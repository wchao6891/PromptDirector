import { sha256Hex } from "./sync-crypto.js";
import { SCHEMA_VERSION, createDefaultTaxonomy, normalizeTaxonomy } from "./taxonomy.js";
import { createDefaultTrashState } from "./trash.js";
import { libraryStoredAssets, storedAssetId } from "./library-asset-inventory.js";

export const SYNC_SNAPSHOT_FORMAT = "prompt-director-sync-state";
export const SYNC_SNAPSHOT_VERSION = 2;
export const SUPPORTED_SYNC_SNAPSHOT_VERSIONS = Object.freeze([1, 2]);
export const DEFAULT_SYNC_RETENTION = 10;
export const SYNC_ERROR_CODES = Object.freeze({
  LOCATION_NOT_FOUND: "location_not_found",
  SNAPSHOT_CORRUPT: "sync_snapshot_corrupt"
});

const SYNC_LOCATION_NOT_FOUND_MESSAGE = "同步文件夹中的文件或目录不存在，请重新选择同步文件夹后再同步";
const LEGACY_LOCATION_NOT_FOUND_PATTERN = /^A requested file or directory could not be found at the time an operation was processed\.?$/i;

const ARRAY_ENTITIES = Object.freeze({
  entry: ["entries", "id"],
  content_type: ["taxonomy.nodes", "id"],
  compound_case: ["compoundCases", "id"],
  collection: ["organizerState.collections", "id"],
  composer_session: ["composerSessions", "id"],
  creative_run: ["creativeRuns", "id"],
  creative_skill: ["creativeSkills.items", "id"],
  trash_item: ["trashState.items", "id"]
});

const SINGLETON_ENTITIES = Object.freeze({
  taxonomy: "legacyTaxonomy",
  taxonomy_profile: "taxonomyProfile",
  facet_catalog: "facetCatalog",
  classification_rules: "classificationRules",
  library_profile: "libraryProfile",
  composer_settings: "composerSettings",
  creative_experiment_settings: "creativeExperimentSettings"
});

export function normalizeSyncSettings(value = {}) {
  const deviceId = cleanId(value.deviceId) || `device:${crypto.randomUUID()}`;
  const storedError = syncErrorDetails(value.lastError);
  const storedCode = cleanText(value.lastErrorCode);
  const lastErrorCode = Object.values(SYNC_ERROR_CODES).includes(storedCode)
    ? storedCode
    : storedError.code;
  return {
    enabled: value.enabled === true,
    vaultId: cleanId(value.vaultId),
    deviceId,
    lastSyncAt: cleanText(value.lastSyncAt),
    lastError: lastErrorCode === SYNC_ERROR_CODES.LOCATION_NOT_FOUND
      ? SYNC_LOCATION_NOT_FOUND_MESSAGE
      : storedError.message,
    lastErrorCode,
    retentionCount: DEFAULT_SYNC_RETENTION
  };
}

export function normalizeSyncMeta(value = {}) {
  const assetRefs = {};
  for (const [assetId, reference] of Object.entries(value?.assetRefs ?? {})) {
    if (!cleanId(assetId) || !validSyncObjectId(reference?.objectId)) continue;
    assetRefs[cleanId(assetId)] = {
      objectId: reference.objectId,
      contentType: cleanText(reference.contentType) || "application/octet-stream"
    };
  }
  return {
    logicalClock: Math.max(0, Math.floor(Number(value?.logicalClock) || 0)),
    records: value?.records && typeof value.records === "object" ? structuredClone(value.records) : {},
    assetRefs,
    localDirty: value?.localDirty === true,
    dirtyAssetIds: [...new Set((Array.isArray(value?.dirtyAssetIds) ? value.dirtyAssetIds : [])
      .map(cleanId).filter(Boolean))],
    pendingCleanupAssetIds: [...new Set((Array.isArray(value?.pendingCleanupAssetIds)
      ? value.pendingCleanupAssetIds
      : []).map(cleanId).filter(Boolean))].sort()
  };
}

