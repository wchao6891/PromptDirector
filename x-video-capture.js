import { PAGE_CAPTURE_LIMITS } from "./resource-limits.js";

// Serialized into the document-start runtime by build:capture-runtime.
// Observe the selected post's normal responses; never issue API requests.
export function installXVideoObserver({ timeoutMs, maxBytes, maxMedia }) {
  const key = "__PROMPTDIRECTOR_X_VIDEO__";
  const postId = /^\/(?:[^/]+\/status|i\/web\/status)\/(\d+)/u.exec(location.pathname)?.[1];
  if (!postId || !/(^|\.)(x|twitter)\.com$/u.test(location.hostname) || globalThis[key]) return;
  const state = { postId, media: [], done: false };
  globalThis[key] = state;
  const mediaUrl = (value) => {
    try {
      const url = new URL(value);
      return url.protocol === "https:" && url.hostname === "video.twimg.com" ? url.href : "";
    } catch { return ""; }
  };
  const ingest = (payload) => {
    if (state.done) return;
    const pending = [payload];
    while (pending.length) {
      const node = pending.pop();
      if (!node || typeof node !== "object") continue;
      const legacy = node.legacy || node;
      if (String(node.rest_id || legacy.id_str || "") === postId && legacy.extended_entities?.media) {
        const media = legacy.extended_entities.media.filter(item =>
          !item.source_status_id_str || item.source_status_id_str === postId).flatMap(item => {
          const variants = (item.video_info?.variants || []).flatMap(variant => {
            const url = mediaUrl(variant.url);
            return url && ["video/mp4", "application/x-mpegURL"].includes(variant.content_type)
              ? [{ url, mimeType: variant.content_type, bitrate: Number(variant.bitrate) || 0 }] : [];
          });
          variants.sort((a, b) => Number(b.mimeType === "video/mp4") - Number(a.mimeType === "video/mp4") || b.bitrate - a.bitrate);
          return variants.length ? [{ id: String(item.id_str || ""), posterUrl: String(item.media_url_https || ""), variants }] : [];
        }).slice(0, maxMedia);
        if (media.length) { state.media = media; state.stop(); return; }
      }
      // A quote is its own post; matching by ID above prevents reply/quote substitution.
      pending.push(...Object.values(node).filter(value => value && typeof value === "object"));
    }
  };
  const isResponseUrl = (value) => {
    try {
      const url = new URL(value, location.href);
      return url.origin === location.origin && url.pathname.startsWith("/i/api/");
    } catch { return false; }
  };
  const parse = (text) => {
    if (!state.done && typeof text === "string" && text.length <= maxBytes) {
      try { ingest(JSON.parse(text)); } catch { /* Unrelated or non-JSON response. */ }
    }
  };
  const originalFetch = globalThis.fetch;
  const Xhr = globalThis.XMLHttpRequest;
  const originalOpen = Xhr?.prototype.open;
  const originalSend = Xhr?.prototype.send;
  const requests = new WeakSet();
  const observedFetch = async function (...args) {
    const response = await originalFetch.apply(this, args);
    if (!state.done && response.ok && isResponseUrl(response.url || args[0]?.url || args[0])) {
      const copy = response.clone();
      (async () => {
        const reader = copy.body.getReader();
        const chunks = []; let bytes = 0;
        try {
          while (!state.done) {
            const part = await reader.read();
            if (part.done) break;
            bytes += part.value.byteLength;
            if (bytes > maxBytes) return;
            chunks.push(part.value);
          }
          if (!state.done) parse(await new Blob(chunks).text());
        } finally { await reader.cancel().catch(() => undefined); }
      })().catch(() => undefined);
    }
    return response;
  };
  const observedOpen = function (method, url, ...rest) {
    requests.delete(this);
    if (isResponseUrl(url)) requests.add(this);
    return originalOpen.call(this, method, url, ...rest);
  };
  const observedSend = function (...args) {
    if (requests.has(this)) this.addEventListener("loadend", () => {
      if (state.done || this.status < 200 || this.status >= 300) return;
      try {
        if (this.responseType === "json") parse(JSON.stringify(this.response));
        else if (!this.responseType || this.responseType === "text") parse(this.responseText);
      } catch { /* Page response type changed. */ }
    }, { once: true });
    return originalSend.apply(this, args);
  };
  let timer;
  state.stop = () => {
    state.done = true;
    clearTimeout(timer);
    if (globalThis.fetch === observedFetch) globalThis.fetch = originalFetch;
    if (Xhr?.prototype.open === observedOpen) Xhr.prototype.open = originalOpen;
    if (Xhr?.prototype.send === observedSend) Xhr.prototype.send = originalSend;
  };
  if (originalFetch) globalThis.fetch = observedFetch;
  if (Xhr) { Xhr.prototype.open = observedOpen; Xhr.prototype.send = observedSend; }
  timer = setTimeout(state.stop, timeoutMs);
}

