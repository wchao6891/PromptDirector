import { PAGE_CAPTURE_ADAPTERS, resolvePageCaptureAdapter } from "./page-capture-adapter-registry.js";
import { PAGE_CAPTURE_QUALITY_LIMITS } from "./resource-limits.js";
import { normalizeArticleDocument, remapArticleDocumentAssets } from "./article-document.js";
import { isSupportedDocumentMimeType } from "./bounded-media.js";

export { PAGE_CAPTURE_ADAPTERS, PAGE_CAPTURE_PLATFORM_ADAPTERS } from "./page-capture-adapter-registry.js";

const PAGE_TYPES = new Set(["article", "artwork", "post", "gallery", "feed", "video", "generic"]);
const COMPLETENESS = new Set(["complete", "partial"]);

export function detectPageCaptureAdapter(value, adapters = PAGE_CAPTURE_ADAPTERS) {
  return resolvePageCaptureAdapter(value, {}, adapters);
}

export function pageCaptureDefaultMediaIds(candidateValue = {}) {
  return (normalizePageCaptureCandidate(candidateValue)?.media || [])
    .filter((item) => item.placement === "inline")
    .map((item) => item.id);
}

export function resolvePageCapturePageType({
  adapterPageType = "generic",
  structuredTypes = [],
  articleTextLength = 0,
  cardCount = 0,
  metadataType = ""
} = {}) {
  if (adapterPageType === "post") return "post";
  if (structuredTypes.includes("VideoObject") || ["youtube", "bilibili"].includes(adapterPageType)) return "video";
  if (structuredTypes.some((type) => ["Article", "NewsArticle", "BlogPosting"].includes(type)) || articleTextLength > 500) return "article";
  if (cardCount > 1) return metadataType === "website" ? "gallery" : "feed";
  return PAGE_TYPES.has(adapterPageType) ? adapterPageType : "generic";
}

export function reconcilePageCaptureArticlePlacement({ articleDocument, media: mediaValue, contentTargets } = {}) {
  const documentValue = normalizeArticleDocument(articleDocument) || { version: 1, blocks: [] };
  const media = uniqueMedia(mediaValue);
  const mediaById = new Map(media.map((item) => [item.id, item]));
  const blocksById = new Map(documentValue.blocks.map((block) => [block.id, block]));
  const blocksByAssetId = new Map(documentValue.blocks.flatMap((block) => block.assetId ? [[block.assetId, block]] : []));
  const inlineIds = new Set(documentValue.blocks.flatMap((block) => block.assetId && mediaById.has(block.assetId) ? [block.assetId] : []));
  const emittedBlockIds = new Set();
  const emittedAssetIds = new Set();
  const orderedBlocks = [];
  const emit = (block) => {
    if (!block || emittedBlockIds.has(block.id) || block.assetId && emittedAssetIds.has(block.assetId)) return;
    emittedBlockIds.add(block.id);
    if (block.assetId) emittedAssetIds.add(block.assetId);
    orderedBlocks.push(block);
  };
  const mediaBlock = (item) => ({
    id: `article:${item.kind}:${item.id}`,
    kind: item.kind,
    assetId: item.id,
    sourceUrl: item.url,
    ...(item.posterUrl ? { posterUrl: item.posterUrl } : {}),
    label: item.alt || item.filename || ""
  });

  for (const target of (Array.isArray(contentTargets) ? contentTargets : [])
    .filter((item) => item?.kind !== "group")
    .sort((left, right) => Number(left.sourceOrder || 0) - Number(right.sourceOrder || 0))) {
    for (const blockId of target.articleBlockIds || []) emit(blocksById.get(blockId));
    for (const mediaId of target.mediaIds || []) {
      const item = mediaById.get(mediaId);
      if (!item) continue;
      inlineIds.add(mediaId);
      emit(blocksByAssetId.get(mediaId) || mediaBlock(item));
    }
  }
  for (const block of documentValue.blocks) {
    if (block.assetId && !inlineIds.has(block.assetId)) continue;
    emit(block);
  }

  return {
    articleDocument: normalizeArticleDocument({
      version: documentValue.version || 1,
      blocks: orderedBlocks.map((block, sourceOrder) => ({ ...block, sourceOrder }))
    }),
    media: media.map((item) => ({ ...item, placement: inlineIds.has(item.id) ? "inline" : "unplaced" }))
  };
}

