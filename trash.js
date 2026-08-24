import {
  collectionEntryIds,
  collectionSubtreeIds,
  normalizeOrganizerState,
  removeEntriesFromOrganizer
} from "./organizer.js";
import { normalizeEntryMedia, removeEntryMedia } from "./media.js";
import { normalizeCompoundCases, removeEntriesFromCompoundCases } from "./compound-cases.js";

export const TRASH_VERSION = 1;

const TRASH_KINDS = new Set(["entry", "media", "collection"]);
const OMIT = Symbol("omit");

export function createDefaultTrashState() {
  return { version: TRASH_VERSION, items: [] };
}

export function normalizeTrashState(value = {}) {
  const items = [];
  const seen = new Set();
  for (const valueItem of Array.isArray(value?.items) ? value.items : []) {
    const item = normalizeTrashItem(valueItem);
    if (!item || seen.has(item.id)) continue;
    seen.add(item.id);
    items.push(item);
  }
  return { version: TRASH_VERSION, items };
}

export function moveEntriesToTrash(contextValue = {}, entryIds = [], options = {}) {
  const deletedAt = operationTime(options.deletedAt);
  const entries = Array.isArray(contextValue.entries) ? contextValue.entries : [];
  const organizerState = normalizeOrganizerState(contextValue.organizerState);
  const trashState = normalizeTrashState(contextValue.trashState);
  const requested = new Set(uniqueIds(entryIds));
  const existingTrashIds = new Set(trashState.items.map((item) => item.id));
  const compoundCases = Array.isArray(contextValue.compoundCases)
    ? normalizeCompoundCases(contextValue.compoundCases, entries)
    : null;
  const moved = [];

  for (const entry of entries) {
    const targetId = clean(entry?.id);
    const trashId = trashItemId("entry", targetId);
    if (!requested.has(targetId) || existingTrashIds.has(trashId)) continue;
    moved.push({
      id: trashId,
      kind: "entry",
      targetId,
      deletedAt,
      snapshot: serializableObject(entry),
      relationships: {
        collections: organizerState.collections.flatMap((collection) => {
          const index = collection.entryIds.indexOf(targetId);
          return index < 0 ? [] : [{ id: collection.id, index }];
        }),
        ...(compoundCases?.some((compound) => compound.memberEntryIds.includes(targetId)) ? {
          compoundCases: compoundCases.filter((compound) => compound.memberEntryIds.includes(targetId))
            .map(serializableObject)
        } : {})
      }
    });
    existingTrashIds.add(trashId);
  }

  const movedIds = new Set(moved.map((item) => item.targetId));
  const result = {
    ...contextValue,
    trashState: normalizeTrashState({ items: [...trashState.items, ...moved] }),
    entries: entries.filter((entry) => !movedIds.has(clean(entry?.id))),
    organizerState: removeEntriesFromOrganizer(organizerState, [...movedIds]),
    movedItemIds: moved.map((item) => item.id)
  };
  if (compoundCases) {
    result.compoundCases = removeEntriesFromCompoundCases(compoundCases, entries, [...movedIds]);
  }
  return result;
}

export function moveCollectionWithEntriesToTrash(contextValue = {}, collectionIdValue, options = {}) {
  const entries = Array.isArray(contextValue.entries) ? contextValue.entries : [];
  const organizerState = normalizeOrganizerState(contextValue.organizerState, entries.map((entry) => clean(entry?.id)));
  const collectionId = clean(collectionIdValue);
  const collection = organizerState.collections.find((item) => item.id === collectionId);
  if (!collection) throw new Error("项目不存在");

  const subtreeCollectionIds = collectionSubtreeIds(organizerState, collection.id);
  const subtreeEntryIds = collectionEntryIds(organizerState, collection.id, { subtree: true });
  const entriesMoved = moveEntriesToTrash({ ...contextValue, organizerState }, subtreeEntryIds, options);
  const collectionMoved = moveCollectionsToTrash({
    ...contextValue,
    trashState: entriesMoved.trashState,
    organizerState
  }, subtreeCollectionIds, options);
  return {
    ...contextValue,
    trashState: collectionMoved.trashState,
    entries: entriesMoved.entries,
    organizerState: removeEntriesFromOrganizer(collectionMoved.organizerState, subtreeEntryIds),
    ...(Array.isArray(contextValue.compoundCases) ? { compoundCases: entriesMoved.compoundCases } : {}),
    movedItemIds: [...entriesMoved.movedItemIds, ...collectionMoved.movedItemIds],
    movedEntryIds: subtreeEntryIds.filter((id) => entries.some((entry) => clean(entry?.id) === id)),
    collection: structuredClone(collection)
  };
}

