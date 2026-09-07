import { appendCaptureCandidate, draftCaptureAddition, savedDraftCaptureItems } from "./capture-additions.js";
import { createPageCaptureCard } from "./collector-page-capture-view.js";
import { deleteScreenshotBlob, getScreenshotBlob, saveScreenshotBlob } from "./image-store.js";
import { addDraftFragment, addDraftVisual } from "./capture-draft.js";
import { createTextCandidate } from "./capture-text-candidate.js";
import {
  assignVisualPreviewSource,
  collectorViewState
} from "./collector-view.js";
import { classifyContent } from "./classifier.js";
import { sha256Blob } from "./blob-digest.js";
import { prepareLocalMedia } from "./local-media.js";
import { runCaptureTransaction } from "./capture-workspace.js";
import {
  CAPTURE_PERMISSION_ONBOARDING_STORAGE_KEY,
  CAPTURE_PERMISSION_ONBOARDING_VERSION,
  ensureClipboardReadPermission,
  ensurePagePermission,
  inspectCapturePermissionBundle,
  inspectPagePermission,
  normalizeCapturePermissionOnboarding,
  pageCapturePermissionFailureMessage,
  readClipboardContentAfterFocus,
  requestCapturePermissionBundle,
  RESTRICTED_PAGE_MESSAGE,
  resolveActivePage
} from "./capture-permissions.js";
import { initializeUi, t, translateUiMessage } from "./i18n.js";
import { confirmAppAction } from "./ui-dialogs.js";
import { createUiIcon } from "./ui-icons.js";
import { ingestHtmlDocument } from "./document-ingestion.js";
import {
  applyPageCaptureSelections,
  normalizePageCaptureBatch,
  normalizePageCaptureSelection,
  pageCaptureDefaultMediaIds,
  pageCapturePermissionOrigins,
  pageCaptureStructureMatches
} from "./page-capture.js";
import { PAGE_CAPTURE_LIMITS } from "./resource-limits.js";
import { createTagEditor } from "./tag-editor.js";

await initializeUi();

const elements = Object.fromEntries([
  "start-clipboard", "add-clipboard", "add-selection", "add-screenshot", "add-smart-visuals", "collector-footer", "content-summary", "discard-draft", "draft-title",
  "content-type", "custom-labels", "capture-metadata", "capture-collection", "capture-new-collection-row", "capture-new-collection-name", "capture-add-more-actions", "duplicate-panel", "duplicate-title", "exit-target", "feedback", "fragment-help", "fragment-list",
  "fragment-section", "merge-duplicate", "open-library", "organizer", "organize-toggle", "preview-state",
  "quick-preview", "result-prompt-title", "result-screenshot", "result-smart-visuals", "result-start", "save-draft", "save-other-inspiration",
  "save-separate", "start-screenshot", "start-selection", "start-smart-visuals", "start-state", "normal-start",
  "other-capture-methods", "smart-selection", "smart-selection-count", "smart-selection-help", "smart-selection-warning", "smart-selection-cancel", "smart-selection-confirm",
  "start-page-capture", "add-page-capture", "page-capture", "page-capture-title", "page-capture-help", "page-capture-list", "page-capture-scan", "page-capture-cancel", "page-capture-save", "page-capture-save-text-only",
  "page-capture-mode", "page-capture-tools", "page-capture-save-summary", "capture-extra-metadata", "page-capture-edit-status", "page-capture-edit-help", "page-capture-edit-cancel",
  "page-capture-clear", "page-capture-media-viewer", "page-capture-media-stage", "page-capture-media-position", "page-capture-media-title", "page-capture-media-meta",
  "page-capture-media-review", "page-capture-media-review-status", "page-capture-media-review-list",
  "page-capture-add-region", "page-capture-exclude-region", "page-capture-undo-region", "page-capture-reset-region",
  "page-capture-media-close", "page-capture-media-prev", "page-capture-media-next",
  "page-capture-list-setup", "page-capture-target-count", "page-capture-list-run", "page-capture-list-result", "page-capture-list-summary",
  "page-capture-save-mode", "page-capture-combined-title-row", "page-capture-combined-title", "page-capture-actions",
  "region-capture-status", "region-capture-title", "region-capture-help", "region-capture-cancel",
  "capture-permission-onboarding", "capture-permission-form", "capture-permission-clipboard", "capture-permission-status", "capture-permission-cancel", "capture-permission-confirm",
  "clipboard-permission-dialog", "clipboard-permission-form", "clipboard-permission-status", "clipboard-permission-cancel", "clipboard-permission-confirm",
  "target-banner", "target-label", "visual-help", "visual-list", "visual-section"
].map((id) => [camel(id), document.getElementById(id)]));

let draft = null;
let targetEntry = null;
let contentTypes = [];
let collections = [];
let suggestedContentTypeId = "";
let captureClassificationContext = {};
let partContentTypes = {};
let activeCreativeResult = null;
let activeCreativePrompt = null;
let organizing = false;
let saving = false;
let smartVisualFallback = false;
let autoTextCaptureActive = false;
let smartVisualSession = null;
let smartVisualCommitCreative = false;
let regionCaptureState = null;
let pageCaptureBatch = null;
let pageCaptureAppendBase = null;
let pageCaptureDraftIds = new Set();
const draftVisualHashes = new Map();
let pageCaptureSession = null;
let pageCaptureMediaView = null;
let pageCaptureEditHistory = [];
let pageCaptureOriginalCandidates = new Map();
let pageCapturePermissionState = { status: "unknown", origin: "", pattern: "" };
const visualUrls = new Map();
const FEEDBACK_DURATION_MS = 4000;
const ERROR_FEEDBACK_DURATION_MS = 8000;
let feedbackTimer = 0;
let pageCaptureRequestId = "";
let pageCaptureListRequested = false;
let pageCaptureEditing = null;
let pageCaptureCancelling = false;
let pageCapturePreviewRequest = 0;
const cancelledPageCaptureRequests = new Set();
let pendingCaptureAction = null;
let pendingClipboardButton = null;
let creatingCollection = false;
const NEW_COLLECTION_OPTION_VALUE = "new-collection";
const CLIPBOARD_IMAGE_EXTENSIONS = Object.freeze({
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp"
});

const customLabelEditor = createTagEditor({
  placeholder: t("输入标签，回车添加"),
  onChange: async (values) => {
    if (!draft) return false;
    return Boolean(await updateDraft({ ...draft, customLabels: values, customLabelsExplicit: true }));
  }
});
elements.customLabels.replaceChildren(customLabelEditor.element);

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== "local" || !(changes.captureDraft || changes.activeCreativeResult || changes.composerSessions)) return;
  refresh().catch(() => undefined);
});

await refresh();
await tryAutoSelection();
void refreshPageCapturePermissionState();
elements.pageCaptureTargetCount.max = String(PAGE_CAPTURE_LIMITS.maxCandidates);

elements.openLibrary.addEventListener("click", () => void openLibraryTab());
window.addEventListener("focus", () => {
  void tryAutoSelection();
  void refreshPageCapturePermissionState();
});
chrome.tabs.onActivated.addListener(() => void refreshPageCapturePermissionState());
chrome.tabs.onUpdated.addListener((_tabId, changeInfo, tab) => {
  if (tab.active && changeInfo.url) void refreshPageCapturePermissionState();
});
window.addEventListener("pagehide", () => void clearPageCaptureMarkers());
elements.startSelection.addEventListener("click", () => runAfterCapturePermissionOnboarding((context) => extractPageSelection(elements.startSelection)));
elements.startClipboard.addEventListener("click", () => extractClipboard(elements.startClipboard));
elements.addClipboard.addEventListener("click", () => extractClipboard(elements.addClipboard));
elements.startScreenshot.addEventListener("click", () => runAfterCapturePermissionOnboarding(() => captureFromActivePage("CAPTURE_ACTIVE_TAB_TO_DRAFT", elements.startScreenshot)));
elements.startSmartVisuals.addEventListener("click", () => runAfterCapturePermissionOnboarding(() => beginSmartVisualSelection(elements.startSmartVisuals)));
elements.startPageCapture.addEventListener("click", () => runAfterCapturePermissionOnboarding(() => startPageCapture("loaded", elements.startPageCapture)));
elements.resultScreenshot.addEventListener("click", () => runAfterCapturePermissionOnboarding(() => captureFromActivePage("CAPTURE_ACTIVE_TAB_TO_DRAFT", elements.resultScreenshot, true)));
elements.resultSmartVisuals.addEventListener("click", () => runAfterCapturePermissionOnboarding(() => beginSmartVisualSelection(elements.resultSmartVisuals, true)));
elements.saveOtherInspiration.addEventListener("click", () => clearActiveCreativeResult());
elements.addSelection.addEventListener("click", () => runAfterCapturePermissionOnboarding((context) => extractPageSelection(elements.addSelection)));
elements.addScreenshot.addEventListener("click", () => runAfterCapturePermissionOnboarding(() => captureFromActivePage("CAPTURE_ACTIVE_TAB_TO_DRAFT", elements.addScreenshot)));
elements.addSmartVisuals.addEventListener("click", () => runAfterCapturePermissionOnboarding(() => beginSmartVisualSelection(elements.addSmartVisuals)));
elements.addPageCapture.addEventListener("click", () => runAfterCapturePermissionOnboarding(() => startPageCapture("loaded", elements.addPageCapture)));
elements.capturePermissionCancel.addEventListener("click", cancelCapturePermissionOnboarding);
elements.capturePermissionForm.addEventListener("submit", confirmCapturePermissionOnboarding);
elements.capturePermissionOnboarding.addEventListener("cancel", (event) => {
  event.preventDefault();
  cancelCapturePermissionOnboarding();
});
elements.clipboardPermissionCancel.addEventListener("click", cancelClipboardPermissionEnable);
elements.clipboardPermissionForm.addEventListener("submit", confirmClipboardPermissionEnable);
elements.clipboardPermissionDialog.addEventListener("cancel", (event) => {
  event.preventDefault();
  cancelClipboardPermissionEnable();
});
elements.pageCaptureScan.addEventListener("click", () => {
  pageCaptureListRequested = false;
  void startPageCapture("loaded", elements.pageCaptureScan);
});
elements.pageCaptureMode.addEventListener("change", () => {
  pageCaptureListRequested = elements.pageCaptureMode.value === "list";
  if (!pageCaptureListRequested && pageCaptureBatch?.captureMode === "list") void startPageCapture("loaded", elements.pageCaptureScan);
  else render();
});
elements.pageCaptureEditCancel.addEventListener("click", async () => {
  if (!pageCaptureEditing) return;
  await chrome.runtime.sendMessage({ type: "CLEAR_PAGE_CAPTURE_MARKERS", tabId: pageCaptureBatch?.tabId, removeRegionMarkers: false });
});
elements.pageCaptureListRun.addEventListener("click", () => startPageListCapture(elements.pageCaptureListRun));
elements.pageCaptureSaveMode.addEventListener("change", () => {
  pageCaptureBatch = normalizePageCaptureBatch({ ...pageCaptureBatch, saveMode: elements.pageCaptureSaveMode.value });
  render();
});
elements.pageCaptureCombinedTitle.addEventListener("change", () => {
  pageCaptureBatch = normalizePageCaptureBatch({ ...pageCaptureBatch, combinedTitle: elements.pageCaptureCombinedTitle.value });
});
elements.pageCaptureCancel.addEventListener("click", cancelPageCapture);
elements.pageCaptureSave.addEventListener("click", () => savePageCapture(false));
elements.pageCaptureSaveTextOnly.addEventListener("click", () => savePageCapture(true));
elements.pageCaptureClear.addEventListener("click", clearPageCaptureConfirmation);
elements.pageCaptureAddRegion.addEventListener("click", () => editConfirmedPageCaptureRegion("include", elements.pageCaptureAddRegion));
elements.pageCaptureExcludeRegion.addEventListener("click", () => editConfirmedPageCaptureRegion("exclude", elements.pageCaptureExcludeRegion));
elements.pageCaptureUndoRegion.addEventListener("click", undoPageCaptureRegionEdit);
elements.pageCaptureResetRegion.addEventListener("click", resetPageCaptureRegionEdit);
elements.pageCaptureMediaClose.addEventListener("click", closePageCaptureMediaViewer);
elements.pageCaptureMediaPrev.addEventListener("click", () => movePageCaptureMediaViewer(-1));
elements.pageCaptureMediaNext.addEventListener("click", () => movePageCaptureMediaViewer(1));
elements.regionCaptureCancel.addEventListener("click", cancelRegionCapture);
elements.smartSelectionCancel.addEventListener("click", cancelSmartVisualSelection);
elements.smartSelectionConfirm.addEventListener("click", confirmSmartVisualSelection);
chrome.runtime.onMessage.addListener((message) => {
  if (message?.type === "SMART_VISUAL_SELECTION_CHANGED" && message.sessionId === smartVisualSession?.sessionId) {
    smartVisualSession = { ...smartVisualSession, ...message };
    render();
  } else if (message?.type === "SMART_VISUAL_SELECTION_ENDED" && message.sessionId === smartVisualSession?.sessionId && message.status !== "confirmed") {
    smartVisualSession = null;
    smartVisualCommitCreative = false;
    showFeedback(message.status === "timeout" ? "智能选图已超时，请重新开始" : "智能选图已结束");
    render();
  } else if (message?.type === "REGION_CAPTURE_CHANGED") {
    regionCaptureState = message.phase === "saved" || message.phase === "cancelled" || message.phase === "failed"
      ? null
      : { sessionId: message.sessionId, phase: message.phase };
    showFeedback(regionCaptureMessage(message.phase), message.phase === "failed");
    render();
  } else if (message?.type === "PAGE_CAPTURE_CHANGED") {
    if (cancelledPageCaptureRequests.has(message.requestId)) {
      void chrome.runtime.sendMessage({ type: "CANCEL_PAGE_CAPTURE", sessionId: message.sessionId });
      return;
    }
    if (!pageCaptureRequestId || message.requestId !== pageCaptureRequestId) return;
    pageCaptureSession = { sessionId: message.sessionId, phase: message.phase };
    pageCaptureBatch = normalizePageCaptureBatch(pageCaptureBatch
      ? { ...pageCaptureBatch, status: "scanning" }
      : { id: message.sessionId, status: "scanning", candidates: [] });
    render();
  }
});
elements.organizeToggle.addEventListener("click", () => {
  organizing = !organizing;
  render();
});
elements.discardDraft.addEventListener("click", () => discardDraft());
elements.exitTarget.addEventListener("click", () => discardDraft());
elements.saveDraft.addEventListener("click", () => commitDraft("", elements.saveDraft));
elements.mergeDuplicate.addEventListener("click", () => commitDraft("merge", elements.mergeDuplicate));
elements.saveSeparate.addEventListener("click", () => commitDraft("new", elements.saveSeparate));
elements.draftTitle.addEventListener("change", () => updateDraft({ ...draft, title: elements.draftTitle.value }));
elements.contentType.addEventListener("change", () => updateDraft({
  ...draft,
  contentTypeId: elements.contentType.value,
  contentTypeExplicit: true
}));
elements.captureCollection.addEventListener("change", () => {
  creatingCollection = elements.captureCollection.value === NEW_COLLECTION_OPTION_VALUE;
  const collectionId = creatingCollection ? "" : elements.captureCollection.value;
  void updateDraft({
    ...draft,
    collectionId,
    newCollectionName: creatingCollection ? draft.newCollectionName : ""
  }).then(() => {
    if (creatingCollection) elements.captureNewCollectionName.focus();
  });
});
elements.captureNewCollectionName.addEventListener("change", () => updateDraft({
  ...draft,
  collectionId: "",
  newCollectionName: elements.captureNewCollectionName.value
}));
elements.captureNewCollectionName.addEventListener("keydown", (event) => {
  if (event.key !== "Enter") return;
  event.preventDefault();
  elements.captureNewCollectionName.blur();
});

