import test from "node:test";
import assert from "node:assert/strict";

import { AI_MODEL_CAPABILITIES, getAiModelCapability } from "../ai-model-capabilities.js";
import { createAiProviderModule } from "../ai-provider-module.js";
import { PORTABLE_LIBRARY_LIMITS } from "../resource-limits.js";

const MP4 = Uint8Array.from([0, 0, 0, 24, 102, 116, 121, 112, 105, 115, 111, 109]);

function videoResponse(headers = {}) {
  return new Response(MP4, {
    headers: { "content-type": "video/mp4", ...headers }
  });
}

function jsonResponse(payload, status = 200, headers = {}) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json", ...headers }
  });
}

test("DeepSeek identity-only discovery keeps models task-neutral and never guesses capability from names", async () => {
  const calls = [];
  const module = createAiProviderModule({ fetchImpl: async (url, options) => {
    calls.push({ url, options });
    return jsonResponse({ data: [{ id: "deepseek-v4-flash" }, { id: "future-model-with-video-in-name" }] }, 200, { etag: '"models-v1"' });
  } });
  const result = await module.discoverModels({
    id: "deepseek",
    endpoint: "https://api.deepseek.com/chat/completions",
    apiKey: "secret",
    protocol: "chat_completions"
  });
  assert.equal(calls[0].url, "https://api.deepseek.com/models");
  assert.equal(result.models.length, 2);
  assert.equal(result.models[0].confidence, "manual_unverified");
  assert.deepEqual(result.models[0].tasks, []);
  assert.equal(result.models[1].tasks.includes("videoGeneration"), false);
  assert.equal(result.cache.etag, '"models-v1"');
});

test("identity discovery automatically classifies standard declared modalities without using model names", async () => {
  const module = createAiProviderModule({ fetchImpl: async () => jsonResponse({ data: [
    {
      id: "opaque-account-model",
      input_modalities: ["text", "image"],
      output_modalities: ["text"]
    },
    {
      id: "looks-like-vision-but-declared-text-only",
      input_modalities: ["text"],
      output_modalities: ["text"]
    }
  ] }) });
  const result = await module.discoverModels({
    id: "deepseek",
    endpoint: "https://api.deepseek.com/chat/completions",
    apiKey: "secret",
    protocol: "chat_completions"
  });

  assert.equal(result.models[0].confidence, "declared");
  assert.deepEqual(result.models[0].tasks, [
    "textTags", "skillExtraction", "creativePlanning", "imageAnalysis"
  ]);
  assert.equal(result.models[1].tasks.includes("imageAnalysis"), false);
});

test("Kimi discovery uses its declared catalog fields without inventing generation capabilities", async () => {
  const calls = [];
  const module = createAiProviderModule({ fetchImpl: async (url, options) => {
    calls.push({ url, options });
    return jsonResponse({ data: [
      { id: "moonshot-text", context_length: 131072 },
      { id: "moonshot-vision", context_length: 262144, supports_image_in: true },
      { id: "moonshot-video", supports_image_in: true, supports_video_in: true,
        input_modalities: ["text", "image", "video"], output_modalities: ["text", "image", "video"] }
    ] });
  } });
  const result = await module.discoverModels({
    id: "kimi",
    endpoint: "https://api.moonshot.cn/v1/chat/completions",
    apiKey: "secret",
    protocol: "chat_completions"
  });
  assert.equal(calls[0].url, "https://api.moonshot.cn/v1/models");
  assert.deepEqual(result.models[0].tasks, ["textTags", "skillExtraction", "creativePlanning"]);
  assert.equal(result.models[1].contextLength, 262144);
  assert.deepEqual(result.models[1].tasks, ["textTags", "skillExtraction", "creativePlanning", "imageAnalysis"]);
  assert.deepEqual(result.models[2].tasks, [
    "textTags", "skillExtraction", "creativePlanning", "imageAnalysis", "videoAnalysis"
  ]);
  assert.equal(result.models.some((model) => model.tasks.includes("imageGeneration") || model.tasks.includes("videoGeneration")), false);
});

