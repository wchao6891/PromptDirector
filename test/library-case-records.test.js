import test from 'node:test';
import assert from 'node:assert/strict';
import { createLibraryStorage } from '../extension/library-storage.js';
import { CASE_INDEX_KEY, LEGACY_ENTRIES_KEY, caseRecordKey } from '../extension/library-case-records.js';
import { SCHEMA_VERSION } from '../extension/taxonomy.js';

function memory(initial = {}) {
  const data = structuredClone(initial), sets = [], removes = [], gets = [], listeners = new Set();
  let tail = Promise.resolve();
  const lock = fn => { const result = tail.then(fn); tail = result.catch(() => {}); return result; };
  const backend = {
    beforeSet: null, afterGet: null, beforeRemove: null,
    async getKeys() { return Object.keys(data); },
    async get(keys) {
      const names = keys == null ? Object.keys(data) : typeof keys === 'string' ? [keys] : keys;
      gets.push(names);
      const result = structuredClone(Object.fromEntries(names.filter(key => Object.hasOwn(data, key)).map(key => [key, data[key]])));
      await backend.afterGet?.(names);
      return result;
    },
    async set(update) {
      update = structuredClone(update);
      backend.beforeSet?.(update);
      sets.push(update);
      const changes = Object.fromEntries(Object.entries(update)
        .filter(([key, value]) => JSON.stringify(data[key]) !== JSON.stringify(value))
        .map(([key, value]) => [key, { oldValue: data[key], newValue: value }]));
      Object.assign(data, update);
      const notification = structuredClone(changes);
      for (const listener of listeners) listener(notification, 'local');
    },
    async remove(keys) {
      keys = Array.isArray(keys) ? keys : [keys]; removes.push(keys);
      backend.beforeRemove?.(keys);
      const changes = Object.fromEntries(keys.filter(key => Object.hasOwn(data, key)).map(key => [key, { oldValue: data[key] }]));
      for (const key of keys) delete data[key];
      for (const listener of listeners) listener(changes, 'local');
    }
  };
  const changes = { addListener: fn => listeners.add(fn), removeListener: fn => listeners.delete(fn) };
  const open = () => createLibraryStorage({ backend, lock, changes });
  return { data, sets, removes, gets, backend, open, storage: open() };
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
  assert.deepEqual(run.removes.at(-1), [caseRecordKey('a'), 'caseView:a']);
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
  await run.backend.remove(caseRecordKey('b'));
  await assert.rejects(run.storage.get(['entries']), error => error.code === 'CASE_RECORDS_MISSING' && error.missingIds[0] === 'b');
  await assert.rejects(run.storage.get(null), error => error.code === 'CASE_RECORDS_MISSING');
});

