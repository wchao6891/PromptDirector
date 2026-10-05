import { createCaptureSaveProgress } from './capture-save-progress.js';

export const CAPTURE_SAVE_TASK_KEY = 'captureSaveTask';
const INPUT_KEY = 'captureSaveInput';
const CACHE_NAME = 'promptdirector-capture-save';
const activeStates = new Set(['queued', 'running', 'cancelling', 'committing']);

// One capture workspace owns one durable, unfinished save. Pixels stay in the
// browser's Blob cache; progress never rewrites the request or the case library.
export function createCaptureSaveTasks({ storage, execute, notify, cleanup = async () => {}, openCache = () => caches.open(CACHE_NAME) }) {
  let live = null, writes = Promise.resolve(), starts = Promise.resolve();
  const persist = record => {
    writes = writes.catch(() => undefined).then(() => storage.set({ [CAPTURE_SAVE_TASK_KEY]: record }));
    return writes;
  };
  const announce = task => { try { Promise.resolve(notify({ type: 'CAPTURE_SAVE_TASK_CHANGED', id: task.id, status: task.status })).catch(() => undefined); } catch {} };
  async function get() {
    const stored = await storage.get([CAPTURE_SAVE_TASK_KEY, INPUT_KEY]);
    let record = stored[CAPTURE_SAVE_TASK_KEY];
    if (!record) return null;
    if (live?.record.id === record.id) record = { ...live.record, progress: live.progress, sequence: live.sequence };
    else if (activeStates.has(record.status)) {
      record = { ...record, status: 'interrupted', canCancel: false, message: '下载中断，待保存内容已保留' };
      await persist(record);
    }
    return { ...record, input: stored[INPUT_KEY] };
  }
  async function clearCache(record) {
    const cache = await openCache();
    for (const item of record.checkpoints || []) await cache.delete(item.cacheUrl);
  }
  async function begin(input) {
    const prior = await get();
    if (live) {
      if (prior?.id === input.saveRequestId) return live;
      throw new Error('已有保存任务，请先取消或完成');
    }
    const id = input.saveRequestId || crypto.randomUUID();
    if (prior?.id === id && (prior.input?.type !== input.type ||
      input.type === 'COMMIT_PAGE_CAPTURE' && prior.input.batch?.id !== input.batch?.id)) {
      throw new Error('还有待保存内容，请先继续或清空');
    }
    if (prior && prior.id !== id) {
      if (prior.status !== 'completed') throw new Error('还有待保存内容，请先继续或清空');
      await clearCache(prior);
    }
    if (prior?.assetIds?.length) await cleanup(prior.assetIds);
    const record = { id, status: 'queued', canCancel: true, progress: { phase: 'queued' }, sequence: 0,
      checkpoints: prior?.id === id ? prior.checkpoints || [] : [], assetIds: [] };
    await storage.set({ [INPUT_KEY]: { ...input, saveRequestId: id }, [CAPTURE_SAVE_TASK_KEY]: record });
    const controller = new AbortController();
    const job = { record, controller, progress: record.progress, sequence: 0 };
    live = job;
    const progress = createCaptureSaveProgress({ requestId: id, send: event => {
      job.progress = event.progress; job.sequence = event.sequence;
      if (job.record.progress.phase !== event.progress.phase) {
        job.record = { ...job.record, progress: event.progress, sequence: event.sequence };
        void persist(job.record);
      }
      return notify(event);
    } });
    progress.signal = controller.signal;
    const stage = progress.stage;
    progress.stage = (...args) => { controller.signal.throwIfAborted(); stage(...args); };
    progress.commit = async () => {
      controller.signal.throwIfAborted();
      job.record = { ...job.record, status: 'committing', canCancel: false };
      await persist(job.record); announce(job.record);
    };
    progress.retain = async ids => {
      job.record = { ...job.record, assetIds: [...new Set([...job.record.assetIds, ...ids])] }; await persist(job.record);
    };
    progress.release = async ids => {
      job.record = { ...job.record, assetIds: job.record.assetIds.filter(id => !ids.includes(id)) }; await persist(job.record);
    };
    progress.media = async (key, load) => {
      controller.signal.throwIfAborted();
      const cache = await openCache();
      const item = job.record.checkpoints.find(item => item.key === key);
      const cached = item && await cache.match(item.cacheUrl);
      if (cached) {
        const blob = await cached.blob();
        return item.object ? { ...item.metadata, blob } : blob;
      }
      const value = await load();
      controller.signal.throwIfAborted();
      const blob = value instanceof Blob ? value : value?.blob;
      if (!blob) return value;
      const cacheUrl = `https://promptdirector.invalid/capture-save/${id}/${encodeURIComponent(key)}`;
      await cache.put(cacheUrl, new Response(blob, { headers: { 'content-type': blob.type } }));
      const { blob: ignored, ...metadata } = value instanceof Blob ? {} : value;
      job.record = { ...job.record, checkpoints: [...job.record.checkpoints.filter(item => item.key !== key),
        { key, cacheUrl, object: !(value instanceof Blob), metadata }] };
      await persist(job.record);
      return value;
    };
    job.done = (async () => {
      try {
        job.record = { ...job.record, status: 'running' }; await persist(job.record); announce(job.record);
        const result = await execute({ ...input, saveRequestId: id }, progress);
        await writes;
        job.record = { ...job.record, status: result.promptConflicts?.length ? 'confirmation' : result.ok ? 'completed' : 'failed',
          canCancel: false, result, message: result.message };
      } catch (error) {
        job.record = { ...job.record, status: controller.signal.aborted ? 'cancelled' : 'failed', canCancel: false,
          result: { ok: false, message: error.message }, message: error.message };
      } finally {
        progress.close();
        try { await persist(job.record); } finally { live = null; announce(job.record); }
      }
      return job.record.result;
    })();
    // START returns immediately; closure or restart is not a lost response channel.
    void job.done.catch(() => undefined);
    return job;
  }
  const start = input => {
    const next = starts.then(() => begin(input)); starts = next.catch(() => undefined); return next;
  };
  return {
    get,
    async start(input) { const job = await start(input); return { ok: true, id: job.record.id }; },
    async run(input) { const job = await start(input); return job.done; },
    async cancel(id) {
      if (!live || live.record.id !== id) return { ok: false, message: '保存任务已结束，请重新读取' };
      if (!live.record.canCancel) return { ok: false, message: '正在完成入库，请稍候' };
      live.controller.abort(new DOMException('保存已取消，待保存内容已保留', 'AbortError'));
      live.record = { ...live.record, status: 'cancelling', canCancel: false };
      await persist(live.record); announce(live.record);
      return { ok: true };
    },
    async acknowledge(id, remainingBatch) {
      const record = await get();
      if (record?.id !== id || record.status !== 'completed') return;
      await clearCache(record);
      if (remainingBatch?.candidates?.length) {
        await storage.set({ [INPUT_KEY]: { ...record.input, batch: remainingBatch },
          [CAPTURE_SAVE_TASK_KEY]: { ...record, input: undefined, status: 'pending', message: '部分内容未保存，已保留供重试', result: null, checkpoints: [], assetIds: [] } });
      } else await storage.remove([CAPTURE_SAVE_TASK_KEY, INPUT_KEY]);
    },
    discard(id) {
      // Order abandonment with starts so a queued save cannot lose its input.
      const next = starts.then(async () => {
        const record = await get();
        if (id && record?.id !== id) throw new Error('保存任务已变化，请重新读取');
        if (live) throw new Error('请先取消保存');
        if (record) { await cleanup(record.assetIds || []); await clearCache(record); }
        await storage.remove([CAPTURE_SAVE_TASK_KEY, INPUT_KEY]);
      });
      starts = next.catch(() => undefined);
      return next;
    }
  };
}

// Re-read under the commit lock. Preserve unrelated concurrent edits; if an
// affected case changed/deleted, keep the draft rather than silently restore it.
export function rebaseCaptureEntries(before, prepared, latest, affectedIds, sameSource) {
  const affected = new Set(affectedIds), replacements = new Map();
  for (const entry of prepared.filter(entry => affected.has(entry.id))) {
    const original = before.find(item => item.id === entry.id);
    const current = latest.find(item => item.id === entry.id);
    if (original ? JSON.stringify(original) !== JSON.stringify(current) : current || latest.some(item => sameSource(item, entry))) {
      throw new Error('案例在下载期间已变化，待保存内容已保留，请重试');
    }
    replacements.set(entry.id, entry);
  }
  return [...latest.map(entry => replacements.get(entry.id) || entry), ...[...replacements.values()].filter(entry => !latest.some(item => item.id === entry.id))];
}
