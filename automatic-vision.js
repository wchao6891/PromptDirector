import {
  createVisionBatchJob,
  normalizeAnalysisBatchJob,
  previewVisionBatch
} from "./analysis-batch.js";

export function buildAutomaticVisionJob(entries, entryIds, options = {}, currentValue = null) {
  const preview = previewVisionBatch(entries, {
    entryIds,
    includeAllImages: true,
    reanalyze: false,
    providerType: options.providerType,
    model: options.model
  });
  if (!preview.requestCount) return null;

  const current = normalizeAnalysisBatchJob(currentValue);
  if (current?.kind === "vision" && current.status === "running" &&
      current.providerType === preview.providerType && current.model === preview.model) {
    const known = new Set(current.items.map((item) => `${item.entryId}:${item.visualId}`));
    const additions = preview.items.filter((item) => !known.has(`${item.entryId}:${item.visualId}`));
    if (!additions.length) return null;
    return {
      ...current,
      updatedAt: String(options.now ?? new Date().toISOString()),
      includeAllImages: true,
      items: [...current.items, ...additions.map(automaticVisionItem)],
      requestCount: current.items.length + additions.length
    };
  }

  return createVisionBatchJob(entries, {
    entryIds,
    includeAllImages: true,
    reanalyze: false,
    providerType: options.providerType,
    model: options.model,
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
