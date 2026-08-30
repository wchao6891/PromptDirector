import { ANALYSIS_PROMPT_VERSION, DEFAULT_ANALYSIS_MODEL } from "./deepseek.js";
import { applyTextAnalysisTags } from "./analysis-candidates.js";
import { canonicalTextAnalysisInput } from "./analysis-input.js";
import {
  analysisRevisionMeta,
  entryTextRevision,
  hasPriorTextAnalysis,
  textAnalysisReason
} from "./analysis-revision.js";
import { prepareFacetRebuild, validateAnalysisTagResponse } from "./tag-taxonomy.js";
import { currentVideoReconstruction, entryMediaAssets, primaryImageAsset } from "./media.js";
import { ANALYSIS_RETRY_POLICY } from "./analysis-retry-policy.js";

export const ANALYSIS_BATCH_VERSION = 2;
export const ANALYSIS_BATCH_CONCURRENCY = 20;
export const VISION_BATCH_CONCURRENCY = 10;
export const VIDEO_BATCH_CONCURRENCY = 2;

export async function previewAnalysisBatch(entries = [], options = {}) {
  const eligible = [];
  const mode = ["reanalyze", "rebuild"].includes(options.mode) ? "rebuild" : "incremental";
  const profileFingerprint = String(options.profileFingerprint ?? "").trim();
  for (const entry of Array.isArray(entries) ? entries : []) {
    const { text, assetId, textRevision } = canonicalTextAnalysisInput(entry);
    if (!entry?.id || !text) continue;
    const reason = mode === "rebuild" ? "explicit_reanalysis" : textAnalysisReason(entry);
    if (!reason) continue;
    eligible.push({
      entryId: entry.id,
      textRevision,
      ...(assetId ? { assetId } : {}),
      characterCount: text.length,
      title: String(entry.title ?? ""),
      reason
    });
  }
  const reasonCounts = eligible.reduce((counts, item) => {
    counts[item.reason] += 1;
    return counts;
  }, { missing_analysis: 0, text_changed: 0, explicit_reanalysis: 0 });
  return {
    mode,
    analysisModel: String(options.analysisModel ?? "").trim() || DEFAULT_ANALYSIS_MODEL,
    profileFingerprint,
    caseCount: eligible.length,
    totalCharacters: eligible.reduce((sum, item) => sum + item.characterCount, 0),
    caseTextCharacters: eligible.reduce((sum, item) => sum + item.characterCount, 0),
    fixedTaxonomyCharacters: Math.max(0, Number(options.fixedTaxonomyCharacters) || 0),
    estimatedRequestCount: eligible.length,
    reasonCounts,
    entries: eligible
  };
}

export async function backfillLegacyAnalysisMeta(entries = []) {
  let updatedCount = 0;
  const next = [];
  for (const entry of Array.isArray(entries) ? entries : []) {
    const { text } = canonicalTextAnalysisInput(entry);
    if (!entry?.id || !text || entry.analysisMeta || !hasPriorTextAnalysis(entry)) {
      next.push(entry);
      continue;
    }
    next.push({
      ...entry,
      analysisMeta: {
        ...analysisRevisionMeta(entry),
        promptVersion: ANALYSIS_PROMPT_VERSION,
        model: "previous-analysis",
        analyzedAt: String(entry.analyzedAt ?? ""),
        usage: emptyUsage()
      }
    });
    updatedCount += 1;
  }
  return { entries: next, updatedCount };
}

export async function createAnalysisBatchJob(entries, options = {}) {
  const preview = await previewAnalysisBatch(entries, options);
  if (!preview.caseCount) throw new Error("没有需要批量分析的文字案例");
  const now = String(options.now ?? new Date().toISOString());
  const jobId = String(options.id ?? "").trim() || `analysis:${globalThis.crypto.randomUUID()}`;
  return {
    version: ANALYSIS_BATCH_VERSION,
    kind: "text_tags",
    mode: preview.mode,
    id: jobId,
    status: "running",
    createdAt: now,
    updatedAt: now,
    analysisModel: preview.analysisModel,
    providerId: String(options.providerId ?? "").trim(),
    model: preview.analysisModel,
    outputProtocol: String(options.outputProtocol ?? "json_object").trim(),
    retryPolicy: structuredClone(ANALYSIS_RETRY_POLICY),
    outputLocale: options.outputLocale === "en" ? "en" : "zh-CN",
    promptVersion: ANALYSIS_PROMPT_VERSION,
    profileFingerprint: preview.profileFingerprint,
    concurrency: normalizeConcurrency(options.concurrency, ANALYSIS_BATCH_CONCURRENCY),
    catalogRevision: Number(options.catalogRevision) || 0,
    resultCatalogRevision: null,
    totalCharacters: preview.totalCharacters,
    fixedTaxonomyCharacters: preview.fixedTaxonomyCharacters,
    items: preview.entries.map((item) => ({
      entryId: item.entryId,
      textRevision: item.textRevision,
      ...(item.assetId ? { assetId: item.assetId } : {}),
      fingerprint: "",
      status: "pending",
      attempts: 0,
      claimId: "",
      error: "",
      statusCode: 0
    })),
    usage: emptyUsage()
  };
}

