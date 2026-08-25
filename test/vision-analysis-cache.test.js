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
        reconstructionPrompt: `${quality} result`,
        tags: [{ g: "style.render", t: "电影写实" }],
        imageFingerprint: "same-image",
        profileFingerprint: "same-profile",
        locale: "zh-CN",
        catalogRevision: 7,
        ...overrides
      }
    }]
  };
}

test("persisted vision cache reuses only complete atomic results and ignores legacy partial output", () => {
  const options = { fingerprint: "same-image", profileFingerprint: "same-profile", locale: "zh-CN", catalogRevision: 7 };
  const partial = findPersistedVisionAnalysis([entryWithAnalysis("partial", "partial")], options);
  assert.equal(partial, null);

  const complete = findPersistedVisionAnalysis([
    entryWithAnalysis("partial", "partial"),
    entryWithAnalysis("complete", "complete")
  ], options);
  assert.equal(complete.quality, "complete");
});

test("persisted vision cache rejects records missing either the reverse prompt or tags", () => {
  const options = { fingerprint: "same-image", profileFingerprint: "same-profile", locale: "zh-CN", catalogRevision: 7 };
  assert.equal(findPersistedVisionAnalysis([
    entryWithAnalysis("no-prompt", "complete", { reconstructionPrompt: "" })
  ], options), null);
  assert.equal(findPersistedVisionAnalysis([
    entryWithAnalysis("no-tags", "complete", { tags: [] })
  ], options), null);
  assert.equal(findPersistedVisionAnalysis([
    entryWithAnalysis("invalid-tags", "complete", { tags: [{ g: "", t: "伪标签" }, {}] })
  ], options), null);
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
