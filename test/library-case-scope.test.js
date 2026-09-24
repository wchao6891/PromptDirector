import test from "node:test";
import assert from "node:assert/strict";
import { libraryCaseScopes } from "../extension/library-case-scope.js";

test("folder identity follows full paths, not device ids or leaf names", () => {
  function scopes(prefix, rootName) {
    return libraryCaseScopes({ entries: [{ id: "case" }], organizerState: { collections: [
      { id: `${prefix}:root`, name: rootName, entryIds: [] },
      { id: `${prefix}:child`, parentId: `${prefix}:root`, name: "素材", entryIds: ["case"] }
    ] } }).get("case");
  }
  assert.equal(scopes("local", "Project A"), scopes("incoming", "project_a"));
  assert.notEqual(scopes("local", "Project A"), scopes("incoming", "Project B"));
});

test("legacy multi-folder ownership is compared as a complete set, without mutating it", () => {
  const state = { entries: [{ id: "a" }, { id: "b" }, { id: "c" }], organizerState: { collections: [
    { id: "p", name: "P", entryIds: ["a", "b", "c"] },
    { id: "q", name: "Q", entryIds: ["a", "b"] }
  ] } };
  const before = structuredClone(state);
  const scopes = libraryCaseScopes(state);
  assert.equal(scopes.get("a"), scopes.get("b"));
  assert.notEqual(scopes.get("a"), scopes.get("c"));
  assert.deepEqual(state, before);
});

test("identical members inside one compound retain independent identities and order", () => {
  const scopes = libraryCaseScopes({
    entries: [{ id: "a" }, { id: "b" }, { id: "c" }],
    compoundCases: [{ id: "pair", memberEntryIds: ["a", "b"] }]
  });
  assert.equal(new Set(scopes.values()).size, 3);
});