test('a read that overlaps a write reads again and returns one consistent library', async () => {
  const run = memory(legacy(['a', 'b']));
  await run.storage.set({ entries: cases('a', 'b') });
  const reader = run.open();
  let raced = false;
  run.backend.afterGet = async names => {
    if (raced || !names.includes(caseRecordKey('a'))) return;
    raced = true;
    run.backend.afterGet = null;
    await run.open().set({ entries: cases('b', 'c') });
  };
  assert.deepEqual(await ids(reader), ['b', 'c']);
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

test('a page applies changed, removed and reordered cases without reading the library again', async () => {
  const { applyCaseChanges } = await import('../extension/library-case-records.js');
  const shown = cases('a', 'b', 'c');
  const edited = { ...shown[1], text: '新' };
  assert.deepEqual(applyCaseChanges(shown, { cases: { b: edited }, removedCaseIds: [] }), [shown[0], edited, shown[2]]);
  assert.deepEqual(applyCaseChanges(shown, { cases: {}, removedCaseIds: ['a'], caseIds: ['c', 'b'] }), [shown[2], shown[1]]);
  assert.deepEqual(applyCaseChanges(shown, { cases: { d: cases('d')[0] }, removedCaseIds: [], caseIds: ['d', 'a', 'b', 'c'] }).map(entry => entry.id), ['d', 'a', 'b', 'c']);
  assert.equal(applyCaseChanges(shown, { cases: { d: cases('d')[0] }, removedCaseIds: [] }), null, 'a new case without its position needs a full read');
  assert.equal(applyCaseChanges(shown, { cases: {}, removedCaseIds: [], caseIds: ['a', 'unknown'] }), null);
});

test('browser storage that returns object fields in its own order still verifies and writes only real changes', async () => {
  const run = memory(legacy(['a', 'b'], SCHEMA_VERSION - 1));
  // Chrome returns stored objects with their fields reordered.
  const sorted = value => value && typeof value === 'object' && !Array.isArray(value)
    ? Object.fromEntries(Object.keys(value).sort().map(key => [key, sorted(value[key])])) : Array.isArray(value) ? value.map(sorted) : value;
  const get = run.backend.get;
  run.backend.get = async keys => sorted(await get(keys));
  const written = cases('a', 'b').map(entry => ({ text: entry.text, id: entry.id, schemaVersion: entry.schemaVersion }));
  await run.storage.set({ schemaVersion: SCHEMA_VERSION, entries: written });
  assert.deepEqual(run.data[CASE_INDEX_KEY].ids, ['a', 'b']);
  run.sets.length = 0;
  await run.open().set({ entries: written });
  assert.deepEqual(Object.keys(run.sets[0]).filter(key => key.startsWith('case:')), [], 'reordered fields are not a change');
});

test('ordinary edits never load the preserved whole-library recovery copy', async () => {
  const run = memory(legacy(['a', 'b']));
  await run.storage.set({ entries: cases('a', 'b') });
  run.gets.length = 0;
  const edited = cases('a', 'b'); edited[0].text = '新正文';
  await run.storage.set({ entries: edited });
  assert.equal(run.gets.some(keys => keys.includes(LEGACY_ENTRIES_KEY)), false);
});

test('a committed deletion remains successful and retries failed record cleanup on the next edit', async () => {
  const run = memory(legacy(['a', 'b']));
  await run.storage.set({ entries: cases('a', 'b') });
  run.backend.beforeRemove = () => { throw new Error('temporary cleanup failure'); };
  await assert.doesNotReject(run.storage.set({ entries: cases('b') }));
  assert.deepEqual(await ids(run.storage), ['b']);
  assert.ok(run.data[caseRecordKey('a')], 'failed auxiliary removal leaves the unindexed record available for retry');
  run.backend.beforeRemove = null;
  await run.storage.set({ entries: cases('b') });
  assert.equal(Object.hasOwn(run.data, caseRecordKey('a')), false);
});

test('old-version cases deliberately deleted by a committed write cannot reappear when plain-list cleanup fails', async () => {
  const run = memory(legacy(['a']));
  await run.storage.set({ entries: cases('a') });
  run.data.entries = cases('a', 'old-added');
  assert.deepEqual(await ids(run.storage), ['a', 'old-added']);
  run.backend.beforeRemove = () => { throw new Error('temporary cleanup failure'); };
  await assert.doesNotReject(run.storage.set({ entries: cases('a') }));
  assert.deepEqual(await ids(run.open()), ['a']);
});

test('first-upgrade edits stay committed when the old-list cleanup fails', async () => {
  const run = memory(legacy(['a', 'b'], SCHEMA_VERSION - 1));
  run.backend.beforeRemove = () => { throw new Error('temporary cleanup failure'); };
  await assert.doesNotReject(run.storage.set({ schemaVersion: SCHEMA_VERSION, entries: cases('b') }));
  assert.deepEqual(await ids(run.open()), ['b']);
  assert.deepEqual(run.data[LEGACY_ENTRIES_KEY], cases('a', 'b'));
});

test('an interrupted first-upgrade readback keeps the old library active and can be retried', async () => {
  const run = memory(legacy(['a', 'b'], SCHEMA_VERSION - 1));
  run.backend.afterGet = names => {
    if (names.includes(caseRecordKey('a'))) throw new Error('readback interrupted');
  };
  await assert.rejects(run.storage.set({ schemaVersion: SCHEMA_VERSION, entries: cases('b', 'a', 'new') }), /readback interrupted/);
  run.backend.afterGet = null;
  assert.equal(run.data.schemaVersion, SCHEMA_VERSION - 1);
  assert.deepEqual(await ids(run.open()), ['a', 'b']);
  await run.open().set({ schemaVersion: SCHEMA_VERSION, entries: cases('b', 'a', 'new') });
  assert.deepEqual(await ids(run.open()), ['b', 'a', 'new']);
});

test('failed upgrade verification and failed auxiliary cleanup still leave the untouched old list readable', async () => {
  const run = memory(legacy(['a', 'b'], SCHEMA_VERSION - 1));
  run.backend.beforeSet = update => { if (update[caseRecordKey('b')]) update[caseRecordKey('b')].text = '损坏'; };
  run.backend.beforeRemove = () => { throw new Error('cleanup unavailable'); };
  await assert.rejects(run.storage.set({ schemaVersion: SCHEMA_VERSION, entries: cases('b', 'a', 'new') }), error => error.code === 'CASE_RECORDS_VERIFY_FAILED');
  assert.equal(run.data.schemaVersion, SCHEMA_VERSION - 1);
  assert.deepEqual(await ids(run.open()), ['a', 'b']);
});

test('stored comparison snapshots do not share mutable nested objects with a caller', async () => {
  const run = memory(legacy(['a']));
  const edited = cases('a'); edited[0].creative = { tags: ['初稿'], nested: { note: '第一次' } };
  await run.storage.set({ entries: edited });
  edited[0].creative.nested.note = '第二次';
  edited[0].creative.tags.push('修改');
  await run.storage.set({ entries: edited });
  assert.deepEqual(run.data[caseRecordKey('a')].creative, edited[0].creative);
  run.sets.length = 0;
  await run.storage.set({ entries: structuredClone(edited) });
  assert.deepEqual(Object.keys(run.sets[0]).filter(key => key.startsWith('case:')), []);
});

test('a case restored before cleanup retry is never removed by the earlier deletion', async () => {
  const run = memory(legacy(['a', 'b']));
  await run.storage.set({ entries: cases('a', 'b') });
  run.backend.beforeRemove = () => { throw new Error('temporary cleanup failure'); };
  await run.storage.set({ entries: cases('b') });
  run.backend.beforeRemove = null;
  await run.storage.set({ entries: cases('a', 'b') });
  assert.deepEqual(await ids(run.open()), ['a', 'b']);
});

test('a restarted page retries unindexed record cleanup without reviving the deleted case', async () => {
  const run = memory(legacy(['a', 'b']));
  await run.storage.set({ entries: cases('a', 'b') });
  run.backend.beforeRemove = () => { throw new Error('temporary cleanup failure'); };
  await run.storage.set({ entries: cases('b') });
  run.backend.beforeRemove = null;
  await run.open().set({ entries: cases('b') });
  assert.equal(Object.hasOwn(run.data, caseRecordKey('a')), false);
  assert.deepEqual(await ids(run.open()), ['b']);
});

test('staged upgrade records never update another page before commit and publishing refreshes changed content', async () => {
  const { applyCaseChanges } = await import('../extension/library-case-records.js');
  const run = memory(legacy(['a']));
  const events = [];
  run.open().subscribe(changes => events.push(changes));
  const edited = cases('a'); edited[0].text = '升级时修改';
  run.backend.afterGet = async names => {
    if (!names.includes(caseRecordKey('a'))) return;
    run.backend.afterGet = null;
    assert.equal(events.some(change => change.entries), false, 'unverified staged records are invisible');
    assert.deepEqual((await run.open().get(null)).entries, cases('a'));
    assert.equal(Object.keys(await run.open().get(null)).some(key => key.startsWith('case:')), false);
  };
  await run.storage.set({ entries: edited });
  const published = events.find(change => change.entries)?.entries;
  assert.ok(published);
  assert.equal(applyCaseChanges(cases('a'), published), null, 'the page must read the committed records after migration');
  run.backend.afterGet = null;
  assert.equal((await run.open().get('entries')).entries[0].text, '升级时修改');
});

test('failure to publish a verified upgrade keeps all old cases and the version unchanged', async () => {
  const run = memory(legacy(['a', 'b'], SCHEMA_VERSION - 1));
  run.backend.beforeSet = update => { if (update[CASE_INDEX_KEY]) throw new Error('commit interrupted'); };
  await assert.rejects(run.storage.set({ schemaVersion: SCHEMA_VERSION, entries: cases('b', 'new') }), /commit interrupted/);
  assert.equal(run.data.schemaVersion, SCHEMA_VERSION - 1);
  assert.deepEqual(await ids(run.open()), ['a', 'b']);
  run.backend.beforeSet = null;
  await run.open().set({ schemaVersion: SCHEMA_VERSION, entries: cases('a', 'b') });
  assert.deepEqual(await ids(run.open()), ['a', 'b']);
  assert.equal(Object.hasOwn(run.data, caseRecordKey('new')), false, 'abandoned staged records are reclaimed');
});

test('clearing an older list with unchanged indexed cases never announces an empty library', async () => {
  const run = memory(legacy(['a']));
  await run.storage.set({ entries: cases('a') });
  run.data.entries = cases('a', 'old-added');
  assert.deepEqual(await ids(run.open()), ['a', 'old-added']);
  const events = [];
  run.open().subscribe(changes => { if (changes.entries) events.push(changes.entries); });
  run.backend.beforeRemove = () => { throw new Error('temporary cleanup failure'); };
  await run.storage.set({ entries: cases('a') });
  assert.equal(events.length, 1);
  assert.equal(Object.hasOwn(events[0], 'newValue'), false);
  assert.equal(events[0].caseLayout, undefined, 'without authoritative records, the page uses its full refresh');
  assert.deepEqual(await ids(run.open()), ['a']);
});

test('auxiliary removal events cannot remove cases from a page after their index already committed', async () => {
  const run = memory(legacy(['a', 'b']));
  await run.storage.set({ entries: cases('a', 'b') });
  const events = [];
  run.open().subscribe(changes => { if (changes.entries) events.push(changes.entries); });
  await run.storage.set({ entries: cases('b') });
  assert.equal(events.length, 1, 'only the committed index change reaches readers');
  assert.deepEqual(events[0].caseIds, ['b']);
});

test('repeated reads reuse verified records and callers cannot mutate the cached library', async () => {
  const run = memory(legacy(['a', 'b']));
  await run.storage.set({ entries: cases('a', 'b') });
  const page = run.open();
  const first = (await page.get('entries')).entries;
  first[0].text = '未保存的草稿'; first.pop();
  run.gets.length = 0;
  assert.deepEqual((await page.get('entries')).entries, cases('a', 'b'));
  assert.equal(run.gets.some(keys => keys.some(key => key.startsWith('case:'))), false);
});

test('another page updates only changed cache records while retaining order, deletion and older-list additions', async () => {
  const run = memory(legacy(['a', 'b']));
  await run.storage.set({ entries: cases('a', 'b') });
  const page = run.open(); await page.get('entries');
  const edited = cases('b', 'c'); edited[0].text = '跨页修改';
  await run.storage.set({ entries: edited });
  run.data.entries = cases('older');
  run.gets.length = 0;
  assert.deepEqual((await page.get('entries')).entries, [...edited, ...cases('older')]);
  assert.equal(run.gets.some(keys => keys.some(key => key.startsWith('case:'))), false);
});

test('single-case edits read only their own record and cannot modify a different case', async () => {
  const run = memory(legacy(['a', 'b']));
  await run.storage.set({ entries: cases('a', 'b') });
  run.gets.length = 0; run.sets.length = 0;
  const result = await run.storage.updateCase('a', entry => ({ ...entry, text: '仅改当前' }));
  assert.equal(result.changed, true); assert.equal(result.entry.text, '仅改当前');
  assert.equal(run.gets.some(keys => keys.includes(caseRecordKey('b')) || keys.includes(LEGACY_ENTRIES_KEY) || keys.includes('entries')), false);
  assert.equal(run.data[caseRecordKey('b')].text, '正文 b');
  assert.deepEqual(Object.keys(run.sets[0]).filter(key => key.startsWith('case:')), [caseRecordKey('a')]);
  await assert.rejects(run.storage.updateCase('a', entry => ({ ...entry, id: 'b' })), error => error.code === 'CASE_ID_INVALID');
});

test('concurrent single-case transforms see latest saved content for the same case and different cases', async () => {
  const run = memory(legacy(['a', 'b']));
  await run.storage.set({ entries: cases('a', 'b') });
  await Promise.all([
    run.storage.updateCase('a', entry => ({ ...entry, text: entry.text + '1' })),
    run.open().updateCase('a', entry => ({ ...entry, text: entry.text + '2' })),
    run.open().updateCase('b', entry => ({ ...entry, text: entry.text + '3' }))
  ]);
  assert.equal(run.data[caseRecordKey('a')].text, '正文 a12');
  assert.equal(run.data[caseRecordKey('b')].text, '正文 b3');
});

test('single-case failed commits and missing records never report success or poison the reader cache', async () => {
  const run = memory(legacy(['a', 'b']));
  await run.storage.set({ entries: cases('a', 'b') });
  const page = run.open(); await page.get('entries');
  run.backend.beforeSet = () => { throw new Error('write unavailable'); };
  await assert.rejects(run.storage.updateCase('a', entry => ({ ...entry, text: '失败' })), /write unavailable/);
  assert.deepEqual((await page.get('entries')).entries, cases('a', 'b'));
  run.backend.beforeSet = null;
  await run.backend.remove(caseRecordKey('a'));
  await assert.rejects(run.storage.updateCase('a', entry => entry), error => error.code === 'CASE_RECORDS_MISSING');
  await assert.rejects(page.get('entries'), error => error.code === 'CASE_RECORDS_MISSING');
  await assert.rejects(run.storage.updateCase('absent', entry => entry), error => error.code === 'CASE_NOT_FOUND');
});

test('unchanged single-case edits avoid writes and returned objects cannot mutate later reads', async () => {
  const run = memory(legacy(['a']));
  await run.storage.set({ entries: cases('a') });
  run.sets.length = 0;
  const unchanged = await run.storage.updateCase('a', entry => entry);
  assert.equal(unchanged.changed, false); assert.equal(run.sets.length, 0);
  const saved = await run.storage.updateCase('a', entry => ({ ...entry, text: '保存' }));
  saved.entry.text = '未保存';
  assert.equal((await run.storage.get('entries')).entries[0].text, '保存');
});

test('single-case edits preserve legacy layout cases and cases added by an older version', async () => {
  const run = memory(legacy(['a', 'b']));
  await run.storage.updateCase('a', entry => ({ ...entry, text: '首次编辑' }));
  assert.deepEqual(await ids(run.storage), ['a', 'b']);
  run.data.entries = cases('older');
  await run.storage.updateCase('older', entry => ({ ...entry, text: '旧版新增后编辑' }));
  const read = (await run.storage.get('entries')).entries;
  assert.deepEqual(read.map(entry => entry.id), ['a', 'b', 'older']);
  assert.equal(read[2].text, '旧版新增后编辑');
});

test('single-case commits preserve both concurrent sync dirty sets atomically and no-ops stay clean', async () => {
  const { createLibraryCommitter } = await import('../extension/library-storage.js');
  const { markSyncMetaDirty } = await import('../extension/sync-model.js');
  const run = memory(legacy(['a', 'b']));
  await run.storage.set({ entries: cases('a', 'b') });
  const commit = createLibraryCommitter({storage: run.storage, syncedKeys: new Set(['entries']), syncMetaKey: 'syncMeta',
    markDirty: markSyncMetaDirty, isSyncApplying: () => false});
  run.sets.length = 0;
  await Promise.all(['a', 'b'].map(id => commit.updateCase(id, entry => ({ ...entry, text: entry.text + '改' }), {dirtyAssetIds: ['asset-' + id]})));
  assert.deepEqual(run.data.syncMeta.dirtyAssetIds, ['asset-a', 'asset-b']);
  assert.equal(run.sets.length, 2);
  assert.ok(run.sets.every(update => update.syncMeta.localDirty && update.caseLibraryRevision && Object.keys(update).some(key => key.startsWith('case:'))));
  const count = run.sets.length;
  await commit.updateCase('a', entry => entry);
  assert.equal(run.sets.length, count);
});

test('single-case sync suppression and failed dirty-marker commits leave the prior sync state intact', async () => {
  const { createLibraryCommitter } = await import('../extension/library-storage.js');
  const { markSyncMetaDirty } = await import('../extension/sync-model.js');
  const run = memory({ ...legacy(['a']), syncMeta: { localDirty: false, dirtyAssetIds: ['retained'] } });
  await run.storage.set({ entries: cases('a') });
  let applying = false;
  const commit = createLibraryCommitter({storage: run.storage, syncedKeys: new Set(['entries']), syncMetaKey: 'syncMeta',
    markDirty: markSyncMetaDirty, isSyncApplying: () => applying});
  await commit.updateCase('a', entry => ({ ...entry, text: '不标脏' }), {markSyncDirty: false});
  applying = true;
  await commit.updateCase('a', entry => ({ ...entry, text: '同步写入' }));
  assert.deepEqual(run.data.syncMeta, {localDirty: false, dirtyAssetIds: ['retained']});
  applying = false;
  run.backend.beforeSet = () => { throw new Error('commit failed'); };
  await assert.rejects(commit.updateCase('a', entry => ({ ...entry, text: '失败' }), {dirtyAssetIds: ['new']}), /commit failed/);
  assert.equal(run.data[caseRecordKey('a')].text, '同步写入');
  assert.deepEqual(run.data.syncMeta, {localDirty: false, dirtyAssetIds: ['retained']});
});

test('editing a deleted case cannot revive an unindexed record awaiting cleanup', async () => {
  const run = memory(legacy(['a', 'b']));
  await run.storage.set({ entries: cases('a', 'b') });
  run.backend.beforeRemove = () => { throw new Error('temporary cleanup failure'); };
  await run.storage.set({ entries: cases('b') });
  assert.ok(run.data[caseRecordKey('a')]);
  await assert.rejects(run.storage.updateCase('a', entry => ({ ...entry, text: '复活' })), error => error.code === 'CASE_NOT_FOUND');
  assert.deepEqual(await ids(run.storage), ['b']);
});

test('returned change events cannot mutate the private cached case order or content', async () => {
  const run = memory(legacy(['a', 'b']));
  await run.storage.set({ entries: cases('a', 'b') });
  const page = run.open(); await page.get('entries');
  page.subscribe(changes => {
    if (changes.entries?.caseIds) changes.entries.caseIds.length = 0;
    if (changes.entries?.cases?.b) changes.entries.cases.b.text = '通知监听器的临时改动';
  });
  const edited = cases('b', 'a'); edited[0].text = '实际保存';
  await run.storage.set({ entries: edited });
  assert.deepEqual((await page.get('entries')).entries, edited);
});

test('a reader with no event source revalidates revisions before reusing its cached cases', async () => {
  const run = memory(legacy(['a', 'b']));
  await run.storage.set({ entries: cases('a', 'b') });
  const page = createLibraryStorage({ backend: run.backend, lock: operation => operation() });
  await page.get('entries');
  await run.storage.updateCase('a', entry => ({ ...entry, text: '另页新值' }));
  assert.equal((await page.get('entries')).entries[0].text, '另页新值');
});

test('read-only snapshots share deeply frozen case records without changing mutable get semantics', async () => {
  const run = memory(legacy(['a']));
  const original = cases('a'); original[0].mediaAssets = [{id: 'image', palette: {colors: ['#123456']}}];
  await run.storage.set({ entries: original });
  const first = (await run.storage.getSnapshot('entries')).entries;
  assert.ok(Object.isFrozen(first));
  assert.ok(Object.isFrozen(first[0].mediaAssets[0].palette.colors));
  assert.throws(() => { first[0].mediaAssets[0].palette.colors.push('#ffffff'); }, TypeError);
  const second = (await run.storage.getSnapshot('entries')).entries;
  assert.equal(first[0], second[0], 'verified case records are shared without copying all case bodies');
  const mutable = (await run.storage.get('entries')).entries;
  mutable[0].mediaAssets[0].palette.colors.push('#ffffff');
  assert.deepEqual((await run.storage.getSnapshot('entries')).entries[0].mediaAssets[0].palette.colors, ['#123456']);
});

test('read-only snapshots retain prior values while cross-page edits and deletion publish a new snapshot', async () => {
  const run = memory(legacy(['a', 'b']));
  await run.storage.set({entries: cases('a', 'b')});
  const page = run.open();
  const before = (await page.getSnapshot('entries')).entries;
  await run.storage.updateCase('a', entry => ({...entry, text: '新正文'}));
  const after = (await page.getSnapshot('entries')).entries;
  assert.equal(before[0].text, '正文 a'); assert.equal(after[0].text, '新正文');
  assert.equal(before[1], after[1]); assert.notEqual(before[0], after[0]);
  await run.storage.set({entries: [after[0]]});
  assert.deepEqual((await page.getSnapshot('entries')).entries.map(entry => entry.id), ['a']);
  assert.equal(before.length, 2);
});

test('read-only entries work before migration and do not freeze caller-owned default values', async () => {
  const run = memory(legacy(['a'], SCHEMA_VERSION - 1));
  const snapshot = await run.storage.getSnapshot({entries: [], keep: 'default'});
  assert.ok(Object.isFrozen(snapshot.entries[0])); assert.equal(snapshot.keep, 'other');
  const empty = memory();
  const defaults = {entries: []};
  assert.ok(Object.isFrozen((await empty.storage.getSnapshot(defaults)).entries));
  assert.equal(Object.isFrozen(defaults.entries), false);
});

test('progressive snapshots show metadata before bodies, prefer selected cases and never reread completed batches', async () => {
  const run = memory(legacy(['a', 'b', 'c', 'd']));
  await run.storage.set({entries: cases('a', 'b', 'c', 'd')});
  const page = run.open(); run.gets.length = 0;
  const reader = page.getSnapshotBatches(['schemaVersion', 'entries', 'keep'], {batchSize: 2, selectIds: () => ['c']});
  const header = (await reader.next()).value;
  assert.equal(header.loaded, 0); assert.equal(header.total, 4); assert.equal(header.complete, false);
  assert.equal(header.stored.keep, 'other');
  assert.equal(run.gets.some(keys => keys.includes('entries') || keys.some(key => key.startsWith('case:'))), false);
  const first = (await reader.next()).value;
  assert.deepEqual(first.stored.entries.map(entry => entry.id), ['a', 'c']);
  assert.ok(Object.isFrozen(first.stored.entries[0]));
  const last = (await reader.next()).value;
  assert.equal(last.complete, true); assert.deepEqual(last.stored.entries.map(entry => entry.id), ['a', 'b', 'c', 'd']);
  assert.equal((await reader.next()).done, true);
  assert.deepEqual(run.gets.flat().filter(key => key.startsWith('case:')).sort(), ['case:a','case:b','case:c','case:d']);
  run.gets.length = 0;
  assert.equal((await page.getSnapshot('entries')).entries.length, 4);
  assert.equal(run.gets.some(keys => keys.some(key => key.startsWith('case:'))), false);
});

test('progressive reads keep compound members together even when the first batch budget is smaller', async () => {
  const run = memory({...legacy(['a', 'b', 'c', 'd']), compoundCases: [{id:'group',memberEntryIds:['a','c','d']}]});
  await run.storage.set({entries: cases('a', 'b', 'c', 'd')});
  const reader = run.open().getSnapshotBatches(['schemaVersion','entries','compoundCases'], {batchSize:1,selectIds:()=>['c']});
  await reader.next();
  const first = (await reader.next()).value;
  assert.deepEqual(first.stored.entries.map(entry => entry.id), ['a','c','d']);
  assert.equal(first.complete,false);
  assert.equal((await reader.next()).value.loaded,4);
});

test('progressive reads reuse a complete cache but never treat an abandoned partial batch as the library', async () => {
  const run = memory(legacy(['a','b','c'])); await run.storage.set({entries:cases('a','b','c')});
  const page = run.open();
  const partial = page.getSnapshotBatches(['entries'],{batchSize:1});
  await partial.next(); await partial.next(); await partial.return();
  assert.deepEqual(await ids(page),['a','b','c']);
  run.gets.length=0;
  const cached = page.getSnapshotBatches(['entries'],{batchSize:1});
  const result=(await cached.next()).value;
  assert.equal(result.complete,true); assert.equal(result.loaded,3);
  assert.equal((await cached.next()).done,true);
  assert.equal(run.gets.some(keys=>keys.some(key=>key.startsWith('case:'))),false);
});

test('progressive reads refuse missing records and revisions changed between batches', async () => {
  const run=memory(legacy(['a','b']));await run.storage.set({entries:cases('a','b')});
  const reader=run.open().getSnapshotBatches(['entries'],{batchSize:1});
  await reader.next(); await reader.next();
  await run.storage.set({entries:cases('b','new')});
  await assert.rejects(reader.next(),error=>error.code==='CASE_RECORDS_CHANGED');
  assert.deepEqual(await ids(run.storage),['b','new']);
  await run.backend.remove(caseRecordKey('b'));
  const missing=run.open().getSnapshotBatches(['entries'],{batchSize:1});await missing.next();
  await assert.rejects(missing.next(),error=>error.code==='CASE_RECORDS_MISSING');
});

test('progressive reads route old schemas and mixed plain lists to full preparation without loading that list', async () => {
  for(const initial of [legacy(['a'],SCHEMA_VERSION-1),legacy(['a'])]) {
    const run=memory(initial);
    if(initial.schemaVersion===SCHEMA_VERSION){await run.storage.set({entries:cases('a')});run.data.entries=cases('older');}
    run.gets.length=0;
    const reader=run.open().getSnapshotBatches(['entries'],{batchSize:1});
    assert.equal((await reader.next()).value.requiresFullRead,true);
    assert.equal((await reader.next()).done,true);
    assert.equal(run.gets.some(keys=>keys.includes('entries')),false);
  }
});

test('a write during a progressive batch is rejected before that mixed batch reaches the page', async () => {
  const run=memory(legacy(['a','b']));await run.storage.set({entries:cases('a','b')});
  const reader=run.open().getSnapshotBatches(['entries'],{batchSize:1});await reader.next();
  run.backend.afterGet=async keys=>{
    if(!keys.includes(caseRecordKey('a')))return;
    run.backend.afterGet=null;
    await run.storage.updateCase('a',entry=>({...entry,text:'读取期间已修改'}));
  };
  await assert.rejects(reader.next(),error=>error.code==='CASE_RECORDS_CHANGED');
  assert.equal((await run.open().getSnapshot('entries')).entries[0].text,'读取期间已修改');
});

test('progressive batches use the caller growth budget and detect unversioned older-list additions', async () => {
  const run=memory(legacy(['a','b','c','d','e']));await run.storage.set({entries:cases('a','b','c','d','e')});
  const sizes=[];
  for await(const frame of run.open().getSnapshotBatches(['entries'],{batchSize:({loaded,total})=>loaded?total-loaded:1})) sizes.push(frame.loaded);
  assert.deepEqual(sizes,[0,1,5]);
  const reader=run.open().getSnapshotBatches(['entries'],{batchSize:1});await reader.next();await reader.next();
  run.data.entries=cases('older');
  await reader.next();await reader.next();await reader.next();
  await assert.rejects(reader.next(),error=>error.code==='CASE_RECORDS_CHANGED');
  assert.deepEqual(await ids(run.open()),['a','b','c','d','e','older']);
});

test('browse projections follow only changed cases in the same commit and stay outside public snapshots and events', async () => {
  const run=memory(legacy(['a','b']));await run.storage.set({entries:cases('a','b')});
  assert.equal(run.data['caseView:a'].id,'a');
  assert.equal(Object.hasOwn(run.data['caseView:a'],'text'),false);
  assert.equal(run.data.caseViewMeta.revision,run.data.caseLibraryRevision);
  const events=[];run.open().subscribe(change=>events.push(change));run.sets.length=0;
  await run.storage.updateCase('a',entry=>({...entry,title:'新名称'}));
  assert.equal(run.data['caseView:a'].title,'新名称');
  assert.equal(Object.hasOwn(run.sets[0],'caseView:b'),false);
  assert.ok(run.sets[0]['case:a']&&run.sets[0]['caseView:a']&&run.sets[0].caseViewMeta);
  assert.equal(events.some(event=>Object.keys(event).some(key=>key.startsWith('caseView'))),false);
  assert.equal(Object.keys(await run.storage.get(null)).some(key=>key.startsWith('caseView')),false);
});

test('metadata-only changes advance a valid browse marker without rewriting case projections', async () => {
  const run=memory(legacy(['a']));await run.storage.set({entries:cases('a')});run.sets.length=0;
  await run.storage.set({organizerState:{collections:[]}});
  assert.equal(run.data.caseViewMeta.revision,run.data.caseLibraryRevision);
  assert.equal(Object.keys(run.sets[0]).some(key=>key.startsWith('caseView:')),false);
  await run.backend.set({'case:a':{...cases('a')[0],title:'旧代码改名'},caseLibraryRevision:'older-writer'});
  await run.storage.set({taxonomy:{nodes:[]}});
  assert.notEqual(run.data.caseViewMeta.revision,run.data.caseLibraryRevision,'metadata alone cannot validate projections skipped by an older writer');
});

test('valid browse projections supply sorting before the first case batch without reading all case bodies', async () => {
  const run=memory(legacy(['a','b','c']));await run.storage.set({entries:cases('a','b','c')});run.gets.length=0;
  const reader=run.open().getSnapshotBatches(['entries'],{batchSize:1,useBrowseIndex:true,
    selectIds:({stored})=>stored.browseEntries.map(entry=>entry.id).reverse()});
  assert.equal((await reader.next()).value.loaded,0);
  const first=(await reader.next()).value;
  assert.deepEqual(first.stored.entries.map(entry=>entry.id),['c']);
  assert.equal(first.stored.browseEntries.length,3);
  assert.deepEqual(run.gets.flat().filter(key=>key.startsWith('case:')),['case:c']);
  await reader.return();
});

test('existing libraries build missing browse projections once from their read snapshot and keep formal records unchanged', async () => {
  const run=memory(legacy(['a','b']));await run.storage.set({entries:cases('a','b')});
  delete run.data['caseView:a'];delete run.data['caseView:b'];delete run.data.caseViewMeta;
  const revision=run.data.caseLibraryRevision;
  run.gets.length=0;run.sets.length=0;
  const page=run.open();const frames=[];
  for await(const frame of page.getSnapshotBatches(['entries'],{batchSize:1,useBrowseIndex:true}))frames.push(frame);
  assert.equal(frames.at(-1).complete,true);
  assert.equal(frames.at(-1).stored.browseEntries.length,2);
  assert.deepEqual(run.gets.flat().filter(key=>key.startsWith('case:')).sort(),['case:a','case:b']);
  assert.equal(run.data.caseLibraryRevision,revision);
  assert.ok(run.sets.every(update=>Object.keys(update).every(key=>key.startsWith('caseView'))));
  run.gets.length=0;await page.getSnapshot('entries');
  assert.equal(run.gets.flat().some(key=>key.startsWith('case:')),false);
});

test('changing sorting during progressive reads selects the new next batch without rereading loaded cases', async () => {
  const run=memory(legacy(['a','b','c','d']));await run.storage.set({entries:cases('a','b','c','d')});
  let order=['a','b','c','d'];
  const reader=run.open().getSnapshotBatches(['entries'],{batchSize:1,useBrowseIndex:true,selectIds:()=>order});
  await reader.next();assert.deepEqual((await reader.next()).value.stored.entries.map(entry=>entry.id),['a']);
  order=['d','c','b','a'];
  assert.deepEqual((await reader.next()).value.stored.entries.map(entry=>entry.id),['a','d']);
  assert.deepEqual((await reader.next()).value.stored.entries.map(entry=>entry.id),['a','c','d']);
  await reader.return();
});

test('full edits update only changed browse rows and deferred deletion cannot erase a restored browse row', async () => {
  const run=memory(legacy(['a','b']));await run.storage.set({entries:cases('a','b')});run.sets.length=0;
  await run.storage.set({entries:[{...cases('a')[0],title:'changed'},cases('b')[0]]});
  assert.deepEqual(Object.keys(run.sets[0]).filter(key=>key.startsWith('caseView:')),['caseView:a']);
  run.backend.beforeRemove=()=>{throw new Error('cleanup offline');};
  await run.storage.set({entries:cases('a')});
  assert.ok(run.data['caseView:b']);
  run.backend.beforeRemove=null;
  await run.storage.set({entries:[...cases('a'),{...cases('b')[0],title:'restored'}]});
  assert.equal(run.data['caseView:b'].title,'restored');
  await run.storage.remove('entries');
  assert.equal(Object.keys(run.data).some(key=>key.startsWith('caseView')),false);
});

test('single-case edits cannot certify other stale projections left by an older writer', async () => {
  const run=memory(legacy(['a','b']));await run.storage.set({entries:cases('a','b')});
  await run.backend.set({'case:b':{...cases('b')[0],title:'older writer'},caseLibraryRevision:'old-code'});
  await run.storage.updateCase('a',entry=>({...entry,title:'modern edit'}));
  assert.notEqual(run.data.caseViewMeta.revision,run.data.caseLibraryRevision);
  const frames=[];
  for await(const frame of run.open().getSnapshotBatches(['entries'],{batchSize:1,useBrowseIndex:true}))frames.push(frame);
  assert.equal(frames.at(-1).stored.browseEntries.find(entry=>entry.id==='b').title,'older writer');
  assert.equal(run.data.caseViewMeta.revision,run.data.caseLibraryRevision);
});

test('missing browse rows are rebuilt from a complete cached snapshot without rereading case bodies', async () => {
  const run=memory(legacy(['a','b']));await run.storage.set({entries:cases('a','b')});
  delete run.data['caseView:b'];run.gets.length=0;
  const frames=[];for await(const frame of run.storage.getSnapshotBatches(['entries'],{batchSize:1,useBrowseIndex:true}))frames.push(frame);
  assert.equal(frames.at(-1).complete,true);assert.equal(run.data['caseView:b'].id,'b');
  assert.equal(run.gets.flat().some(key=>key.startsWith('case:')),false);
  assert.throws(()=>{frames.at(-1).stored.browseEntries[0].customLabels.push('leak');},TypeError);
});

test('failed browse backfill remains disposable and does not block a verified full read or alter formal records', async () => {
  const run=memory(legacy(['a','b']));await run.storage.set({entries:cases('a','b')});
  delete run.data.caseViewMeta;
  const original=structuredClone(run.data),events=[];const page=run.open();page.subscribe(value=>events.push(value));
  run.backend.beforeSet=update=>{if(Object.keys(update).some(key=>key.startsWith('caseView')))throw new Error('cache storage failure');};
  const frames=[];for await(const frame of page.getSnapshotBatches(['entries'],{batchSize:1,useBrowseIndex:true}))frames.push(frame);
  assert.deepEqual(frames.at(-1).stored.entries,cases('a','b'));
  assert.deepEqual(run.data,original);assert.deepEqual(events,[]);
  run.gets.length=0;await page.getSnapshot('entries');assert.equal(run.gets.flat().some(key=>key.startsWith('case:')),false);
});

test('a concurrent edit while thin rows are read never supplies a stale sorted batch', async () => {
  const run=memory(legacy(['a','b']));await run.storage.set({entries:cases('a','b')});
  const reader=run.open().getSnapshotBatches(['entries'],{batchSize:1,useBrowseIndex:true});await reader.next();
  run.backend.afterGet=async keys=>{
    if(!keys.includes('caseView:a'))return;
    run.backend.afterGet=null;await run.storage.updateCase('a',entry=>({...entry,title:'new order'}));
  };
  await assert.rejects(reader.next(),error=>error.code==='CASE_RECORDS_CHANGED');
  assert.equal(run.data['case:a'].title,'new order');
});

test('browse backfill never manufactures missing formal cases or blesses an incomplete directory', async () => {
  const run=memory(legacy(['a','b']));await run.storage.set({entries:cases('a','b')});
  delete run.data.caseViewMeta;delete run.data['case:b'];run.sets.length=0;
  const reader=run.open().getSnapshotBatches(['entries'],{batchSize:1,useBrowseIndex:true});await reader.next();
  await assert.rejects(reader.next(),error=>error.code==='CASE_RECORDS_MISSING');
  assert.equal(run.sets.length,0);assert.equal(run.data.caseViewMeta,undefined);
});

test('an empty indexed library exposes an empty readonly browse directory without reading any record', async () => {
  const run=memory(legacy([]));await run.storage.set({entries:[]});run.gets.length=0;
  const reader=run.open().getSnapshotBatches(['entries'],{batchSize:1,useBrowseIndex:true});
  const frame=(await reader.next()).value;
  assert.equal(frame.complete,true);assert.deepEqual(frame.stored.browseEntries,[]);
  assert.equal(Object.isFrozen(frame.stored.browseEntries),true);
  assert.equal(run.gets.flat().some(key=>key.startsWith('case:')),false);
});
