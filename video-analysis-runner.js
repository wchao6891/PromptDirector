import { getMediaBlob } from "./media-store.js";
import { chunkedBlobFingerprint } from "./local-media.js";
import { runScheduledAnalysisWithRetries } from "./analysis-scheduler.js";
import { createAnalysisRequestBudget, consumeAnalysisRequest } from "./analysis-retry-policy.js";
import {
  analyzeVideoWithChatCompletions,
  analyzeVideoWithGemini,
  analyzeVideoWithOpenRouter,
  chatCompletionsVideoSourcePlan,
  VIDEO_ANALYSIS_REQUEST_TIMEOUT_MS
} from "./video-analysis.js";

const DEFAULT_ADAPTERS = Object.freeze({
  gemini: analyzeVideoWithGemini,
  chat_completions: analyzeVideoWithChatCompletions,
  openrouter: analyzeVideoWithOpenRouter
});

export async function runVideoAnalysisJob(jobValue, context = {}) {
  const job = normalizeJob(jobValue);
  const loadVideo = context.loadVideo ?? getMediaBlob;
  const fingerprint = context.fingerprint ?? chunkedBlobFingerprint;
  const adapters = context.adapters ?? DEFAULT_ADAPTERS;
  const now = context.now ?? (() => Date.now());
  const controller = new AbortController();
  const forwardAbort = () => controller.abort(context.signal?.reason ?? abortError());
  if (context.signal?.aborted) throw context.signal.reason ?? abortError();
  context.signal?.addEventListener("abort", forwardAbort, { once: true });
  const remainingMs = Math.max(0, job.deadlineAt - now());
  const timeoutError = videoTimeoutError();
  let timeoutId;
  const timeout = new Promise((_, reject) => {
    timeoutId = setTimeout(() => {
      controller.abort(timeoutError);
      reject(timeoutError);
    }, remainingMs);
  });
  let rejectAbort;
  const aborted = new Promise((_, reject) => { rejectAbort = () => reject(controller.signal.reason ?? abortError()); });
  controller.signal.addEventListener("abort", rejectAbort, { once: true });
  try {
    if (!remainingMs) throw timeoutError;
    const execution = executeVideoAnalysisJob(job, {
      loadVideo,
      fingerprint,
      adapters,
      signal: controller.signal,
      progress: context.progress,
      wait: context.wait,
      requestTimeoutMs: remainingMs
    });
    const result = await Promise.race([execution, timeout, aborted]);
    controller.signal.throwIfAborted();
    if (now() >= job.deadlineAt) throw timeoutError;
    return result;
  } finally {
    clearTimeout(timeoutId);
    controller.signal.removeEventListener("abort", rejectAbort);
    context.signal?.removeEventListener("abort", forwardAbort);
  }
}

