import { normalizeCreativeSkillsState, currentCreativeSkillVersion } from './creative-skills.js';
import { generatedSkillFiles } from './creative-skill-package.js';
import { SKILL_OPERATION_SPECS } from './skill-operation-specs.js';
import { validate } from './case-operation-specs.js';
import { sha256Blob } from './blob-digest.js';
import { AGENT_CHUNK_BYTES, agentError, bytesToBase64 } from './agent-protocol.js';

const canonical = value => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object'
  ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;
export const skillRevision = value => sha256Blob(new Blob([JSON.stringify(canonical(value))]));
const fail = (code, message) => { throw agentError(code, message); };
function checkRevision(actual, expected, offset = 0) {
  if (offset && !expected) fail('skill_revision_required', '继续读取请携带首屏revision，避免混合不同版本。');
  if (expected && expected !== actual) fail('skill_changed', 'Skill已变化，请重新读取并使用新revision。');
}
function summary(skill) {
  return { id: skill.id, callName: skill.callName, description: skill.description,
    portableId: skill.portableId, versionId: skill.currentVersionId, updatedAt: skill.updatedAt };
}
function chunk(content, offset, length) {
  if (offset > content.length) fail('invalid_input', '读取位置超出正文。');
  return { content: content.slice(offset, offset + length), offset, totalCharacters: content.length,
    nextOffset: offset + length < content.length ? offset + length : null };
}

export function createSkillOperations({ loadState, readBlob }) {
  return { async execute(name, input = {}) {
    const spec = SKILL_OPERATION_SPECS.find(item => item.name === name);
    if (!spec) fail('unknown_operation', '未知Skill操作。');
    validate(spec.parameters, input, name);
    const { offset = 0, length = 12000, expectedRevision } = input;
    const skills = normalizeCreativeSkillsState((await loadState()).creativeSkills).items;
    if (name === 'list_skills') {
      const query = (input.query || '').trim().toLocaleLowerCase();
      const items = skills.filter(item => `${item.callName}\n${item.description}`.toLocaleLowerCase().includes(query)).map(summary);
      const revision = await skillRevision({ query, items });
      checkRevision(revision, expectedRevision, offset);
      // Same summary page size as the case/workspace tools.
      return { revision, total: items.length, offset, items: items.slice(offset, offset + 24),
        nextOffset: offset + 24 < items.length ? offset + 24 : null, untrustedContent: true };
    }
    const skill = skills.find(item => item.id === input.skillId);
    if (!skill) fail('skill_not_found', 'Skill已删除或不存在，请重新查找。');
    const revision = await skillRevision(skill);
    checkRevision(revision, expectedRevision, offset);
    const version = input.versionId ? skill.versions.find(item => item.id === input.versionId) : currentCreativeSkillVersion(skill);
    if (!version) fail('skill_version_not_found', 'Skill版本不存在或已超出保留范围。');
    const isCurrent = version.id === skill.currentVersionId;
    const packageFiles = isCurrent ? skill.packageFiles : version.packageFiles;
    const description = isCurrent ? skill.description : version.description ?? '';
    const common = { ...summary(skill), versionId: version.id, description, revision,
      packageFileScope: packageFiles ? 'version' : 'unrecorded',
      currentFileHasFrontmatter: Boolean(description), untrustedContent: true };
    // Preserve the imported package verbatim. Generated current text is a
    // separate source, so edits never silently serve an older imported main file
    // and custom frontmatter/binary references remain available in the package.
    const generated = () => {
      // Plain Markdown imports may have no description. Keep that fact and the
      // saved body, rather than invent metadata or make all files unreadable.
      const files = generatedSkillFiles({ portableId: skill.portableId, description: description || skill.callName, ...version });
      if (!description) files.set('SKILL.md', new Blob([version.skillMarkdown], { type: 'text/markdown' }));
      return files;
    };
    if (name === 'read_skill') {
      const part = input.part || 'body';
      let content;
      if (part === 'body') content = version.skillMarkdown;
      if (part === 'references') content = JSON.stringify({ references: version.references, provenanceMarkdown: version.provenanceMarkdown });
      if (part === 'versions') content = JSON.stringify(skill.versions);
      if (part === 'files') content = JSON.stringify([
        ...[...generated()].map(([path, blob]) => ({ source: 'current', path, byteSize: blob.size, mimeType: blob.type })),
        ...(packageFiles ?? []).map(({ path, byteSize, mimeType }) => ({ source: 'package', path, byteSize, mimeType }))
      ]);
      return { ...common, part, runtimeDependencies: isCurrent ? skill.runtimeDependencies : version.runtimeDependencies ?? [], ...chunk(content, offset, length) };
    }
    let blob, storedHash;
    if (input.source === 'current') blob = generated().get(input.path);
    else {
      if (!packageFiles) fail('skill_files_unrecorded', '这个旧版本没有记录脚本或包文件；不能用当前文件代替。');
      const file = packageFiles.find(file => file.path === input.path);
      if (!file) fail('skill_file_not_found', '文件不属于此Skill，请重新读取文件清单。');
      blob = await readBlob(file.assetId);
      storedHash = file.sha256;
      if (!(blob instanceof Blob)) fail('skill_file_missing', '已保存的Skill包文件缺失，请先恢复文件。');
      if (file.byteSize && blob.size !== file.byteSize) fail('skill_file_changed', 'Skill包文件大小不一致，请先检查资料。');
    }
    if (!(blob instanceof Blob)) fail('skill_file_not_found', '文件不属于此Skill，请重新读取文件清单。');
    const fileInfo = { ...common, source: input.source, path: input.path, name: input.path, mimeType: blob.type, byteSize: blob.size };
    const sha256 = await sha256Blob(blob);
    if (storedHash && storedHash !== sha256) fail('skill_file_changed', 'Skill文件与保存时摘要不一致，请先恢复原件。');
    if (input.expectedHash && input.expectedHash !== sha256) fail('skill_file_changed', 'Skill文件内容已变化，请从头读取。');
    if (offset && !input.expectedHash) fail('skill_hash_required', '文件续读须携带首块sha256为expectedHash。');
    if (input.encoding !== 'binary') {
      let content;
      try { content = new TextDecoder('utf-8', { fatal: true }).decode(await blob.arrayBuffer()); }
      catch { fail('skill_file_binary', '文件不是UTF-8文字，请使用binary或download_skill_file读取原件。'); }
      return { ...fileInfo, sha256, encoding: 'text', ...chunk(content, offset, length) };
    }
    if (offset > blob.size) fail('invalid_input', '读取位置超出文件。');
    const bytes = new Uint8Array(await blob.slice(offset, offset + AGENT_CHUNK_BYTES).arrayBuffer());
    return { ...fileInfo, sha256, encoding: 'base64', offset, data: bytesToBase64(bytes),
      nextOffset: offset + bytes.length < blob.size ? offset + bytes.length : null };
  } };
}