export function normalizePageCaptureBatch(value = {}) {
  const candidates = uniqueCandidates(value.candidates);
  const legacySelections = Array.isArray(value.selectedIds)
    ? value.selectedIds.map((candidateId) => {
      const candidate = candidates.find((item) => item.id === clean(candidateId));
      return candidate ? {
        candidateId: candidate.id,
        includeText: Boolean(candidate.contentText || candidate.excerpt),
        selectedMediaIds: candidate.media.map((item) => item.id)
      } : null;
    }).filter(Boolean)
    : [];
  const selections = (Array.isArray(value.selections) ? value.selections : legacySelections)
    .map((selection) => normalizePageCaptureSelection(selection, candidates))
    .filter(Boolean);
  return {
    id: clean(value.id) || globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random()}`,
    tabId: Number.isInteger(Number(value.tabId)) ? Number(value.tabId) : null,
    sourceUrl: safeUrl(value.sourceUrl),
    adapter: clean(value.adapter) || "generic",
    captureMode: value.captureMode === "list" ? "list" : "single",
    saveMode: value.saveMode === "combined" ? "combined" : value.saveMode === "multiple" ? "multiple" : value.captureMode === "list" ? "" : "single",
    combinedTitle: clean(value.combinedTitle),
    targetCount: positiveInteger(value.targetCount, 0),
    stopReason: ["target-reached", "no-new-items", "no-next-page", "layout-changed", "pagination-failed", "cancelled"].includes(value.stopReason) ? value.stopReason : "",
    status: ["preview", "scanning", "saving", "completed", "cancelled", "failed"].includes(value.status) ? value.status : "preview",
    sessionMediaAllowed: value.sessionMediaAllowed !== false,
    candidates,
    selections,
    discoveredCount: candidates.length,
    createdAt: validIso(value.createdAt) || new Date().toISOString(),
    error: clean(value.error)
  };
}

export function combinePageCaptureCandidates(values = [], options = {}) {
  const candidates = (Array.isArray(values) ? values : []).map(normalizePageCaptureCandidate).filter(Boolean);
  if (!candidates.length) return null;
  const canonicalUrl = safeUrl(options.canonicalUrl) || candidates[0].canonicalUrl;
  const title = clean(options.title) || candidates[0].title;
  const ordered = candidates.map((candidate, index) => ({ candidate, index }));
  const textBlocks = ordered.flatMap(({ candidate, index }) => {
    const text = [candidate.title, candidate.contentText].filter(Boolean).join("\n");
    return text ? [{
      id: stableCandidateId(canonicalUrl, `combined\n${index}\n${text}`),
      text,
      html: "",
      kind: "section",
      sourceOrder: index
    }] : [];
  });
  const articleBlocks = ordered.flatMap(({ candidate, index }) => {
    const documentValue = normalizeArticleDocument(candidate.articleDocument);
    const blocks = documentValue?.blocks || [];
    return [
      { id: `combined:${index}:title`, kind: "heading", level: 2, text: candidate.title, sourceOrder: 0 },
      ...blocks.map((block) => ({ ...block, id: `combined:${index}:${block.id}` }))
    ];
  }).map((block, sourceOrder) => ({ ...block, sourceOrder }));
  return normalizePageCaptureCandidate({
    id: stableCandidateId(canonicalUrl, `combined\n${candidates.map((item) => item.id).join("\n")}`),
    title,
    canonicalUrl,
    pageType: "gallery",
    contentText: textBlocks.map((item) => item.text).join("\n\n"),
    textBlocks,
    articleDocument: { version: 1, blocks: articleBlocks },
    media: candidates.flatMap((candidate) => candidate.media.map((media) => ({
      ...media,
      sourceTitle: candidate.title,
      sourceAuthor: candidate.sourceFacts.author,
      originalWorkUrl: candidate.canonicalUrl
    }))),
    sourceFacts: {
      provider: hostname(canonicalUrl),
      pageType: "gallery",
      captureScope: "document",
      extractionMethod: "page",
      status: "complete"
    },
    completeness: "complete",
    extraction: { scope: "document", method: "page" },
    adapter: "generic"
  });
}

export function normalizePageCaptureSelection(value = {}, candidatesValue = []) {
  const candidates = Array.isArray(candidatesValue) ? candidatesValue : [];
  const candidateId = clean(value.candidateId);
  const candidate = candidates.find((item) => item.id === candidateId);
  if (!candidate) return null;
  const mediaIds = new Set(candidate.media.map((item) => item.id));
  const selectedMediaIds = [...new Set((Array.isArray(value.selectedMediaIds) ? value.selectedMediaIds : [])
    .map(clean).filter((id) => mediaIds.has(id)))];
  const mediaDecision = value.mediaDecision === "confirmed"
    ? "confirmed"
    : value.mediaDecision === "none" ? "none" : "pending";
  const hasTextBlockSelection = Array.isArray(value.selectedTextBlockIds);
  const textBlockIds = new Set(candidate.textBlocks.map((item) => item.id));
  const selectedTextBlockIds = [...new Set((hasTextBlockSelection ? value.selectedTextBlockIds : [])
    .map(clean).filter((id) => textBlockIds.has(id)))];
  const includeText = hasTextBlockSelection
    ? selectedTextBlockIds.length > 0
    : value.includeText === true && Boolean(candidate.contentText || candidate.excerpt);
  if (!includeText && !selectedMediaIds.length) return null;
  return {
    candidateId,
    includeText,
    ...(hasTextBlockSelection ? { selectedTextBlockIds } : {}),
    selectedMediaIds: mediaDecision === "none" ? [] : selectedMediaIds,
    mediaDecision
  };
}

export function mergePageCaptureRegionEdit(originalValue, revisedValue) {
  const original = normalizePageCaptureCandidate(originalValue);
  const revised = normalizePageCaptureCandidate(revisedValue);
  if (!original || !revised) return original || revised;
  const revisedToOriginalIds = new Map();
  const media = revised.media.map((item) => {
    const originalItem = original.media.find((candidate) => mediaValuesOverlap(candidate, item));
    if (!originalItem) return item;
    revisedToOriginalIds.set(item.id, originalItem.id);
    return {
      ...item,
      ...originalItem,
      id: originalItem.id,
      variants: [...(originalItem.variants || []), ...(item.variants || [])]
    };
  });
  return normalizePageCaptureCandidate({
    ...revised,
    id: original.id,
    title: original.title,
    canonicalUrl: original.canonicalUrl,
    pageType: original.pageType,
    sourceFacts: original.sourceFacts,
    adapter: original.adapter,
    region: revised.region
      ? {
          ...original.region,
          contentTargets: (revised.region.contentTargets?.length ? revised.region.contentTargets : original.region?.contentTargets || [])
            .map((target) => ({
              ...target,
              mediaIds: (target.mediaIds || []).map((id) => revisedToOriginalIds.get(id) || id)
            })),
          edits: revised.region.edits || []
        }
      : original.region,
    media,
    articleDocument: remapArticleDocumentAssets(revised.articleDocument, revisedToOriginalIds)
  });
}

function mediaValuesOverlap(left, right) {
  if (left?.kind && right?.kind && left.kind !== right.kind) return false;
  const identity = (value) => pageCaptureMediaIdentity(value) || value;
  const leftUrls = new Set([left.url, left.posterUrl, ...(left.variants || []).map((item) => item.url)].filter(Boolean).map(identity));
  return [right.url, right.posterUrl, ...(right.variants || []).map((item) => item.url)]
    .filter(Boolean)
    .map(identity)
    .some((url) => leftUrls.has(url));
}

export function applyPageCaptureSelections(batchValue = {}) {
  const batch = normalizePageCaptureBatch(batchValue);
  return batch.selections.flatMap((selection) => {
    const candidate = batch.candidates.find((item) => item.id === selection.candidateId);
    if (!candidate) return [];
    const selectedMediaIds = new Set(selection.mediaDecision === "confirmed" ? selection.selectedMediaIds : []);
    const hasTextBlockSelection = Array.isArray(selection.selectedTextBlockIds);
    const selectedTextBlockIds = new Set(selection.selectedTextBlockIds || []);
    const selectedTextBlocks = (hasTextBlockSelection
      ? candidate.textBlocks.filter((item) => selectedTextBlockIds.has(item.id))
      : candidate.textBlocks)
      .sort((left, right) => (left.sourceOrder ?? 0) - (right.sourceOrder ?? 0));
    const selectedAllText = !hasTextBlockSelection || selectedTextBlocks.length === candidate.textBlocks.length;
    const selectedText = selection.includeText
      ? selectedTextBlocks.map((item) => item.text).join("\n\n")
      : "";
    const selectedHtml = selection.includeText && selectedTextBlocks.every((item) => item.html)
      ? selectedTextBlocks.map((item) => item.html).join("")
      : "";
    const articleDocument = filterCandidateArticleDocument(candidate.articleDocument, {
      includeText: selection.includeText,
      selectedAllText,
      selectedTextBlockIds,
      selectedMediaIds
    });
    return [{
      ...candidate,
      contentHtml: selection.includeText
        ? selectedAllText ? candidate.contentHtml : selectedHtml
        : "",
      contentText: hasTextBlockSelection ? selectedText : selection.includeText ? candidate.contentText : "",
      excerpt: selection.includeText
        ? selectedAllText ? candidate.excerpt : selectedTextBlocks[0]?.text || ""
        : "",
      media: candidate.media.filter((item) => selectedMediaIds.has(item.id)),
      articleDocument
    }];
  });
}

export function pageCaptureMediaDecisionsResolved(batchValue = {}) {
  const batch = normalizePageCaptureBatch(batchValue);
  return batch.selections.length > 0 && batch.selections.every((selection) => selection.mediaDecision !== "pending");
}

export function pageCaptureStructureMatches(referenceValue, candidateValue) {
  const signature = (value) => {
    const candidate = normalizePageCaptureCandidate(value);
    if (!candidate) return null;
    const articleKinds = new Set((candidate.articleDocument?.blocks || [])
      .map((block) => block.kind)
      .filter((kind) => !["heading", "link"].includes(kind)));
    return {
      hasText: Boolean(candidate.textBlocks.length || candidate.contentText),
      articleKinds: [...articleKinds].sort(),
      mediaKinds: [...new Set(candidate.media.map((media) => media.kind))].sort()
    };
  };
  const reference = signature(referenceValue);
  const candidate = signature(candidateValue);
  return Boolean(reference && candidate
    && reference.hasText === candidate.hasText
    && reference.articleKinds.join("|") === candidate.articleKinds.join("|")
    && reference.mediaKinds.join("|") === candidate.mediaKinds.join("|"));
}

function filterCandidateArticleDocument(value, selection) {
  const documentValue = normalizeArticleDocument(value);
  if (!documentValue) return null;
  return normalizeArticleDocument({
    ...documentValue,
    blocks: documentValue.blocks.filter((block) => {
      if (["image", "video", "document"].includes(block.kind)) return selection.selectedMediaIds.has(block.assetId);
      if (block.kind === "link") return true;
      return selection.includeText && (selection.selectedAllText || selection.selectedTextBlockIds.has(block.id));
    })
  });
}

export function normalizePageCaptureCandidate(value = {}) {
  const canonicalUrl = safeUrl(value.canonicalUrl || value.url);
  const title = clean(value.title);
  if (!canonicalUrl && !title) return null;
  const sourceFacts = normalizeSourceFacts(value.sourceFacts, canonicalUrl);
  const rawContentText = normalizeText(value.contentText);
  const rawTextBlocks = normalizeTextBlocks(value.textBlocks, rawContentText, canonicalUrl);
  const prepared = rawTextBlocks.some((item) => item.kind && item.kind !== "section")
    ? prepareCreativeSections(rawTextBlocks, { canonicalUrl, title, sourceFacts })
    : {
        textBlocks: rawTextBlocks,
        possibleOmissions: normalizeTextBlocks(value.possibleOmissions, "", canonicalUrl),
        contentText: rawContentText,
        contentHtml: String(value.contentHtml ?? "")
      };
  const textBlocks = prepared.textBlocks;
  const contentText = prepared.contentText;
  const media = suppressVideoPosterImages(uniqueMedia(value.media));
  const mediaIds = new Set(media.map((item) => item.id));
  const normalizedArticleDocument = normalizeArticleDocument(value.articleDocument);
  const articleDocument = normalizedArticleDocument && normalizeArticleDocument({
    ...normalizedArticleDocument,
    blocks: normalizedArticleDocument.blocks.filter((block) => !block.assetId || mediaIds.has(block.assetId))
  });
  return {
    id: clean(value.id) || stableCandidateId(canonicalUrl, title),
    pageType: PAGE_TYPES.has(value.pageType) ? value.pageType : "generic",
    title: title || hostname(canonicalUrl),
    canonicalUrl,
    contentHtml: prepared.contentHtml,
    contentText,
    textBlocks,
    articleDocument,
    possibleOmissions: prepared.possibleOmissions,
    batchStructureStatus: value.batchStructureStatus === "review" ? "review" : value.batchStructureStatus === "matched" ? "matched" : "",
    region: normalizeCaptureRegion(value.region),
    excerpt: clean(value.excerpt),
    media,
    sourceFacts,
    completeness: COMPLETENESS.has(value.completeness) ? value.completeness : "partial",
    extraction: {
      scope: value.extraction?.scope === "selection" ? "selection" : "document",
      method: ["selection", "readability", "structured", "page"].includes(value.extraction?.method)
        ? value.extraction.method
        : "page",
      textBlockCount: textBlocks.length
    },
    adapter: clean(value.adapter) || "generic"
  };
}

function suppressVideoPosterImages(values) {
  const posterIdentities = new Set(values
    .filter((item) => item.kind === "video")
    .map((item) => pageCaptureMediaIdentity(item.posterUrl) || item.posterUrl)
    .filter(Boolean));
  return values.filter((item) => item.kind !== "image" || !posterIdentities.has(pageCaptureMediaIdentity(item.url) || item.url));
}

function normalizeCaptureRegion(value = {}) {
  value = value && typeof value === "object" ? value : {};
  const marker = clean(value.marker);
  if (!marker) return null;
  return {
    id: clean(value.id) || marker,
    marker,
    label: clean(value.label),
    score: Number.isFinite(Number(value.score)) ? Number(value.score) : 0,
    textLength: positiveInteger(value.textLength, 0),
    mediaCount: positiveInteger(value.mediaCount, 0),
    contentTargets: (Array.isArray(value.contentTargets) ? value.contentTargets : []).flatMap((target, index) => {
      const path = clean(target?.path);
      const kind = ["text", "image", "video", "document", "group"].includes(target?.kind) ? target.kind : "";
      if (!path || !kind) return [];
      return [{
        id: clean(target.id) || `target:${index}`,
        kind,
        path,
        groupId: clean(target.groupId),
        articleBlockIds: [...new Set((Array.isArray(target.articleBlockIds) ? target.articleBlockIds : []).map(clean).filter(Boolean))],
        mediaIds: [...new Set((Array.isArray(target.mediaIds) ? target.mediaIds : []).map(clean).filter(Boolean))],
        sourceOrder: Number.isSafeInteger(Number(target.sourceOrder)) ? Number(target.sourceOrder) : index
      }];
    }).slice(0, PAGE_CAPTURE_QUALITY_LIMITS.maxContentTargetsPerCandidate),
    edits: (Array.isArray(value.edits) ? value.edits : []).flatMap((edit) => {
      const path = clean(edit?.path);
      const mode = edit?.mode === "exclude" ? "exclude" : edit?.mode === "include" ? "include" : "";
      return path && mode ? [{ mode, path }] : [];
    }).slice(0, 200)
  };
}

function normalizeTextBlocks(values, contentText, canonicalUrl) {
  const provided = (Array.isArray(values) ? values : []).flatMap((value, index) => {
    const text = normalizeText(typeof value === "string" ? value : value?.text);
    if (!text) return [];
    const kind = ["heading", "paragraph", "list", "quote", "code", "figure", "table", "noise", "section"].includes(value?.kind) ? value.kind : "";
    const hasSourceOrder = Number.isSafeInteger(Number(value?.sourceOrder));
    return [{
      id: clean(value?.id) || stableCandidateId(canonicalUrl, `${index}\n${text}`),
      text,
      html: String(typeof value === "string" ? "" : value?.html ?? ""),
      ...(kind ? { kind } : {}),
      ...(value?.relevance === "explicit-creative" ? { relevance: "explicit-creative" } : {}),
      ...(clean(value?.reason) ? { reason: clean(value.reason) } : {}),
      ...(Number.isFinite(Number(value?.score)) ? { score: Number(value.score) } : {}),
      ...(hasSourceOrder ? { sourceOrder: Number(value.sourceOrder) } : {})
    }];
  });
  if (provided.length) return provided;
  return normalizeText(contentText).split(/\n\s*\n/g).flatMap((text, index) => {
    const normalized = normalizeText(text);
    return normalized ? [{ id: stableCandidateId(canonicalUrl, `${index}\n${normalized}`), text: normalized, html: "" }] : [];
  });
}

function prepareCreativeSections(blocks, context) {
  const sourceBlocks = blocks
    .map((block, index) => ({ ...block, sourceOrder: Number.isSafeInteger(block.sourceOrder) ? block.sourceOrder : index }))
    .sort((left, right) => left.sourceOrder - right.sourceOrder);
  const omitted = [];
  const sections = [];
  let current = null;
  const flush = () => {
    if (!current?.blocks.length) return;
    const text = current.blocks.map((item) => item.text).join("\n");
    const html = current.blocks.map((item) => item.html).join("");
    const promptLike = current.blocks.some((item) => item.relevance === "explicit-creative") || isPromptSection(text);
    const item = {
      id: stableCandidateId(context.canonicalUrl, `section\n${current.sourceOrder}\n${text}`),
      text,
      html,
      kind: "section",
      sourceOrder: current.sourceOrder,
      relevance: promptLike ? "explicit-creative" : "general-content",
      score: (promptLike ? 1_000_000 : 0) + [...text].length
    };
    if (promptLike || [...text].length >= PAGE_CAPTURE_QUALITY_LIMITS.minOrdinarySectionCharacters) sections.push(item);
    else omitted.push({ ...item, reason: "short-or-uncertain" });
    current = null;
  };

  for (const block of sourceBlocks) {
    if (block.text === context.title || block.text === context.sourceFacts.author) continue;
    if (block.kind === "noise") {
      flush();
      omitted.push({ ...block, reason: "page-chrome" });
      continue;
    }
    if (block.kind === "heading") {
      flush();
      current = { sourceOrder: block.sourceOrder, blocks: [block] };
      continue;
    }
    if (!current) current = { sourceOrder: block.sourceOrder, blocks: [] };
    current.blocks.push(block);
  }
  flush();

  const textBlocks = sections
    .sort((left, right) => right.score - left.score || left.sourceOrder - right.sourceOrder)
    .slice(0, PAGE_CAPTURE_QUALITY_LIMITS.maxCreativeSections);
  const retained = [...textBlocks].sort((left, right) => left.sourceOrder - right.sourceOrder);
  return {
    textBlocks,
    possibleOmissions: omitted
      .sort((left, right) => [...right.text].length - [...left.text].length || left.sourceOrder - right.sourceOrder)
      .slice(0, PAGE_CAPTURE_QUALITY_LIMITS.maxPossibleOmissions),
    contentText: retained.map((item) => item.text).join("\n\n"),
    contentHtml: retained.every((item) => item.html) ? retained.map((item) => item.html).join("") : ""
  };
}

function isPromptSection(value) {
  return /(?:^|\n)\s*(?:prompt|negative prompt|system prompt|提示词|反向提示词|项目\s*brief|creative brief|brief|创作说明)\s*[:：]?\s*(?:\n|$)/iu.test(String(value || ""));
}

export function normalizeSourceFacts(value = {}, canonicalUrl = "") {
  const engagement = Object.fromEntries(Object.entries(value.engagement || {}).flatMap(([key, amount]) => {
    const number = Number(amount);
    return clean(key) && Number.isFinite(number) && number >= 0 ? [[clean(key), number]] : [];
  }));
  const capturedAt = validIso(value.capturedAt) || new Date().toISOString();
  return {
    provider: clean(value.provider) || hostname(canonicalUrl),
    pageType: PAGE_TYPES.has(value.pageType) ? value.pageType : "generic",
    itemId: clean(value.itemId),
    author: clean(value.author),
    handle: clean(value.handle),
    publishedAt: validIso(value.publishedAt),
    capturedAt,
    model: clean(value.model),
    dimensions: clean(value.dimensions),
    duration: clean(value.duration),
    license: clean(value.license),
    engagement,
    engagementObservedAt: Object.keys(engagement).length
      ? validIso(value.engagementObservedAt) || capturedAt
      : "",
    captureScope: value.captureScope === "selection" ? "selection" : "document",
    extractionMethod: ["selection", "readability", "structured", "page"].includes(value.extractionMethod)
      ? value.extractionMethod
      : "page",
    status: value.status === "complete" ? "complete" : "partial"
  };
}

export function pageCapturePermissionOrigins(candidates = []) {
  const origins = new Set();
  for (const candidate of candidates) {
    for (const media of normalizePageCaptureCandidate(candidate)?.media || []) {
      if (media.kind === "document" && !isSupportedDocumentMimeType(media.mimeType)) continue;
      for (const value of [media.posterUrl, ...pageCaptureMediaFetchCandidates(media)]) {
        try {
          const url = new URL(value);
          if (["http:", "https:"].includes(url.protocol)) origins.add(`${url.origin}/*`);
        } catch {
        }
      }
    }
  }
  return [...origins].sort();
}

export function pageCaptureMediaFetchCandidates(value = {}) {
  const seen = new Set();
  return [
    ...(Array.isArray(value.variants) ? value.variants.map((variant) => variant?.url) : []),
    value.url
  ].flatMap((candidate) => {
    const url = safeUrl(candidate);
    if (!url || seen.has(url)) return [];
    seen.add(url);
    return [url];
  });
}

export async function resolvePageCaptureImage(mediaValue = {}, options = {}) {
  if (typeof options.fetchMedia !== "function" || typeof options.decodeDataUrl !== "function") {
    throw new Error("网页媒体解析器缺少下载能力");
  }
  const failures = [];
  for (const url of pageCaptureMediaFetchCandidates(mediaValue)) {
    try {
      const downloaded = await options.fetchMedia(url);
      const blob = downloaded?.blob instanceof Blob ? downloaded.blob : downloaded;
      return { blob, metadata: downloaded?.metadata || null, sourceUrl: url, captureMethod: "source", usedPixelFallback: false, failures };
    } catch (error) {
      failures.push({ url, message: String(error?.message || error) });
    }
  }
  if (options.sessionMediaAllowed !== false && typeof options.fetchSessionMedia === "function") {
    for (const url of pageCaptureMediaFetchCandidates(mediaValue)) {
      try {
        const downloaded = await options.fetchSessionMedia(url);
        const blob = downloaded?.blob instanceof Blob ? downloaded.blob : downloaded;
        return { blob, metadata: downloaded?.metadata || null, sourceUrl: url, captureMethod: "page-session", usedPixelFallback: false, failures };
      } catch (error) {
        failures.push({ url, method: "page-session", message: String(error?.message || error) });
      }
    }
  }
  const dataUrl = safeImageDataUrl(mediaValue.dataUrl || mediaValue.previewDataUrl);
  if (dataUrl) {
    try {
      return { blob: await options.decodeDataUrl(dataUrl), sourceUrl: "", captureMethod: "pixel-fallback", usedPixelFallback: true, failures };
    } catch (error) {
      failures.push({ url: "pixel-fallback", message: String(error?.message || error) });
    }
  }
  const reason = failures.at(-1)?.message || "没有可用的图片来源";
  throw new Error(reason);
}

export async function collectPageCaptureSnapshot(options = {}) {
  function clean(value) {
    return String(value ?? "").replace(/[\u0000-\u001f\u007f]/g, " ").trim();
  }
  const capturedAt = new Date().toISOString();
  const sessionId = clean(options.sessionId);
  let cancelled = false;
  const handleCaptureMessage = (message, _sender, sendResponse) => {
    if (message?.type !== "PROMPTDIRECTOR_PAGE_CAPTURE" || message.sessionId !== sessionId) return undefined;
    if (message.action === "cancel") {
      cancelled = true;
      sendResponse({ ok: true, sessionId, cancelled: true });
      return false;
    }
    return undefined;
  };
  if (sessionId) globalThis.chrome?.runtime?.onMessage?.addListener?.(handleCaptureMessage);
  const maxCandidates = positiveInteger(options.maxCandidates, 100);
  const maxMedia = positiveInteger(options.maxMedia, 24);
  const maxInlinePixelDataCharacters = positiveInteger(options.maxInlinePixelDataCharacters, 1);
  const wholePage = options.mode === "whole";
  const originalScroll = { x: window.scrollX, y: window.scrollY };

  try {
    const editedRegion = options.editedRegion && typeof options.editedRegion === "object" ? options.editedRegion : null;
    const editedBaseRoot = editedRegion?.marker
      ? [...document.querySelectorAll?.("[data-promptdirector-capture-region]") || []]
        .find((element) => element.getAttribute?.("data-promptdirector-capture-region") === clean(editedRegion.marker))
      : null;
    const editedRoot = editedBaseRoot && clean(editedRegion?.token)
      ? buildEditedRegionRoot(editedBaseRoot, clean(editedRegion.token))
      : null;
    for (const element of document.querySelectorAll?.("[data-promptdirector-capture-region]") || []) {
      element.removeAttribute?.("data-promptdirector-capture-region");
    }
    const adapter = detectAdapter(location.hostname);
    const canonicalUrl = safeHttpUrl(document.querySelector('link[rel="canonical"]')?.href || location.href);
    const metadata = collectMetadata();
    const structured = collectStructuredData();
    const article = readArticle();
    const siteData = options.siteData && typeof options.siteData === "object" ? options.siteData : null;
    const pageSelection = options.mode === "whole" ? null : collectPageSelection();
    if (editedRoot) {
      const pageType = detectPageType({ adapter, metadata, structured, article, cardCount: 0 });
      const candidate = candidateForRoot(editedRoot, 0, {
        adapter, metadata, structured, article: null, siteData: null, canonicalUrl, pageType, maxMedia
      });
      if (candidate) candidate.region = editedRegion.region || null;
      editedBaseRoot.setAttribute?.("data-promptdirector-capture-region", clean(editedRegion.marker));
      return { id: sessionId, sourceUrl: canonicalUrl, adapter: adapter.id, candidates: candidate ? [candidate] : [], capturedAt };
    }
    if (siteData?.pageKind === "feed") {
      if (wholePage) await scanLoadedPage(() => undefined);
      return {
        id: sessionId,
        sourceUrl: canonicalUrl,
        adapter: adapter.id,
        candidates: Array.isArray(siteData.candidates) ? siteData.candidates.slice(0, maxCandidates) : [],
        capturedAt,
        siteStatus: siteData.completeness === "complete" ? "complete" : "partial"
      };
    }
    const accumulated = new Map();
    const collectVisible = () => {
      const current = [];
      const adapterRoots = adapter.cardSelectors.flatMap((selector) => [...document.querySelectorAll(selector)]);
      const repeatedRoots = adapterRoots.length > 1 ? [] : collectRepeatedCardRoots(maxCandidates);
      const cardRoots = [...adapterRoots, ...repeatedRoots];
      const roots = [...new Set(cardRoots)].filter(isContentRoot);
      const pageType = detectPageType({ adapter, metadata, structured, article, cardCount: roots.length });
      for (const [index, root] of roots.entries()) {
        const candidate = candidateForRoot(root, index, {
          adapter, metadata, structured, article: null, siteData: null, canonicalUrl, pageType, maxMedia
        });
        if (candidate) current.push(candidate);
      }
      return current;
    };
    const collectVisibleWithFallbacks = async () => {
      const current = collectVisible();
      await attachViewportFallbacks(current);
      for (const candidate of current) {
        if (accumulated.has(candidate.id) || accumulated.size < maxCandidates) accumulated.set(candidate.id, candidate);
      }
    };
    await collectVisibleWithFallbacks();
    if (wholePage) await scanLoadedPage(collectVisibleWithFallbacks);
    await collectVisibleWithFallbacks();
    const capturedCards = [...accumulated.values()];
    const pageType = detectPageType({ adapter, metadata, structured, article, cardCount: capturedCards.length });
    const bodyCandidate = candidateForRoot(document.body, 0, {
      adapter, metadata, structured, article, siteData, pageSelection, canonicalUrl, pageType, maxMedia
    });
    if (bodyCandidate) await attachViewportFallbacks([bodyCandidate]);
    const regionCandidates = !siteData && !pageSelection && !["feed", "gallery"].includes(pageType)
      ? collectSubjectRegionRoots(positiveInteger(options.maxRegionCandidates, 5)).flatMap((root, index) => {
          const candidate = candidateForRoot(root, index, {
            adapter, metadata, structured, article: null, siteData: null, canonicalUrl, pageType, maxMedia
          });
          return candidate ? [candidate] : [];
        })
      : [];
    if (regionCandidates.length) await attachViewportFallbacks(regionCandidates);
    const candidates = capturedCards.length > 1 && ["feed", "gallery"].includes(pageType)
      ? capturedCards.slice(0, maxCandidates)
      : regionCandidates.length ? regionCandidates
        : bodyCandidate ? [bodyCandidate] : capturedCards.slice(0, maxCandidates);
    return {
      id: sessionId,
      sourceUrl: canonicalUrl,
      adapter: adapter.id,
      candidates,
      capturedAt
    };
  } finally {
    if (wholePage) window.scrollTo(originalScroll.x, originalScroll.y);
    if (sessionId) globalThis.chrome?.runtime?.onMessage?.removeListener?.(handleCaptureMessage);
  }

  async function scanLoadedPage(collectVisible) {
    const maxSteps = positiveInteger(options.maxScrollSteps, 30);
    let stableRounds = 0;
    let previousPosition = -1;
    for (let step = 0; step < maxSteps && stableRounds < 3 && !cancelled; step += 1) {
      const height = Math.max(document.body?.scrollHeight || 0, document.documentElement.scrollHeight);
      const viewport = Math.max(1, Number(window.innerHeight) || 720);
      const nextTop = Math.min(Math.max(0, height - viewport), Math.max(0, window.scrollY) + Math.round(viewport * 0.85));
      window.scrollTo({ top: nextTop, behavior: "instant" });
      await waitForVisibleMedia();
      await collectVisible();
      const nextHeight = Math.max(document.body?.scrollHeight || 0, document.documentElement.scrollHeight);
      const position = Math.max(0, Number(window.scrollY) || nextTop);
      stableRounds = position === previousPosition && position + viewport >= nextHeight ? stableRounds + 1 : 0;
      previousPosition = position;
    }
  }

  async function attachViewportFallbacks(candidates) {
    if (!wholePage || !sessionId || !globalThis.chrome?.runtime?.sendMessage) return;
    const positions = [];
    for (const [candidateIndex, candidate] of candidates.entries()) {
      for (const [mediaIndex, media] of candidate.media.entries()) {
        if (media.kind === "image" && media.fallbackRect && !media.dataUrl) {
          positions.push({ candidateIndex, mediaIndex, selection: media.fallbackRect });
        }
      }
    }
    if (!positions.length) return;
    const boundedPositions = positions.slice(0, maxCandidates);
    try {
      const response = await globalThis.chrome.runtime.sendMessage({
        type: "PAGE_CAPTURE_VIEWPORT_FALLBACKS",
        sessionId,
        selections: boundedPositions.map((item) => item.selection)
      });
      if (!response?.ok || response.dataUrls?.length !== boundedPositions.length) return;
      response.dataUrls.forEach((dataUrl, index) => {
        if (!dataUrl) return;
        const position = boundedPositions[index];
        candidates[position.candidateIndex].media[position.mediaIndex].dataUrl = dataUrl;
        candidates[position.candidateIndex].media[position.mediaIndex].previewDataUrl = dataUrl;
      });
    } catch {
    }
  }

  async function waitForVisibleMedia() {
    const visibleImages = [...(document.images || [])].filter((image) => {
      const rect = image.getBoundingClientRect();
      const viewportHeight = Number(window.innerHeight) || 720;
      return rect.width >= 48 && rect.height >= 48 && rect.bottom >= 0 && rect.top <= viewportHeight;
    });
    await Promise.race([
      Promise.allSettled(visibleImages.map((image) => typeof image.decode === "function" ? image.decode() : Promise.resolve())),
      new Promise((resolve) => setTimeout(resolve, 1200))
    ]);
    const frame = typeof globalThis.requestAnimationFrame === "function"
      ? globalThis.requestAnimationFrame.bind(globalThis)
      : (callback) => setTimeout(callback, 16);
    await new Promise((resolve) => frame(() => frame(resolve)));
  }

  function detectAdapter(host) {
    const adapters = Array.isArray(options.adapters) ? options.adapters : [];
    const direct = adapters.find((item) => item.hosts.some((suffix) => host === suffix || host.endsWith(`.${suffix}`)));
    if (direct) return direct;
    const signals = collectPlatformSignals();
    const platformAdapters = Array.isArray(options.platformAdapters) ? options.platformAdapters : [];
    return platformAdapters.find((item) => Object.entries(item.signalPatterns || {}).some(([key, patterns]) => {
      const values = Array.isArray(signals[key]) ? signals[key] : [signals[key]];
      return patterns.some((pattern) => values.some((value) => {
        try { return new RegExp(pattern, "iu").test(value); } catch { return false; }
      }));
    })) || { id: "generic", hosts: [], cardSelectors: ["main article", "[role=main] article"], fields: {} };
  }

  function collectPlatformSignals() {
    const meta = (name) => cleanText(document.querySelector(`meta[name="${name}"]`)?.content);
    return {
      generator: meta("generator"),
      applicationName: meta("application-name") || meta("applicationName"),
      scripts: [...document.querySelectorAll("script[src]")].map((element) => safeHttpUrl(element.src)).filter(Boolean),
      links: [...document.querySelectorAll("link[href]")].map((element) => safeHttpUrl(element.href)).filter(Boolean)
    };
  }

  function collectMetadata() {
    const value = (property, name = "property") => cleanText(document.querySelector(`meta[${name}="${property}"]`)?.content);
    return {
      title: value("og:title") || value("twitter:title", "name") || cleanText(document.title),
      description: value("og:description") || value("description", "name") || value("twitter:description", "name"),
      image: safeHttpUrl(value("og:image") || value("twitter:image", "name")),
      type: value("og:type"),
      siteName: value("og:site_name"),
      author: value("author", "name") || value("article:author"),
      publishedAt: value("article:published_time")
    };
  }

  function collectStructuredData() {
    const values = [];
    for (const script of document.querySelectorAll('script[type="application/ld+json"]')) {
      try {
        const parsed = JSON.parse(script.textContent || "null");
        values.push(...(Array.isArray(parsed) ? parsed : parsed?.["@graph"] || [parsed]));
      } catch {
      }
    }
    return values.filter((item) => item && typeof item === "object");
  }

  function readArticle() {
    try {
      if (typeof globalThis.Readability !== "function") return null;
      return new globalThis.Readability(document.cloneNode(true), { keepClasses: false }).parse();
    } catch {
      return null;
    }
  }

  function collectPageSelection() {
    try {
      const selection = window.getSelection?.();
      const text = cleanBlockText(selection?.toString?.());
      if (!selection || selection.isCollapsed || !selection.rangeCount || !text) return null;
      const container = document.createElement("div");
      for (let index = 0; index < selection.rangeCount; index += 1) {
        container.appendChild(selection.getRangeAt(index).cloneContents());
      }
      const html = String(container.innerHTML || "");
      return {
        text,
        html,
        textBlocks: collectTextBlocks(container, html, text)
      };
    } catch {
      return null;
    }
  }

  function detectPageType({ adapter, metadata, structured, article, cardCount }) {
    const types = structured.flatMap((item) => Array.isArray(item["@type"]) ? item["@type"] : [item["@type"]]).filter(Boolean);
    if (adapter.pageType === "post") return "post";
    if (types.includes("VideoObject") || ["youtube", "bilibili"].includes(adapter.id)) return "video";
    if (types.some((type) => ["Article", "NewsArticle", "BlogPosting"].includes(type)) || (article?.length || 0) > 500) return "article";
    if (cardCount > 1) return metadata.type === "website" ? "gallery" : "feed";
    return ["article", "artwork", "video"].includes(adapter.pageType) ? adapter.pageType : "generic";
  }

  function reconcileArticlePlacement(articleDocument, mediaValue, contentTargets) {
    const blocks = Array.isArray(articleDocument?.blocks) ? articleDocument.blocks : [];
    const media = Array.isArray(mediaValue) ? mediaValue : [];
    const mediaById = new Map(media.map((item) => [item.id, item]));
    const blocksById = new Map(blocks.map((block) => [block.id, block]));
    const blocksByAssetId = new Map(blocks.flatMap((block) => block.assetId ? [[block.assetId, block]] : []));
    const inlineIds = new Set(blocks.flatMap((block) => block.assetId && mediaById.has(block.assetId) ? [block.assetId] : []));
    const emittedBlockIds = new Set();
    const emittedAssetIds = new Set();
    const orderedBlocks = [];
    const emit = (block) => {
      if (!block || emittedBlockIds.has(block.id) || block.assetId && emittedAssetIds.has(block.assetId)) return;
      emittedBlockIds.add(block.id);
      if (block.assetId) emittedAssetIds.add(block.assetId);
      orderedBlocks.push(block);
    };
    for (const target of (Array.isArray(contentTargets) ? contentTargets : [])
      .filter((item) => item?.kind !== "group")
      .sort((left, right) => Number(left.sourceOrder || 0) - Number(right.sourceOrder || 0))) {
      for (const blockId of target.articleBlockIds || []) emit(blocksById.get(blockId));
      for (const mediaId of target.mediaIds || []) {
        const item = mediaById.get(mediaId);
        if (!item) continue;
        inlineIds.add(mediaId);
        emit(blocksByAssetId.get(mediaId) || {
          id: `article:${item.kind}:${item.id}`,
          kind: item.kind,
          assetId: item.id,
          sourceUrl: item.url,
          ...(item.posterUrl ? { posterUrl: item.posterUrl } : {}),
          label: item.alt || item.filename || ""
        });
      }
    }
    for (const block of blocks) {
      if (block.assetId && !inlineIds.has(block.assetId)) continue;
      emit(block);
    }
    return {
      articleDocument: { version: 1, blocks: orderedBlocks.map((block, sourceOrder) => ({ ...block, sourceOrder })) },
      media: media.map((item) => ({ ...item, placement: inlineIds.has(item.id) ? "inline" : "unplaced" }))
    };
  }

  function candidateForRoot(root, index, context) {
    const siteData = root === document.body ? context.siteData : null;
    const adapterFields = collectAdapterFields(root, context.adapter);
    const cardLink = root === document.body || context.pageType === "article" ? "" : safeHttpUrl(root.querySelector("a[href]")?.href);
    const canonicalUrl = adapterFields.canonicalUrl || cardLink || safeHttpUrl(siteData?.canonicalUrl) || context.canonicalUrl;
    const structured = context.structured.find((item) => sameUrl(item.url || item.mainEntityOfPage, canonicalUrl)) || context.structured[0] || {};
    let title = cleanText(root === document.body
      ? siteData?.title || context.article?.title || structured.headline || structured.name || (context.pageType === "post" ? "" : context.metadata.title)
      : adapterFields.title || root.querySelector("h1,h2,h3,[role=heading]")?.textContent || structured.headline || structured.name || (context.pageType === "post" ? "" : root.querySelector("img[alt]")?.alt));
    const pageSelection = root === document.body ? context.pageSelection : null;
    const text = cleanBlockText(root === document.body
      ? pageSelection?.text || siteData?.contentText || context.article?.textContent || structured.articleBody || root.innerText || context.metadata.description
      : root.innerText || root.textContent);
    const contentHtml = root === document.body
      ? pageSelection?.html || context.article?.content || ""
      : "";
    const structuredTextBlocks = siteData?.contentText
      ? [{
          id: "text:structured:" + hashText(siteData.contentText),
          text: cleanBlockText(siteData.contentText),
          html: "",
          kind: "paragraph",
          relevance: "explicit-creative",
          sourceOrder: 0
        }]
      : null;
    const textBlocks = pageSelection?.textBlocks || structuredTextBlocks || collectTextBlocks(root, contentHtml, text);
    const siteMedia = Array.isArray(siteData?.media) ? siteData.media : [];
    const domMedia = pageSelection || root.isConnected === false ? [] : collectMedia(root, context.maxMedia);
    const pairedDomIds = new Set();
    const pairedSiteMedia = siteMedia.map((item) => {
      const visible = domMedia.find((candidate) => mediaValuesOverlap(item, candidate));
      if (visible) pairedDomIds.add(visible.id);
      return visible ? {
        ...item,
        variants: [...(item.variants || []), ...(visible.variants || [])],
        fallbackRect: visible.fallbackRect,
        dataUrl: visible.dataUrl,
        previewDataUrl: visible.previewDataUrl
      } : item;
    });
    let media = mergeCollectedMedia([
      ...pairedSiteMedia,
      ...collectStructuredMedia(structured),
      ...domMedia.filter((item) => !pairedDomIds.has(item.id))
    ], context.maxMedia);
    const article = collectArticleDocument(root, contentHtml, textBlocks, media, context.maxMedia);
    media = mergeCollectedMedia([...media, ...article.media], context.maxMedia);
    if (!title && !text && !media.length) return null;
    const pageType = root === document.body ? context.pageType : ["post", "video"].includes(context.adapter.pageType) ? context.adapter.pageType : "artwork";
    const author = cleanText(siteData?.sourceFacts?.author || adapterFields.author || structuredAuthorName(structured.author) || context.metadata.author || root.querySelector('[rel=author],[data-testid*=author],[class*=author]')?.textContent);
    if (!title && pageType === "post") {
      const identity = author || (adapterFields.handle ? `@${adapterFields.handle}` : "");
      title = [identity, cleanText(text).slice(0, 96)].filter(Boolean).join(" · ") || context.metadata.siteName || location.hostname;
    }
    const itemId = cleanText(siteData?.sourceFacts?.itemId || structured.identifier?.value || structured.identifier) || itemIdFromUrl(canonicalUrl);
    const captureScope = pageSelection ? "selection" : "document";
    const extractionMethod = pageSelection
      ? "selection"
      : siteData?.sourceFacts?.extractionMethod === "structured" ? "structured"
        : context.article?.content ? "readability" : structured.articleBody ? "structured" : "page";
    const complete = siteData?.completeness === "complete" || Boolean(title && (text || media.length));
    const region = markCaptureRegion(root, index, text, media.length);
    if (region && root.isConnected !== false) {
      region.contentTargets = collectContentTargets(
        root,
        article.blocks,
        media,
        positiveInteger(options.maxContentTargets, 200)
      );
    }
    const placed = reconcileArticlePlacement({ version: 1, blocks: article.blocks }, media, region?.contentTargets || []);
    media = placed.media;
    return {
      id: `${context.adapter.id}:${itemId || index}:${hashText(`${canonicalUrl}\n${title}`)}`,
      pageType,
      title: title || context.metadata.siteName || location.hostname,
      canonicalUrl,
      contentHtml,
      contentText: text,
      textBlocks,
      articleDocument: placed.articleDocument,
      region,
      excerpt: cleanText(context.article?.excerpt || context.metadata.description),
      media,
      sourceFacts: {
        provider: cleanText(siteData?.sourceFacts?.provider) || (context.adapter.id === "generic" ? location.hostname : context.adapter.id),
        pageType,
        itemId,
        author,
        handle: cleanText(siteData?.sourceFacts?.handle || adapterFields.handle) || (author.startsWith("@") ? author.slice(1) : ""),
        publishedAt: siteData?.sourceFacts?.publishedAt || adapterFields.publishedAt || structured.datePublished || context.metadata.publishedAt || "",
        capturedAt,
        model: cleanText(siteData?.sourceFacts?.model || adapterFields.model || structured.model || root.querySelector('[class*=model],[data-testid*=model]')?.textContent),
        dimensions: cleanText(siteData?.sourceFacts?.dimensions || (structured.width && structured.height ? `${structured.width}×${structured.height}` : "")),
        duration: cleanText(structured.duration),
        license: cleanText(structured.license),
        engagement: { ...structuredEngagement(structured.interactionStatistic), ...adapterFields.engagement, ...(siteData?.sourceFacts?.engagement || {}) },
        captureScope,
        extractionMethod,
        status: complete ? "complete" : "partial"
      },
      completeness: complete ? "complete" : "partial",
      extraction: {
        scope: captureScope,
        method: extractionMethod,
        textBlockCount: textBlocks.length
      },
      adapter: context.adapter.id
    };
  }

  function buildEditedRegionRoot(baseRoot, token) {
    const attributeValue = String(token).replace(/["\\]/gu, "");
    const includeSelector = `[data-promptdirector-page-edit-include="${attributeValue}"]`;
    const excludeSelector = `[data-promptdirector-page-edit-exclude="${attributeValue}"]`;
    const includes = [...document.querySelectorAll?.(includeSelector) || []]
      .filter((element) => element !== baseRoot && !baseRoot.contains?.(element));
    const roots = [baseRoot, ...includes].sort((left, right) => {
      const position = left.compareDocumentPosition?.(right) || 0;
      return position & 2 ? 1 : -1;
    });
    const wrapper = document.createElement("div");
    for (const root of roots) {
      if (root.matches?.(excludeSelector)) continue;
      const clone = root.cloneNode(true);
      clone.querySelectorAll?.(excludeSelector).forEach((element) => element.remove());
      clone.removeAttribute?.("data-promptdirector-page-edit-include");
      clone.removeAttribute?.("data-promptdirector-page-edit-exclude");
      clone.querySelectorAll?.(`${includeSelector},${excludeSelector}`).forEach((element) => {
        element.removeAttribute("data-promptdirector-page-edit-include");
        element.removeAttribute("data-promptdirector-page-edit-exclude");
      });
      wrapper.append(clone);
    }
    for (const element of document.querySelectorAll?.(`${includeSelector},${excludeSelector}`) || []) {
      element.removeAttribute?.("data-promptdirector-page-edit-include");
      element.removeAttribute?.("data-promptdirector-page-edit-exclude");
    }
    return wrapper;
  }

  function collectSubjectRegionRoots(limit) {
    const semantic = [...document.querySelectorAll?.("main,article,[role=main],[itemprop=articleBody]") || []];
    const bodyChildren = [...(document.body?.children || [])].filter((element) => element.matches?.("section,div"));
    const candidates = [...new Set([...semantic, ...bodyChildren])]
      .filter(isContentRoot)
      .map((root) => ({ root, score: regionRootScore(root) }))
      .filter((item) => item.score > 0)
      .sort((left, right) => right.score - left.score);
    const accepted = [];
    const signatures = new Set();
    for (const item of candidates) {
      const signature = hashText(`${cleanBlockText(item.root.innerText)}\n${[...item.root.querySelectorAll?.("img,video,iframe,canvas") || []].length}`);
      if (signatures.has(signature)) continue;
      signatures.add(signature);
      accepted.push(item.root);
      if (accepted.length >= limit) break;
    }
    return accepted;
  }

  function collectRepeatedCardRoots(limit) {
    const parents = [...document.querySelectorAll?.("main,[role=main],section,ul,ol,[class*=grid],[class*=gallery],[class*=feed],[class*=list]") || []];
    const groups = [];
    for (const parent of parents) {
      if (parent.closest?.("nav,aside,header,footer,[role=navigation],[role=complementary],[role=contentinfo]")) continue;
      const bySignature = new Map();
      for (const child of [...(parent.children || [])]) {
        if (!isContentRoot(child)) continue;
        const textLength = [...cleanText(child.innerText)].length;
        const mediaCount = [...child.querySelectorAll?.("img,video,iframe,canvas") || []].filter((item) => !isExcludedMedia(item)).length;
        if (!mediaCount && textLength < 20) continue;
        const classShape = [...(child.classList || [])]
          .filter((token) => token.length <= 48 && !/\d{4,}/u.test(token))
          .sort()
          .slice(0, 3)
          .join(".");
        const signature = [
          cleanText(child.tagName).toLowerCase(),
          cleanText(child.getAttribute?.("role")),
          child.querySelector?.("h1,h2,h3,[role=heading]") ? "heading" : "",
          mediaCount ? "media" : "",
          classShape
        ].join(":");
        const group = bySignature.get(signature) || [];
        group.push({ root: child, score: textLength + mediaCount * Math.max(120, textLength) });
        bySignature.set(signature, group);
      }
      for (const group of bySignature.values()) {
        if (group.length < 2) continue;
        groups.push({
          items: group,
          score: group.reduce((total, item) => total + item.score, 0)
        });
      }
    }
    const best = groups.sort((left, right) => right.score - left.score)[0];
    return best ? best.items.map((item) => item.root).slice(0, limit) : [];
  }

  function regionRootScore(root) {
    const text = cleanBlockText(root.innerText);
    const textLength = [...text].length;
    const mediaCount = [...root.querySelectorAll?.("img,video,iframe,canvas") || []].filter((item) => !isExcludedMedia(item)).length;
    const linkTextLength = [...root.querySelectorAll?.("a[href]") || []]
      .reduce((total, link) => total + [...cleanText(link.textContent)].length, 0);
    const controls = [...root.querySelectorAll?.("button,input,select,textarea,[role=button]") || []].length;
    const semanticBoost = root.matches?.("main,article,[role=main],[itemprop=articleBody]") ? Math.max(200, textLength * 0.35) : 0;
    const linkPenalty = textLength ? Math.min(textLength, linkTextLength) : 0;
    return textLength + mediaCount * Math.max(120, Math.min(600, textLength || 120)) + semanticBoost - linkPenalty - controls * 40;
  }

  function markCaptureRegion(root, index, text, mediaCount) {
    if (!root?.setAttribute) return null;
    const marker = `${sessionId || "page"}:${hashText(`${index}\n${cleanBlockText(text).slice(0, 512)}`)}`;
    root.setAttribute("data-promptdirector-capture-region", marker);
    return {
      id: marker,
      marker,
      label: `主体方案 ${index + 1}`,
      score: regionRootScore(root),
      textLength: [...cleanBlockText(text)].length,
      mediaCount
    };
  }

  function collectContentTargets(root, articleBlocks, media, limit) {
    const excludedSelector = "nav,aside,header,footer,[role=navigation],[role=banner],[role=complementary],[role=contentinfo],[class*=comment],[class*=recommend],[data-testid*=comment],[data-testid*=recommend]";
    const semanticSelector = "h1,h2,h3,h4,h5,h6,p,li,blockquote,pre,table,img,video,iframe,a[href]";
    const pathFor = (element) => {
      const parts = [];
      let current = element;
      while (current?.nodeType === 1) {
        const tag = cleanText(current.tagName).toLocaleLowerCase("en-US");
        const siblings = [...(current.parentElement?.children || [])].filter((item) => item.tagName === current.tagName);
        parts.unshift(`${tag}:nth-of-type(${Math.max(1, siblings.indexOf(current) + 1)})`);
        if (current === document.body) break;
        current = current.parentElement;
      }
      return parts.join(" > ");
    };
    const backgroundUrl = (element) => {
      try {
        const match = getComputedStyle(element).backgroundImage.match(/url\(["']?([^"')]+)["']?\)/iu);
        return safeHttpUrl(match?.[1]);
      } catch {
        return "";
      }
    };
    const mediaIdsFor = (element, kind) => {
      const urls = new Set();
      if (kind === "image" && element.matches?.("img")) {
        for (const variant of collectImageVariants(element)) urls.add(variant.url);
      }
      if (kind === "image") urls.add(backgroundUrl(element));
      if (kind === "video") {
        urls.add(safeHttpUrl(element.currentSrc || element.src));
        urls.add(safeHttpUrl(element.poster));
      }
      if (kind === "document") urls.add(safeHttpUrl(element.href || element.getAttribute?.("href")));
      urls.delete("");
      return media.filter((item) => [item.url, item.posterUrl, ...(item.variants || []).map((variant) => variant.url)]
        .some((url) => urls.has(url))).map((item) => item.id);
    };
    const kindFor = (element) => {
      if (element.matches?.("video,iframe")) return element.matches("iframe") && !isSupportedVideoFrame(element) ? "" : "video";
      if (element.matches?.("img") || backgroundUrl(element)) return "image";
      if (element.matches?.("a[href]")) {
        const sourceUrl = safeHttpUrl(element.href || element.getAttribute?.("href"));
        if (!sourceUrl) return "";
        if (attachmentDescriptor(element, sourceUrl, cleanText(element.textContent))) return "document";
        if (isVideoUrl(sourceUrl)) return "video";
        return "";
      }
      return cleanBlockText(element.textContent) ? "text" : "";
    };
    const candidates = [...root.querySelectorAll?.(`${semanticSelector},div,section,figure`) || []]
      .filter((element) => !element.closest?.(excludedSelector));
    const leafElements = candidates.filter((element) => {
      const kind = kindFor(element);
      if (!kind) return false;
      if (kind !== "text") return true;
      if (element.matches?.(semanticSelector)) return true;
      return !element.querySelector?.(semanticSelector) && cleanBlockText(element.textContent);
    });
    const leaves = leafElements.flatMap((element, sourceOrder) => {
      const kind = kindFor(element);
      const text = kind === "text" ? cleanBlockText(element.textContent) : "";
      const articleBlockIds = kind === "text"
        ? articleBlocks.filter((block) => !block.assetId && cleanBlockText(block.text) === text).map((block) => block.id)
        : [];
      const mediaIds = mediaIdsFor(element, kind);
      if (kind !== "text" && !mediaIds.length) return [];
      const path = pathFor(element);
      if (!path) return [];
      return [{
        id: `content:${kind}:${sourceOrder}:${hashText(path)}`,
        kind,
        path,
        groupId: "",
        articleBlockIds,
        mediaIds,
        sourceOrder,
        element
      }];
    });
    const groups = candidates.filter((element) => element.matches?.("div,section,article,figure") && element !== root).flatMap((element) => {
      const children = leaves.filter((target) => element.contains?.(target.element));
      if (children.length < 2) return [];
      const path = pathFor(element);
      if (!path) return [];
      const id = `content:group:${hashText(path)}`;
      for (const child of children) if (!child.groupId) child.groupId = id;
      return [{
        id,
        kind: "group",
        path,
        groupId: "",
        articleBlockIds: [...new Set(children.flatMap((target) => target.articleBlockIds))],
        mediaIds: [...new Set(children.flatMap((target) => target.mediaIds))],
        sourceOrder: Math.min(...children.map((target) => target.sourceOrder))
      }];
    });
    return [...leaves.map(({ element, ...target }) => target), ...groups]
      .sort((left, right) => left.sourceOrder - right.sourceOrder || (left.kind === "group" ? 1 : -1))
      .slice(0, limit);
  }

  function collectTextBlocks(root, contentHtml, contentText) {
    let blockRoot = root;
    if (contentHtml) {
      try {
        const template = document.createElement("template");
        template.innerHTML = contentHtml;
        blockRoot = template.content || template;
      } catch {
      }
    }
    const selector = "h1,h2,h3,h4,h5,h6,p,li,blockquote,pre,figure,table";
    const containers = "li,blockquote,pre,figure,table";
    const blocks = [];
    for (const node of blockRoot?.querySelectorAll?.(selector) || []) {
      const parentContainer = node.parentElement?.closest?.(containers);
      if (parentContainer && parentContainer !== node) continue;
      const text = cleanBlockText(node.textContent);
      if (!text) continue;
      const tagName = cleanText(node.tagName).toLowerCase();
      blocks.push({
        id: "text:" + blocks.length + ":" + hashText(text),
        text,
        html: serializeBlockHtml(node),
        kind: /^h[1-6]$/u.test(tagName)
          ? "heading"
          : node.closest?.("nav,aside,header,footer,[role=navigation],[role=complementary],[role=contentinfo],[class*=comment],[class*=recommend],[data-testid*=comment],[data-testid*=recommend]")
            ? "noise"
            : tagName === "li" ? "list" : tagName === "blockquote" ? "quote" : tagName === "pre" ? "code" : tagName === "figure" ? "figure" : tagName === "table" ? "table" : "paragraph",
        sourceOrder: blocks.length
      });
    }
    if (blocks.length) return blocks;
    const text = cleanBlockText(contentText);
    return text ? [{ id: "text:0:" + hashText(text), text, html: String(contentHtml || "") }] : [];
  }

  function collectArticleDocument(root, contentHtml, textBlocks, knownMedia, limit) {
    let blockRoot = root;
    if (contentHtml) {
      try {
        const template = document.createElement("template");
        template.innerHTML = contentHtml;
        blockRoot = template.content || template;
      } catch {
      }
    }
    const media = [];
    const blocks = [];
    const textByValue = new Map();
    for (const block of textBlocks || []) {
      const key = cleanBlockText(block.text);
      if (key && !textByValue.has(key)) textByValue.set(key, block);
    }
    const selector = "h1,h2,h3,h4,h5,h6,p,ul,ol,blockquote,pre,table,figcaption,img,video,iframe,a[href]";
    const structuralContainers = "p,ul,ol,blockquote,pre,table,figcaption";
    const elements = [...(blockRoot?.querySelectorAll?.(selector) || [])];
    for (const element of elements) {
      if (element.closest?.("nav,aside,header,footer,[role=navigation],[role=complementary],[role=contentinfo],[class*=comment],[class*=recommend],[data-testid*=comment],[data-testid*=recommend]")) continue;
      const tagName = cleanText(element.tagName).toLowerCase();
      if (element.matches?.("a[href]")) {
        const sourceUrl = safeHttpUrl(element.href || element.getAttribute?.("href"));
        if (!sourceUrl) continue;
        const label = cleanText(element.textContent || element.getAttribute?.("download")) || filenameFromUrl(sourceUrl);
        const attachment = attachmentDescriptor(element, sourceUrl, label);
        if (attachment) {
          if (attachment.mimeType) {
            media.push(attachment);
            blocks.push({ id: `article:document:${hashText(sourceUrl)}`, kind: "document", assetId: attachment.id, sourceUrl, label, mimeType: attachment.mimeType, sourceOrder: blocks.length });
          } else {
            blocks.push({ id: `article:link:${hashText(sourceUrl)}`, kind: "link", sourceUrl, label, sourceOrder: blocks.length });
          }
        } else if (isVideoUrl(sourceUrl)) {
          const video = { id: `article:video:${hashText(sourceUrl)}`, kind: "video", url: sourceUrl, posterUrl: "", alt: label, captureMethod: "source" };
          media.push(video);
          blocks.push({ id: `article:video-link:${hashText(sourceUrl)}`, kind: "video", assetId: video.id, sourceUrl, label, sourceOrder: blocks.length });
        }
        continue;
      }
      if (element.matches?.("img")) {
        if (blockRoot === root && root.isConnected !== false && isExcludedMedia(element)) continue;
        if (playerForCompanionPoster(element, blockRoot)) continue;
        const variants = collectImageVariants(element);
        const sourceUrl = variants[0]?.url || safeHttpUrl(element.currentSrc || element.src);
        const existing = findKnownMedia(knownMedia, sourceUrl, variants, "image");
        const item = existing || (sourceUrl ? {
          id: `article:image:${hashText(sourceUrl)}`,
          kind: "image",
          url: sourceUrl,
          posterUrl: "",
          alt: cleanText(element.alt),
          width: Number(element.naturalWidth || element.width) || 0,
          height: Number(element.naturalHeight || element.height) || 0,
          captureMethod: "source",
          sourceKind: variants[0]?.sourceKind || "source",
          variants
        } : null);
        if (!item) continue;
        if (!existing) media.push(item);
        blocks.push({ id: `article:image-block:${hashText(item.id)}`, kind: "image", assetId: item.id, sourceUrl: item.url, label: cleanText(item.alt), sourceOrder: blocks.length });
        continue;
      }
      if (element.matches?.("video,iframe")) {
        if (element.matches?.("iframe") && !isSupportedVideoFrame(element)) continue;
        const sourceUrl = safeHttpUrl(element.currentSrc || element.src);
        const posterElement = companionPosterForPlayer(element, blockRoot);
        const posterUrl = safeHttpUrl(element.poster || "") || (posterElement ? collectImageVariants(posterElement)[0]?.url : "") || "";
        const existing = findKnownMedia(knownMedia, sourceUrl || posterUrl, [], "video");
        const item = existing || (sourceUrl || posterUrl ? {
          id: `article:video:${hashText(sourceUrl || posterUrl)}`,
          kind: "video",
          url: sourceUrl,
          posterUrl,
          alt: cleanText(element.getAttribute?.("aria-label")),
          captureMethod: "source"
        } : null);
        if (!item) continue;
        if (!existing) media.push(item);
        blocks.push({ id: `article:video-block:${hashText(item.id)}`, kind: "video", assetId: item.id, sourceUrl: item.url, posterUrl: item.posterUrl, label: cleanText(item.alt), sourceOrder: blocks.length });
        continue;
      }
      const parentContainer = element.parentElement?.closest?.(structuralContainers);
      if (parentContainer && parentContainer !== element) continue;
      const text = cleanBlockText(element.textContent);
      if (!text) continue;
      const known = textByValue.get(text);
      const kind = /^h[1-6]$/u.test(tagName)
        ? "heading"
        : ["ul", "ol"].includes(tagName) ? "list"
          : tagName === "blockquote" ? "quote"
            : tagName === "pre" ? "code"
              : tagName === "table" ? "table" : "paragraph";
      blocks.push({
        id: known?.id || `article:text:${blocks.length}:${hashText(text)}`,
        kind,
        text,
        ...(kind === "heading" ? { level: Number(tagName.slice(1)) || 2 } : {}),
        ...(kind === "list" ? { ordered: tagName === "ol" } : {}),
        sourceOrder: blocks.length
      });
    }
    if (!blocks.length) {
      for (const block of textBlocks || []) {
        blocks.push({ id: block.id, kind: articleTextKind(block.kind), text: block.text, sourceOrder: blocks.length });
      }
    }
    return { blocks, media: media.slice(0, Math.max(0, limit - knownMedia.length)) };
  }

  function articleTextKind(value) {
    return ["heading", "paragraph", "list", "quote", "code", "table"].includes(value) ? value : "paragraph";
  }

  function findKnownMedia(values, sourceUrl, variants, kind) {
    const urls = new Set([sourceUrl, ...(variants || []).map((item) => item.url)].filter(Boolean));
    return (values || []).find((item) => item.kind === kind && [item.url, item.posterUrl, ...(item.variants || []).map((variant) => variant.url)].some((url) => urls.has(url))) || null;
  }

  function attachmentDescriptor(element, sourceUrl, label) {
    const declaredType = cleanText(element.type || element.getAttribute?.("type")).toLocaleLowerCase("en-US").split(";", 1)[0];
    const extension = fileExtension(sourceUrl);
    const mimeByExtension = {
      pdf: "application/pdf",
      md: "text/markdown",
      markdown: "text/markdown",
      txt: "text/plain",
      html: "text/html",
      htm: "text/html",
      rtf: "application/rtf"
    };
    const mimeType = mimeByExtension[extension] || (/[\w.+-]+\/[\w.+-]+/u.test(declaredType) ? declaredType : "");
    const explicitlyDownloadable = element.hasAttribute?.("download") || /\bdownload\b/iu.test(`${element.rel || ""} ${element.className || ""} ${element.getAttribute?.("aria-label") || ""}`);
    if (!mimeType && !explicitlyDownloadable) return null;
    return {
      id: `article:document:${hashText(sourceUrl)}`,
      kind: "document",
      url: sourceUrl,
      filename: cleanText(element.getAttribute?.("download")) || label || filenameFromUrl(sourceUrl),
      mimeType,
      alt: label,
      captureMethod: "source"
    };
  }

  function fileExtension(value) {
    try {
      const name = new URL(value).pathname.split("/").filter(Boolean).at(-1) || "";
      return cleanText(name.split(".").at(-1)).toLocaleLowerCase("en-US");
    } catch {
      return "";
    }
  }

  function filenameFromUrl(value) {
    try { return decodeURIComponent(new URL(value).pathname.split("/").filter(Boolean).at(-1) || ""); }
    catch { return ""; }
  }

  function isVideoUrl(value) {
    try {
      const url = new URL(value);
      return /\.(?:mp4|webm|mov)(?:$|[?#])/iu.test(url.pathname) || ["youtube.com", "youtu.be", "vimeo.com", "bilibili.com", "douyin.com", "x.com"].some((host) => url.hostname === host || url.hostname.endsWith(`.${host}`));
    } catch {
      return false;
    }
  }

  function structuredAuthorName(value) {
    const authors = Array.isArray(value) ? value : value ? [value] : [];
    return authors.map((author) => cleanText(typeof author === "string" ? author : author?.name)).filter(Boolean).join("、");
  }

  function structuredEngagement(value) {
    const statistics = Array.isArray(value) ? value : value ? [value] : [];
    const engagement = {};
    for (const statistic of statistics) {
      const type = cleanText(statistic?.interactionType?.["@type"] || statistic?.interactionType).toLocaleLowerCase("en-US");
      const amount = Number(statistic?.userInteractionCount);
      if (!Number.isFinite(amount) || amount < 0) continue;
      if (type.includes("like")) engagement.likes = amount;
      else if (type.includes("share")) engagement.shares = amount;
      else if (type.includes("view") || type.includes("watch")) engagement.views = amount;
    }
    return engagement;
  }

  function collectStructuredMedia(value) {
    const images = [];
    const addImage = (candidate) => {
      const item = typeof candidate === "string" ? { url: candidate } : candidate || {};
      const url = safeHttpUrl(item.contentUrl || item.url || item["@id"]);
      if (!url) return;
      const width = Number(item.width?.value || item.width) || 0;
      const height = Number(item.height?.value || item.height) || 0;
      images.push({
        id: `structured:${hashText(url)}`,
        kind: "image",
        url,
        width,
        height,
        sourceKind: "structured",
        captureMethod: "source",
        variants: [{ url, width, height, sourceKind: "structured" }]
      });
    };
    for (const image of Array.isArray(value?.image) ? value.image : value?.image ? [value.image] : []) addImage(image);
    if (!images.length && value?.thumbnailUrl) addImage(value.thumbnailUrl);
    return images;
  }

  function serializeBlockHtml(node) {
    try {
      const clone = node.cloneNode(true);
      const elements = [clone, ...(clone.querySelectorAll?.("[href],[src],[poster]") || [])];
      for (const element of elements) {
        for (const attribute of ["href", "src", "poster"]) {
          if (!element.hasAttribute?.(attribute)) continue;
          const absoluteUrl = safeHttpUrl(element.getAttribute(attribute));
          if (absoluteUrl) element.setAttribute(attribute, absoluteUrl);
        }
      }
      return String(clone.outerHTML || "");
    } catch {
      return String(node.outerHTML || "");
    }
  }

  function collectAdapterFields(root, adapter) {
    const fields = adapter?.fields && typeof adapter.fields === "object" ? adapter.fields : {};
    const firstText = (selectors) => {
      for (const selector of Array.isArray(selectors) ? selectors : []) {
        try {
          const node = root.querySelector(selector);
          const value = cleanText(node?.getAttribute?.("datetime") || node?.textContent);
          if (value) return value;
        } catch {
        }
      }
      return "";
    };
    const numeric = (name) => {
      const text = firstText(fields[name]);
      const match = text.replace(/,/g, "").match(/\d+(?:\.\d+)?/);
      return match ? Number(match[0]) : null;
    };
    const firstUrl = (selectors) => {
      for (const selector of Array.isArray(selectors) ? selectors : []) {
        try {
          const node = root.querySelector(selector);
          const value = safeHttpUrl(node?.href || node?.getAttribute?.("href"));
          if (value) return value;
        } catch {
        }
      }
      return "";
    };
    const handleFromLink = (selectors) => {
      const value = firstUrl(selectors);
      if (!value) return "";
      try { return cleanText(new URL(value).pathname.split("/").filter(Boolean)[0]).replace(/^@/u, ""); }
      catch { return ""; }
    };
    const engagement = Object.fromEntries(["likes", "reposts", "views"].flatMap((name) => {
      const value = numeric(name);
      return Number.isFinite(value) ? [[name, value]] : [];
    }));
    return {
      title: firstText(fields.title),
      author: firstText(fields.author),
      handle: handleFromLink(fields.handle),
      canonicalUrl: firstUrl(fields.canonicalUrl),
      model: firstText(fields.model),
      publishedAt: firstText(fields.publishedAt),
      engagement
    };
  }

  function collectMedia(root, limit) {
    const media = [];
    for (const [elementIndex, element] of [...root.querySelectorAll("img,video,iframe,canvas")].entries()) {
      if (isExcludedMedia(element)) continue;
      if (element.matches?.("img") && playerForCompanionPoster(element, root)) continue;
      if (element instanceof HTMLCanvasElement) {
        try {
          const dataUrl = element.toDataURL("image/webp", 0.92);
          if (dataUrl.length <= maxInlinePixelDataCharacters) {
            media.push({ id: `canvas:${elementIndex}:${element.width}x${element.height}`, kind: "image", url: "", dataUrl, posterUrl: "", alt: cleanText(element.getAttribute("aria-label")), width: element.width, height: element.height, captureMethod: "pixel-fallback" });
          }
        } catch {
        }
        if (media.length >= limit) break;
        continue;
      }
      if (element.matches("iframe") && !isSupportedVideoFrame(element)) continue;
      const kind = element.matches("video,iframe") ? "video" : "image";
      const variants = kind === "image" ? collectImageVariants(element) : [];
      const imageSource = variants[0] || null;
      const url = imageSource?.url || safeHttpUrl(element.currentSrc || element.src);
      const posterElement = kind === "video" ? companionPosterForPlayer(element, root) : null;
      const posterUrl = kind === "video" ? safeHttpUrl(element.poster || "") || (posterElement ? collectImageVariants(posterElement)[0]?.url : "") || "" : "";
      const pixelFallback = kind === "image" ? visibleImagePixels(element) : "";
      if (!url && !posterUrl && !pixelFallback) continue;
      const rect = element.getBoundingClientRect();
      const fallbackRect = kind === "image" && rect.width >= 48 && rect.height >= 48 && rect.bottom >= 0 && rect.top <= (Number(window.innerHeight) || 720)
        ? { rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height }, viewportWidth: Number(window.innerWidth) || document.documentElement.clientWidth, viewportHeight: Number(window.innerHeight) || document.documentElement.clientHeight }
        : null;
      const responsiveCandidate = Boolean(imageSource?.declaredWidth || imageSource?.density > 1);
      media.push({
        id: `${kind}:${elementIndex}:${hashText(cleanText(element.alt || element.getAttribute?.("aria-label")))}`,
        kind,
        url,
        posterUrl,
        alt: cleanText(element.alt),
        width: imageSource?.declaredWidth || (responsiveCandidate ? 0 : Number(element.naturalWidth || element.videoWidth || element.width) || 0),
        height: responsiveCandidate ? 0 : Number(element.naturalHeight || element.videoHeight || element.height) || 0,
        captureMethod: "source",
        sourceKind: imageSource?.sourceKind || "current",
        declaredWidth: imageSource?.declaredWidth || 0,
        density: imageSource?.density || 0,
        variants,
        ...(fallbackRect ? { fallbackRect } : {}),
        ...(pixelFallback ? { dataUrl: pixelFallback, previewDataUrl: pixelFallback } : {})
      });
      if (media.length >= limit) break;
    }
    if (media.length < limit) {
      for (const element of root.querySelectorAll("*")) {
        if (isExcludedMedia(element)) continue;
        const match = getComputedStyle(element).backgroundImage.match(/url\(["']?([^"')]+)["']?\)/i);
        const url = safeHttpUrl(match?.[1]);
        const rect = element.getBoundingClientRect();
        if (!url || sameUrl(url, location.href) || rect.width < 48 || rect.height < 48) continue;
        media.push({ id: `background:${hashText(url)}`, kind: "image", url, posterUrl: "", alt: "", width: element.clientWidth, height: element.clientHeight, captureMethod: "css-background", sourceKind: "css-background", variants: [{ url, sourceKind: "css-background", width: element.clientWidth, height: element.clientHeight }] });
        if (media.length >= limit) break;
      }
    }
    const seen = new Set();
    return media.filter((item) => {
      const key = item.url || item.posterUrl || item.dataUrl;
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  function companionPosterForPlayer(player, root) {
    if (!player?.matches?.("video,iframe")) return null;
    const figure = player.closest?.("figure,[role=group]");
    const container = figure && root.contains?.(figure) ? figure : player.parentElement;
    if (!container || !root.contains?.(container)) return null;
    const players = [...container.querySelectorAll?.("video,iframe") || []].filter((item) => item.matches?.("video") || isSupportedVideoFrame(item));
    const images = [...container.querySelectorAll?.("img") || []].filter((image) => {
      const link = image.closest?.("a[href]");
      const linkedUrl = safeHttpUrl(link?.href || link?.getAttribute?.("href"));
      return !linkedUrl || !/\.(?:avif|gif|jpe?g|png|webp)(?:$|[?#])/iu.test(linkedUrl);
    });
    return players.length === 1 && images.length === 1 ? images[0] : null;
  }

  function playerForCompanionPoster(image, root) {
    if (!image?.matches?.("img")) return null;
    const figure = image.closest?.("figure,[role=group]");
    const container = figure && root.contains?.(figure) ? figure : image.parentElement;
    if (!container || !root.contains?.(container)) return null;
    const player = [...container.querySelectorAll?.("video,iframe") || []]
      .find((item) => item.matches?.("video") || isSupportedVideoFrame(item));
    return player && companionPosterForPlayer(player, root) === image ? player : null;
  }

  function collectImageVariants(image) {
    const pictureCandidates = [];
    const imageCandidates = [];
    const addSrcset = (value, sourceKind, target) => {
      for (const candidate of parseSrcset(value)) {
        const url = safeHttpUrl(candidate.url);
        if (url) target.push({ ...candidate, url, sourceKind });
      }
    };
    const picture = image.closest?.("picture");
    for (const source of picture?.querySelectorAll?.("source[srcset],source[data-srcset]") || []) {
      const media = cleanText(source.getAttribute("media"));
      if (media && typeof window.matchMedia === "function" && !window.matchMedia(media).matches) continue;
      addSrcset(source.getAttribute("srcset") || source.getAttribute("data-srcset"), "picture-srcset", pictureCandidates);
      if (pictureCandidates.length) break;
    }
    addSrcset(image.getAttribute?.("srcset") || image.srcset, "img-srcset", imageCandidates);
    addSrcset(image.getAttribute?.("data-srcset") || image.getAttribute?.("data-lazy-srcset"), "deferred-srcset", imageCandidates);
    const candidates = [];
    for (const attribute of [
      "data-full-image", "data-full", "data-full-size", "data-hi-res", "data-high-res", "data-hires",
      "data-zoom-image", "data-large-image", "data-large", "data-src-large", "data-image-url", "data-pin-media",
      "data-orig-file", "data-original", "data-original-src", "data-src-original"
    ]) {
      const originalUrl = safeHttpUrl(image.getAttribute?.(attribute));
      if (originalUrl) candidates.push({ url: originalUrl, sourceKind: "site-original", declaredWidth: urlWidthHint(originalUrl), density: 0 });
    }
    const imageLink = image.closest?.("a[href]");
    const linkedUrl = safeHttpUrl(imageLink?.href || imageLink?.getAttribute?.("href"));
    if (linkedUrl && (imageLink?.hasAttribute?.("download") || /\.(?:avif|gif|jpe?g|png|webp)(?:$|[?#])/iu.test(linkedUrl))) {
      candidates.push({ url: linkedUrl, sourceKind: "site-original", declaredWidth: 0, density: 0 });
    }
    candidates.push(...pictureCandidates, ...imageCandidates);
    for (const attribute of ["data-lazy-src", "data-src"]) {
      const deferredUrl = safeHttpUrl(image.getAttribute?.(attribute));
      if (deferredUrl) candidates.push({ url: deferredUrl, sourceKind: "deferred-src", declaredWidth: 0, density: 0 });
    }
    const currentUrl = safeHttpUrl(image.currentSrc);
    if (currentUrl) candidates.push({ url: currentUrl, sourceKind: "current", declaredWidth: 0, density: 0 });
    const sourceUrl = safeHttpUrl(image.src);
    if (sourceUrl) candidates.push({ url: sourceUrl, sourceKind: "source", declaredWidth: 0, density: 0 });
    const seen = new Set();
    return candidates.filter((candidate) => candidate.url && !seen.has(candidate.url) && seen.add(candidate.url))
      .sort((left, right) => imageVariantScore(right) - imageVariantScore(left));
  }

  function urlWidthHint(value) {
    try {
      const url = new URL(value);
      for (const key of ["width", "w", "resize", "size"]) {
        const match = String(url.searchParams.get(key) || "").match(/\d{2,6}/u);
        const width = Number(match?.[0]);
        if (Number.isSafeInteger(width) && width > 0) return width;
      }
    } catch {
    }
    return 0;
  }

  function visibleImagePixels(image) {
    try {
      if (!image.complete || !image.naturalWidth || !image.naturalHeight) return "";
      const rect = image.getBoundingClientRect();
      if (rect.width < 48 || rect.height < 48 || rect.bottom < 0 || rect.top > (Number(window.innerHeight) || 720)) return "";
      const pixelBudget = Math.max(1, Math.floor(maxInlinePixelDataCharacters * 0.72 / 4));
      const requestedScale = Math.max(1, Number(window.devicePixelRatio) || 1);
      const scale = Math.min(requestedScale, Math.sqrt(pixelBudget / Math.max(1, rect.width * rect.height)));
      const width = Math.max(1, Math.round(rect.width * scale));
      const height = Math.max(1, Math.round(rect.height * scale));
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      canvas.getContext("2d", { alpha: false })?.drawImage(image, 0, 0, width, height);
      const dataUrl = canvas.toDataURL("image/webp", 0.92);
      return dataUrl.length <= maxInlinePixelDataCharacters ? dataUrl : "";
    } catch {
      return "";
    }
  }

  function imageVariantScore(value) {
    const sourcePriority = {
      "site-original": 600,
      "picture-srcset": 500,
      structured: 550,
      "deferred-srcset": 450,
      "deferred-src": 400,
      "img-srcset": 350,
      current: 200,
      source: 100
    }[value?.sourceKind] || 0;
    return sourcePriority + Math.min(100000, Number(value?.declaredWidth || 0)) + Math.min(100, Number(value?.density || 0) * 10);
  }

  function isSupportedVideoFrame(element) {
    const url = safeHttpUrl(element.src);
    if (!url) return false;
    try {
      const host = new URL(url).hostname.toLocaleLowerCase("en-US");
      return ["youtube.com", "youtube-nocookie.com", "youtu.be", "player.vimeo.com", "player.bilibili.com", "douyin.com", "open.douyin.com", "platform.twitter.com"].some((suffix) => host === suffix || host.endsWith(`.${suffix}`));
    } catch {
      return false;
    }
  }

  function mergeCollectedMedia(values, limit) {
    const seenIds = new Set();
    const seenUrls = new Set();
    return values.flatMap((item, index) => {
      if (!item || typeof item !== "object") return [];
      const variants = (Array.isArray(item.variants) ? item.variants : []).filter((variant) => safeHttpUrl(variant?.url));
      const primaryUrl = safeHttpUrl(item.url) || variants[0]?.url || "";
      const itemKind = ["video", "document"].includes(item.kind) ? item.kind : "image";
      const id = cleanText(item.id) || `${itemKind}:${index}:${hashText(primaryUrl || item.dataUrl)}`;
      if (seenIds.has(id) || primaryUrl && seenUrls.has(primaryUrl)) return [];
      seenIds.add(id);
      if (primaryUrl) seenUrls.add(primaryUrl);
      return [{ ...item, id, kind: itemKind, url: primaryUrl, variants }];
    }).slice(0, limit);
  }

  function parseSrcset(value) {
    const input = String(value || "");
    const candidates = [];
    let position = 0;
    while (position < input.length) {
      while (position < input.length && (input[position] === "," || /\s/.test(input[position]))) position += 1;
      if (position >= input.length) break;
      const urlStart = position;
      while (position < input.length && !/\s/.test(input[position])) position += 1;
      let url = input.slice(urlStart, position);
      const descriptors = [];
      if (url.endsWith(",")) {
        url = url.replace(/,+$/, "");
      } else {
        while (position < input.length) {
          while (position < input.length && /\s/.test(input[position])) position += 1;
          if (input[position] === ",") {
            position += 1;
            break;
          }
          const descriptorStart = position;
          while (position < input.length && input[position] !== "," && !/\s/.test(input[position])) position += 1;
          if (position > descriptorStart) descriptors.push(input.slice(descriptorStart, position));
        }
      }
      const widthDescriptor = descriptors.find((item) => /^\d+w$/.test(item));
      const densityDescriptor = descriptors.find((item) => /^(?:\d+|\d*\.\d+)x$/.test(item));
      candidates.push({
        url,
        declaredWidth: widthDescriptor ? Number.parseInt(widthDescriptor, 10) : 0,
        density: densityDescriptor ? Number.parseFloat(densityDescriptor) : descriptors.length ? 0 : 1
      });
    }
    return candidates;
  }

  function isExcludedMedia(element) {
    if (element.closest("nav,aside,header,[role=banner],[aria-label*=广告],[aria-label*=advertisement]")) return true;
    const rect = element.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0 || rect.width < 48 || rect.height < 48) return true;
    const style = typeof globalThis.getComputedStyle === "function" ? globalThis.getComputedStyle(element) : null;
    if (style?.display === "none" || style?.visibility === "hidden" || Number(style?.opacity) === 0) return true;
    const description = `${element.alt || ""} ${element.className || ""} ${element.id || ""} ${element.getAttribute?.("aria-label") || ""}`.toLowerCase();
    return /avatar|emoji|icon|logo|badge|advert|qr[-_ ]?code|二维码/.test(description);
  }

  function isContentRoot(root) {
    if (!(root instanceof HTMLElement) || root.closest("nav,aside,header,[role=banner]")) return false;
    return cleanText(root.innerText).length > 20 || root.querySelector("img,video,iframe,canvas");
  }

  function sameUrl(value, expected) {
    return safeHttpUrl(typeof value === "object" ? value?.["@id"] : value) === expected;
  }

  function itemIdFromUrl(value) {
    try {
      const parts = new URL(value).pathname.split("/").filter(Boolean);
      return cleanText(parts.at(-1));
    } catch {
      return "";
    }
  }

  function safeHttpUrl(value) {
    try {
      const input = String(value || "").trim();
      if (!input) return "";
      const url = new URL(input, document.baseURI);
      return ["http:", "https:"].includes(url.protocol) ? url.href : "";
    } catch {
      return "";
    }
  }

  function cleanText(value) {
    return String(value ?? "").replace(/\s+/g, " ").trim();
  }

  function cleanBlockText(value) {
    return String(value ?? "")
      .replace(/\r\n?/g, "\n")
      .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, " ")
      .replace(/[\t ]+/g, " ")
      .replace(/ *\n */g, "\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
  }

  function hashText(value) {
    let hash = 2166136261;
    for (const character of String(value)) hash = Math.imul(hash ^ character.charCodeAt(0), 16777619);
    return (hash >>> 0).toString(36);
  }

  function positiveInteger(value, fallback) {
    const number = Math.trunc(Number(value));
    return Number.isSafeInteger(number) && number > 0 ? number : fallback;
  }
}

