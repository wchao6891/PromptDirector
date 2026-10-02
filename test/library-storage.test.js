import test from 'node:test';
import assert from 'node:assert/strict';
import { createLibraryStorage, createLibraryCommitter } from '../extension/library-storage.js';
import { markSyncMetaDirty } from '../extension/sync-model.js';

function fixture(initial = {}) {
  const data = structuredClone(initial), listeners = new Set(), calls = [];
  let tail = Promise.resolve(), failure = null;
  const lock = fn => { const result = tail.then(fn); tail = result.catch(() => {}); return result; };
  const backend = {
    async getKeys() { if (failure) throw failure; return Object.keys(data); },
    async get(keys) {
      if (failure) throw failure;
      if (keys == null) return structuredClone(data);
      const defaults = typeof keys === 'object' && !Array.isArray(keys) ? keys : {};
      return structuredClone(Object.fromEntries((typeof keys === 'string' ? [keys] : Array.isArray(keys) ? keys : Object.keys(keys))
        .filter(key => Object.hasOwn(data, key) || Object.hasOwn(defaults, key)).map(key => [key, Object.hasOwn(data, key) ? data[key] : defaults[key]])));
    },
    async set(update) { if (failure) throw failure; calls.push(structuredClone(update)); Object.assign(data, structuredClone(update)); },
    async remove(keys) { if (failure) throw failure; for (const key of Array.isArray(keys) ? keys : [keys]) delete data[key]; }
  };
  const storage = createLibraryStorage({ backend, lock, changes: {
    addListener: fn => listeners.add(fn), removeListener: fn => listeners.delete(fn)
  } });
  return { data, calls, backend, lock, storage, fail: error => { failure = error; },
    emit: (update, area) => { for (const listener of listeners) listener(update, area); } };
}

test('legacy snapshots retain unknown keys, missing/default semantics and exact body text', async () => {
  const run = fixture({ entries: [{ text: '\uFEFF正文\r\n  ', future: [false, 0, null] }], unknown: 'keep' });
  assert.deepEqual(await run.storage.get(null), run.data);
  assert.deepEqual(await run.storage.get({ unknown: 'default', missing: [] }), { unknown: 'keep', missing: [] });
  assert.deepEqual(await run.storage.get(['missing']), {});
  await run.storage.set({ draft: 'not normalized' });
  await run.storage.remove('draft');
  assert.equal(run.data.unknown, 'keep');
});

test('browser metadata reads do not pass a directory option in the Chrome callback position', async () => {
  const keys = ['entries', 'agentReferenceSelection'];
  const storage = createLibraryStorage({ lock: fn => fn(), backend: {
    get(...args) {
      assert.equal(args.length, 1, 'Chrome rejects an explicit second argument that is not a callback');
      assert.deepEqual(args[0], keys);
      return Promise.resolve({ entries: [{ id: 'kept', text: '完整正文' }] });
    },
    set() {}, remove() {}
  } });
  assert.deepEqual(await storage.get(keys), { entries: [{ id: 'kept', text: '完整正文' }] });
});

test('key discovery returns only names, propagates failure and does not read the library values', async () => {
  const run=fixture({entries:['private content'],task:{}});
  run.backend.get=()=>assert.fail('getKeys must not read values');
  assert.deepEqual(await run.storage.getKeys(),['entries','task']);
  run.fail(new Error('unavailable'));await assert.rejects(run.storage.getKeys(),/unavailable/);
});

test('concurrent commits preserve both dirty-original sets and commit metadata with the corresponding change', async () => {
  const run = fixture(), commit = createLibraryCommitter({ storage: run.storage, syncedKeys: new Set(['entries']),
    syncMetaKey: 'syncMeta', markDirty: markSyncMetaDirty, isSyncApplying: () => false });
  await Promise.all(['original-a', 'original-b'].map(id => commit({ entries: [{ id }] }, { dirtyAssetIds: [id] })));
  assert.deepEqual(run.data.syncMeta.dirtyAssetIds, ['original-a', 'original-b']);
  assert.equal(run.calls.length, 2);
  for (const call of run.calls) { assert.ok(call.entries); assert.equal(call.syncMeta.localDirty, true); }
});

test('sync application and device-only writes retain existing dirty-marker behavior', async () => {
  const run = fixture({ syncMeta: { localDirty: false } }); let applying = false;
  const commit = createLibraryCommitter({ storage: run.storage, syncedKeys: new Set(['entries']),
    syncMetaKey: 'syncMeta', markDirty: markSyncMetaDirty, isSyncApplying: () => applying });
  await commit({ uiPreferences: { theme: 'dark' } });
  await commit({ entries: [] }, { markSyncDirty: false });
  applying = true; await commit({ entries: [{ id: 'from-sync' }] });
  assert.deepEqual(run.data.syncMeta, { localDirty: false });
  assert.ok(run.calls.every(call => !Object.hasOwn(call, 'syncMeta')));
});

test('a failed backend is never treated as an empty library or replaced by another store', async () => {
  const source = fixture({ entries: ['keep'] }), other = fixture({ entries: ['other-library'] });
  const failure = Object.assign(new Error('disconnected'), { code: 'vault_unavailable' });
  source.fail(failure);
  for (const operation of [() => source.storage.get(null), () => source.storage.set({ entries: [] }),
    () => source.storage.remove('entries'), () => source.storage.update(null, () => ({ entries: [] }))]) {
    await assert.rejects(operation(), error => error === failure);
  }
  assert.deepEqual(source.data.entries, ['keep']); assert.deepEqual(other.data.entries, ['other-library']);
  source.fail(null); await source.storage.set({ recovered: true });
  assert.equal(source.data.recovered, true);
});

test('change subscriptions forward library events and detach without echo writes', () => {
  const run = fixture(), seen = [], detach = run.storage.subscribe(changes => seen.push(changes));
  run.emit({ entries: { newValue: [1] } }, 'session');
  run.emit({ entries: { newValue: [2] } }, 'local');
  detach(); run.emit({ entries: { newValue: [3] } }, 'local');
  assert.deepEqual(seen, [{ entries: { newValue: [2] } }]); assert.equal(run.calls.length, 0);
});

test('single-file metadata reads or transforms that fail cannot persist a partial sync marker', async () => {
  const run = fixture({ entries: ['keep'] });
  await assert.rejects(run.storage.update('entries', () => { throw new Error('invalid edit'); }), /invalid edit/);
  await assert.rejects(run.storage.update('entries', () => null), /无效/);
  assert.equal(run.calls.length, 0); assert.deepEqual(run.data.entries, ['keep']);
});

test('removing history or sessions invalidates their summaries without touching cases or other sources', async () => {
  for (const source of ['facetUndo', 'trashState', 'analysisBatchUndo', 'analysisRebuildStaging']) {
    const run = fixture({ entries: [{ id: 'kept', text: '完整正文' }], [source]: { retained: true },
      libraryViewSummary: { version: 1, facetUndoCount: 10 }, composerSessionSummaries: [{ id: 'kept-session' }] });
    await run.storage.remove(source);
    assert.equal(Object.hasOwn(run.data, source), false);
    assert.equal(Object.hasOwn(run.data, 'libraryViewSummary'), false);
    assert.equal(run.data.entries[0].text, '完整正文');
    assert.equal(run.data.composerSessionSummaries[0].id, 'kept-session');
  }
  const run = fixture({ composerSessions: [{ id: 'old' }], composerSessionSummaries: [{ id: 'old' }], unrelated: true });
  await run.storage.remove(['composerSessions']);
  assert.deepEqual(run.data, { unrelated: true });
});
