import { requireWebUrl, agentError } from "./agent-protocol.js";
import { resolveAgentProject } from "./agent-save.js";
import { normalizePageCaptureBatch } from "./page-capture.js";
import { PAGE_CAPTURE_LIMITS } from "./resource-limits.js";

export async function waitForAgentTab(tabs, tabId, timeoutMs = PAGE_CAPTURE_LIMITS.navigationTimeoutMs) {
  return new Promise((resolve, reject) => {
    const cleanup = () => { clearTimeout(timer); tabs.onUpdated.removeListener(updated); tabs.onRemoved.removeListener(removed); };
    const finish = tab => { if (tab.status === "complete") { cleanup(); resolve(tab); } };
    const updated = (id, change, tab) => { if (id === tabId && change.status === "complete") finish(tab); };
    const removed = id => { if (id === tabId) { cleanup(); reject(agentError("tab_closed", "采集网页已关闭。")); } };
    const timer = setTimeout(() => { cleanup(); reject(agentError("navigation_timeout", "网页加载超时，请检查登录、网络或页面提示。")); }, timeoutMs);
    tabs.onUpdated.addListener(updated); tabs.onRemoved.addListener(removed);
    // Listen before reading to avoid missing completion between the two.
    tabs.get(tabId).then(finish, failure => { cleanup(); reject(failure); });
  });
}

export async function captureAgentUrl(input, requestId, { chromeApi, loadState, collect, commit }) {
  const url = requireWebUrl(input.url);
  const collectionId = resolveAgentProject(await loadState(), input.project);
  if (!await chromeApi.permissions.contains({ origins: [`${new URL(url).origin}/*`] })) {
    throw agentError("site_permission_required", "请先在插件设置中授权网页采集。Agent 不能代替首次浏览器授权。");
  }
  // A dedicated tab prevents accidental capture of the user's unrelated page.
  // It is visible to preserve the existing capture pipeline's visual capability.
  const tab = await chromeApi.tabs.create({ url, active: true });
  const loaded = await waitForAgentTab(chromeApi.tabs, tab.id);
  const finalUrl = requireWebUrl(loaded.url);
  if (!await chromeApi.permissions.contains({ origins: [`${new URL(finalUrl).origin}/*`] })) {
    throw agentError("site_permission_required", "网页跳转到尚未授权的网站，请先检查页面与权限。");
  }
  const snapshot = await collect(loaded, { sessionId: requestId, mode: "whole", maxCandidates: PAGE_CAPTURE_LIMITS.maxCandidates });
  const batch = normalizePageCaptureBatch({ ...snapshot, tabId: tab.id, sourceUrl: finalUrl });
  if (!batch.candidates.length) throw agentError("capture_unsupported", "插件未取得可保存内容，请检查网页是否需登录，或由 Agent 在获准时提交材料。");
  batch.selections = batch.candidates.map(candidate => ({ candidateId: candidate.id, includeText: true,
    mediaDecision: "confirmed", selectedMediaIds: candidate.media.map(media => media.id) }));
  if ((await chromeApi.tabs.get(tab.id)).url !== finalUrl) throw agentError("page_changed", "采集期间网页地址改变，尚未入库，请重新检查网页。");
  const result = await commit(batch, { collectionId });
  const successful = (result.results || []).filter(item => ["saved", "partial", "duplicate"].includes(item.status));
  return { ...result, ok: result.ok && successful.length > 0, requestedUrl: url, finalUrl, tabId: tab.id };
}
