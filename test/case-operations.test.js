import {ANALYSIS_BATCH_SPECS} from '../extension/analysis-batch-specs.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { createCaseOperations, caseRevision, planCaseOperation } from '../extension/case-operations.js';
import { validateCaseOperation, CASE_OPERATION_SPECS } from '../extension/case-operation-specs.js';
import { PROJECT_OPERATION_SPECS, SAVE_TEXT_MATERIAL_SPEC } from '../extension/project-operation-specs.js';
import { withComposerCaseOperations } from '../extension/composer-case-operations.js';
import { migrateLibraryState } from '../extension/migration.js';
import { createDefaultFacetCatalog } from '../extension/facets.js';
import { SCHEMA_VERSION } from '../extension/taxonomy.js';

function library() {
  return { entries: [{ id: 'old', title: '原作品', text: '原文与人工编辑', textRevision: 2,
    url: 'https://x.com/first/status/101/history', sourceFacts: { provider: 'x', itemId: 'history', author: '被覆盖的作者', engagement: { likes: 8 } },
    mediaAssets: [
      { id: 'a', kind: 'video', storageMode: 'managed', posterAssetId: 'pa', contentHash: 'a', originalWorkUrl: 'https://x.com/first/status/101' },
      { id: 'pa', kind: 'image', usage: 'poster', storageMode: 'managed' },
      { id: 'b', kind: 'video', storageMode: 'managed', posterAssetId: 'pb', contentHash: 'b', originalWorkUrl: 'https://x.com/second/status/202/history' },
      { id: 'pb', kind: 'image', usage: 'poster', storageMode: 'managed' },
      { id: 'frame', kind: 'image', storageMode: 'managed' }], primaryMediaId: 'a',
    mediaPrompts: [{ assetId: 'b', source: 'manual', text: '独立原词' }],
    timeNotes: [{ id: 'note', assetId: 'b', frameAssetId: 'frame', startMs: 100, text: '节奏', createdAt: '2026-09-01T00:00:00Z' }],
    videoAnalyses: [{ assetId: 'b', text: '分析' }],
    articleDocument: { version: 1, blocks: [{ id: 'body', kind: 'paragraph', text: '原文与人工编辑', sourceOrder: 0 }, { id: 'video-a', kind: 'video', assetId: 'a', sourceOrder: 1 }, { id: 'video-b', kind: 'video', assetId: 'b', sourceOrder: 2 }] },
    customLabels: ['导演选择'], classification: { pathIds: ['video'] }
  }, { id: 'other', title: '另一案例', text: '人工正文', mediaAssets: [], textRevision: 1 }],
  organizerState: { collections: [{ id: 'p', name: '原项目', entryIds: ['old'] }, { id: 'q', name: '目标项目', entryIds: ['other'] }] }, compoundCases: [],
  aiRuntime: { apiKey: 'must-not-expose' } };
}
function service(state) {
  const data = structuredClone(state); let commits = 0, failCommit = false;
  let queue = Promise.resolve();
  const api = createCaseOperations({ loadState: async () => data,
    storage: { get: async key => ({ [key]: data[key] }) },
    enqueue: f => { const next = queue.then(f, f); queue = next.catch(() => {}); return next; },
    commit: async update => { if (failCommit) throw Error('disk full'); commits++; Object.assign(data, structuredClone(update)); } });
  return { data, api, get commits() { return commits; }, fail(value) { failCommit = value; } };
}
async function splitInput(state) {
  return { requestId: 'split-1', caseId: 'old', expectedRevision: await caseRevision(state, state.entries[0]), action: 'split_media',
    groups: [{ assetIds: ['b'], title: '第二个作品', text: '核实后的第二帖原文', sourceUrl: 'https://x.com/second/status/202/history', sourceFacts: { author: '第二作者' } }] };
}