export function markSyncMetaDirty(value = {}, assetIds = []) {
  const meta = normalizeSyncMeta(value);
  return {
    ...meta,
    localDirty: true,
    dirtyAssetIds: [...new Set([
      ...meta.dirtyAssetIds,
      ...(Array.isArray(assetIds) ? assetIds : [assetIds]).map(cleanId).filter(Boolean)
    ])]
  };
}

export function syncErrorDetails(value) {
  const objectValue = value && typeof value === "object" ? value : null;
  const name = cleanText(objectValue?.name);
  const message = cleanText(objectValue?.message ?? value);
  if (objectValue?.code === SYNC_ERROR_CODES.SNAPSHOT_CORRUPT) {
    return { code: SYNC_ERROR_CODES.SNAPSHOT_CORRUPT, message: message || "同步目录包含损坏的正式状态文件，本地资料未被修改" };
  }
  if (name === "NotFoundError" || LEGACY_LOCATION_NOT_FOUND_PATTERN.test(message)) {
    return {
      code: SYNC_ERROR_CODES.LOCATION_NOT_FOUND,
      message: SYNC_LOCATION_NOT_FOUND_MESSAGE
    };
  }
  return { code: "", message };
}

export function collectSyncImageReferences(stateValue = {}) {
  const references = {};
  for (const asset of libraryStoredAssets(stateValue)) {
    const id = storedAssetId(asset);
    if (!id || !validSyncObjectId(asset?.syncObjectId)) continue;
    references[id] = {
      objectId: asset.syncObjectId,
      contentType: cleanText(asset.syncContentType) || cleanText(asset.mimeType) || "application/octet-stream"
    };
  }
  return references;
}

export function collectSyncAssets(stateValue = {}) {
  const assets = [];
  const seen = new Set();
  for (const asset of libraryStoredAssets(stateValue)) {
    const id = storedAssetId(asset);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    assets.push({
      id,
      storageMode: cleanText(asset?.storageMode) || "managed",
      contentType: cleanText(asset?.syncContentType) || cleanText(asset?.mimeType) || "application/octet-stream",
      objectId: validSyncObjectId(asset?.syncObjectId) ? asset.syncObjectId : ""
    });
  }
  return assets;
}

export function syncObjectReferencesFromRecords(records = {}) {
  if (!records || typeof records !== "object") return {};
  const restoredState = restoreState(records);
  return {
    ...collectSyncImageReferences(restoredState.state),
    ...restoredState.imageRefs
  };
}

export function sameRevisionRecords(left = {}, right = {}) {
  const leftKeys = Object.keys(left).sort();
  const rightKeys = Object.keys(right).sort();
  if (leftKeys.length !== rightKeys.length || leftKeys.some((key, index) => key !== rightKeys[index])) return false;
  return leftKeys.every((key) => {
    const before = left[key];
    const after = right[key];
    return before?.revisionId === after?.revisionId &&
      cleanText(before?.deletedAt) === cleanText(after?.deletedAt) &&
      before?.fingerprint === after?.fingerprint;
  });
}

export function summarizeRevisionChanges(beforeRecords = {}, afterRecords = {}, conflicts = []) {
  const summary = { added: 0, updated: 0, deleted: 0, conflicts: conflicts.length, byEntity: {} };
  const keys = new Set([...Object.keys(beforeRecords ?? {}), ...Object.keys(afterRecords ?? {})]);
  for (const key of keys) {
    const before = beforeRecords?.[key];
    const after = afterRecords?.[key];
    if (before?.revisionId === after?.revisionId) continue;
    const entityType = splitKey(key)[0] || "unknown";
    const bucket = summary.byEntity[entityType] ??= { added: 0, updated: 0, deleted: 0 };
    if ((!before || before.deletedAt) && after && !after.deletedAt) {
      summary.added += 1;
      bucket.added += 1;
    } else if (before && !before.deletedAt && (!after || after.deletedAt)) {
      summary.deleted += 1;
      bucket.deleted += 1;
    } else {
      summary.updated += 1;
      bucket.updated += 1;
    }
  }
  return summary;
}

