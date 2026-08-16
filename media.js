import { normalizeArticleDocument, removeArticleDocumentAsset } from "./article-document.js";

const IMAGE_MIME_TYPES = new Set(["image/png", "image/jpeg", "image/webp", "image/gif", "image/avif"]);
const VIDEO_MIME_TYPES = new Set([
  "video/mp4", "video/webm", "video/quicktime", "video/x-matroska", "video/x-msvideo"
]);
const DOCUMENT_MIME_TYPES = new Set(["application/pdf", "text/html", "text/markdown", "text/plain", "application/rtf", "text/rtf", "application/x-rtf"]);
const MEDIA_KINDS = new Set(["image", "video", "document"]);
const STORAGE_MODES = new Set(["managed", "reference"]);
const MEDIA_USAGES = new Set(["content", "poster"]);
const PLAYBACK_MODES = new Set(["local", "embed", "source"]);
const OFFICIAL_EMBED_PROVIDERS = new Set(["youtube", "vimeo", "bilibili", "douyin", "x"]);
const PLAYBACK_CAPABILITIES = new Set(["native", "external", "unknown"]);

export const SUPPORTED_MEDIA_KINDS = Object.freeze([...MEDIA_KINDS]);

export function normalizeMediaAsset(value = {}) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const id = clean(value.id);
  if (!id) return null;
  const mimeType = clean(value.mimeType).toLocaleLowerCase("en-US");
  const kind = inferKind(value.kind, mimeType);
  if (!kind) return null;
  const sourceUrl = safeHttpUrl(value.sourceUrl);
  const reference = normalizeReference(value.reference, sourceUrl);
  const storageMode = kind === "video"
    ? STORAGE_MODES.has(value.storageMode)
      ? value.storageMode
      : reference.url && !value.assetPath && !value.screenshotPath
        ? "reference"
        : "managed"
    : "managed";
  const assetPath = safeAssetPath(value.assetPath || value.screenshotPath);
  const width = positiveInteger(value.width);
  const height = positiveInteger(value.height);
  const durationMs = positiveInteger(value.durationMs);
  const byteSize = positiveInteger(value.byteSize);
  const usage = MEDIA_USAGES.has(value.usage) ? value.usage : "content";
  const capturedAt = validIso(value.capturedAt) || new Date().toISOString();
  return {
    id,
    kind,
    usage,
    storageMode,
    sourceUrl,
    sourceTitle: clean(value.sourceTitle),
    sourceAuthor: clean(value.sourceAuthor),
    originalWorkUrl: safeHttpUrl(value.originalWorkUrl),
    capturedAt,
    ...(mimeTypeForKind(kind, mimeType) ? { mimeType } : {}),
    ...(width ? { width } : {}),
    ...(height ? { height } : {}),
    ...(durationMs ? { durationMs } : {}),
    ...(byteSize ? { byteSize } : {}),
    ...(/^[a-f0-9]{64}$/iu.test(clean(value.contentHash)) ? { contentHash: clean(value.contentHash).toLocaleLowerCase("en-US") } : {}),
    ...(["source", "css-background", "pixel-fallback"].includes(value.captureMethod) ? { captureMethod: value.captureMethod } : {}),
    playbackCapability: PLAYBACK_CAPABILITIES.has(value.playbackCapability)
      ? value.playbackCapability
      : storageMode === "reference" ? "external" : "unknown",
    ...(assetPath ? { assetPath } : {}),
    ...(clean(value.posterAssetId) ? { posterAssetId: clean(value.posterAssetId) } : {}),
    ...(kind === "document" ? { extractedTextFormat: normalizeExtractedTextFormat(value.extractedTextFormat, mimeType) } : {}),
    ...(usage === "poster" && clean(value.derivedFromAssetId) ? { derivedFromAssetId: clean(value.derivedFromAssetId) } : {}),
    ...(kind === "video" && storageMode === "reference" && reference.url ? { reference } : {}),
    ...(value.palette?.colors?.length ? { palette: structuredClone(value.palette) } : {}),
    ...(value.visionAnalysis?.description?.trim() ? { visionAnalysis: structuredClone(value.visionAnalysis) } : {}),
    reviewStatus: value.reviewStatus === "verified" ? "verified" : "unverified"
  };
}