export function previewVisionBatch(entries = [], options = {}) {
  const selected = new Set((Array.isArray(options.entryIds) ? options.entryIds : []).map(String));
  const includeAllImages = options.includeAllImages === true;
  const reanalyze = options.reanalyze === true;
  const items = [];
  let skippedAnalyzedCount = 0;
  for (const entry of Array.isArray(entries) ? entries : []) {
    if (!selected.has(String(entry?.id ?? ""))) continue;
    const visuals = entryMediaAssets(entry).filter((asset) => asset.kind === "image" && asset.usage !== "poster");
    const candidates = includeAllImages
      ? visuals
      : [primaryImageAsset(entry)].filter(Boolean);
    for (const visual of candidates) {
      if (!visual?.id) continue;
      const hasCompleteAnalysis = hasReusableVisionAnalysis(visual);
      if (!reanalyze && hasCompleteAnalysis) {
        skippedAnalyzedCount += 1;
        continue;
      }
      items.push({
        entryId: String(entry.id),
        visualId: String(visual.id),
        title: String(entry.title ?? ""),
        alreadyAnalyzed: hasCompleteAnalysis
      });
    }
  }
  return {
    kind: "vision",
    caseCount: new Set(items.map((item) => item.entryId)).size,
    requestCount: items.length,
    skippedAnalyzedCount,
    includeAllImages,
    reanalyze,
    providerType: options.providerType === "compatible" ? "compatible" : "openai",
    model: String(options.model ?? "").trim(),
    items
  };
}

function hasReusableVisionAnalysis(visual = {}) {
  const analysis = visual?.visionAnalysis;
  if (!analysis || analysis.quality === "partial") return false;
  if (!String(analysis.reconstructionPrompt ?? "").trim()) return false;
  return Array.isArray(analysis.tags)
    && analysis.tags.some((tag) => String(tag?.g ?? "").trim() && String(tag?.t ?? "").trim());
}

export function createVisionBatchJob(entries = [], options = {}) {
  const preview = previewVisionBatch(entries, options);
  if (!preview.requestCount) throw new Error("没有需要批量分析的图片");
  const now = String(options.now ?? new Date().toISOString());
  return {
    version: ANALYSIS_BATCH_VERSION,
    kind: "vision",
    id: String(options.id ?? "").trim() || `analysis:${globalThis.crypto.randomUUID()}`,
    status: "running",
    createdAt: now,
    updatedAt: now,
    outputLocale: options.outputLocale === "en" ? "en" : "zh-CN",
    providerType: preview.providerType,
    providerId: String(options.providerId ?? "").trim(),
    model: preview.model,
    outputProtocol: String(options.outputProtocol ?? "json_object").trim(),
    retryPolicy: structuredClone(ANALYSIS_RETRY_POLICY),
    includeAllImages: preview.includeAllImages,
    reanalyze: preview.reanalyze,
    concurrency: normalizeConcurrency(options.concurrency, VISION_BATCH_CONCURRENCY),
    requestCount: preview.requestCount,
    skippedAnalyzedCount: preview.skippedAnalyzedCount,
    items: preview.items.map((item) => ({
      entryId: item.entryId,
      visualId: item.visualId,
      fingerprint: "",
      status: "pending",
      attempts: 0,
      claimId: "",
      error: "",
      statusCode: 0
    })),
    usage: emptyUsage()
  };
}

