import { PORTABLE_LIBRARY_LIMITS } from "./resource-limits.js";

const PROVIDERS = Object.freeze({
  youtube: { label: "YouTube", origins: ["https://www.youtube.com/*", "https://youtu.be/*", "https://i.ytimg.com/*"] },
  vimeo: { label: "Vimeo", origins: ["https://vimeo.com/*", "https://i.vimeocdn.com/*"] },
  bilibili: { label: "Bilibili", origins: ["https://www.bilibili.com/*", "https://b23.tv/*", "https://bili2233.cn/*"] },
  douyin: { label: "抖音", origins: ["https://www.douyin.com/*", "https://v.douyin.com/*", "https://iesdouyin.com/*"] },
  x: { label: "X", origins: ["https://x.com/*", "https://twitter.com/*", "https://mobile.twitter.com/*", "https://t.co/*", "https://publish.twitter.com/*"] },
  generic: { label: "视频来源", origins: [] }
});

export const MEDIA_REFERENCE_PROVIDERS = Object.freeze(Object.keys(PROVIDERS));

export function detectMediaReferenceProvider(value) {
  const url = safeUrl(value);
  if (!url) return "";
  const host = url.hostname.toLocaleLowerCase("en-US");
  if (host === "youtu.be" || host === "youtube.com" || host.endsWith(".youtube.com")) return "youtube";
  if (host === "vimeo.com" || host.endsWith(".vimeo.com")) return "vimeo";
  if (host === "b23.tv" || host === "bili2233.cn" || host === "bilibili.com" || host.endsWith(".bilibili.com")) return "bilibili";
  if (host === "v.douyin.com" || host === "douyin.com" || host.endsWith(".douyin.com") || host === "iesdouyin.com" || host.endsWith(".iesdouyin.com")) return "douyin";
  if (["x.com", "twitter.com", "mobile.twitter.com", "t.co"].includes(host) || host.endsWith(".x.com") || host.endsWith(".twitter.com")) return "x";
  return "generic";
}

export function canonicalizeMediaReference(value, providerValue = "") {
  const source = safeUrl(value);
  if (!source) throw new Error("只支持有效的 http 或 https 视频网页地址");
  const provider = providerValue || detectMediaReferenceProvider(source);
  const url = new URL(source.href);
  url.hash = "";
  if (provider === "youtube") {
    const id = youtubeId(url);
    if (id) return `https://www.youtube.com/watch?v=${encodeURIComponent(id)}`;
  }
  if (provider === "bilibili") {
    const identity = bilibiliIdentity(url);
    if (identity) {
      const page = positiveInteger(url.searchParams.get("p"));
      const suffix = page > 1 ? `?p=${page}` : "";
      if (identity.bvid) return `https://www.bilibili.com/video/${encodeURIComponent(identity.bvid)}/${suffix}`;
      if (identity.aid) return `https://www.bilibili.com/video/av${identity.aid}/${suffix}`;
      if (identity.episodeId) return `https://www.bilibili.com/bangumi/play/ep${identity.episodeId}`;
    }
  }
  if (provider === "x" && ["twitter.com", "mobile.twitter.com"].includes(url.hostname)) url.hostname = "x.com";
  for (const key of [...url.searchParams.keys()]) {
    if (!allowedQueryParameter(provider, key)) url.searchParams.delete(key);
  }
  return url.href;
}

