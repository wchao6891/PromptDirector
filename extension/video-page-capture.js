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
    const adaptive = details.videoId ? response?.streamingData?.adaptiveFormats || [] : [];
    const highestVideo = adaptive.filter(format => /^video\//u.test(format.mimeType || '')).sort((a, b) => (b.height || 0) - (a.height || 0) || (b.fps || 0) - (a.fps || 0) || (b.bitrate || 0) - (a.bitrate || 0))[0];
    const highestAudio = adaptive.filter(format => /^audio\//u.test(format.mimeType || '')).sort((a, b) => (b.bitrate || 0) - (a.bitrate || 0))[0];
    return {
      adapter: "youtube", itemId: id, canonicalUrl: `https://www.youtube.com/watch?v=${encodeURIComponent(id)}`,
      title: details.title || text("ytd-watch-metadata h1") || meta("og:title"),
      description: details.shortDescription ?? text("#description-inline-expander #attributed-snippet-text"),
      author: details.author || text("ytd-watch-metadata #owner #channel-name"),
      posterUrl: details.thumbnail?.thumbnails?.at(-1)?.url || meta("og:image"),
      duration: details.lengthSeconds, publishedAt: micro.publishDate,
      width: highestVideo?.width, height: highestVideo?.height,
      engagement: { views: details.viewCount, likes: micro.likeCount },
      ...(highestVideo?.url && highestAudio?.url ? { videoStreams: { videoUrl: highestVideo.url, audioUrl: highestAudio.url } } : {})
    };
  }
  if (host === "bilibili.com" && /^\/video\/(BV\w+|av\d+)/iu.test(url.pathname)) {
    const id = url.pathname.split("/")[2];
    const initial = window.__INITIAL_STATE__?.videoData;
    const data = initial && (initial.bvid === id || `av${initial.aid}` === id) ? initial : {};
    const stat = data.stat || {};
    const part = Number(url.searchParams.get('p')) || 1;
    const expectedCid = data.pages?.[part - 1]?.cid;
    const currentCid = window.__INITIAL_STATE__?.cid || initial?.cid;
    const play = Object.keys(data).length && (!expectedCid || Number(currentCid) === Number(expectedCid)) ? window.__playinfo__?.data : null;
    const videos = (play?.dash?.video || []).filter(format => format.baseUrl || format.base_url).sort((a, b) => (b.height || 0) - (a.height || 0) || (b.bandwidth || 0) - (a.bandwidth || 0));
    const audios = [...(play?.dash?.audio || []), ...(play?.dash?.dolby?.audio || []), ...(play?.dash?.flac?.audio ? [play.dash.flac.audio] : [])]
      .filter(format => format.baseUrl || format.base_url).sort((a, b) => (b.bandwidth || 0) - (a.bandwidth || 0));
    // PCDN may use unrelated hostnames. Keep the chosen format and use its
    // official CDN mirror; otherwise let the native extractor resolve it afresh.
    const streamUrl = format => {
      const urls = [format?.baseUrl, format?.base_url, ...(format?.backupUrl || format?.backup_url || [])].filter(value => {
        try { const u = new URL(value); return u.protocol === 'https:' && !u.username && !u.password && /(^|\.)(bilivideo\.com|bilivideo\.cn)$/u.test(u.hostname); }
        catch { return false; }
      });
      return urls.find(value => !new URL(value).port) || urls[0];
    };
    const videoUrl = streamUrl(videos[0]), audioUrl = streamUrl(audios[0]);
    return {
      adapter: "bilibili", itemId: data.bvid || id, canonicalUrl: `https://www.bilibili.com/video/${data.bvid || id}/`,
      title: data.title || text("h1.video-title") || meta("og:title"),
      description: data.desc ?? text("#v_desc .basic-desc-info"),
      author: data.owner?.name || text(".up-info-container .up-name"),
      posterUrl: data.pic || meta("og:image"), duration: data.duration,
      width: videos[0]?.width || data.dimension?.width, height: videos[0]?.height || data.dimension?.height,
      publishedAt: data.pubdate ? new Date(data.pubdate * 1000).toISOString() : "",
      engagement: { views: stat.view, likes: stat.like, comments: stat.reply, favorites: stat.favorite, shares: stat.share, coins: stat.coin, danmaku: stat.danmaku },
      ...(videoUrl && audioUrl ? { videoStreams: { videoUrl, audioUrl } }
        : play?.durl?.length === 1 && play.durl[0].url ? { formats: [{ urls: [play.durl[0].url], width: data.dimension?.width, height: data.dimension?.height }] } : {})
    };
  }
  return null;
}

