import {
  deepSeekErrorDetails,
  executeAgentTurn as executeDeepSeekTurn,
  normalizeAiSettings,
  planComposerTurn as planDeepSeekTurn
} from "./deepseek.js";
import {
  assertComposerInputBudget,
  assertComposerRequestBudget,
  normalizeComposerAiProfile,
  normalizeComposerSettings,
  normalizePlannerResult,
  plannerRequestPayload,
  validateGeneratedPrompt
} from "./composer.js";
import { compileAgentExecutionPrompt, compileAgentPlanningPrompt } from "./composer-agent.js";
import { normalizeVisionSettings, OPENAI_RESPONSES_ENDPOINT, OPENAI_VIDEOS_ENDPOINT } from "./vision.js";
import { PORTABLE_LIBRARY_LIMITS } from "./resource-limits.js";
import { boundedMediaBlobFromResponse, fetchBoundedMedia } from "./bounded-media.js";
import { createAiProviderModule } from "./ai-provider-module.js";
import { getAiModelCapability } from "./ai-model-capabilities.js";
import {
  compatibleImageSizesFor,
  compatibleProviderPresetForEndpoint
} from "./compatible-provider-presets.js";

const REQUEST_TIMEOUT_MS = 120_000;
const IMAGE_REQUEST_TIMEOUT_MS = 240_000;
const OPENAI_FILES_ENDPOINT = "https://api.openai.com/v1/files";
const XAI_CHAT_ENDPOINT = "https://api.x.ai/v1/chat/completions";
const XAI_IMAGE_GENERATIONS_ENDPOINT = "https://api.x.ai/v1/images/generations";
const XAI_VIDEOS_ENDPOINT = "https://api.x.ai/v1/videos";
const RESPONSES_IMAGE_SIZES = Object.freeze([
  { value: "auto", label: "自动", aspectRatio: "auto", resolution: "auto" },
  { value: "1024x1024", label: "方形 · 1024×1024", aspectRatio: "1:1", resolution: "1024x1024" },
  { value: "1536x1024", label: "横向 · 1536×1024", aspectRatio: "3:2", resolution: "1536x1024" },
  { value: "1024x1536", label: "纵向 · 1024×1536", aspectRatio: "2:3", resolution: "1024x1536" }
]);
const RESPONSES_IMAGE_QUALITIES = Object.freeze([
  { value: "auto", label: "自动" },
  { value: "low", label: "低" },
  { value: "medium", label: "中" },
  { value: "high", label: "高" }
]);
export class ComposerServiceError extends Error {
  constructor(message, status = 0, options = {}) {
    super(message, options);
    this.name = "ComposerServiceError";
    this.status = Number(status) || 0;
    this.kind = options.kind || serviceErrorKind(this.status);
    this.retryable = options.retryable ?? [0, 408, 429, 500, 502, 503, 504].includes(this.status);
    this.referenceLimit = normalizeReferenceLimit(options.referenceLimit);
  }
}

export function composerServiceErrorDetails(error) {
  if (error?.name === "AbortError") {
    return { kind: "stopped", message: "已停止，本次不完整输出没有保存", retryable: false };
  }
  if (error instanceof ComposerServiceError) {
    return { kind: error.kind, message: error.message, retryable: error.retryable, referenceLimit: error.referenceLimit };
  }
  return deepSeekErrorDetails(error);
}

export function composerServiceCatalog(aiSettingsValue = {}, visionSettingsValue = {}) {
  const ai = normalizeAiSettings(aiSettingsValue);
  const vision = normalizeVisionSettings(visionSettingsValue);
  const compatibleLabel = serviceLabelForEndpoint(vision.compatible.endpoint);
  const xai = normalizeXaiComposerSettings(visionSettingsValue?.xai);
  const deepseekProfile = visionSettingsValue?.providerProfiles?.deepseek;
  const deepseekModels = [...new Set([
    "deepseek-v4-flash", "deepseek-v4-pro", deepseekProfile?.models?.creativePlanning
  ].map((value) => String(value ?? "").trim()).filter(Boolean))];
  const catalog = [
    ...deepseekModels.map((model) => ({
      serviceId: "deepseek",
      model,
      label: model === "deepseek-v4-flash" ? "DeepSeek Flash"
        : model === "deepseek-v4-pro" ? "DeepSeek Pro" : `DeepSeek · ${model}`,
      shortLabel: model === "deepseek-v4-flash" ? "Flash" : model === "deepseek-v4-pro" ? "Pro" : "DeepSeek",
      configured: Boolean(ai.apiKey && ai.consent),
      vision: providerModelSupports(deepseekProfile, model, "imageAnalysis"),
      planning: model === deepseekProfile?.models?.creativePlanning || providerModelSupports(deepseekProfile, model, "creativePlanning"),
      reasoning: model === deepseekProfile?.models?.creativePlanning || providerModelSupports(deepseekProfile, model, "creativePlanning"),
      imageGeneration: false,
      videoGeneration: false
    })),
    {
      serviceId: "openai",
      model: vision.openai.model,
      label: `OpenAI · ${vision.openai.model || "未选择模型"}`,
      shortLabel: "OpenAI",
      configured: Boolean(vision.openai.apiKey && vision.consent && vision.openai.model),
      vision: true,
      planning: true,
      reasoning: true,
      imageGeneration: Boolean(vision.openai.apiKey && vision.consent && vision.openai.model),
      videoGeneration: openAiVideoConfigured(vision)
    },
    {
      serviceId: "compatible",
      model: vision.compatible.model,
      label: `${compatibleLabel} · ${vision.compatible.model || "未选择模型"}`,
      shortLabel: compatibleLabel,
      configured: compatibleConfigured(vision),
      vision: true,
      planning: true,
      reasoning: compatibleReasoningSupported(vision.compatible),
      imageGeneration: compatibleImageConfigured(vision.compatible),
      videoGeneration: false
    },
    {
      serviceId: "xai",
      model: xai.textModel,
      label: `xAI · ${xai.textModel || "未选择模型"}`,
      shortLabel: "xAI",
      configured: Boolean(xai.mediaConsent && xai.apiKey && xai.textModel),
      vision: true,
      planning: true,
      reasoning: false,
      imageGeneration: Boolean(xai.mediaConsent && xai.apiKey && xai.textModel && xai.imageModel),
      videoGeneration: Boolean(xai.mediaConsent && xai.apiKey && xai.textModel && xai.videoModel)
    }
  ];
  const specialProviderIds = new Set(["deepseek", "openai", "xai", "custom-media"]);
  for (const profile of Object.values(visionSettingsValue?.providerProfiles ?? {})) {
    const providerId = String(profile?.id ?? "").trim();
    if (!providerId || specialProviderIds.has(providerId)) continue;
    if (!profile.capabilities?.some((taskId) => ["creativePlanning", "imageGeneration", "videoGeneration"].includes(taskId))) continue;
    const models = [...new Set([profile.models?.creativePlanning, profile.models?.imageGeneration, profile.models?.videoGeneration]
      .map((value) => String(value ?? "").trim()).filter(Boolean))];
    for (const model of models.length ? models : [""]) {
      catalog.push({
        serviceId: providerId,
        model,
        label: `${profile.label || providerId} · ${model || "未选择模型"}`,
        shortLabel: profile.label || providerId,
        configured: Boolean(profile.consent && profile.apiKey && model),
        vision: providerModelSupports(profile, model, "imageAnalysis"),
        planning: model === profile.models?.creativePlanning || providerModelSupports(profile, model, "creativePlanning"),
        reasoning: false,
        imageGeneration: Boolean(profile.consent && profile.apiKey && providerModelSupports(profile, model, "imageGeneration")),
        videoGeneration: Boolean(profile.consent && profile.apiKey && providerModelSupports(profile, model, "videoGeneration"))
      });
    }
  }
  return catalog;
}

export function composerServiceCapabilities(profileValue, visionSettingsValue = {}) {
  const profile = normalizeComposerAiProfile(profileValue);
  if (profile.serviceId === "unassigned") return { serviceId: "unassigned", model: "", image: null, video: null };
  const settings = normalizeVisionSettings(visionSettingsValue);
  const xai = normalizeXaiComposerSettings(visionSettingsValue?.xai);
  if (profile.serviceId === "deepseek") return { serviceId: "deepseek", model: profile.model, image: null, video: null };
  if (profile.serviceId === "openai") {
    const configured = Boolean(settings.consent && settings.openai.apiKey && (profile.model || settings.openai.model));
    const provider = visionSettingsValue?.providerProfiles?.openai;
    const model = profile.model || settings.openai.model;
    const references = modelReferenceCapability(provider, model, { supported: true, maxItems: null });
    return {
      serviceId: "openai",
      model,
      image: responsesImageCapability(configured, references),
      video: openAiVideoCapability(settings)
    };
  }
  if (profile.serviceId === "xai") {
    const configured = Boolean(xai.mediaConsent && xai.apiKey && (profile.model || xai.textModel));
    const provider = visionSettingsValue?.providerProfiles?.xai;
    const references = modelReferenceCapability(provider, xai.imageModel, { supported: false, maxItems: null });
    return {
      serviceId: "xai",
      model: profile.model || xai.textModel,
      image: {
        generate: configured && Boolean(xai.imageModel),
        references,
        edit: { whole: false, local: false },
        parameters: []
      },
      video: xaiVideoCapability(configured, xai)
    };
  }
  const registryProvider = visionSettingsValue?.providerProfiles?.[profile.serviceId];
  if (registryProvider && !["openai", "xai", "custom-media"].includes(profile.serviceId)) {
    const provider = registryProvider;
    const model = profile.model;
    const descriptor = providerModelDescriptor(provider, model);
    const configured = Boolean(provider?.consent && provider?.apiKey && model && descriptor?.tasks?.includes("videoGeneration"));
    const image = ["gemini", "openrouter"].includes(profile.serviceId) ? (() => {
      const imageModel = profile.model;
      const imageDescriptor = providerModelDescriptor(provider, imageModel);
      const references = modelReferenceCapability(provider, imageModel, {
        supported: imageDescriptor?.inputModalities?.includes("image") === true,
        maxItems: null
      });
      return {
        generate: Boolean(provider?.consent && provider?.apiKey && imageModel && imageDescriptor?.tasks?.includes("imageGeneration")),
        references,
        edit: { whole: imageDescriptor?.inputModalities?.includes("image") === true, local: false },
        parameters: profile.serviceId === "gemini" ? providerImageParameters(imageDescriptor) : []
      };
    })() : null;
    return {
      serviceId: profile.serviceId,
      model,
      image,
      video: {
        generate: configured,
        protocol: provider?.protocol,
        inputs: {
          text: true,
          firstFrame: descriptor?.inputModalities?.includes("image") === true,
          lastFrame: ["minimax_videos"].includes(provider?.protocol) && descriptor?.inputModalities?.includes("image") === true,
          referenceImages: modelReferenceCapability(provider, model, {
            supported: descriptor ? descriptor.inputModalities?.includes("image") === true : null,
            maxItems: descriptor?.inputModalities?.includes("image") === true
              ? provider?.protocol === "minimax_videos" ? 2 : 1
              : null
          }),
          referenceVideo: false, edit: false, extend: false, motion: false
        },
        parameters: providerVideoParameters(descriptor)
      }
    };
  }
  const provider = settings.compatible;
  const configured = compatibleConfigured(settings);
  if (provider.imageGeneration.protocol === "responses_tool") {
    return {
      serviceId: "compatible",
      model: profile.model || provider.model,
      image: responsesImageCapability(configured),
      video: null
    };
  }
  if (provider.imageGeneration.protocol !== "images_generations") {
    return { serviceId: "compatible", model: profile.model || provider.model, image: null, video: null };
  }
  const image = provider.imageGeneration;
  const referenceCapability = compatibleImageReferenceCapability(visionSettingsValue, image.model);
  const supportedSizes = compatibleImageSizesFor(provider.endpoint, image);
  const sizeOptions = supportedSizes.map(imageSizeOption);
  const qualityOptions = image.qualities.map((quality) => ({ value: quality, label: quality }));
  return {
    serviceId: "compatible",
    model: image.model || profile.model || provider.model,
    image: {
      generate: configured && !compatibleImageConfigurationIssue(image, supportedSizes),
      references: {
        supported: referenceCapability.supported ?? Boolean(image.editsEndpoint),
        maxItems: referenceCapability.maxItems,
        source: referenceCapability.source
      },
      edit: { whole: Boolean(image.editsEndpoint), local: Boolean(image.editsEndpoint) },
      parameters: [
        imageParameter("size", "画幅与分辨率", sizeOptions, image.sizes[0] || supportedSizes[0]),
        imageParameter("quality", "质量", qualityOptions, image.qualities[0])
      ].filter((parameter) => parameter.options.length)
    },
    video: null
  };
}

