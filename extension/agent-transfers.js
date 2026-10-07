import { AGENT_CHUNK_BYTES, AGENT_UPLOAD_PREFIX, agentPosterAssetId, base64ToBytes, agentError, requireAgentId, requireInteger } from "./agent-protocol.js";
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
  const assetIds = record => [...(record.reused ? [] : [record.assetId, record.prepared?.poster?.id,
    ...(record.state === 'uploading' ? [agentPosterAssetId(record.assetId)] : [])]),
    ...Array.from({ length: record.chunks || 0 }, (_, i) => chunkKey(record.id, i)),
    // The next chunk may exist even when its offset receipt failed. Its key is
    // deterministic, so recovery needs no additional metadata write per chunk.
    ...(record.state === 'uploading' && record.offset < record.byteSize ? [chunkKey(record.id, record.chunks || 0)] : [])].filter(Boolean);
  async function prune() {
    const all = await records();
    const reviewed = new Set(all.filter(([, record]) => record.reviewFeedback?.notes?.length || record.reviewFeedback?.frames?.length)
      .flatMap(([, record]) => [record.assetId, ...(record.reviewFeedback.frames || []).map(frame => frame.assetId)]));
    const stale = all.filter(([, record]) => record.state !== 'committed' && !reviewed.has(record.assetId)
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
    // Save/Skill writers already hold this lock. Their pure reads must not
    // nest it; a public read that renews idle time is itself a coordinated write.
    get: (id, { touch = true } = {}) => touch ? lock(async () => {
      const record = await get(id);
      if (record.state !== 'committed') {
        record.updatedAt = new Date(now()).toISOString();
        await storage.set({ [key(id)]: record });
      }
      return record;
    }) : get(id),
    lock,
    stageLocal({ id: value, name }) {
      return lock(async () => {
        const id = requireAgentId(value), assetId = `agent-file:${id}`;
        if (!name || /[/\\\u0000]/u.test(name)) throw agentError('invalid_input', '文件名称无效');
        const blob = await readBlob(assetId);
        if (!blob?.size) throw agentError('file_missing', '没有读取到本机样片');
        const sha256 = await sha256Blob(blob);
        const prior = (await storage.get(key(id)))[key(id)];
        if (prior && (prior.sha256 !== sha256 || prior.name !== name)) throw agentError('transfer_conflict', '样片身份已对应另一文件');
        if (prior?.state === 'ready') return prior;
        if (prior?.state === 'committed') throw agentError('already_committed', '这个样片已入库');
        await prune();
        const record = prior || { id, assetId, name, mimeType: blob.type, byteSize: blob.size, sha256,
          offset: blob.size, chunks: 0, state: 'uploading', forceImport: false, createdAt: new Date(now()).toISOString() };
        record.updatedAt = new Date(now()).toISOString();
        await storage.set({ [key(id)]: record });
        record.prepared = await prepare(record); record.state = 'ready';
        await storage.set({ [key(id)]: record }); return record;
      });
    },
    updateReview({ id, expectedRevision = 0, note, removeId, frameTransferId, positionMs, removeFrameId }) {
      return lock(async () => {
        const record = await get(id);
        const current = record.reviewFeedback || { revision: 0, notes: [], frames: [] };
        if (record.state !== 'ready') throw agentError('review_saved', '样片已入库，请在已保存案例中记录反馈');
        if (current.revision !== expectedRevision) throw agentError('review_conflict', '备注已变化，请重读后保存');
        let frames = [...current.frames], notes = [...current.notes];
        if (note) {
          if (!note.id || !note.text?.trim() || !Number.isFinite(note.startMs) || note.startMs < 0
            || note.endMs !== undefined && (!Number.isFinite(note.endMs) || note.endMs <= note.startMs)) throw agentError('invalid_note', '备注内容或时间无效');
          let frameAssetId;
          if (frameTransferId) {
            const frame = await get(frameTransferId);
            if (frame.state !== 'ready' || frame.prepared?.asset?.kind !== 'image') throw agentError('invalid_frame', '画面尚未准备好');
            frameAssetId = frame.assetId; frames.push({ transferId: frame.id, assetId: frame.assetId });
          }
          const value = { id: note.id, assetId: record.assetId, startMs: Math.round(note.startMs), text: note.text,
            ...(note.endMs !== undefined ? { endMs: Math.round(note.endMs) } : {}), ...(frameAssetId ? { frameAssetId } : {}), createdAt: new Date(now()).toISOString() };
          notes = [...notes.filter(item => item.id !== note.id), value].toSorted((a, b) => a.startMs - b.startMs);
        } else if (removeId) notes = notes.filter(item => item.id !== removeId);
        else if (frameTransferId) {
          const frame = await get(frameTransferId);
          if (frame.state !== 'ready' || frame.prepared?.asset?.kind !== 'image' || !Number.isFinite(positionMs) || positionMs < 0) throw agentError('invalid_frame', '截图或播放时间无效');
          frame.prepared.asset = { ...frame.prepared.asset, derivedFromAssetId: record.assetId, frameTimeMs: Math.round(positionMs) };
          await storage.set({ [key(frame.id)]: frame });
          if (!frames.some(item => item.assetId === frame.assetId)) frames.push({ transferId: frame.id, assetId: frame.assetId, positionMs: Math.round(positionMs), standalone: true });
        } else if (removeFrameId) {
          frames = frames.filter(frame => frame.assetId !== removeFrameId);
          notes = notes.map(item => { if (item.frameAssetId !== removeFrameId) return item; const { frameAssetId, ...value } = item; return value; });
        }
        else throw agentError('invalid_note', '没有备注操作');
        frames = frames.filter(frame => frame.standalone || notes.some(item => item.frameAssetId === frame.assetId));
        record.reviewFeedback = { revision: current.revision + 1, notes, frames };
        record.updatedAt = new Date(now()).toISOString(); await storage.set({ [key(id)]: record });
        return record.reviewFeedback;
      });
    },
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
            // Reuse already matched the bytes; saveAgentMaterial verifies them
            // again at commit. Finishing a ready transfer only checks availability.
            if (!blob || blob.size !== record.byteSize) {
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
        if (record.reviewFeedback?.notes?.length || record.reviewFeedback?.frames?.length || (await records()).some(([, owner]) => owner.reviewFeedback?.frames?.some(frame => frame.assetId === record.assetId))) throw agentError('review_has_feedback', '文件有已保存的审片反馈，不能作为临时传输丢弃');
        await dispose(assetIds(record));
        await storage.remove(key(id));
        return { discarded: true };
      });
    }
  };
}
