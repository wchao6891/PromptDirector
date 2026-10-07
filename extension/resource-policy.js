// Working budgets protect a process, never define how many cases or original
// files a library may contain. Explicit caller budgets take precedence.
const MiB = 1024 * 1024;

export const RESOURCE_POLICY = Object.freeze({
  // When a heap measurement is unavailable, allow a 512 MiB working set. This
  // is an operation policy, not a browser limit. The fractions reserve room for
  // the UI, two RGBA surfaces, text decoding, and concurrent operations.
  fallbackWorkingBytes: 512 * MiB,
  heapFraction: 1 / 4,
  textFraction: 1 / 8,
  rgbaBytesPerPixel: 8,
  agentRequests: 100,
  agentToolCalls: 500,
  agentDurationMs: 30 * 60 * 1000,
  mediaDownloadConcurrency: 2,
  // Native SHA-256 reads the whole file into one buffer (measured about 7x faster than streaming on M4).
  // Up to this share of the working budget, two concurrent downloads plus their buffers still fit.
  nativeDigestFraction: 1 / 8,
  temporaryIdleMs: 7 * 24 * 60 * 60 * 1000
});

export function operationBudget(value = {}, environment = globalThis) {
  const heapLimit = Number(environment.performance?.memory?.jsHeapSizeLimit);
  const workingBytes = positive(value.workingBytes, Number.isFinite(heapLimit) && heapLimit > 0
    ? Math.floor(heapLimit * RESOURCE_POLICY.heapFraction) : RESOURCE_POLICY.fallbackWorkingBytes);
  return {
    workingBytes,
    maxTextBytes: positive(value.maxTextBytes, Math.floor(workingBytes * RESOURCE_POLICY.textFraction)),
    maxImagePixels: positive(value.maxImagePixels, Math.floor(workingBytes / RESOURCE_POLICY.rgbaBytesPerPixel)),
    maxAutomaticHistoryBytes: positive(value.maxAutomaticHistoryBytes, Math.floor(workingBytes / 128)),
    maxAutomaticHistoryItems: positive(value.maxAutomaticHistoryItems, Math.max(1, Math.floor(workingBytes / (8 * MiB)))),
    maxRequests: positive(value.maxRequests, RESOURCE_POLICY.agentRequests),
    maxToolCalls: positive(value.maxToolCalls, RESOURCE_POLICY.agentToolCalls),
    maxTotalTokens: positive(value.maxTotalTokens, 0),
    maxDurationMs: positive(value.maxDurationMs, RESOURCE_POLICY.agentDurationMs)
  };
}

// Originals are streamed. Their staging space is based on the current storage
// estimate, allowing a temporary and durable copy; no old per-file quota.
export async function stagingByteBudget(options = {}) {
  const estimate = await (options.estimateStorage?.() ?? globalThis.navigator?.storage?.estimate?.() ?? {});
  const available = Number(estimate.quota) - Number(estimate.usage);
  return Number.isFinite(available) && available >= 0 ? Math.floor(available / 2)
    : operationBudget(options.budget).workingBytes * 8;
}

let writeTail = Promise.resolve();
export function withMediaWriteLock(operation) {
  if (globalThis.navigator?.locks?.request) return navigator.locks.request('promptdirector-media-capacity-write', operation);
  const result = writeTail.then(operation, operation);
  writeTail = result.catch(() => {});
  return result;
}

let downloadTail = Promise.resolve();
export async function withMediaDownloadSlot(operation, signal) {
  signal?.throwIfAborted();
  if (globalThis.navigator?.locks?.request) {
    const busy = Symbol('busy');
    for (let index = 0; index < RESOURCE_POLICY.mediaDownloadConcurrency; index++) {
      const result = await navigator.locks.request(`promptdirector-media-download:${index}`, { ifAvailable: true }, lock => {
        if (!lock) return busy;
        signal?.throwIfAborted(); return operation();
      });
      if (result !== busy) return result;
    }
    return navigator.locks.request('promptdirector-media-download:0', { ...(signal ? { signal } : {}) }, operation);
  }
  const result = downloadTail.then(() => { signal?.throwIfAborted(); return operation(); });
  downloadTail = result.catch(() => {}); return result;
}

export function resourceBudgetError(message, details = {}) {
  return Object.assign(new Error(message), { code: 'RESOURCE_BUDGET_REACHED', details, retryable: false });
}

// UTF-8 input, UTF-16 text, parsed objects and subsequent copies coexist.
// Check before materializing untrusted JSON; this is a parse budget, not a
// total case-library quota. The source Blob is never modified.
export async function readJsonWithResourceBudget(blob, { budget, signal, label = 'JSON 文件' } = {}) {
  signal?.throwIfAborted();
  const maxBytes = Math.floor(operationBudget(budget).workingBytes / 6);
  if (blob.size > maxBytes) throw resourceBudgetError(`${label}超过本次解析的内存预算；原文件保留，请分批处理`, {
    requiredBytes: blob.size, availableBytes: maxBytes
  });
  const text = await blob.text();
  signal?.throwIfAborted();
  return JSON.parse(text);
}

function positive(value, fallback) {
  return Number.isSafeInteger(value) && value > 0 ? value : fallback;
}