async function combineInput(run) {
  return { requestId: 'combine', caseId: 'old', expectedRevision: (await run.api.read({ caseId: 'old' })).revision,
    action: 'combine_cases', title: '导演组合', coverVisualId: 'frame',
    additionalCases: [{ caseId: 'other', expectedRevision: (await run.api.read({ caseId: 'other' })).revision }] };
}
function combinationLibrary() {
  const state = library();
  state.organizerState.collections[0].entryIds.push('other');
  state.organizerState.collections[1].entryIds = [];
  return state;
}
test('combining and splitting cases preserves all originals, prompts and independent project relations across retries', async () => {
  const run = service(combinationLibrary()), before = structuredClone(run.data), input = await combineInput(run);
  const saved = await run.api.execute('organize_case', input), id = saved.cases[0].caseId;
  assert.deepEqual(run.data.entries, before.entries);
  assert.deepEqual(run.data.organizerState, before.organizerState);
  assert.deepEqual(run.data.compoundCases[0].memberEntryIds, ['old', 'other']);
  assert.equal(run.data.compoundCases[0].coverVisualId, 'frame');
  assert.equal((await run.api.read({ caseId: id })).revision, saved.cases[0].revision);
  assert((await run.api.execute('organize_case', input)).replayed);
  assert.equal(run.data.compoundCases.length, 1);
  const split = { requestId: 'uncombine', caseId: id, expectedRevision: saved.cases[0].revision, action: 'split_compound' };
  const result = await run.api.execute('organize_case', split);
  assert.deepEqual(result.cases.map(item => item.caseId), ['old', 'other']);
  assert.equal(run.data.compoundCases.length, 0);
  assert.deepEqual(run.data.entries, before.entries);
  assert.deepEqual(run.data.organizerState, before.organizerState);
  assert((await run.api.execute('organize_case', split)).replayed);
  assert((await run.api.execute('organize_case', input)).replayed);
  assert.equal(run.data.compoundCases.length, 0, 'an old receipt must not resurrect a dissolved group');
});
test('combining rejects stale or duplicate members and foreign/video covers without changing reviewed data', async () => {
  for (const change of [
    (run, input) => { run.data.entries[1].text = '人工刚改过'; },
    (run, input) => { input.additionalCases[0].caseId = 'old'; },
    (run, input) => { input.coverVisualId = 'a'; },
    (run, input) => { input.coverVisualId = 'pa'; },
    (run, input) => { input.coverVisualId = 'foreign'; }
  ]) {
    const run = service(combinationLibrary()), input = await combineInput(run); change(run, input);
    const before = structuredClone(run.data);
    await assert.rejects(run.api.execute('organize_case', input));
    assert.equal(run.commits, 0); assert.deepEqual(run.data, before);
  }
});
test('compound edits and split check member edits and project changes; compound body edits cannot overwrite member originals', async () => {
  const run = service(combinationLibrary());
  const saved = await run.api.execute('organize_case', await combineInput(run)), id = saved.cases[0].caseId;
  const patch = { requestId: 'compound-edit', caseId: id, expectedRevision: saved.cases[0].revision,
    patch: { title: '新组合名', customLabels: ['导演确认'], coverVisualId: 'frame' } };
  const before = structuredClone(run.data.entries);
  const edited = await run.api.execute('edit_case', patch);
  assert.equal(run.data.compoundCases[0].title, '新组合名');
  assert.deepEqual(run.data.entries, before);
  await assert.rejects(run.api.execute('edit_case', { ...patch, requestId: 'bad-body', expectedRevision: edited.cases[0].revision, patch: { text: '不能替换原文' } }), { code: 'compound_member' });
  run.data.organizerState.collections[0].name = '人工重命名项目';
  await assert.rejects(run.api.execute('organize_case', { requestId: 'stale-split', caseId: id,
    expectedRevision: edited.cases[0].revision, action: 'split_compound' }), { code: 'case_conflict' });
  const fresh = await run.api.read({ caseId: id });
  run.data.entries[1].text = '人工成员新文字';
  await assert.rejects(run.api.execute('edit_case', { ...patch, requestId: 'stale-title', expectedRevision: fresh.revision }), { code: 'case_conflict' });
});
test('cross-project combination without an explicit destination cannot trigger implicit folder copies or move originals', async () => {
  const run = service(library()), input = await combineInput(run), before = structuredClone(run.data);
  await assert.rejects(run.api.execute('organize_case', input), { code: 'compound_project_conflict' });
  assert.equal(run.commits, 0); assert.deepEqual(run.data, before);
});
test('cover changes preserve original media and annotations, reject foreign assets and can restore automatic selection', async () => {
  const run = service(library()), before = structuredClone(run.data.entries[0]);
  const input = { requestId: 'cover', caseId: 'old', expectedRevision: (await run.api.read({ caseId: 'old' })).revision, patch: { coverVisualId: 'pb' } };
  const saved = await run.api.execute('edit_case', input);
  for (const key of Object.keys(before)) assert.deepEqual(run.data.entries[0][key], before[key]);
  assert.equal(run.data.entries[0].coverVisualId, 'pb');
  assert.equal(JSON.parse((await run.api.read({ caseId: 'old' })).content).coverVisualId, 'pb');
  await assert.rejects(run.api.execute('edit_case', { ...input, requestId: 'video-cover', expectedRevision: saved.cases[0].revision, patch: { coverVisualId: 'a' } }), { code: 'asset_not_in_case' });
  await run.api.execute('edit_case', { ...input, requestId: 'auto-cover', expectedRevision: saved.cases[0].revision, patch: { coverVisualId: null } });
  assert(!Object.hasOwn(run.data.entries[0], 'coverVisualId'));
  assert.deepEqual(run.data.entries[0].mediaAssets, before.mediaAssets);
});

