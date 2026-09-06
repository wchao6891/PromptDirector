export function readVideoMedia(blob, mimeType, videoAssetId = "", options = {}) {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(blob);
    const video = document.createElement("video");
    let settled = false;
    let timeout;
    const finish = (metadata, poster = null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      URL.revokeObjectURL(url);
      video.removeAttribute("src");
      resolve({ metadata, poster });
    };
    const metadata = () => ({
      ...(Number.isFinite(video.videoWidth) && video.videoWidth > 0 ? { width: video.videoWidth } : {}),
      ...(Number.isFinite(video.videoHeight) && video.videoHeight > 0 ? { height: video.videoHeight } : {}),
      ...(Number.isFinite(video.duration) && video.duration > 0 ? { durationMs: Math.round(video.duration * 1000) } : {}),
      playbackCapability: "native"
    });
    video.preload = "auto";
    video.muted = true;
    video.playsInline = true;
    video.onloadeddata = async () => {
      if (!videoAssetId || !video.videoWidth || !video.videoHeight) return finish(metadata());
      try {
        const canvas = document.createElement("canvas");
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        canvas.getContext("2d").drawImage(video, 0, 0, canvas.width, canvas.height);
        const posterBlob = await new Promise((resolve, reject) => canvas.toBlob((value) => value ? resolve(value) : reject(new Error("视频封面生成失败")), "image/webp", 0.84));
        const posterId = globalThis.crypto.randomUUID();
        finish(metadata(), {
          blob: posterBlob,
          asset: {
            id: posterId, kind: "image", usage: "poster", derivedFromAssetId: videoAssetId,
            storageMode: "managed", mimeType: posterBlob.type, byteSize: posterBlob.size,
            width: canvas.width, height: canvas.height, sourceTitle: "视频封面",
            capturedAt: new Date().toISOString(), reviewStatus: "verified"
          }
        });
      } catch { finish(metadata()); }
    };
    video.onloadedmetadata = () => setTimeout(() => finish(metadata()), 2500);
    video.onerror = () => finish({ playbackCapability: "external" });
    if (options.timeoutMs > 0) timeout = setTimeout(() => finish({ playbackCapability: "unknown" }), options.timeoutMs);
    video.src = url;
    if (!video.canPlayType(mimeType)) setTimeout(() => finish({ playbackCapability: "external" }), 800);
  });
}
