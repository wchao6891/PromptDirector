import test from 'node:test';
import assert from 'node:assert/strict';
import { createBrowserLibraryIdentity, LIBRARY_IDENTITY_KEY } from '../extension/library-identity.js';

function setup(initial = {}) {
  const data = structuredClone(initial); let writes = 0, legacy = 'original-agent-id', tail = Promise.resolve();
  const storage = { get: async key => Object.hasOwn(data, key) ? { [key]: structuredClone(data[key]) } : {},
    set: async values => { writes++; Object.assign(data, structuredClone(values)); } };
  const lock = fn => { const next = tail.then(fn); tail = next.catch(() => {}); return next; };
  const options = { storage, lock, getLegacyId: async () => legacy };
  return { data, storage, options, writes: () => writes, legacy: value => { legacy = value; } };
}

test('existing references retain their library id after Agent pairing changes or the worker restarts', async () => {
  const fixture = setup(), first = createBrowserLibraryIdentity(fixture.options);
  assert.deepEqual(await first.read(), { version: 1, backend: 'browser', libraryId: 'original-agent-id' });
  fixture.legacy('replacement-device-id');
  assert.equal((await createBrowserLibraryIdentity(fixture.options).read()).libraryId, 'original-agent-id');
  assert.equal(fixture.writes(), 1);
});

test('concurrent callers adopt one existing id without duplicate persistence', async () => {
  const fixture = setup();
  const ids = await Promise.all(Array.from({ length: 8 }, () => createBrowserLibraryIdentity(fixture.options).read()));
  assert.equal(new Set(ids.map(item => item.libraryId)).size, 1);
  assert.equal(fixture.writes(), 1);
});

test('unknown or damaged identity records are retained instead of silently renaming the library', async () => {
  for (const value of [null, {}, { version: 2, backend: 'browser', libraryId: 'old' }, { version: 1, backend: 'directory', libraryId: 'old' }]) {
    const fixture = setup({ [LIBRARY_IDENTITY_KEY]: value });
    await assert.rejects(createBrowserLibraryIdentity(fixture.options).read(), { code: 'library_identity_invalid' });
    assert.deepEqual(fixture.data[LIBRARY_IDENTITY_KEY], value);
    assert.equal(fixture.writes(), 0);
  }
});

test('read/write failures propagate and an unconfirmed new identity is never returned as saved', async () => {
  const fixture = setup(), failure = new Error('storage unavailable');
  await assert.rejects(createBrowserLibraryIdentity({ ...fixture.options,
    storage: { ...fixture.storage, set: async () => { throw failure; } } }).read(), error => error === failure);
  assert.equal(Object.hasOwn(fixture.data, LIBRARY_IDENTITY_KEY), false);
  await assert.rejects(createBrowserLibraryIdentity({ ...fixture.options,
    storage: { ...fixture.storage, get: async () => { throw failure; } } }).read(), error => error === failure);
});

test('missing legacy identity is an error, not an excuse to invalidate old references', async () => {
  const fixture = setup(); fixture.legacy('');
  await assert.rejects(createBrowserLibraryIdentity(fixture.options).read(), { code: 'library_identity_invalid' });
  assert.equal(fixture.writes(), 0);
});
