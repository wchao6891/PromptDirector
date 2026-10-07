import { LIBRARY_VIEW_SUMMARY_KEY, LIBRARY_VIEW_SUMMARY_SOURCES, updateLibraryViewSummary, composerSessionSummaries } from './library-view-summary.js';
import { jsonBytes, startPhase } from "./perf-trace.js";
import { assertLibraryWritable } from "./library-version-guard.js";
import { SCHEMA_VERSION } from "./taxonomy.js";
import { BROWSE_PROJECTION_VERSION, BROWSE_PROJECTION_META_KEY, caseBrowseKey, caseBrowseProjection } from "./library-browse-index.js";
import { CASE_INDEX_KEY, ENTRIES_KEY, LEGACY_ENTRIES_KEY, assembleEntries, caseIdFromRecordKey, caseIndexFor, caseRecordKey,
  caseText, indexedCaseIds, isCaseRecordKey, keyableEntries, planCaseWrite, sameCaseValue, translateCaseChanges } from "./library-case-records.js";

// The case library records a reader needs to find, show and edit cases.
export const CASE_LIBRARY_KEYS = Object.freeze(['schemaVersion', 'entries', 'trashState', 'compoundCases',
  'taxonomy', 'facetCatalog', 'classificationRules', 'organizerState']);
