import test from 'node:test';
import assert from 'node:assert/strict';
import { migrateLibraryState } from '../extension/migration.js';
import { aiConfigurationFromStorage } from '../extension/ai-runtime.js';
import { createLibraryViewReader, createProgressiveLibraryViewReader, LIBRARY_VIEW_STORAGE_KEYS, libraryViewNeedsPreparation, projectLibraryViewState } from '../extension/library-view-state.js';
import { completeLibraryViewSummary } from '../extension/library-view-summary.js';
import { createLibraryStorage } from '../extension/library-storage.js';
import { CASE_INDEX_KEY, caseRecordKey } from '../extension/library-case-records.js';

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

test('read-only gallery snapshots reuse case content while display decorations stay independently editable', async () => {
  const stored = currentLibrary();
  Object.freeze(stored.entries[0].mediaAssets[0]);
  Object.freeze(stored.entries[0].mediaAssets);
  Object.freeze(stored.entries[0]);
  let snapshotReads = 0;
  const response = await createLibraryViewReader({ readonlyEntries: true,
    storage: { get: () => assert.fail('the gallery must not copy the entire case library to decorate titles'),
      getSnapshot: async () => { snapshotReads++; return stored; } },
    prepare: () => assert.fail('current library'), uiLanguage: 'zh-CN' })();
  assert.equal(snapshotReads, 1);
  assert.notEqual(response.entries[0], stored.entries[0]);
  assert.equal(response.entries[0].mediaAssets, stored.entries[0].mediaAssets);
  response.entries[0].title = '当前显示标题';
  assert.equal(stored.entries[0].title, '人工标题');
  assert.throws(() => { response.entries[0].mediaAssets[0].id = 'cannot-change-original'; }, TypeError);
});

