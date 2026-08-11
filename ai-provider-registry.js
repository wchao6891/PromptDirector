import { normalizeAiSettings } from "./deepseek.js";
import { normalizeAiServiceProfiles, normalizeAiTaskRoutes } from "./ai-task-routing.js";
import { normalizeVisionSettings } from "./vision.js";

export const AI_ASSIGNMENT_TASKS = Object.freeze([
  { id: "textTags", label: "文字标签" },
  { id: "skillExtraction", label: "Skill 提炼" },
  { id: "creativePlanning", label: "创作规划" },
  { id: "imageAnalysis", label: "图片分析" },
  { id: "videoAnalysis", label: "视频分析" },
  { id: "imageGeneration", label: "图片生成" },
  { id: "videoGeneration", label: "视频生成" }
]);

const PROVIDER_LABELS = Object.freeze({
  deepseek: "DeepSeek",
  openai: "OpenAI",
  gemini: "Google Gemini",
  xai: "xAI",
  openrouter: "OpenRouter",
  minimax: "MiniMax",
  volcengine: "火山引擎",
  custom: "自定义兼容服务",
  "custom-text": "自定义兼容服务（文字）",
  "custom-media": "自定义兼容服务（图片与生成）"
});

const DEFAULT_ASSIGNMENTS = Object.freeze({
  textTags: "deepseek",
  skillExtraction: "deepseek",
  creativePlanning: "deepseek",
  imageAnalysis: "openai",
  videoAnalysis: "gemini",
  imageGeneration: "openai",
  videoGeneration: "openai"
});

const BUILT_IN_CAPABILITIES = Object.freeze({
  deepseek: ["textTags", "skillExtraction", "creativePlanning"],
  openai: ["textTags", "skillExtraction", "creativePlanning", "imageAnalysis", "imageGeneration", "videoGeneration"],
  gemini: ["textTags", "skillExtraction", "creativePlanning", "imageAnalysis", "videoAnalysis", "videoGeneration"],
  xai: ["textTags", "skillExtraction", "creativePlanning", "imageAnalysis", "imageGeneration", "videoGeneration"],
  minimax: ["videoGeneration"],
  volcengine: ["videoGeneration"],
  "custom-text": ["textTags", "skillExtraction", "creativePlanning"],
  "custom-media": ["imageAnalysis", "imageGeneration"],
  custom: ["textTags", "skillExtraction", "creativePlanning", "imageAnalysis", "imageGeneration", "videoGeneration"]
});

const DEFAULT_PROVIDER_PROFILES = Object.freeze({
  deepseek: { endpoint: "https://api.deepseek.com/chat/completions", protocol: "chat_completions" },
  openai: { endpoint: "https://api.openai.com/v1/responses", protocol: "responses" },
  gemini: { endpoint: "https://generativelanguage.googleapis.com", protocol: "gemini" },
  xai: { endpoint: "https://api.x.ai/v1", protocol: "xai" },
  openrouter: { endpoint: "https://openrouter.ai/api/v1", protocol: "openrouter" },
  minimax: { endpoint: "https://api.minimaxi.com/v1", protocol: "minimax_videos" },
  volcengine: { endpoint: "https://ark.cn-beijing.volces.com/api/v3", protocol: "ark_videos" }
});

