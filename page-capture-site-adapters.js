const JIMENG_HOST = "jimeng.jianying.com";
const JIMENG_DETAIL_PATH = "/ai-tool/work-detail/";
const JIMENG_OBSERVER_KEY = "__PROMPTDIRECTOR_JIMENG_CAPTURE__";
const JIMENG_IMAGE_HOST_PATTERN = /^p\d+-(?:dreamina|artist)(?:-safe)?-sign\.byteimg\.com$/u;

export function installPageCaptureSiteObserver(options = {}) {
  const clean = (value) => String(value ?? "").replace(/[\u0000-\u001f\u007f]/g, "").trim();
  if (clean(globalThis.location?.hostname).toLocaleLowerCase("en-US") !== "jimeng.jianying.com") return null;
  const stateKey = "__PROMPTDIRECTOR_JIMENG_CAPTURE__";
  const maxItems = Number(options.maxCandidates);
  const maxMedia = Number(options.maxMedia);
  if (!Number.isSafeInteger(maxItems) || maxItems <= 0 || !Number.isSafeInteger(maxMedia) || maxMedia <= 0) {
    return { installed: false, reason: "invalid-resource-limits" };
  }
  const existing = globalThis[stateKey];
  if (existing?.version === 1) {
    existing.maxItems = maxItems;
    existing.maxMedia = maxMedia;
    return { installed: true, itemCount: Array.isArray(existing.items) ? existing.items.length : 0 };
  }

  const state = {
    version: 1,
    maxItems,
    maxMedia,
    items: [],
    modelNames: {},
    updatedAt: ""
  };
  Object.defineProperty(globalThis, stateKey, { value: state, configurable: true });

  const safeText = (value, limit = 10000) => clean(value).slice(0, limit);
  const safeInteger = (value) => Number.isSafeInteger(Number(value)) ? Number(value) : 0;
  const modelKey = (content) => {
    try {
      const draft = JSON.parse(String(content || "{}"));
      return safeText(draft?.component_list?.[0]?.abilities?.generate?.core_param?.model, 200);
    } catch {
      return "";
    }
  };
  const safeImage = (value) => ({
    image_url: safeText(value?.image_url, 5000),
    width: safeInteger(value?.width),
    height: safeInteger(value?.height),
    format: safeText(value?.format, 20)
  });
  const sanitizeItem = (item) => {
    const id = safeText(item?.common_attr?.id, 64);
    if (!/^\d{8,32}$/u.test(id)) return null;
    return {
      extra: { template_type: safeText(item?.extra?.template_type, 40) },
      common_attr: {
        id,
        title: safeText(item?.common_attr?.title, 500),
        description: safeText(item?.common_attr?.description),
        create_time: safeInteger(item?.common_attr?.create_time)
      },
      author: {
        name: safeText(item?.author?.name, 300),
        uid: safeText(item?.author?.uid, 200)
      },
      aigc_image_params: {
        text2image_params: { prompt: safeText(item?.aigc_image_params?.text2image_params?.prompt, 30000) }
      },
      model_key: safeText(item?.model_key, 200) || modelKey(item?.aigc_draft?.content),
      statistic: {
        favorite_num: safeInteger(item?.statistic?.favorite_num),
        usage_num: safeInteger(item?.statistic?.usage_num)
      },
      image: {
        large_images: (Array.isArray(item?.image?.large_images) ? item.image.large_images : [])
          .slice(0, state.maxMedia)
          .map(safeImage)
      }
    };
  };
  const ingestModels = (value) => {
    for (const model of value?.data?.model_list || []) {
      const key = safeText(model?.model_req_key, 200);
      const name = safeText(model?.model_name, 300);
      if (key && name) state.modelNames[key] = name;
    }
  };
  const ingest = (payload) => {
    const items = Array.isArray(payload?.data?.item_list) ? payload.data.item_list : [];
    const byId = new Map(state.items.map((item) => [item.common_attr.id, item]));
    for (const value of items) {
      const item = sanitizeItem(value);
      if (item) byId.set(item.common_attr.id, item);
    }
    state.items = [...byId.values()].slice(-state.maxItems);
    state.updatedAt = new Date().toISOString();
  };
  const isFeedUrl = (value) => {
    try {
      const url = new URL(String(value || ""), globalThis.location?.href);
      return url.hostname === "jimeng.jianying.com" && ["/mweb/v1/get_explore", "/mweb/v1/feed"].includes(url.pathname);
    } catch {
      return false;
    }
  };

  ingest(globalThis.__get_explore_result);
  ingestModels(globalThis.__image_generate_model_config__);

  if (typeof globalThis.fetch === "function") {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async function promptDirectorObservedFetch(...args) {
      const response = await originalFetch.apply(this, args);
      const requestUrl = typeof args[0] === "string" || args[0] instanceof URL ? args[0] : args[0]?.url;
      if (response?.ok && isFeedUrl(requestUrl || response.url)) {
        response.clone().json().then(ingest).catch(() => undefined);
      }
      return response;
    };
  }

  const Xhr = globalThis.XMLHttpRequest;
  if (typeof Xhr === "function") {
    const originalOpen = Xhr.prototype.open;
    const originalSend = Xhr.prototype.send;
    Xhr.prototype.open = function promptDirectorObservedOpen(method, url, ...rest) {
      this.__promptDirectorJimengFeed = isFeedUrl(url);
      return originalOpen.call(this, method, url, ...rest);
    };
    Xhr.prototype.send = function promptDirectorObservedSend(...args) {
      if (this.__promptDirectorJimengFeed) {
        this.addEventListener("loadend", () => {
          if (this.status < 200 || this.status >= 300 || typeof this.responseText !== "string") return;
          try { ingest(JSON.parse(this.responseText)); } catch { }
        }, { once: true });
      }
      return originalSend.apply(this, args);
    };
  }

  let checks = 0;
  const timer = globalThis.setInterval?.(() => {
    checks += 1;
    ingest(globalThis.__get_explore_result);
    ingestModels(globalThis.__image_generate_model_config__);
    if (checks >= 40 || state.items.length) globalThis.clearInterval?.(timer);
  }, 250);
  return { installed: true, itemCount: state.items.length };
}