export async function resolveMediaReference(value, context = {}) {
  let canonicalUrl = canonicalizeMediaReference(value);
  let provider = detectMediaReferenceProvider(canonicalUrl);
  const base = () => ({
    provider,
    providerLabel: PROVIDERS[provider]?.label || PROVIDERS.generic.label,
    canonicalUrl,
    title: "",
    author: "",
    posterUrl: "",
    durationMs: 0,
    playbackMode: ["youtube", "vimeo", "bilibili", "douyin", "x"].includes(provider) ? "embed" : "source",
    playback: mediaPlaybackCapability(canonicalUrl, provider)
  });
  if (provider === "generic" || typeof context.fetch !== "function") {
    return { ...base(), metadataStatus: "partial" };
  }
  const origins = PROVIDERS[provider].origins;
  if (typeof context.requestOrigins === "function" && !await context.requestOrigins(origins)) {
    return { ...base(), metadataStatus: "permission-denied" };
  }
  try {
    const metadata = await fetchMetadata(canonicalUrl, provider, context);
    if (metadata.finalUrl) {
      const finalProvider = detectMediaReferenceProvider(metadata.finalUrl);
      if (provider !== finalProvider) throw new Error("视频短链接跳转到了不受信任的网站");
      canonicalUrl = canonicalizeMediaReference(metadata.finalUrl, provider);
      provider = finalProvider;
    }
    const result = { ...base(), ...cleanMetadata(metadata) };
    const resolved = Boolean(result.title && (result.author || result.posterUrl || result.durationMs));
    return { ...result, metadataStatus: resolved ? "resolved" : "partial" };
  } catch {
    return { ...base(), metadataStatus: "unavailable" };
  }
}

export function officialMediaEmbedUrl(value, providerValue = "") {
  const url = safeUrl(value);
  if (!url) return "";
  const provider = providerValue || detectMediaReferenceProvider(url);
  if (provider === "youtube") {
    const id = youtubeId(url);
    return id ? `https://www.youtube-nocookie.com/embed/${encodeURIComponent(id)}?enablejsapi=1&playsinline=1` : "";
  }
  if (provider === "vimeo") {
    const id = url.pathname.match(/^\/(\d+)/u)?.[1] || "";
    return id ? `https://player.vimeo.com/video/${id}` : "";
  }
  if (provider === "bilibili") {
    const identity = bilibiliIdentity(url);
    if (!identity) return "";
    const params = new URLSearchParams();
    if (identity.bvid) params.set("bvid", identity.bvid);
    else if (identity.aid) params.set("aid", identity.aid);
    else if (identity.episodeId) params.set("episodeId", identity.episodeId);
    if (identity.cid) params.set("cid", identity.cid);
    const page = positiveInteger(url.searchParams.get("p"));
    if (page > 1) params.set("p", String(page));
    params.set("autoplay", "0");
    params.set("poster", "1");
    return `https://player.bilibili.com/player.html?${params}`;
  }
  if (provider === "douyin") {
    const id = url.pathname.match(/\/video\/(\d+)/u)?.[1] || "";
    return id ? `https://open.douyin.com/player/video?vid=${encodeURIComponent(id)}&autoplay=0` : "";
  }
  if (provider === "x") {
    const id = url.pathname.match(/\/status\/(\d+)/u)?.[1] || "";
    return id ? `https://platform.twitter.com/embed/Tweet.html?id=${encodeURIComponent(id)}&dnt=true` : "";
  }
  return "";
}

export function mediaReferenceProviderLabel(provider) {
  return PROVIDERS[provider]?.label || PROVIDERS.generic.label;
}

async function fetchMetadata(url, provider, context) {
  if (provider === "youtube" || provider === "vimeo" || provider === "x") {
    const endpoint = provider === "youtube"
      ? `https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(url)}`
      : provider === "vimeo"
        ? `https://vimeo.com/api/oembed.json?url=${encodeURIComponent(url)}`
        : `https://publish.twitter.com/oembed?omit_script=true&dnt=true&url=${encodeURIComponent(url)}`;
    const response = await context.fetch(endpoint, fetchOptions());
    if (!response.ok) throw new Error(`元数据服务返回 HTTP ${response.status}`);
    const payload = await response.json();
    return {
      title: payload?.title,
      author: payload?.author_name,
      posterUrl: payload?.thumbnail_url,
      durationMs: secondsToMilliseconds(payload?.duration)
    };
  }
  const response = await context.fetch(url, fetchOptions());
  if (!response.ok) throw new Error(`来源页返回 HTTP ${response.status}`);
  const declaredSize = Number(response.headers?.get?.("content-length")) || 0;
  if (declaredSize > PORTABLE_LIBRARY_LIMITS.maxFileBytes) throw new Error("来源页过大，已停止解析");
  const html = await response.text();
  if (new TextEncoder().encode(html).byteLength > PORTABLE_LIBRARY_LIMITS.maxFileBytes) throw new Error("来源页过大，已停止解析");
  return { ...parseOpenGraphMetadata(html), finalUrl: response.url || url };
}