export function migrateLegacyAiConfiguration(value = {}) {
  const text = normalizeAiSettings(value.aiSettings);
  const vision = normalizeVisionSettings(value.visionSettings);
  const services = normalizeAiServiceProfiles(value.aiServiceProfiles);
  const routes = normalizeAiTaskRoutes(value.aiTaskRoutes);
  const providers = {
    deepseek: provider("deepseek", {
      endpoint: "https://api.deepseek.com/chat/completions",
      apiKey: text.apiKey,
      consent: text.consent,
      models: textTaskModels(text.analysisModel)
    }),
    openai: provider("openai", {
      endpoint: "https://api.openai.com/v1/responses",
      apiKey: vision.openai.apiKey,
      consent: vision.consent,
      models: {
        ...textTaskModels(vision.openai.model),
        imageAnalysis: vision.openai.model,
        imageGeneration: vision.openai.model,
        videoGeneration: vision.openai.videoGeneration.model
      },
      videoGeneration: vision.openai.videoGeneration
    }),
    gemini: provider("gemini", {
      endpoint: "https://generativelanguage.googleapis.com",
      apiKey: services.gemini.apiKey,
      models: { videoAnalysis: services.gemini.model }
    }),
    xai: provider("xai", {
      endpoint: "https://api.x.ai/v1",
      apiKey: services.xai.apiKey,
      consent: services.xai.mediaConsent,
      models: {
        ...textTaskModels(services.xai.textModel),
        imageAnalysis: services.xai.imageModel,
        imageGeneration: services.xai.imageModel,
        videoGeneration: services.xai.videoModel
      }
    })
  };
  if (text.compatible.endpoint || text.compatible.model || text.compatible.apiKey) {
    providers["custom-text"] = provider("custom-text", {
      endpoint: text.compatible.endpoint,
      apiKey: text.compatible.apiKey,
      consent: text.consent,
      protocol: "chat_completions",
      models: textTaskModels(text.compatible.model)
    });
  }
  const compatibleMedia = vision.compatible;
  if (compatibleMedia.endpoint || compatibleMedia.model || compatibleMedia.apiKey || compatibleMedia.imageGeneration.endpoint) {
    providers["custom-media"] = provider("custom-media", {
      endpoint: compatibleMedia.endpoint,
      apiKey: compatibleMedia.apiKey,
      consent: vision.consent,
      protocol: compatibleMedia.protocol,
      models: {
        imageAnalysis: compatibleMedia.model,
        imageGeneration: compatibleMedia.imageGeneration.model
      },
      imageGeneration: compatibleMedia.imageGeneration
    });
  }
  const registry = normalizeAiProviderRegistry({ providers });
  const textProvider = (routeId) => routes[routeId].serviceId === "xai"
    ? "xai"
    : text.activeProvider === "compatible" ? "custom-text" : "deepseek";
  const imageProvider = routes["image-analysis"].serviceId === "xai"
    ? "xai"
    : vision.activeProvider === "compatible" ? "custom-media" : "openai";
  const generationProvider = (taskId) => routes[taskId].serviceId === "xai"
    ? "xai"
    : vision.activeProvider === "compatible" ? "custom-media" : "openai";
  const assignments = normalizeAiTaskAssignments({
    textTags: assignment(textProvider("text-tags"), routes["text-tags"].model || text.analysisModel, registry),
    skillExtraction: assignment(textProvider("skill-extraction"), routes["skill-extraction"].model || text.analysisModel, registry),
    creativePlanning: assignment(textProvider("creative-planning"), routes["creative-planning"].model || text.analysisModel, registry),
    imageAnalysis: assignment(imageProvider, routes["image-analysis"].model, registry),
    videoAnalysis: assignment("gemini", routes["video-analysis"].model, registry),
    imageGeneration: assignment(generationProvider("image-generation"), routes["image-generation"].model, registry),
    videoGeneration: assignment(generationProvider("video-generation"), routes["video-generation"].model, registry)
  }, registry);
  return { registry, assignments };
}

export function normalizeAiProviderRegistry(value = {}) {
  const source = value?.providers && typeof value.providers === "object" ? value.providers : {};
  const providers = {};
  for (const id of ["deepseek", "openai", "gemini", "xai", "openrouter", "minimax", "volcengine", "custom", "custom-text", "custom-media"]) {
    if (!source[id] && id === "custom") continue;
    providers[id] = provider(id, { ...(DEFAULT_PROVIDER_PROFILES[id] ?? {}), ...(source[id] ?? {}) });
  }
  return { version: 3, providers };
}

