export const ORGANIZER_VERSION = 7;

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
    }));
  const ids = new Set(collections.map((item) => item.id));
  const byId = new Map(collections.map((item) => [item.id, item]));
  for (const item of collections) {
    if (!ids.has(item.parentId) || item.parentId === item.id) item.parentId = null;
  }
  const resolved = new Set();
  for (const item of collections) {
    if (resolved.has(item.id)) continue;
    const path = [];
    const positions = new Map();
    let current = item;
    while (current && !resolved.has(current.id)) {
      if (positions.has(current.id)) {
        current.parentId = null;
        break;
      }
      positions.set(current.id, path.length);
      path.push(current);
      current = current.parentId ? byId.get(current.parentId) : null;
    }
    path.forEach((entry) => resolved.add(entry.id));
  }
  const childrenByParent = new Map();
  for (const item of collections) {
    const siblings = childrenByParent.get(item.parentId) ?? [];
    siblings.push(item);
    childrenByParent.set(item.parentId, siblings);
  }
  for (const siblings of childrenByParent.values()) {
    siblings.sort(byOrder).forEach((item, order) => { item.order = order; });
  }
  const ordered = [];
  const stack = [...(childrenByParent.get(null) ?? [])].reverse();
  while (stack.length) {
    const item = stack.pop();
    ordered.push(item);
    const children = childrenByParent.get(item.id) ?? [];
    for (let index = children.length - 1; index >= 0; index -= 1) stack.push(children[index]);
  }
  return { version: ORGANIZER_VERSION, collections: ordered };
}

