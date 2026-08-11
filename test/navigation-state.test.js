import test from "node:test";
import assert from "node:assert/strict";

import {
  LIBRARY_RETURN_STORAGE_KEY,
  buildNavigationState,
  buildNavigationUrl,
  deriveNavigationSnapshot,
  createLibraryReturnRestore,
  parseLibraryReturnSnapshot,
  serializeLibraryReturnSnapshot
} from "../navigation-state.js";

function normalizeRoute(route) {
  const view = ["list", "detail", "editor", "refine", "create"].includes(route?.view) ? route.view : "list";
  const skillId = view === "list" || view === "create" ? "" : String(route?.skillId ?? "");
  return skillId ? { view, skillId } : view === "create" ? { view: "create", skillId: "" } : { view: "list", skillId: "" };
}

function parseRoute(search) {
  const params = new URLSearchParams(search);
  return { view: params.get("view"), skillId: params.get("skill") };
}

test("deriveNavigationSnapshot restores same-tab history state without resetting depth", () => {
  const snapshot = deriveNavigationSnapshot({
    stateKey: "skillPage",
    historyState: { skillPage: true, depth: 3, sourcePage: "composer", view: "detail", skillId: "skill:42" },
    locationSearch: "?source=library&view=list",
    parseRoute,
    normalizeRoute
  });

  assert.deepEqual(snapshot.route, { view: "detail", skillId: "skill:42" });
  assert.equal(snapshot.sourcePage, "composer");
  assert.equal(snapshot.depth, 3);
  assert.equal(snapshot.replace, false);
});

test("deriveNavigationSnapshot falls back to URL params and seeds a new state on first load", () => {
  const snapshot = deriveNavigationSnapshot({
    stateKey: "skillPage",
    historyState: null,
    locationSearch: "?source=composer&view=detail&skill=skill:7",
    parseRoute,
    normalizeRoute
  });

  assert.deepEqual(snapshot.route, { view: "detail", skillId: "skill:7" });
  assert.equal(snapshot.sourcePage, "composer");
  assert.equal(snapshot.depth, 0);
  assert.equal(snapshot.replace, true);
});

test("deriveNavigationSnapshot canonicalizes invalid stored route or source", () => {
  const snapshot = deriveNavigationSnapshot({
    stateKey: "skillPage",
    historyState: { skillPage: true, depth: 9, sourcePage: "unknown", view: "broken", skillId: "skill:9" },
    locationSearch: "?source=unknown&view=broken",
    parseRoute,
    normalizeRoute
  });

  assert.deepEqual(snapshot.route, { view: "list", skillId: "" });
  assert.equal(snapshot.sourcePage, "library");
  assert.equal(snapshot.depth, 9);
  assert.equal(snapshot.replace, true);
});

test("buildNavigationState and buildNavigationUrl preserve source, route, and depth contract", () => {
  const state = buildNavigationState({
    stateKey: "skillPage",
    route: { view: "editor", skillId: "skill:12" },
    sourcePage: "composer",
    depth: 4
  });

  assert.deepEqual(state, {
    skillPage: true,
    depth: 4,
    sourcePage: "composer",
    view: "editor",
    skillId: "skill:12"
  });

  const href = buildNavigationUrl("chrome-extension://example/skills.html?view=list", {
    route: { view: "editor", skillId: "skill:12" },
    sourcePage: "composer"
  });
  assert.match(href, /skills\.html\?source=composer&view=editor&skill=skill%3A12$/);
});

test("library return snapshots serialize canonical collection, facets, query, and scroll position", () => {
  const serialized = serializeLibraryReturnSnapshot({
    collectionId: "collection:7",
    contentId: "content:prompt:image",
    facetNodeIds: ["facet:2", "facet:1", "facet:2"],
    pendingOnly: true,
    query: "银色角色",
    scrollY: 428.7
  });

  assert.deepEqual(JSON.parse(serialized), {
    collectionId: "collection:7",
    contentId: "content:prompt:image",
    facetNodeIds: ["facet:2", "facet:1"],
    pendingOnly: true,
    query: "银色角色",
    scrollY: 429
  });
});

test("invalid library return snapshot data is rejected instead of leaking broken state", () => {
  assert.equal(parseLibraryReturnSnapshot("{"), null);
  assert.equal(parseLibraryReturnSnapshot(JSON.stringify({
    collectionId: 7,
    contentId: "",
    facetNodeIds: "facet:1",
    pendingOnly: false,
    query: null,
    scrollY: "far"
  })), null);
});

test("library return restore waits for initialization readiness and only applies once per page boot", () => {
  const storage = new Map();
  storage.set(LIBRARY_RETURN_STORAGE_KEY, serializeLibraryReturnSnapshot({
    collectionId: "collection:1",
    contentId: "",
    facetNodeIds: ["facet:1"],
    pendingOnly: false,
    query: "雾夜",
    scrollY: 320
  }));
  const applied = [];
  const restore = createLibraryReturnRestore({
    storage: {
      getItem: (key) => storage.get(key) ?? null,
      setItem: (key, value) => storage.set(key, value)
    },
    applySnapshot: (snapshot) => applied.push(snapshot)
  });

  assert.equal(restore(false), false);
  assert.deepEqual(applied, []);
  assert.equal(restore(true), true);
  assert.deepEqual(applied, [{
    collectionId: "collection:1",
    contentId: "",
    facetNodeIds: ["facet:1"],
    pendingOnly: false,
    query: "雾夜",
    scrollY: 320
  }]);
  assert.equal(restore(true), false);
  assert.equal(storage.has(LIBRARY_RETURN_STORAGE_KEY), true);
});
