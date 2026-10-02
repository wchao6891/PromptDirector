import { sameUndoState } from "./undo-state.js";
import { inverseChanges, restoreChanges, undoDigest, isInverseChanges } from './undo-delta.js';
import { operationBudget } from './resource-policy.js';
import { libraryFacetAssignments } from './facet-assignments.js';

export const FACET_UNDO_HISTORY_VERSION = 4;
export const FACET_UNDO_LIMIT = 10;

export function appendFacetUndo(value, beforeState, afterState, options = {}) {
  const history = normalizeFacetUndoHistory(value);
  const steps = [...history.steps, createUndoStep(beforeState, afterState, options)].slice(-FACET_UNDO_LIMIT);
  const budget = operationBudget(options.budget).maxAutomaticHistoryBytes;
  const sizes = steps.map(step => new TextEncoder().encode(JSON.stringify(step)).length);
  let total = sizes.reduce((sum, size) => sum + size, 0);
  while (steps.length && total > budget) { steps.shift(); total -= sizes.shift(); }
  return { version: FACET_UNDO_HISTORY_VERSION, steps };

}

export function undoFacetHistory(currentState, value) {
  const history = normalizeFacetUndoHistory(value);
  const step = history.steps.at(-1);
  if (!step) throw new Error("没有可撤回的词库更新");
  if (undoDigest(currentState.facetCatalog) !== step.catalogAfterDigest) {
    throw new Error("标签库在这次操作后又被修改，为保护新内容，无法撤回");
  }

  const restoredEntries = new Map(step.entries.map((item) => [item.id, item]));
  const currentEntries = new Map((currentState.entries ?? []).map((entry) => [entry.id, entry]));
  for (const item of step.entries) {
    const current = currentEntries.get(item.id);
    if (current && undoDigest(current) !== item.afterDigest) {
      throw new Error("案例在这次标签操作后又被修改，为保护新内容，无法撤回");
    }
  }
  const state = { ...currentState, facetCatalog: restoreChanges(currentState.facetCatalog, step.catalogChanges) };
  const compounds = new Map((step.compounds ?? []).map(item => [item.id, item]));
  const currentCompounds = new Map((currentState.compoundCases ?? []).map(item => [item.id, item]));
  for (const item of step.compounds ?? []) {
    const current = currentCompounds.get(item.id);
    if (!current || undoDigest(current) !== item.afterDigest) throw new Error('组合案例在这次标签操作后又被修改，为保护新内容，无法撤回');
  }
  if (compounds.size) state.compoundCases = currentState.compoundCases.map(item => compounds.has(item.id)
    ? restoreChanges(item, compounds.get(item.id).changes) : item);
  state.entries = (state.entries ?? []).map((entry) =>
    restoredEntries.has(entry.id) ? restoreChanges(entry, restoredEntries.get(entry.id).changes) : entry
  );
  assertFacetUndoPreservesReferences(currentState, state);
  const steps = history.steps.slice(0, -1);
  return {
    state,
    history: { version: FACET_UNDO_HISTORY_VERSION, steps },
    remainingSteps: steps.length,
    entriesChanged: step.entries.some((item) => currentEntries.has(item.id)),
    compoundsChanged: compounds.size > 0
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
  return [2, 3, FACET_UNDO_HISTORY_VERSION].includes(value?.version) && Array.isArray(value.steps)
    ? value.steps.filter(step => isUndoStep(step) || isLegacyStep(step)).length : 0;
}

export function normalizeFacetUndoHistory(value) {
  if (![2, 3, FACET_UNDO_HISTORY_VERSION].includes(value?.version) || !Array.isArray(value.steps)) return { version: FACET_UNDO_HISTORY_VERSION, steps: [] };
  return { version: FACET_UNDO_HISTORY_VERSION, steps: value.steps.filter(step => isUndoStep(step) || isLegacyStep(step)).slice(-FACET_UNDO_LIMIT).map(step => {
    if (isUndoStep(step)) return structuredClone(step);
    return { catalogAfterDigest: undoDigest(step.afterFacetCatalog), catalogChanges: inverseChanges(step.facetCatalog, step.afterFacetCatalog),
      entries: step.entries.map(item => ({ id: item.id, afterDigest: undoDigest(item.after), changes: inverseChanges(item.entry, item.after) })) };
  }) };
}

function createUndoStep(beforeState = {}, afterState = {}, { entriesChanged = true } = {}) {
  const afterEntries = new Map((afterState.entries ?? []).map(entry => [entry.id, entry]));
  const afterCompounds = new Map((afterState.compoundCases ?? []).map(item => [item.id, item]));
  if (entriesChanged && (afterEntries.size !== (beforeState.entries ?? []).length || (beforeState.entries ?? []).some(entry => !afterEntries.has(entry.id)))) {
    throw new Error("标签操作改变了案例数量，未保存以保护资料库");
  }
  return {
    catalogAfterDigest: undoDigest(afterState.facetCatalog),
    catalogChanges: inverseChanges(beforeState.facetCatalog, afterState.facetCatalog),
    compounds: (beforeState.compoundCases ?? []).flatMap(item => {
      const after = afterCompounds.get(item.id);
      if (sameValue(item, after)) return [];
      if (!after) throw new Error('标签操作改变了组合案例数量，未保存以保护资料库');
      return [{ id: item.id, afterDigest: undoDigest(after), changes: inverseChanges(item, after) }];
    }),
    entries: entriesChanged ? (beforeState.entries ?? []).flatMap(entry => {
      const after = afterEntries.get(entry.id);
      if (sameValue(entry, after)) return [];
      return [{ id: entry.id, afterDigest: undoDigest(after), changes: inverseChanges(entry, after) }];
    }) : []
  };
}

function isUndoStep(value) {
  return Boolean(/^[a-f0-9]{64}$/.test(value?.catalogAfterDigest) && isInverseChanges(value.catalogChanges) && Array.isArray(value.entries)
    && (value.compounds === undefined || Array.isArray(value.compounds) && value.compounds.every(item => item?.id && /^[a-f0-9]{64}$/.test(item.afterDigest) && isInverseChanges(item.changes)))
    && value.entries.every(item => item?.id && /^[a-f0-9]{64}$/.test(item.afterDigest) && isInverseChanges(item.changes)));
}

// A one-way reader for persisted v2 snapshots, not a second active history format.
function isLegacyStep(value) {
  return Boolean(value?.facetCatalog && value.afterFacetCatalog && Array.isArray(value.entries)
    && value.entries.every(item => item?.id && item.entry && item.after));
}

function sameValue(left, right) {
  return sameUndoState(left, right);
}
