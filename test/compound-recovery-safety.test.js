import test from 'node:test';
import assert from 'node:assert/strict';
import { createCompoundCase, updateCompoundCase, splitCompoundCase } from '../extension/compound-cases.js';
import { moveEntriesToTrash, restoreTrashItems } from '../extension/trash.js';

const entries = ['a', 'b', 'c', 'd', 'e'].map(id => ({ id, title: id, text: id,
  mediaAssets: [{ id: `image-${id}`, kind: 'image', usage: 'content', storageMode: 'managed' }] }));
const create = (members, id = 'first', options = {}) => createCompoundCase([], entries,
  { id, title: '原组合', memberEntryIds: members, now: '2026-10-05T00:00:00Z', ...options }).compoundCases[0];
const state = compounds => ({ entries: structuredClone(entries), compoundCases: compounds, organizerState: { collections: [] } });

test('a stale combination update never takes another combination member or loses its title and labels', () => {
  const first = create(['a', 'b']), second = create(['c', 'd'], 'second', { title: '后建组合', customLabels: ['人工标签'] });
  for (const compounds of [[first, second], [second, first]]) {
    const before = structuredClone(compounds);
    assert.throws(() => updateCompoundCase(compounds, entries, first.id, { memberEntryIds: ['a', 'b', 'c'] }), /其他组合|另一个组合/);
    assert.deepEqual(compounds, before);
    assert.throws(() => updateCompoundCase(compounds, entries, first.id, { memberEntryIds: ['c'] }), /其他组合|另一个组合/);
    assert.deepEqual(compounds, before);
  }
});

test('a missing stale member is rejected before normalizing an update or silently splitting', () => {
  const first = create(['a', 'b']);
  for (const members of [['a', 'missing'], ['missing']]) {
    assert.throws(() => updateCompoundCase([first], entries, first.id, { memberEntryIds: members }), /不存在/);
  }
  assert.equal(updateCompoundCase([first], entries, first.id, { memberEntryIds: ['a'] }).split, true);
});

test('restoring a deleted member preserves later manual combination name, tags, cover and added member', () => {
  const moved = moveEntriesToTrash(state([create(['a', 'b', 'c'])]), ['c']);
  moved.compoundCases = updateCompoundCase(moved.compoundCases, moved.entries, 'first', {
    title: '删除后人工改名', customLabels: ['新标签'], memberEntryIds: ['a', 'b', 'd'], coverVisualId: 'image-d'
  }).compoundCases;
  const restored = restoreTrashItems(moved, moved.movedItemIds);
  const compound = restored.compoundCases[0];
  assert.equal(compound.title, '删除后人工改名');
  assert.deepEqual(compound.customLabels, ['新标签']);
  assert.equal(compound.coverVisualId, 'image-d');
  assert.deepEqual(compound.memberEntryIds, ['a', 'b', 'd', 'c']);
  assert.deepEqual(restored.unresolved, []);
  assert.deepEqual(restored.warnings, []);
});

test('unchanged combinations recover a middle member and original cover without deleting source cases', () => {
  const original = create(['a', 'b', 'c'], 'first', { coverVisualId: 'image-b', customLabels: ['原标签'] });
  const moved = moveEntriesToTrash(state([original]), ['b']);
  const restored = restoreTrashItems(moved, moved.movedItemIds);
  assert.deepEqual(restored.compoundCases[0].memberEntryIds, ['a', 'b', 'c']);
  assert.equal(restored.compoundCases[0].coverVisualId, 'image-b');
  assert.equal(restored.entries.length, entries.length);
});

test('restoring a member does not re-add an active member that a user removed after deletion', () => {
  const moved = moveEntriesToTrash(state([create(['a', 'b', 'c', 'd'])]), ['c']);
  moved.compoundCases = updateCompoundCase(moved.compoundCases, moved.entries, 'first', { memberEntryIds: ['a', 'd', 'e'] }).compoundCases;
  const restored = restoreTrashItems(moved, moved.movedItemIds);
  assert.deepEqual(restored.compoundCases[0].memberEntryIds, ['a', 'c', 'd', 'e']);
});

test('restoring a member of a combination split by the user restores the case and reports the relation conflict', () => {
  const moved = moveEntriesToTrash(state([create(['a', 'b', 'c'])]), ['c']);
  moved.compoundCases = splitCompoundCase(moved.compoundCases, moved.entries, 'first').compoundCases;
  const restored = restoreTrashItems(moved, moved.movedItemIds);
  assert.deepEqual(restored.compoundCases, []);
  assert.ok(restored.entries.some(entry => entry.id === 'c'));
  assert.equal(restored.warnings[0].code, 'COMPOUND_RESTORE_CONFLICT');
  assert.deepEqual(restored.unresolved, []);
});

