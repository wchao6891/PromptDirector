import { selectLibraryPackage, selectProjectPackage } from "./library-package.js";
import { normalizeEntryMedia } from "./media.js";
import { createDefaultOrganizerState } from "./organizer.js";

export const CURATED_SUBMISSION_FORMAT = "prompt-director-curated-submission";
export const CURATED_SUBMISSION_VERSION = 1;
export const CURATED_SUBMISSION_PART_FORMAT = "prompt-director-curated-submission-part";
export const CURATED_SUBMISSION_PART_VERSION = 1;
// GitHub attachments allow 25 MB for other files. Decimal bytes fit either MB
// interpretation; this bounds each upload part, never the complete submission.
// https://docs.github.com/en/get-started/writing-on-github/working-with-advanced-formatting/attaching-files
export const CURATED_SUBMISSION_MAX_FILE_BYTES = 25 * 1_000_000;
export const CURATED_SUBMISSION_PART_OVERHEAD_BYTES = 16 * 1024;
export const CURATED_SUBMISSION_PART_PAYLOAD_BYTES = CURATED_SUBMISSION_MAX_FILE_BYTES - CURATED_SUBMISSION_PART_OVERHEAD_BYTES;

export function prepareCuratedSubmissionState(stateValue = {}, selection = {}) {
  const selected = selection.collectionId
    ? selectProjectPackage(stateValue, selection.collectionId)
    : selectLibraryPackage(stateValue, selection.entryIds);
  const entries = selected.entries.map(sanitizeCuratedSubmissionEntry);
  const requiredTypes = new Set(entries.map((entry) => entry.classification.pathIds[0]));
  const taxonomy = structuredClone(stateValue.taxonomy ?? {});
  taxonomy.nodes = (taxonomy.nodes ?? []).filter((node) => requiredTypes.has(node?.id));
  if (taxonomy.nodes.length !== requiredTypes.size) throw new Error("投稿案例缺少图片或视频类型信息");
  const project = selection.collectionId
    ? selected.organizerState?.collections?.[0]
    : null;
  return {
    title: clean(project?.name) || "精选投稿",
    entries,
    state: {
      entries,
      settings: { libraryTitle: clean(project?.name) || "精选投稿", outputPath: "PromptDirector-投稿.zip" },
      taxonomy,
      facetCatalog: { version: 2, revision: 1, facets: [], nodes: [] },
      classificationRules: [],
      organizerState: createDefaultOrganizerState(),
      compoundCases: sanitizeCuratedCompoundCases(selected.compoundCases, entries)
    }
  };
}

export function sanitizeCuratedSubmissionEntry(entryValue = {}) {
  const entry = normalizeEntryMedia(entryValue);
  const contentAssets = entry.mediaAssets.filter((asset) => asset.usage !== "poster");
  if (!contentAssets.length || contentAssets.some(asset => !["image", "video"].includes(asset.kind))) throw new Error(`“${clean(entry.title)}”包含不支持的媒体`);
  const primary = contentAssets.find(asset => asset.id === entry.primaryMediaId);
  if (!primary) throw new Error(`“${clean(entry.title)}”的主媒体关系无效`);
  if (entry.mediaAssets.some(asset => asset.storageMode !== "managed")) throw new Error(`“${clean(entry.title)}”需要先把媒体保存到本地再投稿`);
  const byId = new Map(entry.mediaAssets.map(asset => [asset.id, asset]));
  const posterIds = new Set();
  for (const asset of contentAssets.filter(asset => asset.kind === "video")) {
    const poster = byId.get(asset.posterAssetId);
    if (poster?.kind !== "image" || poster.usage !== "poster" || posterIds.has(poster.id)) throw new Error(`“${clean(entry.title)}”的视频缺少唯一封面或封面关系无效`);
    posterIds.add(poster.id);
  }
  if (entry.mediaAssets.some(asset => asset.usage === "poster" && !posterIds.has(asset.id))) throw new Error(`“${clean(entry.title)}”包含未关联封面`);
  const text = cleanPrompt(entry.text);
  if (!text) throw new Error(`“${clean(entry.title) || "未命名案例"}”缺少可公开的提示词`);
  const sourceUrl = firstHttpsUrl([entry.url, ...(entry.sourcePages ?? []).map((page) => page?.url)]);
  const allowedIds = new Set(entry.mediaAssets.map(asset => asset.id));
  const mediaAssets = entry.mediaAssets
    .filter((asset) => allowedIds.has(asset.id))
    .map(sanitizeMediaAsset);
  return {
    id: clean(entry.id),
    title: clean(entry.title) || "未命名案例",
    text,
    savedAt: validIso(entry.savedAt),
    schemaVersion: Number.isSafeInteger(entry.schemaVersion) ? entry.schemaVersion : undefined,
    classification: {
      pathIds: [primary.kind === "video" ? "content:prompt:video" : "content:prompt:image"],
      status: "confirmed",
      source: "manual"
    },
    facetAssignments: [],
    customLabels: [],
    metadataLabels: (entry.metadataLabels ?? []).map(clean).filter((label) => /^(?:作者|权利)[:：]/u.test(label)),
    url: sourceUrl,
    sourcePages: (entry.sourcePages ?? []).filter(page => firstHttpsUrl([page.url])).map(page => ({ title: clean(page.title), url: firstHttpsUrl([page.url]) })),
    mediaAssets,
    mediaPrompts: sanitizeCuratedMediaPrompts(entry.mediaPrompts, mediaAssets),
    primaryMediaId: primary.id,
    timeNotes: []
  };
}

