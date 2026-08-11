import { PORTABLE_LIBRARY_LIMITS } from "./resource-limits.js";

const MEDIA_KINDS = new Set(["image", "video"]);

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
  const detectedType = detectMediaMimeType(bytes);
  const mimeType = detectedType || declaredType;
  if (!mimeType.startsWith(`${kind}/`) || !detectedType) {
    throw new Error(`来源没有返回有效${kind === "image" ? "图片" : "视频"}文件`);
  }
  return new Blob([bytes], { type: mimeType });
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
  return kind === "image" ? PORTABLE_LIBRARY_LIMITS.maxImageBytes : PORTABLE_LIBRARY_LIMITS.maxVideoBytes;
}

function cleanMimeType(value) {
  return String(value ?? "").split(";", 1)[0].trim().toLocaleLowerCase("en-US");
}

function positiveInteger(value, fallback) {
  const number = Number(value);
  return Number.isSafeInteger(number) && number > 0 ? number : fallback;
}
