import { waitForAgentTab } from './agent-capture.js';
import { PAGE_CAPTURE_LIMITS } from "./resource-limits.js";
import { readXPostHtml, xVideoSourcesFromHtml } from './x-post-metadata.js';

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
      if (String(node.rest_id || legacy.id_str || "") === postId) {
        const own = node.result || node;
        const quoted = own.quoted_status_result?.result || own.quoted_tweet_results?.result;
        const media = [own, quoted].filter(Boolean).flatMap(tweet => {
          const details = tweet.legacy || tweet;
          const ownerId = String(tweet.rest_id || details.id_str || '');
          return (tweet.media_entities2 || details.extended_entities?.media || []).filter(item =>
            !item.source_status_id_str || item.source_status_id_str === ownerId).flatMap(item => {
            let workUrl = '';
            if (ownerId !== postId) {
              try {
                const url = new URL(item.expanded_url);
                if (url.protocol !== 'https:' || !/^(?:www\.)?(?:x|twitter)\.com$/u.test(url.hostname)
                  || url.username || url.password || url.pathname.match(/^\/[^/]+\/status\/(\d+)\/video\/\d+$/u)?.[1] !== ownerId) return [];
                url.pathname = url.pathname.replace(/\/video\/\d+$/u, ''); url.search = ''; url.hash = '';
                workUrl = url.href;
              } catch { return []; }
            }
            const variants = (item.video_info?.variants || []).flatMap(variant => {
              const url = mediaUrl(variant.url);
              return url && ['video/mp4', 'application/x-mpegURL'].includes(variant.content_type)
                && !/\/(?:vid|aud)\/[^/]+\/\d+\/\d+\//u.test(new URL(url).pathname)
                ? [{ url, mimeType: variant.content_type, bitrate: Number(variant.bitrate) || 0 }] : [];
            });
            variants.sort((a, b) => Number(b.mimeType === 'video/mp4') - Number(a.mimeType === 'video/mp4') || b.bitrate - a.bitrate);
            return variants.length ? [{ id: String(item.id_str || ''), posterUrl: String(item.media_url_https || ''), variants,
              ...(workUrl ? { workUrl } : {}) }] : [];
          });
        }).slice(0, maxMedia);
        if (media.length) { state.media = media; state.stop(); return; }
      }
      // A quote is its own post; matching by ID above prevents unrelated reply/quote substitution.
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
    const videos = candidate.media.filter(item => item.kind === "video");
    const replacements = new Map();
    const media = candidate.media.map(item => {
      if (!videos.includes(item)) return item;
      const source = result.media.find(value => value.posterUrl && item.posterUrl
        && xPosterIdentity(value.posterUrl) === xPosterIdentity(item.posterUrl))
        || (!item.isQuoted && videos.filter(value => !value.isQuoted).length === 1
          && result.media.length === 1 && (!result.media[0].workUrl || xPostId(result.media[0].workUrl) === result.postId) ? result.media[0] : null);
      if (!source) return item;
      if (item.isQuoted && (!source.workUrl || xPostId(source.workUrl) === result.postId)) return item;
      const best = source.variants[0];
      replacements.set(item.id, best.url);
      return { ...item, url: best.url, variants: [], mimeType: best.mimeType,
        sourceKind: "site-original", originalWorkUrl: source.workUrl || candidate.canonicalUrl,
        ...(item.isQuoted ? { quotedPostUrl: source.workUrl } : {}),
        ...(source.variants.find(value => value.mimeType === "application/x-mpegURL")
          ? { streamUrl: source.variants.find(value => value.mimeType === "application/x-mpegURL").url } : {}) };
    });
    return { ...candidate, media, ...(candidate.articleDocument ? { articleDocument: {
      ...candidate.articleDocument, blocks: candidate.articleDocument.blocks.map(block => replacements.has(block.assetId)
        ? { ...block, sourceUrl: replacements.get(block.assetId) } : block)
    } } : {}) };
  }) };
}

