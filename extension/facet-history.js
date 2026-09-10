export const FACET_UNDO_HISTORY_VERSION = 1;
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

  const restoredEntries = new Map(step.entries.map((item) => [item.id, item.entry]));
  const state = structuredClone(currentState);
  state.facetCatalog = structuredClone(step.facetCatalog);
  const currentEntries = new Map((state.entries ?? []).map((entry) => [entry.id, entry]));
  state.entries = Array.isArray(step.entryOrder)
    ? step.entryOrder.flatMap((id) => {
        const entry = restoredEntries.get(id) ?? currentEntries.get(id);
        return entry ? [structuredClone(entry)] : [];
      })
    : (state.entries ?? []).map((entry) =>
        restoredEntries.has(entry.id) ? structuredClone(restoredEntries.get(entry.id)) : entry
      );
  const steps = history.steps.slice(0, -1);
  return {
    state,
    history: { version: FACET_UNDO_HISTORY_VERSION, steps },
    remainingSteps: steps.length
  };
}

export function facetUndoCount(value) {
  if (value?.version === FACET_UNDO_HISTORY_VERSION && Array.isArray(value.steps)) {
    return value.steps.filter(isUndoStep).length;
  }
  return value?.facetCatalog && Array.isArray(value.entries) ? 1 : 0;
}

export function normalizeFacetUndoHistory(value) {
  if (value?.version === FACET_UNDO_HISTORY_VERSION && Array.isArray(value.steps)) {
    return {
      version: FACET_UNDO_HISTORY_VERSION,
      steps: value.steps.filter(isUndoStep).slice(-FACET_UNDO_LIMIT).map((step) => structuredClone(step))
    };
  }
  if (value?.facetCatalog && Array.isArray(value.entries)) {
    return {
      version: FACET_UNDO_HISTORY_VERSION,
      steps: [{
        facetCatalog: structuredClone(value.facetCatalog),
        entries: value.entries.map((entry) => ({ id: entry.id, entry: structuredClone(entry) }))
      }]
    };
  }
  return { version: FACET_UNDO_HISTORY_VERSION, steps: [] };
}

function createUndoStep(beforeState = {}, afterState = {}, { entriesChanged = true } = {}) {
  if (!entriesChanged) {
    return { facetCatalog: structuredClone(beforeState.facetCatalog), entries: [] };
  }
  const afterEntries = new Map((afterState.entries ?? []).map((entry) => [entry.id, entry]));
  const entries = (beforeState.entries ?? []).flatMap((entry) =>
    sameValue(entry, afterEntries.get(entry.id)) ? [] : [{ id: entry.id, entry: structuredClone(entry) }]
  );
  return {
    facetCatalog: structuredClone(beforeState.facetCatalog),
    entries,
    entryOrder: (beforeState.entries ?? []).map((entry) => entry.id)
  };
}

function isUndoStep(value) {
  return Boolean(value?.facetCatalog && Array.isArray(value.entries));
}

function sameValue(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}
