export const ORGANIZER_VERSION = 6;

export const COLLECTION_VISIBILITY = Object.freeze({
  library: "library",
  projectOnly: "project-only"
});

export function createDefaultOrganizerState() {
  return {
    version: ORGANIZER_VERSION,
    collections: []
  };
}

export function normalizeOrganizerState(value = {}, validEntryIds) {
  const allowed = validEntryIds ? new Set(validEntryIds) : null;
  const collections = uniqueById(value.collections, normalizeCollection)
    .map((item, order) => ({
      ...item,
      order: Number.isFinite(item.order) ? item.order : order,
      entryIds: item.entryIds.filter((id) => !allowed || allowed.has(id))
    }))
    .sort(byOrder)
    .map((item, order) => ({ ...item, order }));
  return { version: ORGANIZER_VERSION, collections };
}

export function createCollection(stateValue, name) {
  const state = structuredClone(normalizeOrganizerState(stateValue));
  const cleaned = cleanName(name);
  if (!cleaned) throw new Error("项目名称不能为空");
  if (state.collections.some((item) => canonical(item.name) === canonical(cleaned))) {
    throw new Error("这个项目已经存在");
  }
  const item = {
    id: `collection:${globalThis.crypto.randomUUID()}`,
    name: cleaned,
    order: state.collections.length,
    entryIds: [],
    visibility: COLLECTION_VISIBILITY.library,
    createdAt: new Date().toISOString()
  };
  state.collections.push(item);
  return { state, item };
}

export function renameCollection(stateValue, collectionId, name) {
  const state = structuredClone(normalizeOrganizerState(stateValue));
  const target = state.collections.find((item) => item.id === cleanId(collectionId));
  const cleaned = cleanName(name);
  if (!target || !cleaned) throw new Error("项目名称无效");
  if (state.collections.some((item) => item.id !== target.id && canonical(item.name) === canonical(cleaned))) {
    throw new Error("这个项目已经存在");
  }
  target.name = cleaned;
  return state;
}

export function deleteCollection(stateValue, collectionId) {
  const state = structuredClone(normalizeOrganizerState(stateValue));
  const id = cleanId(collectionId);
  if (!state.collections.some((item) => item.id === id)) throw new Error("项目不存在");
  state.collections = state.collections.filter((item) => item.id !== id);
  return normalizeOrganizerState(state);
}

export function reorderCollections(stateValue, collectionIds) {
  const state = structuredClone(normalizeOrganizerState(stateValue));
  const requested = uniqueIds(collectionIds);
  const existingIds = new Set(state.collections.map((item) => item.id));
  if (requested.length !== state.collections.length || requested.some((id) => !existingIds.has(id))) {
    throw new Error("项目排序列表已经变化，请刷新后重试");
  }
  const byId = new Map(state.collections.map((item) => [item.id, item]));
  state.collections = requested.map((id, order) => ({ ...byId.get(id), order }));
  return normalizeOrganizerState(state);
}

export function planCollectionAndEntriesDeletion(stateValue, entriesValue, collectionId, confirmationName) {
  const entries = Array.isArray(entriesValue) ? entriesValue : [];
  const organizerState = normalizeOrganizerState(stateValue, entries.map((entry) => entry?.id));
  const id = cleanId(collectionId);
  const collection = organizerState.collections.find((item) => item.id === id);
  if (!collection) throw new Error("项目不存在");
  if (cleanName(confirmationName) !== collection.name) throw new Error("项目名称不匹配，未执行删除");
  const deletedEntryIds = [...collection.entryIds];
  const deletedIds = new Set(deletedEntryIds);
  const remainingEntries = entries.filter((entry) => !deletedIds.has(cleanId(entry?.id)));
  const withoutEntries = removeEntriesFromOrganizer(organizerState, deletedEntryIds);
  return {
    collection,
    deletedEntryIds,
    deletedEntries: entries.filter((entry) => deletedIds.has(cleanId(entry?.id))),
    entries: remainingEntries,
    organizerState: deleteCollection(withoutEntries, collection.id)
  };
}

export function setEntriesCollection(stateValue, collectionId, entryIds, selected) {
  const state = structuredClone(normalizeOrganizerState(stateValue));
  const collection = state.collections.find((item) => item.id === cleanId(collectionId));
  if (!collection) throw new Error("项目不存在");
  const members = new Set(collection.entryIds);
  for (const id of uniqueIds(entryIds)) selected ? members.add(id) : members.delete(id);
  collection.entryIds = [...members];
  return state;
}

