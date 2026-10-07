import {
  createVisionBatchJob,
  normalizeAnalysisBatchJob,
  previewVisionBatch
} from "./analysis-batch.js";

export function buildAutomaticVisionJob(entries, entryIds, options = {}, currentValue = null) {
  const current = normalizeAnalysisBatchJob(currentValue);
  const active = current?.kind === "vision" && ["running", "paused"].includes(current.status) ? current : null;
  // Unfinished images of the active job stay queued when it is rebuilt for a new service or model.
  const carriedEntryIds = active
    ? active.items.filter((item) => ["pending", "running"].includes(item.status)).map((item) => item.entryId)
    : [];
  const sameRoute = active
    && active.providerType === options.providerType
    && active.model === options.model
    && String(active.providerId ?? "") === String(options.providerId ?? "");
  const targetEntryIds = sameRoute ? entryIds : [...new Set([...entryIds, ...carriedEntryIds])];
  const preview = previewVisionBatch(entries, {
    entryIds: targetEntryIds,
    includeAllImages: true,
    reanalyze: false,
    providerType: options.providerType,
    providerId: options.providerId,
    model: options.model,
    outputProtocol: options.outputProtocol,
    concurrency: options.concurrency
  });

  if (sameRoute) {
    const known = new Set(active.items.map((item) => `${item.entryId}:${item.visualId}`));
    const additions = preview.items.filter((item) => !known.has(`${item.entryId}:${item.visualId}`));
    const resumable = active.status === "paused" && carriedEntryIds.length > 0;
    if (!additions.length && !resumable) return null;
    return {
      ...active,
      status: "running",
      updatedAt: String(options.now ?? new Date().toISOString()),
      includeAllImages: true,
      items: [...active.items, ...additions.map(automaticVisionItem)],
      requestCount: active.items.length + additions.length
    };
  }
  if (!preview.requestCount) return null;

  return createVisionBatchJob(entries, {
    entryIds: targetEntryIds,
    includeAllImages: true,
    reanalyze: false,
    providerType: options.providerType,
    providerId: options.providerId,
    model: options.model,
    outputProtocol: options.outputProtocol,
    concurrency: options.concurrency,
    outputLocale: options.outputLocale,
    now: options.now,
    id: options.id
  });
}

function automaticVisionItem(item) {
  return {
    entryId: item.entryId,
    visualId: item.visualId,
    fingerprint: "",
    status: "pending",
    attempts: 0,
    claimId: "",
    error: "",
    statusCode: 0
  };
}
