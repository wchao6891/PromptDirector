import test from "node:test";
import assert from "node:assert/strict";

import {
  libraryStoredAssetIds,
  libraryStoredAssets
} from "../library-asset-inventory.js";

test("one library asset inventory covers every durable synced resource without duplicating shared ids", () => {
  const shared = { id: "asset:shared", storageMode: "managed" };
  const state = {
    entries: [{ mediaAssets: [shared, { id: "asset:entry", storageMode: "managed" }] }],
    trashState: { items: [
      { kind: "entry", snapshot: { mediaAssets: [shared, { id: "asset:trash-entry" }] } },
      { kind: "media", snapshot: { mediaAssets: [{ id: "asset:trash-media" }] } }
    ] },
    creativeRuns: [{ outputs: [{ visual: { id: "asset:creative" } }] }],
    creativeSkills: { items: [{ packageFiles: [{ assetId: "asset:skill" }] }] },
    composerSessions: [{ referenceSnapshots: [
      { sourceType: "temporary", assetRefs: [{ assetId: "asset:temporary" }] },
      { sourceType: "case", assetRefs: [{ assetId: "asset:not-temporary" }] }
    ] }]
  };

  assert.deepEqual(libraryStoredAssetIds(state), new Set([
    "asset:shared",
    "asset:entry",
    "asset:trash-entry",
    "asset:trash-media",
    "asset:creative",
    "asset:skill",
    "asset:temporary"
  ]));
  assert.equal(libraryStoredAssets(state).filter((item) => item.id === "asset:shared").length, 2);
});

test("local-only jobs staging and recovery media are retained locally but never enter sync by default", () => {
  const state = {
    entries: [],
    creativeJobs: { items: [{ request: { session: { referenceSnapshots: [{
      sourceType: "temporary",
      assetRefs: [{ assetId: "asset:job" }]
    }] } } }] },
    importStaging: { assets: [{ assetId: "asset:staged", posterAssetId: "asset:poster" }] },
    libraryReplacementRecoveryPoint: {
      state: { entries: [{ mediaAssets: [{ id: "asset:recovery-state" }] }] },
      retainedAssetIds: ["asset:recovery-retained"]
    }
  };

  assert.deepEqual(libraryStoredAssetIds(state), new Set());
  assert.deepEqual(libraryStoredAssetIds(state, { includeLocalOnly: true }), new Set([
    "asset:job",
    "asset:staged",
    "asset:poster",
    "asset:recovery-state",
    "asset:recovery-retained"
  ]));
});