export function composerVideoAvailability(profileValue, visionSettingsValue = {}, session = {}) {
  if (session?.targetType !== "video") return { available: false, message: "视频生成只在视频任务中显示" };
  const capability = composerServiceCapabilities(profileValue, visionSettingsValue).video;
  if (!capability?.generate) return { available: false, message: "当前服务没有声明可用的视频生成能力" };
  const state = normalizeVideoGenerationRequest(profileValue, visionSettingsValue, session.generationParameters);
  if (state.issues.length) return { available: false, message: state.issues.join("；") };
  const imageCount = referenceImageCount(session);
  const references = capability.inputs.referenceImages;
  if (imageCount && references.supported === false) {
    return { available: false, message: "当前视频模型不接收原图" };
  }
  if (Number.isInteger(references.maxItems) && imageCount > references.maxItems) {
    return { available: false, message: `当前视频服务最多接收 ${references.maxItems} 张首帧参考图` };
  }
  return { available: true, message: imageCount ? "将首张参考图作为视频起始参考" : "由当前视频服务直接生成并下载到本机临时结果" };
}

export function normalizeVideoGenerationRequest(profileValue, visionSettingsValue = {}, parametersValue = {}) {
  const capability = composerServiceCapabilities(profileValue, visionSettingsValue).video;
  if (!capability?.generate) return { parameters: {}, ignored: [], issues: ["当前服务未声明可用的视频生成能力"] };
  const source = parametersValue && typeof parametersValue === "object" ? parametersValue : {};
  const parameters = {};
  const issues = [];
  for (const field of capability.parameters) {
    const requested = String(source[field.key] ?? "").trim();
    const selected = requested || field.defaultValue;
    if (!selected) continue;
    if (!field.options.some((option) => option.value === selected)) {
      issues.push(`${field.label}“${selected}”不受当前服务支持`);
      continue;
    }
    parameters[field.key] = selected;
  }
  const declared = new Set(capability.parameters.map((field) => field.key));
  const ignored = Object.entries(source)
    .filter(([key, value]) => !declared.has(key) && String(value ?? "").trim())
    .map(([key]) => key);
  return { parameters, ignored, issues };
}

export function normalizeImageGenerationRequest(profileValue, visionSettingsValue = {}, parametersValue = {}) {
  const capability = composerServiceCapabilities(profileValue, visionSettingsValue).image;
  if (!capability?.generate) return { parameters: {}, ignored: [], issues: ["当前服务未声明可用的图片生成能力"] };
  const source = parametersValue && typeof parametersValue === "object" ? parametersValue : {};
  const parameters = {};
  const issues = [];
  for (const field of capability.parameters) {
    const requested = String(source[field.key] ?? "").trim();
    const selected = requested || field.defaultValue;
    if (!selected) continue;
    if (!field.options.some((option) => option.value === selected)) {
      issues.push(`${field.label}“${selected}”不受当前服务支持`);
      continue;
    }
    parameters[field.key] = selected;
  }
  const declared = new Set(capability.parameters.map((field) => field.key));
  const ignored = Object.entries(source)
    .filter(([key, value]) => !declared.has(key) && String(value ?? "").trim())
    .map(([key]) => key);
  return { parameters, ignored, issues };
}

export function composerImageAvailability(profileValue, visionSettingsValue = {}, session = {}) {
  if (session?.targetType === "video") return { available: false, message: "视频创作只输出提示词" };
  const settings = normalizeVisionSettings(visionSettingsValue);
  const profile = normalizeComposerAiProfile(profileValue);
  const catalog = composerServiceCatalog({}, visionSettingsValue);
  const service = catalog.find((item) => item.serviceId === profile.serviceId && item.model === profile.model)
    ?? catalog.find((item) => item.serviceId === profile.serviceId);
  if (!service || service.serviceId === "deepseek") return { available: false, message: "当前服务只输出文字提示词" };
  if (service.serviceId === "xai") {
    if (!service.imageGeneration) return { available: false, message: "xAI 创建图片还缺少 API Key、文字模型或图片模型" };
    if (referenceImageCount(session)) return { available: false, message: "当前 xAI 生图接口未声明参考图输入；请移除图片参考或改用其他服务" };
    return { available: true, message: "由 xAI 直接创建图片并保存到本轮结果" };
  }
  if (service.serviceId === "openrouter") {
    const capability = composerServiceCapabilities(profileValue, visionSettingsValue).image;
    if (!capability?.generate) return { available: false, message: "OpenRouter 生图还缺少已声明图片输出能力的模型、API Key 或发送授权" };
    if (session.imageReferenceMode === "prompt_only") return { available: false, message: "当前 OpenRouter 独立图片接口不能在整理提示词阶段读取原图；请选择带图生成或全程纯文字" };
    if (referenceImageCount(session) && session.imageReferenceMode === "conditioned" && capability.references.supported === false) {
      return { available: false, message: "所选 OpenRouter 模型未声明参考图输入能力" };
    }
    return { available: true, message: "由 OpenRouter 独立图片接口生成；不会静默改用其他模型" };
  }
  if (service.serviceId === "gemini") {
    const capability = composerServiceCapabilities(profileValue, visionSettingsValue).image;
    if (!capability?.generate) return { available: false, message: "Gemini 生图还缺少已分配的 Nano Banana 模型、API Key 或发送授权" };
    const count = referenceImageCount(session);
    if (count && session.imageReferenceMode === "conditioned" && capability.references.supported === false) {
      return { available: false, message: "所选 Gemini 图片模型未声明参考图输入能力" };
    }
    if (session.imageReferenceMode === "conditioned" && Number.isInteger(capability.references.maxItems) && count > capability.references.maxItems) {
      return { available: false, message: `当前有 ${count} 张参考图，所选 Gemini 模型最多读取 ${capability.references.maxItems} 张，请先减少参考` };
    }
    return imageParameterAvailability(profileValue, visionSettingsValue, session, "由 Google Gemini 官方 Interactions 接口直接生成；不会静默改用其他模型");
  }
  if (service.serviceId === "openai") {
    const capability = composerServiceCapabilities(profileValue, visionSettingsValue).image;
    if (referenceImageCount(session) && session.imageReferenceMode === "conditioned" && capability?.references?.supported === false) {
      return { available: false, message: "所选 OpenAI 模型明确不支持原图参考；请选择最终生图不垫图或全程纯文字" };
    }
    return service.imageGeneration
      ? imageParameterAvailability(profileValue, visionSettingsValue, session, "由 OpenAI 直接生成并保存到本轮结果")
      : { available: false, message: "创建图片还缺少 OpenAI API Key 或模型" };
  }
  const image = settings.compatible.imageGeneration;
  if (image.protocol === "responses_tool") {
    return service.imageGeneration
      ? imageParameterAvailability(profileValue, visionSettingsValue, session, `由 ${service.shortLabel} 直接生成并保存到本轮结果`)
      : { available: false, message: "创建图片还缺少兼容服务的接口、模型或 API Key" };
  }
  const issue = compatibleImageConfigurationIssue(image, compatibleImageSizesFor(settings.compatible.endpoint, image));
  if (issue) return { available: false, message: issue };
  const count = referenceImageCount(session);
  const micu = service.shortLabel === "米醋";
  const capability = composerServiceCapabilities(profileValue, visionSettingsValue).image;
  if (session.imageReferenceMode === "conditioned" && count && capability?.references?.supported === false) {
    return { available: false, message: "当前图片模型明确不接收原图；请选择最终生图不垫图或全程纯文字" };
  }
  if (session.imageReferenceMode === "conditioned" && Number.isInteger(capability?.references?.maxItems) && count > capability.references.maxItems) {
    return { available: false, message: `当前有 ${count} 张参考图，所选模型最多读取 ${capability.references.maxItems} 张，请先减少参考` };
  }
  if (count && !image.editsEndpoint) return { available: false, message: "带参考图创建还缺少图片编辑接口" };
  const requestState = normalizeImageGenerationRequest(profileValue, visionSettingsValue, session?.generationParameters);
  if (micu && count && exceedsReferenceImageSize(requestState.parameters.size)) return { available: false, message: "米醋参考图模式最高支持 2K，请调整本轮输出尺寸" };
  return imageParameterAvailability(profileValue, visionSettingsValue, session, `由 ${service.shortLabel} 直接生成并保存到本轮结果`);
}

function imageParameterAvailability(profileValue, settings, session, message) {
  const state = normalizeImageGenerationRequest(profileValue, settings, session?.generationParameters);
  return state.issues.length
    ? { available: false, message: state.issues.join("；") }
    : { available: true, message };
}

export function composerImageEditCapabilities(profileValue, visionSettingsValue = {}) {
  const profile = normalizeComposerAiProfile(profileValue);
  const settings = normalizeVisionSettings(visionSettingsValue);
  if (profile.serviceId === "openai") {
    const available = Boolean(settings.consent && settings.openai.apiKey && (profile.model || settings.openai.model));
    return { whole: available, local: available };
  }
  if (profile.serviceId === "gemini") {
    const capability = composerServiceCapabilities(profile, visionSettingsValue).image;
    return { whole: capability?.generate === true && capability.edit?.whole === true, local: false };
  }
  if (profile.serviceId !== "compatible") return { whole: false, local: false };
  const provider = settings.compatible;
  const verifiedMicu = serviceLabelForEndpoint(provider.endpoint) === "米醋"
    && provider.imageGeneration.protocol === "images_generations"
    && Boolean(provider.imageGeneration.editsEndpoint && provider.imageGeneration.apiKey && provider.imageGeneration.model);
  return { whole: verifiedMicu, local: verifiedMicu };
}

export function selectedComposerService(profileValue, aiSettingsValue, visionSettingsValue) {
  const profile = normalizeComposerAiProfile(profileValue);
  if (profile.serviceId === "unassigned") {
    return {
      serviceId: "unassigned",
      model: "",
      label: "未选择模型",
      shortLabel: "未选择模型",
      configured: false,
      vision: false,
      planning: false,
      reasoning: false,
      imageGeneration: false,
      videoGeneration: false
    };
  }
  const catalog = composerServiceCatalog(aiSettingsValue, visionSettingsValue);
  return catalog.find((item) => item.serviceId === profile.serviceId && item.model === profile.model)
    ?? catalog.find((item) => item.serviceId === profile.serviceId)
    ?? catalog[0];
}

export async function planComposerTurnWithService(input, settingsValue, options = {}) {
  const profile = normalizeComposerAiProfile(input.session?.aiProfile);
  if (profile.serviceId === "unassigned") {
    throw new ComposerServiceError("创作规划未配置，请在 AI 服务的任务路由中选择模型", 422, { retryable: false });
  }
  if (profile.serviceId === "deepseek") return planDeepSeekTurn(input, settingsValue.ai, options);
  const service = requireVisualService(profile, settingsValue.vision, "规划");
  if (service.planning === false) {
    throw new ComposerServiceError(`${service.label} 的所选模型未声明创作规划能力，请重新分配模型`, 422, { retryable: false });
  }
  assertComposerInputBudget(input.session, input.userMessage, input.composerSettings);
  const request = plannerRequestPayload(input.session, input.userMessage, input.composerSettings);
  const systemInstruction = compileAgentPlanningPrompt({
    settings: input.composerSettings,
    targetType: request.targetType,
    routeMode: request.routeMode,
    outputLanguage: request.outputLanguage,
    productionReviewEnabled: request.productionReviewEnabled
  });
  const result = await requestStructured(service, systemInstruction, [{ type: "text", text: JSON.stringify(request) }], {
    signal: options.signal,
    fetchImpl: options.fetchImpl
  });
  const latestUserMessage = [...request.messages].reverse().find((item) => item.role === "user")?.content ?? "";
  const planned = normalizePlannerResult(parseObject(result.content, "创作服务没有返回有效的 Agent 计划"), {
    route: request.routeMode === "auto" ? "compose" : request.routeMode,
    instruction: latestUserMessage
  });
  if (request.routeMode !== "auto" && planned.route !== request.routeMode) {
    throw new ComposerServiceError("Agent 改写了用户手动选择的任务，本次规划未采用", 422, { retryable: false });
  }
  return { ...planned, usage: result.usage, model: result.model, finishReason: result.finishReason };
}

