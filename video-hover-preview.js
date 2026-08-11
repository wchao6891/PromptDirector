export function bindVideoHoverPreview(container, options = {}) {
  if (!container || typeof options.loadBlob !== "function") throw new Error("视频预览缺少容器或媒体读取器");
  let active = false;
  let generation = 0;
  let video = null;
  let objectUrl = "";

  const canPreview = () => {
    if (document.documentElement.dataset.motion === "reduced") return false;
    const query = globalThis.matchMedia?.("(hover: hover) and (pointer: fine)");
    return query ? query.matches : false;
  };

  const destroyPlayer = () => {
    generation += 1;
    container.classList.remove("is-video-loading", "is-video-playing");
    if (video) {
      video.pause();
      video.removeAttribute("src");
      video.load();
      video.remove();
      video = null;
    }
    if (objectUrl) {
      URL.revokeObjectURL(objectUrl);
      objectUrl = "";
    }
  };

  const start = async () => {
    active = true;
    if (!canPreview() || video) return;
    const token = ++generation;
    container.classList.add("is-video-loading");
    try {
      const blob = await options.loadBlob();
      if (!active || token !== generation) return;
      if (!(blob instanceof Blob) || !blob.size || !blob.type.startsWith("video/")) {
        throw new Error("本地视频文件缺失或格式无效");
      }
      objectUrl = URL.createObjectURL(blob);
      video = document.createElement("video");
      video.className = "case-video-preview";
      video.muted = true;
      video.loop = true;
      video.playsInline = true;
      video.preload = "auto";
      video.tabIndex = -1;
      video.setAttribute("aria-hidden", "true");
      video.src = objectUrl;
      container.append(video);
      await video.play();
      if (!active || token !== generation) return destroyPlayer();
      container.classList.remove("is-video-loading");
      container.classList.add("is-video-playing");
    } catch {
      if (token === generation) {
        destroyPlayer();
        container.classList.add("is-video-preview-unavailable");
      }
    }
  };

  const stop = () => {
    active = false;
    destroyPlayer();
  };

  container.addEventListener("pointerenter", start);
  container.addEventListener("pointerleave", stop);
  return {
    destroy() {
      active = false;
      container.removeEventListener("pointerenter", start);
      container.removeEventListener("pointerleave", stop);
      destroyPlayer();
    }
  };
}
