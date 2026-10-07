import test from 'node:test';
import assert from 'node:assert/strict';
import { planFolderOwnership, planCaseCopies, needsFolderOwnershipMigration } from '../extension/library-folder-ownership.js';
import { projectPortableMedia } from '../extension/library-portable-media.js';
import { caseSemanticFingerprint, reconcileLibrarySemanticIdentity } from '../extension/library-semantic-identity.js';
import { collectRetainedLocalAssetIds } from '../extension/import-staging.js';
import { expandLogicalCaseIds } from '../extension/compound-cases.js';
import { moveEntriesBetweenCollections } from '../extension/organizer.js';

function fixture() {
  return { entries: [{ id: 'a', title: '人工标题', text: '正文', customLabels: ['人工标签'],
    mediaAssets: [{ id: 'asset', kind: 'image', storageMode: 'managed', assetPath: 'images/a.png', contentHash: 'a'.repeat(64) }],
    primaryMediaId: 'asset', articleDocument: { blocks: [{ type: 'image', assetId: 'asset' }] } }],
    organizerState: { collections: [
      { id: 'p', name: 'P', entryIds: ['a'] }, { id: 'q', name: 'Q', entryIds: ['a'] }
    ] }, compoundCases: [], composerSessions: [{ referenceSnapshots: [{ entryId: 'a', assetRefs: [{ assetId: 'asset' }] }] }],
    trashState: { items: [] } };
}

test('legacy multi-folder cases retain every location and original references; conversion is idempotent', () => {
  const source = fixture(), before = structuredClone(source);
  const result = planFolderOwnership(source);
  assert.deepEqual(source, before);
  assert.equal(result.copies.length, 1);
  assert.equal(result.state.entries.length, 2);
  const copy = result.state.entries[1];
  assert.deepEqual(result.state.organizerState.collections.map(c => c.entryIds), [['a'], [copy.id]]);
  assert.equal(copy.text, source.entries[0].text);
  assert.deepEqual(result.state.composerSessions, source.composerSessions);
  assert.equal(needsFolderOwnershipMigration(result.state), false);
  assert.deepEqual(planFolderOwnership(result.state).state, result.state);
  copy.customLabels.push('副本新标签');
  copy.articleDocument.blocks[0].assetId = 'changed';
  assert.deepEqual(result.state.entries[0].customLabels, ['人工标签']);
  assert.equal(result.state.entries[0].articleDocument.blocks[0].assetId, 'asset');
});

test('a compound spanning members with separate project owners is already valid and never triggers implicit copies', () => {
  const source = fixture();
  source.entries.push({ id: 'b', title: '镜头二', text: '第二段', mediaAssets: [] });
  source.compoundCases = [{ id: 'pair', title: '完整组合', memberEntryIds: ['b', 'a'], coverVisualId: 'asset', customLabels: ['组合标签'] }];
  source.organizerState.collections[1].entryIds = ['b'];
  assert.equal(needsFolderOwnershipMigration(source), false);
  const result = planFolderOwnership(source);
  assert.equal(result.changed, false);
  assert.deepEqual(result.state, source);
});

test('a truly shared legacy member still migrates without converting unrelated cross-project compositions', () => {
  const source = fixture();
  source.entries.push({id:'b',text:'成员B',mediaAssets:[]},{id:'shared',text:'旧多项目资料',mediaAssets:[]});
  source.compoundCases=[{id:'pair',title:'跨项目组合',memberEntryIds:['a','b']}];
  source.organizerState.collections[0].entryIds=['a','shared'];
  source.organizerState.collections[1].entryIds=['b','shared'];
  assert.equal(needsFolderOwnershipMigration(source),true);
  const result=planFolderOwnership(source);
  assert.equal(result.copies.length,1);assert.equal(result.copies[0].sourceCaseId,'shared');
  assert.deepEqual(result.state.compoundCases,source.compoundCases);
  assert.deepEqual(result.state.organizerState.collections.map(c=>c.entryIds[0]),['a','b']);
  assert.equal(needsFolderOwnershipMigration(result.state),false);
});

