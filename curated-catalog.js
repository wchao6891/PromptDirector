import { sha256Hex } from "./sync-crypto.js";
import { PORTABLE_LIBRARY_LIMITS } from "./resource-limits.js";
import { selectLibraryPackage } from "./library-package.js";

export const CURATED_CATALOG_FORMAT = "prompt-director-curated";
export const CURATED_CATALOG_VERSION = 2;

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

export function isTrustedCuratedResponseUrl(value) {
  const url = safeHttpsUrl(value);
  return Boolean(url && (DOWNLOAD_HOSTS.has(url.hostname) || COVER_HOSTS.has(url.hostname)));
}

function normalizeItem(value = {}) {
  const id = clean(value.id);
  const title = clean(value.title);
  const packageId = clean(value.packageId);
  const packageVersion = clean(value.packageVersion);
  const type = TYPES.has(value.type) ? value.type : "";
  const author = clean(value.author);
  const license = clean(value.license);
  const updatedAt = validIso(value.updatedAt);
  const coverUrl = trustedUrl(value.coverUrl, COVER_HOSTS, "精选封面地址不受信任");
  const downloadUrl = trustedUrl(value.downloadUrl, DOWNLOAD_HOSTS, "精选下载地址不受信任");
  const sha256 = String(value.sha256 ?? "").toLocaleLowerCase("en-US");
  if (!id || !title || !type || !packageId || !packageVersion || !author || !license || !updatedAt ||
      !/^[a-f0-9]{64}$/.test(sha256)) {
    throw new Error("精选目录条目缺少必填字段或校验值");
  }
  return {
    id,
    title,
    type,
    packageId,
    packageVersion,
    author,
    license,
    updatedAt,
    coverUrl,
    downloadUrl,
    sha256,
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

function positiveInteger(value) {
  const number = Math.floor(Number(value) || 0);
  if (number < 1) throw new Error("精选主题排序无效");
  return number;
}
