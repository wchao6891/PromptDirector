import { collectPageCaptureSnapshot } from "./page-capture.js";
import { waitForAgentTab } from "./agent-capture.js";
import { PAGE_CAPTURE_LIMITS } from "./resource-limits.js";

// Read only the selected comment in a temporary tab; leave the source page and draft in place.
export async function readPageCaptureSupplement(item, api) {
  const url = new URL(item.sourceUrl);
  if (url.protocol !== "https:" || !/^(?:www\.)?(?:x|twitter)\.com$/u.test(url.hostname)
    || !/^\/[^/]+\/status\/\d+\/?$/u.test(url.pathname) || url.username || url.password) {
    throw new Error("评论来源不是有效的 X 帖子地址");
  }
  if (!await api.permissions.contains({ origins: [`${url.origin}/*`] })) {
    throw new Error("请先授权该网站的网页采集，再补入评论全文");
  }
  const tab = await api.tabs.create({ url: url.href, active: false });
  try {
    await waitForAgentTab(api.tabs, tab.id);
    const [result] = await api.scripting.executeScript({ target: { tabId: tab.id },
      func: collectPageCaptureSnapshot,
      args: [{ xSupplementUrl: url.href, mediaTimeoutMs: PAGE_CAPTURE_LIMITS.navigationTimeoutMs }] });
    if (result?.error) throw new Error(`未能取得评论全文，当前草稿已保留：${result.error.message || String(result.error)}`);
    const supplement = result?.result?.supplement;
    if (!supplement?.text || supplement.partial !== false || supplement.sourceUrl !== url.href) {
      throw new Error("未能取得评论全文，当前草稿已保留，请检查原评论后重试");
    }
    return { ...supplement, id: item.id };
  } finally {
    await api.tabs.remove(tab.id).catch(() => undefined);
  }
}
