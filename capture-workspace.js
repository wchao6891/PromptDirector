import {
  CAPTURE_PERMISSION_MESSAGE,
  captureVisibleTabWithRecovery,
  restorePageAfterCapture,
  selectCaptureRegion,
  selectPageVisuals
} from "./capture-region.js";
import {
  addDraftFragment,
  addDraftSourceContext,
  addDraftVisual,
  createCaptureDraft,
  removeDraftFragment,
  removeDraftVisual,
  reorderDraftFragments,
  reorderDraftVisuals,
  setDraftPrimaryVisual,
  updateDraftFragment
} from "./capture-draft.js";
import { createTextCandidate } from "./capture-text-candidate.js";
import {
  ensureContinuousCapturePermission,
  ensurePagePermission
} from "./capture-permissions.js";
import { translateForLocale } from "./i18n.js";
import { normalizeUiPreferences, resolveLocale } from "./preferences.js";
import {
  SMART_VISUAL_MINIMUM_EDGE,
  SMART_VISUAL_SELECTION_LIMIT
} from "./resource-limits.js";
import {
  SMART_VISUAL_SELECTION_STATUS,
  createSmartVisualSelectionSession,
  updateSmartVisualSelectionSession
} from "./smart-visual-selection.js";

const VISUAL_CAPTURE_MESSAGES = new Set([
  "CAPTURE_ACTIVE_TAB_TO_DRAFT",
  "CAPTURE_VISIBLE_VISUALS_TO_DRAFT",
  "START_SMART_VISUAL_SELECTION"
]);
const TEXT_CAPTURE_MESSAGE = "ADD_ACTIVE_SELECTION_TO_DRAFT";
const SUPPORTED_CAPTURE_MESSAGES = new Set([
  TEXT_CAPTURE_MESSAGE,
  ...VISUAL_CAPTURE_MESSAGES
]);

export async function runCaptureTransaction({
  type,
  commitCreative = false,
  chromeApi,
  onStatus = () => undefined
}) {
  if (!SUPPORTED_CAPTURE_MESSAGES.has(type)) throw new Error("不支持的采集操作");
  if (!chromeApi?.permissions || !chromeApi?.tabs || !chromeApi?.runtime) {
    throw new Error("采集环境不可用");
  }

  const capturesVisual = VISUAL_CAPTURE_MESSAGES.has(type);
  if (capturesVisual) {
    onStatus("Chrome 将询问一次全部网页截图权限");
    if (!await ensureContinuousCapturePermission(chromeApi.permissions)) {
      throw new Error("没有获得跨网页截图权限，当前草稿没有改变");
    }
  }

  const tab = (await chromeApi.tabs.query({ active: true, currentWindow: true }))[0];
  if (!tab?.id || !isHttpPage(tab.url)) {
    throw new Error("请先切换到需要采集的普通网页");
  }

  if (!capturesVisual) {
    onStatus("Chrome 将询问一次这个网站的访问权限");
    if (!await ensurePagePermission(tab.url, chromeApi.permissions)) {
      throw new Error("没有获得当前网站权限，待保存内容没有改变");
    }
  }

  const result = await chromeApi.runtime.sendMessage(commitCreative
    ? { type: "CAPTURE_CREATIVE_OUTPUTS", captureType: type, tabId: tab.id }
    : { type, tabId: tab.id });
  if (!result?.ok) {
    const error = new Error(result?.message || (commitCreative ? "生成结果保存失败" : "采集失败"));
    if (result?.draft) error.draft = result.draft;
    throw error;
  }
  if (commitCreative) return result;
  return {
    ok: true,
    message: result.message,
    draft: result.draft,
    fallbackAction: result.fallbackAction,
    captured: result
  };
}