async function openLibraryTab() {
  try {
    const tab = await chrome.tabs.create({ url: chrome.runtime.getURL("library.html"), active: false });
    if (Number.isInteger(tab?.id)) {
      try {
        await chrome.sidePanel?.setOptions?.({ tabId: tab.id, enabled: false });
      } catch {
        showFeedback("灵感库已打开，但未能为新标签关闭侧边栏", true);
      }
      await chrome.tabs.update(tab.id, { active: true });
    }
  } catch (error) {
    showFeedback(error.message || "无法打开灵感库", true);
  }
}

async function runAfterCapturePermissionOnboarding(action) {
  const stored = await chrome.storage.local.get(CAPTURE_PERMISSION_ONBOARDING_STORAGE_KEY);
  const onboarding = normalizeCapturePermissionOnboarding(stored[CAPTURE_PERMISSION_ONBOARDING_STORAGE_KEY]);
  if (onboarding.acknowledgedAt) {
    return action({ clipboardPreferenceJustDeclined: false });
  }
  const permissionStatus = await inspectCapturePermissionBundle(chrome.permissions);
  if (permissionStatus.webCaptureGranted && permissionStatus.clipboardGranted) {
    await chrome.storage.local.set({
      [CAPTURE_PERMISSION_ONBOARDING_STORAGE_KEY]: {
        ...onboarding,
        acknowledgedAt: new Date().toISOString(),
        clipboardIncluded: true
      }
    });
    return action({ clipboardPreferenceJustDeclined: false });
  }
  pendingCaptureAction = { action, permissionStatus };
  elements.capturePermissionClipboard.checked = true;
  elements.capturePermissionStatus.textContent = "";
  elements.capturePermissionStatus.classList.remove("error");
  elements.capturePermissionOnboarding.showModal();
}

function cancelCapturePermissionOnboarding() {
  pendingCaptureAction = null;
  elements.capturePermissionOnboarding.close();
  showFeedback("已取消授权，待保存内容没有改变");
}

async function confirmCapturePermissionOnboarding(event) {
  event.preventDefault();
  if (!pendingCaptureAction) return elements.capturePermissionOnboarding.close();
  const pending = pendingCaptureAction;
  const includeClipboard = elements.capturePermissionClipboard.checked;
  elements.capturePermissionConfirm.disabled = true;
  elements.capturePermissionCancel.disabled = true;
  elements.capturePermissionStatus.textContent = t("正在等待 Chrome 确认…");
  elements.capturePermissionStatus.classList.remove("error");
  let permissionGranted = false;
  try {
    const permission = await requestCapturePermissionBundle(chrome.permissions, {
      includeClipboard,
      current: pending.permissionStatus
    });
    if (!permission.granted) {
      elements.capturePermissionStatus.textContent = t("未获得所选权限，待保存内容没有改变。你可以调整选择后重试。");
      elements.capturePermissionStatus.classList.add("error");
      return;
    }
    await chrome.storage.local.set({
      [CAPTURE_PERMISSION_ONBOARDING_STORAGE_KEY]: {
        version: CAPTURE_PERMISSION_ONBOARDING_VERSION,
        acknowledgedAt: new Date().toISOString(),
        clipboardIncluded: includeClipboard
      }
    });
    permissionGranted = true;
    pendingCaptureAction = null;
  } catch (error) {
    elements.capturePermissionStatus.textContent = error?.message || "权限申请失败，待保存内容没有改变。";
    elements.capturePermissionStatus.classList.add("error");
  } finally {
    elements.capturePermissionConfirm.disabled = false;
    elements.capturePermissionCancel.disabled = false;
  }
  if (!permissionGranted) return;
  elements.capturePermissionOnboarding.close();
  try {
    await pending.action({ clipboardPreferenceJustDeclined: !includeClipboard });
  } catch (error) {
    showFeedback(error?.message || "采集没有完成，待保存内容没有改变", true);
  }
}

async function refresh() {
  const response = await chrome.runtime.sendMessage({ type: "GET_CAPTURE_WORKSPACE" });
  if (!response?.ok) return showFeedback(response?.message || "无法读取待保存内容", true);
  const refreshedDraft = response.draft;
  await Promise.all(refreshedDraft.visuals.map(async visual => {
    if (!visual.contentHash) {
      if (!draftVisualHashes.has(visual.id)) draftVisualHashes.set(visual.id,
        getScreenshotBlob(visual.id).then(blob => blob ? sha256Blob(blob) : ""));
      visual.contentHash = await draftVisualHashes.get(visual.id);
    }
  }));
  draft = refreshedDraft;
  targetEntry = response.targetEntry ?? null;
  contentTypes = response.contentTypes ?? [];
  collections = response.collections ?? [];
  suggestedContentTypeId = response.suggestedContentTypeId || "";
  captureClassificationContext = response.classificationContext || {};
  partContentTypes = response.partContentTypes ?? {};
  activeCreativeResult = response.activeCreativeResult ?? null;
  activeCreativePrompt = response.activeCreativePrompt ?? null;
  syncDraftIntoPageCapture();
  render();
}

async function tryAutoSelection() {
  if (autoTextCaptureActive || pageCaptureBatch || !draft || activeCreativePrompt || draft.fragments.length || draft.visuals.length) return;
  autoTextCaptureActive = true;
  try {
    const response = await chrome.runtime.sendMessage({ type: "TRY_ACTIVE_SELECTION_TO_DRAFT" });
    if (!response?.ok || !response.added) return;
    draft = response.draft;
    showFeedback("已读取你刚才高亮的文字");
    render();
  } catch {
  } finally {
    autoTextCaptureActive = false;
  }
}

async function extractPageSelection(button) {
  await withButton(button, async () => {
    try {
      const selection = await runCaptureTransaction({
        type: "ADD_ACTIVE_SELECTION_TO_DRAFT", chromeApi: chrome, onStatus: showFeedback
      });
      if (selection.captured?.reason === "empty-selection") {
        showFeedback("请先在网页中选中文字");
        return;
      }
      draft = selection.draft;
      showFeedback(selection.message || "已提取网页高亮文字");
      await refresh();
    } catch (error) {
      showFeedback(error.message || "文字提取失败", true);
    }
  });
}

async function extractClipboard(button, { clipboardPreferenceJustDeclined = false } = {}) {
  await withButton(button, async () => {
    try {
      const stored = await chrome.storage.local.get(CAPTURE_PERMISSION_ONBOARDING_STORAGE_KEY);
      const onboarding = normalizeCapturePermissionOnboarding(stored[CAPTURE_PERMISSION_ONBOARDING_STORAGE_KEY]);
      if (onboarding.acknowledgedAt && !onboarding.clipboardIncluded) {
        if (clipboardPreferenceJustDeclined) {
          showFeedback("已按你的选择保持剪贴板关闭，未读取任何内容");
          return;
        }
        pendingClipboardButton = button;
        elements.clipboardPermissionStatus.textContent = "";
        elements.clipboardPermissionStatus.classList.remove("error");
        elements.clipboardPermissionDialog.showModal();
        return;
      }
      await extractClipboardContent();
    } catch (error) {
      if (error?.draft) draft = error.draft;
      if (draft) render();
      showFeedback(error.message || "文字或图片提取失败", true);
    }
  });
}

function cancelClipboardPermissionEnable() {
  pendingClipboardButton = null;
  elements.clipboardPermissionDialog.close();
  showFeedback("剪贴板仍保持关闭，未读取任何内容");
}

