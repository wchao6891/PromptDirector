// A decoded preview stays in the existing byte-budgeted cache. Recycling a
// card releases its request, never its already prepared preview.
export function createGalleryPreviewQueue({ concurrency, load, cached, priority }) {
  const requests = new Map();
  let active = 0, scheduled = false;

  function rank(request) {
    let score = Infinity;
    for (const consumer of request.consumers) {
      const value = priority(consumer);
      if (!Number.isFinite(value)) request.consumers.delete(consumer);
      else score = Math.min(score, value);
    }
    request.score = score;
  }
  function finish(request, value, error) {
    if (requests.get(request.key) === request) requests.delete(request.key);
    if (error) request.reject(error);
    else request.resolve(value);
  }
  function drain() {
    scheduled = false;
    while (active < concurrency) {
      let next = null;
      for (const request of requests.values()) {
        if (request.running) continue;
        for (const consumer of request.consumers) if (!consumer.isConnected) request.consumers.delete(consumer);
        if (!request.consumers.size) { finish(request); continue; }
        if (!next || request.score < next.score) next = request;
      }
      if (!next) break;
      next.running = true;
      active += 1;
      Promise.resolve().then(() => load(next.key)).then(
        value => finish(next, value), error => finish(next, undefined, error)
      ).finally(() => { active -= 1; schedule(); });
    }
  }
  function schedule() {
    if (scheduled) return;
    scheduled = true;
    queueMicrotask(drain);
  }
  return {
    request(key, consumer) {
      const ready = cached(key);
      if (ready) return Promise.resolve(ready);
      if (!Number.isFinite(priority(consumer))) return Promise.resolve();
      let request = requests.get(key);
      if (!request) {
        request = { key, consumers: new Set(), running: false };
        request.promise = new Promise((resolve, reject) => Object.assign(request, { resolve, reject }));
        requests.set(key, request);
      }
      request.consumers.add(consumer);
      rank(request);
      schedule();
      return request.promise;
    },
    release(consumer) {
      const request = requests.get(consumer.dataset.visualId);
      request?.consumers.delete(consumer);
      if (request && !request.running && !request.consumers.size) finish(request);
      schedule();
    },
    refresh() {
      for (const request of requests.values()) if (!request.running) {
        rank(request);
        if (!request.consumers.size) finish(request);
      }
      schedule();
    },
    updateConsumers(key, update) {
      for (const consumer of requests.get(key)?.consumers ?? []) if (consumer.isConnected) update(consumer);
    }
  };
}

// Foreground images precede the existing preload runway. The viewport and
// runway come from the caller's gallery policy, not a case-count limit.
export function cardPreviewPriority(image, viewportHeight, runway) {
  if (!image.isConnected) return Infinity;
  const bounds = image.getBoundingClientRect();
  if (bounds.bottom < -runway || bounds.top > viewportHeight + runway) return Infinity;
  if (bounds.bottom >= 0 && bounds.top <= viewportHeight) return 0;
  return bounds.top > viewportHeight ? bounds.top - viewportHeight : -bounds.bottom;
}

export function indexGalleryMedia(entries, mediaForEntry) {
  const result = new Map();
  for (const entry of entries) for (const asset of mediaForEntry(entry)) {
    if (!result.has(asset.id)) result.set(asset.id, { asset, entryId: entry.id });
  }
  return result;
}
