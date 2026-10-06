import { LIBRARY_VIEW_SUMMARY_KEY, LIBRARY_VIEW_SUMMARY_SOURCES, updateLibraryViewSummary, composerSessionSummaries } from './library-view-summary.js';
import { jsonBytes, startPhase } from "./perf-trace.js";
import { assertLibraryWritable } from "./library-version-guard.js";
import { SCHEMA_VERSION } from "./taxonomy.js";
import { CASE_INDEX_KEY, ENTRIES_KEY, LEGACY_ENTRIES_KEY, assembleEntries, caseIdFromRecordKey, caseIndexFor, caseRecordKey,
  indexedCaseIds, isCaseRecordKey, keyableEntries, planCaseWrite, translateCaseChanges } from "./library-case-records.js";

// The case library records a reader needs to find, show and edit cases.
export const CASE_LIBRARY_KEYS = Object.freeze(['schemaVersion', 'entries', 'trashState', 'compoundCases',
  'taxonomy', 'facetCatalog', 'classificationRules', 'organizerState']);
// Written in the same storage call as any case library change, so an unchanged value proves the
// records are unchanged; removing a case key drops it, which disables reuse until the next write.
export const CASE_LIBRARY_REVISION_KEY = 'caseLibraryRevision';
const touchesCaseLibrary = keys => keys.some(key => CASE_LIBRARY_KEYS.includes(key));