test("Gemini discovery grants Nano Banana image generation only to exact official models visible in the live catalog", async () => {
  const calls = [];
  const module = createAiProviderModule({ fetchImpl: async (url, options) => {
    calls.push({ url, options });
    return jsonResponse({ models: [
      { name: "models/gemini-3.1-flash-lite-image", supportedGenerationMethods: ["generateContent"] },
      { name: "models/gemini-3.1-flash-image", supportedGenerationMethods: ["generateContent"] },
      { name: "models/gemini-3-pro-image", supportedGenerationMethods: ["generateContent"] },
      { name: "models/gemini-2.5-flash-image", supportedGenerationMethods: ["generateContent"] },
      { name: "models/gemini-3.1-flash", supportedGenerationMethods: ["generateContent"] },
      { name: "models/future-image-model", supportedGenerationMethods: ["generateContent"] },
      { name: "models/gemini-3.1-flash-image-preview", supportedGenerationMethods: ["generateContent"] }
    ] });
  } });

  const result = await module.discoverModels({
    id: "gemini",
    endpoint: "https://generativelanguage.googleapis.com",
    apiKey: "gemini-secret",
    protocol: "gemini",
    models: { imageGeneration: "gemini-3.1-flash-image" }
  });

  assert.equal(calls[0].url, "https://generativelanguage.googleapis.com/v1beta/models");
  assert.equal(calls[0].options.headers.Authorization, undefined);
  assert.equal(calls[0].options.headers["x-goog-api-key"], "gemini-secret");
  assert.deepEqual(
    result.models.filter((model) => model.tasks.includes("imageGeneration")).map((model) => model.id),
    ["gemini-3.1-flash-lite-image", "gemini-3.1-flash-image", "gemini-3-pro-image", "gemini-2.5-flash-image"]
  );
  assert.equal(result.models.find((model) => model.id === "gemini-3.1-flash").tasks.includes("imageGeneration"), false);
  assert.equal(result.models.find((model) => model.id === "future-image-model").tasks.includes("imageGeneration"), false);
  assert.equal(result.models.find((model) => model.id === "gemini-3.1-flash-image-preview").tasks.includes("imageGeneration"), false);
  const configuredFlash = result.models.find((model) => model.id === "gemini-3.1-flash-image");
  assert.deepEqual(configuredFlash.configuredTasks, ["imageGeneration"]);
  assert.deepEqual(configuredFlash.referenceImages, {
    supported: true, maxItems: 14, source: "declared", observedAt: ""
  });
  assert.deepEqual(configuredFlash.parameterDescriptors.reference_images, {
    maxItems: 14, objectReferences: 10, characterReferences: 4
  });
  assert.deepEqual(configuredFlash.supportedMethods, ["generateContent"]);
});

test("Nano Banana capability metadata exposes official Interactions parameters and per-model reference limits", () => {
  assert.deepEqual(AI_MODEL_CAPABILITIES.filter((item) => item.providerId === "gemini").map((item) => item.id), [
    "gemini-3.1-flash-lite-image",
    "gemini-3.1-flash-image",
    "gemini-3-pro-image",
    "gemini-2.5-flash-image"
  ]);
  const flash = getAiModelCapability("gemini", "models/gemini-3.1-flash-image");
  assert.equal(flash.protocol, "gemini_interactions");
  assert.deepEqual(flash.supportedResolutions, ["512px", "1K", "2K", "4K"]);
  assert.deepEqual(flash.referenceImages, {
    supported: true, maxItems: 14, source: "declared", observedAt: ""
  });
  assert.deepEqual(flash.parameterDescriptors.reference_images, {
    maxItems: 14, objectReferences: 10, characterReferences: 4
  });
  assert.equal(flash.source.url, "https://ai.google.dev/gemini-api/docs/image-generation");
  assert.deepEqual(getAiModelCapability("gemini", "gemini-3.1-flash-lite-image").supportedResolutions, ["1K"]);
  assert.deepEqual(getAiModelCapability("gemini", "gemini-3-pro-image").parameterDescriptors.reference_images, {
    maxItems: 14, objectReferences: 6, characterReferences: 5, styleReferences: 3
  });
  assert.equal(getAiModelCapability("gemini", "gemini-2.5-flash-image").referenceImages.maxItems, 3);
  assert.equal(getAiModelCapability("gemini", "gemini-3.1-flash-image-preview"), null);
  assert.equal(getAiModelCapability("openrouter", "gemini-3.1-flash-image"), null);
});