export function previewVideoBatch(entries = [], options = {}) {
  const selected = new Set((Array.isArray(options.entryIds) ? options.entryIds : []).map(String));
  const includeAllVideos = options.includeAllVideos === true;
  const reanalyze = options.reanalyze === true;
  const sendable = new Set((Array.isArray(options.sendableAssetIds) ? options.sendableAssetIds : []).map(String));
  const snapshots = new Map((Array.isArray(options.assetSnapshots) ? options.assetSnapshots : []).map((item) => [
    `${String(item?.entryId ?? "")}\u0000${String(item?.assetId ?? "")}`,
    item
  ]));
  const items = [];
  let skippedAnalyzedCount = 0;
  let excludedCount = 0;
  for (const entry of Array.isArray(entries) ? entries : []) {
    if (!selected.has(String(entry?.id ?? ""))) continue;
    const videos = entryMediaAssets(entry).filter((asset) => asset.kind === "video" && asset.usage !== "poster");
    const primary = videos.find((asset) => asset.id === entry.primaryMediaId) || videos[0];
    const candidates = includeAllVideos ? videos : [primary].filter(Boolean);
    for (const asset of candidates) {
      if (!asset?.id || asset.storageMode !== "managed" || !sendable.has(asset.id)) {
        excludedCount += 1;
        continue;
      }
      const alreadyAnalyzed = Boolean(currentVideoReconstruction(entry, asset.id));
      if (!reanalyze && alreadyAnalyzed) {
        skippedAnalyzedCount += 1;
        continue;
      }
      items.push({
        entryId: String(entry.id),
        assetId: String(asset.id),
        title: String(entry.title ?? ""),
        byteSize: Math.max(0, Number(snapshots.get(`${entry.id}\u0000${asset.id}`)?.byteSize) || Number(asset.byteSize) || 0),
        durationMs: Math.max(0, Number(snapshots.get(`${entry.id}\u0000${asset.id}`)?.durationMs) || Number(asset.durationMs) || 0),
        fingerprint: String(snapshots.get(`${entry.id}\u0000${asset.id}`)?.fingerprint ?? ""),
        sourcePlan: String(snapshots.get(`${entry.id}\u0000${asset.id}`)?.sourcePlan ?? options.sourcePlan ?? "").trim(),
        alreadyAnalyzed
      });
    }
  }
  return {
    kind: "video",
    caseCount: new Set(items.map((item) => item.entryId)).size,
    requestCount: items.length,
    skippedAnalyzedCount,
    excludedCount,
    includeAllVideos,
    reanalyze,
    includeTags: options.includeTags !== false,
    providerId: String(options.providerId ?? "").trim(),
    model: String(options.model ?? "").trim(),
    protocol: String(options.protocol ?? "").trim(),
    sourcePlan: String(options.sourcePlan ?? "").trim(),
    endpoint: String(options.endpoint ?? "").trim(),
    localVideo: String(options.localVideo ?? "").trim(),
    preferPublicVideoUrl: options.preferPublicVideoUrl === true,
    publicVideoUrl: String(options.publicVideoUrl ?? "").trim(),
    concurrency: normalizeConcurrency(options.concurrency, VIDEO_BATCH_CONCURRENCY),
    totalBytes: items.reduce((sum, item) => sum + item.byteSize, 0),
    knownDurationMs: items.reduce((sum, item) => sum + item.durationMs, 0),
    unknownDurationCount: items.filter((item) => !item.durationMs).length,
    items
  };
}

export function createVideoBatchJob(entries = [], options = {}) {
  const preview = previewVideoBatch(entries, options);
  if (!preview.requestCount) throw new Error("没有需要批量逆推的本地视频");
  const now = String(options.now ?? new Date().toISOString());
  return {
    version: ANALYSIS_BATCH_VERSION,
    kind: "video",
    id: String(options.id ?? "").trim() || `analysis:${globalThis.crypto.randomUUID()}`,
    status: "running",
    createdAt: now,
    updatedAt: now,
    outputLocale: options.outputLocale === "en" ? "en" : "zh-CN",
    providerId: preview.providerId,
    model: preview.model,
    protocol: preview.protocol,
    sourcePlan: preview.sourcePlan,
    endpoint: preview.endpoint,
    localVideo: preview.localVideo,
    preferPublicVideoUrl: preview.preferPublicVideoUrl,
    publicVideoUrl: preview.publicVideoUrl,
    concurrency: preview.concurrency,
    includeAllVideos: preview.includeAllVideos,
    reanalyze: preview.reanalyze,
    includeTags: preview.includeTags,
    instruction: String(options.instruction ?? "").replace(/\r\n?/gu, "\n").trim(),
    contractVersion: String(options.contractVersion ?? "").trim(),
    requestCount: preview.requestCount,
    skippedAnalyzedCount: preview.skippedAnalyzedCount,
    excludedCount: preview.excludedCount,
    totalBytes: preview.totalBytes,
    knownDurationMs: preview.knownDurationMs,
    unknownDurationCount: preview.unknownDurationCount,
    items: preview.items.map((item) => ({
      entryId: item.entryId,
      assetId: item.assetId,
      fingerprint: item.fingerprint,
      sourcePlan: item.sourcePlan,
      taskId: "",
      attemptId: "",
      requestId: "",
      status: "pending",
      attempts: 0,
      claimId: "",
      error: "",
      statusCode: 0
    })),
    usage: emptyUsage()
  };
}

