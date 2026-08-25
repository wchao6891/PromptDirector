import test from "node:test";
import assert from "node:assert/strict";

import { buildAutomaticVisionJob } from "../automatic-vision.js";

const entries = [{
  id: "case-one",
  primaryMediaId: "image-one",
  mediaAssets: [
    { id: "image-one", kind: "image", usage: "content" },
    { id: "image-two", kind: "image", usage: "content" },
    {
      id: "image-done",
      kind: "image",
      usage: "content",
      visionAnalysis: {
        version: 2,
        quality: "complete",
        reconstructionPrompt: "already analyzed",
        tags: [{ g: "light.direction", t: "逆光" }]
      }
    },
    { id: "video-poster", kind: "image", usage: "poster" }
  ]
}];

test("automatic import vision queues every unanalysed content image and excludes posters", () => {
  const job = buildAutomaticVisionJob(entries, ["case-one"], {
    providerType: "openai", model: "vision-model", outputLocale: "zh-CN",
    id: "automatic:one", now: "2026-08-05T00:00:00.000Z"
  });
  assert.deepEqual(job.items.map((item) => item.visualId), ["image-one", "image-two"]);
  assert.equal(job.includeAllImages, true);
  assert.equal(job.requestCount, 2);
});

test("automatic import vision merges newly added images without paying twice", () => {
  const current = buildAutomaticVisionJob(entries, ["case-one"], {
    providerType: "openai", model: "vision-model", outputLocale: "zh-CN",
    id: "automatic:one", now: "2026-08-05T00:00:00.000Z"
  });
  const expandedEntries = structuredClone(entries);
  expandedEntries[0].mediaAssets.push({ id: "image-three", kind: "image", usage: "content" });
  const merged = buildAutomaticVisionJob(expandedEntries, ["case-one"], {
    providerType: "openai", model: "vision-model", outputLocale: "zh-CN",
    now: "2026-08-05T00:01:00.000Z"
  }, current);
  assert.deepEqual(merged.items.map((item) => item.visualId), ["image-one", "image-two", "image-three"]);
  assert.equal(buildAutomaticVisionJob(expandedEntries, ["case-one"], {
    providerType: "openai", model: "vision-model", outputLocale: "zh-CN"
  }, merged), null);
});
