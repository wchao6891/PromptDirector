export const MENU_IDS = Object.freeze({
  addSelectionToDraft: "add-selection-to-capture-draft",
  smartVisualsToDraft: "smart-visuals-to-capture-draft",
  openSidePanel: "open-prompt-director-side-panel"
});

export const CONTEXT_MENU_ITEMS = Object.freeze([
  { id: MENU_IDS.addSelectionToDraft, messageKey: "menuSaveSelectionToPromptDirector", contexts: ["selection"] },
  { id: MENU_IDS.smartVisualsToDraft, messageKey: "menuSmartVisualsToPromptDirector", contexts: ["image", "video"] },
  { id: MENU_IDS.openSidePanel, messageKey: "menuOpenPromptDirectorSidePanel", contexts: ["page"] }
]);

const STABLE_LAYOUT_FRAMES = 3;
const MIN_LAYOUT_FRAMES = 8;
const MAX_LAYOUT_WAIT_FRAMES = 60;

let synchronization = Promise.resolve();

export function syncContextMenus(chromeApi = chrome) {
  synchronization = synchronization.catch(() => undefined).then(async () => {
    await chromeApi.contextMenus.removeAll();
    for (const item of CONTEXT_MENU_ITEMS) {
      chromeApi.contextMenus.create({
        id: item.id,
        title: chromeApi.i18n.getMessage(item.messageKey),
        contexts: [...item.contexts]
      });
    }
  });
  return synchronization;
}

export function handleContextMenuCapture(info, tab, dependencies = {}) {
  const {
    chromeApi,
    enqueueCapture,
    dispatch,
    showResult,
    waitForLayout = (tabId) => waitForStablePageLayout(chromeApi, tabId),
    formatError = (error) => error?.message || String(error),
    reportSidePanelError = () => undefined
  } = dependencies;
  const request = contextCaptureRequest(info, tab);
  if (!request) return false;

  const panelOpening = openSidePanelFromUserGesture(chromeApi, tab, reportSidePanelError);
  if (!request.action) return true;

  const readyToCapture = request.waitForPanel
    ? panelOpening.then(() => waitForLayout(tab?.id))
    : Promise.resolve();
  readyToCapture.then(() => enqueueCapture(() => dispatch(request.action, request.payload)))
    .then(async (response) => {
      const panelOpened = await panelOpening;
      const message = response.ok && !panelOpened
        ? `${response.message}；侧边栏未能自动打开，请点击扩展图标`
        : response.message;
      await showResult(tab?.id, message, !response.ok);
    })
    .catch((error) => showResult(tab?.id, formatError(error), true));
  return true;
}

export async function waitForStablePageLayout(chromeApi, tabId) {
  if (!Number.isInteger(tabId) || !chromeApi?.scripting?.executeScript) return false;
  try {
    const [execution] = await chromeApi.scripting.executeScript({
      target: { tabId },
      func: async (stableFrames, minimumFrames, maximumFrames) => new Promise((resolve) => {
        let previousWidth = window.innerWidth;
        let previousHeight = window.innerHeight;
        let consecutiveStableFrames = 0;
        let observedFrames = 0;
        const observe = () => {
          const unchanged = previousWidth === window.innerWidth && previousHeight === window.innerHeight;
          consecutiveStableFrames = unchanged ? consecutiveStableFrames + 1 : 0;
          previousWidth = window.innerWidth;
          previousHeight = window.innerHeight;
          observedFrames += 1;
          const layoutSettled = observedFrames >= minimumFrames && consecutiveStableFrames >= stableFrames;
          if (layoutSettled || observedFrames >= maximumFrames) {
            resolve(layoutSettled);
            return;
          }
          requestAnimationFrame(observe);
        };
        requestAnimationFrame(observe);
      }),
      args: [STABLE_LAYOUT_FRAMES, MIN_LAYOUT_FRAMES, MAX_LAYOUT_WAIT_FRAMES]
    });
    return Boolean(execution?.result);
  } catch {
    return false;
  }
}

function openSidePanelFromUserGesture(chromeApi, tab, reportError) {
  if (!tab?.windowId) return Promise.resolve(false);
  try {
    return chromeApi.sidePanel.open({ windowId: tab.windowId })
      .then(() => true)
      .catch((error) => {
        reportError(error);
        return false;
      });
  } catch (error) {
    reportError(error);
    return Promise.resolve(false);
  }
}

function contextCaptureRequest(info = {}, tab) {
  if (info.menuItemId === MENU_IDS.addSelectionToDraft) {
    const selectedText = String(info.selectionText ?? "").trim();
    if (!selectedText) return null;
    return {
      action: "add-selection",
      payload: {
        fragment: {
          text: selectedText,
          sourceUrl: info.pageUrl ?? tab?.url,
          sourceTitle: tab?.title
        }
      }
    };
  }
  if (info.menuItemId === MENU_IDS.smartVisualsToDraft) {
    return { action: "capture-visible-visuals", payload: { tabId: tab?.id }, waitForPanel: true };
  }
  if (info.menuItemId === MENU_IDS.openSidePanel) {
    return { action: "", payload: {} };
  }
  return null;
}