export async function executeComposerTurnWithService(input, settingsValue, preparedImages = [], options = {}) {
  const planningProfile = normalizeComposerAiProfile(input.session?.aiProfile);
  const generationMode = ["create_image", "create_video"].includes(input.session?.outputMode);
  const executionProfile = generationMode
    ? normalizeComposerAiProfile(input.session?.generationAiProfile)
    : planningProfile;
  if (!generationMode && executionProfile.serviceId === "deepseek") {
    assertTextReferencesAvailable(input.session);
    return executeDeepSeekTurn(input, settingsValue.ai, options);
  }
  const service = requireVisualService(executionProfile, settingsValue.vision, "创作");
  if (input.session?.outputMode === "create_video") {
    return generateVideoTurn(input, service, settingsValue, preparedImages, options);
  }
  if (input.session?.outputMode === "create_image") {
    return generateImageTurn(input, service, preparedImages, { ...options, visionSettings: settingsValue.vision, aiSettings: settingsValue.ai });
  }
  return executeVisualTextTurn(input, service, preparedImages, options);
}

async function generateVideoTurn(input, service, settingsValue, preparedImages, options) {
  const visionSettingsValue = settingsValue.vision;
  const generationProfile = input.session?.generationAiProfile ?? input.session?.aiProfile;
  if (["gemini", "openrouter", "minimax", "volcengine"].includes(service.serviceId)) {
    return generateProviderVideoTurn(input, service, settingsValue, preparedImages, options);
  }
  if (service.serviceId === "xai") {
    return generateXaiVideoTurn(input, service, visionSettingsValue, preparedImages, options);
  }
  const remote = normalizeRemoteVideo(options.remoteVideo, "openai");
  const state = remote
    ? { parameters: remote.requestParameters, issues: [] }
    : normalizeVideoGenerationRequest(generationProfile, visionSettingsValue, input.session?.generationParameters);
  if (state.issues.length) throw new ComposerServiceError(state.issues.join("；"), 422, { retryable: false });
  if (preparedImages.length > 1) throw new ComposerServiceError("当前视频服务最多接收 1 张首帧参考图", 422, { retryable: false });
  const settings = normalizeVisionSettings(visionSettingsValue);
  if (!settings.openai.apiKey) throw new ComposerServiceError("恢复视频任务还缺少 OpenAI API Key", 422, { retryable: true });
  let finalPrompt = remote?.finalPrompt || "";
  let remoteId = remote?.remoteId || "";
  let promptResult = null;
  if (!remoteId) {
    promptResult = await executeVisualTextTurn({
      ...input,
      session: { ...input.session, outputMode: "text_prompt" }
    }, service, preparedImages, { ...options, stream: false });
    if (promptResult.kind !== "prompt") throw new ComposerServiceError("视频任务没有生成可提交的最终提示词", 422, { retryable: false });
    finalPrompt = promptResult.finalPrompt;
    const form = new FormData();
    form.append("model", settings.openai.videoGeneration.model);
    form.append("prompt", finalPrompt);
    form.append("size", state.parameters.size);
    form.append("seconds", state.parameters.duration);
    if (preparedImages[0]?.dataUrl) {
      const blob = imageBlobFromDataUrl(preparedImages[0].dataUrl);
      form.append("input_reference", blob, `first-frame.${imageExtension(blob.type) || "png"}`);
    }
    options.onPhase?.("generation");
    const payload = await videoJsonRequest(OPENAI_VIDEOS_ENDPOINT, settings.openai.apiKey, "POST", form, options);
    remoteId = String(payload?.id ?? "").trim();
    if (!remoteId) throw new ComposerServiceError("视频服务没有返回任务编号", 503);
    await options.onRemoteVideo?.({ serviceId: "openai", remoteId, finalPrompt, requestParameters: state.parameters });
  }
  const completed = await pollOpenAiVideo(remoteId, settings.openai.apiKey, options);
  options.onPhase?.("downloading");
  const blob = await videoBlobRequest(`${OPENAI_VIDEOS_ENDPOINT}/${encodeURIComponent(remoteId)}/content`, settings.openai.apiKey, options);
  return {
    route: "compose",
    kind: "video",
    finalPrompt,
    videos: [{ blob, remoteId, responseStatus: String(completed.status ?? "completed") }],
    outputLanguage: promptResult?.outputLanguage || input.session?.outputLanguage || "auto",
    usage: promptResult?.usage || {},
    serviceId: "openai",
    model: String(completed.model ?? settings.openai.videoGeneration.model),
    requestModel: settings.openai.videoGeneration.model,
    requestParameters: state.parameters,
    finishReason: String(completed.status ?? "completed")
  };
}

async function generateXaiVideoTurn(input, service, visionSettingsValue, preparedImages, options) {
  const remote = normalizeRemoteVideo(options.remoteVideo, "xai");
  const state = remote
    ? { parameters: remote.requestParameters, issues: [] }
    : normalizeVideoGenerationRequest(input.session?.generationAiProfile ?? input.session?.aiProfile, visionSettingsValue, input.session?.generationParameters);
  if (state.issues.length) throw new ComposerServiceError(state.issues.join("；"), 422, { retryable: false });
  if (preparedImages.length) {
    throw new ComposerServiceError("当前已验证的 xAI 视频生成接口未启用首帧参考图，请移除图片参考后再生成", 422, { retryable: false });
  }
  const xai = normalizeXaiComposerSettings(visionSettingsValue?.xai);
  if (!xai.apiKey || !xai.videoModel) {
    throw new ComposerServiceError("xAI 视频生成还缺少 API Key 或视频模型", 422, { retryable: false });
  }
  let finalPrompt = remote?.finalPrompt || "";
  let remoteId = remote?.remoteId || "";
  let promptResult = null;
  if (!remoteId) {
    promptResult = await executeVisualTextTurn({
      ...input,
      session: { ...input.session, outputMode: "text_prompt" }
    }, service, [], { ...options, stream: false });
    if (promptResult.kind !== "prompt") throw new ComposerServiceError("视频任务没有生成可提交的最终提示词", 422, { retryable: false });
    finalPrompt = promptResult.finalPrompt;
    options.onPhase?.("generation");
    const submitted = await videoJsonRequest(`${XAI_VIDEOS_ENDPOINT}/generations`, xai.apiKey, "POST", {
      model: xai.videoModel,
      prompt: finalPrompt
    }, options, "xAI 视频服务");
    remoteId = String(submitted?.request_id ?? "").trim();
    if (!remoteId) throw new ComposerServiceError("xAI 视频服务没有返回任务编号", 503);
    await options.onRemoteVideo?.({ serviceId: "xai", remoteId, finalPrompt, requestParameters: state.parameters });
  }
  const completed = await pollXaiVideo(remoteId, xai.apiKey, options);
  const resultUrl = validateXaiVideoResultUrl(completed?.video?.url);
  options.onPhase?.("downloading");
  const blob = await videoBlobRequest(resultUrl, "", options, "xAI 视频成品");
  return {
    route: "compose",
    kind: "video",
    finalPrompt,
    videos: [{ blob, remoteId, responseStatus: String(completed.status ?? "done") }],
    outputLanguage: promptResult?.outputLanguage || input.session?.outputLanguage || "auto",
    usage: promptResult?.usage || {},
    serviceId: "xai",
    model: String(completed.model ?? xai.videoModel),
    requestModel: xai.videoModel,
    requestParameters: state.parameters,
    finishReason: String(completed.status ?? "done")
  };
}

async function generateProviderVideoTurn(input, service, settingsValue, preparedImages, options) {
  const profile = settingsValue.vision?.providerProfiles?.[service.serviceId];
  if (!profile?.apiKey || !profile?.consent) {
    throw new ComposerServiceError(`${profile?.label || service.serviceId} 还缺少 API Key 或媒体发送授权`, 422, { retryable: false });
  }
  const generationProfile = input.session?.generationAiProfile ?? input.session?.aiProfile;
  const capability = composerServiceCapabilities(generationProfile, settingsValue.vision).video;
  const referenceCapability = capability?.inputs?.referenceImages ?? { supported: null, maxItems: null };
  if (preparedImages.length && referenceCapability.supported === false) {
    throw new ComposerServiceError("当前视频模型不接收原图", 422, { retryable: false });
  }
  if (Number.isInteger(referenceCapability.maxItems) && preparedImages.length > referenceCapability.maxItems) {
    throw new ComposerServiceError(`当前服务最多接收 ${referenceCapability.maxItems} 张参考图`, 422, { retryable: false });
  }
  const remote = normalizeRemoteVideo(options.remoteVideo, service.serviceId);
  const state = remote
    ? { parameters: remote.requestParameters, issues: [] }
    : normalizeVideoGenerationRequest(generationProfile, settingsValue.vision, input.session?.generationParameters);
  if (state.issues.length) throw new ComposerServiceError(state.issues.join("；"), 422, { retryable: false });
  const module = createAiProviderModule({
    fetchImpl: options.fetchImpl ?? fetch,
    signal: options.signal,
    timeoutMs: REQUEST_TIMEOUT_MS
  });
  module.configureProvider(profile);
  let finalPrompt = remote?.finalPrompt || "";
  let job = remote?.job || null;
  let promptResult = null;
  if (!job) {
    promptResult = await assembleImagePrompt(input, preparedImages, {
      ...options,
      stream: false,
      visionSettings: settingsValue.vision,
      aiSettings: settingsValue.ai
    });
    if (promptResult.kind !== "prompt") throw new ComposerServiceError("视频任务没有生成可提交的最终提示词", 422, { retryable: false });
    finalPrompt = promptResult.finalPrompt;
    options.onPhase?.("generation");
    job = await module.submit("videoGeneration", {
      provider: profile,
      model: service.model,
      prompt: finalPrompt,
      parameters: {
        ...state.parameters,
        ...(state.parameters.size && !state.parameters.resolution ? { resolution: state.parameters.size } : {})
      },
      images: preparedImages.map((image, index) => ({
        role: index === 0 ? "firstFrame" : "lastFrame",
        url: image.dataUrl
      }))
    });
    await options.onRemoteVideo?.({
      serviceId: service.serviceId,
      remoteId: job.remoteId,
      finalPrompt,
      requestParameters: state.parameters,
      job
    });
  }
  let completed = await module.poll(job);
  while (completed.status !== "completed") {
    await waitForVideoPoll(options.pollIntervalMs, options.signal);
    completed = await module.poll(completed);
  }
  options.onPhase?.("downloading");
  const downloaded = await module.download(completed);
  if (downloaded.blob.size > PORTABLE_LIBRARY_LIMITS.maxVideoBytes) {
    throw new ComposerServiceError("视频成品超过本地素材库单文件上限", 413, { retryable: false });
  }
  return {
    route: "compose",
    kind: "video",
    finalPrompt,
    videos: [{ blob: downloaded.blob, remoteId: job.remoteId, responseStatus: completed.status }],
    outputLanguage: promptResult?.outputLanguage || input.session?.outputLanguage || "auto",
    usage: promptResult?.usage || {},
    serviceId: service.serviceId,
    model: service.model,
    requestModel: service.model,
    requestParameters: state.parameters,
    providerUsage: normalizeChatUsage(completed.providerPayload?.usage),
    cost: Number(completed.providerPayload?.usage?.cost),
    routing: completed.providerPayload?.openrouter_metadata && typeof completed.providerPayload.openrouter_metadata === "object" ? {
      provider: String(completed.providerPayload.openrouter_metadata.provider ?? ""),
      model: String(completed.providerPayload.openrouter_metadata.model ?? service.model)
    } : null,
    finishReason: completed.status
  };
}

async function pollOpenAiVideo(remoteId, apiKey, options) {
  let payload = await videoJsonRequest(`${OPENAI_VIDEOS_ENDPOINT}/${encodeURIComponent(remoteId)}`, apiKey, "GET", null, options);
  while (!["completed", "failed", "canceled"].includes(String(payload?.status ?? "").toLocaleLowerCase("en-US"))) {
    await waitForVideoPoll(options.pollIntervalMs, options.signal);
    payload = await videoJsonRequest(`${OPENAI_VIDEOS_ENDPOINT}/${encodeURIComponent(remoteId)}`, apiKey, "GET", null, options);
  }
  if (String(payload.status).toLocaleLowerCase("en-US") !== "completed") {
    throw new ComposerServiceError(String(payload?.error?.message ?? "视频生成未完成"), 422, { retryable: true });
  }
  return payload;
}

