import { createComposerSession } from "./composer.js";

export const CREATIVE_JOBS_VERSION = 1;

export const CREATIVE_JOB_STATUSES = Object.freeze([
  "queued",
  "running",
  "completed",
  "failed",
  "canceled",
  "interrupted"
]);

export const CREATIVE_JOB_PHASES = Object.freeze([
  "planning",
  "generation",
  "downloading",
  "persisting",
  "completed"
]);

export const CREATIVE_JOB_EXECUTION_STATES = Object.freeze([
  "queued",
  "running",
  "stop_requested",
  "stop_unknown",
  "submission_unknown",
  "completed",
  "failed",
  "canceled",
  "interrupted"
]);

const ACTIVE_STATUSES = new Set(["queued", "running"]);
const RETRYABLE_STATUSES = new Set(["failed", "canceled", "interrupted"]);
const STATUS_TRANSITIONS = Object.freeze({
  queued: new Set(["queued", "running", "failed", "canceled", "interrupted"]),
  running: new Set(["running", "completed", "failed", "canceled", "interrupted"]),
  completed: new Set(["completed"]),
  failed: new Set(["failed"]),
  canceled: new Set(["canceled"]),
  interrupted: new Set(["interrupted"])
});

export function normalizeCreativeJobsState(value) {
  const seen = new Set();
  const items = [];
  for (const candidate of Array.isArray(value?.items) ? value.items : []) {
    const job = normalizeCreativeJob(candidate);
    if (!job || seen.has(job.id)) continue;
    seen.add(job.id);
    items.push(job);
  }
  return {
    version: CREATIVE_JOBS_VERSION,
    items: items.sort((left, right) => left.createdAt.localeCompare(right.createdAt))
  };
}

export function createCreativeJob(stateValue, requestValue, options = {}) {
  const state = normalizeCreativeJobsState(stateValue);
  if (state.items.some((item) => ACTIVE_STATUSES.has(item.status))) {
    throw new Error("已有创作任务正在进行，请等待完成或先停止当前任务");
  }
  const now = validIso(options.now) || new Date().toISOString();
  const request = normalizeCreativeJobRequest(requestValue);
  const job = {
    id: clean(options.id) || `creative:${globalThis.crypto.randomUUID()}`,
    version: CREATIVE_JOBS_VERSION,
    sessionId: request.session.id,
    userMessageId: request.userMessageId,
    status: "queued",
    executionState: "queued",
    providerMayHaveAccepted: false,
    stopRequestedAt: "",
    phase: request.startPhase,
    actualStages: [],
    retryOf: clean(options.retryOf),
    request,
    remoteVideo: null,
    error: null,
    createdAt: now,
    updatedAt: now,
    startedAt: "",
    completedAt: ""
  };
  const next = normalizeCreativeJobsState({ ...state, items: [...state.items, job] });
  return { state: next, job: structuredClone(job) };
}

export function updateCreativeJob(stateValue, jobIdValue, patchValue = {}, options = {}) {
  const state = normalizeCreativeJobsState(stateValue);
  const jobId = clean(jobIdValue);
  const index = state.items.findIndex((item) => item.id === jobId);
  if (index < 0) throw new Error("没有找到对应的创作任务");

  const current = state.items[index];
  const status = CREATIVE_JOB_STATUSES.includes(patchValue.status) ? patchValue.status : current.status;
  const phase = CREATIVE_JOB_PHASES.includes(patchValue.phase) ? patchValue.phase : current.phase;
  if (!STATUS_TRANSITIONS[current.status].has(status)) {
    throw new Error(`创作任务不能从 ${current.status} 变为 ${status}`);
  }
  if (phaseIndex(phase) < phaseIndex(current.phase)) {
    throw new Error(`创作任务阶段不能从 ${current.phase} 回退到 ${phase}`);
  }
  if (status === "completed" && phase !== "completed") {
    throw new Error("完成的创作任务必须处于完成阶段");
  }
  const now = validIso(options.now) || new Date().toISOString();
  const nextJob = {
    ...current,
    status,
    phase,
    actualStages: normalizeActualStages(current.actualStages, patchValue.actualStages),
    executionState: normalizeExecutionState(patchValue.executionState, status, current.executionState),
    providerMayHaveAccepted: current.providerMayHaveAccepted || patchValue.providerMayHaveAccepted === true,
    stopRequestedAt: validIso(patchValue.stopRequestedAt) || current.stopRequestedAt,
    error: Object.hasOwn(patchValue, "error") ? normalizeCreativeJobError(patchValue.error) : current.error,
    remoteVideo: Object.hasOwn(patchValue, "remoteVideo") ? normalizeRemoteVideo(patchValue.remoteVideo) : current.remoteVideo,
    updatedAt: now,
    startedAt: current.startedAt || (status === "running" ? now : ""),
    completedAt: terminalStatus(status) ? current.completedAt || now : ""
  };
  state.items[index] = nextJob;
  return normalizeCreativeJobsState(state);
}

