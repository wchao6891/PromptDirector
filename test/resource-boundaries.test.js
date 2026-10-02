import test from 'node:test';
import { createHash } from 'node:crypto';
import { undoDigest } from '../extension/undo-delta.js';
import { serializeUndoState } from '../extension/undo-state.js';
import assert from 'node:assert/strict';
import { operationBudget, stagingByteBudget, readJsonWithResourceBudget } from '../extension/resource-policy.js';
import { ResourceCache } from '../extension/resource-cache.js';
import { createLibraryStorage } from '../extension/library-storage.js';
import { completeLibraryViewSummary } from '../extension/library-view-summary.js';
import { createLibraryViewReader } from '../extension/library-view-state.js';
import { createCreativeSkill, saveCreativeSkillVersion, currentCreativeSkillVersion, protectedSkillVersionIds } from '../extension/creative-skills.js';
import { createComposerSession, normalizeComposerSessions, createComposerAssemblySnapshot, completeComposerAssemblySnapshot } from '../extension/composer.js';
import { createAgentTransfers } from '../extension/agent-transfers.js';
import { createComposerToolProgress, discardComposerToolProgress } from '../extension/composer-tool-progress.js';
import { readImageDimensions } from '../extension/image-metadata.js';
import { assertImageDimensions } from '../extension/resource-limits.js';
import { prepareLocalMedia } from '../extension/local-media.js';
import { parseSkillMarkdown, buildSkillMarkdown } from '../extension/creative-skill-package.js';

const MiB = 1024 * 1024;

test('untrusted backup JSON checks parse memory before copying; full accepted text, cancellation and malformed-file errors stay distinct', async () => {
  let copied = false;
  await assert.rejects(readJsonWithResourceBudget({ size: 1000, text: async () => { copied = true; return '{}'; } }, {
    budget: { workingBytes: 600 }, label: 'library.json'
  }), { code: 'RESOURCE_BUDGET_REACHED' });
  assert.equal(copied, false, 'resource protection must run before a full UTF-16/JSON copy');
  const body = '完整资料，保留尾部'.repeat(3000);
  const file = new Blob([JSON.stringify({ body })]);
  assert.equal((await readJsonWithResourceBudget(file)).body, body);
  assert.equal(await file.text(), JSON.stringify({ body }), 'the original backup remains unchanged');
  await assert.rejects(readJsonWithResourceBudget(new Blob(['{broken'])), SyntaxError);
  const controller = new AbortController(); controller.abort();
  await assert.rejects(readJsonWithResourceBudget(file, { signal: controller.signal }), { name: 'AbortError' });
});
function memoryStore(initial = {}) {
  const data = structuredClone(initial), reads = [], writes = [];
  let tail = Promise.resolve();
  const storage = createLibraryStorage({ lock: fn => { const operation = tail.then(fn); tail = operation.catch(() => {}); return operation; }, backend: {
    getKeys: async () => Object.keys(data),
    get: async keys => { reads.push(keys); return structuredClone(keys == null ? data : Object.fromEntries((typeof keys === 'string' ? [keys] : keys).filter(key => Object.hasOwn(data, key)).map(key => [key, data[key]]))); },
    set: async update => { writes.push(structuredClone(update)); Object.assign(data, structuredClone(update)); },
    remove: async keys => { for (const key of Array.isArray(keys) ? keys : [keys]) delete data[key]; }
  } });
  return { data, reads, writes, storage };
}

test('working and staging budgets follow measured resources rather than original-file or case quotas', async () => {
  const budget = operationBudget({}, { performance: { memory: { jsHeapSizeLimit: 800 * MiB } } });
  assert.equal(budget.workingBytes, 200 * MiB);
  assert.equal(budget.maxImagePixels * 8, budget.workingBytes);
  assert.ok(budget.maxRequests > 0 && budget.maxDurationMs > 0);
  assert.equal(await stagingByteBudget({ estimateStorage: async () => ({ quota: 101, usage: 51 }) }), 25);
  assert.equal(await stagingByteBudget({ estimateStorage: async () => ({ quota: 100, usage: 100 }) }), 0);
});

