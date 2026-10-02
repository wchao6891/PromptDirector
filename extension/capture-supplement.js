import { collectPageCaptureSnapshot, readPageCaptureInjectionResult } from "./page-capture.js";
import { waitForAgentTab } from "./agent-capture.js";
import { PAGE_CAPTURE_LIMITS } from "./resource-limits.js";
import { resolveXVideoSources } from './x-video-capture.js';

// Read the selected post in its live source thread when possible. A background
// tab may not mount X's below-fold post until the user activates it.
export async function readPageCaptureSupplement(item, api, { sourceTabId, sourceUrl } = {}) {
  const url = new URL(item.sourceUrl);
  if (url.protocol !== "https:" || !/^(?:www\.)?(?:x|twitter)\.com$/u.test(url.hostname)
    || !/^\/[^/]+\/status\/\d+\/?$/u.test(url.pathname) || url.username || url.password) {
    throw new Error("评论来源不是有效的 X 帖子地址");
  }
  if (!await api.permissions.contains({ origins: [`${url.origin}/*`] })) {
    throw new Error("请先授权该网站的网页采集，再补入评论全文");
  }
  let tab = null;
  let temporary = false;
  try {
    let supplement;
    if (Number.isSafeInteger(sourceTabId) && sourceUrl) {
      const source = await api.tabs.get(sourceTabId).catch(() => null);
      if (source?.url === sourceUrl && new URL(source.url).origin === url.origin && /\/status\/\d+(?:\/|$)/u.test(new URL(source.url).pathname)) {
        tab = source;
        try {
          const [result] = await api.scripting.executeScript({ target: { tabId: source.id }, func: collectPageCaptureSnapshot,
            args: [{ serializeErrors: true, xSupplementInThread: true, xSourceUrl: sourceUrl, xSupplementUrl: url.href, mediaTimeoutMs: PAGE_CAPTURE_LIMITS.navigationTimeoutMs }] });
          supplement = readPageCaptureInjectionResult(result).supplement;
          if ((await api.tabs.get(source.id)).url !== sourceUrl) throw new Error('采集页面已改变；当前草稿已保留');
        } catch (error) {
          if (error.code !== 'X_POST_NOT_MOUNTED') throw error;
        }
      }
    }
    if (!supplement) {
      tab = await api.tabs.create({ url: url.href, active: false });
      temporary = true;
      await waitForAgentTab(api.tabs, tab.id);
      const [result] = await api.scripting.executeScript({ target: { tabId: tab.id }, func: collectPageCaptureSnapshot,
        args: [{ serializeErrors: true, xSupplementUrl: url.href, mediaTimeoutMs: PAGE_CAPTURE_LIMITS.navigationTimeoutMs }] });
      supplement = readPageCaptureInjectionResult(result).supplement;
    }
    if ((!supplement?.text && !supplement?.media?.length) || supplement.partial !== false || supplement.sourceUrl !== url.href) {
      throw new Error("未能取得评论全文，当前草稿已保留，请检查原评论后重试");
    }
    let snapshot = await resolveXVideoSources({ candidates: [{ canonicalUrl: url.href, media: supplement.media || [] }] },
      { ...tab, url: url.href }, api, { allowTabReload: temporary });
    const unresolvedVideo = () => snapshot.candidates[0].media.some(media => media.kind === 'video' && !/\.mp4(?:\?|$)/iu.test(media.url || ''));
    if (unresolvedVideo() && !temporary) {
      // Only the temporary selected-post page may reload to observe normal
      // responses. Never reload or navigate the user's source thread.
      tab = await api.tabs.create({ url: url.href, active: false });
      temporary = true;
      await waitForAgentTab(api.tabs, tab.id);
      snapshot = await resolveXVideoSources(snapshot, { ...tab, url: url.href }, api);
    }
    if (unresolvedVideo()) {
      throw new Error('评论视频原件尚未取得，当前草稿已保留，请稍后重试');
    }
    return { ...supplement, media: snapshot.candidates[0].media, id: item.id };
  } finally {
    if (temporary && tab) await api.tabs.remove(tab.id).catch(() => undefined);
  }
}
