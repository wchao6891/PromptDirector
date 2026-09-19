// Runs in the page's MAIN world so the current player's data stays tied to its video.
export function collectVideoPagePayload() {
  const url = new URL(location.href);
  const host = url.hostname.replace(/^www\./u, "");
  const text = selector => document.querySelector(selector)?.textContent?.trim() || "";
  const meta = property => document.querySelector(`meta[property="${property}"],meta[name="${property}"]`)?.content || "";
  if (host === "youtube.com" && (url.pathname === "/watch" || /^\/(shorts|live)\//u.test(url.pathname))) {
    const id = url.searchParams.get("v") || url.pathname.split("/")[2];
    if (!id) return null;
    let response = window.ytInitialPlayerResponse;
    // The initial response can belong to the previous video after in-page navigation.
    const current = document.querySelector("#movie_player")?.getPlayerResponse?.();
    if (current?.videoDetails?.videoId === id) response = current;
    const details = response?.videoDetails?.videoId === id ? response.videoDetails : {};
    const micro = details.videoId ? response?.microformat?.playerMicroformatRenderer || {} : {};
    return {
      adapter: "youtube", itemId: id, canonicalUrl: `https://www.youtube.com/watch?v=${encodeURIComponent(id)}`,
      title: details.title || text("ytd-watch-metadata h1") || meta("og:title"),
      description: details.shortDescription ?? text("#description-inline-expander #attributed-snippet-text"),
      author: details.author || text("ytd-watch-metadata #owner #channel-name"),
      posterUrl: details.thumbnail?.thumbnails?.at(-1)?.url || meta("og:image"),
      duration: details.lengthSeconds, publishedAt: micro.publishDate,
      engagement: { views: details.viewCount, likes: micro.likeCount }
    };
  }
  if (host === "bilibili.com" && /^\/video\/(BV\w+|av\d+)/iu.test(url.pathname)) {
    const id = url.pathname.split("/")[2];
    const initial = window.__INITIAL_STATE__?.videoData;
    const data = initial && (initial.bvid === id || `av${initial.aid}` === id) ? initial : {};
    const stat = data.stat || {};
    return {
      adapter: "bilibili", itemId: data.bvid || id, canonicalUrl: `https://www.bilibili.com/video/${data.bvid || id}/`,
      title: data.title || text("h1.video-title") || meta("og:title"),
      description: data.desc ?? text("#v_desc .basic-desc-info"),
      author: data.owner?.name || text(".up-info-container .up-name"),
      posterUrl: data.pic || meta("og:image"), duration: data.duration,
      publishedAt: data.pubdate ? new Date(data.pubdate * 1000).toISOString() : "",
      engagement: { views: stat.view, likes: stat.like, comments: stat.reply, favorites: stat.favorite, shares: stat.share, coins: stat.coin, danmaku: stat.danmaku }
    };
  }
  return null;
}

export function normalizeVideoPagePayload(value, sourceUrl) {
  if (!value || !["youtube", "bilibili"].includes(value.adapter)) return null;
  const source = new URL(sourceUrl);
  const expectedId = value.adapter === "youtube" ? source.searchParams.get("v") || source.pathname.split("/")[2] : source.pathname.split("/")[2];
  if (value.itemId !== expectedId && !/^av\d+$/u.test(expectedId || "")) return null;
  const clean = text => String(text ?? "").trim();
  const title = clean(value.title);
  if (!title) return null;
  const canonicalUrl = clean(value.canonicalUrl);
  const description = clean(value.description);
  let posterUrl = clean(value.posterUrl);
  try {
    const poster = new URL(posterUrl, source);
    if (value.adapter === "bilibili" && (poster.hostname === "hdslb.com" || poster.hostname.endsWith(".hdslb.com"))) poster.protocol = "https:";
    posterUrl = posterUrl ? poster.href : "";
  } catch { posterUrl = ""; }
  const id = `${value.adapter}:${value.itemId}`;
  const mediaId = `${id}:video`;
  const textBlocks = description ? [{ id: `${id}:description`, kind: "section", relevance: "explicit-creative", text: description }] : [];
  const engagement = Object.fromEntries(Object.entries(value.engagement || {}).filter(([, count]) => count !== undefined && count !== null && count !== "" && Number.isFinite(Number(count)) && Number(count) >= 0).map(([key, count]) => [key, Number(count)]));
  const sourceFacts = { provider: value.adapter, pageType: "video", itemId: clean(value.itemId), author: clean(value.author), description,
    publishedAt: clean(value.publishedAt), duration: clean(value.duration), engagement, extractionMethod: "structured", captureScope: "document" };
  return {
    adapter: value.adapter, pageKind: "detail", pageType: "video", canonicalUrl,
    candidates: [{ id, adapter: value.adapter, pageType: "video", title, canonicalUrl, contentText: description, textBlocks, sourceFacts,
      media: [{ id: mediaId, kind: "video", url: canonicalUrl, originalWorkUrl: canonicalUrl, posterUrl, sourceTitle: title, placement: "inline" }],
      articleDocument: { version: 1, blocks: [...textBlocks.map(block => ({ ...block, kind: "paragraph" })), { id: `${id}:player`, kind: "video", assetId: mediaId, sourceUrl: canonicalUrl }] }
    }]
  };
}
