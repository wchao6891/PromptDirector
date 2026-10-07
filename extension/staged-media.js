// Pages register before writing bytes. Closing a page cannot lose the cleanup list.
export function createMediaStage(chromeApi = chrome) {
  const operationId = crypto.randomUUID();
  let registered = false;
  let writing = 0;
  let released = false;
  const flush = () => {
    if (!registered || writing) return;
    try { void chromeApi.runtime.sendMessage({ type: 'RELEASE_STAGED_MEDIA', operationId }).catch(() => {}); }
    catch { /* Worker recovery retries after this document closes. */ }
  };
  const stage = {
    async register(assetIds, localReferenceIds = []) {
      if (released) throw new Error('文件准备已取消');
      const response = await chromeApi.runtime.sendMessage({ type: 'REGISTER_STAGED_MEDIA', operationId, assetIds, localReferenceIds });
      if (!response?.ok) throw new Error(response?.message || '无法准备本机文件，请重试');
      registered = true;
    },
    async write(assetIds, write, localReferenceIds = []) {
      writing++;
      try {
        await stage.register(assetIds, localReferenceIds);
        return await write();
      } finally {
        writing--;
        if (released) flush();
      }
    },
    release() {
      // The durable record survives a lost reply; cleanup must not block the UI.
      released = true;
      flush();
    }
  };
  return stage;
}

export const STAGED_MEDIA_KEY = 'stagedMediaWrites';

export function createStagedMediaRegistry({ storage, activeDocuments, cleanup }) {
  const read = async () => (await storage.get(STAGED_MEDIA_KEY))[STAGED_MEDIA_KEY] ?? {};
  async function sweep(onlyId) {
    const records = await read();
    if (!Object.keys(records).length) return;
    const documents = new Set(await activeDocuments());
    for (const [id, record] of Object.entries(records)) {
      if (onlyId && id !== onlyId) continue;
      if (!record.released && documents.has(record.documentId)) continue;
      // Other live writers may be saving the same planned asset identity.
      const protectedIds = Object.entries(records).filter(([otherId, other]) => otherId !== id && !other.released && documents.has(other.documentId))
        .flatMap(([, other]) => other.assetIds);
      try {
        await cleanup(record.assetIds, protectedIds, record.localReferenceIds ?? []);
        delete records[id];
        await storage.set({ [STAGED_MEDIA_KEY]: records });
      } catch { /* Keep IDs for the next worker start/maintenance pass. */ }
    }
  }
  return {
    async register(operationId, documentId, values, localReferenceIds = []) {
      if (!operationId || !documentId || !Array.isArray(values) || !Array.isArray(localReferenceIds)
        || [...values, ...localReferenceIds].some(id => typeof id !== 'string' || !id.trim())
        || localReferenceIds.some(id => !values.includes(id))) throw new Error('文件准备信息无效');
      const records = await read();
      const prior = records[operationId];
      if (prior && prior.documentId !== documentId) throw new Error('文件准备任务不属于当前页面');
      records[operationId] = { documentId, assetIds: [...new Set([...(prior?.assetIds ?? []), ...values])],
        localReferenceIds: [...new Set([...(prior?.localReferenceIds ?? []), ...localReferenceIds])], released: false };
      await storage.set({ [STAGED_MEDIA_KEY]: records });
    },
    async release(operationId, documentId) {
      const records = await read();
      if (!records[operationId]) return;
      if (records[operationId].documentId !== documentId) throw new Error('文件准备任务不属于当前页面');
      records[operationId].released = true;
      await storage.set({ [STAGED_MEDIA_KEY]: records });
      await sweep(operationId);
    },
    sweep,
    async retainedIds() {
      return Object.values(await read()).filter(record => !record.released).flatMap(record => record.assetIds);
    }
  };
}