async function confirmClipboardPermissionEnable(event) {
  event.preventDefault();
  const button = pendingClipboardButton;
  if (!button) return elements.clipboardPermissionDialog.close();
  elements.clipboardPermissionConfirm.disabled = true;
  elements.clipboardPermissionCancel.disabled = true;
  elements.clipboardPermissionStatus.textContent = t("正在等待 Chrome 确认…");
  elements.clipboardPermissionStatus.classList.remove("error");
  try {
    if (!await ensureClipboardReadPermission(chrome.permissions)) {
      elements.clipboardPermissionStatus.textContent = t("未获得剪贴板读取权限，未读取任何内容。");
      elements.clipboardPermissionStatus.classList.add("error");
      return;
    }
    const stored = await chrome.storage.local.get(CAPTURE_PERMISSION_ONBOARDING_STORAGE_KEY);
    const onboarding = normalizeCapturePermissionOnboarding(stored[CAPTURE_PERMISSION_ONBOARDING_STORAGE_KEY]);
    await chrome.storage.local.set({
      [CAPTURE_PERMISSION_ONBOARDING_STORAGE_KEY]: { ...onboarding, clipboardIncluded: true }
    });
    pendingClipboardButton = null;
    elements.clipboardPermissionDialog.close();
    await withButton(button, extractClipboardContent);
  } catch (error) {
    showFeedback(error?.message || "剪贴板提取失败，未改变待保存内容", true);
  } finally {
    elements.clipboardPermissionConfirm.disabled = false;
    elements.clipboardPermissionCancel.disabled = false;
  }
}

async function extractClipboardContent() {
  showFeedback("正在读取你明确授权的当前剪贴板内容");
  let clipboardContent;
  try {
    clipboardContent = await readClipboardContentAfterFocus();
  } catch {
    showFeedback("剪贴板读取失败，请保持采集台获得焦点后再试", true);
    return;
  }
  const response = await addClipboardContentToDraft(clipboardContent);
  if (!response.added) {
    showFeedback(response.message, true);
    return;
  }
  draft = response.draft;
  showFeedback(response.message);
  await refresh();
}

async function addClipboardContentToDraft({ text: clipboardText, image } = {}) {
  let nextDraft = draft;
  let addedText = false;
  let addedImage = false;
  let storedVisualId = "";
  const candidate = await createTextCandidate({ clipboard: clipboardText });
  if (candidate) {
    const result = addDraftFragment(nextDraft, candidate);
    nextDraft = result.draft;
    addedText = result.added;
  }
  if (image instanceof Blob) {
    const extension = CLIPBOARD_IMAGE_EXTENSIONS[image.type.toLocaleLowerCase("en-US")];
    if (!extension) throw new Error("剪贴板图片格式暂不支持");
    const visualId = crypto.randomUUID();
    const prepared = await prepareLocalMedia(
      new File([image], `clipboard.${extension}`, { type: image.type }),
      visualId,
      { estimateStorage: () => navigator.storage?.estimate?.() ?? {} }
    );
    const duplicate = prepared.asset.contentHash && nextDraft.visuals.some((visual) => visual.contentHash === prepared.asset.contentHash);
    if (!duplicate) {
      await saveScreenshotBlob(visualId, prepared.blob);
      storedVisualId = visualId;
      nextDraft = addDraftVisual(nextDraft, { ...prepared.asset, sourceTitle: "剪贴板" });
      addedImage = true;
    }
  }
  if (!addedText && !addedImage) {
    return {
      added: false,
      message: candidate || image ? "剪贴板里的文字或图片已经在当前草稿中" : "剪贴板里没有可提取的文字或图片",
      draft
    };
  }
  try {
    const response = await chrome.runtime.sendMessage({ type: "UPDATE_CAPTURE_DRAFT", draft: nextDraft });
    if (!response?.ok) throw new Error(response?.message || "剪贴板内容没有写入草稿");
    return {
      added: true,
      message: addedText && addedImage ? "已提取剪贴板文字和图片" : addedImage ? "已提取剪贴板图片" : "已提取剪贴板文字",
      draft: response.draft
    };
  } catch (error) {
    if (storedVisualId) await deleteScreenshotBlob(storedVisualId).catch(() => undefined);
    throw error;
  }
}

function render() {
  if (!draft) return;
  const view = collectorViewState(draft, targetEntry, { organizing });
  if (!view.hasContent) organizing = false;
  elements.startState.hidden = Boolean(smartVisualSession || pageCaptureBatch || regionCaptureState) || !view.showStart;
  const showCreativeResult = view.showStart && Boolean(activeCreativePrompt);
  elements.resultStart.hidden = !showCreativeResult;
  elements.normalStart.hidden = showCreativeResult;
  elements.resultPromptTitle.textContent = activeCreativePrompt?.title || "";
  elements.smartSelection.hidden = !smartVisualSession;
  elements.pageCapture.hidden = !pageCaptureBatch || Boolean(smartVisualSession || regionCaptureState);
  document.body.classList.toggle("page-capture-active", Boolean(pageCaptureBatch));
  if (pageCaptureBatch) {
    elements.pageCaptureTools.before(elements.captureAddMoreActions);
    elements.pageCaptureActions.before(elements.captureMetadata);
  } else {
    elements.organizer.before(elements.captureAddMoreActions);
    elements.captureAddMoreActions.before(elements.captureMetadata);
  }
  elements.captureAddMoreActions.hidden = Boolean(pageCaptureBatch && (pageCaptureAppendBase || pageCaptureBatch.selections.length !== 1));
  elements.captureMetadata.hidden = pageCaptureBatch ? !pageCaptureBatch.selections.length : !view.showPreview;
  elements.regionCaptureStatus.hidden = !regionCaptureState;
  elements.previewState.hidden = Boolean(smartVisualSession || pageCaptureBatch || regionCaptureState) || !view.showPreview;
  elements.collectorFooter.hidden = Boolean(smartVisualSession || pageCaptureBatch || regionCaptureState) || !view.showFooter;
  if (regionCaptureState) {
    elements.regionCaptureTitle.textContent = t(regionCaptureMessage(regionCaptureState.phase));
    elements.regionCaptureHelp.textContent = regionCaptureState.phase === "selecting"
      ? t("请切回网页拖动选择画面；按 Esc 或在这里取消。")
      : t("请保持当前网页与侧边栏打开，完成后会自动回到待保存内容。");
    elements.regionCaptureCancel.disabled = !regionCaptureState.sessionId || ["capturing"].includes(regionCaptureState.phase);
  }
  if (pageCaptureBatch) renderPageCapture();
  if (smartVisualSession) {
    elements.smartSelectionCount.textContent = t("已选 {count} 张", { count: smartVisualSession.selectedCount || 0 });
    elements.smartSelectionHelp.textContent = t("网页中识别到 {count} 个候选；点击画面选择，页面滚动或布局变化后会自动重新对齐。", { count: smartVisualSession.candidateCount || 0 });
    elements.smartSelectionConfirm.disabled = !(smartVisualSession.selectedCount > 0);
    const overlayUnavailable = smartVisualSession.overlayReady === false;
    elements.smartSelectionWarning.hidden = !overlayUnavailable;
    elements.smartSelectionWarning.textContent = overlayUnavailable
      ? t("当前页面没有成功显示选图层，请退出网页元素全屏后重试。")
      : "";
  }
  elements.targetBanner.hidden = !targetEntry;
  elements.targetLabel.textContent = translateUiMessage(view.targetLabel);
  elements.contentSummary.textContent = translateUiMessage(view.summary);
  elements.saveDraft.textContent = t(view.saveLabel);
  elements.saveDraft.disabled = saving || !view.hasContent;
  elements.draftTitle.disabled = saving;
  elements.contentType.disabled = saving;
  elements.captureCollection.disabled = saving;
  elements.captureNewCollectionName.disabled = saving;
  for (const control of [
    elements.addClipboard,
    elements.startClipboard,
    elements.addSelection,
    elements.addScreenshot,
    elements.addSmartVisuals,
    elements.startSelection,
    elements.startScreenshot,
    elements.startSmartVisuals,
    elements.resultScreenshot,
    elements.resultSmartVisuals,
    elements.saveOtherInspiration,
    elements.organizeToggle,
    elements.discardDraft,
    elements.exitTarget,
    elements.mergeDuplicate,
    elements.saveSeparate
  ]) {
    control.disabled = saving;
  }
  elements.organizer.hidden = !view.showOrganizer;
  elements.organizeToggle.setAttribute("aria-expanded", String(view.showOrganizer));
  elements.organizeToggle.title = t(view.showOrganizer ? "收起整理" : "编辑与整理");
  elements.organizeToggle.setAttribute("aria-label", elements.organizeToggle.title);
  elements.fragmentSection.hidden = !view.showOrganizer || !draft.fragments.length;
  elements.visualSection.hidden = !view.showOrganizer || !draft.visuals.length;
  elements.fragmentHelp.textContent = view.canReorderFragments ? t("使用箭头调整段落顺序") : "";
  elements.visualHelp.textContent = view.canReorderVisuals ? t("使用箭头调整图片顺序") : "";
  if (document.activeElement !== elements.draftTitle) {
    elements.draftTitle.value = draft.title || targetEntry?.title || "";
  }
  const pageCandidate = pageCaptureBatch?.selections.length === 1 ? applyPageCaptureSelections(finalizePageCaptureSelectionsForSave(pageCaptureBatch))[0] : null;
  const pageClassification = pageCandidate ? classifyContent({ text: pageCandidate.contentText,
    title: pageCandidate.title, url: pageCandidate.canonicalUrl, sourceFacts: pageCandidate.sourceFacts, mediaAssets: pageCandidate.media },
    captureClassificationContext.rules, captureClassificationContext.taxonomy) : null;
  const selectedContentType = draft.contentTypeExplicit ? draft.contentTypeId
    : pageCandidate ? pageClassification?.pathIds?.[0] : draft.contentTypeId || suggestedContentTypeId;
  elements.contentType.replaceChildren(...contentTypes.map((item) => {
    const option = document.createElement("option");
    option.value = item.id;
    option.textContent = item.customized ? item.name : t(item.name);
    option.selected = item.id === selectedContentType;
    return option;
  }));
  if (!selectedContentType || !contentTypes.some((item) => item.id === selectedContentType)) {
    const option = document.createElement("option");
    option.value = "";
    option.textContent = t("待确认");
    option.selected = true;
    elements.contentType.prepend(option);
  }
  const selectedCollectionId = draft.collectionId && collections.some((item) => item.id === draft.collectionId)
    ? draft.collectionId
    : "";
  creatingCollection = creatingCollection || Boolean(draft.newCollectionName);
  elements.captureCollection.replaceChildren(
    optionElement("", t("不分组"), !creatingCollection && !selectedCollectionId),
    ...collections.map((item) => optionElement(item.id, item.name, !creatingCollection && item.id === selectedCollectionId)),
    optionElement(NEW_COLLECTION_OPTION_VALUE, t("＋ 新建项目"), creatingCollection)
  );
  elements.captureNewCollectionRow.hidden = !creatingCollection;
  if (document.activeElement !== elements.captureNewCollectionName) {
    elements.captureNewCollectionName.value = draft.newCollectionName || "";
  }
  customLabelEditor.setValues(draft.customLabels ?? []);
  customLabelEditor.setDisabled(saving);
  elements.quickPreview.replaceChildren(...createQuickPreview());
  elements.otherCaptureMethods.classList.toggle("fallback-highlight", smartVisualFallback);
  elements.addScreenshot.classList.toggle("fallback-highlight", smartVisualFallback);
  for (const button of [elements.addSmartVisuals, elements.addSelection, elements.addClipboard, elements.addScreenshot, elements.addPageCapture]) {
    button.disabled = saving || button.hasAttribute("aria-busy") || Boolean(pageCaptureBatch && (pageCaptureRequestId || pageCaptureEditing || pageCaptureCancelling || pageCaptureBatch.status === "saving" || pageCaptureBatch.selections.length !== 1));
  }
  renderPageCapturePermissionAction();
  elements.fragmentList.replaceChildren(...draft.fragments.map((fragment, index) =>
    createFragmentCard(fragment, index, view.canReorderFragments)));
  elements.visualList.replaceChildren(...draft.visuals.map((visual, index) =>
    createVisualCard(visual, index, view)));
}

