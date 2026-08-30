import {
  analysisTaxonomyPayload,
  validateAnalysisTagResponse,
  validateDetailOrganizationResponse
} from "./tag-taxonomy.js";
import { parseStructuredObject } from "./structured-output.js";
import { ANALYSIS_RETRY_POLICY } from "./analysis-retry-policy.js";
import {
  normalizeComposerAiProfile,
  normalizePlannerResult,
  plannerRequestPayload,
  assertComposerInputBudget,
  assertComposerRequestBudget,
  validateGeneratedPrompt
} from "./composer.js";
import {
  compileAgentAutoExecutionPrompt,
  compileAgentExecutionPrompt,
  compileAgentPlanningPrompt
} from "./composer-agent.js";
import { composerAutoResponseProtocolFacts, createComposerAutoResponseProjector } from "./composer-auto-response.js";
import { canonicalTextAnalysisInput } from "./analysis-input.js";

export const DEEPSEEK_ENDPOINT = "https://api.deepseek.com/chat/completions";
export const DEFAULT_ANALYSIS_MODEL = "deepseek-v4-flash";
export const DEFAULT_COMPOSER_STREAM_TIMEOUT_MS = 120_000;
export const DEFAULT_COMPOSER_REQUEST_TIMEOUT_MS = 120_000;
export const ANALYSIS_SERVICE_RETRY_LIMIT = ANALYSIS_RETRY_POLICY.serviceRetries;
export const ANALYSIS_CLAIM_TIMEOUT_MS = DEFAULT_COMPOSER_REQUEST_TIMEOUT_MS * (ANALYSIS_SERVICE_RETRY_LIMIT + 1) + 30_000;
const ANALYSIS_OUTPUT_CORRECTION_TIMEOUT_MS = DEFAULT_COMPOSER_REQUEST_TIMEOUT_MS / 2;
export const ANALYSIS_PROMPT_VERSION = 9;
export const ANALYSIS_OUTPUT_PROTOCOL_VERSION = 4;
export const DEFAULT_ANALYSIS_INSTRUCTIONS_BY_LOCALE = Object.freeze({
  "zh-CN": "提取最有助于搜索的稳定标签，通常 5–6 个；内容不足时少给，不确定或重复项省略。",
  en: "Extract the most useful stable search tags, usually 5–6; return fewer for sparse content and omit uncertain or duplicate items."
});

export class DeepSeekApiError extends Error {
  constructor(message, status = 0, options = {}) {
    super(message, options);
    this.name = "DeepSeekApiError";
    this.status = Number(status) || 0;
    this.retryAfterMs = Number(options.retryAfterMs) || 0;
    this.kind = options.kind || deepSeekErrorKind(this.status);
    this.retryable = [0, 408, 429, 500, 502, 503, 504].includes(this.status);
  }
}

export function deepSeekErrorDetails(error) {
  if (error?.name === "AbortError") {
    return { kind: "stopped", message: "已停止，本次不完整输出没有保存", retryable: false };
  }
  if (error instanceof DeepSeekApiError) {
    return { kind: error.kind, message: error.message, retryable: error.retryable };
  }
  if (error instanceof TypeError && /fetch|network|load/i.test(String(error.message ?? ""))) {
    return { kind: "network", message: "网络连接失败，请检查服务地址、权限或网络后重试", retryable: true };
  }
  return { kind: "unknown", message: error?.message || "AI 服务处理失败", retryable: false };
}

export function normalizeAiSettings(value = {}) {
  return {
    activeProvider: value.activeProvider === "compatible" ? "compatible" : "deepseek",
    apiKey: String(value.apiKey ?? "").trim(),
    consent: value.consent === true,
    analysisModel: String(value.analysisModel ?? "").trim() || DEFAULT_ANALYSIS_MODEL,
    analysisInstructionsByLocale: normalizeAnalysisInstructions(value.analysisInstructionsByLocale),
    compatible: {
      ...(String(value.compatible?.label ?? "").trim() ? { label: String(value.compatible.label).trim() } : {}),
      endpoint: String(value.compatible?.endpoint ?? "").trim(),
      model: String(value.compatible?.model ?? "").trim(),
      apiKey: String(value.compatible?.apiKey ?? "").trim(),
      structuredOutput: value.compatible?.structuredOutput === "prompt_only" ? "prompt_only" : "json_object",
      ...(positiveInteger(value.compatible?.structuredOutputTokenBudget)
        ? { structuredOutputTokenBudget: positiveInteger(value.compatible.structuredOutputTokenBudget) }
        : {})
    }
  };
}