export function normalizeAnalysisBatchJob(value) {
  if (!value || ![1, ANALYSIS_BATCH_VERSION].includes(value.version) || !value.id || !Array.isArray(value.items)) return null;
  const statuses = new Set(["pending", "running", "succeeded", "failed"]);
  const jobStatuses = new Set(["running", "paused", "completed", "partial", "failed", "canceled"]);
  return {
    version: ANALYSIS_BATCH_VERSION,
    kind: ["vision", "video"].includes(value.kind) ? value.kind : "text_tags",
    mode: ["reanalyze", "rebuild"].includes(value.mode) ? "rebuild" : "incremental",
    id: String(value.id),
    status: jobStatuses.has(value.status) ? value.status : "paused",
    createdAt: String(value.createdAt ?? ""),
    updatedAt: String(value.updatedAt ?? ""),
    analysisModel: String(value.analysisModel ?? "") || DEFAULT_ANALYSIS_MODEL,
    providerId: String(value.providerId ?? ""),
    protocol: String(value.protocol ?? ""),
    sourcePlan: String(value.sourcePlan ?? ""),
    endpoint: String(value.endpoint ?? ""),
    localVideo: String(value.localVideo ?? ""),
    preferPublicVideoUrl: value.preferPublicVideoUrl === true,
    publicVideoUrl: String(value.publicVideoUrl ?? ""),
    outputProtocol: String(value.outputProtocol ?? "json_object"),
    retryPolicy: normalizeRetryPolicy(value.retryPolicy),
    outputLocale: value.outputLocale === "en" ? "en" : "zh-CN",
    providerType: value.providerType === "compatible" ? "compatible" : "openai",
    model: String(value.model ?? ""),
    includeAllImages: value.includeAllImages === true,
    includeAllVideos: value.includeAllVideos === true,
    reanalyze: value.reanalyze === true,
    includeTags: value.includeTags !== false,
    instruction: String(value.instruction ?? "").replace(/\r\n?/gu, "\n").trim(),
    contractVersion: String(value.contractVersion ?? "").trim(),
    concurrency: normalizeConcurrency(value.concurrency, value.kind === "video" ? VIDEO_BATCH_CONCURRENCY : value.kind === "vision" ? VISION_BATCH_CONCURRENCY : ANALYSIS_BATCH_CONCURRENCY),
    requestCount: Math.max(0, Number(value.requestCount) || value.items.length),
    skippedAnalyzedCount: Math.max(0, Number(value.skippedAnalyzedCount) || 0),
    excludedCount: Math.max(0, Number(value.excludedCount) || 0),
    totalBytes: Math.max(0, Number(value.totalBytes) || 0),
    knownDurationMs: Math.max(0, Number(value.knownDurationMs) || 0),
    unknownDurationCount: Math.max(0, Number(value.unknownDurationCount) || 0),
    promptVersion: Number(value.promptVersion) || ANALYSIS_PROMPT_VERSION,
    profileFingerprint: String(value.profileFingerprint ?? "").trim(),
    catalogRevision: Number(value.catalogRevision) || 0,
    resultCatalogRevision: Number.isInteger(value.resultCatalogRevision) ? value.resultCatalogRevision : null,
    partialApplied: value.partialApplied === true,
    partialAppliedAt: String(value.partialAppliedAt ?? ""),
    totalCharacters: Math.max(0, Number(value.totalCharacters) || 0),
    fixedTaxonomyCharacters: Math.max(0, Number(value.fixedTaxonomyCharacters) || 0),
    items: value.items.flatMap((item) => item?.entryId ? [{
      entryId: String(item.entryId),
      ...(String(item.visualId ?? "").trim() ? { visualId: String(item.visualId).trim() } : {}),
      ...(String(item.assetId ?? "").trim() ? { assetId: String(item.assetId).trim() } : {}),
      fingerprint: String(item.fingerprint ?? ""),
      sourcePlan: String(item.sourcePlan ?? value.sourcePlan ?? ""),
      taskId: String(item.taskId ?? ""),
      attemptId: String(item.attemptId ?? ""),
      requestId: String(item.requestId ?? ""),
      textRevision: Math.max(1, Math.floor(Number(item.textRevision) || 1)),
      status: item.status === "partial"
        ? "failed"
        : statuses.has(item.status) ? item.status : "pending",
      attempts: Math.max(0, Number(item.attempts) || 0),
      claimId: String(item.claimId ?? ""),
      error: item.status === "partial"
        ? value.kind === "vision" ? "旧版图片分析结果不完整，请重试" : "旧版分析结果不完整，请重试"
        : String(item.error ?? ""),
      statusCode: Math.max(0, Number(item.statusCode) || 0),
      serviceRequests: Math.max(0, Number(item.serviceRequests) || 0),
      outputCorrectionRequests: Math.max(0, Number(item.outputCorrectionRequests) || 0),
      cacheHit: item.cacheHit === true,
      costReturned: item.costReturned === true,
      cost: item.costReturned === true && Number.isFinite(Number(item.cost)) ? Number(item.cost) : null
    }] : []),
    usage: normalizeUsage(value.usage)
  };
}

export function claimAnalysisItems(value, limit, idFactory = () => globalThis.crypto.randomUUID()) {
  const job = requireJob(value);
  if (job.status !== "running") return { job, claims: [] };
  const maximum = limit === undefined
    ? job.concurrency
    : Math.max(1, Math.floor(limit));
  const claims = [];
  for (const item of job.items) {
    if (item.status !== "pending" || claims.length >= maximum) continue;
    item.status = "running";
    item.attempts += 1;
    item.claimId = String(idFactory());
    item.error = "";
    item.statusCode = 0;
    item.taskId = "";
    item.attemptId = "";
    item.requestId = "";
    claims.push({
      entryId: item.entryId,
      ...(item.visualId ? { visualId: item.visualId } : {}),
      ...(item.assetId ? { assetId: item.assetId } : {}),
      fingerprint: item.fingerprint,
      sourcePlan: item.sourcePlan,
      textRevision: item.textRevision,
      claimId: item.claimId,
      attempts: item.attempts
    });
  }
  touch(job);
  return { job, claims };
}

