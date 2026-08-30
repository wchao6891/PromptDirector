import {
  createAnalysisTask,
  normalizeAnalysisPriority,
  normalizeAnalysisTask,
  restartRunningAnalysisTask
} from "./analysis-tasks.js";

const ANALYSIS_TASK_REGISTRY_VERSION = 1;
const MAX_PERSISTED_ANALYSIS_TASKS = 50;

export function createOrJoinAnalysisTask(value, requestValue = {}, options = {}) {
  const state = normalizeAnalysisTaskRegistry(value);
  const request = normalizeRequest(requestValue);
  if (!request.clientRequestId) throw new Error("分析任务缺少请求编号");
  if (request.kind === "entry_video") {
    if (!request.entryId || !request.assetId || !request.mode) throw new Error("视频分析任务缺少案例、视频或分析方式");
  } else if (!request.sessionId || !request.tempReferenceIds.length) {
    throw new Error("图片分析任务缺少会话或参考图片");
  }
  const activeVideoTask = request.kind === "entry_video"
    ? state.items.find((task) => ["queued", "running"].includes(task.status)
      && task.request.kind === "entry_video"
      && task.request.entryId === request.entryId
      && task.request.assetId === request.assetId)
    : null;
  const existing = state.items.find((task) => task.clientRequestIds.includes(request.clientRequestId))
    ?? (activeVideoTask && sameEntryVideoRequest(activeVideoTask.request, request) ? activeVideoTask : null);
  if (!existing && activeVideoTask) throw new Error("当前视频已有分析在运行，请等待或停止后再发起");
  if (existing) {
    if (request.consumerId && !existing.consumerIds.includes(request.consumerId)) existing.consumerIds.push(request.consumerId);
    if (!existing.clientRequestIds.includes(request.clientRequestId)) existing.clientRequestIds.push(request.clientRequestId);
    return { state, task: structuredClone(existing), created: false };
  }
  const task = createAnalysisTask({
    id: options.taskId,
    priority: request.priority,
    now: options.now
  });
  Object.assign(task, {
    request: {
      kind: request.kind,
      sessionId: request.sessionId,
      tempReferenceIds: request.tempReferenceIds,
      entryId: request.entryId,
      assetId: request.assetId,
      mode: request.mode,
      instruction: request.instruction,
      includeTags: request.includeTags,
      batchJobId: request.batchJobId,
      batchClaimId: request.batchClaimId,
      sourceFingerprint: request.sourceFingerprint,
      protocol: request.protocol,
      sourceKind: request.sourceKind,
      routeEndpoint: request.routeEndpoint,
      routeProviderId: request.routeProviderId,
      routeModel: request.routeModel,
      localVideo: request.localVideo,
      preferPublicVideoUrl: request.preferPublicVideoUrl,
      publicVideoUrl: request.publicVideoUrl,
      hasRouteSnapshot: request.hasRouteSnapshot,
      outputLocale: request.outputLocale,
      priority: request.priority
    },
    consumerIds: request.consumerId ? [request.consumerId] : [],
    clientRequestIds: [request.clientRequestId]
  });
  state.items.push(task);
  state.items = state.items.slice(-MAX_PERSISTED_ANALYSIS_TASKS);
  return { state, task: structuredClone(task), created: true };
}

export function detachAnalysisTaskConsumer(value, taskIdValue, consumerIdValue, clientRequestIdValue = "") {
  const state = normalizeAnalysisTaskRegistry(value);
  const taskId = clean(taskIdValue);
  const consumerId = clean(consumerIdValue);
  const clientRequestId = clean(clientRequestIdValue);
  const task = state.items.find((item) => item.id === taskId)
    ?? state.items.find((item) => clientRequestId && item.clientRequestIds.includes(clientRequestId));
  if (!task) throw new Error("没有找到图片分析任务");
  task.consumerIds = task.consumerIds.filter((id) => id !== consumerId);
  return { state, task: structuredClone(task) };
}

export function replaceAnalysisTask(value, taskValue) {
  const state = normalizeAnalysisTaskRegistry(value);
  const task = normalizeRegistryTask(taskValue);
  const index = state.items.findIndex((item) => item.id === task.id);
  if (index < 0) state.items.push(task);
  else state.items[index] = task;
  state.items = state.items.slice(-MAX_PERSISTED_ANALYSIS_TASKS);
  return state;
}

