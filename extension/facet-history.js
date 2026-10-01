import { sameUndoState } from "./undo-state.js";
import { libraryFacetAssignments } from './facet-assignments.js';

export const FACET_UNDO_HISTORY_VERSION = 2;
export const FACET_UNDO_LIMIT = 10;

export function appendFacetUndo(value, beforeState, afterState, options = {}) {
  const history = normalizeFacetUndoHistory(value);
  return {
    version: FACET_UNDO_HISTORY_VERSION,
    steps: [...history.steps, createUndoStep(beforeState, afterState, options)].slice(-FACET_UNDO_LIMIT)
  };
}

export function undoFacetHistory(currentState, value) {
  const history = normalizeFacetUndoHistory(value);
  const step = history.steps.at(-1);
  if (!step) throw new Error("没有可撤回的词库更新");
  if (!sameValue(currentState.facetCatalog, step.afterFacetCatalog)) {
    throw new Error("标签库在这次操作后又被修改，为保护新内容，无法撤回");
  }

  const restoredEntries = new Map(step.entries.map((item) => [item.id, item.entry]));
  const currentEntries = new Map((currentState.entries ?? []).map((entry) => [entry.id, entry]));
  for (const item of step.entries) {
    const current = currentEntries.get(item.id);
    if (current && !sameValue(current, item.after)) {
      throw new Error("案例在这次标签操作后又被修改，为保护新内容，无法撤回");
    }
  }
  const state = structuredClone(currentState);
  state.facetCatalog = structuredClone(step.facetCatalog);
  state.entries = (state.entries ?? []).map((entry) =>
    restoredEntries.has(entry.id) ? structuredClone(restoredEntries.get(entry.id)) : entry
  );
  assertFacetUndoPreservesReferences(currentState, state);
  const steps = history.steps.slice(0, -1);
  return {
    state,
    history: { version: FACET_UNDO_HISTORY_VERSION, steps },
    remainingSteps: steps.length,
    entriesChanged: step.entries.some((item) => currentEntries.has(item.id))
  };
}

// Catalog rollback must also preserve tags adopted by later cases or trash snapshots.
export function assertFacetUndoPreservesReferences(currentState, restoredState) {
  const beforeNodes = new Set((currentState.facetCatalog?.nodes ?? []).map((item) => item.id));
  const afterNodes = new Set((restoredState.facetCatalog?.nodes ?? []).map((item) => item.id));
  const removedNodes = new Set([...beforeNodes].filter((id) => !afterNodes.has(id)));
  if (!removedNodes.size) return;
  if (libraryFacetAssignments(restoredState).some(item => removedNodes.has(item.nodeId))) {
    throw new Error("其他案例或回收站仍在使用这次新增的标签，为保护资料，本次没有撤回");
  }
}

export function facetUndoCount(value) {
  if (value?.version === FACET_UNDO_HISTORY_VERSION && Array.isArray(value.steps)) {
    return value.steps.filter(isUndoStep).length;
  }
  return 0;
}

export function normalizeFacetUndoHistory(value) {
  if (value?.version === FACET_UNDO_HISTORY_VERSION && Array.isArray(value.steps)) {
    return {
      version: FACET_UNDO_HISTORY_VERSION,
      steps: value.steps.filter(isUndoStep).slice(-FACET_UNDO_LIMIT).map((step) => structuredClone(step))
    };
  }
  return { version: FACET_UNDO_HISTORY_VERSION, steps: [] };
}

function createUndoStep(beforeState = {}, afterState = {}, { entriesChanged = true } = {}) {
  if (!entriesChanged) {
    return {
      facetCatalog: structuredClone(beforeState.facetCatalog),
      afterFacetCatalog: structuredClone(afterState.facetCatalog),
      entries: []
    };
  }
  const afterEntries = new Map((afterState.entries ?? []).map((entry) => [entry.id, entry]));
  if (afterEntries.size !== (beforeState.entries ?? []).length
    || (beforeState.entries ?? []).some((entry) => !afterEntries.has(entry.id))) {
    throw new Error("标签操作改变了案例数量，未保存以保护资料库");
  }
  const entries = (beforeState.entries ?? []).flatMap((entry) =>
    sameValue(entry, afterEntries.get(entry.id)) ? [] : [{
      id: entry.id,
      entry: structuredClone(entry),
      after: structuredClone(afterEntries.get(entry.id))
    }]
  );
  return {
    facetCatalog: structuredClone(beforeState.facetCatalog),
    afterFacetCatalog: structuredClone(afterState.facetCatalog),
    entries
  };
}

function isUndoStep(value) {
  return Boolean(value?.facetCatalog && value.afterFacetCatalog && Array.isArray(value.entries)
    && value.entries.every((item) => item?.id && item.entry && item.after));
}

function sameValue(left, right) {
  return sameUndoState(left, right);
}
