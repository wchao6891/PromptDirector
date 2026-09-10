// Keep protocol facts, never prompts, media, upstream messages or reasoning text.
const statuses = new WeakMap();
const TRANSIENT = new Set([429, 500, 502, 503, 504]);
export class AnalysisResponseError extends Error {
  constructor(code, message, facts = {}, recovery = "none") {
    super(message);
    this.name = "AnalysisResponseError";
    this.code = this.kind = code;
    this.recovery = recovery;
    this.retryable = recovery === "retry";
    this.diagnostic = sanitizeAnalysisDiagnostic({ ...facts, code, recovery });
    this.status = this.diagnostic.httpStatus ?? 0;
    this.usage = Object.fromEntries(["inputTokens", "outputTokens", "totalTokens"].map((key) => [key, this.diagnostic[key]]));
  }
}
export function sanitizeAnalysisDiagnostic(value = {}) {
  const id = (key) => {
    const text = String(value[key] ?? "");
    return /^[a-zA-Z0-9_.:/-]{1,160}$/.test(text) && !/sk-|bearer|[a-f0-9]{32}\.|[a-f0-9]{64}/i.test(text) ? text : null;
  };
  const count = (key) => Number.isFinite(value[key]) && value[key] >= 0 ? value[key] : null;
  return {
    code: id("code"), recovery: ["retry", "correct", "none"].includes(value.recovery) ? value.recovery : "none",
    httpStatus: count("httpStatus"), providerCode: id("providerCode"), finishReason: id("finishReason"),
    responseId: id("responseId"), model: id("model"), protocol: id("protocol"), contentLength: count("contentLength"),
    reasoningPresent: typeof value.reasoningPresent === "boolean" ? value.reasoningPresent : null,
    inputTokens: count("inputTokens"), outputTokens: count("outputTokens"), totalTokens: count("totalTokens")
  };
}

export function analysisDiagnosticSummary(value, budget = {}) {
  const facts = sanitizeAnalysisDiagnostic(value);
  const fields = [["model", facts.model], ["HTTP", facts.httpStatus], ["finish", facts.finishReason],
    ["code", facts.code], ["providerCode", facts.providerCode], ["response", facts.responseId],
    ["contentLength", facts.contentLength], ["inputTokens", facts.inputTokens], ["outputTokens", facts.outputTokens],
    ["requests", Number.isInteger(budget.providerCalls) ? budget.providerCalls : null],
    ["corrections", Number.isInteger(budget.outputCorrectionRequests) ? budget.outputCorrectionRequests : null]];
  return fields.map(([label, value]) => `${label}: ${value ?? "unknown"}`).join(" · ");
}
export async function readAnalysisJson(response, provider = "AI 服务") {
  let payload;
  try { payload = await response.json(); }
  catch (error) {
    if (error?.name === "AbortError") throw error;
    if (!response.ok) throw httpFailure(response, {}, provider);
    throw new AnalysisResponseError("invalid_response_json", `${provider} 返回的响应不是完整 JSON，本次结果未保存`, { httpStatus: response.status });
  }
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) throw new AnalysisResponseError("invalid_response_json", `${provider} 返回的响应结构无效，本次结果未保存`, { httpStatus: response.status });
  statuses.set(payload, response.status ?? null);
  if (!response.ok) throw httpFailure(response, payload, provider);
  if (payload.error) {
    const error = providerFailure(payload, { httpStatus: response.status }, provider);
    error.retryAfterMs = retryAfter(response);
    throw error;
  }
  return payload;
}
export function inspectAnalysisResponse(payload, { protocol = "chat_completions", provider = "AI 服务" } = {}) {
  const choice = payload?.choices?.[0];
  const candidate = payload?.candidates?.[0];
  const reason = protocol === "gemini" ? candidate?.finishReason : protocol === "responses"
    ? payload?.incomplete_details?.reason || (payload?.status === "completed" ? "stop" : payload?.status) : choice?.finish_reason;
  const parts = protocol === "gemini" ? candidate?.content?.parts : protocol === "responses"
    ? (payload?.output ?? []).flatMap((item) => item?.type === "reasoning" ? [] : item?.content ?? []) : choice?.message?.content;
  const text = protocol === "responses" && typeof payload?.output_text === "string" ? payload.output_text.trim() : responseText(parts);
  const usage = payload?.usage ?? payload?.usageMetadata ?? {};
  const facts = {
    protocol, httpStatus: statuses.get(payload) ?? null, finishReason: reason ?? null,
    responseId: payload?.request_id ?? payload?.id ?? payload?.responseId, model: payload?.model ?? payload?.modelVersion,
    contentLength: text.length, reasoningPresent: Boolean(choice?.message?.reasoning_content) || (Array.isArray(parts) && parts.some((part) => part?.thought === true)),
    inputTokens: usage.prompt_tokens ?? usage.input_tokens ?? usage.promptTokenCount,
    outputTokens: usage.completion_tokens ?? usage.output_tokens ?? usage.candidatesTokenCount, totalTokens: usage.total_tokens ?? usage.totalTokenCount
  };
  if (payload?.error) throw providerFailure(payload, facts, provider);
  if (["length", "MAX_TOKENS", "max_output_tokens"].includes(reason)) throw new AnalysisResponseError("output_truncated", `${provider} 输出达到长度上限，被截断，本次结果未保存`, facts);
  if (["content_filter", "SAFETY", "RECITATION", "BLOCKLIST", "PROHIBITED_CONTENT", "SPII", "IMAGE_SAFETY"].includes(reason) || payload?.promptFeedback?.blockReason || choice?.message?.refusal || (Array.isArray(parts) && parts.some((part) => part?.type === "refusal"))) throw new AnalysisResponseError("output_refused", `${provider} 因内容过滤或拒绝未返回分析结果，本次结果未保存`, facts);
  if (reason === "insufficient_system_resource") throw new AnalysisResponseError("provider_unavailable", `${provider} 资源暂时不足`, facts, "retry");
  if (reason && !["stop", "STOP"].includes(reason)) throw new AnalysisResponseError("incomplete_output", `${provider} 未正常完成输出，本次结果未保存`, facts);
  if (!text) throw new AnalysisResponseError("empty_output", `${provider} 返回了空的 JSON 内容，响应缺少可用内容，本次结果未保存`, facts, ["stop", "STOP"].includes(reason) ? "correct" : "none");
  return { text, diagnostic: sanitizeAnalysisDiagnostic(facts) };
}
function responseText(value) {
  if (typeof value === "string") return value.trim();
  return (Array.isArray(value) ? value : []).filter((part) => !part?.thought && !["reasoning", "thinking", "refusal"].includes(part?.type))
    .map((part) => typeof part?.text === "string" ? part.text : typeof part?.content === "string" ? part.content : "").filter(Boolean).join("\n\n").trim();
}
function providerFailure(payload, facts, provider) {
  const providerCode = payload?.error?.code ?? payload?.error?.type;
  return new AnalysisResponseError("provider_error", `${provider} 返回服务错误（${Number(providerCode) || "未提供状态码"}），本次结果未保存`, { ...facts, providerCode }, TRANSIENT.has(Number(providerCode)) ? "retry" : "none");
}

