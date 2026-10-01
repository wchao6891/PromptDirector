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
  assert.deepEqual(Object.keys(first).sort(), ['compoundCases','entries','facetCatalog','organizerState']);
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
