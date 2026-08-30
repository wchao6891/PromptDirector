import { AI_PROVIDER_PRESETS, getAiProviderPreset } from "./ai-provider-presets.js";
import { getAiModelCapability } from "./ai-model-capabilities.js";

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

const ASSIGNMENT_EVIDENCE = new Set(["declared", "protocol_inferred", "manual_unverified"]);
const MANUAL_ASSIGNMENT_TASKS = new Set([
  "textTags", "skillExtraction", "creativePlanning", "imageAnalysis", "videoAnalysis"
]);
const TEXT_ANALYSIS_TASKS = new Set(["textTags", "skillExtraction", "creativePlanning"]);
export const DEFAULT_TEXT_ANALYSIS_CONCURRENCY = 20;
export const DEFAULT_MEDIA_ANALYSIS_CONCURRENCY = 10;
export const DEFAULT_VIDEO_ANALYSIS_CONCURRENCY = 2;

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
  return { version: 5, providers };
}

export function normalizeAiTaskAssignments(value = {}, registryValue = {}) {
  return Object.fromEntries(AI_ASSIGNMENT_TASKS.map((task) => {
    const candidate = value?.[task.id];
    const source = candidate && typeof candidate === "object" ? candidate : {};
    const assignment = { providerId: clean(source.providerId), model: clean(source.model) };
    const profile = registryValue?.providers?.[assignment.providerId];
    const discovered = profile?.discoveredModels?.find((model) => model.id === assignment.model);
    const inferredEvidence = discovered ? modelAssignmentEvidence(task.id, discovered, profile) : "";
    const evidence = ASSIGNMENT_EVIDENCE.has(source.evidence)
      ? source.evidence
      : inferredEvidence === "manual_unverified" ? inferredEvidence : "";
    if (evidence) assignment.evidence = evidence;
    if (assignment.providerId && assignment.model) {
      assignment.managedBy = source.managedBy === "connection" ? "connection" : "task";
    }
    assignment.concurrency = normalizeTaskConcurrency(
      task.id,
      source.concurrency,
      modelConcurrencyLimit(assignment.providerId, assignment.model, registryValue)
    );
    return [task.id, assignment];
  }));
}

export function applyConnectionModelAssignments(assignmentsValue = {}, selectionValue = {}, registryValue = {}) {
  const registry = normalizeAiProviderRegistry(registryValue);
  const current = normalizeAiTaskAssignments(assignmentsValue, registry);
  const providerId = clean(selectionValue?.providerId);
  const model = clean(selectionValue?.model);
  const taskIds = new Set((Array.isArray(selectionValue?.taskIds) ? selectionValue.taskIds : [])
    .filter((taskId) => AI_ASSIGNMENT_TASKS.some((task) => task.id === taskId)));
  if (!providerId || !model || taskIds.size === 0) return current;
  if (registry.providers[providerId]?.consent !== true) return current;
  const allowManualUnverifiedTasks = new Set((Array.isArray(selectionValue?.allowManualUnverifiedTasks)
    ? selectionValue.allowManualUnverifiedTasks : [])
    .filter((taskId) => taskIds.has(taskId)));
  const next = structuredClone(current);
  for (const taskId of taskIds) {
    const existing = current[taskId] ?? {};
    const empty = !existing.providerId || !existing.model;
    const managedByThisConnection = existing.managedBy === "connection" && existing.providerId === providerId;
    if (!empty && !managedByThisConnection) continue;
    const assignment = createAiTaskAssignment(taskId, providerId, model, registry);
    if (assignment.evidence === "manual_unverified" && !allowManualUnverifiedTasks.has(taskId)) continue;
    next[taskId] = normalizeAiTaskAssignments({
      [taskId]: {
        ...assignment,
        managedBy: "connection",
        concurrency: existing.concurrency
      }
    }, registry)[taskId];
  }
  return next;
}