export function moveCollectionsToTrash(contextValue = {}, collectionIds = [], options = {}) {
  const deletedAt = operationTime(options.deletedAt);
  const organizerState = normalizeOrganizerState(contextValue.organizerState);
  const trashState = normalizeTrashState(contextValue.trashState);
  const requestedRoots = uniqueIds(collectionIds);
  const requested = new Set(requestedRoots.flatMap((id) => collectionSubtreeIds(organizerState, id)));
  const existingTrashIds = new Set(trashState.items.map((item) => item.id));
  const moved = organizerState.collections.flatMap((collection) => {
    const trashId = trashItemId("collection", collection.id);
    if (!requested.has(collection.id) || existingTrashIds.has(trashId)) return [];
    existingTrashIds.add(trashId);
    return [{
      id: trashId,
      kind: "collection",
      targetId: collection.id,
      deletedAt,
      snapshot: serializableObject(collection),
      relationships: {}
    }];
  });
  const movedIds = new Set(moved.map((item) => item.targetId));
  return {
    ...contextValue,
    trashState: normalizeTrashState({ items: [...trashState.items, ...moved] }),
    organizerState: {
      ...organizerState,
      collections: organizerState.collections.filter((collection) => !movedIds.has(collection.id))
    },
    movedItemIds: moved.map((item) => item.id)
  };
}

export function moveMediaToTrash(contextValue = {}, entryIdValue, mediaIds = [], options = {}) {
  const deletedAt = operationTime(options.deletedAt);
  const entryId = clean(entryIdValue);
  const requested = uniqueIds(mediaIds);
  const sourceEntries = Array.isArray(contextValue.entries) ? contextValue.entries : [];
  const entryIndex = sourceEntries.findIndex((entry) => clean(entry?.id) === entryId);
  if (entryIndex < 0) throw new Error("案例不存在");
  const entries = structuredClone(sourceEntries);
  const trashState = normalizeTrashState(contextValue.trashState);
  const existingTrashIds = new Set(trashState.items.map((item) => item.id));
  const moved = [];
  let entry = normalizeEntryMedia(entries[entryIndex]);

  for (const targetId of requested) {
    const trashId = trashItemId("media", targetId, entryId);
    if (existingTrashIds.has(trashId) || !entry.mediaAssets.some((asset) => asset.id === targetId)) continue;
    const before = entry;
    const after = removeEntryMedia(before, targetId);
    const remainingIds = new Set(after.mediaAssets.map((asset) => asset.id));
    const removedAssets = before.mediaAssets.filter((asset) => !remainingIds.has(asset.id));
    const removedIds = new Set(removedAssets.map((asset) => asset.id));
    moved.push({
      id: trashId,
      kind: "media",
      targetId,
      deletedAt,
      snapshot: { mediaAssets: removedAssets },
      relationships: {
        entryId,
        positions: removedAssets.map((asset) => ({ id: asset.id, index: before.mediaAssets.findIndex((item) => item.id === asset.id) })),
        primaryMediaId: removedIds.has(before.primaryMediaId) ? before.primaryMediaId : "",
        timeNotes: relatedValues(before.timeNotes, removedIds, ["assetId", "frameAssetId"]),
        mediaPrompts: relatedValues(before.mediaPrompts, removedIds, ["assetId"]),
        videoAnalyses: relatedValues(before.videoAnalyses, removedIds, ["assetId"]),
        facetAssignments: relatedValues(before.facetAssignments, removedIds, ["visualId"]),
        articleDocument: before.articleDocument ?? null,
        articleDocumentAfterDelete: after.articleDocument ?? null
      }
    });
    existingTrashIds.add(trashId);
    entry = {
      ...after,
      facetAssignments: (after.facetAssignments ?? []).filter((assignment) =>
        !removedIds.has(clean(assignment?.visualId))
      )
    };
  }

  entries[entryIndex] = entry;
  return {
    ...contextValue,
    trashState: normalizeTrashState({ items: [...trashState.items, ...moved] }),
    entries,
    movedItemIds: moved.map((item) => item.id),
    pendingBlobDeletes: []
  };
}

