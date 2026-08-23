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
  assert.equal(AI_RUNTIME_PROTOCOL_VERSION, 2);
  assert.equal(requireAiRuntimeProtocolVersion(2), true);
  assert.throws(() => requireAiRuntimeProtocolVersion(undefined), /扩展后台不是同一版本/);
  assert.throws(() => requireAiRuntimeProtocolVersion(1), /没有发起付费请求/);
});

const storedConfiguration = {
  aiProviderRegistry: { version: 4, providers: {
    deepseek: {
      apiKey: "deepseek-key", consent: true,
      models: { textTags: "deepseek-tags", skillExtraction: "deepseek-tags" }
    },
    openai: {
      apiKey: "openai-key", consent: true,
      models: { imageAnalysis: "openai-vision" }
    },
    xai: {
      apiKey: "xai-key", consent: true,
      models: { creativePlanning: "grok-plan", imageAnalysis: "grok-image" }
    }
  } },
  aiTaskAssignments: {
    textTags: { providerId: "deepseek", model: "deepseek-tags" },
    skillExtraction: { providerId: "deepseek", model: "deepseek-tags" },
    creativePlanning: { providerId: "xai", model: "grok-plan" },
    imageAnalysis: { providerId: "openai", model: "openai-vision" },
    videoAnalysis: { providerId: "", model: "" },
    imageGeneration: { providerId: "", model: "" },
    videoGeneration: { providerId: "", model: "" }
  },
  aiPreferences: {
    textInstructionsByLocale: { "zh-CN": "文字规则", en: "Text rules" }
  }
};

test("one canonical v4 configuration preserves independent text task assignments", () => {
  const configuration = aiConfigurationFromStorage(storedConfiguration);
  assert.equal(configuration.assignments.textTags.providerId, "deepseek");
  assert.equal(configuration.assignments.creativePlanning.providerId, "xai");
  assert.equal(resolveTextTaskSettings("textTags", configuration).analysisModel, "deepseek-tags");
  const planning = resolveTextTaskSettings("creativePlanning", configuration);
  assert.equal(planning.activeProvider, "compatible");
  assert.equal(planning.compatible.model, "grok-plan");
  assert.equal(planning.compatible.apiKey, "xai-key");
});

test("obsolete AI storage keys are ignored instead of becoming a second configuration path", () => {
  const configuration = aiConfigurationFromStorage({
    aiSettings: { apiKey: "obsolete-key", analysisModel: "obsolete-model" },
    visionSettings: { openai: { apiKey: "obsolete-vision-key", model: "obsolete-vision-model" } },
    aiTaskRoutes: { "text-tags": { serviceId: "deepseek", model: "obsolete-model" } }
  });

  assert.equal(configuration.registry.providers.deepseek.apiKey, "");
  assert.deepEqual(configuration.assignments.textTags, { providerId: "", model: "" });
  assert.equal(JSON.stringify(configuration).includes("obsolete-key"), false);
});

test("runtime projections are derived views and task resolvers keep credentials private", () => {
  const configuration = aiConfigurationFromStorage(storedConfiguration);
  const runtime = projectAiRuntime(configuration);
  assert.equal(runtime.aiTaskAssignments.imageAnalysis.providerId, "openai");
  assert.equal(runtime.aiSettings.compatible.model, "grok-plan");
  assert.equal(runtime.aiSettings.compatible.apiKey, "xai-key");
  assert.equal(runtime.aiSettings.analysisInstructionsByLocale["zh-CN"], "文字规则");
  const vision = resolveVisionTaskSettings("imageAnalysis", configuration);
  assert.equal(vision.openai.apiKey, "openai-key");
  assert.equal(vision.openai.model, "openai-vision");
});

test("DeepSeek image analysis projects the selected account model through its compatible vision protocol", () => {
  const configuration = aiConfigurationFromStorage({
    aiProviderRegistry: { providers: {
      deepseek: {
        apiKey: "deepseek-key",
        consent: true,
        models: { imageAnalysis: "opaque-account-model" },
        discoveredModels: [{
          id: "opaque-account-model", status: "available", confidence: "manual_unverified",
          source: "provider_models", tasks: []
        }]
      }
    } },
    aiTaskAssignments: {
      imageAnalysis: {
        providerId: "deepseek", model: "opaque-account-model", evidence: "manual_unverified"
      }
    }
  });

  const vision = resolveVisionTaskSettings("imageAnalysis", configuration);
  assert.equal(vision.activeProvider, "compatible");
  assert.equal(vision.compatible.endpoint, "https://api.deepseek.com/chat/completions");
  assert.equal(vision.compatible.model, "opaque-account-model");
  assert.equal(vision.compatible.apiKey, "deepseek-key");
  assert.equal(vision.compatible.structuredOutput, "json_object");

  const projected = projectAiRuntime(configuration).visionSettings;
  assert.equal(projected.activeProvider, "compatible");
  assert.equal(projected.compatible.endpoint, "https://api.deepseek.com/chat/completions");
  assert.equal(projected.compatible.model, "opaque-account-model");
  assert.equal(projected.compatible.structuredOutput, "json_object");
});

