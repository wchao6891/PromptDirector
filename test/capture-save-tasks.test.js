import test from 'node:test';
import assert from 'node:assert/strict';
import { createCaptureSaveTasks, rebaseCaptureEntries } from '../extension/capture-save-tasks.js';

function fixture(execute) {
  const data = {}, responses = new Map(), events = [];
  const storage = { async get(keys) { return Object.fromEntries(keys.map(key => [key, structuredClone(data[key])])); },
    async set(values) { Object.assign(data, structuredClone(values)); }, async remove(keys) { for (const key of keys) delete data[key]; } };
  const openCache = async () => ({ async match(key) { return responses.get(key)?.clone(); },
    async put(key, value) { responses.set(key, value.clone()); }, async delete(key) { return responses.delete(key); } });
  const create = run => createCaptureSaveTasks({ storage, execute: run, notify: event => events.push(event), openCache });
  return { create, tasks: create(execute), data, responses, events };
}
const aborted = signal => new Promise((_, reject) => signal.addEventListener('abort', () => reject(signal.reason), { once: true }));
const input = { type: 'COMMIT_PAGE_CAPTURE', saveRequestId: 'task-a', batch: { candidates: [{ id: 'original', contentText: '完整原词' }] } };

test('closing the UI leaves a durable save whose next UI can read and cancel it without a write queue wait', async () => {
  let started;
  const began = new Promise(resolve => { started = resolve; });
  const f = fixture(async (_input, progress) => { progress.stage('download'); started(); await aborted(progress.signal); });
  assert.equal((await f.tasks.start(input)).id, input.saveRequestId); await began;
  const task = await f.tasks.get();
  assert.equal(task.status, 'running'); assert.equal(task.input.batch.candidates[0].contentText, '完整原词');
  assert.equal((await f.tasks.cancel(task.id)).ok, true);
  for (let i = 0; i < 20 && (await f.tasks.get()).status !== 'cancelled'; i++) await new Promise(setImmediate);
  assert.equal((await f.tasks.get()).status, 'cancelled');
  assert.equal((await f.tasks.get()).input.batch.candidates.length, 1);
});

test('worker restart retains completed file bytes and an interrupted task; continue does not download that file twice', async () => {
  let checkpointed;
  const prepared = new Promise(resolve => { checkpointed = resolve; });
  const f = fixture(async (_input, progress) => {
    await progress.media('file', async () => new Blob(['original pixels'], { type: 'video/mp4' }));
    checkpointed(); await new Promise(() => {});
  });
  await f.tasks.start(input); await prepared;
  const restarted = f.create(async (_input, progress) => {
    const blob = await progress.media('file', () => { throw new Error('completed original must not be fetched again'); });
    assert.equal(await blob.text(), 'original pixels');
    return { ok: true, results: [{ entryId: 'saved' }] };
  });
  assert.equal((await restarted.get()).status, 'interrupted');
  assert.equal((await restarted.run(input)).ok, true);
  await restarted.acknowledge(input.saveRequestId);
  assert.equal(await restarted.get(), null); assert.equal(f.responses.size, 0);
});

test('cancel cannot interrupt an atomic case commit or report a saved case as cancelled', async () => {
  let committed, finish;
  const committing = new Promise(resolve => { committed = resolve; });
  const waiting = new Promise(resolve => { finish = resolve; });
  const f = fixture(async (_input, progress) => { await progress.commit(); committed(); await waiting; return { ok: true }; });
  await f.tasks.start(input); await committing;
  assert.equal((await f.tasks.cancel(input.saveRequestId)).ok, false);
  finish(); for (let i = 0; i < 20 && (await f.tasks.get()).status !== 'completed'; i++) await new Promise(setImmediate);
  assert.equal((await f.tasks.get()).status, 'completed');
});

test('partial receipt keeps only pending captures for reopening instead of replaying completed ones', async () => {
  const f = fixture(async () => ({ ok: true })); await f.tasks.run(input);
  const pending = { candidates: [{ id: 'pending', contentText: '未完成原词' }] };
  await f.tasks.acknowledge(input.saveRequestId, pending);
  const task = await f.tasks.get(); assert.equal(task.status, 'pending');
  assert.deepEqual(task.input.batch, pending); assert.equal(task.result, null);
});

test('download commit preserves unrelated concurrent cases and rejects changes or deletion of an affected case', () => {
  const before = [{ id: 'old', text: 'source' }], ready = [...before, { id: 'new', text: 'captured' }];
  const latest = [{ id: 'old', text: 'edited' }, { id: 'user-new', text: 'user work' }];
  assert.deepEqual(rebaseCaptureEntries(before, ready, latest, ['new'], () => false), [...latest, ready[1]]);
  assert.throws(() => rebaseCaptureEntries(before, ready, latest, ['old'], () => false), /已变化/);
  assert.throws(() => rebaseCaptureEntries(before, ready, [], ['old'], () => false), /已变化/);
  assert.throws(() => rebaseCaptureEntries([], ready, latest, ['new'], () => true), /已变化/);
});

test('a new capture cannot silently replace the cancelled task original even when a UI reuses its ID', async () => {
  const original = { ...input, batch: { id: 'original-batch', candidates: [{ contentText: '原始资料' }] } };
  const f = fixture(async () => ({ ok: false, message: 'connection failed' }));
  await f.tasks.run(original);
  await assert.rejects(() => f.tasks.start({ ...original, batch: { id: 'different-batch' } }), /待保存内容/);
  assert.equal((await f.tasks.get()).input.batch.candidates[0].contentText, '原始资料');
});

test('explicit discard releases only the selected unfinished task and checkpoints, retaining saved cases and separate drafts', async () => {
  const f = fixture(async (_input, progress) => {
    await progress.media('original', async () => new Blob(['completed original']));
    return { ok: false, message: 'second download failed' };
  });
  f.data.entries = [{ id: 'saved', text: '已入库内容' }];
  f.data.captureDraft = { text: '另一个待保存草稿' };
  await f.tasks.run(input);
  assert.equal(f.responses.size, 1);
  await assert.rejects(f.tasks.discard('stale-task'), /已变化/);
  assert.equal((await f.tasks.get()).id, input.saveRequestId);
  await f.tasks.discard(input.saveRequestId);
  assert.equal(await f.tasks.get(), null);
  assert.equal(f.responses.size, 0);
  assert.deepEqual(f.data.entries, [{ id: 'saved', text: '已入库内容' }]);
  assert.deepEqual(f.data.captureDraft, { text: '另一个待保存草稿' });
  const next = { ...input, saveRequestId: 'next', batch: { id: 'next-batch' } };
  assert.equal((await f.tasks.start(next)).id, 'next');
});

test('a start queued before stale discard cannot have its durable input removed', async () => {
  const f = fixture(async () => new Promise(() => {}));
  const start = f.tasks.start(input);
  const discard = assert.rejects(f.tasks.discard(input.saveRequestId), /先取消保存/);
  await start; await discard;
  assert.equal((await f.tasks.get()).id, input.saveRequestId);
  assert.deepEqual((await f.tasks.get()).input.batch, input.batch);
});
