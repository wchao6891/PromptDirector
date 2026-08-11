import {
  VISUAL_ANALYSIS_VERSION,
  VISUAL_MODEL_PROTOCOL_VERSION,
  VISUAL_MODEL_RESPONSE_SCHEMA,
  compileVisualAnalysisInstruction,
  normalizeVisualModelResponse,
  visualModelResponseSchema
} from "./visual-analysis.js";

export const VISION_ANALYSIS_VERSION = VISUAL_ANALYSIS_VERSION;
export const DEFAULT_VISION_MODEL = "gpt-5-mini";
export const OPENAI_RESPONSES_ENDPOINT = "https://api.openai.com/v1/responses";
export const OPENAI_VIDEOS_ENDPOINT = "https://api.openai.com/v1/videos";
export const MICU_RESPONSES_ENDPOINT = "https://www.micuapi.ai/v1/responses";
export const MICU_DEFAULT_CHAT_MODEL = "gpt-5.4-mini";
export const MICU_IMAGE_GENERATIONS_ENDPOINT = "https://www.micuapi.ai/v1/images/generations";
export const MICU_IMAGE_EDITS_ENDPOINT = "https://www.micuapi.ai/v1/images/edits";
export const MICU_DEFAULT_IMAGE_MODEL = "gpt-image-2";
export const MICU_DEFAULT_IMAGE_SIZE = "1536x1024";
export const MICU_IMAGE_RESULT_PERMISSION = "https://oss.filenest.top/*";
export const MAX_VISION_TAGS = 6;
export const VISION_MAX_OUTPUT_TOKENS = 12000;
export const VISION_REQUEST_TIMEOUT_MS = 120_000;

export const DEFAULT_VISION_INSTRUCTIONS_BY_LOCALE = Object.freeze({
  "zh-CN": "客观描述当前图片或截图。视觉作品重点记录主体、空间关系、构图镜头、光线色彩、风格材质、情绪动作；文档、界面和图表重点记录可见标题、信息结构、栏目、表格图表关系和工作状态。忽略浏览器界面、插件浮层、截图黑白边、无关水印和页面控件；不推测画面外事实、品牌、作者或艺术家。",
  en: "Objectively describe the current image or screenshot. For visual work, focus on subject, spatial relationships, composition and camera, lighting and color, style and material, mood, and action. For documents, interfaces, and charts, focus on visible titles, information structure, sections, table or chart relationships, and work state. Ignore browser UI, extension overlays, screenshot borders, irrelevant watermarks, and page controls. Do not infer off-image facts, brands, authors, or artists."
});

const CREATIVE_EVALUATION_SCHEMA = Object.freeze({
  type: "object",
  additionalProperties: false,
  required: ["summary", "checks", "primaryDeviation"],
  properties: {
    summary: { type: "string", minLength: 1 },
    checks: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["criterion", "status", "evidence"],
        properties: {
          criterion: { type: "string", minLength: 1 },
          status: { type: "string", enum: ["met", "partial", "missed", "conflict", "unknown"] },
          evidence: { type: "string", minLength: 1 }
        }
      }
    },
    primaryDeviation: {
      type: "object",
      additionalProperties: false,
      required: ["criterion", "finding", "suggestedChange"],
      properties: {
        criterion: { type: "string" },
        finding: { type: "string" },
        suggestedChange: { type: "string" }
      }
    }
  }
});

