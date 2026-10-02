import { LIBRARY_VIEW_SUMMARY_KEY, LIBRARY_VIEW_SUMMARY_SOURCES, updateLibraryViewSummary, composerSessionSummaries } from './library-view-summary.js';

// Browser metadata writes share one lock across extension pages. Read/modify/write
// commits preserve concurrent sync markers; originals stay in media-store.js.
export function createLibraryStorage({ backend, changes, lock }) {
  if (!["get", "set", "remove"].every(name => typeof backend?.[name] === "function") || typeof lock !== "function") {
    throw new Error("资料读写接口缺少存储或写入协调能力。");
  }
  const withSummary = async update => {
    if (Object.hasOwn(update, 'composerSessions')) update = { ...update, composerSessionSummaries: composerSessionSummaries(update.composerSessions) };
    if (!LIBRARY_VIEW_SUMMARY_SOURCES.some(key => Object.hasOwn(update, key))) return update;
    const stored = await backend.get(LIBRARY_VIEW_SUMMARY_KEY);
    return { ...update, [LIBRARY_VIEW_SUMMARY_KEY]: updateLibraryViewSummary(update[LIBRARY_VIEW_SUMMARY_KEY] || stored[LIBRARY_VIEW_SUMMARY_KEY], update) };
  };
  return Object.freeze({
    get: keys => backend.get(keys),
    // Available before our minimum Chrome version; never load values to enumerate keys.
    getKeys: () => backend.getKeys(),
    set: values => lock(async () => backend.set(await withSummary(values))),
    remove: keys => lock(() => {
      const removed = typeof keys === 'string' ? [keys] : keys;
      // Invalidate derived values in the same lock. The next reader rebuilds
      // them from the retained source instead of advertising a deleted undo.
      return backend.remove([...new Set([...removed,
        ...(removed.some(key => LIBRARY_VIEW_SUMMARY_SOURCES.includes(key)) ? [LIBRARY_VIEW_SUMMARY_KEY] : []),
        ...(removed.includes('composerSessions') ? ['composerSessionSummaries'] : [])
      ])]);
    }),
    // Read/modify/write is serialized with every set/remove using this backend.
    // The transform must not call a nested write on this same interface.
    update: (keys, transform) => lock(async () => {
      const update = await transform(await backend.get(keys));
      if (!update || typeof update !== "object" || Array.isArray(update)) throw new Error("资料更新内容无效。");
      await backend.set(await withSummary(update));
    }),
    subscribe: listener => {
      if (!changes) throw new Error("资料变化通知不可用。");
      const handler = (values, area) => { if (area === "local") listener(values); };
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
    lock: operation => navigator.locks.request("promptdirector-library-metadata-write", operation)
  });
  return boundStorage;
}

export function createLibraryCommitter({ storage, syncedKeys, syncMetaKey, markDirty, isSyncApplying }) {
  return async (update, options = {}) => {
    const payload = { ...update };
    const affectsSync = Object.keys(payload).some(key => syncedKeys.has(key));
    if (isSyncApplying() || options.markSyncDirty === false || !affectsSync) return storage.set(payload);
    return storage.update(syncMetaKey, stored => ({
      ...payload,
      [syncMetaKey]: markDirty(stored[syncMetaKey], options.dirtyAssetIds)
    }));
  };
}
