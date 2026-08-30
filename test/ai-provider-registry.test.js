import test from "node:test";
import assert from "node:assert/strict";

import {
  AI_ASSIGNMENT_TASKS,
  applyConnectionModelAssignments,
  availableAiModelsForTask,
  availableAiProvidersForTask,
  createAiTaskAssignment,
  mergeAiProviderRegistry,
  modelConcurrencyLimit,
  normalizeAiProviderRegistry,
  normalizeAiTaskAssignments,
  publicAiProviderRegistry,
  resolveAiProviderAssignment
} from "../ai-provider-registry.js";
import { AI_PROVIDER_PRESETS, getAiProviderPreset } from "../ai-provider-presets.js";
import { getAiModelCapability } from "../ai-model-capabilities.js";

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
    "deepseek", "zhipu", "openai", "gemini", "xai", "kimi", "minimax", "volcengine", "openrouter",
    "custom-text", "custom-media"
  ]);
  assert.equal(AI_PROVIDER_PRESETS.every((preset) =>
    preset.label && (preset.endpoint || preset.category === "custom") && preset.protocol && preset.discovery?.adapter
      && ["official", "aggregator", "custom"].includes(preset.category)
      && Array.isArray(preset.capabilities)
  ), true);
  assert.equal(Object.hasOwn(getAiProviderPreset("kimi"), "models"), false);
  assert.equal(getAiProviderPreset("gemini").capabilities.includes("imageGeneration"), true);
  assert.equal(getAiProviderPreset("deepseek").capabilities.includes("imageAnalysis"), true);
  assert.equal(getAiProviderPreset("deepseek").structuredOutput, "json_object");
  assert.deepEqual(getAiProviderPreset("zhipu"), {
    id: "zhipu",
    label: "智谱 GLM",
    category: "official",
    endpoint: "https://open.bigmodel.cn/api/paas/v4/chat/completions",
    protocol: "chat_completions",
    discovery: { adapter: "identity" },
    catalogCompleteness: "partial",
    capabilities: ["textTags", "skillExtraction", "creativePlanning", "imageAnalysis", "videoAnalysis"],
    catalogRequiredTasks: [],
    structuredOutput: "prompt_only",
    mediaInput: {
      imageBase64: "raw",
      localVideo: "unsupported",
      preferPublicVideoUrl: true,
      publicVideoUrl: "direct"
    }
  });
  assert.deepEqual(getAiProviderPreset("gemini").catalogRequiredTasks, ["imageGeneration"]);
  assert.equal(getAiProviderPreset("openrouter").category, "aggregator");
  assert.equal(getAiProviderPreset("missing"), null);
});

test("task model candidates separate declared catalog capability from explicit manual assignment", () => {
  const registry = normalizeAiProviderRegistry({ providers: {
    deepseek: {
      apiKey: "deepseek-secret",
      consent: true,
      discoveredModels: [
        { id: "opaque-account-model", confidence: "manual_unverified", source: "provider_models", tasks: [] },
        {
          id: "declared-vision", confidence: "declared", source: "provider_models",
          tasks: ["textTags", "skillExtraction", "creativePlanning", "imageAnalysis"],
          inputModalities: ["text", "image"], outputModalities: ["text"]
        },
        {
          id: "declared-text", confidence: "declared", source: "provider_models",
          tasks: ["textTags", "skillExtraction", "creativePlanning"],
          inputModalities: ["text"], outputModalities: ["text"]
        }
      ]
    },
    openai: {
      apiKey: "openai-secret",
      discoveredModels: [{
        id: "task-neutral-account-model", confidence: "manual_unverified",
        source: "provider_models", tasks: []
      }]
    }
  } });

  assert.deepEqual(availableAiModelsForTask("imageAnalysis", registry.providers.deepseek).map((model) => ({
    id: model.id, evidence: model.assignmentEvidence
  })), [
    { id: "opaque-account-model", evidence: "manual_unverified" },
    { id: "declared-vision", evidence: "declared" }
  ]);
  assert.deepEqual(createAiTaskAssignment(
    "imageAnalysis", "deepseek", "opaque-account-model", registry
  ), {
    providerId: "deepseek",
    model: "opaque-account-model",
    evidence: "manual_unverified"
  });
  assert.deepEqual(normalizeAiTaskAssignments({
    imageAnalysis: { providerId: "deepseek", model: "opaque-account-model" }
  }, registry).imageAnalysis, {
    providerId: "deepseek",
    model: "opaque-account-model",
    evidence: "manual_unverified",
    managedBy: "task",
    concurrency: 10
  });
  assert.throws(() => createAiTaskAssignment(
    "imageAnalysis", "deepseek", "declared-text", registry
  ), /目录声明.*不支持图片分析/);
  assert.deepEqual(availableAiModelsForTask("imageGeneration", registry.providers.openai), []);
});