export function normalizeEntryMedia(entryValue = {}) {
  const entry = structuredClone(entryValue);
  const mediaAssets = uniqueMediaAssets(
    Array.isArray(entry.mediaAssets) ? entry.mediaAssets : entry.visuals
  );
  const hasLegacyVisual = entry.hasScreenshot || entry.screenshotPath || entry.visionAnalysis ||
    entry.screenshotWidth || entry.screenshotHeight;
  if (!mediaAssets.length && hasLegacyVisual) {
    const migrated = normalizeMediaAsset({
      id: clean(entry.id),
      kind: "image",
      storageMode: "managed",
      sourceUrl: entry.url,
      sourceTitle: entry.title,
      capturedAt: entry.screenshotUpdatedAt || entry.savedAt,
      width: entry.screenshotWidth,
      height: entry.screenshotHeight,
      mimeType: entry.screenshotMimeType,
      byteSize: entry.screenshotByteSize,
      palette: entry.palette,
      visionAnalysis: entry.visionAnalysis,
      reviewStatus: entry.screenshotReviewStatus,
      assetPath: entry.screenshotPath
    });
    if (migrated) mediaAssets.push(migrated);
  }
  const ids = new Set(mediaAssets.map((item) => item.id));
  const contentAssets = mediaAssets.filter((item) => item.usage !== "poster");
  const requestedPrimary = clean(entry.primaryMediaId || entry.primaryVisualId);
  entry.mediaAssets = mediaAssets;
  entry.primaryMediaId = contentAssets.some((item) => item.id === requestedPrimary) ? requestedPrimary : contentAssets[0]?.id || "";
  const articleDocument = normalizeArticleDocument(entry.articleDocument);
  if (articleDocument) entry.articleDocument = articleDocument;
  else delete entry.articleDocument;
  entry.timeNotes = normalizeTimeNotes(entry.timeNotes, ids);
  entry.mediaPrompts = normalizeMediaPrompts(entry.mediaPrompts, ids);
  entry.visualSetAnalyses = normalizeVersionedAnalyses(entry.visualSetAnalyses, "visual-set");
  entry.videoAnalyses = normalizeVersionedAnalyses(entry.videoAnalyses, "video");
  for (const field of [
    "visuals", "primaryVisualId", "hasScreenshot", "screenshotWidth", "screenshotHeight",
    "screenshotMimeType", "screenshotByteSize", "screenshotReviewStatus", "screenshotUpdatedAt",
    "screenshotPath", "screenshotPreviousMetadata", "palette", "visionAnalysis"
  ]) delete entry[field];
  if (entry.primaryMediaId && Array.isArray(entry.facetAssignments)) {
    entry.facetAssignments = entry.facetAssignments.map((item) => item?.source === "vision_model" && !item.visualId
      ? { ...item, visualId: entry.primaryMediaId }
      : item);
  }
  return entry;
}

export function entryMediaAssets(entryValue = {}) {
  if (Array.isArray(entryValue?.mediaAssets)) {
    const assets = entryValue.mediaAssets;
    for (const asset of assets) {
      if (!asset || typeof asset !== "object" || Array.isArray(asset)) {
        return assets.filter((item) => item && typeof item === "object" && !Array.isArray(item));
      }
    }
    return assets;
  }
  return normalizeEntryMedia(entryValue).mediaAssets;
}

export function primaryMediaAsset(entryValue = {}) {
  const assets = entryMediaAssets(entryValue);
  return assets.find((item) => item.id === entryValue?.primaryMediaId && item.usage !== "poster") ??
    assets.find((item) => item.usage !== "poster") ?? null;
}

export function primaryImageAsset(entryValue = {}) {
  const assets = entryMediaAssets(entryValue);
  const primary = assets.find((item) => item.id === entryValue?.primaryMediaId && item.kind === "image" && item.usage !== "poster");
  return primary ?? assets.find((item) => item.kind === "image" && item.usage !== "poster") ?? null;
}

export function posterAssetForVideo(entryValue = {}, videoValue = {}) {
  const assets = entryMediaAssets(entryValue);
  const videoId = clean(videoValue.id);
  const requested = clean(videoValue.posterAssetId);
  return assets.find((item) => item.kind === "image" && item.usage === "poster" &&
    (item.id === requested || item.derivedFromAssetId === videoId)) ?? null;
}