export function modelConcurrencyLimit(providerIdValue, modelValue, registryValue = {}) {
  const providerId = clean(providerIdValue);
  const model = clean(modelValue).replace(/^models\//, "");
  if (!providerId || !model) return null;
  const profile = registryValue?.providers?.[providerId];
  const discoveredLimit = Number(profile?.discoveredModels?.find((item) => item.id === model)?.concurrencyLimit?.value);
  if (Number.isInteger(discoveredLimit) && discoveredLimit >= 2) return discoveredLimit;
  const officialLimit = Number(getAiModelCapability(providerId, model)?.concurrencyLimit?.value);
  return Number.isInteger(officialLimit) && officialLimit >= 2 ? officialLimit : null;
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
      structuredOutput: profile.structuredOutput,
      mediaInput: structuredClone(profile.mediaInput),
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

export function availableAiModelsForTask(taskId, profileValue = {}) {
  requireTask(taskId);
  const profile = provider(clean(profileValue?.id), profileValue);
  if (!profile.capabilities.includes(taskId)) return [];
  const available = profile.discoveredModels.flatMap((model) => {
    if (model.status === "unavailable") return [];
    const assignmentEvidence = modelAssignmentEvidence(taskId, model, profile);
    return assignmentEvidence ? [{ ...structuredClone(model), assignmentEvidence }] : [];
  });
  const configuredModel = taskId === "imageGeneration"
    ? clean(profile.models.imageGeneration) || clean(profile.imageGeneration?.model)
    : taskId === "videoGeneration"
      ? clean(profile.models.videoGeneration) || clean(profile.videoGeneration?.model)
      : clean(profile.models[taskId]);
  if (!available.length && !profile.discovery.discoveredAt && configuredModel) {
    return [{
      id: configuredModel,
      name: configuredModel,
      status: "available",
      confidence: "manual_unverified",
      tasks: [],
      inputModalities: [],
      outputModalities: [],
      assignmentEvidence: "manual_unverified"
    }];
  }
  return available;
}

export function availableAiModelChoicesForTask(taskId, registryValue = {}) {
  requireTask(taskId);
  const registry = normalizeAiProviderRegistry(registryValue);
  return Object.values(registry.providers).flatMap((profile) =>
    availableAiModelsForTask(taskId, profile)
      .filter((model) => model.status === "available" && providerConfiguredForTask(profile, taskId, model.id))
      .map((model) => ({
        providerId: profile.id,
        providerLabel: profile.label,
        modelId: model.id,
        modelName: model.name || model.id,
        assignmentEvidence: model.assignmentEvidence
      }))
  );
}

export function createAiTaskAssignment(taskId, providerIdValue, modelValue, registryValue = {}) {
  requireTask(taskId);
  const registry = normalizeAiProviderRegistry(registryValue);
  const providerId = clean(providerIdValue);
  const model = clean(modelValue);
  const profile = registry.providers[providerId];
  if (!profile) throw new Error("所选 AI 服务不存在");
  const taskLabel = taskName(taskId);
  if (!profile.capabilities.includes(taskId)) throw new Error(`${profile.label} 的协议不支持${taskLabel}`);
  if (!model) throw new Error(`${taskLabel}尚未选择模型`);
  const discovered = profile.discoveredModels.find((item) => item.id === model);
  if (!discovered) {
    const configured = availableAiModelsForTask(taskId, profile).some((item) => item.id === model);
    if (configured) return { providerId, model, evidence: "manual_unverified" };
    throw new Error(`${profile.label} 的当前模型目录中没有该模型`);
  }
  if (discovered.status === "unavailable") throw new Error(`${profile.label} 中已选模型已下架或当前账号不可用，请重新选择`);
  const evidence = modelAssignmentEvidence(taskId, discovered, profile);
  if (!evidence) throw new Error(`${profile.label} 模型目录声明该模型不支持${taskLabel}`);
  return { providerId, model, evidence };
}

export function resolveAiProviderAssignment(taskId, registryValue = {}, assignmentsValue = {}) {
  requireTask(taskId);
  const registry = normalizeAiProviderRegistry(registryValue);
  const raw = assignmentsValue?.[taskId] ?? {};
  const providerId = clean(raw.providerId);
  if (!providerId) throw new Error(`${AI_ASSIGNMENT_TASKS.find((task) => task.id === taskId)?.label || taskId}尚未分配 AI 服务`);
  const profile = registry.providers[providerId];
  if (!profile) throw new Error("所选 AI 服务不存在");
  const taskLabel = taskName(taskId);
  if (!profile.capabilities.includes(taskId)) throw new Error(`${profile.label} 的协议不支持${taskLabel}`);
  const model = clean(raw.model);
  const discovered = profile.discoveredModels.find((item) => item.id === model);
  if (!discovered && profile.discovery.discoveredAt) {
    throw new Error(`${profile.label} 的当前模型目录中没有该模型，请重新选择`);
  }
  if (discovered?.status === "unavailable") throw new Error(`${profile.label} 中已选模型已下架或当前账号不可用，请重新选择`);
  const evidence = discovered ? modelAssignmentEvidence(taskId, discovered, profile) : "manual_unverified";
  if (discovered && !evidence) throw new Error(`${profile.label} 模型目录声明该模型不支持${taskLabel}`);
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
    structuredOutput: normalizeStructuredOutput(preset?.structuredOutput ?? value?.structuredOutput),
    mediaInput: normalizeMediaInput(preset?.mediaInput ?? value?.mediaInput),
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
    pricing: item?.pricing && typeof item.pricing === "object" ? structuredClone(item.pricing) : null,
    concurrencyLimit: normalizeConcurrencyLimit(item?.concurrencyLimit)
  })).filter((item) => item.id);
}

