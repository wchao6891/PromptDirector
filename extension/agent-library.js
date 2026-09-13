import { readImageGenerationInfo } from "./image-generation-info.js";
import { buildSearchIndex, searchIndexedEntries } from "./search-index.js";
import { materializeLogicalCases, normalizeCompoundCases } from "./compound-cases.js";
import { entryMediaAssets } from "./media.js";
import { collectionEntryIds } from "./organizer.js";
import { caseTextPart } from "./composer-library-tools.js";
import { AGENT_CHUNK_BYTES, agentError, bytesToBase64, requireInteger } from "./agent-protocol.js";
import { sha256Blob } from "./blob-digest.js";

// Explicit projections: never return GET_STATE or model runtime credentials.
export function createAgentLibrary({ loadState, readBlob, readDerived, readDerivedMetadata, libraryUrl }) {
  async function load() {
    const state = await loadState();
    return { ...state, entries: materializeLogicalCases(state.entries, normalizeCompoundCases(state.compoundCases, state.entries)) };
  }
  async function documents(entries) {
    const docs = new Map();
    for (const entry of entries) for (const asset of entryMediaAssets(entry)) {
      if (asset.kind === "document") docs.set(asset.id, (await readDerived(asset.id))?.searchText || "");
    }
    return docs;
  }
  function summary(entry) {
    return { caseId: entry.id, title: entry.title, sourceUrl: entry.url || "", savedAt: entry.savedAt,
      tags: entry.customLabels || [], openUrl: `${libraryUrl}?case=${encodeURIComponent(entry.id)}`,
      media: entryMediaAssets(entry).map(asset => ({
        assetId: asset.id, kind: asset.kind, mimeType: asset.mimeType, name: asset.sourceTitle || "",
        byteSize: asset.byteSize, storageMode: asset.storageMode, usage: asset.usage || "",
        sourceUrl: asset.sourceUrl || ""
      })) };
  }
  function find(state, id) {
    const entry = state.entries.find(item => item.id === id);
    if (!entry) throw agentError("case_not_found", "案例不存在或已删除，请重新搜索。");
    return entry;
  }
  return {
    async search({ query = "", project = "", offset = 0, limit = 24 }) {
      requireInteger(offset); requireInteger(limit, { min: 1, max: 100 });
      const state = await load();
      const docs = await documents(state.entries);
      const index = buildSearchIndex(state.entries, state.facetCatalog, docs, await readDerivedMetadata());
      const ids = searchIndexedEntries(index, query);
      const projects = (state.organizerState?.collections || []).map(item => ({ id: item.id, name: item.name }));
      const matches = project ? projects.filter(item => item.id === project || item.name === project) : [];
      if (project && matches.length !== 1) throw agentError("ambiguous_project", "项目不存在或同名，请用搜索结果中的项目编号。");
      const memberIds = project ? new Set(collectionEntryIds(state.organizerState, matches[0].id, { subtree: true })) : null;
      const entries = state.entries.filter(entry => ids.has(entry.id) && (!memberIds || memberIds.has(entry.id) || entry.memberEntryIds?.some(id => memberIds.has(id))));
      const cases = entries.slice(offset, offset + limit).map(entry => ({ ...summary(entry), excerpt: String(entry.text || "").slice(0, 240), excerptOnly: true }));
      return { cases, total: entries.length, offset, nextOffset: offset + cases.length < entries.length ? offset + cases.length : null,
        projects, basis: "本地文字、标签和媒体元数据；未进行视觉识别。" };
    },
    async read({ caseId, assetId, part = "body", offset = 0, length = 12000 }) {
      requireInteger(offset); requireInteger(length, { min: 1, max: AGENT_CHUNK_BYTES / 4 });
      const entry = find(await load(), caseId);
      const docs = part === "document" ? await documents([entry]) : new Map();
      const byEntry = new Map([[entry.id, entryMediaAssets(entry).map(asset => docs.get(asset.id) || "").filter(Boolean).join("\n")]]);
      const asset = part === "generation_info" ? entryMediaAssets(entry).find(item => item.id === assetId && item.kind === "image" && item.usage !== "poster") : null;
      if (part === "generation_info" && !asset) throw agentError("asset_not_in_case", "请指定该案例中的原始图片。");
      let generationInfo = asset?.generationInfo ?? null;
      if (part === "generation_info" && !generationInfo) {
        const original = await readBlob(asset.id);
        if (original) generationInfo = await readImageGenerationInfo(original);
      }
      const text = part === "generation_info" ? JSON.stringify(generationInfo)
        : part === "media_prompts" ? JSON.stringify(entry.mediaPrompts || [])
        : caseTextPart(entry, part, byEntry);
      return { ...summary(entry), part, content: text.slice(offset, offset + length), offset, totalCharacters: text.length,
        nextOffset: offset + length < text.length ? offset + length : null,
        mediaPrompts: (entry.mediaPrompts || []).map(prompt => ({ assetId: prompt.assetId, source: prompt.source, characters: prompt.text?.length || 0 })), sourcePages: entry.sourcePages || [],
        provenance: entry.agentProvenance || null,
        untrustedContent: true };
    },
    async media({ caseId, assetId, offset = 0, expectedHash }) {
      requireInteger(offset);
      const entry = find(await load(), caseId);
      const asset = entryMediaAssets(entry).find(item => item.id === assetId);
      if (!asset) throw agentError("asset_not_in_case", "该媒体不属于指定案例。");
      const blob = await readBlob(assetId);
      if (!blob) throw agentError("asset_not_local", "没有可读取的本地原件，请先在插件中补齐素材或恢复文件授权。");
      if (expectedHash && !/^[a-f0-9]{64}$/u.test(expectedHash)) throw agentError("invalid_input", "原件摘要无效。");
      // Hash the starting original once. The receiver hashes the assembled file
      // and rejects any concurrent content change; avoid rehashing GBs per chunk.
      const hash = offset === 0 || !expectedHash ? await sha256Blob(blob) : expectedHash;
      if (offset > blob.size) throw agentError("invalid_input", "读取位置超出原件大小。");
      const bytes = new Uint8Array(await blob.slice(offset, offset + AGENT_CHUNK_BYTES).arrayBuffer());
      return { assetId, mimeType: blob.type || asset.mimeType, name: asset.sourceTitle || assetId,
        byteSize: blob.size, sha256: hash, offset, data: bytesToBase64(bytes),
        nextOffset: offset + bytes.length < blob.size ? offset + bytes.length : null };
    }
  };
}