export function mergeAiSettings(currentValue = {}, incomingValue = {}) {
  const current = normalizeAiSettings(currentValue);
  const incoming = incomingValue && typeof incomingValue === "object" ? incomingValue : {};
  const nextEndpoint = String(incoming.compatible?.endpoint ?? current.compatible.endpoint).trim();
  const currentOrigin = safeCompatibleOrigin(current.compatible.endpoint);
  const nextOrigin = safeCompatibleOrigin(nextEndpoint);
  const incomingCompatibleKey = String(incoming.compatible?.apiKey ?? "").trim();
  const credentialReset = Boolean(current.compatible.apiKey && currentOrigin && nextOrigin !== currentOrigin && !incomingCompatibleKey);
  const settings = normalizeAiSettings({
    activeProvider: incoming.activeProvider ?? current.activeProvider,
    analysisModel: incoming.analysisModel ?? current.analysisModel,
    apiKey: String(incoming.apiKey ?? "").trim() || current.apiKey,
    consent: incoming.consent === true,
    analysisInstructionsByLocale: {
      "zh-CN": incoming.analysisInstructionsByLocale?.["zh-CN"] ?? current.analysisInstructionsByLocale["zh-CN"],
      en: incoming.analysisInstructionsByLocale?.en ?? current.analysisInstructionsByLocale.en
    },
    compatible: {
      label: incoming.compatible?.label ?? current.compatible.label,
      endpoint: nextEndpoint,
      model: incoming.compatible?.model ?? current.compatible.model,
      apiKey: incomingCompatibleKey || (credentialReset ? "" : current.compatible.apiKey),
      structuredOutput: incoming.compatible?.structuredOutput ?? current.compatible.structuredOutput,
      structuredOutputTokenBudget: incoming.compatible?.structuredOutputTokenBudget
        ?? current.compatible.structuredOutputTokenBudget
    }
  });
  if (incoming.clearApiKey) {
    if (incoming.clearApiKey === "compatible") settings.compatible.apiKey = "";
    else settings.apiKey = "";
  }
  return { settings, credentialReset };
}

export function publicAiSettings(value = {}) {
  const settings = normalizeAiSettings(value);
  return {
    activeProvider: settings.activeProvider,
    analysisModel: settings.analysisModel,
    configured: settings.activeProvider === "compatible"
      ? Boolean(settings.compatible.endpoint && settings.compatible.model && (settings.compatible.apiKey || isLoopbackEndpoint(settings.compatible.endpoint)))
      : Boolean(settings.apiKey),
    consent: settings.consent,
    analysisInstructionsByLocale: structuredClone(settings.analysisInstructionsByLocale),
    compatible: {
      ...(settings.compatible.label ? { label: settings.compatible.label } : {}),
      endpoint: settings.compatible.endpoint,
      model: settings.compatible.model,
      configured: Boolean(settings.compatible.apiKey || isLoopbackEndpoint(settings.compatible.endpoint))
    }
  };
}

export function permissionPatternForAiSettings(value = {}) {
  const settings = normalizeAiSettings(value);
  return settings.activeProvider === "compatible" ? compatibleEndpoint(settings.compatible.endpoint).permissionPattern : "https://api.deepseek.com/*";
}

export async function analyzeTextWithDeepSeek(entry, catalogValue, settingsValue, fetchImpl = fetch, requestOptions = {}) {
  return (await analyzeTextDetailedWithDeepSeek(entry, catalogValue, settingsValue, fetchImpl, requestOptions)).tags;
}