function uniqueCandidates(values) {
  const seen = new Set();
  return (Array.isArray(values) ? values : []).flatMap((value) => {
    const candidate = normalizePageCaptureCandidate(value);
    const key = candidate ? `${candidate.canonicalUrl}\n${candidate.sourceFacts.itemId}\n${candidate.title}\n${candidate.region?.id || ""}` : "";
    if (!candidate || seen.has(key)) return [];
    seen.add(key);
    return [candidate];
  });
}

function uniqueMedia(values) {
  const items = [];
  const indexById = new Map();
  const indexByIdentity = new Map();
  for (const value of Array.isArray(values) ? values : []) {
    const variants = normalizeMediaVariants(value);
    const url = variants[0]?.url || safeUrl(value?.url);
    const posterUrl = safeUrl(value?.posterUrl);
    const dataUrl = safeImageDataUrl(value?.dataUrl);
    const previewDataUrl = safeImageDataUrl(value?.previewDataUrl);
    const id = clean(value?.id) || stableCandidateId(url || posterUrl || dataUrl || previewDataUrl, value?.kind);
    const keyUrl = url || posterUrl;
    const kind = ["video", "document"].includes(value?.kind) ? value.kind : "image";
    if (!keyUrl && !dataUrl && !previewDataUrl) continue;
    const item = {
      id,
      kind,
      placement: value?.placement === "inline" ? "inline" : "unplaced",
      url,
      posterUrl,
      ...(dataUrl ? { dataUrl } : {}),
      ...(previewDataUrl ? { previewDataUrl } : {}),
      ...(normalizeFallbackRect(value?.fallbackRect) ? { fallbackRect: normalizeFallbackRect(value.fallbackRect) } : {}),
      variants,
      alt: clean(value.alt),
      filename: clean(value.filename),
      mimeType: clean(value.mimeType).toLocaleLowerCase("en-US"),
      sourceTitle: clean(value.sourceTitle),
      sourceAuthor: clean(value.sourceAuthor),
      originalWorkUrl: safeUrl(value.originalWorkUrl),
      width: positiveInteger(variants[0]?.width || value.width, 0),
      height: positiveInteger(variants[0]?.height || value.height, 0),
      sourceKind: variants[0]?.sourceKind || normalizeMediaSourceKind(value.sourceKind),
      declaredWidth: positiveInteger(variants[0]?.declaredWidth || value.declaredWidth, 0),
      density: positiveNumber(variants[0]?.density || value.density, 0),
      captureMethod: ["source", "css-background", "page-session", "pixel-fallback"].includes(value.captureMethod) ? value.captureMethod : "source"
    };
    const identity = kind === "image" ? pageCaptureMediaIdentity(url) : keyUrl;
    const existingIndex = indexById.get(id) ?? (identity ? indexByIdentity.get(identity) : undefined);
    if (existingIndex !== undefined) {
      const existing = items[existingIndex];
      const mergedVariants = normalizeMediaVariants({ variants: [...existing.variants, ...item.variants] });
      items[existingIndex] = {
        ...existing,
        url: mergedVariants[0]?.url || existing.url,
        variants: mergedVariants,
        width: positiveInteger(mergedVariants[0]?.width || existing.width || item.width, 0),
        height: positiveInteger(mergedVariants[0]?.height || existing.height || item.height, 0),
        sourceKind: mergedVariants[0]?.sourceKind || existing.sourceKind,
        declaredWidth: positiveInteger(mergedVariants[0]?.declaredWidth || existing.declaredWidth || item.declaredWidth, 0),
        density: positiveNumber(mergedVariants[0]?.density || existing.density || item.density, 0),
        dataUrl: existing.dataUrl || item.dataUrl,
        previewDataUrl: existing.previewDataUrl || item.previewDataUrl,
        fallbackRect: existing.fallbackRect || item.fallbackRect,
        alt: existing.alt || item.alt,
        placement: existing.placement === "inline" || item.placement === "inline" ? "inline" : "unplaced"
      };
      indexById.set(id, existingIndex);
      continue;
    }
    const index = items.push(item) - 1;
    indexById.set(id, index);
    if (identity) indexByIdentity.set(identity, index);
  }
  return items;
}

