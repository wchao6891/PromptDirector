// Planning is side-effect free: callers commit the whole result atomically only
// after their import/upgrade checks pass. Original media bytes remain shared.
export function needsFolderOwnershipMigration(state = {}) {
  const logicalId = new Map();
  for (const compound of state.compoundCases ?? []) {
    for (const id of compound.memberEntryIds ?? []) logicalId.set(id, compound.id);
  }
  const owners = new Map();
  for (const collection of state.organizerState?.collections ?? []) {
    for (const id of collection.entryIds ?? []) {
      const key = logicalId.get(id) ?? id;
      if (owners.has(key) && owners.get(key) !== collection.id) return true;
      owners.set(key, collection.id);
    }
  }
  return false;
}

export function planFolderOwnership(stateValue) {
  const state = structuredClone(stateValue);
  const { entries, collections, groups, usedIds } = indexState(state);
  const copies = [];
  const locations = new Map();
  for (const collection of collections) {
    for (const id of collection.entryIds) {
      const group = groups.get(id);
      if (!group) throw new Error("项目包含不存在的案例，未转换资料");
      if (!locations.has(group)) locations.set(group, []);
      const list = locations.get(group);
      if (list.at(-1) !== collection) list.push(collection);
    }
  }
  for (const [group, folders] of locations) {
    const uniqueFolders = [...new Set(folders)];
    if (uniqueFolders.length < 2) continue;
    for (const collection of uniqueFolders.slice(1)) {
      const mapping = new Map(group.members.map(id => [id, reserveId(freeId(
        `folder-copy:${encodeURIComponent(id)}:${encodeURIComponent(collection.id)}`, usedIds
      ), usedIds)]));
      const copy = copyGroup(state, group, entries, mapping, usedIds,
        freeId(`folder-copy:${encodeURIComponent(group.id)}:${encodeURIComponent(collection.id)}`, usedIds));
      const members = new Set(group.members);
      const first = collection.entryIds.findIndex(id => members.has(id));
      collection.entryIds = collection.entryIds.filter(id => !members.has(id));
      collection.entryIds.splice(first, 0, ...copy.entryIds);
      copies.push({ sourceCaseId: group.id, collectionId: collection.id, ...copy });
    }
    // A compound shown through any member represents the whole logical case.
    const original = uniqueFolders[0];
    const members = new Set(group.members);
    const first = original.entryIds.findIndex(id => members.has(id));
    original.entryIds = original.entryIds.filter(id => !members.has(id));
    original.entryIds.splice(first, 0, ...group.members);
  }
  return { state, copies, changed: copies.length > 0 };
}

export function planCaseCopies(stateValue, caseIds, collectionId, options = {}) {
  const state = structuredClone(stateValue);
  const { entries, collections, groups, usedIds } = indexState(state);
  const collection = collections.find(item => item.id === collectionId);
  if (!collection) throw new Error("目标项目不存在");
  const requested = [...new Set(caseIds.map(id => {
    const group = groups.get(id);
    if (!group) throw new Error("案例已不存在，未复制");
    return group;
  }))];
  if (!requested.length) throw new Error("请先选择案例");
  const idFactory = options.idFactory ?? (() => globalThis.crypto.randomUUID());
  const copies = [];
  for (const group of requested) {
    const mapping = new Map(group.members.map(id => [id, reserveId(idFactory(), usedIds)]));
    const copy = copyGroup(state, group, entries, mapping, usedIds, idFactory());
    collection.entryIds.push(...copy.entryIds);
    copies.push({ sourceCaseId: group.id, collectionId, ...copy });
  }
  return { state, copies, changed: true };
}

function copyGroup(state, group, entries, mapping, usedIds, compoundId) {
  for (const id of group.members) {
    const original = entries.get(id);
    // Stable identity survives package sanitization and protects intentional
    // copies even when a selection share omits private folder names.
    original.caseInstanceId ||= `case-instance:${original.id}`;
    const copy = structuredClone(original);
    copy.id = mapping.get(id);
    copy.caseInstanceId = `case-instance:${copy.id}`;
    state.entries.push(copy);
  }
  let caseId = mapping.get(group.members[0]);
  if (group.compound) {
    const compound = structuredClone(group.compound);
    compound.id = reserveId(compoundId, usedIds);
    compound.memberEntryIds = group.members.map(id => mapping.get(id));
    state.compoundCases.push(compound);
    caseId = compound.id;
  }
  return { caseId, entryIds: group.members.map(id => mapping.get(id)), entryIdMap: Object.fromEntries(mapping) };
}

function indexState(state) {
  if (!Array.isArray(state.entries)) throw new Error("案例资料无效，未转换资料");
  state.organizerState ??= { collections: [] };
  state.organizerState.collections ??= [];
  state.compoundCases ??= [];
  const entries = new Map();
  const groups = new Map();
  const usedIds = new Set();
  for (const entry of state.entries) {
    reserveId(entry.id, usedIds);
    entries.set(entry.id, entry);
    groups.set(entry.id, { id: entry.id, members: [entry.id] });
  }
  const claimed = new Set();
  for (const compound of state.compoundCases) {
    reserveId(compound.id, usedIds);
    if (!Array.isArray(compound.memberEntryIds) || compound.memberEntryIds.length < 2) {
      throw new Error("组合案例关系无效，未转换资料");
    }
    const group = { id: compound.id, members: compound.memberEntryIds, compound };
    groups.set(compound.id, group);
    for (const id of group.members) {
      if (!entries.has(id) || claimed.has(id)) throw new Error("组合案例成员冲突，未转换资料");
      claimed.add(id);
      groups.set(id, group);
    }
  }
  const collections = state.organizerState.collections;
  const collectionIds = new Set();
  for (const item of collections) {
    reserveId(item.id, collectionIds);
    if (!Array.isArray(item.entryIds)) throw new Error("项目关系无效，未转换资料");
  }
  return { entries, collections, groups, usedIds };
}

function reserveId(id, usedIds) {
  if (typeof id !== "string" || !id.trim() || usedIds.has(id)) {
    throw new Error("案例编号冲突，未转换资料");
  }
  usedIds.add(id);
  return id;
}

function freeId(base, usedIds) {
  let id = base;
  let suffix = 1;
  while (usedIds.has(id)) id = `${base}:${suffix++}`;
  return id;
}
