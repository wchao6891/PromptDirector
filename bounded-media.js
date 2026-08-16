import { PORTABLE_LIBRARY_LIMITS } from "./resource-limits.js";

const MEDIA_KINDS = new Set(["image", "video", "document"]);
export const SUPPORTED_DOCUMENT_MIME_TYPES = Object.freeze([
  "application/pdf",
  "application/rtf",
  "text/rtf",
  "application/x-rtf",
  "text/html",
  "text/markdown",
  "text/plain"
]);
const DOCUMENT_MIME_TYPES = new Set(SUPPORTED_DOCUMENT_MIME_TYPES);

export async function fetchBoundedMedia(value, options = {}) {
  const url = assertRemoteMediaUrl(value, options);
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  if (typeof fetchImpl !== "function") throw new Error("当前环境无法下载媒体文件");
  const controller = new AbortController();
  const abort = () => controller.abort();
  if (options.signal?.aborted) controller.abort();
  options.signal?.addEventListener?.("abort", abort, { once: true });
  const timeoutMs = positiveInteger(options.timeoutMs, 0);
  const timeout = timeoutMs ? setTimeout(abort, timeoutMs) : 0;
  try {
    const response = await fetchImpl(url.href, {
      credentials: "omit",
      redirect: "error",
      referrerPolicy: "no-referrer",
      cache: "no-store",
      signal: controller.signal,
      headers: options.accept ? { accept: String(options.accept) } : undefined
    });
    if (!response.ok) throw new Error(`媒体下载失败（HTTP ${response.status}）`);
    return boundedMediaBlobFromResponse(response, { ...options, controller });
  } finally {
    if (timeout) clearTimeout(timeout);
    options.signal?.removeEventListener?.("abort", abort);
  }
}

export async function boundedMediaBlobFromResponse(response, options = {}) {
  const kind = mediaKind(options.kind);
  const maxBytes = positiveInteger(options.maxBytes, defaultLimit(kind));
  const declared = Number(response?.headers?.get?.("content-length"));
  if (Number.isFinite(declared) && declared > maxBytes) {
    await response.body?.cancel?.().catch(() => undefined);
    throw new Error(`媒体文件超过本地容量上限（${maxBytes} bytes）`);
  }
  const bytes = await readBoundedBytes(response, maxBytes, options.controller);
  const declaredType = cleanMimeType(response?.headers?.get?.("content-type"));
  const detectedType = kind === "document" ? detectDocumentMimeType(bytes) : detectMediaMimeType(bytes);
  const mimeType = kind === "document"
    ? verifiedDocumentMimeType(bytes, detectedType, declaredType, options.expectedMimeType)
    : detectedType || declaredType;
  if (kind !== "document" && (!mimeType.startsWith(`${kind}/`) || !detectedType)) {
    throw new Error(`来源没有返回有效${kind === "image" ? "图片" : "视频"}文件`);
  }
  const dimensions = kind === "image" ? detectImageDimensions(bytes, mimeType) : null;
  const maxPixels = positiveInteger(options.maxPixels, 0);
  if (dimensions && maxPixels && dimensions.width * dimensions.height > maxPixels) {
    throw new Error(`图片像素超过 ${maxPixels.toLocaleString("en-US")} 上限`);
  }
  options.onMetadata?.({ mimeType, ...(dimensions || {}) });
  return new Blob([bytes], { type: mimeType });
}

export function isSupportedDocumentMimeType(value) {
  return DOCUMENT_MIME_TYPES.has(cleanMimeType(value));
}

