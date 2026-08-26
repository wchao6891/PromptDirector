import { analysisTaskPriorityRank, normalizeAnalysisPriority } from "./analysis-tasks.js";
import { ANALYSIS_RETRY_POLICY } from "./analysis-retry-policy.js";

const schedulers = new Map();
const inFlight = new Map();
const RETRYABLE_STATUSES = new Set([0, 408, 429, 500, 502, 503, 504]);
const SHARED_QUEUE_AGING_MS = 30_000;

export function createAnalysisScheduler(options = {}) {
  const limit = normalizedQueueConcurrency(options.concurrency);
  const agingMs = Math.max(1, Math.floor(Number(options.agingMs) || 30_000));
  const state = {
    active: 0,
    limit,
    queue: [],
    nextSequence: 0,
    nextId: 0,
    agingMs
  };

  return {
    schedule(task, scheduleOptions = {}) {
      if (typeof task !== "function") throw new Error("分析调度参数无效");
      const item = {
        id: `analysis-scheduler-item:${++state.nextId}`,
        task,
        priority: normalizeAnalysisPriority(scheduleOptions.priority),
        enqueuedAt: toTime(scheduleOptions.now),
        sequence: state.nextSequence++,
        started: false,
        canceled: false
      };
      const promise = new Promise((resolve, reject) => {
        item.resolve = resolve;
        item.reject = reject;
      });
      const handle = {
        id: item.id,
        status: "queued",
        promise,
        cancel: () => cancelQueuedItem(state, item)
      };
      item.handle = handle;
      state.queue.push(item);
      drainPriorityQueue(state);
      return handle;
    },
    snapshot() {
      return {
        active: state.active,
        limit: state.limit,
        queued: state.queue
          .filter((item) => !item.canceled)
          .map((item) => ({
            id: item.id,
            priority: item.priority,
            sequence: item.sequence,
            ageMs: Math.max(0, Date.now() - item.enqueuedAt)
          }))
      };
    }
  };
}

export function scheduleAnalysis(keyValue, concurrencyValue, task, options = {}) {
  const key = String(keyValue ?? "").trim();
  if (!key || typeof task !== "function") throw new Error("分析调度参数无效");
  const concurrency = normalizedConcurrency(concurrencyValue);
  const state = schedulers.get(key) ?? {
    active: 0,
    limit: concurrency,
    effectiveLimit: concurrency,
    queue: [],
    activeItems: new Set(),
    nextSequence: 0,
    throttledUntil: 0
  };
  state.activeItems ??= new Set();
  if (!schedulers.has(key)) schedulers.set(key, state);
  return new Promise((resolve, reject) => {
    state.queue.push({
      task,
      resolve,
      reject,
      concurrency,
      priority: normalizeAnalysisPriority(options.priority),
      enqueuedAt: Date.now(),
      sequence: state.nextSequence++
    });
    synchronizeLimit(state);
    drain(state);
  });
}

export function coalesceAnalysisRequest(keyValue, task, options = {}) {
  const key = String(keyValue ?? "").trim();
  if (!key) return task();
  if (inFlight.has(key)) {
    options.onCoalesced?.();
    return inFlight.get(key);
  }
  const promise = Promise.resolve().then(task).finally(() => inFlight.delete(key));
  inFlight.set(key, promise);
  return promise;
}

export async function runScheduledAnalysisWithRetries(options = {}) {
  const wait = options.wait ?? defaultWait;
  const jitter = options.jitter ?? (() => Math.floor(Math.random() * 501));
  let retries = 0;
  for (;;) {
    try {
      return await scheduleAnalysis(options.key, options.concurrency, options.task, {
        priority: options.priority
      });
    } catch (error) {
      if (!isRetryable(error) || retries >= ANALYSIS_RETRY_POLICY.serviceRetries) throw error;
      const retryAfter = Number(error?.retryAfterMs) || 0;
      const delay = retryAfter || ANALYSIS_RETRY_POLICY.backoffMs[retries] + Math.max(0, Number(jitter()) || 0);
      retries += 1;
      await wait(delay);
    }
  }
}

