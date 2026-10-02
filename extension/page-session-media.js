export const PAGE_SESSION_MEDIA_CHUNK_BYTES = 512 * 1024;

export async function preparePageSessionMedia(value = {}) {
  const clean = (input) => String(input ?? "").trim();
  const token = clean(value.token);
  const maxBytes = Number(value.maxBytes);
  const chunkBytes = Number(value.chunkBytes);
  const timeoutMs = Number(value.timeoutMs);
  if (!token || token.length > 128) throw new Error("页面媒体读取令牌无效");
  if (!Number.isSafeInteger(maxBytes) || maxBytes <= 0 || !Number.isSafeInteger(chunkBytes) || chunkBytes <= 0 || chunkBytes > maxBytes) {
    throw new Error("页面媒体读取上限无效");
  }
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0) throw new Error("页面媒体读取时间预算无效");
  const signal = AbortSignal.timeout(timeoutMs);
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
    referrerPolicy: "strict-origin-when-cross-origin",
    cache: "no-store",
    signal
  });
  if (!response?.ok) throw new Error(`页面媒体读取失败（HTTP ${response?.status || 0}）`);
  const declared = Number(response.headers?.get?.("content-length"));
  if (Number.isFinite(declared) && declared > maxBytes) {
    await response.body?.cancel().catch(() => undefined);
    throw new Error(`页面媒体超过本次暂存预算（${maxBytes} bytes）`);
  }
  if (!response.body?.getReader) throw new Error("页面媒体无法流式读取");
  let totalBytes = 0;
  const stream = response.body.pipeThrough(new TransformStream({ transform(part, controller) {
    totalBytes += part.byteLength;
    if (totalBytes > maxBytes) throw new Error(`页面媒体超过本次暂存预算（${maxBytes} bytes）`);
    controller.enqueue(part);
  } }), { signal });
  const blob = await new Response(stream).blob();
  signal.throwIfAborted();
  if (!totalBytes) throw new Error("页面媒体为空");
  // Keep one browser-managed Blob. Encode only the requested transport chunk.
  const stateKey = "__PROMPTDIRECTOR_PAGE_SESSION_MEDIA__";
  const state = globalThis[stateKey] instanceof Map ? globalThis[stateKey] : new Map();
  if (!(globalThis[stateKey] instanceof Map)) Object.defineProperty(globalThis, stateKey, { value: state, configurable: true });
  clearTimeout(state.get(token)?.timer);
  const timer = setTimeout(() => state.delete(token), timeoutMs);
  state.set(token, { blob, chunkBytes, timer });
  return {
    token,
    chunkCount: Math.ceil(blob.size / chunkBytes),
    totalBytes,
    contentType: clean(response.headers?.get?.("content-type")).split(";", 1)[0].toLocaleLowerCase("en-US")
  };
}

export async function readPageSessionMediaChunk(value = {}) {
  const token = String(value.token ?? "").trim();
  const index = Number(value.index);
  const state = globalThis.__PROMPTDIRECTOR_PAGE_SESSION_MEDIA__;
  if (!(state instanceof Map) || !Number.isSafeInteger(index) || index < 0) return "";
  const record = state.get(token);
  if (!record || index >= Math.ceil(record.blob.size / record.chunkBytes)) return "";
  const bytes = new Uint8Array(await record.blob.slice(index * record.chunkBytes, (index + 1) * record.chunkBytes).arrayBuffer());
  let binary = "";
  for (let start = 0; start < bytes.length; start += 8192) binary += String.fromCharCode(...bytes.subarray(start, start + 8192));
  return globalThis.btoa(binary);
}

export function discardPageSessionMedia(value = {}) {
  const token = String(value.token ?? "").trim();
  const state = globalThis.__PROMPTDIRECTOR_PAGE_SESSION_MEDIA__;
  if (!(state instanceof Map)) return false;
  clearTimeout(state.get(token)?.timer);
  return state.delete(token);
}
