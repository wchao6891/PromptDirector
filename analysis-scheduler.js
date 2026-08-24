import { ANALYSIS_RETRY_POLICY } from "./analysis-retry-policy.js";

const schedulers = new Map();
const inFlight = new Map();
const RETRYABLE_STATUSES = new Set([0, 408, 429, 500, 502, 503, 504]);

export function scheduleAnalysis(keyValue, concurrencyValue, task) {
  const key = String(keyValue ?? "").trim();
  if (!key || typeof task !== "function") throw new Error("分析调度参数无效");
  const concurrency = normalizedConcurrency(concurrencyValue);
  const state = schedulers.get(key) ?? { active: 0, limit: concurrency, effectiveLimit: concurrency, queue: [], throttledUntil: 0 };
  state.limit = concurrency;
  state.effectiveLimit = state.throttledUntil
    ? Math.min(state.effectiveLimit, concurrency)
    : concurrency;
  if (!schedulers.has(key)) schedulers.set(key, state);
  return new Promise((resolve, reject) => {
    state.queue.push({ task, resolve, reject });
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
      return await scheduleAnalysis(options.key, options.concurrency, options.task);
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
  while (state.active < state.effectiveLimit && state.queue.length) {
    const item = state.queue.shift();
    state.active += 1;
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
      drain(state);
    });
  }
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

function defaultWait(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