export function normalizeVisionSettings(value = {}) {
  const source = value && typeof value === "object" ? value : {};
  const instructions = source.instructionsByLocale && typeof source.instructionsByLocale === "object"
    ? source.instructionsByLocale
    : {};
  return {
    activeProvider: source.activeProvider === "compatible" ? "compatible" : "openai",
    consent: source.consent === true,
    autoAnalyzeImports: source.autoAnalyzeImports === true,
    maxOutputTokens: positiveTokenBudget(source.maxOutputTokens) || VISION_MAX_OUTPUT_TOKENS,
    instructionsByLocale: {
      "zh-CN": String(instructions["zh-CN"] ?? instructions.zh ?? "").trim() || DEFAULT_VISION_INSTRUCTIONS_BY_LOCALE["zh-CN"],
      en: String(instructions.en ?? "").trim() || DEFAULT_VISION_INSTRUCTIONS_BY_LOCALE.en
    },
    openai: {
      model: String(source.openai?.model ?? "").trim() || DEFAULT_VISION_MODEL,
      apiKey: String(source.openai?.apiKey ?? "").trim(),
      videoGeneration: normalizeVideoGenerationSettings(source.openai?.videoGeneration)
    },
    compatible: normalizeCompatibleSettings(source.compatible),
    nativeProvider: source.nativeProvider && typeof source.nativeProvider === "object" ? {
      id: String(source.nativeProvider.id ?? "").trim(),
      endpoint: String(source.nativeProvider.endpoint ?? "").trim(),
      apiKey: String(source.nativeProvider.apiKey ?? "").trim(),
      model: String(source.nativeProvider.model ?? "").trim()
    } : null
  };
}

function normalizeVideoGenerationSettings(value = {}) {
  return {
    model: String(value?.model ?? "").trim(),
    sizes: uniqueSettingsValues(value?.sizes),
    durations: uniqueSettingsValues(value?.durations)
  };
}

function uniqueSettingsValues(value) {
  const values = Array.isArray(value) ? value : String(value ?? "").split(",");
  return [...new Set(values.map((item) => String(item ?? "").trim()).filter(Boolean))];
}

function normalizeCompatibleSettings(value = {}) {
  const endpoint = String(value?.endpoint ?? "").trim();
  const apiKey = String(value?.apiKey ?? "").trim();
  let credentialOrigin = String(value?.credentialOrigin ?? "").trim();
  if (apiKey && !credentialOrigin) {
    try {
      credentialOrigin = endpointDetails(endpoint).origin;
    } catch {
      credentialOrigin = "";
    }
  }
  return {
    protocol: value?.protocol === "responses" ? "responses" : "chat_completions",
    endpoint,
    model: String(value?.model ?? "").trim(),
    apiKey,
    credentialOrigin,
    imageGeneration: normalizeImageGenerationSettings(value?.imageGeneration)
  };
}

function normalizeImageGenerationSettings(value = {}) {
  const protocol = ["responses_tool", "images_generations"].includes(value?.protocol)
    ? value.protocol
    : "none";
  const endpoint = String(value?.endpoint ?? "").trim();
  const editsEndpoint = String(value?.editsEndpoint ?? "").trim();
  const apiKey = String(value?.apiKey ?? "").trim();
  let credentialOrigin = String(value?.credentialOrigin ?? "").trim();
  if (apiKey && !credentialOrigin) {
    try { credentialOrigin = endpointDetails(endpoint).origin; }
    catch { credentialOrigin = ""; }
  }
  return {
    protocol,
    endpoint,
    editsEndpoint,
    model: String(value?.model ?? "").trim(),
    sizes: uniqueSettingsValues(value?.sizes ?? value?.size),
    qualities: uniqueSettingsValues(value?.qualities ?? value?.quality),
    apiKey,
    credentialOrigin
  };
}

