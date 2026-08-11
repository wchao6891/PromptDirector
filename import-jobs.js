const JOB_STATUSES = new Set(["queued", "running", "completed", "failed", "canceled"]);
const ITEM_STATUSES = new Set(["queued", "imported", "skipped", "failed"]);

export function normalizeImportJobsState(value = {}, options = {}) {
  return {
    version: 1,
    items: (Array.isArray(value?.items) ? value.items : [])
      .map((job) => normalizeImportJob(job, options))
      .filter(Boolean)
  };
}

export function normalizeImportJob(value, { recoverRunning = false } = {}) {
  const id = clean(value?.id);
  if (!id) return null;
  const items = (Array.isArray(value?.items) ? value.items : [])
    .map((item) => normalizeImportItem(item, { recoverRunning }))
    .filter(Boolean);
  let status = JOB_STATUSES.has(value?.status) ? value.status : "queued";
  if (recoverRunning && status === "running") status = "queued";
  return {
    id,
    status,
    collectionId: clean(value?.collectionId),
    createdAt: clean(value?.createdAt),
    updatedAt: clean(value?.updatedAt),
    ...(clean(value?.retryOf) ? { retryOf: clean(value.retryOf) } : {}),
    ...(clean(value?.undoneAt) ? { undoneAt: clean(value.undoneAt) } : {}),
    ...(clean(value?.analysisQueuedAt) ? { analysisQueuedAt: clean(value.analysisQueuedAt) } : {}),
    createdEntryIds: uniqueStrings(value?.createdEntryIds),
    options: normalizeOptions(value?.options),
    items
  };
}

export function startImportJob(stateValue, jobId, options = {}) {
  return updateJob(stateValue, jobId, (current) => {
    if (!current.items.some((item) => item.status === "queued")) return current;
    if (!["queued", "running"].includes(current.status)) throw new Error("这次导入任务已经结束");
    return { ...current, status: "running", updatedAt: clean(options.now) || new Date().toISOString() };
  });
}

export function markImportJobAnalysisQueued(stateValue, jobId, options = {}) {
  return updateJob(stateValue, jobId, (current) => ({
    ...current,
    analysisQueuedAt: clean(options.now) || new Date().toISOString(),
    updatedAt: clean(options.now) || new Date().toISOString()
  }));
}

export function createImportJob(stateValue, request = {}, options = {}) {
  const state = normalizeImportJobsState(stateValue);
  const requestedItems = Array.isArray(request.items)
    ? request.items.map((item) => ({
        stagedAssetId: clean(item?.stagedAssetId),
        duplicateAssetId: clean(item?.duplicateAssetId),
        keepDuplicate: item?.keepDuplicate === true
      })).filter((item) => item.stagedAssetId)
    : uniqueStrings(request.stagedAssetIds).map((stagedAssetId) => ({ stagedAssetId }));
  const importItems = [...new Map(requestedItems.map((item) => [item.stagedAssetId, item])).values()];
  if (!importItems.length) throw new Error("请选择要导入的本机资料");
  const now = clean(options.now) || new Date().toISOString();
  const makeItemId = typeof options.itemId === "function"
    ? options.itemId
    : () => `import-item:${crypto.randomUUID()}`;
  const job = normalizeImportJob({
    id: clean(options.id) || `import-job:${crypto.randomUUID()}`,
    collectionId: request.collectionId,
    status: importItems.some((item) => !item.duplicateAssetId || item.keepDuplicate) ? "queued" : "completed",
    createdAt: now,
    updatedAt: now,
    createdEntryIds: [],
    options: request.options,
    items: importItems.map((item) => ({
      id: makeItemId(item.stagedAssetId),
      stagedAssetId: item.stagedAssetId,
      status: item.duplicateAssetId && !item.keepDuplicate ? "skipped" : "queued",
      ...(item.duplicateAssetId && !item.keepDuplicate ? { skipReason: "duplicate" } : {})
    }))
  });
  return { state: { ...state, items: [...state.items, job] }, job };
}

export function finishImportItem(stateValue, jobId, itemId, result = {}, options = {}) {
  const state = normalizeImportJobsState(stateValue);
  const jobIndex = state.items.findIndex((item) => item.id === clean(jobId));
  if (jobIndex < 0) throw new Error("没有找到这次导入任务");
  const current = state.items[jobIndex];
  if (!["queued", "running"].includes(current.status)) throw new Error("这次导入任务已经结束");
  const itemIndex = current.items.findIndex((item) => item.id === clean(itemId));
  if (itemIndex < 0) throw new Error("没有找到这项导入资料");
  if (current.items[itemIndex].status !== "queued") throw new Error("这项资料已经处理过");
  const status = ["imported", "skipped", "failed"].includes(result.status) ? result.status : "failed";
  const nextItem = {
    ...current.items[itemIndex],
    status,
    ...(status === "imported" && clean(result.entryId) ? { entryId: clean(result.entryId) } : {}),
    ...(status === "skipped" && clean(result.skipReason) ? { skipReason: clean(result.skipReason) } : {}),
    ...(status === "failed" && clean(result.error) ? { error: clean(result.error) } : {})
  };
  const items = current.items.map((item, index) => index === itemIndex ? nextItem : item);
  const createdEntryIds = uniqueStrings([
    ...current.createdEntryIds,
    ...(nextItem.entryId ? [nextItem.entryId] : [])
  ]);
  const statusValue = items.some((item) => item.status === "queued")
    ? "running"
    : items.some((item) => item.status === "failed") ? "failed" : "completed";
  const job = normalizeImportJob({
    ...current,
    items,
    createdEntryIds,
    status: statusValue,
    updatedAt: clean(options.now) || new Date().toISOString()
  });
  return { state: replaceJob(state, jobIndex, job), job, item: nextItem };
}