export async function analyzeTextDetailedWithDeepSeek(entry, catalogValue, settingsValue, fetchImpl = fetch, requestOptions = {}) {
  const settings = requireAiSettings(settingsValue, "分析");
  const providerLabel = aiProvider(settings).label;
  const outputLocale = settingsValue?.outputLocale === "en" ? "en" : "zh-CN";
  const input = requestOptions.analysisInput || canonicalTextAnalysisInput(entry);
  if (!input.text) throw new Error(`这条案例没有文字，${providerLabel} 文字分析会跳过`);
  const systemMessages = [
    { role: "system", content: analysisSystemInstruction(outputLocale) },
    { role: "system", content: analysisTaxonomyPrompt(catalogValue, outputLocale) },
    { role: "system", content: settings.analysisInstructionsByLocale[outputLocale].slice(0, 1200) }
  ];
  const userMessage = { role: "user", content: analysisEntryInput(entry, input.text) };
  let usage = normalizeUsage();
  for (let outputAttempt = 0; outputAttempt < 2; outputAttempt += 1) {
    const attempt = outputAttempt ? "correction" : "initial";
    const messages = outputAttempt
      ? [...systemMessages, { role: "system", content: analysisOutputCorrection(outputLocale) }, userMessage]
      : [...systemMessages, userMessage];
    let result;
    const requestStartedAt = Date.now();
    emitAnalysisDiagnostic(requestOptions, "request_started", { attempt });
    try {
      result = await requestDeepSeek(structuredRequestBody({
        model: settings.analysisModel,
        thinking: { type: "disabled" },
        temperature: 0.1,
        max_tokens: settings.activeProvider === "compatible"
          ? settings.compatible.structuredOutputTokenBudget || 1000
          : 1000,
        messages
      }, settings), settings, {
        fetchImpl,
        signal: requestOptions.signal,
        timeoutMs: outputAttempt
          ? correctionRequestTimeout(requestOptions.timeoutMs)
          : requestOptions.timeoutMs,
        timeoutMessage: "AI 分析超时，本次没有写入任何标签"
      });
    } catch (error) {
      emitAnalysisDiagnostic(requestOptions, "request_failed", {
        attempt,
        elapsedMs: Date.now() - requestStartedAt,
        status: Number(error?.status) || 0,
        category: error?.name === "AbortError" ? "aborted" : Number(error?.status) === 408 ? "timeout" : "service"
      });
      if (outputAttempt) {
        error.analysisOutputCorrectionAttempt = true;
        error.usage = addNormalizedUsage(usage, error.usage);
      }
      throw error;
    }
    usage = addNormalizedUsage(usage, result.usage);
    try {
      const parsed = parseJsonObject(result.content, `${providerLabel} 返回格式不正确，本次没有写入任何标签`);
      const tagCount = Array.isArray(parsed.tags) ? parsed.tags.length : null;
      emitAnalysisDiagnostic(requestOptions, "response_received", {
        attempt,
        elapsedMs: Date.now() - requestStartedAt,
        tagCount
      });
      const normalizationDiagnostics = [];
      const tags = validateAnalysisTagResponse(parsed, catalogValue, { diagnostics: normalizationDiagnostics });
      emitAnalysisDiagnostic(requestOptions, "validation_succeeded", { attempt, tagCount: tags.length });
      return {
        tags,
        normalizationDiagnostics,
        attempts: { outputCorrectionRequests: outputAttempt },
        usage,
        model: result.model || settings.analysisModel,
        finishReason: result.finishReason
      };
    } catch (error) {
      emitAnalysisDiagnostic(requestOptions, "validation_failed", {
        attempt,
        category: analysisValidationCategory(error)
      });
      if (outputAttempt === 0) continue;
      error.usage = usage;
      throw error;
    }
  }
  throw new Error("AI 标签输出校验失败，本次没有写入");
}

export async function summarizeVisualSetWithAi(input, settingsValue, options = {}) {
  const settings = requireAiSettings(settingsValue, "总结整组图片");
  const result = await requestDeepSeek(structuredRequestBody({
    model: settings.analysisModel,
    thinking: { type: "disabled" },
    temperature: 0.1,
    max_tokens: 6000,
    messages: [
      { role: "system", content: String(options.instruction ?? "").trim() },
      { role: "user", content: JSON.stringify(input) }
    ]
  }, settings), settings, {
    fetchImpl: options.fetchImpl ?? fetch,
    signal: options.signal,
    timeoutMs: options.timeoutMs,
    timeoutMessage: "整组图片总结超时，已有逐图分析不会改变"
  });
  return {
    value: parseJsonObject(result.content, "整组图片总结返回格式无效"),
    usage: result.usage,
    model: result.model || settings.analysisModel,
    provider: settings.activeProvider
  };
}

function emitAnalysisDiagnostic(options, stage, detail = {}) {
  if (typeof options?.onDiagnostic !== "function") return;
  options.onDiagnostic({ stage, ...detail });
}

function analysisValidationCategory(error) {
  const message = String(error?.message ?? "");
  if (message.includes("未知分类路径")) return "unknown_path";
  if (message.includes("重复标签")) return "duplicate";
  if (message.includes("标签过长")) return "too_long";
  if (message.includes("未允许字段")) return "extra_fields";
  if (message.includes("必须返回")) return "count";
  if (message.includes("格式")) return "format";
  return "invalid";
}

