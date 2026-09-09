import { localVideoController } from "./media-playback.js";

let runtime;
const loadHls = () => runtime ||= import("./hls-runtime.js").then(() => globalThis.Hls);

export async function attachRemoteVideo(video, reference, onStatus) {
  const direct = reference.playbackUrl || "";
  const stream = reference.streamUrl || (/\.m3u8(?:\?|$)/iu.test(direct) ? direct : "");
  const controller = localVideoController(video);
  let hls = null;
  let disposed = false;
  const fail = () => onStatus("视频暂不可播放，请从原页面重新采集", true);
  let triedStream = false;
  const startStream = async () => {
    triedStream = true;
    try {
      const Hls = await loadHls();
      if (disposed) return;
      if (Hls.isSupported()) {
        // Bundled runtime; workers stay disabled to avoid blob code execution.
        hls = new Hls({ enableWorker: false });
        hls.on(Hls.Events.ERROR, (_event, data) => {
          if (data.fatal || [401, 403, 429].includes(data.response?.code)) {
            hls.destroy();
            fail();
          }
        });
        hls.loadSource(stream);
        hls.attachMedia(video);
      } else if (video.canPlayType("application/vnd.apple.mpegurl")) video.src = stream;
      else fail();
    } catch { fail(); }
  };
  const onError = () => {
    if (stream && !triedStream) void startStream();
    else fail();
  };
  const ready = () => onStatus("可以播放", false);
  video.addEventListener("playing", ready);
  video.addEventListener("error", onError);
  controller.destroy = () => {
    disposed = true;
    hls?.destroy();
    video.removeEventListener("playing", ready);
    video.removeEventListener("error", onError);
    video.pause();
    video.removeAttribute("src");
    video.load();
  };
  try {
    if (stream && (!direct || /\.m3u8(?:\?|$)/iu.test(direct))) {
      await startStream();
    } else if (direct) video.src = direct;
    else fail();
  } catch { fail(); }
  return controller;
}