function pageCaptureMediaIdentity(value) {
  try {
    const url = new URL(value);
    for (const key of [...url.searchParams.keys()]) {
      if (/^(?:w|width|h|height|q|quality|resize|size|dpr|format)$/iu.test(key)) url.searchParams.delete(key);
    }
    url.hash = "";
    return url.href;
  } catch {
    return "";
  }
}

function normalizeFallbackRect(value) {
  const rect = value?.rect;
  const numbers = [rect?.x, rect?.y, rect?.width, rect?.height, value?.viewportWidth, value?.viewportHeight].map(Number);
  if (!numbers.every(Number.isFinite) || numbers[2] <= 0 || numbers[3] <= 0 || numbers[4] <= 0 || numbers[5] <= 0) return null;
  return {
    rect: { x: numbers[0], y: numbers[1], width: numbers[2], height: numbers[3] },
    viewportWidth: numbers[4],
    viewportHeight: numbers[5]
  };
}

function normalizeMediaVariants(value = {}) {
  const seen = new Set();
  const variants = [...(Array.isArray(value.variants) ? value.variants : []), {
    url: value.url,
    sourceKind: value.sourceKind,
    width: value.width,
    height: value.height,
    declaredWidth: value.declaredWidth,
    density: value.density
  }].flatMap((variant, index) => {
    const url = safeUrl(variant?.url);
    if (!url || seen.has(url)) return [];
    seen.add(url);
    return [{
      url,
      sourceKind: normalizeMediaSourceKind(variant?.sourceKind),
      width: positiveInteger(variant?.width, 0),
      height: positiveInteger(variant?.height, 0),
      declaredWidth: positiveInteger(variant?.declaredWidth, 0),
      density: positiveNumber(variant?.density, 0),
      order: index
    }];
  });
  return variants.sort((left, right) => mediaVariantScore(right) - mediaVariantScore(left) || left.order - right.order)
    .map(({ order, ...variant }) => variant);
}

