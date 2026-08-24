import test from "node:test";
import assert from "node:assert/strict";

import {
  COLLECTION_VISIBILITY,
  createCollection,
  deleteCollection,
  mergeOrganizerState,
  normalizeOrganizerState,
  planCollectionAndEntriesDeletion,
  reorderCollections,
  removeEntriesFromOrganizer,
  replaceCollectionEntries,
  renameCollection,
  isEntryVisibleInLibrary,
  collectionEntryIds,
  collectionPathLabel,
  collectionSelectorLabel,
  collectionSubtreeEntryIdsById,
  collectionSubtreeIds,
  moveCollection,
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
  assert.equal(normalized.version, 7);
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

test("receiver-local project creation time is assigned only to newly imported projects", () => {
  const merged = mergeOrganizerState({
    collections: [{ id: "existing", name: "已有", order: 0, entryIds: ["one"], createdAt: "2026-01-01T00:00:00.000Z" }]
  }, {
    collections: [
      { id: "same-name", name: "已有", order: 0, entryIds: ["two"] },
      { id: "new", name: "新项目", order: 1, entryIds: ["three"], createdAt: "2025-01-01T00:00:00.000Z" }
    ]
  }, { two: "two", three: "three" }, { createdAt: "2026-08-22T00:00:00.000Z" });

  assert.equal(merged.collections[0].createdAt, "2026-01-01T00:00:00.000Z");
  assert.equal(merged.collections[1].createdAt, "2026-08-22T00:00:00.000Z");
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
    parentId: null,
    order: 0,
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

test("project order is normalized after deletion so a new project cannot reuse a stale order", () => {
  const initial = {
    collections: [
      { id: "collection:a", name: "A", order: 4, entryIds: [] },
      { id: "collection:b", name: "B", order: 9, entryIds: [] }
    ]
  };
  const afterDelete = deleteCollection(initial, "collection:a");
  assert.deepEqual(afterDelete.collections.map((item) => item.order), [0]);
  const created = createCollection(afterDelete, "C");
  assert.deepEqual(created.state.collections.map((item) => item.order), [0, 1]);
  assert.ok(Number.isFinite(Date.parse(created.item.createdAt)));
});

test("projects can be reordered without changing member order or inventing legacy creation time", () => {
  const reordered = reorderCollections({
    collections: [
      { id: "collection:a", name: "A", order: 0, entryIds: ["one", "two"] },
      { id: "collection:b", name: "B", order: 1, entryIds: ["three"], createdAt: "2026-08-22T01:02:03.000Z" }
    ]
  }, ["collection:b", "collection:a"]);
  assert.deepEqual(reordered.collections.map((item) => item.id), ["collection:b", "collection:a"]);
  assert.deepEqual(reordered.collections.map((item) => item.order), [0, 1]);
  assert.deepEqual(reordered.collections[1].entryIds, ["one", "two"]);
  assert.equal(Object.hasOwn(reordered.collections[1], "createdAt"), false);
  assert.equal(reordered.collections[0].createdAt, "2026-08-22T01:02:03.000Z");
});

test("project reorder rejects stale, incomplete, or duplicate project lists", () => {
  const state = {
    collections: [
      { id: "collection:a", name: "A", entryIds: [] },
      { id: "collection:b", name: "B", entryIds: [] }
    ]
  };
  assert.throws(() => reorderCollections(state, ["collection:a"]), /刷新后重试/);
  assert.throws(() => reorderCollections(state, ["collection:a", "collection:a"]), /刷新后重试/);
  assert.throws(() => reorderCollections(state, ["collection:a", "collection:missing"]), /刷新后重试/);
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

test("legacy flat projects migrate to roots without changing membership or order", () => {
  const normalized = normalizeOrganizerState({
    version: 6,
    collections: [
      { id: "collection:a", name: "A", order: 1, entryIds: ["one"] },
      { id: "collection:b", name: "B", order: 0, entryIds: ["one", "two"] }
    ]
  });
  assert.deepEqual(normalized.collections.map(({ id, parentId, order, entryIds }) => ({ id, parentId, order, entryIds })), [
    { id: "collection:b", parentId: null, order: 0, entryIds: ["one", "two"] },
    { id: "collection:a", parentId: null, order: 1, entryIds: ["one"] }
  ]);
});

test("projects move across parents and reject cycles", () => {
  const state = normalizeOrganizerState({ collections: [
    { id: "root", name: "根", order: 0, entryIds: ["one"] },
    { id: "peer", name: "同级", order: 1, entryIds: [] },
    { id: "child", name: "子项目", parentId: "root", order: 0, entryIds: ["two"] }
  ] });
  const moved = moveCollection(state, "peer", "root", 0);
  assert.deepEqual(moved.collections.map(({ id, parentId, order }) => ({ id, parentId, order })), [
    { id: "root", parentId: null, order: 0 },
    { id: "peer", parentId: "root", order: 0 },
    { id: "child", parentId: "root", order: 1 }
  ]);
  assert.throws(() => moveCollection(moved, "root", "child", 0), /自身或其子项目/);
});

test("tree helpers preserve paths and deduplicate subtree cases", () => {
  const state = { collections: [
    { id: "root", name: "根", entryIds: ["one"] },
    { id: "child", name: "素材", parentId: "root", entryIds: ["one", "two"] }
  ] };
  assert.deepEqual(collectionSubtreeIds(state, "root"), ["root", "child"]);
  assert.deepEqual(collectionEntryIds(state, "root", { subtree: true }), ["one", "two"]);
  assert.equal(collectionPathLabel(state, "child"), "根 / 素材");
  assert.deepEqual(collectionSubtreeEntryIdsById(state).get("root"), ["one", "two"]);
});

test("project selector labels distinguish literal separators from nested paths", () => {
  const state = { collections: [
    { id: "literal", name: "A › B", entryIds: [] },
    { id: "root", name: "A", entryIds: [] },
    { id: "child", name: "B", parentId: "root", entryIds: [] }
  ] };
  assert.equal(collectionSelectorLabel(state, "literal"), "A ›› B");
  assert.equal(collectionSelectorLabel(state, "child"), "A › B");
});

test("deep project trees normalize and traverse without recursive stack overflow", () => {
  const collections = Array.from({ length: 6000 }, (_, index) => ({
    id: `project:${index}`,
    name: `P${index}`,
    parentId: index ? `project:${index - 1}` : null,
    entryIds: index === 5999 ? ["case:deep"] : []
  }));
  const state = normalizeOrganizerState({ collections });
  assert.equal(state.collections.length, 6000);
  assert.equal(collectionSubtreeIds(state, "project:0").length, 6000);
  assert.deepEqual(collectionEntryIds(state, "project:0", { subtree: true }), ["case:deep"]);
});

test("project names are unique only among siblings", () => {
  let state = createCollection({}, "根 A").state;
  state = createCollection(state, "根 B").state;
  const [rootA, rootB] = state.collections;
  state = createCollection(state, "素材", rootA.id).state;
  state = createCollection(state, "素材", rootB.id).state;
  assert.equal(state.collections.filter((item) => item.name === "素材").length, 2);
  assert.throws(() => createCollection(state, "素材", rootA.id), /已经存在/);
});
