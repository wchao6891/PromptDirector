export const PAGE_SESSION_MEDIA_CHUNK_BYTES = 512 * 1024;

export async function preparePageSessionMedia(value = {}) {
  const clean = (input) => String(input ?? "").trim();
  const token = clean(value.token);
  const maxBytes = Number(value.maxBytes);
  const chunkBytes = Number(value.chunkBytes);
  if (!token || token.length > 128) throw new Error("页面媒体读取令牌无效");
  if (!Number.isSafeInteger(maxBytes) || maxBytes <= 0 || !Number.isSafeInteger(chunkBytes) || chunkBytes <= 0 || chunkBytes > maxBytes) {
    throw new Error("页面媒体读取上限无效");
  }
  let url;
  try { url = new URL(clean(value.url)); } catch { throw new Error("页面媒体地址无效"); }
  if (url.protocol !== "https:" || url.username || url.password) throw new Error("页面媒体只允许无凭据 HTTPS 地址");
  const allowed = new Set((Array.isArray(value.allowedUrls) ? value.allowedUrls : []).flatMap((item) => {
    try {
      const candidate = new URL(clean(item));
      return candidate.protocol === "https:" && !candidate.username && !candidate.password ? [candidate.href] : [];
    } catch {
      return [];
    }
  }));
  if (!allowed.has(url.href)) throw new Error("页面媒体地址不在本次选择范围内");
  if (typeof globalThis.fetch !== "function") throw new Error("当前页面无法读取媒体");

  const response = await globalThis.fetch(url.href, {
    credentials: "include",
    redirect: "error",
    referrerPolicy: "no-referrer",
    cache: "no-store"
  });
  if (!response?.ok) throw new Error(`页面媒体读取失败（HTTP ${response?.status || 0}）`);
  const declared = Number(response.headers?.get?.("content-length"));
  if (Number.isFinite(declared) && declared > maxBytes) throw new Error(`页面媒体超过读取上限（${maxBytes} bytes）`);
  if (!response.body?.getReader) throw new Error("页面媒体无法流式读取");

  const reader = response.body.getReader();
  const rawChunks = [];
  let totalBytes = 0;
  try {
    while (true) {
      const { done, value: part } = await reader.read();
      if (done) break;
      totalBytes += part.byteLength;
      if (totalBytes > maxBytes) {
        await reader.cancel().catch(() => undefined);
        throw new Error(`页面媒体超过读取上限（${maxBytes} bytes）`);
      }
      rawChunks.push(part);
    }
  } finally {
    reader.releaseLock();
  }
  if (!totalBytes) throw new Error("页面媒体为空");

  const bytes = new Uint8Array(totalBytes);
  let offset = 0;
  for (const part of rawChunks) {
    bytes.set(part, offset);
    offset += part.byteLength;
  }
  const encode = (part) => {
    let binary = "";
    for (let start = 0; start < part.length; start += 8192) {
      binary += String.fromCharCode(...part.subarray(start, Math.min(part.length, start + 8192)));
    }
    return globalThis.btoa(binary);
  };
  const chunks = [];
  for (let start = 0; start < bytes.length; start += chunkBytes) chunks.push(encode(bytes.subarray(start, start + chunkBytes)));
  const stateKey = "__PROMPTDIRECTOR_PAGE_SESSION_MEDIA__";
  const state = globalThis[stateKey] instanceof Map ? globalThis[stateKey] : new Map();
  if (!(globalThis[stateKey] instanceof Map)) Object.defineProperty(globalThis, stateKey, { value: state, configurable: true });
  state.set(token, { chunks });
  return {
    token,
    chunkCount: chunks.length,
    totalBytes,
    contentType: clean(response.headers?.get?.("content-type")).split(";", 1)[0].toLocaleLowerCase("en-US")
  };
}

export function readPageSessionMediaChunk(value = {}) {
  const token = String(value.token ?? "").trim();
  const index = Number(value.index);
  const state = globalThis.__PROMPTDIRECTOR_PAGE_SESSION_MEDIA__;
  if (!(state instanceof Map) || !Number.isSafeInteger(index) || index < 0) return "";
  return String(state.get(token)?.chunks?.[index] || "");
}

export function discardPageSessionMedia(value = {}) {
  const token = String(value.token ?? "").trim();
  const state = globalThis.__PROMPTDIRECTOR_PAGE_SESSION_MEDIA__;
  return state instanceof Map ? state.delete(token) : false;
}
