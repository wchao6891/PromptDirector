import test from 'node:test';
import assert from 'node:assert/strict';
import { createLibraryStorage } from '../extension/library-storage.js';
import { CASE_INDEX_KEY, LEGACY_ENTRIES_KEY, caseRecordKey } from '../extension/library-case-records.js';
import { SCHEMA_VERSION } from '../extension/taxonomy.js';

function memory(initial = {}) {
  const data = structuredClone(initial), sets = [], removes = [], listeners = new Set();
  let tail = Promise.resolve();
  const lock = fn => { const result = tail.then(fn); tail = result.catch(() => {}); return result; };
  const backend = {
    beforeSet: null, afterGet: null,
    async getKeys() { return Object.keys(data); },
    async get(keys) {
      const names = keys == null ? Object.keys(data) : typeof keys === 'string' ? [keys] : keys;
      const result = structuredClone(Object.fromEntries(names.filter(key => Object.hasOwn(data, key)).map(key => [key, data[key]])));
      await backend.afterGet?.(names);
      return result;
    },
    async set(update) {
      update = structuredClone(update);
      backend.beforeSet?.(update);
      sets.push(update);
      const changes = Object.fromEntries(Object.entries(update).map(([key, value]) => [key, { oldValue: data[key], newValue: value }]));
      Object.assign(data, update);
      for (const listener of listeners) listener(changes, 'local');
    },
    async remove(keys) {
      keys = Array.isArray(keys) ? keys : [keys]; removes.push(keys);
      for (const key of keys) delete data[key];
    }
  };
  const changes = { addListener: fn => listeners.add(fn), removeListener: fn => listeners.delete(fn) };
  const open = () => createLibraryStorage({ backend, lock, changes });
  return { data, sets, removes, backend, open, storage: open() };
}

const cases = (...ids) => ids.map(id => ({ id, schemaVersion: SCHEMA_VERSION, text: `正文 ${id}` }));
const legacy = (ids, schemaVersion = SCHEMA_VERSION) => ({ schemaVersion, entries: cases(...ids), keep: 'other' });
const ids = async storage => (await storage.get('entries')).entries.map(entry => entry.id);

test('the first current-version write stores each case separately, keeps the old list untouched and reads back the same library', async () => {
  const run = memory(legacy(['a', 'b', 'c'], SCHEMA_VERSION - 1));
  const original = structuredClone(run.data.entries);
  await run.storage.set({ schemaVersion: SCHEMA_VERSION, entries: cases('a', 'b', 'c') });
  assert.deepEqual(run.data[CASE_INDEX_KEY].ids, ['a', 'b', 'c']);
  assert.deepEqual(run.data[caseRecordKey('b')], cases('b')[0]);
  assert.deepEqual(run.data[LEGACY_ENTRIES_KEY], original, 'the list as it was before the switch stays for recovery');
  assert.equal(Object.hasOwn(run.data, 'entries'), false);
  assert.equal(run.data.keep, 'other');
  assert.deepEqual(await ids(run.storage), ['a', 'b', 'c']);
  assert.deepEqual((await run.storage.get(null)).entries, cases('a', 'b', 'c'));
  assert.equal(Object.keys(await run.storage.get(null)).some(key => key.startsWith('case:') || key === CASE_INDEX_KEY), false);
});

test('a library still at an older version keeps the single list until the upgrade sets the current version', async () => {
  const run = memory(legacy(['a'], SCHEMA_VERSION - 1));
  await run.storage.set({ entries: cases('a', 'b') });
  assert.deepEqual(run.data.entries.map(entry => entry.id), ['a', 'b']);
  assert.equal(Object.hasOwn(run.data, CASE_INDEX_KEY), false);
});

test('editing one case writes only that case; reordering writes only the order; deleting removes only that record', async () => {
  const run = memory(legacy(['a', 'b', 'c']));
  await run.storage.set({ entries: cases('a', 'b', 'c') });
  run.sets.length = 0; run.removes.length = 0;
  const edited = cases('a', 'b', 'c'); edited[1].text = '改过的正文';
  await run.storage.set({ entries: edited });
  assert.deepEqual(Object.keys(run.sets[0]).filter(key => key.startsWith('case:') || key === CASE_INDEX_KEY), [caseRecordKey('b')]);
  assert.equal(run.data[caseRecordKey('b')].text, '改过的正文');

  run.sets.length = 0;
  await run.storage.set({ entries: [edited[2], edited[0], edited[1]] });
  assert.deepEqual(Object.keys(run.sets[0]).filter(key => key.startsWith('case:') || key === CASE_INDEX_KEY), [CASE_INDEX_KEY]);

  run.sets.length = 0;
  await run.storage.update(['entries'], stored => ({ entries: stored.entries.filter(entry => entry.id !== 'a') }));
  assert.deepEqual(run.removes.at(-1), [caseRecordKey('a')]);
  assert.deepEqual(await ids(run.storage), ['c', 'b']);
  assert.equal(run.data[caseRecordKey('b')].text, '改过的正文');
});

test('a write from another page is never overwritten by a stale copy of the stored cases', async () => {
  const run = memory(legacy(['a', 'b']));
  const page = run.open();
  await run.storage.set({ entries: cases('a', 'b') });
  const fromPage = cases('a', 'b'); fromPage[0].text = '另一页面改的';
  await page.set({ entries: fromPage });
  // This page last saw "a" unchanged; it must notice the other write and still store its own change.
  const mine = structuredClone(fromPage); mine[1].text = '这一页改的';
  await run.storage.set({ entries: mine });
  const stored = (await run.storage.get('entries')).entries;
  assert.equal(stored[0].text, '另一页面改的'); assert.equal(stored[1].text, '这一页改的');
  // And writing back the original text for "a" really writes it, although this page once stored it.
  await run.storage.set({ entries: cases('a', 'b') });
  assert.equal(run.data[caseRecordKey('a')].text, '正文 a');
});

