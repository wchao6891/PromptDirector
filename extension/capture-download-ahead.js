import { RESOURCE_POLICY } from './resource-policy.js';

// Starts the next few network downloads of a capture while the current item is verified and
// written. Items are still consumed strictly in their order, so saved media order, receipts and
// warnings are unchanged; the shared download slots still cap simultaneous transfers. At most
// `window` items ahead are fetched, which bounds how many downloaded files wait in memory.
export function createDownloadAhead({ signal, window = RESOURCE_POLICY.mediaDownloadConcurrency } = {}) {
  const controller = new AbortController();
  const abort = () => controller.abort(signal?.reason);
  if (signal?.aborted) abort();
  else signal?.addEventListener?.('abort', abort, { once: true });
  const jobs = new Map();
  let plan = [];
  let started = 0;

  function start(item) {
    if (!item || jobs.has(item.key)) return;
    const job = { forward: null };
    // Progress of a download that is not the current item yet is shown once it becomes current.
    job.promise = Promise.resolve().then(() => item.start({
      signal: controller.signal,
      onProgress: value => job.forward?.(value)
    }));
    job.promise.catch(() => undefined);
    jobs.set(item.key, job);
  }

  return {
    // One entry per item in processing order; null for items fetched another way.
    plan(items = []) {
      plan = items;
      started = 0;
    },
    // Called when item `index` becomes current: keep the following `window` items downloading.
    advance(index) {
      started = Math.max(started, index + 1);
      for (; started <= index + window && started < plan.length; started++) start(plan[started]);
    },
    // The planned download for this key, or null so the caller downloads it directly as before.
    take(key, onProgress) {
      const job = jobs.get(key);
      if (!job) return null;
      jobs.delete(key);
      job.forward = onProgress;
      return job.promise;
    },
    // Downloads that were planned but not used (skipped or already saved items) are cancelled.
    close() {
      controller.abort();
      jobs.clear();
      signal?.removeEventListener?.('abort', abort);
    }
  };
}
