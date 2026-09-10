export const YOUTUBE_PLAYBACK_HOSTS = Object.freeze([
  "https://www.youtube-nocookie.com/*",
  "https://www.youtube.com/*"
]);

const YOUTUBE_PLAYBACK_RULE_ID = 61001;
export const EMBED_PLAYER_RESPONSE_TIMEOUT_MS = 8000;

export function buildYouTubePlaybackRule({ extensionId, homepageUrl }) {
  const clientIdentity = publicHttpUrl(homepageUrl);
  if (!extensionId || !clientIdentity) {
    throw new Error("YouTube 内嵌播放需要 Manifest 提供公开项目地址作为客户端身份");
  }
  return {
    id: YOUTUBE_PLAYBACK_RULE_ID,
    priority: 1,
    action: {
      type: "modifyHeaders",
      requestHeaders: [{ header: "Referer", operation: "set", value: clientIdentity }]
    },
    condition: {
      requestDomains: ["www.youtube-nocookie.com", "www.youtube.com"],
      initiatorDomains: [String(extensionId)],
      resourceTypes: ["sub_frame"]
    }
  };
}

export async function ensureYouTubePlaybackPermission(chromeApi, { request = false } = {}) {
  const permission = {
    permissions: ["declarativeNetRequestWithHostAccess"],
    origins: [...YOUTUBE_PLAYBACK_HOSTS]
  };
  const permissions = chromeApi?.permissions;
  const dnr = chromeApi?.declarativeNetRequest;
  if (!permissions?.contains || !dnr?.updateSessionRules) return false;
  let granted = await permissions.contains(permission);
  if (!granted && request) granted = await permissions.request(permission);
  if (!granted) return false;
  const rule = buildYouTubePlaybackRule({
    extensionId: chromeApi.runtime?.id,
    homepageUrl: chromeApi.runtime?.getManifest?.().homepage_url
  });
  await dnr.updateSessionRules({ removeRuleIds: [YOUTUBE_PLAYBACK_RULE_ID], addRules: [rule] });
  return true;
}

export async function removeYouTubePlaybackRule(chromeApi) {
  if (!chromeApi?.declarativeNetRequest?.updateSessionRules) return;
  await chromeApi.declarativeNetRequest.updateSessionRules({ removeRuleIds: [YOUTUBE_PLAYBACK_RULE_ID] });
}

export function youtubePlaybackError(codeValue) {
  const code = Number(codeValue);
  if ([101, 150].includes(code)) return { status: "blocked", blockReason: "作者禁止在其他页面内嵌播放" };
  if (code === 100) return { status: "failed", blockReason: "视频不存在、已删除或设为私密" };
  if (code === 153) return { status: "failed", blockReason: "播放器没有收到有效的客户端身份" };
  if (code === 2) return { status: "failed", blockReason: "视频地址或播放参数无效" };
  return { status: "failed", blockReason: "播放器未能加载此视频" };
}

// TikTok's official player reports readiness, playback time and errors via postMessage.
export function tiktokMediaController(frame, onStatus, eventTarget = globalThis.window) {
  const origin = "https://www.tiktok.com";
  let currentTimeMs = null;
  const timeoutId = setTimeout(() => onStatus("播放器响应超时，可重试或打开来源", true), EMBED_PLAYER_RESPONSE_TIMEOUT_MS);
  const onLoadError = () => {
    clearTimeout(timeoutId);
    onStatus("播放器未能加载此视频", true);
  };
  const onMessage = (event) => {
    if (event.origin !== origin || event.source !== frame.contentWindow || event.data?.["x-tiktok-player"] !== true) return;
    const { type, value } = event.data;
    if (type === "onPlayerReady") {
      clearTimeout(timeoutId);
      onStatus("播放器已加载", false);
    }
    if (type === "onStateChange" && value === 1) onStatus("正在播放", false);
    if (type === "onCurrentTime" && Number.isFinite(value?.currentTime)) currentTimeMs = Math.max(0, Math.round(value.currentTime * 1000));
    if (type === "onPlayerError" || type === "onError") {
      clearTimeout(timeoutId);
      const reason = value?.errorCode === 1001 ? "视频不存在、已删除或设为私密" : "播放器未能加载此视频";
      onStatus(reason, true);
    }
  };
  eventTarget.addEventListener("message", onMessage);
  frame.addEventListener("error", onLoadError);
  return {
    getCurrentTimeMs: async () => {
      if (!Number.isFinite(currentTimeMs)) throw new Error("播放器尚未报告当前时间");
      return currentTimeMs;
    },
    seekToMs: async (value) => frame.contentWindow?.postMessage({ type: "seekTo", value: Math.max(0, Number(value) || 0) / 1000, "x-tiktok-player": true }, origin),
    destroy: () => {
      clearTimeout(timeoutId);
      frame.removeEventListener("error", onLoadError);
      eventTarget.removeEventListener("message", onMessage);
    }
  };
}

function publicHttpUrl(value) {
  try {
    const url = new URL(String(value ?? ""));
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) return "";
    url.hash = "";
    return url.href;
  } catch {
    return "";
  }
}

export function localVideoController(video) {
  return {
    video,
    getCurrentTimeMs: async () => Math.max(0, Math.round(video.currentTime * 1000)),
    seekToMs: async (value) => {
      video.currentTime = Math.max(0, Number(value) || 0) / 1000;
      await video.play().catch(() => undefined);
    }
  };
}
