import { caseRevision } from './case-operations.js';
import { checkProjectRevision } from './project-operations.js';
import { normalizeOrganizerState } from './organizer.js';
import { MATERIAL_PROPERTIES } from './project-operation-specs.js';
import { validate } from './case-operation-specs.js';
import { agentError } from './agent-protocol.js';

// Validate only the new metadata here; attachment staging has its own boundary.
export async function materialProvenance(state, input, collectionId) {
  for (const key of ['projectRevision', 'sourceReferences', 'previousCreation']) {
    if (input[key] !== undefined) validate(MATERIAL_PROPERTIES[key], input[key], key);
  }
  if (input.projectRevision) {
    if (!collectionId) throw agentError('invalid_input', '项目版本必须对应明确项目');
    await checkProjectRevision(normalizeOrganizerState(state.organizerState), collectionId, input.projectRevision);
  }
  const checked = new Map();
  async function check(reference) {
    const entry = state.entries.find(item => item.id === reference.caseId);
    if (!entry) throw agentError('source_case_missing', '来源成员案例已不存在，请核对参考范围');
    if (!checked.has(entry.id)) checked.set(entry.id, await caseRevision(state, entry));
    if (checked.get(entry.id) !== reference.expectedRevision) throw agentError('case_conflict', '参考或前一成果已变化，请重新读取并核对实际使用的资料');
    return entry;
  }
  const references = [];
  for (const reference of input.sourceReferences || []) {
    const entry = await check(reference);
    const asset = reference.assetId && entry.mediaAssets?.find(a => a.id === reference.assetId && a.usage !== 'poster');
    if (reference.assetId && !asset) throw agentError('asset_not_in_case', '参考素材不属于指定成员案例');
    const timed = reference.startMs !== undefined || reference.endMs !== undefined;
    if (timed && (!asset || !['video', 'audio'].includes(asset.kind) || reference.startMs === undefined || reference.endMs === undefined || reference.endMs <= reference.startMs)) {
      throw agentError('invalid_input', '参考片段需要视频或音频素材，以及先后有序的开始和结束毫秒');
    }
    if (timed && asset.durationMs > 0 && reference.endMs > asset.durationMs) throw agentError('invalid_input', '参考片段超出素材已知时长');
    const { expectedRevision, ...identity } = reference;
    references.push({ ...identity, revision: expectedRevision, title: entry.title, sourceUrl: entry.url || '' });
  }
  let creationVersion;
  if (input.previousCreation) {
    if (input.kind !== 'creation') throw agentError('invalid_input', '只有创作成果才能另存创作版本');
    const previous = await check(input.previousCreation);
    if (previous.agentProvenance?.kind !== 'creation') throw agentError('invalid_input', '前一版本必须是已保存的创作成果');
    creationVersion = { rootCaseId: previous.agentProvenance.creationVersion?.rootCaseId || previous.id,
      number: (previous.agentProvenance.creationVersion?.number || 1) + 1,
      previous: { caseId: previous.id, revision: input.previousCreation.expectedRevision } };
  }
  return { ...(input.sourceReferences !== undefined ? { references } : {}), ...(creationVersion ? { creationVersion } : {}),
    ...(collectionId ? { project: { id: collectionId, ...(input.projectRevision ? { revision: input.projectRevision } : {}) } } : {}) };
}