export function createCaptureWorkspace({
  chromeApi,
  captureDraftStorageKey,
  uiPreferencesStorageKey = "uiPreferences",
  ensureOffscreenDocument,
  deleteVisual,
  resolveSourceContext = async () => null,
  createId = () => globalThis.crypto.randomUUID(),
  now = () => new Date().toISOString()
}) {
  if (!chromeApi?.storage?.local || !chromeApi?.tabs || !chromeApi?.scripting || !chromeApi?.runtime) {
    throw new Error("采集工作区缺少浏览器能力");
  }
  if (!captureDraftStorageKey) throw new Error("采集工作区缺少草稿存储键");
  if (typeof ensureOffscreenDocument !== "function" || typeof deleteVisual !== "function") {
    throw new Error("采集工作区缺少截图存储能力");
  }
  if (typeof resolveSourceContext !== "function") throw new Error("采集工作区来源解析器无效");

  let activeVisualSelection = null;
  let activeRegionCapture = null;
  chromeApi.tabs.onUpdated?.addListener?.((tabId, changeInfo) => {
    if (activeVisualSelection?.tab.id === tabId && changeInfo.status === "loading") {
      cancelVisibleVisualSelection(activeVisualSelection.sessionId, "页面已刷新，智能选图已取消").catch(() => undefined);
    }
  });
  chromeApi.tabs.onRemoved?.addListener?.((tabId) => {
    if (activeVisualSelection?.tab.id === tabId) clearVisualSelectionState();
  });
  chromeApi.tabs.onActivated?.addListener?.(({ tabId }) => {
    if (activeVisualSelection && activeVisualSelection.tab.id !== tabId) {
      cancelVisibleVisualSelection(activeVisualSelection.sessionId, "已切换网页，智能选图已取消").catch(() => undefined);
    }
  });

  return Object.freeze({
    getDraft: readDraft,
    dispatch
  });

  async function dispatch(action, payload = {}) {
    switch (action) {
      case "add-selection":
        return addSelection(payload.fragment, payload.sourceContext);
      case "add-active-selection":
        return addActiveSelection(payload.tabId);
      case "try-active-selection":
        return tryActiveSelection();
      case "add-clipboard-text":
        return addClipboardText(payload.text);
      case "capture-active-tab":
        return captureTab(await activeTab(payload.tabId));
      case "capture-visible-visuals":
        return captureVisibleVisuals(payload.tabId);
      case "start-visible-visual-selection":
        return startVisibleVisualSelection(payload.tabId);
      case "confirm-visible-visual-selection":
        return confirmVisibleVisualSelection(payload.sessionId);
      case "cancel-visible-visual-selection":
        return cancelVisibleVisualSelection(payload.sessionId);
      case "cancel-region-capture":
        return cancelRegionCapture(payload.sessionId);
      case "capture-tab":
        return captureTab(payload.tab);
      case "persist-draft":
        return persistDraft(payload.draft);
      case "update-fragment":
        return updateFragment(payload.fragmentId, payload.text);
      case "remove-fragment":
        return removeFragment(payload.fragmentId);
      case "reorder-fragments":
        return reorderFragments(payload.ids);
      case "remove-visual":
        return removeVisual(payload.visualId);
      case "reorder-visuals":
        return reorderVisuals(payload.ids);
      case "set-primary-visual":
        return setPrimaryVisual(payload.visualId);
      case "cancel":
        return cancel();
      default:
        throw new Error("不支持的采集工作区操作");
    }
  }

  async function readDraft() {
    const stored = await chromeApi.storage.local.get(captureDraftStorageKey);
    return createCaptureDraft(stored[captureDraftStorageKey]);
  }

  async function persistDraft(value) {
    const draft = createCaptureDraft(value);
    await chromeApi.storage.local.set({ [captureDraftStorageKey]: draft });
    return { ok: true, message: "采集草稿已更新", draft };
  }

  async function addActiveSelection(tabId) {
    const tab = await activeTab(tabId);
    try {
      const [result] = await chromeApi.scripting.executeScript({
        target: { tabId: tab.id },
        func: () => window.getSelection()?.toString() ?? ""
      });
      const sourceContext = await resolvedSourceContext(tab);
      const candidate = await createTextCandidate({
        selection: result?.result,
        page: { ...tab, title: sourceContext?.displayTitle || tab.title }
      });
      if (!candidate) {
        return { ok: true, added: false, reason: "empty-selection", message: "", draft: await readDraft() };
      }
      const response = await addSelection(candidate, sourceContext);
      return { ...response, candidateKind: candidate.kind };
    } catch {
      return {
        ok: false,
        message: "无法读取当前高亮；请在普通网页点击扩展图标后重试",
        draft: await readDraft()
      };
    }
  }

  async function tryActiveSelection() {
    const before = await readDraft();
    if (before.fragments.length || before.visuals.length) {
      return { ok: true, added: false, reason: "draft-not-empty", message: "", draft: before };
    }
    try {
      const tab = await activeTab();
      const [result] = await chromeApi.scripting.executeScript({
        target: { tabId: tab.id },
        func: () => window.getSelection()?.toString() ?? ""
      });
      const sourceContext = await resolvedSourceContext(tab);
      const candidate = await createTextCandidate({
        selection: result?.result,
        page: { ...tab, title: sourceContext?.displayTitle || tab.title }
      });
      if (!candidate) {
        return { ok: true, added: false, reason: "empty-selection", message: "", draft: before };
      }
      const response = await addSelection(candidate, sourceContext);
      return { ...response, candidateKind: candidate.kind };
    } catch {
      return { ok: true, added: false, reason: "selection-unavailable", message: "", draft: before };
    }
  }

  async function addClipboardText(text) {
    const candidate = await createTextCandidate({ clipboard: text });
    if (!candidate) {
      return { ok: true, added: false, reason: "empty-clipboard", message: "剪贴板里没有可提取的文字", draft: await readDraft() };
    }
    const response = await addSelection(candidate);
    return { ...response, candidateKind: candidate.kind };
  }

  async function addSelection(fragment, sourceContext = null) {
    const storedDraft = await readDraft();
    const before = sourceContext ? addDraftSourceContext(storedDraft, sourceContext) : storedDraft;
    const wasEmpty = !before.fragments.length && !before.visuals.length;
    const result = addDraftFragment(before, fragment);
    if (!result.added) {
      return {
        ok: true,
        added: false,
        wasEmpty,
        message: fragment?.sourceKind === "clipboard" ? "这段剪贴板文字已经在当前草稿中" : "这段高亮已经在当前草稿中",
        draft: result.draft
      };
    }
    await chromeApi.storage.local.set({ [captureDraftStorageKey]: result.draft });
    const textCount = result.draft.fragments.length;
    const imageCount = result.draft.visuals.length;
    return {
      ok: true,
      added: true,
      wasEmpty,
      textCount,
      imageCount,
      message: `已加入 · 共 ${textCount} 段文字 / ${imageCount} 张图片`,
      draft: result.draft
    };
  }

  async function captureVisibleVisuals(tabId) {
    const tab = await activeTab(tabId);
    const before = await readDraft();
    if (!Number.isInteger(tab.windowId)) {
      return { ok: false, message: "当前页面不支持智能选图", draft: await readDraft() };
    }

    const selection = await selectVisibleVisuals(tab);
    if (!selection) {
      return { ok: true, message: "已取消智能选图，草稿没有改变", draft: await readDraft() };
    }
    if (!selection.selections.length) {
      return {
        ok: true,
        message: "当前画面没有识别到足够大的图片，可以改用框选截图",
        fallbackAction: "capture-region",
        draft: await readDraft()
      };
    }

    return storeSelectedVisuals(tab, selection, before);
  }

  async function storeSelectedVisuals(tab, selection, before = null) {
    const draftBefore = before ?? await readDraft();
    const sourceContext = await resolvedSourceContext(tab);
    const visualIds = selection.selections.map(() => createId());
    try {
      const visibleTab = await captureSelectedTab(tab, selection);
      await ensureOffscreenDocument();
      const result = await chromeApi.runtime.sendMessage({
        target: "offscreen",
        type: "CROP_AND_STORE_SCREENSHOTS",
        entryIds: visualIds,
        dataUrl: visibleTab,
        selections: selection.selections
      });
      if (!result?.ok || result.results?.length !== visualIds.length) {
        throw new Error(result?.message || "批量截图裁剪失败");
      }

      const capturedAt = now();
      let draft = await readDraft();
      if (sourceContext) draft = addDraftSourceContext(draft, sourceContext);
      result.results.forEach((screenshot, index) => {
        draft = addDraftVisual(draft, visualRecord({
          id: visualIds[index],
          tab,
          sourceContext,
          capturedAt,
          screenshot
        }));
      });
      await chromeApi.storage.local.set({ [captureDraftStorageKey]: draft });
      return {
        ok: true,
        added: true,
        wasEmpty: !draftBefore.fragments.length && !draftBefore.visuals.length,
        textCount: draft.fragments.length,
        imageCount: draft.visuals.length,
        message: `${visualIds.length} 张图片已加入草稿 · 共 ${draft.visuals.length} 张`,
        draft
      };
    } catch (error) {
      await Promise.allSettled(visualIds.map((visualId) => deleteVisual(visualId)));
      throw error;
    }
  }

  async function startVisibleVisualSelection(tabId) {
    if (activeVisualSelection) await cancelVisibleVisualSelection(activeVisualSelection.sessionId);
    const tab = await activeTab(tabId);
    if (!Number.isInteger(tab.windowId)) {
      return { ok: false, message: "当前页面不支持智能选图", draft: await readDraft() };
    }
    const locale = await currentLocale();
    const sessionId = createId();
    const browserFullscreen = await isBrowserFullscreen(tab.windowId);
    await chromeApi.scripting.insertCSS({ target: { tabId: tab.id }, files: ["capture-region.css"] });
    try {
      const [result] = await chromeApi.scripting.executeScript({
        target: { tabId: tab.id },
        func: selectPageVisuals,
        args: [{
          externalControls: true,
          sessionId,
          candidateLabel: translateForLocale("选择图片", locale),
          minimumSize: SMART_VISUAL_MINIMUM_EDGE,
          maximumSelections: SMART_VISUAL_SELECTION_LIMIT,
          browserFullscreen,
          hideFloatingControls: true
        }]
      });
      const state = result?.result;
      if (!state || state.empty) {
        await removeVisualSelectionCss(tab.id);
        return {
          ok: true,
          empty: true,
          fallbackAction: "capture-region",
          message: "当前画面没有识别到足够大的图片，可以改用框选截图",
          draft: await readDraft()
        };
      }
      const timeoutId = setTimeout(() => {
        cancelVisibleVisualSelection(sessionId, "智能选图已超时").catch(() => undefined);
      }, 120_000);
      const session = createSmartVisualSelectionSession({
        ...state,
        sessionId,
        tabId: tab.id,
        windowId: tab.windowId,
        status: SMART_VISUAL_SELECTION_STATUS.selecting,
        startedAt: now()
      });
      activeVisualSelection = { sessionId, tab, timeoutId, session };
      return {
        ok: true,
        message: "请直接在网页中选择图片，然后在侧边栏确认",
        session,
        draft: await readDraft()
      };
    } catch (error) {
      await removeVisualSelectionCss(tab.id);
      throw error;
    }
  }

  async function confirmVisibleVisualSelection(sessionId) {
    const session = activeVisualSelection;
    if (!session || session.sessionId !== sessionId) {
      return { ok: false, message: "智能选图会话已经结束，请重新开始", draft: await readDraft() };
    }
    const before = await readDraft();
    activeVisualSelection.session = updateSmartVisualSelectionSession(activeVisualSelection.session, {
      status: SMART_VISUAL_SELECTION_STATUS.confirming
    });
    const selection = await chromeApi.tabs.sendMessage(session.tab.id, {
      type: "PROMPTDIRECTOR_SMART_VISUAL_SELECTION",
      action: "confirm",
      sessionId
    });
    if (!selection?.ok) {
      activeVisualSelection.session = updateSmartVisualSelectionSession(activeVisualSelection.session, {
        status: SMART_VISUAL_SELECTION_STATUS.selecting,
        candidateCount: selection?.candidateCount,
        selectedCount: selection?.selectedCount,
        fullscreen: selection?.fullscreen
      });
      return { ...selection, draft: before };
    }
    try {
      activeVisualSelection.session = updateSmartVisualSelectionSession(activeVisualSelection.session, {
        status: SMART_VISUAL_SELECTION_STATUS.completed,
        selections: selection.selections,
        selectedCount: selection.selections.length
      });
      clearVisualSelectionState();
      const result = await storeSelectedVisuals(session.tab, selection, before);
      return { ...result, sessionId, status: "completed" };
    } finally {
      clearVisualSelectionState();
      await removeVisualSelectionCss(session.tab.id);
    }
  }

  async function cancelVisibleVisualSelection(sessionId, message = "已取消智能选图，草稿没有改变") {
    const session = activeVisualSelection;
    if (!session || (sessionId && session.sessionId !== sessionId)) {
      return { ok: true, message, draft: await readDraft() };
    }
    clearVisualSelectionState();
    await chromeApi.tabs.sendMessage(session.tab.id, {
      type: "PROMPTDIRECTOR_SMART_VISUAL_SELECTION",
      action: "cancel",
      sessionId: session.sessionId
    }).catch(() => undefined);
    await removeVisualSelectionCss(session.tab.id);
    return { ok: true, cancelled: true, message, draft: await readDraft() };
  }

  function clearVisualSelectionState() {
    if (activeVisualSelection?.timeoutId) clearTimeout(activeVisualSelection.timeoutId);
    activeVisualSelection = null;
  }

  async function removeVisualSelectionCss(tabId) {
    await chromeApi.scripting.removeCSS({ target: { tabId }, files: ["capture-region.css"] }).catch(() => undefined);
  }

  async function captureTab(tab) {
    if (!tab?.id || !Number.isInteger(tab.windowId) || !isHttpPage(tab.url)) {
      return { ok: false, message: "当前页面不支持截图", draft: await readDraft() };
    }

    const before = await readDraft();
    const sourceContext = await resolvedSourceContext(tab);
    const visualId = createId();
    try {
      const screenshot = await captureRegion(tab, visualId);
      if (!screenshot) {
        return { ok: true, message: "已取消截图，草稿没有改变", draft: await readDraft() };
      }
      const current = sourceContext ? addDraftSourceContext(await readDraft(), sourceContext) : await readDraft();
      const draft = addDraftVisual(current, visualRecord({
        id: visualId,
        tab,
        sourceContext,
        capturedAt: now(),
        screenshot
      }));
      await chromeApi.storage.local.set({ [captureDraftStorageKey]: draft });
      return {
        ok: true,
        added: true,
        wasEmpty: !before.fragments.length && !before.visuals.length,
        textCount: draft.fragments.length,
        imageCount: draft.visuals.length,
        message: `截图已加入草稿 · 共 ${draft.visuals.length} 张`,
        draft
      };
    } catch (error) {
      await deleteVisual(visualId).catch(() => undefined);
      throw error;
    }
  }

  async function selectVisibleVisuals(tab) {
    const locale = await currentLocale();
    await chromeApi.scripting.insertCSS({
      target: { tabId: tab.id },
      files: ["capture-region.css"]
    });
    try {
      const [result] = await chromeApi.scripting.executeScript({
        target: { tabId: tab.id },
        func: selectPageVisuals,
        args: [{
          instruction: translateForLocale("点击选择图片，可多选 · Esc 取消", locale),
          selectedCount: translateForLocale("已选 {count} 张", locale),
          candidateLabel: translateForLocale("选择图片", locale),
          add: translateForLocale("加入素材", locale),
          cancel: translateForLocale("取消", locale),
          minimumSize: SMART_VISUAL_MINIMUM_EDGE,
          maximumSelections: SMART_VISUAL_SELECTION_LIMIT,
          hideFloatingControls: true
        }]
      });
      return result?.result ?? null;
    } finally {
      await chromeApi.scripting
        .removeCSS({ target: { tabId: tab.id }, files: ["capture-region.css"] })
        .catch(() => undefined);
    }
  }

  async function captureSelectedTab(tab, selection) {
    const locale = await currentLocale();
    try {
      const [current] = await chromeApi.tabs.query({ active: true, windowId: tab.windowId });
      if (current?.id !== tab.id) throw new Error("选图过程中切换了网页，请重新选择");
      return await captureVisibleTabWithRecovery(
        chromeApi.tabs.captureVisibleTab.bind(chromeApi.tabs),
        tab.windowId,
        { format: "png" },
        translateForLocale(CAPTURE_PERMISSION_MESSAGE, locale)
      );
    } finally {
      await restorePage(tab, selection.captureToken);
    }
  }

  async function captureRegion(tab, visualId) {
    const locale = await currentLocale();
    const sessionId = createId();
    await chromeApi.scripting.insertCSS({
      target: { tabId: tab.id },
      files: ["capture-region.css"]
    });
    let selection;
    activeRegionCapture = { sessionId, tabId: tab.id };
    await broadcastRegionState({ sessionId, phase: "starting" });
    try {
      const [result] = await chromeApi.scripting.executeScript({
        target: { tabId: tab.id },
        func: selectCaptureRegion,
        args: [{
          sessionId,
          instruction: translateForLocale("拖动框选需要保存的画面 · Esc 取消", locale),
          tooSmall: translateForLocale("框选区域太小，请重新拖动 · Esc 取消", locale),
          hideFloatingControls: true
        }]
      });
      selection = result?.result;
    } finally {
      activeRegionCapture = null;
      await chromeApi.scripting
        .removeCSS({ target: { tabId: tab.id }, files: ["capture-region.css"] })
        .catch(() => undefined);
    }
    if (!selection) return null;

    await broadcastRegionState({ sessionId, phase: "capturing" });

    let visibleTab;
    try {
      const [current] = await chromeApi.tabs.query({ active: true, windowId: tab.windowId });
      if (current?.id !== tab.id) throw new Error("截图过程中切换了网页，请重新保存");
      visibleTab = await captureVisibleTabWithRecovery(
        chromeApi.tabs.captureVisibleTab.bind(chromeApi.tabs),
        tab.windowId,
        { format: "png" },
        translateForLocale(CAPTURE_PERMISSION_MESSAGE, locale)
      );
    } finally {
      await restorePage(tab, selection.captureToken);
    }

    await ensureOffscreenDocument();
    const result = await chromeApi.runtime.sendMessage({
      target: "offscreen",
      type: "CROP_AND_STORE_SCREENSHOT",
      entryId: visualId,
      dataUrl: visibleTab,
      selection
    });
    if (!result?.ok) throw new Error(result?.message || "截图裁剪失败");
    await broadcastRegionState({ sessionId, phase: "saved" });
    return result;
  }

  async function cancelRegionCapture(sessionIdValue) {
    const sessionId = String(sessionIdValue ?? "").trim();
    if (!activeRegionCapture || sessionId && sessionId !== activeRegionCapture.sessionId) {
      return { ok: false, message: "框选会话已经结束" };
    }
    try {
      const response = await chromeApi.tabs.sendMessage(activeRegionCapture.tabId, {
        type: "PROMPTDIRECTOR_REGION_CAPTURE",
        sessionId: activeRegionCapture.sessionId,
        action: "cancel"
      });
      return response?.ok ? { ok: true, message: "已取消框选截图" } : { ok: false, message: "框选层没有响应" };
    } catch {
      return { ok: false, message: "框选页面已经关闭或刷新" };
    }
  }

  async function isBrowserFullscreen(windowId) {
    if (!Number.isInteger(windowId) || typeof chromeApi.windows?.get !== "function") return false;
    try {
      return (await chromeApi.windows.get(windowId))?.state === "fullscreen";
    } catch {
      return false;
    }
  }

  async function broadcastRegionState({ sessionId, phase, message = "" }) {
    try {
      await chromeApi.runtime.sendMessage({ type: "REGION_CAPTURE_CHANGED", sessionId, phase, message });
    } catch {
    }
  }

  async function activeTab(tabId) {
    const [active] = await chromeApi.tabs.query({ active: true, currentWindow: true });
    if (!active?.id || (tabId && active.id !== Number(tabId))) {
      throw new Error("当前网页已经切换，请重新发起采集");
    }
    if (!isHttpPage(active.url)) throw new Error("请在普通网页点击扩展图标后再采集");
    return active;
  }

  async function updateFragment(fragmentId, text) {
    const draft = updateDraftFragment(await readDraft(), fragmentId, text);
    await chromeApi.storage.local.set({ [captureDraftStorageKey]: draft });
    return { ok: true, message: "高亮文字已更新", draft };
  }

  async function removeFragment(fragmentId) {
    const draft = removeDraftFragment(await readDraft(), fragmentId);
    await chromeApi.storage.local.set({ [captureDraftStorageKey]: draft });
    return { ok: true, message: "高亮文字已移除", draft };
  }

  async function reorderFragments(ids) {
    const draft = reorderDraftFragments(await readDraft(), ids);
    await chromeApi.storage.local.set({ [captureDraftStorageKey]: draft });
    return { ok: true, message: "文字顺序已更新", draft };
  }

  async function removeVisual(visualId) {
    const current = await readDraft();
    if (!current.visuals.some((item) => item.id === visualId)) {
      return { ok: false, message: "没有找到这张草稿截图", draft: current };
    }
    const draft = removeDraftVisual(current, visualId);
    await chromeApi.storage.local.set({ [captureDraftStorageKey]: draft });
    try {
      await deleteVisual(visualId);
    } catch (error) {
      await chromeApi.storage.local.set({ [captureDraftStorageKey]: current });
      throw error;
    }
    return { ok: true, message: "截图已从草稿移除", draft };
  }

  async function reorderVisuals(ids) {
    const draft = reorderDraftVisuals(await readDraft(), ids);
    await chromeApi.storage.local.set({ [captureDraftStorageKey]: draft });
    return { ok: true, message: "截图顺序已更新", draft };
  }

  async function setPrimaryVisual(visualId) {
    const draft = setDraftPrimaryVisual(await readDraft(), visualId);
    await chromeApi.storage.local.set({ [captureDraftStorageKey]: draft });
    return { ok: true, message: "主图已更新", draft };
  }

  async function cancel() {
    const current = await readDraft();
    const results = await Promise.allSettled(current.visuals.map((visual) => deleteVisual(visual.id)));
    const failedVisuals = current.visuals.filter((_visual, index) => results[index].status === "rejected");
    const draft = createCaptureDraft({ visuals: failedVisuals });
    await chromeApi.storage.local.set({ [captureDraftStorageKey]: draft });
    if (failedVisuals.length) {
      throw new Error(`草稿文字已清除，但有 ${failedVisuals.length} 张截图未能删除；已保留在草稿中，可再次丢弃`);
    }
    return { ok: true, message: "采集草稿已丢弃", draft };
  }

  async function currentLocale() {
    const stored = await chromeApi.storage.local.get(uiPreferencesStorageKey);
    return resolveLocale(
      normalizeUiPreferences(stored[uiPreferencesStorageKey]),
      chromeApi.i18n?.getUILanguage?.()
    );
  }

  async function resolvedSourceContext(tab) {
    try {
      const context = await resolveSourceContext(tab);
      return context && typeof context === "object" ? context : null;
    } catch {
      return null;
    }
  }

  async function restorePage(tab, captureToken) {
    if (!captureToken) return;
    await chromeApi.scripting.executeScript({
      target: { tabId: tab.id },
      func: restorePageAfterCapture,
      args: [captureToken]
    }).catch(() => undefined);
  }
}

function visualRecord({ id, tab, sourceContext, capturedAt, screenshot }) {
  return {
    id,
    sourceUrl: tab.url,
    sourceTitle: sourceContext?.displayTitle || tab.title,
    capturedAt,
    width: screenshot.width,
    height: screenshot.height,
    mimeType: screenshot.mimeType,
    byteSize: screenshot.byteSize,
    palette: screenshot.palette,
    reviewStatus: "verified"
  };
}

function isHttpPage(value) {
  return /^https?:\/\//i.test(String(value ?? ""));
}
