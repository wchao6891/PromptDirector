import { AGENT_PROTOCOL_VERSION } from './agent-protocol.js';
import { PAGE_CAPTURE_LIMITS } from './resource-limits.js';
import { stagingByteBudget, withMediaDownloadSlot } from './resource-policy.js';
import { VIDEO_COMPONENT, videoComponentCurrent, videoComponentRequired } from './video-component-config.js';

export async function openNativeVideoSession(chromeApi = chrome, { inspectOnly = false } = {}) {
  if (!await chromeApi.permissions.contains({ permissions: ['nativeMessaging'] }) || typeof chromeApi.runtime.connectNative !== 'function') {
    throw videoComponentRequired();
  }
  try {
    const session = await connectVideoHost(VIDEO_COMPONENT.host, chromeApi);
    if (!inspectOnly && !videoComponentCurrent(session.componentVersion)) { session.close(); throw videoComponentRequired('视频组件需要更新'); }
    return session;
  }
  catch (error) { if (error.code === 'native_host_missing') throw videoComponentRequired(); throw error; }
}

async function connectVideoHost(host, chromeApi) {
  const port = chromeApi.runtime.connectNative(host);
  const requests = new Map();
  let ready, failReady, componentVersion, connected = false;
  const initialized = new Promise((resolve, reject) => { ready = resolve; failReady = reject; });
  const timer = setTimeout(() => failReady(videoComponentRequired('视频组件没有响应，请重新安装')), PAGE_CAPTURE_LIMITS.navigationTimeoutMs);
  port.onMessage.addListener(message => {
    if (message?.type === 'video_ready') { connected = true; componentVersion = message.componentVersion; clearTimeout(timer); ready(); return; }
    const request = requests.get(message?.id);
    if (!request) return;
    if (message.type === 'video_progress') { request.onProgress?.(message.progress); return; }
    if (message.type !== 'video_response') return;
    requests.delete(message.id);
    if (message.error) {
      const http = /(?:HTTP(?: Error)?|Server returned)\s*([45]\d\d)\b/iu.exec(message.error.message);
      const reason = http ? `${http[1] === '403' ? '视频服务器拒绝下载' : '视频服务器返回错误'}（HTTP ${http[1]}）` : message.error.message;
      const error = Object.assign(new Error(reason), { code: message.error.code });
      request.reject(error);
    } else request.resolve(message.result);
  });
  port.onDisconnect.addListener(() => {
    clearTimeout(timer);
    const reason = chromeApi.runtime.lastError?.message || '';
    const error = new Error(/not found/iu.test(reason) ? '本机视频解析组件未安装或需要更新'
      : /forbidden|not allowed/iu.test(reason) ? '本机视频解析连接未获授权，请检查组件安装'
        : reason || '本机视频解析连接已断开');
    if (/not found/iu.test(reason)) error.code = 'native_host_missing';
    else if (!connected) error.code = 'video_component_required';
    failReady(error);
    for (const request of requests.values()) request.reject(error);
    requests.clear();
  });
  try {
    port.postMessage({ type: 'video_hello', protocolVersion: AGENT_PROTOCOL_VERSION, extensionId: chromeApi.runtime.id });
    await initialized;
  } catch (error) { port.disconnect(); throw error; }
  return {
    componentVersion,
    request(operation, input, { id = crypto.randomUUID(), onProgress } = {}) {
      return new Promise((resolve, reject) => {
        requests.set(id, { resolve, reject, onProgress });
        try { port.postMessage({ type: 'video_request', id, operation, input }); }
        catch (error) { requests.delete(id); reject(error); }
      });
    },
    close() { port.disconnect(); }
  };
}

export async function nativeVideoStatus(chromeApi = chrome) {
  const session = await openNativeVideoSession(chromeApi, { inspectOnly: true });
  try {
    const result = await session.request('status', {}), updateRequired = !videoComponentCurrent(session.componentVersion);
    return { ...result, available: result.available && !updateRequired, updateRequired };
  } finally { session.close(); }
}

export async function downloadNativeVideo(url, { streams, minWidth = 0, minHeight = 0, signal, onProgress, chromeApi = chrome, estimateStorage } = {}) {
  return withMediaDownloadSlot(async () => {
    signal?.throwIfAborted();
    const session = await openNativeVideoSession(chromeApi);
    const id = crypto.randomUUID();
    let token;
    const abort = () => { void session.request('cancel', { requestId: id }).catch(() => {}); };
    signal?.addEventListener('abort', abort, { once: true });
    try {
      signal?.throwIfAborted();
      const maxBytes = Math.floor(await stagingByteBudget({ estimateStorage }));
      signal?.throwIfAborted();
      const result = await session.request('download', { url, streams, maxBytes }, { id, onProgress });
      token = result.token;
      if (minWidth > 0 && !(result.width >= minWidth) || minHeight > 0 && !(result.height >= minHeight)) {
        throw new Error(`重新解析的视频未达到页面画质（${minWidth || '?'}×${minHeight || '?'}），未保存较低画质版本`);
      }
      let index = 0, receivedBytes = 0;
      const stream = new ReadableStream({
        async pull(controller) {
          try {
            signal?.throwIfAborted();
            if (index === result.chunkCount) { controller.close(); return; }
            const chunk = await session.request('read', { token, index: index++ });
            const bytes = Uint8Array.from(atob(chunk.data), value => value.charCodeAt(0));
            receivedBytes += bytes.length;
            controller.enqueue(bytes);
            onProgress?.({ phase: 'transfer', receivedBytes, totalBytes: result.byteSize });
          } catch (error) { controller.error(error); }
        }
      });
      const blob = await new Response(stream).blob();
      signal?.throwIfAborted();
      if (blob.size !== result.byteSize) throw new Error('本机视频传输不完整，请重试');
      return blob.slice(0, blob.size, result.mimeType);
    } finally {
      signal?.removeEventListener('abort', abort);
      if (token) await session.request('release', { token }).catch(() => {});
      session.close();
    }
  }, signal);
}