export function attachSyncImageReferences(stateValue = {}, references = {}) {
  const state = structuredClone(stateValue);
  for (const asset of libraryStoredAssets(state)) {
    const reference = references?.[storedAssetId(asset)];
    if (!validSyncObjectId(reference?.objectId)) continue;
    asset.syncObjectId = reference.objectId;
    asset.syncContentType = cleanText(reference.contentType) || cleanText(asset.mimeType) || "application/octet-stream";
  }
  return state;
}

export async function createRevisionSnapshot(stateValue = {}, options = {}) {
  const deviceId = cleanId(options.deviceId);
  const logicalClock = Math.max(1, Math.floor(Number(options.logicalClock) || 1));
  if (!deviceId) throw new Error("同步设备缺少稳定编号");
  const base = validSnapshot(options.baseSnapshot) ? options.baseSnapshot : null;
  const previous = base?.records ?? {};
  const payloads = flattenState(stateValue);
  const records = {};

  for (const [key, payload] of Object.entries(payloads)) {
    const fingerprint = await sha256Hex(stableStringify(payload));
    const before = previous[key];
    if (before && !before.deletedAt && before.fingerprint === fingerprint) {
      records[key] = structuredClone(before);
      continue;
    }
    records[key] = await createRecord({
      key, payload, fingerprint, deviceId, logicalClock,
      parentRevisionId: before?.revisionId ?? "",
      ancestorRevisionIds: recordAncestry(before)
    });
  }
  for (const [key, before] of Object.entries(previous)) {
    if (Object.hasOwn(payloads, key) || before.deletedAt) continue;
    records[key] = await createRecord({
      key, payload: null, fingerprint: "",
      deviceId, logicalClock,
      parentRevisionId: before.revisionId,
      ancestorRevisionIds: recordAncestry(before),
      deletedAt: new Date().toISOString()
    });
  }

  return {
    format: SYNC_SNAPSHOT_FORMAT,
    version: SYNC_SNAPSHOT_VERSION,
    snapshotId: `snapshot:${deviceId}:${logicalClock}:${crypto.randomUUID()}`,
    deviceId,
    logicalClock,
    createdAt: new Date().toISOString(),
    records
  };
}

