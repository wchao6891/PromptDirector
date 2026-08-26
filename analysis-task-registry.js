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
  if (!request.sessionId || !request.tempReferenceIds.length || !request.clientRequestId) {
    throw new Error("图片分析任务缺少会话、参考图片或请求编号");
  }
  const existing = state.items.find((task) => task.clientRequestIds.includes(request.clientRequestId));
  if (existing) {
    if (request.consumerId && !existing.consumerIds.includes(request.consumerId)) existing.consumerIds.push(request.consumerId);
    return { state, task: structuredClone(existing), created: false };
  }
  const task = createAnalysisTask({
    id: options.taskId,
    priority: request.priority,
    now: options.now
  });
  Object.assign(task, {
    request: {
      sessionId: request.sessionId,
      tempReferenceIds: request.tempReferenceIds,
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
  return {
    sessionId: clean(value.sessionId),
    tempReferenceIds: uniqueIds(value.tempReferenceIds),
    outputLocale: value.outputLocale === "en" ? "en" : "zh-CN",
    priority: normalizeAnalysisPriority(value.priority),
    consumerId: clean(value.consumerId),
    clientRequestId: clean(value.clientRequestId)
  };
}

function uniqueIds(values) {
  return [...new Set((Array.isArray(values) ? values : []).map(clean).filter(Boolean))];
}

function clean(value) {
  return String(value ?? "").trim();
}
