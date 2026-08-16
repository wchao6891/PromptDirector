import { sha256Hex } from "./sync-crypto.js";
import { PORTABLE_LIBRARY_LIMITS } from "./resource-limits.js";
import { selectLibraryPackage } from "./library-package.js";

export const CURATED_CATALOG_FORMAT = "prompt-director-curated";
export const CURATED_CATALOG_VERSION = 2;
export const CURATED_PREVIEW_FORMAT = "prompt-director-curated-preview";
export const CURATED_PREVIEW_VERSION = 1;
export const CURATED_METRICS_FORMAT = "prompt-director-curated-metrics";
export const CURATED_METRICS_VERSION = 1;

const TYPES = new Set(["editorial", "image_prompt", "video_prompt"]);
const COVER_HOSTS = new Set(["wchao6891.github.io"]);
const DOWNLOAD_HOSTS = new Set([
  "github.com",
  "objects.githubusercontent.com",
  "release-assets.githubusercontent.com"
]);

export function normalizeCuratedCatalog(value) {
  if (value?.format !== CURATED_CATALOG_FORMAT) {
    throw new Error("精选目录格式无效");
  }
  if (value.version !== CURATED_CATALOG_VERSION) {
    throw new Error(value.version === 1 && Array.isArray(value.items)
      ? "精选目录版本过旧，请发布最新主题目录"
      : "精选目录版本不受支持");
  }
  if (!Array.isArray(value.themes)) throw new Error("精选目录格式无效");
  const ids = new Set();
  const packages = new Set();
  const orders = new Set();
  const themes = value.themes.map((item) => {
    const normalized = normalizeItem(item);
    if (ids.has(normalized.id)) throw new Error("精选目录包含重复条目");
    if (orders.has(normalized.order)) throw new Error("精选目录包含重复排序");
    const packageKey = `${normalized.packageId}@${normalized.packageVersion}`;
    if (packages.has(packageKey)) throw new Error("精选目录包含重复案例包版本");
    ids.add(normalized.id);
    orders.add(normalized.order);
    packages.add(packageKey);
    return normalized;
  }).toSorted((left, right) => left.order - right.order || left.id.localeCompare(right.id));
  return {
    format: CURATED_CATALOG_FORMAT,
    version: CURATED_CATALOG_VERSION,
    updatedAt: validIso(value.updatedAt),
    themes
  };
}

export function applyCuratedOrigin(entryValue, itemValue, installedAt = new Date().toISOString()) {
  const item = normalizeItem(itemValue);
  const sourceEntryId = clean(entryValue?.id);
  return {
    ...structuredClone(entryValue),
    curatedOrigin: {
      catalogId: item.id,
      packageId: item.packageId,
      packageVersion: item.packageVersion,
      author: item.author,
      license: item.license,
      sourceEntryId,
      installedAt: validIso(installedAt) || new Date().toISOString()
    }
  };
}

export function normalizeCuratedPreview(value, itemValue) {
  const item = normalizeItem(itemValue);
  if (value?.format !== CURATED_PREVIEW_FORMAT || value.version !== CURATED_PREVIEW_VERSION || !Array.isArray(value.entries)) {
    throw new Error("精选预览格式无效");
  }
  if (clean(value.catalogId) !== item.id || clean(value.packageId) !== item.packageId || clean(value.packageVersion) !== item.packageVersion) {
    throw new Error("精选预览与案例包版本不一致");
  }
  if (value.entries.length !== item.caseCount) throw new Error("精选预览案例数量与目录不一致");
  const ids = new Set();
  const entries = value.entries.map((entry) => {
    const id = clean(entry?.id);
    const title = clean(entry?.title);
    const text = cleanPrompt(entry?.text);
    const author = clean(entry?.author);
    const rights = clean(entry?.rights);
    const mediaKind = ["image", "video"].includes(entry?.mediaKind) ? entry.mediaKind : "";
    const previewImageUrl = trustedUrl(entry?.previewImageUrl, COVER_HOSTS, "精选预览图片地址不受信任");
    const sourceUrl = optionalHttpsUrl(entry?.sourceUrl);
    const hasVideoAsset = Boolean(clean(entry?.videoUrl) || clean(entry?.videoSha256) || clean(entry?.videoMimeType) || Number(entry?.videoBytes) > 0);
    const videoUrl = hasVideoAsset ? trustedUrl(entry?.videoUrl, DOWNLOAD_HOSTS, "精选视频地址不受信任") : "";
    const videoSha256 = hasVideoAsset ? String(entry?.videoSha256 ?? "").toLocaleLowerCase("en-US") : "";
    const videoBytes = hasVideoAsset ? positiveInteger(entry?.videoBytes, "精选视频大小无效") : 0;
    const videoMimeType = hasVideoAsset ? clean(entry?.videoMimeType) : "";
    if (!id || !title || !text || !author || !rights || !mediaKind) throw new Error("精选预览案例缺少必填字段");
    if (hasVideoAsset && (mediaKind !== "video" || !/^[a-f0-9]{64}$/.test(videoSha256) || videoMimeType !== "video/mp4")) {
      throw new Error("精选视频预览字段无效");
    }
    if (ids.has(id)) throw new Error("精选预览包含重复案例");
    ids.add(id);
    return {
      id,
      title,
      text,
      author,
      rights,
      sourceUrl,
      mediaKind,
      previewImageUrl,
      ...(hasVideoAsset ? { videoUrl, videoSha256, videoBytes, videoMimeType } : {}),
      width: positiveInteger(entry?.width),
      height: positiveInteger(entry?.height)
    };
  });
  return {
    format: CURATED_PREVIEW_FORMAT,
    version: CURATED_PREVIEW_VERSION,
    catalogId: item.id,
    packageId: item.packageId,
    packageVersion: item.packageVersion,
    entries
  };
}