export function interruptActiveCreativeJobs(stateValue, options = {}) {
  const state = normalizeCreativeJobsState(stateValue);
  const now = validIso(options.now) || new Date().toISOString();
  return normalizeCreativeJobsState({
    ...state,
    items: state.items.map((job) => ACTIVE_STATUSES.has(job.status) ? {
      ...job,
      status: "interrupted",
      executionState: job.providerMayHaveAccepted && !job.remoteVideo ? "submission_unknown" : "interrupted",
      error: {
        kind: job.providerMayHaveAccepted && !job.remoteVideo ? "submission_unknown" : "interrupted",
        message: job.providerMayHaveAccepted && !job.remoteVideo
          ? "服务商可能已接收本次创作，但插件尚未取得可恢复编号。提交结果未知，不会自动重试"
          : job.remoteVideo
            ? "远程任务恢复失败，已保留任务编号，请手动重试继续查询"
            : "浏览器曾在任务完成前退出，结果状态未知，请手动重试",
        retryable: true
      },
      updatedAt: now,
      completedAt: now
    } : job)
  });
}

export function requestCreativeJobStop(stateValue, jobIdValue, options = {}) {
  const state = normalizeCreativeJobsState(stateValue);
  const current = creativeJobById(state, jobIdValue);
  if (!current) throw new Error("没有找到对应的创作任务");
  if (!ACTIVE_STATUSES.has(current.status)) return { state, job: current };
  const now = validIso(options.now) || new Date().toISOString();
  const next = updateCreativeJob(state, current.id, {
    executionState: "stop_requested",
    stopRequestedAt: now
  }, { now });
  return { state: next, job: creativeJobById(next, current.id) };
}

export function settleCreativeJobStop(stateValue, jobIdValue, options = {}) {
  const state = normalizeCreativeJobsState(stateValue);
  const current = creativeJobById(state, jobIdValue);
  if (!current) throw new Error("没有找到对应的创作任务");
  if (!ACTIVE_STATUSES.has(current.status)) return { state, job: current };
  const providerMayHaveAccepted = current.providerMayHaveAccepted || options.providerMayHaveAccepted === true;
  const providerCancelConfirmed = options.providerCancelConfirmed === true;
  const canceled = providerCancelConfirmed || !providerMayHaveAccepted;
  const next = updateCreativeJob(state, current.id, canceled ? {
    status: "canceled",
    executionState: "canceled",
    providerMayHaveAccepted,
    error: {
      kind: "canceled",
      message: providerCancelConfirmed ? "服务商已确认取消本次创作" : "任务已在发出服务请求前停止",
      retryable: true
    }
  } : {
    status: "interrupted",
    executionState: "stop_unknown",
    providerMayHaveAccepted: true,
    error: {
      kind: "stop_unknown",
      message: "插件已停止等待，但服务商是否停止仍未知。本轮不会自动重试，再次创作可能重复计费",
      retryable: true
    }
  }, options);
  return { state: next, job: creativeJobById(next, current.id) };
}

export function retryCreativeJob(stateValue, jobIdValue, options = {}) {
  const state = normalizeCreativeJobsState(stateValue);
  const source = state.items.find((item) => item.id === clean(jobIdValue));
  if (!source) throw new Error("没有找到需要重试的创作任务");
  if (!RETRYABLE_STATUSES.has(source.status)) throw new Error("当前创作任务不能重试");
  if (source.error?.retryable === false) throw new Error("当前创作任务需要重新发起，不能直接重试");
  const created = createCreativeJob(state, source.request, { ...options, retryOf: source.id });
  if (!source.remoteVideo || source.error?.kind === "expired") return created;
  const resumedState = updateCreativeJob(created.state, created.job.id, {
    phase: source.phase,
    remoteVideo: source.remoteVideo
  }, options);
  return { state: resumedState, job: creativeJobById(resumedState, created.job.id) };
}

export function activeCreativeJob(stateValue) {
  return normalizeCreativeJobsState(stateValue).items.find((item) => ACTIVE_STATUSES.has(item.status)) ?? null;
}

export function creativeJobById(stateValue, jobIdValue) {
  const job = normalizeCreativeJobsState(stateValue).items.find((item) => item.id === clean(jobIdValue));
  return job ? structuredClone(job) : null;
}