// Written in the same storage call as any case library change, so an unchanged value proves the
// records are unchanged; removing a case key drops it, which disables reuse until the next write.
export const CASE_LIBRARY_REVISION_KEY = 'caseLibraryRevision';
const isBrowseKey = key => key === BROWSE_PROJECTION_META_KEY || key.startsWith('caseView:');
const browseMarker = revision => ({ format: BROWSE_PROJECTION_VERSION, revision });
const validBrowseMarker = (marker, revision) => Boolean(revision) && marker?.format === BROWSE_PROJECTION_VERSION && marker.revision === revision;
const browseRecords = entries => Object.fromEntries(entries.map(entry => [caseBrowseKey(entry.id), caseBrowseProjection(entry)]));
const touchesCaseLibrary = keys => keys.some(key => CASE_LIBRARY_KEYS.includes(key));
const freezeCaseSnapshot = value => {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const item of Object.values(value)) freezeCaseSnapshot(item);
  return value;
};

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
  // Independent snapshots as last stored by this page, valid while its revision is unchanged.
  let caseCache = null;
  const updateCachedCases = (values, area = 'local') => {
    if (area !== 'local' || !caseCache) return;
    const change = values[CASE_LIBRARY_REVISION_KEY];
    if (!change) {
      if (Object.hasOwn(values, CASE_INDEX_KEY) || Object.keys(values).some(key => isCaseRecordKey(key) && caseCache.values.has(caseIdFromRecordKey(key)))) caseCache = null;
      return;
    }
    if (change.newValue && change.newValue === caseCache.revision) return;
    if (!change.newValue || change.oldValue !== caseCache.revision) { caseCache = null; return; }
    const ids = Object.hasOwn(values, CASE_INDEX_KEY) ? indexedCaseIds(values[CASE_INDEX_KEY].newValue) : caseCache.ids;
    if (!ids) { caseCache = null; return; }
    const records = new Map(caseCache.values);
    for (const [key, item] of Object.entries(values)) if (isCaseRecordKey(key)) {
      if (Object.hasOwn(item, 'newValue')) records.set(caseIdFromRecordKey(key), structuredClone(item.newValue));
      else records.delete(caseIdFromRecordKey(key));
    }
    const kept = new Set(ids);
    const removed = [...records.keys()].filter(id => !kept.has(id));
    for (const id of removed) records.delete(id);
    if (ids.some(id => !records.has(id))) { caseCache = null; return; }
    caseCache = { revision: change.newValue, ids: [...ids], values: records,
      orphanKeys: caseCache.orphanKeys === null ? null : [...caseCache.orphanKeys, ...removed.map(caseRecordKey)] };
  };
  changes?.addListener(updateCachedCases);
  const records = async ids => {
    const values = ids.length ? await backend.get(ids.map(caseRecordKey)) : {};
    return Object.fromEntries(Object.entries(values).map(([key, value]) => [caseIdFromRecordKey(key), value]));
  };
  // Reads see one consistent library: the records are read again if a write landed in between,
  // and a record named by the index but absent is reported instead of showing fewer cases.
  const withCases = async (stored, wantsRevision, refetch, readonlyEntries) => {
    for (let attempt = 0; attempt < 5; attempt++) {
      const index = stored[CASE_INDEX_KEY];
      const ids = indexedCaseIds(index) ?? [];
      const cached = caseCache && stored[CASE_LIBRARY_REVISION_KEY] && caseCache.revision === stored[CASE_LIBRARY_REVISION_KEY] ? caseCache : null;
      const found = cached ? Object.fromEntries(cached.values) : await records(ids);
      const { [CASE_LIBRARY_REVISION_KEY]: revision } = ids.length ? await backend.get([CASE_LIBRARY_REVISION_KEY]) : stored;
      if (revision !== stored[CASE_LIBRARY_REVISION_KEY]) {
        stored = await refetch();
        if (!stored[CASE_INDEX_KEY]) return stored;
        continue;
      }
      const assembled = assembleEntries(index, found, stored[ENTRIES_KEY]);
      if (assembled.missingIds.length) throw Object.assign(new Error(`资料库有 ${assembled.missingIds.length} 个案例记录读取不到，已停止读取；资料没有改动`), { code: "CASE_RECORDS_MISSING", missingIds: assembled.missingIds.slice(0, 20) });
      if (!cached && revision) caseCache = { revision, ids, values: new Map(Object.entries(found)), orphanKeys: null };
      const { [CASE_INDEX_KEY]: _index, ...rest } = stored;
      if (!wantsRevision) delete rest[CASE_LIBRARY_REVISION_KEY];
      return { ...rest, [ENTRIES_KEY]: readonlyEntries ? freezeCaseSnapshot(assembled.entries) : structuredClone(assembled.entries) };
    }
    throw Object.assign(new Error("资料库正在连续写入，暂时读不到一致的案例；请稍后重试"), { code: "CASE_RECORDS_BUSY" });
  };
  const read = async (keys, readonlyEntries = false) => {
    if (keys == null) {
      const all = await backend.get(keys);
      if (!all[CASE_INDEX_KEY]) {
        if (readonlyEntries) freezeCaseSnapshot(all[ENTRIES_KEY]);
        return Object.fromEntries(Object.entries(all).filter(([key]) => !isCaseRecordKey(key) && !isBrowseKey(key) && key !== CASE_INDEX_KEY));
      }
      const ids = indexedCaseIds(all[CASE_INDEX_KEY]) ?? [];
      const found = Object.fromEntries(ids.filter(id => Object.hasOwn(all, caseRecordKey(id))).map(id => [id, all[caseRecordKey(id)]]));
      const assembled = assembleEntries(all[CASE_INDEX_KEY], found, all[ENTRIES_KEY]);
      if (assembled.missingIds.length) throw Object.assign(new Error(`资料库有 ${assembled.missingIds.length} 个案例记录读取不到，已停止读取；资料没有改动`), { code: "CASE_RECORDS_MISSING", missingIds: assembled.missingIds.slice(0, 20) });
      const rest = Object.fromEntries(Object.entries(all).filter(([key]) => !isCaseRecordKey(key) && !isBrowseKey(key) && key !== CASE_INDEX_KEY));
      return { ...rest, [ENTRIES_KEY]: readonlyEntries ? freezeCaseSnapshot(assembled.entries) : assembled.entries };
    }
    const defaults = typeof keys === 'object' && !Array.isArray(keys) ? keys : null;
    const names = typeof keys === 'string' ? [keys] : defaults ? Object.keys(defaults) : keys;
    if (!names.includes(ENTRIES_KEY)) return backend.get(keys);
    const fetch = () => backend.get([...new Set([...names, CASE_INDEX_KEY, CASE_LIBRARY_REVISION_KEY])]);
    const stored = await fetch();
    const result = stored[CASE_INDEX_KEY] ? await withCases(stored, true, fetch, readonlyEntries) : stored;
    if (!names.includes(CASE_INDEX_KEY)) delete result[CASE_INDEX_KEY];
    if (!names.includes(CASE_LIBRARY_REVISION_KEY)) delete result[CASE_LIBRARY_REVISION_KEY];
    if (defaults) for (const [key, value] of Object.entries(defaults)) if (!Object.hasOwn(result, key)) result[key] = readonlyEntries && key === ENTRIES_KEY ? structuredClone(value) : value;
    if (readonlyEntries) freezeCaseSnapshot(result[ENTRIES_KEY]);
    return result;
  };
  // Progressive reads keep partial records private to this iterator. Only a verified, complete
  // result becomes the shared library cache; callers choose budgets from their visible layout.
  async function* getSnapshotBatches(keys, { batchSize, selectIds, useBrowseIndex = false } = {}) {
    const names = typeof keys === 'string' ? [keys] : Array.isArray(keys) ? keys : keys && Object.keys(keys);
    if (!names || !names.includes(ENTRIES_KEY)) throw new Error('分批读取需要指定案例列表');
    if (typeof backend.getKeys !== 'function') { yield { requiresFullRead: true }; return; }
    const [stored, storageKeys] = await Promise.all([
      backend.get([...new Set([...names.filter(key => key !== ENTRIES_KEY), 'schemaVersion', CASE_INDEX_KEY, CASE_LIBRARY_REVISION_KEY, ...(useBrowseIndex ? [BROWSE_PROJECTION_META_KEY] : [])])]),
      backend.getKeys()
    ]);
    const indexed = indexedCaseIds(stored[CASE_INDEX_KEY]);
    if (!indexed || stored.schemaVersion !== SCHEMA_VERSION || storageKeys.includes(ENTRIES_KEY)
      || !stored[CASE_LIBRARY_REVISION_KEY]) { yield { requiresFullRead: true }; return; }
    const entryIds = Object.freeze([...indexed]);
    const expectedRevision = stored[CASE_LIBRARY_REVISION_KEY];
    const { [CASE_INDEX_KEY]: _index, [CASE_LIBRARY_REVISION_KEY]: _revision, [BROWSE_PROJECTION_META_KEY]: _browse, ...metadata } = stored;
    const assertCurrent = async () => {
      const current = await backend.get([CASE_LIBRARY_REVISION_KEY, 'schemaVersion']);
      if (current[CASE_LIBRARY_REVISION_KEY] !== expectedRevision || current.schemaVersion !== SCHEMA_VERSION) {
        throw Object.assign(new Error('案例库已更新，请重新读取当前内容'), { code: 'CASE_RECORDS_CHANGED' });
      }
    };
    const makeResult = values => ({
      stored: { ...metadata, [ENTRIES_KEY]: freezeCaseSnapshot(entryIds.filter(id => values.has(id)).map(id => values.get(id))) },
      entryIds, loaded: values.size, total: entryIds.length, complete: values.size === entryIds.length, revision: expectedRevision
    });
    if (!useBrowseIndex && caseCache?.revision === expectedRevision) {
      const cached = caseCache;
      await assertCurrent();
      yield makeResult(cached.values);
      return;
    }
    const found = new Map();
    if (!entryIds.length) {
      if (useBrowseIndex) metadata.browseEntries = Object.freeze([]);
      await assertCurrent();
      caseCache = { revision: expectedRevision, ids: [], values: found, orphanKeys: null };
      yield makeResult(found);
      return;
    }
    yield makeResult(found);
    if (useBrowseIndex) {
      let thin;
      if (validBrowseMarker(stored[BROWSE_PROJECTION_META_KEY], expectedRevision)) {
        thin = await backend.get(entryIds.map(caseBrowseKey));
        await assertCurrent();
      }
      if (!thin || entryIds.some(id => thin[caseBrowseKey(id)]?.id !== id)) {
        // This disposable directory is backfilled once for existing libraries, using the same
        // verified full snapshot the view will receive. Cache writes never alter formal revision.
        thin = await lock(async () => {
          await assertCurrent();
          if ((await backend.getKeys()).includes(ENTRIES_KEY)) throw Object.assign(new Error('案例库已更新，请重新读取当前内容'), { code: 'CASE_RECORDS_CHANGED' });
          const values = caseCache?.revision === expectedRevision ? caseCache.values : new Map(Object.entries(await records(entryIds)));
          const missingIds = entryIds.filter(id => !values.has(id));
          if (missingIds.length) throw Object.assign(new Error(`资料库有 ${missingIds.length} 个案例记录读取不到，资料没有改动`), { code: 'CASE_RECORDS_MISSING', missingIds: missingIds.slice(0, 20) });
          await assertCurrent();
          const projections = browseRecords(entryIds.map(id => values.get(id)));
          try {
            await backend.set({ ...projections, [BROWSE_PROJECTION_META_KEY]: browseMarker(expectedRevision) });
          } catch (error) {
            console.warn('PromptDirector: browse cache could not be saved; using the verified cases', error);
          }
          caseCache = { revision: expectedRevision, ids: [...entryIds], values, orphanKeys: null };
          return projections;
        });
      }
      metadata.browseEntries = freezeCaseSnapshot(entryIds.map(id => thin[caseBrowseKey(id)]));
      if (caseCache?.revision === expectedRevision) {
        const cached = caseCache;
        await assertCurrent();
        yield makeResult(cached.values);
        return;
      }
    }
    const known = new Set(entryIds);
    const groupById = new Map();
    for (const compound of Array.isArray(metadata.compoundCases) ? metadata.compoundCases : []) {
      const members = (Array.isArray(compound?.memberEntryIds) ? compound.memberEntryIds : []).filter(id => known.has(id));
      const group = [...new Set(members.flatMap(id => groupById.get(id) ?? [id]))];
      for (const id of group) groupById.set(id, group);
    }
    while (found.size < entryIds.length) {
      const selected = selectIds ? await selectIds({ ids: entryIds, stored: metadata }) : [];
      if (!Array.isArray(selected)) throw new Error('首批案例选择无效');
      const order = [...new Set([...selected.filter(id => known.has(id)), ...entryIds])];
      let position = 0;
      const budget = typeof batchSize === 'function' ? batchSize({ loaded: found.size, total: entryIds.length }) : batchSize;
      if (!Number.isSafeInteger(budget) || budget < 1) throw new Error('每批读取数量必须是正整数');
      const pending = new Set();
      while (position < order.length && pending.size < budget) {
        const id = order[position++];
        if (found.has(id)) continue;
        for (const member of groupById.get(id) ?? [id]) if (!found.has(member)) pending.add(member);
      }
      const batch = await records([...pending]);
      await assertCurrent();
      const missingIds = [...pending].filter(id => !Object.hasOwn(batch, id));
      if (missingIds.length) throw Object.assign(new Error(`资料库有 ${missingIds.length} 个案例记录读取不到，资料没有改动`),
        { code: 'CASE_RECORDS_MISSING', missingIds: missingIds.slice(0, 20) });
      for (const [id, entry] of Object.entries(batch)) found.set(id, entry);
      if (found.size === entryIds.length) {
        // An older version can add a plain list without a revision. Never silently omit it.
        if ((await backend.getKeys()).includes(ENTRIES_KEY)) throw Object.assign(new Error('案例库已更新，请重新读取当前内容'), { code: 'CASE_RECORDS_CHANGED' });
        await assertCurrent();
        caseCache = { revision: expectedRevision, ids: [...entryIds], values: found, orphanKeys: null };
      }
      yield makeResult(found);
    }
  }
  const storedCases = async (ids, revision) => {
    const cached = caseCache && revision && caseCache.revision === revision ? caseCache : null;
    if (cached && cached.orphanKeys !== null) return cached;
    const values = cached?.values ?? new Map(Object.entries(await records(ids)));
    // Records left by an interrupted removal are not part of the library; clear them with this write.
    const orphanKeys = typeof backend.getKeys === 'function'
      ? (await backend.getKeys()).filter(key => (isCaseRecordKey(key) && !values.has(caseIdFromRecordKey(key)))
        || (key.startsWith('caseView:') && !values.has(key.slice('caseView:'.length)))) : [];
    return { revision, ids, values, orphanKeys };
  };
  const cleanup = async keys => {
    if (!keys.length) return [];
    try {
      await backend.remove(keys);
      return [];
    } catch (error) {
      console.warn('PromptDirector: auxiliary case cleanup will retry', error);
      return keys;
    }
  };
  // Stage and verify the records before publishing their index. An interrupted readback leaves
  // the old list and version active; only the final commit switches the library to the new layout.
  const switchToCaseRecords = async (update, plainEntries, hadLegacyCopy, storageKeys) => {
    const entries = update[ENTRIES_KEY];
    const { [ENTRIES_KEY]: _entries, ...rest } = update;
    const payload = Object.fromEntries(entries.map(entry => [caseRecordKey(entry.id), entry]));
    if (Array.isArray(plainEntries) && !hadLegacyCopy) payload[LEGACY_ENTRIES_KEY] = plainEntries;
    await backend.set(payload);
    const back = await backend.get(entries.map(entry => caseRecordKey(entry.id)));
    const intact = entries.every(entry => caseText(back[caseRecordKey(entry.id)]) === caseText(entry));
    if (!intact) {
      await cleanup(entries.map(entry => caseRecordKey(entry.id)));
      throw Object.assign(new Error("按案例保存的核对没有通过，仍使用原来的资料；资料没有丢失"), { code: "CASE_RECORDS_VERIFY_FAILED" });
    }
    // Empty the old list in the commit itself: a failed removal must not resurrect deleted cases.
    await backend.set({ ...rest, ...browseRecords(entries), [BROWSE_PROJECTION_META_KEY]: browseMarker(update[CASE_LIBRARY_REVISION_KEY]), [CASE_INDEX_KEY]: caseIndexFor(entries), ...(Array.isArray(plainEntries) ? { [ENTRIES_KEY]: [] } : {}) });
    const values = new Map(entries.map(entry => [entry.id, back[caseRecordKey(entry.id)]]));
    const kept = new Set(entries.flatMap(entry => [caseRecordKey(entry.id), caseBrowseKey(entry.id)]));
    const leftovers = storageKeys.filter(key => (isCaseRecordKey(key) || key.startsWith('caseView:')) && !kept.has(key));
    caseCache = { revision: update[CASE_LIBRARY_REVISION_KEY], ids: entries.map(entry => entry.id), values,
      orphanKeys: await cleanup([...leftovers, ...(Array.isArray(plainEntries) ? [ENTRIES_KEY] : [])]) };
  };
  const write = async update => {
    if (!Object.hasOwn(update, ENTRIES_KEY)) {
      if (Object.hasOwn(update, CASE_LIBRARY_REVISION_KEY)) {
        const current = await backend.get([CASE_LIBRARY_REVISION_KEY, BROWSE_PROJECTION_META_KEY]);
        if (validBrowseMarker(current[BROWSE_PROJECTION_META_KEY], current[CASE_LIBRARY_REVISION_KEY])) {
          update = { ...update, [BROWSE_PROJECTION_META_KEY]: browseMarker(update[CASE_LIBRARY_REVISION_KEY]) };
        }
      }
      return backend.set(update);
    }
    const entries = update[ENTRIES_KEY];
    const stored = await backend.get(['schemaVersion', CASE_INDEX_KEY, CASE_LIBRARY_REVISION_KEY, ENTRIES_KEY, BROWSE_PROJECTION_META_KEY]);
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
      const storageKeys = typeof backend.getKeys === 'function' ? await backend.getKeys() : [];
      const hadLegacyCopy = typeof backend.getKeys === 'function'
        ? storageKeys.includes(LEGACY_ENTRIES_KEY)
        : Object.hasOwn(await backend.get(LEGACY_ENTRIES_KEY), LEGACY_ENTRIES_KEY);
      return switchToCaseRecords(update, stored[ENTRIES_KEY], hadLegacyCopy, storageKeys);
    }
    const cache = await storedCases(indexedCaseIds(stored[CASE_INDEX_KEY]) ?? [], stored[CASE_LIBRARY_REVISION_KEY]);
    const plan = planCaseWrite(entries, cache.ids, cache.values);
    const { [ENTRIES_KEY]: _entries, ...rest } = update;
    const hasPlainEntries = Object.hasOwn(stored, ENTRIES_KEY);
    const projected = validBrowseMarker(stored[BROWSE_PROJECTION_META_KEY], stored[CASE_LIBRARY_REVISION_KEY]) ? Object.values(plan.records) : entries;
    await backend.set({ ...rest, ...plan.records, ...browseRecords(projected), [BROWSE_PROJECTION_META_KEY]: browseMarker(update[CASE_LIBRARY_REVISION_KEY]), ...(plan.index ? { [CASE_INDEX_KEY]: plan.index } : {}),
      ...(hasPlainEntries ? { [ENTRIES_KEY]: [] } : {}) });
    // A plain list beside the records came from an older version; its cases are part of this write.
    const kept = new Set(plan.ids.flatMap(id => [caseRecordKey(id), caseBrowseKey(id)]));
    const leftovers = [...plan.removedKeys.flatMap(key => [key, caseBrowseKey(caseIdFromRecordKey(key))]), ...cache.orphanKeys.filter(key => !kept.has(key)),
      ...(hasPlainEntries ? [ENTRIES_KEY] : [])];
    caseCache = { revision: update[CASE_LIBRARY_REVISION_KEY], ids: plan.ids, values: plan.values,
      orphanKeys: await cleanup([...new Set(leftovers)]) };
  };
  const updateCase = (entryId, transform, { keys = [], metadata = () => ({}) } = {}) => lock(async () => {
    await assertWritable(backend);
    const key = caseRecordKey(entryId);
    const stored = await backend.get([...new Set([CASE_INDEX_KEY, CASE_LIBRARY_REVISION_KEY, BROWSE_PROJECTION_META_KEY, key, ...keys])]);
    const indexed = indexedCaseIds(stored[CASE_INDEX_KEY]);
    let entries;
    let current;
    if (indexed?.includes(entryId)) {
      if (!Object.hasOwn(stored, key)) throw Object.assign(new Error('案例记录读取不到，资料没有改动'), { code: 'CASE_RECORDS_MISSING', missingIds: [entryId] });
      current = stored[key];
    } else {
      // Old libraries and cases added by an older version retain the established merge/migration.
      const plain = await backend.get(ENTRIES_KEY);
      if (!plain[ENTRIES_KEY]?.some(entry => entry.id === entryId)) throw Object.assign(new Error('没有找到这条案例'), { code: 'CASE_NOT_FOUND' });
      const legacy = indexed ? await read([ENTRIES_KEY, ...keys]) : plain;
      entries = legacy[ENTRIES_KEY] ?? [];
      current = entries.find(entry => entry.id === entryId);
      Object.assign(stored, legacy);
      if (!current) throw Object.assign(new Error('没有找到这条案例'), { code: 'CASE_NOT_FOUND' });
    }
    const next = await transform(structuredClone(current));
    if (!next || next.id !== entryId) throw Object.assign(new Error('案例编号不能在编辑时改变，资料没有改动'), { code: 'CASE_ID_INVALID' });
    if (sameCaseValue(current, next)) return { entry: structuredClone(next), changed: false };
    const extra = await metadata(stored);
    if (!extra || typeof extra !== 'object' || Array.isArray(extra)
      || Object.keys(extra).some(name => touchesCaseLibrary([name]) || name === CASE_INDEX_KEY || name === CASE_LIBRARY_REVISION_KEY || isCaseRecordKey(name) || isBrowseKey(name))) throw new Error('案例附加更新内容无效');
    if (entries) await write(await withSummary({ ...extra, [ENTRIES_KEY]: entries.map(entry => entry.id === entryId ? next : entry) }));
    else {
      const nextRevision = revision();
      const snapshot = structuredClone(next);
      await backend.set({ ...extra, [key]: snapshot, [caseBrowseKey(entryId)]: caseBrowseProjection(snapshot), [CASE_LIBRARY_REVISION_KEY]: nextRevision,
        ...(validBrowseMarker(stored[BROWSE_PROJECTION_META_KEY], stored[CASE_LIBRARY_REVISION_KEY]) ? { [BROWSE_PROJECTION_META_KEY]: browseMarker(nextRevision) } : {}) });
      updateCachedCases({ [key]: { newValue: snapshot }, [CASE_LIBRARY_REVISION_KEY]: { oldValue: stored[CASE_LIBRARY_REVISION_KEY], newValue: nextRevision } });
    }
    return { entry: structuredClone(next), changed: true };
  });
  return Object.freeze({
    get: read,
    // View readers may share frozen case records; editing callers keep the mutable get contract.
    getSnapshot: keys => read(keys, true),
    getSnapshotBatches,
    updateCase,
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
        ? (await backend.getKeys()).filter(key => isCaseRecordKey(key) || isBrowseKey(key) || key === CASE_INDEX_KEY) : [];
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
      const handler = (values, area) => {
        if (area !== 'local') return;
        values = Object.fromEntries(Object.entries(values).filter(([key]) => !isBrowseKey(key)));
        // Staged records and auxiliary deletions do not change the indexed library. Every actual
        // case commit includes the revision; only those records may update a page's visible list.
        if (!Object.hasOwn(values, CASE_LIBRARY_REVISION_KEY)) values = Object.fromEntries(Object.entries(values)
          .filter(([key]) => !isCaseRecordKey(key)));
        if (Object.keys(values).length) listener(translateCaseChanges(values));
      };
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
  const commit = async (update, options = {}) => {
    const done = startPhase("background", "write");
    try {
      return await commitLibraryUpdate(update, options);
    } finally {
      done({ bytes: () => jsonBytes(update) });
    }
  };
  commit.updateCase = async (entryId, transform, options = {}) => {
    const done = startPhase('background', 'writeCase');
    const sync = !isSyncApplying() && options.markSyncDirty !== false && syncedKeys.has(ENTRIES_KEY);
    try {
      return await storage.updateCase(entryId, transform, sync ? {
        keys: [syncMetaKey], metadata: stored => ({ [syncMetaKey]: markDirty(stored[syncMetaKey], options.dirtyAssetIds) })
      } : {});
    } finally { done(); }
  };
  return commit;
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
