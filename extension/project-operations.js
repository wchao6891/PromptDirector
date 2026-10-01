import { createCollection, renameCollection, normalizeOrganizerState, collectionPath, collectionSubtreeIds } from './organizer.js';
import { validateProjectOperation } from './project-operation-specs.js';
import { sha256Blob } from './blob-digest.js';
import { agentError } from './agent-protocol.js';

const canonical = value => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object'
  ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;
const hash = value => sha256Blob(new Blob([JSON.stringify(canonical(value))]));
export const projectRevision = project => hash(project);
export function findProject(organizer, id) {
  const project = organizer.collections.find(item => item.id === id);
  if (!project) throw agentError('project_not_found', '项目已不存在，请重新读取项目树');
  return project;
}
export async function checkProjectRevision(organizer, id, expected) {
  const project = findProject(organizer, id);
  if (await projectRevision(project) !== expected) throw agentError('project_conflict', '项目要求或内容已变化，请重新读取后核对');
  return project;
}
async function summary(organizer, project) {
  return { id: project.id, name: project.name, parentId: project.parentId, path: collectionPath(organizer, project.id).map(({ id, name }) => ({ id, name })),
    requirements: project.requirements || '', caseCount: project.entryIds.length, revision: await projectRevision(project) };
}
export function createProjectOperations({ loadState, storage, commit, enqueue }) {
  return {
    read: input => enqueue(async () => {
      validateProjectOperation('read_projects', input);
      const organizer = normalizeOrganizerState((await loadState()).organizerState);
      const revision = await hash(organizer);
      if (input.expectedRevision && revision !== input.expectedRevision) throw agentError('project_conflict', '项目树已变化，请从第一页重新读取');
      if (input.projectId) findProject(organizer, input.projectId);
      const scope = input.projectId && new Set(collectionSubtreeIds(organizer, input.projectId));
      const projects = await Promise.all(organizer.collections.filter(p => !scope || scope.has(p.id)).map(p => summary(organizer, p)));
      const text = JSON.stringify(projects), offset = input.offset || 0, length = input.length || 12000;
      return { ok: true, revision, content: text.slice(offset, offset + length), offset, total: projects.length,
        totalCharacters: text.length, nextOffset: offset + length < text.length ? offset + length : null, untrustedContent: true };
    }),
    execute: (operation, input) => enqueue(async () => {
      validateProjectOperation(operation, input);
      if (!['create_project', 'update_project'].includes(operation)) throw agentError('invalid_input', '未知项目写入');
      const key = `projectOperation:${input.requestId}`, fingerprint = await hash({ operation, input });
      const prior = (await storage.get(key))[key];
      if (prior) {
        if (prior.fingerprint !== fingerprint) throw agentError('request_conflict', '此请求编号已用于其他项目操作');
        return { ...prior.result, replayed: true };
      }
      let organizer = normalizeOrganizerState((await loadState()).organizerState), project;
      if (operation === 'create_project') {
        const created = createCollection(organizer, input.name, input.parentId);
        organizer = created.state; project = created.item;
      } else {
        project = await checkProjectRevision(organizer, input.projectId, input.expectedRevision);
        if (input.name === undefined && input.requirements === undefined) throw agentError('invalid_input', '请指定要修改的名称或项目要求');
        if (input.name !== undefined) organizer = renameCollection(organizer, project.id, input.name);
        project = findProject(organizer, project.id);
      }
      if (input.requirements !== undefined) project.requirements = input.requirements;
      const result = { ok: true, requestId: input.requestId, project: await summary(organizer, project) };
      await commit({ organizerState: organizer, [key]: { fingerprint, result } });
      return result;
    })
  };
}