export function mergeVisionSettings(currentValue = {}, incomingValue = {}) {
  const current = normalizeVisionSettings(currentValue);
  const incoming = incomingValue && typeof incomingValue === "object" ? incomingValue : {};
  const nextEndpoint = String(incoming.compatible?.endpoint ?? current.compatible.endpoint).trim();
  const currentOrigin = safeEndpointOrigin(current.compatible.endpoint);
  const nextOrigin = nextEndpoint ? endpointDetails(nextEndpoint).origin : "";
  const incomingCompatibleKey = String(incoming.compatible?.apiKey ?? "").trim();
  const originChanged = currentOrigin !== nextOrigin;
  const credentialReset = Boolean(current.compatible.apiKey && originChanged && !incomingCompatibleKey);
  const compatibleApiKey = incoming.clearApiKey === "compatible"
    ? ""
    : incomingCompatibleKey || (originChanged ? "" : current.compatible.apiKey);
  const currentImage = current.compatible.imageGeneration;
  const nextImageEndpoint = String(incoming.compatible?.imageGeneration?.endpoint ?? currentImage.endpoint).trim();
  const nextImageEditsEndpoint = String(incoming.compatible?.imageGeneration?.editsEndpoint ?? currentImage.editsEndpoint).trim();
  const currentImageOrigin = safeEndpointOrigin(currentImage.endpoint);
  const nextImageOrigin = nextImageEndpoint ? endpointDetails(nextImageEndpoint).origin : "";
  const nextImageEditsOrigin = nextImageEditsEndpoint ? endpointDetails(nextImageEditsEndpoint).origin : "";
  const incomingImageKey = String(incoming.compatible?.imageGeneration?.apiKey ?? "").trim();
  const imageOriginChanged = currentImageOrigin !== nextImageOrigin || Boolean(nextImageEditsOrigin && nextImageEditsOrigin !== nextImageOrigin);
  const imageApiKey = incoming.clearApiKey === "compatible_image"
    ? ""
    : incomingImageKey || (imageOriginChanged ? "" : currentImage.apiKey);
  const openaiApiKey = incoming.clearApiKey === "openai"
    ? ""
    : String(incoming.openai?.apiKey ?? "").trim() || current.openai.apiKey;
  const settings = normalizeVisionSettings({
    activeProvider: incoming.activeProvider ?? current.activeProvider,
    consent: incoming.consent === true,
    autoAnalyzeImports: Object.hasOwn(incoming, "autoAnalyzeImports")
      ? incoming.autoAnalyzeImports === true
      : current.autoAnalyzeImports,
    maxOutputTokens: incoming.maxOutputTokens ?? current.maxOutputTokens,
    instructionsByLocale: {
      "zh-CN": incoming.instructionsByLocale?.["zh-CN"] ?? current.instructionsByLocale["zh-CN"],
      en: incoming.instructionsByLocale?.en ?? current.instructionsByLocale.en
    },
    openai: {
      model: incoming.openai?.model ?? current.openai.model,
      apiKey: openaiApiKey,
      videoGeneration: incoming.openai?.videoGeneration ?? current.openai.videoGeneration
    },
    compatible: {
      protocol: incoming.compatible?.protocol ?? current.compatible.protocol,
      endpoint: nextEndpoint,
      model: incoming.compatible?.model ?? current.compatible.model,
      apiKey: compatibleApiKey,
      credentialOrigin: compatibleApiKey ? nextOrigin : "",
      imageGeneration: {
        protocol: incoming.compatible?.imageGeneration?.protocol ?? currentImage.protocol,
        endpoint: nextImageEndpoint,
        editsEndpoint: nextImageEditsEndpoint,
        model: incoming.compatible?.imageGeneration?.model ?? currentImage.model,
        sizes: incoming.compatible?.imageGeneration?.sizes ?? currentImage.sizes,
        qualities: incoming.compatible?.imageGeneration?.qualities ?? currentImage.qualities,
        apiKey: imageApiKey,
        credentialOrigin: imageApiKey ? nextImageOrigin : ""
      }
    }
  });
  return { settings, credentialReset, imageCredentialReset: Boolean(currentImage.apiKey && imageOriginChanged && !incomingImageKey) };
}

export function publicVisionSettings(value = {}) {
  const settings = normalizeVisionSettings(value);
  return {
    activeProvider: settings.activeProvider,
    consent: settings.consent,
    autoAnalyzeImports: settings.autoAnalyzeImports,
    maxOutputTokens: settings.maxOutputTokens,
    instructionsByLocale: structuredClone(settings.instructionsByLocale),
    openai: {
      model: settings.openai.model,
      configured: Boolean(settings.openai.apiKey),
      videoGeneration: structuredClone(settings.openai.videoGeneration)
    },
    compatible: {
      protocol: settings.compatible.protocol,
      model: settings.compatible.model,
      configured: Boolean(settings.compatible.endpoint && settings.compatible.model &&
        (settings.compatible.apiKey || isLoopbackEndpoint(settings.compatible.endpoint))),
      targetOrigin: safeEndpointOrigin(settings.compatible.endpoint),
      imageGeneration: {
        protocol: settings.compatible.imageGeneration.protocol,
        model: settings.compatible.imageGeneration.model,
        sizes: structuredClone(settings.compatible.imageGeneration.sizes),
        qualities: structuredClone(settings.compatible.imageGeneration.qualities),
        configured: compatibleImageGenerationConfigured(settings.compatible.imageGeneration),
        targetOrigin: safeEndpointOrigin(settings.compatible.imageGeneration.endpoint)
      }
    }
  };
}