export function detectImageDimensions(bytesValue, mimeTypeValue = "") {
  const bytes = bytesValue instanceof Uint8Array ? bytesValue : new Uint8Array(bytesValue || []);
  const mimeType = cleanMimeType(mimeTypeValue) || detectMediaMimeType(bytes);
  if (mimeType === "image/png" && bytes.length >= 24) {
    return { width: readUint32BE(bytes, 16), height: readUint32BE(bytes, 20) };
  }
  if (mimeType === "image/gif" && bytes.length >= 10) {
    return { width: readUint16LE(bytes, 6), height: readUint16LE(bytes, 8) };
  }
  if (mimeType === "image/jpeg") return jpegDimensions(bytes);
  if (mimeType === "image/webp" && bytes.length >= 30) {
    const chunk = ascii(bytes, 12, 16);
    if (chunk === "VP8X") {
      return { width: 1 + readUint24LE(bytes, 24), height: 1 + readUint24LE(bytes, 27) };
    }
    if (chunk === "VP8L" && bytes[20] === 0x2f) {
      const bits = bytes[21] | bytes[22] << 8 | bytes[23] << 16 | bytes[24] << 24;
      return { width: (bits & 0x3fff) + 1, height: (bits >>> 14 & 0x3fff) + 1 };
    }
    if (chunk === "VP8 " && bytes.length >= 30 && matches(bytes.subarray(23), [0x9d, 0x01, 0x2a])) {
      return { width: readUint16LE(bytes, 26) & 0x3fff, height: readUint16LE(bytes, 28) & 0x3fff };
    }
  }
  return null;
}

export function assertRemoteMediaUrl(value, options = {}) {
  let url;
  try { url = value instanceof URL ? new URL(value.href) : new URL(String(value ?? "")); }
  catch { throw new Error("媒体地址无效"); }
  if (url.username || url.password) throw new Error("媒体地址不能包含登录凭据");
  const loopback = ["localhost", "127.0.0.1", "::1"].includes(url.hostname.toLocaleLowerCase("en-US"));
  if (url.protocol !== "https:" && !(options.allowLoopback === true && loopback && url.protocol === "http:")) {
    throw new Error("远程媒体只允许 HTTPS 地址");
  }
  if (typeof options.allowUrl === "function" && !options.allowUrl(url)) throw new Error("媒体地址不在允许范围内");
  return url;
}

