import { AGENT_CHUNK_BYTES, AGENT_UPLOAD_PREFIX, base64ToBytes, agentError, requireAgentId, requireInteger } from "./agent-protocol.js";
import { sha256Blob } from "./blob-digest.js";
import { RESOURCE_POLICY } from './resource-policy.js';
import { assertStorageCapacity } from './media-store.js';

export function createAgentTransfers({ storage, readBlob, writeBlob, deleteBlob, prepare,
  cleanup, reuse, protectedIds = async () => [], estimateStorage = () => globalThis.navigator?.storage?.estimate?.() ?? {}, now = () => Date.now(), idleMs = RESOURCE_POLICY.temporaryIdleMs }) {
  let queue = Promise.resolve();
  const lock = fn => {
    const op = queue.then(fn, fn); queue = op.catch(() => {}); return op;
  };
  const key = id => AGENT_UPLOAD_PREFIX + requireAgentId(id);
  const chunkKey = (id, index) => `${key(id)}:${index}`;
  const get = async id => {
    const value = (await storage.get(key(id)))[key(id)];
    if (!value) throw agentError("transfer_not_found", "文件传输不存在，请重新传入文件。");
    return value;
  };
  const records = async () => {
    const keys = typeof storage.getKeys === 'function' ? (await storage.getKeys()).filter(name => name.startsWith(AGENT_UPLOAD_PREFIX)) : null;
    return Object.entries(await storage.get(keys)).filter(([name]) => name.startsWith(AGENT_UPLOAD_PREFIX));
  };
  const dispose = async ids => {
    if (cleanup) return cleanup(ids);
    const protectedSet = new Set(await protectedIds());
    for (const id of ids) if (!protectedSet.has(id)) await deleteBlob(id);
  };
  const assetIds = record => [...(record.reused ? [] : [record.assetId, record.prepared?.poster?.id]),
    ...Array.from({ length: record.chunks || 0 }, (_, i) => chunkKey(record.id, i))].filter(Boolean);
  async function prune() {
    const stale = (await records()).filter(([, record]) => record.state !== 'committed'
      && Number.isFinite(Date.parse(record.updatedAt || record.createdAt)) && now() - Date.parse(record.updatedAt || record.createdAt) > idleMs);
    if (!stale.length) return { discarded: 0 };
    const protectedSet = new Set(await protectedIds());
    let discarded = 0;
    for (const [name, record] of stale) {
      if (assetIds(record).some(id => protectedSet.has(id))) continue;
      await dispose(assetIds(record));
      await storage.remove(name); discarded++;
    }
    return { discarded };
  }
  async function clearChunks(record) {
    for (let i = 0; i < record.chunks; i++) await deleteBlob(chunkKey(record.id, i));
  }
  return {
    key,
    get: async id => {
      const record = await get(id);
      if (record.state !== 'committed') {
        record.updatedAt = new Date(now()).toISOString();
        await storage.set({ [key(id)]: record });
      }
      return record;
    },
    lock,
    prune: () => lock(prune),
    async retainedIds() {
      return (await records()).filter(([, record]) => record.state !== 'committed').flatMap(([, record]) => assetIds(record));
    },
    begin(input) {
      return lock(async () => {
        await prune();
        const id = requireAgentId(input.id);
        if (input.purpose !== undefined && input.purpose !== 'skill-file') throw agentError('invalid_input', '未知文件用途。');
        requireInteger(input.byteSize, { min: input.purpose === 'skill-file' ? 0 : 1 });
        if (!/^[a-f0-9]{64}$/u.test(input.sha256 || "") || !input.name || /[/\\\u0000]/u.test(input.name)) {
          throw agentError("invalid_input", "文件名称或 SHA-256 无效。");
        }
        const prior = (await storage.get(key(id)))[key(id)];
        if (prior) {
          if (prior.sha256 !== input.sha256 || prior.byteSize !== input.byteSize || prior.name !== input.name || prior.mimeType !== (input.mimeType || "") || prior.forceImport !== (input.forceImport === true) || prior.purpose !== input.purpose) {
            throw agentError("transfer_conflict", "传输编号已对应另一文件。");
          }
          prior.updatedAt = new Date(now()).toISOString();
          await storage.set({ [key(id)]: prior });
          return { id, offset: prior.offset, state: prior.state, chunkBytes: AGENT_CHUNK_BYTES };
        }
        const record = { id, name: input.name, mimeType: input.mimeType || "", byteSize: input.byteSize, sha256: input.sha256, forceImport: input.forceImport === true,
          ...(input.purpose ? { purpose: input.purpose } : {}),
          offset: 0, chunks: 0, state: "uploading", createdAt: new Date(now()).toISOString(), updatedAt: new Date(now()).toISOString(),
          assetId: input.purpose === 'skill-file' ? `skill-file:agent-${id}` : `agent-file:${id}` };
        let existing = await reuse?.(record);
        // Two pending files may have distinct per-file prompts despite matching
        // bytes. Keep separate asset identities instead of merging those inputs.
        if (existing && (await records()).some(([, other]) => other.state !== 'committed' && other.assetId === existing.asset.id)) existing = null;
        if (existing) {
          record.assetId = existing.asset.id; record.prepared = existing; record.reused = true;
          record.offset = input.byteSize; record.state = 'ready';
        } else assertStorageCapacity(await estimateStorage(), input.byteSize * 2);
        await storage.set({ [key(id)]: record });
        return { id, offset: record.offset, state: record.state, chunkBytes: AGENT_CHUNK_BYTES };
      });
    },
    append({ id, offset, data }) {
      return lock(async () => {
        const record = await get(id); requireInteger(offset);
        const bytes = base64ToBytes(data);
        if (record.state !== "uploading" || offset !== record.offset || !bytes.length || offset + bytes.length > record.byteSize) {
          throw agentError("transfer_position", "文件传输位置不一致，请重新查询传输状态后续传。");
        }
        await writeBlob(chunkKey(id, record.chunks), new Blob([bytes]));
        record.chunks++; record.offset += bytes.length;
        record.updatedAt = new Date(now()).toISOString();
        await storage.set({ [key(id)]: record });
        return { id, offset: record.offset };
      });
    },
    finish({ id }) {
      return lock(async () => {
        const record = await get(id);
        if (["ready", "committed"].includes(record.state)) {
          if (record.reused && record.state === 'ready') {
            const blob = await readBlob(record.assetId);
            if (!blob || blob.size !== record.byteSize || await sha256Blob(blob) !== record.sha256) {
              throw agentError('integrity_failed', '库内原件已改变或不可用，未完成入库；请重新传入本机文件。');
            }
          }
          if (record.chunks) { await clearChunks(record); record.chunks = 0; await storage.set({ [key(id)]: record }); }
          return { id, state: record.state, assetId: record.assetId };
        }
        if (record.offset !== record.byteSize) throw agentError("transfer_incomplete", "文件尚未传完。");
        const chunks = [];
        for (let i = 0; i < record.chunks; i++) {
          const blob = await readBlob(chunkKey(id, i));
          if (!blob) throw agentError("transfer_incomplete", "文件分块丢失，请重新传输。");
          chunks.push(blob);
        }
        const blob = new Blob(chunks, { type: record.mimeType });
        if (blob.size !== record.byteSize || await sha256Blob(blob) !== record.sha256) throw agentError("integrity_failed", "文件摘要不一致，未完成入库。");
        await writeBlob(record.assetId, blob);
        const prepared = record.purpose === 'skill-file' ? { kind: 'skill-file' } : await prepare(record);
        record.state = "ready"; record.prepared = prepared; record.updatedAt = new Date(now()).toISOString();
        await storage.set({ [key(id)]: record });
        await clearChunks(record);
        record.chunks = 0;
        await storage.set({ [key(id)]: record });
        return { id, state: record.state, assetId: record.assetId };
      });
    },
    abort({ id }) {
      return lock(async () => {
        const record = await get(id);
        if (record.state === "committed") throw agentError("already_committed", "这个文件已入库，不能作为临时传输删除。");
        await dispose(assetIds(record));
        await storage.remove(key(id));
        return { discarded: true };
      });
    }
  };
}
