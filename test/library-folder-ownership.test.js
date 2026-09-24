import test from 'node:test';
import assert from 'node:assert/strict';
import { planFolderOwnership, planCaseCopies, needsFolderOwnershipMigration } from '../extension/library-folder-ownership.js';
import { projectPortableMedia } from '../extension/library-portable-media.js';
import { caseSemanticFingerprint, reconcileLibrarySemanticIdentity } from '../extension/library-semantic-identity.js';
import { collectRetainedLocalAssetIds } from '../extension/import-staging.js';

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

test('a compound visible through different members in legacy folders becomes complete independent compositions', () => {
  const source = fixture();
  source.entries.push({ id: 'b', title: '镜头二', text: '第二段', mediaAssets: [] });
  source.compoundCases = [{ id: 'pair', title: '完整组合', memberEntryIds: ['b', 'a'], coverVisualId: 'asset', customLabels: ['组合标签'] }];
  source.organizerState.collections[1].entryIds = ['b'];
  const result = planFolderOwnership(source).state;
  assert.equal(result.compoundCases.length, 2);
  assert.deepEqual(result.compoundCases[0].memberEntryIds, ['b', 'a']);
  assert.equal(result.compoundCases[1].title, '完整组合');
  assert.deepEqual(result.organizerState.collections[0].entryIds, ['b', 'a']);
  assert.deepEqual(result.organizerState.collections[1].entryIds, result.compoundCases[1].memberEntryIds);
  assert.equal(new Set(result.organizerState.collections.flatMap(c => c.entryIds)).size, 4);
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