test('complete details are paginated consistently and never include library credentials', async () => {
  const { api } = service(library());
  for (const part of ['overview', 'source', 'media', 'document', 'annotations', 'organization']) {
    let offset = 0, content = '', revision;
    do {
      const result = await api.read({ caseId: 'old', part, offset, length: 31, ...(revision ? { expectedRevision: revision } : {}) });
      revision = result.revision; content += result.content; offset = result.nextOffset;
    } while (offset !== null);
    assert.doesNotThrow(() => JSON.parse(content));
    assert(!content.includes('must-not-expose'));
    if (part === 'media') assert(content.includes('originalWorkUrl'));
  }
});
test('field edits correct source identity while preserving originals and unrelated manual work', async () => {
  const run = service(library()), before = structuredClone(run.data.entries[0]);
  const input = { requestId: 'edit', caseId: 'old', expectedRevision: await caseRevision(run.data, before),
    sourceCorrection: { reason: '核对来源帖子后修正错误元信息', fields: ['sourceUrl', 'sourceFacts'] },
    patch: { sourceUrl: before.url, sourceFacts: { itemId: '101', author: '第一作者', engagement: null }, title: '正确标题' } };
  assert((await run.api.execute('edit_case', input)).ok);
  const next = run.data.entries[0];
  assert.equal(next.url, 'https://x.com/first/status/101'); assert.equal(next.sourceFacts.itemId, '101');
  assert.equal(next.sourceFacts.engagement, undefined);
  for (const key of ['text', 'articleDocument', 'mediaAssets', 'customLabels', 'mediaPrompts', 'timeNotes']) assert.deepEqual(next[key], before[key]);
  const result = await run.api.execute('edit_case', input); assert(result.replayed); assert.equal(run.commits, 1);
  await assert.rejects(run.api.execute('edit_case', { ...input, patch: { title: '不同请求' } }), { code: 'request_conflict' });
});
test('human text, media or folder edits invalidate agent versions and paginated reads', async () => {
  for (const change of [s => { s.entries[0].text = '刚编辑'; }, s => { s.entries[0].mediaAssets[0].sourceTitle = '新名称'; }, s => { s.organizerState.collections[0].entryIds = []; }]) {
    const run = service(library()), revision = (await run.api.read({ caseId: 'old' })).revision;
    change(run.data);
    await assert.rejects(run.api.execute('edit_case', { requestId: 'change', caseId: 'old', expectedRevision: revision, patch: { title: '不能覆盖' } }), { code: 'case_conflict' });
    await assert.rejects(run.api.read({ caseId: 'old', expectedRevision: revision, offset: 10 }), { code: 'case_conflict' });
    assert.equal(run.commits, 0);
  }
});
test('two concurrent edits cannot both overwrite the same reviewed version', async () => {
  const run = service(library()), expectedRevision = (await run.api.read({ caseId: 'old' })).revision;
  const results = await Promise.allSettled(['one', 'two'].map(requestId => run.api.execute('edit_case', { caseId: 'old', requestId, expectedRevision, patch: { title: requestId } })));
  assert.equal(results.filter(r => r.status === 'fulfilled').length, 1); assert.equal(run.commits, 1);
});
test('media splitting moves originals, poster, keyframe, prompt and notes without copying files', async () => {
  const run = service(library()), before = structuredClone(run.data), input = await splitInput(run.data);
  const result = await run.api.execute('organize_case', input);
  const original = run.data.entries[0], added = run.data.entries.at(-1);
  assert.equal(result.cases.length, 2);
  assert.deepEqual(original.mediaAssets.map(a => a.id), ['a', 'pa']);
  assert.deepEqual(added.mediaAssets.map(a => a.id), ['b', 'pb', 'frame']);
  for (const a of added.mediaAssets) assert.deepEqual(a, before.entries[0].mediaAssets.find(b => b.id === a.id));
  assert.equal(original.text, before.entries[0].text); assert.equal(added.text, input.groups[0].text);
  assert.equal(added.sourceFacts.itemId, '202'); assert.equal(added.sourceFacts.author, '第二作者');
  assert.equal(added.sourceFacts.engagement, undefined);
  assert.deepEqual(added.mediaPrompts, before.entries[0].mediaPrompts); assert.deepEqual(added.timeNotes, before.entries[0].timeNotes);
  assert.equal(original.articleDocument.blocks.some(b => b.assetId === 'b'), false);
  assert.deepEqual(run.data.organizerState.collections[0].entryIds, ['old', added.id]);
  assert.deepEqual(run.data.entries[1], before.entries[1]);
  const restarted = service(run.data); await restarted.api.execute('organize_case', input); assert.equal(restarted.commits, 0);
});
test('failed storage commit leaves both library and acknowledgement untouched', async () => {
  const run = service(library()), input = await splitInput(run.data), before = structuredClone(run.data);
  run.fail(true); await assert.rejects(run.api.execute('organize_case', input), /disk full/); assert.deepEqual(run.data, before);
  run.fail(false); await run.api.execute('organize_case', input); assert.equal(run.data.entries.length, 3);
});
test('explicit article edits keep media structure and text in sync', async () => {
  const run = service(library());
  const input = { requestId: 'text', caseId: 'old', expectedRevision: (await run.api.read({ caseId: 'old' })).revision, sourceCorrection: { reason: '明确修正已读原文段落', fields: ['text', 'articlePatches'] }, patch: { text: '不能扁平覆盖' } };
  input.sourceCorrection = { reason: '明确修正已读原文段落', fields: ['text', 'articlePatches'] };
  await assert.rejects(run.api.execute('edit_case', input), { code: 'article_requires_patches' });
  input.patch = { articlePatches: [{ blockId: 'body', text: '新的正文' }] };
  await run.api.execute('edit_case', input);
  assert.equal(run.data.entries[0].text, '新的正文'); assert.equal(run.data.entries[0].textRevision, 3);
  assert.equal(run.data.entries[0].articleDocument.blocks.length, 3);
});
test('split cannot invent moved paragraph text, duplicate selections or leave an empty source', async () => {
  const state = library(), input = await splitInput(state);
  input.groups[0].textBlockIds = ['body'];
  await assert.rejects(planCaseOperation(state, 'organize_case', input), { code: 'text_conflict' });
  delete input.groups[0].textBlockIds;
  input.groups.push(structuredClone(input.groups[0]));
  await assert.rejects(planCaseOperation(state, 'organize_case', input), { code: 'asset_conflict' });
  state.entries[0].text = ''; delete state.entries[0].articleDocument;
  const emptyInput = await splitInput(state); emptyInput.groups[0].assetIds = ['a', 'b', 'frame'];
  await assert.rejects(planCaseOperation(state, 'organize_case', emptyInput), { code: 'empty_source_case' });
});
test('shared posters remain with both videos and intentional project copies stay independent', async () => {
  const state = library(); state.entries[0].mediaAssets[2].posterAssetId = 'pa';
  state.entries[0].mediaAssets = state.entries[0].mediaAssets.filter(a => a.id !== 'pb');
  const plan = await planCaseOperation(state, 'organize_case', await splitInput(state));
  assert(plan.update.entries[0].mediaAssets.some(a => a.id === 'pa'));
  assert(plan.update.entries.at(-1).mediaAssets.some(a => a.id === 'pa'));
  const run = service(library());
  await run.api.execute('organize_case', { requestId: 'copy', caseId: 'old', expectedRevision: (await run.api.read({ caseId: 'old' })).revision, action: 'copy_project', projectId: 'q' });
  const copy = run.data.entries.at(-1);
  assert.notEqual(copy.id, 'old'); assert.deepEqual(copy.mediaAssets, run.data.entries[0].mediaAssets);
  assert(run.data.organizerState.collections[0].entryIds.includes('old'));
  assert(run.data.organizerState.collections[1].entryIds.includes(copy.id));
});
test('moving to a project removes previous membership instead of creating a copy', async () => {
  const run = service(library());
  await run.api.execute('organize_case', { requestId: 'move', caseId: 'old', expectedRevision: (await run.api.read({ caseId: 'old' })).revision, action: 'move_project', projectId: 'q' });
  assert.equal(run.data.entries.length, 2); assert.deepEqual(run.data.organizerState.collections[0].entryIds, []);
  assert(run.data.organizerState.collections[1].entryIds.includes('old'));
});
test('moving media checks both case versions and preserves target text', async () => {
  const run = service(library()), input = { requestId: 'move', caseId: 'old', expectedRevision: (await run.api.read({ caseId: 'old' })).revision,
    targetCaseId: 'other', targetRevision: (await run.api.read({ caseId: 'other' })).revision, action: 'move_media', assetIds: ['b'] };
  const saved = await run.api.execute('organize_case', input); assert(saved.ok);
  assert.equal(run.data.entries[1].text, '人工正文'); assert.equal(run.data.entries[1].mediaAssets[0].id, 'b');
  assert.equal(run.data.entries[1].mediaPrompts[0].text, '独立原词');
});