export function restoreTrashItems(contextValue = {}, itemIds = [], options = {}) {
  const trashState = normalizeTrashState(contextValue.trashState);
  const requested = new Set(uniqueIds(itemIds));
  const entries = structuredClone(Array.isArray(contextValue.entries) ? contextValue.entries : []);
  let organizerState = structuredClone(normalizeOrganizerState(contextValue.organizerState));
  const restored = new Set();
  const unresolved = [];
  const warnings = [];
  const kindOrder = { collection: 0, entry: 1, media: 2 };
  const candidates = trashState.items
    .filter((item) => requested.has(item.id))
    .toSorted((left, right) => kindOrder[left.kind] - kindOrder[right.kind]);
  const restorableEntryIds = new Set([
    ...entries.map((entry) => clean(entry?.id)).filter(Boolean),
    ...candidates.filter((item) => item.kind === "entry").map((item) => item.targetId)
  ]);

  const collectionRestore = restoreCollectionItems(
    candidates.filter((item) => item.kind === "collection"),
    organizerState,
    restorableEntryIds
  );
  organizerState = collectionRestore.organizerState;
  collectionRestore.restoredItemIds.forEach((id) => restored.add(id));
  unresolved.push(...collectionRestore.unresolved);
  warnings.push(...collectionRestore.warnings);

  for (const item of candidates.filter((candidate) => candidate.kind !== "collection")) {
    let result;
    if (item.kind === "entry") {
      result = restoreEntryItem(item, entries, organizerState, options.collectionReplacements);
      if (result.ok) organizerState = result.organizerState;
    } else {
      result = restoreMediaItem(item, entries);
    }
    if (result.ok) restored.add(item.id);
    else unresolved.push({ itemId: item.id, kind: item.kind, targetId: item.targetId, ...result.issue });
  }

  const compoundCases = restoreRelatedCompoundCases(
    contextValue.compoundCases,
    entries,
    candidates.filter((item) => restored.has(item.id))
  );

  return {
    ...contextValue,
    trashState: normalizeTrashState({ items: trashState.items.filter((item) => !restored.has(item.id)) }),
    entries,
    organizerState,
    ...(Array.isArray(contextValue.compoundCases) ? { compoundCases } : {}),
    restoredItemIds: trashState.items.filter((item) => restored.has(item.id)).map((item) => item.id),
    unresolved,
    warnings
  };
}

export function listTrashItems(stateValue = {}, options = {}) {
  const kind = clean(options.kind);
  return structuredClone(normalizeTrashState(stateValue).items
    .filter((item) => !kind || item.kind === kind)
    .toSorted((left, right) => right.deletedAt.localeCompare(left.deletedAt) || left.id.localeCompare(right.id)));
}

export function takeTrashItems(stateValue = {}, itemIds = [], options = {}) {
  const state = normalizeTrashState(stateValue);
  const requested = new Set(uniqueIds(itemIds));
  const takenItems = state.items.filter((item) => requested.has(item.id));
  const remainingItems = state.items.filter((item) => !requested.has(item.id));
  const retainedMediaIds = new Set([
    ...uniqueIds(options.retainedMediaIds),
    ...remainingItems.flatMap(mediaIdsInTrashItem)
  ]);
  const retainedEntryIds = new Set(uniqueIds(options.retainedEntryIds));
  const cleanupMediaIds = uniqueIds(takenItems.flatMap(mediaIdsInTrashItem))
    .filter((id) => !retainedMediaIds.has(id));
  const entryIds = uniqueIds(takenItems.filter((item) => item.kind === "entry").map((item) => item.targetId));
  return {
    trashState: normalizeTrashState({ items: remainingItems }),
    takenItems: structuredClone(takenItems),
    cleanup: {
      entryIds,
      collectionIds: uniqueIds(takenItems.filter((item) => item.kind === "collection").map((item) => item.targetId)),
      mediaIds: cleanupMediaIds,
      screenshotEntryIds: entryIds.filter((id) => !retainedEntryIds.has(id))
    }
  };
}

