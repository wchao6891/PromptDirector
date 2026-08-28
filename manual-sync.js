import { replaceImagesWithRollback } from "./image-transaction.js";
import {
  SYNC_SNAPSHOT_FORMAT,
  SYNC_SNAPSHOT_VERSION,
  attachSyncImageReferences,
  collectSyncAssets,
  collectSyncImageReferences,
  createRevisionSnapshot,
  mergeRevisionSnapshots,
  normalizeSyncMeta,
  normalizeSyncSettings,
  sameRevisionRecords,
  summarizeRevisionChanges,
  syncObjectReferencesFromRecords,
  syncStateHasContent
} from "./sync-model.js";
import {
  listSyncSnapshots,
  readSyncObject,
  writeSyncObject,
  writeSyncSnapshot
} from "./sync-vault.js";
import { libraryAssetCleanupCandidates, libraryStoredAssetIds } from "./library-asset-inventory.js";
import { salvageMissingLibraryAssets } from "./library-asset-salvage.js";
import { reconcileLibrarySemanticIdentity } from "./library-semantic-identity.js";

const TERMINAL_STATES = new Set(["up-to-date", "success", "canceled", "error"]);

export function createManualSyncController(dependencies = {}) {
  const deps = validateDependencies(dependencies);
  let activeRun = null;
  let currentStatus = idleStatus();

  function start(input = {}) {
    if (activeRun) return activeRun.promise;
    const abortController = new AbortController();
    const effects = emptyEffects();
    setStatus({
      state: "running",
      phase: "reading",
      active: true,
      pendingCount: 0,
      runningCount: 1,
      startedAt: deps.now(),
      finishedAt: "",
      cancelRequested: false,
      effects,
      changeSummary: emptyChangeSummary(),
      error: ""
    });
    const promise = runManualSync({
      ...input,
      dependencies: deps,
      signal: abortController.signal,
      effects,
      update: (patch) => setStatus({ ...patch, effects })
    }).then((result) => {
      const state = result.canceled ? "canceled" : result.upToDate ? "up-to-date" : "success";
      setStatus({
        state,
        phase: state,
        active: false,
        pendingCount: 0,
        runningCount: 0,
        finishedAt: deps.now(),
        effects,
        changeSummary: result.changeSummary ?? emptyChangeSummary(),
        error: ""
      });
      return result;
    }).catch((error) => {
      if (isAbortError(error)) {
        const result = canceledResult(effects);
        setStatus({
          state: "canceled",
          phase: "canceled",
          active: false,
          pendingCount: 0,
          runningCount: 0,
          finishedAt: deps.now(),
          effects,
          changeSummary: emptyChangeSummary(),
          error: ""
        });
        return result;
      }
      setStatus({
        state: "error",
        phase: "error",
        active: false,
        pendingCount: 0,
        runningCount: 0,
        finishedAt: deps.now(),
        effects,
        changeSummary: emptyChangeSummary(),
        error: cleanError(error)
      });
      throw error;
    }).finally(() => {
      activeRun = null;
    });
    activeRun = { abortController, promise };
    return promise;
  }

  function cancel() {
    if (!activeRun) return false;
    if (currentStatus.phase === "committing") return false;
    activeRun.abortController.abort();
    setStatus({ phase: "canceling", cancelRequested: true });
    return true;
  }

  function status() {
    return structuredClone(currentStatus);
  }

  function setStatus(patch) {
    currentStatus = normalizeStatus({ ...currentStatus, ...patch });
    try { deps.onStatus(structuredClone(currentStatus)); } catch { }
  }

  return { start, cancel, status };
}