test('media organization preserves captions, block sources and tag ownership after a library read', async () => {
  for (const action of ['split_media', 'move_media']) for (const targetHasDocument of [false, true]) {
    const state = library(), source = state.entries[0], target = state.entries[1];
    const group = createDefaultFacetCatalog().nodes.find(n => n.kind === 'group');
    const assignment = visualId => ({ facetId: group.facetId, nodeId: group.id, source: 'vision_model', status: 'confirmed', visualId });
    source.facetAssignments = [assignment('a'), assignment('b'), { facetId: group.facetId, nodeId: group.id, source: 'manual', status: 'confirmed' }];
    target.mediaAssets = [{ id: 'target-image', kind: 'image', storageMode: 'managed' }];
    target.facetAssignments = [assignment('target-image')];
    const originalBlock = { ...source.articleDocument.blocks[2], label: '人工图注', text: '随媒体保留的描述',
      sourceUrl: 'https://example.com/media-source', mimeType: 'video/mp4', posterUrl: 'https://example.com/poster.png' };
    source.articleDocument.blocks[2] = originalBlock;
    if (targetHasDocument) target.articleDocument = { version: 1, blocks: [{ id: originalBlock.id, kind: 'paragraph', text: target.text, sourceOrder: 0 }] };
    const input = action === 'split_media' ? await splitInput(state) : { requestId: 'move', caseId: source.id, action,
      expectedRevision: await caseRevision(state, source), targetCaseId: target.id, targetRevision: await caseRevision(state, target), assetIds: ['b'] };
    const plan = await planCaseOperation(state, 'organize_case', input);
    const loaded = migrateLibraryState({ schemaVersion: SCHEMA_VERSION, facetCatalog: createDefaultFacetCatalog(), ...state, ...plan.update }).state;
    const receiver = action === 'split_media' ? loaded.entries.at(-1) : loaded.entries[1];
    const movedBlock = receiver.articleDocument?.blocks.find(b => b.assetId === 'b');
    assert(movedBlock, `${action}: moved media block must exist even when target has no document`);
    for (const key of ['kind', 'assetId', 'label', 'text', 'sourceUrl', 'mimeType', 'posterUrl']) assert.equal(movedBlock[key], originalBlock[key]);
    assert.equal(new Set(receiver.articleDocument.blocks.map(b => b.id)).size, receiver.articleDocument.blocks.length);
    assert(loaded.entries[0].facetAssignments.some(a => a.visualId === 'a'));
    assert(loaded.entries[0].facetAssignments.some(a => !a.visualId && a.source === 'manual'));
    assert(!loaded.entries[0].facetAssignments.some(a => a.visualId === 'b'));
    assert(receiver.facetAssignments.some(a => a.visualId === 'b'));
    if (action === 'move_media') {
      assert(receiver.facetAssignments.some(a => a.visualId === 'target-image'));
      assert.equal(receiver.text, target.text);
      assert(receiver.articleDocument.blocks.some(b => b.assetId === 'target-image') || targetHasDocument);
    } else assert(!receiver.facetAssignments.some(a => !a.visualId));
  }
});