export function emptyTrash(stateValue = {}, options = {}) {
  const state = normalizeTrashState(stateValue);
  return takeTrashItems(state, state.items.map((item) => item.id), options);
}

function restoreCollectionItems(items, organizerState, restorableEntryIds) {
  const unresolved = [];
  const warnings = [];
  const accepted = [];
  const existingById = new Map(organizerState.collections.map((collection) => [collection.id, collection]));
  for (const item of items) {
    const snapshot = serializableObject(item.snapshot);
    if (clean(snapshot.id) !== item.targetId || !clean(snapshot.name)) {
      unresolved.push({ itemId: item.id, kind: item.kind, targetId: item.targetId, reason: "项目快照无效" });
      continue;
    }
    const existing = existingById.get(item.targetId);
    if (existing) {
      const normalizedSnapshot = normalizeOrganizerState({
        ...organizerState,
        collections: [...organizerState.collections.filter((collection) => collection.id !== item.targetId), snapshot]
      }).collections.find((collection) => collection.id === item.targetId);
      if (jsonEqual(existing, normalizedSnapshot)) accepted.push({ item, snapshot: null });
      else unresolved.push({ itemId: item.id, kind: item.kind, targetId: item.targetId, reason: "当前资料库存在同编号但内容不同的项目" });
      continue;
    }
    const missingEntryIds = uniqueIds(snapshot.entryIds).filter((entryId) => !restorableEntryIds.has(entryId));
    if (missingEntryIds.length) {
      unresolved.push({ itemId: item.id, kind: item.kind, targetId: item.targetId, reason: "项目成员案例不存在", missingEntryIds });
      continue;
    }
    accepted.push({ item, snapshot });
  }
  const availableIds = new Set([...existingById.keys(), ...accepted.map(({ item }) => item.targetId)]);
  for (const acceptedItem of accepted) {
    if (!acceptedItem.snapshot) continue;
    const originalParentId = clean(acceptedItem.snapshot.parentId);
    if (originalParentId && !availableIds.has(originalParentId)) {
      acceptedItem.snapshot.parentId = null;
      warnings.push({ itemId: acceptedItem.item.id, reason: "原父项目不存在，已恢复到根级", missingParentId: originalParentId });
    }
  }
  return {
    organizerState: normalizeOrganizerState({
      ...organizerState,
      collections: [...organizerState.collections, ...accepted.map(({ snapshot }) => snapshot).filter(Boolean)]
    }),
    restoredItemIds: accepted.map(({ item }) => item.id),
    unresolved,
    warnings
  };
}

function mediaIdsInTrashItem(item) {
  if (!item || !["entry", "media"].includes(item.kind)) return [];
  const assets = Array.isArray(item.snapshot?.mediaAssets)
    ? item.snapshot.mediaAssets
    : Array.isArray(item.snapshot?.visuals) ? item.snapshot.visuals : [];
  return assets
    .filter((asset) => asset?.storageMode !== "reference")
    .map((asset) => clean(asset?.id))
    .filter(Boolean);
}