function compatibleImageGenerationConfigured(value = {}) {
  if (value.protocol === "none") return false;
  if (value.protocol === "responses_tool") return true;
  if (!value.endpoint || !value.model) return false;
  return Boolean(value.apiKey || isLoopbackEndpoint(value.endpoint));
}

export async function probeCompatibleModels(value = {}, fetchImpl = fetch) {
  const settings = normalizeCompatibleSettings(value);
  const details = endpointDetails(settings.endpoint);
  if (!settings.apiKey && !details.loopback) throw new Error("远程或局域网兼容服务需要认证信息");
  const modelsUrl = new URL(details.url);
  const versionIndex = modelsUrl.pathname.indexOf("/v1/");
  modelsUrl.pathname = versionIndex >= 0 ? `${modelsUrl.pathname.slice(0, versionIndex)}/v1/models` : "/v1/models";
  let response;
  try {
    response = await fetchImpl(modelsUrl.href, {
      method: "GET",
      headers: settings.apiKey ? { Authorization: `Bearer ${settings.apiKey}` } : {},
      redirect: "error"
    });
  } catch (error) {
    throw new Error("无法连接本地或兼容 AI 服务", { cause: error });
  }
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`兼容服务连接失败（HTTP ${response.status}）`);
  const models = [...new Set((Array.isArray(payload?.data) ? payload.data : [])
    .map((item) => String(item?.id ?? "").trim()).filter(Boolean))];
  if (!models.length) throw new Error("连接成功，但服务没有返回可用模型");
  return { models, targetOrigin: details.origin, local: details.loopback };
}

export function permissionPatternForVisionSettings(value = {}) {
  const settings = normalizeVisionSettings(value);
  if (settings.activeProvider === "openai") return "https://api.openai.com/*";
  return endpointDetails(settings.compatible.endpoint).permissionPattern;
}

export function permissionPatternsForVisionSettings(value = {}) {
  const settings = normalizeVisionSettings(value);
  const patterns = [permissionPatternForVisionSettings(settings)];
  const image = settings.compatible.imageGeneration;
  if (settings.activeProvider === "compatible" && image.protocol === "images_generations" && image.endpoint) {
    patterns.push(endpointDetails(image.endpoint).permissionPattern);
    if (image.editsEndpoint) patterns.push(endpointDetails(image.editsEndpoint).permissionPattern);
    if (safeEndpointOrigin(image.endpoint) === "https://www.micuapi.ai") patterns.push(MICU_IMAGE_RESULT_PERMISSION);
  }
  return [...new Set(patterns)];
}

export function normalizeVisionResult(value, catalogValue) {
  return normalizeVisualModelResponse(value, catalogValue);
}