test('explicitly moved text keeps its original order among selected media blocks', async () => {
  const state = library(), entry = state.entries[0];
  entry.articleDocument.blocks = [entry.articleDocument.blocks[1], entry.articleDocument.blocks[2], entry.articleDocument.blocks[0]];
  const input = await splitInput(state);
  input.groups[0].textBlockIds = ['body']; input.groups[0].text = entry.text;
  const plan = await planCaseOperation(state, 'organize_case', input);
  const blocks = plan.update.entries.at(-1).articleDocument.blocks;
  assert.equal(blocks[0].assetId, 'b'); assert.equal(blocks[1].id, 'body');
  assert.equal(blocks.filter(b => b.assetId === 'b').length, 1);
});
test('schemas reject raw storage changes, unsafe URLs, invalid integer pages and mismatched post IDs', async () => {
  const run = service(library()), input = { requestId: 'bad', caseId: 'old', expectedRevision: (await run.api.read({ caseId: 'old' })).revision, patch: {} };
  for (const patch of [{ mediaAssets: [] }, { sourceUrl: 'file:///tmp/secret' }, { sourceUrl: 'https://user:pass@example.com' }, { sourceFacts: { itemId: '999' } }, JSON.parse('{"__proto__":{"bad":true}}')]) {
    await assert.rejects(run.api.execute('edit_case', { ...input, patch }));
  }
  assert.throws(() => validateCaseOperation('read_case_details', { caseId: 'old', offset: 0.5 }));
  assert.equal(run.commits, 0);
});
test('composer and MCP share schemas; composer cannot edit unknown cases and reports committed results after stop', async () => {
  const run = service(library()), events = [], session = { messages: [{ id: 'u', role: 'user', content: '修改案例' }], referenceSnapshots: [], retrievedSources: [] };
  const controller = new AbortController();
  const wrapper = withComposerCaseOperations({ session, tools: { specs: [], instructions: '', execute: async () => ({ data: { candidates: [{ caseId: 'old' }] } }) },
    invoke: async (name, input) => {
      if (name === 'read_case_details') return run.api.read(input);
      const result = await run.api.execute(name, input); controller.abort(); return result;
    }, onEvent: e => events.push(e) });
  assert.deepEqual(wrapper.specs.map(s => s.parameters), [...CASE_OPERATION_SPECS, ...PROJECT_OPERATION_SPECS, SAVE_TEXT_MATERIAL_SPEC, ...ANALYSIS_BATCH_SPECS].map(s => s.parameters));
  assert((await wrapper.execute('read_case_details', { caseId: 'old' }, {})).data.error);
  await wrapper.execute('search_cases', {}, {});
  const read = (await wrapper.execute('read_case_details', { caseId: 'old' }, {})).data;
  const saved = (await wrapper.execute('edit_case', { requestId: 'composer', caseId: 'old', expectedRevision: read.revision, patch: { title: '创作台修改' } }, { signal: controller.signal })).data;
  assert(controller.signal.aborted);
  assert(saved.ok); assert.equal(run.data.entries[0].title, '创作台修改'); assert.equal(events.at(-1).status, 'completed');
});
test('invalid keyframes, reversed time ranges and colliding annotations do not silently lose information', async () => {
  const run = service(library()), revision = (await run.api.read({ caseId: 'old' })).revision;
  for (const note of [{ assetId: 'b', startMs: 100, endMs: 99, text: '保留' }, { assetId: 'b', startMs: 100, frameAssetId: 'missing', text: '保留' }]) {
    await assert.rejects(run.api.execute('edit_case', { requestId: 'bad-note', caseId: 'old', expectedRevision: revision, patch: { timeNotes: [note] } }));
  }
  run.data.entries[1].timeNotes = [{ id: 'note', assetId: 'different', text: '目标中的人工笔记' }];
  await assert.rejects(run.api.execute('organize_case', { requestId: 'collision', caseId: 'old', expectedRevision: revision,
    action: 'move_media', assetIds: ['b'], targetCaseId: 'other', targetRevision: (await run.api.read({ caseId: 'other' })).revision }), { code: 'annotation_conflict' });
  assert.equal(run.commits, 0);
});

