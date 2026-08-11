import test from "node:test";
import assert from "node:assert/strict";

import {
  AI_RUNTIME_PROTOCOL_VERSION,
  aiConfigurationFromStorage,
  projectAiRuntime,
  requireAiRuntimeProtocolVersion,
  resolveTextTaskSettings,
  resolveVideoAnalysisTask,
  resolveVisionTaskSettings
} from "../ai-runtime.js";

test("Composer and background share one AI runtime protocol version", () => {
  assert.equal(AI_RUNTIME_PROTOCOL_VERSION, 1);
  assert.equal(requireAiRuntimeProtocolVersion(1), true);
  assert.throws(() => requireAiRuntimeProtocolVersion(undefined), /扩展后台不是同一版本/);
  assert.throws(() => requireAiRuntimeProtocolVersion(0), /没有发起付费请求/);
});

const legacy = {
  aiSettings: {
    activeProvider: "deepseek",
    apiKey: "deepseek-key",
    consent: true,
    analysisModel: "deepseek-tags",
    analysisInstructionsByLocale: { "zh-CN": "文字规则", en: "Text rules" }
  },
  visionSettings: {
    activeProvider: "openai",
    consent: true,
    openai: { apiKey: "openai-key", model: "openai-vision" }
  },
  aiServiceProfiles: {
    xai: { apiKey: "xai-key", textModel: "grok-plan", imageModel: "grok-image", mediaConsent: true }
  },
  aiTaskRoutes: {
    "creative-planning": { serviceId: "xai", model: "grok-plan" },
    "image-analysis": { serviceId: "current-vision", model: "openai-vision" }
  }
};

test("one canonical configuration preserves independent text task assignments after legacy migration", () => {
  const configuration = aiConfigurationFromStorage(legacy);
  assert.equal(configuration.assignments.textTags.providerId, "deepseek");
  assert.equal(configuration.assignments.creativePlanning.providerId, "xai");
  assert.equal(resolveTextTaskSettings("textTags", configuration).analysisModel, "deepseek-tags");
  const planning = resolveTextTaskSettings("creativePlanning", configuration);
  assert.equal(planning.activeProvider, "compatible");
  assert.equal(planning.compatible.model, "grok-plan");
  assert.equal(planning.compatible.apiKey, "xai-key");
});

test("runtime projections are derived views and task resolvers keep credentials private", () => {
  const configuration = aiConfigurationFromStorage(legacy);
  const runtime = projectAiRuntime(configuration);
  assert.equal(runtime.aiTaskAssignments.imageAnalysis.providerId, "openai");
  assert.equal(runtime.aiSettings.analysisInstructionsByLocale["zh-CN"], "文字规则");
  const vision = resolveVisionTaskSettings("imageAnalysis", configuration);
  assert.equal(vision.openai.apiKey, "openai-key");
  assert.equal(vision.openai.model, "openai-vision");
});

test("video analysis requires the provider sending authorization before exposing credentials", () => {
  const configuration = {
    registry: {
      providers: {
        gemini: {
          endpoint: "https://generativelanguage.googleapis.com",
          apiKey: "gemini-video-secret",
          consent: false,
          models: { videoAnalysis: "gemini-video" }
        }
      }
    },
    assignments: { videoAnalysis: { providerId: "gemini", model: "gemini-video" } }
  };

  assert.throws(() => resolveVideoAnalysisTask(configuration), /尚未确认发送范围/);
  configuration.registry.providers.gemini.consent = true;
  assert.deepEqual(resolveVideoAnalysisTask(configuration), {
    taskId: "videoAnalysis",
    providerId: "gemini",
    provider: "Google Gemini",
    model: "gemini-video",
    apiKey: "gemini-video-secret",
    endpoint: "https://generativelanguage.googleapis.com"
  });
});

test("Micu image runtime never silently sends the text-group key to image generation", () => {
  const configuration = aiConfigurationFromStorage({
    aiProviderRegistry: { providers: {
      "custom-media": {
        endpoint: "https://www.micuapi.ai/v1/responses",
        apiKey: "vip-2-text-key",
        consent: true,
        models: { imageAnalysis: "vision", imageGeneration: "gpt-image-2" },
        imageGeneration: {
          protocol: "images_generations",
          endpoint: "https://www.micuapi.ai/v1/images/generations",
          model: "gpt-image-2",
          sizes: ["1280x720"]
        }
      }
    } },
    aiTaskAssignments: { imageGeneration: { providerId: "custom-media", model: "gpt-image-2" } }
  });
  assert.throws(() => resolveVisionTaskSettings("imageGeneration", configuration), /尚未完成图片生成配置/);
  const diagnostic = resolveVisionTaskSettings("imageGeneration", configuration, { requireConfigured: false });
  assert.equal(diagnostic.compatible.apiKey, "vip-2-text-key");
  assert.equal(diagnostic.compatible.imageGeneration.apiKey, "");
});