async function runManualSync({ vault, settings: settingsValue, dependencies: deps, signal, effects, update }) {
  requireNotAborted(signal);
  const settings = normalizeSyncSettings(settingsValue);
  if (!settings.enabled || !settings.vaultId) throw new Error("请先连接同步文件夹");
  if (!vault?.header?.vaultId || vault.header.vaultId !== settings.vaultId) {
    throw new Error("所选文件夹不是此前连接的同步库，请重新连接");
  }

  const meta = normalizeSyncMeta(await deps.readMeta());
  requireNotAborted(signal);
  const remoteSnapshots = await deps.listSnapshots(vault, { signal });
  requireNotAborted(signal);

  const maximumClock = Math.max(
    meta.logicalClock,
    0,
    ...remoteSnapshots.map((snapshot) => Number(snapshot?.logicalClock) || 0)
  );
  const baseSnapshot = revisionBase(meta.records);
  const dirtyAssetIds = new Set(meta.dirtyAssetIds);
  const previousRefs = {
    ...syncObjectReferencesFromRecords(meta.records),
    ...meta.assetRefs
  };
  for (const assetId of dirtyAssetIds) delete previousRefs[assetId];
  if (!meta.localDirty && !dirtyAssetIds.size && Object.keys(meta.records).length) {
    const unchangedLocal = {
      format: SYNC_SNAPSHOT_FORMAT,
      version: SYNC_SNAPSHOT_VERSION,
      snapshotId: `local-meta:${settings.deviceId}`,
      deviceId: settings.deviceId,
      logicalClock: meta.logicalClock,
      createdAt: "",
      records: meta.records
    };
    const remotePreview = mergeRevisionSnapshots([...remoteSnapshots, unchangedLocal]);
    const remoteIdentity = reconcileLibrarySemanticIdentity(remotePreview.state);
    if (sameRevisionRecords(remotePreview.records, meta.records) && !remoteIdentity.changed) {
      if (meta.pendingCleanupAssetIds.length) {
        const current = await deps.readState();
        const cleanup = await retryPendingCleanup({
          state: current,
          settings,
          meta,
          dependencies: deps,
          effects
        });
        return upToDateResult(current, cleanup.meta, effects, cleanup.pendingCount);
      }
      return upToDateResult(remotePreview.state, { ...meta, assetRefs: previousRefs }, effects);
    }
  }

  const current = await deps.readState();
  requireNotAborted(signal);
  let localPrepared = attachSyncImageReferences(current, previousRefs);
  let localSnapshot = await createRevisionSnapshot(localPrepared, {
    deviceId: settings.deviceId,
    logicalClock: maximumClock + 1,
    baseSnapshot
  });
  const preview = mergeRevisionSnapshots([...remoteSnapshots, localSnapshot]);
  const previewIdentity = reconcileLibrarySemanticIdentity(preview.state);

  if (!meta.localDirty && !dirtyAssetIds.size && !previewIdentity.changed && sameRevisionRecords(preview.records, meta.records)) {
    return upToDateResult(current, { ...meta, assetRefs: previousRefs }, effects);
  }

  const localRefs = collectSyncImageReferences(localPrepared);
  const missingAssets = collectSyncAssets(localPrepared).filter((asset) =>
    asset.storageMode !== "reference" && !asset.objectId
  );
  const missingAssetIds = new Set();
  if (missingAssets.length) update({ phase: "uploading" });
  for (const [index, asset] of missingAssets.entries()) {
    requireNotAborted(signal);
    deps.onProgress({ phase: "uploading", current: index, total: missingAssets.length });
    const blob = await deps.readMedia(asset.id);
    requireNotAborted(signal);
    if (!(blob instanceof Blob) || !blob.size) {
      missingAssetIds.add(asset.id);
      continue;
    }
    const objectId = await deps.writeObject(vault, blob, { signal });
    requireNotAborted(signal);
    localRefs[asset.id] = { objectId, contentType: blob.type || asset.contentType };
    effects.preparedRemoteObjects += 1;
  }
  if (missingAssets.length) deps.onProgress({ phase: "uploading", current: missingAssets.length, total: missingAssets.length });

  const salvage = salvageMissingLibraryAssets(current, missingAssetIds);
  const skippedMedia = salvage.issues;
  for (const assetId of missingAssetIds) delete localRefs[assetId];
  localPrepared = attachSyncImageReferences(salvage.state, localRefs);
  localSnapshot = await createRevisionSnapshot(localPrepared, {
    deviceId: settings.deviceId,
    logicalClock: maximumClock + 1,
    baseSnapshot
  });
  update({ phase: "merging" });
  const merged = mergeRevisionSnapshots([...remoteSnapshots, localSnapshot]);
  const identity = reconcileLibrarySemanticIdentity(merged.state);
  const finalState = identity.state;
  const finalImageRefs = reconcileImageReferences(merged.imageRefs, identity.assetIdMap, finalState);
  if (!skippedMedia.length && syncStateHasContent(current) && !syncStateHasContent(finalState)) {
    throw new Error("同步结果异常为空，本机资料未被修改");
  }
  const finalPrepared = attachSyncImageReferences(finalState, finalImageRefs);
  const finalSnapshot = await createRevisionSnapshot(finalPrepared, {
    deviceId: settings.deviceId,
    logicalClock: maximumClock + 2,
    baseSnapshot: revisionBase(merged.records)
  });
  const changeSummary = summarizeRevisionChanges(meta.records, finalSnapshot.records, merged.conflicts);
  const appliedChangeSummary = summarizeRevisionChanges(localSnapshot.records, finalSnapshot.records, merged.conflicts);

  if (!skippedMedia.length && sameRevisionRecords(finalSnapshot.records, meta.records)) {
    let nextMeta = { ...meta, assetRefs: localRefs };
    if (meta.localDirty || dirtyAssetIds.size) {
      requireNotAborted(signal);
      nextMeta = { ...nextMeta, localDirty: false, dirtyAssetIds: [] };
      await deps.commit({
        state: current,
        settings,
        meta: nextMeta,
        trackingOnly: true,
        changeSummary
      });
      effects.localMetadataCommitted = true;
    }
    if (nextMeta.pendingCleanupAssetIds.length) {
      const cleanup = await retryPendingCleanup({
        state: current,
        settings,
        meta: nextMeta,
        dependencies: deps,
        effects
      });
      nextMeta = cleanup.meta;
      return upToDateResult(current, nextMeta, effects, cleanup.pendingCount);
    }
    return upToDateResult(current, nextMeta, effects);
  }

  const replacements = remoteMediaReplacements({
    vault,
    imageRefs: finalImageRefs,
    localRefs,
    readObject: deps.readObject,
    signal,
    onProgress: deps.onProgress
  });
  update({ phase: "downloading", changeSummary });
  const lastSyncAt = deps.now();
  const restoredMediaCount = countDifferentReferences(finalImageRefs, localRefs);
  const cleanupAssetIds = libraryAssetCleanupCandidates(current, finalState, {
    localOnlyState: current,
    pendingAssetIds: meta.pendingCleanupAssetIds
  });
  effects.localBusinessChanged = skippedMedia.length > 0 || hasChanges(appliedChangeSummary) || restoredMediaCount > 0;
  const nextSettings = normalizeSyncSettings({
    ...settings,
    lastSyncAt,
    lastError: "",
    lastErrorCode: ""
  });

  await deps.replaceMediaWithRollback({
    replacements,
    readImage: deps.readMedia,
    writeImage: deps.writeMedia,
    deleteImage: deps.deleteMedia,
    commitMetadata: async () => {
      requireNotAborted(signal);
      update({ phase: "committing", changeSummary });
      await deps.writeSnapshot(vault, finalSnapshot, { retentionCount: settings.retentionCount });
      effects.snapshotWritten = true;
      await deps.commit({
        state: finalState,
        settings: nextSettings,
        meta: {
          logicalClock: maximumClock + 2,
          records: finalSnapshot.records,
          assetRefs: finalImageRefs,
          localDirty: false,
          dirtyAssetIds: [],
          pendingCleanupAssetIds: cleanupAssetIds
        },
        trackingOnly: false,
        changeSummary
      });
      effects.localMetadataCommitted = true;
    }
  });
  effects.localMediaCommitted = restoredMediaCount;
  const cleanup = await retryPendingCleanup({
    state: {
      ...finalState,
      libraryReplacementRecoveryPoint: current.libraryReplacementRecoveryPoint,
      creativeJobs: current.creativeJobs,
      importStaging: current.importStaging
    },
    settings: nextSettings,
    meta: {
      logicalClock: maximumClock + 2,
      records: finalSnapshot.records,
      assetRefs: finalImageRefs,
      localDirty: false,
      dirtyAssetIds: [],
      pendingCleanupAssetIds: cleanupAssetIds
    },
    dependencies: deps,
    effects
  });

  return {
    ok: true,
    upToDate: false,
    canceled: false,
    entryCount: finalState.entries?.length ?? 0,
    mediaCount: Object.keys(finalImageRefs).length,
    conflictCount: merged.conflicts.length,
    addedCount: changeSummary.added,
    updatedCount: changeSummary.updated,
    deletedCount: changeSummary.deleted,
    changeSummary,
    appliedChangeSummary,
    lastSyncAt,
    cleanupPendingCount: cleanup.pendingCount,
    skippedMediaCount: skippedMedia.length,
    skippedMedia,
    effects: structuredClone(effects)
  };
}