test('source and small gallery summary share a commit, concurrent updates preserve the other source', async () => {
  const run = memoryStore({ libraryViewSummary: completeLibraryViewSummary({ trashState: { items: [] } }) });
  await Promise.all([
    run.storage.set({ trashState: { items: [{ id: 'preserved', snapshot: { text: '完整原文'.repeat(1000) } }] } }),
    run.storage.set({ analysisRebuildStaging: { jobId: 'task', results: { one: { text: '完整恢复结果'.repeat(1000) } } } })
  ]);
  assert.equal(run.data.libraryViewSummary.trashCount, 1);
  assert.deepEqual(run.data.libraryViewSummary.analysisStaging, { jobId: 'task', entryIds: ['one'] });
  assert.ok(JSON.stringify(run.data.libraryViewSummary).length < 300);
  assert.ok(run.writes.every(update => update.libraryViewSummary));
  assert.equal(run.reads.includes(null), false);
  await run.storage.set({ analysisRebuildStaging: null });
  assert.deepEqual(run.data.libraryViewSummary.analysisStaging.entryIds, []);
  assert.equal(run.data.trashState.items[0].id, 'preserved');
});

test('unchanged Skill saves preserve version identity, bounded automatic versions protect work references and current full text', () => {
  let { state, skill } = createCreativeSkill({}, { callName: '方法', skillMarkdown: '完整正文-0' }, { id: 'skill', versionId: 'first' });
  const noChange = saveCreativeSkillVersion(state, skill.id, { skillMarkdown: '完整正文-0' });
  assert.equal(noChange.unchanged, true); assert.equal(noChange.skill.currentVersionId, 'first');
  const original = structuredClone(state);
  for (let i = 1; i <= 100; i++) {
    ({ state, skill } = saveCreativeSkillVersion(state, skill.id, { skillMarkdown: `完整正文-${i}` }, {
      versionId: `v${i}`, protectedVersionIds: ['first'], budget: { maxAutomaticHistoryBytes: 1024, maxAutomaticHistoryItems: 2 }
    }));
  }
  assert.deepEqual(original.items[0].versions.map(version => version.id), ['first']);
  assert.deepEqual(skill.versions.map(version => version.id), ['first', 'v98', 'v99', 'v100']);
  assert.equal(currentCreativeSkillVersion(skill).skillMarkdown, '完整正文-100');
  assert.deepEqual(protectedSkillVersionIds({ composerSessions: [{ appliedSkills: [{ versionId: 'first' }], assemblySnapshots: [{ skills: [{ version: 'v99' }] }] }] }), ['first', 'v99']);
});

test('automatic Skill history shares one library budget instead of multiplying with each user-owned Skill', () => {
  let state = {};
  for (let i = 0; i < 20; i++) ({ state } = createCreativeSkill(state, {
    callName: `完整方法${i}`, skillMarkdown: `原文${i}`
  }, { id: `skill-${i}`, versionId: `original-${i}` }));
  const before = structuredClone(state);
  for (let i = 0; i < 20; i++) ({ state } = saveCreativeSkillVersion(state, `skill-${i}`, {
    skillMarkdown: `修改后的完整原文${i}`
  }, { versionId: `current-${i}`, protectedVersionIds: ['original-0'],
    budget: { maxAutomaticHistoryItems: 2, maxAutomaticHistoryBytes: 4096 } }));
  assert.equal(state.items.length, 20, 'all user-owned Skills remain');
  assert.ok(state.items.every(skill => skill.currentVersionId === `current-${skill.id.split('-')[1]}`));
  assert.equal(state.items.flatMap(skill => skill.versions).length, 23, '20 current plus one work reference plus two automatic versions total');
  assert.equal(state.items[0].versions.find(version => version.id === 'original-0').skillMarkdown, '原文0');
  assert.deepEqual(before.items.map(skill => skill.versions.length), Array(20).fill(1), 'the pre-commit input remains unchanged');
});

test('completed assembly auxiliaries are compacted while user requests, evidence, results and unfinished work remain', () => {
  const snapshots = Array.from({ length: 80 }, (_, i) => completeComposerAssemblySnapshot(createComposerAssemblySnapshot({
    id: `s${i}`, turnId: `turn${i}`, userMessageId: `user${i}`, createdAt: new Date(i * 1000).toISOString(),
    agentInstruction: '重复自动装配文字'.repeat(1000), taskMethod: '方法', userRequest: `完整用户要求${i}`,
    references: [{ alias: '@参考1', title: '原案', referenceText: `完整来源${i}` }]
  }), { usage: { promptTokens: i } }));
  const pending = createComposerAssemblySnapshot({ id: 'pending', turnId: 'pending', userMessageId: 'work', agentInstruction: '未完成工作', createdAt: new Date(90000).toISOString() });
  const session = createComposerSession({ assemblySnapshots: [...snapshots, pending], messages: [{ id: 'user', role: 'user', content: '原始要求' }] });
  assert.equal(session.assemblySnapshots.length, 81);
  assert.equal(session.assemblySnapshots[0].auxiliaryCompacted, true);
  assert.equal(session.assemblySnapshots[0].userRequest, '完整用户要求0');
  assert.equal(session.assemblySnapshots[0].references[0].referenceText, '完整来源0');
  assert.equal(session.assemblySnapshot.agentInstruction, '未完成工作');
  assert.equal(session.messages[0].content, '原始要求');
});

