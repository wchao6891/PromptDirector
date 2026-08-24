import { boundedMediaBlobFromResponse } from "./bounded-media.js";
import { getAiModelCapability } from "./ai-model-capabilities.js";
import { getAiProviderPreset } from "./ai-provider-presets.js";

const TEXT_TASKS = Object.freeze(["textTags", "skillExtraction", "creativePlanning"]);
const ALL_TASKS = Object.freeze([...TEXT_TASKS, "imageAnalysis", "videoAnalysis", "imageGeneration", "videoGeneration"]);
const DISCOVERY_ADAPTERS = Object.freeze({
  identity: discoverIdentityModels,
  kimi: discoverKimi,
  xai: discoverXai,
  openrouter: discoverOpenRouter,
  gemini: discoverGemini,
  configured_video: discoverConfiguredVideo
});

export function createAiProviderModule(options = {}) {
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  if (typeof fetchImpl !== "function") throw new Error("当前环境不支持模型发现请求");
  const catalogs = new Map();
  const cachedDiscoveries = new Map();
  const providerProfiles = new Map();
  const requestOptions = { signal: options.signal, timeoutMs: options.timeoutMs };

  return {
    configureProvider(profileValue) {
      const profile = normalizeProfile(profileValue);
      providerProfiles.set(profile.id, profile);
      return { providerId: profile.id };
    },
    discoverModels,
    verifyModelAccess,
    describeCapabilities,
    execute: (task, request) => executeTask(fetchImpl, providerProfiles, task, request, requestOptions),
    submit: (task, request) => submitTask(fetchImpl, providerProfiles, task, request, requestOptions),
    poll: (job) => pollJob(fetchImpl, providerProfiles, job, requestOptions),
    download: (job) => downloadJob(fetchImpl, providerProfiles, job, requestOptions),
    resume: (job) => resumeJob(fetchImpl, providerProfiles, job, requestOptions)
  };

  async function discoverModels(profileValue = {}, requestOptions = {}) {
    const profile = normalizeProfile(profileValue);
    providerProfiles.set(profile.id, profile);
    const previous = cachedDiscoveries.get(profile.id);
    const discovery = await discoverProviderModels(fetchImpl, profile, {
      etag: requestOptions.etag || previous?.cache?.etag || ""
    });
    const result = discovery.notModified ? (previous ?? {
      providerId: profile.id,
      discoveredAt: profile.discovery?.discoveredAt || new Date().toISOString(),
      models: profile.discoveredModels,
      cache: { etag: requestOptions.etag || "", cacheControl: profile.discovery?.cacheControl || "" },
      source: profile.discovery?.source || "provider_cache"
    }) : {
      providerId: profile.id,
      discoveredAt: new Date().toISOString(),
      models: mergeModels(discovery.models, configuredModels(profile).map((model) => ({
        ...model,
        status: Array.isArray(discovery.models) && !discovery.models.some((item) => item.id === model.id) && !profile.id.startsWith("custom")
          ? "unavailable"
          : model.status
      }))),
      cache: discovery.cache,
      source: discovery.source
    };
    catalogs.set(profile.id, new Map(result.models.map((model) => [model.id, model])));
    cachedDiscoveries.set(profile.id, result);
    return structuredClone(result);
  }

  async function verifyModelAccess(profileValue = {}, modelIdValue = "") {
    const modelId = clean(modelIdValue);
    if (!modelId) throw new Error("缺少要校验的模型名称");
    const result = await discoverModels({ ...profileValue, models: {} }, { etag: "" });
    const providerModels = result.models.filter((model) => model.source !== "user_configuration");
    return {
      providerId: result.providerId,
      modelId,
      available: providerModels.some((model) => model.id === modelId),
      verification: "catalog_visible",
      executionVerified: false,
      visibleModelIds: providerModels.map((model) => model.id)
    };
  }

  function describeCapabilities(providerId, modelId) {
    const model = catalogs.get(clean(providerId))?.get(clean(modelId));
    if (!model) throw new Error("尚未发现该模型的能力信息");
    return structuredClone(model);
  }
}