export function normalizeAiTaskAssignments(value = {}, registryValue = {}) {
  const registry = normalizeAiProviderRegistry(registryValue);
  return Object.fromEntries(AI_ASSIGNMENT_TASKS.map((task) => {
    const fallback = ["textTags", "skillExtraction", "creativePlanning"].includes(task.id) ? value?.text : null;
    const candidate = value?.[task.id] ?? fallback;
    const source = candidate && typeof candidate === "object" ? candidate : {};
    const providerId = clean(source.providerId) || DEFAULT_ASSIGNMENTS[task.id];
    const profile = registry.providers[providerId];
    return [task.id, { providerId, model: clean(source.model) || clean(profile?.models?.[task.id]) }];
  }));
}

export function publicAiProviderRegistry(value = {}) {
  const registry = normalizeAiProviderRegistry(value);
  return {
    version: registry.version,
    providers: Object.fromEntries(Object.entries(registry.providers).map(([id, profile]) => [id, {
      id,
      label: profile.label,
      endpoint: profile.endpoint,
      protocol: profile.protocol,
      models: structuredClone(profile.models),
      capabilities: [...profile.capabilities],
      discoveredModels: structuredClone(profile.discoveredModels),
      discovery: structuredClone(profile.discovery),
      configured: profile.capabilities.some((taskId) => providerConfiguredForTask(profile, taskId)),
      credentialConfigured: profile.credentialConfigured,
      consent: profile.consent,
      imageGeneration: publicCapabilitySettings(profile.imageGeneration),
      videoGeneration: publicCapabilitySettings(profile.videoGeneration)
    }]))
  };
}

export function availableAiProvidersForTask(taskId, value = {}) {
  const registry = normalizeAiProviderRegistry(value);
  return Object.values(registry.providers).filter((profile) =>
    profile.capabilities.includes(taskId) && providerConfiguredForTask(profile, taskId)
  ).map((profile) => ({ id: profile.id, label: profile.label, model: profile.models[taskId] }));
}

export function resolveAiProviderAssignment(taskId, registryValue = {}, assignmentsValue = {}) {
  if (!AI_ASSIGNMENT_TASKS.some((task) => task.id === taskId)) throw new Error("未知 AI 任务");
  const registry = normalizeAiProviderRegistry(registryValue);
  const raw = assignmentsValue?.[taskId] ?? {};
  const providerId = clean(raw.providerId) || DEFAULT_ASSIGNMENTS[taskId];
  const profile = registry.providers[providerId];
  if (!profile) throw new Error("所选 AI 服务不存在");
  const taskLabel = AI_ASSIGNMENT_TASKS.find((task) => task.id === taskId)?.label || taskId;
  if (!profile.capabilities.includes(taskId)) throw new Error(`${profile.label} 不支持${taskLabel}`);
  const model = clean(raw.model) || profile.models[taskId];
  const discovered = profile.discoveredModels.find((item) => item.id === model);
  if (discovered?.status === "unavailable") throw new Error(`${profile.label} 中已选模型已下架或当前账号不可用，请重新选择`);
  if (!providerConfiguredForTask(profile, taskId) || !model) throw new Error(`${profile.label} 尚未完成${taskLabel}配置`);
  return { taskId, providerId, provider: profile.label, model };
}

