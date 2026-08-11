import test from "node:test";
import assert from "node:assert/strict";

import {
  AI_ASSIGNMENT_TASKS,
  availableAiProvidersForTask,
  mergeAiProviderRegistry,
  migrateLegacyAiConfiguration,
  normalizeAiProviderRegistry,
  publicAiProviderRegistry,
  resolveAiProviderAssignment
} from "../ai-provider-registry.js";

const legacy = {
  aiSettings: {
    activeProvider: "deepseek",
    apiKey: "deepseek-secret",
    analysisModel: "deepseek-text"
  },
  visionSettings: {
    activeProvider: "openai",
    openai: {
      apiKey: "openai-secret",
      model: "openai-vision",
      videoGeneration: { model: "openai-video" }
    }
  },
  aiServiceProfiles: {
    gemini: { apiKey: "gemini-secret", model: "gemini-video" },
    xai: { apiKey: "xai-secret", textModel: "grok-text", imageModel: "grok-image", videoModel: "grok-video" }
  },
  aiTaskRoutes: {
    "video-analysis": { serviceId: "gemini" },
    "image-generation": { serviceId: "xai" }
  }
};

test("legacy AI settings migrate once into connected providers and seven independent assignments", () => {
  const migrated = migrateLegacyAiConfiguration(legacy);
  assert.deepEqual(Object.keys(migrated.assignments), AI_ASSIGNMENT_TASKS.map((task) => task.id));
  assert.equal(migrated.registry.providers.deepseek.apiKey, "deepseek-secret");
  assert.equal(migrated.registry.providers.openai.apiKey, "openai-secret");
  assert.equal(migrated.registry.providers.gemini.models.videoAnalysis, "gemini-video");
  assert.equal(migrated.assignments.textTags.providerId, "deepseek");
  assert.equal(migrated.assignments.skillExtraction.providerId, "deepseek");
  assert.equal(migrated.assignments.creativePlanning.providerId, "deepseek");
  assert.equal(migrated.assignments.imageAnalysis.providerId, "openai");
  assert.equal(migrated.assignments.videoAnalysis.providerId, "gemini");
  assert.equal(migrated.assignments.imageGeneration.providerId, "xai");
});

test("public provider registry never exposes credentials", () => {
  const migrated = migrateLegacyAiConfiguration(legacy);
  const publicRegistry = publicAiProviderRegistry(migrated.registry);
  assert.equal(JSON.stringify(publicRegistry).includes("secret"), false);
  assert.equal(publicRegistry.providers.openai.configured, true);
  assert.equal(publicRegistry.providers.gemini.configured, true);
});

test("task pickers show only configured providers that declare the requested capability", () => {
  const migrated = migrateLegacyAiConfiguration(legacy);
  assert.deepEqual(availableAiProvidersForTask("videoAnalysis", migrated.registry).map((item) => item.id), ["gemini"]);
  assert.deepEqual(availableAiProvidersForTask("textTags", migrated.registry).map((item) => item.id), ["deepseek", "openai", "xai"]);
});

test("task resolution reports the actual provider and model without silent fallback", () => {
  const migrated = migrateLegacyAiConfiguration(legacy);
  assert.deepEqual(resolveAiProviderAssignment("videoAnalysis", migrated.registry, migrated.assignments), {
    taskId: "videoAnalysis",
    providerId: "gemini",
    provider: "Google Gemini",
    model: "gemini-video"
  });
  migrated.assignments.videoAnalysis = { providerId: "xai", model: "" };
  assert.throws(() => resolveAiProviderAssignment("videoAnalysis", migrated.registry, migrated.assignments), /不支持视频分析/);
});

test("a disappeared selected model is blocked instead of silently replaced", () => {
  const migrated = migrateLegacyAiConfiguration(legacy);
  migrated.registry.providers.openai.discoveredModels = [{
    id: "openai-video", name: "openai-video", status: "unavailable", confidence: "declared",
    source: "provider_models", tasks: ["videoGeneration"], inputModalities: ["text"], outputModalities: ["video"],
    supportedParameters: [], supportedResolutions: [], supportedAspectRatios: [], contextLength: null, pricing: null
  }];
  assert.throws(() => resolveAiProviderAssignment("videoGeneration", migrated.registry, migrated.assignments), /已下架|不可用/);
  assert.equal(migrated.assignments.videoGeneration.model, "openai-video");
});

test("legacy custom media keeps its configured image tasks after registry normalization", () => {
  const migrated = migrateLegacyAiConfiguration({
    ...legacy,
    visionSettings: {
      activeProvider: "compatible",
      consent: true,
      compatible: {
        endpoint: "https://vision.example.com/v1/chat/completions",
        model: "vision-model",
        apiKey: "vision-secret",
        imageGeneration: {
          protocol: "images_generations",
          endpoint: "https://vision.example.com/v1/images/generations",
          editsEndpoint: "https://vision.example.com/v1/images/edits",
          model: "image-model",
          apiKey: "image-secret",
          sizes: ["1024x1024"]
        }
      }
    },
    aiTaskRoutes: {
      ...legacy.aiTaskRoutes,
      "image-analysis": { serviceId: "current-vision", model: "vision-model" },
      "image-generation": { serviceId: "current-vision", model: "image-model" }
    }
  });
  const restored = normalizeAiProviderRegistry(migrated.registry);
  assert.deepEqual(restored.providers["custom-media"].capabilities, ["imageAnalysis", "imageGeneration"]);
  assert.equal(resolveAiProviderAssignment("imageAnalysis", restored, migrated.assignments).model, "vision-model");
  assert.equal(resolveAiProviderAssignment("imageGeneration", restored, migrated.assignments).model, "image-model");
});