test("a manually configured Gemini image model records the selection without acquiring official generation capability", async () => {
  const module = createAiProviderModule({ fetchImpl: async () => jsonResponse({ models: [
    { name: "models/account-image-model", supportedGenerationMethods: ["generateContent"] }
  ] }) });
  const result = await module.discoverModels({
    id: "gemini",
    endpoint: "https://generativelanguage.googleapis.com",
    apiKey: "secret",
    protocol: "gemini",
    models: { imageGeneration: "account-image-model" }
  });
  const model = result.models[0];
  assert.deepEqual(model.configuredTasks, ["imageGeneration"]);
  assert.equal(model.tasks.includes("imageGeneration"), false);
  assert.equal(model.referenceImages, null);
  assert.equal(model.parameterDescriptors, null);
});

test("discovery failure stays visible and does not erase the last in-memory catalog", async () => {
  let attempt = 0;
  const module = createAiProviderModule({ fetchImpl: async () => {
    attempt += 1;
    return attempt === 1
      ? jsonResponse({ data: [{ id: "available-model" }] })
      : jsonResponse({ error: { message: "catalog temporarily unavailable" } }, 503);
  } });
  const profile = {
    id: "deepseek",
    endpoint: "https://api.deepseek.com/chat/completions",
    apiKey: "secret",
    protocol: "chat_completions"
  };
  await module.discoverModels(profile);
  await assert.rejects(() => module.discoverModels(profile), /catalog temporarily unavailable/);
  assert.equal(module.describeCapabilities("deepseek", "available-model").id, "available-model");
});

test("a configured model missing from a successful empty catalog is marked unavailable", async () => {
  const module = createAiProviderModule({ fetchImpl: async () => jsonResponse({ data: [] }) });
  const result = await module.discoverModels({
    id: "deepseek",
    endpoint: "https://api.deepseek.com/chat/completions",
    apiKey: "secret",
    protocol: "chat_completions",
    models: { imageAnalysis: "previously-visible-model" }
  });

  assert.equal(result.models.length, 1);
  assert.equal(result.models[0].id, "previously-visible-model");
  assert.equal(result.models[0].status, "unavailable");
});

test("xAI discovery combines language, image, and video model endpoints using declared modalities", async () => {
  const module = createAiProviderModule({ fetchImpl: async (url) => {
    if (url.endsWith("/language-models")) return jsonResponse({ models: [{
      id: "grok-language", input_modalities: ["text", "image"], output_modalities: ["text"]
    }] });
    if (url.endsWith("/image-generation-models")) return jsonResponse({ models: [{
      id: "grok-image", input_modalities: ["text", "image"], output_modalities: ["image"]
    }] });
    if (url.endsWith("/video-generation-models")) return jsonResponse({ models: [{
      id: "grok-video", input_modalities: ["text", "image"], output_modalities: ["video"]
    }] });
    throw new Error(`unexpected ${url}`);
  } });
  const result = await module.discoverModels({ id: "xai", endpoint: "https://api.x.ai/v1", apiKey: "secret", protocol: "native" });
  assert.deepEqual(module.describeCapabilities("xai", "grok-language").tasks, [
    "textTags", "skillExtraction", "creativePlanning", "imageAnalysis"
  ]);
  assert.deepEqual(module.describeCapabilities("xai", "grok-image").tasks, ["imageGeneration"]);
  assert.deepEqual(module.describeCapabilities("xai", "grok-video").tasks, ["videoGeneration"]);
  assert.equal(result.models.every((model) => model.confidence === "declared"), true);
});