export async function analysisProfileFingerprint(settingsValue = {}, outputLocale = "zh-CN") {
  const settings = normalizeAiSettings(settingsValue);
  const locale = outputLocale === "en" ? "en" : "zh-CN";
  const value = JSON.stringify({
    promptVersion: ANALYSIS_PROMPT_VERSION,
    protocolVersion: ANALYSIS_OUTPUT_PROTOCOL_VERSION,
    locale,
    provider: settings.activeProvider,
    model: settings.activeProvider === "compatible" ? settings.compatible.model : settings.analysisModel,
    instructions: settings.analysisInstructionsByLocale[locale]
  });
  const digest = await globalThis.crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function organizeDetailTagsWithDeepSeek(chunk, settingsValue, fetchImpl = fetch) {
  const settings = requireAiSettings(settingsValue, "整理三级标签");
  const result = await requestDeepSeek(structuredRequestBody({
    model: settings.analysisModel,
    thinking: { type: "disabled" },
    temperature: 0,
    max_tokens: 4000,
    messages: [
      {
        role: "system",
        content: "整理同一固定二级分组内的三级标签。统一明显同义、大小写、空格、标点和 Unicode 写法；不要跨组改变含义。只返回需要改名或合并的映射，不返回未变化项、理由或解释。严格 JSON：{\"m\":[{\"id\":\"旧标签ID\",\"n\":\"规范名称\"}]}"
      },
      { role: "user", content: JSON.stringify(chunk) }
    ]
  }, settings), settings, { fetchImpl, timeoutMessage: "AI 整理超时，正式标签库没有改变" });
  const parsed = parseJsonObject(result.content, "AI 整理结果格式无效，正式标签库没有改变");
  return {
    mappings: validateDetailOrganizationResponse(parsed, chunk),
    usage: result.usage,
    model: result.model || settings.analysisModel
  };
}

export async function planComposerTurn(input, settingsValue, options = {}) {
  const settings = requireAiSettings(settingsValue, "生成");
  const providerLabel = aiProvider(settings).label;
  const profile = normalizeComposerAiProfile(input.session?.aiProfile);
  assertComposerInputBudget(input.session, input.userMessage, input.composerSettings);
  const request = plannerRequestPayload(input.session, input.userMessage, input.composerSettings);
  const body = withComposerProfile(structuredRequestBody({
    model: profile.model,
    messages: [
      { role: "system", content: compileAgentPlanningPrompt({
        settings: input.composerSettings,
        targetType: request.targetType,
        routeMode: request.routeMode,
        outputLanguage: request.outputLanguage,
        productionReviewEnabled: request.productionReviewEnabled
      }) },
      { role: "user", content: JSON.stringify(request) }
    ]
  }, settings), profile);
  assertComposerRequestBudget(body.messages);
  const result = await requestDeepSeek(body, settings, {
    fetchImpl: options.fetchImpl ?? fetch,
    signal: options.signal,
    timeoutMs: options.timeoutMs,
    timeoutMessage: `${providerLabel} 规划超时，本次没有开始生成`
  });
  const parsed = parseJsonObject(result.content, `${providerLabel} 没有返回有效的 Agent 计划`);
  const latestUserMessage = [...request.messages].reverse().find((item) => item.role === "user")?.content ?? "";
  const planned = normalizePlannerResult(parsed, {
    route: request.routeMode === "auto" ? "compose" : request.routeMode,
    instruction: latestUserMessage
  });
  if (request.routeMode !== "auto" && planned.route !== request.routeMode) {
    throw new Error("Agent 改写了用户手动选择的任务，本次规划未采用");
  }
  return {
    ...planned,
    usage: result.usage,
    model: result.model || profile.model,
    finishReason: result.finishReason
  };
}

export async function streamComposedPrompt(input, settingsValue, options = {}) {
  const settings = requireAiSettings(settingsValue, "生成");
  const provider = aiProvider(settings);
  const profile = normalizeComposerAiProfile(input.session?.aiProfile);
  assertComposerInputBudget(input.session, input.userMessage, input.composerSettings);
  const request = plannerRequestPayload(input.session, input.userMessage, input.composerSettings);
  const instruction = String(input.instruction ?? "").trim()
    || [...request.messages].reverse().find((item) => item.role === "user")?.content
    || "";
  const executionRequest = { ...request, route: "compose", instruction };
  const body = withComposerProfile({
    model: profile.model,
    stream: true,
    stream_options: { include_usage: true },
    messages: [
      { role: "system", content: compileAgentExecutionPrompt({
        settings: input.composerSettings,
        route: "compose",
        targetType: request.targetType,
        outputLanguage: request.outputLanguage,
        productionReviewEnabled: request.productionReviewEnabled
      }) },
      { role: "user", content: JSON.stringify(executionRequest) }
    ]
  }, profile);
  assertComposerRequestBudget(body.messages);
  const requestController = new AbortController();
  const timeoutMs = Number.isFinite(options.timeoutMs) && options.timeoutMs > 0 ? options.timeoutMs : DEFAULT_COMPOSER_STREAM_TIMEOUT_MS;
  let timedOut = false;
  const onExternalAbort = () => requestController.abort();
  if (options.signal?.aborted) requestController.abort();
  options.signal?.addEventListener("abort", onExternalAbort, { once: true });
  const timeoutId = setTimeout(() => { timedOut = true; requestController.abort(); }, timeoutMs);
  let streamed;
  try {
    const response = await fetchDeepSeekStream(body, settings, options.fetchImpl ?? fetch, requestController.signal, options.onRequestStart);
    streamed = await readDeepSeekSse(response, options.onDelta, provider.label, provider.apiKey);
  } catch (error) {
    if (timedOut) throw new DeepSeekApiError(`${provider.label} 流式输出超时，本次结果未保存`, 408);
    throw error;
  } finally {
    clearTimeout(timeoutId);
    options.signal?.removeEventListener("abort", onExternalAbort);
  }
  const finalPrompt = validateGeneratedPrompt(streamed.content);
  return {
    finalPrompt,
    outputLanguage: request.outputLanguage,
    usage: streamed.usage,
    model: streamed.model || profile.model,
    finishReason: streamed.finishReason
  };
}

export async function executeAgentTurn(input, settingsValue, options = {}) {
  const route = ["auto", "compose", "analyze_materials", "chat"].includes(input.route)
    ? input.route
    : "chat";
  if (route === "compose") return { route, kind: "prompt", ...(await streamComposedPrompt(input, settingsValue, options)) };

  const settings = requireAiSettings(settingsValue, "对话");
  const profile = normalizeComposerAiProfile(input.session?.aiProfile);
  assertComposerInputBudget(input.session, input.userMessage, input.composerSettings);
  const request = plannerRequestPayload(input.session, input.userMessage, input.composerSettings);
  const instruction = String(input.instruction ?? "").trim()
    || [...request.messages].reverse().find((item) => item.role === "user")?.content
    || "";
  const executionRequest = { ...request, route, instruction };
  const promptInput = {
    settings: input.composerSettings,
    route,
    targetType: request.targetType,
    outputLanguage: request.outputLanguage
  };
  const automatic = route === "auto";
  const systemInstruction = automatic
    ? compileAgentAutoExecutionPrompt(promptInput)
    : compileAgentExecutionPrompt(promptInput);
  const projector = automatic ? createComposerAutoResponseProjector(options.onDelta) : null;

  const streamed = await streamAgentText({
    settings,
    profile,
    systemInstruction,
    executionRequest,
    options: automatic
      ? { ...options, onDelta: (_delta, cumulative) => projector.push(cumulative) }
      : options
  });
  if (automatic) {
    const parsed = projector.push(streamed.content, { final: true });
    const protocolFacts = composerAutoResponseProtocolFacts(parsed);
    if (parsed.status === "needs_clarification") {
      return {
        ...protocolFacts,
        route: parsed.route,
        kind: "question",
        text: parsed.visibleText,
        outputLanguage: request.outputLanguage,
        usage: streamed.usage,
        model: streamed.model || profile.model,
        finishReason: streamed.finishReason
      };
    }
    if (parsed.route === "compose") {
      return {
        ...protocolFacts,
        route: parsed.route,
        kind: "prompt",
        finalPrompt: validateGeneratedPrompt(parsed.visibleText),
        outputLanguage: request.outputLanguage,
        usage: streamed.usage,
        model: streamed.model || profile.model,
        finishReason: streamed.finishReason
      };
    }
    return {
      ...protocolFacts,
      route: parsed.route,
      kind: parsed.route === "analyze_materials" ? "analysis" : "chat",
      text: parsed.visibleText,
      outputLanguage: request.outputLanguage,
      usage: streamed.usage,
      model: streamed.model || profile.model,
      finishReason: streamed.finishReason
    };
  }
  return {
    route,
    kind: route === "analyze_materials" ? "analysis" : "chat",
    text: streamed.content,
    outputLanguage: request.outputLanguage,
    usage: streamed.usage,
    model: streamed.model || profile.model,
    finishReason: streamed.finishReason
  };
}

async function streamAgentText({ settings, profile, systemInstruction, executionRequest, options }) {
  const provider = aiProvider(settings);
  const body = withComposerProfile({
    model: profile.model,
    stream: true,
    stream_options: { include_usage: true },
    messages: [
      { role: "system", content: systemInstruction },
      { role: "user", content: JSON.stringify(executionRequest) }
    ]
  }, profile);
  assertComposerRequestBudget(body.messages);
  const controller = new AbortController();
  const timeoutMs = options.timeoutMs === null
    ? null
    : Number.isFinite(options.timeoutMs) && options.timeoutMs > 0 ? options.timeoutMs : DEFAULT_COMPOSER_STREAM_TIMEOUT_MS;
  let timedOut = false;
  const onAbort = () => controller.abort();
  if (options.signal?.aborted) controller.abort();
  options.signal?.addEventListener("abort", onAbort, { once: true });
  const timeoutId = timeoutMs === null ? null : setTimeout(() => { timedOut = true; controller.abort(); }, timeoutMs);
  try {
    const response = await fetchDeepSeekStream(body, settings, options.fetchImpl ?? fetch, controller.signal, options.onRequestStart);
    const result = await readDeepSeekSse(response, options.onDelta, provider.label, provider.apiKey);
    if (!String(result.content ?? "").trim()) throw new DeepSeekApiError(`${provider.label} 没有返回完整内容`, 422);
    return result;
  } catch (error) {
    if (timedOut) throw new DeepSeekApiError(`${provider.label} 流式输出超时，本次结果未保存`, 408);
    throw error;
  } finally {
    if (timeoutId !== null) clearTimeout(timeoutId);
    options.signal?.removeEventListener("abort", onAbort);
  }
}

export async function readDeepSeekSse(response, onDelta = () => undefined, providerLabel = "DeepSeek", apiKey = "") {
  if (!response?.body?.getReader) throw new DeepSeekApiError(`${providerLabel} 没有返回流式内容`, 503);
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let content = "";
  let usage = normalizeUsage();
  let model = "";
  let finishReason = "";
  let done = false;
  const consume = (block) => {
    const data = block.split(/\r?\n/).filter((line) => line.startsWith("data:"))
      .map((line) => line.slice(5).trimStart()).join("\n").trim();
    if (!data) return;
    if (data === "[DONE]") { done = true; return; }
    let event;
    try { event = JSON.parse(data); } catch { throw new DeepSeekApiError(`${providerLabel} 流式结果格式错误，本次结果未保存`, 422); }
    if (event?.error) throw new DeepSeekApiError(`${providerLabel} 流式生成失败：${redactSecret(String(event.error.message ?? "服务返回错误"), apiKey)}`, Number(event.error.status) || 503);
    model = String(event.model ?? model);
    if (event.usage) usage = normalizeUsage(event.usage);
    const choice = event.choices?.[0];
    const delta = String(choice?.delta?.content ?? "");
    if (delta) {
      content += delta;
      onDelta(delta, content);
    }
    if (choice?.finish_reason) finishReason = String(choice.finish_reason);
  };
  try {
    for (;;) {
      const { value, done: readerDone } = await reader.read();
      buffer += decoder.decode(value ?? new Uint8Array(), { stream: !readerDone });
      const blocks = buffer.split(/\r?\n\r?\n/);
      buffer = blocks.pop() ?? "";
      for (const block of blocks) consume(block);
      if (readerDone) break;
    }
    if (buffer.trim()) consume(buffer);
  } finally {
    reader.releaseLock?.();
  }
  if (finishReason === "length") throw new DeepSeekApiError(`${providerLabel} 输出被截断，本次结果未保存`, 422);
  if (finishReason === "content_filter") throw new DeepSeekApiError(`${providerLabel} 未能返回此内容，本次结果未保存`, 422);
  if (!done || finishReason !== "stop") throw new DeepSeekApiError(`${providerLabel} 流式输出意外中断，本次结果未保存`, 503);
  if (!content.trim()) throw new DeepSeekApiError(`${providerLabel} 没有返回完整提示词`, 503);
  return { content, usage, model, finishReason };
}

export function isRetryableDeepSeekError(error) {
  return error instanceof DeepSeekApiError && error.retryable && error.analysisOutputCorrectionAttempt !== true;
}

function requireAiSettings(value, action) {
  const settings = normalizeAiSettings(value);
  const provider = aiProvider(settings);
  if (!provider.apiKey && !provider.loopback) throw new Error("请先填写所选 AI 服务的 API Key");
  if (!provider.model) throw new Error("请先选择所选 AI 服务的模型");
  if (!settings.consent) throw new Error(settings.activeProvider === "deepseek"
    ? `请先确认：主动${action}时会把所选案例文字发送到 DeepSeek`
    : `请先确认：主动${action}时会把所选案例文字发送到所选 AI 服务`);
  return settings;
}

function structuredRequestBody(body, settings) {
  return settings.activeProvider === "compatible" && settings.compatible.structuredOutput === "prompt_only"
    ? body
    : { ...body, response_format: { type: "json_object" } };
}

async function requestDeepSeek(body, settings, options = {}) {
  const provider = aiProvider(settings);
  const requestModel = settings.activeProvider === "compatible" ? provider.model : body.model || provider.model;
  const fetchImpl = options.fetchImpl ?? fetch;
  const requestController = new AbortController();
  const timeoutMs = Number.isFinite(options.timeoutMs) && options.timeoutMs > 0
    ? options.timeoutMs
    : DEFAULT_COMPOSER_REQUEST_TIMEOUT_MS;
  let timedOut = false;
  const onExternalAbort = () => requestController.abort();
  if (options.signal?.aborted) requestController.abort();
  options.signal?.addEventListener("abort", onExternalAbort, { once: true });
  const timeoutId = setTimeout(() => {
    timedOut = true;
    requestController.abort();
  }, timeoutMs);
  let response;
  let payload = {};
  try {
    const requestBody = settings.activeProvider === "compatible"
      ? Object.fromEntries(Object.entries(body).filter(([key]) => key !== "thinking"))
      : body;
    response = await fetchImpl(provider.endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(provider.apiKey ? { Authorization: `Bearer ${provider.apiKey}` } : {}) },
      body: JSON.stringify({ ...requestBody, model: requestModel }),
      signal: requestController.signal
    });
    try {
      payload = await response.json();
    } catch (error) {
      if (error?.name === "AbortError") throw error;
      payload = {};
    }
  } catch (error) {
    if (timedOut) throw new DeepSeekApiError(options.timeoutMessage || `${provider.label} 请求超时，本次没有保存`, 408);
    if (error?.name === "AbortError") throw error;
    throw new DeepSeekApiError(`无法连接 ${provider.label}，请检查网络后重试`, 0, { cause: error });
  } finally {
    clearTimeout(timeoutId);
    options.signal?.removeEventListener("abort", onExternalAbort);
  }
  if (!response.ok) {
    throw new DeepSeekApiError(apiError(payload, response.status, provider), response.status, {
      retryAfterMs: retryAfterMilliseconds(response.headers?.get?.("retry-after"))
    });
  }
  const choice = payload?.choices?.[0];
  const finishReason = String(choice?.finish_reason ?? "");
  const content = choice?.message?.content;
  if (!content) throw new DeepSeekApiError(`${provider.label} 没有返回可用结果`, 503);
  if (!options.allowPartialContent && finishReason === "length") throw new DeepSeekApiError(`${provider.label} 输出被截断，本次结果未应用`, 422);
  if (!options.allowPartialContent && finishReason === "content_filter") throw new DeepSeekApiError(`${provider.label} 未能返回此内容，本次结果未应用`, 422);
  return {
    content,
    finishReason,
    model: String(payload?.model ?? requestModel),
    usage: normalizeUsage(payload?.usage)
  };
}