test('automatic assembly text shares a budget across work conversations, preserving every request and latest task', () => {
  const sessions = Array.from({ length: 60 }, (_, i) => ({ id: `work-${i}`,
    messages: [{ id: `user-${i}`, role: 'user', content: `完整用户任务${i}` }],
    assemblySnapshots: Array.from({ length: 3 }, (_, j) => completeComposerAssemblySnapshot(createComposerAssemblySnapshot({
      id: `snapshot-${i}-${j}`, turnId: `turn-${i}-${j}`, userMessageId: `user-${i}`,
      createdAt: new Date((i * 3 + j) * 1000).toISOString(), userRequest: `完整要求${i}-${j}`,
      agentInstruction: '可重建的自动装配副本'.repeat(1000)
    }))) }));
  const normalized = normalizeComposerSessions(sessions);
  assert.equal(normalized.length, 60);
  const histories = normalized.flatMap(session => session.assemblySnapshots.slice(0, -1));
  assert.ok(histories.filter(snapshot => !snapshot.auxiliaryCompacted).length <= operationBudget().maxAutomaticHistoryItems);
  assert.ok(normalized.every(session => session.assemblySnapshot.agentInstruction.length > 0), 'every latest task remains complete');
  assert.equal(normalized.flatMap(session => session.assemblySnapshots).length, 180);
  assert.ok(normalized.every(session => session.messages[0].content === `完整用户任务${session.id.split('-')[1]}`));
  assert.ok(normalized.every(session => session.assemblySnapshots.every(snapshot => snapshot.userRequest.startsWith('完整要求'))));
  assert.ok(sessions.every(session => session.assemblySnapshots.every(snapshot => snapshot.agentInstruction.length > 0)));
});

test('expired abandoned transfers release chunks; current tasks, committed originals and touched resumable uploads survive', async () => {
  const staleAt = '2020-01-01T00:00:00.000Z';
  const run = memoryStore(Object.fromEntries(['abandoned', 'owned', 'completed', 'resumed'].map(id => [`agentUpload:${id}`, {
    id, assetId: `file:${id}`, createdAt: staleAt, offset: 1, chunks: 1, state: id === 'completed' ? 'committed' : 'uploading'
  }])));
  // Use the current protocol prefix, rather than depending on a private literal.
  const { AGENT_UPLOAD_PREFIX } = await import('../extension/agent-protocol.js');
  const records = Object.values(run.data); for (const key of Object.keys(run.data)) delete run.data[key];
  for (const record of records) run.data[AGENT_UPLOAD_PREFIX + record.id] = record;
  const deleted = [];
  const transfers = createAgentTransfers({ storage: run.storage, readBlob: async () => null, writeBlob: async () => {}, deleteBlob: async id => deleted.push(id),
    prepare: async () => ({}), protectedIds: async () => ['file:owned'], now: () => Date.parse('2026-10-02T00:00:00Z') });
  await transfers.get('resumed');
  assert.equal((await transfers.prune()).discarded, 1);
  assert.ok(deleted.includes('file:abandoned'));
  assert.ok(deleted.includes(`${AGENT_UPLOAD_PREFIX}abandoned:0`));
  assert.equal(deleted.includes('file:owned'), false);
  assert.ok(run.data[AGENT_UPLOAD_PREFIX + 'completed']); assert.ok(run.data[AGENT_UPLOAD_PREFIX + 'resumed']);
  assert.equal(run.reads.includes(null), false);
});

