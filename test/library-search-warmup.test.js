import test from 'node:test';
import assert from 'node:assert/strict';
import { createSearchIndexWarmup } from '../extension/library-search-warmup.js';

function fixture() {
  const pending = new Map(); let handle = 0, clock = 0;
  const warmup = createSearchIndexWarmup({
    requestIdle: fn => { pending.set(++handle, fn); return handle; }, cancelIdle: id => pending.delete(id),
    now: () => clock, sliceMs: 8
  });
  return { warmup, pending, run() { const [id, fn] = pending.entries().next().value; pending.delete(id); fn(); },
    row(onRead) { return { get fullText() { clock += 4; onRead(); return '完整原词'; } }; } };
}

test('search warmup never blocks first render and yields after the existing index slice budget', () => {
  const run = fixture(); let read = 0;
  run.warmup.start(Array.from({ length: 5 }, () => run.row(() => read++)));
  assert.equal(read, 0); assert.equal(run.pending.size, 1);
  run.run(); assert.equal(read, 2); assert.equal(run.pending.size, 1);
  run.run(); assert.equal(read, 4);
  run.run(); assert.equal(read, 5); assert.equal(run.pending.size, 0);
});

test('a replacement index cancels obsolete rows and page teardown cancels remaining work', () => {
  const run = fixture(); let old = 0, current = 0;
  run.warmup.start([run.row(() => old++)]);
  run.warmup.start([run.row(() => current++)]);
  assert.equal(run.pending.size, 1);run.run();
  assert.equal(old, 0);assert.equal(current, 1);
  run.warmup.start([run.row(() => current++)]);run.warmup.cancel();
  assert.equal(run.pending.size, 0);assert.equal(current, 1);
});
