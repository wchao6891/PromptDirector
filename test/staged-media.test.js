import test from 'node:test';
import assert from 'node:assert/strict';
import { createMediaStage, createStagedMediaRegistry, STAGED_MEDIA_KEY } from '../extension/staged-media.js';
import { createAgentTransfers } from '../extension/agent-transfers.js';
import { sha256Blob } from '../extension/blob-digest.js';

function storage(initial = {}) {
  const data = structuredClone(initial);
  return { data, get: async key => structuredClone(key === null ? data : { [key]: data[key] }),
    set: async update => { Object.assign(data, structuredClone(update)); },
    remove: async key => { delete data[key]; } };
}
function fixture() {
  const store = storage(), files = new Set(), references = new Set();
  let documents = ['page'], failure = false;
  const options = { storage: store, activeDocuments: async () => documents,
    cleanup: async (ids, protectedIds) => {
      if (failure) throw new Error('disk unavailable');
      for (const id of ids) if (!references.has(id) && !protectedIds.includes(id)) files.delete(id);
    } };
  return { store, files, references, options, registry: createStagedMediaRegistry(options),
    close: () => { documents = []; }, fail: value => { failure = value; } };
}

test('closing a preview removes only uncommitted originals, while live previews stay protected', async () => {
  const f = fixture();
  await f.registry.register('preview', 'page', ['pending', 'committed']);
  f.files.add('pending'); f.files.add('committed'); f.references.add('committed');
  await f.registry.sweep(); assert.equal(f.files.size, 2);
  f.close(); await f.registry.sweep();
  assert.deepEqual([...f.files], ['committed']);
  assert.deepEqual(f.store.data[STAGED_MEDIA_KEY], {});
});

test('lost save replies never delete originals already referenced by the committed library', async () => {
  const f = fixture();
  await f.registry.register('save', 'page', ['original']); f.files.add('original');
  f.references.add('original');
  await f.registry.release('save', 'page');
  assert(f.files.has('original'));
  assert.deepEqual(f.store.data[STAGED_MEDIA_KEY], {});
});

test('a cleanup failure preserves the ID journal and a restarted worker retries it', async () => {
  const f = fixture();
  await f.registry.register('save', 'page', ['orphan']); f.files.add('orphan'); f.fail(true);
  await f.registry.release('save', 'page');
  assert.equal(f.store.data[STAGED_MEDIA_KEY].save.released, true);
  f.fail(false); await createStagedMediaRegistry(f.options).sweep();
  assert.equal(f.files.size, 0);
  assert.deepEqual(f.store.data[STAGED_MEDIA_KEY], {});
});

test('one cancelled writer cannot remove an original still being written by another page', async () => {
  const f = fixture();
  await f.registry.register('one', 'page', ['shared']);
  await f.registry.register('two', 'page', ['shared']); f.files.add('shared');
  await f.registry.release('one', 'page'); assert(f.files.has('shared'));
  await f.registry.release('two', 'page'); assert.equal(f.files.size, 0);
});

test('local reference handles use the same ownership journal and cannot be released by a different document', async () => {
  const calls = [], store = storage();
  const registry = createStagedMediaRegistry({ storage: store, activeDocuments: async () => ['page'], cleanup: async (...args) => calls.push(args) });
  await registry.register('link', 'page', ['handle'], ['handle']);
  await assert.rejects(registry.release('link', 'other'), /不属于/);
  await registry.release('link', 'page'); assert.deepEqual(calls, [[['handle'], [], ['handle']]]);
});

test('registration failure skips the write; background cleanup that never replies cannot block the UI', async () => {
  let rejectRegistration = true, writes = 0;
  const stage = createMediaStage({ runtime: { sendMessage: async message => {
    if (message.type === 'RELEASE_STAGED_MEDIA') return new Promise(() => {});
    return rejectRegistration ? { ok: false, message: 'quota' } : { ok: true };
  } } });
  await assert.rejects(stage.write(['bad'], () => { writes++; }), /quota/);
  rejectRegistration = false;
  await stage.write(['good'], () => { writes++; });
  assert.equal(stage.release(), undefined); assert.equal(writes, 1);
});

test('cancelling during registration or writing releases only after the final bytes settle', async () => {
  let registered, finish;
  const events = [];
  const stage = createMediaStage({ runtime: { sendMessage: message => {
    if (message.type === 'REGISTER_STAGED_MEDIA') return new Promise(resolve => { registered = resolve; });
    events.push('release'); return Promise.resolve({ ok: true });
  } } });
  const writing = stage.write(['original'], () => new Promise(resolve => { events.push('write'); finish = resolve; }));
  stage.release(); assert.deepEqual(events, []);
  registered({ ok: true }); await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(events, ['write']);
  finish(); await writing;
  assert.deepEqual(events, ['write', 'release']);
  await assert.rejects(stage.write(['late'], () => assert.fail('cancelled write')), /已取消/);
});

for (const action of ['abort', 'prune']) test(`a chunk written before receipt persistence fails remains discoverable for ${action}`, async () => {
  const store = storage(), blobs = new Map(); let sets = 0, fail = false;
  const realSet = store.set;
  store.set = async update => { if (fail && ++sets === 1) throw new Error('receipt failure'); await realSet(update); };
  const options = { storage: store, readBlob: async id => blobs.get(id), writeBlob: async (id, blob) => blobs.set(id, blob), deleteBlob: async id => blobs.delete(id),
    prepare: async () => ({}), now: () => 0, idleMs: 1 };
  const transfer = createAgentTransfers(options);
  const blob = new Blob(['original']);
  await transfer.begin({ id: 'file', name: 'file.txt', mimeType: 'text/plain', byteSize: blob.size, sha256: await sha256Blob(blob) });
  fail = true;
  await assert.rejects(transfer.append({ id: 'file', offset: 0, data: Buffer.from('original').toString('base64') }), /receipt failure/);
  assert(blobs.has('agentUpload:file:0')); assert.equal(store.data['agentUpload:file'].chunks, 0);
  fail = false;
  const restarted = createAgentTransfers({ ...options, now: () => 100 });
  if (action === 'abort') await restarted.abort({ id: 'file' }); else assert.equal((await restarted.prune()).discarded, 1);
  assert.equal(blobs.size, 0); assert.equal(store.data['agentUpload:file'], undefined);
});

test('offscreen poster writes are reclaimed after preparation interruption', async () => {
  const store = storage({ 'agentUpload:file': { id: 'file', assetId: 'original', chunks: 0, state: 'uploading' } });
  const removed = [];
  const transfers = createAgentTransfers({ storage: store, deleteBlob: async id => removed.push(id) });
  await transfers.abort({ id: 'file' }); assert.deepEqual(removed, ['original', 'original:poster']);
});