function normalizeMediaSourceKind(value) {
  const sourceKind = clean(value);
  return ["site-original", "structured", "picture-srcset", "deferred-srcset", "deferred-src", "img-srcset", "css-background", "current", "source"].includes(sourceKind)
    ? sourceKind
    : "source";
}

function mediaVariantScore(value) {
  const sourcePriority = {
    "site-original": 600000,
    structured: 550000,
    "picture-srcset": 500000,
    "deferred-srcset": 450000,
    "deferred-src": 400000,
    "img-srcset": 350000,
    "css-background": 250000,
    current: 200000,
    source: 100000
  }[value?.sourceKind] || 0;
  const width = positiveInteger(value?.width || value?.declaredWidth, 0);
  return sourcePriority + Math.min(width, 99999) + Math.min(99, positiveNumber(value?.density, 0) * 10);
}

function safeImageDataUrl(value) {
  const dataUrl = String(value ?? "");
  return /^data:image\/(?:png|jpeg|webp);base64,[a-z0-9+/=]+$/iu.test(dataUrl) ? dataUrl : "";
}

function stableCandidateId(url, title) {
  let hash = 2166136261;
  for (const character of `${url}\n${title}`) hash = Math.imul(hash ^ character.charCodeAt(0), 16777619);
  return `page:${(hash >>> 0).toString(36)}`;
}

function hostname(value) {
  try { return new URL(value).hostname.replace(/^www\./, ""); } catch { return ""; }
}

function safeUrl(value) {
  try {
    const url = new URL(clean(value));
    return ["http:", "https:"].includes(url.protocol) ? url.href : "";
  } catch { return ""; }
}

function validIso(value) {
  const text = clean(value);
  return text && Number.isFinite(Date.parse(text)) ? new Date(text).toISOString() : "";
}

function positiveInteger(value, fallback = 0) {
  const number = Math.trunc(Number(value));
  return Number.isSafeInteger(number) && number > 0 ? number : fallback;
}

function positiveNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : fallback;
}

function normalizeText(value) {
  return String(value ?? "").replace(/\r\n?/g, "\n").replace(/[\t ]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}

function clean(value) {
  return String(value ?? "").replace(/[\u0000-\u001f\u007f]/g, " ").trim();
}