export function bindAnalysisItemAttempt(value, entryId, claimId, identity = {}) {
  const job = requireJob(value);
  const item = claimedItem(job, entryId, claimId);
  const taskId = String(identity.taskId ?? "").trim();
  const attemptId = String(identity.attemptId ?? "").trim();
  const requestId = String(identity.requestId ?? attemptId).trim();
  if (!taskId) throw new Error("批量视频任务缺少精确任务编号");
  if (item.taskId && item.taskId !== taskId) throw new Error("批量视频任务编号已经变化");
  if (item.attemptId && attemptId && item.attemptId !== attemptId) throw new Error("批量视频执行编号已经变化");
  item.taskId = taskId;
  if (attemptId) item.attemptId = attemptId;
  if (requestId) item.requestId = requestId;
  touch(job);
  return job;
}

export function succeedAnalysisItem(value, entryId, claimId, usage, catalogRevision, metadata = {}) {
  const job = requireJob(value);
  const item = claimedItem(job, entryId, claimId);
  item.status = "succeeded";
  item.claimId = "";
  item.error = "";
  item.statusCode = 0;
  recordItemExecution(item, metadata);
  job.usage = addUsage(job.usage, usage);
  job.resultCatalogRevision = Number.isInteger(catalogRevision) ? catalogRevision : job.resultCatalogRevision;
  finishIfSettled(job);
  touch(job);
  return job;
}

export function failAnalysisItem(value, entryId, claimId, error = {}) {
  const job = requireJob(value);
  const item = claimedItem(job, entryId, claimId);
  item.status = "failed";
  item.claimId = "";
  item.error = String(error.message ?? "分析失败");
  item.statusCode = Math.max(0, Number(error.status) || 0);
  recordItemExecution(item, error);
  job.usage = addUsage(job.usage, error.usage);
  finishIfSettled(job);
  if ([401, 402, 403].includes(item.statusCode)) job.status = "paused";
  touch(job);
  return job;
}

export function failUnfinishedAnalysisItems(value, error = {}) {
  const job = requireJob(value);
  const message = String(error.message ?? "批量任务启动失败");
  const statusCode = Math.max(0, Number(error.status) || 0);
  for (const item of job.items) {
    if (!["pending", "running"].includes(item.status)) continue;
    item.status = "failed";
    item.claimId = "";
    item.error = message;
    item.statusCode = statusCode;
  }
  finishIfSettled(job);
  touch(job);
  return job;
}

export function stageAnalysisRebuildResults(jobValue, stagingValue, state, results = []) {
  let job = requireJob(jobValue);
  if (job.mode !== "rebuild") throw new Error("当前任务不是标签系统重建");
  const staging = stagingValue?.jobId === job.id && stagingValue.results && typeof stagingValue.results === "object"
    ? structuredClone(stagingValue)
    : { version: 1, jobId: job.id, results: {} };
  for (const result of results) {
    claimedItem(job, result.entryId, result.claimId);
    if (result.error) {
      job = failAnalysisItem(job, result.entryId, result.claimId, result.error);
      continue;
    }
    const entry = state.entries?.find((item) => item.id === result.entryId);
    if (!entry || canonicalTextAnalysisInput(entry, result.assetId).textRevision !== Math.max(1, Number(result.textRevision) || 1)) {
      job = failAnalysisItem(job, result.entryId, result.claimId, {
        message: "提示词原文已变化，请重新预览",
        status: 409
      });
      continue;
    }
    let tags;
    try {
      tags = validateAnalysisTagResponse({ tags: result.tags }, state.facetCatalog);
    } catch (error) {
      job = failAnalysisItem(job, result.entryId, result.claimId, { message: error.message, status: 422 });
      continue;
    }
    staging.results[result.entryId] = {
      tags,
      fingerprint: String(result.fingerprint ?? ""),
      textRevision: Math.max(1, Number(result.textRevision) || 1),
      ...(String(result.assetId ?? "").trim() ? { assetId: String(result.assetId).trim() } : {}),
      model: String(result.model ?? ""),
      normalizationDiagnostics: structuredClone(Array.isArray(result.normalizationDiagnostics) ? result.normalizationDiagnostics : []),
      attempts: {
        serviceRequests: Math.max(0, Number(result.attempts?.serviceRequests) || 0),
        outputCorrectionRequests: Math.max(0, Number(result.attempts?.outputCorrectionRequests) || 0)
      },
      usage: normalizeUsage(result.usage)
    };
    job = succeedAnalysisItem(job, result.entryId, result.claimId, result.usage, state.facetCatalog.revision, result);
  }
  return { job, staging };
}

