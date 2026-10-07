import test from 'node:test';
import assert from 'node:assert/strict';
import { createCaseEditor, touchEntry } from '../extension/case-editor.js';
import { createLibraryStorage, createLibraryCommitter } from '../extension/library-storage.js';
import { CASE_INDEX_KEY, caseRecordKey } from '../extension/library-case-records.js';
import { SCHEMA_VERSION } from '../extension/taxonomy.js';
import { markSyncMetaDirty } from '../extension/sync-model.js';
import { articleDocumentText, normalizeArticleDocument } from '../extension/article-document.js';
import { normalizeEntryMedia, currentVideoReconstruction } from '../extension/media.js';

function fixture(overrides = {}) {
  return { id: 'edited', schemaVersion: SCHEMA_VERSION, title: '原标题', text: '原正文', textRevision: 3,
    customLabels: ['保留'], libraryUpdatedAt: '2026-01-01T00:00:00.000Z',
    mediaAssets: [{ id: 'original', kind: 'image', storageMode: 'managed' }],
    mediaPrompts: [{ assetId: 'original', text: '逐媒体原词', source: 'manual' }], ...overrides };
}

// Exercise the real storage adapter, committer and editor together; the backend only simulates
// Chrome's asynchronous cloning and records which values crossed the storage boundary.
function openEditor(entry = fixture()) {
  const neighbor = fixture({ id: 'unrelated', title: '不能读取或覆盖的案例' });
  const data = { schemaVersion: SCHEMA_VERSION, [CASE_INDEX_KEY]: { layout: 1, ids: [entry.id, neighbor.id] },
    [caseRecordKey(entry.id)]: structuredClone(entry), [caseRecordKey(neighbor.id)]: structuredClone(neighbor),
    syncMeta: { localDirty: false, dirtyAssetIds: ['pending-original'] } };
  const gets = [], sets = [];
  let tail = Promise.resolve();
  const lock = operation => { const result = tail.then(operation); tail = result.catch(() => {}); return result; };
  const backend = {
    async get(keys) {
      const names = keys == null ? Object.keys(data) : typeof keys === 'string' ? [keys] : keys;
      gets.push([...names]);
      return structuredClone(Object.fromEntries(names.filter(key => Object.hasOwn(data, key)).map(key => [key, data[key]])));
    },
    async set(update) { sets.push(structuredClone(update)); Object.assign(data, structuredClone(update)); },
    async remove(keys) { for (const key of [keys].flat()) delete data[key]; },
    async getKeys() { return Object.keys(data); }
  };
  const storage = createLibraryStorage({ backend, lock });
  const commit = createLibraryCommitter({ storage, syncedKeys: new Set(['entries']), syncMetaKey: 'syncMeta',
    markDirty: markSyncMetaDirty, isSyncApplying: () => false });
  const editor = createCaseEditor({ commitCase: (...args) => commit.updateCase(...args) });
  return { data, gets, sets, editor, neighbor, saved: () => data[caseRecordKey(entry.id)] };
}

function assertSingleCaseIo(run) {
  assert.equal(run.gets.flat().includes(caseRecordKey('unrelated')), false, 'an ordinary edit must not read other case content');
  assert.equal(run.gets.flat().includes('entries'), false, 'an indexed case edit must not read the full library');
  assert.equal(run.gets.flat().includes('legacyEntries'), false, 'editing must not load the retained pre-upgrade backup');
  assert.deepEqual(run.data[caseRecordKey('unrelated')], run.neighbor);
  assert.ok(run.sets.every(update => !Object.hasOwn(update, 'entries') && !Object.hasOwn(update, caseRecordKey('unrelated'))));
}

test('title editing sanitizes input, touches only the case and commits sync state with it', async () => {
  const run = openEditor();
  const result = await run.editor.title({ entryId: 'edited', title: ' \n新标题\u0000\t ' });
  assert.equal(result.ok, true);
  assert.equal(result.changed, true);
  assert.equal(result.entry.title, '新标题');
  assert.equal(result.message, '标题已保存');
  assert.notEqual(result.entry.libraryUpdatedAt, fixture().libraryUpdatedAt);
  assert.deepEqual(result.entry.mediaPrompts, fixture().mediaPrompts);
  assert.equal(Object.hasOwn(result, 'entries'), false);
  assert.equal(run.sets.length, 1);
  assert.equal(run.sets[0].syncMeta.localDirty, true);
  assert.deepEqual(run.sets[0].syncMeta.dirtyAssetIds, ['pending-original']);
  assert.equal(run.sets[0][caseRecordKey('edited')].title, '新标题');
  assertSingleCaseIo(run);
});

