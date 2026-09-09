import test from "node:test";
import assert from "node:assert/strict";
import { projectMovePlan, projectTreeRows, readProjectExpansion, saveProjectExpansion } from "../project-tree.js";
import { collectionPathLabelsById, moveCollection, normalizeOrganizerState } from "../organizer.js";

function fixture() {
  return normalizeOrganizerState({ collections: [
    { id: "a", name: "广告", parentId: null, order: 0, entryIds: ["case-a"] },
    { id: "b", name: "视频", parentId: "a", order: 0, entryIds: ["case-b"] },
    { id: "c", name: "游戏", parentId: null, order: 1, entryIds: ["case-a"] },
    { id: "d", name: "视频", parentId: "c", order: 0, entryIds: ["case-d"] },
    { id: "e", name: "九月素材", parentId: null, order: 2, entryIds: [] }
  ] });
}

test("search reaches folded descendants, distinguishes duplicate names by path, and preserves expansion", () => {
  const state = fixture();
  const children = new Map();
  for (const item of state.collections) children.set(item.parentId, [...(children.get(item.parentId) || []), item]);
  const expanded = new Set(["c"]);
  const rows = () => projectTreeRows(children, expanded).map((row) => row.collection.id);
  assert.deepEqual(rows(), ["a", "c", "d", "e"]);
  assert.deepEqual(projectTreeRows(children, expanded, "视频", collectionPathLabelsById(state)).map((row) => row.collection.id), ["b", "d"]);
  assert.deepEqual(rows(), ["a", "c", "d", "e"]);
});

test("far moves before, after, inside and to root preserve descendants and case relationships", () => {
  const original = fixture();
  for (const [target, position, parent, order] of [["c", "before", null, 0], ["c", "after", null, 1], ["c", "inside", "c", 1]]) {
    const plan = projectMovePlan(original, "a", target, position);
    const moved = moveCollection(original, "a", plan.parentId, plan.index);
    assert.equal(moved.collections.find((item) => item.id === "a").parentId, parent);
    assert.equal(moved.collections.find((item) => item.id === "a").order, order);
    assert.equal(moved.collections.find((item) => item.id === "b").parentId, "a");
    for (const item of original.collections) assert.deepEqual(moved.collections.find((row) => row.id === item.id).entryIds, item.entryIds);
  }
  const plan = projectMovePlan(original, "b", null);
  assert.equal(plan.parentId, null);
  assert.equal(plan.index, 3);
  assert.equal(original.collections.find((item) => item.id === "b").parentId, "a");
});

test("a project cannot target itself, descendants, or a destination deleted while choosing", () => {
  for (const target of ["a", "b", "deleted"]) assert.throws(() => projectMovePlan(fixture(), "a", target));
  assert.throws(() => projectMovePlan(fixture(), "deleted", "c"));
  assert.throws(() => projectMovePlan(fixture(), "a", null, "before"));
});

test("same-parent placement counts siblings after removing the moving project", () => {
  const state = fixture();
  const plan = projectMovePlan(state, "a", "e", "after");
  assert.equal(plan.index, 2);
  const moved = moveCollection(state, "a", plan.parentId, plan.index);
  const restored = moveCollection(moved, "a", null, 0);
  assert.deepEqual(restored, state);
});

test("folded view can be restored after reload and invalid saved view cannot break library loading", () => {
  const storage = { value: "broken", getItem() { return this.value; }, setItem(key, value) { this.value = value; } };
  assert.deepEqual([...readProjectExpansion(storage)], []);
  saveProjectExpansion(new Set(["a"]), storage);
  assert.deepEqual([...readProjectExpansion(storage)], ["a"]);
});