function drain(state) {
  synchronizeLimit(state);
  while (state.active < state.effectiveLimit && state.queue.length) {
    const item = nextSharedItem(state);
    if (!item) return;
    state.active += 1;
    state.activeItems.add(item);
    Promise.resolve().then(item.task).then((value) => {
      if (state.throttledUntil && Date.now() >= state.throttledUntil) {
        state.effectiveLimit = Math.min(state.limit, state.effectiveLimit + 1);
        if (state.effectiveLimit === state.limit) state.throttledUntil = 0;
      }
      item.resolve(value);
    }, (error) => {
      if ([429, 503].includes(Number(error?.status))) {
        state.effectiveLimit = Math.max(1, Math.floor(state.effectiveLimit / 2));
        state.throttledUntil = Date.now() + 30_000;
      }
      item.reject(error);
    }).finally(() => {
      state.active -= 1;
      state.activeItems.delete(item);
      synchronizeLimit(state);
      drain(state);
    });
  }
}

function nextSharedItem(state) {
  let bestIndex = -1;
  let bestScore = Infinity;
  let bestSequence = Infinity;
  const now = Date.now();
  for (let index = 0; index < state.queue.length; index += 1) {
    const item = state.queue[index];
    const score = analysisPriorityScore(item.priority, now - item.enqueuedAt, SHARED_QUEUE_AGING_MS);
    if (score < bestScore || (score === bestScore && item.sequence < bestSequence)) {
      bestIndex = index;
      bestScore = score;
      bestSequence = item.sequence;
    }
  }
  if (bestIndex < 0) return null;
  return state.queue.splice(bestIndex, 1)[0];
}

function drainPriorityQueue(state) {
  while (state.active < state.limit) {
    const item = nextPriorityItem(state);
    if (!item) return;
    item.started = true;
    state.active += 1;
    item.handle.status = "running";
    Promise.resolve()
      .then(item.task)
      .then((value) => {
        item.handle.status = "completed";
        item.resolve(value);
      }, (error) => {
        item.handle.status = "failed";
        item.reject(error);
      })
      .finally(() => {
        state.active -= 1;
        drainPriorityQueue(state);
      });
  }
}

function nextPriorityItem(state) {
  const now = Date.now();
  let bestIndex = -1;
  let bestScore = Infinity;
  let bestSequence = Infinity;
  for (let index = 0; index < state.queue.length; index += 1) {
    const item = state.queue[index];
    if (item.canceled || item.started) continue;
    const score = analysisPriorityScore(item.priority, now - item.enqueuedAt, state.agingMs);
    if (score < bestScore || (score === bestScore && item.sequence < bestSequence)) {
      bestIndex = index;
      bestScore = score;
      bestSequence = item.sequence;
    }
  }
  if (bestIndex < 0) return null;
  const [item] = state.queue.splice(bestIndex, 1);
  return item;
}

function analysisPriorityScore(priority, waitMs, agingMs) {
  const rank = analysisTaskPriorityRank(priority);
  return rank - Math.floor(Math.max(0, waitMs) / agingMs);
}

function cancelQueuedItem(state, item) {
  if (item.started || item.canceled) return false;
  item.canceled = true;
  item.handle.status = "canceled";
  const index = state.queue.indexOf(item);
  if (index >= 0) state.queue.splice(index, 1);
  item.reject(abortError());
  return true;
}

function synchronizeLimit(state) {
  const requestedLimits = [...state.activeItems, ...state.queue].map((item) => item.concurrency);
  if (requestedLimits.length) state.limit = Math.min(...requestedLimits);
  state.effectiveLimit = state.throttledUntil
    ? Math.min(state.effectiveLimit, state.limit)
    : state.limit;
}

function isRetryable(error) {
  if (error?.status === undefined || error?.status === null) return false;
  const status = Number(error.status) || 0;
  return error?.name !== "AbortError" && RETRYABLE_STATUSES.has(status);
}

function normalizedConcurrency(value) {
  const number = Number(value);
  return Number.isInteger(number) && number >= 2 ? number : 2;
}

function normalizedQueueConcurrency(value) {
  const number = Number(value);
  return Number.isInteger(number) && number >= 1 ? number : 1;
}

function defaultWait(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function toTime(value) {
  if (Number.isFinite(value)) return Math.max(0, Math.floor(value));
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(0, Math.floor(parsed)) : Date.now();
}

function abortError() {
  const error = new Error("分析任务已取消");
  error.name = "AbortError";
  return error;
}