test('unchanged or empty title does not dirty sync or bump the case timestamp', async () => {
  const run = openEditor();
  const unchanged = await run.editor.title({ entryId: 'edited', title: ' 原标题 ' });
  assert.equal(unchanged.message, '标题没有变化');
  assert.equal(unchanged.changed, false);
  assert.deepEqual(await run.editor.title({ entryId: 'edited', title: '\n\t' }), { ok: false, message: '案例标题不能为空' });
  assert.equal(run.sets.length, 0);
  assert.equal(run.saved().libraryUpdatedAt, fixture().libraryUpdatedAt);
  assert.equal(run.data.syncMeta.localDirty, false);
});

test('two simultaneous label deltas retain both users edits and return only the saved case', async () => {
  const run = openEditor();
  const results = await Promise.all([
    run.editor.customLabels({ entryId: 'edited', addLabels: ['外部Agent'], removeLabels: [] }),
    run.editor.customLabels({ entryId: 'edited', addLabels: ['人工新增'], removeLabels: ['保留'] })
  ]);
  assert.deepEqual(run.saved().customLabels, ['外部Agent', '人工新增']);
  assert.deepEqual(results[1].entry.customLabels, run.saved().customLabels);
  assert.ok(results.every(result => result.ok && !Object.hasOwn(result, 'entries')));
  const replaced = await run.editor.customLabels({ entryId: 'edited', customLabels: ['整组指定', '整组指定'] });
  assert.deepEqual(replaced.entry.customLabels, ['整组指定']);
  assertSingleCaseIo(run);
});

test('a concurrent text save cannot overwrite newer prose or its original media prompt', async () => {
  const run = openEditor();
  const outcomes = await Promise.allSettled([
    run.editor.text({ entryId: 'edited', text: '先保存的全文', textRevision: 3 }),
    run.editor.text({ entryId: 'edited', text: '过时草稿', textRevision: 3 })
  ]);
  assert.equal(outcomes[0].status, 'fulfilled');
  assert.equal(outcomes[1].status, 'rejected');
  assert.match(outcomes[1].reason.message, /其他页面/);
  assert.equal(run.saved().text, '先保存的全文');
  assert.equal(run.saved().textRevision, 4);
  assert.deepEqual(run.saved().mediaPrompts, fixture().mediaPrompts);
  assert.equal(run.sets.length, 1);
  const unchanged = await run.editor.text({ entryId: 'edited', text: '先保存的全文', textRevision: 4 });
  assert.equal(unchanged.message, '提示词没有变化');
  assert.equal(unchanged.changed, false);
  assert.equal(run.sets.length, 1);
  assertSingleCaseIo(run);
});

test('article edits preserve resource blocks, update search prose and reject stale block drafts', async () => {
  const articleDocument = normalizeArticleDocument({ blocks: [
    { id: 'body', kind: 'paragraph', text: '原正文' },
    { id: 'original', kind: 'image', assetId: 'original', sourceUrl: 'https://fixture.invalid/original.png' }
  ] });
  const run = openEditor(fixture({ articleDocument, text: articleDocumentText(articleDocument) }));
  const result = await run.editor.article({ entryId: 'edited', patches: [{ blockId: 'body', text: '完整修订正文' }], textRevision: 3 });
  assert.equal(result.message, '正文已保存');
  assert.equal(result.entry.textRevision, 4);
  assert.match(result.entry.text, /完整修订正文/);
  assert.deepEqual(result.entry.articleDocument.blocks[1], articleDocument.blocks[1]);
  assert.deepEqual(result.entry.mediaPrompts, fixture().mediaPrompts);
  assert.notEqual(result.entry.libraryUpdatedAt, fixture().libraryUpdatedAt);
  await assert.rejects(run.editor.article({ entryId: 'edited', patches: [{ blockId: 'body', text: '过时草稿' }], textRevision: 3 }), /正文已发生变化/);
  assert.equal(run.sets.length, 1);
  assertSingleCaseIo(run);
});