function normalizeCreativeJob(value) {
  const id = clean(value?.id);
  if (!id || !CREATIVE_JOB_STATUSES.includes(value?.status)) return null;
  let request;
  try {
    request = normalizeCreativeJobRequest(value.request);
  } catch {
    return null;
  }
  const createdAt = validIso(value.createdAt) || new Date().toISOString();
  const status = value.status;
  const legacyProviderState = !Object.hasOwn(value, "providerMayHaveAccepted") && status === "running";
  return {
    id,
    version: CREATIVE_JOBS_VERSION,
    sessionId: request.session.id,
    userMessageId: request.userMessageId,
    status,
    executionState: normalizeExecutionState(value.executionState, status),
    providerMayHaveAccepted: value.providerMayHaveAccepted === true || legacyProviderState,
    stopRequestedAt: validIso(value.stopRequestedAt),
    phase: CREATIVE_JOB_PHASES.includes(value.phase) ? value.phase : request.startPhase,
    actualStages: normalizeActualStages(value.actualStages),
    retryOf: clean(value.retryOf),
    request,
    remoteVideo: normalizeRemoteVideo(value.remoteVideo),
    error: normalizeCreativeJobError(value.error),
    createdAt,
    updatedAt: validIso(value.updatedAt) || createdAt,
    startedAt: validIso(value.startedAt),
    completedAt: terminalStatus(status) ? validIso(value.completedAt) : ""
  };
}

function normalizeRemoteVideo(value) {
  if (!value || typeof value !== "object") return null;
  const serviceId = ["openai", "xai", "gemini", "openrouter", "minimax", "volcengine"].includes(value.serviceId) ? value.serviceId : "";
  const remoteId = clean(value.remoteId);
  const finalPrompt = clean(value.finalPrompt);
  if (!serviceId || !remoteId || !finalPrompt) return null;
  const requestParameters = Object.fromEntries(["size", "duration", "resolution", "aspectRatio"]
    .map((key) => [key, clean(value.requestParameters?.[key])])
    .filter(([, parameter]) => parameter));
  const job = value.job && typeof value.job === "object" ? normalizeProviderJob(value.job, serviceId, remoteId) : null;
  return { serviceId, remoteId, finalPrompt, requestParameters, ...(job ? { job } : {}) };
}

function normalizeProviderJob(value, providerId, remoteId) {
  if (clean(value.providerId) !== providerId || clean(value.remoteId) !== remoteId) return null;
  const protocol = clean(value.protocol);
  if (!protocol) return null;
  return {
    providerId,
    protocol,
    remoteId,
    requestModel: clean(value.requestModel),
    status: ["submitted", "running", "completed"].includes(value.status) ? value.status : "submitted",
    submittedAt: validIso(value.submittedAt),
    pollUrl: safeHttpsUrl(value.pollUrl)
  };
}

function safeHttpsUrl(value) {
  try {
    const url = new URL(clean(value));
    return url.protocol === "https:" && !url.username && !url.password ? url.href : "";
  } catch {
    return "";
  }
}

function normalizeCreativeJobRequest(value = {}) {
  const session = createComposerSession(value.session);
  const userMessageId = clean(value.userMessageId);
  if (!userMessageId || !session.messages.some((message) => message.id === userMessageId && message.role === "user")) {
    throw new Error("创作任务缺少已保存的用户消息");
  }
  const imageEdit = normalizeImageEdit(value.imageEdit);
  return {
    session,
    userMessageId,
    startPhase: CREATIVE_JOB_PHASES.includes(value.startPhase) && value.startPhase !== "completed"
      ? value.startPhase
      : "planning",
    imageEdit
  };
}

function normalizeImageEdit(value) {
  if (!value) return null;
  const mode = value.mode === "local" ? "local" : value.mode === "whole" ? "whole" : "regenerate";
  const parentVisualId = clean(value.parentVisualId);
  if (!parentVisualId) throw new Error("图片编辑任务缺少原图");
  const maskAssetId = mode === "local" ? clean(value.maskAssetId) : "";
  if (mode === "local" && !maskAssetId) throw new Error("局部修改任务缺少遮罩");
  return {
    mode,
    parentVisualId,
    maskAssetId,
    modification: clean(value.modification),
    originalPrompt: clean(value.originalPrompt)
  };
}

function normalizeCreativeJobError(value) {
  if (!value) return null;
  const message = clean(value.message);
  if (!message) return null;
  return {
    kind: clean(value.kind) || "failed",
    message,
    retryable: value.retryable === true
  };
}

function terminalStatus(status) {
  return ["completed", "failed", "canceled", "interrupted"].includes(status);
}

function normalizeExecutionState(value, status, fallback = "") {
  if (CREATIVE_JOB_EXECUTION_STATES.includes(value)) return value;
  if (status === "completed") return "completed";
  if (status === "failed") return "failed";
  if (status === "canceled") return "canceled";
  if (status === "interrupted") return "interrupted";
  if (fallback === "stop_requested") return "stop_requested";
  return status === "running" ? "running" : "queued";
}

function phaseIndex(phase) {
  return CREATIVE_JOB_PHASES.indexOf(phase);
}

function normalizeActualStages(...values) {
  return [...new Set(values.flatMap((value) => Array.isArray(value) ? value : [])
    .map(clean)
    .filter(Boolean))];
}

function clean(value) {
  return String(value ?? "").trim();
}

function validIso(value) {
  const text = clean(value);
  return text && !Number.isNaN(Date.parse(text)) ? text : "";
}
