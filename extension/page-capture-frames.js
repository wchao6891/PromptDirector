// Observed public ArtStation project video player; keep the rule scoped to that player.
export const PAGE_CAPTURE_VIDEO_FRAME_RULES = Object.freeze([
  Object.freeze({ host: "www.artstation.com", pathPrefix: "/api/v2/animation/video_clips/", pathSuffix: "/embed.html" })
]);

function readableFrameUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && PAGE_CAPTURE_VIDEO_FRAME_RULES.some(rule =>
      url.hostname === rule.host && url.pathname.startsWith(rule.pathPrefix) && url.pathname.endsWith(rule.pathSuffix));
  } catch {
    return false;
  }
}

// Injected into accessible frames. Read only a player explicitly found in the capture candidates.
export function readPageCaptureVideoFrame(expectedUrls) {
  const frameUrl = globalThis.location.href;
  if (!expectedUrls.includes(frameUrl)) return null;
  const players = [...document.querySelectorAll("video")];
  if (players.length !== 1) return null;
  const player = players[0];
  const httpUrl = value => {
    try {
      const url = new URL(value);
      return ["http:", "https:"].includes(url.protocol) && !url.username && !url.password ? url.href : "";
    } catch { return ""; }
  };
  const url = httpUrl(player.currentSrc || player.src);
  if (!url) return null;
  return {
    frameUrl, url, posterUrl: httpUrl(player.poster),
    width: player.videoWidth || 0, height: player.videoHeight || 0
  };
}

export async function resolvePageCaptureVideoFrames(snapshot, tabId, scripting) {
  const frameUrls = [...new Set((snapshot.candidates || []).flatMap(candidate =>
    (candidate.media || []).filter(media => media.kind === "video" && readableFrameUrl(media.url)).map(media => media.url)))];
  if (!frameUrls.length) return snapshot;
  let results = [];
  try {
    results = await scripting.executeScript({
      target: { tabId, allFrames: true },
      func: readPageCaptureVideoFrame,
      args: [frameUrls]
    });
  } catch {
    // An inaccessible or navigated player remains in the preview as incomplete content.
  }
  const byUrl = new Map();
  for (const { result } of results) {
    if (!result || !frameUrls.includes(result.frameUrl)) continue;
    try {
      const url = new URL(result.url);
      if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) continue;
      byUrl.set(result.frameUrl, { ...result, url: url.href });
    } catch { /* A player without a usable URL remains pending. */ }
  }
  return {
    ...snapshot,
    candidates: (snapshot.candidates || []).map(candidate => {
      let pending = 0;
      const replacements = new Map();
      const media = (candidate.media || []).map(item => {
        if (item.kind !== "video" || !frameUrls.includes(item.url)) return item;
        const source = byUrl.get(item.url);
        if (!source) { pending += 1; return item; }
        replacements.set(item.id, source);
        return {
          ...item, url: source.url, sourceKind: "video-element", variants: [],
          posterUrl: source.posterUrl || item.posterUrl || "",
          width: source.width || item.width || 0, height: source.height || item.height || 0
        };
      });
      return {
        ...candidate, media,
        ...(candidate.articleDocument ? { articleDocument: {
          ...candidate.articleDocument,
          blocks: candidate.articleDocument.blocks.map(block => {
            const source = replacements.get(block.assetId);
            return source ? { ...block, sourceUrl: source.url, posterUrl: source.posterUrl || block.posterUrl || "" } : block;
          })
        } } : {}),
        ...(pending ? {
          completeness: "partial",
          sourceFacts: { ...candidate.sourceFacts, status: "partial" },
          extraction: { ...candidate.extraction, pendingMediaCount: (candidate.extraction?.pendingMediaCount || 0) + pending }
        } : {})
      };
    })
  };
}