test('unreadable recovered cases reject every edit without writing partial content', async () => {
  for (const [method, input] of [
    ['title', { title: '新标题' }], ['customLabels', { addLabels: ['新'] }],
    ['text', { text: '新正文', textRevision: 3 }], ['article', { patches: [], textRevision: 3 }]
  ]) {
    const run = openEditor(fixture({ vaultReadStatus: { readOnly: true } }));
    await assert.rejects(run.editor[method]({ entryId: 'edited', ...input }), error => error.code === 'case_files_unavailable');
    assert.equal(run.sets.length, 0);
  }
});

test('other background edits keep the same explicit touch timestamp boundary', () => {
  assert.deepEqual(touchEntry({ id: 'a' }, 'provided-time'), { id: 'a', libraryUpdatedAt: 'provided-time' });
});

test('missing cases and invalid plain-text clearing cannot commit unrelated state', async () => {
  const run = openEditor(fixture({ mediaAssets: [] }));
  await assert.rejects(run.editor.title({ entryId: 'missing', title: '不存在' }), /没有找到这条案例/);
  await assert.rejects(run.editor.text({ entryId: 'edited', text: '', textRevision: 3 }), /不能为空/);
  assert.equal(run.sets.length, 0);
  assert.equal(run.data.syncMeta.localDirty, false);
  assert.equal(run.saved().text, '原正文');
});

test('reapplying the same label edit leaves the existing timestamp and sync state alone', async () => {
  const run = openEditor();
  const result = await run.editor.customLabels({ entryId: 'edited', addLabels: ['保留'], removeLabels: [] });
  assert.equal(result.ok, true);
  assert.equal(result.entry.libraryUpdatedAt, fixture().libraryUpdatedAt);
  assert.equal(result.changed, false);
  assert.equal(run.sets.length, 0);
  assert.equal(run.data.syncMeta.localDirty, false);
});

test('concurrent original and AI prompt edits preserve both sources and the shared original text', async () => {
  const run = openEditor(normalizeEntryMedia(fixture({ mediaPrompts: [
    ...fixture().mediaPrompts, { assetId: 'original', text: '旧 AI 建议', source: 'ai-suggestion' }
  ] })));
  await Promise.all([
    run.editor.mediaPrompt({ entryId: 'edited', assetId: 'original', text: '人工修订原词' }),
    run.editor.mediaPrompt({ entryId: 'edited', assetId: 'original', text: '人工修订 AI 建议', preserveAiSource: true })
  ]);
  const prompts = run.saved().mediaPrompts;
  assert.equal(prompts.find(item => item.source === 'manual').text, '人工修订原词');
  assert.equal(prompts.find(item => item.source === 'ai-suggestion').text, '人工修订 AI 建议');
  assert.equal(run.saved().text, '原正文');
  assert.equal(run.saved().textRevision, 3);
  assert.notEqual(run.saved().libraryUpdatedAt, fixture().libraryUpdatedAt);
  assertSingleCaseIo(run);
});

test('confirming AI suggestions preserves captured and manual originals', async () => {
  for (const source of ['manual', 'embedded']) {
    const entry = normalizeEntryMedia(fixture({ mediaPrompts: [{ assetId: 'original', text: '必须保留的原词', source }] }));
    const run = openEditor(entry);
    const result = await run.editor.mediaPromptSuggestions({ entryId: 'edited', suggestions: [
      { assetId: 'original', text: '新的 AI 建议' }, { assetId: 'original', text: ' ' }
    ] });
    assert.equal(result.message, '已确认并保存 1 条逐图提示词');
    assert.deepEqual(result.entry.mediaPrompts.find(item => item.source === source), entry.mediaPrompts.find(item => item.source === source));
    assert.equal(result.entry.mediaPrompts.find(item => item.source === 'ai-suggestion').text, '新的 AI 建议');
    assert.equal(Object.hasOwn(result, 'entries'), false);
    assertSingleCaseIo(run);
  }
});

test('clearing an AI media prompt keeps the manual original and prevents old image analysis from reappearing', async () => {
  const run = openEditor(normalizeEntryMedia(fixture({
    mediaAssets: [{ ...fixture().mediaAssets[0], visionAnalysis: { reconstructionPrompt: '旧模型反推', tags: [], quality: 'complete' } }],
    mediaPrompts: [...fixture().mediaPrompts, { assetId: 'original', text: 'AI 词', source: 'ai-suggestion' }]
  })));
  const result = await run.editor.mediaPrompt({ entryId: 'edited', assetId: 'original', text: '', preserveAiSource: true });
  assert.equal(result.entry.mediaPrompts.find(item => item.source === 'manual').text, '逐媒体原词');
  assert.equal(result.entry.mediaPrompts.find(item => item.source === 'ai-suggestion').cleared, true);
  assert.equal(result.entry.mediaAssets[0].visionAnalysis.reconstructionPrompt, '');
  assertSingleCaseIo(run);
});

