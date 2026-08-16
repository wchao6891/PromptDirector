import test from "node:test";
import assert from "node:assert/strict";
import {
  normalizeAiServiceProfiles,
  publicAiServiceProfiles
} from "../ai-service-profiles.js";

test("runtime service profiles are normalized without inventing defaults", () => {
  assert.deepEqual(normalizeAiServiceProfiles(), {
    gemini: { apiKey: "", model: "" },
    xai: {
      apiKey: "",
      textModel: "",
      imageModel: "",
      videoModel: "",
      mediaConsent: false
    }
  });
});

test("public runtime profiles expose readiness but never credentials", () => {
  const profiles = publicAiServiceProfiles({
    gemini: { apiKey: "gemini-secret", model: "video-model" },
    xai: {
      apiKey: "xai-secret",
      textModel: "text-model",
      mediaConsent: true
    }
  });

  assert.deepEqual(profiles.gemini, { model: "video-model", configured: true });
  assert.deepEqual(profiles.xai, {
    textModel: "text-model",
    imageModel: "",
    videoModel: "",
    mediaConsent: true,
    configured: true
  });
  assert.doesNotMatch(JSON.stringify(profiles), /gemini-secret|xai-secret/);
});