export async function analyzeImageWithVision(input = {}, fetchImpl = fetch) {
  const settings = requireVisionSettings(input.settings);
  const imageDataUrl = requireImageDataUrl(input.imageDataUrl);
  const locale = input.locale === "en" ? "en" : "zh-CN";
  const instruction = compileVisualAnalysisInstruction({
    catalog: input.catalog,
    customInstruction: settings.instructionsByLocale[locale],
    locale,
    measuredCanvas: input.measuredCanvas
  });
  const requestOptions = {
    maxOutputTokens: settings.maxOutputTokens,
    schema: visualModelResponseSchema(input.catalog)
  };
  const response = settings.nativeProvider?.id === "gemini"
    ? await requestGeminiVision(settings.nativeProvider, imageDataUrl, instruction, fetchImpl, requestOptions)
    : settings.activeProvider === "compatible"
      ? await requestCompatible(settings, imageDataUrl, instruction, fetchImpl, requestOptions)
    : await requestOpenAI(settings, imageDataUrl, instruction, fetchImpl, requestOptions);
  const parsed = parseJson(response.content);
  return {
    ...normalizeVisionResult(parsed, input.catalog),
    profileFingerprint: await visionAnalysisProfileFingerprint(settings, locale),
    providerType: settings.nativeProvider?.id || settings.activeProvider,
    model: response.model,
    usage: response.usage
  };
}

export async function evaluateCreativeOutputWithVision(input = {}, fetchImpl = fetch) {
  const settings = requireVisionSettings(input.settings);
  const imageDataUrl = requireImageDataUrl(input.imageDataUrl);
  const locale = input.locale === "en" ? "en" : "zh-CN";
  const instruction = creativeEvaluationInstruction(input.target, locale);
  const requestOptions = {
    schema: CREATIVE_EVALUATION_SCHEMA,
    schemaName: "creative_output_evaluation",
    emptyResultMessage: locale === "en"
      ? "The vision service did not return a usable comparison"
      : "视觉服务没有返回可用的结果对照"
  };
  const response = settings.activeProvider === "compatible"
    ? await requestCompatible(settings, imageDataUrl, instruction, fetchImpl, requestOptions)
    : await requestOpenAI(settings, imageDataUrl, instruction, fetchImpl, requestOptions);
  return {
    ...normalizeCreativeEvaluationResult(parseJson(response.content)),
    providerType: settings.activeProvider,
    model: response.model,
    usage: response.usage
  };
}

export async function imageFingerprint(blob) {
  if (!(blob instanceof Blob) || !blob.size) throw new Error("没有读取到可分析的截图");
  const digest = await globalThis.crypto.subtle.digest("SHA-256", await blob.arrayBuffer());
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function blobToDataUrl(blob) {
  if (!(blob instanceof Blob) || !blob.type.startsWith("image/") || !blob.size) {
    throw new Error("没有读取到可分析的截图");
  }
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = "";
  const chunkSize = 0x8000;
  for (let index = 0; index < bytes.length; index += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize));
  }
  return `data:${blob.type};base64,${btoa(binary)}`;
}

export function visionProtocolDescription(locale = "zh-CN") {
  return locale === "en"
    ? "Fixed input: the current image, measured canvas when available, fixed taxonomy paths, and these vision rules. Fixed output: one complete VisualAnalysisV2 reconstruction record and 0–6 compact search tags in one call. Existing detail tags, prompt text, title, URL, project, and other cases are never sent."
    : "固定输入：当前图片、可用的程序实测画布、固定分类路径和本页图片规则。固定输出：单次调用完成一份 VisualAnalysisV2 高保真重建记录和 0–6 个紧凑检索标签；不发送已有三级标签、原提示词、标题、网址、项目或其他案例。";
}

