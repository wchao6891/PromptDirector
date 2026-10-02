import test from 'node:test';
import assert from 'node:assert/strict';
import { migrateLibraryState } from '../extension/migration.js';
import { aiConfigurationFromStorage } from '../extension/ai-runtime.js';
import { createLibraryViewReader, LIBRARY_VIEW_STORAGE_KEYS, libraryViewNeedsPreparation, projectLibraryViewState } from '../extension/library-view-state.js';
import { completeLibraryViewSummary } from '../extension/library-view-summary.js';

function currentLibrary() {
  const state = migrateLibraryState({ entries: [{ id: 'one', text: '完整原词', title: '人工标题',
    mediaAssets: [{ id: 'original', kind: 'image', usage: 'content', mimeType: 'image/png', storageMode: 'managed' }], primaryMediaId: 'original' }] }).state;
  const ai = aiConfigurationFromStorage({});
  return { ...state, libraryViewSummary: completeLibraryViewSummary(state), aiProviderRegistry: ai.registry, aiTaskAssignments: ai.assignments, aiPreferences: ai.preferences };
}

test('gallery uses one consistent snapshot without task histories or recovery copies', async () => {
  const stored = currentLibrary();
  const before = structuredClone(stored);
  const reads = [];
  const read = createLibraryViewReader({
    storage: { get: async keys => { reads.push(keys); return stored; } },
    prepare: () => { throw new Error('Current library must not write on opening'); }, uiLanguage: 'zh-CN'
  });
  const response = await read();
  assert.equal(response.ok, true);
  assert.equal(response.entries[0].text, '完整原词');
  assert.equal(response.entries[0].contentRole, 'image_case');
  assert.equal(reads.length, 1);
  assert.equal(reads[0], LIBRARY_VIEW_STORAGE_KEYS);
  for (const key of ['migrationBackup', 'analysisTasks', 'composerSessions', 'creativeRuns', 'creativeSkills', 'libraryReplacementRecoveryPoint', 'facetUndo', 'trashState', 'analysisBatchUndo', 'analysisRebuildStaging']) {
    assert.ok(!reads[0].includes(key), key);
    if (!Object.hasOwn(stored, key)) assert.equal(Object.hasOwn(response, key), false);
  }
  assert.deepEqual(stored, before);
});

test('legacy preparation acknowledges the existing full repair before rereading the snapshot', async () => {
  let stored = { schemaVersion: 27, entries: [{ id: 'one', text: '完整原词' }] };
  let preparations = 0;
  let reads = 0;
  const response = await createLibraryViewReader({
    storage: { get: async () => { reads++; return stored; } },
    prepare: async () => { preparations++; stored = currentLibrary(); return { ok: true, restoredArchivedFacetCount: 2 }; }
  })();
  assert.equal(preparations, 1);
  assert.equal(reads, 2);
  assert.equal(response.restoredArchivedFacetCount, 2);
  assert.equal(response.entries[0].text, '完整原词');
  assert.equal(libraryViewNeedsPreparation(stored), false);
});

test('failed or incomplete preparation stays a visible failure without pretending the library is empty', async () => {
  for (const result of [{ ok: false, message: '真实准备失败' }, { ok: true }]) {
    await assert.rejects(createLibraryViewReader({ storage: { get: async () => ({}) }, prepare: async () => result })(), /真实准备失败|准备未完成/);
  }
});

test('shared gallery projection keeps model credentials out of page state', () => {
  const stored = currentLibrary();
  stored.aiProviderRegistry.providers.openai.apiKey = 'private-test-credential';
  const projected = projectLibraryViewState(stored);
  assert.equal(JSON.stringify(projected).includes('private-test-credential'), false);
  assert.equal(stored.aiProviderRegistry.providers.openai.apiKey, 'private-test-credential');
});