async function refreshPageCapturePermissionState() {
  try {
    const tab = await resolveActivePage(chrome.tabs, chrome.scripting);
    if (!tab?.url && Number.isInteger(tab?.id)) {
      pageCapturePermissionState = { status: "active-tab-required", origin: "", pattern: "" };
    } else {
      pageCapturePermissionState = await inspectPagePermission(tab?.url || "", chrome.permissions);
    }
  } catch {
    pageCapturePermissionState = { status: "restricted", origin: "", pattern: "" };
  }
  renderPageCapturePermissionAction();
  return pageCapturePermissionState;
}

function renderPageCapturePermissionAction() {
  const startText = elements.startPageCapture.querySelector("strong");
  if (startText) startText.textContent = t("网页采集");
  elements.addPageCapture.querySelector("span").textContent = t("网页");

}

function renderPageCapture() {
  const activeCardId = document.activeElement?.closest(".page-capture-item")?.dataset.candidateId;
  const activeMediaId = document.activeElement?.closest(".page-capture-media-review-item")?.dataset.mediaId;
  const selections = new Map(pageCaptureBatch.selections.map((selection) => [selection.candidateId, selection]));
  const selectedCount = pageCaptureBatch.selections.length;
  const listMode = pageCaptureBatch.captureMode === "list";
  const scanning = pageCaptureBatch.status === "scanning";
  const busy = scanning || pageCaptureBatch.status === "saving" || Boolean(pageCaptureEditing) || pageCaptureCancelling;
  elements.pageCaptureTitle.textContent = t("网页采集");
  elements.pageCaptureHelp.textContent = pageCaptureBatch.status === "scanning"
    ? t("正在扫描已加载内容；可随时停止，结束后会恢复原滚动位置。")
    : pageCaptureBatch.error || (selectedCount ? t("已选 {count} 项内容", { count: selectedCount }) : pageCaptureBatch.candidates.length ? t("选择要保存的内容") : t("未识别到内容，可重新扫描或返回选择其他采集方式"));
  const selectedMediaCount = pageCaptureBatch.selections.reduce((count, selection) => count + selection.selectedMediaIds.length, 0);
  const saveBlocked = busy || !selectedCount || (listMode && !["multiple", "combined"].includes(pageCaptureBatch.saveMode));
  elements.pageCaptureSave.disabled = saveBlocked;
  elements.pageCaptureSaveTextOnly.disabled = saveBlocked;
  elements.pageCaptureSaveTextOnly.hidden = selectedMediaCount === 0;
  elements.pageCaptureSave.textContent = listMode
    ? pageCaptureBatch.saveMode === "combined" ? t("合并保存案例") : t("保存 {count} 个案例", { count: selectedCount })
    : t("保存案例");
  elements.pageCaptureSaveSummary.textContent = scanning ? t("正在读取网页正文和媒体…")
    : pageCaptureBatch.status === "saving" ? t("正在保存…")
    : selectedCount ? t("已选 {count} 项内容 · {media} 项媒体", { count: selectedCount, media: selectedMediaCount }) : t("请选择一项内容");
  elements.pageCaptureCancel.textContent = scanning ? t("停止扫描") : t("退出");
  elements.pageCaptureCancel.disabled = pageCaptureBatch.status === "saving" || pageCaptureCancelling;
  elements.pageCaptureScan.hidden = false;
  elements.pageCaptureScan.disabled = busy;
  elements.pageCaptureMode.disabled = busy;
  elements.pageCaptureMode.value = listMode || pageCaptureListRequested ? "list" : "single";
  elements.pageCaptureListSetup.hidden = listMode || !pageCaptureListRequested;
  elements.pageCaptureListRun.disabled = busy || selectedCount !== 1;
  elements.pageCaptureTargetCount.disabled = busy;
  elements.pageCaptureListResult.hidden = !listMode;
  elements.pageCaptureSaveMode.disabled = busy;
  elements.pageCaptureCombinedTitle.disabled = busy;
  elements.pageCaptureTools.hidden = !selectedCount;
  if (!selectedCount) elements.pageCaptureTools.open = false;
  elements.pageCaptureClear.textContent = listMode ? t("取消选择") : t("换一项");
  elements.pageCaptureClear.disabled = busy;
  elements.pageCaptureEditStatus.hidden = !pageCaptureEditing;
  elements.pageCaptureEditHelp.textContent = pageCaptureEditing?.mode === "include" ? t("点击网页中遗漏的内容，完成后返回") : t("点击网页中不想保存的内容，完成后返回");
  if (listMode) {
    const reviewCount = pageCaptureBatch.candidates.filter((candidate) => candidate.batchStructureStatus === "review").length;
    elements.pageCaptureListSummary.textContent = t("目标 {target} 个，实际识别 {actual} 个。{reason}", {
      target: pageCaptureBatch.targetCount,
      actual: pageCaptureBatch.candidates.length,
      reason: pageCaptureStopReasonLabel(pageCaptureBatch.stopReason)
    }) + (reviewCount ? t(" · {count} 个结构不同的案例未自动加入，请单独确认。", { count: reviewCount }) : "");
    if (document.activeElement !== elements.pageCaptureSaveMode) elements.pageCaptureSaveMode.value = pageCaptureBatch.saveMode;
    elements.pageCaptureCombinedTitleRow.hidden = pageCaptureBatch.saveMode !== "combined";
    if (document.activeElement !== elements.pageCaptureCombinedTitle) elements.pageCaptureCombinedTitle.value = pageCaptureBatch.combinedTitle;
  }
  const expandedPreviews = new Set([...elements.pageCaptureList.querySelectorAll(".page-capture-item")]
    .filter(card => card.querySelector(".page-capture-preview-details")?.open).map(card => card.dataset.candidateId));
  elements.pageCaptureList.replaceChildren(...pageCaptureBatch.candidates.map(candidate => createPageCaptureCard(candidate, {
    selected: selections.has(candidate.id), listMode, busy,
    hidden: !listMode && !pageCaptureListRequested && selectedCount > 0 && !selections.has(candidate.id),
    meta: [pageCaptureTypeLabel(candidate.pageType), candidate.extraction.scope === "selection" ? t("原网页选区") : "", hostname(candidate.canonicalUrl), candidate.sourceFacts.author,
      candidate.batchStructureStatus === "review" ? t("结构需复核") : ""].filter(Boolean).join(" · "),
    onSelect: () => selections.has(candidate.id) ? (listMode ? removePageCaptureCandidate(candidate.id) : clearPageCaptureConfirmation()) : confirmPageCaptureCandidate(candidate),
    onLocate: () => previewPageCaptureRegion(candidate, true),
    onIncludeSupplement: item => includePageCaptureSupplement(candidate, item),
    selectedMediaIds: selections.get(candidate.id)?.selectedMediaIds || [],
    loadLocalVisual: loadVisual,
    onIncludeMediaGroup: group => {
      const selection = selections.get(candidate.id);
      pageCaptureEditHistory.push({ candidateId: candidate.id, candidate: structuredClone(candidate), selection: structuredClone(selection) });
      pageCaptureBatch = normalizePageCaptureBatch({ ...pageCaptureBatch, selections: pageCaptureBatch.selections.map(s => s.candidateId === candidate.id
        ? { ...s, mediaDecision: "confirmed", selectedMediaIds: [...new Set([...s.selectedMediaIds, ...group.map(m => m.id)])] } : s) });
      render();
    },
    onRemoveMedia: media => {
      const selection = selections.get(candidate.id);
      pageCaptureEditHistory.push({ candidateId: candidate.id, candidate: structuredClone(candidate), selection: structuredClone(selection) });
      pageCaptureBatch = normalizePageCaptureBatch({ ...pageCaptureBatch, selections: pageCaptureBatch.selections.map(s => s.candidateId === candidate.id
        ? { ...s, mediaDecision: "confirmed", selectedMediaIds: s.selectedMediaIds.filter(id => id !== media.id) } : s) });
      render();
    },
    onPreviewMedia: index => openPageCaptureMediaViewer(candidate, index),
    createArticlePreview: () => createPageCaptureArticlePreview(candidate, selections.get(candidate.id)),
    previewOpen: expandedPreviews.has(candidate.id)
  })));
  const canEditRegion = !busy && !listMode && selectedCount === 1;
  elements.pageCaptureAddRegion.disabled = !canEditRegion;
  elements.pageCaptureExcludeRegion.disabled = !canEditRegion;
  elements.pageCaptureUndoRegion.disabled = !canEditRegion || !pageCaptureEditHistory.length;
  elements.pageCaptureResetRegion.disabled = !canEditRegion || !pageCaptureEditHistory.length;
  elements.pageCaptureAddRegion.hidden = listMode;
  elements.pageCaptureExcludeRegion.hidden = listMode;
  elements.pageCaptureUndoRegion.hidden = listMode;
  elements.pageCaptureResetRegion.hidden = listMode;
  renderPageCaptureMediaReview(selections);
  if (activeCardId) elements.pageCaptureList.querySelector(`[data-candidate-id="${CSS.escape(activeCardId)}"] .page-capture-confirm`)?.focus({ preventScroll: true });
  if (activeMediaId) elements.pageCaptureMediaReviewList.querySelector(`[data-media-id="${CSS.escape(activeMediaId)}"] button:last-child`)?.focus({ preventScroll: true });
}

function createPageCaptureArticlePreview(candidate, selection) {
  const section = document.createElement("section");
  section.className = "page-capture-article";
  const heading = document.createElement("header");
  const blocks = candidate.articleDocument?.blocks?.length
    ? candidate.articleDocument.blocks
    : [
        ...candidate.textBlocks.map((block, sourceOrder) => ({ ...block, kind: block.kind === "section" ? "paragraph" : block.kind, sourceOrder })),
        ...candidate.media.filter((media) => media.placement === "inline").map((media, index) => ({ id: `fallback:${media.id}`, kind: media.kind, assetId: media.id, sourceUrl: media.url, label: media.alt, sourceOrder: candidate.textBlocks.length + index }))
      ];
  heading.append(
    textNode("strong", candidate.extraction.scope === "selection" ? t("原网页选区") : "完整文章预览"),
    textNode("small", `${pageCaptureExtractionLabel(candidate.extraction.method)} · ${blocks.length} 个有序内容块`)
  );
  section.append(heading);
  const mediaById = new Map(candidate.media.map((media) => [media.id, media]));
  for (const block of blocks.toSorted((left, right) => left.sourceOrder - right.sourceOrder)) {
    const media = block.assetId ? mediaById.get(block.assetId) : null;
    if (["image", "video"].includes(block.kind)) {
      section.append(createPageCaptureArticleMedia(candidate, media, block, selection));
      continue;
    }
    if (["document", "attachment", "link"].includes(block.kind)) {
      section.append(createPageCaptureArticleResource(media, block, selection));
      continue;
    }
    const tagName = block.kind === "heading" ? `h${Math.min(6, Math.max(1, Number(block.level) || 2))}`
      : block.kind === "quote" ? "blockquote" : block.kind === "code" ? "pre" : "p";
    const node = textNode(tagName, block.text || "");
    if (block.kind === "list") node.textContent = block.text.split("\n").map((item) => `• ${item}`).join("\n");
    section.append(node);
  }
  return section;
}