export function collectPageCaptureSitePayload(options = {}) {
  const clean = (value) => String(value ?? "").replace(/[\u0000-\u001f\u007f]/g, "").trim();
  const maxMedia = Number.isSafeInteger(Number(options.maxMedia)) && Number(options.maxMedia) > 0 ? Number(options.maxMedia) : 0;
  const maxNodes = Number.isSafeInteger(Number(options.maxCandidates)) && Number(options.maxCandidates) > 0 ? Number(options.maxCandidates) : 0;
  const maxTextCharacters = Number.isSafeInteger(Number(options.maxTextCharacters)) && Number(options.maxTextCharacters) > 0 ? Number(options.maxTextCharacters) : 0;
  const host = clean(globalThis.location?.hostname).toLocaleLowerCase("en-US");
  if ((host === "liblib.art" || host.endsWith(".liblib.art") || host === "liblib.ai" || host.endsWith(".liblib.ai"))
    && clean(globalThis.location?.pathname).startsWith("/imageinfo/")) {
    try {
      const nextData = JSON.parse(String(globalThis.document?.querySelector?.("#__NEXT_DATA__")?.textContent || "null"));
      const pageProps = nextData?.props?.pageProps;
      const data = pageProps?.data;
      if (!data || typeof data !== "object") return { adapter: "liblibai", status: "partial" };
      const rawImages = Array.isArray(data.images)
        ? data.images
        : (Array.isArray(data.imagesV2) ? data.imagesV2.flatMap((items) => Array.isArray(items) ? items : []) : []);
      const images = rawImages.slice(0, maxMedia).map((image) => ({
        id: Number(image?.id) || 0,
        uuid: clean(image?.uuid),
        originalImageUrl: clean(image?.originalImageUrl || image?.previewUrl),
        imageUrl: clean(image?.imageUrl || image?.watermarkImageUrl),
        width: Number(image?.width) || 0,
        height: Number(image?.height) || 0,
        generateInfo: {
          prompt: String(image?.generateInfo?.prompt || "").slice(0, maxTextCharacters),
          negativePrompt: String(image?.generateInfo?.negativePrompt || "").slice(0, maxTextCharacters)
        },
        models: (Array.isArray(image?.models) ? image.models : []).slice(0, maxMedia).map((model) => ({
          modelName: clean(model?.modelName),
          versionName: clean(model?.versionName),
          modelType: Number(model?.modelType) || 0
        }))
      }));
      return {
        adapter: "liblibai",
        canonicalUrl: clean(globalThis.location?.href),
        data: {
          uuid: clean(data.uuid),
          title: clean(data.title),
          createTime: clean(data.createTime),
          counter: {
            likeCount: Number(data?.counter?.likeCount) || 0,
            commentCount: Number(data?.counter?.commentCount) || 0,
            hitCount: Number(data?.counter?.hitCount) || 0
          },
          images
        },
        author: {
          nickname: clean(pageProps?.authorInfo?.userDetail?.nickname),
          uuid: clean(pageProps?.authorInfo?.userDetail?.uuid)
        },
        status: images.length ? "complete" : "partial"
      };
    } catch {
      return { adapter: "liblibai", status: "partial" };
    }
  }
  if (host === "krea.ai" || host.endsWith(".krea.ai")) {
    const compactImageObject = (value) => ({
      "@type": clean(value?.["@type"]),
      name: clean(value?.name),
      url: clean(value?.url),
      contentUrl: clean(value?.contentUrl),
      thumbnailUrl: clean(value?.thumbnailUrl),
      datePublished: clean(value?.datePublished),
      width: Number(value?.width?.value || value?.width) || 0,
      height: Number(value?.height?.value || value?.height) || 0
    });
    const jsonLd = [];
    for (const script of [...(globalThis.document?.querySelectorAll?.('script[type="application/ld+json"]') || [])].slice(0, maxNodes)) {
      try {
        const parsed = JSON.parse(String(script.textContent || "null"));
        const values = Array.isArray(parsed) ? parsed : Array.isArray(parsed?.["@graph"]) ? parsed["@graph"] : [parsed];
        for (const value of values) {
          const type = Array.isArray(value?.["@type"]) ? value["@type"] : [value?.["@type"]];
          if (type.includes("ImageObject") && jsonLd.length < maxNodes) jsonLd.push(compactImageObject(value));
        }
      } catch {
      }
    }
    const path = clean(globalThis.location?.pathname);
    const uuidPattern = /[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/iu;
    const detailId = path.match(uuidPattern)?.[0]?.toLocaleLowerCase("en-US") || "";
    if (detailId) {
      return {
        adapter: "krea",
        pageKind: "detail",
        canonicalUrl: clean(globalThis.location?.href),
        prompt: String(globalThis.document?.querySelector?.("article h1")?.textContent || "").slice(0, maxTextCharacters).trim(),
        jsonLd,
        status: jsonLd.length ? "complete" : "partial"
      };
    }
    const items = [];
    const seen = new Set();
    for (const link of [...(globalThis.document?.querySelectorAll?.('a[href^="/feed/"],a[href^="https://www.krea.ai/feed/"]') || [])].slice(0, maxNodes * 2)) {
      const href = clean(link.href || link.getAttribute?.("href"));
      let canonicalUrl = "";
      try { canonicalUrl = new URL(href, globalThis.location?.href).href; } catch { continue; }
      const itemId = canonicalUrl.match(uuidPattern)?.[0]?.toLocaleLowerCase("en-US") || "";
      if (!itemId || seen.has(itemId)) continue;
      const imageNode = link.querySelector?.('[style*="background"]');
      const styleText = clean(imageNode?.style?.backgroundImage || imageNode?.getAttribute?.("style"));
      const imageUrls = styleText.match(/https:\/\/[^\s"')]+/gu) || [];
      const observedImage = imageUrls.find((url) => url.includes("-1024.webp")) || imageUrls[0] || "";
      let observedHost = "";
      try { observedHost = new URL(observedImage).hostname; } catch { }
      const imageUrl = observedImage.includes(itemId) && (observedHost === "krea.ai" || observedHost.endsWith(".krea.ai"))
        ? `https://gen.krea.ai/images/${itemId}.png`
        : observedImage;
      if (!imageUrl) continue;
      const slug = new URL(canonicalUrl).pathname.split("/").filter(Boolean).at(-1) || "";
      seen.add(itemId);
      items.push({
        itemId,
        canonicalUrl,
        title: clean(slug.replace(new RegExp(`-${itemId}$`, "iu"), "").replace(/-/gu, " ")),
        imageUrl
      });
      if (items.length >= maxNodes) break;
    }
    return { adapter: "krea", pageKind: "feed", canonicalUrl: clean(globalThis.location?.href), items, status: items.length ? "complete" : "partial" };
  }
  if (host === "higgsfield.ai" || host.endsWith(".higgsfield.ai")) {
    const compactPerson = (value) => value && typeof value === "object" ? {
      "@type": clean(value["@type"]),
      name: clean(value.name),
      alternateName: clean(value.alternateName),
      identifier: clean(value.identifier)
    } : null;
    const compactImage = (value) => {
      if (typeof value === "string") return clean(value);
      if (!value || typeof value !== "object") return "";
      return {
        url: clean(value.url),
        contentUrl: clean(value.contentUrl),
        thumbnailUrl: clean(value.thumbnailUrl),
        width: Number(value.width?.value || value.width) || 0,
        height: Number(value.height?.value || value.height) || 0
      };
    };
    const compactStatistics = (value) => (Array.isArray(value) ? value : value ? [value] : []).slice(0, maxMedia).map((item) => ({
      interactionType: { "@type": clean(item?.interactionType?.["@type"] || item?.interactionType) },
      userInteractionCount: Number(item?.userInteractionCount) || 0
    }));
    const compactCreativeWork = (value) => ({
      "@type": clean(value?.["@type"]),
      name: clean(value?.name),
      description: String(value?.description || "").slice(0, maxTextCharacters).trim(),
      url: clean(value?.url),
      identifier: clean(value?.identifier),
      author: compactPerson(value?.author || value?.creator),
      datePublished: clean(value?.datePublished || value?.dateCreated || value?.uploadDate),
      image: (Array.isArray(value?.image) ? value.image : value?.image ? [value.image] : []).slice(0, maxMedia).map(compactImage).filter(Boolean),
      thumbnailUrl: clean(value?.thumbnailUrl),
      interactionStatistic: compactStatistics(value?.interactionStatistic)
    });
    const jsonLd = [];
    for (const script of [...(globalThis.document?.querySelectorAll?.('script[type="application/ld+json"]') || [])].slice(0, maxNodes)) {
      try {
        const parsed = JSON.parse(String(script.textContent || "null"));
        const values = Array.isArray(parsed) ? parsed : Array.isArray(parsed?.["@graph"]) ? parsed["@graph"] : [parsed];
        for (const value of values) {
          const types = Array.isArray(value?.["@type"]) ? value["@type"] : [value?.["@type"]];
          if (types.includes("CreativeWork") && jsonLd.length < maxNodes) jsonLd.push(compactCreativeWork(value));
          if (types.includes("ItemList") && jsonLd.length < maxNodes) {
            jsonLd.push({
              "@type": "ItemList",
              itemListElement: (Array.isArray(value?.itemListElement) ? value.itemListElement : []).slice(0, maxNodes).flatMap((entry, index) => {
                const item = entry?.item || entry;
                const itemTypes = Array.isArray(item?.["@type"]) ? item["@type"] : [item?.["@type"]];
                return itemTypes.includes("CreativeWork") ? [{ position: Number(entry?.position) || index + 1, item: compactCreativeWork(item) }] : [];
              })
            });
          }
        }
      } catch {
      }
    }
    const detail = /^\/@[^/]+\/projects\/[^/]+/u.test(clean(globalThis.location?.pathname));
    const brief = detail
      ? String(globalThis.document?.querySelector?.('[aria-label^="Project brief:"]')?.innerText || "").slice(0, maxTextCharacters).trim()
      : "";
    return {
      adapter: "higgsfield",
      pageKind: detail ? "detail" : "feed",
      canonicalUrl: clean(globalThis.location?.href),
      brief,
      jsonLd,
      status: jsonLd.length ? "complete" : "partial"
    };
  }
  if ((host === "pinterest.com" || host.endsWith(".pinterest.com")) && /^\/pin\/(?:[^/]*--)?\d+\/?$/u.test(clean(globalThis.location?.pathname))) {
    const parseRelayResponse = (source) => {
      const text = String(source || "");
      const marker = "window.__PWS_RELAY_REGISTER_COMPLETED_REQUEST__";
      const markerIndex = text.indexOf(marker);
      if (markerIndex < 0 || text.length > maxTextCharacters) return null;
      const separator = text.indexOf(", {", markerIndex + marker.length);
      if (separator < 0) return null;
      const start = text.indexOf("{", separator);
      let depth = 0;
      let quote = "";
      let escaped = false;
      for (let index = start; index < text.length; index += 1) {
        const character = text[index];
        if (quote) {
          if (escaped) escaped = false;
          else if (character === "\\") escaped = true;
          else if (character === quote) quote = "";
          continue;
        }
        if (character === '"') {
          quote = character;
          continue;
        }
        if (character === "{") depth += 1;
        if (character === "}") depth -= 1;
        if (depth === 0) {
          try { return JSON.parse(text.slice(start, index + 1)); } catch { return null; }
        }
      }
      return null;
    };
    let rawPin = null;
    for (const script of [...(globalThis.document?.scripts || [])]) {
      const text = String(script?.textContent || "");
      if (!text.includes("v3GetPinQueryv2")) continue;
      rawPin = parseRelayResponse(text)?.data?.v3GetPinQueryv2?.data || null;
      if (rawPin) break;
    }
    if (!rawPin || typeof rawPin !== "object") return { adapter: "pinterest", pageKind: "detail", status: "partial" };
    const image = (value) => ({
      url: clean(value?.url),
      width: Number(value?.width) || 0,
      height: Number(value?.height) || 0
    });
    const creator = rawPin.nativeCreator || rawPin.closeupAttribution || rawPin.pinner || {};
    const repins = Number(globalThis.document?.querySelector?.('meta[property="pinterestapp:repins"],meta[name="pinterestapp:repins"]')?.content);
    return {
      adapter: "pinterest",
      pageKind: "detail",
      canonicalUrl: clean(globalThis.location?.href),
      pin: {
        entityId: clean(rawPin.entityId),
        title: clean(rawPin.gridTitle || rawPin.seoTitle),
        description: String(rawPin.gridDescription || rawPin.description || "").slice(0, maxTextCharacters).trim(),
        createdAt: clean(rawPin.createdAt),
        author: {
          fullName: clean(creator.fullName || creator.name || creator.firstName),
          username: clean(creator.username)
        },
        ...(Number.isSafeInteger(repins) && repins >= 0 ? { repins } : {}),
        images: {
          original: image(rawPin.images_orig || (rawPin.embed?.src ? { url: rawPin.embed.src } : null)),
          large: image(rawPin.images_1200x || rawPin.images_736x),
          display: image(rawPin.images_736x || rawPin.images_564x)
        }
      },
      status: "complete"
    };
  }
  if ((host === "behance.net" || host.endsWith(".behance.net")) && /^\/gallery\/\d+\//u.test(clean(globalThis.location?.pathname))) {
    const jsonLd = [];
    for (const script of [...(globalThis.document?.querySelectorAll?.('script[type="application/ld+json"]') || [])].slice(0, maxNodes)) {
      try {
        const parsed = JSON.parse(String(script.textContent || "null"));
        const values = Array.isArray(parsed) ? parsed : Array.isArray(parsed?.["@graph"]) ? parsed["@graph"] : [parsed];
        for (const value of values) {
          const types = Array.isArray(value?.["@type"]) ? value["@type"] : [value?.["@type"]];
          if (!types.includes("VisualArtwork") || jsonLd.length >= maxNodes) continue;
          jsonLd.push({
            "@type": "VisualArtwork",
            name: clean(value?.name),
            description: String(value?.description || "").slice(0, maxTextCharacters).trim(),
            url: clean(value?.url),
            identifier: clean(value?.identifier),
            image: clean(typeof value?.image === "string" ? value.image : value?.image?.contentUrl || value?.image?.url),
            creator: (Array.isArray(value?.creator) ? value.creator : value?.creator ? [value.creator] : []).slice(0, maxMedia).map((creator) => ({
              "@type": clean(creator?.["@type"]),
              identifier: clean(creator?.identifier),
              name: clean(creator?.name),
              url: clean(creator?.url)
            })),
            interactionStatistic: (Array.isArray(value?.interactionStatistic) ? value.interactionStatistic : value?.interactionStatistic ? [value.interactionStatistic] : []).slice(0, maxMedia).map((item) => ({
              interactionType: clean(item?.interactionType?.["@type"] || item?.interactionType),
              userInteractionCount: Number(item?.userInteractionCount) || 0
            }))
          });
        }
      } catch {
      }
    }
    return {
      adapter: "behance",
      pageKind: "detail",
      canonicalUrl: clean(globalThis.location?.href),
      publishedAt: clean(globalThis.document?.querySelector?.("time[datetime]")?.dateTime || globalThis.document?.querySelector?.("time[datetime]")?.getAttribute?.("datetime")),
      jsonLd,
      status: jsonLd.length ? "complete" : "partial"
    };
  }
  if (host === "mp.weixin.qq.com") {
    const content = globalThis.document?.querySelector?.("#js_content");
    if (!content) return { adapter: "wechat", status: "partial" };
    const images = [...(content.querySelectorAll?.("img") || [])].slice(0, maxMedia).flatMap((image) => {
      const url = clean(image.getAttribute?.("data-src") || image.currentSrc || image.src);
      if (!url) return [];
      const width = Number(image.getAttribute?.("data-w") || image.naturalWidth || image.width) || 0;
      const naturalHeight = Number(image.naturalHeight || image.height) || 0;
      const ratio = Number(image.getAttribute?.("data-ratio")) || 0;
      return [{ url, width, height: naturalHeight || (width && ratio ? Math.round(width * ratio) : 0), alt: clean(image.alt) }];
    });
    return {
      adapter: "wechat",
      canonicalUrl: clean(globalThis.location?.href),
      title: clean(globalThis.document.querySelector?.("#activity-name")?.textContent),
      author: clean(globalThis.document.querySelector?.("#js_name")?.textContent),
      publishedAt: clean(globalThis.document.querySelector?.("#publish_time")?.getAttribute?.("datetime") || globalThis.document.querySelector?.("#publish_time")?.textContent),
      contentText: String(content.innerText || "").replace(/\r\n?/g, "\n").trim().slice(0, maxTextCharacters),
      images,
      status: "complete"
    };
  }
  if (host !== "jimeng.jianying.com") return null;

  const path = clean(globalThis.location?.pathname);
  const rawLastPart = path.split("/").filter(Boolean).at(-1) || "";
  const workId = /^\d{8,32}$/u.test(rawLastPart) ? rawLastPart : "";
  const pageKind = workId ? "detail" : path.startsWith("/ai-tool/home") ? "feed" : "unknown";
  const parseAssignedJson = (source, marker) => {
    const text = String(source || "");
    const markerIndex = text.indexOf(marker);
    if (markerIndex < 0) return null;
    let start = markerIndex + marker.length;
    while (/\s/u.test(text[start] || "")) start += 1;
    const opening = text[start];
    const closing = opening === "{" ? "}" : opening === "[" ? "]" : "";
    if (!closing) return null;
    let depth = 0;
    let quote = "";
    let escaped = false;
    for (let index = start; index < text.length; index += 1) {
      const character = text[index];
      if (quote) {
        if (escaped) escaped = false;
        else if (character === "\\") escaped = true;
        else if (character === quote) quote = "";
        continue;
      }
      if (character === '"' || character === "'") {
        quote = character;
        continue;
      }
      if (character === opening) depth += 1;
      if (character === closing) depth -= 1;
      if (depth === 0) {
        try { return JSON.parse(text.slice(start, index + 1)); }
        catch { return null; }
      }
    }
    return null;
  };
  const scripts = [...(globalThis.document?.scripts || [])];
  const assigned = (marker) => {
    for (const script of scripts) {
      const parsed = parseAssignedJson(script?.textContent, marker);
      if (parsed) return parsed;
    }
    return null;
  };
  const explore = globalThis.__get_explore_result || assigned("window.__get_explore_result=");
  const modelConfig = globalThis.__image_generate_model_config__
    || assigned("window.__image_generate_model_config__=");
  const observer = globalThis.__PROMPTDIRECTOR_JIMENG_CAPTURE__;
  const observedItems = Array.isArray(observer?.items) ? observer.items : [];
  const initialItems = Array.isArray(explore?.data?.item_list) ? explore.data.item_list : [];
  const byId = new Map();
  for (const item of [...initialItems, ...observedItems]) {
    const id = clean(item?.common_attr?.id);
    if (/^\d{8,32}$/u.test(id)) byId.set(id, item);
  }

  const detailFromDom = () => {
    if (!workId || !globalThis.document?.body) return null;
    const bodyText = String(globalThis.document.body.innerText || "").replace(/\r\n?/g, "\n");
    const lines = bodyText.split("\n").map((line) => line.replace(/\s+/g, " ").trim()).filter(Boolean);
    const dateIndex = lines.findIndex((line) => /20\d{2}[-/.]\d{1,2}[-/.]\d{1,2}/u.test(line));
    const excludedAuthor = /^(?:\+?\s*关注|更多|图片提示词|内容由\s*AI\s*生成|做同款|用作参考图|发现|技能|短片|活动)$/u;
    let author = "";
    let authorIndex = -1;
    for (let index = dateIndex - 1; index >= Math.max(0, dateIndex - 8); index -= 1) {
      const candidate = lines[index];
      if (candidate.length <= 80 && !excludedAuthor.test(candidate) && !/^\d+$/u.test(candidate)) {
        author = candidate;
        authorIndex = index;
        break;
      }
    }
    const favoriteLine = authorIndex >= 0 && dateIndex > authorIndex
      ? lines.slice(authorIndex + 1, dateIndex).find((line) => /^\d+(?:\.\d+)?\s*(?:万|w|k)?$/iu.test(line)) || ""
      : "";
    const favoriteMatch = favoriteLine.match(/^(\d+(?:\.\d+)?)\s*(万|w|k)?$/iu);
    const favoriteUnit = favoriteMatch?.[2]?.toLocaleLowerCase("en-US") || "";
    const favoriteMultiplier = ["万", "w"].includes(favoriteUnit)
      ? 10000
      : favoriteUnit === "k" ? 1000 : 1;
    const favoriteCount = favoriteMatch ? Math.round(Number(favoriteMatch[1]) * favoriteMultiplier) : 0;
    const promptStart = lines.findIndex((line) => line === "图片提示词" || line.endsWith("图片提示词"));
    const promptLines = [];
    for (let index = promptStart + 1; promptStart >= 0 && index < lines.length; index += 1) {
      if (/^图片\s*\d+(?:\.\d+)?(?:\s+(?:Lite|Pro))?(?:\s*[|｜]|$)/iu.test(lines[index]) || /^(?:做同款|用作参考图)$/u.test(lines[index])) break;
      promptLines.push(lines[index]);
    }
    const modelLine = lines.find((line) => /^图片\s*\d+(?:\.\d+)?(?:\s+(?:Lite|Pro))?(?:\s*[|｜]|$)/iu.test(line)) || "";
    const modelMatch = modelLine.match(/(?:图片\s*)?(\d+(?:\.\d+)?(?:\s+(?:Lite|Pro))?)/iu);
    const dateMatch = dateIndex >= 0 ? lines[dateIndex].match(/20\d{2}[-/.]\d{1,2}[-/.]\d{1,2}/u) : null;
    const createTime = dateMatch ? Math.floor(Date.parse(dateMatch[0].replace(/[/.]/g, "-")) / 1000) : 0;
    const images = [];
    for (const image of globalThis.document.querySelectorAll?.("img") || []) {
      const url = clean(image.currentSrc || image.src);
      const width = Number(image.naturalWidth || image.width) || 0;
      const height = Number(image.naturalHeight || image.height) || 0;
      if (/^https:\/\/p\d+-(?:dreamina|artist)(?:-safe)?-sign\.byteimg\.com\//u.test(url) && width >= 256 && height >= 256) {
        images.push({ image_url: url, width, height });
      }
    }
    if (!author && !promptLines.length && !modelMatch) return null;
    return {
      common_attr: { id: workId, create_time: createTime },
      author: { name: author },
      aigc_image_params: { text2image_params: { prompt: promptLines.join("\n") } },
      model_key: clean(modelMatch?.[1]),
      statistic: { favorite_num: favoriteCount },
      image: { large_images: images }
    };
  };

  if (pageKind === "detail" && !byId.has(workId)) {
    const domItem = detailFromDom();
    if (domItem) byId.set(workId, domItem);
  }
  const items = pageKind === "detail"
    ? [...byId.values()].filter((item) => clean(item?.common_attr?.id) === workId)
    : [...byId.values()];
  const names = {
    ...(observer?.modelNames && typeof observer.modelNames === "object" ? observer.modelNames : {}),
    ...Object.fromEntries((modelConfig?.data?.model_list || [])
      .map((model) => [clean(model?.model_req_key), clean(model?.model_name)])
      .filter(([key, name]) => key && name))
  };
  return {
    adapter: "jimeng",
    pageKind,
    workId,
    items,
    ...(items.length === 1 ? { item: items[0] } : {}),
    modelNames: names,
    status: items.length ? "complete" : "partial"
  };
}

export function normalizePageCaptureSitePayload(value, canonicalUrlValue = "") {
  if (value?.adapter === "liblibai") return normalizeStructuredFeedMedia(normalizeLiblibPayload(value, canonicalUrlValue));
  if (value?.adapter === "krea") return normalizeStructuredFeedMedia(normalizeKreaPayload(value, canonicalUrlValue));
  if (value?.adapter === "higgsfield") return normalizeStructuredFeedMedia(normalizeHiggsfieldPayload(value, canonicalUrlValue));
  if (value?.adapter === "behance") return normalizeStructuredFeedMedia(normalizeBehancePayload(value, canonicalUrlValue));
  if (value?.adapter === "pinterest") return normalizeStructuredFeedMedia(normalizePinterestPayload(value, canonicalUrlValue));
  if (value?.adapter === "wechat") return normalizeStructuredFeedMedia(normalizeWechatPayload(value, canonicalUrlValue));
  if (value?.adapter !== "jimeng") return null;
  const pageKind = ["feed", "detail"].includes(value?.pageKind) ? value.pageKind : "detail";
  const rawItems = Array.isArray(value?.items) ? value.items : value?.item ? [value.item] : [];
  const seen = new Set();
  const candidates = rawItems.flatMap((item) => {
    const candidate = normalizeJimengItem(item, value?.modelNames);
    if (!candidate || seen.has(candidate.sourceFacts.itemId)) return [];
    seen.add(candidate.sourceFacts.itemId);
    return [candidate];
  });
  const canonicalUrl = safeHttpUrl(canonicalUrlValue);
  if (!candidates.length) {
    return {
      adapter: "jimeng",
      pageKind,
      canonicalUrl,
      completeness: "partial",
      sourceFacts: { provider: "jimeng", pageType: pageKind === "feed" ? "feed" : "artwork", itemId: "", status: "partial" },
      media: [],
      candidates: []
    };
  }
  if (pageKind === "feed") {
    return normalizeStructuredFeedMedia({
      adapter: "jimeng",
      pageKind,
      canonicalUrl,
      completeness: candidates.every((item) => item.completeness === "complete") ? "complete" : "partial",
      candidates
    });
  }
  const exact = candidates.find((candidate) => candidate.sourceFacts.itemId === clean(value?.workId)) || candidates[0];
  return { ...exact, pageKind, candidates: [exact] };
}

function normalizeStructuredFeedMedia(payload) {
  if (payload?.pageKind !== "feed" || !Array.isArray(payload.candidates)) return payload;
  return {
    ...payload,
    candidates: payload.candidates.map((candidate) => ({
      ...candidate,
      media: Array.isArray(candidate?.media)
        ? candidate.media.map((item) => ({ ...item, placement: "inline" }))
        : []
    }))
  };
}

export function isTrustedPageCaptureMediaUrl(adapterId, value) {
  try {
    const url = new URL(String(value || ""));
    if (url.protocol !== "https:") return false;
    if (adapterId === "jimeng") return JIMENG_IMAGE_HOST_PATTERN.test(url.hostname);
    if (adapterId === "liblibai") return url.hostname === "liblib.cloud" || url.hostname.endsWith(".liblib.cloud");
    if (adapterId === "krea") return url.hostname === "krea.ai" || url.hostname.endsWith(".krea.ai");
    if (adapterId === "higgsfield") return url.hostname === "higgsfield.ai"
      || url.hostname.endsWith(".higgsfield.ai")
      || url.hostname === "higgs.ai"
      || url.hostname.endsWith(".higgs.ai")
      || ["d2ol7oe51mr4n9.cloudfront.net", "du4zrvwy3vtek.cloudfront.net", "d8j0ntlcm91z4.cloudfront.net"].includes(url.hostname);
    if (adapterId === "behance") return url.hostname === "mir-s3-cdn-cf.behance.net";
    if (adapterId === "pinterest") return url.hostname === "i.pinimg.com";
    if (adapterId === "wechat") return url.hostname === "qpic.cn" || url.hostname.endsWith(".qpic.cn");
    return true;
  } catch {
    return false;
  }
}

function normalizeKreaPayload(value, canonicalUrlValue) {
  const canonicalUrl = safeHttpUrl(value?.canonicalUrl || canonicalUrlValue);
  if (!canonicalUrl) return null;
  const canonicalHost = new URL(canonicalUrl).hostname;
  if (!(canonicalHost === "krea.ai" || canonicalHost.endsWith(".krea.ai"))) return null;
  const pageKind = value?.pageKind === "feed" ? "feed" : "detail";
  if (pageKind === "feed") {
    const seen = new Set();
    const candidates = (Array.isArray(value?.items) ? value.items : []).flatMap((item) => {
      const candidate = normalizeKreaItem(item);
      const itemId = candidate?.sourceFacts?.itemId;
      if (!candidate || seen.has(itemId)) return [];
      seen.add(itemId);
      return [candidate];
    });
    return {
      adapter: "krea",
      pageKind,
      canonicalUrl,
      completeness: candidates.length && candidates.every((candidate) => candidate.completeness === "complete") ? "complete" : "partial",
      candidates
    };
  }
  const jsonLd = (Array.isArray(value?.jsonLd) ? value.jsonLd : []).find((node) => {
    const types = Array.isArray(node?.["@type"]) ? node["@type"] : [node?.["@type"]];
    return types.includes("ImageObject");
  }) || {};
  return normalizeKreaItem({
    itemId: kreaItemId(canonicalUrl) || kreaItemId(jsonLd.contentUrl),
    canonicalUrl,
    title: jsonLd.name,
    prompt: value?.prompt,
    imageUrl: jsonLd.contentUrl || jsonLd.url || jsonLd.thumbnailUrl,
    publishedAt: jsonLd.datePublished,
    width: jsonLd.width,
    height: jsonLd.height
  });
}

function normalizeKreaItem(value) {
  const canonicalUrl = safeHttpUrl(value?.canonicalUrl);
  if (!canonicalUrl) return null;
  const canonicalHost = new URL(canonicalUrl).hostname;
  if (!(canonicalHost === "krea.ai" || canonicalHost.endsWith(".krea.ai"))) return null;
  const itemId = clean(value?.itemId) || kreaItemId(canonicalUrl) || kreaItemId(value?.imageUrl);
  if (!itemId) return null;
  const url = safeTrustedMediaUrl("krea", value?.imageUrl);
  const width = positiveInteger(value?.width);
  const height = positiveInteger(value?.height);
  const prompt = cleanMultiline(value?.prompt);
  const media = url ? [{
    id: `krea:${itemId}:1`, kind: "image", url, width, height,
    sourceKind: "site-original", captureMethod: "source",
    variants: [{ url, sourceKind: "site-original", width, height }]
  }] : [];
  const complete = Boolean(prompt && media.length);
  return {
    id: `krea:${itemId}`,
    adapter: "krea",
    pageType: "artwork",
    canonicalUrl,
    title: clean(value?.title) || (prompt ? prompt.slice(0, 160) : `Krea ${itemId.slice(0, 8)}`),
    contentText: prompt,
    media,
    completeness: complete ? "complete" : "partial",
    extraction: { scope: "document", method: "structured", textBlockCount: prompt ? 1 : 0 },
    sourceFacts: {
      provider: "krea", pageType: "artwork", itemId,
      publishedAt: validIso(value?.publishedAt),
      dimensions: width && height ? `${width}×${height}` : "",
      engagement: {}, extractionMethod: "structured",
      status: complete ? "complete" : "partial"
    }
  };
}

function kreaItemId(value) {
  return clean(value).match(/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/iu)?.[0]?.toLocaleLowerCase("en-US") || "";
}

function normalizeHiggsfieldPayload(value, canonicalUrlValue) {
  const canonicalUrl = safeHttpUrl(value?.canonicalUrl || canonicalUrlValue);
  if (!canonicalUrl) return null;
  const canonicalHost = new URL(canonicalUrl).hostname;
  if (!(canonicalHost === "higgsfield.ai" || canonicalHost.endsWith(".higgsfield.ai"))) return null;
  const nodes = Array.isArray(value?.jsonLd) ? value.jsonLd : [];
  const pageKind = value?.pageKind === "feed" ? "feed" : "detail";
  if (pageKind === "feed") {
    const works = nodes.flatMap((node) => {
      const types = Array.isArray(node?.["@type"]) ? node["@type"] : [node?.["@type"]];
      if (types.includes("CreativeWork")) return [node];
      if (!types.includes("ItemList")) return [];
      return (Array.isArray(node?.itemListElement) ? node.itemListElement : []).map((entry) => entry?.item || entry).filter(Boolean);
    });
    const seen = new Set();
    const candidates = works.flatMap((work) => {
      const candidate = normalizeHiggsfieldWork(work, "");
      const itemId = candidate?.sourceFacts?.itemId;
      if (!candidate || seen.has(itemId)) return [];
      seen.add(itemId);
      return [candidate];
    });
    return {
      adapter: "higgsfield",
      pageKind,
      canonicalUrl,
      completeness: candidates.length && candidates.every((candidate) => candidate.completeness === "complete") ? "complete" : "partial",
      candidates
    };
  }
  const work = nodes.find((node) => {
    const types = Array.isArray(node?.["@type"]) ? node["@type"] : [node?.["@type"]];
    return types.includes("CreativeWork") && (!safeHttpUrl(node?.url) || safeHttpUrl(node?.url) === canonicalUrl);
  }) || nodes.find((node) => {
    const types = Array.isArray(node?.["@type"]) ? node["@type"] : [node?.["@type"]];
    return types.includes("CreativeWork");
  });
  if (!work) return null;
  const candidate = normalizeHiggsfieldWork({ ...work, url: safeHttpUrl(work?.url) || canonicalUrl }, value?.brief);
  return candidate ? { ...candidate, pageKind, candidates: [candidate] } : null;
}

function normalizeHiggsfieldWork(value, briefValue) {
  const canonicalUrl = safeHttpUrl(value?.url);
  if (!canonicalUrl) return null;
  const host = new URL(canonicalUrl).hostname;
  if (!(host === "higgsfield.ai" || host.endsWith(".higgsfield.ai"))) return null;
  const pathParts = new URL(canonicalUrl).pathname.split("/").filter(Boolean);
  const handlePart = pathParts.find((part) => part.startsWith("@")) || "";
  const projectIndex = pathParts.indexOf("projects");
  const projectSlug = projectIndex >= 0 ? clean(pathParts[projectIndex + 1]) : "";
  const author = clean(value?.author?.name || value?.creator?.name);
  const handle = clean(value?.author?.alternateName || value?.creator?.alternateName || handlePart).replace(/^@/u, "");
  const itemId = [handle, projectSlug].filter(Boolean).join("/") || clean(value?.identifier) || stableTextHash(canonicalUrl);
  const imageValues = Array.isArray(value?.image) ? value.image : value?.image ? [value.image] : [];
  const imageValue = imageValues.find((item) => typeof item === "string" ? item : item?.contentUrl || item?.url || item?.thumbnailUrl);
  const imageUrlValue = typeof imageValue === "string" ? imageValue : imageValue?.contentUrl || imageValue?.url || imageValue?.thumbnailUrl;
  const url = safeTrustedMediaUrl("higgsfield", imageUrlValue || value?.thumbnailUrl);
  const width = positiveInteger(typeof imageValue === "object" ? imageValue?.width : 0);
  const height = positiveInteger(typeof imageValue === "object" ? imageValue?.height : 0);
  const contentText = cleanMultiline(briefValue) || cleanMultiline(value?.description);
  const media = url ? [{
    id: `higgsfield:${stableTextHash(itemId)}:1`, kind: "image", url, width, height,
    sourceKind: "site-original", captureMethod: "source",
    variants: [{ url, sourceKind: "site-original", width, height }]
  }] : [];
  const engagement = Object.fromEntries([
    ["likes", interactionCount(value?.interactionStatistic, "LikeAction")],
    ["comments", interactionCount(value?.interactionStatistic, "CommentAction")],
    ["views", interactionCount(value?.interactionStatistic, "ViewAction")]
  ].filter(([, count]) => count !== null));
  const title = clean(value?.name);
  const complete = Boolean(title && author && contentText && media.length);
  return {
    id: `higgsfield:${stableTextHash(itemId)}`,
    adapter: "higgsfield",
    pageType: "artwork",
    canonicalUrl,
    title: title || author || `Higgsfield ${projectSlug || itemId}`,
    contentText,
    media,
    completeness: complete ? "complete" : "partial",
    extraction: { scope: "document", method: "structured", textBlockCount: contentText ? 1 : 0 },
    sourceFacts: {
      provider: "higgsfield", pageType: "artwork", itemId, author, handle,
      publishedAt: validIso(value?.datePublished || value?.dateCreated || value?.uploadDate),
      dimensions: width && height ? `${width}×${height}` : "",
      engagement, extractionMethod: "structured",
      status: complete ? "complete" : "partial"
    }
  };
}

function normalizeBehancePayload(value, canonicalUrlValue) {
  const canonicalUrl = safeHttpUrl(value?.canonicalUrl || canonicalUrlValue);
  if (!canonicalUrl) return null;
  const host = new URL(canonicalUrl).hostname;
  if (!(host === "behance.net" || host.endsWith(".behance.net"))) return null;
  const artwork = (Array.isArray(value?.jsonLd) ? value.jsonLd : []).find((node) => {
    const types = Array.isArray(node?.["@type"]) ? node["@type"] : [node?.["@type"]];
    return types.includes("VisualArtwork");
  });
  if (!artwork) return null;
  const pathId = new URL(canonicalUrl).pathname.match(/^\/gallery\/(\d+)\//u)?.[1] || "";
  const itemId = clean(artwork.identifier) || pathId;
  if (!itemId) return null;
  const creators = (Array.isArray(artwork?.creator) ? artwork.creator : artwork?.creator ? [artwork.creator] : []).filter(Boolean);
  const author = creators.map((creator) => clean(creator?.name)).filter(Boolean).join(", ");
  let handle = "";
  try { handle = new URL(creators[0]?.url || "").pathname.split("/").filter(Boolean).at(-1) || ""; } catch { }
  const imageUrl = safeTrustedMediaUrl("behance", typeof artwork?.image === "string" ? artwork.image : artwork?.image?.contentUrl || artwork?.image?.url);
  const contentText = cleanMultiline(artwork?.description);
  const media = imageUrl ? [{
    id: `behance:${itemId}:cover`, kind: "image", url: imageUrl,
    sourceKind: "structured", captureMethod: "source",
    variants: [{ url: imageUrl, sourceKind: "structured" }]
  }] : [];
  const engagement = Object.fromEntries([
    ["likes", interactionCount(artwork?.interactionStatistic, "LikeAction")],
    ["views", interactionCount(artwork?.interactionStatistic, "WatchAction")]
  ].filter(([, count]) => count !== null));
  const title = clean(artwork?.name);
  const complete = Boolean(title && author && contentText && media.length);
  const candidate = {
    id: `behance:${itemId}`,
    adapter: "behance",
    pageType: "artwork",
    canonicalUrl,
    title: title || author || `Behance ${itemId}`,
    contentText,
    media,
    completeness: complete ? "complete" : "partial",
    extraction: { scope: "document", method: "structured", textBlockCount: contentText ? 1 : 0 },
    sourceFacts: {
      provider: "behance", pageType: "artwork", itemId, author, handle,
      publishedAt: validIso(value?.publishedAt), engagement,
      extractionMethod: "structured", status: complete ? "complete" : "partial"
    }
  };
  return { ...candidate, pageKind: "detail", candidates: [candidate] };
}

function normalizePinterestPayload(value, canonicalUrlValue) {
  const canonicalUrl = safeHttpUrl(value?.canonicalUrl || canonicalUrlValue);
  if (!canonicalUrl) return null;
  const host = new URL(canonicalUrl).hostname;
  if (!(host === "pinterest.com" || host.endsWith(".pinterest.com"))) return null;
  const pin = value?.pin && typeof value.pin === "object" ? value.pin : {};
  const pathId = new URL(canonicalUrl).pathname.match(/(?:--)?(\d+)\/?$/u)?.[1] || "";
  const itemId = clean(pin.entityId) || pathId;
  if (!/^\d+$/u.test(itemId)) return null;
  const author = clean(pin?.author?.fullName) || clean(pin?.author?.username);
  const handle = clean(pin?.author?.username);
  const variants = [
    [pin?.images?.original, "site-original"],
    [pin?.images?.large, "responsive"],
    [pin?.images?.display, "current"]
  ].flatMap(([image, sourceKind]) => {
    const url = safeTrustedMediaUrl("pinterest", image?.url);
    if (!url) return [];
    return [{ url, sourceKind, width: positiveInteger(image?.width), height: positiveInteger(image?.height) }];
  }).filter((variant, index, items) => items.findIndex((candidate) => candidate.url === variant.url) === index);
  const first = variants[0];
  const contentText = cleanMultiline(pin.description);
  const media = first ? [{
    id: `pinterest:${itemId}:1`, kind: "image", url: first.url,
    width: first.width, height: first.height, sourceKind: first.sourceKind,
    captureMethod: "source", variants
  }] : [];
  const engagement = Number.isSafeInteger(Number(pin.repins)) && Number(pin.repins) >= 0 ? { repins: Number(pin.repins) } : {};
  const title = clean(pin.title);
  const complete = Boolean(title && author && contentText && media.length);
  const candidate = {
    id: `pinterest:${itemId}`,
    adapter: "pinterest",
    pageType: "artwork",
    canonicalUrl,
    title: title || author || `Pinterest ${itemId}`,
    contentText,
    media,
    completeness: complete ? "complete" : "partial",
    extraction: { scope: "document", method: "structured", textBlockCount: contentText ? 1 : 0 },
    sourceFacts: {
      provider: "pinterest", pageType: "artwork", itemId, author, handle,
      publishedAt: validIso(pin.createdAt), engagement,
      extractionMethod: "structured", status: complete ? "complete" : "partial"
    }
  };
  return { ...candidate, pageKind: "detail", candidates: [candidate] };
}

function normalizeLiblibPayload(value, canonicalUrlValue) {
  const canonicalUrl = safeHttpUrl(value?.canonicalUrl || canonicalUrlValue);
  if (!canonicalUrl) return null;
  const canonicalHost = new URL(canonicalUrl).hostname;
  if (!["liblib.art", "liblib.ai"].some((host) => canonicalHost === host || canonicalHost.endsWith(`.${host}`))) return null;
  const data = value?.data && typeof value.data === "object" ? value.data : {};
  const itemId = clean(data.uuid) || new URL(canonicalUrl).pathname.split("/").filter(Boolean).at(-1) || "";
  const author = clean(value?.author?.nickname);
  const handle = clean(value?.author?.uuid);
  const images = Array.isArray(data.images) ? data.images : [];
  const media = images.flatMap((image, index) => {
    const originalUrl = safeTrustedMediaUrl("liblibai", image?.originalImageUrl || image?.previewUrl);
    const displayUrl = safeTrustedMediaUrl("liblibai", image?.imageUrl || image?.watermarkImageUrl);
    const url = originalUrl || displayUrl;
    if (!url) return [];
    const width = positiveInteger(image?.width);
    const height = positiveInteger(image?.height);
    const variants = [
      originalUrl ? { url: originalUrl, sourceKind: "site-original", width, height } : null,
      displayUrl && displayUrl !== originalUrl ? { url: displayUrl, sourceKind: "current", width, height } : null
    ].filter(Boolean);
    return [{
      id: `liblibai:${itemId}:${clean(image?.uuid || image?.id) || index + 1}`,
      kind: "image",
      url,
      width,
      height,
      sourceKind: originalUrl ? "site-original" : "current",
      captureMethod: "source",
      variants
    }];
  });
  const promptText = cleanMultiline(images.map((image) => image?.generateInfo?.prompt).find(clean));
  const model = [...new Set(images.flatMap((image) => Array.isArray(image?.models) ? image.models : []).map((entry) => (
    [clean(entry?.modelName), clean(entry?.versionName)].filter(Boolean).join(" ")
  )).filter(Boolean))].join(" · ");
  const engagement = Object.fromEntries([
    ["likes", data?.counter?.likeCount],
    ["comments", data?.counter?.commentCount],
    ["views", data?.counter?.hitCount]
  ].flatMap(([name, amount]) => Number.isSafeInteger(Number(amount)) && Number(amount) >= 0 ? [[name, Number(amount)]] : []));
  const complete = Boolean(promptText && author && media.length);
  return {
    id: `liblibai:${itemId}`,
    adapter: "liblibai",
    pageType: "artwork",
    canonicalUrl,
    title: clean(data.title) || author || "LiblibAI 作品",
    contentText: promptText,
    media,
    completeness: complete ? "complete" : "partial",
    extraction: { scope: "document", method: "structured", textBlockCount: promptText ? 1 : 0 },
    sourceFacts: {
      provider: "liblibai", pageType: "artwork", itemId, author, handle,
      publishedAt: validIso(data.createTime), model,
      dimensions: media[0]?.width && media[0]?.height ? `${media[0].width}×${media[0].height}` : "",
      engagement, extractionMethod: "structured",
      status: complete ? "complete" : "partial"
    }
  };
}

function normalizeWechatPayload(value, canonicalUrlValue) {
  const canonicalUrl = safeHttpUrl(value?.canonicalUrl || canonicalUrlValue);
  if (!canonicalUrl || new URL(canonicalUrl).hostname !== "mp.weixin.qq.com") return null;
  const title = clean(value?.title);
  const author = clean(value?.author);
  const contentText = cleanMultiline(value?.contentText);
  const media = (Array.isArray(value?.images) ? value.images : []).flatMap((image, index) => {
    const url = safeTrustedMediaUrl("wechat", image?.url);
    if (!url) return [];
    const width = positiveInteger(image?.width);
    const height = positiveInteger(image?.height);
    return [{
      id: `wechat:${index + 1}:${stableTextHash(url)}`, kind: "image", url, width, height,
      alt: clean(image?.alt), sourceKind: "site-original", captureMethod: "source",
      variants: [{ url, sourceKind: "site-original", width, height }]
    }];
  });
  const complete = Boolean(title && author && contentText);
  return {
    id: `wechat:${stableTextHash(canonicalUrl)}`,
    adapter: "wechat",
    pageType: "article",
    canonicalUrl,
    title: title || author || "微信公众号文章",
    contentText,
    media,
    completeness: complete ? "complete" : "partial",
    extraction: { scope: "document", method: "structured", textBlockCount: contentText ? 1 : 0 },
    sourceFacts: {
      provider: "wechat", pageType: "article", itemId: stableTextHash(canonicalUrl), author,
      publishedAt: validIso(value?.publishedAt), extractionMethod: "structured",
      status: complete ? "complete" : "partial"
    }
  };
}

function interactionCount(value, action) {
  const items = Array.isArray(value) ? value : value ? [value] : [];
  const item = items.find((candidate) => clean(candidate?.interactionType?.["@type"] || candidate?.interactionType).split(/[\/#]/u).at(-1) === action);
  const number = Number(item?.userInteractionCount);
  return Number.isSafeInteger(number) && number >= 0 ? number : null;
}

function safeTrustedMediaUrl(adapterId, value) {
  const url = safeHttpUrl(value);
  return url && isTrustedPageCaptureMediaUrl(adapterId, url) ? url : "";
}

function validIso(value) {
  const timestamp = Date.parse(clean(value));
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : "";
}

function stableTextHash(value) {
  let hash = 2166136261;
  for (const character of String(value)) hash = Math.imul(hash ^ character.charCodeAt(0), 16777619);
  return (hash >>> 0).toString(36);
}

function normalizeJimengItem(item, modelNamesValue = {}) {
  const workId = clean(item?.common_attr?.id);
  if (!/^\d{8,32}$/u.test(workId)) return null;
  const prompt = cleanMultiline(item?.aigc_image_params?.text2image_params?.prompt);
  const images = Array.isArray(item?.image?.large_images) ? item.image.large_images : [];
  const modelKey = clean(item?.model_key) || jimengDraftModel(item?.aigc_draft?.content);
  const model = clean(modelNamesValue?.[modelKey]) || modelKey;
  const author = clean(item?.author?.name);
  const publishedAt = epochSecondsToIso(item?.common_attr?.create_time);
  const canonicalUrl = `https://${JIMENG_HOST}${JIMENG_DETAIL_PATH}${workId}`;
  const media = images.flatMap((image, index) => {
    const url = safeJimengImageUrl(image?.image_url);
    if (!url) return [];
    const width = positiveInteger(image?.width);
    const height = positiveInteger(image?.height);
    return [{
      id: `jimeng:${workId}:${index + 1}`,
      kind: "image",
      url,
      width,
      height,
      sourceKind: "site-original",
      captureMethod: "source",
      variants: [{ url, sourceKind: "site-original", width, height }]
    }];
  });
  if (!prompt && !author && !media.length) return null;
  const title = clean(item?.common_attr?.title);
  const dateLabel = publishedAt.slice(0, 10);
  const displayTitle = title || [author, dateLabel].filter(Boolean).join(" · ") || author || `即梦作品 ${workId.slice(-6)}`;
  const complete = Boolean(prompt && author && media.length);
  return {
    id: `jimeng:${workId}`,
    adapter: "jimeng",
    pageType: "artwork",
    canonicalUrl,
    title: displayTitle,
    displayTitle,
    contentText: prompt,
    media,
    completeness: complete ? "complete" : "partial",
    extraction: { scope: "document", method: "structured", textBlockCount: prompt ? 1 : 0 },
    sourceFacts: {
      provider: "jimeng",
      pageType: "artwork",
      itemId: workId,
      author,
      handle: clean(item?.author?.uid),
      publishedAt,
      model,
      dimensions: media[0]?.width && media[0]?.height ? `${media[0].width}×${media[0].height}` : "",
      engagement: {
        favorites: nonNegativeInteger(item?.statistic?.favorite_num),
        uses: nonNegativeInteger(item?.statistic?.usage_num)
      },
      extractionMethod: "structured",
      status: complete ? "complete" : "partial"
    }
  };
}

function jimengDraftModel(content) {
  try {
    const draft = JSON.parse(String(content || "{}"));
    return clean(draft?.component_list?.[0]?.abilities?.generate?.core_param?.model);
  } catch {
    return "";
  }
}

function safeJimengImageUrl(value) {
  try {
    const url = new URL(String(value || ""));
    return url.protocol === "https:" && JIMENG_IMAGE_HOST_PATTERN.test(url.hostname) ? url.href : "";
  } catch {
    return "";
  }
}

function safeHttpUrl(value) {
  try {
    const url = new URL(clean(value));
    return ["http:", "https:"].includes(url.protocol) ? url.href : "";
  } catch {
    return "";
  }
}

function epochSecondsToIso(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? new Date(number * 1000).toISOString() : "";
}

function positiveInteger(value) {
  const number = Number(value);
  return Number.isSafeInteger(number) && number > 0 ? number : 0;
}

function nonNegativeInteger(value) {
  const number = Number(value);
  return Number.isSafeInteger(number) && number >= 0 ? number : 0;
}

function clean(value) {
  return String(value ?? "").replace(/[\u0000-\u001f\u007f]/g, "").replace(/\s+/g, " ").trim();
}

function cleanMultiline(value) {
  return String(value ?? "").replace(/\r\n?/g, "\n").replace(/[\t ]+$/gm, "").replace(/\n{3,}/g, "\n\n").trim();
}
