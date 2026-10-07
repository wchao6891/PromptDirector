import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { normalizeTrashState } from '../extension/trash.js';
import { planTrashCleanup, retainedTrashCleanupAssets, TRASH_HISTORY_KEYS, TRASH_CLEANUP_KEY } from '../extension/trash-cleanup.js';

const source = readFileSync(new URL('../extension/background.js', import.meta.url), 'utf8');
const actions = source.slice(source.indexOf('async function permanentlyDeleteTrashItems('), source.indexOf('\nfunction enqueue('));
const item = (id, assets) => ({ id: `trash:entry:${id}`, kind: 'entry', targetId: id,
  deletedAt: '2026-10-05T00:00:00Z', snapshot: { id, mediaAssets: assets.map(id => ({ id, kind: 'image', storageMode: 'managed' })) } });

function fixture(state, options = {}) {
  const deleted = [];
  const context = vm.createContext({ normalizeTrashState, planTrashCleanup, retainedTrashCleanupAssets, TRASH_HISTORY_KEYS, TRASH_CLEANUP_KEY,
    Set, structuredClone, console: { warn() {} }, activeCaptureAssetIds: new Set(), agentTransfers: { retainedIds: async () => options.activeIds ?? [] },
    stagedMedia: { retainedIds: async () => [] },
    STORAGE_KEYS: Object.fromEntries(['trashState'].map(key => [key, key])),
    readState: async () => structuredClone(state),
    commitLocalChanges: async update => { if (options.commitFails) throw new Error('metadata failure'); Object.assign(state, structuredClone(update)); },
    libraryStorage: {
      get: async keys => Object.fromEntries((Array.isArray(keys) ? keys : [keys]).filter(key => key in state).map(key => [key, structuredClone(state[key])])),
      remove: async key => { delete state[key]; }
    },
    deleteMediaBlobs: async ids => { if (options.deleteFails) throw new Error('disk failure'); deleted.push(...ids); }, deleteLocalAssetHandle: async () => {},
    screenshotStorageKey: id => `screenshot:${id}`, LOCAL_ASSET_REFERENCE_RECORD_TYPE: 'local-asset-reference'
  });
  vm.runInContext(actions, context);
  return { state, deleted, context };
}

test('empty trash physically removes exclusive originals instead of protecting its own snapshots', async () => {
  const f = fixture({ entries: [], trashState: { items: [item('gone', ['exclusive'])] } });
  assert.equal((await f.context.emptyTrashAction()).ok, true);
  assert.deepEqual(f.deleted, ['exclusive']);
  assert.equal(f.state.trashState.items.length, 0);
});

test('permanent deletion preserves originals shared by live cases or remaining trash', async () => {
  const f = fixture({ entries: [{ id: 'live', mediaAssets: [{ id: 'shared-live' }] }],
    trashState: { items: [item('gone', ['exclusive', 'shared-live', 'shared-trash']), item('waiting', ['shared-trash'])] } });
  assert.equal((await f.context.permanentlyDeleteTrashItems({ itemIds: ['trash:entry:gone'] })).ok, true);
  assert.deepEqual(f.deleted, ['exclusive']);
  assert.equal(f.state.trashState.items.length, 1);
});