function createPageCaptureArticleMedia(candidate, media, block, selection) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "page-capture-article-media";
  setPageCaptureMediaDecisionClass(button, media?.id, selection);
  const mediaIndex = media ? candidate.media.findIndex((item) => item.id === media.id) : -1;
  if (mediaIndex >= 0) button.addEventListener("click", () => openPageCaptureMediaViewer(candidate, mediaIndex));
  else if (block.sourceUrl) button.addEventListener("click", () => openPageCaptureArticleUrl(block.sourceUrl));
  const preview = document.createElement("span");
  preview.className = "page-capture-media-preview";
  const previewUrl = media?.kind === "video" ? media.posterUrl : media?.previewDataUrl || media?.dataUrl || media?.url || block.posterUrl || block.sourceUrl;
  if (previewUrl || media?.localAssetId) {
    const image = document.createElement("img");
    if (media?.localAssetId) loadVisual(image, media.localAssetId);
    else image.src = previewUrl;
    image.alt = "";
    image.referrerPolicy = "no-referrer";
    image.addEventListener("error", () => {
      preview.replaceChildren(textNode("span", t("预览不可用")));
      button.classList.add("preview-unavailable");
    }, { once: true });
    preview.append(image);
  } else preview.textContent = block.kind === "video" ? "VIDEO" : t("预览不可用");
  const copy = document.createElement("span");
  const evidence = [];
  if (media?.width && media?.height) evidence.push(`${media.width}×${media.height}`);
  if (media?.declaredWidth) evidence.push(t("候选 {count}px", { count: media.declaredWidth }));
  else if (media?.density > 1) evidence.push(t("候选 {count}x", { count: media.density }));
  if (media?.kind === "image") evidence.push(pageCaptureMediaSourceLabel(media.sourceKind, media.captureMethod));
  copy.append(
    textNode("strong", block.kind === "video" ? t("视频引用") : t("图片")),
    textNode("small", [block.label || media?.alt || hostname(block.sourceUrl || media?.url) || t("可见媒体"), ...evidence].filter(Boolean).join(" · "))
  );
  button.append(preview, copy);
  return button;
}

function createPageCaptureArticleResource(media, block, selection) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "page-capture-article-resource";
  if (["document", "attachment"].includes(block.kind)) setPageCaptureMediaDecisionClass(button, media?.id, selection);
  const sourceUrl = block.sourceUrl || media?.url || "";
  button.disabled = !sourceUrl;
  if (sourceUrl) button.addEventListener("click", () => openPageCaptureArticleUrl(sourceUrl));
  button.append(
    textNode("span", block.kind === "attachment" ? "SKILL" : block.kind === "document" ? "DOC" : "LINK"),
    textNode("span", block.label || media?.filename || hostname(sourceUrl) || "下载资源")
  );
  return button;
}

function openPageCaptureArticleUrl(url) {
  chrome.tabs.create({ url, active: true }).catch(() => showFeedback("无法打开这个文章资源", true));
}

function removePageCaptureCandidate(candidateId) {
  pageCaptureBatch = normalizePageCaptureBatch({
    ...pageCaptureBatch,
    selections: pageCaptureBatch.selections.filter((item) => item.candidateId !== candidateId)
  });
  render();
}

function textNode(tagName, value) {
  const node = document.createElement(tagName);
  node.textContent = value;
  return node;
}

function appendToPageCapture(addition) {
  const selection = pageCaptureBatch?.selections[0];
  if (!selection || pageCaptureBatch.selections.length !== 1) return;
  const candidate = pageCaptureBatch.candidates.find(c => c.id === selection.candidateId);
  const result = appendCaptureCandidate(candidate, addition, selection);
  pageCaptureEditHistory.push({ candidateId: candidate.id, candidate: structuredClone(candidate), selection: structuredClone(selection) });
  pageCaptureBatch = normalizePageCaptureBatch({ ...pageCaptureBatch,
    candidates: pageCaptureBatch.candidates.map(c => c.id === candidate.id ? result.candidate : c),
    selections: [result.selection] });
}

function syncDraftIntoPageCapture() {
  if (!draft || !pageCaptureBatch || pageCaptureAppendBase || pageCaptureBatch.selections.length !== 1 || pageCaptureBatch.status === "saving") return;
  const addition = draftCaptureAddition(draft, pageCaptureDraftIds);
  if (!addition.consumed.length) return;
  appendToPageCapture(addition);
  addition.consumed.forEach(id => pageCaptureDraftIds.add(id));
}

function confirmPageCaptureCandidate(candidate) {
  if (pageCaptureRequestId || pageCaptureEditing || pageCaptureCancelling || pageCaptureBatch?.status === "saving") return;
  if (pageCaptureAppendBase) {
    const selected = applyPageCaptureSelections(normalizePageCaptureBatch({ ...pageCaptureBatch,
      selections: [{ candidateId: candidate.id, selectedTextBlockIds: candidate.textBlocks.map(b => b.id),
        selectedMediaIds: pageCaptureDefaultMediaIds(candidate), mediaDecision: "confirmed" }] }))[0];
    pageCaptureBatch = pageCaptureAppendBase;
    pageCaptureAppendBase = null;
    appendToPageCapture(selected);
    render();
    return;
  }
  pageCaptureDraftIds = new Set();
  const next = normalizePageCaptureSelection({
    candidateId: candidate.id,
    selectedTextBlockIds: candidate.textBlocks.map((item) => item.id),
    selectedMediaIds: pageCaptureDefaultMediaIds(candidate),
    mediaDecision: "pending"
  }, pageCaptureBatch.candidates);
  pageCaptureBatch = normalizePageCaptureBatch({
    ...pageCaptureBatch,
    selections: next ? (pageCaptureBatch.captureMode === "list" ? [...pageCaptureBatch.selections, next] : [next]) : []
  });
  syncDraftIntoPageCapture();
  previewPageCaptureRegion(candidate);
  render();
}

function clearPageCaptureConfirmation() {
  if (pageCaptureRequestId || pageCaptureEditing || pageCaptureCancelling || pageCaptureBatch?.status === "saving") return;
  pageCaptureBatch = normalizePageCaptureBatch({ ...pageCaptureBatch, selections: [] });
  previewPageCaptureRegion(null);
  render();
}

async function previewPageCaptureRegion(candidate, locate = false) {
  const request = ++pageCapturePreviewRequest;
  const selection = pageCaptureBatch?.selections.find(item => item.candidateId === candidate?.id);
  const response = await chrome.runtime.sendMessage({
    type: "PREVIEW_PAGE_CAPTURE_REGION", tabId: pageCaptureBatch?.tabId,
    preview: {
      marker: candidate?.region?.marker || "", targets: candidate?.region?.contentTargets || [],
      text: [candidate?.contentText, ...(candidate?.articleDocument?.blocks || []).map(block => block.text)].filter(Boolean).join("\n"),
      mediaIds: selection?.selectedMediaIds || (candidate ? pageCaptureDefaultMediaIds(candidate) : []),
      mediaUrls: (candidate?.media || []).filter(media => (selection?.selectedMediaIds || pageCaptureDefaultMediaIds(candidate)).includes(media.id))
        .flatMap(media => [media.url, ...(media.variants || []).map(variant => variant.url)]).filter(Boolean),
      edits: candidate?.region?.edits || [], locate
    }
  }).catch(() => ({ ok: false, message: t("无法在当前网页显示区域高亮") }));
  if (request === pageCapturePreviewRequest && candidate && !response?.ok) showFeedback(response?.message || t("部分内容无法在网页定位，请以保存预览为准"), true);
}

async function editConfirmedPageCaptureRegion(mode, button) {
  if (pageCaptureRequestId || pageCaptureEditing || pageCaptureCancelling || pageCaptureBatch?.status === "saving") return;
  const batchId = pageCaptureBatch?.id;
  const selectedId = pageCaptureBatch?.selections?.[0]?.candidateId;
  const candidate = pageCaptureBatch?.candidates?.find(item => item.id === selectedId);
  if (!candidate) return showFeedback("请先确认一个主体方案", true);
  const edit = { mode, batchId };
  await withButton(button, async () => {
    pageCaptureEditing = edit;
    render();
    try {
      const response = await chrome.runtime.sendMessage({ type: "EDIT_PAGE_CAPTURE_REGION", tabId: pageCaptureBatch.tabId, candidate, mode });
      if (pageCaptureEditing !== edit || pageCaptureBatch?.id !== batchId) return;
      if (!response?.ok) {
        if (!response?.cancelled) showFeedback(response?.message || "网页区域没有修改", true);
        void previewPageCaptureRegion(candidate);
        return;
      }
      pageCaptureEditHistory.push({ candidateId: candidate.id, candidate: structuredClone(candidate) });
      replacePageCaptureCandidate(response.candidate);
      showFeedback(response.message);
    } catch (error) {
      showFeedback(error.message || "网页区域没有修改", true);
    } finally {
      if (pageCaptureEditing === edit) pageCaptureEditing = null;
      render();
    }
  });
  render();
}

function includePageCaptureSupplement(candidate, item) {
  if (!candidate.supplements.some(value => value.id === item.id)) return;
  const paragraph = document.createElement("p");
  paragraph.textContent = item.text;
  const block = { id: item.id, kind: "section", text: item.text, html: paragraph.outerHTML, sourceOrder: candidate.textBlocks.length };
  const revised = {
    ...candidate,
    textBlocks: [...candidate.textBlocks, block],
    contentText: [candidate.contentText, item.text].filter(Boolean).join("\n\n"),
    articleDocument: { version: 1, blocks: [...(candidate.articleDocument?.blocks || []),
      { id: item.id + ":source", kind: "link", sourceUrl: item.sourceUrl, label: t("作者补充") },
      { ...block, kind: "paragraph" }] },
    supplements: candidate.supplements.filter(value => value.id !== item.id),
    completeness: item.partial ? "partial" : candidate.completeness,
    sourceFacts: { ...candidate.sourceFacts, status: item.partial ? "partial" : candidate.sourceFacts.status }
  };
  pageCaptureBatch = normalizePageCaptureBatch({ ...pageCaptureBatch,
    candidates: pageCaptureBatch.candidates.map(value => value.id === candidate.id ? revised : value),
    selections: pageCaptureBatch.selections.map(selection => selection.candidateId === candidate.id
      ? { ...selection, includeText: true, selectedTextBlockIds: [...(selection.selectedTextBlockIds || (selection.includeText ? candidate.textBlocks.map(value => value.id) : [])), item.id] }
      : selection)
  });
  render();
}

function replacePageCaptureCandidate(candidate) {
  const candidates = pageCaptureBatch.candidates.map((item) => item.id === candidate.id ? candidate : item);
  const selection = normalizePageCaptureSelection({
    candidateId: candidate.id,
    selectedTextBlockIds: candidate.textBlocks.map((item) => item.id),
    selectedMediaIds: pageCaptureDefaultMediaIds(candidate),
    mediaDecision: "pending"
  }, candidates);
  pageCaptureBatch = normalizePageCaptureBatch({ ...pageCaptureBatch, candidates, selections: selection ? [selection] : [] });
  previewPageCaptureRegion(candidate);
  render();
}

