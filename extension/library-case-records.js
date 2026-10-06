// Per-case storage layout. Every case lives in its own record so changing one case writes only that
// case; the index keeps the library order. Callers keep reading and writing one ordered `entries`
// list through library-storage.js, which translates to and from this layout.
export const CASE_RECORD_PREFIX = 'case:';
export const CASE_INDEX_KEY = 'caseIndex';
// The list exactly as stored before the first switch to per-case records, kept untouched for recovery.
export const LEGACY_ENTRIES_KEY = 'legacyEntries';
export const CASE_INDEX_LAYOUT = 1;
export const ENTRIES_KEY = 'entries';

export const caseRecordKey = id => CASE_RECORD_PREFIX + id;
export const isCaseRecordKey = key => typeof key === 'string' && key.startsWith(CASE_RECORD_PREFIX);
export const caseIdFromRecordKey = key => key.slice(CASE_RECORD_PREFIX.length);

export function indexedCaseIds(index) {
  return Array.isArray(index?.ids) ? index.ids : null;
}

// Per-case records need one distinct text id per case; anything else stays in the single list.
export function keyableEntries(entries) {
  if (!Array.isArray(entries)) return false;
  const seen = new Set();
  for (const entry of entries) {
    const id = entry?.id;
    if (typeof id !== 'string' || !id || seen.has(id)) return false;
    seen.add(id);
  }
  return true;
}

// Indexed records are the library. A plain `entries` list beside them was written either in the
// same switch (same cases) or by an older PromptDirector that cannot see the records; its cases
// that the index does not know are kept after the indexed ones, and it never overrides a record.
export function assembleEntries(index, records, plainEntries) {
  const ids = indexedCaseIds(index) ?? [];
  const entries = [], missingIds = [];
  for (const id of ids) {
    if (Object.hasOwn(records, id)) entries.push(records[id]);
    else missingIds.push(id);
  }
  const known = new Set(ids);
  const addedByOlderVersion = (Array.isArray(plainEntries) ? plainEntries : [])
    .filter(entry => typeof entry?.id === 'string' && !known.has(entry.id));
  return { entries: [...entries, ...addedByOlderVersion], missingIds, addedIds: addedByOlderVersion.map(entry => entry.id) };
}

export function caseIndexFor(entries) {
  return { layout: CASE_INDEX_LAYOUT, ids: entries.map(entry => entry.id) };
}

// Browser storage keeps object fields in its own order, so stored and written cases are compared by
// content: object fields sorted, everything else as JSON itself serializes it.
export function caseText(value) {
  return JSON.stringify(value, (_key, item) => item && typeof item === 'object' && !Array.isArray(item)
    ? Object.fromEntries(Object.keys(item).sort().map(key => [key, item[key]])) : item);
}

const sameIds = (left, right) => left.length === right.length && left.every((id, index) => id === right[index]);

// Compares against the last stored text of each case and returns only what must be written.
export function planCaseWrite(entries, storedIds, storedText) {
  const records = {}, text = new Map();
  for (const entry of entries) {
    const serialized = caseText(entry);
    text.set(entry.id, serialized);
    if (storedText.get(entry.id) !== serialized) records[caseRecordKey(entry.id)] = entry;
  }
  const ids = entries.map(entry => entry.id);
  const kept = new Set(ids);
  return {
    records,
    index: sameIds(ids, storedIds) ? null : caseIndexFor(entries),
    removedKeys: storedIds.filter(id => !kept.has(id)).map(caseRecordKey),
    ids,
    text
  };
}

// Translates raw storage change events: changed records arrive as one `entries` change naming the
// cases, so listeners never see the layout. `newValue` is absent; listeners re-read what they need.
export function translateCaseChanges(changes) {
  const keys = Object.keys(changes);
  if (!keys.some(key => isCaseRecordKey(key) || key === CASE_INDEX_KEY)) return changes;
  const translated = {}, cases = {}, removedCaseIds = [];
  let caseIds;
  for (const key of keys) {
    if (key === CASE_INDEX_KEY) caseIds = indexedCaseIds(changes[key].newValue) ?? [];
    else if (isCaseRecordKey(key)) {
      const id = caseIdFromRecordKey(key);
      if (Object.hasOwn(changes[key], 'newValue')) cases[id] = changes[key].newValue;
      else removedCaseIds.push(id);
    } else translated[key] = changes[key];
  }
  translated[ENTRIES_KEY] = { ...(translated[ENTRIES_KEY] ?? {}), caseLayout: true, cases, removedCaseIds,
    ...(caseIds ? { caseIds } : {}) };
  delete translated[ENTRIES_KEY].newValue;
  return translated;
}

// Applies a translated case change to the list a page already shows. Returns null when the change
// cannot be applied on its own (a case whose position the page does not know), so the caller reads again.
export function applyCaseChanges(currentEntries, change) {
  const byId = new Map(currentEntries.map(entry => [entry.id, entry]));
  const changed = Object.entries(change.cases ?? {});
  if (!change.caseIds && changed.some(([id]) => !byId.has(id))) return null;
  for (const id of change.removedCaseIds ?? []) byId.delete(id);
  for (const [id, entry] of changed) byId.set(id, entry);
  const ids = change.caseIds ?? currentEntries.map(entry => entry.id).filter(id => byId.has(id));
  return ids.every(id => byId.has(id)) ? ids.map(id => byId.get(id)) : null;
}