function httpFailure(response, payload, provider) {
  const status = Number(response.status);
  const reason = [401, 403].includes(status) ? "认证或模型权限不足，请检查服务设置"
    : status === 429 ? "请求过于频繁，请稍后重试"
    : status >= 500 ? "服务暂时不可用" : "请求失败，请检查模型和输入支持";
  const permanent = /insufficient_quota|insufficient_balance|billing|credit/i.test(String(payload?.error?.code ?? payload?.error?.type ?? ""));
  const error = new AnalysisResponseError("provider_http_error", `${provider} ${reason}（HTTP ${status}），本次结果未保存`, {
    httpStatus: status, providerCode: payload?.error?.code ?? payload?.error?.type
  }, TRANSIENT.has(status) && !permanent ? "retry" : "none");
  error.retryAfterMs = retryAfter(response);
  return error;
}

function retryAfter(response) {
  const value = response.headers?.get?.("retry-after");
  if (!value) return 0;
  const seconds = Number(value);
  return Number.isFinite(seconds) ? Math.max(0, seconds * 1000) : Math.max(0, Date.parse(value) - Date.now()) || 0;
}

export async function fetchAnalysisJson(fetchImpl, url, init, { signal, timeoutMs, provider = "AI 服务" } = {}) {
  signal?.throwIfAborted();
  const controller = new AbortController();
  const forward = () => controller.abort(signal.reason);
  signal?.addEventListener("abort", forward, { once: true });
  let response;
  let timer;
  let onAbort;
  const aborted = new Promise((_, reject) => {
    onAbort = () => reject(controller.signal.reason ?? new DOMException("已停止", "AbortError"));
    controller.signal.addEventListener("abort", onAbort, { once: true });
  });
  if (Number.isFinite(timeoutMs) && timeoutMs > 0) timer = setTimeout(() => {
    const error = new AnalysisResponseError("request_timeout", `${provider} 等待超时，本次结果未保存`, { httpStatus: response?.status });
    error.status = 408;
    controller.abort(error);
  }, timeoutMs);
  try {
    return await Promise.race([aborted, (async () => {
      response = await fetchImpl(url, { ...init, signal: controller.signal });
      const payload = await readAnalysisJson(response, provider);
      controller.signal.throwIfAborted();
      return { response, payload };
    })()]);
  } catch (error) {
    if (error?.diagnostic || error?.name === "AbortError") throw error;
    throw new AnalysisResponseError("network_unknown", `${provider} 连接中断，执行状态未知，请检查网络；本次未保存`, { httpStatus: response?.status });
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", forward);
    controller.signal.removeEventListener("abort", onAbort);
  }
}