function normalizeConcurrencyLimit(value) {
  const limit = Number(value?.value);
  if (!Number.isInteger(limit) || limit < 2) return null;
  const source = value?.source && typeof value.source === "object" ? {
    authority: clean(value.source.authority),
    document: clean(value.source.document),
    url: clean(value.source.url),
    reviewedAt: clean(value.source.reviewedAt)
  } : null;
  return { value: limit, source };
}

function normalizeTaskConcurrency(taskId, value, documentedLimit) {
  const fallback = taskId === "videoAnalysis"
    ? DEFAULT_VIDEO_ANALYSIS_CONCURRENCY
    : TEXT_ANALYSIS_TASKS.has(taskId)
    ? DEFAULT_TEXT_ANALYSIS_CONCURRENCY
    : DEFAULT_MEDIA_ANALYSIS_CONCURRENCY;
  const requested = Number(value);
  const normalized = Number.isInteger(requested) && requested >= 2 ? requested : fallback;
  return Math.min(normalized, Number.isInteger(documentedLimit) && documentedLimit >= 2
    ? documentedLimit
    : Number.POSITIVE_INFINITY);
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
    item.status !== "unavailable" && Boolean(modelAssignmentEvidence(taskId, item, profile))
  );
  const discovered = profile.discoveredModels.find((item) => item.id === configuredModel);
  const catalogRequired = profile.catalogRequiredTasks.includes(taskId);
  const savedCredential = dedicatedImageCredential
    ? Boolean(profile.imageGeneration?.apiKey || profile.imageGeneration?.credentialConfigured)
    : profile.credentialConfigured;
  return Boolean(
    (catalogRequired
      ? clean(selectedModel)
        ? discovered?.status !== "unavailable" && Boolean(modelAssignmentEvidence(taskId, discovered, profile))
        : discoveredCandidate
      : (configuredModel && (!discovered || Boolean(modelAssignmentEvidence(taskId, discovered, profile)))) || discoveredCandidate)
    && discovered?.status !== "unavailable"
    && (key || savedCredential || isLoopback(endpoint))
  );
}

function modelAssignmentEvidence(taskId, model = {}, profile = null) {
  if ((model.tasks ?? []).includes(taskId)) {
    return ASSIGNMENT_EVIDENCE.has(model.confidence) ? model.confidence : "declared";
  }
  if (model.confidence === "manual_unverified"
    && (model.tasks ?? []).length === 0
    && (model.inputModalities ?? []).length === 0 && (model.outputModalities ?? []).length === 0) {
    if (MANUAL_ASSIGNMENT_TASKS.has(taskId)) return "manual_unverified";
    const configuredGenerationModel = taskId === "imageGeneration"
      ? clean(profile?.models?.imageGeneration) || clean(profile?.imageGeneration?.model)
      : taskId === "videoGeneration" ? clean(profile?.models?.videoGeneration) || clean(profile?.videoGeneration?.model) : "";
    if (!profile?.discovery?.discoveredAt && configuredGenerationModel === clean(model.id)) {
      return "manual_unverified";
    }
  }
  return "";
}

function normalizeStructuredOutput(value) {
  if (value === "prompt_only") return "prompt_only";
  return value === "json_object" ? "json_object" : "json_schema";
}

function normalizeMediaInput(value = {}) {
  return {
    imageBase64: value?.imageBase64 === "raw" ? "raw" : "data_url",
    localVideo: ["unsupported", "base64"].includes(value?.localVideo) ? value.localVideo : "data_url",
    preferPublicVideoUrl: value?.preferPublicVideoUrl === true,
    publicVideoUrl: value?.publicVideoUrl === "direct" ? "direct" : "any_https"
  };
}

function taskName(taskId) {
  return AI_ASSIGNMENT_TASKS.find((task) => task.id === taskId)?.label || taskId;
}

function requireTask(taskId) {
  if (!AI_ASSIGNMENT_TASKS.some((task) => task.id === taskId)) throw new Error("未知 AI 任务");
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