export function mergeRevisionSnapshots(values = []) {
  const snapshots = (Array.isArray(values) ? values : []).filter(validSnapshot).map(upgradeSyncSnapshot);
  if (!snapshots.length) {
    return { state: emptyState(), records: {}, conflicts: [], imageRefs: {} };
  }
  const allRecords = collectRecords(snapshots);
  const records = {};
  const conflicts = [];
  const conflictPayloads = [];

  for (const key of [...allRecords.keys()].sort()) {
    const candidates = uniqueRevisions(allRecords.get(key));
    const heads = candidates.filter((candidate) =>
      !candidates.some((other) => candidate.revisionId !== other.revisionId && isAncestor(candidate, other, allRecords))
    );
    if (heads.length === 1) {
      records[key] = structuredClone(heads[0]);
      continue;
    }
    const [type, entityId] = splitKey(key);
    if (type === "entry") {
      const active = heads.filter((item) => !item.deletedAt);
      const deleted = heads.filter((item) => item.deletedAt);
      if (deleted.length && active.length) {
        records[key] = structuredClone(preferredRecord(deleted));
        for (const item of active) {
          const copy = conflictEntry(item.payload, item, "delete_edit");
          conflictPayloads.push({ entityType: "entry", payload: copy });
          conflicts.push({ entityType: "entry", entityId, reason: "delete_edit", deviceId: item.deviceId });
        }
        continue;
      }
      if (active.length > 1) {
        const tagMerge = mergeEntryTagRecords(key, active, allRecords);
        if (tagMerge) {
          records[key] = tagMerge;
          continue;
        }
        const winner = preferredRecord(active);
        records[key] = structuredClone(winner);
        for (const item of active.filter((candidate) => candidate.revisionId !== winner.revisionId)) {
          const copy = conflictEntry(item.payload, item, "concurrent_edit");
          conflictPayloads.push({ entityType: "entry", payload: copy });
          conflicts.push({ entityType: "entry", entityId, reason: "concurrent_edit", deviceId: item.deviceId });
        }
        continue;
      }
    }
    if (type === "collection") {
      records[key] = mergeCollectionRecords(key, heads, allRecords);
      continue;
    }
    if (type === "trash_item") {
      const active = heads.filter((item) => !item.deletedAt);
      const deleted = heads.filter((item) => item.deletedAt);
      if (deleted.length) {
        records[key] = structuredClone(preferredRecord(deleted));
        if (active.length) {
          conflicts.push({ entityType: type, entityId, reason: "delete_edit", deviceId: preferredRecord(active).deviceId });
        }
        continue;
      }
      const winner = preferredRecord(active);
      records[key] = structuredClone(winner);
      for (const item of active.filter((candidate) => candidate.revisionId !== winner.revisionId)) {
        conflictPayloads.push({
          entityType: type,
          payload: conflictEntity(type, item.payload, item, "concurrent_edit")
        });
        conflicts.push({ entityType: type, entityId, reason: "concurrent_edit", deviceId: item.deviceId });
      }
      continue;
    }
    if (["compound_case", "composer_session", "creative_run", "creative_skill"].includes(type)) {
      const active = heads.filter((item) => !item.deletedAt);
      const deleted = heads.filter((item) => item.deletedAt);
      if (deleted.length && active.length) {
        records[key] = structuredClone(preferredRecord(deleted));
        for (const item of active) {
          conflictPayloads.push({
            entityType: type,
            payload: conflictEntity(type, item.payload, item, "delete_edit")
          });
          conflicts.push({ entityType: type, entityId, reason: "delete_edit", deviceId: item.deviceId });
        }
        continue;
      }
      if (active.length > 1) {
        const winner = preferredRecord(active);
        records[key] = structuredClone(winner);
        for (const item of active.filter((candidate) => candidate.revisionId !== winner.revisionId)) {
          conflictPayloads.push({
            entityType: type,
            payload: conflictEntity(type, item.payload, item, "concurrent_edit")
          });
          conflicts.push({ entityType: type, entityId, reason: "concurrent_edit", deviceId: item.deviceId });
        }
        continue;
      }
    }
    records[key] = structuredClone(preferredRecord(heads));
  }

  for (const conflict of conflictPayloads) {
    const key = entityKey(conflict.entityType, conflict.payload.id);
    records[key] = syntheticRecord(key, conflict.payload, []);
  }
  const restored = restoreState(records);
  return { ...restored, records, conflicts };
}

export function syncStateHasContent(state = {}) {
  return Boolean(
    (state.entries ?? []).length ||
    (state.compoundCases ?? []).length ||
    (state.organizerState?.collections ?? []).length ||
    (state.composerSessions ?? []).length ||
    (state.creativeRuns ?? []).length ||
    (state.creativeSkills?.items ?? []).length ||
    (state.trashState?.items ?? []).length ||
    taxonomyHasUserChanges(state.taxonomy)
  );
}

function taxonomyHasUserChanges(value) {
  const current = normalizeTaxonomy(value).nodes.map(({ id, name, role, order }) => ({ id, name, role, order }));
  const defaults = createDefaultTaxonomy().nodes.map(({ id, name, role, order }) => ({ id, name, role, order }));
  return stableStringify(current) !== stableStringify(defaults);
}