export function entryHasMedia(entryValue = {}, kind = "") {
  const assets = entryMediaAssets(entryValue).filter((item) => item.usage !== "poster");
  return kind ? assets.some((item) => item.kind === kind) : assets.length > 0;
}

export function addEntryMedia(entryValue, assetValue, { makePrimary = false } = {}) {
  const entry = normalizeEntryMedia(entryValue);
  const asset = normalizeMediaAsset(assetValue);
  if (!asset) throw new Error("媒体缺少有效编号或类型");
  entry.mediaAssets = [...entry.mediaAssets.filter((item) => item.id !== asset.id), asset];
  if (asset.usage !== "poster" && (makePrimary || !entry.primaryMediaId)) entry.primaryMediaId = asset.id;
  return entry;
}

export function removeEntryMedia(entryValue, assetId) {
  const entry = normalizeEntryMedia(entryValue);
  const id = clean(assetId);
  const removedIds = new Set([id]);
  for (const item of entry.mediaAssets) {
    if (item.usage === "poster" && item.derivedFromAssetId === id) removedIds.add(item.id);
  }
  entry.mediaAssets = entry.mediaAssets.filter((item) => !removedIds.has(item.id));
  entry.mediaAssets = entry.mediaAssets.map((item) => {
    if (!removedIds.has(item.posterAssetId)) return item;
    const next = { ...item };
    delete next.posterAssetId;
    return next;
  });
  entry.timeNotes = entry.timeNotes.filter((item) => item.assetId !== id);
  entry.mediaPrompts = entry.mediaPrompts.filter((item) => !removedIds.has(item.assetId));
  entry.videoAnalyses = entry.videoAnalyses.filter((item) => !removedIds.has(item.assetId));
  for (const removedId of removedIds) entry.articleDocument = removeArticleDocumentAsset(entry.articleDocument, removedId);
  if (!entry.articleDocument) delete entry.articleDocument;
  if (entry.primaryMediaId === id) entry.primaryMediaId = entry.mediaAssets.find((item) => item.usage !== "poster")?.id || "";
  return entry;
}

export function reorderEntryMedia(entryValue, assetIds = []) {
  const entry = normalizeEntryMedia(entryValue);
  const byId = new Map(entry.mediaAssets.map((item) => [item.id, item]));
  const ordered = [];
  for (const id of assetIds.map(clean)) {
    const asset = byId.get(id);
    if (!asset) continue;
    ordered.push(asset);
    byId.delete(id);
  }
  entry.mediaAssets = [...ordered, ...byId.values()];
  return entry;
}

export function setPrimaryMedia(entryValue, assetId) {
  const entry = normalizeEntryMedia(entryValue);
  const id = clean(assetId);
  if (!entry.mediaAssets.some((item) => item.id === id && item.usage !== "poster")) throw new Error("没有找到这个媒体");
  entry.primaryMediaId = id;
  return entry;
}

export function updateEntryMedia(entryValue, assetId, updater) {
  const entry = normalizeEntryMedia(entryValue);
  const id = clean(assetId);
  const index = entry.mediaAssets.findIndex((item) => item.id === id);
  if (index < 0) throw new Error("没有找到这个媒体");
  const updated = normalizeMediaAsset(typeof updater === "function" ? updater(entry.mediaAssets[index]) : updater);
  if (!updated || updated.id !== id) throw new Error("媒体更新结果无效");
  entry.mediaAssets[index] = updated;
  return entry;
}

export function addTimeNote(entryValue, noteValue = {}) {
  const entry = normalizeEntryMedia(entryValue);
  const assetId = clean(noteValue.assetId);
  const asset = entry.mediaAssets.find((item) => item.id === assetId && item.kind === "video");
  if (!asset) throw new Error("时间点笔记必须关联当前案例中的视频");
  const note = normalizeTimeNote(
    { ...noteValue, id: clean(noteValue.id) || `note:${crypto.randomUUID()}` },
    new Set(entry.mediaAssets.map((item) => item.id))
  );
  if (!note) throw new Error("时间点笔记缺少有效内容");
  entry.timeNotes = [...entry.timeNotes.filter((item) => item.id !== note.id), note]
    .toSorted((left, right) => left.startMs - right.startMs || left.createdAt.localeCompare(right.createdAt));
  return entry;
}

