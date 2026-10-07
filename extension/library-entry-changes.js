import { applyCaseChanges } from './library-case-records.js';

// Keep the exact ids delivered by per-case writes across one coalesced render. A legacy full-list
// notification has no such evidence, so subsequent changes must retain the comparison path.
export function mergeLibraryEntryChange(pending, currentEntries, change) {
  const before = pending?.entries ?? currentEntries;
  if (Array.isArray(change.newValue)) return { entries: change.newValue, changedEntryIds: null,
    orderChanged: Boolean(pending?.orderChanged) || before.length !== change.newValue.length
      || before.some((entry, index) => entry.id !== change.newValue[index]?.id) };
  const entries = applyCaseChanges(before, change);
  if (!entries) return null;
  const changedEntryIds = pending?.changedEntryIds === null ? null : new Set(pending?.changedEntryIds);
  if (changedEntryIds) {
    for (const id of Object.keys(change.cases ?? {})) changedEntryIds.add(id);
    for (const id of change.removedCaseIds ?? []) changedEntryIds.add(id);
    if (change.caseIds) {
      const retained = new Set(change.caseIds);
      for (const entry of before) if (!retained.has(entry.id)) changedEntryIds.add(entry.id);
    }
  }
  return { entries, changedEntryIds, orderChanged: Boolean(pending?.orderChanged)
    || before.length !== entries.length || before.some((entry, index) => entry.id !== entries[index]?.id) };
}

export function libraryChangedEntryIds(currentEntries, nextEntries, knownIds = null) {
  if (knownIds) return knownIds;
  // The page decorates stored cases for display; compare only persisted fields for old full lists.
  const storedJson = entry => JSON.stringify({ ...entry, contentRole: undefined, contentTypeName: undefined });
  const previous = new Map(currentEntries.map(entry => [entry.id, entry]));
  const changed = new Set();
  for (const entry of nextEntries) {
    const before = previous.get(entry.id);
    if (!before || storedJson(before) !== storedJson(entry)) changed.add(entry.id);
    previous.delete(entry.id);
  }
  for (const id of previous.keys()) changed.add(id);
  return changed;
}

const sameCase = (left, right) => left && right
  && libraryChangedEntryIds([left], [right]).size === 0;

// A response and its storage echo can arrive in either order. Hold only in-flight edits and
// unmatched echoes, and compare just that case; unrelated notifications continue normally.
export function createLocalCaseEditTracker() {
  const active = new Set();
  const echoes = new Map();
  return {
    get pending() { return active.size > 0; },
    begin(entry) {
      const token = { entry, observed: [] };
      active.add(token);
      return token;
    },
    observe(change) {
      if (Array.isArray(change?.newValue)) {
        for (const token of active) token.observed.push(change.newValue.find(entry => entry.id === token.entry.id) ?? null);
      }
      if (!change?.caseLayout) return change;
      for (const token of active) {
        if (Object.hasOwn(change.cases ?? {}, token.entry.id)) token.observed.push(change.cases[token.entry.id]);
        if (change.removedCaseIds?.includes(token.entry.id) || (change.caseIds && !change.caseIds.includes(token.entry.id))) token.observed.push(null);
      }
      let cases = change.cases;
      for (const [id, entry] of echoes) {
        if (!sameCase(cases?.[id], entry)) continue;
        cases = { ...cases };
        delete cases[id];
        echoes.delete(id);
      }
      if (cases === change.cases) return change;
      if (!Object.keys(cases).length && !change.caseIds && !change.removedCaseIds?.length) return null;
      return { ...change, cases };
    },
    finish(token, entry, { changed } = {}) {
      active.delete(token);
      if (!entry) return null;
      if (changed === false || sameCase(token.entry, entry)) return token.observed.length ? token.observed.at(-1) : entry;
      const index = token.observed.findIndex(value => sameCase(value, entry));
      if (index >= 0) return token.observed.at(-1);
      if (!sameCase(token.entry, entry)) echoes.set(entry.id, entry);
      return entry;
    },
    matches: sameCase
  };
}
