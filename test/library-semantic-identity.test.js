import test from "node:test";
import assert from "node:assert/strict";

import { reconcileLibrarySemanticIdentity } from "../extension/library-semantic-identity.js";

test("complete duplicates within one folder converge while preserving creative references", () => {
  const first = semanticEntry("case:a", "asset:a", "a".repeat(64));
  const duplicate = semanticEntry("case:b", "asset:b", "a".repeat(64));
  first.creationMeta = { sourceEntryIds: ["case:a"] };
  duplicate.creationMeta = { sourceEntryIds: ["case:b"] };
  const distinct = semanticEntry("case:c", "asset:c", "c".repeat(64));
  distinct.title = "Distinct";
  distinct.text = "Distinct";
  const result = reconcileLibrarySemanticIdentity({
    entries: [duplicate, distinct, first],
    organizerState: { collections: [
      { id: "project:a", name: "One folder", entryIds: ["case:a", "case:b"] }
    ] },
    composerSessions: [{
      id: "session:one",
      referenceSnapshots: [{
        referenceId: "case:b:asset:b",
        entryId: "case:b",
        assetRefs: [{ assetId: "asset:b" }]
      }]
    }]
  });

  assert.equal(result.changed, true);
  assert.deepEqual(result.state.entries.map((entry) => entry.id), ["case:a", "case:c"]);
  assert.deepEqual(result.state.organizerState.collections.map((project) => project.entryIds), [
    ["case:a"]
  ]);
  assert.equal(result.state.composerSessions[0].referenceSnapshots[0].entryId, "case:a");
  assert.equal(result.state.composerSessions[0].referenceSnapshots[0].referenceId, "case:a:asset:a");
  assert.equal(result.state.composerSessions[0].referenceSnapshots[0].assetRefs[0].assetId, "asset:a");
  assert.deepEqual(result.entryIdMap, { "case:b": "case:a" });
  assert.deepEqual(result.assetIdMap, { "asset:b": "asset:a" });
});

test("uncertain cases without complete managed-media hashes are never deduplicated", () => {
  const result = reconcileLibrarySemanticIdentity({
    entries: [semanticEntry("case:a", "asset:a", ""), semanticEntry("case:b", "asset:b", "")]
  });

  assert.equal(result.changed, false);
  assert.deepEqual(result.state.entries.map((entry) => entry.id), ["case:a", "case:b"]);
});

function semanticEntry(id, assetId, contentHash) {
  return {
    id,
    title: "Same",
    text: "Same",
    mediaAssets: [{
      id: assetId,
      kind: "image",
      usage: "content",
      storageMode: "managed",
      mimeType: "image/webp",
      byteSize: 1,
      ...(contentHash ? { contentHash } : {})
    }],
    primaryMediaId: assetId
  };
}

for (const kind of ["different folders", "compound members", "assigned and unassigned"]) {
  test(`sync must retain independent cases: ${kind}`, () => {
    const state = {
      entries: [semanticEntry("a", "asset:a", "a".repeat(64)), semanticEntry("b", "asset:b", "a".repeat(64))],
      organizerState: { collections: kind === "different folders" ? [
        { id: "p:a", name: "A", entryIds: ["a"] },
        { id: "p:b", name: "B", entryIds: ["b"] }
      ] : kind === "assigned and unassigned" ? [{ id: "p:a", name: "A", entryIds: ["a"] }] : [] },
      compoundCases: kind === "compound members" ? [{ id: "pair", memberEntryIds: ["a", "b"] }] : [],
      composerSessions: [{ referenceSnapshots: [{ entryId: "b", assetRefs: [{ assetId: "asset:b" }] }] }]
    };
    const before = structuredClone(state);
    const result = reconcileLibrarySemanticIdentity(state);
    assert.equal(result.changed, false);
    assert.deepEqual(result.state, before);
    assert.deepEqual(state, before);
  });
}
