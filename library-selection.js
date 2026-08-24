import { expandLogicalCaseIds } from "./compound-cases.js";
import { uniqueNames } from "./facets.js";

export const LIBRARY_BATCH_ACTIONS = Object.freeze({
  addCustomLabels: "BATCH_ADD_CUSTOM_LABELS",
  setProject: "BATCH_SET_PROJECT",
  moveToTrash: "BATCH_MOVE_TO_TRASH"
});

const PROJECT_MODES = new Set(["add", "remove", "move"]);

export function normalizeSelectedLogicalCaseIds(values = []) {
  return uniqueIds(values);
}

export function selectAllFilteredLogicalCases(filteredLogicalCaseIds = []) {
  return uniqueIds(filteredLogicalCaseIds);
}

export function clearLibrarySelection() {
  return [];
}

export function toggleLibraryCaseSelection(selectedLogicalCaseIds = [], logicalCaseId) {
  const selected = normalizeSelectedLogicalCaseIds(selectedLogicalCaseIds);
  const id = clean(logicalCaseId);
  if (!id) return selected;
  return selected.includes(id)
    ? selected.filter((selectedId) => selectedId !== id)
    : [...selected, id];
}

export function expandLibrarySelection(selectedLogicalCaseIds = [], compoundCases = []) {
  return expandLogicalCaseIds(normalizeSelectedLogicalCaseIds(selectedLogicalCaseIds), compoundCases);
}

export function buildLibraryBatchPayload(selectedLogicalCaseIds = [], compoundCases = [], operation = {}) {
  const entryIds = expandLibrarySelection(selectedLogicalCaseIds, compoundCases);
  if (!entryIds.length) throw new Error("请至少选择一个案例");

  if (operation.type === LIBRARY_BATCH_ACTIONS.addCustomLabels) {
    return {
      type: LIBRARY_BATCH_ACTIONS.addCustomLabels,
      entryIds,
      customLabels: uniqueNames(operation.customLabels)
    };
  }

  if (operation.type === LIBRARY_BATCH_ACTIONS.setProject) {
    const collectionId = clean(operation.collectionId);
    const mode = clean(operation.mode);
    if (!collectionId) throw new Error("请选择项目");
    if (!PROJECT_MODES.has(mode)) throw new Error("项目批量操作必须明确选择加入、移出或移动");
    return {
      type: LIBRARY_BATCH_ACTIONS.setProject,
      entryIds,
      collectionId,
      mode
    };
  }

  if (operation.type === LIBRARY_BATCH_ACTIONS.moveToTrash) {
    return { type: LIBRARY_BATCH_ACTIONS.moveToTrash, entryIds };
  }

  throw new Error("不支持的批量操作");
}

function uniqueIds(values = []) {
  const source = Array.isArray(values)
    ? values
    : values instanceof Set ? [...values] : [];
  return [...new Set(source.map(clean).filter(Boolean))];
}

function clean(value) {
  return String(value ?? "").replace(/[\u0000-\u001f\u007f]/g, "").trim();
}
