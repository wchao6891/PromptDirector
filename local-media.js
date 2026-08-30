import { readImageDimensions as readStoredImageDimensions } from "./image-metadata.js";
import {
  ASSET_IMPORT_FAILURE_CODES,
  MEDIA_FINGERPRINT_CHUNK_BYTES,
  assetImportError,
  assertImageDimensions,
  formatBytes,
  isAssetImportError,
  portableLibraryLimits
} from "./resource-limits.js";
import { assertStorageCapacity } from "./media-store.js";
import { ingestLocalDocument } from "./document-ingestion.js";
import {
  assetFileAccept,
  assetFormatForExtension,
  canonicalMimeType,
  fileExtension,
  isReportedMimeCompatible
} from "./asset-formats.js";

export const LOCAL_ASSET_FILE_ACCEPT = assetFileAccept();
export const LOCAL_ASSET_REFERENCE_RECORD_TYPE = "local-asset-reference";

export function detectLocalMediaFile(file, options = {}) {
  if (!(file instanceof Blob) || !file.size) {
    throw assetImportError(ASSET_IMPORT_FAILURE_CODES.INVALID_FILE, "文件为空或已经失效");
  }
  const name = clean(file.name);
  const extension = fileExtension(name);
  const format = assetFormatForExtension(extension);
  if (!format) throw unsupportedFormatError(name);
  if (format.kind === "video" && options.allowVideo === false) throw unsupportedFormatError(name, "当前入口暂不支持视频");
  if (format.kind === "audio" && options.allowAudio === false) throw unsupportedFormatError(name, "当前入口暂不支持音频");
  if (format.kind === "attachment" && options.allowAttachment === false) {
    throw unsupportedFormatError(name, "当前入口暂不支持创作源文件");
  }
  const reportedMimeType = clean(file.type).toLocaleLowerCase("en-US");
  if (!isReportedMimeCompatible(format, reportedMimeType)) {
    throw unsupportedFormatError(name, "扩展名和文件格式不一致，请检查原文件");
  }
  const mimeType = canonicalMimeType(format, reportedMimeType);
  return { extension, kind: format.kind, mimeType };
}

export function normalizeLocalRelativePath(value, fallbackName = "") {
  const source = clean(value) || clean(fallbackName);
  const normalized = source.replaceAll("\\", "/");
  if (!normalized || normalized.startsWith("/") || /^[a-z]:\//iu.test(normalized)) {
    throw assetImportError(ASSET_IMPORT_FAILURE_CODES.INVALID_FILE, "本机资料必须使用相对路径");
  }
  const parts = normalized.split("/");
  if (parts.some((part) => !part || part === "." || part === "..")) {
    throw assetImportError(ASSET_IMPORT_FAILURE_CODES.INVALID_FILE, "本机资料必须使用安全相对路径");
  }
  return parts.join("/");
}

export async function prepareLocalMedia(file, assetId, options = {}) {
  try {
    return await prepareLocalMediaValue(file, assetId, options);
  } catch (error) {
    if (isAssetImportError(error)) throw error;
    const name = clean(file?.name) || "这个文件";
    const explanation = clean(error?.message);
    throw assetImportError(
      ASSET_IMPORT_FAILURE_CODES.READ_OR_DECODE_FAILED,
      explanation ? `无法读取或解析“${name}”：${explanation}` : `无法读取或解析“${name}”`,
      {},
      { cause: error }
    );
  }
}

export function createUnsupportedLocalAssetReference(file, assetId, options = {}) {
  if (!(file instanceof Blob) || !file.size) {
    throw assetImportError(ASSET_IMPORT_FAILURE_CODES.INVALID_FILE, "文件为空或已经失效");
  }
  const id = clean(assetId);
  if (!id) throw assetImportError(ASSET_IMPORT_FAILURE_CODES.INVALID_FILE, "媒体缺少有效编号");
  let failure;
  try {
    detectLocalMediaFile(file);
    throw assetImportError(
      ASSET_IMPORT_FAILURE_CODES.INVALID_FILE,
      "已支持的文件格式应使用正常导入流程"
    );
  } catch (error) {
    if (!isAssetImportError(error) || error.code !== ASSET_IMPORT_FAILURE_CODES.UNSUPPORTED_FORMAT) throw error;
    failure = error;
  }
  const sourceTitle = clean(file.name);
  const relativePath = normalizeLocalRelativePath(options.relativePath, sourceTitle);
  const sourceFormat = fileExtension(sourceTitle);
  const reportedMimeType = clean(file.type).toLocaleLowerCase("en-US");
  const sourceLastModified = Number(file.lastModified);
  return {
    recordType: LOCAL_ASSET_REFERENCE_RECORD_TYPE,
    id,
    kind: "attachment",
    storageMode: "reference",
    linkStatus: "relink-required",
    mimeType: reportedMimeType || "application/octet-stream",
    byteSize: file.size,
    ...(Number.isSafeInteger(sourceLastModified) && sourceLastModified >= 0 ? { sourceLastModified } : {}),
    sourceTitle,
    relativePath,
    sourceFormat,
    formatCategory: "local-link",
    capturedAt: clean(options.now) || new Date().toISOString(),
    reviewStatus: "unverified",
    importFailure: {
      code: failure.code,
      message: failure.message,
      forceAllowed: false
    }
  };
}