async function readBoundedBytes(response, limit, controller) {
  if (!response?.body?.getReader) throw new Error("媒体响应无法流式读取");
  const reader = response.body.getReader();
  const chunks = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > limit) {
        controller?.abort?.();
        throw new Error(`媒体文件超过本地容量上限（${limit} bytes）`);
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  if (!total) throw new Error("媒体文件为空");
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

function detectMediaMimeType(bytes) {
  if (matches(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return "image/png";
  if (matches(bytes, [0xff, 0xd8, 0xff])) return "image/jpeg";
  if (ascii(bytes, 0, 4) === "RIFF" && ascii(bytes, 8, 12) === "WEBP") return "image/webp";
  if (["GIF87a", "GIF89a"].includes(ascii(bytes, 0, 6))) return "image/gif";
  const brand = ascii(bytes, 4, 12);
  if (brand.startsWith("ftyp") && /(?:avif|avis)/u.test(brand)) return "image/avif";
  if (matches(bytes, [0x1a, 0x45, 0xdf, 0xa3])) return "video/webm";
  if (ascii(bytes, 4, 8) === "ftyp") return "video/mp4";
  return "";
}

function detectDocumentMimeType(bytes) {
  if (ascii(bytes, 0, 5) === "%PDF-") return "application/pdf";
  const prefix = decodedPrefix(bytes, 256).trimStart().toLocaleLowerCase("en-US");
  if (prefix.startsWith("{\\rtf")) return "application/rtf";
  if (/^(?:<!doctype\s+html\b|<html\b|<head\b|<body\b)/u.test(prefix)) return "text/html";
  return "";
}

function verifiedDocumentMimeType(bytes, detectedType, declaredType, expectedTypeValue) {
  const expectedType = cleanMimeType(expectedTypeValue);
  if (expectedType && !isSupportedDocumentMimeType(expectedType)) {
    throw new Error("来源不是支持的安全文档类型");
  }
  const declaredDocumentType = isSupportedDocumentMimeType(declaredType) ? declaredType : "";
  const requestedType = expectedType || declaredDocumentType || detectedType;
  if (!requestedType) throw new Error("来源不是支持的安全文档类型");
  if (detectedType && !sameDocumentFamily(detectedType, requestedType)) {
    throw new Error("来源没有返回有效文档文件");
  }
  if (["application/pdf", "text/html"].includes(requestedType) && detectedType !== requestedType) {
    throw new Error("来源没有返回有效文档文件");
  }
  if (["application/rtf", "text/rtf", "application/x-rtf"].includes(requestedType) && detectedType !== "application/rtf") {
    throw new Error("来源没有返回有效文档文件");
  }
  if (["text/plain", "text/markdown"].includes(requestedType) && !isSafeUtf8Text(bytes)) {
    throw new Error("来源没有返回有效文档文件");
  }
  return requestedType;
}

function sameDocumentFamily(left, right) {
  const rtf = new Set(["application/rtf", "text/rtf", "application/x-rtf"]);
  return left === right || (rtf.has(left) && rtf.has(right));
}

function isSafeUtf8Text(bytes) {
  let text;
  try { text = new TextDecoder("utf-8", { fatal: true }).decode(bytes); }
  catch { return false; }
  if (text.includes("\u0000")) return false;
  let controls = 0;
  for (const character of text) {
    const code = character.codePointAt(0);
    if ((code < 0x20 && ![0x09, 0x0a, 0x0d].includes(code)) || code === 0x7f) controls += 1;
  }
  return controls <= Math.max(1, Math.floor(text.length * 0.01));
}

function decodedPrefix(bytes, limit) {
  try { return new TextDecoder("utf-8", { fatal: true }).decode(bytes.subarray(0, Math.min(bytes.length, limit))); }
  catch { return ""; }
}

function jpegDimensions(bytes) {
  let offset = 2;
  while (offset + 8 < bytes.length) {
    if (bytes[offset] !== 0xff) {
      offset += 1;
      continue;
    }
    const marker = bytes[offset + 1];
    offset += 2;
    if (marker === 0xd8 || marker === 0xd9) continue;
    if (offset + 2 > bytes.length) break;
    const length = bytes[offset] << 8 | bytes[offset + 1];
    if (length < 2 || offset + length > bytes.length) break;
    if ([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(marker)) {
      return { width: bytes[offset + 5] << 8 | bytes[offset + 6], height: bytes[offset + 3] << 8 | bytes[offset + 4] };
    }
    offset += length;
  }
  return null;
}

function readUint32BE(bytes, offset) {
  return (bytes[offset] * 0x1000000 + (bytes[offset + 1] << 16 | bytes[offset + 2] << 8 | bytes[offset + 3])) >>> 0;
}

function readUint16LE(bytes, offset) {
  return bytes[offset] | bytes[offset + 1] << 8;
}

function readUint24LE(bytes, offset) {
  return bytes[offset] | bytes[offset + 1] << 8 | bytes[offset + 2] << 16;
}

function matches(bytes, signature) {
  return bytes.length >= signature.length && signature.every((value, index) => bytes[index] === value);
}

function ascii(bytes, start, end) {
  if (bytes.length < end) return "";
  return String.fromCharCode(...bytes.subarray(start, end));
}

function mediaKind(value) {
  const kind = String(value ?? "");
  if (!MEDIA_KINDS.has(kind)) throw new Error("媒体类型无效");
  return kind;
}

function defaultLimit(kind) {
  if (kind === "image") return PORTABLE_LIBRARY_LIMITS.maxImageBytes;
  if (kind === "document") return PORTABLE_LIBRARY_LIMITS.maxFileBytes;
  return PORTABLE_LIBRARY_LIMITS.maxVideoBytes;
}

function cleanMimeType(value) {
  return String(value ?? "").split(";", 1)[0].trim().toLocaleLowerCase("en-US");
}

function positiveInteger(value, fallback) {
  const number = Number(value);
  return Number.isSafeInteger(number) && number > 0 ? number : fallback;
}