function flattenState(state = {}) {
  const payloads = {};
  for (const [type, [path, idField]] of Object.entries(ARRAY_ENTITIES)) {
    for (const item of arrayAt(state, path)) {
      const id = cleanId(item?.[idField]);
      if (id) payloads[entityKey(type, id)] = sanitizePayload(item);
    }
  }
  const profile = state.settings
    ? { libraryTitle: cleanText(state.settings.libraryTitle) }
    : undefined;
  const singletons = {
    taxonomy_profile: state.taxonomy
      ? { version: state.taxonomy.version, revision: state.taxonomy.revision }
      : undefined,
    facet_catalog: state.facetCatalog,
    classification_rules: state.classificationRules,
    library_profile: profile,
    composer_settings: state.composerSettings,
    creative_experiment_settings: state.creativeExperimentSettings
  };
  for (const [type, payload] of Object.entries(singletons)) {
    if (payload !== undefined) payloads[entityKey(type, "singleton")] = sanitizePayload(payload);
  }
  return payloads;
}

function restoreState(records) {
  const state = emptyState();
  const imageRefs = {};
  for (const [key, record] of Object.entries(records)) {
    if (record.deletedAt || record.payload === null) continue;
    const [type] = splitKey(key);
    const payload = structuredClone(record.payload);
    if (type === "entry") state.entries.push(payload);
    else if (type === "content_type") state.taxonomy.nodes.push(payload);
    else if (type === "compound_case") state.compoundCases.push(payload);
    else if (type === "collection") state.organizerState.collections.push(payload);
    else if (type === "composer_session") state.composerSessions.push(payload);
    else if (type === "creative_run") state.creativeRuns.push(payload);
    else if (type === "creative_skill") state.creativeSkills.items.push(payload);
    else if (type === "trash_item") state.trashState.items.push(payload);
    else {
      const target = SINGLETON_ENTITIES[type];
      if (target === "libraryProfile") {
        state.settings = { ...(state.settings ?? {}), libraryTitle: payload.libraryTitle };
      } else if (target === "taxonomyProfile") {
        state.taxonomy = { ...state.taxonomy, version: payload.version, revision: payload.revision };
      } else if (target) {
        state[target] = payload;
      }
    }
  }
  state.entries.sort(bySavedAtThenId);
  if (!state.taxonomy.nodes.length && state.legacyTaxonomy?.nodes?.length) state.taxonomy = state.legacyTaxonomy;
  delete state.legacyTaxonomy;
  state.organizerState.collections.sort((left, right) =>
    (Number(left.order) || 0) - (Number(right.order) || 0) || String(left.name).localeCompare(String(right.name))
  );
  state.trashState.items.sort((left, right) =>
    String(left.deletedAt ?? "").localeCompare(String(right.deletedAt ?? "")) ||
    String(left.id).localeCompare(String(right.id))
  );
  for (const asset of libraryStoredAssets(state)) {
    const assetId = storedAssetId(asset);
    if (!assetId || !validSyncObjectId(asset?.syncObjectId)) continue;
    imageRefs[assetId] = {
      objectId: asset.syncObjectId,
      contentType: cleanText(asset.syncContentType) || cleanText(asset.mimeType) || "application/octet-stream"
    };
    delete asset.syncObjectId;
    delete asset.syncContentType;
  }
  return { state, imageRefs };
}

function validSyncObjectId(value) {
  return /^[a-f0-9]{64}$/.test(String(value ?? ""));
}

async function createRecord({
  key,
  payload,
  fingerprint,
  deviceId,
  logicalClock,
  parentRevisionId,
  ancestorRevisionIds = [],
  deletedAt = ""
}) {
  const revisionSeed = `${key}\n${deviceId}\n${logicalClock}\n${parentRevisionId}\n${deletedAt}\n${fingerprint}`;
  const revisionId = `revision:${await sha256Hex(revisionSeed)}`;
  const [entityType, entityId] = splitKey(key);
  return {
    entityType,
    entityId,
    revisionId,
    parentRevisionId,
    ancestorRevisionIds: [...new Set(ancestorRevisionIds)].filter(Boolean),
    deviceId,
    logicalClock,
    ...(deletedAt ? { deletedAt } : {}),
    fingerprint,
    payload: payload === null ? null : structuredClone(payload)
  };
}

