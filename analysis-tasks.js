export const ANALYSIS_TASK_PRIORITIES = Object.freeze(["interactive", "user_batch", "background_import"]);

export function normalizeAnalysisPriority(value) {
  const priority = String(value ?? "").trim();
  return ANALYSIS_TASK_PRIORITIES.includes(priority) ? priority : "user_batch";
}

export function analysisTaskPriorityRank(value) {
  return {
    interactive: 0,
    user_batch: 1,
    background_import: 2
  }[normalizeAnalysisPriority(value)] ?? 1;
}

export function createAnalysisTask(value = {}) {
  const now = timestamp(value.now);
  return {
    version: 1,
    id: cleanId(value.id, "analysis-task"),
    priority: normalizeAnalysisPriority(value.priority),
    status: "queued",
    executionState: "queued",
    createdAt: now,
    updatedAt: now,
    activeAttemptId: "",
    attemptCount: 0,
    providerMayHaveAccepted: false,
    attempts: []
  };
}

export function startAnalysisAttempt(value, options = {}) {
  const task = normalizeAnalysisTask(value);
  if (["canceled", "completed", "failed"].includes(task.status)) {
    throw new Error("任务已经结束，不能再开始新的 Attempt");
  }
  if (task.status === "running") {
    throw new Error("任务已经在运行中");
  }
  const attemptId = cleanId(options.attemptId, "attempt");
  const now = timestamp(options.now);
  const attemptNumber = task.attemptCount + 1;
  const nextAttempt = {
    id: attemptId,
    attemptNumber,
    status: "running",
    startedAt: now,
    finishedAt: "",
    result: null,
    writeCount: 0
  };
  task.attempts.push(nextAttempt);
  task.activeAttemptId = attemptId;
  task.attemptCount = attemptNumber;
  task.status = "running";
  task.executionState = "running";
  task.updatedAt = now;
  return task;
}

export function restartRunningAnalysisTask(value, options = {}) {
  const task = normalizeAnalysisTask(value);
  if (task.status !== "running") return task;
  const now = timestamp(options.now);
  const attempt = currentAttempt(task);
  if (attempt) {
    attempt.status = "execution_state_unknown";
    attempt.finishedAt = now;
  }
  task.activeAttemptId = "";
  task.status = "stopped";
  task.executionState = "execution_state_unknown";
  task.updatedAt = now;
  return task;
}

export function cancelQueuedAnalysisTask(value, options = {}) {
  const task = normalizeAnalysisTask(value);
  if (task.status !== "queued" || task.attempts.length) return task;
  task.status = "canceled";
  task.executionState = "canceled";
  task.updatedAt = timestamp(options.now);
  return task;
}

export function applyAnalysisAttemptWrite(value, write = {}) {
  const task = normalizeAnalysisTask(value);
  const attemptId = String(write.attemptId ?? "").trim();
  const attempt = attemptId ? task.attempts.find((item) => item.id === attemptId) : null;
  if (!attempt || task.activeAttemptId !== attemptId || task.status !== "running" || task.executionState !== "running" || attempt.status !== "running") {
    throw staleAttemptError();
  }
  const now = timestamp(write.now);
  if (Object.hasOwn(write, "result")) {
    attempt.result = structuredClone(write.result);
  }
  attempt.writeCount += 1;
  task.updatedAt = now;
  return task;
}

export function completeAnalysisAttempt(value, options = {}) {
  const task = applyAnalysisAttemptWrite(value, {
    attemptId: options.attemptId,
    result: options.result,
    now: options.now
  });
  const attempt = currentAttempt(task);
  attempt.status = "completed";
  attempt.finishedAt = timestamp(options.now);
  task.status = "completed";
  task.executionState = "completed";
  task.activeAttemptId = "";
  task.updatedAt = attempt.finishedAt;
  return task;
}

export function failAnalysisAttempt(value, options = {}) {
  const task = normalizeAnalysisTask(value);
  const attempt = requireActiveAttempt(task, options.attemptId);
  const now = timestamp(options.now);
  attempt.status = "failed";
  attempt.finishedAt = now;
  attempt.error = String(options.error ?? "").trim();
  task.status = "failed";
  task.executionState = "failed";
  task.activeAttemptId = "";
  task.updatedAt = now;
  return task;
}

export function retryAnalysisAttempt(value, options = {}) {
  const task = normalizeAnalysisTask(value);
  if (options.confirmed !== true) throw new Error("重新发起分析前必须确认可能再次计费");
  if (!["failed", "stopped"].includes(task.status) && task.executionState !== "execution_state_unknown") {
    throw new Error("当前分析任务不能重新发起");
  }
  task.status = "queued";
  task.executionState = "queued";
  task.activeAttemptId = "";
  task.providerMayHaveAccepted = false;
  return startAnalysisAttempt(task, options);
}