async function discoverProviderModels(fetchImpl, profile, cache) {
  const preset = getAiProviderPreset(profile.id);
  const adapterId = clean(profile.discovery?.adapter) || preset?.discovery?.adapter || "identity";
  const adapter = DISCOVERY_ADAPTERS[adapterId];
  if (!adapter) throw new Error(`${profile.id} 的模型发现方式 ${adapterId} 尚未适配`);
  const result = await adapter(fetchImpl, profile, cache);
  if (result.notModified) return result;
  const allowedTasks = preset ? new Set(preset.capabilities) : null;
  return {
    ...result,
    models: result.models.map((model) => ({
      ...model,
      tasks: allowedTasks ? model.tasks.filter((task) => allowedTasks.has(task)) : model.tasks
    }))
  };
}

async function discoverIdentityModels(fetchImpl, profile, cache) {
  const url = modelsEndpoint(profile.endpoint);
  const response = await modelRequest(fetchImpl, url, profile, cache);
  if (response.notModified) return response;
  const list = requiredArrayFrom(response.payload, `${profile.id} 返回了当前版本尚未适配的模型列表结构`, "data", "models");
  return {
    models: list.map((item) => {
      const architecture = item?.architecture && typeof item.architecture === "object" ? item.architecture : item;
      const inputModalities = normalizeModalities(architecture.input_modalities ?? architecture.inputModalities);
      const outputModalities = normalizeModalities(architecture.output_modalities ?? architecture.outputModalities);
      const hasDeclaredModalities = inputModalities.length > 0 && outputModalities.length > 0;
      const id = clean(item.id ?? item.name).replace(/^models\//, "");
      const official = getAiModelCapability(profile.id, id);
      return modelDescriptor(item, {
        confidence: official || hasDeclaredModalities ? "declared" : "manual_unverified",
        tasks: official?.tasks ?? (hasDeclaredModalities ? tasksFromModalities(inputModalities, outputModalities) : []),
        inputModalities: official?.inputModalities ?? inputModalities,
        outputModalities: official?.outputModalities ?? outputModalities,
        supportedParameters: official?.supportedParameters,
        supportedResolutions: official?.supportedResolutions,
        supportedAspectRatios: official?.supportedAspectRatios,
        referenceImages: official?.referenceImages,
        concurrencyLimit: official?.concurrencyLimit,
        source: official ? "provider_models+official_capabilities" : "provider_models"
      });
    }),
    cache: response.cache,
    source: "provider_models"
  };
}

async function discoverKimi(fetchImpl, profile, cache) {
  const response = await modelRequest(fetchImpl, modelsEndpoint(profile.endpoint), profile, cache);
  if (response.notModified) return response;
  const list = requiredArrayFrom(response.payload, "Kimi 返回了当前版本尚未适配的模型列表结构", "data", "models");
  return {
    models: list.map((item) => {
      const inputModalities = [
        "text",
        ...(item.supports_image_in === true ? ["image"] : []),
        ...(item.supports_video_in === true ? ["video"] : [])
      ];
      return modelDescriptor(item, {
        confidence: "declared",
        tasks: tasksFromModalities(inputModalities, ["text"]),
        inputModalities,
        outputModalities: ["text"],
        source: "kimi_models"
      });
    }),
    cache: response.cache,
    source: "kimi_models"
  };
}

async function discoverConfiguredVideo(_fetchImpl, profile) {
  return {
    models: configuredProtocolModels(profile, ["videoGeneration"]),
    cache: {},
    source: "configured_protocol"
  };
}

async function discoverXai(fetchImpl, profile, cache) {
  const base = apiBase(profile.endpoint, "/v1");
  const definitions = [
    ["language-models", "language_models"],
    ["image-generation-models", "image_generation_models"],
    ["video-generation-models", "video_generation_models"]
  ];
  const responses = [];
  for (const [path, source] of definitions) {
    const response = await modelRequest(fetchImpl, `${base}/${path}`, profile, path === "language-models" ? cache : {});
    if (response.notModified) return response;
    responses.push({ ...response, source });
  }
  return {
    models: responses.flatMap(({ payload, source }) => requiredArrayFrom(payload, "xAI 返回了当前版本尚未适配的模型列表结构", "models", "data").map((item) =>
      declaredModel(item, { source })
    )),
    cache: responses[0]?.cache ?? {},
    source: "xai_model_catalogs"
  };
}

async function discoverOpenRouter(fetchImpl, profile, cache) {
  const base = apiBase(profile.endpoint, "/api/v1");
  const general = await modelRequest(fetchImpl, `${base}/models?output_modalities=all`, profile, cache);
  if (general.notModified) return general;
  const image = await modelRequest(fetchImpl, `${base}/images/models`, profile, {});
  const video = await modelRequest(fetchImpl, `${base}/videos/models`, profile, {});
  const generalModels = requiredArrayFrom(general.payload, "OpenRouter 返回了当前版本尚未适配的模型列表结构", "data", "models").map((item) =>
    declaredModel(item, { source: "openrouter_models" })
  );
  const videoModels = requiredArrayFrom(video.payload, "OpenRouter 视频模型结构暂未适配", "data", "models").map((item) =>
    declaredModel({
      ...item,
      architecture: item.architecture ?? { input_modalities: ["text", "image"], output_modalities: ["video"] }
    }, { source: "openrouter_video_models", forceTasks: ["videoGeneration"] })
  );
  const imageModels = requiredArrayFrom(image.payload, "OpenRouter 图片模型结构暂未适配", "data", "models").map((item) =>
    declaredModel({
      ...item,
      architecture: item.architecture ?? { input_modalities: ["text"], output_modalities: ["image"] }
    }, { source: "openrouter_image_models", forceTasks: ["imageGeneration"] })
  );
  return {
    models: mergeModels(generalModels, imageModels, videoModels),
    cache: general.cache,
    source: "openrouter_catalogs"
  };
}

async function discoverGemini(fetchImpl, profile, cache) {
  const base = apiBase(profile.endpoint, "");
  const url = `${base.replace(/\/$/, "")}/v1beta/models`;
  const response = await modelRequest(fetchImpl, url, profile, cache,
    profile.apiKey ? { "x-goog-api-key": profile.apiKey } : {});
  if (response.notModified) return response;
  return {
    models: requiredArrayFrom(response.payload, "Gemini 返回了当前版本尚未适配的模型列表结构", "models", "data").map((item) => {
      const methods = stringArray(item.supportedGenerationMethods ?? item.supported_generation_methods);
      const tasks = methods.includes("generateContent") ? [...TEXT_TASKS] : [];
      if (methods.includes("predictLongRunning")) tasks.push("videoGeneration");
      const id = clean(item.id ?? item.name).replace(/^models\//, "");
      const officialCapability = getAiModelCapability("gemini", id);
      if (officialCapability) tasks.push(...officialCapability.tasks);
      return modelDescriptor(item, {
        confidence: "declared",
        tasks,
        inputModalities: officialCapability?.inputModalities,
        outputModalities: officialCapability?.outputModalities,
        source: officialCapability ? "gemini_models+google_official_capabilities" : "gemini_models",
        supportedMethods: methods,
        supportedParameters: officialCapability?.supportedParameters,
        parameterDescriptors: officialCapability?.parameterDescriptors,
        supportedResolutions: officialCapability?.supportedResolutions,
        supportedAspectRatios: officialCapability?.supportedAspectRatios,
        referenceImages: officialCapability?.referenceImages
      });
    }),
    cache: response.cache,
    source: "gemini_models"
  };
}

function declaredModel(item, options = {}) {
  const architecture = item?.architecture && typeof item.architecture === "object" ? item.architecture : item;
  const inputModalities = normalizeModalities(architecture.input_modalities ?? architecture.inputModalities);
  const outputModalities = normalizeModalities(architecture.output_modalities ?? architecture.outputModalities);
  const tasks = options.forceTasks ?? tasksFromModalities(inputModalities, outputModalities);
  return modelDescriptor(item, {
    confidence: "declared",
    tasks,
    inputModalities,
    outputModalities,
    source: options.source
  });
}

function modelDescriptor(item = {}, options = {}) {
  const id = clean(item.id ?? item.name).replace(/^models\//, "");
  const parameterDescriptors = item.supported_parameters && !Array.isArray(item.supported_parameters) && typeof item.supported_parameters === "object"
    ? structuredClone(item.supported_parameters)
    : null;
  const descriptor = {
    id,
    name: clean(item.displayName ?? item.display_name ?? item.name ?? item.id) || id,
    status: clean(item.status) || "available",
    confidence: options.confidence ?? "manual_unverified",
    source: options.source ?? "unknown",
    tasks: uniqueTaskIds(options.tasks),
    inputModalities: normalizeModalities(options.inputModalities),
    outputModalities: normalizeModalities(options.outputModalities),
    supportedParameters: options.supportedParameters ?? (parameterDescriptors
      ? Object.keys(parameterDescriptors)
      : stringArray(item.supported_parameters ?? item.supportedParameters ?? item.allowed_passthrough_parameters)),
    parameterDescriptors: options.parameterDescriptors ?? parameterDescriptors,
    supportedMethods: stringArray(options.supportedMethods),
    contextLength: positiveNumber(item.context_length ?? item.contextLength),
    pricing: cloneObject(item.pricing ?? item.pricing_skus),
    supportedResolutions: options.supportedResolutions ?? stringArray(item.supported_resolutions ?? item.supportedResolutions ?? parameterDescriptors?.resolution?.values),
    supportedAspectRatios: options.supportedAspectRatios ?? stringArray(item.supported_aspect_ratios ?? item.supportedAspectRatios ?? parameterDescriptors?.aspect_ratio?.values),
    referenceImages: options.referenceImages ? structuredClone(options.referenceImages) : undefined,
    concurrencyLimit: options.concurrencyLimit ? structuredClone(options.concurrencyLimit) : undefined
  };
  return descriptor;
}

function configuredModels(profile) {
  const byId = new Map();
  for (const task of ALL_TASKS) {
    const id = clean(profile.models?.[task]);
    if (!id) continue;
    const current = byId.get(id) ?? modelDescriptor({ id }, {
      confidence: "manual_unverified",
      tasks: [],
      source: "user_configuration"
    });
    current.configuredTasks = uniqueTaskIds([...(current.configuredTasks ?? []), task]);
    byId.set(id, current);
  }
  return [...byId.values()];
}

function configuredProtocolModels(profile, tasks) {
  const ids = [...new Set(tasks.map((task) => clean(profile.models?.[task])).filter(Boolean))];
  return ids.map((id) => modelDescriptor({ id }, {
    confidence: "protocol_inferred",
    tasks,
    inputModalities: ["text", "image"],
    outputModalities: ["video"],
    source: "configured_protocol"
  }));
}

function mergeModels(...collections) {
  const merged = new Map();
  for (const collection of collections.flat()) {
    if (!collection?.id) continue;
    const before = merged.get(collection.id);
    if (!before) {
      merged.set(collection.id, structuredClone(collection));
      continue;
    }
    const collectionHasStrongerMetadata = confidenceRank(collection.confidence) >= confidenceRank(before.confidence);
    const metadataPrimary = collectionHasStrongerMetadata ? collection : before;
    const metadataSecondary = collectionHasStrongerMetadata ? before : collection;
    const trustedModels = [before, collection].filter((item) => item.confidence !== "manual_unverified");
    merged.set(collection.id, {
      ...before,
      ...collection,
      confidence: strongerConfidence(before.confidence, collection.confidence),
      source: collection.confidence === "manual_unverified" && before.confidence !== "manual_unverified" ? before.source : collection.source,
      name: metadataPrimary.name || metadataSecondary.name,
      tasks: uniqueTaskIds([...(before.tasks ?? []), ...(collection.tasks ?? [])]),
      configuredTasks: uniqueTaskIds([...(before.configuredTasks ?? []), ...(collection.configuredTasks ?? [])]),
      inputModalities: uniqueStrings([...(before.inputModalities ?? []), ...(collection.inputModalities ?? [])]),
      outputModalities: uniqueStrings([...(before.outputModalities ?? []), ...(collection.outputModalities ?? [])]),
      supportedParameters: uniqueStrings([...(before.supportedParameters ?? []), ...(collection.supportedParameters ?? [])]),
      parameterDescriptors: cloneObject(metadataPrimary.parameterDescriptors ?? metadataSecondary.parameterDescriptors),
      supportedMethods: uniqueStrings(trustedModels.flatMap((item) => item.supportedMethods ?? [])),
      supportedResolutions: uniqueStrings([...(before.supportedResolutions ?? []), ...(collection.supportedResolutions ?? [])]),
      supportedAspectRatios: uniqueStrings([...(before.supportedAspectRatios ?? []), ...(collection.supportedAspectRatios ?? [])]),
      referenceImages: cloneObject(metadataPrimary.referenceImages ?? metadataSecondary.referenceImages),
      contextLength: metadataPrimary.contextLength ?? metadataSecondary.contextLength,
      pricing: metadataPrimary.pricing ?? metadataSecondary.pricing
    });
  }
  return [...merged.values()];
}

function strongerConfidence(left, right) {
  return confidenceRank(right) > confidenceRank(left) ? right : left;
}

function confidenceRank(value) {
  return ({ manual_unverified: 0, protocol_inferred: 1, declared: 2 })[value] ?? 0;
}

async function modelRequest(fetchImpl, url, profile, cache = {}, extraHeaders = {}) {
  validateRemoteUrl(url);
  const headers = { Accept: "application/json", ...extraHeaders };
  if (profile.apiKey && !headers.Authorization && !headers["x-goog-api-key"]) headers.Authorization = `Bearer ${profile.apiKey}`;
  if (cache.etag) headers["If-None-Match"] = cache.etag;
  const response = await fetchImpl(url, { method: "GET", headers });
  if (response.status === 304) return { notModified: true };
  if (!response.ok) {
    throw new Error(redactCredential(await providerError(response, `${profile.id} 模型列表读取失败`), profile.apiKey));
  }
  return {
    payload: await response.json(),
    cache: {
      etag: response.headers.get("etag") || "",
      cacheControl: response.headers.get("cache-control") || ""
    }
  };
}

function modelsEndpoint(endpoint) {
  const url = validatedUrl(endpoint);
  const path = url.pathname.replace(/\/$/, "");
  if (/\/(chat\/completions|responses|images\/generations)$/.test(path)) {
    const prefix = path.replace(/\/(chat\/completions|responses|images\/generations)$/, "");
    url.pathname = `${prefix || ""}/models`;
  } else if (!path.endsWith("/models")) {
    url.pathname = `${path}/models`.replace(/\/+/g, "/");
  }
  url.search = "";
  return url.toString();
}

function apiBase(endpoint, expectedSuffix) {
  const url = validatedUrl(endpoint);
  let path = url.pathname.replace(/\/$/, "");
  path = path.replace(/\/(chat\/completions|responses|models)$/, "");
  if (expectedSuffix && !path.endsWith(expectedSuffix)) path = `${path}${expectedSuffix}`;
  url.pathname = path;
  url.search = "";
  return url.toString().replace(/\/$/, "");
}

function tasksFromModalities(inputModalities, outputModalities) {
  const tasks = [];
  if (inputModalities.includes("text") && outputModalities.includes("text")) tasks.push(...TEXT_TASKS);
  if (inputModalities.includes("image") && outputModalities.includes("text")) tasks.push("imageAnalysis");
  if (inputModalities.includes("video") && outputModalities.includes("text")) tasks.push("videoAnalysis");
  if (outputModalities.includes("image")) tasks.push("imageGeneration");
  if (outputModalities.includes("video")) tasks.push("videoGeneration");
  return uniqueTaskIds(tasks);
}

async function executeTask(fetchImpl, providerProfiles, task, request = {}, requestOptions = {}) {
  ensureTask(task, ["textTags", "skillExtraction", "creativePlanning", "imageAnalysis", "videoAnalysis"]);
  if (typeof request.adapter?.execute === "function") return request.adapter.execute(task, request);
  const profile = rememberProvider(providerProfiles, request.provider);
  if (!["chat_completions", "openrouter", "xai"].includes(profile.protocol)) throw new Error("该服务的同步执行协议尚未适配");
  const endpoint = profile.protocol === "openrouter"
    ? `${apiBase(profile.endpoint, "/api/v1")}/chat/completions`
    : chatCompletionsEndpoint(profile.endpoint);
  const payload = await authorizedJsonRequest(fetchImpl, endpoint, profile.apiKey, "POST", request.body ?? {
    model: clean(request.model), messages: request.messages
  }, {}, requestOptions);
  return { providerId: profile.id, model: payload.model || request.model, payload };
}

async function submitTask(fetchImpl, providerProfiles, task, request = {}, requestOptions = {}) {
  ensureTask(task, ["imageGeneration", "videoGeneration"]);
  if (typeof request.adapter?.submit === "function") return request.adapter.submit(task, request);
  if (task !== "videoGeneration") throw new Error("该服务的异步提交协议尚未适配");
  const profile = rememberProvider(providerProfiles, request.provider);
  const model = required(request.model, "视频生成缺少模型");
  const prompt = required(request.prompt, "视频生成缺少提示词");
  let endpoint;
  let body;
  if (profile.protocol === "minimax_videos") {
    endpoint = `${apiBase(profile.endpoint, "/v1")}/video_generation`;
    body = compactObject({
      model, prompt, duration: request.parameters?.duration, resolution: request.parameters?.resolution,
      first_frame_image: frameUrl(request.images, "firstFrame"), last_frame_image: frameUrl(request.images, "lastFrame")
    });
  } else if (profile.protocol === "ark_videos") {
    endpoint = `${apiBase(profile.endpoint, "/api/v3")}/contents/generations/tasks`;
    body = { model, content: [{ type: "text", text: prompt }, ...referenceContents(request.images)] };
  } else if (["xai", "xai_videos"].includes(profile.protocol)) {
    endpoint = `${apiBase(profile.endpoint, "/v1")}/videos/generations`;
    body = { model, prompt };
  } else if (profile.protocol === "gemini") {
    endpoint = `${apiBase(profile.endpoint, "")}/v1beta/models/${encodeURIComponent(model)}:predictLongRunning`;
    body = { instances: [{ prompt }], ...(request.parameters ? { parameters: request.parameters } : {}) };
  } else if (profile.protocol === "openrouter") {
    endpoint = `${apiBase(profile.endpoint, "/api/v1")}/videos`;
    body = compactObject({
      model,
      prompt,
      duration: request.parameters?.duration,
      resolution: request.parameters?.resolution,
      aspect_ratio: request.parameters?.aspectRatio,
      size: request.parameters?.size,
      frame_images: openRouterFrameImages(request.images)
    });
  } else {
    throw new Error("该视频服务的提交协议尚未适配");
  }
  const extraHeaders = profile.protocol === "gemini" ? { "x-goog-api-key": profile.apiKey } : {};
  const payload = await authorizedJsonRequest(fetchImpl, endpoint, profile.apiKey, "POST", body, extraHeaders, requestOptions);
  const remoteId = clean(payload.task_id ?? payload.id ?? payload.request_id ?? payload.name);
  if (!remoteId) throw new Error("视频服务没有返回任务编号");
  return {
    providerId: profile.id, protocol: profile.protocol, remoteId, requestModel: model,
    status: "submitted", submittedAt: new Date().toISOString(),
    pollUrl: safeOptionalUrl(payload.polling_url ?? payload.poll_url ?? payload.status_url)
  };
}

async function pollJob(fetchImpl, providerProfiles, job = {}, requestOptions = {}) {
  if (typeof job.adapter?.poll === "function") return job.adapter.poll(job);
  const profile = providerProfiles.get(clean(job.providerId));
  if (!profile) throw new Error("恢复任务前需要重新载入对应厂商配置");
  const remoteId = required(job.remoteId, "任务缺少远端编号");
  let endpoint;
  if (job.protocol === "minimax_videos") endpoint = `${apiBase(profile.endpoint, "/v1")}/query/video_generation?task_id=${encodeURIComponent(remoteId)}`;
  else if (job.protocol === "ark_videos") endpoint = `${apiBase(profile.endpoint, "/api/v3")}/contents/generations/tasks/${encodeURIComponent(remoteId)}`;
  else if (["xai", "xai_videos"].includes(job.protocol)) endpoint = `${apiBase(profile.endpoint, "/v1")}/videos/${encodeURIComponent(remoteId)}`;
  else if (job.protocol === "gemini") endpoint = `${apiBase(profile.endpoint, "")}/v1beta/${remoteId.replace(/^\//, "")}`;
  else if (job.protocol === "openrouter" && job.pollUrl) endpoint = job.pollUrl;
  else if (job.protocol === "openrouter") endpoint = `${apiBase(profile.endpoint, "/api/v1")}/videos/${encodeURIComponent(remoteId)}`;
  else throw new Error("该任务的轮询协议尚未适配");
  if (!sameOrigin(endpoint, profile.endpoint)) throw new Error("任务轮询地址与已授权厂商来源不一致");
  const extraHeaders = job.protocol === "gemini" ? { "x-goog-api-key": profile.apiKey } : {};
  const payload = await authorizedJsonRequest(fetchImpl, endpoint, profile.apiKey, "GET", null, extraHeaders, requestOptions);
  return normalizePolledJob(job, payload, profile.apiKey);
}

async function downloadJob(fetchImpl, providerProfiles, job = {}, requestOptions = {}) {
  if (typeof job.adapter?.download === "function") return job.adapter.download(job);
  const profile = providerProfiles.get(clean(job.providerId));
  if (!profile) throw new Error("下载任务前需要重新载入对应厂商配置");
  let downloadUrl = safeOptionalUrl(job.downloadUrl);
  if (!downloadUrl && job.protocol === "minimax_videos" && job.fileId) {
    const endpoint = `${apiBase(profile.endpoint, "/v1")}/files/retrieve?file_id=${encodeURIComponent(job.fileId)}`;
    const payload = await authorizedJsonRequest(fetchImpl, endpoint, profile.apiKey, "GET", null, {}, requestOptions);
    downloadUrl = safeOptionalUrl(payload?.file?.download_url);
  }
  if (!downloadUrl) throw new Error("视频任务还没有可下载的结果地址");
  const headers = {};
  if (sameOrigin(downloadUrl, profile.endpoint) && profile.apiKey) {
    if (job.protocol === "gemini") headers["x-goog-api-key"] = profile.apiKey;
    else headers.Authorization = `Bearer ${profile.apiKey}`;
  }
  const control = createRequestControl(requestOptions);
  try {
    const response = await fetchImpl(downloadUrl, {
      method: "GET",
      headers,
      credentials: "omit",
      redirect: "error",
      referrerPolicy: "no-referrer",
      cache: "no-store",
      signal: control.signal
    });
    if (!response.ok) throw new Error(`视频下载失败（HTTP ${response.status}）`);
    const blob = await boundedMediaBlobFromResponse(response, { kind: "video", controller: control.controller });
    return { ...job, downloadUrl, blob };
  } finally {
    control.cleanup();
  }
}

async function resumeJob(fetchImpl, providerProfiles, job = {}, requestOptions = {}) {
  if (typeof job.adapter?.resume === "function") return job.adapter.resume(job);
  return pollJob(fetchImpl, providerProfiles, job, requestOptions);
}

function rememberProvider(providerProfiles, value) {
  const profile = normalizeProfile(value);
  providerProfiles.set(profile.id, profile);
  return profile;
}

function normalizePolledJob(job, payload, apiKey = "") {
  const raw = clean(payload.status ?? (payload.done === true ? "completed" : "pending")).toLowerCase();
  const failed = ["fail", "failed", "expired", "cancelled", "canceled"].includes(raw) || Boolean(payload.error);
  const completed = ["success", "succeeded", "done", "completed"].includes(raw) || payload.done === true;
  if (failed) {
    const message = clean(payload.error_message ?? payload.error?.message) || "视频生成失败";
    throw new Error(redactCredential(message, apiKey));
  }
  return {
    ...job,
    status: completed ? "completed" : "running",
    fileId: clean(payload.file_id ?? job.fileId),
    downloadUrl: safeOptionalUrl(payload?.unsigned_urls?.[0] ?? payload?.content?.video_url ?? payload?.video?.url ?? payload?.response?.generatedVideos?.[0]?.video?.uri ?? job.downloadUrl),
    providerPayload: payload && typeof payload === "object" ? structuredClone(payload) : {}
  };
}

function ensureTask(task, allowed) {
  if (!allowed.includes(task)) throw new Error("任务类型与执行方式不匹配");
}

async function authorizedJsonRequest(fetchImpl, url, apiKey, method, body = null, extraHeaders = {}, requestOptions = {}) {
  validateRemoteUrl(url);
  const headers = { Accept: "application/json", ...extraHeaders };
  if (apiKey && !headers["x-goog-api-key"]) headers.Authorization = `Bearer ${apiKey}`;
  if (body !== null) headers["Content-Type"] = "application/json";
  const control = createRequestControl(requestOptions);
  try {
    const response = await fetchImpl(url, {
      method,
      headers,
      ...(body !== null ? { body: JSON.stringify(body) } : {}),
      credentials: "omit",
      redirect: "error",
      referrerPolicy: "no-referrer",
      signal: control.signal
    });
    if (!response.ok) {
      throw new Error(redactCredential(await providerError(response, "AI 服务请求失败"), apiKey));
    }
    return await response.json();
  } finally {
    control.cleanup();
  }
}

function createRequestControl(options = {}) {
  const controller = new AbortController();
  const abort = () => controller.abort(options.signal?.reason);
  if (options.signal?.aborted) abort();
  else options.signal?.addEventListener?.("abort", abort, { once: true });
  const timeoutMs = Number(options.timeoutMs);
  const timeout = Number.isSafeInteger(timeoutMs) && timeoutMs > 0
    ? setTimeout(() => controller.abort(), timeoutMs)
    : 0;
  return {
    controller,
    signal: controller.signal,
    cleanup() {
      if (timeout) clearTimeout(timeout);
      options.signal?.removeEventListener?.("abort", abort);
    }
  };
}

function sameOrigin(left, right) {
  return validatedUrl(left).origin === validatedUrl(right).origin;
}

function redactCredential(message, credential) {
  const secret = clean(credential);
  return secret ? String(message).split(secret).join("已隐藏凭据") : String(message);
}

function chatCompletionsEndpoint(endpoint) {
  const url = validatedUrl(endpoint);
  if (!url.pathname.endsWith("/chat/completions")) url.pathname = `${url.pathname.replace(/\/$/, "")}/chat/completions`;
  return url.toString();
}

function frameUrl(images, role) {
  return clean((Array.isArray(images) ? images : []).find((image) => image?.role === role)?.url);
}

function referenceContents(images) {
  return (Array.isArray(images) ? images : []).flatMap((image) => {
    const url = clean(image?.url);
    return url ? [{ type: "image_url", image_url: { url } }] : [];
  });
}

function openRouterFrameImages(images) {
  const values = (Array.isArray(images) ? images : []).flatMap((image) => {
    const url = clean(image?.url);
    if (!url) return [];
    return [{
      type: "image_url",
      image_url: { url },
      frame_type: image?.role === "lastFrame" ? "last_frame" : "first_frame"
    }];
  });
  return values.length ? values : undefined;
}

function compactObject(value) {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined && item !== null && item !== ""));
}

function safeOptionalUrl(value) {
  const text = clean(value);
  if (!text) return "";
  validateRemoteUrl(text);
  return text;
}

function required(value, message) {
  const text = clean(value);
  if (!text) throw new Error(message);
  return text;
}

function normalizeProfile(value = {}) {
  const id = clean(value.id);
  if (!id) throw new Error("缺少 AI 厂商标识");
  const endpoint = clean(value.endpoint);
  if (!endpoint) throw new Error("缺少 AI 厂商接口地址");
  return {
    id,
    endpoint,
    apiKey: clean(value.apiKey),
    protocol: clean(value.protocol) || "native",
    models: value.models && typeof value.models === "object" ? structuredClone(value.models) : {},
    discoveredModels: Array.isArray(value.discoveredModels) ? structuredClone(value.discoveredModels) : [],
    discovery: value.discovery && typeof value.discovery === "object" ? structuredClone(value.discovery) : {}
  };
}

function validatedUrl(value) {
  const url = new URL(value);
  validateRemoteUrl(url.toString());
  return url;
}

function validateRemoteUrl(value) {
  const url = new URL(value);
  const loopback = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  if (url.protocol !== "https:" && !(loopback && url.protocol === "http:")) throw new Error("模型接口必须使用 HTTPS");
  if (url.username || url.password) throw new Error("模型接口地址不能包含账号或密码");
}

async function providerError(response, fallback) {
  try {
    const payload = await response.json();
    return clean(payload?.error?.message ?? payload?.message) || `${fallback}（HTTP ${response.status}）`;
  } catch {
    return `${fallback}（HTTP ${response.status}）`;
  }
}

function arrayFrom(value, ...keys) {
  for (const key of keys) if (Array.isArray(value?.[key])) return value[key];
  return [];
}

function requiredArrayFrom(value, message, ...keys) {
  for (const key of keys) if (Array.isArray(value?.[key])) return value[key];
  throw new Error(message);
}

function normalizeModalities(value) {
  return uniqueStrings(stringArray(value).map((item) => item.toLowerCase().replace(/^modalit(y|ies)_/, "")));
}

function stringArray(value) {
  return Array.isArray(value) ? uniqueStrings(value.map(clean).filter(Boolean)) : [];
}

function uniqueStrings(value) {
  return [...new Set(value.map(clean).filter(Boolean))];
}

function uniqueTaskIds(value) {
  const set = new Set(value);
  return ALL_TASKS.filter((task) => set.has(task));
}

function positiveNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : null;
}

function cloneObject(value) {
  return value && typeof value === "object" ? structuredClone(value) : null;
}

function clean(value) {
  return String(value ?? "").trim();
}
