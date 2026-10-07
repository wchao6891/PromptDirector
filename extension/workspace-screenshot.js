import { agentDownloadChunkBytes, agentError, bytesToBase64, requireInteger } from './agent-protocol.js';
import { validate } from './case-operation-specs.js';
import { operationBudget } from './resource-policy.js';
import { ResourceCache } from './resource-cache.js';

export { WORKSPACE_SCREENSHOT_SPEC } from './workspace-screenshot-specs.js';
import { WORKSPACE_SCREENSHOT_SPEC } from './workspace-screenshot-specs.js';

// captureVisibleTab targets a window, not a tab. Watch the entire capture interval as well as
// checking its endpoints so an intervening switch cannot disclose a different page's pixels.
// https://developer.chrome.com/docs/extensions/reference/api/tabs#method-captureVisibleTab
export function createWorkspaceScreenshot({ chromeApi, now = () => Date.now(), budget } = {}) {
  const limits = operationBudget(budget);
  const captures = new ResourceCache({ maxEntries: Infinity, maxBytes: limits.workingBytes / 8,
    cost: item => item.bytes.byteLength });
  const surfaces = new Map(['library', 'composer', 'collector'].map(surface => [chromeApi.runtime.getURL(`${surface}.html`), surface]));
  const pageUrl = url => String(url ?? '').split(/[?#]/u)[0];
  const contexts = async () => (await chromeApi.runtime.getContexts({ contextTypes: ['TAB'] }))
    .filter(item => surfaces.has(pageUrl(item.documentUrl)) && Number.isSafeInteger(item.tabId) && item.tabId >= 0);

  async function visible(context) {
    const tab = await chromeApi.tabs.get(context.tabId);
    const window = await chromeApi.windows.get(tab.windowId);
    return { tab, visible: tab.active && !tab.discarded && !tab.pendingUrl && tab.status !== 'loading'
      // Chrome can omit tab.url without the tabs permission, including our own pages.
      // runtime.getContexts supplies the verified extension document identity.
      && window.state !== 'minimized' && (!tab.url || pageUrl(tab.url) === pageUrl(context.documentUrl)) };
  }
  async function capture(input = {}) {
    if (input.screenshotId !== undefined) return read(input);
    validate(WORKSPACE_SCREENSHOT_SPEC.parameters, input, 'capture_workspace');
    let target, changed = false;
    const onActivated = info => { if (target && info.windowId === target.windowId && info.tabId !== target.id) changed = true; };
    const onUpdated = (id, change) => { if (target && id === target.id && (change.url || change.status === 'loading')) changed = true; };
    const onRemoved = id => { if (target && id === target.id) changed = true; };
    chromeApi.tabs.onActivated.addListener(onActivated);
    chromeApi.tabs.onUpdated.addListener(onUpdated);
    chromeApi.tabs.onRemoved.addListener(onRemoved);
    try {
      const available = (await contexts()).filter(context => (!input.surface || surfaces.get(pageUrl(context.documentUrl)) === input.surface)
        && (input.tabId === undefined || context.tabId === input.tabId));
      if (!available.length) {
        if (input.tabId !== undefined) throw agentError('invalid_workspace', '指定标签不是当前插件的案例库、创作台或采集页面。');
        return { state: 'no_workspace', contexts: [], message: '请打开插件案例库、创作台或采集页面。' };
      }
      const candidates = await Promise.all(available.map(async context => ({ context, ...await visible(context) })));
      const active = candidates.filter(item => item.visible);
      if (active.length !== 1) return { state: active.length ? 'choose_workspace' : 'not_visible',
        contexts: (active.length ? active : candidates).map(({ context, tab, visible: isVisible }) => ({
          tabId: tab.id, windowId: tab.windowId, surface: surfaces.get(pageUrl(context.documentUrl)), visible: isVisible
        })), message: active.length ? '多个插件页面可见，请指定tabId。' : '请将需要查看的插件页面置于其窗口的当前标签，然后重试。' };
      const { context, tab } = active[0];
      target = tab;
      // Recheck after resolving candidates; the user may have switched during that asynchronous lookup.
      if (!(await visible(context)).visible || changed) throw agentError('workspace_changed', '页面已切换，未返回截图，请按当前页面重试。');
      let dataUrl;
      try { dataUrl = await chromeApi.tabs.captureVisibleTab(tab.windowId, { format: 'png' }); }
      catch (error) {
        const permission = /permission|activeTab|all_urls|not allowed|cannot access|not been invoked/i.test(error?.message ?? '');
        throw agentError(permission ? 'permission_required' : 'screenshot_unavailable', permission
          ? 'Chrome尚未授权截取该页面。请在目标插件标签页点击浏览器工具栏的PromptDirector图标授予当前标签权限，保持目标页面可见后重试；MCP调用不会自动授予权限。'
          : `Chrome未能截取插件页面：${error?.message || '未知错误'}`);
      }
      const current = (await contexts()).find(item => item.tabId === tab.id);
      if (changed || !current || current.contextId !== context.contextId || current.documentId !== context.documentId
        || !(await visible(current)).visible || changed) throw agentError('workspace_changed', '截图期间页面已切换或刷新，截图已丢弃，请按当前页面重试。');
      if (typeof dataUrl !== 'string' || !dataUrl.startsWith('data:image/png;base64,')) throw agentError('screenshot_unavailable', 'Chrome未返回PNG截图。');
      const bytes = Uint8Array.from(atob(dataUrl.slice('data:image/png;base64,'.length)), char => char.charCodeAt(0));
      const screenshotId = crypto.randomUUID();
      const capturedAt = new Date(now()).toISOString();
      for (const [id, item] of captures) if (now() - item.createdAt > limits.maxDurationMs) captures.delete(id);
      captures.set(screenshotId, { bytes, createdAt: now(), metadata: { state: 'captured', screenshotId, tabId: tab.id,
        windowId: tab.windowId, surface: surfaces.get(pageUrl(context.documentUrl)), capturedAt, mimeType: 'image/png', byteSize: bytes.byteLength } });
      return read({ screenshotId, offset: 0 });
    } finally {
      chromeApi.tabs.onActivated.removeListener(onActivated);
      chromeApi.tabs.onUpdated.removeListener(onUpdated);
      chromeApi.tabs.onRemoved.removeListener(onRemoved);
    }
  }
  function read({ screenshotId, offset = 0 }) {
    requireInteger(offset);
    const item = captures.get(screenshotId);
    if (!item || now() - item.createdAt > limits.maxDurationMs) {
      captures.delete(screenshotId);
      throw agentError('screenshot_expired', '临时截图已过期，请重新读取当前页面。');
    }
    if (offset >= item.bytes.length) throw agentError('invalid_input', '截图读取位置无效。');
    const end = Math.min(item.bytes.length, offset + agentDownloadChunkBytes(budget));
    return { ...item.metadata, offset, data: bytesToBase64(item.bytes.subarray(offset, end)), nextOffset: end < item.bytes.length ? end : null };
  }
  return { capture };
}
