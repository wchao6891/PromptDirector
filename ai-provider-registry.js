import { AI_PROVIDER_PRESETS, getAiProviderPreset } from "./ai-provider-presets.js";

export const AI_ASSIGNMENT_TASKS = Object.freeze([
  { id: "textTags", label: "文字标签" },
  { id: "skillExtraction", label: "Skill 提炼" },
  { id: "creativePlanning", label: "创作规划" },
  { id: "imageAnalysis", label: "图片分析" },
  { id: "videoAnalysis", label: "视频分析" },
  { id: "imageGeneration", label: "图片生成" },
  { id: "videoGeneration", label: "视频生成" }
]);

const CUSTOM_PROVIDER_LABELS = Object.freeze({
  "custom-text": "自定义兼容服务（文字）",
  "custom-media": "自定义兼容服务（图片与生成）"
});

export function normalizeAiProviderRegistry(value = {}) {
  const source = value?.providers && typeof value.providers === "object" ? value.providers : {};
  const providers = {};
  const ids = AI_PROVIDER_PRESETS.map((item) => item.id);
  for (const id of ids) {
    const preset = getAiProviderPreset(id);
    const saved = source[id] ?? {};
    providers[id] = provider(id, {
      ...(preset ?? {}),
      ...saved,
      discovery: { ...(preset?.discovery ?? {}), ...(saved.discovery ?? {}) }
    });
  }
  return { version: 4, providers };
}

export function normalizeAiTaskAssignments(value = {}) {
  return Object.fromEntries(AI_ASSIGNMENT_TASKS.map((task) => {
    const candidate = value?.[task.id];
    const source = candidate && typeof candidate === "object" ? candidate : {};
    return [task.id, { providerId: clean(source.providerId), model: clean(source.model) }];
  }));
}

export function publicAiProviderRegistry(value = {}) {
  const registry = normalizeAiProviderRegistry(value);
  return {
    version: registry.version,
    providers: Object.fromEntries(Object.entries(registry.providers).map(([id, profile]) => [id, {
      id,
      label: profile.label,
      category: profile.category,
      endpoint: profile.endpoint,
      protocol: profile.protocol,
      models: structuredClone(profile.models),
      capabilities: [...profile.capabilities],
      catalogRequiredTasks: [...profile.catalogRequiredTasks],
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
  const providerId = clean(raw.providerId);
  if (!providerId) throw new Error(`${AI_ASSIGNMENT_TASKS.find((task) => task.id === taskId)?.label || taskId}尚未分配 AI 服务`);
  const profile = registry.providers[providerId];
  if (!profile) throw new Error("所选 AI 服务不存在");
  const taskLabel = AI_ASSIGNMENT_TASKS.find((task) => task.id === taskId)?.label || taskId;
  if (!profile.capabilities.includes(taskId)) throw new Error(`${profile.label} 不支持${taskLabel}`);
  const model = clean(raw.model);
  const discovered = profile.discoveredModels.find((item) => item.id === model);
  if (discovered?.status === "unavailable") throw new Error(`${profile.label} 中已选模型已下架或当前账号不可用，请重新选择`);
  if (!providerConfiguredForTask(profile, taskId, model) || !model) throw new Error(`${profile.label} 尚未完成${taskLabel}配置`);
  return { taskId, providerId, provider: profile.label, model };
}

export function mergeAiProviderRegistry(currentValue = {}, incomingValue = {}) {
  const current = normalizeAiProviderRegistry(currentValue);
  const incoming = incomingValue?.providers && typeof incomingValue.providers === "object" ? incomingValue.providers : {};
  const providers = { ...current.providers };
  for (const [id, update] of Object.entries(incoming)) {
    if (!getAiProviderPreset(id)) continue;
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
  const preset = getAiProviderPreset(id);
  const models = Object.fromEntries(AI_ASSIGNMENT_TASKS.map((task) => [
    task.id,
    clean(value?.models?.[task.id])
  ]));
  const discoveredModels = normalizeDiscoveredModels(value?.discoveredModels).map((model) => ({
    ...model,
    tasks: preset ? model.tasks.filter((taskId) => preset.capabilities.includes(taskId)) : model.tasks
  }));
  const capabilities = [...(preset?.capabilities ?? [])];
  return {
    id,
    label: clean(value?.label) || preset?.label || CUSTOM_PROVIDER_LABELS[id] || "自定义兼容服务",
    category: preset?.category ?? "custom",
    endpoint: clean(value?.endpoint) || preset?.endpoint || "",
    protocol: clean(value?.protocol) || preset?.protocol || "native",
    apiKey: clean(value?.apiKey),
    credentialConfigured: Object.hasOwn(value ?? {}, "apiKey")
      ? Boolean(clean(value?.apiKey) || isLoopback(value?.endpoint))
      : value?.credentialConfigured === true || isLoopback(value?.endpoint),
    consent: value?.consent === true,
    models,
    capabilities,
    catalogRequiredTasks: [...(preset?.catalogRequiredTasks ?? [])],
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
    supportedMethods: cleanArray(item?.supportedMethods),
    supportedResolutions: cleanArray(item?.supportedResolutions),
    supportedAspectRatios: cleanArray(item?.supportedAspectRatios),
    referenceImages: normalizeReferenceImages(item?.referenceImages),
    contextLength: Number(item?.contextLength) > 0 ? Number(item.contextLength) : null,
    pricing: item?.pricing && typeof item.pricing === "object" ? structuredClone(item.pricing) : null
  })).filter((item) => item.id);
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
    adapter: clean(value?.adapter),
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

function providerConfiguredForTask(profile, taskId, selectedModel = "") {
  const endpoint = taskId === "imageGeneration" ? profile.imageGeneration?.endpoint || profile.endpoint : profile.endpoint;
  const dedicatedImageCredential = taskId === "imageGeneration" && requiresDedicatedImageCredential(profile);
  const key = taskId === "imageGeneration"
    ? profile.imageGeneration?.apiKey || (dedicatedImageCredential ? "" : profile.apiKey)
    : profile.apiKey;
  const configuredModel = clean(selectedModel) || profile.models[taskId];
  const discoveredCandidate = profile.discoveredModels.some((item) =>
    item.status !== "unavailable" && item.tasks.includes(taskId)
  );
  const discovered = profile.discoveredModels.find((item) => item.id === configuredModel);
  const catalogRequired = profile.catalogRequiredTasks.includes(taskId);
  const savedCredential = dedicatedImageCredential
    ? Boolean(profile.imageGeneration?.apiKey || profile.imageGeneration?.credentialConfigured)
    : profile.credentialConfigured;
  return Boolean(
    (catalogRequired
      ? clean(selectedModel)
        ? discovered?.status !== "unavailable" && discovered?.tasks.includes(taskId)
        : discoveredCandidate
      : configuredModel || discoveredCandidate)
    && discovered?.status !== "unavailable"
    && (key || savedCredential || isLoopback(endpoint))
  );
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