async function executeVideoAnalysisJob(job, context) {
  await context.progress?.({ phase: "encoding", providerMayHaveAccepted: false });
  const videoBlob = job.asset.storageMode === "managed" ? await context.loadVideo(job.asset.id) : null;
  if (job.asset.storageMode === "managed" && !(videoBlob instanceof Blob)) {
    throw new Error("本地视频文件缺失，无法分析");
  }
  const sourceFingerprint = videoBlob ? await context.fingerprint(videoBlob) : "";
  context.signal.throwIfAborted();
  if (job.sourceFingerprint) {
    if (!sourceFingerprint || sourceFingerprint !== job.sourceFingerprint) {
      throw new Error("视频文件在发送前已经变化，未发送");
    }
  }
  const sourceUrl = job.sourceKind === "local-video" ? "" : job.asset.referenceUrl || job.asset.sourceUrl;
  const preferPublicVideoUrl = job.sourceKind === "local-video" ? false : job.route.preferPublicVideoUrl;
  const sourcePlan = job.route.protocol === "chat_completions" || job.route.protocol === "openrouter"
    ? chatCompletionsVideoSourcePlan({
        providerLabel: job.route.providerLabel,
        videoBlob,
        videoUrl: sourceUrl,
        videoMimeType: videoBlob?.type || job.asset.mimeType,
        referenceProvider: job.asset.referenceProvider,
        referencePlaybackMode: job.asset.referencePlaybackMode,
        localVideo: job.route.localVideo,
        preferPublicVideoUrl,
        publicVideoUrl: job.route.publicVideoUrl
      }).sourceKind
    : videoBlob ? "local-video" : "public-video-url";
  if (job.sourceKind && job.sourceKind !== sourcePlan) {
    throw new Error("视频来源发送方式已经变化，未发送");
  }
  const analyzeVideo = context.adapters[job.route.protocol];
  if (!analyzeVideo) throw new Error(`${job.route.providerLabel} 的视频理解请求协议当前版本尚未适配`);
  const requestBudget = createAnalysisRequestBudget();
  let correcting = false;
  const usage = { inputTokens: 0, outputTokens: 0, totalTokens: 0 };
  const accumulateUsage = (value) => {
    for (const key of Object.keys(usage)) usage[key] = usage[key] === null || !Number.isFinite(value?.[key])
      ? null : usage[key] + value[key];
  };
  const request = async () => {
    const before = requestBudget.providerCalls;
    try {
      const result = await analyzeVideo({
    apiKey: job.route.apiKey,
    endpoint: job.route.endpoint,
    providerLabel: job.route.providerLabel,
    model: job.route.model,
    mode: "visual-reconstruction",
    instruction: correcting
      ? `${job.instruction}\nThe previous response did not satisfy the required output. Return one complete JSON object matching the fixed protocol, grounded only in actual observable or audible evidence; no markdown or commentary.`
      : job.instruction,
    includeTags: true,
    requestId: requestBudget.providerCalls ? `${job.attemptId}:${requestBudget.providerCalls + 1}` : job.attemptId,
    onRequestStart: async () => {
      context.signal.throwIfAborted();
      consumeAnalysisRequest(requestBudget, correcting && !requestBudget.outputCorrectionRequests ? "correction" : "primary");
      await context.progress?.({
        phase: correcting ? "correcting" : requestBudget.providerCalls > 1 ? "retrying" : "analyzing",
        providerMayHaveAccepted: false,
        requestBudget: { ...requestBudget },
        requestId: requestBudget.providerCalls > 1 ? `${job.attemptId}:${requestBudget.providerCalls}` : job.attemptId
      });
    },
    maxOutputTokens: job.route.maxOutputTokens,
    catalog: job.catalog,
    locale: job.outputLocale,
    durationMs: job.asset.durationMs,
    width: job.asset.width,
    height: job.asset.height,
    videoBlob,
    videoUrl: sourceUrl,
    youtubeUrl: sourceUrl,
    videoMimeType: job.asset.mimeType,
    referenceProvider: job.asset.referenceProvider,
    referencePlaybackMode: job.asset.referencePlaybackMode,
    localVideo: job.route.localVideo,
    preferPublicVideoUrl,
    publicVideoUrl: job.route.publicVideoUrl,
    signal: context.signal,
    onStage: (phase) => context.progress?.({
      phase: phase === "analyzing" && correcting ? "correcting" : phase,
      requestBudget: { ...requestBudget },
      providerMayHaveAccepted: phase === "analyzing"
    })
      }, { requestTimeoutMs: context.requestTimeoutMs });
      if (requestBudget.providerCalls > before) accumulateUsage(result.diagnostic ?? result.usage);
      return result;
    } catch (error) {
      if (requestBudget.providerCalls > before) accumulateUsage(error.usage);
      throw error;
    }
  };
  try {
    const analysis = await runScheduledAnalysisWithRetries({
      key: `${job.route.providerId || job.route.protocol}:${job.route.model}:videoAnalysis`,
      concurrency: job.route.concurrency || 1,
      signal: context.signal,
      requestBudget,
      wait: context.wait,
      task: async () => {
        try { return await request(); }
        catch (error) {
          if (error?.recovery !== "correct" || requestBudget.outputCorrectionRequests || requestBudget.providerCalls >= requestBudget.maxProviderCalls) throw error;
          correcting = true;
          return request();
        }
      }
    });
    await context.progress?.({ phase: "completed", requestBudget, diagnostic: analysis.diagnostic });
    return { ...analysis, sourceFingerprint, requestBudget,
      ...(requestBudget.providerCalls > 1 ? { usage, cost: null } : {}) };
  } catch (error) {
    error.requestBudget = { ...requestBudget };
    error.usage = usage;
    throw error;
  }
}

function normalizeJob(value = {}) {
  const deadlineAt = Date.parse(String(value.deadlineAt ?? ""));
  if (!String(value.taskId ?? "").trim() || !String(value.attemptId ?? "").trim()) {
    throw new Error("视频分析任务标识无效");
  }
  if (!Number.isFinite(deadlineAt)) throw new Error("视频分析截止时间无效");
  return {
    ...structuredClone(value),
    taskId: String(value.taskId).trim(),
    attemptId: String(value.attemptId).trim(),
    deadlineAt,
    instruction: String(value.instruction ?? "").trim(),
    sourceKind: String(value.sourceKind ?? "").trim(),
    sourceFingerprint: String(value.sourceFingerprint ?? "").trim(),
    outputLocale: value.outputLocale === "en" ? "en" : "zh-CN",
    asset: { ...(value.asset ?? {}) },
    route: { ...(value.route ?? {}) }
  };
}

function videoTimeoutError() {
  const error = new Error(`视频分析等待已达 ${VIDEO_ANALYSIS_REQUEST_TIMEOUT_MS / 60_000} 分钟，未保存结果`);
  error.code = "VIDEO_ANALYSIS_TIMEOUT";
  error.status = 408;
  return error;
}

function abortError() {
  return new DOMException("The operation was aborted", "AbortError");
}