export function normalizeVideoPagePayload(value, sourceUrl) {
  if (!value || !["youtube", "bilibili", "douyin"].includes(value.adapter)) return null;
  const source = new URL(sourceUrl);
  const expectedId = value.adapter === "youtube" ? source.searchParams.get("v") || source.pathname.split("/")[2]
    : value.adapter === 'douyin' ? source.searchParams.get('modal_id') || source.pathname.split('/')[2] : source.pathname.split("/")[2];
  if (value.itemId !== expectedId && !/^av\d+$/u.test(expectedId || "")) return null;
  const clean = text => String(text ?? "").trim();
  const title = clean(value.title);
  if (!title) return null;
  const canonical = new URL(clean(value.canonicalUrl));
  if (value.adapter === 'bilibili' && Number(source.searchParams.get('p')) > 1) canonical.searchParams.set('p', source.searchParams.get('p'));
  const canonicalUrl = canonical.href;
  const description = clean(value.description);
  let posterUrl = clean(value.posterUrl);
  try {
    const poster = new URL(posterUrl, source);
    if (value.adapter === "bilibili" && (poster.hostname === "hdslb.com" || poster.hostname.endsWith(".hdslb.com"))) poster.protocol = "https:";
    posterUrl = posterUrl ? poster.href : "";
  } catch { posterUrl = ""; }
  const id = `${value.adapter}:${value.itemId}${value.adapter === 'bilibili' && Number(source.searchParams.get('p')) > 1 ? `:p${source.searchParams.get('p')}` : ''}`;
  const mediaId = `${id}:video`;
  const formats = (value.formats || []).filter(format => Array.isArray(format.urls) && format.urls.length);
  const primary = formats[0];
  const textBlocks = description ? [{ id: `${id}:description`, kind: "section", relevance: "explicit-creative", text: description }] : [];
  const engagement = Object.fromEntries(Object.entries(value.engagement || {}).filter(([, count]) => count !== undefined && count !== null && count !== "" && Number.isFinite(Number(count)) && Number(count) >= 0).map(([key, count]) => [key, Number(count)]));
  const sourceFacts = { provider: value.adapter, pageType: "video", itemId: value.adapter === 'bilibili' ? id.slice('bilibili:'.length) : clean(value.itemId), author: clean(value.author), description,
    publishedAt: clean(value.publishedAt), duration: clean(value.duration), engagement, extractionMethod: "structured", captureScope: "document", originalPromptAvailable: false };
  return {
    adapter: value.adapter, pageKind: "detail", pageType: "video", canonicalUrl,
    candidates: [{ id, adapter: value.adapter, pageType: "video", title, canonicalUrl, contentText: description, textBlocks, sourceFacts,
      media: [{ id: mediaId, kind: "video", url: primary?.urls[0] || canonicalUrl, originalWorkUrl: canonicalUrl, posterUrl, sourceTitle: title, placement: "inline",
        width: primary?.width || value.width, height: primary?.height || value.height,
        ...(value.videoStreams ? { videoStreams: value.videoStreams } : {}),
        ...(primary ? { sourceKind: 'site-original', width: primary.width, height: primary.height,
          variants: formats.flatMap(format => format.urls.map(url => ({ url, sourceKind: 'site-original', width: format.width, height: format.height }))) } : {}) }],
      articleDocument: { version: 1, blocks: [...textBlocks.map(block => ({ ...block, kind: "paragraph" })), { id: `${id}:player`, kind: "video", assetId: mediaId, sourceUrl: canonicalUrl }] }
    }]
  };
}
