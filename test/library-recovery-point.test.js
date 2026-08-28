import test from "node:test";
import assert from "node:assert/strict";

import {
  createLibraryReplacementRecoveryPoint,
  normalizeLibraryReplacementRecoveryPoint,
  obsoleteRecoveryAssetIds,
  swapLibraryReplacementRecoveryPoint
} from "../library-recovery-point.js";

test("a replacement recovery point snapshots managed state and retained media without sharing references", () => {
  const current = managedState("local");
  const point = createLibraryReplacementRecoveryPoint(current, {
    id: "recovery:one",
    createdAt: "2026-08-28T00:10:00.000Z",
    retainedAssetIds: ["media:local", "media:local"]
  });
  current.entries[0].text = "后来修改";

  assert.equal(point.state.entries[0].text, "local");
  assert.deepEqual(point.retainedAssetIds, ["media:local"]);
  assert.deepEqual(normalizeLibraryReplacementRecoveryPoint(point), point);
});

test("rolling back swaps the saved state and keeps the replaced state as the next recovery point", () => {
  const current = managedState("after replace");
  const previous = createLibraryReplacementRecoveryPoint(managedState("before replace"), {
    id: "recovery:previous",
    createdAt: "2026-08-28T00:10:00.000Z",
    retainedAssetIds: ["media:before"]
  });

  const swapped = swapLibraryReplacementRecoveryPoint(current, previous, {
    id: "recovery:after",
    createdAt: "2026-08-28T00:20:00.000Z",
    retainedAssetIds: ["media:after"]
  });

  assert.equal(swapped.targetState.entries[0].text, "before replace");
  assert.equal(swapped.recoveryPoint.state.entries[0].text, "after replace");
  assert.deepEqual(swapped.recoveryPoint.retainedAssetIds, ["media:after"]);
});

test("a later exact replace cleans only assets no longer referenced by the live library or newest recovery point", () => {
  const previous = createLibraryReplacementRecoveryPoint(managedState("old"), {
    retainedAssetIds: ["media:old-only", "media:shared"]
  });
  const next = createLibraryReplacementRecoveryPoint(managedState("current"), {
    retainedAssetIds: ["media:current", "media:shared"]
  });

  assert.deepEqual(obsoleteRecoveryAssetIds(previous, ["media:new-live"], next), ["media:old-only"]);
});

function managedState(text) {
  return {
    entries: [{ id: `case:${text}`, text, mediaAssets: [], primaryMediaId: "" }],
    trashState: { version: 1, items: [] },
    organizerState: { version: 1, collections: [] },
    compoundCases: [],
    settings: {},
    taxonomy: { version: 1, nodes: [] },
    facetCatalog: { version: 1, facets: [], nodes: [] },
    classificationRules: [],
    composerSettings: {},
    composerSessions: [],
    creativeExperimentSettings: {},
    creativeRuns: [],
    creativeSkills: { version: 1, items: [] }
  };
}
