import { ANALYSIS_PROMPT_VERSION, DEFAULT_ANALYSIS_MODEL } from "./deepseek.js";
import { applyTextAnalysisTags } from "./analysis-candidates.js";
import {
  analysisRevisionMeta,
  entryTextRevision,
  hasPriorTextAnalysis,
  textAnalysisReason
} from "./analysis-revision.js";
import { prepareFacetRebuild, validateAnalysisTagResponse } from "./tag-taxonomy.js";
import { entryMediaAssets, primaryImageAsset } from "./media.js";

export const ANALYSIS_BATCH_VERSION = 2;
export const ANALYSIS_BATCH_CONCURRENCY = 3;

export async function previewAnalysisBatch(entries = [], options = {}) {
  const eligible = [];
  const mode = ["reanalyze", "rebuild"].includes(options.mode) ? "rebuild" : "incremental";
  const profileFingerprint = String(options.profileFingerprint ?? "").trim();
  for (const entry of Array.isArray(entries) ? entries : []) {
    const text = String(entry?.text ?? "").trim();
    if (!entry?.id || !text) continue;
    const reason = mode === "rebuild" ? "explicit_reanalysis" : textAnalysisReason(entry);
    if (!reason) continue;
    eligible.push({
      entryId: entry.id,
      textRevision: entryTextRevision(entry),
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
    const text = String(entry?.text ?? "").trim();
    if (!entry?.id || !text || entry.analysisMeta || !hasPriorTextAnalysis(entry)) {
      next.push(entry);
      continue;
    }
    next.push({
      ...entry,
      analysisMeta: {
        textRevision: entryTextRevision(entry),
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
    outputLocale: options.outputLocale === "en" ? "en" : "zh-CN",
    promptVersion: ANALYSIS_PROMPT_VERSION,
    profileFingerprint: preview.profileFingerprint,
    catalogRevision: Number(options.catalogRevision) || 0,
    resultCatalogRevision: null,
    totalCharacters: preview.totalCharacters,
    fixedTaxonomyCharacters: preview.fixedTaxonomyCharacters,
    items: preview.entries.map((item) => ({
      entryId: item.entryId,
      textRevision: item.textRevision,
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
      if (!reanalyze && visual.visionAnalysis?.description) {
        skippedAnalyzedCount += 1;
        continue;
      }
      items.push({
        entryId: String(entry.id),
        visualId: String(visual.id),
        title: String(entry.title ?? ""),
        alreadyAnalyzed: Boolean(visual.visionAnalysis?.description)
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
    model: preview.model,
    includeAllImages: preview.includeAllImages,
    reanalyze: preview.reanalyze,
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

export function normalizeAnalysisBatchJob(value) {
  if (!value || ![1, ANALYSIS_BATCH_VERSION].includes(value.version) || !value.id || !Array.isArray(value.items)) return null;
  const statuses = new Set(["pending", "running", "succeeded", "failed"]);
  const jobStatuses = new Set(["running", "paused", "completed", "canceled"]);
  return {
    version: ANALYSIS_BATCH_VERSION,
    kind: value.kind === "vision" ? "vision" : "text_tags",
    mode: ["reanalyze", "rebuild"].includes(value.mode) ? "rebuild" : "incremental",
    id: String(value.id),
    status: jobStatuses.has(value.status) ? value.status : "paused",
    createdAt: String(value.createdAt ?? ""),
    updatedAt: String(value.updatedAt ?? ""),
    analysisModel: String(value.analysisModel ?? "") || DEFAULT_ANALYSIS_MODEL,
    outputLocale: value.outputLocale === "en" ? "en" : "zh-CN",
    providerType: value.providerType === "compatible" ? "compatible" : "openai",
    model: String(value.model ?? ""),
    includeAllImages: value.includeAllImages === true,
    reanalyze: value.reanalyze === true,
    requestCount: Math.max(0, Number(value.requestCount) || value.items.length),
    skippedAnalyzedCount: Math.max(0, Number(value.skippedAnalyzedCount) || 0),
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
      fingerprint: String(item.fingerprint ?? ""),
      textRevision: Math.max(1, Math.floor(Number(item.textRevision) || 1)),
      status: statuses.has(item.status) ? item.status : "pending",
      attempts: Math.max(0, Number(item.attempts) || 0),
      claimId: String(item.claimId ?? ""),
      error: String(item.error ?? ""),
      statusCode: Math.max(0, Number(item.statusCode) || 0)
    }] : []),
    usage: normalizeUsage(value.usage)
  };
}

export function claimAnalysisItems(value, limit, idFactory = () => globalThis.crypto.randomUUID()) {
  const job = requireJob(value);
  if (job.status !== "running") return { job, claims: [] };
  const maximum = limit === undefined
    ? job.kind === "vision" ? 1 : ANALYSIS_BATCH_CONCURRENCY
    : Math.max(1, Math.floor(limit));
  const claims = [];
  for (const item of job.items) {
    if (item.status !== "pending" || claims.length >= maximum) continue;
    item.status = "running";
    item.attempts += 1;
    item.claimId = String(idFactory());
    item.error = "";
    item.statusCode = 0;
    claims.push({
      entryId: item.entryId,
      ...(item.visualId ? { visualId: item.visualId } : {}),
      fingerprint: item.fingerprint,
      textRevision: item.textRevision,
      claimId: item.claimId,
      attempts: item.attempts
    });
  }
  touch(job);
  return { job, claims };
}

export function succeedAnalysisItem(value, entryId, claimId, usage, catalogRevision) {
  const job = requireJob(value);
  const item = claimedItem(job, entryId, claimId);
  item.status = "succeeded";
  item.claimId = "";
  item.error = "";
  item.statusCode = 0;
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
  job.usage = addUsage(job.usage, error.usage);
  finishIfSettled(job);
  if ([401, 402].includes(item.statusCode)) job.status = "paused";
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
    if (!entry || entryTextRevision(entry) !== Math.max(1, Number(result.textRevision) || 1)) {
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
      model: String(result.model ?? ""),
      usage: normalizeUsage(result.usage)
    };
    job = succeedAnalysisItem(job, result.entryId, result.claimId, result.usage, state.facetCatalog.revision);
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

export function retryFailedAnalysisItems(value) {
  const job = requireJob(value);
  let count = 0;
  for (const item of job.items) {
    if (item.status !== "failed") continue;
    item.status = "pending";
    item.error = "";
    item.statusCode = 0;
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
    if (!analysis?.description || analysis.batchJobId !== job.id) continue;
    item.status = "succeeded";
    item.claimId = "";
    item.error = "";
    item.statusCode = 0;
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
  const counts = { pending: 0, running: 0, succeeded: 0, failed: 0 };
  for (const item of job.items) counts[item.status] += 1;
  return { ...job, counts, total: job.items.length };
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
    recoverable: job.status === "completed" && counts.failed > 0 && !job.partialApplied && stagingValid
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
  job.status = "completed";
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
  return { promptTokens: 0, completionTokens: 0, totalTokens: 0, cacheHitTokens: 0, cacheMissTokens: 0 };
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
    ...analysisRevisionMeta(entry),
    promptVersion: job.promptVersion || ANALYSIS_PROMPT_VERSION,
    model: staged.model,
    analyzedAt,
    profileFingerprint: job.profileFingerprint,
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
