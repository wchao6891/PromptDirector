export const LIBRARY_MAINTENANCE_VERSION = 1;

const JOB_STATUSES = new Set(["running", "paused", "completed", "canceled"]);

export function createLibraryMaintenanceJob(options = {}) {
  const createdAt = validDate(options.now) || new Date().toISOString();
  const job = {
    version: LIBRARY_MAINTENANCE_VERSION,
    id: String(options.id ?? "").trim() || `maintenance:${globalThis.crypto.randomUUID()}`,
    status: "running",
    createdAt,
    startedAt: createdAt,
    updatedAt: createdAt,
    classificationEntryIds: uniqueIds(options.classificationEntryIds),
    paletteAssetIds: uniqueIds(options.paletteAssetIds),
    classificationCursor: 0,
    paletteCursor: 0,
    succeeded: 0,
    failures: []
  };
  if (!maintenanceTotal(job)) job.status = "completed";
  return job;
}

export function normalizeLibraryMaintenanceJob(value) {
  if (!value || value.version !== LIBRARY_MAINTENANCE_VERSION || !value.id) return null;
  const classificationEntryIds = uniqueIds(value.classificationEntryIds);
  const paletteAssetIds = uniqueIds(value.paletteAssetIds);
  const classificationCursor = boundedCursor(value.classificationCursor, classificationEntryIds.length);
  const paletteCursor = boundedCursor(value.paletteCursor, paletteAssetIds.length);
  const failures = (Array.isArray(value.failures) ? value.failures : []).flatMap((item) => {
    const id = String(item?.id ?? "").trim();
    const kind = item?.kind === "classification" ? "classification" : "palette";
    return id ? [{ kind, id, message: String(item?.message ?? "处理失败").slice(0, 240) }] : [];
  });
  const job = {
    version: LIBRARY_MAINTENANCE_VERSION,
    id: String(value.id),
    status: JOB_STATUSES.has(value.status) ? value.status : "paused",
    createdAt: validDate(value.createdAt),
    startedAt: validDate(value.startedAt) || validDate(value.createdAt),
    updatedAt: validDate(value.updatedAt),
    classificationEntryIds,
    paletteAssetIds,
    classificationCursor,
    paletteCursor,
    succeeded: Math.max(0, Math.floor(Number(value.succeeded) || 0)),
    failures
  };
  if (maintenanceProcessed(job) >= maintenanceTotal(job) && job.status === "running") job.status = "completed";
  return job;
}

export function nextLibraryMaintenanceItem(value) {
  const job = requireJob(value);
  if (job.status !== "running") return null;
  if (job.classificationCursor < job.classificationEntryIds.length) {
    return { kind: "classification", id: job.classificationEntryIds[job.classificationCursor] };
  }
  if (job.paletteCursor < job.paletteAssetIds.length) {
    return { kind: "palette", id: job.paletteAssetIds[job.paletteCursor] };
  }
  return null;
}

export function completeLibraryMaintenanceItem(value, result = {}) {
  const job = requireJob(value);
  const item = nextLibraryMaintenanceItem(job);
  if (!item) return job;
  if (item.kind === "classification") job.classificationCursor += 1;
  else job.paletteCursor += 1;
  if (result.ok === false) {
    job.failures.push({ kind: item.kind, id: item.id, message: String(result.message ?? "处理失败").slice(0, 240) });
  } else job.succeeded += 1;
  if (maintenanceProcessed(job) >= maintenanceTotal(job)) job.status = "completed";
  touch(job);
  return job;
}

export function pauseLibraryMaintenance(value) {
  const job = requireJob(value);
  if (job.status === "running") job.status = "paused";
  touch(job);
  return job;
}

export function resumeLibraryMaintenance(value) {
  const job = requireJob(value);
  if (job.status === "canceled") throw new Error("已取消的资料补全任务不能继续");
  if (maintenanceProcessed(job) < maintenanceTotal(job)) job.status = "running";
  touch(job);
  return job;
}

export function cancelLibraryMaintenance(value) {
  const job = requireJob(value);
  job.status = "canceled";
  touch(job);
  return job;
}

export function retryLibraryMaintenanceFailures(value, options = {}) {
  const current = requireJob(value);
  if (!current.failures.length) throw new Error("没有可重试的资料补全失败项");
  return createLibraryMaintenanceJob({
    id: options.id,
    now: options.now,
    classificationEntryIds: current.failures.filter((item) => item.kind === "classification").map((item) => item.id),
    paletteAssetIds: current.failures.filter((item) => item.kind === "palette").map((item) => item.id)
  });
}

export function mergeLibraryMaintenanceProgress(currentValue, progressValue) {
  const current = normalizeLibraryMaintenanceJob(currentValue);
  const progress = normalizeLibraryMaintenanceJob(progressValue);
  if (!progress || !current || current.id !== progress.id) return current;
  if (current.status !== "running") progress.status = current.status;
  return progress;
}

export function libraryMaintenanceSummary(value, nowValue = Date.now()) {
  const job = normalizeLibraryMaintenanceJob(value);
  if (!job) return null;
  const total = maintenanceTotal(job);
  const processed = maintenanceProcessed(job);
  const elapsedSeconds = Math.max(0, (Number(nowValue) - Date.parse(job.startedAt)) / 1000);
  const itemsPerSecond = processed && elapsedSeconds ? processed / elapsedSeconds : 0;
  const remaining = Math.max(0, total - processed);
  return {
    id: job.id,
    status: job.status,
    total,
    processed,
    remaining,
    succeeded: job.succeeded,
    failed: job.failures.length,
    itemsPerSecond,
    estimatedSeconds: itemsPerSecond ? remaining / itemsPerSecond : 0,
    updatedAt: job.updatedAt
  };
}

function maintenanceTotal(job) {
  return job.classificationEntryIds.length + job.paletteAssetIds.length;
}

function maintenanceProcessed(job) {
  return job.classificationCursor + job.paletteCursor;
}

function uniqueIds(values) {
  return [...new Set((Array.isArray(values) ? values : []).map((item) => String(item ?? "").trim()).filter(Boolean))];
}

function boundedCursor(value, length) {
  return Math.min(length, Math.max(0, Math.floor(Number(value) || 0)));
}

function validDate(value) {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : "";
}

function touch(job) {
  job.updatedAt = new Date().toISOString();
}

function requireJob(value) {
  const job = normalizeLibraryMaintenanceJob(value);
  if (!job) throw new Error("没有可用的资料补全任务");
  return job;
}
