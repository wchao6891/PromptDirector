import { readImageDimensions as readStoredImageDimensions } from "./image-metadata.js";
import { PORTABLE_LIBRARY_LIMITS, assertImageDimensions, formatBytes } from "./resource-limits.js";
import { assertStorageCapacity, validateMediaBlob } from "./media-store.js";
import { ingestLocalDocument } from "./document-ingestion.js";

const FORMATS = Object.freeze({
  png: { kind: "image", mimeTypes: ["image/png"] },
  jpg: { kind: "image", mimeTypes: ["image/jpeg"] },
  jpeg: { kind: "image", mimeTypes: ["image/jpeg"] },
  webp: { kind: "image", mimeTypes: ["image/webp"] },
  gif: { kind: "image", mimeTypes: ["image/gif"] },
  mp4: { kind: "video", mimeTypes: ["video/mp4"] },
  webm: { kind: "video", mimeTypes: ["video/webm"] },
  mov: { kind: "video", mimeTypes: ["video/quicktime"] },
  mkv: { kind: "video", mimeTypes: ["video/x-matroska"] },
  avi: { kind: "video", mimeTypes: ["video/x-msvideo"] },
  pdf: { kind: "document", mimeTypes: ["application/pdf"] },
  txt: { kind: "document", mimeTypes: ["text/plain"] },
  md: { kind: "document", mimeTypes: ["text/markdown", "text/plain"] },
  markdown: { kind: "document", mimeTypes: ["text/markdown", "text/plain"] },
  html: { kind: "document", mimeTypes: ["text/html"] },
  htm: { kind: "document", mimeTypes: ["text/html"] },
  rtf: { kind: "document", mimeTypes: ["application/rtf", "text/rtf", "application/x-rtf"] }
});

export function detectLocalMediaFile(file, options = {}) {
  if (!(file instanceof Blob) || !file.size) throw new Error("文件为空或已经失效");
  const name = clean(file.name);
  const extension = fileExtension(name);
  const format = FORMATS[extension];
  if (!format) throw new Error("暂不支持这种文件格式");
  if (format.kind === "video" && options.allowVideo === false) throw new Error("暂不支持视频");
  const reportedMimeType = clean(file.type).toLocaleLowerCase("en-US");
  if (reportedMimeType && !format.mimeTypes.includes(reportedMimeType)) {
    throw new Error("扩展名和文件格式不一致，请检查原文件");
  }
  const mimeType = reportedMimeType || format.mimeTypes[0];
  return { extension, kind: format.kind, mimeType };
}

export function normalizeLocalRelativePath(value, fallbackName = "") {
  const source = clean(value) || clean(fallbackName);
  const normalized = source.replaceAll("\\", "/");
  if (!normalized || normalized.startsWith("/") || /^[a-z]:\//iu.test(normalized)) {
    throw new Error("本机资料必须使用相对路径");
  }
  const parts = normalized.split("/");
  if (parts.some((part) => !part || part === "." || part === "..")) {
    throw new Error("本机资料必须使用安全相对路径");
  }
  return parts.join("/");
}

export async function prepareLocalMedia(file, assetId, options = {}) {
  const format = detectLocalMediaFile(file, { allowVideo: options.allowVideo !== false });
  if (format.kind === "image" && file.size > PORTABLE_LIBRARY_LIMITS.maxImageBytes) {
    throw new Error(`图片超过 ${formatBytes(PORTABLE_LIBRARY_LIMITS.maxImageBytes)} 上限`);
  }
  const id = clean(assetId);
  if (!id) throw new Error("媒体缺少有效编号");
  const blob = file.type === format.mimeType ? file : file.slice(0, file.size, format.mimeType);
  validateMediaBlob(blob);
  const estimate = typeof options.estimateStorage === "function" ? await options.estimateStorage() : {};
  assertStorageCapacity(estimate, file.size);
  const relativePath = normalizeLocalRelativePath(options.relativePath, file.name);
  const now = clean(options.now) || new Date().toISOString();
  const base = {
    id,
    kind: format.kind,
    storageMode: "managed",
    mimeType: format.mimeType,
    byteSize: file.size,
    sourceTitle: clean(file.name),
    relativePath,
    contentHash: await sha256Blob(blob),
    capturedAt: now,
    reviewStatus: "verified"
  };
  if (format.kind === "document") {
    const document = await ingestLocalDocument(blob, {
      extension: format.extension,
      parseHtml: options.parseHtml,
      toMarkdown: options.toMarkdown,
      extractPdfText: options.extractPdfText
    });
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
  const readDimensions = typeof options.readImageDimensions === "function"
    ? options.readImageDimensions
    : readLocalImageDimensions;
  const dimensions = await readDimensions(blob);
  assertImageDimensions(dimensions.width, dimensions.height);
  let poster = null;
  if (format.extension === "gif") {
    const createFirstFrame = typeof options.createGifFirstFrame === "function"
      ? options.createGifFirstFrame
      : createGifFirstFrame;
    const posterBlob = await createFirstFrame(blob);
    const posterDimensions = await readDimensions(posterBlob);
    assertImageDimensions(posterDimensions.width, posterDimensions.height);
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
  return (await ingestLocalDocument(blob, options)).contentText;
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

function fileExtension(name) {
  return String(name ?? "").trim().toLocaleLowerCase("en-US").match(/\.([a-z0-9]+)$/u)?.[1] ?? "";
}

function clean(value) {
  return String(value ?? "").trim();
}