function restoreEntryItem(item, entries, organizerState, replacementValue) {
  const snapshot = serializableObject(item.snapshot);
  if (clean(snapshot.id) !== item.targetId) return unresolvedIssue("案例快照无效");
  const existing = entries.find((entry) => clean(entry?.id) === item.targetId);
  if (existing && !jsonEqual(serializableObject(existing), snapshot)) {
    return unresolvedIssue("当前资料库存在同编号但内容不同的案例");
  }
  const replacements = replacementValue && typeof replacementValue === "object" ? replacementValue : {};
  const collectionIds = new Set(organizerState.collections.map((collection) => collection.id));
  const relationships = Array.isArray(item.relationships?.collections) ? item.relationships.collections : [];
  const resolvedRelationships = [];
  const missingCollectionIds = [];
  for (const relationship of relationships) {
    const originalId = clean(relationship?.id);
    if (collectionIds.has(originalId)) {
      resolvedRelationships.push({ id: originalId, index: safeIndex(relationship?.index) });
      continue;
    }
    if (!Object.hasOwn(replacements, originalId)) {
      missingCollectionIds.push(originalId);
      continue;
    }
    const replacementIds = uniqueIds(replacements[originalId]);
    const invalidReplacementIds = replacementIds.filter((id) => !collectionIds.has(id));
    if (invalidReplacementIds.length) missingCollectionIds.push(...invalidReplacementIds);
    else replacementIds.forEach((id) => resolvedRelationships.push({ id, index: Number.MAX_SAFE_INTEGER }));
  }
  if (missingCollectionIds.length) {
    return unresolvedIssue("原项目关系不存在", { missingCollectionIds: [...new Set(missingCollectionIds)] });
  }
  if (!existing) entries.push(snapshot);
  for (const relationship of resolvedRelationships) {
    const collection = organizerState.collections.find((candidate) => candidate.id === relationship.id);
    if (!collection || collection.entryIds.includes(item.targetId)) continue;
    collection.entryIds.splice(Math.min(relationship.index, collection.entryIds.length), 0, item.targetId);
  }
  return { ok: true, organizerState: normalizeOrganizerState(organizerState) };
}

function restoreMediaItem(item, entries) {
  const entryIndex = entries.findIndex((entry) => clean(entry?.id) === clean(item.relationships?.entryId));
  if (entryIndex < 0) return unresolvedIssue("媒体所属案例不存在");
  const entry = normalizeEntryMedia(entries[entryIndex]);
  const restoredAssets = Array.isArray(item.snapshot?.mediaAssets) ? item.snapshot.mediaAssets : [];
  if (!restoredAssets.length || !restoredAssets.some((asset) => clean(asset?.id) === item.targetId)) {
    return unresolvedIssue("媒体快照无效");
  }
  const currentById = new Map(entry.mediaAssets.map((asset) => [asset.id, asset]));
  for (const asset of restoredAssets) {
    const existing = currentById.get(clean(asset?.id));
    if (existing && !jsonEqual(existing, asset)) {
      return unresolvedIssue("案例中存在同编号但内容不同的媒体");
    }
  }
  const expectedDocument = item.relationships?.articleDocumentAfterDelete ?? null;
  const currentDocument = entry.articleDocument ?? null;
  if (!jsonEqual(currentDocument, expectedDocument)) {
    return unresolvedIssue("案例正文在删除媒体后已经改变，无法安全覆盖");
  }
  const positions = new Map((Array.isArray(item.relationships?.positions) ? item.relationships.positions : [])
    .map((position) => [clean(position?.id), safeIndex(position?.index)]));
  const mediaAssets = [...entry.mediaAssets];
  for (const asset of restoredAssets.toSorted((left, right) =>
    (positions.get(clean(left?.id)) ?? Number.MAX_SAFE_INTEGER) - (positions.get(clean(right?.id)) ?? Number.MAX_SAFE_INTEGER)
  )) {
    if (currentById.has(clean(asset?.id))) continue;
    const index = Math.min(positions.get(clean(asset?.id)) ?? mediaAssets.length, mediaAssets.length);
    mediaAssets.splice(index, 0, asset);
  }
  const next = {
    ...entry,
    mediaAssets,
    timeNotes: mergeRelated(entry.timeNotes, item.relationships?.timeNotes, "id"),
    mediaPrompts: mergeRelated(entry.mediaPrompts, item.relationships?.mediaPrompts, "assetId"),
    videoAnalyses: mergeRelated(entry.videoAnalyses, item.relationships?.videoAnalyses, "id"),
    facetAssignments: mergeRelated(entry.facetAssignments, item.relationships?.facetAssignments, "nodeId"),
    primaryMediaId: clean(item.relationships?.primaryMediaId) || entry.primaryMediaId
  };
  const originalDocument = item.relationships?.articleDocument ?? null;
  if (originalDocument) next.articleDocument = originalDocument;
  else delete next.articleDocument;
  entries[entryIndex] = normalizeEntryMedia(next);
  return { ok: true };
}

