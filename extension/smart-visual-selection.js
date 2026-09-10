export const SMART_VISUAL_SELECTION_STATUS = Object.freeze({
  starting: "starting",
  selecting: "selecting",
  confirming: "confirming",
  completed: "completed",
  cancelled: "cancelled",
  expired: "expired"
});

export function createSmartVisualSelectionSession(value = {}) {
  const sessionId = clean(value.sessionId);
  const tabId = Number(value.tabId);
  if (!sessionId || !Number.isInteger(tabId)) throw new Error("智能选图会话缺少有效页面");
  return {
    sessionId,
    tabId,
    windowId: Number.isInteger(Number(value.windowId)) ? Number(value.windowId) : null,
    status: normalizeStatus(value.status),
    candidateCount: nonNegativeInteger(value.candidateCount),
    selectedCount: nonNegativeInteger(value.selectedCount),
    selections: normalizeSelections(value.selections),
    geometryRevision: nonNegativeInteger(value.geometryRevision),
    candidateRevision: nonNegativeInteger(value.candidateRevision),
    overlayReady: value.overlayReady === true,
    fullscreenMode: normalizeFullscreenMode(value.fullscreenMode),
    fullscreen: value.fullscreen === true,
    cleanupReason: clean(value.cleanupReason),
    startedAt: clean(value.startedAt) || new Date().toISOString()
  };
}

export function updateSmartVisualSelectionSession(currentValue, changes = {}) {
  const current = createSmartVisualSelectionSession(currentValue);
  return createSmartVisualSelectionSession({ ...current, ...changes, startedAt: current.startedAt });
}

export function shouldClearSmartVisualSelection(session, event = {}) {
  if (!session) return false;
  if ([SMART_VISUAL_SELECTION_STATUS.completed, SMART_VISUAL_SELECTION_STATUS.cancelled, SMART_VISUAL_SELECTION_STATUS.expired].includes(session.status)) return true;
  if (event.type === "tab-removed" && Number(event.tabId) === session.tabId) return true;
  if (event.type === "tab-loading" && Number(event.tabId) === session.tabId) return true;
  if (event.type === "tab-activated" && Number(event.tabId) !== session.tabId) return true;
  return false;
}

function normalizeSelections(value) {
  return (Array.isArray(value) ? value : []).flatMap((item) => {
    const rect = item?.rect;
    if (![rect?.x, rect?.y, rect?.width, rect?.height].every(Number.isFinite)) return [];
    if (rect.width <= 0 || rect.height <= 0) return [];
    return [{
      rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
      viewportWidth: Number(item.viewportWidth) || 0,
      viewportHeight: Number(item.viewportHeight) || 0
    }];
  });
}

function normalizeStatus(value) {
  return Object.values(SMART_VISUAL_SELECTION_STATUS).includes(value)
    ? value
    : SMART_VISUAL_SELECTION_STATUS.selecting;
}

function normalizeFullscreenMode(value) {
  return ["none", "browser", "element"].includes(value) ? value : "none";
}

function nonNegativeInteger(value) {
  return Math.max(0, Math.trunc(Number(value) || 0));
}

function clean(value) {
  return String(value ?? "").replace(/[\u0000-\u001f\u007f]/g, "").trim();
}
