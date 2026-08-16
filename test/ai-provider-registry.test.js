import test from "node:test";
import assert from "node:assert/strict";

import {
  AI_ASSIGNMENT_TASKS,
  availableAiProvidersForTask,
  mergeAiProviderRegistry,
  normalizeAiProviderRegistry,
  normalizeAiTaskAssignments,
  publicAiProviderRegistry,
  resolveAiProviderAssignment
} from "../ai-provider-registry.js";
import { AI_PROVIDER_PRESETS, getAiProviderPreset } from "../ai-provider-presets.js";

function configuredRegistry() {
  return normalizeAiProviderRegistry({ providers: {
    deepseek: {
      apiKey: "deepseek-secret", consent: true,
      models: { textTags: "deepseek-text", skillExtraction: "deepseek-text", creativePlanning: "deepseek-text" }
    },
    openai: {
      apiKey: "openai-secret", consent: true,
      models: {
        textTags: "openai-text", skillExtraction: "openai-text", creativePlanning: "openai-text",
        imageAnalysis: "openai-vision", imageGeneration: "openai-image", videoGeneration: "openai-video"
      }
    },
    gemini: { apiKey: "gemini-secret", consent: true, models: { videoAnalysis: "gemini-video" } },
    xai: {
      apiKey: "xai-secret", consent: true,
      models: {
        textTags: "grok-text", skillExtraction: "grok-text", creativePlanning: "grok-text",
        imageAnalysis: "grok-image", imageGeneration: "grok-image", videoGeneration: "grok-video"
      }
    }
  } });
}

function configuredAssignments() {
  return normalizeAiTaskAssignments({
    textTags: { providerId: "deepseek", model: "deepseek-text" },
    skillExtraction: { providerId: "deepseek", model: "deepseek-text" },
    creativePlanning: { providerId: "deepseek", model: "deepseek-text" },
    imageAnalysis: { providerId: "openai", model: "openai-vision" },
    videoAnalysis: { providerId: "gemini", model: "gemini-video" },
    imageGeneration: { providerId: "xai", model: "grok-image" },
    videoGeneration: { providerId: "openai", model: "openai-video" }
  });
}

test("provider presets are the single model-free source for official and aggregator services", () => {
  assert.deepEqual(AI_PROVIDER_PRESETS.map((preset) => preset.id), [
    "deepseek", "openai", "gemini", "xai", "kimi", "minimax", "volcengine", "openrouter",
    "custom-text", "custom-media"
  ]);
  assert.equal(AI_PROVIDER_PRESETS.every((preset) =>
    preset.label && (preset.endpoint || preset.category === "custom") && preset.protocol && preset.discovery?.adapter
      && ["official", "aggregator", "custom"].includes(preset.category)
      && Array.isArray(preset.capabilities)
  ), true);
  assert.equal(Object.hasOwn(getAiProviderPreset("kimi"), "models"), false);
  assert.equal(getAiProviderPreset("gemini").capabilities.includes("imageGeneration"), true);
  assert.deepEqual(getAiProviderPreset("gemini").catalogRequiredTasks, ["imageGeneration"]);
  assert.equal(getAiProviderPreset("openrouter").category, "aggregator");
  assert.equal(getAiProviderPreset("missing"), null);
});

test("registry v4 exposes provider categories and leaves all new-install tasks unassigned", () => {
  const registry = normalizeAiProviderRegistry({ providers: {
    kimi: { discovery: { etag: "catalog-version" } }
  } });
  const assignments = normalizeAiTaskAssignments({}, registry);
  assert.equal(registry.version, 4);
  assert.equal(registry.providers.kimi.endpoint, "https://api.moonshot.cn/v1/chat/completions");
  assert.deepEqual(registry.providers.kimi.discovery, {
    adapter: "kimi",
    discoveredAt: "",
    source: "",
    etag: "catalog-version",
    cacheControl: "",
    error: ""
  });
  assert.equal(publicAiProviderRegistry(registry).providers.kimi.category, "official");
  assert.deepEqual(assignments, Object.fromEntries(AI_ASSIGNMENT_TASKS.map(({ id }) => [id, {
    providerId: "", model: ""
  }])));
  assert.throws(() => resolveAiProviderAssignment("textTags", registry, assignments), /未分配/);
  const bounded = normalizeAiProviderRegistry({ providers: {
    kimi: { discoveredModels: [{ id: "declared-model", tasks: ["videoAnalysis", "imageGeneration", "videoGeneration"] }] }
  } });
  assert.deepEqual(bounded.providers.kimi.discoveredModels[0].tasks, ["videoAnalysis"]);
});