function xPosterIdentity(value) {
  try {
    const url = new URL(value);
    if (url.hostname === 'pbs.twimg.com') {
      url.pathname = url.pathname.replace(/\.(?:jpe?g|png|webp)$/iu, '');
      url.search = '';
    }
    return url.href;
  } catch { return ''; }
}

function xPostId(value) {
  try {
    const url = new URL(value);
    return /(^|\.)(x|twitter)\.com$/u.test(url.hostname)
      ? /^\/(?:[^/]+\/status|i\/web\/status)\/(\d+)/u.exec(url.pathname)?.[1] || "" : "";
  } catch { return ""; }
}

export async function resolveXVideoSources(snapshot, tab, api, { cancelled = () => false, readHtml = readXPostHtml, allowTabReload = true, allowTemporaryTab = false, deadline = Date.now() + PAGE_CAPTURE_LIMITS.navigationTimeoutMs } = {}) {
  const postId = xPostId(tab.url);
  const unresolved = (snapshot.candidates || []).some(candidate => xPostId(candidate.canonicalUrl) === postId
    && candidate.media?.some(item => item.kind === "video" && !/\.mp4(?:\?|$)/iu.test(item.url || "")));
  if (!postId || !unresolved || cancelled()) return snapshot;
  const controller = new AbortController();
  const cancelCheck = setInterval(() => { if (cancelled()) controller.abort(); }, 250);
  try {
    const result = xVideoSourcesFromHtml(await readHtml(tab.url, { signal: controller.signal }), tab.url);
    if (cancelled()) return snapshot;
    if (result?.media.some(item => item.variants[0]?.mimeType === 'video/mp4')) {
      snapshot = applyXVideoSources(snapshot, result);
      if (!(snapshot.candidates || []).some(candidate => xPostId(candidate.canonicalUrl) === postId
        && candidate.media?.some(item => item.kind === 'video' && !/\.mp4(?:\?|$)/iu.test(item.url || '')))) return snapshot;
    }
  } catch { /* Logged-in-only posts retain the normal-response observer path. */ }
  finally { clearInterval(cancelCheck); }
  if ((!allowTabReload && !allowTemporaryTab) || cancelled() || Date.now() >= deadline) return snapshot;
  const id = `capture-x-video-${tab.id ?? postId}`;
  let registered = false, temporary = null;
  let observedTab = tab;
  try {
    await api.scripting.unregisterContentScripts({ ids: [id] }).catch(() => undefined);
    const url = new URL(tab.url);
    await api.scripting.registerContentScripts([{ id, matches: [`${url.origin}${url.pathname}*`],
      js: ["x-video-observer.js"], world: "MAIN", runAt: "document_start", persistAcrossSessions: false }]);
    registered = true;
    if (allowTabReload) await api.tabs.reload(tab.id);
    else {
      // Register before navigation so even the first normal response is seen;
      // the selected source page and its scroll/playback state stay untouched.
      temporary = await api.tabs.create({ url: tab.url, active: false });
      observedTab = temporary;
      await waitForAgentTab(api.tabs, temporary.id, Math.max(1, deadline - Date.now()));
    }
    while (Date.now() < deadline && !cancelled()) {
      const current = await api.tabs.get(observedTab.id);
      if (xPostId(current.url) !== postId) break;
      const results = await api.scripting.executeScript({ target: { tabId: observedTab.id }, world: "MAIN",
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
    await api.scripting.executeScript({ target: { tabId: observedTab.id }, world: "MAIN",
      func: () => { globalThis.__PROMPTDIRECTOR_X_VIDEO__?.stop?.(); delete globalThis.__PROMPTDIRECTOR_X_VIDEO__; }
    }).catch(() => undefined);
    if (temporary) await api.tabs.remove(temporary.id).catch(() => undefined);
  }
  return snapshot;
}