test("OpenRouter discovery merges rich model metadata and dedicated asynchronous video capabilities", async () => {
  const module = createAiProviderModule({ fetchImpl: async (url) => {
    if (url.includes("/images/models")) return jsonResponse({ data: [] });
    if (url.includes("/videos/models")) return jsonResponse({ data: [{
      id: "google/veo-next",
      supported_resolutions: ["720p", "1080p"],
      supported_aspect_ratios: ["16:9", "9:16"],
      pricing_skus: { "per-video-second": "0.5" },
      allowed_passthrough_parameters: ["output_config"]
    }] });
    return jsonResponse({ data: [
      {
        id: "vision/text-model",
        name: "Vision Text",
        architecture: { input_modalities: ["text", "image"], output_modalities: ["text"] },
        supported_parameters: ["structured_outputs"],
        context_length: 128000,
        pricing: { prompt: "0.000001", completion: "0.000002" }
      },
      {
        id: "google/veo-next",
        architecture: { input_modalities: ["text", "image"], output_modalities: ["video"] },
        supported_parameters: ["seed"]
      }
    ] });
  } });
  const result = await module.discoverModels({
    id: "openrouter", endpoint: "https://openrouter.ai/api/v1", apiKey: "secret", protocol: "openrouter"
  });
  const vision = module.describeCapabilities("openrouter", "vision/text-model");
  assert.equal(vision.tasks.includes("imageAnalysis"), true);
  assert.equal(vision.tasks.includes("imageGeneration"), false);
  assert.equal(vision.contextLength, 128000);
  const video = module.describeCapabilities("openrouter", "google/veo-next");
  assert.deepEqual(video.supportedResolutions, ["720p", "1080p"]);
  assert.deepEqual(video.supportedAspectRatios, ["16:9", "9:16"]);
  assert.equal(video.tasks.includes("videoGeneration"), true);
  assert.equal(result.models.length, 2);
});

test("generic compatible discovery remains manual-unverified beyond explicitly configured task models", async () => {
  const module = createAiProviderModule({ fetchImpl: async () => jsonResponse({ data: [{ id: "unknown-model" }] }) });
  const result = await module.discoverModels({
    id: "custom-media",
    endpoint: "https://third-party.example/v1/chat/completions",
    apiKey: "secret",
    protocol: "chat_completions",
    models: { imageAnalysis: "configured-vision" }
  });
  assert.equal(result.models[0].confidence, "manual_unverified");
  assert.deepEqual(result.models[0].tasks, []);
});

test("credential verification accepts only models returned by the provider catalog", async () => {
  const module = createAiProviderModule({ fetchImpl: async () => jsonResponse({
    data: [{ id: "gpt-5.6-terra" }, { id: "gpt-image-2" }]
  }) });
  const profile = {
    id: "custom-media-image-credential-check",
    endpoint: "https://www.micuapi.ai/v1/images/generations",
    apiKey: "image-secret",
    protocol: "images_generations",
    models: { imageGeneration: "configured-but-not-visible" }
  };
  const available = await module.verifyModelAccess(profile, "gpt-image-2");
  const unavailable = await module.verifyModelAccess(profile, "configured-but-not-visible");
  assert.equal(available.available, true);
  assert.equal(unavailable.available, false);
  assert.deepEqual(available.visibleModelIds, ["gpt-5.6-terra", "gpt-image-2"]);
});

test("model catalog visibility is not misrepresented as verified image-channel access", async () => {
  const module = createAiProviderModule({ fetchImpl: async () => jsonResponse({
    data: [{ id: "gpt-image-2" }]
  }) });
  const result = await module.verifyModelAccess({
    id: "custom-media-image-credential-check",
    endpoint: "https://www.micuapi.ai/v1/images/generations",
    apiKey: "catalog-visible-but-wrong-group",
    protocol: "images_generations"
  }, "gpt-image-2");

  assert.equal(result.available, true);
  assert.equal(result.verification, "catalog_visible");
  assert.equal(result.executionVerified, false);
});

test("MiniMax video adapter submits, polls, resolves file metadata, and downloads without persisting the API key in the job", async () => {
  const calls = [];
  const module = createAiProviderModule({ fetchImpl: async (url, options = {}) => {
    calls.push({ url, options });
    if (url.endsWith("/video_generation") && options.method === "POST") return jsonResponse({ task_id: "task-1" });
    if (url.includes("/query/video_generation")) return jsonResponse({ status: "Success", file_id: "file-1" });
    if (url.includes("/files/retrieve")) return jsonResponse({ file: { download_url: "https://cdn.example/video.mp4" } });
    if (url === "https://cdn.example/video.mp4") return videoResponse();
    throw new Error(`unexpected ${url}`);
  } });
  const job = await module.submit("videoGeneration", {
    provider: { id: "minimax", endpoint: "https://api.minimaxi.com/v1", apiKey: "secret", protocol: "minimax_videos" },
    model: "hailuo-account-model",
    prompt: "camera moves forward",
    parameters: { duration: 6, resolution: "1080P" },
    images: [{ role: "firstFrame", url: "https://assets.example/frame.png" }]
  });
  assert.equal(job.remoteId, "task-1");
  assert.equal(JSON.stringify(job).includes("secret"), false);
  const completed = await module.poll(job);
  assert.equal(completed.status, "completed");
  assert.equal(completed.fileId, "file-1");
  const downloaded = await module.download(completed);
  assert.equal(downloaded.blob.type, "video/mp4");
  assert.equal(calls[0].options.body.includes("first_frame_image"), true);
});