export async function visionAnalysisProfileFingerprint(settingsValue = {}, localeValue = "zh-CN") {
  const settings = normalizeVisionSettings(settingsValue);
  const locale = localeValue === "en" ? "en" : "zh-CN";
  const provider = settings[settings.activeProvider];
  const payload = JSON.stringify({
    version: VISION_ANALYSIS_VERSION,
    modelProtocol: VISUAL_MODEL_PROTOCOL_VERSION,
    locale,
    provider: settings.activeProvider,
    protocol: provider.protocol || "responses",
    model: provider.model,
    maxOutputTokens: settings.maxOutputTokens,
    instructions: settings.instructionsByLocale[locale]
  });
  const digest = await globalThis.crypto.subtle.digest("SHA-256", new TextEncoder().encode(payload));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function requestOpenAI(settings, imageDataUrl, instruction, fetchImpl, options = {}) {
  return requestResponses({
    endpoint: OPENAI_RESPONSES_ENDPOINT,
    apiKey: settings.openai.apiKey,
    model: settings.openai.model,
    serviceName: "OpenAI"
  }, imageDataUrl, instruction, fetchImpl, options);
}

async function requestResponses(provider, imageDataUrl, instruction, fetchImpl, options = {}) {
  const schema = options.schema ?? VISUAL_MODEL_RESPONSE_SCHEMA;
  const schemaName = options.schemaName ?? "vision_analysis_box_2d_v1";
  const body = {
    model: provider.model,
    store: false,
    max_output_tokens: positiveTokenBudget(options.maxOutputTokens) || VISION_MAX_OUTPUT_TOKENS,
    text: { format: { type: "json_schema", name: schemaName, strict: true, schema } },
    input: [{
      role: "user",
      content: [
        { type: "input_text", text: instruction },
        { type: "input_image", image_url: imageDataUrl, detail: "high" }
      ]
    }]
  };
  const payload = await requestJson(provider.endpoint, provider.apiKey, body, fetchImpl);
  const refusal = extractOpenAIRefusal(payload);
  if (refusal) throw new Error(`${provider.serviceName} 拒绝分析这张图片：${refusal}`);
  const content = String(payload.output_text ?? extractOpenAIText(payload) ?? "").trim();
  if (!content) throw new Error(options.emptyResultMessage || `${provider.serviceName} 没有返回可用的画面描述`);
  return { content, model: String(payload.model ?? provider.model), usage: normalizeOpenAIUsage(payload.usage) };
}

async function requestCompatible(settings, imageDataUrl, instruction, fetchImpl, options = {}) {
  const { url } = endpointDetails(settings.compatible.endpoint);
  if (settings.compatible.protocol === "responses") {
    return requestResponses({
      endpoint: url,
      apiKey: settings.compatible.apiKey,
      model: settings.compatible.model,
      serviceName: "兼容服务"
    }, imageDataUrl, instruction, fetchImpl, options);
  }
  const schema = options.schema ?? VISUAL_MODEL_RESPONSE_SCHEMA;
  const schemaName = options.schemaName ?? "vision_analysis_box_2d_v1";
  const body = {
    model: settings.compatible.model,
    max_tokens: positiveTokenBudget(options.maxOutputTokens) || settings.maxOutputTokens,
    response_format: {
      type: "json_schema",
      json_schema: { name: schemaName, strict: true, schema }
    },
    messages: [{
      role: "user",
      content: [
        { type: "text", text: instruction },
        { type: "image_url", image_url: { url: imageDataUrl, detail: "high" } }
      ]
    }]
  };
  const payload = await requestJson(url, settings.compatible.apiKey, body, fetchImpl);
  const content = payload?.choices?.[0]?.message?.content;
  if (typeof content !== "string" || !content.trim()) {
    throw new Error(options.emptyResultMessage || "兼容服务没有返回可用的画面描述");
  }
  return { content, model: String(payload.model ?? settings.compatible.model), usage: normalizeCompatibleUsage(payload.usage) };
}

async function requestGeminiVision(provider, imageDataUrl, instruction, fetchImpl, options = {}) {
  const match = imageDataUrl.match(/^data:(image\/[^;]+);base64,(.+)$/i);
  if (!match) throw new Error("Gemini 图片输入格式无效");
  const endpoint = `${provider.endpoint.replace(/\/$/, "")}/v1beta/models/${encodeURIComponent(provider.model)}:generateContent`;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), VISION_REQUEST_TIMEOUT_MS);
  let response;
  try {
    response = await fetchImpl(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": provider.apiKey },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [
          { text: instruction },
          { inlineData: { mimeType: match[1], data: match[2] } }
        ] }],
        generationConfig: {
          responseMimeType: "application/json",
          responseJsonSchema: options.schema ?? VISUAL_MODEL_RESPONSE_SCHEMA,
          maxOutputTokens: positiveTokenBudget(options.maxOutputTokens) || VISION_MAX_OUTPUT_TOKENS,
          temperature: 0.1
        }
      }),
      redirect: "error",
      signal: controller.signal
    });
  } catch (error) {
    if (controller.signal.aborted) throw new Error("Gemini 图片分析超过 2 分钟未完成", { cause: error });
    throw new Error("无法连接 Gemini 图片分析服务", { cause: error });
  } finally {
    clearTimeout(timeoutId);
  }
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`Gemini 图片分析失败：${String(payload?.error?.message ?? `HTTP ${response.status}`)}`);
  const content = (payload?.candidates?.[0]?.content?.parts ?? []).map((part) => part?.text || "").join("").trim();
  if (!content) throw new Error(options.emptyResultMessage || "Gemini 没有返回可用的画面描述");
  return {
    content,
    model: provider.model,
    usage: normalizeCompatibleUsage({
      prompt_tokens: payload?.usageMetadata?.promptTokenCount,
      completion_tokens: payload?.usageMetadata?.candidatesTokenCount,
      total_tokens: payload?.usageMetadata?.totalTokenCount
    })
  };
}