test("a manually assigned catalog-visible DeepSeek model resolves for image analysis and disappears safely", () => {
  const source = {
    providers: {
      deepseek: {
        apiKey: "deepseek-secret",
        consent: true,
        models: { imageAnalysis: "opaque-account-model" },
        discoveredModels: [{
          id: "opaque-account-model", status: "available", confidence: "manual_unverified",
          source: "provider_models", tasks: []
        }]
      }
    }
  };
  const registry = normalizeAiProviderRegistry(source);
  const assignments = normalizeAiTaskAssignments({
    imageAnalysis: {
      providerId: "deepseek", model: "opaque-account-model", evidence: "manual_unverified"
    }
  });

  assert.deepEqual(availableAiProvidersForTask("imageAnalysis", registry).map((item) => item.id), ["deepseek"]);
  assert.deepEqual(resolveAiProviderAssignment("imageAnalysis", registry, assignments), {
    taskId: "imageAnalysis", providerId: "deepseek", provider: "DeepSeek", model: "opaque-account-model"
  });

  source.providers.deepseek.discoveredModels[0].status = "unavailable";
  assert.throws(() => resolveAiProviderAssignment(
    "imageAnalysis", normalizeAiProviderRegistry(source), assignments
  ), /已下架|不可用/);

  source.providers.deepseek.discoveredModels = [];
  source.providers.deepseek.discovery = { discoveredAt: "2026-08-23T00:00:00.000Z" };
  assert.throws(() => resolveAiProviderAssignment(
    "imageAnalysis", normalizeAiProviderRegistry(source), assignments
  ), /当前模型目录中没有/);
});

test("registry v5 exposes task concurrency defaults and official model limits", () => {
  const registry = normalizeAiProviderRegistry({ providers: {
    kimi: { discovery: { etag: "catalog-version" } }
  } });
  const assignments = normalizeAiTaskAssignments({}, registry);
  assert.equal(registry.version, 5);
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
  assert.equal(assignments.textTags.concurrency, 20);
  assert.equal(assignments.imageAnalysis.concurrency, 10);
  assert.equal(assignments.videoAnalysis.concurrency, 2);
  const deepSeekVision = getAiModelCapability("deepseek", "deepseek-v4-flash-vision-exp");
  assert.equal(deepSeekVision.inputModalities.includes("image"), true);
  assert.equal(deepSeekVision.concurrencyLimit.value, 2500);
  assert.match(deepSeekVision.concurrencyLimit.source.url, /deepseek\.com\/quick_start\/pricing/);
  assert.throws(() => resolveAiProviderAssignment("textTags", registry, assignments), /未分配/);
  const bounded = normalizeAiProviderRegistry({ providers: {
    kimi: { discoveredModels: [{ id: "declared-model", tasks: ["videoAnalysis", "imageGeneration", "videoGeneration"] }] }
  } });
  assert.deepEqual(bounded.providers.kimi.discoveredModels[0].tasks, ["videoAnalysis"]);
});

test("assignment ownership protects existing task routes while one confirmed connection fills compatible gaps", () => {
  const registry = normalizeAiProviderRegistry({ providers: {
    zhipu: {
      apiKey: "zhipu-secret",
      consent: true,
      discoveredModels: [{
        id: "glm-5.3-flash",
        status: "available",
        confidence: "declared",
        tasks: ["textTags", "skillExtraction", "creativePlanning", "imageAnalysis", "videoAnalysis"],
        inputModalities: ["text", "image", "video"],
        outputModalities: ["text"]
      }]
    },
    deepseek: {
      apiKey: "deepseek-secret",
      consent: true,
      discoveredModels: [{
        id: "deepseek-text",
        status: "available",
        confidence: "declared",
        tasks: ["textTags", "skillExtraction", "creativePlanning"],
        inputModalities: ["text"],
        outputModalities: ["text"]
      }]
    }
  } });
  const existing = normalizeAiTaskAssignments({
    textTags: { providerId: "deepseek", model: "deepseek-text" },
    imageAnalysis: {
      providerId: "zhipu", model: "legacy-connection-model", managedBy: "connection"
    }
  }, registry);

  assert.equal(existing.textTags.managedBy, "task");
  assert.equal(existing.imageAnalysis.managedBy, "connection");
  assert.equal(Object.hasOwn(existing.videoAnalysis, "managedBy"), false);

  const next = applyConnectionModelAssignments(existing, {
    providerId: "zhipu",
    model: "glm-5.3-flash",
    taskIds: ["textTags", "skillExtraction", "creativePlanning", "imageAnalysis", "videoAnalysis"]
  }, registry);

  assert.deepEqual(next.textTags, existing.textTags);
  for (const taskId of ["skillExtraction", "creativePlanning", "imageAnalysis", "videoAnalysis"]) {
    assert.equal(next[taskId].providerId, "zhipu");
    assert.equal(next[taskId].model, "glm-5.3-flash");
    assert.equal(next[taskId].managedBy, "connection");
  }

  const anotherProvider = applyConnectionModelAssignments(next, {
    providerId: "deepseek",
    model: "deepseek-text",
    taskIds: ["textTags", "skillExtraction", "creativePlanning"]
  }, registry);
  assert.deepEqual(anotherProvider, next);
});