test("Volcengine adapter uses the declared Ark content task protocol and does not guess Seedance parameters", async () => {
  const calls = [];
  const module = createAiProviderModule({ fetchImpl: async (url, options = {}) => {
    calls.push({ url, options });
    if (options.method === "POST") return jsonResponse({ id: "cgt-1" });
    return jsonResponse({ id: "cgt-1", status: "succeeded", content: { video_url: "https://tos.example/out.mp4" } });
  } });
  const job = await module.submit("videoGeneration", {
    provider: { id: "volcengine", endpoint: "https://ark.cn-beijing.volces.com/api/v3", apiKey: "secret", protocol: "ark_videos" },
    model: "account-endpoint-id",
    prompt: "a detective enters",
    parameters: {},
    images: []
  });
  assert.equal(calls[0].url.endsWith("/contents/generations/tasks"), true);
  const body = JSON.parse(calls[0].options.body);
  assert.deepEqual(Object.keys(body).sort(), ["content", "model"]);
  const completed = await module.poll(job);
  assert.equal(completed.downloadUrl, "https://tos.example/out.mp4");
});

test("OpenRouter video adapter keeps the official polling URL, frame schema, authenticated content download, and usage", async () => {
  const calls = [];
  const module = createAiProviderModule({ fetchImpl: async (url, options = {}) => {
    calls.push({ url, options });
    if (options.method === "POST") return jsonResponse({
      id: "or-job", polling_url: "https://openrouter.ai/api/v1/videos/or-job", status: "pending"
    }, 202);
    if (url.endsWith("/or-job")) return jsonResponse({
      id: "or-job", status: "completed",
      unsigned_urls: ["https://openrouter.ai/api/v1/videos/or-job/content?index=0"],
      usage: { cost: 0.25 }
    });
    if (url.includes("/content?index=0")) return videoResponse();
    throw new Error(`unexpected ${url}`);
  } });
  const job = await module.submit("videoGeneration", {
    provider: { id: "openrouter", endpoint: "https://openrouter.ai/api/v1", apiKey: "secret", protocol: "openrouter" },
    model: "account/video-model", prompt: "move forward", parameters: { resolution: "1080p", aspectRatio: "16:9" },
    images: [{ role: "firstFrame", url: "data:image/png;base64,AAAA" }]
  });
  assert.equal(job.pollUrl, "https://openrouter.ai/api/v1/videos/or-job");
  const submitted = JSON.parse(calls[0].options.body);
  assert.equal(submitted.aspect_ratio, "16:9");
  assert.equal(submitted.frame_images[0].frame_type, "first_frame");
  const completed = await module.poll(job);
  assert.equal(completed.providerPayload.usage.cost, 0.25);
  const downloaded = await module.download(completed);
  assert.equal(downloaded.blob.type, "video/mp4");
  assert.equal(calls.at(-1).options.headers.Authorization, "Bearer secret");
});

test("provider polling refuses a cross-origin URL before sending an API key", async () => {
  const calls = [];
  const module = createAiProviderModule({ fetchImpl: async (url, options = {}) => {
    calls.push({ url, options });
    if (options.method === "POST") return jsonResponse({
      id: "unsafe-job",
      polling_url: "https://collector.example/status/unsafe-job"
    });
    throw new Error("cross-origin polling must not be requested");
  } });
  const job = await module.submit("videoGeneration", {
    provider: { id: "openrouter", endpoint: "https://openrouter.ai/api/v1", apiKey: "secret", protocol: "openrouter" },
    model: "account/video-model",
    prompt: "move forward"
  });

  await assert.rejects(() => module.poll(job), /轮询地址.*授权厂商/);
  assert.equal(calls.length, 1);
  assert.equal(JSON.stringify(calls).includes("collector.example"), false);
});