async function pollXaiVideo(remoteId, apiKey, options) {
  let payload = await videoJsonRequest(`${XAI_VIDEOS_ENDPOINT}/${encodeURIComponent(remoteId)}`, apiKey, "GET", null, options, "xAI 视频服务");
  while (!["done", "failed", "canceled"].includes(String(payload?.status ?? "").toLocaleLowerCase("en-US"))) {
    await waitForVideoPoll(options.pollIntervalMs, options.signal);
    payload = await videoJsonRequest(`${XAI_VIDEOS_ENDPOINT}/${encodeURIComponent(remoteId)}`, apiKey, "GET", null, options, "xAI 视频服务");
  }
  if (String(payload.status).toLocaleLowerCase("en-US") !== "done") {
    throw new ComposerServiceError(String(payload?.error?.message ?? "xAI 视频生成未完成"), 422, { retryable: true });
  }
  return payload;
}

async function videoJsonRequest(url, apiKey, method, body, options, label = "OpenAI 视频服务") {
  const response = await videoRequest(url, apiKey, method, body, options, label);
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw responseError(label, response.status, payload, { secrets: [apiKey] });
  return payload;
}

async function videoBlobRequest(url, apiKey, options, label = "OpenAI 视频服务") {
  const response = await videoRequest(url, apiKey, "GET", null, options, label);
  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    if ([404, 410].includes(response.status)) {
      throw new ComposerServiceError("远程视频成品已经过期，需要重新生成", response.status, {
        kind: "expired",
        retryable: true
      });
    }
    throw responseError(label, response.status, payload, { secrets: [apiKey] });
  }
  try {
    return await boundedMediaBlobFromResponse(response, {
      kind: "video",
      maxBytes: PORTABLE_LIBRARY_LIMITS.maxVideoBytes
    });
  } catch (error) {
    throw new ComposerServiceError(error.message || "视频服务没有返回有效视频文件", 503, { retryable: true, cause: error });
  }
}

async function videoRequest(url, apiKey, method, body, options, label = "OpenAI 视频服务") {
  const controller = new AbortController();
  const onAbort = () => controller.abort();
  if (options.signal?.aborted) controller.abort();
  options.signal?.addEventListener("abort", onAbort, { once: true });
  const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const multipart = typeof FormData !== "undefined" && body instanceof FormData;
    const json = body && !multipart;
    return await (options.fetchImpl ?? fetch)(url, {
      method,
      headers: {
        ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
        ...(json ? { "Content-Type": "application/json" } : {})
      },
      ...(body ? { body: json ? JSON.stringify(body) : body } : {}),
      redirect: "error",
      signal: controller.signal
    });
  } catch (error) {
    if (error?.name === "AbortError") throw error;
    throw new ComposerServiceError(`无法连接${label}，请检查网络和权限`, 0, { cause: error });
  } finally {
    clearTimeout(timeoutId);
    options.signal?.removeEventListener("abort", onAbort);
  }
}

function waitForVideoPoll(intervalValue, signal) {
  const delay = Number.isFinite(Number(intervalValue)) ? Math.max(0, Number(intervalValue)) : 2_000;
  if (!delay) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, delay);
    signal?.addEventListener("abort", () => {
      clearTimeout(timer);
      reject(new DOMException("Aborted", "AbortError"));
    }, { once: true });
  });
}

function validateXaiVideoResultUrl(value) {
  let url;
  try { url = new URL(String(value ?? "").trim()); }
  catch { throw new ComposerServiceError("xAI 视频服务没有返回有效的成品地址", 503, { retryable: true }); }
  const hostname = url.hostname.toLocaleLowerCase("en-US");
  if (url.protocol !== "https:" || !(hostname === "x.ai" || hostname.endsWith(".x.ai")) || url.username || url.password) {
    throw new ComposerServiceError("xAI 视频成品地址不属于已授权的 xAI 域名", 422, { retryable: true });
  }
  return url.href;
}

function normalizeRemoteVideo(value, expectedServiceId = "") {
  const serviceId = ["openai", "xai", "gemini", "openrouter", "minimax", "volcengine"].includes(value?.serviceId) ? value.serviceId : "";
  if (!serviceId || (expectedServiceId && serviceId !== expectedServiceId)) return null;
  const remoteId = String(value?.remoteId ?? "").trim();
  const finalPrompt = String(value?.finalPrompt ?? "").trim();
  const requestParameters = Object.fromEntries(["size", "duration", "resolution", "aspectRatio"]
    .map((key) => [key, String(value?.requestParameters?.[key] ?? "").trim()])
    .filter(([, parameter]) => parameter));
  const job = value?.job && typeof value.job === "object" ? structuredClone(value.job) : null;
  return remoteId && finalPrompt ? { serviceId, remoteId, finalPrompt, requestParameters, job } : null;
}

async function executeVisualTextTurn(input, service, preparedImages, options) {
  assertComposerInputBudget(input.session, input.userMessage, input.composerSettings);
  const request = executionRequest(input);
  const route = request.route;
  const systemInstruction = compileAgentExecutionPrompt({
    settings: input.composerSettings,
    route,
    targetType: request.targetType,
    outputLanguage: request.outputLanguage,
    productionReviewEnabled: request.productionReviewEnabled
  });
  const content = multimodalContent(input.session, request, preparedImages, service.protocol);
  const result = await requestText(service, systemInstruction, content, {
    signal: options.signal,
    fetchImpl: options.fetchImpl,
    onDelta: options.onDelta,
    stream: options.stream !== false
  });
  if (route === "compose") {
    return {
      route,
      kind: "prompt",
      finalPrompt: validateGeneratedPrompt(result.content),
      outputLanguage: request.outputLanguage,
      usage: result.usage,
      model: result.model,
      finishReason: result.finishReason
    };
  }
  return {
    route,
    kind: route === "analyze_materials" ? "analysis" : "chat",
    text: result.content,
    outputLanguage: request.outputLanguage,
    usage: result.usage,
    model: result.model,
    finishReason: result.finishReason
  };
}

async function generateImageTurn(input, service, preparedImages, options) {
  const request = executionRequest({ ...input, route: "compose" });
  if (request.targetType !== "image") throw new ComposerServiceError("创建图片只适用于图片创作", 422, { retryable: false });
  const systemInstruction = compileAgentExecutionPrompt({
    settings: input.composerSettings,
    route: "compose",
    targetType: "image",
    outputLanguage: request.outputLanguage,
    productionReviewEnabled: request.productionReviewEnabled
  });
  const imageEdit = normalizeImageEdit(input.imageEdit);
  const referenceMode = ["prompt_only", "text_only"].includes(input.session?.imageReferenceMode)
    ? input.session.imageReferenceMode
    : "conditioned";
  if (imageEdit && referenceMode !== "conditioned") {
    throw new ComposerServiceError("局部修改和扩图必须使用当前底图参与生成", 422, { retryable: false });
  }
  if (service.serviceId === "openrouter") {
    return generateOpenRouterImageTurn(input, service, preparedImages, referenceMode, options);
  }
  if (service.serviceId === "gemini" && imageEdit?.mode === "local") {
    throw new ComposerServiceError("Gemini Interactions 当前不支持上传局部遮罩编辑；请改用整图语义修改", 422, { retryable: false });
  }
  const requestState = normalizeImageGenerationRequest(input.session?.generationAiProfile, options.visionSettings ?? {}, input.session?.generationParameters);
  if (requestState.issues.length) throw new ComposerServiceError(requestState.issues.join("；"), 422, { retryable: false });
  const requestParameters = requestState.parameters;
  const baseContent = multimodalContent(input.session, request, preparedImages, service.protocol);
  const content = imageEdit ? imageEditContent(baseContent, imageEdit, service.protocol) : baseContent;
  if (service.imageGeneration.protocol === "gemini_interactions") {
    return generateGeminiImageTurn(input, service, request, content, referenceMode, imageEdit, requestParameters, preparedImages, options);
  }
  if (service.imageGeneration.protocol === "responses_tool") {
    const instructions = [
      systemInstruction,
      "本轮最终结果是图片。必须调用 image_generation 工具，依据用户要求、手选原图及其职责直接创建图片；不要只返回文字提示词。"
    ].join("\n\n");
    if (referenceMode === "conditioned") {
      const result = imageEdit?.mode === "local"
        ? await requestOpenAiMaskedImage(service, instructions, baseContent, imageEdit, requestParameters, options)
        : await requestResponsesImage(service, instructions, content, request.instruction, requestParameters, options);
      return { route: "compose", kind: "image", serviceId: service.serviceId, outputLanguage: request.outputLanguage, requestParameters, ...result };
    }
    const promptResult = await assembleImagePrompt(input, preparedImages, options);
    const finalPrompt = promptResult.finalPrompt;
    const imageResult = await requestResponsesImage(
      service,
      instructions,
      [{ type: "text", text: finalPrompt }],
      finalPrompt,
      requestParameters,
      options
    );
    return {
      route: "compose",
      kind: "image",
      serviceId: service.serviceId,
      outputLanguage: request.outputLanguage,
      requestParameters,
      ...imageResult,
      finalPrompt,
      usage: addUsage(promptResult.usage, imageResult.usage)
    };
  }
  if (service.imageGeneration.protocol !== "images_generations") {
    throw new ComposerServiceError("当前创作服务没有配置可用的生图接口", 422, { retryable: false });
  }
  const referenceImages = [
    ...(imageEdit ? [{
      label: "当前结果底图",
      dataUrl: imageEdit.baseImage.dataUrl,
      referenceIndex: -1,
      imageIndex: -1,
      editBase: true
    }] : []),
    ...(referenceMode === "conditioned" ? referenceImagesForEdits(input.session, preparedImages) : [])
  ];
  assertImagesEndpointRequest(service, referenceImages, requestParameters);
  const promptResult = await assembleImagePrompt(input, preparedImages, options);
  const finalPrompt = promptResult.finalPrompt;
  const imageResult = await requestImagesEndpoint(service, finalPrompt, referenceImages, requestParameters, options, imageEdit);
  return {
    route: "compose",
    kind: "image",
    finalPrompt,
    images: imageResult.images,
    outputLanguage: request.outputLanguage,
    usage: addUsage(promptResult.usage, imageResult.usage),
    serviceId: service.serviceId,
    model: imageResult.model,
    requestModel: service.imageGeneration.model,
    requestParameters,
    finishReason: imageResult.finishReason
  };
}

async function generateGeminiImageTurn(input, service, request, conditionedContent, referenceMode, imageEdit, requestParameters, preparedImages, options) {
  let finalPrompt = String(request.instruction ?? "").trim();
  let content = conditionedContent;
  if (!imageEdit && referenceMode !== "conditioned") {
    const promptResult = await assembleImagePrompt(input, preparedImages, options);
    finalPrompt = promptResult.finalPrompt;
    content = [{ type: "text", text: finalPrompt }];
  }
  const imageBlocks = content.filter((item) => item.type === "image");
  const maximum = service.provider
    ? modelReferenceCapability(service.provider, service.imageGeneration.model, { supported: null, maxItems: null }).maxItems
    : null;
  if (Number.isInteger(maximum) && imageBlocks.length > maximum) {
    throw new ComposerServiceError(`所选 Gemini 模型最多读取 ${maximum} 张参考图，请先减少参考`, 422, {
      kind: "reference_limit",
      retryable: false,
      referenceLimit: { actual: imageBlocks.length, maximum }
    });
  }
  const interactionInput = imageBlocks.length
    ? content.map((item) => item.type === "image" ? geminiImageInput(item.dataUrl) : { type: "text", text: item.text })
    : finalPrompt;
  const responseFormat = { type: "image" };
  if (requestParameters.aspectRatio) responseFormat.aspect_ratio = requestParameters.aspectRatio;
  if (requestParameters.imageSize) responseFormat.image_size = requestParameters.imageSize;
  const body = {
    model: service.imageGeneration.model,
    input: interactionInput,
    response_format: responseFormat
  };
  const response = await requestRaw(
    service.imageGeneration.endpoint,
    "",
    body,
    options,
    IMAGE_REQUEST_TIMEOUT_MS,
    "Google Gemini 图片服务",
    { "x-goog-api-key": service.imageGeneration.apiKey }
  );
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw responseError("Google Gemini 图片服务", response.status, payload, {
    secrets: [service.imageGeneration.apiKey]
  });
  const parsed = geminiInteractionImages(payload);
  if (!parsed.images.length) {
    throw new ComposerServiceError("Google Gemini 图片服务完成请求但没有返回有效图片", 422, { retryable: false });
  }
  return {
    route: "compose",
    kind: "image",
    finalPrompt: parsed.text || finalPrompt || "创建图片",
    images: parsed.images,
    outputLanguage: request.outputLanguage,
    usage: normalizeGeminiInteractionsUsage(payload.usage),
    serviceId: "gemini",
    model: String(payload.model ?? service.imageGeneration.model),
    requestModel: service.imageGeneration.model,
    requestParameters,
    finishReason: String(payload.status ?? "completed")
  };
}