function renderPageCaptureMediaReview(selections) {
  const selected = pageCaptureBatch.candidates.flatMap((candidate) => {
    const selection = selections.get(candidate.id);
    return selection ? candidate.media.map((media, mediaIndex) => ({ candidate, media, mediaIndex, selection })) : [];
  });
  elements.pageCaptureMediaReview.hidden = pageCaptureBatch.selections.length === 0;
  if (!pageCaptureBatch.selections.length) {
    elements.pageCaptureMediaReviewList.replaceChildren();
    return;
  }
  const proposedCount = pageCaptureBatch.selections.reduce((count, selection) => count + selection.selectedMediaIds.length, 0);
  elements.pageCaptureMediaReviewStatus.textContent = selected.length
    ? t("{count} 项媒体", { count: proposedCount })
    : t("未识别到媒体，可返回网页补选");
  const createRow = ({ candidate, media, mediaIndex, selection }) => {
    const row = document.createElement("div");
    row.className = "page-capture-media-review-item";
    row.dataset.mediaId = `${candidate.id}:${media.id}`;
    setPageCaptureMediaDecisionClass(row, media.id, selection);
    const preview = document.createElement("button");
    preview.type = "button";
    preview.className = "page-capture-media-review-preview";
    preview.addEventListener("click", () => openPageCaptureMediaViewer(candidate, mediaIndex));
    const previewUrl = media.kind === "video" ? media.posterUrl : media.previewDataUrl || media.dataUrl || media.url;
    if (previewUrl || media.localAssetId) {
      const image = document.createElement("img");
      if (media.localAssetId) loadVisual(image, media.localAssetId);
      else image.src = previewUrl;
      image.alt = "";
      image.referrerPolicy = "no-referrer";
      image.addEventListener("error", () => preview.replaceChildren(textNode("span", t("预览不可用"))), { once: true });
      preview.append(image);
    } else preview.append(textNode("span", media.kind === "video" ? "VIDEO" : "DOC"));
    const copy = document.createElement("span");
    copy.append(
      textNode("strong", media.kind === "video" ? t("视频") : ["document", "attachment"].includes(media.kind) ? t("文档") : media.captureMethod === "pixel-fallback" ? t("页面截图") : t("图片")),
      textNode("small", media.alt || media.filename || hostname(media.url || media.posterUrl) || t("可见媒体"))
    );
    const toggle = document.createElement("button");
    toggle.type = "button";
    toggle.className = "button-secondary compact";
    const included = selection.mediaDecision !== "none" && selection.selectedMediaIds.includes(media.id);
    toggle.textContent = included ? t("排除") : t("恢复");
    toggle.disabled = Boolean(pageCaptureRequestId || pageCaptureEditing || pageCaptureBatch.status === "saving");
    toggle.addEventListener("click", () => updatePageCaptureMediaSelection(candidate.id, media.id));
    row.append(preview, copy, toggle);
    return row;
  };
  const inline = selected.filter(({ media }) => media.placement === "inline");
  const unplaced = selected.filter(({ media }) => media.placement !== "inline");
  const nodes = inline.map(createRow);
  if (unplaced.length) {
    const group = document.createElement("details");
    group.className = "page-capture-media-review-group";
    const summary = document.createElement("summary");
    summary.textContent = t("可能遗漏媒体（{count}）", { count: unplaced.length });
    const list = document.createElement("div");
    list.append(...unplaced.map(createRow));
    group.append(summary, list);
    nodes.push(group);
  }
  elements.pageCaptureMediaReviewList.replaceChildren(...nodes);
}

function setPageCaptureMediaDecisionClass(node, mediaId, selection) {
  if (!selection || !mediaId) return;
  const included = selection.mediaDecision !== "none" && selection.selectedMediaIds.includes(mediaId);
  node.classList.add(included ? "media-proposed" : "media-excluded");
  if (selection.mediaDecision === "pending") node.classList.add("media-pending");
}

function updatePageCaptureMediaSelection(candidateId, mediaId) {
  const selections = pageCaptureBatch.selections.map((selection) => {
    if (selection.candidateId !== candidateId) return selection;
    const selected = new Set(selection.mediaDecision === "none" ? [] : selection.selectedMediaIds);
    if (selected.has(mediaId)) selected.delete(mediaId);
    else selected.add(mediaId);
    return { ...selection, selectedMediaIds: [...selected], mediaDecision: "pending" };
  });
  pageCaptureBatch = normalizePageCaptureBatch({ ...pageCaptureBatch, selections });
  if (pageCaptureBatch.captureMode !== "list") void previewPageCaptureRegion(pageCaptureBatch.candidates.find(item => item.id === candidateId));
  render();
}

function finalizePageCaptureSelectionsForSave(batchValue, textOnly = false) {
  const batch = normalizePageCaptureBatch(batchValue);
  return normalizePageCaptureBatch({
    ...batch,
    selections: batch.selections.map((selection) => {
      const selectedMediaIds = textOnly ? [] : selection.selectedMediaIds;
      return {
        ...selection,
        selectedMediaIds,
        mediaDecision: selectedMediaIds.length ? "confirmed" : "none"
      };
    })
  });
}

function undoPageCaptureRegionEdit() {
  const previous = pageCaptureEditHistory.pop();
  if (!previous) return;
  if (previous.selection) {
    pageCaptureBatch = normalizePageCaptureBatch({ ...pageCaptureBatch,
      candidates: pageCaptureBatch.candidates.map(c => c.id === previous.candidate.id ? previous.candidate : c),
      selections: pageCaptureBatch.selections.map(s => s.candidateId === previous.candidate.id ? previous.selection : s) });
    render();
  } else replacePageCaptureCandidate(previous.candidate);
  showFeedback(t("已撤销上次调整"));
}

function resetPageCaptureRegionEdit() {
  const selectedId = pageCaptureBatch?.selections?.[0]?.candidateId;
  const original = pageCaptureOriginalCandidates.get(selectedId);
  if (!original) return;
  pageCaptureEditHistory = [];
  replacePageCaptureCandidate(structuredClone(original));
  showFeedback("已恢复本次扫描的自动识别结果");
}

function openPageCaptureMediaViewer(candidate, mediaIndex) {
  pageCaptureMediaView = { candidateId: candidate.id, mediaIndex };
  renderPageCaptureMediaViewer();
  if (!elements.pageCaptureMediaViewer.open) elements.pageCaptureMediaViewer.showModal();
}

function closePageCaptureMediaViewer() {
  pageCaptureMediaView = null;
  elements.pageCaptureMediaStage.replaceChildren();
  if (elements.pageCaptureMediaViewer.open) elements.pageCaptureMediaViewer.close();
}

function movePageCaptureMediaViewer(offset) {
  const candidate = pageCaptureBatch?.candidates.find((item) => item.id === pageCaptureMediaView?.candidateId);
  if (!candidate?.media.length) return;
  pageCaptureMediaView.mediaIndex = (pageCaptureMediaView.mediaIndex + offset + candidate.media.length) % candidate.media.length;
  renderPageCaptureMediaViewer();
}

function renderPageCaptureMediaViewer() {
  const candidate = pageCaptureBatch?.candidates.find((item) => item.id === pageCaptureMediaView?.candidateId);
  const media = candidate?.media[pageCaptureMediaView?.mediaIndex];
  if (!media) return closePageCaptureMediaViewer();
  if (["document", "attachment"].includes(media.kind)) {
    const card = textNode("div", media.filename || media.alt || t("文档"));
    card.className = "page-capture-document-preview";
    elements.pageCaptureMediaStage.replaceChildren(card);
    elements.pageCaptureMediaPosition.textContent = t("媒体 {current} / {count}", { current: pageCaptureMediaView.mediaIndex + 1, count: candidate.media.length });
    elements.pageCaptureMediaTitle.textContent = media.filename || media.alt || candidate.title;
    elements.pageCaptureMediaMeta.textContent = media.mimeType || "";
    elements.pageCaptureMediaPrev.disabled = candidate.media.length < 2;
    elements.pageCaptureMediaNext.disabled = candidate.media.length < 2;
    return;
  }
  const sourceUrl = media.kind === "video" ? media.url : media.previewDataUrl || media.dataUrl || media.url;
  const visual = document.createElement(media.kind === "video" ? "video" : "img");
  if (media.localAssetId) loadVisual(visual, media.localAssetId);
  else visual.src = sourceUrl || media.posterUrl || "";
  visual.setAttribute("referrerpolicy", "no-referrer");
  if (media.kind === "video") {
    visual.controls = true;
    visual.poster = media.posterUrl || "";
  } else {
    visual.alt = media.alt || candidate.title;
  }
  elements.pageCaptureMediaStage.replaceChildren(visual);
  elements.pageCaptureMediaPosition.textContent = t("媒体 {current} / {count}", { current: pageCaptureMediaView.mediaIndex + 1, count: candidate.media.length });
  elements.pageCaptureMediaTitle.textContent = media.alt || candidate.title;
  elements.pageCaptureMediaMeta.textContent = [
    media.width && media.height ? `${media.width}×${media.height}` : "",
    pageCaptureMediaSourceLabel(media.sourceKind, media.captureMethod),
    hostname(media.url || media.posterUrl)
  ].filter(Boolean).join(" · ");
  elements.pageCaptureMediaPrev.disabled = candidate.media.length < 2;
  elements.pageCaptureMediaNext.disabled = candidate.media.length < 2;
}

function pageCaptureStopReasonLabel(value) {
  return ({
    "target-reached": t("已达到目标数量。"),
    "no-new-items": t("列表没有新增案例，已按实际数量结束。"),
    "no-next-page": t("没有可继续的列表页，已按实际数量结束。"),
    "layout-changed": t("列表结构发生变化，已停止。"),
    "pagination-failed": t("列表翻页失败，已按当前结果结束。"),
    cancelled: t("采集已由用户停止。")
  })[value] || t("已按当前列表可识别结果结束。");
}

function pageCaptureExtractionLabel(value) {
  return ({ readability: t("智能正文"), structured: t("结构化正文"), page: t("页面正文") })[value] || t("页面正文");
}

function pageCaptureMediaSourceLabel(value, captureMethod = "") {
  if (captureMethod === "pixel-fallback") return t("页面可见画面");
  return ({
    "site-original": t("站点原图"),
    structured: t("结构化原图"),
    "picture-srcset": t("picture 响应图"),
    "deferred-srcset": t("延迟加载原图"),
    "deferred-src": t("延迟加载原图"),
    "img-srcset": t("srcset 响应图"),
    "css-background": t("CSS 背景图"),
    current: t("页面当前图"),
    source: t("页面当前图")
  })[value] || t("页面当前图");
}

async function cancelPageCapture() {
  if (pageCaptureCancelling || pageCaptureBatch?.status === "saving") return;
  pageCaptureCancelling = true;
  const requestId = pageCaptureRequestId;
  const sessionId = pageCaptureSession?.sessionId;
  const scanning = pageCaptureBatch?.status === "scanning";
  if (requestId) cancelledPageCaptureRequests.add(requestId);
  pageCaptureRequestId = "";
  pageCaptureSession = null;
  pageCaptureEditing = null;
  pageCapturePreviewRequest += 1;
  closePageCaptureMediaViewer();
  render();
  try {
    if (sessionId) await chrome.runtime.sendMessage({ type: "CANCEL_PAGE_CAPTURE", sessionId });
    await clearPageCaptureMarkers();
    if (pageCaptureAppendBase) {
      pageCaptureBatch = pageCaptureAppendBase;
      pageCaptureAppendBase = null;
    } else if (scanning && pageCaptureBatch) {
      pageCaptureBatch = normalizePageCaptureBatch({ ...pageCaptureBatch, status: "preview", selections: [], error: t("扫描已停止，可重新扫描") });
    } else {
      pageCaptureBatch = null;
      pageCaptureListRequested = false;
      pageCaptureEditHistory = [];
      pageCaptureOriginalCandidates = new Map();
    }
  } finally {
    pageCaptureCancelling = false;
    render();
  }
}

async function clearPageCaptureMarkers() {
  const tabId = pageCaptureBatch?.tabId;
  if (!Number.isInteger(tabId)) return;
  await chrome.runtime.sendMessage({ type: "CLEAR_PAGE_CAPTURE_MARKERS", tabId, removeRegionMarkers: true }).catch(() => undefined);
}

function pageCaptureTypeLabel(value) {
  return t(({ article: "文章", artwork: "作品", post: "帖子", gallery: "画廊", feed: "信息流", video: "视频", generic: "网页内容" })[value] || "网页内容");
}

function createQuickPreview() {
  const nodes = [];
  draft.fragments.forEach((fragment, index) => {
    const card = div("quick-item quick-text");
    const marker = text("Aa", "strong");
    const copy = div("quick-copy");
    copy.append(text(fragment.text, "p"), text(hostname(fragment.sourceUrl) || fragment.sourceTitle || t("当前网页"), "small"));
    const remove = createQuickRemoveButton(`删除第 ${index + 1} 段文字`, (button) =>
      sendDraftAction(button, "REMOVE_CAPTURE_FRAGMENT", { fragmentId: fragment.id }));
    card.append(marker, copy, remove);
    nodes.push(card);
  });
  if (draft.visuals.length) {
    const card = div("quick-item quick-visuals");
    const strip = div("quick-image-strip");
    draft.visuals.forEach((visual, index) => {
      const item = div("quick-image-item");
      const image = document.createElement("img");
      image.alt = visual.sourceTitle || `截图 ${index + 1}`;
      loadVisual(image, visual.id);
      const remove = createQuickRemoveButton(`删除第 ${index + 1} 张图片`, (button) =>
        sendDraftAction(button, "REMOVE_CAPTURE_VISUAL", { visualId: visual.id }));
      item.append(image, remove);
      strip.append(item);
    });
    const copy = div("quick-copy");
    copy.append(text(hostname(draft.visuals[0].sourceUrl) || draft.visuals[0].sourceTitle || t("当前网页"), "small"));
    card.append(strip, copy);
    nodes.push(card);
  }
  return nodes;
}