export function replaceCollectionEntries(stateValue, collectionId, entryIds) {
  const state = structuredClone(normalizeOrganizerState(stateValue));
  const collection = state.collections.find((item) => item.id === cleanId(collectionId));
  if (!collection) throw new Error("项目不存在");
  collection.entryIds = uniqueIds(entryIds);
  return state;
}

export function setCollectionVisibility(stateValue, collectionId, visibility) {
  const state = structuredClone(normalizeOrganizerState(stateValue));
  const collection = state.collections.find((item) => item.id === cleanId(collectionId));
  if (!collection) throw new Error("项目不存在");
  collection.visibility = normalizeVisibility(visibility);
  return state;
}

export function isEntryVisibleInLibrary(stateValue, entryId) {
  const id = cleanId(entryId);
  if (!id) return false;
  const memberships = normalizeOrganizerState(stateValue).collections.filter((item) => item.entryIds.includes(id));
  return !memberships.length || memberships.some((item) => item.visibility === COLLECTION_VISIBILITY.library);
}

export function removeEntriesFromOrganizer(stateValue, entryIds) {
  const state = structuredClone(normalizeOrganizerState(stateValue));
  const removed = new Set(uniqueIds(entryIds));
  state.collections.forEach((item) => {
    item.entryIds = item.entryIds.filter((id) => !removed.has(id));
  });
  return state;
}

export function mergeOrganizerState(currentValue, importedValue, entryIdMap = {}, options = {}) {
  const current = structuredClone(normalizeOrganizerState(currentValue));
  const imported = normalizeOrganizerState(importedValue);
  const remap = (ids) => uniqueIds(ids).map((id) => cleanId(entryIdMap[id])).filter(Boolean);
  const receiverCreatedAt = normalizeTimestamp(options.createdAt);

  for (const source of imported.collections) {
    const existing = current.collections.find((item) => canonical(item.name) === canonical(source.name));
    if (existing) {
      existing.entryIds = uniqueIds([...existing.entryIds, ...remap(source.entryIds)]);
      continue;
    }
    const id = current.collections.some((item) => item.id === source.id)
      ? `collection:${globalThis.crypto.randomUUID()}`
      : source.id;
    current.collections.push({
      ...source,
      id,
      order: current.collections.length,
      entryIds: remap(source.entryIds),
      ...(receiverCreatedAt ? { createdAt: receiverCreatedAt } : {})
    });
  }
  return normalizeOrganizerState(current);
}

function normalizeCollection(value = {}) {
  const id = cleanId(value.id);
  const name = cleanName(value.name);
  if (!id || !name) return null;
  const createdAt = normalizeTimestamp(value.createdAt);
  return {
    id,
    name,
    order: Number(value.order),
    entryIds: uniqueIds(value.entryIds),
    visibility: normalizeVisibility(value.visibility),
    ...(createdAt ? { createdAt } : {})
  };
}

function normalizeTimestamp(value) {
  const timestamp = String(value ?? "").trim();
  return timestamp && Number.isFinite(Date.parse(timestamp)) ? timestamp : "";
}

function normalizeVisibility(value) {
  return value === COLLECTION_VISIBILITY.projectOnly
    ? COLLECTION_VISIBILITY.projectOnly
    : COLLECTION_VISIBILITY.library;
}

function uniqueById(values, normalize) {
  const result = new Map();
  for (const value of Array.isArray(values) ? values : []) {
    const item = normalize(value);
    if (item && !result.has(item.id)) result.set(item.id, item);
  }
  return [...result.values()];
}

function uniqueIds(values) {
  return [...new Set((Array.isArray(values) ? values : []).map(cleanId).filter(Boolean))];
}

function cleanId(value) {
  return String(value ?? "").replace(/[\u0000-\u001f\u007f]/g, "").trim();
}

function cleanName(value) {
  return cleanId(value).replace(/\s+/g, " ");
}

function canonical(value) {
  return cleanName(value).toLocaleLowerCase().replace(/[\s._-]+/g, "");
}

function byOrder(left, right) {
  return left.order - right.order || left.name.localeCompare(right.name);
}