function collectRecords(snapshots) {
  const result = new Map();
  for (const snapshot of snapshots) {
    for (const [key, record] of Object.entries(snapshot.records)) {
      if (!validRecord(key, record)) continue;
      if (!result.has(key)) result.set(key, []);
      result.get(key).push(record);
    }
  }
  return result;
}

function isAncestor(candidate, descendant, recordsByKey) {
  if ((descendant.ancestorRevisionIds ?? []).includes(candidate.revisionId)) return true;
  const key = entityKey(candidate.entityType, candidate.entityId);
  const byRevision = new Map((recordsByKey.get(key) ?? []).map((item) => [item.revisionId, item]));
  const pending = [descendant.parentRevisionId, ...(descendant.mergedRevisionIds ?? [])].filter(Boolean);
  const seen = new Set();
  while (pending.length) {
    const revisionId = pending.pop();
    if (revisionId === candidate.revisionId) return true;
    if (seen.has(revisionId)) continue;
    seen.add(revisionId);
    const parent = byRevision.get(revisionId);
    if (parent) pending.push(parent.parentRevisionId, ...(parent.mergedRevisionIds ?? []));
  }
  return false;
}

function mergeCollectionRecords(key, heads, recordsByKey) {
  const active = heads.filter((item) => !item.deletedAt);
  if (!active.length) return structuredClone(preferredRecord(heads));
  const preferred = preferredRecord(active);
  const base = commonAncestorRecord(key, active, recordsByKey);
  const names = [...new Set(active.map((item) => cleanText(item.payload?.name)).filter(Boolean))];
  const entryIds = base
    ? mergeStringSetOperations(
      base.payload?.entryIds,
      active.map((item) => item.payload?.entryIds)
    )
    : [...new Set(active.flatMap((item) => item.payload?.entryIds ?? []))];
  const payload = {
    ...structuredClone(preferred.payload),
    entryIds,
    aliases: [...new Set([
      ...(preferred.payload?.aliases ?? []),
      ...names.filter((name) => name !== preferred.payload?.name)
    ])]
  };
  return syntheticRecord(key, payload, heads);
}

function mergeEntryTagRecords(key, heads, recordsByKey) {
  const base = commonAncestorRecord(key, heads, recordsByKey);
  if (!base?.payload) return null;
  const withoutTags = (payload) => {
    const clone = structuredClone(payload);
    delete clone.facetAssignments;
    return clone;
  };
  const shape = stableStringify(withoutTags(base.payload));
  if (heads.some((item) => stableStringify(withoutTags(item.payload)) !== shape)) return null;

  const assignmentKey = (item) => [
    cleanId(item?.facetId),
    cleanId(item?.nodeId),
    cleanId(item?.visualId)
  ].join("\n");
  const baseAssignments = new Map((base.payload.facetAssignments ?? []).map((item) => [assignmentKey(item), item]));
  const removed = new Set();
  const changed = new Map();
  for (const head of [...heads].sort((left, right) => left.logicalClock - right.logicalClock)) {
    const current = new Map((head.payload?.facetAssignments ?? []).map((item) => [assignmentKey(item), item]));
    for (const id of baseAssignments.keys()) {
      if (!current.has(id)) removed.add(id);
    }
    for (const [id, assignment] of current) {
      if (!id.trim() || stableStringify(assignment) === stableStringify(baseAssignments.get(id))) continue;
      changed.set(id, structuredClone(assignment));
    }
  }
  const assignments = new Map(baseAssignments);
  for (const id of removed) assignments.delete(id);
  for (const [id, assignment] of changed) {
    if (!removed.has(id)) assignments.set(id, assignment);
  }
  const payload = {
    ...structuredClone(preferredRecord(heads).payload),
    facetAssignments: [...assignments.values()]
  };
  return syntheticRecord(key, payload, heads);
}