function createQuickRemoveButton(ariaLabel, handler) {
  const button = action("", handler, false, "quick-remove", ariaLabel);
  button.title = ariaLabel;
  button.append(createUiIcon("x"));
  return button;
}

function createFragmentCard(fragment, index, canReorder) {
  const card = document.createElement("article");
  card.className = "fragment-card";
  const textarea = document.createElement("textarea");
  textarea.value = fragment.text;
  textarea.setAttribute("aria-label", `文字内容 ${index + 1}`);
  textarea.addEventListener("change", () =>
    sendDraftAction(null, "UPDATE_CAPTURE_FRAGMENT", { fragmentId: fragment.id, text: textarea.value }));
  const meta = div("item-meta");
  const source = text(hostname(fragment.sourceUrl) || fragment.sourceTitle || t("当前网页"));
  const partContentType = partContentTypes[fragment.sourceUrl || "source:unknown"];
  const partType = text(partContentType?.customized ? partContentType.name : t(partContentType?.name || "待确认"), "small");
  meta.append(source, partType);
  const actions = div("item-actions");
  if (canReorder) {
    actions.append(
      action("↑", (button) => moveItem("fragment", index, -1, button), index === 0, "", `上移第 ${index + 1} 段文字`),
      action("↓", (button) => moveItem("fragment", index, 1, button), index === draft.fragments.length - 1, "", `下移第 ${index + 1} 段文字`)
    );
  }
  actions.append(action("删除", (button) =>
    sendDraftAction(button, "REMOVE_CAPTURE_FRAGMENT", { fragmentId: fragment.id }), false, "remove"));
  meta.append(actions);
  card.append(textarea, meta);
  return card;
}

function createVisualCard(visual, index, view) {
  const card = document.createElement("article");
  card.className = `visual-card${draft.primaryVisualId === visual.id ? " primary" : ""}`;
  const image = document.createElement("img");
  image.alt = visual.sourceTitle || `截图 ${index + 1}`;
  loadVisual(image, visual.id);
  const copy = div("visual-copy");
  copy.append(
    text(draft.primaryVisualId === visual.id ? t("主图") : t("图片 {count}", { count: index + 1 }), "strong"),
    text(visual.sourceTitle || hostname(visual.sourceUrl) || t("当前网页"), "small")
  );
  const actions = div("item-actions");
  if (view.canChoosePrimary && draft.primaryVisualId !== visual.id) {
    actions.append(action("设为主图", (button) =>
      sendDraftAction(button, "SET_CAPTURE_PRIMARY_VISUAL", { visualId: visual.id })));
  }
  if (view.canReorderVisuals) {
    actions.append(
      action("↑", (button) => moveItem("visual", index, -1, button), index === 0, "", `上移第 ${index + 1} 张图片`),
      action("↓", (button) => moveItem("visual", index, 1, button), index === draft.visuals.length - 1, "", `下移第 ${index + 1} 张图片`)
    );
  }
  actions.append(action("删除", (button) =>
    sendDraftAction(button, "REMOVE_CAPTURE_VISUAL", { visualId: visual.id }), false, "remove"));
  copy.append(actions);
  card.append(image, copy);
  return card;
}

async function captureFromActivePage(type, button, commitCreative = false) {
  await withButton(button, async () => {
    try {
      if (type === "CAPTURE_ACTIVE_TAB_TO_DRAFT") {
        regionCaptureState = { sessionId: "", phase: "requesting-permission" };
        showFeedback(regionCaptureMessage(regionCaptureState.phase));
        render();
      }
      const response = await runCaptureTransaction({
        type,
        commitCreative,
        chromeApi: chrome,
        onStatus: showFeedback
      });
      if (type === "CAPTURE_ACTIVE_TAB_TO_DRAFT") regionCaptureState = null;
      smartVisualFallback = response.fallbackAction === "capture-region";
      draft = response.draft;
      elements.duplicatePanel.hidden = true;
      showFeedback(response.message);
      await refresh();
    } catch (error) {
      regionCaptureState = null;
      if (type === "CAPTURE_VISIBLE_VISUALS_TO_DRAFT") smartVisualFallback = true;
      if (error?.draft) draft = error.draft;
      if (draft) render();
      showFeedback(error.message || "采集失败", true);
    }
  });
}

async function cancelRegionCapture() {
  if (!regionCaptureState?.sessionId) return;
  const response = await chrome.runtime.sendMessage({ type: "CANCEL_REGION_CAPTURE", sessionId: regionCaptureState.sessionId });
  if (!response?.ok) return showFeedback(response?.message || "无法取消当前框选", true);
  showFeedback(response.message);
}

function regionCaptureMessage(phase) {
  return ({
    "requesting-permission": "正在申请截图权限…",
    starting: "正在启动框选…",
    selecting: "框选已启动，请在网页中拖拽选择画面；按 Esc 取消。",
    capturing: "正在截取并保存所选画面…",
    saved: "截图已保存",
    cancelled: "已取消框选截图",
    failed: "框选截图失败"
  })[phase] || "正在准备框选截图…";
}

async function beginSmartVisualSelection(button, commitCreative = false) {
  await withButton(button, async () => {
    try {
      const response = await runCaptureTransaction({
        type: "START_SMART_VISUAL_SELECTION",
        chromeApi: chrome,
        onStatus: showFeedback
      });
      smartVisualFallback = response.fallbackAction === "capture-region";
      if (!response.captured?.session) {
        showFeedback(response.message || "当前画面没有可选择的图片", Boolean(response.fallbackAction));
        render();
        return;
      }
      smartVisualSession = response.captured.session;
      smartVisualCommitCreative = commitCreative;
      showFeedback(response.message);
      render();
    } catch (error) {
      smartVisualFallback = true;
      showFeedback(error.message || "无法开始智能选图", true);
      render();
    }
  });
}

async function startPageCapture(mode, button) {
  if (pageCaptureRequestId || pageCaptureEditing || pageCaptureCancelling || pageCaptureBatch?.status === "saving" || button?.disabled) return;
  if (mode !== "list" && pageCaptureBatch?.selections.length === 1 && button === elements.addPageCapture) {
    pageCaptureAppendBase = structuredClone(pageCaptureBatch);
  } else if (!pageCaptureBatch) pageCaptureDraftIds = new Set();
  const requestId = crypto.randomUUID();
  pageCaptureRequestId = requestId;
  await withButton(button, async () => {
    try {
      const representative = mode === "list"
        ? pageCaptureBatch?.candidates.find((candidate) => candidate.id === pageCaptureBatch.selections[0]?.candidateId) || null
        : null;
      const tab = await resolveActivePage(chrome.tabs, chrome.scripting);
      if (!tab?.url && Number.isInteger(tab?.id)) {
        throw new Error(t("Chrome 不会在点击插件图标时弹出授权窗口。请先在当前网页点击工具栏里的 PromptDirector 图标，再回到侧栏点击“网页采集”；待保存内容没有改变。"));
      }
      if (!tab?.url) throw new Error(t(RESTRICTED_PAGE_MESSAGE));
      let permission = await inspectPagePermission(tab.url, chrome.permissions);
      if (permission.status === "missing") {
        if (!await ensurePagePermission(tab.url, chrome.permissions)) {
          throw new Error(t("你没有授予当前网站访问权限。请再次点击“网页采集”，或在 Chrome 扩展详情的“网站访问权限”中允许此网站；待保存内容没有改变。"));
        }
        permission = { ...permission, status: "granted" };
      }
      pageCapturePermissionState = permission;
      renderPageCapturePermissionAction();
      if (permission.status === "restricted") {
        throw new Error(t("Chrome 内部页、扩展页或本机设置页不能采集，请切换到普通网页"));
      }
      if (pageCaptureRequestId !== requestId) return;
      await clearPageCaptureMarkers();
      if (pageCaptureRequestId !== requestId) return;
      pageCaptureBatch = normalizePageCaptureBatch({ ...(pageCaptureBatch || { id: requestId, candidates: [] }), tabId: tab.id, status: "scanning", error: "" });
      render();
      const targetCount = mode === "list" ? Number(elements.pageCaptureTargetCount.value) : 0;
      const response = await chrome.runtime.sendMessage({ type: "START_PAGE_CAPTURE", mode, targetCount, requestId });
      if (pageCaptureRequestId !== requestId) return;
      if (!response?.ok) throw new Error(pageCapturePermissionFailureMessage(response?.message || t("网页采集失败")));
      const candidates = response.batch.candidates.map((candidate) => {
        let contentText = candidate.contentText;
        try {
          if (candidate.contentHtml) contentText = ingestHtmlDocument(candidate.contentHtml).contentText || contentText;
        } catch {
        }
        const textBlocks = candidate.textBlocks.map((block) => {
          if (!block.html) return block;
          try {
            return { ...block, text: ingestHtmlDocument(block.html).contentText || block.text };
          } catch {
            return block;
          }
        });
        const normalized = { ...candidate, contentText, textBlocks };
        return representative
          ? { ...normalized, batchStructureStatus: pageCaptureStructureMatches(representative, normalized) ? "matched" : "review" }
          : normalized;
      });
      const batch = normalizePageCaptureBatch({ ...response.batch, candidates, status: "preview" });
      const selections = mode === "list"
        ? batch.candidates.filter((candidate) => candidate.batchStructureStatus !== "review").map((candidate) => normalizePageCaptureSelection({
            candidateId: candidate.id,
            selectedTextBlockIds: candidate.textBlocks.map((item) => item.id),
            selectedMediaIds: pageCaptureDefaultMediaIds(candidate),
            mediaDecision: "pending"
          }, batch.candidates)).filter(Boolean)
        : batch.selections;
      pageCaptureBatch = normalizePageCaptureBatch({ ...batch, selections });
      if (!pageCaptureAppendBase) pageCaptureEditHistory = [];
      if (!pageCaptureAppendBase) pageCaptureOriginalCandidates = new Map(pageCaptureBatch.candidates.map((candidate) => [candidate.id, structuredClone(candidate)]));
      pageCaptureSession = null;
      pageCaptureListRequested = mode === "list";
      closePageCaptureMediaViewer();
      elements.pageCaptureMediaReview.open = false;
      render();
    } catch (error) {
      if (pageCaptureRequestId !== requestId) return;
      if (pageCaptureAppendBase) {
        pageCaptureBatch = pageCaptureAppendBase;
        pageCaptureAppendBase = null;
      }
      if (pageCaptureBatch) pageCaptureBatch = normalizePageCaptureBatch({ ...pageCaptureBatch, status: "preview", error: error.message });
      pageCaptureSession = null;
      showFeedback(error.message || t("网页采集失败"), true);
      render();
    } finally {
      cancelledPageCaptureRequests.delete(requestId);
      if (pageCaptureRequestId === requestId) {
        pageCaptureRequestId = "";
        pageCaptureSession = null;
        if (pageCaptureBatch?.status === "scanning") pageCaptureBatch = normalizePageCaptureBatch({ ...pageCaptureBatch, status: "preview" });
        render();
      }
    }
  });
}

async function startPageListCapture(button) {
  const targetCount = Number(elements.pageCaptureTargetCount.value);
  if (!pageCaptureBatch?.selections.length) {
    showFeedback(t("请先查看并确认一个代表案例，再开始列表采集"), true);
    return;
  }
  if (!Number.isSafeInteger(targetCount) || targetCount < 1 || targetCount > PAGE_CAPTURE_LIMITS.maxCandidates) {
    showFeedback(t("请输入 1 到 {count} 之间的目标案例数", { count: PAGE_CAPTURE_LIMITS.maxCandidates }), true);
    return;
  }
  await startPageCapture("list", button);
}