function groupedLibrary() {
  const stored = currentLibrary();
  stored.entries = ['one', 'two', 'three', 'four'].map(id => ({ ...structuredClone(stored.entries[0]), id,
    mediaAssets: [{ ...stored.entries[0].mediaAssets[0], id: `image-${id}` }], primaryMediaId: `image-${id}` }));
  stored.organizerState.collections = [{ id: 'project', name: '保留全部归属', entryIds: stored.entries.map(entry => entry.id) }];
  stored.compoundCases = [{ id: 'compound', title: '不能拆开的组合', memberEntryIds: ['one', 'three'],
    coverVisualId: 'image-three', customLabels: ['手工标签'], createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' }];
  return stored;
}

function batch(stored, entries, complete = false) {
  return { stored: { ...stored, entries }, entryIds: stored.entries.map(entry => entry.id),
    loaded: entries.length, total: stored.entries.length, complete, revision: 'current-revision' };
}

test('progressive startup exposes metadata and full relationship definitions before reading case groups', async () => {
  const stored = groupedLibrary(), before = structuredClone(stored);
  const batchOptions = { batchSize: 2, selectIds: () => ['one'] };
  const read = createProgressiveLibraryViewReader({ storage: {
    get: () => assert.fail('a current progressive read must not request the full library'),
    async *getSnapshotBatches(keys, options) {
      assert.equal(keys, LIBRARY_VIEW_STORAGE_KEYS);
      assert.equal(options, batchOptions);
      yield batch(stored, []);
      yield batch(stored, [stored.entries[0], stored.entries[2]]);
      yield batch(stored, stored.entries, true);
    }
  }, prepare: () => assert.fail('partial relationships must never trigger migration'), uiLanguage: 'zh-CN' });
  const iterator = read(batchOptions);
  const shell = (await iterator.next()).value;
  assert.equal(shell.complete, false);
  assert.equal(shell.loaded, 0);
  assert.equal(shell.total, 4);
  assert.deepEqual(shell.entryIds, ['one', 'two', 'three', 'four']);
  assert.deepEqual(shell.organizerState.collections[0].entryIds, shell.entryIds);
  assert.deepEqual(shell.compoundCases, stored.compoundCases);
  assert.deepEqual(shell.loadedCompoundCases, []);
  shell.compoundCases[0].memberEntryIds.pop();
  assert.deepEqual(stored, before, 'partial metadata is not a mutable path back into stored relationships');
  const first = (await iterator.next()).value;
  assert.equal(first.loaded, 2);
  assert.equal(first.complete, false);
  assert.deepEqual(first.compoundCases, stored.compoundCases);
  assert.deepEqual(first.loadedCompoundCases[0].memberEntryIds, ['one', 'three']);
  assert.equal(first.loadedCompoundCases[0].coverVisualId, 'image-three');
  assert.deepEqual(first.organizerState.collections[0].entryIds, shell.entryIds);
  const final = (await iterator.next()).value;
  assert.equal(final.complete, true);
  assert.equal(final.loaded, final.total);
  assert.deepEqual(final.entries.map(entry => entry.id), shell.entryIds);
  assert.deepEqual(final.loadedCompoundCases, final.compoundCases);
  assert.equal((await iterator.next()).done, true);
});

test('partial projection never invents a smaller compound when some members have not arrived', async () => {
  const stored = groupedLibrary();
  stored.compoundCases[0].memberEntryIds = ['one', 'two', 'three'];
  const read = createProgressiveLibraryViewReader({ storage: {
    async *getSnapshotBatches() { yield batch(stored, stored.entries.slice(0, 2)); }
  }, prepare: () => assert.fail('must not prepare a partial library') });
  const partial = (await read().next()).value;
  assert.deepEqual(partial.compoundCases[0].memberEntryIds, ['one', 'two', 'three']);
  assert.equal(partial.compoundCases[0].coverVisualId, 'image-three');
  assert.deepEqual(partial.loadedCompoundCases, []);
});

test('preparation of current metadata waits until all records arrive and replaces the partial result with a complete repaired state', async () => {
  let stored = groupedLibrary();
  delete stored.libraryViewSummary;
  let completeDelivered = false, preparations = 0, fullReads = 0;
  const read = createProgressiveLibraryViewReader({ storage: {
    get: async () => { assert(completeDelivered); fullReads++; return stored; },
    async *getSnapshotBatches() {
      yield batch(stored, []);
      yield batch(stored, [stored.entries[0], stored.entries[2]]);
      assert.equal(preparations, 0);
      completeDelivered = true;
      yield batch(stored, stored.entries, true);
    }
  }, prepare: async options => {
    assert(completeDelivered);
    assert.equal(options.summaryOnly, true);
    preparations++;
    stored = { ...stored, libraryViewSummary: completeLibraryViewSummary(stored) };
    return { ok: true, restoredArchivedFacetCount: 2 };
  } });
  const results = [];
  for await (const state of read()) results.push(state);
  assert.deepEqual(results.map(state => state.complete), [false, false, true]);
  assert.equal(preparations, 1);
  assert.equal(fullReads, 2);
  assert.equal(results.at(-1).restoredArchivedFacetCount, 2);
  assert.equal(results.at(-1).entries.length, 4);
  assert.equal(results.at(-1).total, 4);
});

test('legacy and mixed-layout startup use complete preparation instead of exposing partial entries', async () => {
  for (const useSignal of [true, false]) {
    let stored = { schemaVersion: 27, entries: [{ id: 'one', text: '完整原词' }] };
    let preparations = 0, reads = 0;
    const read = createProgressiveLibraryViewReader({ storage: {
      get: async () => { reads++; return stored; },
      async *getSnapshotBatches() {
        yield useSignal ? { requiresFullRead: true } : batch(stored, []);
        assert.fail('legacy startup must close its partial iterator');
      }
    }, prepare: async () => { preparations++; stored = currentLibrary(); return { ok: true }; } });
    const states = [];
    for await (const state of read()) states.push(state);
    assert.equal(states.length, 1);
    assert.equal(states[0].complete, true);
    assert.equal(states[0].entries[0].text, '完整原词');
    assert.equal(preparations, 1);
    assert.equal(reads, 2);
  }
});

test('a changed storage revision aborts progressive startup without claiming completion or preparing partial content', async () => {
  const stored = groupedLibrary();
  const changed = Object.assign(new Error('library changed'), { code: 'CASE_RECORDS_CHANGED' });
  const read = createProgressiveLibraryViewReader({ storage: {
    async *getSnapshotBatches() { yield batch(stored, []); throw changed; }
  }, prepare: () => assert.fail('partial reads are never repair inputs') });
  const iterator = read();
  assert.equal((await iterator.next()).value.complete, false);
  await assert.rejects(iterator.next(), error => error === changed);
});

test('newer metadata and newer individual records fail before projection, without a downgrade write', async () => {
  for (const newerRecord of [false, true]) {
    const stored = groupedLibrary();
    if (newerRecord) stored.entries[0].schemaVersion = stored.schemaVersion + 1;
    else stored.schemaVersion++;
    const read = createProgressiveLibraryViewReader({ storage: {
      async *getSnapshotBatches() { yield batch(stored, newerRecord ? stored.entries.slice(0, 1) : []); }
    }, prepare: () => assert.fail('newer libraries cannot be prepared by an older extension') });
    await assert.rejects(read().next(), error => error.code === 'LIBRARY_FROM_NEWER_VERSION');
  }
});

test('real storage batches feed the startup reader without full-body reads or lost project and compound members', async () => {
  const { entries, ...metadata } = groupedLibrary();
  const data = { ...metadata, caseLibraryRevision: 'startup-revision',
    [CASE_INDEX_KEY]: { layout: 1, ids: entries.map(entry => entry.id) },
    ...Object.fromEntries(entries.map(entry => [caseRecordKey(entry.id), entry])) };
  const reads = [];
  const storage = createLibraryStorage({ lock: operation => operation(), backend: {
    getKeys: async () => Object.keys(data),
    get: async keys => {
      const names = typeof keys === 'string' ? [keys] : keys;
      reads.push([...names]);
      return structuredClone(Object.fromEntries(names.filter(key => Object.hasOwn(data, key)).map(key => [key, data[key]])));
    },
    set: () => assert.fail('opening a current library must not rewrite it'),
    remove: () => assert.fail('partial loading cannot remove any records')
  } });
  const read = createProgressiveLibraryViewReader({ storage, readonlyEntries: true,
    prepare: () => assert.fail('current fixture needs no migration') });
  const iterator = read({ batchSize: ({ loaded, total }) => loaded ? total - loaded : 1, selectIds: () => ['three'] });
  const shell = (await iterator.next()).value;
  assert.equal(shell.loaded, 0);
  assert.equal(reads.flat().some(key => key.startsWith('case:') || key === 'entries'), false);
  const first = (await iterator.next()).value;
  assert.deepEqual(first.entries.map(entry => entry.id), ['one', 'three']);
  assert.equal(first.loadedCompoundCases[0].coverVisualId, 'image-three');
  assert.equal(first.organizerState.collections[0].entryIds.length, 4);
  assert(Object.isFrozen(first.entries[0].mediaAssets));
  const last = (await iterator.next()).value;
  assert.equal(last.complete, true);
  assert.equal(last.total, 4);
  assert.deepEqual(reads.flat().filter(key => key.startsWith('case:')).sort(), entries.map(entry => caseRecordKey(entry.id)).sort());
  const caseReadCount = reads.flat().filter(key => key.startsWith('case:')).length;
  const full = await createLibraryViewReader({ storage, readonlyEntries: true,
    prepare: () => assert.fail('complete cache is valid') })();
  assert.equal(full.entries.length, 4);
  assert.equal(reads.flat().filter(key => key.startsWith('case:')).length, caseReadCount, 'the finished stream seeds the ordinary reader cache');
});

test('complete gallery reads expose their exact final revision without changing the shared domain projection', async () => {
  const stored={...currentLibrary(),caseLibraryRevision:'already-painted'};
  const read=createLibraryViewReader({storage:{get:async keys=>{
    assert.ok(keys.includes('caseLibraryRevision'));
    return stored;
  }},prepare:()=>assert.fail('current snapshot')});
  assert.equal((await read()).revision,'already-painted');
  assert.equal(Object.hasOwn(projectLibraryViewState(stored),'revision'),false);
  stored.caseLibraryRevision='real-later-change';stored.entries[0].title='另一页面的新名称';
  const later=await read();
  assert.equal(later.revision,'real-later-change');
  assert.equal(later.entries[0].title,'另一页面的新名称');
});

test('progressive fallback preserves the final repaired snapshot revision instead of the earlier queued notification', async () => {
  let stored={schemaVersion:27,entries:[]};
  const read=createProgressiveLibraryViewReader({storage:{
    get:async()=>stored,
    async *getSnapshotBatches(){yield {requiresFullRead:true};}
  },prepare:async()=>{
    stored={...currentLibrary(),caseLibraryRevision:'repair-committed'};
    return {ok:true};
  }});
  const frames=[];for await(const frame of read({batchSize:1}))frames.push(frame);
  assert.equal(frames.length,1);assert.equal(frames[0].complete,true);
  assert.equal(frames[0].revision,'repair-committed');
});