async function fetchDeepSeekStream(body, settings, fetchImpl, signal, onRequestStart) {
  const provider = aiProvider(settings);
  const requestModel = settings.activeProvider === "compatible" ? provider.model : body.model || provider.model;
  let response;
  try {
    const pending = Promise.resolve(fetchImpl(provider.endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(provider.apiKey ? { Authorization: `Bearer ${provider.apiKey}` } : {}) },
      body: JSON.stringify({ ...body, model: requestModel }),
      signal
    }));
    pending.catch(() => undefined);
    await notifyRequestStart(onRequestStart);
    response = await pending;
  } catch (error) {
    if (error?.name === "AbortError") throw error;
    throw new DeepSeekApiError(`无法连接 ${provider.label}，请检查网络后重试`, 0, { cause: error });
  }
  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    throw new DeepSeekApiError(apiError(payload, response.status, provider), response.status);
  }
  return response;
}

async function notifyRequestStart(onRequestStart) {
  try {
    await onRequestStart?.();
  } catch {
    // The provider request is already in flight; a local checkpoint failure must not create a paid retry window.
  }
}

function aiProvider(settingsValue) {
  const settings = normalizeAiSettings(settingsValue);
  if (settings.activeProvider === "compatible") {
    const details = compatibleEndpoint(settings.compatible.endpoint);
    return { endpoint: details.url, apiKey: settings.compatible.apiKey, model: settings.compatible.model, loopback: details.loopback, label: settings.compatible.label || "所选 AI 服务" };
  }
  return { endpoint: DEEPSEEK_ENDPOINT, apiKey: settings.apiKey, model: settings.analysisModel, loopback: false, label: "DeepSeek" };
}