test('if the stored cases do not read back exactly, the library returns to the old list and nothing is lost', async () => {
  const run = memory(legacy(['a', 'b'], SCHEMA_VERSION - 1));
  const before = structuredClone(run.data);
  run.backend.beforeSet = update => { if (update[caseRecordKey('b')]) update[caseRecordKey('b')] = { id: 'b', text: '损坏' }; };
  await assert.rejects(run.storage.set({ schemaVersion: SCHEMA_VERSION, entries: cases('a', 'b') }), error => error.code === 'CASE_RECORDS_VERIFY_FAILED');
  run.backend.beforeSet = null;
  assert.deepEqual(run.data.entries, before.entries);
  assert.equal(run.data.schemaVersion, before.schemaVersion);
  assert.equal(Object.keys(run.data).some(key => key.startsWith('case:') || key === CASE_INDEX_KEY), false);
  assert.deepEqual(await ids(run.storage), ['a', 'b']);
});

test('cases an older PromptDirector added to a plain list are kept after the stored cases and folded in by the next write', async () => {
  const run = memory(legacy(['a', 'b']));
  await run.storage.set({ entries: cases('a', 'b') });
  // An older version cannot see the records; it writes its own list with an old version number.
  run.data.entries = [{ id: 'a', text: '旧版本的过期副本' }, ...cases('new')];
  run.data.schemaVersion = SCHEMA_VERSION - 1;
  const read = (await run.storage.get('entries')).entries;
  assert.deepEqual(read.map(entry => entry.id), ['a', 'b', 'new']);
  assert.equal(read[0].text, '正文 a', 'a stored case is never replaced by the older list');
  await run.storage.set({ schemaVersion: SCHEMA_VERSION, entries: read });
  assert.equal(Object.hasOwn(run.data, 'entries'), false);
  assert.deepEqual(run.data[CASE_INDEX_KEY].ids, ['a', 'b', 'new']);
});

test('a case named by the order but missing stops the read instead of showing a smaller library', async () => {
  const run = memory(legacy(['a', 'b']));
  await run.storage.set({ entries: cases('a', 'b') });
  delete run.data[caseRecordKey('b')];
  await assert.rejects(run.storage.get(['entries']), error => error.code === 'CASE_RECORDS_MISSING' && error.missingIds[0] === 'b');
  await assert.rejects(run.storage.get(null), error => error.code === 'CASE_RECORDS_MISSING');
});

test('a read that overlaps a write reads again and returns one consistent library', async () => {
  const run = memory(legacy(['a', 'b']));
  await run.storage.set({ entries: cases('a', 'b') });
  let raced = false;
  run.backend.afterGet = async names => {
    if (raced || !names.includes(caseRecordKey('a'))) return;
    raced = true;
    run.backend.afterGet = null;
    await run.open().set({ entries: cases('b', 'c') });
  };
  assert.deepEqual(await ids(run.storage), ['b', 'c']);
  assert.equal(raced, true);
});

test('cases without distinct ids stay in the single list; once stored separately such a write is refused unchanged', async () => {
  const run = memory(legacy(['a']));
  await run.storage.set({ entries: [{ id: 'x' }, { id: 'x' }] });
  assert.equal(run.data.entries.length, 2);
  assert.equal(Object.hasOwn(run.data, CASE_INDEX_KEY), false);
  await run.storage.set({ entries: cases('a') });
  await assert.rejects(run.storage.set({ entries: [{ text: '没有编号' }] }), error => error.code === 'CASE_ID_INVALID');
  assert.deepEqual(await ids(run.storage), ['a']);
});

test('removing the case list removes every case record and its order', async () => {
  const run = memory(legacy(['a', 'b']));
  await run.storage.set({ entries: cases('a', 'b') });
  await run.storage.remove('entries');
  assert.equal(Object.keys(run.data).some(key => key.startsWith('case:') || key === CASE_INDEX_KEY), false);
  assert.deepEqual(await run.storage.get('entries'), {});
});

test('listeners see changed cases as one case list change, never the storage layout', async () => {
  const run = memory(legacy(['a', 'b']));
  await run.storage.set({ entries: cases('a', 'b') });
  const seen = [];
  run.storage.subscribe(changes => seen.push(changes));
  const edited = cases('b', 'a'); edited[0].text = '新';
  await run.storage.set({ entries: edited });
  const change = seen.at(-1);
  assert.deepEqual(Object.keys(change.entries.cases), ['b']);
  assert.deepEqual(change.entries.caseIds, ['b', 'a']);
  assert.equal(Object.hasOwn(change.entries, 'newValue'), false);
  assert.equal(Object.keys(change).some(key => key.startsWith('case:') || key === CASE_INDEX_KEY), false);
});

test('reads keep the requested keys and defaults whichever way cases are stored', async () => {
  const run = memory(legacy(['a']));
  await run.storage.set({ entries: cases('a') });
  assert.deepEqual(await run.storage.get({ entries: [], missing: 7, keep: 'default' }), { entries: cases('a'), missing: 7, keep: 'other' });
  assert.deepEqual(Object.keys(await run.storage.get(['entries', 'keep'])).sort(), ['entries', 'keep']);
  assert.deepEqual(await run.storage.get(['keep']), { keep: 'other' });
});