export function createCollection(stateValue, name, parentId = null) {
  const state = structuredClone(normalizeOrganizerState(stateValue));
  const cleaned = cleanName(name);
  const parent = cleanId(parentId) || null;
  if (!cleaned) throw new Error("项目名称不能为空");
  if (parent && !state.collections.some((item) => item.id === parent)) throw new Error("父项目不存在");
  if (state.collections.some((item) => item.parentId === parent && canonical(item.name) === canonical(cleaned))) {
    throw new Error("这个项目已经存在");
  }
  const item = {
    id: `collection:${globalThis.crypto.randomUUID()}`,
    name: cleaned,
    parentId: parent,
    order: state.collections.filter((collection) => collection.parentId === parent).length,
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
  if (state.collections.some((item) => item.id !== target.id && item.parentId === target.parentId && canonical(item.name) === canonical(cleaned))) {
    throw new Error("这个项目已经存在");
  }
  target.name = cleaned;
  return state;
}

export function deleteCollection(stateValue, collectionId) {
  const state = structuredClone(normalizeOrganizerState(stateValue));
  const id = cleanId(collectionId);
  if (!state.collections.some((item) => item.id === id)) throw new Error("项目不存在");
  const removed = new Set(collectionSubtreeIds(state, id));
  state.collections = state.collections.filter((item) => !removed.has(item.id));
  return normalizeOrganizerState(state);
}

export function reorderCollections(stateValue, collectionIds) {
  const state = structuredClone(normalizeOrganizerState(stateValue));
  const requested = uniqueIds(collectionIds);
  const roots = state.collections.filter((item) => item.parentId === null);
  const existingIds = new Set(roots.map((item) => item.id));
  if (requested.length !== roots.length || requested.some((id) => !existingIds.has(id))) {
    throw new Error("项目排序列表已经变化，请刷新后重试");
  }
  const byId = new Map(state.collections.map((item) => [item.id, item]));
  requested.forEach((id, order) => { byId.get(id).order = order; });
  return normalizeOrganizerState(state);
}

export function moveCollection(stateValue, collectionId, parentId = null, index = 0) {
  const state = structuredClone(normalizeOrganizerState(stateValue));
  const id = cleanId(collectionId);
  const parent = cleanId(parentId) || null;
  const target = state.collections.find((item) => item.id === id);
  if (!target) throw new Error("项目不存在");
  if (parent && !state.collections.some((item) => item.id === parent)) throw new Error("父项目不存在");
  if (parent === id || collectionSubtreeIds(state, id).includes(parent)) throw new Error("不能把项目移入自身或其子项目");
  const oldParent = target.parentId;
  const oldSiblings = state.collections.filter((item) => item.parentId === oldParent && item.id !== id);
  const newSiblings = oldParent === parent
    ? oldSiblings
    : state.collections.filter((item) => item.parentId === parent && item.id !== id);
  const insertAt = Math.max(0, Math.min(newSiblings.length, Math.floor(Number(index) || 0)));
  target.parentId = parent;
  newSiblings.splice(insertAt, 0, target);
  newSiblings.forEach((item, order) => { item.order = order; });
  if (oldParent !== parent) oldSiblings.forEach((item, order) => { item.order = order; });
  return normalizeOrganizerState(state);
}

export function collectionSubtreeIds(stateValue, collectionId) {
  const state = normalizeOrganizerState(stateValue);
  const id = cleanId(collectionId);
  return subtreeIdsFromCollections(state.collections, id);
}

export function collectionEntryIds(stateValue, collectionId, options = {}) {
  const state = normalizeOrganizerState(stateValue);
  const id = cleanId(collectionId);
  if (options.subtree === true) return collectionSubtreeEntryIdsById(state).get(id) ?? [];
  return [...(state.collections.find((item) => item.id === id)?.entryIds ?? [])];
}

export function collectionSubtreeEntryIdsById(stateValue) {
  const state = normalizeOrganizerState(stateValue);
  const result = new Map(state.collections.map((item) => [item.id, new Set(item.entryIds)]));
  for (let index = state.collections.length - 1; index >= 0; index -= 1) {
    const item = state.collections[index];
    if (!item.parentId) continue;
    const parentEntries = result.get(item.parentId);
    for (const entryId of result.get(item.id) ?? []) parentEntries?.add(entryId);
  }
  return new Map([...result].map(([id, entryIds]) => [id, [...entryIds]]));
}

export function collectionPath(stateValue, collectionId) {
  const state = normalizeOrganizerState(stateValue);
  const byId = new Map(state.collections.map((item) => [item.id, item]));
  const result = [];
  let current = byId.get(cleanId(collectionId));
  while (current) {
    result.unshift(current);
    current = current.parentId ? byId.get(current.parentId) : null;
  }
  return result;
}

export function collectionPathLabel(stateValue, collectionId, separator = " / ") {
  return collectionPath(stateValue, collectionId).map((item) => item.name).join(separator);
}

export function collectionSelectorLabel(stateValue, collectionId) {
  return collectionSelectorLabelsById(stateValue).get(cleanId(collectionId)) ?? "";
}

export function collectionPathLabelsById(stateValue, separator = " / ") {
  return collectionLabelsById(stateValue, separator, (name) => name);
}

export function collectionSelectorLabelsById(stateValue) {
  return collectionLabelsById(stateValue, " › ", (name) => name.replaceAll("›", "››"));
}

export function planCollectionAndEntriesDeletion(stateValue, entriesValue, collectionId, confirmationName) {
  const entries = Array.isArray(entriesValue) ? entriesValue : [];
  const organizerState = normalizeOrganizerState(stateValue, entries.map((entry) => entry?.id));
  const id = cleanId(collectionId);
  const collection = organizerState.collections.find((item) => item.id === id);
  if (!collection) throw new Error("项目不存在");
  if (cleanName(confirmationName) !== collection.name) throw new Error("项目名称不匹配，未执行删除");
  const deletedEntryIds = collectionEntryIds(organizerState, collection.id, { subtree: true });
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
  return mergeOrganizerStateWithMap(currentValue, importedValue, entryIdMap, options).state;
}

export function mergeOrganizerStateWithMap(currentValue, importedValue, entryIdMap = {}, options = {}) {
  const current = structuredClone(normalizeOrganizerState(currentValue));
  const imported = normalizeOrganizerState(importedValue);
  const remap = (ids) => uniqueIds(ids).map((id) => cleanId(entryIdMap[id])).filter(Boolean);
  const receiverCreatedAt = normalizeTimestamp(options.createdAt);

  const collectionIdMap = new Map();
  for (const source of imported.collections) {
    const parentId = source.parentId ? collectionIdMap.get(source.parentId) ?? null : null;
    const existing = current.collections.find((item) => item.parentId === parentId && canonical(item.name) === canonical(source.name));
    if (existing) {
      existing.entryIds = uniqueIds([...existing.entryIds, ...remap(source.entryIds)]);
      collectionIdMap.set(source.id, existing.id);
      continue;
    }
    const id = current.collections.some((item) => item.id === source.id)
      ? `collection:${globalThis.crypto.randomUUID()}`
      : source.id;
    current.collections.push({
      ...source,
      id,
      parentId,
      order: current.collections.filter((item) => item.parentId === parentId).length,
      entryIds: remap(source.entryIds),
      ...(receiverCreatedAt ? { createdAt: receiverCreatedAt } : {})
    });
    collectionIdMap.set(source.id, id);
  }
  return {
    state: normalizeOrganizerState(current),
    collectionIdMap: Object.fromEntries(collectionIdMap)
  };
}

function normalizeCollection(value = {}) {
  const id = cleanId(value.id);
  const name = cleanName(value.name);
  if (!id || !name) return null;
  const createdAt = normalizeTimestamp(value.createdAt);
  return {
    id,
    name,
    parentId: cleanId(value.parentId) || null,
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

function subtreeIdsFromCollections(collections, collectionId) {
  if (!collections.some((item) => item.id === collectionId)) return [];
  const childrenByParent = new Map();
  for (const item of collections) {
    const children = childrenByParent.get(item.parentId) ?? [];
    children.push(item.id);
    childrenByParent.set(item.parentId, children);
  }
  const result = [];
  const stack = [collectionId];
  while (stack.length) {
    const id = stack.pop();
    result.push(id);
    const children = childrenByParent.get(id) ?? [];
    for (let index = children.length - 1; index >= 0; index -= 1) stack.push(children[index]);
  }
  return result;
}

function collectionLabelsById(stateValue, separator, transformName) {
  const state = normalizeOrganizerState(stateValue);
  const result = new Map();
  for (const item of state.collections) {
    const name = transformName(item.name);
    const parentLabel = item.parentId ? result.get(item.parentId) : "";
    result.set(item.id, parentLabel ? `${parentLabel}${separator}${name}` : name);
  }
  return result;
}