test('permanent deletion removes only the selected case from internal backups and undo', async () => {
  const gone = item('gone', ['exclusive']).snapshot;
  const kept = item('old-kept', ['old-kept-original']).snapshot;
  const snapshot = { entries: [{ ...gone, mediaAssets: [{ id: 'older-exclusive' }] }, kept],
    organizerState: { collections: [{ id: 'p', entryIds: ['gone', 'old-kept'] }] }, trashState: { items: [item('gone', ['old-trash'])] } };
  const f = fixture({ entries: [], trashState: { items: [item('gone', ['exclusive'])] },
    folderOwnershipBackup: { state: snapshot }, migrationBackup: snapshot,
    libraryReplacementRecoveryPoint: { state: snapshot, retainedAssetIds: ['exclusive', 'older-exclusive', 'old-trash', 'old-kept-original'] },
    facetUndo: { version: 4, steps: [{ entries: [{ id: 'gone', changes: 'private content' }, { id: 'old-kept' }] }] },
    lastSaveUndo: { entryId: 'gone', backupEntryId: 'backup:gone' },
    visionAnalysisUndo: { gone: { old: true }, 'old-kept': {} },
    analysisBatchUndo: { entries: [{ entryId: 'gone' }, { entryId: 'old-kept' }], appliedEntries: [{ entryId: 'gone' }] }
  });
  assert.equal((await f.context.emptyTrashAction()).ok, true);
  assert.deepEqual(f.deleted.sort(), ['exclusive', 'older-exclusive', 'old-trash', 'backup:gone'].sort());
  for (const key of ['folderOwnershipBackup', 'libraryReplacementRecoveryPoint', 'migrationBackup']) {
    const snapshot = f.state[key].state ?? f.state[key];
    assert.deepEqual(snapshot.entries, [kept]);
    assert.deepEqual(snapshot.organizerState.collections[0].entryIds, ['old-kept']);
    assert.equal(snapshot.trashState.items.length, 0);
  }
  assert.deepEqual(f.state.libraryReplacementRecoveryPoint.retainedAssetIds, ['old-kept-original']);
  assert.equal(f.state.lastSaveUndo, null);
  assert.deepEqual(f.state.facetUndo.steps[0].entries, [{ id: 'old-kept' }]);
  assert.deepEqual(f.state.visionAnalysisUndo, { 'old-kept': {} });
  assert.deepEqual(f.state.analysisBatchUndo.entries, [{ entryId: 'old-kept' }]);
});

test('deleting one media prunes its historical versions while retaining the case and shared originals', async () => {
  const media = { id: 'trash:media:one:video', kind: 'media', targetId: 'video', deletedAt: '2026-10-05T00:00:00Z',
    snapshot: { mediaAssets: [{ id: 'video', kind: 'video' }, { id: 'poster', kind: 'image', usage: 'poster', derivedFromAssetId: 'video' }] },
    relationships: { entryId: 'one' } };
  const f = fixture({ entries: [{ id: 'one', mediaAssets: [{ id: 'other' }] }, { id: 'copy', mediaAssets: [{ id: 'video' }] }],
    trashState: { items: [media] }, folderOwnershipBackup: { state: { entries: [{ id: 'one', title: 'keep text', mediaAssets: [...media.snapshot.mediaAssets, { id: 'other', kind: 'image' }] }] } } });
  await f.context.emptyTrashAction();
  assert.deepEqual(f.deleted, ['poster']);
  assert.equal(f.state.folderOwnershipBackup.state.entries[0].title, 'keep text');
  assert.deepEqual(f.state.folderOwnershipBackup.state.entries[0].mediaAssets.map(asset => asset.id), ['other']);
});

test('a failed metadata write does not delete any file or change the recycle bin', async () => {
  const f = fixture({ entries: [], trashState: { items: [item('gone', ['exclusive'])] } }, { commitFails: true });
  await assert.rejects(f.context.emptyTrashAction(), /metadata failure/);
  assert.equal(f.state.trashState.items.length, 1);
  assert.deepEqual(f.deleted, []);
});

test('file deletion failure persists only IDs and retries after restart without restoring deleted content', async () => {
  const f = fixture({ entries: [], trashState: { items: [item('gone', ['exclusive'])] } }, { deleteFails: true });
  const response = await f.context.emptyTrashAction();
  assert.equal(response.ok, false);
  assert.equal(f.state.trashState.items.length, 0);
  assert.deepEqual(f.state.pendingTrashCleanup, { mediaIds: ['exclusive'], localReferenceIds: [], screenshotEntryIds: ['gone'] });
  const restarted = fixture(structuredClone(f.state));
  assert.equal((await restarted.context.resumeTrashCleanup()).ok, true);
  assert.deepEqual(restarted.deleted, ['exclusive']);
  assert.equal(restarted.state.pendingTrashCleanup, undefined);
});

