import test from 'node:test';
import assert from 'node:assert/strict';
import { mergeLibraryEntryChange, libraryChangedEntryIds, createLocalCaseEditTracker } from '../extension/library-entry-changes.js';

const cases = () => [{ id: 'a', text: '保留原词甲' }, { id: 'b', text: '保留原词乙' }, { id: 'c', text: '保留原词丙' }];
test('coalesced updates and deletions carry precise ids without serializing untouched originals', () => {
  const before = cases();
  before[2].toJSON = () => { throw Error('untouched original was serialized'); };
  const first = mergeLibraryEntryChange(null, before, { caseLayout: true, cases: { a: { ...before[0], title: '新标题' } } });
  const next = mergeLibraryEntryChange(first, before, { caseLayout: true, removedCaseIds: ['b'], caseIds: ['c', 'a'] });
  assert.deepEqual([...libraryChangedEntryIds(before, next.entries, next.changedEntryIds)].sort(), ['a', 'b']);
  assert.deepEqual(next.entries.map(entry => entry.id), ['c', 'a']);
  assert.equal(next.entries[0], before[2]);
  assert(next.orderChanged);
});
test('legacy full-list notifications mixed with precise changes keep necessary comparison evidence', () => {
  const before = cases();
  const legacy = mergeLibraryEntryChange(null, before, { newValue: [{ ...before[0], text: '人工刚编辑' }, ...before.slice(1)] });
  const next = mergeLibraryEntryChange(legacy, before, { caseLayout: true, cases: { b: { ...before[1], title: '另一个修改' } } });
  assert.equal(next.changedEntryIds, null);
  assert.deepEqual([...libraryChangedEntryIds(before, next.entries, next.changedEntryIds)], ['a', 'b']);
});
test('reordering does not invalidate all cards and an index-only removal still invalidates its old card', () => {
  const before = cases();
  const reordered = mergeLibraryEntryChange(null, before, { caseLayout: true, caseIds: ['b', 'a', 'c'] });
  assert.equal(reordered.changedEntryIds.size, 0); assert(reordered.orderChanged);
  const removed = mergeLibraryEntryChange(reordered, before, { caseLayout: true, caseIds: ['a', 'c'] });
  assert.deepEqual([...removed.changedEntryIds], ['b']);
});
test('unknown added records and migration publications force a full refresh instead of assuming completeness', () => {
  const before = cases();
  assert.equal(mergeLibraryEntryChange(null, before, { caseLayout: true, cases: { new: { id: 'new' } } }), null);
  assert.equal(mergeLibraryEntryChange(null, before, { caseLayout: true, oldValue: before, caseIds: ['a'] }), null);
});

test('a later edit or deletion seen while a save reply is delayed stays newer than that reply', () => {
  const tracker = createLocalCaseEditTracker();
  const original = { id: 'a', text: '旧原词' }, saved = { ...original, text: '我的保存' };
  const token = tracker.begin(original);
  tracker.observe({ caseLayout: true, cases: { a: saved } });
  const newer = { ...saved, title: '另一页面的后续修改' };
  tracker.observe({ caseLayout: true, cases: { a: newer, b: { id: 'b', text: '其他案例' } } });
  assert.equal(tracker.finish(token, saved), newer);
  assert(!tracker.pending);
  const deleting = tracker.begin(newer);
  tracker.observe({ caseLayout: true, cases: { a: saved } });
  tracker.observe({ caseLayout: true, removedCaseIds: ['a'] });
  assert.equal(tracker.finish(deleting, saved), null);
});

test('a save reply before its echo suppresses only the exact saved case and keeps concurrent changes', () => {
  const tracker = createLocalCaseEditTracker();
  const original = { id: 'a', text: '原词' }, saved = { ...original, title: '保存标题' };
  assert.equal(tracker.finish(tracker.begin(original), saved), saved);
  const b = { id: 'b', text: '并发案例' };
  assert.deepEqual(tracker.observe({ caseLayout: true, cases: { a: saved, b } }), { caseLayout: true, cases: { b } });
  assert.deepEqual(tracker.observe({ caseLayout: true, cases: { a: saved } }), { caseLayout: true, cases: { a: saved } });
});

test('failed and unchanged saves never consume another writer notification', () => {
  const tracker = createLocalCaseEditTracker();
  const original = { id: 'a', text: '原词' };
  assert.equal(tracker.finish(tracker.begin(original), null), null);
  assert.equal(tracker.finish(tracker.begin(original), original), original);
  const change = { caseLayout: true, cases: { a: original } };
  assert.equal(tracker.observe(change), change);
  assert(!tracker.pending);
});

test('a no-op save has no echo and never rolls back newer external edits or index-only deletions', () => {
  const tracker = createLocalCaseEditTracker();
  const original = { id: 'a', text: '原词' }, changed = { ...original, title: '别人的新标题' };
  const token = tracker.begin(original);
  tracker.observe({ caseLayout: true, cases: { a: changed } });
  assert.equal(tracker.finish(token, original), changed);
  const removed = tracker.begin(original);
  tracker.observe({ caseLayout: true, caseIds: ['b'] });
  assert.equal(tracker.finish(removed, original), null);
});

test('explicit no-op evidence keeps a later writer even when the rendered baseline predates the stored case', () => {
  const tracker = createLocalCaseEditTracker();
  const a = { id: 'a', title: '页面尚未画出外部编辑' };
  const b = { id: 'a', title: '后台读到的已保存标题' };
  const c = { id: 'a', title: '回复等待期间更新' };
  for (const change of [{ caseLayout: true, cases: { a: c } }, { newValue: [c] }]) {
    const token = tracker.begin(a);
    tracker.observe(change);
    assert.equal(tracker.finish(token, b, { changed: false }), c);
  }
});