export function mergeAiProviderRegistry(currentValue = {}, incomingValue = {}) {
  const current = normalizeAiProviderRegistry(currentValue);
  const incoming = incomingValue?.providers && typeof incomingValue.providers === "object" ? incomingValue.providers : {};
  const providers = { ...current.providers };
  for (const [id, update] of Object.entries(incoming)) {
    const before = providers[id] ?? provider(id);
    const endpointChanged = Object.hasOwn(update ?? {}, "endpoint") && clean(update.endpoint) !== before.endpoint;
    const imageUpdate = update?.imageGeneration && typeof update.imageGeneration === "object" ? update.imageGeneration : null;
    const imageEndpointChanged = imageUpdate && Object.hasOwn(imageUpdate, "endpoint")
      && clean(imageUpdate.endpoint) !== clean(before.imageGeneration?.endpoint);
    const imageGeneration = imageUpdate ? {
      ...(before.imageGeneration ?? {}),
      ...imageUpdate,
      apiKey: imageUpdate.clearApiKey ? "" : clean(imageUpdate.apiKey)
        || (imageEndpointChanged ? "" : clean(before.imageGeneration?.apiKey)),
      ...(imageEndpointChanged ? { credentialOrigin: "" } : {})
    } : before.imageGeneration;
    providers[id] = provider(id, {
      ...before,
      ...update,
      apiKey: update?.clearApiKey ? "" : clean(update?.apiKey) || (endpointChanged ? "" : before.apiKey),
      credentialConfigured: update?.clearApiKey || endpointChanged ? false : before.credentialConfigured,
      models: { ...before.models, ...(update?.models ?? {}) },
      imageGeneration
    });
  }
  return normalizeAiProviderRegistry({ providers });
}

function provider(id, value = {}) {
  const legacyTextModel = clean(value?.models?.text);
  const models = Object.fromEntries(AI_ASSIGNMENT_TASKS.map((task) => [
    task.id,
    clean(value?.models?.[task.id]) || (["textTags", "skillExtraction", "creativePlanning"].includes(task.id) ? legacyTextModel : "")
  ]));
  const discoveredModels = normalizeDiscoveredModels(value?.discoveredModels);
  const declaredTasks = new Set(discoveredModels.flatMap((model) => model.tasks));
  const configuredTasks = configuredCustomCapabilities(id, value, models);
  const capabilities = [...new Set([
    ...(BUILT_IN_CAPABILITIES[id] ?? []),
    ...configuredTasks,
    ...AI_ASSIGNMENT_TASKS.map((task) => task.id).filter((taskId) => value?.capabilities?.includes(taskId)),
    ...declaredTasks
  ])];
  return {
    id,
    label: clean(value?.label) || PROVIDER_LABELS[id] || "自定义兼容服务",
    endpoint: clean(value?.endpoint),
    protocol: clean(value?.protocol) || "native",
    apiKey: clean(value?.apiKey),
    credentialConfigured: Object.hasOwn(value ?? {}, "apiKey")
      ? Boolean(clean(value?.apiKey) || isLoopback(value?.endpoint))
      : value?.credentialConfigured === true || isLoopback(value?.endpoint),
    consent: value?.consent === true,
    models,
    capabilities,
    discoveredModels,
    discovery: normalizeDiscovery(value?.discovery),
    imageGeneration: value?.imageGeneration && typeof value.imageGeneration === "object" ? structuredClone(value.imageGeneration) : null,
    videoGeneration: value?.videoGeneration && typeof value.videoGeneration === "object" ? structuredClone(value.videoGeneration) : null
  };
}

function normalizeDiscoveredModels(values) {
  return (Array.isArray(values) ? values : []).map((item) => ({
    id: clean(item?.id),
    name: clean(item?.name) || clean(item?.id),
    status: clean(item?.status) || "available",
    confidence: ["declared", "protocol_inferred", "manual_unverified"].includes(item?.confidence) ? item.confidence : "manual_unverified",
    source: clean(item?.source),
    tasks: AI_ASSIGNMENT_TASKS.map((task) => task.id).filter((taskId) => item?.tasks?.includes(taskId)),
    inputModalities: cleanArray(item?.inputModalities),
    outputModalities: cleanArray(item?.outputModalities),
    supportedParameters: cleanArray(item?.supportedParameters),
    parameterDescriptors: item?.parameterDescriptors && typeof item.parameterDescriptors === "object" ? structuredClone(item.parameterDescriptors) : null,
    supportedResolutions: cleanArray(item?.supportedResolutions),
    supportedAspectRatios: cleanArray(item?.supportedAspectRatios),
    referenceImages: normalizeReferenceImages(item?.referenceImages),
    contextLength: Number(item?.contextLength) > 0 ? Number(item.contextLength) : null,
    pricing: item?.pricing && typeof item.pricing === "object" ? structuredClone(item.pricing) : null
  })).filter((item) => item.id);
}

