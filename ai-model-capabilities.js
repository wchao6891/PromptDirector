const GOOGLE_IMAGE_GENERATION_SOURCE = Object.freeze({
  authority: "Google AI for Developers",
  document: "Gemini API image generation",
  url: "https://ai.google.dev/gemini-api/docs/image-generation",
  reviewedAt: "2026-08-12"
});

const DEEPSEEK_VISION_SOURCE = Object.freeze({
  authority: "DeepSeek API Docs",
  document: "DeepSeek-V4-Flash-Vision-Exp Release",
  url: "https://api-docs.deepseek.com/news/news260821/",
  reviewedAt: "2026-08-24"
});

const DEEPSEEK_CONCURRENCY_SOURCE = Object.freeze({
  authority: "DeepSeek API Docs",
  document: "Models & Pricing",
  url: "https://api-docs.deepseek.com/quick_start/pricing/",
  reviewedAt: "2026-08-24"
});

const ZHIPU_GLM_46V_SOURCE = Object.freeze({
  authority: "智谱 AI 开放平台",
  document: "GLM-4.6V",
  url: "https://docs.bigmodel.cn/cn/guide/models/vlm/glm-4.6v",
  reviewedAt: "2026-08-28"
});

const ZHIPU_GLM_53_FLASH_SOURCE = Object.freeze({
  authority: "智谱 AI 开放平台",
  document: "GLM-5.3-Flash",
  url: "https://docs.bigmodel.cn/cn/guide/models/vlm/glm-5.3-flash",
  reviewedAt: "2026-08-29"
});
const STANDARD_ASPECT_RATIOS = Object.freeze([
  "1:1", "2:3", "3:2", "3:4", "4:3", "4:5", "5:4", "9:16", "16:9", "21:9"
]);
const FLASH_ASPECT_RATIOS = Object.freeze([
  "1:1", "1:4", "1:8", "2:3", "3:2", "3:4", "4:1", "4:3", "4:5", "5:4", "8:1", "9:16", "16:9", "21:9"
]);

function googleImageModel(value) {
  return Object.freeze({
    ...value,
    providerId: "gemini",
    protocol: "gemini_interactions",
    tasks: Object.freeze(["imageGeneration"]),
    inputModalities: Object.freeze(["text", "image"]),
    outputModalities: Object.freeze(["text", "image"]),
    supportedParameters: Object.freeze([...value.supportedParameters]),
    supportedResolutions: Object.freeze([...value.supportedResolutions]),
    supportedAspectRatios: Object.freeze([...value.supportedAspectRatios]),
    referenceImages: Object.freeze({ ...value.referenceImages }),
    parameterDescriptors: Object.freeze(structuredClone(value.parameterDescriptors)),
    source: GOOGLE_IMAGE_GENERATION_SOURCE
  });
}