function compatibleEndpoint(value) {
  let url;
  try { url = new URL(String(value ?? "")); }
  catch { throw new Error("OpenAI-compatible 接口地址无效"); }
  const loopback = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname.toLocaleLowerCase("en-US"));
  if (url.protocol !== "https:" && !(url.protocol === "http:" && loopback)) throw new Error("兼容接口只允许 HTTPS；本机 localhost 可使用 HTTP");
  if (url.username || url.password || url.search || url.hash) throw new Error("兼容接口地址不能包含账号、查询参数或片段");
  return { url: url.href, loopback, permissionPattern: `${url.origin}/*` };
}

function safeCompatibleOrigin(value) {
  try { return new URL(compatibleEndpoint(value).url).origin; }
  catch { return ""; }
}

function isLoopbackEndpoint(value) {
  try { return ["localhost", "127.0.0.1", "[::1]"].includes(new URL(String(value ?? "")).hostname.toLocaleLowerCase("en-US")); }
  catch { return false; }
}

function analysisSystemInstruction(outputLocale) {
  const languageRule = outputLocale === "en"
    ? "Write detail tag t in English; preserve standard spelling for proper names."
    : "三级标签 t 使用简体中文；作者、作品和模型等专名保留规范拼写。";
  return [
    "你是本地资料库的检索标签器。只依据给定文字，不猜测图片。",
    "只能选择下一条消息中的固定二级路径 g，不能创建路径。具体内容写入三级标签 t；没有明确三级词时省略 t，直接归入 g。",
    languageRule,
    "通常返回 5–6 个；内容不足时至少返回最确定的一个二级 g，可省略 t；必须为 1–10 个确定且不重复的标签，不凑数。",
    "只输出 JSON，不要理由、证据、置信度、解释或 Markdown：{\"tags\":[{\"g\":\"style.render\",\"t\":\"赛璐珞\"}]}"
  ].join("\n");
}

