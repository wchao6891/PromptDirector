import test from "node:test";
import assert from "node:assert/strict";

import { buildAutomaticVisionJob } from "../extension/automatic-vision.js";

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

test("a paused automatic job resumes with its unfinished images when the same service queues more work", () => {
  const route = { providerType: "openai", providerId: "openai", model: "vision-model", outputLocale: "zh-CN" };
  const paused = { ...buildAutomaticVisionJob(entries, ["case-one"], { ...route, id: "automatic:paused" }), status: "paused" };
  const resumed = buildAutomaticVisionJob(entries, ["case-one"], route, paused);
  assert.equal(resumed.id, "automatic:paused");
  assert.equal(resumed.status, "running");
  assert.deepEqual(resumed.items.map((item) => item.visualId), ["image-one", "image-two"]);
});

test("changing the automatic image model carries unfinished images into a job for the current model", () => {
  const oldRoute = { providerType: "openai", providerId: "openai", model: "old-model", outputLocale: "zh-CN" };
  let current = buildAutomaticVisionJob(entries, ["case-one"], { ...oldRoute, id: "automatic:old" });
  current = { ...current, items: current.items.map((item) => item.visualId === "image-one"
    ? { ...item, status: "succeeded" }
    : item) };
  const analysed = structuredClone(entries);
  analysed[0].mediaAssets[0].visionAnalysis = structuredClone(analysed[0].mediaAssets[2].visionAnalysis);
  const next = buildAutomaticVisionJob(analysed, [], { ...oldRoute, model: "new-model", id: "automatic:new" }, current);
  assert.equal(next.id, "automatic:new");
  assert.equal(next.model, "new-model");
  assert.deepEqual(next.items.map((item) => item.visualId), ["image-two"], "only the unfinished image is requeued, nothing already paid is resent");
});