export function removeTimeNote(entryValue, noteId) {
  const entry = normalizeEntryMedia(entryValue);
  const id = clean(noteId);
  entry.timeNotes = entry.timeNotes.filter((item) => item.id !== id);
  return entry;
}

export function setEntryMediaPrompt(entryValue, assetIdValue, textValue, source = "manual") {
  const entry = normalizeEntryMedia(entryValue);
  const assetId = clean(assetIdValue);
  const asset = entry.mediaAssets.find((item) => item.id === assetId && item.kind === "image" && item.usage !== "poster");
  if (!asset) throw new Error("没有找到这张内容图片");
  const text = cleanMultiline(textValue);
  entry.mediaPrompts = entry.mediaPrompts.filter((item) => item.assetId !== assetId);
  if (text) entry.mediaPrompts.push({
    assetId,
    text,
    textRevision: 1,
    source: source === "ai-suggestion" ? "ai-suggestion" : "manual",
    updatedAt: new Date().toISOString()
  });
  return entry;
}

export function mediaDescriptions(entryValue = {}) {
  return entryMediaAssets(entryValue)
    .map((asset) => asset.visionAnalysis?.invalidated ? "" : clean(asset.visionAnalysis?.description))
    .filter(Boolean);
}

export function mediaKindFromFile(file) {
  const mimeType = clean(file?.type).toLocaleLowerCase("en-US");
  const name = clean(file?.name).toLocaleLowerCase("en-US");
  if (mimeType.startsWith("image/") || /\.(?:avif|gif|png|jpe?g|webp)$/.test(name)) return "image";
  if (mimeType.startsWith("video/") || /\.(?:mp4|webm|mov|mkv|avi)$/.test(name)) return "video";
  if (DOCUMENT_MIME_TYPES.has(mimeType) || /\.(?:pdf|md|markdown|txt|html?|rtf)$/.test(name)) return "document";
  return "";
}

function normalizeTimeNotes(values, assetIds) {
  const seen = new Set();
  return (Array.isArray(values) ? values : []).flatMap((value) => {
    const note = normalizeTimeNote(value, assetIds);
    if (!note || seen.has(note.id)) return [];
    seen.add(note.id);
    return [note];
  }).toSorted((left, right) => left.startMs - right.startMs || left.createdAt.localeCompare(right.createdAt));
}

function normalizeMediaPrompts(values, assetIds) {
  const seen = new Set();
  return (Array.isArray(values) ? values : []).flatMap((value) => {
    const assetId = clean(value?.assetId);
    const text = cleanMultiline(value?.text);
    if (!assetIds.has(assetId) || !text || seen.has(assetId)) return [];
    seen.add(assetId);
    return [{
      assetId,
      text,
      textRevision: Math.max(1, Math.trunc(Number(value.textRevision) || 1)),
      source: value.source === "ai-suggestion" ? "ai-suggestion" : "manual",
      updatedAt: validIso(value.updatedAt) || new Date().toISOString()
    }];
  });
}

function normalizeVersionedAnalyses(values, kind) {
  return (Array.isArray(values) ? values : []).flatMap((value) => {
    const id = clean(value?.id);
    const text = cleanMultiline(value?.text);
    if (!id || !text) return [];
    return [{
      id,
      kind,
      text,
      assetId: clean(value.assetId),
      mode: clean(value.mode),
      prompt: cleanMultiline(value.prompt),
      sourceKind: clean(value.sourceKind),
      version: Math.max(1, positiveInteger(value.version)),
      batchIndex: nonNegativeInteger(value.batchIndex),
      batchCount: Math.max(1, positiveInteger(value.batchCount)),
      model: clean(value.model),
      provider: clean(value.provider),
      usage: structuredClone(value.usage || {}),
      cost: Number.isFinite(Number(value.cost)) && Number(value.cost) >= 0 ? Number(value.cost) : null,
      routing: value.routing && typeof value.routing === "object" && !Array.isArray(value.routing)
        ? structuredClone(value.routing)
        : null,
      createdAt: validIso(value.createdAt) || new Date().toISOString()
    }];
  });
}