test("changing the image-analysis assignment does not erase generation services", () => {
  const configuration = aiConfigurationFromStorage({
    aiProviderRegistry: { providers: {
      deepseek: {
        apiKey: "deepseek-key", consent: true,
        models: { imageAnalysis: "deepseek-vision" }
      },
      openai: {
        apiKey: "openai-key", consent: true,
        models: { imageAnalysis: "openai-vision", imageGeneration: "openai-image" }
      },
      "custom-media": {
        endpoint: "https://media.example/v1/chat/completions",
        apiKey: "compatible-key", consent: true,
        models: { imageAnalysis: "compatible-vision", imageGeneration: "compatible-image" },
        imageGeneration: {
          protocol: "images_generations",
          endpoint: "https://media.example/v1/images/generations",
          apiKey: "compatible-image-key",
          model: "compatible-image"
        }
      }
    } },
    aiTaskAssignments: {
      imageAnalysis: { providerId: "deepseek", model: "deepseek-vision" },
      imageGeneration: { providerId: "custom-media", model: "compatible-image" }
    }
  });

  const runtime = projectAiRuntime(configuration);
  assert.equal(runtime.visionSettings.compatible.model, "deepseek-vision");
  assert.equal(runtime.visionSettings.openai.apiKey, "openai-key");
  assert.equal(runtime.visionSettings.openai.model, "openai-vision");
  assert.equal(runtime.visionSettings.compatible.apiKey, "deepseek-key");
  assert.equal(runtime.visionSettings.compatible.imageGeneration.apiKey, "compatible-image-key");
  assert.equal(runtime.visionSettings.compatible.imageGeneration.model, "compatible-image");
});

test("new-install runtime previews remain unassigned instead of inventing providers or models", () => {
  const configuration = aiConfigurationFromStorage({});
  const runtime = projectAiRuntime(configuration);

  assert.equal(runtime.aiSettings.activeProvider, "compatible");
  assert.equal(runtime.aiSettings.analysisModel, "");
  assert.deepEqual(runtime.aiSettings.compatible, { endpoint: "", model: "", apiKey: "" });
  assert.equal(resolveTextTaskSettings("textTags", configuration, { requireConfigured: false }).analysisModel, "");
  assert.throws(() => resolveTextTaskSettings("textTags", configuration), /尚未分配/);
  assert.throws(() => resolveVideoAnalysisTask(configuration), /尚未分配/);

  configuration.assignments.textTags = { providerId: "deepseek", model: "" };
  assert.equal(resolveTextTaskSettings("textTags", configuration, { requireConfigured: false }).analysisModel, "");
  assert.throws(() => resolveTextTaskSettings("textTags", configuration), /尚未完成文字标签配置/);
});

test("Kimi text and video runtimes use the explicit assignment and declared chat protocol", () => {
  const configuration = {
    registry: { providers: { kimi: {
      label: "Kimi",
      endpoint: "https://api.moonshot.cn/v1/chat/completions",
      protocol: "chat_completions",
      apiKey: "kimi-secret",
      consent: true,
      capabilities: ["textTags", "videoAnalysis"]
    } } },
    assignments: {
      textTags: { providerId: "kimi", model: "moonshot-account-text" },
      videoAnalysis: { providerId: "kimi", model: "moonshot-account-video" }
    }
  };

  const textSettings = resolveTextTaskSettings("textTags", configuration);
  assert.equal(textSettings.activeProvider, "compatible");
  assert.equal(textSettings.compatible.endpoint, "https://api.moonshot.cn/v1/chat/completions");
  assert.equal(textSettings.compatible.model, "moonshot-account-text");
  assert.equal(textSettings.compatible.apiKey, "kimi-secret");
  assert.deepEqual(resolveVideoAnalysisTask(configuration), {
    taskId: "videoAnalysis",
    providerId: "kimi",
    provider: "Kimi",
    providerLabel: "Kimi",
    model: "moonshot-account-video",
    protocol: "chat_completions",
    apiKey: "kimi-secret",
    endpoint: "https://api.moonshot.cn/v1/chat/completions"
  });
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
    providerLabel: "Google Gemini",
    model: "gemini-video",
    protocol: "gemini",
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