export function cancelImportJob(stateValue, jobId, options = {}) {
  const state = normalizeImportJobsState(stateValue);
  const jobIndex = state.items.findIndex((item) => item.id === clean(jobId));
  if (jobIndex < 0) throw new Error("没有找到这次导入任务");
  const current = state.items[jobIndex];
  if (!["queued", "running"].includes(current.status)) throw new Error("这次导入任务已经结束");
  const job = normalizeImportJob({
    ...current,
    status: "canceled",
    updatedAt: clean(options.now) || new Date().toISOString(),
    items: current.items.map((item) => item.status === "queued"
      ? { ...item, status: "skipped", skipReason: "canceled" }
      : item)
  });
  return { state: replaceJob(state, jobIndex, job), job };
}

export function undoImportJob(stateValue, jobId, options = {}) {
  const state = normalizeImportJobsState(stateValue);
  const jobIndex = state.items.findIndex((item) => item.id === clean(jobId));
  if (jobIndex < 0) throw new Error("没有找到这次导入任务");
  const current = state.items[jobIndex];
  if (!["completed", "failed", "canceled"].includes(current.status)) throw new Error("导入完成后才能撤销");
  if (current.undoneAt) throw new Error("这次导入已经撤销");
  const createdEntryIds = uniqueStrings(current.createdEntryIds);
  if (!createdEntryIds.length) throw new Error("这次导入没有新增案例");
  const job = normalizeImportJob({
    ...current,
    undoneAt: clean(options.now) || new Date().toISOString(),
    updatedAt: clean(options.now) || new Date().toISOString()
  });
  return { state: replaceJob(state, jobIndex, job), job, createdEntryIds };
}

export function retryImportJob(stateValue, jobId, options = {}) {
  const state = normalizeImportJobsState(stateValue);
  const source = state.items.find((item) => item.id === clean(jobId));
  if (!source) throw new Error("没有找到这次导入任务");
  const failed = source.items.filter((item) => item.status === "failed");
  if (!failed.length) throw new Error("这次导入没有可重试的失败项");
  const now = clean(options.now) || new Date().toISOString();
  const makeItemId = typeof options.itemId === "function"
    ? options.itemId
    : () => `import-item:${crypto.randomUUID()}`;
  const job = normalizeImportJob({
    id: clean(options.id) || `import-job:${crypto.randomUUID()}`,
    retryOf: source.id,
    collectionId: source.collectionId,
    status: "queued",
    createdAt: now,
    updatedAt: now,
    items: failed.map((item) => ({
      id: makeItemId(item.stagedAssetId),
      stagedAssetId: item.stagedAssetId,
      status: "queued"
    })),
    options: source.options
  });
  return { state: { ...state, items: [...state.items, job] }, job };
}

function normalizeImportItem(value, { recoverRunning = false } = {}) {
  const id = clean(value?.id);
  const stagedAssetId = clean(value?.stagedAssetId);
  if (!id || !stagedAssetId) return null;
  let status = ITEM_STATUSES.has(value?.status) ? value.status : "queued";
  return {
    id,
    stagedAssetId,
    status,
    ...(clean(value?.entryId) ? { entryId: clean(value.entryId) } : {}),
    ...(clean(value?.skipReason) ? { skipReason: clean(value.skipReason) } : {}),
    ...(clean(value?.error) ? { error: clean(value.error) } : {})
  };
}

function replaceJob(state, index, job) {
  return { ...state, items: state.items.map((item, itemIndex) => itemIndex === index ? job : item) };
}

function updateJob(stateValue, jobId, updater) {
  const state = normalizeImportJobsState(stateValue);
  const jobIndex = state.items.findIndex((item) => item.id === clean(jobId));
  if (jobIndex < 0) throw new Error("没有找到这次导入任务");
  const job = normalizeImportJob(updater(state.items[jobIndex]));
  return { state: replaceJob(state, jobIndex, job), job };
}

function clean(value) {
  return String(value ?? "").trim();
}

function uniqueStrings(value) {
  return [...new Set((Array.isArray(value) ? value : []).map(clean).filter(Boolean))];
}

function normalizeOptions(value) {
  if (!value || typeof value !== "object") return {};
  const duplicateAction = value.duplicateAction === "skip" ? "skip" : "import";
  return { duplicateAction, autoAnalyze: value.autoAnalyze === true };
}