export function finalizeAnalysisRebuild(jobValue, stagingValue, state, analyzedAtValue = new Date().toISOString()) {
  const job = requireJob(jobValue);
  const summary = analysisBatchSummary(job);
  if (job.mode !== "rebuild" || summary.status !== "completed" || summary.counts.failed) {
    throw new Error("重建任务尚未全部成功，正式标签库保持不变");
  }
  if (stagingValue?.jobId !== job.id || !stagingValue.results || typeof stagingValue.results !== "object") {
    throw new Error("重建暂存结果无效，正式标签库保持不变");
  }
  const analyzedAt = String(analyzedAtValue || new Date().toISOString());
  const working = applyStagedRebuildItems(job, stagingValue, state, job.items, analyzedAt);
  return {
    state: working,
    job: { ...job, resultCatalogRevision: working.facetCatalog.revision }
  };
}

export function finalizePartialAnalysisRebuild(jobValue, stagingValue, state, analyzedAtValue = new Date().toISOString()) {
  const job = requireJob(jobValue);
  const recovery = analysisRebuildRecovery(job, stagingValue);
  if (!recovery.recoverable) {
    throw new Error("没有可安全应用的部分重建结果，正式标签库保持不变");
  }
  const analyzedAt = String(analyzedAtValue || new Date().toISOString());
  const succeededItems = job.items.filter((item) => item.status === "succeeded");
  const working = applyStagedRebuildItems(job, stagingValue, state, succeededItems, analyzedAt);
  return {
    state: working,
    job: {
      ...job,
      partialApplied: true,
      partialAppliedAt: analyzedAt,
      resultCatalogRevision: working.facetCatalog.revision
    }
  };
}

export function pauseAnalysisBatch(value) {
  const job = requireJob(value);
  if (job.status === "running") job.status = "paused";
  touch(job);
  return job;
}

export function resumeAnalysisBatch(value) {
  const job = requireJob(value);
  if (job.status === "canceled") throw new Error("已取消的批量任务不能继续");
  if (job.items.some((item) => ["pending", "running"].includes(item.status))) job.status = "running";
  else finishIfSettled(job);
  touch(job);
  return job;
}

export function recoverInterruptedAnalysisBatch(value) {
  const job = requireJob(value);
  if (job.status === "canceled") return job;
  for (const item of job.items) {
    if (item.status !== "running") continue;
    item.status = "pending";
    item.claimId = "";
  }
  if (job.items.some((item) => item.status === "pending")) job.status = "running";
  else finishIfSettled(job);
  touch(job);
  return job;
}

export function retryFailedAnalysisItems(value, options = {}) {
  const job = requireJob(value);
  const selected = new Set((Array.isArray(options.itemKeys) ? options.itemKeys : []).map(String));
  const requireSelection = job.kind === "video" && options.requireSelection === true;
  if (requireSelection && !selected.size) throw new Error("请选择要重新发送的视频");
  let count = 0;
  for (const item of job.items) {
    if (!["failed", "partial"].includes(item.status)) continue;
    const itemKey = `${item.entryId}\u0000${item.assetId || item.visualId || ""}`;
    if (selected.size && !selected.has(itemKey)) continue;
    if (requireSelection && /状态未知|可能已收到/.test(item.error) && options.confirmDuplicateCharge !== true) {
      throw new Error("状态未知的视频重新发送前必须确认可能重复计费");
    }
    item.status = "pending";
    item.error = "";
    item.statusCode = 0;
    item.claimId = "";
    item.taskId = "";
    item.attemptId = "";
    item.requestId = "";
    count += 1;
  }
  if (!count) throw new Error("没有可重试的失败案例");
  job.status = "running";
  touch(job);
  return job;
}

export function cancelAnalysisBatch(value) {
  const job = requireJob(value);
  job.status = "canceled";
  for (const item of job.items) {
    if (item.status !== "running") continue;
    item.status = "pending";
    item.claimId = "";
  }
  touch(job);
  return job;
}