async function retryPendingCleanup({ state, settings, meta: metaValue, dependencies: deps, effects }) {
  const meta = normalizeSyncMeta(metaValue);
  const retained = libraryStoredAssetIds(state, { includeLocalOnly: true });
  const candidates = meta.pendingCleanupAssetIds.filter((assetId) => !retained.has(assetId));
  const results = await Promise.allSettled(candidates.map((assetId) => deps.deleteMedia(assetId)));
  const failedIds = candidates.filter((_assetId, index) => results[index].status === "rejected");
  const nextMeta = { ...meta, pendingCleanupAssetIds: failedIds };
  effects.localMediaDeleted += candidates.length - failedIds.length;
  effects.cleanupPendingCount = failedIds.length;
  if (candidates.length || meta.pendingCleanupAssetIds.length !== failedIds.length) {
    try {
      await deps.commit({
        state,
        settings,
        meta: nextMeta,
        trackingOnly: true,
        changeSummary: emptyChangeSummary()
      });
      effects.localMetadataCommitted = true;
    } catch {
      effects.cleanupTrackingPending = true;
      return { meta, pendingCount: meta.pendingCleanupAssetIds.length };
    }
  }
  return { meta: nextMeta, pendingCount: failedIds.length };
}

function reconcileImageReferences(referencesValue, assetIdMap = {}, state = {}) {
  const references = referencesValue && typeof referencesValue === "object" ? referencesValue : {};
  const retained = libraryStoredAssetIds(state);
  const result = {};
  for (const assetId of retained) {
    if (references[assetId]) result[assetId] = structuredClone(references[assetId]);
  }
  for (const [sourceId, targetId] of Object.entries(assetIdMap)) {
    if (!retained.has(targetId) || result[targetId] || !references[sourceId]) continue;
    result[targetId] = structuredClone(references[sourceId]);
  }
  return result;
}