function analysisOutputCorrection(outputLocale) {
  return outputLocale === "en"
    ? "Correct the output: never return an empty tags array. For sparse content, return the single most certain fixedPaths g and omit t. Return 1–10 tags containing only g and optional t; JSON only."
    : "纠正输出：不能返回空 tags。内容稀疏时返回最确定的一个 fixedPaths 二级 g 并省略 t。返回 1–10 个仅含 g 和可选 t 的标签；仅输出 JSON。";
}

export function analysisProtocolDescription(outputLocale = "zh-CN") {
  return outputLocale === "en"
    ? "Input: fixed L1/L2 paths plus this case's content type, title, and text. Output: 1–10 compact g/t tags only. Existing detail tags, images, URLs, API keys, projects, and the library are never sent."
    : "输入：固定一二级路径，以及当前案例的内容类型、标题和原文。输出：仅 1–10 个紧凑 g/t 标签。不会发送已有三级标签、图片、网址、API Key、项目或整库数据。";
}

function normalizeAnalysisInstructions(value) {
  const source = value && typeof value === "object" ? value : {};
  return {
    "zh-CN": String(source["zh-CN"] ?? source.zh ?? "").trim() || DEFAULT_ANALYSIS_INSTRUCTIONS_BY_LOCALE["zh-CN"],
    en: String(source.en ?? "").trim() || DEFAULT_ANALYSIS_INSTRUCTIONS_BY_LOCALE.en
  };
}