async function savePageCapture(textOnly = false) {
  if (!pageCaptureBatch || pageCaptureRequestId || pageCaptureEditing || pageCaptureBatch.status === "saving") return;
  const trigger = textOnly ? elements.pageCaptureSaveTextOnly : elements.pageCaptureSave;
  await withButton(trigger, async () => {
    const reviewBatch = pageCaptureBatch;
    const metadata = captureMetadataForCommit();
    const saveBatch = finalizePageCaptureSelectionsForSave(reviewBatch, textOnly);
    const selected = applyPageCaptureSelections(saveBatch);
    const origins = pageCapturePermissionOrigins(selected);
    pageCaptureBatch = normalizePageCaptureBatch({ ...saveBatch, status: "saving" });
    render();
    try {
      let sessionMediaAllowed = true;
      if (origins.length) {
        const granted = await chrome.permissions.request({ origins });
        if (!granted) {
          sessionMediaAllowed = false;
          showFeedback(t("媒体域名权限未获授权；仍会保存正文和可用引用，并逐项显示下载失败原因。"), true);
        }
      }
      const response = await chrome.runtime.sendMessage({
        type: "COMMIT_PAGE_CAPTURE",
        batch: normalizePageCaptureBatch({ ...pageCaptureBatch, sessionMediaAllowed }),
        ...metadata
      });
      if (!response?.ok) throw new Error(response?.message || t("网页内容保存失败"));
      const partial = response.results?.filter((item) => item.status === "partial" || item.status === "failed") || [];
      if (partial.length) {
        if (metadata.newCollectionName && response.collectionId) {
          creatingCollection = false;
          await updateDraft({ ...draft, collectionId: response.collectionId, newCollectionName: "" });
        }
        const reasons = [...new Set(partial.flatMap(item => item.warnings || []))];
        pageCaptureBatch = normalizePageCaptureBatch({ ...saveBatch, status: "preview", error: reasons.join("；") });
        elements.pageCaptureMediaReview.open = true;
        showFeedback(t("{message}；{count} 项存在媒体下载问题", { message: response.message, count: partial.length }), true);
        await refresh();
        return;
      }
      await clearPageCaptureMarkers();
      const savedCandidateIds = new Set(response.results.filter(item => item.status === "saved").map(item => item.candidateId));
      const savedDraftItems = savedDraftCaptureItems(draft, selected.filter(c => savedCandidateIds.has(c.id)), pageCaptureDraftIds);
      const cleanupErrors = [];
      for (const item of savedDraftItems) {
        try {
          const cleanup = await chrome.runtime.sendMessage(item.kind === "image"
            ? { type: "REMOVE_CAPTURE_VISUAL", visualId: item.id }
            : { type: "REMOVE_CAPTURE_FRAGMENT", fragmentId: item.id });
          if (!cleanup?.ok) throw new Error(cleanup?.message || t("待保存内容没有更新"));
        } catch (error) { cleanupErrors.push(error.message); }
      }
      pageCaptureDraftIds = new Set();
      pageCaptureBatch = null;
      pageCaptureEditHistory = [];
      pageCaptureOriginalCandidates = new Map();
      showFeedback(cleanupErrors.length ? `${response.message}；${cleanupErrors.join("；")}` : response.message, Boolean(cleanupErrors.length));
      await refresh();
    } catch (error) {
      pageCaptureBatch = normalizePageCaptureBatch({ ...reviewBatch, status: "preview", error: error.message });
      showFeedback(error.message || t("网页内容保存失败"), true);
      render();
    }
  });
}

async function confirmSmartVisualSelection() {
  if (!smartVisualSession) return;
  await withButton(elements.smartSelectionConfirm, async () => {
    try {
      const sessionId = smartVisualSession.sessionId;
      const response = await chrome.runtime.sendMessage({ type: "CONFIRM_SMART_VISUAL_SELECTION", sessionId });
      if (!response?.ok) {
        if (Number.isFinite(response?.selectedCount)) smartVisualSession.selectedCount = response.selectedCount;
        throw new Error(response?.message || "智能选图确认失败");
      }
      draft = response.draft;
      smartVisualSession = null;
      if (smartVisualCommitCreative) {
        const commit = await chrome.runtime.sendMessage({ type: "COMMIT_CREATIVE_OUTPUTS" });
        if (!commit?.ok) throw new Error(commit?.message || "生成结果保存失败");
        showFeedback(commit.message);
      } else {
        showFeedback(response.message);
      }
      smartVisualCommitCreative = false;
      await refresh();
    } catch (error) {
      showFeedback(error.message || "智能选图确认失败", true);
      render();
    }
  });
}

async function cancelSmartVisualSelection() {
  const sessionId = smartVisualSession?.sessionId;
  if (!sessionId) return;
  await withButton(elements.smartSelectionCancel, async () => {
    const response = await chrome.runtime.sendMessage({ type: "CANCEL_SMART_VISUAL_SELECTION", sessionId });
    smartVisualSession = null;
    smartVisualCommitCreative = false;
    showFeedback(response?.message || "已取消智能选图");
    render();
  });
}

async function clearActiveCreativeResult() {
  await withButton(elements.saveOtherInspiration, async () => {
    const response = await chrome.runtime.sendMessage({ type: "CLEAR_ACTIVE_CREATIVE_RESULT" });
    if (!response?.ok) return showFeedback(response?.message || t("无法切换采集任务"), true);
    activeCreativeResult = null;
    activeCreativePrompt = null;
    render();
  });
}

async function sendDraftAction(button, type, payload = {}) {
  const removedVisualUrl = type === "REMOVE_CAPTURE_VISUAL" ? visualUrls.get(payload.visualId) : "";
  await withButton(button, async () => {
    try {
      const response = await chrome.runtime.sendMessage({ type, ...payload });
      if (!response?.ok) throw new Error(response?.message || "内容更新失败");
      if (removedVisualUrl) URL.revokeObjectURL(removedVisualUrl);
      if (type === "REMOVE_CAPTURE_VISUAL") visualUrls.delete(payload.visualId);
      draft = response.draft;
      showFeedback(response.message || "待保存内容已更新");
      await refresh();
    } catch (error) {
      showFeedback(error.message || "内容更新失败", true);
    }
  });
}

async function updateDraft(value) {
  try {
    const response = await chrome.runtime.sendMessage({ type: "UPDATE_CAPTURE_DRAFT", draft: value });
    if (!response?.ok) throw new Error(response?.message || "标题更新失败");
    draft = response.draft;
    render();
    return draft;
  } catch (error) {
    showFeedback(error.message || "标题更新失败", true);
    return null;
  }
}

async function moveItem(kind, index, offset, button) {
  const values = kind === "fragment" ? draft.fragments : draft.visuals;
  const target = index + offset;
  if (target < 0 || target >= values.length) return;
  const ids = values.map((item) => item.id);
  [ids[index], ids[target]] = [ids[target], ids[index]];
  await sendDraftAction(
    button,
    kind === "fragment" ? "REORDER_CAPTURE_FRAGMENTS" : "REORDER_CAPTURE_VISUALS",
    { ids }
  );
}

async function commitDraft(duplicateAction = "", button) {
  if (saving) return;
  saving = true;
  if (button) {
    button.disabled = true;
    button.setAttribute("aria-busy", "true");
  }
  render();
  try {
    const metadata = captureMetadataForCommit();
    const response = await chrome.runtime.sendMessage({
      type: "COMMIT_CAPTURE_DRAFT",
      duplicateAction,
      ...metadata
    });
    if (response?.duplicate) {
      elements.duplicateTitle.textContent = response.existing.title;
      elements.duplicatePanel.hidden = false;
      showFeedback("请选择添加到原案例，还是仍然新建");
      return;
    }
    if (!response?.ok) throw new Error(response?.message || "案例保存失败");
    draft = response.draft;
    targetEntry = null;
    organizing = false;
    creatingCollection = false;
    elements.duplicatePanel.hidden = true;
    showFeedback(response.message);
  } catch (error) {
    showFeedback(error.message || "案例保存失败", true);
  } finally {
    saving = false;
    if (button) button.removeAttribute("aria-busy");
    render();
  }
}

async function discardDraft() {
  if ((draft?.fragments.length || draft?.visuals.length) && !await confirmAppAction({
    title: "清空待保存内容？",
    description: "当前尚未保存的文字和图片会被移除，这项操作无法撤回。",
    confirmLabel: "清空",
    danger: true
  })) return;
  await withButton(elements.discardDraft, async () => {
    try {
      const response = await chrome.runtime.sendMessage({ type: "CANCEL_CAPTURE_DRAFT" });
      if (!response?.ok) throw new Error(response?.message || "无法清空");
      draft = response.draft;
      targetEntry = null;
      organizing = false;
      creatingCollection = false;
      elements.duplicatePanel.hidden = true;
      showFeedback("待保存内容已清空");
      render();
    } catch (error) {
      showFeedback(error.message || "无法清空", true);
    }
  });
}

async function loadVisual(image, visualId) {
  try {
    let url = visualUrls.get(visualId);
    if (!url) {
      const blob = await getScreenshotBlob(visualId);
      if (!blob) return;
      url = URL.createObjectURL(blob);
      visualUrls.set(visualId, url);
    }
    assignVisualPreviewSource(image, url);
  } catch {}
}

async function withButton(button, task) {
  if (button) {
    if (button.disabled) return;
    button.disabled = true;
    button.setAttribute("aria-busy", "true");
  }
  try {
    await task();
  } finally {
    if (button) {
      button.disabled = saving;
      button.removeAttribute("aria-busy");
    }
  }
}

function showFeedback(message, error = false) {
  if (feedbackTimer) window.clearTimeout(feedbackTimer);
  feedbackTimer = 0;
  const value = translateUiMessage(message || "");
  elements.feedback.textContent = value;
  elements.feedback.classList.toggle("error", error);
  if (value) {
    feedbackTimer = window.setTimeout(() => {
      elements.feedback.textContent = "";
      elements.feedback.classList.remove("error");
      feedbackTimer = 0;
    }, error ? ERROR_FEEDBACK_DURATION_MS : FEEDBACK_DURATION_MS);
  }
}

function action(label, handler, disabled = false, className = "", ariaLabel = "") {
  const button = text(translateUiMessage(label), "button");
  button.type = "button";
  button.disabled = disabled;
  button.className = className;
  if (ariaLabel) button.setAttribute("aria-label", translateUiMessage(ariaLabel));
  button.addEventListener("click", () => handler(button));
  return button;
}

function div(className) {
  const node = document.createElement("div");
  node.className = className;
  return node;
}

function text(value, tag = "span") {
  const node = document.createElement(tag);
  node.textContent = value;
  return node;
}

function optionElement(value, label, selected = false) {
  const option = document.createElement("option");
  option.value = value;
  option.textContent = label;
  option.selected = selected;
  return option;
}

function captureMetadataForCommit() {
  const selectedCollection = elements.captureCollection.value;
  return {
    collectionId: selectedCollection === NEW_COLLECTION_OPTION_VALUE ? "" : selectedCollection,
    newCollectionName: selectedCollection === NEW_COLLECTION_OPTION_VALUE
      ? elements.captureNewCollectionName.value.trim()
      : "",
    customLabels: customLabelEditor.values,
    contentTypeId: draft.contentTypeId,
    contentTypeExplicit: draft.contentTypeExplicit
  };
}

function hostname(value) {
  try {
    return new URL(value).hostname;
  } catch {
    return "";
  }
}

function camel(value) {
  return value.replace(/-([a-z])/g, (_match, letter) => letter.toUpperCase());
}

addEventListener("beforeunload", () => {
  if (smartVisualSession?.sessionId) {
    chrome.runtime.sendMessage({ type: "CANCEL_SMART_VISUAL_SELECTION", sessionId: smartVisualSession.sessionId }).catch(() => undefined);
  }
  for (const url of visualUrls.values()) URL.revokeObjectURL(url);
});