export function parseOpenGraphMetadata(source) {
  const values = new Map();
  for (const match of String(source ?? "").matchAll(/<meta\s+[^>]*(?:property|name)\s*=\s*["']([^"']+)["'][^>]*content\s*=\s*["']([^"']*)["'][^>]*>|<meta\s+[^>]*content\s*=\s*["']([^"']*)["'][^>]*(?:property|name)\s*=\s*["']([^"']+)["'][^>]*>/giu)) {
    values.set(clean(match[1] || match[4]).toLocaleLowerCase("en-US"), decodeHtml(match[2] || match[3]));
  }
  return {
    title: values.get("og:title") || values.get("twitter:title") || "",
    author: values.get("author") || values.get("og:site_name") || "",
    posterUrl: values.get("og:image") || values.get("twitter:image") || "",
    durationMs: secondsToMilliseconds(values.get("video:duration") || values.get("og:video:duration"))
  };
}

function cleanMetadata(value) {
  return {
    title: clean(value?.title).replace(/[\u0000-\u001f\u007f]/gu, ""),
    author: clean(value?.author).replace(/[\u0000-\u001f\u007f]/gu, ""),
    posterUrl: safeUrl(value?.posterUrl)?.href || "",
    durationMs: positiveInteger(value?.durationMs)
  };
}

function youtubeId(url) {
  return url.hostname === "youtu.be"
    ? url.pathname.slice(1).split("/")[0]
    : url.searchParams.get("v") || url.pathname.match(/\/(?:shorts|embed|live)\/([^/?]+)/u)?.[1] || "";
}

function bilibiliIdentity(url) {
  const bvid = clean(url.searchParams.get("bvid") || url.pathname.match(/\/video\/(BV[\w]+)/iu)?.[1]);
  const aid = positiveInteger(url.searchParams.get("aid") || url.pathname.match(/\/video\/av(\d+)/iu)?.[1]);
  const episodeId = positiveInteger(url.searchParams.get("episodeId") || url.pathname.match(/\/bangumi\/play\/ep(\d+)/iu)?.[1]);
  const cid = positiveInteger(url.searchParams.get("cid"));
  return bvid || aid || episodeId ? { bvid, aid, episodeId, cid } : null;
}

function mediaPlaybackCapability(canonicalUrl, provider) {
  const embedUrl = officialMediaEmbedUrl(canonicalUrl, provider);
  if (!embedUrl) {
    return { provider, canonicalUrl, embedUrl: "", status: "failed", blockReason: "此来源没有可验证的官方内嵌播放器" };
  }
  return {
    provider,
    canonicalUrl,
    embedUrl,
    status: provider === "youtube" ? "permission-required" : "loading",
    blockReason: ""
  };
}

function allowedQueryParameter(provider, key) {
  if (provider === "youtube") return key === "v";
  if (provider === "bilibili") return key === "p";
  return false;
}

function fetchOptions() {
  return { credentials: "omit", redirect: "follow", referrerPolicy: "no-referrer" };
}

function safeUrl(value) {
  try {
    const url = value instanceof URL ? value : new URL(String(value ?? ""));
    return ["http:", "https:"].includes(url.protocol) && url.username === "" && url.password === "" ? url : null;
  } catch {
    return null;
  }
}

function secondsToMilliseconds(value) {
  const seconds = Number(value);
  return Number.isFinite(seconds) && seconds > 0 ? Math.round(seconds * 1000) : 0;
}

function positiveInteger(value) {
  const number = Math.floor(Number(value) || 0);
  return Number.isSafeInteger(number) && number > 0 ? number : 0;
}

function decodeHtml(value) {
  return clean(value).replace(/&(?:amp|#38);/giu, "&").replace(/&(?:quot|#34);/giu, '"').replace(/&(?:apos|#39);/giu, "'").replace(/&(?:lt|#60);/giu, "<").replace(/&(?:gt|#62);/giu, ">");
}

function clean(value) {
  return String(value ?? "").trim();
}
