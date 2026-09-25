import { getMediaBlob } from "./media-store.js";
import { posterAssetForVideo } from "./media.js";
import { attachRemoteVideo } from "./remote-video-player.js";
import { officialMediaEmbedUrl } from "./media-reference-resolver.js";
import { ensureYouTubePlaybackPermission } from "./media-playback.js";
import { t } from "./i18n.js";

// Preview is independent of the source-selection checkbox and model input.
export function createSourceVideoPreview(entry, asset) {
  const host = document.createElement("div");
  host.className = "skill-source-video";
  const video = document.createElement("video");
  video.preload = "none";
  video.playsInline = true;
  video.setAttribute("aria-label", asset.sourceTitle || t("视频"));
  const play = document.createElement("button");
  play.type = "button";
  play.className = "button-secondary";
  play.textContent = t("播放视频");
  const status = document.createElement("p");
  status.hidden = true;
  status.setAttribute("role", "status");
  host.append(video, play, status);
  let disposed = false;
  let controller;
  let frame;
  const urls = [];
  const blobUrl = blob => {
    const url = URL.createObjectURL(blob);
    urls.push(url);
    return url;
  };
  const report = message => {
    if (disposed) return;
    status.textContent = t(message);
    status.hidden = false;
  };
  const poster = posterAssetForVideo(entry, asset);
  if (poster) void getMediaBlob(poster.id).then(blob => {
    if (!disposed && blob) video.poster = blobUrl(blob);
  }).catch(() => {});
  video.addEventListener("error", () => report("视频无法播放，请在案例库检查原件或打开来源"));
  play.addEventListener("click", async () => {
    play.disabled = true;
    status.hidden = true;
    try {
      const reference = asset.reference || {};
      if (asset.storageMode === "reference") {
        if (reference.playbackUrl || reference.streamUrl) {
          controller?.destroy();
          controller = await attachRemoteVideo(video, reference, (message, failed) => {
            if (failed) report(message);
          }, { defer: true });
          if (disposed) { controller.destroy(); return; }
          await video.preparePlayback();
        } else {
          const embed = officialMediaEmbedUrl(reference.url || asset.sourceUrl, reference.provider);
          if (!embed) throw new Error(t("视频暂不可播放，请在案例库检查来源"));
          if (new URL(embed).hostname === "www.youtube-nocookie.com"
            && !await ensureYouTubePlaybackPermission(chrome, { request: false })) {
            throw new Error(t("请先在案例库授权 YouTube 播放器"));
          }
          if (disposed) return;
          frame = document.createElement("iframe");
          frame.title = asset.sourceTitle || t("视频");
          frame.allow = "autoplay; encrypted-media; fullscreen; picture-in-picture";
          frame.allowFullscreen = true;
          frame.src = embed;
          video.replaceWith(frame);
          play.hidden = true;
          return;
        }
      } else if (!video.getAttribute("src")) {
        const blob = await getMediaBlob(asset.id);
        if (disposed) return;
        if (!blob) throw new Error(t("本地媒体文件缺失；请从完整备份恢复"));
        video.src = blobUrl(blob);
      }
      if (disposed) return;
      video.controls = true;
      await video.play();
      if (!disposed) play.hidden = true;
    } catch (error) {
      report(error.message || t("视频暂不可播放"));
    } finally {
      if (!disposed) play.disabled = false;
    }
  });
  host.releaseMedia = () => {
    disposed = true;
    controller?.destroy();
    video.pause();
    video.removeAttribute("src");
    video.load();
    frame?.remove();
    urls.forEach(url => URL.revokeObjectURL(url));
  };
  return host;
}

// Decode only visible local videos without a saved poster; never autoplay cards.
export function bindSourceVideoCover(host, entry, asset, root) {
  let disposed = false;
  let url = "";
  let preview;
  const poster = posterAssetForVideo(entry, asset);
  const observer = new IntersectionObserver(async records => {
    if (!records.some(record => record.isIntersecting) || disposed) return;
    observer.disconnect();
    try {
      const blob = poster ? await getMediaBlob(poster.id)
        : asset.storageMode !== "reference" ? await getMediaBlob(asset.id) : null;
      if (disposed) return;
      if (!blob) { host.textContent = t("视频 · 点击播放"); return; }
      url = URL.createObjectURL(blob);
      if (poster) {
        preview = document.createElement("img");
        preview.alt = t("视频封面");
      } else {
        preview = document.createElement("video");
        preview.muted = true;
        preview.playsInline = true;
        preview.preload = "metadata";
        preview.addEventListener("loadedmetadata", () => {
          if (!disposed && Number.isFinite(preview.duration)) preview.currentTime = Math.min(0.1, preview.duration / 2);
        }, { once: true });
      }
      preview.addEventListener("error", () => { if (!disposed) host.textContent = t("视频预览不可用 · 点击检查"); }, { once: true });
      preview.src = url;
      host.replaceChildren(preview);
    } catch { if (!disposed) host.textContent = t("视频预览不可用 · 点击检查"); }
  }, { root });
  observer.observe(host);
  return () => {
    disposed = true;
    observer.disconnect();
    if (preview?.tagName === "VIDEO") {
      preview.pause(); preview.removeAttribute("src"); preview.load();
    }
    if (url) URL.revokeObjectURL(url);
  };
}