export function reconcileVisionBatchResults(value, entries = []) {
  const job = requireJob(value);
  if (job.kind !== "vision") return { job, recoveredCount: 0 };
  const visuals = new Map();
  for (const entry of Array.isArray(entries) ? entries : []) {
    for (const visual of entryMediaAssets(entry).filter((asset) => asset.kind === "image" && asset.usage !== "poster")) {
      visuals.set(`${entry.id}:${visual.id}`, visual);
    }
  }
  let recoveredCount = 0;
  for (const item of job.items) {
    if (!["pending", "running"].includes(item.status)) continue;
    const analysis = visuals.get(`${item.entryId}:${item.visualId}`)?.visionAnalysis;
    const hasPrompt = Boolean(String(analysis?.reconstructionPrompt ?? "").trim());
    const hasTags = Array.isArray(analysis?.tags)
      && analysis.tags.some((tag) => String(tag?.g ?? "").trim() && String(tag?.t ?? "").trim());
    if (!hasPrompt || !hasTags || analysis.batchJobId !== job.id) continue;
    item.status = "succeeded";
    item.claimId = "";
    item.error = "";
    item.statusCode = 0;
    recordItemExecution(item, analysis);
    job.usage = addUsage(job.usage, {
      promptTokens: analysis.usage?.inputTokens,
      completionTokens: analysis.usage?.outputTokens,
      totalTokens: analysis.usage?.totalTokens
    });
    recoveredCount += 1;
  }
  if (recoveredCount) {
    finishIfSettled(job);
    touch(job);
  }
  return { job, recoveredCount };
}

export function analysisBatchSummary(value) {
  const job = normalizeAnalysisBatchJob(value);
  if (!job) return null;
  const counts = { pending: 0, running: 0, succeeded: 0, partial: 0, failed: 0 };
  for (const item of job.items) counts[item.status] += 1;
  const failureCategories = {};
  for (const item of job.items.filter((candidate) => candidate.status === "failed")) {
    const category = failureCategory(item.statusCode);
    failureCategories[category] = (failureCategories[category] ?? 0) + 1;
  }
  return {
    ...job,
    counts,
    unknownCostCount: job.items.filter((item) => item.status === "succeeded" && item.costReturned !== true).length,
    totalCost: job.items.reduce((sum, item) => sum + (item.costReturned === true ? Number(item.cost) || 0 : 0), 0),
    total: job.items.length,
    requestAttempts: job.items.reduce((sum, item) => sum + item.serviceRequests, 0),
    outputCorrectionRequests: job.items.reduce((sum, item) => sum + item.outputCorrectionRequests, 0),
    cacheHitCount: job.items.filter((item) => item.cacheHit).length,
    failureCategories
  };
}

export function analysisRebuildRecovery(value, stagingValue) {
  const job = normalizeAnalysisBatchJob(value);
  if (!job || job.mode !== "rebuild") {
    return { stagedResultCount: 0, stagingValid: false, recoverable: false };
  }
  const succeededIds = job.items.filter((item) => item.status === "succeeded").map((item) => item.entryId);
  const stagingMatches = stagingValue?.jobId === job.id && stagingValue.results && typeof stagingValue.results === "object";
  const stagedIds = stagingMatches ? Object.keys(stagingValue.results) : [];
  const stagingValid = stagingMatches && stagedIds.length === succeededIds.length &&
    succeededIds.every((entryId) => Object.hasOwn(stagingValue.results, entryId));
  const counts = analysisBatchSummary(job).counts;
  return {
    stagedResultCount: stagedIds.length,
    stagingValid,
    recoverable: ["completed", "partial"].includes(job.status) && counts.failed > 0 && !job.partialApplied && stagingValid
  };
}

export function createAnalysisBatchUndo(jobValue, state = {}) {
  const job = requireJob(jobValue);
  const included = new Set(job.items.map((item) => item.entryId));
  const includeAllEntries = job.mode === "rebuild";
  return {
    jobId: job.id,
    createdAt: new Date().toISOString(),
    facetCatalog: structuredClone(state.facetCatalog),
    entries: (state.entries ?? []).flatMap((entry) => includeAllEntries || included.has(entry.id) ? [{
      entryId: entry.id,
      value: pickEntryAnalysisState(entry)
    }] : [])
  };
}

export function restoreAnalysisBatchUndo(stateValue = {}, undo = {}) {
  const state = structuredClone(stateValue);
  const backupById = new Map((undo.entries ?? []).map((item) => [item.entryId, item.value]));
  state.entries = (state.entries ?? []).map((entry) => {
    const value = backupById.get(entry.id);
    if (!value) return entry;
    const restored = { ...entry };
    for (const key of analysisStateKeys()) {
      if (Object.hasOwn(value, key)) restored[key] = structuredClone(value[key]);
      else delete restored[key];
    }
    return restored;
  });
  state.facetCatalog = structuredClone(undo.facetCatalog);
  return state;
}

