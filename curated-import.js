import { curatedSourceKey } from "./curated-catalog.js";
import { mergeLibraryPackage } from "./library-package.js";
import { COLLECTION_VISIBILITY, createDefaultOrganizerState, normalizeOrganizerState } from "./organizer.js";

export function mergeCuratedLibraryPackage(currentValue = {}, libraryValue = {}, options = {}) {
  const packageId = clean(options.packageId);
  const projectName = clean(options.projectName);
  const mode = options.mode === "package" ? "package" : "case";
  const requestedCreatedAt = clean(options.now);
  const projectCreatedAt = requestedCreatedAt && Number.isFinite(Date.parse(requestedCreatedAt))
    ? new Date(requestedCreatedAt).toISOString()
    : new Date().toISOString();
  if (!packageId) throw new Error("精选案例包缺少稳定编号");
  if (mode === "package" && !projectName) throw new Error("精选案例包缺少项目名称");

  const current = structuredClone(currentValue);
  const imported = structuredClone(libraryValue);
  const sourceEntries = Array.isArray(imported.entries) ? imported.entries : [];
  if (!sourceEntries.length) throw new Error("精选案例包没有可保存案例");

  const currentBySource = new Map();
  for (const entry of Array.isArray(current.entries) ? current.entries : []) {
    const key = curatedSourceKey(entry);
    if (key && !currentBySource.has(key)) currentBySource.set(key, entry);
  }

  const originalToAdaptedId = new Map();
  const sourceEntryIds = new Set();
  const existingSourceEntryIds = new Set();
  for (const entry of sourceEntries) {
    if (clean(entry.curatedOrigin?.packageId) !== packageId) throw new Error("精选案例来源与案例包不一致");
    const sourceEntryId = clean(entry.curatedOrigin?.sourceEntryId);
    const key = curatedSourceKey(entry);
    if (!sourceEntryId || !key || sourceEntryIds.has(sourceEntryId)) throw new Error("精选案例来源编号无效或重复");
    sourceEntryIds.add(sourceEntryId);
    const existing = currentBySource.get(key);
    const originalId = clean(entry.id);
    const adaptedId = existing?.id || originalId;
    originalToAdaptedId.set(originalId, adaptedId);
    entry.id = adaptedId;
    if (existing) existingSourceEntryIds.add(sourceEntryId);
  }
  remapEntryRelationships(imported, originalToAdaptedId);
  imported.organizerState = createDefaultOrganizerState();

  const result = mergeLibraryPackage(current, imported, {
    entryIdMap: remapPreferredIds(options.entryIdMap, originalToAdaptedId),
    compoundIdMap: options.compoundIdMap,
    visualIdMap: options.visualIdMap,
    sessionIdMap: options.sessionIdMap,
    runIdMap: options.runIdMap,
    preserveLibraryConfiguration: true,
    skipExistingEntryIds: true,
    now: projectCreatedAt
  });

  const entriesBySourceEntryId = {};
  const entryIds = [];
  for (const sourceEntryId of sourceEntryIds) {
    const key = curatedSourceKey({ curatedOrigin: { packageId, sourceEntryId } });
    if (!key) throw new Error("精选案例来源编号无效");
    const entry = result.state.entries.find((candidate) => curatedSourceKey(candidate) === key);
    if (!entry) throw new Error("精选案例没有写入私人案例库");
    entriesBySourceEntryId[sourceEntryId] = entry.id;
    entryIds.push(entry.id);
  }

  let projectId = "";
  if (mode === "package") {
    projectId = `curated-project:${safeId(packageId)}`;
    const organizer = normalizeOrganizerState(result.state.organizerState, result.state.entries.map((entry) => entry.id));
    const existingProject = organizer.collections.find((collection) => collection.id === projectId);
    if (existingProject) {
      existingProject.entryIds = [...new Set([...existingProject.entryIds, ...entryIds])];
    } else {
      organizer.collections.push({
        id: projectId,
        name: projectName,
        order: organizer.collections.length,
        entryIds,
        visibility: COLLECTION_VISIBILITY.library,
        createdAt: projectCreatedAt
      });
    }
    result.state.organizerState = normalizeOrganizerState(organizer, result.state.entries.map((entry) => entry.id));
  }

  const importedSourceEntryIds = [...sourceEntryIds].filter((id) => !existingSourceEntryIds.has(id));
  const importedEntryIds = importedSourceEntryIds.map((id) => entriesBySourceEntryId[id]);
  const importedEntryIdSet = new Set(importedEntryIds);
  const importedVisualIds = result.state.entries
    .filter((entry) => importedEntryIdSet.has(entry.id))
    .flatMap((entry) => (entry.mediaAssets ?? []).filter((asset) => asset.storageMode !== "reference").map((asset) => asset.id));

  return {
    ...result,
    entryIdMap: restoreOriginalIdMap(result.entryIdMap, originalToAdaptedId),
    importedCount: importedSourceEntryIds.length,
    existingCount: sourceEntryIds.size - importedSourceEntryIds.length,
    sourceEntryIds: [...sourceEntryIds],
    importedSourceEntryIds,
    entriesBySourceEntryId,
    importedEntryIds,
    importedVisualIds,
    projectId
  };
}

function remapEntryRelationships(library, idMap) {
  for (const entry of library.entries ?? []) {
    if (entry.creationMeta?.sourceEntryIds) {
      entry.creationMeta.sourceEntryIds = entry.creationMeta.sourceEntryIds.map((id) => idMap.get(id) ?? id);
    }
  }
  for (const item of library.compoundCases ?? []) {
    item.memberEntryIds = (item.memberEntryIds ?? []).map((id) => idMap.get(id) ?? id);
  }
  for (const collection of library.organizerState?.collections ?? []) {
    collection.entryIds = (collection.entryIds ?? []).map((id) => idMap.get(id) ?? id);
  }
}

function remapPreferredIds(value = {}, idMap) {
  const preferred = {};
  for (const [sourceId, targetId] of Object.entries(value ?? {})) {
    preferred[idMap.get(sourceId) ?? sourceId] = targetId;
  }
  return preferred;
}

function restoreOriginalIdMap(value = {}, idMap) {
  const restored = {};
  for (const [originalId, adaptedId] of idMap) {
    if (value[adaptedId]) restored[originalId] = value[adaptedId];
  }
  return restored;
}

function clean(value) {
  return String(value ?? "").replace(/[\u0000-\u001f\u007f]/g, "").trim();
}

function safeId(value) {
  const id = clean(value);
  if (!/^[A-Za-z0-9._-]+$/.test(id) || id === "." || id === "..") throw new Error("精选编号无效");
  return id;
}