export function stopAnalysisTask(value, options = {}) {
  const task = normalizeAnalysisTask(value);
  if (["completed", "failed", "canceled"].includes(task.status)) return task;
  const now = timestamp(options.now);
  const attempt = currentAttempt(task);
  task.providerMayHaveAccepted = task.status === "running" || Boolean(attempt);
  if (attempt?.status === "running") {
    attempt.status = "canceled";
    attempt.finishedAt = now;
  }
  task.status = "stopped";
  task.executionState = "canceled";
  task.activeAttemptId = "";
  task.updatedAt = now;
  return task;
}

export function normalizeAnalysisTask(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return createAnalysisTask();
  }
  const task = structuredClone(value);
  task.version = 1;
  task.id = cleanId(task.id, "analysis-task");
  task.priority = normalizeAnalysisPriority(task.priority);
  task.status = normalizeTaskStatus(task.status);
  task.executionState = normalizeExecutionState(task.executionState, task.status);
  task.createdAt = String(task.createdAt ?? "");
  task.updatedAt = String(task.updatedAt ?? task.createdAt ?? "");
  task.activeAttemptId = String(task.activeAttemptId ?? "");
  task.attemptCount = Math.max(0, Math.floor(Number(task.attemptCount) || 0));
  task.providerMayHaveAccepted = task.providerMayHaveAccepted === true;
  task.attempts = Array.isArray(task.attempts)
    ? task.attempts.flatMap((attempt) => normalizeAttempt(attempt))
    : [];
  if (!task.attemptCount) task.attemptCount = task.attempts.reduce((max, attempt) => Math.max(max, attempt.attemptNumber), 0);
  const activeAttempt = task.activeAttemptId ? task.attempts.find((attempt) => attempt.id === task.activeAttemptId) : null;
  if (task.status === "running" && (!activeAttempt || activeAttempt.status !== "running")) {
    task.status = "stopped";
    task.executionState = "execution_state_unknown";
    task.activeAttemptId = "";
  }
  if (task.status !== "running" && task.executionState === "running") {
    task.executionState = task.status === "queued" ? "queued" : task.status === "canceled" ? "canceled" : task.status === "completed" ? "completed" : "execution_state_unknown";
  }
  return task;
}

function normalizeAttempt(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return [];
  const id = cleanId(value.id, "attempt");
  const attemptNumber = Math.max(1, Math.floor(Number(value.attemptNumber) || 0));
  const status = normalizeAttemptStatus(value.status);
  return [{
    id,
    attemptNumber,
    status,
    startedAt: String(value.startedAt ?? ""),
    finishedAt: String(value.finishedAt ?? ""),
    result: Object.hasOwn(value, "result") ? structuredClone(value.result) : null,
    error: String(value.error ?? ""),
    writeCount: Math.max(0, Math.floor(Number(value.writeCount) || 0))
  }];
}

function normalizeTaskStatus(value) {
  const status = String(value ?? "").trim();
  return ["queued", "running", "stopped", "completed", "failed", "canceled"].includes(status) ? status : "queued";
}

function normalizeExecutionState(value, status) {
  const state = String(value ?? "").trim();
  if (["queued", "running", "execution_state_unknown", "completed", "failed", "canceled"].includes(state)) return state;
  return status === "running" ? "running"
    : status === "canceled" ? "canceled"
    : status === "completed" ? "completed"
    : status === "failed" ? "failed"
    : status === "stopped" ? "execution_state_unknown"
    : "queued";
}

function normalizeAttemptStatus(value) {
  const status = String(value ?? "").trim();
  return ["queued", "running", "execution_state_unknown", "completed", "failed", "canceled"].includes(status)
    ? status
    : "queued";
}

function currentAttempt(task) {
  return task.activeAttemptId ? task.attempts.find((attempt) => attempt.id === task.activeAttemptId) ?? null : null;
}

function requireActiveAttempt(task, attemptIdValue) {
  const attemptId = String(attemptIdValue ?? "").trim();
  const attempt = currentAttempt(task);
  if (!attempt || attempt.id !== attemptId || task.status !== "running" || task.executionState !== "running" || attempt.status !== "running") {
    throw staleAttemptError();
  }
  return attempt;
}

function staleAttemptError() {
  const error = new Error("这次写回已经失效，请重新发起新的 Attempt");
  error.code = "STALE_ATTEMPT";
  return error;
}

function cleanId(value, fallbackPrefix) {
  const text = String(value ?? "").trim();
  return text || `${fallbackPrefix}:${globalThis.crypto.randomUUID()}`;
}

function timestamp(value) {
  return String(value ?? new Date().toISOString());
}