test('restoring a disappeared combination never takes original members from another current combination', () => {
  const moved = moveEntriesToTrash(state([create(['a', 'c'])]), ['c']);
  const second = createCompoundCase(moved.compoundCases, moved.entries, { id: 'second', title: '人工新组合', memberEntryIds: ['a', 'd'], customLabels: ['保留'] }).compoundCase;
  moved.compoundCases = [second];
  const restored = restoreTrashItems(moved, moved.movedItemIds);
  assert.deepEqual(restored.compoundCases, [second]);
  assert.ok(restored.entries.some(entry => entry.id === 'c'));
  assert.equal(restored.warnings[0].code, 'COMPOUND_RESTORE_CONFLICT');
  assert.deepEqual(restored.warnings[0].memberEntryIds, ['a']);
});

test('sequential deletion snapshots recover all selected members while retaining the latest manual metadata', () => {
  let moved = moveEntriesToTrash(state([create(['a', 'b', 'c', 'd'])]), ['c'], { deletedAt: '2026-10-05T00:01:00Z' });
  moved.compoundCases = updateCompoundCase(moved.compoundCases, moved.entries, 'first', { title: '两次删除之间的编辑', customLabels: ['新标签'] }).compoundCases;
  moved = moveEntriesToTrash(moved, ['d'], { deletedAt: '2026-10-05T00:02:00Z' });
  const restored = restoreTrashItems(moved, moved.trashState.items.map(item => item.id));
  assert.deepEqual(new Set(restored.compoundCases[0].memberEntryIds), new Set(['a', 'b', 'c', 'd']));
  assert.equal(restored.compoundCases[0].title, '两次删除之间的编辑');
  assert.deepEqual(restored.compoundCases[0].customLabels, ['新标签']);
});

test('legacy trash snapshots without a delete-state baseline can safely add restored members without rolling back edits', () => {
  const moved = moveEntriesToTrash(state([create(['a', 'b', 'c'])]), ['c']);
  for (const item of moved.trashState.items) delete item.relationships.compoundCasesAfterDelete;
  moved.compoundCases = updateCompoundCase(moved.compoundCases, moved.entries, 'first', { title: '保留当前', memberEntryIds: ['a', 'b', 'd'] }).compoundCases;
  const restored = restoreTrashItems(moved, moved.movedItemIds);
  assert.equal(restored.compoundCases[0].title, '保留当前');
  assert.deepEqual(restored.compoundCases[0].memberEntryIds, ['a', 'b', 'd', 'c']);
});

test('a legacy snapshot cannot recreate a user-split group that should have survived deletion', () => {
  const moved = moveEntriesToTrash(state([create(['a', 'b', 'c'])]), ['c']);
  for (const item of moved.trashState.items) delete item.relationships.compoundCasesAfterDelete;
  moved.compoundCases = [];
  const restored = restoreTrashItems(moved, moved.movedItemIds);
  assert.deepEqual(restored.compoundCases, []);
  assert.ok(restored.entries.some(entry => entry.id === 'c'));
  assert.equal(restored.warnings[0].code, 'COMPOUND_RESTORE_CONFLICT');
});

test('restoring members separately retains an incomplete relation until its missing originals return', () => {
  let moved = moveEntriesToTrash(state([create(['a', 'b', 'c'])]), ['a'], { deletedAt: '2026-10-05T00:01:00Z' });
  moved = moveEntriesToTrash(moved, ['b'], { deletedAt: '2026-10-05T00:02:00Z' });
  moved = moveEntriesToTrash(moved, ['c'], { deletedAt: '2026-10-05T00:03:00Z' });
  const first = restoreTrashItems(moved, ['trash:entry:a']);
  assert.ok(first.entries.some(entry => entry.id === 'a'));
  assert.deepEqual(first.compoundCases, []);
  assert.equal(first.warnings[0].code, 'COMPOUND_RESTORE_CONFLICT');
  const second = restoreTrashItems(first, ['trash:entry:b']);
  assert.deepEqual(second.compoundCases[0].memberEntryIds, ['a', 'b']);
  const third = restoreTrashItems(second, ['trash:entry:c']);
  assert.deepEqual(third.compoundCases[0].memberEntryIds, ['a', 'b', 'c']);
  assert.equal(third.compoundCases[0].title, '原组合');
  assert.deepEqual(third.trashState.items, []);
});

test('a recovered duplicate case already in another combination cannot displace either current group', () => {
  const moved = moveEntriesToTrash(state([create(['a', 'b', 'c'])]), ['c']);
  moved.entries.push(structuredClone(moved.trashState.items[0].snapshot));
  moved.compoundCases = [...moved.compoundCases, create(['c', 'd'], 'second', { title: '保留新归属' })];
  const before = structuredClone(moved.compoundCases);
  const restored = restoreTrashItems(moved, moved.movedItemIds);
  assert.deepEqual(restored.compoundCases, before);
  assert.equal(restored.warnings[0].code, 'COMPOUND_RESTORE_CONFLICT');
  assert.deepEqual(restored.warnings[0].memberEntryIds, ['c']);
});
