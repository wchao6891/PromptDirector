import { readImageGenerationInfo } from "./image-generation-info.js";
import { createSearchIndexCache } from "./search-index.js";
import { materializeLogicalCases, normalizeCompoundCases } from "./compound-cases.js";
import { entryMediaAssets } from "./media.js";
import { filterCaseSearchEntries, searchCaseResult, caseSearchSourceSummary, caseSearchPage } from "./case-search.js";
import { describeCaseQuery } from './case-query-fields.js';
import { caseTextPage } from './case-text-page.js';
import { caseTextPart } from "./composer-library-tools.js";
import { AGENT_CHUNK_BYTES, agentDownloadChunkBytes, agentError, bytesToBase64, requireInteger } from "./agent-protocol.js";
import { detailPromptSources } from "./prompt-sources.js";
import { sha256Blob } from "./blob-digest.js";
import { resolveCaseMediaId } from './media-identity-aliases.js';
import { assertCaseFilesReadable, caseFilesUnavailable } from './case-file-status.js';

// Explicit projections: never return GET_STATE or model runtime credentials.
export function createAgentLibrary({ loadState, readBlob, readDerived, readDerivedMetadata, libraryUrl }) {
  const searchCache = createSearchIndexCache();
  async function load() {
    const state = await loadState();
    return { ...state, entries: materializeLogicalCases(state.entries, normalizeCompoundCases(state.compoundCases, state.entries)) };
  }
  async function documents(entries) {
    const docs = new Map();
    for (const entry of entries.filter(entry => !caseFilesUnavailable(entry))) for (const asset of entryMediaAssets(entry)) {
      if (asset.kind === "document") docs.set(asset.id, (await readDerived(asset.id))?.searchText || "");
    }
    return docs;
  }
  function summary(entry) {
    return { caseId: entry.id, title: entry.title, sourceUrl: entry.url || "", savedAt: entry.savedAt,
      ...(caseFilesUnavailable(entry) ? { availability: 'recovery-only', readOnly: true } : {}),
      tags: entry.customLabels || [], openUrl: `${libraryUrl}?case=${encodeURIComponent(entry.id)}`,
      media: entryMediaAssets(entry).map(asset => ({
        assetId: asset.id, kind: asset.kind, mimeType: asset.mimeType, name: asset.sourceTitle || "",
        byteSize: asset.byteSize, ...(asset.durationMs ? { durationMs: asset.durationMs } : {}), storageMode: asset.storageMode, usage: asset.usage || "",
        sourceUrl: asset.sourceUrl || ""
      })) };
  }
  function find(state, id) {
    const entry = state.entries.find(item => item.id === id);
    if (!entry) throw agentError("case_not_found", "案例不存在或已删除，请重新搜索。");
    assertCaseFilesReadable(entry);
    return entry;
  }
  return {
    async describeQuery() {
      const state = await load();
      return describeCaseQuery(state.entries, state);
    },
    async search(input = {}) {
      const { query = "", offset = 0, limit = 24 } = input;
      requireInteger(offset); requireInteger(limit, { min: 1, max: 100 });
      const state = await load();
      const { minDurationMs, maxDurationMs, hasOriginalPrompt, ...indexScope } = input;
      filterCaseSearchEntries([], state.organizerState, input);
      const scoped = filterCaseSearchEntries(state.entries, state.organizerState, indexScope);
      const docs = await documents(scoped);
      const derived = await readDerivedMetadata();
      const { index, resultVersion } = searchCache.build(scoped, state.facetCatalog, docs, derived, new Set(state.entries.map(e => e.id)));
      // Coverage must include unknown-duration candidates; structural project/type
      // scoping happens below, while index reads already skip unrelated projects.
      const result = await searchCaseResult(state.entries, index, state.organizerState, input, resultVersion, { ...state, documentTextByAsset: docs, derivedMetadataByAsset: derived });
      const { matches: entries, revision, durationCoverage, engagementCoverage } = result;
      const page = caseSearchPage(result, input, limit, entry => ({ ...summary(entry), sources: caseSearchSourceSummary(entry, input), excerpt: caseFilesUnavailable(entry) ? '' : String(entry.text || "").slice(0, 240), excerptOnly: true }));
      return { ...page, query, revision, ...(durationCoverage ? { durationCoverage } : {}), ...(engagementCoverage ? { engagementCoverage } : {}), total: entries.length, offset,
        basis: "本地文字、标签和媒体元数据；未进行视觉识别。" };
    },
    async read({ caseId, assetId, part = "body", offset = 0, length = 12000, expectedRevision }) {
      requireInteger(offset); requireInteger(length, { min: 1, max: AGENT_CHUNK_BYTES / 4 });
      const entry = find(await load(), caseId);
      assetId = resolveCaseMediaId(entry, assetId);
      const docs = part === "document" ? await documents([entry]) : new Map();
      const byEntry = new Map([[entry.id, entryMediaAssets(entry).map(asset => docs.get(asset.id) || "").filter(Boolean).join("\n")]]);
      const asset = part === "generation_info" ? entryMediaAssets(entry).find(item => item.id === assetId && item.kind === "image" && item.usage !== "poster") : null;
      if (part === "generation_info" && !asset) throw agentError("asset_not_in_case", "请指定该案例中的原始图片。");
      let generationInfo = asset?.generationInfo ?? null;
      if (part === "generation_info" && !generationInfo) {
        const original = await readBlob(asset.id);
        if (original) generationInfo = await readImageGenerationInfo(original);
      }
      let assetOriginal;
      if (part === "original_prompt" && assetId) {
        const sources = entry.memberEntries?.length ? entry.memberEntries : [entry];
        const matching = sources.flatMap(source => entryMediaAssets(source)
          .filter(item => item.id === assetId && item.usage !== "poster")
          .map(asset => detailPromptSources(source, asset).original));
        if (!matching.length) throw agentError("asset_not_in_case", "请指定该案例中的原始素材。");
        if (new Set(matching).size > 1) throw agentError("ambiguous_asset_prompt", "组合成员对同一素材保存了不同原词，请用 read_case_details 读取各成员的媒体提示词关系。");
        assetOriginal = matching[0];
      }
      const text = part === "generation_info" ? JSON.stringify(generationInfo)
        : assetOriginal !== undefined ? assetOriginal
        : part === "media_prompts" ? JSON.stringify(entry.mediaPrompts || [])
        : caseTextPart(entry, part, byEntry);
      return { caseId: entry.id, ...(assetId ? { assetId } : {}), title: entry.title, sourceUrl: entry.url || '',
        openUrl: `${libraryUrl}?case=${encodeURIComponent(entry.id)}`, part,
        ...await caseTextPage({ caseId: entry.id, assetId, part, text, offset, length, expectedRevision }) };
    },
    async media({ caseId, assetId, offset = 0, expectedHash }) {
      requireInteger(offset);
      const entry = find(await load(), caseId);
      assetId = resolveCaseMediaId(entry, assetId);
      const asset = entryMediaAssets(entry).find(item => item.id === assetId);
      if (!asset) throw agentError("asset_not_in_case", "该媒体不属于指定案例。");
      const blob = await readBlob(assetId);
      if (!blob) throw agentError("asset_not_local", "没有可读取的本地原件，请先在插件中补齐素材或恢复文件授权。");
      if (expectedHash && !/^[a-f0-9]{64}$/u.test(expectedHash)) throw agentError("invalid_input", "原件摘要无效。");
      // Hash the starting original once. The receiver hashes the assembled file
      // and rejects any concurrent content change; avoid rehashing GBs per chunk.
      const hash = offset === 0 || !expectedHash ? await sha256Blob(blob) : expectedHash;
      if (offset > blob.size) throw agentError("invalid_input", "读取位置超出原件大小。");
      const bytes = new Uint8Array(await blob.slice(offset, offset + agentDownloadChunkBytes()).arrayBuffer());
      return { assetId, mimeType: blob.type || asset.mimeType, name: asset.sourceTitle || assetId,
        byteSize: blob.size, sha256: hash, offset, data: bytesToBase64(bytes),
        nextOffset: offset + bytes.length < blob.size ? offset + bytes.length : null };
    }
  };
}