function geminiImageInput(dataUrl) {
  const match = String(dataUrl ?? "").match(/^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/=]+)$/i);
  if (!match) throw new ComposerServiceError("Gemini 参考图数据无效，本次没有发送不完整参考", 422, { retryable: false });
  return { type: "image", mime_type: match[1].toLocaleLowerCase("en-US"), data: match[2] };
}

function geminiInteractionImages(payload) {
  const blocks = (Array.isArray(payload?.steps) ? payload.steps : [])
    .filter((step) => step?.type === "model_output")
    .flatMap((step) => Array.isArray(step.content) ? step.content : []);
  if (payload?.output_image && (!payload.output_image.type || payload.output_image.type === "image")) {
    const outputImage = { type: "image", ...payload.output_image };
    const alreadyIncluded = blocks.some((block) => block?.type === "image"
      && block.data === outputImage.data && block.mime_type === outputImage.mime_type);
    if (!alreadyIncluded) blocks.push(outputImage);
  }
  const images = [];
  const texts = [];
  for (const block of blocks) {
    if (block?.type === "text" && String(block.text ?? "").trim()) {
      texts.push(String(block.text).trim());
      continue;
    }
    if (block?.type !== "image") continue;
    const encoded = String(block.data ?? "").trim();
    const mimeType = String(block.mime_type ?? "").trim().toLocaleLowerCase("en-US");
    if (!encoded || !/^image\/(?:png|jpeg|webp|heic|heif|gif|bmp|tiff)$/.test(mimeType)) continue;
    try {
      images.push({ blob: base64Image(encoded, mimeType), mimeType, source: "base64" });
    } catch {}
  }
  return { images, text: texts.join("\n").trim() };
}

async function generateOpenRouterImageTurn(input, service, preparedImages, referenceMode, options) {
  if (input.imageEdit?.mode === "local") throw new ComposerServiceError("所选 OpenRouter 模型未声明局部遮罩编辑能力", 422, { retryable: false });
  if (referenceMode === "prompt_only") {
    throw new ComposerServiceError("当前 OpenRouter 独立图片接口不能在提示词整理阶段读取原图", 422, { retryable: false });
  }
  const promptResult = await assembleImagePrompt(input, preparedImages, options);
  const finalPrompt = promptResult.finalPrompt;
  const references = referenceMode === "conditioned" ? referenceImagesForEdits(input.session, preparedImages) : [];
  const body = {
    model: service.imageGeneration.model,
    prompt: finalPrompt,
    ...(references.length ? { input_references: references.map((image) => ({ type: "image_url", image_url: { url: image.dataUrl } })) } : {})
  };
  const response = await requestRaw(service.imageGeneration.endpoint, service.apiKey, body, options, IMAGE_REQUEST_TIMEOUT_MS, "OpenRouter 图片服务");
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw responseError("OpenRouter 图片服务", response.status, payload, { secrets: [service.apiKey] });
  const images = (Array.isArray(payload.data) ? payload.data : []).flatMap((item) => {
    const encoded = String(item?.b64_json ?? "").trim();
    if (!encoded) return [];
    const mimeType = String(item?.media_type ?? "image/png").trim();
    const blob = imageBlobFromDataUrl(`data:${mimeType};base64,${encoded}`);
    return [{ blob, mimeType, source: "base64" }];
  });
  if (!images.length) throw new ComposerServiceError("OpenRouter 没有返回有效图片", 503, { retryable: true });
  return {
    route: "compose", kind: "image", finalPrompt, images,
    outputLanguage: promptResult.outputLanguage || input.session?.outputLanguage || "auto",
    usage: addUsage(promptResult.usage, normalizeChatUsage(payload.usage)),
    serviceId: "openrouter",
    model: String(payload.model ?? service.imageGeneration.model),
    requestModel: service.imageGeneration.model,
    requestParameters: {},
    providerUsage: normalizeChatUsage(payload.usage),
    cost: Number(payload?.usage?.cost),
    routing: payload?.openrouter_metadata && typeof payload.openrouter_metadata === "object" ? {
      provider: String(payload.openrouter_metadata.provider ?? ""),
      model: String(payload.openrouter_metadata.model ?? payload.model ?? "")
    } : null,
    finishReason: "completed"
  };
}

async function assembleImagePrompt(input, preparedImages, options) {
  const promptInput = {
    ...input,
    session: { ...input.session, outputMode: "text_prompt" }
  };
  const profile = normalizeComposerAiProfile(input.session?.aiProfile);
  if (profile.serviceId === "deepseek") {
    assertTextReferencesAvailable(input.session);
    const result = await executeDeepSeekTurn(promptInput, options.aiSettings, { ...options, stream: false });
    if (result.kind !== "prompt") throw new ComposerServiceError("图片任务没有生成可提交的最终提示词", 422, { retryable: false });
    return result;
  }
  const service = requireVisualService(profile, options.visionSettings, "整理生图提示词");
  const result = await executeVisualTextTurn(promptInput, service, preparedImages, { ...options, stream: false });
  if (result.kind !== "prompt") throw new ComposerServiceError("图片任务没有生成可提交的最终提示词", 422, { retryable: false });
  return result;
}

function executionRequest(input) {
  const request = plannerRequestPayload(input.session, input.userMessage, input.composerSettings);
  const instruction = String(input.instruction ?? "").trim()
    || [...request.messages].reverse().find((item) => item.role === "user")?.content
    || "";
  return {
    ...request,
    route: ["compose", "analyze_materials", "chat"].includes(input.route) ? input.route : "chat",
    instruction,
    references: (input.session?.referenceSnapshots ?? []).map((item) => ({
      alias: item.alias,
      referenceKind: item.referenceKind,
      referenceText: item.referenceKind === "video_sources" ? item.referenceText || "" : item.originalText || "",
      sources: item.referenceKind === "video_sources"
        ? (item.referenceSources ?? []).map(({ kind, label }) => ({ kind, label }))
        : [],
      imageCount: item.imageRefs?.length || 0
    }))
  };
}

function multimodalContent(session, request, preparedImages, protocol) {
  const content = [{ type: "text", text: JSON.stringify(request) }];
  const images = new Map((Array.isArray(preparedImages) ? preparedImages : []).map((item) => [item.visualId, item]));
  for (const reference of session?.referenceSnapshots ?? []) {
    if (reference.referenceKind === "video_sources") continue;
    const textOnly = session?.imageReferenceMode === "text_only";
    const savedReconstructions = (reference.assets ?? []).map((asset, index) => String(asset?.reconstructionPrompt ?? "").trim()
      ? `[图片${index + 1}重建提示词]\n${String(asset.reconstructionPrompt).trim()}` : "").filter(Boolean).join("\n\n");
    const referenceText = textOnly
      ? savedReconstructions || String(reference.referenceText ?? "").trim()
      : [String(reference.originalText ?? "").trim(), savedReconstructions].filter(Boolean).join("\n\n");
    const referenceLabel = textOnly
      ? "[已保存的 V2 高保真提示词]"
      : savedReconstructions ? "[案例已有提示词与 V2 高保真提示词]" : "[案例已有提示词]";
    content.push({ type: "text", text: `${reference.alias}${referenceText ? `\n${referenceLabel}\n${referenceText}` : "\n[纯图片案例]"}` });
    if (textOnly) continue;
    (reference.imageRefs ?? []).forEach((imageRef, index) => {
      const image = images.get(imageRef.visualId);
      if (!image?.dataUrl) throw new ComposerServiceError(`${reference.alias}/图片${index + 1} 读取失败，本次没有发送不完整参考`, 422, { retryable: true });
      content.push({ type: "text", text: `${reference.alias}/图片${index + 1}` });
      content.push({ type: "image", dataUrl: image.dataUrl, detail: "high", protocol });
    });
  }
  return content;
}

async function requestStructured(service, instructions, content, options = {}) {
  const jsonContent = [{ type: "text", text: "Return valid json." }, ...content];
  if (service.protocol === "responses") {
    const body = responsesBody(service, instructions, jsonContent, false);
    body.text = { format: { type: "json_object" } };
    return parseResponsesPayload(await requestJson(service, body, options), service);
  }
  const body = chatBody(service, instructions, jsonContent, false);
  if (service.structuredOutput !== "prompt_only") body.response_format = { type: "json_object" };
  return parseChatPayload(await requestJson(service, body, options), service);
}

async function requestText(service, instructions, content, options = {}) {
  if (options.stream === false) {
    const body = service.protocol === "responses"
      ? responsesBody(service, instructions, content, false)
      : chatBody(service, instructions, content, false);
    const payload = await requestJson(service, body, options);
    return service.protocol === "responses" ? parseResponsesPayload(payload, service) : parseChatPayload(payload, service);
  }
  const body = service.protocol === "responses"
    ? responsesBody(service, instructions, content, true)
    : chatBody(service, instructions, content, true);
  const response = await requestRaw(service.endpoint, service.apiKey, body, options, REQUEST_TIMEOUT_MS, service.label);
  const contentType = String(response.headers?.get?.("content-type") ?? "");
  if (!contentType.includes("text/event-stream")) {
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw responseError(service.label, response.status, payload, { secrets: [service.apiKey] });
    const result = service.protocol === "responses" ? parseResponsesPayload(payload, service) : parseChatPayload(payload, service);
    options.onDelta?.(result.content, result.content);
    return result;
  }
  if (!response.ok) throw responseError(service.label, response.status, await response.json().catch(() => ({})), { secrets: [service.apiKey] });
  return service.protocol === "responses"
    ? readResponsesSse(response, service, options.onDelta)
    : readChatSse(response, service, options.onDelta);
}

async function requestResponsesImage(service, instructions, content, fallbackPrompt, requestParameters, options, imageTool = { type: "image_generation" }) {
  const body = responsesBody(service, instructions, content, false);
  body.tools = [{ ...imageTool, ...requestParameters }];
  const payload = await requestJson(service, body, options, IMAGE_REQUEST_TIMEOUT_MS);
  const calls = (Array.isArray(payload?.output) ? payload.output : []).filter((item) => item?.type === "image_generation_call");
  const images = calls.flatMap((call) => call.result ? [{ blob: base64Image(call.result, "image/png"), revisedPrompt: String(call.revised_prompt ?? "").trim() }] : []);
  if (!images.length) throw new ComposerServiceError(`${service.label} 没有返回生成图片`, 422, { retryable: true });
  const text = String(payload.output_text ?? extractResponsesText(payload) ?? "").trim();
  const revisedPrompt = images.find((item) => item.revisedPrompt)?.revisedPrompt || text;
  return {
    finalPrompt: revisedPrompt || String(fallbackPrompt ?? "").trim() || "创建图片",
    images,
    usage: normalizeResponsesUsage(payload.usage),
    model: String(payload.model ?? ""),
    requestModel: service.model,
    finishReason: "completed"
  };
}

async function requestOpenAiMaskedImage(service, instructions, content, imageEdit, requestParameters, options) {
  const uploadedIds = [];
  try {
    const baseFileId = await uploadOpenAiImage(service, imageEdit.baseImage.dataUrl, "edit-base", options);
    uploadedIds.push(baseFileId);
    const maskFileId = await uploadOpenAiImage(service, imageEdit.mask.dataUrl, "edit-mask", options);
    uploadedIds.push(maskFileId);
    const maskedContent = [
      content[0],
      { type: "image", fileId: baseFileId, detail: "high", protocol: service.protocol },
      { type: "text", text: imageEditInstruction(imageEdit) },
      ...content.slice(1)
    ];
    return await requestResponsesImage(
      service,
      instructions,
      maskedContent,
      imageEdit.modification,
      requestParameters,
      options,
      { type: "image_generation", input_image_mask: { file_id: maskFileId } }
    );
  } finally {
    const cleanupOptions = { fetchImpl: options.fetchImpl };
    await Promise.allSettled(uploadedIds.map((fileId) => deleteOpenAiFile(service, fileId, cleanupOptions)));
  }
}

