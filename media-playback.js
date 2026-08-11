export const YOUTUBE_PLAYBACK_HOSTS = Object.freeze([
  "https://www.youtube-nocookie.com/*",
  "https://www.youtube.com/*"
]);

const YOUTUBE_PLAYBACK_RULE_ID = 61001;

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
