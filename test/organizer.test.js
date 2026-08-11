import test from "node:test";
import assert from "node:assert/strict";

import {
  COLLECTION_VISIBILITY,
  createCollection,
  deleteCollection,
  mergeOrganizerState,
  normalizeOrganizerState,
  planCollectionAndEntriesDeletion,
  removeEntriesFromOrganizer,
  replaceCollectionEntries,
  renameCollection,
  isEntryVisibleInLibrary,
  setCollectionVisibility,
  setEntriesCollection
} from "../organizer.js";

test("organizer normalizes duplicate and missing entry references", () => {
  const value = normalizeOrganizerState({
    collections: [{ id: "collection:a", name: "项目 A", entryIds: ["one", "missing", "one"] }]
  }, ["one"]);
  assert.deepEqual(value.collections[0].entryIds, ["one"]);
});

test("organizer drops obsolete saved searches and only keeps explicit projects", () => {
  const normalized = normalizeOrganizerState({
    savedViews: [{ id: "view:old", name: "视频参考", query: "type:video" }],
    collections: [{ id: "collection:a", name: "项目 A", entryIds: [] }]
  });
  assert.equal(normalized.version, 6);
  assert.deepEqual(Object.keys(normalized), ["version", "collections"]);
});

test("a case can belong to multiple project collections", () => {
  let state = createCollection({}, "广告参考").state;
  state = createCollection(state, "电影参考").state;
  state = setEntriesCollection(state, state.collections[0].id, ["one"], true);
  state = setEntriesCollection(state, state.collections[1].id, ["one"], true);
  assert.deepEqual(state.collections.map((item) => item.entryIds), [["one"], ["one"]]);
  assert.equal(renameCollection(state, state.collections[0].id, "广告成片").collections[0].name, "广告成片");
  assert.equal(deleteCollection(state, state.collections[0].id).collections.length, 1);
});

test("organizer merge remaps entry ids and merges same-name collections", () => {
  const merged = mergeOrganizerState({
    collections: [{ id: "collection:local", name: "项目", order: 0, entryIds: ["local"] }]
  }, {
    collections: [{ id: "collection:remote", name: "项目", order: 0, entryIds: ["source"] }]
  }, { source: "imported" });
  assert.deepEqual(merged.collections[0].entryIds, ["local", "imported"]);
});

test("removing a case also removes private organizer references", () => {
  const state = removeEntriesFromOrganizer({
    collections: [{ id: "collection:a", name: "A", entryIds: ["one", "two"] }]
  }, ["one"]);
  assert.deepEqual(state.collections[0].entryIds, ["two"]);
});

test("project and entries deletion is planned atomically and removes shared project references", () => {
  const organizer = {
    collections: [
      { id: "collection:delete", name: "AIArtWorks Midjourney", entryIds: ["one", "two"] },
      { id: "collection:keep", name: "保留项目", entryIds: ["two", "three"] }
    ]
  };
  const result = planCollectionAndEntriesDeletion(
    organizer,
    [{ id: "one" }, { id: "two" }, { id: "three" }],
    "collection:delete",
    "AIArtWorks Midjourney"
  );
  assert.deepEqual(result.deletedEntryIds, ["one", "two"]);
  assert.deepEqual(result.entries, [{ id: "three" }]);
  assert.deepEqual(result.organizerState.collections, [{
    id: "collection:keep",
    name: "保留项目",
    order: 1,
    entryIds: ["three"],
    visibility: COLLECTION_VISIBILITY.library
  }]);
});

test("project and entries deletion rejects a stale or mistyped confirmation name", () => {
  assert.throws(() => planCollectionAndEntriesDeletion({
    collections: [{ id: "collection:a", name: "准确名称", entryIds: ["one"] }]
  }, [{ id: "one" }], "collection:a", "错误名称"), /项目名称不匹配/);
});

test("project membership can be replaced atomically in visual selection order", () => {
  const state = replaceCollectionEntries({
    collections: [{ id: "collection:a", name: "A", entryIds: ["old", "keep"] }]
  }, "collection:a", ["keep", "new", "keep"]);
  assert.deepEqual(state.collections[0].entryIds, ["keep", "new"]);
});

test("project-only cases leave the main library unless another visible project also contains them", () => {
  let state = createCollection({}, "字体参考").state;
  state = createCollection(state, "当前项目").state;
  state = setEntriesCollection(state, state.collections[0].id, ["font", "shared"], true);
  state = setEntriesCollection(state, state.collections[1].id, ["shared"], true);
  state = setCollectionVisibility(state, state.collections[0].id, COLLECTION_VISIBILITY.projectOnly);

  assert.equal(isEntryVisibleInLibrary(state, "font"), false);
  assert.equal(isEntryVisibleInLibrary(state, "shared"), true);
  assert.equal(isEntryVisibleInLibrary(state, "unassigned"), true);
  assert.equal(state.collections[0].visibility, COLLECTION_VISIBILITY.projectOnly);
});

test("organizer upgrade permanently discards legacy project methods", () => {
  const normalized = normalizeOrganizerState({
    collections: [{
      id: "collection:a", name: "项目", entryIds: ["one"],
      projectMethods: { image: { systemInstruction: "legacy" } }
    }]
  }, ["one"]);
  assert.equal(Object.hasOwn(normalized.collections[0], "projectMethods"), false);
});