test('shared remove_tags validates reviewed version, commits undo atomically and replays without a second removal', async () => {
  const run=service(combinationLibrary());
  const combined=await run.api.execute('organize_case',await combineInput(run));
  const caseId=combined.cases[0].caseId;
  const input={requestId:'remove-tags',caseId,expectedRevision:combined.cases[0].revision,action:'remove_tags',customLabels:['导演选择']};
  const result=await run.api.execute('organize_case',input);
  assert.equal(result.updatedCount,1);assert.equal(result.canUndoFacetUpdate,true);
  assert.deepEqual(run.data.entries[0].customLabels,[]);
  assert.equal(run.data.facetUndo.steps.length,1);
  assert((await run.api.execute('organize_case',input)).replayed);
  assert.equal(run.data.facetUndo.steps.length,1);
  await assert.rejects(run.api.execute('organize_case',{...input,requestId:'stale'}),{code:'case_conflict'});
  const noOp=await run.api.execute('organize_case',{...input,requestId:'noop',expectedRevision:result.cases[0].revision});
  assert.equal(noOp.updatedCount,0);assert.equal(run.data.facetUndo.steps.length,1);
});

test('originals are protected by default while authored notes and AI prompts can change independently', async () => {
  const run = service(library()), original = structuredClone(run.data.entries[0]);
  const input = { requestId: 'protected', caseId: 'old', expectedRevision: (await run.api.read({ caseId: 'old' })).revision };
  for (const patch of [{sourceFacts:{author:'guess'}},{articlePatches:[{blockId:'body',text:'rewrite'}]},{mediaPrompts:[{assetId:'b',source:'manual',text:'overwrite'}]}]) {
    await assert.rejects(run.api.execute('edit_case', {...input,patch}), {code:'source_protected'});
  }
  assert.equal(run.commits,0); assert.deepEqual(run.data.entries[0],original);
  const saved = await run.api.execute('edit_case',{...input,requestId:'own',patch:{creative:{purpose:'广告参考',notes:'第二镜表演参考'},mediaPrompts:[{assetId:'b',source:'ai-suggestion',text:'自己的推导词'}]}});
  assert.equal(saved.cases.length,1); assert.equal(run.data.entries[0].creative.purpose,'广告参考');
  for (const field of ['text','articleDocument','sourceFacts','mediaAssets']) assert.deepEqual(run.data.entries[0][field],original[field]);
  assert(run.data.entries[0].mediaPrompts.some(p=>p.source==='manual'&&p.text==='独立原词'));
  const annotations = JSON.parse((await run.api.read({caseId:'old',part:'annotations'})).content); assert.equal(annotations.creative.notes,'第二镜表演参考');
});
test('explicit source correction keeps the previous evidence for readback and authored creation text stays editable', async () => {
  const run=service(library());
  await run.api.execute('edit_case',{requestId:'correct',caseId:'old',expectedRevision:(await run.api.read({caseId:'old'})).revision,
    sourceCorrection:{reason:'核对作者主页后的修正',fields:['sourceFacts']},patch:{sourceFacts:{author:'真实作者'}}});
  const source=JSON.parse((await run.api.read({caseId:'old',part:'source'})).content);
  assert.equal(source.corrections[0].before.sourceFacts.author,'被覆盖的作者'); assert.equal(source.corrections[0].reason,'核对作者主页后的修正');
  run.data.entries[1].agentProvenance={kind:'creation'};
  await run.api.execute('edit_case',{requestId:'creation',caseId:'other',expectedRevision:(await run.api.read({caseId:'other'})).revision,patch:{text:'新的自写方案'}});
  assert.equal(run.data.entries[1].text,'新的自写方案');
});
test('media reordering keeps every original and refuses incomplete or foreign permutations', async () => {
  const run=service(library()), before=structuredClone(run.data.entries[0]);
  const input={requestId:'order',caseId:'old',expectedRevision:(await run.api.read({caseId:'old'})).revision};
  await assert.rejects(run.api.execute('edit_case',{...input,patch:{mediaOrder:['b','a']}}),{code:'invalid_media_order'});
  const ids=before.mediaAssets.map(a=>a.id).reverse();
  await run.api.execute('edit_case',{...input,patch:{mediaOrder:ids}});
  assert.deepEqual(run.data.entries[0].mediaAssets,ids.map(id=>before.mediaAssets.find(a=>a.id===id)));
  assert.deepEqual(run.data.entries[0].articleDocument,before.articleDocument); assert.deepEqual(run.data.entries[0].timeNotes,before.timeNotes);
});