test("new installs retain both custom connection entries without inventing a saved generic profile", () => {
  const providers = publicAiProviderRegistry(normalizeAiProviderRegistry({})).providers;
  assert.equal(providers["custom-text"].category, "custom");
  assert.equal(providers["custom-media"].category, "custom");
  assert.equal(Object.hasOwn(providers, "custom"), false);
});

test("unknown saved provider ids do not become hidden v4 connections", () => {
  const providers = normalizeAiProviderRegistry({ providers: {
    custom: { endpoint: "https://old.example/v1", apiKey: "obsolete-secret" },
    "retired-provider": { endpoint: "https://retired.example/v1", apiKey: "obsolete-secret" }
  } }).providers;
  assert.equal(Object.hasOwn(providers, "custom"), false);
  assert.equal(Object.hasOwn(providers, "retired-provider"), false);
});

test("empty v4 storage normalizes without inventing task assignments", () => {
  const registry = normalizeAiProviderRegistry({});
  const assignments = normalizeAiTaskAssignments({});
  assert.equal(registry.version, 4);
  assert.deepEqual(assignments, Object.fromEntries(AI_ASSIGNMENT_TASKS.map(({ id }) => [id, {
    providerId: "",
    model: ""
  }])));
});

test("obsolete shared text routes are ignored instead of entering v4 assignments", () => {
  const assignments = normalizeAiTaskAssignments({
    text: { providerId: "deepseek", model: "obsolete-shared-model" }
  });
  assert.deepEqual(assignments, Object.fromEntries(AI_ASSIGNMENT_TASKS.map(({ id }) => [id, {
    providerId: "",
    model: ""
  }])));
});

test("explicit task assignments survive v4 normalization unchanged", () => {
  const explicit = Object.fromEntries(AI_ASSIGNMENT_TASKS.map(({ id }, index) => [id, {
    providerId: index % 2 ? "openai" : "deepseek",
    model: `account-model-${index}`
  }]));
  assert.deepEqual(normalizeAiTaskAssignments(explicit), explicit);
  assert.equal(configuredRegistry().providers.deepseek.apiKey, "deepseek-secret");
});

test("public provider registry never exposes credentials", () => {
  const publicRegistry = publicAiProviderRegistry(configuredRegistry());
  assert.equal(JSON.stringify(publicRegistry).includes("secret"), false);
  assert.equal(publicRegistry.providers.openai.configured, true);
  assert.equal(publicRegistry.providers.gemini.configured, true);
});

test("task pickers show only configured providers that declare the requested capability", () => {
  const registry = configuredRegistry();
  assert.deepEqual(availableAiProvidersForTask("videoAnalysis", registry).map((item) => item.id), ["gemini"]);
  assert.deepEqual(availableAiProvidersForTask("textTags", registry).map((item) => item.id), ["deepseek", "openai", "xai"]);
});

test("a connected provider with discovered task models is selectable without silently choosing a model", () => {
  const registry = normalizeAiProviderRegistry({ providers: {
    kimi: {
      apiKey: "kimi-secret",
      discoveredModels: [{
        id: "account-visible-model",
        tasks: ["textTags", "skillExtraction", "creativePlanning"],
        status: "available"
      }]
    }
  } });
  assert.equal(registry.providers.kimi.models.textTags, "");
  assert.deepEqual(availableAiProvidersForTask("textTags", registry).find(({ id }) => id === "kimi"), {
    id: "kimi",
    label: "Kimi",
    model: ""
  });
  assert.deepEqual(resolveAiProviderAssignment("textTags", registry, {
    textTags: { providerId: "kimi", model: "account-visible-model" }
  }), {
    taskId: "textTags",
    providerId: "kimi",
    provider: "Kimi",
    model: "account-visible-model"
  });
  assert.throws(() => resolveAiProviderAssignment("textTags", registry, {
    textTags: { providerId: "kimi", model: "" }
  }), /尚未完成文字标签配置/);
});

