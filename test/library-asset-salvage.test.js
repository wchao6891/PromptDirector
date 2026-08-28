import test from "node:test";
import assert from "node:assert/strict";

import { salvageMissingLibraryAssets } from "../library-asset-salvage.js";

test("missing media is isolated across durable library owners while healthy content stays recoverable", () => {
  const state = {
    entries: [
      entry("case:text", "asset:missing", "保留正文"),
      entry("case:media-only", "asset:media-only", ""),
      entry("case:healthy", "asset:healthy", "健康正文")
    ],
    organizerState: { collections: [{ id: "project:one", entryIds: ["case:text", "case:media-only", "case:healthy"] }] },
    compoundCases: [{ id: "compound:one", memberEntryIds: ["case:text", "case:media-only", "case:healthy"], coverVisualId: "asset:missing" }],
    trashState: { items: [{
      id: "trash:media", kind: "media", targetId: "asset:trash-missing",
      snapshot: { mediaAssets: [{ id: "asset:trash-missing" }] },
      relationships: { entryId: "case:healthy", positions: [{ id: "asset:trash-missing", index: 0 }] }
    }] },
    creativeRuns: [{ id: "run:one", outputs: [
      { visual: { id: "asset:run-missing" } },
      { visual: { id: "asset:run-healthy" } }
    ], events: [{ visualId: "asset:run-missing" }, { visualId: "asset:run-healthy" }] }],
    creativeSkills: { items: [{ id: "skill:one", packageFiles: [
      { assetId: "asset:skill-missing" }, { assetId: "asset:skill-healthy" }
    ] }] },
    composerSessions: [{ id: "session:one", referenceSnapshots: [{
      sourceType: "temporary", entryId: "temporary:one", referenceText: "仍有文字",
      assetId: "asset:temp-missing",
      assetRefs: [{ assetId: "asset:temp-missing" }, { assetId: "asset:temp-healthy" }],
      imageRefs: [{ visualId: "asset:temp-missing" }, { visualId: "asset:temp-healthy" }],
      assets: [{ assetId: "asset:temp-missing" }, { assetId: "asset:temp-healthy" }]
    }] }]
  };
  const missing = new Set([
    "asset:missing", "asset:media-only", "asset:trash-missing", "asset:run-missing",
    "asset:skill-missing", "asset:temp-missing"
  ]);

  const result = salvageMissingLibraryAssets(state, missing);

  assert.deepEqual(result.state.entries.map((item) => item.id), ["case:text", "case:healthy"]);
  assert.deepEqual(result.state.entries[0].mediaAssets, []);
  assert.deepEqual(result.state.entries[0].facetAssignments, []);
  assert.deepEqual(result.state.organizerState.collections[0].entryIds, ["case:text", "case:healthy"]);
  assert.deepEqual(result.state.compoundCases[0].memberEntryIds, ["case:text", "case:healthy"]);
  assert.equal(result.state.compoundCases[0].coverVisualId, "");
  assert.deepEqual(result.state.trashState.items, []);
  assert.deepEqual(result.state.creativeRuns[0].outputs.map((output) => output.visual.id), ["asset:run-healthy"]);
  assert.deepEqual(result.state.creativeRuns[0].events.map((event) => event.visualId), ["asset:run-healthy"]);
  assert.deepEqual(result.state.creativeSkills.items[0].packageFiles.map((file) => file.assetId), ["asset:skill-healthy"]);
  assert.deepEqual(result.state.composerSessions[0].referenceSnapshots[0].assetRefs.map((asset) => asset.assetId), ["asset:temp-healthy"]);
  assert.equal(result.state.composerSessions[0].referenceSnapshots[0].assetId, "");
  assert.equal(result.issues.length, missing.size);
});

function entry(id, assetId, text) {
  return {
    id,
    title: text ? id : "",
    text,
    mediaAssets: [{ id: assetId, storageMode: "managed" }],
    primaryMediaId: assetId,
    facetAssignments: [{ source: "vision_model", visualId: assetId }]
  };
}