function restoreRelatedCompoundCases(currentValue, entries, restoredEntryItems) {
  if (!Array.isArray(currentValue)) return undefined;
  const activeEntryIds = new Set(entries.map((entry) => clean(entry?.id)).filter(Boolean));
  const snapshots = new Map();
  for (const item of restoredEntryItems) {
    for (const snapshot of Array.isArray(item.relationships?.compoundCases) ? item.relationships.compoundCases : []) {
      const id = clean(snapshot?.id);
      if (id && Array.isArray(snapshot?.memberEntryIds) && snapshot.memberEntryIds.every((entryId) => activeEntryIds.has(clean(entryId)))) {
        snapshots.set(id, snapshot);
      }
    }
  }
  const current = normalizeCompoundCases(currentValue, entries);
  if (!snapshots.size) return current;
  const replacedIds = new Set(snapshots.keys());
  return normalizeCompoundCases([
    ...current.filter((compound) => !replacedIds.has(compound.id)),
    ...snapshots.values()
  ], entries);
}

function unresolvedIssue(reason, details = {}) {
  return { ok: false, issue: { reason, ...details } };
}

function mergeRelated(currentValue, restoredValue, key) {
  const current = Array.isArray(currentValue) ? currentValue : [];
  const seen = new Set(current.map((item) => clean(item?.[key])).filter(Boolean));
  return [...current, ...(Array.isArray(restoredValue) ? restoredValue : []).filter((item) => {
    const id = clean(item?.[key]);
    if (!id || seen.has(id)) return false;
    seen.add(id);
    return true;
  })];
}

function safeIndex(value) {
  const number = Number(value);
  return Number.isSafeInteger(number) && number >= 0 ? number : Number.MAX_SAFE_INTEGER;
}

function jsonEqual(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function normalizeTrashItem(value = {}) {
  const id = clean(value?.id);
  const kind = clean(value?.kind);
  const targetId = clean(value?.targetId);
  const deletedAt = validIso(value?.deletedAt);
  if (!id || !TRASH_KINDS.has(kind) || !targetId || !deletedAt) return null;
  const snapshot = serializableObject(value.snapshot);
  const relationships = serializableObject(value.relationships);
  return { id, kind, targetId, deletedAt, snapshot, relationships };
}

function serializableObject(value) {
  const normalized = toSerializable(value, new Set());
  return normalized && normalized !== OMIT && !Array.isArray(normalized) ? normalized : {};
}

function toSerializable(value, ancestors) {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") return Number.isFinite(value) ? value : OMIT;
  if (typeof value !== "object") return OMIT;
  if (ancestors.has(value)) return OMIT;
  ancestors.add(value);
  let result;
  if (Array.isArray(value)) {
    result = value.flatMap((item) => {
      const normalized = toSerializable(item, ancestors);
      return normalized === OMIT ? [] : [normalized];
    });
  } else {
    result = {};
    for (const [key, item] of Object.entries(value)) {
      if (["__proto__", "prototype", "constructor"].includes(key)) continue;
      const normalized = toSerializable(item, ancestors);
      if (normalized !== OMIT) result[key] = normalized;
    }
  }
  ancestors.delete(value);
  return result;
}

function validIso(value) {
  const text = clean(value);
  return text && Number.isFinite(Date.parse(text)) ? new Date(text).toISOString() : "";
}

function operationTime(value) {
  const normalized = validIso(value ?? new Date().toISOString());
  if (!normalized) throw new Error("删除时间无效");
  return normalized;
}

function trashItemId(kind, targetId, parentId = "") {
  return ["trash", kind, parentId, targetId].filter(Boolean).join(":");
}

function uniqueIds(values) {
  return [...new Set((Array.isArray(values) ? values : []).map(clean).filter(Boolean))];
}

function relatedValues(values, ids, fields) {
  return (Array.isArray(values) ? values : []).filter((value) =>
    fields.some((field) => ids.has(clean(value?.[field])))
  );
}

function clean(value) {
  return String(value ?? "").replace(/[\u0000-\u001f\u007f]/g, "").trim();
}