function commonAncestorRecord(key, heads, recordsByKey) {
  const candidates = recordsByKey.get(key) ?? [];
  return [...candidates]
    .filter((candidate) => heads.every((head) =>
      candidate.revisionId === head.revisionId || isAncestor(candidate, head, recordsByKey)
    ))
    .sort((left, right) => right.logicalClock - left.logicalClock)[0] ?? null;
}

function mergeStringSetOperations(baseValues = [], branchValues = []) {
  const base = new Set(Array.isArray(baseValues) ? baseValues : []);
  const removed = new Set();
  const added = new Set();
  for (const values of branchValues) {
    const current = new Set(Array.isArray(values) ? values : []);
    for (const value of base) {
      if (!current.has(value)) removed.add(value);
    }
    for (const value of current) {
      if (!base.has(value)) added.add(value);
    }
  }
  return [...base].filter((value) => !removed.has(value)).concat([...added]);
}

function syntheticRecord(key, payload, parents) {
  const [entityType, entityId] = splitKey(key);
  const revisionIds = parents.map((item) => item.revisionId).sort();
  return {
    entityType,
    entityId,
    revisionId: `merge:${revisionIds.join("+") || entityId}`,
    parentRevisionId: revisionIds[0] ?? "",
    mergedRevisionIds: revisionIds.slice(1),
    ancestorRevisionIds: [...new Set(parents.flatMap((item) => recordAncestry(item)))],
    deviceId: "merge",
    logicalClock: Math.max(0, ...parents.map((item) => item.logicalClock)),
    fingerprint: stableStringify(payload),
    payload: structuredClone(payload)
  };
}

function recordAncestry(record) {
  if (!record) return [];
  return [
    record.revisionId,
    ...(record.ancestorRevisionIds ?? []),
    ...(record.mergedRevisionIds ?? [])
  ].filter(Boolean);
}

function conflictEntry(payload, record, reason) {
  const source = structuredClone(payload);
  const suffix = record.revisionId.replace(/[^a-z0-9]/gi, "").slice(-10);
  source.id = `${source.id}-conflict-${suffix}`;
  source.title = `${cleanText(source.title) || "未命名案例"}（同步冲突副本）`;
  const visualIds = new Map();
  const sourceMedia = source.mediaAssets ?? source.visuals ?? [];
  source.mediaAssets = sourceMedia.map((visual) => {
    const id = `${visual.id}-conflict-${suffix}`;
    visualIds.set(visual.id, id);
    return { ...visual, id };
  });
  source.mediaAssets = source.mediaAssets.map((asset) => ({
    ...asset,
    ...(asset.posterAssetId ? { posterAssetId: visualIds.get(asset.posterAssetId) ?? asset.posterAssetId } : {}),
    ...(asset.derivedFromAssetId ? { derivedFromAssetId: visualIds.get(asset.derivedFromAssetId) ?? asset.derivedFromAssetId } : {})
  }));
  source.primaryMediaId = visualIds.get(source.primaryMediaId ?? source.primaryVisualId) ?? source.mediaAssets[0]?.id ?? "";
  delete source.visuals;
  delete source.primaryVisualId;
  source.timeNotes = (source.timeNotes ?? []).map((note) => ({
    ...note,
    assetId: visualIds.get(note.assetId) ?? note.assetId,
    ...(note.frameAssetId ? { frameAssetId: visualIds.get(note.frameAssetId) ?? note.frameAssetId } : {})
  }));
  source.facetAssignments = (source.facetAssignments ?? []).map((assignment) =>
    assignment.visualId && visualIds.has(assignment.visualId)
      ? { ...assignment, visualId: visualIds.get(assignment.visualId) }
      : assignment
  );
  source.syncConflict = {
    reason,
    originalEntryId: record.entityId,
    sourceDeviceId: record.deviceId,
    revisionId: record.revisionId
  };
  return source;
}