async function requestImagesEndpoint(service, prompt, referenceImages, requestParameters, options, imageEdit = null) {
  const image = service.imageGeneration;
  if (referenceImages.length) return requestImageEdits(service, prompt, referenceImages, requestParameters, options, imageEdit);
  const body = {
    model: image.model,
    prompt,
    n: 1,
    ...requestParameters,
    ...(service.serviceId === "xai" ? {} : { response_format: "b64_json" })
  };
  const response = await requestRaw(image.endpoint, image.apiKey, body, options, IMAGE_REQUEST_TIMEOUT_MS, service.label);
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw responseError(service.label, response.status, payload, {
    credentialHint: credentialHint(image.apiKey),
    secrets: [image.apiKey]
  });
  const values = Array.isArray(payload?.data) ? payload.data : [];
  const images = [];
  for (const item of values) {
    if (item?.b64_json) images.push({ blob: base64Image(item.b64_json, "image/png"), revisedPrompt: String(item.revised_prompt ?? "").trim() });
    else if (item?.url) images.push({ blob: await downloadGeneratedImage(item.url, options), revisedPrompt: String(item.revised_prompt ?? "").trim() });
  }
  if (!images.length) throw new ComposerServiceError(`${service.label} 生图接口没有返回图片`, 422, { retryable: true });
  return {
    images,
    usage: normalizeChatUsage(payload.usage),
    model: String(payload.model ?? ""),
    finishReason: "completed"
  };
}

async function requestImageEdits(service, prompt, referenceImages, requestParameters, options, imageEdit = null) {
  const image = service.imageGeneration;
  const body = new FormData();
  body.append("model", image.model);
  body.append("prompt", [
    "参考图按以下顺序上传，请严格保持每张图片与对应职责的关系：",
    referenceImages.map((item, index) => `图${index + 1} = ${item.label}`).join("\n"),
    "最终提示词：",
    prompt
  ].join("\n"));
  body.append("n", "1");
  for (const [key, value] of Object.entries(requestParameters)) body.append(key, value);
  body.append("response_format", "b64_json");
  referenceImages.forEach((item, index) => {
    const blob = imageBlobFromDataUrl(item.dataUrl);
    const stem = item.editBase ? "edit-base" : `reference-${item.referenceIndex + 1}-image-${item.imageIndex + 1}`;
    const field = referenceImages.length === 1 ? "image" : "image[]";
    body.append(field, blob, `${stem}.${imageExtension(blob.type) || `image-${index + 1}`}`);
  });
  if (imageEdit?.mode === "local") {
    const maskBlob = imageBlobFromDataUrl(imageEdit.mask.dataUrl);
    body.append("mask", maskBlob, "edit-mask.png");
  }
  assertComposerRequestBudget([{ content: prompt }]);
  const response = await requestRaw(image.editsEndpoint, image.apiKey, body, options, IMAGE_REQUEST_TIMEOUT_MS, service.label);
  return parseImagesEndpointResponse(service, response, options);
}

async function parseImagesEndpointResponse(service, response, options) {
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw responseError(service.label, response.status, payload, {
    credentialHint: credentialHint(service.imageGeneration?.apiKey),
    secrets: [service.imageGeneration?.apiKey]
  });
  const values = Array.isArray(payload?.data) ? payload.data : [];
  const images = [];
  for (const item of values) {
    if (item?.b64_json) images.push({ blob: base64Image(item.b64_json, "image/png"), revisedPrompt: String(item.revised_prompt ?? "").trim() });
    else if (item?.url) images.push({ blob: await downloadGeneratedImage(item.url, options), revisedPrompt: String(item.revised_prompt ?? "").trim() });
  }
  if (!images.length) throw new ComposerServiceError(`${service.label} 生图接口没有返回图片`, 422, { retryable: true });
  return {
    images,
    usage: normalizeChatUsage(payload.usage),
    model: String(payload.model ?? ""),
    finishReason: "completed"
  };
}

function responsesBody(service, instructions, content, stream) {
  return {
    model: service.model,
    store: false,
    stream,
    instructions,
    input: [{ role: "user", content: content.map((item) => item.type === "image"
      ? { type: "input_image", ...(item.fileId ? { file_id: item.fileId } : { image_url: item.dataUrl }), detail: item.detail }
      : { type: "input_text", text: item.text }) }],
    ...(service.reasoningEffort ? { reasoning: { effort: service.reasoningEffort } } : {})
  };
}

function chatBody(service, instructions, content, stream) {
  return {
    model: service.model,
    stream,
    messages: [
      { role: "system", content: instructions },
      { role: "user", content: content.map((item) => item.type === "image"
        ? chatImagePart(service, item)
        : { type: "text", text: item.text }) }
    ]
  };
}

function chatImagePart(service, item) {
  if (service.mediaInput?.imageBase64 === "raw") {
    const raw = String(item.dataUrl ?? "").split(",", 2)[1] || "";
    return { type: "image_url", image_url: { url: raw } };
  }
  return { type: "image_url", image_url: { url: item.dataUrl, detail: item.detail } };
}

async function requestJson(service, body, options = {}, timeoutMs = REQUEST_TIMEOUT_MS) {
  const response = await requestRaw(service.endpoint, service.apiKey, body, options, timeoutMs, service.label);
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw responseError(service.label, response.status, payload, { secrets: [service.apiKey] });
  return payload;
}

async function requestRaw(url, apiKey, body, options, timeoutMs, label, extraHeaders = {}) {
  const multipart = typeof FormData !== "undefined" && body instanceof FormData;
  if (!multipart) assertComposerRequestBudget(textMessagesForBudget(body));
  const controller = new AbortController();
  let timedOut = false;
  const onAbort = () => controller.abort();
  if (options.signal?.aborted) controller.abort();
  options.signal?.addEventListener("abort", onAbort, { once: true });
  const requestedTimeout = Object.hasOwn(options ?? {}, "timeoutMs") ? options.timeoutMs : timeoutMs;
  const timeoutId = Number.isFinite(requestedTimeout) && requestedTimeout > 0
    ? setTimeout(() => { timedOut = true; controller.abort(); }, requestedTimeout)
    : null;
  try {
    return await (options.fetchImpl ?? fetch)(url, {
      method: "POST",
      headers: { ...(multipart ? {} : { "Content-Type": "application/json" }), ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}), ...extraHeaders },
      body: multipart ? body : JSON.stringify(body),
      redirect: "error",
      signal: controller.signal
    });
  } catch (error) {
    if (timedOut) throw new ComposerServiceError(`${label} 请求超时，本次结果未保存`, 408, { cause: error });
    if (error?.name === "AbortError") throw error;
    throw new ComposerServiceError(`无法连接 ${label}，请检查网络、地址和权限`, 0, { cause: error });
  } finally {
    if (timeoutId !== null) clearTimeout(timeoutId);
    options.signal?.removeEventListener("abort", onAbort);
  }
}

function requireVisualService(profileValue, visionSettingsValue, action) {
  const profile = normalizeComposerAiProfile(profileValue);
  const settings = normalizeVisionSettings(visionSettingsValue);
  if (profile.serviceId === "xai") {
    const xai = normalizeXaiComposerSettings(visionSettingsValue?.xai);
    if (!xai.apiKey || !(profile.model || xai.textModel)) throw new ComposerServiceError("请先完成 xAI API Key 和文字模型配置", 422, { retryable: false });
    if (!xai.mediaConsent) throw new ComposerServiceError(`请先确认：主动${action}时会把本轮文字与所选图片发送到 xAI`, 422, { retryable: false });
    return {
      serviceId: "xai",
      label: "xAI",
      protocol: "chat_completions",
      endpoint: XAI_CHAT_ENDPOINT,
      apiKey: xai.apiKey,
      model: profile.model || xai.textModel,
      reasoningEffort: "",
      imageGeneration: {
        protocol: "images_generations",
        endpoint: XAI_IMAGE_GENERATIONS_ENDPOINT,
        editsEndpoint: "",
        apiKey: xai.apiKey,
        model: xai.imageModel,
        sizes: [],
        qualities: [],
        parametersOptional: true
      },
      videoGeneration: {
        protocol: "xai_videos",
        endpoint: XAI_VIDEOS_ENDPOINT,
        apiKey: xai.apiKey,
        model: xai.videoModel
      }
    };
  }
  const registryProvider = visionSettingsValue?.providerProfiles?.[profile.serviceId];
  if (registryProvider && !["openai", "xai", "custom-media"].includes(profile.serviceId)) {
    const provider = registryProvider;
    const model = profile.model;
    const modelCapability = getAiModelCapability(profile.serviceId, model);
    if (!provider?.apiKey || !model) throw new ComposerServiceError(`请先完成 ${provider?.label || profile.serviceId} 的 API Key 和所选模型配置`, 422, { retryable: false });
    if (!provider.consent) throw new ComposerServiceError(`请先确认：主动${action}时会把本轮文字与所选图片发送到 ${provider.label || profile.serviceId}`, 422, { retryable: false });
    const planning = model === provider.models?.creativePlanning || providerModelSupports(provider, model, "creativePlanning");
    const chatCompatible = ["openrouter", "gemini"].includes(profile.serviceId);
    const endpoint = profile.serviceId === "openrouter"
      ? `${String(provider.endpoint).replace(/\/$/, "")}/chat/completions`
      : profile.serviceId === "gemini"
        ? `${String(provider.endpoint).replace(/\/$/, "")}/v1beta/openai/chat/completions`
        : provider.endpoint;
    return {
      serviceId: profile.serviceId,
      label: provider.label || profile.serviceId,
      protocol: chatCompatible ? "chat_completions" : provider.protocol,
      endpoint,
      apiKey: provider.apiKey,
      model,
      planning,
      reasoningEffort: "",
      structuredOutput: modelCapability?.structuredOutput ?? provider.structuredOutput,
      mediaInput: { ...(provider.mediaInput ?? {}), ...(modelCapability?.mediaInput ?? {}) },
      provider,
      imageGeneration: profile.serviceId === "openrouter" ? {
        protocol: "openrouter_images",
        endpoint: `${String(provider.endpoint).replace(/\/$/, "")}/images`,
        model
      } : profile.serviceId === "gemini" ? {
        protocol: "gemini_interactions",
        endpoint: geminiInteractionsEndpoint(provider.endpoint),
        apiKey: provider.apiKey,
        model
      } : null
    };
  }
  if (!settings.consent) throw new ComposerServiceError(`请先确认：主动${action}时会把所选案例图片和文字发送到当前视觉服务`, 422, { retryable: false });
  if (profile.serviceId === "openai") {
    if (!settings.openai.apiKey || !settings.openai.model) throw new ComposerServiceError("请先完成 OpenAI 视觉服务配置", 422, { retryable: false });
    return {
      serviceId: "openai",
      label: "OpenAI",
      protocol: "responses",
      endpoint: OPENAI_RESPONSES_ENDPOINT,
      apiKey: settings.openai.apiKey,
      model: profile.model || settings.openai.model,
      reasoningEffort: profile.thinking ? "high" : "",
      imageGeneration: { protocol: "responses_tool" }
    };
  }
  const provider = settings.compatible;
  if (!provider.endpoint || !provider.model || (!provider.apiKey && !isLoopback(provider.endpoint))) {
    throw new ComposerServiceError("请先完成兼容视觉服务配置", 422, { retryable: false });
  }
  assertCredentialOrigin(provider.endpoint, provider.apiKey, provider.credentialOrigin);
  const image = provider.imageGeneration;
  if (image.protocol === "images_generations") {
    if (image.endpoint) assertCredentialOrigin(image.endpoint, image.apiKey, image.credentialOrigin);
    if (image.editsEndpoint) assertCredentialOrigin(image.editsEndpoint, image.apiKey, image.credentialOrigin);
  }
  return {
    serviceId: "compatible",
    label: serviceLabelForEndpoint(provider.endpoint),
    protocol: provider.protocol,
    endpoint: provider.endpoint,
    apiKey: provider.apiKey,
    model: profile.model || provider.model,
    reasoningEffort: profile.thinking && compatibleReasoningSupported(provider) ? "high" : "",
    imageGeneration: image.protocol === "responses_tool"
      ? { protocol: "responses_tool" }
      : {
          protocol: image.protocol,
          endpoint: image.endpoint,
          editsEndpoint: image.editsEndpoint,
          apiKey: image.apiKey,
          model: image.model,
          sizes: compatibleImageSizesFor(provider.endpoint, image),
          qualities: structuredClone(image.qualities),
          referenceImages: compatibleImageReferenceCapability(visionSettingsValue, image.model)
        }
  };
}

function assertTextReferencesAvailable(session) {
  const unavailable = (session?.referenceSnapshots ?? []).filter((item) => !String(item.referenceText ?? "").trim() && item.imageRefs?.length);
  if (unavailable.length) {
    throw new ComposerServiceError(`${unavailable.map((item) => item.alias).join("、")} 只有原图，DeepSeek 无法读取；请切换 OpenAI、米醋或兼容视觉服务`, 422, { retryable: false });
  }
}

