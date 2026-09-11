import { AGENT_CHUNK_BYTES, AGENT_UPLOAD_PREFIX, base64ToBytes, agentError, requireAgentId, requireInteger } from "./agent-protocol.js";
import { sha256Blob } from "./blob-digest.js";

export function createAgentTransfers({ storage, readBlob, writeBlob, deleteBlob, prepare }) {
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
  async function clearChunks(record) {
    for (let i = 0; i < record.chunks; i++) await deleteBlob(chunkKey(record.id, i));
  }
  return {
    key,
    get,
    lock,
    async retainedIds() {
      const all = await storage.get(null);
      return Object.entries(all).filter(([name, record]) => name.startsWith(AGENT_UPLOAD_PREFIX) && record.state !== "committed")
        .flatMap(([, record]) => [record.assetId, record.prepared?.poster?.id, ...Array.from({ length: record.chunks }, (_, i) => chunkKey(record.id, i))]).filter(Boolean);
    },
    begin(input) {
      return lock(async () => {
        const id = requireAgentId(input.id);
        requireInteger(input.byteSize, { min: 1 });
        if (!/^[a-f0-9]{64}$/u.test(input.sha256 || "") || !input.name || /[/\\\u0000]/u.test(input.name)) {
          throw agentError("invalid_input", "文件名称或 SHA-256 无效。");
        }
        const prior = (await storage.get(key(id)))[key(id)];
        if (prior) {
          if (prior.sha256 !== input.sha256 || prior.byteSize !== input.byteSize || prior.name !== input.name || prior.mimeType !== (input.mimeType || "") || prior.forceImport !== (input.forceImport === true)) {
            throw agentError("transfer_conflict", "传输编号已对应另一文件。");
          }
          return { id, offset: prior.offset, state: prior.state, chunkBytes: AGENT_CHUNK_BYTES };
        }
        const record = { id, name: input.name, mimeType: input.mimeType || "", byteSize: input.byteSize, sha256: input.sha256, forceImport: input.forceImport === true,
          offset: 0, chunks: 0, state: "uploading", createdAt: new Date().toISOString(), assetId: `agent-file:${id}` };
        await storage.set({ [key(id)]: record });
        return { id, offset: 0, state: "uploading", chunkBytes: AGENT_CHUNK_BYTES };
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
        await storage.set({ [key(id)]: record });
        return { id, offset: record.offset };
      });
    },
    finish({ id }) {
      return lock(async () => {
        const record = await get(id);
        if (["ready", "committed"].includes(record.state)) return { id, state: record.state, assetId: record.assetId };
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
        const prepared = await prepare(record);
        record.state = "ready"; record.prepared = prepared;
        await storage.set({ [key(id)]: record });
        await clearChunks(record);
        return { id, state: record.state, assetId: record.assetId };
      });
    },
    abort({ id }) {
      return lock(async () => {
        const record = await get(id);
        if (record.state === "committed") throw agentError("already_committed", "这个文件已属于案例，不能作为临时传输删除。");
        await clearChunks(record);
        await deleteBlob(record.assetId);
        if (record.prepared?.poster) await deleteBlob(record.prepared.poster.id);
        await storage.remove(key(id));
        return { discarded: true };
      });
    }
  };
}
