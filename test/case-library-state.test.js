import test from 'node:test';
import assert from 'node:assert/strict';
import { createCaseLibraryReader } from '../extension/case-library-state.js';
import { migrateLibraryState } from '../extension/migration.js';
import { recoverFullyArchivedFacets } from '../extension/facets.js';

function fixture() {
  const state = migrateLibraryState({ entries: [{ id: 'case', title: 'before', text: '原词' }] }).state;
  const reads = [];
  const storage = { async get(keys) { reads.push(keys); return structuredClone(Object.fromEntries(keys.map(key => [key, state[key]]))); } };
  return { state, reads, storage };
}

test('case reads exclude sessions, secrets and backup copies while observing immediate edits and deletions', async () => {
  const {state, reads, storage} = fixture();
  const read = createCaseLibraryReader({storage, readFullState: () => assert.fail('current libraries do not need full state')});
  const first = await read();
  assert.equal(first.entries[0].title, 'before');
  state.entries[0].title = 'after';
  assert.equal((await read()).entries[0].title, 'after');
  assert.equal(first.entries[0].title, 'before');
  state.entries = [];
  assert.deepEqual((await read()).entries, []);
  for (const keys of reads) for (const forbidden of ['composerSessions','migrationBackup','aiProviderRegistry','creativeRuns','facetUndo']) assert(!keys.includes(forbidden));
  assert.deepEqual(Object.keys(first).sort(), ['compoundCases','entries','facetCatalog','organizerState','taxonomy']);
  assert.deepEqual(first.taxonomy, state.taxonomy, 'Shared field queries must resolve current classification names/roles without pulling credentials or sessions');
});

test('legacy libraries use the full migration path rather than backing up a partial snapshot', async () => {
  const {state,storage} = fixture();
  delete state.schemaVersion;
  let fullReads = 0;
  const read = createCaseLibraryReader({storage, readFullState: async () => {
    fullReads++;
    assert.equal(state.schemaVersion, undefined);
    return { ...migrateLibraryState(state).state, composerSessions: [{content:'private'}], aiSettings:{apiKey:'secret'} };
  }});
  const result = await read();
  assert.equal(fullReads, 1);
  assert.equal(result.entries[0].text, '原词');
  assert(!JSON.stringify(result).includes('private'));
  assert(!JSON.stringify(result).includes('secret'));
});

test('fully archived vocabulary still uses the existing recovery path instead of losing visible tags in fast reads',async()=>{
  const {state,storage}=fixture();
  for(const facet of state.facetCatalog.facets) facet.status='archived';
  let fullReads=0;
  const read=createCaseLibraryReader({storage,readFullState:async()=>{
    fullReads++;
    return {...state,facetCatalog:recoverFullyArchivedFacets(state.facetCatalog).catalog};
  }});
  const result=await read();
  assert.equal(fullReads,1);
  assert(result.facetCatalog.facets.length>0);
  assert(result.facetCatalog.facets.every(facet=>facet.status==='active'));
});

test('an unchanged case library is reused without re-reading records; any page write is seen immediately', async () => {
  const { createLibraryStorage, CASE_LIBRARY_REVISION_KEY } = await import('../extension/library-storage.js');
  const data = structuredClone(migrateLibraryState({ entries: [{ id: 'case', title: 'before', text: '原词' }] }).state);
  let recordReads = 0;
  const backend = {
    async get(keys) {
      const list = typeof keys === 'string' ? [keys] : keys;
      if (list.includes('entries') && list.includes('taxonomy')) recordReads++;
      return structuredClone(Object.fromEntries(list.filter(key => key in data).map(key => [key, data[key]])));
    },
    async set(values) { Object.assign(data, structuredClone(values)); },
    async remove(keys) { for (const key of [keys].flat()) delete data[key]; }
  };
  const lock = operation => operation();
  // Two extension contexts write the same browser storage.
  const background = createLibraryStorage({ backend, lock }), page = createLibraryStorage({ backend, lock });
  await page.set({ entries: data.entries });
  const read = createCaseLibraryReader({ storage: background, readFullState: () => assert.fail('current library') });
  const first = await read();
  assert.equal(await read(), first, 'same revision reuses the snapshot');
  assert.equal(recordReads, 1);
  assert.throws(() => { first.entries[0].title = 'mutated'; }, TypeError, 'shared snapshots cannot be changed by one caller');

  await page.set({ entries: [{ ...first.entries[0], title: 'page edit' }] });
  assert.equal((await read()).entries[0].title, 'page edit');
  await page.update(['entries'], stored => ({ entries: [...stored.entries, { ...stored.entries[0], id: 'second' }] }));
  assert.equal((await read()).entries.length, 2);
  await page.set({ uiPreferences: { theme: 'dark' } });
  const afterUnrelated = await read();
  assert.equal(recordReads, 3, 'writes outside the case library keep the snapshot');
  await page.remove('classificationRules');
  assert.equal(data[CASE_LIBRARY_REVISION_KEY], undefined, 'removing case records drops the revision');
  assert.notEqual(await read(), afterUnrelated);
  assert.equal(recordReads, 4);
});