async function* remoteMediaReplacements({ vault, imageRefs, localRefs, readObject, signal, onProgress }) {
  const pending = Object.entries(imageRefs).filter(([assetId, reference]) =>
    localRefs?.[assetId]?.objectId !== reference?.objectId
  );
  for (const [index, [assetId, reference]] of pending.entries()) {
    requireNotAborted(signal);
    onProgress({ phase: "downloading", current: index, total: pending.length });
    const blob = await readObject(vault, reference.objectId, { signal });
    requireNotAborted(signal);
    yield { id: assetId, blob };
  }
  onProgress({ phase: "downloading", current: pending.length, total: pending.length });
}

function validateDependencies(value) {
  const required = ["readState", "readMeta", "readMedia", "writeMedia", "deleteMedia", "commit"];
  for (const name of required) {
    if (typeof value[name] !== "function") throw new Error(`手动同步缺少 ${name} 依赖`);
  }
  const onProgress = typeof value.onProgress === "function" ? value.onProgress : () => undefined;
  return {
    ...value,
    listSnapshots: value.listSnapshots ?? listSyncSnapshots,
    writeObject: value.writeObject ?? writeSyncObject,
    readObject: value.readObject ?? readSyncObject,
    writeSnapshot: value.writeSnapshot ?? writeSyncSnapshot,
    replaceMediaWithRollback: value.replaceMediaWithRollback ?? replaceImagesWithRollback,
    onProgress: (progress) => {
      try { onProgress(progress); } catch { }
    },
    onStatus: typeof value.onStatus === "function" ? value.onStatus : () => undefined,
    now: typeof value.now === "function" ? value.now : () => new Date().toISOString()
  };
}