test('one requested case read supplies complete source, media and body with a single snapshot and no unrelated fields', async () => {
  const data = library(); let reads = 0;
  data.entries[0].text = '完整原词\n'.repeat(1800);
  const api = createCaseOperations({ loadState: async () => { reads++; return data; }, enqueue: fn => fn() });
  const parts = ['overview', 'source', 'media', 'document'];
  const result = await api.read({ caseId: 'old', parts, length: 49152 });
  assert.equal(reads, 1, 'one user request must not load the same library once per section');
  assert.equal(result.nextOffset, null);
  const content = JSON.parse(result.content);
  assert.deepEqual(Object.keys(content), parts);
  assert.equal(content.document.text, data.entries[0].text);
  assert.deepEqual(content.media, data.entries[0].mediaAssets);
  assert.deepEqual(content.source.sourceFacts, data.entries[0].sourceFacts);
  assert.equal(result.revision, await caseRevision(data, data.entries[0]));
  assert.equal(result.untrustedContent, true);
  assert(!result.content.includes('must-not-expose'));
  await assert.rejects(api.read({ caseId: 'old', part: 'media', parts }), { code: 'invalid_input' });
  await assert.rejects(api.read({ caseId: 'old', parts: [] }));
  await assert.rejects(api.read({ caseId: 'old', parts: ['media', 'media'] }));
  assert.equal(reads, 1, 'invalid requests must fail before a library read');
});

test('multi-part pagination preserves the whole original and rejects an intervening human edit', async () => {
  const run = service(library()), parts = ['source', 'document', 'annotations'];
  const first = await run.api.read({ caseId: 'old', parts, length: 200 });
  let text = first.content, page = first;
  while (page.nextOffset !== null) {
    page = await run.api.read({ caseId: 'old', parts, expectedRevision: first.revision, offset: page.nextOffset, length: 200 });
    text += page.content;
  }
  assert.equal(JSON.parse(text).document.text, run.data.entries[0].text);
  assert.deepEqual(JSON.parse(text).annotations.timeNotes, run.data.entries[0].timeNotes);
  run.data.entries[0].text = '用户刚修改的正文';
  await assert.rejects(run.api.read({ caseId: 'old', parts, expectedRevision: first.revision, offset: first.nextOffset }), { code: 'case_conflict' });
  const combined = service(combinationLibrary());
  const saved = await combined.api.execute('organize_case', await combineInput(combined));
  await assert.rejects(combined.api.read({ caseId: saved.cases[0].caseId, parts: ['overview', 'document'] }), { code: 'compound_member' });
});