test('video reconstruction editing preserves request evidence, media originals and shared prompt', async () => {
  const entry = normalizeEntryMedia(fixture({
    mediaAssets: [{ id: 'original', kind: 'video', storageMode: 'managed', mimeType: 'video/mp4' }],
    videoAnalyses: [{ id: 'analysis', assetId: 'original', mode: 'visual-reconstruction',
      requestId: 'attempt', contractVersion: 'visual-v3-1', prompt: '实际请求原文', reconstructionPrompt: '模型原结果',
      tags: [], uncertainties: [], includeTags: false, analysisScope: 'visual', finishReason: 'stop', createdAt: '2026-01-01T00:00:00.000Z' }]
  }));
  const run = openEditor(entry);
  const result = await run.editor.videoReconstruction({ entryId: 'edited', assetId: 'original', reconstructionPrompt: '人工修订的反推' });
  const analysis = currentVideoReconstruction(result.entry, 'original');
  assert.equal(analysis.reconstructionPrompt, '人工修订的反推');
  assert.equal(analysis.prompt, '实际请求原文');
  assert.equal(analysis.requestId, 'attempt');
  assert.equal(analysis.userEdited, true);
  assert.deepEqual(result.entry.mediaPrompts, entry.mediaPrompts);
  assert.equal(result.entry.text, entry.text);
  assert.equal(result.entry.libraryUpdatedAt, entry.libraryUpdatedAt, 'retain the existing analysis-only timestamp semantics');
  assert.equal(Object.hasOwn(result, 'entries'), false);
  assertSingleCaseIo(run);
});

test('image reconstruction editing changes only the selected analysis and preserves original prompts', async () => {
  const entry = normalizeEntryMedia(fixture({ mediaAssets: [
    { ...fixture().mediaAssets[0], visionAnalysis: { reconstructionPrompt: '原模型词', tags: [], quality: 'complete' } },
    { id: 'other-image', kind: 'image', storageMode: 'managed', visionAnalysis: { reconstructionPrompt: '其他图模型词', tags: [], quality: 'complete' } }
  ] }));
  const run = openEditor(entry);
  const result = await run.editor.visionReconstruction({ entryId: 'edited', visualId: 'original', reconstructionPrompt: '修订模型词' });
  assert.equal(result.entry.mediaAssets[0].visionAnalysis.reconstructionPrompt, '修订模型词');
  assert.equal(result.entry.mediaAssets[0].visionAnalysis.userEdited, true);
  assert.deepEqual(result.entry.mediaAssets[1], entry.mediaAssets[1]);
  assert.deepEqual(result.entry.mediaPrompts, entry.mediaPrompts);
  assert.equal(result.entry.text, entry.text);
  assert.equal(Object.hasOwn(result, 'entries'), false);
  assertSingleCaseIo(run);
});

test('invalid prompt edits and an empty suggestion set never commit partial changes', async () => {
  const run = openEditor();
  assert.deepEqual(await run.editor.mediaPromptSuggestions({ entryId: 'edited', suggestions: [] }), { ok: false, message: '没有需要保存的逐图提示词' });
  await assert.rejects(run.editor.mediaPrompt({ entryId: 'edited', assetId: 'missing', text: '词' }), /没有找到/);
  await assert.rejects(run.editor.visionReconstruction({ entryId: 'edited', visualId: 'original', reconstructionPrompt: '词' }), /没有可编辑/);
  await assert.rejects(run.editor.videoReconstruction({ entryId: 'edited', assetId: 'original', reconstructionPrompt: '' }), /不能为空/);
  await assert.rejects(run.editor.mediaPromptSuggestions({ entryId: 'edited', suggestions: [
    { assetId: 'original', text: '先处理的词' }, { assetId: 'missing', text: '无效媒体' }
  ] }), /没有找到/);
  assert.equal(run.sets.length, 0);
  assert.equal(run.data.syncMeta.localDirty, false);
});