function revisionBase(records) {
  return { format: SYNC_SNAPSHOT_FORMAT, version: SYNC_SNAPSHOT_VERSION, records };
}

function upToDateResult(state, meta, effects, cleanupPendingCount = 0) {
  return {
    ok: true,
    upToDate: true,
    canceled: false,
    entryCount: state.entries?.length ?? 0,
    mediaCount: Object.keys(meta.assetRefs ?? {}).length,
    conflictCount: 0,
    addedCount: 0,
    updatedCount: 0,
    deletedCount: 0,
    cleanupPendingCount,
    changeSummary: emptyChangeSummary(),
    effects: structuredClone(effects)
  };
}

function canceledResult(effects) {
  return {
    ok: false,
    upToDate: false,
    canceled: true,
    conflictCount: 0,
    addedCount: 0,
    updatedCount: 0,
    deletedCount: 0,
    changeSummary: emptyChangeSummary(),
    effects: structuredClone(effects)
  };
}

function countDifferentReferences(next, before) {
  return Object.entries(next).filter(([assetId, reference]) =>
    before?.[assetId]?.objectId !== reference?.objectId
  ).length;
}

function idleStatus() {
  return normalizeStatus({
    state: "idle",
    phase: "idle",
    active: false,
    pendingCount: 0,
    runningCount: 0,
    startedAt: "",
    finishedAt: "",
    cancelRequested: false,
    effects: emptyEffects(),
    changeSummary: emptyChangeSummary(),
    error: ""
  });
}

function normalizeStatus(value) {
  const state = String(value?.state ?? "idle");
  return {
    state,
    phase: String(value?.phase ?? state),
    active: value?.active === true,
    terminal: TERMINAL_STATES.has(state),
    pendingCount: Math.max(0, Number(value?.pendingCount) || 0),
    runningCount: Math.max(0, Number(value?.runningCount) || 0),
    startedAt: String(value?.startedAt ?? ""),
    finishedAt: String(value?.finishedAt ?? ""),
    cancelRequested: value?.cancelRequested === true,
    effects: structuredClone(value?.effects ?? emptyEffects()),
    changeSummary: structuredClone(value?.changeSummary ?? emptyChangeSummary()),
    error: String(value?.error ?? "")
  };
}

function emptyEffects() {
  return {
    preparedRemoteObjects: 0,
    snapshotWritten: false,
    localMediaCommitted: 0,
    localBusinessChanged: false,
    localMetadataCommitted: false,
    localMediaDeleted: 0,
    cleanupPendingCount: 0,
    cleanupTrackingPending: false
  };
}

function emptyChangeSummary() {
  return { added: 0, updated: 0, deleted: 0, conflicts: 0, byEntity: {} };
}

function hasChanges(summary = {}) {
  return Boolean(summary.added || summary.updated || summary.deleted || summary.conflicts);
}

function requireNotAborted(signal) {
  if (!signal?.aborted) return;
  if (typeof signal.throwIfAborted === "function") signal.throwIfAborted();
  throw new DOMException("同步已取消", "AbortError");
}

function isAbortError(error) {
  return error?.name === "AbortError";
}

function cleanError(error) {
  return String(error?.message ?? error ?? "同步失败").trim() || "同步失败";
}