function normalizeTimeNote(value, assetIds) {
  const id = clean(value?.id);
  const assetId = clean(value?.assetId);
  const text = cleanMultiline(value?.text);
  const startMs = nonNegativeInteger(value?.startMs);
  const endMs = nonNegativeInteger(value?.endMs);
  if (!id || !assetIds.has(assetId) || !text) return null;
  const createdAt = validIso(value.createdAt) || new Date().toISOString();
  const frameAssetId = clean(value.frameAssetId);
  return {
    id,
    assetId,
    startMs,
    ...(endMs > startMs ? { endMs } : {}),
    text,
    createdAt,
    ...(frameAssetId && assetIds.has(frameAssetId) ? { frameAssetId } : {})
  };
}

function uniqueMediaAssets(values) {
  const seen = new Set();
  return (Array.isArray(values) ? values : []).flatMap((value) => {
    const asset = normalizeMediaAsset(value);
    if (!asset || seen.has(asset.id)) return [];
    seen.add(asset.id);
    return [asset];
  });
}

function normalizeExtractedTextFormat(value, mimeType) {
  if (value === "markdown" || value === "plain") return value;
  return mimeType === "text/markdown" || mimeType === "text/html" || ["application/rtf", "text/rtf", "application/x-rtf"].includes(mimeType)
    ? "markdown"
    : "plain";
}

function normalizeReference(value, fallbackUrl) {
  const url = safeHttpUrl(value?.url || fallbackUrl);
  if (!url) return { url: "", provider: "", playbackMode: "source" };
  const provider = MEDIA_REFERENCE_PROVIDERS.includes(value?.provider) ? value.provider : providerForUrl(url);
  const requested = PLAYBACK_MODES.has(value?.playbackMode) ? value.playbackMode : "source";
  const playbackMode = requested === "embed" && !OFFICIAL_EMBED_PROVIDERS.has(provider) ? "source" : requested;
  const metadataStatus = ["resolved", "partial", "permission-denied", "unavailable"].includes(value?.metadataStatus)
    ? value.metadataStatus
    : "partial";
  const author = clean(value?.author);
  return { url, provider, playbackMode, metadataStatus, ...(author ? { author } : {}) };
}

function providerForUrl(url) {
  return detectMediaReferenceProvider(url);
}

function inferKind(value, mimeType) {
  if (MEDIA_KINDS.has(value)) return value;
  if (IMAGE_MIME_TYPES.has(mimeType) || mimeType.startsWith("image/")) return "image";
  if (VIDEO_MIME_TYPES.has(mimeType) || mimeType.startsWith("video/")) return "video";
  if (DOCUMENT_MIME_TYPES.has(mimeType)) return "document";
  return value ? "" : "image";
}

function mimeTypeForKind(kind, mimeType) {
  if (!mimeType) return false;
  if (kind === "image") return mimeType.startsWith("image/");
  if (kind === "video") return mimeType.startsWith("video/");
  return DOCUMENT_MIME_TYPES.has(mimeType);
}

function safeAssetPath(value) {
  const path = clean(value).replace(/\\/g, "/");
  return path && !path.startsWith("/") && !path.split("/").includes("..") ? path : "";
}

function safeHttpUrl(value) {
  try {
    const url = new URL(clean(value));
    return ["http:", "https:"].includes(url.protocol) ? url.href : "";
  } catch {
    return "";
  }
}

function positiveInteger(value) {
  const number = Number(value);
  return Number.isSafeInteger(number) && number > 0 ? number : 0;
}

function nonNegativeInteger(value) {
  const number = Number(value);
  return Number.isSafeInteger(number) && number >= 0 ? number : 0;
}

function validIso(value) {
  const text = clean(value);
  return text && Number.isFinite(Date.parse(text)) ? new Date(text).toISOString() : "";
}

function cleanMultiline(value) {
  return String(value ?? "").replace(/\r\n?/g, "\n").replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "").trim();
}

function clean(value) {
  return String(value ?? "").replace(/[\u0000-\u001f\u007f]/g, "").trim();
}
import { MEDIA_REFERENCE_PROVIDERS, detectMediaReferenceProvider } from "./media-reference-resolver.js";