async function prepareLocalMediaValue(file, assetId, options) {
  const limits = portableLibraryLimits(options.limits);
  const format = detectLocalMediaFile(file, {
    allowVideo: options.allowVideo !== false,
    allowAudio: options.allowAudio !== false,
    allowAttachment: options.allowAttachment !== false
  });
  if (format.kind === "image" && file.size > limits.maxImageBytes && options.forceImport !== true) {
    throw assetImportError(
      ASSET_IMPORT_FAILURE_CODES.TOO_LARGE,
      `图片大小为 ${formatBytes(file.size)}，超过默认 ${formatBytes(limits.maxImageBytes)} 上限；确认风险后可强制导入`,
      { actualBytes: file.size, maxBytes: limits.maxImageBytes, forceAllowed: true }
    );
  }
  const id = clean(assetId);
  if (!id) throw assetImportError(ASSET_IMPORT_FAILURE_CODES.INVALID_FILE, "媒体缺少有效编号");
  const blob = file.type === format.mimeType ? file : file.slice(0, file.size, format.mimeType);
  const estimate = typeof options.estimateStorage === "function" ? await options.estimateStorage() : {};
  assertStorageCapacity(estimate, file.size);
  const relativePath = normalizeLocalRelativePath(options.relativePath, file.name);
  const now = clean(options.now) || new Date().toISOString();
  const definition = assetFormatForExtension(format.extension);
  const storageMode = format.kind === "attachment" && options.storageMode === "reference" ? "reference" : "managed";
  const base = {
    id,
    kind: format.kind,
    storageMode,
    mimeType: format.mimeType,
    byteSize: file.size,
    sourceTitle: clean(file.name),
    relativePath,
    sourceFormat: format.extension,
    formatCategory: definition.category,
    contentHash: await sha256Blob(blob),
    capturedAt: now,
    reviewStatus: "verified"
  };
  if (format.kind === "document") {
    const document = await ingestDetectedDocument(blob, definition, format.extension, options);
    return {
      blob,
      asset: { ...base, extractedTextFormat: document.contentFormat },
      ...document
    };
  }
  if (format.kind === "video") {
    const videoMedia = await readVideoMedia(blob, id, options);
    return {
      blob,
      asset: {
        ...base,
        ...videoMedia.metadata,
        ...(videoMedia.poster ? { posterAssetId: videoMedia.poster.asset.id } : {})
      },
      ...(videoMedia.poster ? { poster: videoMedia.poster } : {})
    };
  }
  if (format.kind === "audio") {
    return { blob, asset: { ...base, playbackCapability: "native" } };
  }
  if (format.kind === "attachment") {
    return { blob, asset: base };
  }
  const readDimensions = typeof options.readImageDimensions === "function"
    ? options.readImageDimensions
    : readLocalImageDimensions;
  const dimensions = await readDimensions(blob);
  assertImageDimensions(dimensions.width, dimensions.height, limits);
  let poster = null;
  if (format.extension === "gif") {
    const createFirstFrame = typeof options.createGifFirstFrame === "function"
      ? options.createGifFirstFrame
      : createGifFirstFrame;
    const posterBlob = await createFirstFrame(blob);
    const posterDimensions = await readDimensions(posterBlob);
    assertImageDimensions(posterDimensions.width, posterDimensions.height, limits);
    const posterId = typeof options.posterId === "function" ? clean(options.posterId()) : `poster:${crypto.randomUUID()}`;
    poster = {
      blob: posterBlob,
      asset: posterAsset(posterId, id, posterBlob, posterDimensions, now, "GIF 首帧")
    };
  }
  return {
    blob,
    asset: { ...base, ...dimensions, ...(poster ? { posterAssetId: poster.asset.id } : {}) },
    ...(poster ? { poster } : {})
  };
}

export async function extractLocalDocumentText(blob, options = {}) {
  const extension = clean(options.extension).toLocaleLowerCase("en-US");
  const definition = assetFormatForExtension(extension);
  if (definition?.kind !== "document") throw unsupportedFormatError(clean(options.name));
  try {
    return (await ingestDetectedDocument(blob, definition, extension, options)).contentText;
  } catch (error) {
    if (isAssetImportError(error)) throw error;
    throw assetImportError(
      ASSET_IMPORT_FAILURE_CODES.READ_OR_DECODE_FAILED,
      clean(error?.message) || "文件读取或解析失败",
      {},
      { cause: error }
    );
  }
}