export function normalizeCuratedMetrics(value, catalogValue) {
  const catalog = normalizeCuratedCatalog(catalogValue);
  if (value?.format !== CURATED_METRICS_FORMAT || value.version !== CURATED_METRICS_VERSION || !value.downloads || Array.isArray(value.downloads)) {
    throw new Error("精选下载指标格式无效");
  }
  const downloads = {};
  for (const item of catalog.themes) {
    const count = value.downloads[item.id];
    if (!Number.isSafeInteger(count) || count < 0) throw new Error("精选下载指标不完整");
    downloads[item.id] = count;
  }
  return {
    format: CURATED_METRICS_FORMAT,
    version: CURATED_METRICS_VERSION,
    updatedAt: validIso(value.updatedAt),
    downloads
  };
}

export function curatedSourceKey(entryValue = {}) {
  const packageId = clean(entryValue.curatedOrigin?.packageId);
  if (!packageId) return "";
  let sourceEntryId = clean(entryValue.curatedOrigin?.sourceEntryId);
  if (!sourceEntryId) {
    const version = clean(entryValue.curatedOrigin?.packageVersion);
    const prefix = version ? `curated:${safeId(packageId)}:${safeId(version)}:entry:` : "";
    const entryId = clean(entryValue.id);
    if (prefix && entryId.startsWith(prefix)) sourceEntryId = entryId.slice(prefix.length);
  }
  return sourceEntryId ? `${safeId(packageId)}:${safeId(sourceEntryId)}` : "";
}

export function prepareCuratedPackageVersion(libraryValue = {}, itemValue) {
  const item = normalizeItem(itemValue);
  const library = structuredClone(libraryValue);
  const entryIds = new Map();
  const visualIds = new Map();
  const prefix = `curated:${safeId(item.packageId)}:${safeId(item.packageVersion)}`;
  const sourceEntries = Array.isArray(library.entries) ? library.entries : [];
  for (const entry of sourceEntries) {
    const originalId = clean(entry.id);
    entryIds.set(originalId, `${prefix}:entry:${safeId(originalId)}`);
  }
  library.entries = sourceEntries.map((entry) => {
    const next = applyCuratedOrigin(entry, item);
    const originalId = clean(entry.id);
    next.id = entryIds.get(originalId);
    if (Array.isArray(next.mediaAssets)) {
      next.mediaAssets = next.mediaAssets.map((asset) => {
        const originalVisualId = clean(asset.id);
        const visualId = `${prefix}:visual:${safeId(originalVisualId)}`;
        visualIds.set(originalVisualId, visualId);
        return { ...asset, id: visualId };
      });
      next.mediaAssets = next.mediaAssets.map((asset) => ({
        ...asset,
        ...(asset.posterAssetId ? { posterAssetId: visualIds.get(asset.posterAssetId) ?? asset.posterAssetId } : {}),
        ...(asset.derivedFromAssetId ? { derivedFromAssetId: visualIds.get(asset.derivedFromAssetId) ?? asset.derivedFromAssetId } : {})
      }));
      next.primaryMediaId = visualIds.get(next.primaryMediaId) ?? next.mediaAssets[0]?.id ?? "";
      next.timeNotes = (next.timeNotes ?? []).map((note) => ({
        ...note,
        assetId: visualIds.get(note.assetId) ?? note.assetId,
        ...(note.frameAssetId ? { frameAssetId: visualIds.get(note.frameAssetId) ?? note.frameAssetId } : {})
      }));
    } else {
      next.visuals = (Array.isArray(next.visuals) ? next.visuals : []).map((visual) => {
        const originalVisualId = clean(visual.id);
        const visualId = `${prefix}:visual:${safeId(originalVisualId)}`;
        visualIds.set(originalVisualId, visualId);
        return { ...visual, id: visualId };
      });
      next.primaryVisualId = visualIds.get(next.primaryVisualId) ?? next.visuals[0]?.id ?? "";
    }
    next.facetAssignments = (next.facetAssignments ?? []).map((assignment) =>
      assignment.visualId && visualIds.has(assignment.visualId)
        ? { ...assignment, visualId: visualIds.get(assignment.visualId) }
        : assignment
    );
    if (next.creationMeta?.sourceEntryIds) {
      next.creationMeta.sourceEntryIds = next.creationMeta.sourceEntryIds.map((idValue) => entryIds.get(idValue) ?? idValue);
    }
    return next;
  });
  if (library.organizerState?.collections) {
    library.organizerState.collections = library.organizerState.collections.map((collection, index) => ({
      ...collection,
      id: `${prefix}:collection:${safeId(collection.id || index)}`,
      entryIds: (collection.entryIds ?? []).map((id) => entryIds.get(id)).filter(Boolean),
    }));
  }
  return library;
}

