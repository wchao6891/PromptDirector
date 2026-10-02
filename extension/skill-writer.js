import { createCreativeSkill, normalizeCreativeSkillsState, saveCreativeSkillVersion, restoreCreativeSkillVersion,
  skillPackageAssetIds, currentCreativeSkillVersion, protectedSkillVersionIds } from './creative-skills.js';
import { parseSkillFiles } from './creative-skill-package.js';
import { SKILL_WRITE_SPECS } from './skill-operation-specs.js';
import { validate } from './case-operation-specs.js';
import { skillRevision } from './skill-operations.js';
import { sha256Blob } from './blob-digest.js';
import { agentError } from './agent-protocol.js';

const fail = (code, message) => { throw agentError(code, message); };
export function createSkillWriter({ storage, transfers, readBlob, commit, enqueue, cleanup = async () => {} }) {
  async function verifyFile(file) {
    const blob = await readBlob(file.assetId);
    if (!(blob instanceof Blob) || (file.byteSize && blob.size !== file.byteSize) ||
        (file.sha256 && await sha256Blob(blob) !== file.sha256)) {
      fail('skill_file_missing', 'Skill文件缺失或内容不一致，未更新版本。');
    }
    return blob;
  }
  return { execute: (name, input) => enqueue(() => transfers.lock(async () => {
    const spec = SKILL_WRITE_SPECS.find(item => item.name === name);
    if (!spec) fail('unknown_operation', '未知Skill写入。');
    validate(spec.parameters, input, name);
    const key = `skillOperation:${input.requestId}`;
    const fingerprint = await skillRevision({ name, input });
    const stored = await storage.get(['creativeSkills', 'composerSessions', 'creativeRuns', 'creativeJobs', key]);
    const historyOptions = { protectedVersionIds: protectedSkillVersionIds(stored) };
    if (stored[key]) {
      if (stored[key].fingerprint !== fingerprint) fail('request_conflict', '此请求编号已用于另一项Skill操作。');
      return { ...stored[key].result, replayed: true };
    }
    const state = normalizeCreativeSkillsState(stored.creativeSkills);
    const current = input.skillId && state.items.find(item => item.id === input.skillId);
    if (input.skillId && !current) fail('skill_not_found', 'Skill已删除或不存在。');
    if (current) {
      if (!input.expectedRevision) fail('skill_revision_required', '修改Skill前请先读取当前revision。');
      if (await skillRevision(current) !== input.expectedRevision) fail('skill_changed', 'Skill已变化，请重读后核对，不能覆盖新编辑。');
    } else if (input.expectedRevision) fail('invalid_input', '新建Skill不接受旧版本编号。');
    let changed;
    const records = [];
    if (name === 'restore_skill') {
      const target = current.versions.find(version => version.id === input.versionId);
      if (!target) fail('skill_version_not_found', '要恢复的版本不存在或已超出保留范围。');
      const files = target.id === current.currentVersionId ? current.packageFiles : target.packageFiles;
      if (input.mode !== 'text') {
        if (!files) fail('skill_files_unrecorded', '这个旧版本没有包文件记录；只能在用户明确要求时恢复文字。');
        for (const file of files) await verifyFile(file);
        changed = restoreCreativeSkillVersion(state, current.id, target.id, historyOptions);
      } else changed = saveCreativeSkillVersion(state, current.id, {
        skillMarkdown: target.skillMarkdown, references: target.references, provenanceMarkdown: target.provenanceMarkdown,
        source: target.source, reason: 'restored'
      }, historyOptions);
    } else {
      let values = input;
      if (input.files) {
        if (['skillMarkdown','references','description','portableId'].some(key => Object.hasOwn(input,key))) {
          fail('invalid_input', '整包保存以SKILL.md为准，不要同时传另一份正文、引用、说明或可移植ID。');
        }
        const blobs = new Map(), recordsByPath = new Map();
        for (const item of input.files) {
          const path = item.path.replace(/\\/g, '/');
          if (blobs.has(path) || /^[a-z]:/i.test(path) || /[\u0000-\u001f]/u.test(path)) fail('invalid_input', 'Skill包文件路径重复或无效。');
          const record = await transfers.get(item.transferId);
          if (record.purpose !== 'skill-file' || !['ready','committed'].includes(record.state)) {
            fail('transfer_not_ready', '请通过Skill文件传输接口传完并校验文件后再保存。');
          }
          blobs.set(path, await verifyFile(record)); recordsByPath.set(path, record); records.push(record);
        }
        const parsed = await parseSkillFiles(blobs);
        if (current && parsed.name !== current.portableId) fail('skill_identity_changed', '包内name与现有Skill可移植ID不同；请核对目标或明确新建Skill。');
        if (!current && state.items.some(skill => skill.portableId === parsed.name)) fail('skill_identity_conflict', '已有同名可移植ID；请核对并更新原Skill，或明确为新包设置不同name。');
        values = { callName: input.callName ?? current?.callName ?? parsed.name, portableId: parsed.name,
          description: parsed.description, skillMarkdown: parsed.body, references: parsed.references,
          provenanceMarkdown: parsed.references.find(ref => ref.path === 'references/provenance.md')?.markdown ?? '',
          runtimeDependencies: parsed.dependencies, textModeConfirmed: parsed.requiresTextModeConfirmation,
          source: 'imported', reason: 'imported',
          packageFiles: [...parsed.files].map(([path,blob]) => {
            const record = recordsByPath.get(path);
            return { path, assetId: record.assetId, byteSize: blob.size, mimeType: blob.type || record.mimeType || 'application/octet-stream', sha256: record.sha256 };
          }) };
      } else {
        if (!input.skillMarkdown) fail('invalid_input', '请提供完整正文或完整文件包。');
        if (!current && !input.callName) fail('invalid_input', '新建Skill需要调用名。');
        if (current && input.portableId && input.portableId !== current.portableId) fail('skill_identity_changed', '已有Skill的可移植ID不能在正文更新时改变。');
        if (input.references) for (const ref of input.references) {
          if (!/^references\/.+\.md$/iu.test(ref.path) || /[\\\u0000-\u001f]/u.test(ref.path) || ref.path.split('/').some(part => !part || part === '.' || part === '..')) {
            fail('invalid_input', '参考路径必须是references内的Markdown文件，不能静默丢弃。');
          }
        }
        if (new Set(input.references?.map(ref=>ref.path)).size !== (input.references?.length ?? 0)) fail('invalid_input', '参考路径不能重复。');
      }
      changed = current ? saveCreativeSkillVersion(state, current.id, values, historyOptions) : createCreativeSkill(state, values);
    }
    const version = currentCreativeSkillVersion(changed.skill);
    const result = { ok: true, requestId: input.requestId, skillId: changed.skill.id, callName: changed.skill.callName,
      versionId: version.id, revision: await skillRevision(changed.skill),
      fileCount: changed.skill.packageFiles.length, restoredScope: name === 'restore_skill' ? input.mode ?? 'complete' : undefined };
    const update = { creativeSkills: changed.state, [key]: { fingerprint, result } };
    for (const record of records) update[transfers.key(record.id)] = { ...record, prepared: null, chunks: 0, state: 'committed', skillId: changed.skill.id };
    // Uploaded files stay staged until this single commit publishes both the
    // Skill and its receipt. An ambiguous error never deletes referenced bytes.
    await commit(update);
    const retained = new Set(changed.state.items.flatMap(skillPackageAssetIds));
    const expired = state.items.flatMap(skillPackageAssetIds).filter(id => !retained.has(id));
    if (expired.length) {
      try { await cleanup(expired); }
      catch { return { ...result, warnings: ['Skill已保存；不再引用的旧文件清理未完成。'] }; }
    }
    return result;
  })) };
}