export const AI_MODEL_CAPABILITIES = Object.freeze([
  Object.freeze({
    id: "deepseek-v4-flash",
    providerId: "deepseek",
    protocol: "chat_completions",
    tasks: Object.freeze(["textTags", "skillExtraction", "creativePlanning"]),
    inputModalities: Object.freeze(["text"]),
    outputModalities: Object.freeze(["text"]),
    supportedParameters: Object.freeze(["response_format", "reasoning_effort"]),
    supportedResolutions: Object.freeze([]),
    supportedAspectRatios: Object.freeze([]),
    contextLength: 1_000_000,
    structuredOutput: "json_object",
    concurrencyLimit: Object.freeze({ value: 2500, source: DEEPSEEK_CONCURRENCY_SOURCE }),
    source: DEEPSEEK_CONCURRENCY_SOURCE
  }),
  Object.freeze({
    id: "deepseek-v4-pro",
    providerId: "deepseek",
    protocol: "chat_completions",
    tasks: Object.freeze(["textTags", "skillExtraction", "creativePlanning"]),
    inputModalities: Object.freeze(["text"]),
    outputModalities: Object.freeze(["text"]),
    supportedParameters: Object.freeze(["response_format", "reasoning_effort"]),
    supportedResolutions: Object.freeze([]),
    supportedAspectRatios: Object.freeze([]),
    contextLength: 1_000_000,
    structuredOutput: "json_object",
    concurrencyLimit: Object.freeze({ value: 500, source: DEEPSEEK_CONCURRENCY_SOURCE }),
    source: DEEPSEEK_CONCURRENCY_SOURCE
  }),
  Object.freeze({
    id: "deepseek-v4-flash-vision-exp",
    providerId: "deepseek",
    protocol: "chat_completions",
    tasks: Object.freeze(["textTags", "skillExtraction", "creativePlanning", "imageAnalysis"]),
    inputModalities: Object.freeze(["text", "image"]),
    outputModalities: Object.freeze(["text"]),
    supportedParameters: Object.freeze(["response_format"]),
    supportedResolutions: Object.freeze([]),
    supportedAspectRatios: Object.freeze([]),
    referenceImages: Object.freeze({ supported: true, maxItems: 600, source: "declared", observedAt: "" }),
    concurrencyLimit: Object.freeze({ value: 2500, source: DEEPSEEK_CONCURRENCY_SOURCE }),
    source: DEEPSEEK_VISION_SOURCE
  }),
  Object.freeze({
    id: "glm-5.3-flash",
    providerId: "zhipu",
    protocol: "chat_completions",
    tasks: Object.freeze(["textTags", "skillExtraction", "creativePlanning", "imageAnalysis", "videoAnalysis"]),
    inputModalities: Object.freeze(["text", "image", "video", "file"]),
    outputModalities: Object.freeze(["text"]),
    supportedParameters: Object.freeze(["response_format"]),
    supportedResolutions: Object.freeze([]),
    supportedAspectRatios: Object.freeze([]),
    contextLength: 1_000_000,
    structuredOutput: "json_object",
    structuredOutputTokenBudget: 8192,
    mediaInput: Object.freeze({
      imageBase64: "data_url",
      localVideo: "base64",
      preferPublicVideoUrl: true,
      publicVideoUrl: "direct"
    }),
    source: ZHIPU_GLM_53_FLASH_SOURCE
  }),
  Object.freeze({
    id: "glm-4.6v",
    providerId: "zhipu",
    protocol: "chat_completions",
    tasks: Object.freeze(["textTags", "skillExtraction", "creativePlanning", "imageAnalysis", "videoAnalysis"]),
    inputModalities: Object.freeze(["text", "image", "video", "file"]),
    outputModalities: Object.freeze(["text"]),
    supportedParameters: Object.freeze([]),
    supportedResolutions: Object.freeze([]),
    supportedAspectRatios: Object.freeze([]),
    source: ZHIPU_GLM_46V_SOURCE
  }),
  googleImageModel({
    id: "gemini-3.1-flash-lite-image",
    supportedParameters: ["response_format", "aspect_ratio", "image_size"],
    supportedResolutions: ["1K"],
    supportedAspectRatios: STANDARD_ASPECT_RATIOS,
    referenceImages: { supported: true, maxItems: 14, source: "declared", observedAt: "" },
    parameterDescriptors: {
      image_size: { values: ["1K"] },
      aspect_ratio: { values: STANDARD_ASPECT_RATIOS },
      reference_images: { maxItems: 14, objectReferences: 14 }
    }
  }),
  googleImageModel({
    id: "gemini-3.1-flash-image",
    supportedParameters: ["response_format", "aspect_ratio", "image_size"],
    supportedResolutions: ["512px", "1K", "2K", "4K"],
    supportedAspectRatios: FLASH_ASPECT_RATIOS,
    referenceImages: { supported: true, maxItems: 14, source: "declared", observedAt: "" },
    parameterDescriptors: {
      image_size: { values: ["512px", "1K", "2K", "4K"] },
      aspect_ratio: { values: FLASH_ASPECT_RATIOS },
      reference_images: { maxItems: 14, objectReferences: 10, characterReferences: 4 }
    }
  }),
  googleImageModel({
    id: "gemini-3-pro-image",
    supportedParameters: ["response_format", "aspect_ratio", "image_size"],
    supportedResolutions: ["1K", "2K", "4K"],
    supportedAspectRatios: STANDARD_ASPECT_RATIOS,
    referenceImages: { supported: true, maxItems: 14, source: "declared", observedAt: "" },
    parameterDescriptors: {
      image_size: { values: ["1K", "2K", "4K"] },
      aspect_ratio: { values: STANDARD_ASPECT_RATIOS },
      reference_images: { maxItems: 14, objectReferences: 6, characterReferences: 5, styleReferences: 3 }
    }
  }),
  googleImageModel({
    id: "gemini-2.5-flash-image",
    supportedParameters: ["response_format", "aspect_ratio"],
    supportedResolutions: ["1024px"],
    supportedAspectRatios: STANDARD_ASPECT_RATIOS,
    referenceImages: { supported: true, maxItems: 3, source: "declared", observedAt: "" },
    parameterDescriptors: {
      aspect_ratio: { values: STANDARD_ASPECT_RATIOS },
      reference_images: { recommendedMaxItems: 3 }
    }
  })
]);

const MODEL_CAPABILITY_INDEX = new Map(
  AI_MODEL_CAPABILITIES.map((item) => [`${item.providerId}:${item.id}`, item])
);

export function getAiModelCapability(providerIdValue, modelIdValue) {
  const providerId = String(providerIdValue ?? "").trim();
  const modelId = String(modelIdValue ?? "").trim().replace(/^models\//, "");
  const capability = MODEL_CAPABILITY_INDEX.get(`${providerId}:${modelId}`);
  return capability ? structuredClone(capability) : null;
}

export function listAiModelCapabilities(providerIdValue) {
  const providerId = String(providerIdValue ?? "").trim();
  return AI_MODEL_CAPABILITIES
    .filter((item) => item.providerId === providerId)
    .map((item) => structuredClone(item));
}