async function requestJson(url, apiKey, body, fetchImpl) {
  let response;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), VISION_REQUEST_TIMEOUT_MS);
  try {
    response = await fetchImpl(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}) },
      body: JSON.stringify(body),
      redirect: "error",
      signal: controller.signal
    });
  } catch (error) {
    if (controller.signal.aborted) throw new Error("图片分析超过 2 分钟未完成，本次已停止，请手动重试", { cause: error });
    throw new Error("无法连接图片分析服务，请检查网络、地址和权限", { cause: error });
  } finally {
    clearTimeout(timeoutId);
  }
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const detail = String(payload?.error?.message ?? payload?.message ?? "").trim();
    throw new Error(`图片分析失败${detail ? `：${detail}` : `（HTTP ${response.status}）`}`);
  }
  return payload;
}

function requireVisionSettings(value) {
  const settings = normalizeVisionSettings(value);
  if (!settings.consent) throw new Error("请先确认：主动分析时会发送截图到所选视觉模型服务");
  const provider = settings[settings.activeProvider];
  if (settings.nativeProvider?.id === "gemini") {
    if (!settings.nativeProvider.apiKey || !settings.nativeProvider.model) throw new Error("请先完成 Gemini 图片分析配置");
    return settings;
  }
  if (!provider.apiKey && !(settings.activeProvider === "compatible" && isLoopbackEndpoint(provider.endpoint))) {
    throw new Error("请先在图片视觉设置中填写所选服务的 API Key");
  }
  if (!provider.model) throw new Error("请先填写图片分析模型");
  if (settings.activeProvider === "compatible") {
    const { origin } = endpointDetails(provider.endpoint);
    if (provider.apiKey && provider.credentialOrigin !== origin) {
      throw new Error("兼容接口域名已变化，请重新填写该服务的 API Key");
    }
  }
  return settings;
}

function endpointDetails(value) {
  let url;
  try {
    url = new URL(String(value ?? ""));
  } catch {
    throw new Error("兼容接口地址无效");
  }
  const loopback = isLoopbackUrl(url);
  if (url.protocol !== "https:" && !(url.protocol === "http:" && loopback)) {
    throw new Error("兼容接口只允许 HTTPS；本机 localhost 可使用 HTTP");
  }
  if (url.username || url.password) throw new Error("兼容接口地址不能包含账号信息");
  if (url.search) throw new Error("兼容接口地址不能包含查询参数");
  if (url.hash) throw new Error("兼容接口地址不能包含片段");
  return { url: url.href, origin: url.origin, permissionPattern: `${url.origin}/*`, loopback };
}

function isLoopbackEndpoint(value) {
  try { return isLoopbackUrl(new URL(String(value ?? ""))); }
  catch { return false; }
}

function isLoopbackUrl(url) {
  return ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname.toLocaleLowerCase("en-US"));
}

function safeEndpointOrigin(value) {
  try {
    return value ? endpointDetails(value).origin : "";
  } catch {
    return "";
  }
}

