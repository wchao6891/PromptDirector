import test from "node:test";
import assert from "node:assert/strict";
import {
  AI_TASKS,
  mergeAiServiceProfiles,
  normalizeAiTaskRoutes,
  publicAiServiceProfiles,
  resolveAiTaskRoute
} from "../ai-task-routing.js";

test("every AI task has one explicit valid default route", () => {
  const routes = normalizeAiTaskRoutes();
  assert.deepEqual(Object.keys(routes), AI_TASKS.map((item) => item.id));
  assert.equal(routes["video-analysis"].serviceId, "gemini");
});

test("service credentials remain private and blank updates preserve existing keys", () => {
  const profiles = mergeAiServiceProfiles({ gemini: { apiKey: "secret", model: "video-model" } }, { gemini: { apiKey: "", model: "next-model" } });
  assert.equal(profiles.gemini.apiKey, "secret");
  assert.deepEqual(publicAiServiceProfiles(profiles).gemini, { model: "next-model", configured: true });
  assert.equal(JSON.stringify(publicAiServiceProfiles(profiles)).includes("secret"), false);
});

test("video analysis never silently routes to a non-video service", () => {
  assert.throws(() => resolveAiTaskRoute("video-analysis", {}, { profiles: {} }), /Gemini/);
  assert.deepEqual(resolveAiTaskRoute("video-analysis", {}, { profiles: { gemini: { apiKey: "key", model: "video-model" } } }), {
    taskId: "video-analysis", serviceId: "gemini", provider: "Google Gemini", model: "video-model"
  });
});

test("xAI video generation uses its video model without becoming a video-analysis route", () => {
  const routes = normalizeAiTaskRoutes({ "video-generation": { serviceId: "xai" } });
  const resolved = resolveAiTaskRoute("video-generation", routes, {
    profiles: { xai: { apiKey: "xai-key", textModel: "text", videoModel: "video", mediaConsent: true } }
  });
  assert.deepEqual(resolved, {
    taskId: "video-generation",
    serviceId: "xai",
    provider: "xAI",
    model: "video"
  });
  assert.equal(normalizeAiTaskRoutes({ "video-analysis": { serviceId: "xai" } })["video-analysis"].serviceId, "gemini");
});
