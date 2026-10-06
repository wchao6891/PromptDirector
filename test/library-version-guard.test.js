import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createLibraryStorage } from '../extension/library-storage.js';
import { assertLibraryWritable, libraryFromNewerVersion, NEWER_LIBRARY_CODE } from '../extension/library-version-guard.js';
import { casesLostByMigration, migrateLibraryState } from '../extension/migration.js';
import { SCHEMA_VERSION } from '../extension/taxonomy.js';

function memoryStorage(initial) {
  const data = structuredClone(initial);
  let tail = Promise.resolve();
  const backend = {
    async get(keys) { return structuredClone(Object.fromEntries((Array.isArray(keys) ? keys : [keys]).filter(key => Object.hasOwn(data, key)).map(key => [key, data[key]]))); },
    async set(update) { Object.assign(data, structuredClone(update)); },
    async remove(keys) { for (const key of Array.isArray(keys) ? keys : [keys]) delete data[key]; }
  };
  const lock = fn => { const result = tail.then(fn); tail = result.catch(() => {}); return result; };
  return { data, storage: createLibraryStorage({ backend, lock, assertWritable: assertLibraryWritable }) };
}

test('a library saved by a newer version is recognised from its version or any of its cases', () => {
  assert.equal(libraryFromNewerVersion({ schemaVersion: SCHEMA_VERSION + 1 }), true);
  assert.equal(libraryFromNewerVersion({ schemaVersion: SCHEMA_VERSION, entries: [{ id: 'a', schemaVersion: SCHEMA_VERSION + 1 }] }), true);
  assert.equal(libraryFromNewerVersion({ schemaVersion: SCHEMA_VERSION, entries: [{ id: 'a', schemaVersion: SCHEMA_VERSION }] }), false);
  assert.equal(libraryFromNewerVersion({ schemaVersion: SCHEMA_VERSION - 3 }), false);
  assert.equal(libraryFromNewerVersion({}), false);
});

test('no write, update or removal can touch a library saved by a newer version; its records stay byte-identical', async () => {
  const newer = { schemaVersion: SCHEMA_VERSION + 1, entries: [{ id: 'future', newField: { kept: true } }], other: 'value' };
  const { data, storage } = memoryStorage(newer);
  for (const attempt of [
    () => storage.set({ entries: [] }),
    () => storage.update(['entries'], () => ({ entries: [] })),
    () => storage.remove('entries')
  ]) await assert.rejects(attempt, error => error.code === NEWER_LIBRARY_CODE);
  assert.deepEqual(data, newer);
});

test('the current and older versions still write normally, including the upgrade that sets the version', async () => {
  const { data, storage } = memoryStorage({ schemaVersion: SCHEMA_VERSION - 1, entries: [] });
  await storage.set({ schemaVersion: SCHEMA_VERSION, entries: [{ id: 'a' }] });
  await storage.update(['entries'], stored => ({ entries: [...stored.entries, { id: 'b' }] }));
  assert.deepEqual((await storage.get('entries')).entries.map(entry => entry.id), ['a', 'b']);
});

test('a migration that would drop a case is detected; a case moved to the recycle bin is not a loss', () => {
  const before = { entries: [{ id: 'a' }, { id: 'b' }, { id: 'c' }], trashState: { items: [{ kind: 'entry', targetId: 'd' }] } };
  assert.deepEqual(casesLostByMigration(before, { entries: [{ id: 'a' }], trashState: { items: [{ kind: 'entry', targetId: 'b' }, { kind: 'entry', targetId: 'd' }] } }), ['c']);
  assert.deepEqual(casesLostByMigration(before, before), []);
});

test('migrating the stored compatibility fixture loses no case', async () => {
  const fixture = JSON.parse(await readFile(new URL('./fixtures/compat/storage/schema-28.json', import.meta.url), 'utf8'));
  const stored = fixture.storage ?? fixture;
  const older = { ...structuredClone(stored), schemaVersion: SCHEMA_VERSION - 1 };
  assert.deepEqual(casesLostByMigration(older, migrateLibraryState(older).state), []);
});

test('each upgrade keeps a backup of only the library records, never nesting older recovery copies, beside the untouched first backup', async () => {
  const source = await readFile(new URL('../extension/background.js', import.meta.url), 'utf8');
  const keys = source.match(/const MIGRATION_BACKUP_KEYS = Object\.freeze\(\[([\s\S]*?)\]\)/)[1];
  assert.doesNotMatch(keys, /Backup|RecoveryPoint|Undo/);
  assert.match(source, /if \(libraryFromNewerVersion\(stored\)\) throw newerLibraryError\(\);[\s\S]*?const shouldMigrate = needsMigration\(stored\)/,
    'the newer-version check runs before any repair or migration write');
  assert.match(source, /const upgrading = [^\n]+stored\.schemaVersion < SCHEMA_VERSION;\n\s+if \(upgrading \|\| !stored\[STORAGE_KEYS\.upgradeBackup\]\)/);
});
