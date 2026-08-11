const DEFAULT_SOURCES = ["library", "composer"];
export const LIBRARY_RETURN_STORAGE_KEY = "promptDirector.libraryReturn";

export function buildNavigationState({ stateKey, route, sourcePage, depth }) {
  return {
    [stateKey]: true,
    depth: Number.isFinite(depth) ? depth : 0,
    sourcePage,
    view: route?.view || "list",
    skillId: route?.skillId || ""
  };
}

export function buildNavigationUrl(currentHref, { route, sourcePage }) {
  const url = new URL(currentHref);
  url.searchParams.delete("source");
  url.searchParams.delete("view");
  url.searchParams.delete("skill");
  url.searchParams.set("source", sourcePage);
  if (route?.view && route.view !== "list") url.searchParams.set("view", route.view);
  if (route?.skillId) url.searchParams.set("skill", route.skillId);
  return url.href;
}

export function deriveNavigationSnapshot({
  stateKey,
  historyState,
  locationSearch,
  parseRoute,
  normalizeRoute,
  allowedSources = DEFAULT_SOURCES,
  fallbackSource = "library"
}) {
  const routeFromLocation = normalizeRoute(parseRoute(locationSearch));
  const sourceFromLocation = normalizeSource(new URLSearchParams(locationSearch).get("source"), {
    allowedSources,
    fallbackSource
  });
  const savedState = historyState?.[stateKey] === true ? historyState : null;
  const depth = Number.isFinite(savedState?.depth) ? savedState.depth : 0;
  const sourcePage = normalizeSource(savedState?.sourcePage ?? sourceFromLocation, {
    allowedSources,
    fallbackSource
  });
  const route = normalizeRoute(savedState
    ? { view: savedState.view, skillId: savedState.skillId }
    : routeFromLocation);
  const replace = !savedState ||
    savedState.sourcePage !== sourcePage ||
    savedState.view !== route.view ||
    (savedState.skillId || "") !== route.skillId;
  return { sourcePage, route, depth, replace };
}

function normalizeSource(value, { allowedSources, fallbackSource }) {
  return allowedSources.includes(value) ? value : fallbackSource;
}

export function serializeLibraryReturnSnapshot(snapshot) {
  return JSON.stringify(normalizeLibraryReturnSnapshot(snapshot));
}

export function parseLibraryReturnSnapshot(serialized) {
  try {
    return normalizeLibraryReturnSnapshot(JSON.parse(serialized));
  } catch {
    return null;
  }
}

export function createLibraryReturnRestore({
  storage,
  key = LIBRARY_RETURN_STORAGE_KEY,
  applySnapshot
}) {
  let restored = false;
  return function restoreWhenReady(isReady) {
    if (!isReady || restored) return false;
    const snapshot = parseLibraryReturnSnapshot(storage?.getItem?.(key) ?? "");
    if (!snapshot) return false;
    applySnapshot(snapshot);
    restored = true;
    return true;
  };
}

function normalizeLibraryReturnSnapshot(value) {
  const collectionId = typeof value?.collectionId === "string" ? value.collectionId : null;
  const contentId = typeof value?.contentId === "string" ? value.contentId : null;
  const facetNodeIds = Array.isArray(value?.facetNodeIds)
    ? [...new Set(value.facetNodeIds.filter((item) => typeof item === "string" && item))]
    : null;
  const pendingOnly = typeof value?.pendingOnly === "boolean" ? value.pendingOnly : null;
  const query = typeof value?.query === "string" ? value.query : null;
  const scrollY = Number.isFinite(value?.scrollY) ? Math.max(0, Math.round(value.scrollY)) : null;
  if (collectionId === null || contentId === null || facetNodeIds === null || pendingOnly === null || query === null || scrollY === null) return null;
  return { collectionId, contentId, facetNodeIds, pendingOnly, query, scrollY };
}
