const PAGE_TYPES = new Set(["article", "artwork", "post", "gallery", "feed", "video", "generic"]);
const COMPLETENESS = new Set(["complete", "partial"]);

export const PAGE_CAPTURE_ADAPTERS = Object.freeze([
  { id: "jimeng", hosts: ["jimeng.jianying.com"], cardSelectors: ["[data-testid*=work]", "[class*=masonry] > *"], fields: { title: ["[class*=title]"], author: ["[class*=author]"], model: ["[class*=model]"] } },
  { id: "liblibai", hosts: ["liblib.art", "liblibai.com"], cardSelectors: ["[class*=work-card]", "[class*=waterfall] > *"], fields: { title: ["[class*=title]"], author: ["[class*=user]"], model: ["[class*=model]"] } },
  { id: "higgsfield", hosts: ["higgsfield.ai"], cardSelectors: ["[data-testid*=creation]", "[class*=feed] > article"], fields: { title: ["[data-testid*=title]"], author: ["[data-testid*=author]"] } },
  { id: "krea", hosts: ["krea.ai"], cardSelectors: ["[data-testid*=generation]", "[class*=gallery] > *"], fields: { title: ["[data-testid*=title]"], model: ["[data-testid*=model]"] } },
  { id: "tapnow", hosts: ["tapnow.ai"], cardSelectors: ["[data-testid*=work]", "[class*=gallery] > *"], fields: { title: ["[class*=title]"], author: ["[class*=author]"] } },
  { id: "pinterest", hosts: ["pinterest.com", "pin.it"], cardSelectors: ["[data-test-id=pin]", "[data-grid-item]"], fields: { title: ["[data-test-id*=title]"], author: ["[data-test-id*=creator]"] } },
  { id: "artstation", hosts: ["artstation.com"], cardSelectors: [".project", "[data-test=project-card]"], fields: { title: [".project-title", "[class*=title]"], author: [".user-name", "[class*=artist]"] } },
  { id: "x", hosts: ["x.com", "twitter.com"], cardSelectors: ["article[data-testid=tweet]"], fields: { author: ["[data-testid=User-Name]"], publishedAt: ["time"], likes: ["[data-testid=like]"], reposts: ["[data-testid=retweet]"] } },
  { id: "reddit", hosts: ["reddit.com"], cardSelectors: ["shreddit-post", "article"], fields: { title: ["[slot=title]", "h1,h2,h3"], author: ["[slot=authorName]", "[class*=author]"], publishedAt: ["time"] } },
  { id: "youtube", hosts: ["youtube.com", "youtu.be"], cardSelectors: ["ytd-rich-item-renderer", "ytd-video-renderer"], fields: { title: ["#video-title"], author: ["#channel-name"], views: ["#metadata-line span"] } },
  { id: "bilibili", hosts: ["bilibili.com", "b23.tv"], cardSelectors: [".bili-video-card", ".video-card"], fields: { title: ["[class*=title]"], author: ["[class*=owner]"], views: ["[class*=play]"] } },
  { id: "steam", hosts: ["steampowered.com", "steamcommunity.com"], cardSelectors: [".apphub_Card", ".search_result_row", ".workshopItem"], fields: { title: [".title", "[class*=title]"], author: ["[class*=author]"], publishedAt: ["time", "[class*=date]"] } }
]);

export function detectPageCaptureAdapter(value, adapters = PAGE_CAPTURE_ADAPTERS) {
  let host;
  try { host = new URL(value).hostname.toLocaleLowerCase("en-US"); }
  catch { host = String(value ?? "").toLocaleLowerCase("en-US"); }
  return adapters.find((item) => item.hosts.some((suffix) => host === suffix || host.endsWith(`.${suffix}`)))
    || { id: "generic", hosts: [], cardSelectors: ["main article", "[role=main] article"] };
}