export function recoverInterruptedAnalysisTasks(value, options = {}) {
  const state = normalizeAnalysisTaskRegistry(value);
  state.items = state.items.map((task) => task.status === "running"
    ? normalizeRegistryTask(restartRunningAnalysisTask(task, options))
    : task);
  return state;
}

export function analysisTaskById(value, taskIdValue) {
  const taskId = clean(taskIdValue);
  const task = normalizeAnalysisTaskRegistry(value).items.find((item) => item.id === taskId);
  return task ? structuredClone(task) : null;
}

export function normalizeAnalysisTaskRegistry(value) {
  const items = [];
  const seen = new Set();
  for (const raw of Array.isArray(value?.items) ? value.items : []) {
    const task = normalizeRegistryTask(raw);
    if (seen.has(task.id)) continue;
    seen.add(task.id);
    items.push(task);
  }
  return { version: ANALYSIS_TASK_REGISTRY_VERSION, items: items.slice(-MAX_PERSISTED_ANALYSIS_TASKS) };
}

function normalizeRegistryTask(value) {
  const task = normalizeAnalysisTask(value);
  task.request = normalizeRequest(value?.request);
  task.consumerIds = uniqueIds(value?.consumerIds);
  task.clientRequestIds = uniqueIds(value?.clientRequestIds);
  return task;
}

function normalizeRequest(value = {}) {
  const kind = value.kind === "entry_video" ? "entry_video" : "temp_references";
  return {
    kind,
    sessionId: clean(value.sessionId),
    tempReferenceIds: uniqueIds(value.tempReferenceIds),
    entryId: kind === "entry_video" ? clean(value.entryId) : "",
    assetId: kind === "entry_video" ? clean(value.assetId) : "",
    mode: kind === "entry_video" ? clean(value.mode) : "",
    instruction: kind === "entry_video" ? cleanMultiline(value.instruction) : "",
    includeTags: kind === "entry_video" ? value.includeTags !== false : false,
    batchJobId: kind === "entry_video" ? clean(value.batchJobId) : "",
    batchClaimId: kind === "entry_video" ? clean(value.batchClaimId) : "",
    sourceFingerprint: kind === "entry_video" ? clean(value.sourceFingerprint) : "",
    protocol: kind === "entry_video" ? clean(value.protocol) : "",
    sourceKind: kind === "entry_video" ? clean(value.sourceKind) : "",
    routeEndpoint: kind === "entry_video" ? clean(value.routeEndpoint) : "",
    routeProviderId: kind === "entry_video" ? clean(value.routeProviderId) : "",
    routeModel: kind === "entry_video" ? clean(value.routeModel) : "",
    localVideo: kind === "entry_video" ? clean(value.localVideo) : "",
    preferPublicVideoUrl: kind === "entry_video" && typeof value.preferPublicVideoUrl === "boolean"
      ? value.preferPublicVideoUrl
      : null,
    publicVideoUrl: kind === "entry_video" ? clean(value.publicVideoUrl) : "",
    hasRouteSnapshot: kind === "entry_video" ? value.hasRouteSnapshot === true : false,
    outputLocale: value.outputLocale === "en" ? "en" : "zh-CN",
    priority: normalizeAnalysisPriority(value.priority),
    consumerId: clean(value.consumerId),
    clientRequestId: clean(value.clientRequestId)
  };
}

function sameEntryVideoRequest(left, right) {
  return left.entryId === right.entryId
    && left.assetId === right.assetId
    && left.mode === right.mode
    && left.instruction === right.instruction
    && left.includeTags === right.includeTags
    && left.batchJobId === right.batchJobId
    && left.batchClaimId === right.batchClaimId
    && left.sourceFingerprint === right.sourceFingerprint
    && left.protocol === right.protocol
    && left.sourceKind === right.sourceKind
    && left.routeEndpoint === right.routeEndpoint
    && left.routeProviderId === right.routeProviderId
    && left.routeModel === right.routeModel
    && left.localVideo === right.localVideo
    && left.preferPublicVideoUrl === right.preferPublicVideoUrl
    && left.publicVideoUrl === right.publicVideoUrl
    && left.hasRouteSnapshot === right.hasRouteSnapshot
    && left.outputLocale === right.outputLocale;
}

function uniqueIds(values) {
  return [...new Set((Array.isArray(values) ? values : []).map(clean).filter(Boolean))];
}

function clean(value) {
  return String(value ?? "").trim();
}

function cleanMultiline(value) {
  return String(value ?? "").replace(/\r\n?/gu, "\n").trim();
}