test("connection linking ignores unverified catalog guesses unless one explicit custom protocol role allows it", () => {
  const registry = normalizeAiProviderRegistry({ providers: {
    "custom-text": {
      endpoint: "https://compatible.example/v1/chat/completions",
      protocol: "chat_completions",
      apiKey: "compatible-secret",
      consent: true,
      discoveredModels: [{ id: "opaque-model", confidence: "manual_unverified", tasks: [] }]
    }
  } });
  const ignored = applyConnectionModelAssignments({}, {
    providerId: "custom-text",
    model: "opaque-model",
    taskIds: ["textTags", "creativePlanning"]
  }, registry);
  assert.equal(ignored.textTags.providerId, "");
  assert.equal(ignored.creativePlanning.providerId, "");

  const explicit = applyConnectionModelAssignments({}, {
    providerId: "custom-text",
    model: "opaque-model",
    taskIds: ["creativePlanning"],
    allowManualUnverifiedTasks: ["creativePlanning"]
  }, registry);
  assert.equal(explicit.creativePlanning.providerId, "custom-text");
  assert.equal(explicit.creativePlanning.managedBy, "connection");
  assert.equal(explicit.textTags.providerId, "");
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

test("empty v5 storage normalizes without inventing provider or model assignments", () => {
  const registry = normalizeAiProviderRegistry({});
  const assignments = normalizeAiTaskAssignments({});
  assert.equal(registry.version, 5);
  assert.equal(Object.values(assignments).every((assignment) => !assignment.providerId && !assignment.model), true);
  assert.equal(assignments.textTags.concurrency, 20);
  assert.equal(assignments.imageAnalysis.concurrency, 10);
});

test("obsolete shared text routes are ignored instead of entering v5 assignments", () => {
  const assignments = normalizeAiTaskAssignments({
    text: { providerId: "deepseek", model: "obsolete-shared-model" }
  });
  assert.equal(Object.values(assignments).every((assignment) => !assignment.providerId && !assignment.model), true);
});

test("explicit task assignments survive v5 normalization with task defaults", () => {
  const explicit = Object.fromEntries(AI_ASSIGNMENT_TASKS.map(({ id }, index) => [id, {
    providerId: index % 2 ? "openai" : "deepseek",
    model: `account-model-${index}`
  }]));
  const normalized = normalizeAiTaskAssignments(explicit);
  assert.equal(AI_ASSIGNMENT_TASKS.every(({ id }) => normalized[id].providerId === explicit[id].providerId
    && normalized[id].model === explicit[id].model), true);
  assert.equal(normalized.textTags.concurrency, 20);
  assert.equal(normalized.imageAnalysis.concurrency, 10);
  assert.equal(configuredRegistry().providers.deepseek.apiKey, "deepseek-secret");
});

test("official concurrency remains enforceable even before model discovery", () => {
  const registry = normalizeAiProviderRegistry({});
  assert.equal(modelConcurrencyLimit("deepseek", "deepseek-v4-flash-vision-exp", registry), 2500);
  const assignments = normalizeAiTaskAssignments({
    imageAnalysis: { providerId: "deepseek", model: "deepseek-v4-flash-vision-exp", concurrency: 3000 }
  }, registry);
  assert.equal(assignments.imageAnalysis.concurrency, 2500);
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

test("an explicitly configured generation model remains assignable until a successful catalog refresh", () => {
  const registry = normalizeAiProviderRegistry({ providers: {
    openai: {
      apiKey: "openai-key",
      consent: true,
      models: { imageGeneration: "openai-account-image-model" }
    }
  } });
  const profile = registry.providers.openai;
  assert.deepEqual(
    availableAiModelsForTask("imageGeneration", profile).map((model) => model.id),
    ["openai-account-image-model"]
  );
  assert.equal(
    createAiTaskAssignment("imageGeneration", "openai", "openai-account-image-model", registry).model,
    "openai-account-image-model"
  );

  profile.discovery.discoveredAt = "2026-08-23T00:00:00.000Z";
  assert.deepEqual(availableAiModelsForTask("imageGeneration", profile), []);
  assert.throws(
    () => createAiTaskAssignment("imageGeneration", "openai", "openai-account-image-model", registry),
    /当前模型目录中没有/
  );
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