export function prepareCuratedEntryPackage(libraryValue = {}, entryIdValue) {
  const entryId = clean(entryIdValue);
  const selected = selectLibraryPackage(libraryValue, [entryId]);
  if (selected.entries.length !== 1 || selected.entries[0].id !== entryId) {
    throw new Error("精选案例无法作为单个案例保存");
  }
  return selected;
}

export function prepareCuratedEntriesPackage(libraryValue = {}, entryIdValues = []) {
  const entryIds = [...new Set((Array.isArray(entryIdValues) ? entryIdValues : []).map(clean).filter(Boolean))];
  const selected = selectLibraryPackage(libraryValue, entryIds);
  if (selected.entries.length !== entryIds.length) throw new Error("精选案例批次不完整，无法保存");
  const selectedIds = new Set(entryIds);
  selected.organizerState = {
    ...(selected.organizerState ?? {}),
    collections: (libraryValue.organizerState?.collections ?? []).flatMap((collection) => {
      const memberIds = (collection.entryIds ?? []).filter((id) => selectedIds.has(id));
      return memberIds.length ? [{ ...structuredClone(collection), entryIds: memberIds }] : [];
    })
  };
  return selected;
}

export async function verifyCuratedPackageBlob(blob, expectedSha256) {
  if (!(blob instanceof Blob) || blob.size < 22) throw new Error("精选案例包为空或无效");
  if (blob.size > PORTABLE_LIBRARY_LIMITS.maxArchiveBytes) throw new Error("精选案例包超过安全大小上限");
  const expected = String(expectedSha256 ?? "").toLocaleLowerCase("en-US");
  if (!/^[a-f0-9]{64}$/.test(expected)) throw new Error("精选案例包缺少有效校验值");
  const actual = await sha256Hex(blob);
  if (actual !== expected) throw new Error("精选案例包校验失败，文件可能损坏或被替换");
  return true;
}

export function validateCuratedPackageContents(itemValue, parsedValue = {}) {
  const item = normalizeItem(itemValue);
  const caseCount = Array.isArray(parsedValue.entries) ? parsedValue.entries.length : 0;
  const imageCount = parsedValue.images instanceof Map ? parsedValue.images.size : 0;
  const videoCount = parsedValue.assets instanceof Map
    ? [...parsedValue.assets.values()].filter((asset) => asset instanceof Blob && asset.type.startsWith("video/")).length
    : 0;
  if (caseCount !== item.caseCount) throw new Error("精选案例包的案例数量与目录不一致");
  if (imageCount !== item.imageCount) throw new Error("精选案例包的图片数量与目录不一致");
  if (videoCount !== item.videoCount) throw new Error("精选案例包的视频数量与目录不一致");
  return true;
}

export function validateCuratedPackageIndex(itemValue, libraryValue = {}, fileNamesValue = []) {
  const item = normalizeItem(itemValue);
  const entries = Array.isArray(libraryValue.entries) ? libraryValue.entries : [];
  if (entries.length !== item.caseCount) throw new Error("精选案例包的案例数量与目录不一致");
  const fileNames = new Set(fileNamesValue);
  const assetIds = new Set();
  const assetPaths = new Set();
  let imageCount = 0;
  let videoCount = 0;
  for (const entry of entries) {
    for (const asset of Array.isArray(entry?.mediaAssets) ? entry.mediaAssets : []) {
      if (asset?.storageMode === "reference") continue;
      const id = clean(asset?.id);
      const path = clean(asset?.assetPath);
      if (!id || assetIds.has(id) || !safeCuratedMediaPath(path, asset?.kind) || assetPaths.has(path)) {
        throw new Error("精选案例包包含无效或重复的媒体索引");
      }
      if (!fileNames.has(path)) throw new Error("精选案例包的媒体索引与 ZIP 不一致");
      assetIds.add(id);
      assetPaths.add(path);
      if (asset.kind === "image") imageCount += 1;
      if (asset.kind === "video") videoCount += 1;
    }
  }
  if (imageCount !== item.imageCount) throw new Error("精选案例包的图片数量与目录不一致");
  if (videoCount !== item.videoCount) throw new Error("精选案例包的视频数量与目录不一致");
  return true;
}