test("task resolution reports the actual provider and model without silent fallback", () => {
  const registry = configuredRegistry();
  const assignments = configuredAssignments();
  assert.deepEqual(resolveAiProviderAssignment("videoAnalysis", registry, assignments), {
    taskId: "videoAnalysis",
    providerId: "gemini",
    provider: "Google Gemini",
    model: "gemini-video"
  });
  assignments.videoAnalysis = { providerId: "xai", model: "" };
  assert.throws(() => resolveAiProviderAssignment("videoAnalysis", registry, assignments), /不支持视频分析/);
});

test("a disappeared selected model is blocked instead of silently replaced", () => {
  const registry = configuredRegistry();
  const assignments = configuredAssignments();
  registry.providers.openai.discoveredModels = [{
    id: "openai-video", name: "openai-video", status: "unavailable", confidence: "declared",
    source: "provider_models", tasks: ["videoGeneration"], inputModalities: ["text"], outputModalities: ["video"],
    supportedParameters: [], supportedResolutions: [], supportedAspectRatios: [], contextLength: null, pricing: null
  }];
  assert.throws(() => resolveAiProviderAssignment("videoGeneration", registry, assignments), /已下架|不可用/);
  assert.equal(assignments.videoGeneration.model, "openai-video");
});

test("custom media keeps its configured image tasks after registry normalization", () => {
  const registry = normalizeAiProviderRegistry({ providers: {
    "custom-media": {
      endpoint: "https://vision.example.com/v1/chat/completions",
      protocol: "chat_completions",
      apiKey: "vision-secret",
      consent: true,
      models: { imageAnalysis: "vision-model", imageGeneration: "image-model" },
      imageGeneration: {
        protocol: "images_generations",
        endpoint: "https://vision.example.com/v1/images/generations",
        editsEndpoint: "https://vision.example.com/v1/images/edits",
        model: "image-model",
        apiKey: "image-secret",
        sizes: ["1024x1024"]
      }
    }
  } });
  const assignments = normalizeAiTaskAssignments({
    imageAnalysis: { providerId: "custom-media", model: "vision-model" },
    imageGeneration: { providerId: "custom-media", model: "image-model" }
  });
  const restored = normalizeAiProviderRegistry(registry);
  assert.deepEqual(restored.providers["custom-media"].capabilities, ["imageAnalysis", "imageGeneration"]);
  assert.equal(resolveAiProviderAssignment("imageAnalysis", restored, assignments).model, "vision-model");
  assert.equal(resolveAiProviderAssignment("imageGeneration", restored, assignments).model, "image-model");
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

test("registry keeps provider-declared model methods for capability diagnostics", () => {
  const registry = normalizeAiProviderRegistry({ providers: { gemini: {
    discoveredModels: [{
      id: "gemini-3.1-flash-image",
      confidence: "declared",
      tasks: ["imageGeneration"],
      supportedMethods: ["generateContent"]
    }]
  } } });
  assert.deepEqual(registry.providers.gemini.discoveredModels[0].supportedMethods, ["generateContent"]);
});

test("Gemini image generation requires an exact available catalog model", () => {
  const manual = normalizeAiProviderRegistry({ providers: { gemini: {
    apiKey: "gemini-secret", consent: true,
    models: { imageGeneration: "gemini-image-lookalike" }
  } } });
  assert.equal(manual.providers.gemini.catalogRequiredTasks.includes("imageGeneration"), true);
  const cannotDisableGuard = normalizeAiProviderRegistry({ providers: { gemini: {
    catalogRequiredTasks: [], apiKey: "gemini-secret", consent: true,
    models: { imageGeneration: "gemini-image-lookalike" }
  } } });
  assert.deepEqual(cannotDisableGuard.providers.gemini.catalogRequiredTasks, ["imageGeneration"]);
  assert.throws(() => resolveAiProviderAssignment("imageGeneration", manual, {
    imageGeneration: { providerId: "gemini", model: "gemini-image-lookalike" }
  }), /尚未完成图片生成配置/);

  manual.providers.gemini.discoveredModels = [{
    id: "gemini-3.1-flash-image", status: "available", confidence: "declared",
    tasks: ["imageGeneration"]
  }];
  assert.deepEqual(resolveAiProviderAssignment("imageGeneration", manual, {
    imageGeneration: { providerId: "gemini", model: "gemini-3.1-flash-image" }
  }), {
    taskId: "imageGeneration", providerId: "gemini", provider: "Google Gemini", model: "gemini-3.1-flash-image"
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