test('continuations are isolated by work identity and session deletion never erases another task', async () => {
  const run = memoryStore({ composerSessions: [{ id: 'one' }, { id: 'two' }] });
  const one = createComposerToolProgress({ storage: run.storage, sessionId: 'one', userMessageId: 'turn' });
  const two = createComposerToolProgress({ storage: run.storage, sessionId: 'two', userMessageId: 'turn' });
  await one.saveContinuation({ protocol: 'chat_completions', body: { model: 'm', messages: ['完整工作'] } });
  await two.saveContinuation({ protocol: 'chat_completions', body: { model: 'm', messages: ['另一任务'] } });
  await assert.rejects(one.loadContinuation({ protocol: 'responses', model: 'm' }), /模型或协议/);
  await discardComposerToolProgress(run.storage, 'one');
  assert.equal(await one.loadContinuation({ protocol: 'chat_completions', model: 'm' }), null);
  assert.equal((await two.loadContinuation({ protocol: 'chat_completions', model: 'm' })).body.messages[0], '另一任务');
});

test('cache evicts released resources while visible resources and alias owners stay valid', () => {
  const disposed = [], pinned = new Set(['visible']);
  const cache = new ResourceCache({ maxEntries: 2, protectedValue: value => pinned.has(value), dispose: value => disposed.push(value) });
  cache.set('visible', 'visible'); cache.set('alias1', 'same'); cache.set('alias2', 'same');
  assert.equal(disposed.includes('same'), false);
  cache.set('last', 'new'); assert.deepEqual(disposed, ['same']);
  assert.equal(cache.get('visible'), 'visible');
  pinned.clear(); cache.set('final', 'final'); cache.trim(); assert.equal(cache.size, 2);
});

function box(kind, ...chunks) {
  const body = Buffer.concat(chunks.map(value => Buffer.from(value))), header = Buffer.alloc(8);
  header.writeUInt32BE(body.length + 8); header.write(kind, 4); return Buffer.concat([header, body]);
}
function ispe(width, height) { const payload = Buffer.alloc(12); payload.writeUInt32BE(width, 4); payload.writeUInt32BE(height, 8); return box('ispe', payload); }

test('AVIF inspects the primary image properties before any decoder, excluding an unrelated property', async () => {
  const pitm = Buffer.alloc(6); pitm.writeUInt16BE(1, 4);
  const ipma = Buffer.alloc(12); ipma.writeUInt32BE(1, 4); ipma.writeUInt16BE(1, 8); ipma[10] = 1; ipma[11] = 2;
  const file = new Blob([box('meta', Buffer.alloc(4), box('pitm', pitm), box('iprp', box('ipco', ispe(100000, 100000), ispe(320, 240)), box('ipma', ipma)))], { type: 'image/avif' });
  assert.deepEqual(await readImageDimensions(file), { width: 320, height: 240 });
});

test('extreme image pixels refuse decoding but keep the original local file with a truthful processing warning', async () => {
  const png = Buffer.alloc(24); png.set([137,80,78,71,13,10,26,10]); png.write('IHDR', 12); png.writeUInt32BE(100000, 16); png.writeUInt32BE(100000, 20);
  const file = new File([png], 'original.png', { type: 'image/png' });
  const prepared = await prepareLocalMedia(file, 'original');
  assert.equal(prepared.blob, file); assert.equal(prepared.asset.width, 100000);
  assert.match(prepared.asset.processingWarnings[0], /原件完整保留/);
  assert.throws(() => assertImageDimensions(100000, 100000), /解码预算/);
});

test('official Skill metadata bounds reject rather than truncate, while the human description and full body remain', () => {
  const body = '完整正文'.repeat(1000), description = '😀'.repeat(1024);
  assert.equal(parseSkillMarkdown(buildSkillMarkdown({ name: 'valid', description, body })).body, body);
  assert.throws(() => buildSkillMarkdown({ name: 'valid', description: description + 'x', body }), /1024/);
  assert.throws(() => parseSkillMarkdown(`---\nname: valid\ndescription: valid\ncompatibility: ${'x'.repeat(501)}\n---\n${body}`), /500/);
  const { skill } = createCreativeSkill({}, { callName: '方法', skillMarkdown: body, description: '人工完整说明'.repeat(300) });
  assert.equal(skill.description, '人工完整说明'.repeat(300));
});


test('streamed undo digest matches stable JSON across escapes, a surrogate at a chunk boundary, arrays and large unchanged text', () => {
  const value = { z: 'x'.repeat(65535) + '😀\n"\\' + '完整'.repeat(40000), a: [0, false, null, { skipped: undefined, text: '\ud800' }] };
  assert.equal(undoDigest(value), createHash('sha256').update(serializeUndoState(value)).digest('hex'));
});