export function submissionManifest({ submissionId, payloadBytes, caseCount, mediaCount, createdAt = new Date().toISOString() }) {
  return {
    format: CURATED_SUBMISSION_FORMAT,
    version: CURATED_SUBMISSION_VERSION,
    submissionId: sha256(submissionId),
    payloadBytes: positiveInteger(payloadBytes),
    caseCount: positiveInteger(caseCount),
    mediaCount: positiveInteger(mediaCount),
    createdAt: validIso(createdAt)
  };
}

export function submissionPartManifest({ submissionId, archiveSha256, archiveBytes, partIndex, partCount, payloadSha256, payloadBytes }) {
  return {
    format: CURATED_SUBMISSION_PART_FORMAT,
    version: CURATED_SUBMISSION_PART_VERSION,
    submissionId: sha256(submissionId),
    archiveSha256: sha256(archiveSha256),
    archiveBytes: positiveInteger(archiveBytes),
    partIndex: positiveInteger(partIndex),
    partCount: positiveInteger(partCount),
    payloadSha256: sha256(payloadSha256),
    payloadBytes: positiveInteger(payloadBytes)
  };
}

function sanitizeMediaAsset(asset) {
  const sourceUrl = firstHttpsUrl([asset.sourceUrl]);
  return {
    id: clean(asset.id),
    kind: asset.kind,
    usage: asset.usage === "poster" ? "poster" : "content",
    storageMode: "managed",
    sourceUrl,
    sourceTitle: clean(asset.sourceTitle),
    sourceAuthor: clean(asset.sourceAuthor),
    originalWorkUrl: firstHttpsUrl([asset.originalWorkUrl]),
    capturedAt: validIso(asset.capturedAt),
    mimeType: clean(asset.mimeType),
    width: positiveInteger(asset.width),
    height: positiveInteger(asset.height),
    ...(asset.durationMs ? { durationMs: positiveInteger(asset.durationMs) } : {}),
    ...(asset.byteSize ? { byteSize: positiveInteger(asset.byteSize) } : {}),
    ...(clean(asset.posterAssetId) ? { posterAssetId: clean(asset.posterAssetId) } : {}),
    ...(clean(asset.derivedFromAssetId) ? { derivedFromAssetId: clean(asset.derivedFromAssetId) } : {}),
    reviewStatus: "unverified"
  };
}

function firstHttpsUrl(values) {
  for (const value of values) {
    try {
      const url = new URL(String(value ?? ""));
      if (url.protocol === "https:" && !url.username && !url.password) return url.href;
    } catch {
    }
  }
  return "";
}

function cleanPrompt(value) {
  return String(value ?? "")
    .replace(/\r\n?/g, "\n")
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "")
    .trim();
}

function clean(value) {
  return String(value ?? "").trim();
}

function positiveInteger(value) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 1) throw new Error("投稿包包含无效数值");
  return number;
}

function sha256(value) {
  const normalized = clean(value).toLocaleLowerCase("en-US");
  if (!/^[a-f0-9]{64}$/.test(normalized)) throw new Error("投稿包摘要无效");
  return normalized;
}

function validIso(value) {
  const text = clean(value);
  return text && Number.isFinite(Date.parse(text)) ? new Date(text).toISOString() : new Date().toISOString();
}

export function sanitizeCuratedCompoundCases(values = [], entries = []) {
  const ids = new Set(entries.map(entry => entry.id));
  return (values ?? []).filter(item => item.memberEntryIds?.every(id => ids.has(id))).map(item => ({
    id: clean(item.id), title: clean(item.title), memberEntryIds: [...item.memberEntryIds],
    coverVisualId: clean(item.coverVisualId), customLabels: [], createdAt: validIso(item.createdAt), updatedAt: validIso(item.updatedAt)
  }));
}

export function sanitizeCuratedMediaPrompts(values, mediaAssets) {
  const ids = new Set(mediaAssets.map(asset => asset.id));
  return (values ?? []).filter(value => ids.has(value.assetId) && ['manual', 'webpage', 'embedded'].includes(value.source) && String(value.text ?? '').trim())
    .map(value => ({ assetId: value.assetId, text: value.text, source: value.source }));
}
