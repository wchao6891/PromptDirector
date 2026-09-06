import { assetFormatForExtension, fileExtension } from "./asset-formats.js";
import { fetchBoundedMedia } from "./bounded-media.js";
import { PORTABLE_LIBRARY_LIMITS } from "./resource-limits.js";

export function isPageCaptureVideoFileUrl(value, { declaredVideo = false } = {}) {
  try {
    const url = new URL(value);
    const extension = fileExtension(url.pathname);
    return ["http:", "https:"].includes(url.protocol)
      && (assetFormatForExtension(extension)?.kind === "video"
        || declaredVideo && !["m3u8", "mpd"].includes(extension));
  } catch {
    return false;
  }
}

export async function downloadPageCaptureVideo(value, options = {}) {
  if (!isPageCaptureVideoFileUrl(value, options)) return null;
  return fetchBoundedMedia(value, {
    kind: "video",
    maxBytes: PORTABLE_LIBRARY_LIMITS.maxVideoBytes,
    timeoutMs: 60_000,
    accept: "video/*",
    ...options
  });
}