test("cross-origin video downloads omit provider credentials while same-origin downloads retain them", async () => {
  const calls = [];
  const module = createAiProviderModule({ fetchImpl: async (url, options = {}) => {
    calls.push({ url, options });
    return videoResponse();
  } });
  module.configureProvider({
    id: "openrouter",
    endpoint: "https://openrouter.ai/api/v1",
    apiKey: "secret",
    protocol: "openrouter"
  });

  await module.download({
    providerId: "openrouter",
    protocol: "openrouter",
    remoteId: "cross-origin",
    status: "completed",
    downloadUrl: "https://cdn.example/out.mp4"
  });
  await module.download({
    providerId: "openrouter",
    protocol: "openrouter",
    remoteId: "same-origin",
    status: "completed",
    downloadUrl: "https://openrouter.ai/api/v1/videos/same-origin/content"
  });

  assert.equal(calls[0].options.headers.Authorization, undefined);
  assert.equal(calls[1].options.headers.Authorization, "Bearer secret");
  assert.equal(calls.every((call) => call.options.credentials === "omit"), true);
});

test("video downloads reject oversized declarations and spoofed non-video bodies", async () => {
  const responses = [
    videoResponse({ "content-length": String(PORTABLE_LIBRARY_LIMITS.maxVideoBytes + 1) }),
    new Response("<html>not a video</html>", { headers: { "content-type": "video/mp4" } })
  ];
  const module = createAiProviderModule({ fetchImpl: async () => responses.shift() });
  module.configureProvider({
    id: "openrouter",
    endpoint: "https://openrouter.ai/api/v1",
    apiKey: "secret",
    protocol: "openrouter"
  });
  const job = {
    providerId: "openrouter",
    protocol: "openrouter",
    remoteId: "bounded",
    status: "completed",
    downloadUrl: "https://openrouter.ai/api/v1/videos/bounded/content"
  };

  await assert.rejects(() => module.download(job), /超过本地容量上限/);
  await assert.rejects(() => module.download(job), /有效视频文件/);
});

test("provider polling is interrupted by the shared cancellation signal", async () => {
  const controller = new AbortController();
  const module = createAiProviderModule({
    signal: controller.signal,
    timeoutMs: 1_000,
    fetchImpl: async (_url, options = {}) => new Promise((_resolve, reject) => {
      assert.equal(options.signal instanceof AbortSignal, true);
      options.signal.addEventListener("abort", () => reject(options.signal.reason ?? new DOMException("Aborted", "AbortError")), { once: true });
    })
  });
  module.configureProvider({
    id: "openrouter",
    endpoint: "https://openrouter.ai/api/v1",
    apiKey: "secret",
    protocol: "openrouter"
  });
  const polling = module.poll({
    providerId: "openrouter",
    protocol: "openrouter",
    remoteId: "pending",
    status: "running",
    pollUrl: "https://openrouter.ai/api/v1/videos/pending"
  });
  controller.abort();

  await assert.rejects(polling, (error) => error?.name === "AbortError");
});

test("provider errors cannot echo the configured API key", async () => {
  const responses = [
    jsonResponse({ error: { message: "credential secret-value is not authorized" } }, 401),
    jsonResponse({ status: "failed", error_message: "credential secret-value was rejected" })
  ];
  const module = createAiProviderModule({ fetchImpl: async () => responses.shift() });
  module.configureProvider({
    id: "openrouter",
    endpoint: "https://openrouter.ai/api/v1",
    apiKey: "secret-value",
    protocol: "openrouter"
  });

  await assert.rejects(
    () => module.poll({
      providerId: "openrouter",
      protocol: "openrouter",
      remoteId: "denied",
      status: "running"
    }),
    (error) => /已隐藏凭据/.test(error.message) && !error.message.includes("secret-value")
  );
  await assert.rejects(
    () => module.poll({
      providerId: "openrouter",
      protocol: "openrouter",
      remoteId: "failed",
      status: "running"
    }),
    (error) => /已隐藏凭据/.test(error.message) && !error.message.includes("secret-value")
  );
});