export function analysisTaxonomyPrompt(catalogValue, outputLocale = "zh-CN") {
  return `fixedPaths=${analysisTaxonomyPayload(catalogValue, outputLocale)}`;
}

function analysisEntryInput(entry, textValue = entry?.text) {
  return JSON.stringify({
    contentType: String(entry.contentTypeName ?? "").trim() || "unknown",
    title: String(entry.title ?? ""),
    text: String(textValue ?? "")
  });
}

function withComposerProfile(body, profileValue) {
  const profile = normalizeComposerAiProfile(profileValue);
  const request = {
    ...body,
    model: profile.model,
    thinking: { type: profile.thinking ? "enabled" : "disabled" }
  };
  if (profile.thinking) request.reasoning_effort = "high";
  return request;
}

function deepSeekErrorKind(status) {
  if (status === 0) return "network";
  if (status === 408) return "timeout";
  if (status === 429) return "rate_limit";
  if (status >= 500) return "service";
  return "response";
}

function parseJsonObject(content, message) {
  try {
    return parseStructuredObject(content, message);
  } catch {
    throw new Error(message);
  }
}

function normalizeUsage(value = {}) {
  return {
    promptTokens: finite(value.prompt_tokens),
    completionTokens: finite(value.completion_tokens),
    totalTokens: finite(value.total_tokens),
    cacheHitTokens: finite(value.prompt_cache_hit_tokens),
    cacheMissTokens: finite(value.prompt_cache_miss_tokens)
  };
}

function addNormalizedUsage(left = {}, right = {}) {
  return Object.fromEntries([
    "promptTokens", "completionTokens", "totalTokens", "cacheHitTokens", "cacheMissTokens"
  ].map((key) => [key, finite(left[key]) + finite(right[key])]));
}

function correctionRequestTimeout(value) {
  const requested = Number(value);
  return Number.isFinite(requested) && requested > 0
    ? Math.min(requested, ANALYSIS_OUTPUT_CORRECTION_TIMEOUT_MS)
    : ANALYSIS_OUTPUT_CORRECTION_TIMEOUT_MS;
}

function finite(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? Math.round(number) : 0;
}

function positiveInteger(value) {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : 0;
}

function retryAfterMilliseconds(value) {
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1000;
  const date = Date.parse(String(value ?? ""));
  return Number.isFinite(date) ? Math.max(0, date - Date.now()) : 0;
}

function apiError(payload, status, provider = {}) {
  const label = provider.label || "AI 服务";
  const detail = redactSecret(String(payload?.error?.message ?? "").trim(), provider.apiKey);
  if (status === 401) return `${label} API Key 无效或已失效`;
  if (status === 402) return `${label} 余额不足，请充值后继续`;
  if (status === 429) return `${label} 请求过于频繁，请稍后重试`;
  if (status === 500 || status === 503) return `${label} 服务暂时不可用，请稍后重试`;
  return `${label} 分析失败${detail ? `：${detail}` : `（HTTP ${status}）`}`;
}

function redactSecret(value, secretValue) {
  const secret = String(secretValue ?? "").trim();
  return secret ? String(value ?? "").split(secret).join("[已隐藏 API Key]") : String(value ?? "");
}