test('a legacy compound whose physical member is genuinely shared retains its established copy conversion', () => {
  const source=fixture();source.entries.push({id:'b',text:'另一成员',mediaAssets:[]});
  source.compoundCases=[{id:'pair',title:'旧组合',memberEntryIds:['a','b']}];
  source.organizerState.collections[1].entryIds.push('b');
  const result=planFolderOwnership(source);
  assert.equal(result.copies.length,1);assert.equal(result.state.compoundCases.length,2);
  assert.deepEqual(result.state.compoundCases[0].memberEntryIds,['a','b']);
  assert.equal(needsFolderOwnershipMigration(result.state),false);
});

test('explicit copies in the same folder stay independent after content reconciliation and project-free sharing', () => {
  const state = fixture(); state.organizerState.collections[1].entryIds = [];
  const result = planCaseCopies(state, ['a'], 'p', { idFactory: () => 'copy' });
  assert.equal(result.state.entries.length, 2);
  assert.notEqual(caseSemanticFingerprint(result.state.entries[0]), caseSemanticFingerprint(result.state.entries[1]));
  result.state.organizerState.collections = [];
  assert.equal(reconcileLibrarySemanticIdentity(result.state).state.entries.length, 2);
  const copy = result.state.entries.find(e => e.id === 'copy');
  result.state.entries = [copy];
  assert.ok(collectRetainedLocalAssetIds(result.state).has('asset'), 'deleting the original must not release the copy media');
});

test('explicitly copying or moving a cross-project group still includes every member and preserves original media', () => {
  const source = fixture();
  source.entries.push({ id: 'b', text: '第二成员原词', mediaAssets: [] });
  source.compoundCases = [{ id: 'pair', title: '跨项目组合', memberEntryIds: ['a', 'b'] }];
  source.organizerState.collections[1].entryIds = ['b'];
  const before = structuredClone(source);
  const memberIds = expandLogicalCaseIds(['pair'], source.compoundCases);
  let serial = 0;
  const copied = planCaseCopies(source, memberIds, 'q', { idFactory: () => `copy-${++serial}` });
  assert.deepEqual(source, before);
  assert.equal(copied.copies.length, 1);
  assert.equal(copied.state.entries.length, 4);
  const group = copied.state.compoundCases[1];
  assert.equal(group.memberEntryIds.length, 2);
  group.memberEntryIds.forEach((id, index) => {
    const copy = copied.state.entries.find(entry => entry.id === id);
    assert.equal(copy.text, source.entries[index].text);
    assert.deepEqual(copy.mediaAssets, source.entries[index].mediaAssets);
  });
  assert.deepEqual(copied.state.organizerState.collections.map(c => c.entryIds), [['a'], ['b', ...group.memberEntryIds]]);
  assert.equal(needsFolderOwnershipMigration(copied.state), false);
  const moved = moveEntriesBetweenCollections(source.organizerState, null, 'q', memberIds);
  assert.deepEqual(moved.collections[0].entryIds, []);
  assert.deepEqual(new Set(moved.collections[1].entryIds), new Set(['a', 'b']));
  assert.deepEqual(source, before);
  assert.equal(needsFolderOwnershipMigration({ ...source, organizerState: moved }), false);
});

test('invalid members or identity collisions abort the entire plan without changing the source', () => {
  const source = fixture(), before = structuredClone(source);
  assert.throws(() => planCaseCopies(source, ['a', 'missing'], 'p'));
  assert.throws(() => planCaseCopies(source, ['a'], 'p', { idFactory: () => 'a' }));
  assert.deepEqual(source, before);
  source.compoundCases = [{ id: 'bad', memberEntryIds: ['a', 'missing'] }];
  assert.throws(() => planFolderOwnership(source));
});

