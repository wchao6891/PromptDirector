import test from "node:test";
import assert from "node:assert/strict";

import { reconcileLibrarySemanticIdentity } from "../library-semantic-identity.js";

test("complete semantic duplicates converge to one stable case and keep every project relationship", () => {
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
      { id: "project:a", entryIds: ["case:a"] },
      { id: "project:b", entryIds: ["case:b"] }
    ] },
    compoundCases: [{
      id: "compound:one",
      memberEntryIds: ["case:b", "case:c"],
      coverVisualId: "asset:b"
    }],
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
    ["case:a"],
    ["case:a"]
  ]);
  assert.deepEqual(result.state.compoundCases[0].memberEntryIds, ["case:a", "case:c"]);
  assert.equal(result.state.compoundCases[0].coverVisualId, "asset:a");
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