// Browser metadata writes share one lock across extension pages. Read/modify/write
// commits preserve concurrent sync markers; originals stay in media-store.js.
export function createLibraryStorage({ backend, changes, lock, revision = () => globalThis.crypto.randomUUID(), assertWritable = async () => {} }) {
  if (!["get", "set", "remove"].every(name => typeof backend?.[name] === "function") || typeof lock !== "function") {
    throw new Error("资料读写接口缺少存储或写入协调能力。");
  }
  const withRevision = update => touchesCaseLibrary(Object.keys(update))
    ? { ...update, [CASE_LIBRARY_REVISION_KEY]: revision() } : update;
  const withSummary = async update => {
    update = withRevision(update);
    if (Object.hasOwn(update, 'composerSessions')) update = { ...update, composerSessionSummaries: composerSessionSummaries(update.composerSessions) };
    if (!LIBRARY_VIEW_SUMMARY_SOURCES.some(key => Object.hasOwn(update, key))) return update;
    const stored = await backend.get(LIBRARY_VIEW_SUMMARY_KEY);
    return { ...update, [LIBRARY_VIEW_SUMMARY_KEY]: updateLibraryViewSummary(update[LIBRARY_VIEW_SUMMARY_KEY] || stored[LIBRARY_VIEW_SUMMARY_KEY], update) };
  };
  // Text of every case as last stored by this page, valid while the stored revision is unchanged.
  let caseCache = null;
  const records = async ids => {
    const values = ids.length ? await backend.get(ids.map(caseRecordKey)) : {};
    return Object.fromEntries(Object.entries(values).map(([key, value]) => [caseIdFromRecordKey(key), value]));
  };
  // Reads see one consistent library: the records are read again if a write landed in between,
  // and a record named by the index but absent is reported instead of showing fewer cases.
  const withCases = async (stored, wantsRevision, refetch) => {
    for (let attempt = 0; attempt < 5; attempt++) {
      const index = stored[CASE_INDEX_KEY];
      const ids = indexedCaseIds(index) ?? [];
      const found = await records(ids);
      const { [CASE_LIBRARY_REVISION_KEY]: revision } = ids.length ? await backend.get([CASE_LIBRARY_REVISION_KEY]) : stored;
      if (revision !== stored[CASE_LIBRARY_REVISION_KEY]) {
        stored = await refetch();
        if (!stored[CASE_INDEX_KEY]) return stored;
        continue;
      }
      const assembled = assembleEntries(index, found, stored[ENTRIES_KEY]);
      if (assembled.missingIds.length) throw Object.assign(new Error(`资料库有 ${assembled.missingIds.length} 个案例记录读取不到，已停止读取；资料没有改动`), { code: "CASE_RECORDS_MISSING", missingIds: assembled.missingIds.slice(0, 20) });
      const { [CASE_INDEX_KEY]: _index, ...rest } = stored;
      if (!wantsRevision) delete rest[CASE_LIBRARY_REVISION_KEY];
      return { ...rest, [ENTRIES_KEY]: assembled.entries };
    }
    throw Object.assign(new Error("资料库正在连续写入，暂时读不到一致的案例；请稍后重试"), { code: "CASE_RECORDS_BUSY" });
  };
  const read = async keys => {
    if (keys == null) {
      const all = await backend.get(keys);
      if (!all[CASE_INDEX_KEY]) return all;
      const ids = indexedCaseIds(all[CASE_INDEX_KEY]) ?? [];
      const found = Object.fromEntries(ids.filter(id => Object.hasOwn(all, caseRecordKey(id))).map(id => [id, all[caseRecordKey(id)]]));
      const assembled = assembleEntries(all[CASE_INDEX_KEY], found, all[ENTRIES_KEY]);
      if (assembled.missingIds.length) throw Object.assign(new Error(`资料库有 ${assembled.missingIds.length} 个案例记录读取不到，已停止读取；资料没有改动`), { code: "CASE_RECORDS_MISSING", missingIds: assembled.missingIds.slice(0, 20) });
      const rest = Object.fromEntries(Object.entries(all).filter(([key]) => !isCaseRecordKey(key) && key !== CASE_INDEX_KEY));
      return { ...rest, [ENTRIES_KEY]: assembled.entries };
    }
    const defaults = typeof keys === 'object' && !Array.isArray(keys) ? keys : null;
    const names = typeof keys === 'string' ? [keys] : defaults ? Object.keys(defaults) : keys;
    if (!names.includes(ENTRIES_KEY)) return backend.get(keys);
    const fetch = () => backend.get([...new Set([...names, CASE_INDEX_KEY, CASE_LIBRARY_REVISION_KEY])]);
    const stored = await fetch();
    const result = stored[CASE_INDEX_KEY] ? await withCases(stored, true, fetch) : stored;
    if (!names.includes(CASE_INDEX_KEY)) delete result[CASE_INDEX_KEY];
    if (!names.includes(CASE_LIBRARY_REVISION_KEY)) delete result[CASE_LIBRARY_REVISION_KEY];
    if (defaults) for (const [key, value] of Object.entries(defaults)) if (!Object.hasOwn(result, key)) result[key] = value;
    return result;
  };
  const storedCaseText = async (ids, revision) => {
    if (caseCache && revision && caseCache.revision === revision) return caseCache;
    const found = await records(ids);
    const text = new Map(Object.entries(found).map(([id, value]) => [id, JSON.stringify(value)]));
    // Records left by an interrupted removal are not part of the library; clear them with this write.
    const orphanKeys = typeof backend.getKeys === 'function'
      ? (await backend.getKeys()).filter(key => isCaseRecordKey(key) && !text.has(caseIdFromRecordKey(key))) : [];
    return { revision, ids, text, orphanKeys };
  };
  // The first write of the current version moves the single list into per-case records in one
  // storage call that keeps the list as it was; the result is read back before the list is removed.
  const switchToCaseRecords = async (update, plainEntries, hadLegacyCopy) => {
    const entries = update[ENTRIES_KEY];
    const { [ENTRIES_KEY]: _entries, ...rest } = update;
    const payload = { ...rest, [CASE_INDEX_KEY]: caseIndexFor(entries),
      ...Object.fromEntries(entries.map(entry => [caseRecordKey(entry.id), entry])) };
    if (Array.isArray(plainEntries) && !hadLegacyCopy) payload[LEGACY_ENTRIES_KEY] = plainEntries;
    await backend.set(payload);
    const back = await backend.get([CASE_INDEX_KEY, ...entries.map(entry => caseRecordKey(entry.id))]);
    const text = new Map(entries.map(entry => [entry.id, JSON.stringify(entry)]));
    const intact = JSON.stringify(indexedCaseIds(back[CASE_INDEX_KEY])) === JSON.stringify(entries.map(entry => entry.id))
      && entries.every(entry => JSON.stringify(back[caseRecordKey(entry.id)]) === text.get(entry.id));
    if (!intact) {
      // Put the library back exactly as the single list it was; the records are discarded.
      if (Array.isArray(plainEntries)) await backend.set({ [ENTRIES_KEY]: plainEntries });
      if (Number.isInteger(update.priorSchemaVersion)) await backend.set({ schemaVersion: update.priorSchemaVersion });
      await backend.remove([CASE_INDEX_KEY, ...entries.map(entry => caseRecordKey(entry.id)),
        ...(update.priorSchemaVersion == null ? ['schemaVersion'] : [])]);
      throw Object.assign(new Error("按案例保存的核对没有通过，已恢复为原来的资料；资料没有丢失"), { code: "CASE_RECORDS_VERIFY_FAILED" });
    }
    if (Array.isArray(plainEntries)) await backend.remove([ENTRIES_KEY]);
    caseCache = { revision: update[CASE_LIBRARY_REVISION_KEY], ids: entries.map(entry => entry.id), text, orphanKeys: [] };
  };
  const write = async update => {
    if (!Object.hasOwn(update, ENTRIES_KEY)) return backend.set(update);
    const entries = update[ENTRIES_KEY];
    const stored = await backend.get(['schemaVersion', CASE_INDEX_KEY, CASE_LIBRARY_REVISION_KEY, ENTRIES_KEY, LEGACY_ENTRIES_KEY]);
    const split = Boolean(stored[CASE_INDEX_KEY]);
    if (!keyableEntries(entries)) {
      if (split) throw Object.assign(new Error("案例编号缺失或重复，无法保存；资料没有改动"), { code: "CASE_ID_INVALID" });
      console.warn("PromptDirector: cases without distinct ids stay in the single list", { count: Array.isArray(entries) ? entries.length : 0 });
      return backend.set(update);
    }
    if (!split) {
      // Only a library at the current version is moved, so an older version that refuses newer
      // libraries never meets records it cannot read.
      const version = Object.hasOwn(update, 'schemaVersion') ? update.schemaVersion : stored.schemaVersion;
      if (version !== SCHEMA_VERSION) return backend.set(update);
      Object.defineProperty(update, 'priorSchemaVersion', { value: stored.schemaVersion ?? null, enumerable: false });
      return switchToCaseRecords(update, stored[ENTRIES_KEY], Object.hasOwn(stored, LEGACY_ENTRIES_KEY));
    }
    const cache = await storedCaseText(indexedCaseIds(stored[CASE_INDEX_KEY]) ?? [], stored[CASE_LIBRARY_REVISION_KEY]);
    const plan = planCaseWrite(entries, cache.ids, cache.text);
    const { [ENTRIES_KEY]: _entries, ...rest } = update;
    await backend.set({ ...rest, ...plan.records, ...(plan.index ? { [CASE_INDEX_KEY]: plan.index } : {}) });
    caseCache = { revision: update[CASE_LIBRARY_REVISION_KEY], ids: plan.ids, text: plan.text, orphanKeys: [] };
    // A plain list beside the records came from an older version; its cases are part of this write.
    const leftovers = [...plan.removedKeys, ...cache.orphanKeys, ...(Object.hasOwn(stored, ENTRIES_KEY) ? [ENTRIES_KEY] : [])];
    if (leftovers.length) await backend.remove(leftovers);
  };
  return Object.freeze({
    get: read,
    // Available before our minimum Chrome version; never load values to enumerate keys.
    getKeys: () => backend.getKeys(),
    set: values => lock(async () => {
      await assertWritable(backend);
      await write(await withSummary(values));
    }),
    remove: keys => lock(async () => {
      await assertWritable(backend);
      const removed = typeof keys === 'string' ? [keys] : keys;
      // Removing the case list removes every case record with its index.
      const caseKeys = removed.includes(ENTRIES_KEY) && typeof backend.getKeys === 'function'
        ? (await backend.getKeys()).filter(key => isCaseRecordKey(key) || key === CASE_INDEX_KEY) : [];
      if (caseKeys.length) caseCache = null;
      // Invalidate derived values in the same lock. The next reader rebuilds
      // them from the retained source instead of advertising a deleted undo.
      return backend.remove([...new Set([...removed, ...caseKeys,
        ...(removed.some(key => LIBRARY_VIEW_SUMMARY_SOURCES.includes(key)) ? [LIBRARY_VIEW_SUMMARY_KEY] : []),
        ...(removed.includes('composerSessions') ? ['composerSessionSummaries'] : []),
        ...(touchesCaseLibrary(removed) ? [CASE_LIBRARY_REVISION_KEY] : [])
      ])]);
    }),
    // Read/modify/write is serialized with every set/remove using this backend.
    // The transform must not call a nested write on this same interface.
    update: (keys, transform) => lock(async () => {
      await assertWritable(backend);
      const update = await transform(await read(keys));
      if (!update || typeof update !== "object" || Array.isArray(update)) throw new Error("资料更新内容无效。");
      await write(await withSummary(update));
    }),
    subscribe: listener => {
      if (!changes) throw new Error("资料变化通知不可用。");
      const handler = (values, area) => { if (area === "local") listener(translateCaseChanges(values)); };
      changes.addListener(handler);
      return () => changes.removeListener(handler);
    }
  });
}

let boundStorage;
// Lazy construction keeps imported domain helpers usable outside Chrome. The
// Chrome object is captured once, not looked up again after an async request.
export function getLibraryStorage() {
  boundStorage ??= createLibraryStorage({
    backend: chrome.storage.local,
    changes: chrome.storage.onChanged,
    lock: operation => navigator.locks.request("promptdirector-library-metadata-write", operation),
    assertWritable: assertLibraryWritable
  });
  return boundStorage;
}

export function createLibraryCommitter({ storage, syncedKeys, syncMetaKey, markDirty, isSyncApplying }) {
  return async (update, options = {}) => {
    const done = startPhase("background", "write");
    try {
      return await commitLibraryUpdate(update, options);
    } finally {
      done({ bytes: () => jsonBytes(update) });
    }
  };
  async function commitLibraryUpdate(update, options) {
    const payload = { ...update };
    const affectsSync = Object.keys(payload).some(key => syncedKeys.has(key));
    if (isSyncApplying() || options.markSyncDirty === false || !affectsSync) return storage.set(payload);
    return storage.update(syncMetaKey, stored => ({
      ...payload,
      [syncMetaKey]: markDirty(stored[syncMetaKey], options.dirtyAssetIds)
    }));
  }
}