test('portable copies get unique media ids while paths, bytes and original state stay untouched', () => {
  const source = planFolderOwnership(fixture()).state;
  const copy = source.entries[1];
  source.compoundCases = [{ id: 'copy-group', memberEntryIds: [copy.id], coverVisualId: 'asset' }];
  source.composerSessions.push({ referenceSnapshots: [{ entryId: copy.id, referenceId: `${copy.id}:asset`, assetRefs: [{ assetId: 'asset' }] }] });
  const before = structuredClone(source);
  const exported = projectPortableMedia(source);
  const assetId = exported.entries[1].mediaAssets[0].id;
  assert.notEqual(assetId, 'asset');
  assert.equal(exported.entries[1].primaryMediaId, assetId);
  assert.equal(exported.entries[1].articleDocument.blocks[0].assetId, assetId);
  assert.equal(exported.compoundCases[0].coverVisualId, assetId);
  assert.equal(exported.composerSessions[1].referenceSnapshots[0].assetRefs[0].assetId, assetId);
  assert.equal(exported.entries[1].mediaAssets[0].assetPath, source.entries[1].mediaAssets[0].assetPath);
  assert.deepEqual(source, before);
  assert.deepEqual(projectPortableMedia(exported), exported);
});

test('selection sharing retains separately selected equivalent cases after private folders are omitted', async () => {
  const { selectLibraryPackage, mergeLibraryPackage, parseLibraryPackage } = await import('../extension/library-package.js');
  const { renderLibraryJson } = await import('../extension/lib.js');
  const state = parseLibraryPackage(JSON.parse(renderLibraryJson([
    { id: 'a', title: '相同', text: '相同正文', mediaAssets: [] },
    { id: 'b', title: '相同', text: '相同正文', mediaAssets: [] }
  ])));
  const share = selectLibraryPackage(state, ['a', 'b']);
  assert.equal(share.organizerState.collections.length, 0);
  assert.notEqual(share.entries[0].caseInstanceId, share.entries[1].caseInstanceId);
  const imported = mergeLibraryPackage({ entries: [] }, share).state;
  assert.equal(imported.entries.length, 2);
  assert.equal(mergeLibraryPackage(imported, share).state.entries.length, 2);
  assert.equal(mergeLibraryPackage(state, share).state.entries.length, 2, 'exporting then importing into the source library must not multiply cases');
});

test('a deleted shared media item has its own portable id and can be restored without colliding with the live copy', () => {
  const source = fixture();
  source.trashState.items = [{ id: 'trash:media:b:asset', kind: 'media', targetId: 'asset',
    snapshot: { mediaAssets: structuredClone(source.entries[0].mediaAssets) },
    relationships: { entryId: 'b', positions: [{ assetId: 'asset', index: 0 }], primaryMediaId: 'asset' } }];
  const projected = projectPortableMedia(source);
  const item = projected.trashState.items[0];
  const id = item.snapshot.mediaAssets[0].id;
  assert.notEqual(id, 'asset');
  assert.equal(item.targetId, id);
  assert.equal(item.relationships.positions[0].assetId, id);
  assert.equal(item.relationships.primaryMediaId, id);
  assert.equal(source.trashState.items[0].targetId, 'asset');
});

test('migration keeps a pre-existing case whose id happens to match the planned copy id', () => {
  const source = fixture();
  source.entries.push({ id: 'folder-copy:a:q', title: '已有的另一个案例', text: '必须保留', mediaAssets: [] });
  const result = planFolderOwnership(source).state;
  assert.equal(result.entries.length, 3);
  assert.equal(result.entries.find(entry => entry.id==='folder-copy:a:q').text, '必须保留');
  assert.notEqual(result.organizerState.collections[1].entryIds[0], 'folder-copy:a:q');
  assert.deepEqual(planFolderOwnership(result).state, result);
});