function conflictEntity(entityType, payload, record, reason) {
  if (entityType === "entry") return conflictEntry(payload, record, reason);
  const source = structuredClone(payload);
  const suffix = record.revisionId.replace(/[^a-z0-9]/gi, "").slice(-10);
  source.id = `${source.id}-conflict-${suffix}`;
  if (entityType === "trash_item") {
    source.syncConflict = {
      reason,
      originalEntityId: record.entityId,
      sourceDeviceId: record.deviceId,
      revisionId: record.revisionId
    };
    return source;
  }
  source.title = `${cleanText(source.title) || "未命名记录"}（同步冲突副本）`;
  source.syncConflict = {
    reason,
    originalEntityId: record.entityId,
    sourceDeviceId: record.deviceId,
    revisionId: record.revisionId
  };
  if (entityType === "creative_run") {
    source.outputs = (source.outputs ?? []).map((output) => ({
      ...output,
      visual: {
        ...output.visual,
        id: `${output.visual.id}-conflict-${suffix}`
      }
    }));
  }
  return source;
}

function preferredRecord(values) {
  return [...values].sort((left, right) =>
    right.logicalClock - left.logicalClock ||
    String(right.revisionId).localeCompare(String(left.revisionId))
  )[0];
}

function uniqueRevisions(values) {
  return [...new Map(values.map((item) => [item.revisionId, item])).values()];
}

function validSnapshot(value) {
  return value?.format === SYNC_SNAPSHOT_FORMAT &&
    isSupportedSyncSnapshotVersion(value.version) &&
    value.records && typeof value.records === "object";
}

export function isSupportedSyncSnapshotVersion(value) {
  return Number.isInteger(value) && SUPPORTED_SYNC_SNAPSHOT_VERSIONS.includes(value);
}

function upgradeSyncSnapshot(value) {
  if (value.version !== 1) return value;
  const snapshot = structuredClone(value);
  snapshot.version = SYNC_SNAPSHOT_VERSION;
  for (const [key, record] of Object.entries(snapshot.records ?? {})) {
    if (!key.startsWith("collection:") || !record?.payload) continue;
    record.payload.parentId = null;
    // Legacy flat devices may continue writing after a tree exists. Keeping their
    // collection clock at the migration baseline prevents a flat snapshot from
    // winning a concurrent conflict over a newer tree-aware collection record.
    record.logicalClock = 0;
  }
  return snapshot;
}

function validRecord(key, value) {
  const [type, id] = splitKey(key);
  return value && type === value.entityType && id === value.entityId &&
    typeof value.revisionId === "string" && value.revisionId &&
    Number.isFinite(value.logicalClock);
}

function emptyState() {
  return {
    entries: [],
    taxonomy: { version: SCHEMA_VERSION, revision: 1, nodes: [] },
    compoundCases: [],
    organizerState: { version: 7, collections: [] },
    composerSessions: [],
    creativeRuns: [],
    creativeSkills: { version: 1, items: [] },
    trashState: createDefaultTrashState()
  };
}

function sanitizePayload(value) {
  const clone = structuredClone(value);
  delete clone.apiKey;
  delete clone.endpoint;
  return clone;
}

function arrayAt(value, path) {
  return path.split(".").reduce((current, segment) => current?.[segment], value) ?? [];
}

function entityKey(type, id) {
  return `${type}:${encodeURIComponent(id)}`;
}

function splitKey(key) {
  const separator = key.indexOf(":");
  if (separator < 1) return ["", ""];
  return [key.slice(0, separator), decodeURIComponent(key.slice(separator + 1))];
}

function stableStringify(value) {
  return JSON.stringify(sortObject(value));
}

function sortObject(value) {
  if (Array.isArray(value)) return value.map(sortObject);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, sortObject(value[key])]));
}

function cleanId(value) {
  return String(value ?? "").replace(/[\u0000-\u001f\u007f]/g, "").trim();
}

function cleanText(value) {
  return cleanId(value).replace(/\s+/g, " ");
}

function bySavedAtThenId(left, right) {
  return String(left.savedAt ?? "").localeCompare(String(right.savedAt ?? "")) ||
    String(left.id).localeCompare(String(right.id));
}
