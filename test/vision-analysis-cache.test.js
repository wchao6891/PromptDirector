import test from "node:test";
import assert from "node:assert/strict";

import { findPersistedVisionAnalysis } from "../vision-analysis-cache.js";

function entryWithAnalysis(id, quality, overrides = {}) {
  return {
    id,
    primaryMediaId: `${id}-image`,
    mediaAssets: [{
      id: `${id}-image`,
      kind: "image",
      storageMode: "managed",
      mimeType: "image/png",
      byteSize: 10,
      visionAnalysis: {
        version: 2,
        quality,
        description: `${quality} result`,
        imageFingerprint: "same-image",
        profileFingerprint: "same-profile",
        locale: "zh-CN",
        catalogRevision: 7,
        ...overrides
      }
    }]
  };
}

test("persisted vision cache prefers a complete matching result and can use a partial result as completion input", () => {
  const options = { fingerprint: "same-image", profileFingerprint: "same-profile", locale: "zh-CN", catalogRevision: 7 };
  const partial = findPersistedVisionAnalysis([entryWithAnalysis("partial", "partial")], options);
  assert.equal(partial.quality, "partial");

  const complete = findPersistedVisionAnalysis([
    entryWithAnalysis("partial", "partial"),
    entryWithAnalysis("complete", "complete")
  ], options);
  assert.equal(complete.quality, "complete");
});

test("persisted vision cache rejects stale model, locale, taxonomy, and protocol matches", () => {
  const entry = entryWithAnalysis("stale", "complete");
  assert.equal(findPersistedVisionAnalysis([entry], {
    fingerprint: "same-image", profileFingerprint: "different-profile", locale: "zh-CN", catalogRevision: 7
  }), null);
  assert.equal(findPersistedVisionAnalysis([entry], {
    fingerprint: "same-image", profileFingerprint: "same-profile", locale: "en", catalogRevision: 7
  }), null);
  assert.equal(findPersistedVisionAnalysis([entry], {
    fingerprint: "same-image", profileFingerprint: "same-profile", locale: "zh-CN", catalogRevision: 8
  }), null);
});