function configuredCustomCapabilities(id, value, models) {
  if (id === "custom-text") {
    return ["textTags", "skillExtraction", "creativePlanning"].filter((taskId) => Boolean(models[taskId]));
  }
  if (id === "custom-media") {
    return [
      ...(models.imageAnalysis && value?.endpoint ? ["imageAnalysis"] : []),
      ...(models.imageGeneration && (value?.imageGeneration?.endpoint || value?.imageGeneration?.protocol === "responses_tool")
        ? ["imageGeneration"] : [])
    ];
  }
  return [];
}

function normalizeReferenceImages(value) {
  const source = value && typeof value === "object" ? value : {};
  const maxItems = source.maxItems === null || source.maxItems === undefined || source.maxItems === ""
    ? null
    : Number(source.maxItems);
  const supported = source.supported === true ? true : source.supported === false ? false : null;
  return {
    supported,
    maxItems: supported !== false && Number.isInteger(maxItems) && maxItems > 0 ? maxItems : null,
    source: ["declared", "verified", "observed_error", "unknown"].includes(source.source) ? source.source : "unknown",
    observedAt: clean(source.observedAt)
  };
}

function normalizeDiscovery(value) {
  return {
    discoveredAt: clean(value?.discoveredAt),
    source: clean(value?.source),
    etag: clean(value?.etag),
    cacheControl: clean(value?.cacheControl),
    error: clean(value?.error)
  };
}

function cleanArray(value) {
  return [...new Set((Array.isArray(value) ? value : []).map(clean).filter(Boolean))];
}

function assignment(providerId, model) {
  return { providerId, model: clean(model) };
}

function textTaskModels(model) {
  return {
    textTags: clean(model),
    skillExtraction: clean(model),
    creativePlanning: clean(model)
  };
}

function providerConfiguredForTask(profile, taskId) {
  const endpoint = taskId === "imageGeneration" ? profile.imageGeneration?.endpoint || profile.endpoint : profile.endpoint;
  const dedicatedImageCredential = taskId === "imageGeneration" && requiresDedicatedImageCredential(profile);
  const key = taskId === "imageGeneration"
    ? profile.imageGeneration?.apiKey || (dedicatedImageCredential ? "" : profile.apiKey)
    : profile.apiKey;
  const model = profile.models[taskId];
  const discovered = profile.discoveredModels.find((item) => item.id === model);
  const savedCredential = dedicatedImageCredential
    ? Boolean(profile.imageGeneration?.apiKey || profile.imageGeneration?.credentialConfigured)
    : profile.credentialConfigured;
  return Boolean(model && discovered?.status !== "unavailable" && (key || savedCredential || isLoopback(endpoint)));
}

function requiresDedicatedImageCredential(profile = {}) {
  if (profile.imageGeneration?.protocol !== "images_generations") return false;
  try {
    const endpoint = profile.imageGeneration?.endpoint || profile.endpoint;
    return new URL(endpoint).hostname.toLocaleLowerCase("en-US").endsWith("micuapi.ai");
  } catch {
    return false;
  }
}

function publicCapabilitySettings(value) {
  if (!value || typeof value !== "object") return null;
  const { apiKey: _apiKey, credentialOrigin: _credentialOrigin, ...safe } = value;
  return {
    ...structuredClone(safe),
    credentialConfigured: Boolean(_apiKey),
    credentialHint: credentialHint(_apiKey)
  };
}

function credentialHint(value) {
  const key = clean(value);
  return key.length >= 4 ? key.slice(-4) : "";
}

function isLoopback(value) {
  try {
    const hostname = new URL(value).hostname;
    return ["localhost", "127.0.0.1", "::1"].includes(hostname);
  } catch {
    return false;
  }
}

function clean(value) {
  return String(value ?? "").replace(/[\u0000-\u001f\u007f]/gu, " ").trim();
}