export async function findExactMediaDuplicate(file, entries = [], options = {}) {
  const format = detectLocalMediaFile(file);
  const name = clean(file.name);
  const storedAssets = (Array.isArray(entries) ? entries : []).flatMap((entry) =>
    Array.isArray(entry?.mediaAssets) ? entry.mediaAssets : []
  );
  const candidates = [
    ...storedAssets,
    ...(Array.isArray(options.candidateAssets) ? options.candidateAssets : [])
  ].filter((asset) =>
      Number(asset?.byteSize) === file.size &&
      clean(asset?.mimeType).toLocaleLowerCase("en-US") === format.mimeType &&
      clean(asset?.sourceTitle ?? asset?.name) === name
  );
  const contentHash = await sha256Blob(file);
  for (const asset of candidates) {
    let candidateHash = clean(asset.contentHash);
    if (!candidateHash) {
      const blob = await options.readBlob?.(asset.id);
      if (!(blob instanceof Blob)) continue;
      candidateHash = await sha256Blob(blob);
    }
    if (candidateHash === contentHash) {
      return { contentHash, duplicateAssetId: clean(asset.id) };
    }
  }
  return { contentHash, duplicateAssetId: "" };
}

export async function sha256Blob(blob) {
  if (!(blob instanceof Blob)) throw new Error("无法计算无效媒体的内容摘要");
  const digest = await crypto.subtle.digest("SHA-256", await blob.arrayBuffer());
  return [...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, "0")).join("");
}

export async function chunkedBlobFingerprint(blob, options = {}) {
  if (!(blob instanceof Blob) || !blob.size) throw new Error("无法计算空媒体的内容指纹");
  const chunkBytes = Math.max(1, Number(options.chunkBytes) || MEDIA_FINGERPRINT_CHUNK_BYTES);
  const chunkDigests = [];
  for (let offset = 0; offset < blob.size; offset += chunkBytes) {
    const chunk = blob.slice(offset, Math.min(blob.size, offset + chunkBytes));
    chunkDigests.push(`${chunk.size}:${await sha256Blob(chunk)}`);
  }
  const descriptor = `${blob.size}:${blob.type}:${chunkDigests.join(":")}`;
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(descriptor));
  return [...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, "0")).join("");
}

async function readLocalImageDimensions(blob) {
  if (blob.type !== "image/gif") return readStoredImageDimensions(blob);
  const bytes = new Uint8Array(await blob.slice(0, 10).arrayBuffer());
  if (bytes.length < 10 || !["GIF87a", "GIF89a"].includes(String.fromCharCode(...bytes.slice(0, 6)))) {
    throw new Error("无法读取 GIF 图片尺寸");
  }
  return { width: bytes[6] | (bytes[7] << 8), height: bytes[8] | (bytes[9] << 8) };
}

async function createGifFirstFrame(blob) {
  if (typeof createImageBitmap !== "function" || typeof OffscreenCanvas !== "function") {
    throw new Error("当前浏览器无法提取 GIF 首帧");
  }
  const bitmap = await createImageBitmap(blob);
  try {
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
    canvas.getContext("2d").drawImage(bitmap, 0, 0);
    return await canvas.convertToBlob({ type: "image/webp" });
  } finally {
    bitmap.close?.();
  }
}

async function readVideoMedia(blob, videoAssetId, options) {
  if (typeof options.readVideoMedia !== "function") {
    throw new Error("当前浏览器无法读取视频，请重新打开资料库后重试");
  }
  const value = await options.readVideoMedia(blob, blob.type, videoAssetId);
  return value && typeof value === "object" ? value : { metadata: { playbackCapability: "external" } };
}

function posterAsset(id, derivedFromAssetId, blob, dimensions, capturedAt, sourceTitle) {
  if (!id) throw new Error("预览图缺少有效编号");
  return {
    id,
    kind: "image",
    usage: "poster",
    derivedFromAssetId,
    storageMode: "managed",
    mimeType: blob.type,
    byteSize: blob.size,
    width: dimensions.width,
    height: dimensions.height,
    sourceTitle,
    capturedAt,
    reviewStatus: "verified"
  };
}

async function ingestDetectedDocument(blob, definition, extension, options) {
  if (!definition?.plainText) {
    return ingestLocalDocument(blob, {
      extension,
      parseHtml: options.parseHtml,
      toMarkdown: options.toMarkdown,
      extractPdfText: options.extractPdfText
    });
  }
  return {
    contentText: normalizePlainText(await blob.text()),
    contentFormat: "plain",
    sourceFormat: extension,
    warnings: []
  };
}

function normalizePlainText(value) {
  return String(value ?? "")
    .replace(/\r\n?/gu, "\n")
    .replace(/[\u0000\u0008\u000b\u000c\u000e-\u001f\u007f]/gu, "")
    .trim();
}

function clean(value) {
  return String(value ?? "").trim();
}

function unsupportedFormatError(name, message = "暂不支持这种文件格式") {
  const sourceTitle = clean(name);
  return assetImportError(
    ASSET_IMPORT_FAILURE_CODES.UNSUPPORTED_FORMAT,
    sourceTitle ? `${message}：${sourceTitle}` : message
  );
}