function requireImageDataUrl(value) {
  const image = String(value ?? "").trim();
  if (!/^data:image\/(?:png|jpe?g|webp|gif);base64,[A-Za-z0-9+/=]+$/i.test(image)) {
    throw new Error("截图格式不受支持");
  }
  return image;
}

function creativeEvaluationInstruction(value = {}, locale) {
  const target = {
    targetType: value?.targetType === "video" ? "video" : "image",
    targetPlatform: String(value?.targetPlatform ?? "").trim(),
    userRequest: String(value?.userRequest ?? "").trim(),
    finalPrompt: String(value?.finalPrompt ?? "").trim(),
    executionInstruction: String(value?.executionInstruction ?? "").trim()
  };
  if (!target.finalPrompt) throw new Error("缺少用于视觉对照的最终提示词");
  const language = locale === "en"
    ? "Write the summary, criteria, evidence, and suggested change in English."
    : "摘要、检查项、证据和修改建议使用简体中文。";
  return [
    "Compare only the attached generated result against the current creation target below.",
    language,
    "Create concrete checks from the user's request, the final prompt, and the execution instruction. Judge only visibly verifiable properties. Use status met, partial, missed, conflict, or unknown. Evidence must describe what is visible in this result. Return at most one primary deviation: the single most causal mismatch worth changing next. If there is no material deviation, return empty strings for all three primaryDeviation fields. Do not output an overall score, confidence, generic aesthetic praise, hidden reasoning, or unrelated image description.",
    `currentTarget=${JSON.stringify(target)}`,
    "Output exactly one JSON object matching the required schema."
  ].join("\n");
}

function normalizeCreativeEvaluationResult(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("视觉服务返回的结果对照格式不正确");
  }
  const summary = String(value.summary ?? "").trim();
  if (!summary) throw new Error("视觉服务没有返回对照摘要");
  const checks = (Array.isArray(value.checks) ? value.checks : []).flatMap((item) => {
    const criterion = String(item?.criterion ?? "").trim();
    const status = String(item?.status ?? "").trim();
    const evidence = String(item?.evidence ?? "").trim();
    if (!criterion || !["met", "partial", "missed", "conflict", "unknown"].includes(status) || !evidence) return [];
    return [{ criterion, status, evidence }];
  });
  const criterion = String(value.primaryDeviation?.criterion ?? "").trim();
  const finding = String(value.primaryDeviation?.finding ?? "").trim();
  const suggestedChange = String(value.primaryDeviation?.suggestedChange ?? "").trim();
  return {
    summary,
    checks,
    primaryDeviation: criterion && finding && suggestedChange
      ? { criterion, finding, suggestedChange }
      : null
  };
}

function parseJson(content) {
  const cleaned = String(content ?? "").trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  try {
    return JSON.parse(cleaned);
  } catch {
    throw new Error("视觉模型返回的 JSON 无效，本次没有写入");
  }
}

function extractOpenAIText(payload) {
  for (const item of Array.isArray(payload?.output) ? payload.output : []) {
    for (const content of Array.isArray(item?.content) ? item.content : []) {
      if (content?.type === "output_text" && content.text) return content.text;
    }
  }
  return "";
}

function extractOpenAIRefusal(payload) {
  for (const item of Array.isArray(payload?.output) ? payload.output : []) {
    for (const content of Array.isArray(item?.content) ? item.content : []) {
      if (content?.type === "refusal" && content.refusal) return String(content.refusal);
    }
  }
  return "";
}

function normalizeOpenAIUsage(value = {}) {
  return {
    inputTokens: finite(value.input_tokens),
    outputTokens: finite(value.output_tokens),
    totalTokens: finite(value.total_tokens)
  };
}

function normalizeCompatibleUsage(value = {}) {
  return {
    inputTokens: finite(value.prompt_tokens),
    outputTokens: finite(value.completion_tokens),
    totalTokens: finite(value.total_tokens)
  };
}

function finite(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? Math.round(number) : 0;
}

function positiveTokenBudget(value) {
  const number = Number(value);
  return Number.isInteger(number) && number >= 1000 ? number : 0;
}
