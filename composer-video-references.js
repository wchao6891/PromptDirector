import { getMediaBlob } from "./media-store.js";
import { videoBlobDataUrl } from "./video-analysis.js";

export function composerVideoReferences(session) {
  return [...new Map((session?.referenceSnapshots ?? [])
    .flatMap((reference) => reference.assetRefs ?? [])
    .filter((asset) => asset.kind === "video")
    .map((asset) => [asset.assetId, asset])).values()];
}

export function sessionHasVideoReferences(session) {
  return composerVideoReferences(session).length > 0;
}

export async function prepareComposerVideos(session, options = {}) {
  const loadVideo = options.loadVideo ?? getMediaBlob;
  const encode = options.encode ?? videoBlobDataUrl;
  const videos = [];
  for (const asset of composerVideoReferences(session)) {
    options.signal?.throwIfAborted();
    const blob = await loadVideo(asset.assetId);
    if (!(blob instanceof Blob) || !blob.size) {
      throw new Error("有一支手选视频已不存在，请重新添加视频文件；本次没有发送不完整参考");
    }
    const dataUrl = await encode(blob);
    options.signal?.throwIfAborted();
    videos.push({ assetId: asset.assetId, mimeType: blob.type || asset.mimeType, dataUrl });
  }
  return videos;
}