export function applyXVideoSources(snapshot, result) {
  if (!result?.media?.length) return snapshot;
  return { ...snapshot, candidates: (snapshot.candidates || []).map(candidate => {
    if (xPostId(candidate.canonicalUrl) !== result.postId) return candidate;
    const videos = candidate.media.filter(item => item.kind === "video" && !item.isQuoted);
    return { ...candidate, media: candidate.media.map(item => {
      if (!videos.includes(item)) return item;
      const source = result.media.find(value => value.posterUrl && value.posterUrl === item.posterUrl)
        || (videos.length === 1 && result.media.length === 1 ? result.media[0] : null);
      if (!source) return item;
      const best = source.variants[0];
      return { ...item, url: best.url, variants: [], mimeType: best.mimeType,
        sourceKind: "site-original", originalWorkUrl: candidate.canonicalUrl,
        ...(source.variants.find(value => value.mimeType === "application/x-mpegURL")
          ? { streamUrl: source.variants.find(value => value.mimeType === "application/x-mpegURL").url } : {}) };
    }) };
  }) };
}

function xPostId(value) {
  try {
    const url = new URL(value);
    return /(^|\.)(x|twitter)\.com$/u.test(url.hostname)
      ? /^\/(?:[^/]+\/status|i\/web\/status)\/(\d+)/u.exec(url.pathname)?.[1] || "" : "";
  } catch { return ""; }
}

export async function resolveXVideoSources(snapshot, tab, api, { cancelled = () => false } = {}) {
  const postId = xPostId(tab.url);
  const unresolved = (snapshot.candidates || []).some(candidate => xPostId(candidate.canonicalUrl) === postId
    && candidate.media?.some(item => item.kind === "video" && !item.isQuoted && !/\.mp4(?:\?|$)/iu.test(item.url || "")));
  if (!postId || !unresolved || cancelled()) return snapshot;
  const id = `capture-x-video-${tab.id}`;
  let registered = false;
  try {
    await api.scripting.unregisterContentScripts({ ids: [id] }).catch(() => undefined);
    const url = new URL(tab.url);
    await api.scripting.registerContentScripts([{ id, matches: [`${url.origin}${url.pathname}*`],
      js: ["x-video-observer.js"], world: "MAIN", runAt: "document_start", persistAcrossSessions: false }]);
    registered = true;
    await api.tabs.reload(tab.id);
    const deadline = Date.now() + PAGE_CAPTURE_LIMITS.navigationTimeoutMs;
    while (Date.now() < deadline && !cancelled()) {
      const current = await api.tabs.get(tab.id);
      if (xPostId(current.url) !== postId) break;
      const results = await api.scripting.executeScript({ target: { tabId: tab.id }, world: "MAIN",
        func: () => {
          const state = globalThis.__PROMPTDIRECTOR_X_VIDEO__;
          return state ? { postId: state.postId, media: state.media, done: state.done } : null;
        } }).catch(() => []);
      const state = results[0]?.result;
      if (state?.media?.length) return applyXVideoSources(snapshot, state);
      if (state?.done) break;
      await new Promise(resolve => setTimeout(resolve, 250));
    }
  } catch (error) {
    console.warn("[capture-video] Selected post video source unavailable:", error?.name || "Error");
  } finally {
    if (registered) await api.scripting.unregisterContentScripts({ ids: [id] }).catch(() => undefined);
    await api.scripting.executeScript({ target: { tabId: tab.id }, world: "MAIN",
      func: () => { globalThis.__PROMPTDIRECTOR_X_VIDEO__?.stop?.(); delete globalThis.__PROMPTDIRECTOR_X_VIDEO__; }
    }).catch(() => undefined);
  }
  return snapshot;
}