function compatibleConfigured(vision) {
  const provider = vision.compatible;
  return Boolean(vision.consent && provider.endpoint && provider.model && (provider.apiKey || isLoopback(provider.endpoint)));
}

function responsesImageCapability(configured, references = { supported: true, maxItems: null }) {
  return {
    generate: configured,
    references,
    edit: { whole: true, local: true },
    parameters: [
      imageParameter("size", "画幅与分辨率", RESPONSES_IMAGE_SIZES, "auto"),
      imageParameter("quality", "质量", RESPONSES_IMAGE_QUALITIES, "auto")
    ]
  };
}

function openAiVideoConfigured(settings) {
  const video = settings.openai.videoGeneration;
  return Boolean(settings.consent && settings.openai.apiKey && video.model && video.sizes.length && video.durations.length);
}

function openAiVideoCapability(settings) {
  const video = settings.openai.videoGeneration;
  const configured = openAiVideoConfigured(settings);
  return {
    generate: configured,
    protocol: "openai_videos",
    inputs: {
      text: true,
      firstFrame: true,
      lastFrame: false,
      referenceImages: { supported: true, maxItems: 1 },
      referenceVideo: false,
      edit: false,
      extend: false,
      motion: false
    },
    parameters: [
      imageParameter("size", "画幅与分辨率", video.sizes.map(imageSizeOption), video.sizes[0]),
      imageParameter("duration", "时长", video.durations.map((value) => ({ value, label: `${value} 秒` })), video.durations[0])
    ]
  };
}

function xaiVideoCapability(configured, xai) {
  return {
    generate: configured && Boolean(xai.videoModel),
    protocol: "xai_videos",
    inputs: {
      text: true,
      firstFrame: false,
      lastFrame: false,
      referenceImages: { supported: false, maxItems: null },
      referenceVideo: false,
      edit: false,
      extend: false,
      motion: false
    },
    // The public REST schema currently documents the model and prompt as the
    // stable creation contract. Optional output controls are not exposed until
    // the account capability can be validated rather than guessed.
    parameters: []
  };
}

function providerModelDescriptor(profile, modelId) {
  const id = String(modelId ?? "").trim();
  return (profile?.discoveredModels ?? []).find((model) => model.id === id) ?? null;
}

function providerModelSupports(profile, modelId, taskId) {
  const id = String(modelId ?? "").trim();
  const descriptor = providerModelDescriptor(profile, id);
  if (descriptor) return descriptor.tasks?.includes(taskId) === true;
  return profile?.capabilities?.includes(taskId) === true
    && String(profile?.models?.[taskId] ?? "").trim() === id;
}

function compatibleImageReferenceCapability(visionSettingsValue, modelId) {
  const profile = visionSettingsValue?.providerProfiles?.["custom-media"]
    ?? visionSettingsValue?.providerProfiles?.custom;
  return modelReferenceCapability(profile, modelId, { supported: null, maxItems: null });
}

function modelReferenceCapability(profile, modelId, fallback = { supported: null, maxItems: null }) {
  const value = providerModelDescriptor(profile, modelId)?.referenceImages;
  const maximum = value?.maxItems === null || value?.maxItems === undefined || value?.maxItems === ""
    ? null
    : Number(value.maxItems);
  const supported = value?.supported === true ? true : value?.supported === false ? false : fallback.supported;
  return {
    supported,
    maxItems: supported !== false && Number.isInteger(maximum) && maximum > 0 ? maximum : fallback.maxItems,
    source: ["declared", "verified", "observed_error"].includes(value?.source) ? value.source : "unknown"
  };
}

function providerVideoParameters(descriptor) {
  const parameters = [];
  if (descriptor?.supportedResolutions?.length) {
    parameters.push(imageParameter("size", "分辨率", descriptor.supportedResolutions.map((value) => ({ value, label: value })), descriptor.supportedResolutions[0]));
  }
  if (descriptor?.supportedAspectRatios?.length) {
    parameters.push(imageParameter("aspectRatio", "画幅比例", descriptor.supportedAspectRatios.map((value) => ({ value, label: value })), descriptor.supportedAspectRatios[0]));
  }
  return parameters;
}

function providerImageParameters(descriptor) {
  const parameters = [];
  const supported = new Set(descriptor?.supportedParameters ?? []);
  if (supported.has("aspect_ratio") && descriptor?.supportedAspectRatios?.length) {
    parameters.push(imageParameter("aspectRatio", "画幅比例", descriptor.supportedAspectRatios.map((value) => ({ value, label: value })), descriptor.supportedAspectRatios[0]));
  }
  if (supported.has("image_size") && descriptor?.supportedResolutions?.length) {
    parameters.push(imageParameter("imageSize", "图片尺寸", descriptor.supportedResolutions.map((value) => ({ value, label: value })), descriptor.supportedResolutions[0]));
  }
  return parameters;
}

function geminiInteractionsEndpoint(value) {
  try { return new URL("/v1beta/interactions", value).href; }
  catch { throw new ComposerServiceError("Gemini 官方接口地址无效", 422, { retryable: false }); }
}

function imageParameter(key, label, options, defaultValue) {
  return {
    key,
    label,
    defaultValue: String(defaultValue ?? "").trim(),
    options: options.map((option) => ({ ...option }))
  };
}

function imageSizeOption(value) {
  const size = String(value ?? "").trim();
  const match = size.match(/^(\d+)\s*[x×]\s*(\d+)$/i);
  if (!match) return { value: size, label: size, aspectRatio: "", resolution: size };
  const width = Number(match[1]);
  const height = Number(match[2]);
  const divisor = greatestCommonDivisor(width, height);
  return {
    value: size,
    label: `${width === height ? "方形" : width > height ? "横向" : "纵向"} · ${width}×${height}`,
    aspectRatio: `${width / divisor}:${height / divisor}`,
    resolution: `${width}x${height}`
  };
}

function greatestCommonDivisor(left, right) {
  let a = Math.max(1, Math.trunc(Math.abs(left)));
  let b = Math.max(1, Math.trunc(Math.abs(right)));
  while (b) [a, b] = [b, a % b];
  return a;
}

function compatibleImageConfigured(provider) {
  const image = provider.imageGeneration;
  if (image.protocol === "responses_tool") return compatibleConfigured({ consent: true, compatible: provider });
  return !compatibleImageConfigurationIssue(image, compatibleImageSizesFor(provider.endpoint, image));
}

function compatibleImageConfigurationIssue(image = {}, supportedSizes = image.sizes) {
  if (image.protocol !== "images_generations") return "当前服务没有配置可用的生图协议";
  if (!image.endpoint) return "创建图片还缺少生图接口";
  if (!image.apiKey && !isLoopback(image.endpoint)) return "创建图片还缺少生图 API Key";
  if (!image.model) return "创建图片还缺少生图模型";
  if (!image.parametersOptional && (!Array.isArray(supportedSizes) || !supportedSizes.length)) return "创建图片还缺少服务支持的尺寸选项";
  return "";
}

function normalizeXaiComposerSettings(value = {}) {
  return {
    apiKey: String(value?.apiKey ?? "").trim(),
    textModel: String(value?.textModel ?? "").trim(),
    imageModel: String(value?.imageModel ?? "").trim(),
    videoModel: String(value?.videoModel ?? "").trim(),
    mediaConsent: value?.mediaConsent === true
  };
}

function compatibleReasoningSupported(provider = {}) {
  if (provider.protocol !== "responses") return false;
  return Boolean(compatibleProviderPresetForEndpoint(provider.endpoint));
}

function referenceImageCount(session) {
  return (session?.referenceSnapshots ?? []).reduce((total, item) => total + (item.imageRefs?.length || 0), 0);
}

function exceedsReferenceImageSize(value) {
  const size = String(value ?? "").trim();
  if (/4k/i.test(size)) return true;
  const match = size.match(/^(\d+)\s*[x×]\s*(\d+)$/i);
  return Boolean(match && (Number(match[1]) > 2048 || Number(match[2]) > 2048));
}

function referenceImagesForEdits(session, preparedImages) {
  const imagesById = new Map((Array.isArray(preparedImages) ? preparedImages : []).map((item) => [item.visualId, item]));
  return (session?.referenceSnapshots ?? []).flatMap((reference, referenceIndex) =>
    (reference.imageRefs ?? []).map((imageRef, imageIndex) => {
      const image = imagesById.get(imageRef.visualId);
      if (!image?.dataUrl) throw new ComposerServiceError(`${reference.alias}/图片${imageIndex + 1} 读取失败，本次没有发送不完整参考`, 422, { retryable: true });
      return { label: `${reference.alias}/图片${imageIndex + 1}`, dataUrl: image.dataUrl, referenceIndex, imageIndex };
    }));
}

function assertImagesEndpointRequest(service, referenceImages, requestParameters = {}) {
  const image = service.imageGeneration;
  const issue = compatibleImageConfigurationIssue(image);
  if (issue) throw new ComposerServiceError(issue, 422, { retryable: false });
  const maxItems = image.referenceImages?.maxItems;
  if (Number.isInteger(maxItems) && referenceImages.length > maxItems) {
    const includesEditBase = referenceImages.some((item) => item.editBase);
    throw new ComposerServiceError(includesEditBase
      ? `所选模型的 ${maxItems} 图上限包含当前底图；最多 ${maxItems} 张，请先减少原始参考`
      : `所选模型最多读取 ${maxItems} 张参考图，请先减少参考`, 422, {
        retryable: false,
        kind: "reference_limit",
        referenceLimit: { actual: referenceImages.length, maximum: maxItems }
      });
  }
  if (!referenceImages.length) return;
  if (!image.editsEndpoint) throw new ComposerServiceError("带参考图创建还缺少图片编辑接口", 422, { retryable: false });
  if (service.label === "米醋" && exceedsReferenceImageSize(requestParameters.size)) throw new ComposerServiceError("米醋参考图模式最高支持 2K，请调整本轮输出尺寸", 422, { retryable: false });
}

function imageEditContent(content, imageEdit, protocol) {
  return [
    content[0],
    { type: "text", text: imageEditInstruction(imageEdit) },
    { type: "image", dataUrl: imageEdit.baseImage.dataUrl, detail: "high", protocol },
    ...content.slice(1)
  ];
}

function imageEditInstruction(imageEdit) {
  return [
    "[当前结果底图，优先级最高]",
    imageEdit.originalPrompt ? `原提示词：${imageEdit.originalPrompt}` : "",
    `修改范围：${imageEdit.mode === "local" ? "只修改透明遮罩区域" : "整张图片"}`,
    `修改要求：${imageEdit.modification}`,
    "没有被修改要求覆盖的画面内容应保持稳定。"
  ].filter(Boolean).join("\n");
}

function normalizeImageEdit(value) {
  if (!value) return null;
  const mode = value.mode === "local" ? "local" : "whole";
  const baseDataUrl = String(value.baseImage?.dataUrl ?? "").trim();
  const modification = String(value.modification ?? "").trim();
  if (!baseDataUrl || !modification) throw new ComposerServiceError("图片编辑缺少底图或修改要求", 422, { retryable: false });
  const maskDataUrl = String(value.mask?.dataUrl ?? "").trim();
  if (mode === "local" && !maskDataUrl) throw new ComposerServiceError("局部修改缺少有效遮罩", 422, { retryable: false });
  return {
    mode,
    parentVisualId: String(value.parentVisualId ?? value.baseImage?.visualId ?? "").trim(),
    originalPrompt: String(value.originalPrompt ?? "").trim(),
    modification,
    baseImage: { visualId: String(value.baseImage?.visualId ?? "").trim(), dataUrl: baseDataUrl },
    mask: mode === "local" ? { dataUrl: maskDataUrl } : null
  };
}

async function uploadOpenAiImage(service, dataUrl, stem, options) {
  const body = new FormData();
  const blob = imageBlobFromDataUrl(dataUrl);
  body.append("purpose", "vision");
  body.append("file", blob, `${stem}.${imageExtension(blob.type) || "png"}`);
  const response = await requestOpenAiFile(service, OPENAI_FILES_ENDPOINT, "POST", body, options);
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw responseError(service.label, response.status, payload, { secrets: [service.apiKey] });
  const fileId = String(payload?.id ?? "").trim();
  if (!fileId) throw new ComposerServiceError("OpenAI 没有返回临时图片文件 ID", 503);
  return fileId;
}