export function normalizePageCaptureBatch(value = {}) {
  const candidates = uniqueCandidates(value.candidates);
  const legacySelections = Array.isArray(value.selectedIds)
    ? value.selectedIds.map((candidateId) => {
      const candidate = candidates.find((item) => item.id === clean(candidateId));
      return candidate ? {
        candidateId: candidate.id,
        includeText: Boolean(candidate.contentText || candidate.excerpt),
        selectedMediaIds: candidate.media.map((item) => item.id)
      } : null;
    }).filter(Boolean)
    : [];
  const selections = (Array.isArray(value.selections) ? value.selections : legacySelections)
    .map((selection) => normalizePageCaptureSelection(selection, candidates))
    .filter(Boolean);
  return {
    id: clean(value.id) || globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random()}`,
    tabId: Number.isInteger(Number(value.tabId)) ? Number(value.tabId) : null,
    sourceUrl: safeUrl(value.sourceUrl),
    adapter: clean(value.adapter) || "generic",
    status: ["preview", "scanning", "saving", "completed", "cancelled", "failed"].includes(value.status) ? value.status : "preview",
    candidates,
    selections,
    discoveredCount: candidates.length,
    createdAt: validIso(value.createdAt) || new Date().toISOString(),
    error: clean(value.error)
  };
}

export function normalizePageCaptureSelection(value = {}, candidatesValue = []) {
  const candidates = Array.isArray(candidatesValue) ? candidatesValue : [];
  const candidateId = clean(value.candidateId);
  const candidate = candidates.find((item) => item.id === candidateId);
  if (!candidate) return null;
  const mediaIds = new Set(candidate.media.map((item) => item.id));
  const selectedMediaIds = [...new Set((Array.isArray(value.selectedMediaIds) ? value.selectedMediaIds : [])
    .map(clean).filter((id) => mediaIds.has(id)))];
  const includeText = value.includeText === true && Boolean(candidate.contentText || candidate.excerpt);
  return includeText || selectedMediaIds.length ? { candidateId, includeText, selectedMediaIds } : null;
}

export function applyPageCaptureSelections(batchValue = {}) {
  const batch = normalizePageCaptureBatch(batchValue);
  return batch.selections.flatMap((selection) => {
    const candidate = batch.candidates.find((item) => item.id === selection.candidateId);
    if (!candidate) return [];
    const selectedMediaIds = new Set(selection.selectedMediaIds);
    return [{
      ...candidate,
      contentHtml: selection.includeText ? candidate.contentHtml : "",
      contentText: selection.includeText ? candidate.contentText : "",
      excerpt: selection.includeText ? candidate.excerpt : "",
      media: candidate.media.filter((item) => selectedMediaIds.has(item.id))
    }];
  });
}

export function normalizePageCaptureCandidate(value = {}) {
  const canonicalUrl = safeUrl(value.canonicalUrl || value.url);
  const title = clean(value.title);
  if (!canonicalUrl && !title) return null;
  return {
    id: clean(value.id) || stableCandidateId(canonicalUrl, title),
    pageType: PAGE_TYPES.has(value.pageType) ? value.pageType : "generic",
    title: title || hostname(canonicalUrl),
    canonicalUrl,
    contentHtml: String(value.contentHtml ?? ""),
    contentText: normalizeText(value.contentText),
    excerpt: clean(value.excerpt),
    media: uniqueMedia(value.media),
    sourceFacts: normalizeSourceFacts(value.sourceFacts, canonicalUrl),
    completeness: COMPLETENESS.has(value.completeness) ? value.completeness : "partial",
    adapter: clean(value.adapter) || "generic"
  };
}

export function normalizeSourceFacts(value = {}, canonicalUrl = "") {
  const engagement = Object.fromEntries(Object.entries(value.engagement || {}).flatMap(([key, amount]) => {
    const number = Number(amount);
    return clean(key) && Number.isFinite(number) && number >= 0 ? [[clean(key), number]] : [];
  }));
  const capturedAt = validIso(value.capturedAt) || new Date().toISOString();
  return {
    provider: clean(value.provider) || hostname(canonicalUrl),
    pageType: PAGE_TYPES.has(value.pageType) ? value.pageType : "generic",
    itemId: clean(value.itemId),
    author: clean(value.author),
    handle: clean(value.handle),
    publishedAt: validIso(value.publishedAt),
    capturedAt,
    model: clean(value.model),
    dimensions: clean(value.dimensions),
    duration: clean(value.duration),
    license: clean(value.license),
    engagement,
    engagementObservedAt: Object.keys(engagement).length
      ? validIso(value.engagementObservedAt) || capturedAt
      : "",
    status: value.status === "complete" ? "complete" : "partial"
  };
}

export function pageCapturePermissionOrigins(candidates = []) {
  const origins = new Set();
  for (const candidate of candidates) {
    for (const media of normalizePageCaptureCandidate(candidate)?.media || []) {
      try {
        const url = new URL(media.url || media.posterUrl);
        if (["http:", "https:"].includes(url.protocol)) origins.add(`${url.origin}/*`);
      } catch {
      }
    }
  }
  return [...origins].sort();
}

export async function collectPageCaptureSnapshot(options = {}) {
  function clean(value) {
    return String(value ?? "").replace(/[\u0000-\u001f\u007f]/g, " ").trim();
  }
  const capturedAt = new Date().toISOString();
  const sessionId = clean(options.sessionId);
  let cancelled = false;
  const handleCaptureMessage = (message, _sender, sendResponse) => {
    if (message?.type !== "PROMPTDIRECTOR_PAGE_CAPTURE" || message.sessionId !== sessionId) return undefined;
    if (message.action === "cancel") {
      cancelled = true;
      sendResponse({ ok: true, sessionId, cancelled: true });
      return false;
    }
    return undefined;
  };
  if (sessionId) globalThis.chrome?.runtime?.onMessage?.addListener?.(handleCaptureMessage);
  const maxCandidates = positiveInteger(options.maxCandidates, 100);
  const maxMedia = positiveInteger(options.maxMedia, 24);
  const maxInlinePixelDataCharacters = positiveInteger(options.maxInlinePixelDataCharacters, 1);
  const wholePage = options.mode === "whole";
  const originalScroll = { x: window.scrollX, y: window.scrollY };

  try {
    const adapter = detectAdapter(location.hostname);
    const canonicalUrl = safeHttpUrl(document.querySelector('link[rel="canonical"]')?.href || location.href);
    const metadata = collectMetadata();
    const structured = collectStructuredData();
    const article = readArticle();
    const accumulated = new Map();
    const collectVisible = () => {
      const cardRoots = adapter.cardSelectors.flatMap((selector) => [...document.querySelectorAll(selector)]);
      const roots = [...new Set(cardRoots)].filter(isContentRoot);
      const pageType = detectPageType({ adapter, metadata, structured, article, cardCount: roots.length });
      for (const [index, root] of roots.entries()) {
        const candidate = candidateForRoot(root, index, {
          adapter, metadata, structured, article: null, canonicalUrl, pageType, maxMedia
        });
        if (candidate && !accumulated.has(candidate.id) && accumulated.size < maxCandidates) accumulated.set(candidate.id, candidate);
      }
    };
    collectVisible();
    if (wholePage) await scanLoadedPage(collectVisible);
    collectVisible();
    const capturedCards = [...accumulated.values()];
    const pageType = detectPageType({ adapter, metadata, structured, article, cardCount: capturedCards.length });
    const bodyCandidate = candidateForRoot(document.body, 0, {
      adapter, metadata, structured, article, canonicalUrl, pageType, maxMedia
    });
    const candidates = capturedCards.length > 1 && ["feed", "gallery"].includes(pageType)
      ? capturedCards.slice(0, maxCandidates)
      : bodyCandidate ? [bodyCandidate] : capturedCards.slice(0, maxCandidates);
    return {
      id: sessionId,
      sourceUrl: canonicalUrl,
      adapter: adapter.id,
      candidates,
      capturedAt
    };
  } finally {
    if (wholePage) window.scrollTo(originalScroll.x, originalScroll.y);
    if (sessionId) globalThis.chrome?.runtime?.onMessage?.removeListener?.(handleCaptureMessage);
  }

  async function scanLoadedPage(collectVisible) {
    const maxSteps = positiveInteger(options.maxScrollSteps, 30);
    let stableRounds = 0;
    let previousPosition = -1;
    for (let step = 0; step < maxSteps && stableRounds < 3 && !cancelled; step += 1) {
      const height = Math.max(document.body?.scrollHeight || 0, document.documentElement.scrollHeight);
      const viewport = Math.max(1, Number(window.innerHeight) || 720);
      const nextTop = Math.min(Math.max(0, height - viewport), Math.max(0, window.scrollY) + Math.round(viewport * 0.85));
      window.scrollTo({ top: nextTop, behavior: "instant" });
      await new Promise((resolve) => setTimeout(resolve, 450));
      collectVisible();
      const nextHeight = Math.max(document.body?.scrollHeight || 0, document.documentElement.scrollHeight);
      const position = Math.max(0, Number(window.scrollY) || nextTop);
      stableRounds = position === previousPosition && position + viewport >= nextHeight ? stableRounds + 1 : 0;
      previousPosition = position;
    }
  }

  function detectAdapter(host) {
    const adapters = Array.isArray(options.adapters) ? options.adapters : [];
    return adapters.find((item) => item.hosts.some((suffix) => host === suffix || host.endsWith(`.${suffix}`)))
      || { id: "generic", hosts: [], cardSelectors: ["main article", "[role=main] article"] };
  }

  function collectMetadata() {
    const value = (property, name = "property") => cleanText(document.querySelector(`meta[${name}="${property}"]`)?.content);
    return {
      title: value("og:title") || value("twitter:title", "name") || cleanText(document.title),
      description: value("og:description") || value("description", "name") || value("twitter:description", "name"),
      image: safeHttpUrl(value("og:image") || value("twitter:image", "name")),
      type: value("og:type"),
      siteName: value("og:site_name"),
      author: value("author", "name") || value("article:author"),
      publishedAt: value("article:published_time")
    };
  }

  function collectStructuredData() {
    const values = [];
    for (const script of document.querySelectorAll('script[type="application/ld+json"]')) {
      try {
        const parsed = JSON.parse(script.textContent || "null");
        values.push(...(Array.isArray(parsed) ? parsed : parsed?.["@graph"] || [parsed]));
      } catch {
      }
    }
    return values.filter((item) => item && typeof item === "object");
  }

  function readArticle() {
    try {
      if (typeof globalThis.Readability !== "function") return null;
      return new globalThis.Readability(document.cloneNode(true), { keepClasses: false }).parse();
    } catch {
      return null;
    }
  }

  function detectPageType({ adapter, metadata, structured, article, cardCount }) {
    const types = structured.flatMap((item) => Array.isArray(item["@type"]) ? item["@type"] : [item["@type"]]).filter(Boolean);
    if (types.includes("VideoObject") || ["youtube", "bilibili"].includes(adapter.id)) return "video";
    if (types.some((type) => ["Article", "NewsArticle", "BlogPosting"].includes(type)) || (article?.length || 0) > 500) return "article";
    if (cardCount > 1) return metadata.type === "website" ? "gallery" : "feed";
    if (["x", "reddit"].includes(adapter.id)) return "post";
    if (["jimeng", "liblibai", "higgsfield", "krea", "tapnow", "pinterest", "artstation", "steam"].includes(adapter.id)) return "artwork";
    return "generic";
  }

  function candidateForRoot(root, index, context) {
    const adapterFields = collectAdapterFields(root, context.adapter);
    const cardLink = root === document.body ? "" : safeHttpUrl(root.querySelector("a[href]")?.href);
    const canonicalUrl = cardLink || context.canonicalUrl;
    const structured = context.structured.find((item) => sameUrl(item.url || item.mainEntityOfPage, canonicalUrl)) || context.structured[0] || {};
    const title = cleanText(root === document.body
      ? context.article?.title || structured.headline || structured.name || context.metadata.title
      : adapterFields.title || root.querySelector("h1,h2,h3,[role=heading]")?.textContent || root.querySelector("img[alt]")?.alt || structured.name);
    const text = cleanText(root === document.body
      ? context.article?.textContent || structured.articleBody || context.metadata.description
      : root.innerText);
    const media = collectMedia(root, context.maxMedia);
    if (!title && !text && !media.length) return null;
    const pageType = root === document.body ? context.pageType : ["x", "reddit"].includes(context.adapter.id) ? "post" : "artwork";
    const author = cleanText(adapterFields.author || structured.author?.name || structured.author || context.metadata.author || root.querySelector('[rel=author],[data-testid*=author],[class*=author]')?.textContent);
    const itemId = itemIdFromUrl(canonicalUrl);
    return {
      id: `${context.adapter.id}:${itemId || index}:${hashText(`${canonicalUrl}\n${title}`)}`,
      pageType,
      title: title || context.metadata.siteName || location.hostname,
      canonicalUrl,
      contentHtml: root === document.body ? context.article?.content || "" : "",
      contentText: text,
      excerpt: cleanText(context.article?.excerpt || context.metadata.description),
      media,
      sourceFacts: {
        provider: context.adapter.id === "generic" ? location.hostname : context.adapter.id,
        pageType,
        itemId,
        author,
        handle: author.startsWith("@") ? author.slice(1) : "",
        publishedAt: adapterFields.publishedAt || structured.datePublished || context.metadata.publishedAt || "",
        capturedAt,
        model: cleanText(adapterFields.model || structured.model || root.querySelector('[class*=model],[data-testid*=model]')?.textContent),
        dimensions: cleanText(structured.width && structured.height ? `${structured.width}×${structured.height}` : ""),
        duration: cleanText(structured.duration),
        license: cleanText(structured.license),
        engagement: adapterFields.engagement,
        status: title && (text || media.length) ? "complete" : "partial"
      },
      completeness: title && (text || media.length) ? "complete" : "partial",
      adapter: context.adapter.id
    };
  }

  function collectAdapterFields(root, adapter) {
    const fields = adapter?.fields && typeof adapter.fields === "object" ? adapter.fields : {};
    const firstText = (selectors) => {
      for (const selector of Array.isArray(selectors) ? selectors : []) {
        try {
          const node = root.querySelector(selector);
          const value = cleanText(node?.getAttribute?.("datetime") || node?.textContent);
          if (value) return value;
        } catch {
        }
      }
      return "";
    };
    const numeric = (name) => {
      const text = firstText(fields[name]);
      const match = text.replace(/,/g, "").match(/\d+(?:\.\d+)?/);
      return match ? Number(match[0]) : null;
    };
    const engagement = Object.fromEntries(["likes", "reposts", "views"].flatMap((name) => {
      const value = numeric(name);
      return Number.isFinite(value) ? [[name, value]] : [];
    }));
    return {
      title: firstText(fields.title),
      author: firstText(fields.author),
      model: firstText(fields.model),
      publishedAt: firstText(fields.publishedAt),
      engagement
    };
  }

  function collectMedia(root, limit) {
    const media = [];
    for (const [elementIndex, element] of [...root.querySelectorAll("img,video,iframe,canvas")].entries()) {
      if (isExcludedMedia(element)) continue;
      if (element instanceof HTMLCanvasElement) {
        try {
          const dataUrl = element.toDataURL("image/webp", 0.92);
          if (dataUrl.length <= maxInlinePixelDataCharacters) {
            media.push({ id: `canvas:${elementIndex}:${element.width}x${element.height}`, kind: "image", url: "", dataUrl, posterUrl: "", alt: cleanText(element.getAttribute("aria-label")), width: element.width, height: element.height, captureMethod: "pixel-fallback" });
          }
        } catch {
        }
        if (media.length >= limit) break;
        continue;
      }
      const kind = element.matches("video,iframe") ? "video" : "image";
      const url = kind === "image"
        ? bestImageUrl(element)
        : safeHttpUrl(element.currentSrc || element.src);
      const posterUrl = kind === "video" ? safeHttpUrl(element.poster || "") : "";
      if (!url && !posterUrl) continue;
      media.push({ kind, url, posterUrl, alt: cleanText(element.alt), width: Number(element.naturalWidth || element.videoWidth || element.width) || 0, height: Number(element.naturalHeight || element.videoHeight || element.height) || 0, captureMethod: "source" });
      if (media.length >= limit) break;
    }
    if (media.length < limit) {
      for (const element of root.querySelectorAll("*")) {
        if (isExcludedMedia(element)) continue;
        const match = getComputedStyle(element).backgroundImage.match(/url\(["']?([^"')]+)["']?\)/i);
        const url = safeHttpUrl(match?.[1]);
        const rect = element.getBoundingClientRect();
        if (!url || sameUrl(url, location.href) || rect.width < 48 || rect.height < 48) continue;
        media.push({ kind: "image", url, posterUrl: "", alt: "", width: element.clientWidth, height: element.clientHeight, captureMethod: "css-background" });
        if (media.length >= limit) break;
      }
    }
    const seen = new Set();
    return media.filter((item) => {
      const key = item.url || item.posterUrl || item.dataUrl;
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  function bestImageUrl(image) {
    const srcset = String(image.srcset || "").split(",").map((item) => item.trim().split(/\s+/)).filter((item) => item[0]);
    const ranked = srcset.map(([url, descriptor]) => ({ url: safeHttpUrl(url), score: Number.parseFloat(descriptor) || 1 })).filter((item) => item.url).sort((left, right) => right.score - left.score);
    return safeHttpUrl(image.currentSrc) || ranked[0]?.url || safeHttpUrl(image.src);
  }

  function isExcludedMedia(element) {
    if (element.closest("nav,aside,header,[role=banner],[aria-label*=广告],[aria-label*=advertisement]")) return true;
    const rect = element.getBoundingClientRect();
    if (rect.width > 0 && rect.height > 0 && (rect.width < 48 || rect.height < 48)) return true;
    const description = `${element.alt || ""} ${element.className || ""}`.toLowerCase();
    return /avatar|emoji|icon|logo|badge|advert/.test(description);
  }

  function isContentRoot(root) {
    if (!(root instanceof HTMLElement) || root.closest("nav,aside,header,[role=banner]")) return false;
    return cleanText(root.innerText).length > 20 || root.querySelector("img,video,iframe,canvas");
  }

  function sameUrl(value, expected) {
    return safeHttpUrl(typeof value === "object" ? value?.["@id"] : value) === expected;
  }

  function itemIdFromUrl(value) {
    try {
      const parts = new URL(value).pathname.split("/").filter(Boolean);
      return cleanText(parts.at(-1));
    } catch {
      return "";
    }
  }

  function safeHttpUrl(value) {
    try {
      const url = new URL(String(value || ""), document.baseURI);
      return ["http:", "https:"].includes(url.protocol) ? url.href : "";
    } catch {
      return "";
    }
  }

  function cleanText(value) {
    return String(value ?? "").replace(/\s+/g, " ").trim();
  }

  function hashText(value) {
    let hash = 2166136261;
    for (const character of String(value)) hash = Math.imul(hash ^ character.charCodeAt(0), 16777619);
    return (hash >>> 0).toString(36);
  }

  function positiveInteger(value, fallback) {
    const number = Math.trunc(Number(value));
    return Number.isSafeInteger(number) && number > 0 ? number : fallback;
  }
}

function uniqueCandidates(values) {
  const seen = new Set();
  return (Array.isArray(values) ? values : []).flatMap((value) => {
    const candidate = normalizePageCaptureCandidate(value);
    const key = candidate ? `${candidate.canonicalUrl}\n${candidate.sourceFacts.itemId}\n${candidate.title}` : "";
    if (!candidate || seen.has(key)) return [];
    seen.add(key);
    return [candidate];
  });
}

function uniqueMedia(values) {
  const seen = new Set();
  return (Array.isArray(values) ? values : []).flatMap((value) => {
    const url = safeUrl(value?.url);
    const posterUrl = safeUrl(value?.posterUrl);
    const dataUrl = safeImageDataUrl(value?.dataUrl);
    const key = url || posterUrl || clean(value?.id) || dataUrl;
    const kind = value?.kind === "video" ? "video" : "image";
    if (!key || seen.has(key)) return [];
    seen.add(key);
    return [{
      id: clean(value.id) || stableCandidateId(key, kind),
      kind,
      url,
      posterUrl,
      ...(dataUrl ? { dataUrl } : {}),
      alt: clean(value.alt),
      width: positiveInteger(value.width, 0),
      height: positiveInteger(value.height, 0),
      captureMethod: ["source", "css-background", "pixel-fallback"].includes(value.captureMethod) ? value.captureMethod : "source"
    }];
  });
}

function safeImageDataUrl(value) {
  const dataUrl = String(value ?? "");
  return /^data:image\/(?:png|jpeg|webp);base64,[a-z0-9+/=]+$/iu.test(dataUrl) ? dataUrl : "";
}

function stableCandidateId(url, title) {
  let hash = 2166136261;
  for (const character of `${url}\n${title}`) hash = Math.imul(hash ^ character.charCodeAt(0), 16777619);
  return `page:${(hash >>> 0).toString(36)}`;
}

function hostname(value) {
  try { return new URL(value).hostname.replace(/^www\./, ""); } catch { return ""; }
}

function safeUrl(value) {
  try {
    const url = new URL(clean(value));
    return ["http:", "https:"].includes(url.protocol) ? url.href : "";
  } catch { return ""; }
}

function validIso(value) {
  const text = clean(value);
  return text && Number.isFinite(Date.parse(text)) ? new Date(text).toISOString() : "";
}

function positiveInteger(value, fallback = 0) {
  const number = Math.trunc(Number(value));
  return Number.isSafeInteger(number) && number > 0 ? number : fallback;
}

function normalizeText(value) {
  return String(value ?? "").replace(/\r\n?/g, "\n").replace(/[\t ]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}

function clean(value) {
  return String(value ?? "").replace(/[\u0000-\u001f\u007f]/g, " ").trim();
}