export function isTrustedCuratedResponseUrl(value) {
  const url = safeHttpsUrl(value);
  return Boolean(url && (DOWNLOAD_HOSTS.has(url.hostname) || COVER_HOSTS.has(url.hostname)));
}

function normalizeItem(value = {}) {
  const id = clean(value.id);
  const title = clean(value.title);
  const packageId = clean(value.packageId);
  const packageVersion = clean(value.packageVersion);
  const authorId = safeId(value.authorId);
  const type = TYPES.has(value.type) ? value.type : "";
  const author = clean(value.author);
  const license = clean(value.license);
  const updatedAt = validIso(value.updatedAt);
  const coverUrl = trustedUrl(value.coverUrl, COVER_HOSTS, "精选封面地址不受信任");
  const previewUrl = trustedUrl(value.previewUrl, COVER_HOSTS, "精选预览地址不受信任");
  const downloadUrl = trustedUrl(value.downloadUrl, DOWNLOAD_HOSTS, "精选下载地址不受信任");
  const sha256 = String(value.sha256 ?? "").toLocaleLowerCase("en-US");
  if (!id || !title || !type || !packageId || !packageVersion || !authorId || !author || !license || !updatedAt ||
      !/^[a-f0-9]{64}$/.test(sha256)) {
    throw new Error("精选目录条目缺少必填字段或校验值");
  }
  return {
    id,
    title,
    type,
    packageId,
    packageVersion,
    authorId,
    author,
    license,
    updatedAt,
    coverUrl,
    previewUrl,
    downloadUrl,
    sha256,
    archiveBytes: positiveInteger(value.archiveBytes, "精选案例包大小无效"),
    caseCount: nonNegativeInteger(value.caseCount),
    imageCount: nonNegativeInteger(value.imageCount),
    videoCount: nonNegativeInteger(value.videoCount),
    summary: clean(value.summary),
    order: positiveInteger(value.order)
  };
}

function trustedUrl(value, hosts, message) {
  const url = safeHttpsUrl(value);
  if (!url || !hosts.has(url.hostname) || url.username || url.password || url.search || url.hash) {
    throw new Error(message);
  }
  return url.href;
}

function safeHttpsUrl(value) {
  try {
    const url = new URL(String(value ?? ""));
    return url.protocol === "https:" ? url : null;
  } catch {
    return null;
  }
}

function optionalHttpsUrl(value) {
  if (!clean(value)) return "";
  const url = safeHttpsUrl(value);
  if (!url || url.username || url.password) throw new Error("精选案例来源地址无效");
  return url.href;
}

function safeCuratedMediaPath(path, kind) {
  if (!path || path.startsWith("/") || path.includes("\\") || path.split("/").some((part) => !part || part === "." || part === "..")) return false;
  if (kind === "image") return /^images\/[A-Za-z0-9._/-]+\.(?:png|jpe?g|webp)$/i.test(path);
  if (kind === "video") return /^videos\/[A-Za-z0-9._/-]+\.(?:mp4|webm|mov|mkv|avi)$/i.test(path);
  return false;
}

function cleanPrompt(value) {
  return String(value ?? "")
    .replace(/\r\n?/g, "\n")
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "")
    .trim();
}

function validIso(value) {
  const text = clean(value);
  return text && !Number.isNaN(Date.parse(text)) ? new Date(text).toISOString() : "";
}

function safeId(value) {
  const text = clean(value);
  const safe = text.replace(/[^A-Za-z0-9._-]/g, "-").replace(/-+/g, "-");
  if (!safe || safe === "." || safe === "..") throw new Error("精选案例包编号无效");
  return safe;
}

function clean(value) {
  return String(value ?? "").replace(/[\u0000-\u001f\u007f]/g, "").trim();
}

function nonNegativeInteger(value) {
  return Math.max(0, Math.floor(Number(value) || 0));
}

function positiveInteger(value, message = "精选主题排序无效") {
  const number = Math.floor(Number(value) || 0);
  if (number < 1) throw new Error(message);
  return number;
}
