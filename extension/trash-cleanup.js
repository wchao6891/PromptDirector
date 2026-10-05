import { libraryStoredAssets, libraryStoredAssetIds } from './library-asset-inventory.js';
import { normalizeTrashState, takeTrashItems } from './trash.js';
import { removeEntryMedia } from './media.js';
import { LOCAL_ASSET_REFERENCE_RECORD_TYPE } from './local-media.js';
import { removeEntriesFromCompoundCases } from './compound-cases.js';

// Local recovery snapshots are not a second recycle bin after permanent deletion.
const SNAPSHOT_KEYS = ['folderOwnershipBackup', 'libraryReplacementRecoveryPoint',
  'migrationBackup', 'classificationResetBackup', 'creativeFacetMigrationBackupV5'];
export const TRASH_HISTORY_KEYS = [...SNAPSHOT_KEYS,
  'facetUndo', 'visionAnalysisUndo', 'analysisBatchUndo', 'lastSaveUndo'];
export const TRASH_CLEANUP_KEY = 'pendingTrashCleanup';

export function planTrashCleanup(state, itemIds, extraRetainedIds = []) {
  const items = normalizeTrashState(state.trashState).items;
  const requested = new Set(itemIds);
  const deletedEntries = new Set(items.filter(item => requested.has(item.id) && item.kind === 'entry').map(item => item.targetId));
  // A media item belonging to a permanently deleted case cannot be restored alone.
  for (const item of items) if (item.kind === 'media' && deletedEntries.has(item.relationships?.entryId)) requested.add(item.id);
  const taken = takeTrashItems(state.trashState, [...requested]);
  const deletedCollections = new Set(taken.cleanup.collectionIds);
  const mediaByEntry = new Map();
  for (const item of taken.takenItems.filter(item => item.kind === 'media')) {
    const ids = mediaByEntry.get(item.relationships?.entryId) ?? new Set();
    for (const asset of assets(item.snapshot)) ids.add(asset.id);
    mediaByEntry.set(item.relationships?.entryId, ids);
  }
  const affectedEntries = new Set([...deletedEntries, ...mediaByEntry.keys()]);
  const candidateAssets = taken.takenItems.flatMap(item => assets(item.snapshot));
  const candidates = new Set(candidateAssets.map(asset => asset.id));
  const localReferences = new Set(candidateAssets.filter(asset => asset.recordType === LOCAL_ASSET_REFERENCE_RECORD_TYPE).map(asset => asset.id));
  const changes = { trashState: taken.trashState };

  function pruneEntry(entry) {
    if (deletedEntries.has(entry.id)) return null;
    let result = entry;
    for (const id of mediaByEntry.get(entry.id) ?? []) {
      result = removeEntryMedia(result, id);
      result.facetAssignments = (result.facetAssignments ?? []).filter(item => item.visualId !== id);
    }
    return result;
  }
  function pruneRelationships(value = {}) {
    const result = { ...value };
    for (const key of ['compoundCases', 'compoundCasesAfterDelete']) {
      if (result[key]) result[key] = result[key].filter(item => !mentions(item, deletedEntries));
    }
    if (result.collections) result.collections = result.collections.filter(item => !deletedCollections.has(item.id));
    return result;
  }
  function pruneSnapshot(snapshot) {
    const result = { ...snapshot };
    if (Array.isArray(snapshot.entries)) result.entries = snapshot.entries.map(pruneEntry).filter(Boolean);
    if (snapshot.trashState) result.trashState = { ...snapshot.trashState, items: normalizeTrashState(snapshot.trashState).items.flatMap(item => {
      if (deletedEntries.has(item.kind === 'entry' ? item.targetId : item.relationships?.entryId) ||
          item.kind === 'collection' && deletedCollections.has(item.targetId)) return [];
      if (item.kind === 'media' && mediaByEntry.get(item.relationships?.entryId)?.has(item.targetId)) return [];
      const itemSnapshot = item.kind === 'entry' ? pruneEntry(item.snapshot) : item.kind === 'collection'
        ? { ...item.snapshot, entryIds: (item.snapshot.entryIds ?? []).filter(id => !deletedEntries.has(id)) } : item.snapshot;
      return [{ ...item, snapshot: itemSnapshot, relationships: pruneRelationships(item.relationships) }];
    }) };
    if (snapshot.organizerState?.collections) result.organizerState = { ...snapshot.organizerState,
      collections: snapshot.organizerState.collections.filter(item => !deletedCollections.has(item.id)).map(item => ({ ...item,
        entryIds: (item.entryIds ?? []).filter(id => !deletedEntries.has(id)),
        ...(deletedCollections.has(item.parentId) ? { parentId: null } : {}) })) };
    if (snapshot.compoundCases?.some(item => item.memberEntryIds?.some(id => deletedEntries.has(id)))) {
      result.compoundCases = removeEntriesFromCompoundCases(snapshot.compoundCases, snapshot.entries ?? [], [...deletedEntries]);
    }
    return result;
  }

  taken.trashState = pruneSnapshot({ trashState: taken.trashState }).trashState;
  changes.trashState = taken.trashState;

  for (const key of SNAPSHOT_KEYS) {
    const value = state[key];
    if (!value || typeof value !== 'object') continue;
    const before = value.state ?? value;
    const after = pruneSnapshot(before);
    const kept = libraryStoredAssetIds(after);
    for (const asset of libraryStoredAssets(before)) if (!kept.has(asset.id)) {
      candidates.add(asset.id);
      if (asset.recordType === LOCAL_ASSET_REFERENCE_RECORD_TYPE) localReferences.add(asset.id);
    }
    changes[key] = value.state ? { ...value, state: after } : after;
  }
  const recovery = changes.libraryReplacementRecoveryPoint;
  if (recovery) recovery.retainedAssetIds = (recovery.retainedAssetIds ?? []).filter(id => !candidates.has(id));

  const deletedReferences = new Set([...deletedEntries, ...candidates]);
  if (state.facetUndo?.steps) changes.facetUndo = { ...state.facetUndo, steps: state.facetUndo.steps.map(step => ({ ...step,
    entries: (step.entries ?? []).filter(item => !affectedEntries.has(item.id)),
    ...(step.entryOrder ? { entryOrder: step.entryOrder.filter(id => !deletedEntries.has(id)) } : {}),
    ...(step.compounds ? { compounds: step.compounds.filter(item => !mentions(item, deletedReferences)) } : {}) })) };
  if (state.visionAnalysisUndo) changes.visionAnalysisUndo = Object.fromEntries(Object.entries(state.visionAnalysisUndo)
    .filter(([id]) => !affectedEntries.has(id)));
  if (state.analysisBatchUndo) changes.analysisBatchUndo = { ...state.analysisBatchUndo,
    entries: (state.analysisBatchUndo.entries ?? []).filter(item => !affectedEntries.has(item.entryId)),
    appliedEntries: (state.analysisBatchUndo.appliedEntries ?? []).filter(item => !affectedEntries.has(item.entryId)) };
  if (affectedEntries.has(state.lastSaveUndo?.entryId)) {
    if (state.lastSaveUndo.backupEntryId) candidates.add(state.lastSaveUndo.backupEntryId);
    changes.lastSaveUndo = null;
  }

  const after = { ...state, ...changes };
  const retained = retainedTrashCleanupAssets(after, extraRetainedIds);
  const cleanup = { mediaIds: [...candidates].filter(id => id && !retained.has(id)),
    localReferenceIds: [...localReferences].filter(id => !retained.has(id)),
    screenshotEntryIds: taken.cleanup.screenshotEntryIds.filter(id => !(state.entries ?? []).some(entry => entry.id === id)) };
  return { ...taken, changes, cleanup };
}

export function retainedTrashCleanupAssets(state, extraIds = []) {
  const retained = libraryStoredAssetIds(state, { includeLocalOnly: true });
  for (const key of SNAPSHOT_KEYS) {
    for (const id of libraryStoredAssetIds(state[key]?.state ?? state[key] ?? {})) retained.add(id);
  }
  if (state.lastSaveUndo?.backupEntryId) retained.add(state.lastSaveUndo.backupEntryId);
  for (const id of extraIds) retained.add(id);
  return retained;
}

function assets(value) { return value?.mediaAssets ?? value?.visuals ?? []; }
function mentions(value, ids) {
  if (typeof value === 'string') return ids.has(value);
  return Boolean(value && typeof value === 'object' && Object.values(value).some(item => mentions(item, ids)));
}