async function deleteOpenAiFile(service, fileId, options) {
  const response = await requestOpenAiFile(service, `${OPENAI_FILES_ENDPOINT}/${encodeURIComponent(fileId)}`, "DELETE", null, options);
  if (!response.ok) throw new ComposerServiceError("OpenAI 临时图片清理失败", response.status);
}

async function requestOpenAiFile(service, url, method, body, options) {
  const controller = new AbortController();
  const onAbort = () => controller.abort();
  if (options.signal?.aborted) controller.abort();
  options.signal?.addEventListener("abort", onAbort, { once: true });
  const timeoutId = setTimeout(() => controller.abort(), IMAGE_REQUEST_TIMEOUT_MS);
  try {
    return await (options.fetchImpl ?? fetch)(url, {
      method,
      headers: { Authorization: `Bearer ${service.apiKey}` },
      ...(body ? { body } : {}),
      redirect: "error",
      signal: controller.signal
    });
  } finally {
    clearTimeout(timeoutId);
    options.signal?.removeEventListener("abort", onAbort);
  }
}

function serviceLabelForEndpoint(value) {
  return compatibleProviderPresetForEndpoint(value)?.label || "兼容服务";
}

function isLoopback(value) {
  try { return ["localhost", "127.0.0.1", "[::1]"].includes(new URL(value).hostname.toLocaleLowerCase("en-US")); }
  catch { return false; }
}

function assertCredentialOrigin(endpoint, apiKey, credentialOrigin) {
  if (!apiKey) return;
  let origin;
  try { origin = new URL(endpoint).origin; }
  catch { throw new ComposerServiceError("兼容接口地址无效", 422, { retryable: false }); }
  if (origin !== credentialOrigin) throw new ComposerServiceError("兼容接口域名已变化，请重新填写该服务的 API Key", 422, { retryable: false });
}

function parseResponsesPayload(payload, service) {
  const content = String(payload?.output_text ?? extractResponsesText(payload) ?? "").trim();
  if (!content) throw new ComposerServiceError(`${service.label} 没有返回可用内容`, 503);
  return {
    content,
    usage: normalizeResponsesUsage(payload.usage),
    model: String(payload?.model ?? service.model),
    finishReason: String(payload?.status ?? "completed")
  };
}

function parseChatPayload(payload, service) {
  const choice = payload?.choices?.[0];
  const content = String(choice?.message?.content ?? "").trim();
  if (!content) throw new ComposerServiceError(`${service.label} 没有返回可用内容`, 503);
  return {
    content,
    usage: normalizeChatUsage(payload.usage),
    model: String(payload?.model ?? service.model),
    finishReason: String(choice?.finish_reason ?? "")
  };
}

async function readResponsesSse(response, service, onDelta = () => undefined) {
  return readSse(response, (event, state) => {
    if (event.type === "response.output_text.delta") {
      state.content += String(event.delta ?? "");
      onDelta(String(event.delta ?? ""), state.content);
    }
    if (event.type === "response.completed") {
      state.model = String(event.response?.model ?? state.model);
      state.usage = normalizeResponsesUsage(event.response?.usage);
      state.finishReason = String(event.response?.status ?? "completed");
    }
  }, service);
}

async function readChatSse(response, service, onDelta = () => undefined) {
  return readSse(response, (event, state) => {
    const choice = event?.choices?.[0];
    const delta = String(choice?.delta?.content ?? "");
    if (delta) {
      state.content += delta;
      onDelta(delta, state.content);
    }
    if (choice?.finish_reason) state.finishReason = String(choice.finish_reason);
    if (event?.usage) state.usage = normalizeChatUsage(event.usage);
    if (event?.model) state.model = String(event.model);
  }, service);
}

async function readSse(response, applyEvent, service) {
  if (!response?.body?.getReader) throw new ComposerServiceError(`${service.label} 没有返回流式内容`, 503);
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  const state = { content: "", usage: emptyUsage(), model: service.model, finishReason: "" };
  let buffer = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      if (!line.startsWith("data:")) continue;
      const data = line.slice(5).trim();
      if (!data || data === "[DONE]") continue;
      try { applyEvent(JSON.parse(data), state); }
      catch {}
    }
  }
  if (!state.content.trim()) throw new ComposerServiceError(`${service.label} 没有返回完整内容`, 503);
  return state;
}

function extractResponsesText(payload) {
  for (const output of Array.isArray(payload?.output) ? payload.output : []) {
    for (const item of Array.isArray(output?.content) ? output.content : []) {
      if (item?.type === "output_text" && item.text) return item.text;
    }
  }
  return "";
}

function normalizeResponsesUsage(value = {}) {
  return {
    promptTokens: finite(value.input_tokens),
    completionTokens: finite(value.output_tokens),
    totalTokens: finite(value.total_tokens),
    cacheHitTokens: finite(value.input_tokens_details?.cached_tokens),
    cacheMissTokens: 0
  };
}

function normalizeGeminiInteractionsUsage(value = {}) {
  return {
    promptTokens: finite(value.total_input_tokens),
    completionTokens: finite(value.total_output_tokens),
    totalTokens: finite(value.total_tokens),
    cacheHitTokens: finite(value.total_cached_tokens),
    cacheMissTokens: Math.max(0, finite(value.total_input_tokens) - finite(value.total_cached_tokens))
  };
}

function normalizeChatUsage(value = {}) {
  return {
    promptTokens: finite(value.prompt_tokens),
    completionTokens: finite(value.completion_tokens),
    totalTokens: finite(value.total_tokens),
    cacheHitTokens: finite(value.prompt_cache_hit_tokens),
    cacheMissTokens: finite(value.prompt_cache_miss_tokens)
  };
}

function emptyUsage() {
  return { promptTokens: 0, completionTokens: 0, totalTokens: 0, cacheHitTokens: 0, cacheMissTokens: 0 };
}

function addUsage(left = {}, right = {}) {
  return Object.fromEntries(Object.keys(emptyUsage()).map((key) => [key, finite(left[key]) + finite(right[key])]));
}

function finite(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? Math.round(number) : 0;
}

function parseObject(content, message) {
  const cleaned = String(content ?? "").trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  try {
    const parsed = JSON.parse(cleaned);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error();
    return parsed;
  } catch {
    throw new ComposerServiceError(message, 422, { retryable: true });
  }
}

function textMessagesForBudget(body) {
  if (Array.isArray(body.messages)) return body.messages.map((item) => ({ content: typeof item.content === "string" ? item.content : JSON.stringify(item.content.filter?.((part) => part.type === "text") ?? []) }));
  if (typeof body.input === "string") return [{ content: body.input }];
  if (Array.isArray(body.input) && body.input.some((item) => item?.type === "text" || item?.type === "image")) {
    return body.input.filter((item) => item?.type === "text").map((item) => ({ content: item.text ?? "" }));
  }
  return [
    { content: body.instructions || "" },
    { content: JSON.stringify((body.input ?? []).map((item) => ({ ...item, content: item.content?.filter?.((part) => part.type === "input_text") }))) }
  ];
}

function responseError(label, status, payload, options = {}) {
  const detail = redactSecrets(String(payload?.error?.message ?? payload?.message ?? "").trim(), options.secrets);
  const referenceLimit = referenceLimitFromMessage(detail);
  const micuRouting = micuImageRoutingError(label, detail, options.credentialHint);
  if (micuRouting) {
    return new ComposerServiceError(micuRouting, status, {
      kind: "configuration",
      retryable: false
    });
  }
  return new ComposerServiceError(`${label} 请求失败${detail ? `：${detail}` : `（HTTP ${status}）`}`, status, referenceLimit ? {
    kind: "reference_limit",
    retryable: false,
    referenceLimit
  } : {});
}

function redactSecrets(value, secrets = []) {
  return (Array.isArray(secrets) ? secrets : []).reduce((text, secretValue) => {
    const secret = String(secretValue ?? "").trim();
    return secret ? text.split(secret).join("[已隐藏凭据]") : text;
  }, String(value ?? ""));
}

function micuImageRoutingError(label, detail, keyHint = "") {
  if (label !== "米醋" || !/gpt-image-2(?:-pro)?/i.test(detail) || !/(?:无可用渠道|distributor)/i.test(detail)) return "";
  const group = detail.match(/分组\s+([^\s]+)\s+下模型/i)?.[1] ?? "";
  const requestId = detail.match(/request id:\s*([^)\s]+)/i)?.[1] ?? "";
  const sentCredential = keyHint ? `本轮发送的是独立图片生成 Key（尾号 ${keyHint}），` : "本轮发送的是独立图片生成 Key，";
  const currentGroup = group ? `米醋服务器将它识别为 ${group} 分组，` : "米醋服务器判定它的分组与模型不匹配，";
  const supportReference = requestId ? `（request id: ${requestId}）` : "";
  return `米醋请求未进入生图渠道：${sentCredential}${currentGroup}而 gpt-image-2 需要 vip_2_image（Image2）。PromptDirector 不能改变服务端 Key 分组；模型目录里能看到 gpt-image-2 也不代表这把 Key 已获生图授权。请在米醋后台核对这把 Key 的分组，或把以上 request id 交给米醋客服确认。这与本轮分辨率和参考图模式无关。${supportReference}`;
}

function credentialHint(value) {
  const key = String(value ?? "").trim();
  return key.length >= 4 ? key.slice(-4) : "";
}

function referenceLimitFromMessage(value) {
  const text = String(value ?? "").trim();
  const comparison = text.match(/(?:reference images?|参考图)[^\d]{0,40}(\d+)\s*>\s*(\d+)\s*(?:max|maximum|最多)/i)
    ?? text.match(/(\d+)\s*>\s*(\d+)\s*(?:max|maximum)/i);
  if (comparison) return { actual: Number(comparison[1]), maximum: Number(comparison[2]) };
  const maximum = text.match(/(?:reference images?|参考图)[^\d]{0,40}(?:max(?:imum)?|最多|上限)[^\d]{0,12}(\d+)/i);
  return maximum ? { actual: null, maximum: Number(maximum[1]) } : null;
}

function normalizeReferenceLimit(value) {
  const maximum = Number(value?.maximum);
  const actual = Number(value?.actual);
  if (!Number.isInteger(maximum) || maximum <= 0) return null;
  return { maximum, actual: Number.isInteger(actual) && actual >= 0 ? actual : null };
}

function serviceErrorKind(status) {
  if (status === 0) return "network";
  if (status === 408) return "timeout";
  if (status === 429) return "rate_limit";
  if (status >= 500) return "service";
  return "response";
}

function base64Image(value, mimeType) {
  let bytes;
  try {
    const binary = atob(String(value ?? ""));
    bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  } catch {
    throw new ComposerServiceError("生图服务返回了无效图片数据", 422, { retryable: true });
  }
  if (!bytes.length || bytes.length > PORTABLE_LIBRARY_LIMITS.maxImageBytes) {
    throw new ComposerServiceError("生成图片为空或超过本地单图容量上限", 422, { retryable: false });
  }
  return new Blob([bytes], { type: mimeType });
}

function imageBlobFromDataUrl(value) {
  const match = String(value ?? "").match(/^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/=]+)$/i);
  if (!match) throw new ComposerServiceError("参考图数据无效，本次没有发送不完整参考", 422, { retryable: true });
  return base64Image(match[2], match[1].toLocaleLowerCase("en-US"));
}

function imageExtension(mimeType) {
  if (mimeType === "image/jpeg") return "jpg";
  if (mimeType === "image/png") return "png";
  if (mimeType === "image/webp") return "webp";
  return "";
}

async function downloadGeneratedImage(value, options = {}) {
  let url;
  try { url = new URL(String(value ?? "")); }
  catch { throw new ComposerServiceError("生图服务返回了无效图片地址", 422, { retryable: true }); }
  if (url.protocol !== "https:") throw new ComposerServiceError("生图服务返回的图片地址不是 HTTPS", 422, { retryable: false });
  options.onPhase?.("downloading");
  try {
    const blob = await fetchBoundedMedia(url, {
      kind: "image",
      maxBytes: PORTABLE_LIBRARY_LIMITS.maxImageBytes,
      timeoutMs: IMAGE_REQUEST_TIMEOUT_MS,
      signal: options.signal,
      fetchImpl: options.fetchImpl,
      accept: "image/png,image/jpeg,image/webp"
    });
    if (!["image/png", "image/jpeg", "image/webp"].includes(blob.type)) {
      throw new Error("生成服务返回了暂不支持的图片格式");
    }
    return blob;
  } catch (error) {
    if (error instanceof ComposerServiceError) throw error;
    throw new ComposerServiceError(error.message || "生成图片下载失败", 422, { retryable: false, cause: error });
  }
}