export async function textFingerprint(value) {
  const bytes = new TextEncoder().encode(String(value ?? "").trim());
  const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function claimedItem(job, entryId, claimId) {
  const item = job.items.find((candidate) =>
    candidate.entryId === entryId &&
    candidate.status === "running" &&
    candidate.claimId === claimId
  );
  if (!item) {
    throw new Error("这条批量分析结果已经失效，请刷新后继续");
  }
  return item;
}

function finishIfSettled(job) {
  if (job.items.some((item) => item.status === "pending" || item.status === "running")) return;
  const succeeded = job.items.filter((item) => item.status === "succeeded").length;
  const partial = job.items.filter((item) => item.status === "partial").length;
  const failed = job.items.filter((item) => item.status === "failed").length;
  job.status = failed === job.items.length ? "failed" : failed || partial ? "partial" : succeeded ? "completed" : "failed";
}

function normalizeConcurrency(value, fallback) {
  const number = Number(value);
  return Number.isInteger(number) && number >= 2 ? number : fallback;
}

function normalizeRetryPolicy(value) {
  return {
    serviceRetries: Number(value?.serviceRetries) === 2 ? 2 : ANALYSIS_RETRY_POLICY.serviceRetries,
    outputCorrectionRequests: Number(value?.outputCorrectionRequests) === 1 ? 1 : ANALYSIS_RETRY_POLICY.outputCorrectionRequests,
    maxProviderCallsPerItem: ANALYSIS_RETRY_POLICY.maxProviderCallsPerItem,
    backoffMs: [...ANALYSIS_RETRY_POLICY.backoffMs],
    obeyRetryAfter: true
  };
}

function recordItemExecution(item, metadata = {}) {
  item.serviceRequests += Math.max(0, Number(metadata.attempts?.serviceRequests ?? metadata.serviceRequests) || 0);
  item.outputCorrectionRequests += Math.max(0, Number(metadata.attempts?.outputCorrectionRequests ?? metadata.outputCorrectionRequests) || 0);
  item.cacheHit = item.cacheHit || metadata.cacheHit === true;
  if (Object.hasOwn(metadata, "cost")) {
    item.costReturned = metadata.cost !== null && Number.isFinite(Number(metadata.cost));
    item.cost = item.costReturned ? Number(metadata.cost) : null;
  }
}

function failureCategory(status) {
  if ([401, 402, 403].includes(status)) return "authorization";
  if (status === 429) return "rate_limit";
  if (status === 408) return "timeout";
  if (status >= 500) return "service";
  if (status === 0) return "network";
  return "output";
}

function requireJob(value) {
  const job = normalizeAnalysisBatchJob(value);
  if (!job) throw new Error("没有可用的批量分析任务");
  return job;
}

function touch(job) {
  job.updatedAt = new Date().toISOString();
}

function emptyUsage() {
  return { promptTokens: 0, completionTokens: 0, totalTokens: 0, cacheHitTokens: 0, cacheMissTokens: 0, cacheHits: 0 };
}

function pickEntryAnalysisState(entry) {
  const value = {};
  for (const key of analysisStateKeys()) {
    if (Object.hasOwn(entry, key)) value[key] = structuredClone(entry[key]);
  }
  return value;
}

function analysisStateKeys() {
  return ["facetAssignments", "customLabels", "analysisCandidates", "analysisBreakdown", "analysisMeta", "analyzedAt", "analysisPending"];
}

function normalizeUsage(value = {}) {
  return Object.fromEntries(Object.keys(emptyUsage()).map((key) => [key, Math.max(0, Number(value?.[key]) || 0)]));
}

function rebuildAnalysisMeta(staged, job, entry, analyzedAt) {
  return {
    ...(staged.fingerprint ? { textFingerprint: staged.fingerprint } : {}),
    textRevision: Math.max(1, Math.floor(Number(staged.textRevision) || analysisRevisionMeta(entry).textRevision)),
    ...(String(staged.assetId ?? "").trim() ? { assetId: String(staged.assetId).trim() } : {}),
    promptVersion: job.promptVersion || ANALYSIS_PROMPT_VERSION,
    model: staged.model,
    analyzedAt,
    profileFingerprint: job.profileFingerprint,
    normalizationDiagnostics: structuredClone(Array.isArray(staged.normalizationDiagnostics) ? staged.normalizationDiagnostics : []),
    attempts: {
      serviceRequests: Math.max(0, Number(staged.attempts?.serviceRequests) || 0),
      outputCorrectionRequests: Math.max(0, Number(staged.attempts?.outputCorrectionRequests) || 0)
    },
    usage: normalizeUsage(staged.usage)
  };
}

function applyStagedRebuildItems(job, stagingValue, state, items, analyzedAt) {
  const prepared = prepareFacetRebuild(state.entries, state.facetCatalog);
  let working = { ...structuredClone(state), entries: prepared.entries, facetCatalog: prepared.catalog };
  for (const item of items) {
    const staged = stagingValue.results[item.entryId];
    if (!staged) throw new Error("重建暂存结果不完整，正式标签库保持不变");
    const applied = applyTextAnalysisTags(working, item.entryId, staged.tags);
    working = applied.state;
    const updated = working.entries.find((entry) => entry.id === item.entryId);
    updated.analysisPending = false;
    updated.analyzedAt = analyzedAt;
    updated.analysisMeta = rebuildAnalysisMeta(staged, job, updated, analyzedAt);
  }
  return working;
}

function addUsage(left, right) {
  const base = normalizeUsage(left);
  const incoming = normalizeUsage(right);
  return Object.fromEntries(Object.keys(base).map((key) => [key, base[key] + incoming[key]]));
}