test('retry rechecks new references, including in-progress work, before deleting originals', async () => {
  const f = fixture({ entries: [{ id: 'new', mediaAssets: [{ id: 'reused' }] }],
    pendingTrashCleanup: { mediaIds: ['reused', 'working', 'exclusive'], localReferenceIds: [], screenshotEntryIds: [] } }, { activeIds: ['working'] });
  assert.equal((await f.context.resumeTrashCleanup()).ok, true);
  assert.deepEqual(f.deleted, ['exclusive']);
});

test('a historical copy belonging to another case remains recoverable and does not lose its shared file', async () => {
  const state = { entries: [], trashState: { items: [item('gone', ['shared'])] },
    folderOwnershipBackup: { state: { entries: [item('gone', ['shared']).snapshot, item('other', ['shared']).snapshot] } } };
  const before = structuredClone(state);
  const plan = planTrashCleanup(state, ['trash:entry:gone']);
  assert.deepEqual(state, before);
  assert.deepEqual(plan.cleanup.mediaIds, []);
  assert.deepEqual(plan.changes.folderOwnershipBackup.state.entries, [item('other', ['shared']).snapshot]);
});

test('permanent deletion prunes the pre-split case copy without deleting another historical case shared original', async () => {
  const kept = item('other', ['shared']).snapshot;
  const f = fixture({ entries: [], trashState: { items: [item('gone', ['shared', 'current-only'])] },
    legacyEntries: [item('gone', ['shared', 'old-only']).snapshot, kept] });
  await f.context.emptyTrashAction();
  assert.deepEqual(f.state.legacyEntries, [kept], 'permanent deletion must also remove the pre-split recovery copy');
  assert.deepEqual(f.deleted.sort(), ['current-only', 'old-only']);
  assert.ok(TRASH_HISTORY_KEYS.includes('legacyEntries'), 'the background must load this recovery copy before deleting originals');
});

test('retrying cleanup protects originals still referenced by the pre-split recovery copy', async () => {
  const f = fixture({ entries: [], legacyEntries: [item('other', ['shared']).snapshot],
    pendingTrashCleanup: { mediaIds: ['shared', 'exclusive'], localReferenceIds: [], screenshotEntryIds: [] } });
  await f.context.resumeTrashCleanup();
  assert.deepEqual(f.deleted, ['exclusive']);
});

test('permanently deleting a case also purges its separately trashed media and stale project membership', () => {
  const state = { entries: [], trashState: { items: [item('gone', ['original']),
    { id: 'trash:media:gone:video', kind: 'media', targetId: 'video', deletedAt: '2026-10-05T00:00:00Z',
      snapshot: { mediaAssets: [{ id: 'video', kind: 'video' }] }, relationships: { entryId: 'gone' } },
    { id: 'trash:collection:p', kind: 'collection', targetId: 'p', deletedAt: '2026-10-05T00:00:00Z',
      snapshot: { id: 'p', name: 'Project', entryIds: ['gone', 'other'] } }
  ] } };
  const plan = planTrashCleanup(state, ['trash:entry:gone']);
  assert.deepEqual(plan.cleanup.mediaIds.sort(), ['original', 'video']);
  assert.equal(plan.trashState.items.length, 1);
  assert.deepEqual(plan.trashState.items[0].snapshot.entryIds, ['other']);
});

test('permanent cleanup removes local link handles without requesting deletion of external source files', () => {
  const linked = item('gone', ['linked']);
  linked.snapshot.mediaAssets[0] = { id: 'linked', storageMode: 'reference', recordType: 'local-asset-reference' };
  const plan = planTrashCleanup({ entries: [], trashState: { items: [linked] } }, [linked.id]);
  assert.deepEqual(plan.cleanup.localReferenceIds, ['linked']);
  assert.ok(!('path' in plan.cleanup));
});
