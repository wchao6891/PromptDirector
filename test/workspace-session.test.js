import test from 'node:test';
import assert from 'node:assert/strict';
import { createWorkspaceSession } from '../extension/workspace-session.js';
const fixture = () => {
  let state = { viewedCaseId: 'a', viewedAssetId: 'one', positionMs: 0 }, count = 0;
  const session = createWorkspaceSession({ sessionId: 'page', readState: () => state,
    perform: async input => { count++; state = { ...state, viewedAssetId: input.assetId }; return { action: input.action }; } });
  return { session, human: patch => { state = { ...state, ...patch }; session.observe(); }, count: () => count };
};
test('a human media change rejects the late agent command without reclaiming the page', async () => {
  const f = fixture(), current = f.session.read();
  f.human({ viewedAssetId: 'two' });
  await assert.rejects(f.session.execute({ requestId: 'late', expectedRevision: current.controlRevision, action: 'select_media', assetId: 'one' }), { code: 'workspace_changed' });
  assert.equal(f.count(), 0); assert.equal(f.session.read().snapshot.viewedAssetId, 'two');
});
test('visible command receipt replays after later human input without performing the command again', async () => {
  const f = fixture(), input = { requestId: 'once', expectedRevision: f.session.read().controlRevision, action: 'select_media', assetId: 'two' };
  const receipt = await f.session.execute(input);
  assert.equal(receipt.snapshot.viewedAssetId, 'two'); assert.equal(receipt.state, 'executed'); assert.equal(Object.hasOwn(receipt, 'displayVerified'), false, 'execution is not visual acceptance');
  f.human({ viewedAssetId: 'three' });
  assert((await f.session.execute(input)).replayed); assert.equal(f.count(), 1);
  assert.equal(f.session.read().snapshot.viewedAssetId, 'three');
  await assert.rejects(f.session.execute({ ...input, assetId: 'four' }), { code: 'request_conflict' });
});
test('ordered changes wake a pending reader and journal expiration explicitly resets to the current snapshot', async () => {
  let state = { positionMs: 0 };
  const session = createWorkspaceSession({ sessionId: 'video', readState: () => state, perform: async () => {},
    budget: { maxAutomaticHistoryItems: 2, maxAutomaticHistoryBytes: 10000 } });
  const first = session.read();
  const waiting = session.wait({ afterRevision: first.revision, waitMs: 15000 });
  state.positionMs = 100; session.observe();
  const changed = await waiting; assert.equal(changed.changes.length, 1); assert.equal(changed.snapshot.positionMs, 100);
  for (const positionMs of [200, 300, 400]) { state.positionMs = positionMs; session.observe(); }
  const reset = session.read(first.revision); assert(reset.reset); assert.deepEqual(reset.changes, []); assert.equal(reset.snapshot.positionMs, 400);
  assert(session.read('old-page:1').reset);
});
test('retrying a failed or partially executed command cannot repeat its side effects', async () => {
  let count = 0;
  const session = createWorkspaceSession({ readState: () => ({ dirty: false }), perform: async () => { count++; throw Object.assign(Error('play blocked'), { code: 'blocked' }); } });
  const input = { requestId: 'failed', expectedRevision: session.read().controlRevision };
  await assert.rejects(session.execute(input), { code: 'blocked' });
  await assert.rejects(session.execute(input), { code: 'blocked' }); assert.equal(count, 1);
});

test('receipt retention does not cap a continuing review session and expired no-op commands cannot run again', async () => {
  let count=0;
  const session=createWorkspaceSession({sessionId:'long-review',readState:()=>({paused:true}),perform:async()=>{count++;},budget:{maxAutomaticHistoryItems:2,maxAutomaticHistoryBytes:10000}});
  const first={requestId:'first',expectedRevision:session.read().controlRevision};
  await session.execute(first);
  for(let i=0;i<10;i++)await session.execute({requestId:`later-${i}`,expectedRevision:session.read().controlRevision});
  assert.equal(count,11);
  await assert.rejects(session.execute(first),{code:'workspace_changed'});assert.equal(count,11);
});

test('natural playback progress remains readable without invalidating pause commands; an actual human seek still rejects stale control', async () => {
  let state={positionMs:100,paused:false},humanIntent=0;
  const session=createWorkspaceSession({readState:()=>state,readControlState:()=>({humanIntent}),perform:async()=>{state.paused=true;}});
  const before=session.read();state.positionMs=200;session.observe('playback');
  assert.notEqual(session.read().revision,before.revision);assert.equal(session.read().controlRevision,before.controlRevision);
  await session.execute({requestId:'pause',expectedRevision:before.controlRevision});assert(state.paused);
  const stale=session.read();humanIntent++;state.positionMs=900;session.observe('human');
  await assert.rejects(session.execute({requestId:'late',expectedRevision:stale.controlRevision}),{code:'workspace_changed'});
});