test("model reference-image limits retain their declared or observed source", () => {
  const registry = normalizeAiProviderRegistry({ providers: {
    openrouter: {
      apiKey: "secret",
      discoveredModels: [{
        id: "image-model",
        tasks: ["imageGeneration"],
        referenceImages: { supported: true, maxItems: 6, source: "observed_error", observedAt: "2026-08-09T00:00:00.000Z" }
      }]
    }
  } });
  assert.deepEqual(registry.providers.openrouter.discoveredModels[0].referenceImages, {
    supported: true,
    maxItems: 6,
    source: "observed_error",
    observedAt: "2026-08-09T00:00:00.000Z"
  });
});

test("reference-image capability keeps four states and remains idempotent", () => {
  const registry = normalizeAiProviderRegistry({ providers: {
    openrouter: {
      apiKey: "secret",
      discoveredModels: [
        { id: "unknown", tasks: ["imageGeneration"] },
        { id: "unsupported", tasks: ["imageGeneration"], referenceImages: { supported: false, maxItems: 0 } },
        { id: "unbounded", tasks: ["imageGeneration"], referenceImages: { supported: true, maxItems: null } },
        { id: "bounded", tasks: ["imageGeneration"], referenceImages: { supported: true, maxItems: 6 } }
      ]
    }
  } });
  const models = Object.fromEntries(registry.providers.openrouter.discoveredModels.map((item) => [item.id, item.referenceImages]));
  assert.deepEqual(models.unknown, { supported: null, maxItems: null, source: "unknown", observedAt: "" });
  assert.deepEqual(models.unsupported, { supported: false, maxItems: null, source: "unknown", observedAt: "" });
  assert.deepEqual(models.unbounded, { supported: true, maxItems: null, source: "unknown", observedAt: "" });
  assert.deepEqual(models.bounded, { supported: true, maxItems: 6, source: "unknown", observedAt: "" });
  assert.deepEqual(normalizeAiProviderRegistry(registry), registry);
});

test("compatible image credentials stay on the same endpoint and clear when that endpoint changes", () => {
  const current = normalizeAiProviderRegistry({ providers: {
    "custom-media": {
      endpoint: "https://vision.example.com/v1/responses",
      apiKey: "vision-secret",
      consent: true,
      models: { imageAnalysis: "vision", imageGeneration: "image" },
      imageGeneration: {
        protocol: "images_generations",
        endpoint: "https://images.example.com/v1/images/generations",
        apiKey: "image-secret",
        model: "image"
      }
    }
  } });
  const kept = mergeAiProviderRegistry(current, { providers: {
    "custom-media": { imageGeneration: { endpoint: "https://images.example.com/v1/images/generations", apiKey: "" } }
  } });
  assert.equal(kept.providers["custom-media"].imageGeneration.apiKey, "image-secret");
  const changed = mergeAiProviderRegistry(current, { providers: {
    "custom-media": { imageGeneration: { endpoint: "https://other.example.com/v1/images/generations", apiKey: "" } }
  } });
  assert.equal(changed.providers["custom-media"].imageGeneration.apiKey, "");
  const replaced = mergeAiProviderRegistry(current, { providers: {
    "custom-media": { imageGeneration: {
      endpoint: "https://other.example.com/v1/images/generations",
      apiKey: "replacement-image-secret"
    } }
  } });
  assert.equal(replaced.providers["custom-media"].imageGeneration.apiKey, "replacement-image-secret");
  assert.equal(replaced.providers["custom-media"].imageGeneration.credentialOrigin, "");
});

test("Micu image generation requires its dedicated image-group key instead of reusing the text key", () => {
  const registry = normalizeAiProviderRegistry({ providers: {
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
  } });
  assert.throws(() => resolveAiProviderAssignment("imageGeneration", registry, {
    imageGeneration: { providerId: "custom-media", model: "gpt-image-2" }
  }), /尚未完成图片生成配置/);
});

test("custom media reports analysis and generation credentials independently", () => {
  const registry = normalizeAiProviderRegistry({ providers: {
    "custom-media": {
      endpoint: "https://www.micuapi.ai/v1/responses",
      apiKey: "",
      consent: true,
      models: { imageAnalysis: "vision-model", imageGeneration: "gpt-image-2" },
      imageGeneration: {
        protocol: "images_generations",
        endpoint: "https://www.micuapi.ai/v1/images/generations",
        apiKey: "image-group-key",
        model: "gpt-image-2",
        sizes: ["1280x720"]
      }
    }
  } });
  const publicRegistry = publicAiProviderRegistry(registry);
  assert.equal(publicRegistry.providers["custom-media"].credentialConfigured, false);
  assert.equal(publicRegistry.providers["custom-media"].imageGeneration.credentialConfigured, true);
  assert.equal(publicRegistry.providers["custom-media"].imageGeneration.credentialHint, "-key");
  assert.equal(JSON.stringify(publicRegistry).includes("image-group-key"), false);
  assert.throws(() => resolveAiProviderAssignment("imageAnalysis", registry, {
    imageAnalysis: { providerId: "custom-media", model: "vision-model" }
  }), /尚未完成图片分析配置/);
  assert.equal(resolveAiProviderAssignment("imageGeneration", registry, {
    imageGeneration: { providerId: "custom-media", model: "gpt-image-2" }
  }).model, "gpt-image-2");
});
