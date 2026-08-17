import { deleteScreenshotBlob, getScreenshotBlob, saveScreenshotBlob } from "./image-store.js";
import { addDraftFragment, addDraftVisual } from "./capture-draft.js";
import { createTextCandidate } from "./capture-text-candidate.js";
import {
  assignVisualPreviewSource,
  collectorViewState
} from "./collector-view.js";
import { prepareLocalMedia } from "./local-media.js";
import { runCaptureTransaction } from "./capture-workspace.js";
import {
  ensureClipboardReadPermission,
  ensurePagePermission,
  inspectPagePermission,
  pageCapturePermissionFailureMessage,
  readClipboardContentAfterFocus,
  RESTRICTED_PAGE_MESSAGE,
  resolveActivePage
} from "./capture-permissions.js";
import { initializeUi, t } from "./i18n.js";
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

await initializeUi();

const elements = Object.fromEntries([
  "add-selection", "add-screenshot", "add-smart-visuals", "collector-footer", "content-summary", "discard-draft", "draft-title",
  "content-type", "custom-labels", "duplicate-panel", "duplicate-title", "exit-target", "feedback", "fragment-help", "fragment-list",
  "fragment-section", "merge-duplicate", "open-library", "organizer", "organize-toggle", "preview-state",
  "quick-preview", "result-prompt-title", "result-screenshot", "result-smart-visuals", "result-start", "save-draft", "save-other-inspiration",
  "save-separate", "start-screenshot", "start-selection", "start-smart-visuals", "start-state", "normal-start",
  "other-capture-methods", "add-other-capture-methods", "smart-selection", "smart-selection-count", "smart-selection-help", "smart-selection-warning", "smart-selection-cancel", "smart-selection-confirm",
  "start-page-capture", "add-page-capture", "page-capture", "page-capture-title", "page-capture-help", "page-capture-list", "page-capture-scan", "page-capture-cancel", "page-capture-save", "page-capture-save-text-only",
  "page-capture-clear", "page-capture-media-viewer", "page-capture-media-stage", "page-capture-media-position", "page-capture-media-title", "page-capture-media-meta",
  "page-capture-media-review", "page-capture-media-review-status", "page-capture-media-review-list",
  "page-capture-add-region", "page-capture-exclude-region", "page-capture-undo-region", "page-capture-reset-region",
  "page-capture-media-close", "page-capture-media-prev", "page-capture-media-next",
  "page-capture-list-setup", "page-capture-target-count", "page-capture-list-run", "page-capture-list-result", "page-capture-list-summary",
  "page-capture-save-mode", "page-capture-combined-title-row", "page-capture-combined-title",
  "region-capture-status", "region-capture-title", "region-capture-help", "region-capture-cancel",
  "target-banner", "target-label", "visual-help", "visual-list", "visual-section"
].map((id) => [camel(id), document.getElementById(id)]));

let draft = null;
let targetEntry = null;
let contentTypes = [];
let suggestedContentTypeId = "";
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
let pageCaptureSession = null;
let pageCaptureMediaView = null;
let pageCaptureEditHistory = [];
let pageCaptureOriginalCandidates = new Map();
let pageCapturePermissionState = { status: "unknown", origin: "", pattern: "" };
const visualUrls = new Map();
const FEEDBACK_DURATION_MS = 4000;
const ERROR_FEEDBACK_DURATION_MS = 8000;
let feedbackTimer = 0;
const CLIPBOARD_IMAGE_EXTENSIONS = Object.freeze({
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp"
});

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
elements.startSelection.addEventListener("click", () => extractClipboardOrSelection(elements.startSelection));
elements.startScreenshot.addEventListener("click", () => captureFromActivePage("CAPTURE_ACTIVE_TAB_TO_DRAFT", elements.startScreenshot));
elements.startSmartVisuals.addEventListener("click", () => beginSmartVisualSelection(elements.startSmartVisuals));
elements.startPageCapture.addEventListener("click", () => startPageCapture("loaded", elements.startPageCapture));
elements.resultScreenshot.addEventListener("click", () => captureFromActivePage("CAPTURE_ACTIVE_TAB_TO_DRAFT", elements.resultScreenshot, true));
elements.resultSmartVisuals.addEventListener("click", () => beginSmartVisualSelection(elements.resultSmartVisuals, true));
elements.saveOtherInspiration.addEventListener("click", () => clearActiveCreativeResult());
elements.addSelection.addEventListener("click", () => extractClipboardOrSelection(elements.addSelection));
elements.addScreenshot.addEventListener("click", () => captureFromActivePage("CAPTURE_ACTIVE_TAB_TO_DRAFT", elements.addScreenshot));
elements.addSmartVisuals.addEventListener("click", () => beginSmartVisualSelection(elements.addSmartVisuals));
elements.addPageCapture.addEventListener("click", () => startPageCapture("loaded", elements.addPageCapture));
elements.pageCaptureScan.addEventListener("click", () => {
  elements.pageCaptureListSetup.open = true;
  elements.pageCaptureTargetCount.focus();
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
elements.customLabels.addEventListener("change", () => updateDraft({
  ...draft,
  customLabels: parseCustomLabels(elements.customLabels.value),
  customLabelsExplicit: true
}));
elements.customLabels.addEventListener("keydown", (event) => {
  if (event.key !== "Enter") return;
  event.preventDefault();
  elements.customLabels.blur();
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

async function refresh() {
  const response = await chrome.runtime.sendMessage({ type: "GET_CAPTURE_WORKSPACE" });
  if (!response?.ok) return showFeedback(response?.message || "无法读取待保存内容", true);
  draft = response.draft;
  targetEntry = response.targetEntry ?? null;
  contentTypes = response.contentTypes ?? [];
  suggestedContentTypeId = response.suggestedContentTypeId || "";
  partContentTypes = response.partContentTypes ?? {};
  activeCreativeResult = response.activeCreativeResult ?? null;
  activeCreativePrompt = response.activeCreativePrompt ?? null;
  render();
}

async function tryAutoSelection() {
  if (autoTextCaptureActive || !draft || activeCreativePrompt || draft.fragments.length || draft.visuals.length) return;
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

async function extractClipboardOrSelection(button) {
  await withButton(button, async () => {
    try {
      let selection = null;
      try {
        selection = await runCaptureTransaction({
          type: "ADD_ACTIVE_SELECTION_TO_DRAFT",
          chromeApi: chrome,
          onStatus: showFeedback
        });
      } catch {
      }
      if (selection && (selection.captured?.added || selection.captured?.reason !== "empty-selection")) {
        draft = selection.draft;
        showFeedback(selection.message || "已提取网页高亮文字");
        await refresh();
        return;
      }

      showFeedback("当前网页没有可提取的高亮；Chrome 将询问一次剪贴板读取权限");
      if (!await ensureClipboardReadPermission(chrome.permissions)) {
        showFeedback("未获得剪贴板读取权限，未提取文字或图片", true);
        return;
      }
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
    } catch (error) {
      if (error?.draft) draft = error.draft;
      if (draft) render();
      showFeedback(error.message || "文字或图片提取失败", true);
    }
  });
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
  elements.pageCapture.hidden = !pageCaptureBatch;
  elements.regionCaptureStatus.hidden = !regionCaptureState;
  elements.previewState.hidden = Boolean(smartVisualSession || pageCaptureBatch || regionCaptureState) || !view.showPreview;
  elements.collectorFooter.hidden = Boolean(smartVisualSession || pageCaptureBatch || regionCaptureState) || !view.showFooter;
  if (regionCaptureState) {
    elements.regionCaptureTitle.textContent = regionCaptureMessage(regionCaptureState.phase);
    elements.regionCaptureHelp.textContent = regionCaptureState.phase === "selecting"
      ? "请切回网页拖动选择画面；按 Esc 或在这里取消。"
      : "请保持当前网页与侧边栏打开，完成后会自动回到待保存内容。";
    elements.regionCaptureCancel.disabled = !regionCaptureState.sessionId || ["capturing"].includes(regionCaptureState.phase);
  }
  if (pageCaptureBatch) renderPageCapture();
  if (smartVisualSession) {
    elements.smartSelectionCount.textContent = `已选 ${smartVisualSession.selectedCount || 0} 张`;
    elements.smartSelectionHelp.textContent = `网页中识别到 ${smartVisualSession.candidateCount || 0} 个候选；点击画面选择，页面滚动或布局变化后会自动重新对齐。`;
    elements.smartSelectionConfirm.disabled = !(smartVisualSession.selectedCount > 0);
    const overlayUnavailable = smartVisualSession.overlayReady === false;
    elements.smartSelectionWarning.hidden = !overlayUnavailable;
    elements.smartSelectionWarning.textContent = overlayUnavailable
      ? "当前页面没有成功显示选图层，请退出网页元素全屏后重试。"
      : "";
  }
  elements.targetBanner.hidden = !targetEntry;
  elements.targetLabel.textContent = view.targetLabel;
  elements.contentSummary.textContent = view.summary;
  elements.saveDraft.textContent = view.saveLabel;
  elements.saveDraft.disabled = saving || !view.hasContent;
  elements.draftTitle.disabled = saving;
  elements.contentType.disabled = saving;
  elements.customLabels.disabled = saving;
  for (const control of [
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
  elements.organizeToggle.textContent = view.showOrganizer ? "收起整理" : "编辑与整理";
  elements.fragmentSection.hidden = !view.showOrganizer || !draft.fragments.length;
  elements.visualSection.hidden = !view.showOrganizer || !draft.visuals.length;
  elements.fragmentHelp.textContent = view.canReorderFragments ? "使用箭头调整段落顺序" : "";
  elements.visualHelp.textContent = view.canReorderVisuals ? "使用箭头调整图片顺序" : "";
  if (document.activeElement !== elements.draftTitle) {
    elements.draftTitle.value = draft.title || targetEntry?.title || "";
  }
  const selectedContentType = draft.contentTypeId || suggestedContentTypeId;
  elements.contentType.replaceChildren(...contentTypes.map((item) => {
    const option = document.createElement("option");
    option.value = item.id;
    option.textContent = item.name;
    option.selected = item.id === selectedContentType;
    return option;
  }));
  if (!selectedContentType || !contentTypes.some((item) => item.id === selectedContentType)) {
    const option = document.createElement("option");
    option.value = "";
    option.textContent = "待确认";
    option.selected = true;
    elements.contentType.prepend(option);
  }
  if (document.activeElement !== elements.customLabels) {
    elements.customLabels.value = (draft.customLabels ?? []).join("，");
  }
  elements.quickPreview.replaceChildren(...createQuickPreview());
  elements.addOtherCaptureMethods.open = smartVisualFallback;
  elements.otherCaptureMethods.classList.toggle("fallback-highlight", smartVisualFallback);
  elements.addOtherCaptureMethods.classList.toggle("fallback-highlight", smartVisualFallback);
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
  const needsGrant = pageCapturePermissionState.status === "missing";
  const needsInvocation = pageCapturePermissionState.status === "active-tab-required";
  const startLabel = needsInvocation ? t("点插件图标后再采集") : needsGrant ? t("授权当前网站并扫描") : t("网页采集");
  const startText = elements.startPageCapture.querySelector("strong");
  if (startText) startText.textContent = startLabel;
  elements.addPageCapture.textContent = needsInvocation
    ? t("＋ 点插件图标后再采集")
    : needsGrant ? t("＋ 授权当前网站并扫描") : t("＋ 网页采集");
}

function renderPageCapture() {
  const selections = new Map(pageCaptureBatch.selections.map((selection) => [selection.candidateId, selection]));
  const selectedCount = pageCaptureBatch.selections.length;
  const listMode = pageCaptureBatch.captureMode === "list";
  elements.pageCaptureTitle.textContent = t("已识别 {count} 个主体方案 · 已确认 {selected} 个", { count: pageCaptureBatch.candidates.length, selected: selectedCount });
  elements.pageCaptureHelp.textContent = pageCaptureBatch.status === "scanning"
    ? t("正在扫描已加载内容；可随时停止，结束后会恢复原滚动位置。")
    : t("先查看并修正网页区域，再确认一个创作主体。确认后会按原始顺序保存完整文章和相关资源。");
  const selectedMediaCount = pageCaptureBatch.selections.reduce((count, selection) => count + selection.selectedMediaIds.length, 0);
  const saveBlocked = !selectedCount || pageCaptureBatch.status === "saving" || (listMode && !["multiple", "combined"].includes(pageCaptureBatch.saveMode));
  elements.pageCaptureSave.disabled = saveBlocked;
  elements.pageCaptureSaveTextOnly.disabled = saveBlocked;
  elements.pageCaptureSaveTextOnly.hidden = selectedMediaCount === 0;
  elements.pageCaptureSave.textContent = listMode
    ? selectedMediaCount
      ? t("保存 {cases} 个案例 · 含 {media} 项媒体", { cases: selectedCount, media: selectedMediaCount })
      : t("只保存 {count} 个正文案例", { count: selectedCount })
    : selectedMediaCount ? t("保存案例 · 含 {count} 项媒体", { count: selectedMediaCount }) : t("只保存正文");
  elements.pageCaptureScan.hidden = listMode;
  elements.pageCaptureListSetup.hidden = listMode;
  elements.pageCaptureListResult.hidden = !listMode;
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
  elements.pageCaptureList.replaceChildren(...pageCaptureBatch.candidates.map((candidate) => {
    const card = document.createElement("article");
    const confirmed = selections.has(candidate.id);
    card.className = `page-capture-item${confirmed ? " confirmed" : ""}`;
    if (candidate.batchStructureStatus === "review") card.classList.add("structure-review");
    const heading = document.createElement("header");
    const copy = document.createElement("div");
    const title = document.createElement("strong");
    title.textContent = candidate.title;
    const meta = document.createElement("small");
    const captureScope = candidate.extraction.scope === "selection" ? t("原网页选区") : pageCaptureExtractionLabel(candidate.extraction.method);
    meta.textContent = `${pageCaptureTypeLabel(candidate.pageType)} · ${hostname(candidate.canonicalUrl) || t("当前网页")} · ${captureScope}${candidate.sourceFacts.author ? ` · ${candidate.sourceFacts.author}` : ""}${candidate.batchStructureStatus === "review" ? ` · ${t("结构需复核")}` : ""}`;
    copy.append(title, meta);
    const inspect = document.createElement("button");
    inspect.type = "button";
    inspect.className = "button-secondary compact page-capture-inspect";
    inspect.textContent = t("查看网页区域");
    inspect.addEventListener("click", () => previewPageCaptureRegion(candidate));
    heading.append(copy);
    if (!listMode) heading.append(inspect);
    card.append(heading);
    card.append(createPageCaptureArticlePreview(candidate, selections.get(candidate.id)));
    if (candidate.possibleOmissions?.length) {
      const omissions = document.createElement("details");
      omissions.className = "page-capture-omissions";
      const summary = document.createElement("summary");
      summary.textContent = t("可能遗漏（{count}）", { count: candidate.possibleOmissions.length });
      const list = document.createElement("div");
      list.append(...candidate.possibleOmissions.map((item) => {
        const block = document.createElement("p");
        block.textContent = item.text;
        return block;
      }));
      omissions.append(summary, list);
      card.append(omissions);
    }
    const confirm = document.createElement("button");
    confirm.type = "button";
    confirm.className = confirmed ? "button-secondary page-capture-confirm" : "primary page-capture-confirm";
    confirm.textContent = listMode && confirmed ? t("移除此案例") : confirmed ? t("已确认这个主体") : t("确认这个主体");
    confirm.disabled = confirmed && !listMode;
    confirm.addEventListener("click", () => listMode && confirmed ? removePageCaptureCandidate(candidate.id) : confirmPageCaptureCandidate(candidate));
    card.append(confirm);
    return card;
  }));
  const canEditRegion = !listMode && selectedCount === 1;
  elements.pageCaptureAddRegion.disabled = !canEditRegion;
  elements.pageCaptureExcludeRegion.disabled = !canEditRegion;
  elements.pageCaptureUndoRegion.disabled = !canEditRegion || !pageCaptureEditHistory.length;
  elements.pageCaptureResetRegion.disabled = !canEditRegion || !pageCaptureEditHistory.length;
  elements.pageCaptureAddRegion.hidden = listMode;
  elements.pageCaptureExcludeRegion.hidden = listMode;
  elements.pageCaptureUndoRegion.hidden = listMode;
  elements.pageCaptureResetRegion.hidden = listMode;
  renderPageCaptureMediaReview(selections);
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
    textNode("small", `${blocks.length} 个有序内容块`)
  );
  section.append(heading);
  const mediaById = new Map(candidate.media.map((media) => [media.id, media]));
  for (const block of blocks.toSorted((left, right) => left.sourceOrder - right.sourceOrder)) {
    const media = block.assetId ? mediaById.get(block.assetId) : null;
    if (["image", "video"].includes(block.kind)) {
      section.append(createPageCaptureArticleMedia(candidate, media, block, selection));
      continue;
    }
    if (["document", "link"].includes(block.kind)) {
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
  if (previewUrl) {
    const image = document.createElement("img");
    image.src = previewUrl;
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
  if (block.kind === "document") setPageCaptureMediaDecisionClass(button, media?.id, selection);
  const sourceUrl = block.sourceUrl || media?.url || "";
  button.disabled = !sourceUrl;
  if (sourceUrl) button.addEventListener("click", () => openPageCaptureArticleUrl(sourceUrl));
  button.append(
    textNode("span", block.kind === "document" ? "DOC" : "LINK"),
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

function confirmPageCaptureCandidate(candidate) {
  const next = normalizePageCaptureSelection({
    candidateId: candidate.id,
    selectedTextBlockIds: candidate.textBlocks.map((item) => item.id),
    selectedMediaIds: pageCaptureDefaultMediaIds(candidate),
    mediaDecision: "pending"
  }, pageCaptureBatch.candidates);
  pageCaptureBatch = normalizePageCaptureBatch({
    ...pageCaptureBatch,
    selections: next ? [next] : []
  });
  previewPageCaptureRegion(candidate);
  render();
}

function clearPageCaptureConfirmation() {
  pageCaptureBatch = normalizePageCaptureBatch({ ...pageCaptureBatch, selections: [] });
  previewPageCaptureRegion(null);
  render();
}

function previewPageCaptureRegion(candidate) {
  chrome.runtime.sendMessage({
    type: "PREVIEW_PAGE_CAPTURE_REGION",
    tabId: pageCaptureBatch?.tabId,
    marker: candidate?.region?.marker || ""
  }).catch(() => undefined);
}

async function editConfirmedPageCaptureRegion(mode, button) {
  const selectedId = pageCaptureBatch?.selections?.[0]?.candidateId;
  const candidate = pageCaptureBatch?.candidates?.find((item) => item.id === selectedId);
  if (!candidate) return showFeedback("请先确认一个主体方案", true);
  await withButton(button, async () => {
    const response = await chrome.runtime.sendMessage({
      type: "EDIT_PAGE_CAPTURE_REGION",
      tabId: pageCaptureBatch.tabId,
      candidate,
      mode
    });
    if (!response?.ok) {
      if (!response?.cancelled) showFeedback(response?.message || "网页区域没有修改", true);
      return;
    }
    pageCaptureEditHistory.push({ candidateId: candidate.id, candidate: structuredClone(candidate) });
    replacePageCaptureCandidate(response.candidate);
    showFeedback(response.message);
  });
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
    ? t("保存时将确认 {count} 项媒体", { count: proposedCount })
    : t("未识别到媒体，可返回网页补选");
  const createRow = ({ candidate, media, mediaIndex, selection }) => {
    const row = document.createElement("div");
    row.className = "page-capture-media-review-item";
    setPageCaptureMediaDecisionClass(row, media.id, selection);
    const preview = document.createElement("button");
    preview.type = "button";
    preview.className = "page-capture-media-review-preview";
    preview.addEventListener("click", () => openPageCaptureMediaViewer(candidate, mediaIndex));
    const previewUrl = media.kind === "video" ? media.posterUrl : media.previewDataUrl || media.dataUrl || media.url;
    if (previewUrl) {
      const image = document.createElement("img");
      image.src = previewUrl;
      image.alt = "";
      image.referrerPolicy = "no-referrer";
      image.addEventListener("error", () => preview.replaceChildren(textNode("span", t("预览不可用"))), { once: true });
      preview.append(image);
    } else preview.append(textNode("span", media.kind === "video" ? "VIDEO" : "DOC"));
    const copy = document.createElement("span");
    copy.append(
      textNode("strong", media.kind === "video" ? t("视频") : media.kind === "document" ? t("文档") : media.captureMethod === "pixel-fallback" ? t("页面截图") : t("图片")),
      textNode("small", media.alt || media.filename || hostname(media.url || media.posterUrl) || t("可见媒体"))
    );
    const toggle = document.createElement("button");
    toggle.type = "button";
    toggle.className = "button-secondary compact";
    const included = selection.mediaDecision !== "none" && selection.selectedMediaIds.includes(media.id);
    toggle.textContent = included ? t("排除") : t("恢复");
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
  replacePageCaptureCandidate(previous.candidate);
  showFeedback("已撤销上一次主体修正");
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
  const sourceUrl = media.kind === "video" ? media.url : media.previewDataUrl || media.dataUrl || media.url;
  const visual = document.createElement(media.kind === "video" ? "video" : "img");
  visual.src = sourceUrl || media.posterUrl || "";
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
  if (pageCaptureBatch?.status !== "scanning" || !pageCaptureSession?.sessionId) {
    await clearPageCaptureMarkers();
    pageCaptureBatch = null;
    pageCaptureSession = null;
    pageCaptureEditHistory = [];
    pageCaptureOriginalCandidates = new Map();
    return render();
  }
  const response = await chrome.runtime.sendMessage({ type: "CANCEL_PAGE_CAPTURE", sessionId: pageCaptureSession.sessionId });
  await clearPageCaptureMarkers();
  showFeedback(response?.message || t("正在停止整页扫描"), !response?.ok);
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
    copy.append(text(fragment.text, "p"), text(fragment.sourceTitle || hostname(fragment.sourceUrl) || "当前网页", "small"));
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
    copy.append(text(`${draft.visuals.length} 张图片`, "strong"), text(draft.visuals[0].sourceTitle || hostname(draft.visuals[0].sourceUrl) || "当前网页", "small"));
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
  const source = text(fragment.sourceTitle || hostname(fragment.sourceUrl) || "当前网页");
  const partType = text(partContentTypes[fragment.sourceUrl || "source:unknown"]?.name || "待确认", "small");
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
    text(draft.primaryVisualId === visual.id ? "主图" : `图片 ${index + 1}`, "strong"),
    text(visual.sourceTitle || hostname(visual.sourceUrl) || "当前网页", "small")
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
  await withButton(button, async () => {
    try {
      const representative = mode === "list"
        ? pageCaptureBatch?.candidates.find((candidate) => candidate.id === pageCaptureBatch.selections[0]?.candidateId) || null
        : null;
      const tab = await resolveActivePage(chrome.tabs, chrome.scripting);
      if (!tab?.url && Number.isInteger(tab?.id)) {
        throw new Error(t("Chrome 不会在点击插件图标时弹出授权窗口。请先在当前网页点击工具栏里的 PromptDirector 图标，再回到侧栏点击“授权当前网站并扫描”；待保存内容没有改变。"));
      }
      if (!tab?.url) throw new Error(t(RESTRICTED_PAGE_MESSAGE));
      let permission = await inspectPagePermission(tab.url, chrome.permissions);
      if (permission.status === "missing") {
        if (!await ensurePagePermission(tab.url, chrome.permissions)) {
          throw new Error(t("你没有授予当前网站访问权限。请再次点击“授权当前网站并扫描”，或在 Chrome 扩展详情的“网站访问权限”中允许此网站；待保存内容没有改变。"));
        }
        permission = { ...permission, status: "granted" };
      }
      pageCapturePermissionState = permission;
      renderPageCapturePermissionAction();
      if (permission.status === "restricted") {
        throw new Error(t("Chrome 内部页、扩展页或本机设置页不能采集，请切换到普通网页"));
      }
      if (mode === "whole" && pageCaptureBatch) {
        pageCaptureBatch = normalizePageCaptureBatch({ ...pageCaptureBatch, status: "scanning" });
        render();
      }
      const targetCount = mode === "list" ? Number(elements.pageCaptureTargetCount.value) : 0;
      const response = await chrome.runtime.sendMessage({ type: "START_PAGE_CAPTURE", mode, targetCount });
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
      pageCaptureEditHistory = [];
      pageCaptureOriginalCandidates = new Map(pageCaptureBatch.candidates.map((candidate) => [candidate.id, structuredClone(candidate)]));
      pageCaptureSession = null;
      showFeedback(response.message);
      render();
    } catch (error) {
      if (pageCaptureBatch) pageCaptureBatch = normalizePageCaptureBatch({ ...pageCaptureBatch, status: "preview", error: error.message });
      pageCaptureSession = null;
      showFeedback(error.message || t("网页采集失败"), true);
      render();
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
  if (!pageCaptureBatch) return;
  const trigger = textOnly ? elements.pageCaptureSaveTextOnly : elements.pageCaptureSave;
  await withButton(trigger, async () => {
    const reviewBatch = pageCaptureBatch;
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
        batch: normalizePageCaptureBatch({ ...pageCaptureBatch, sessionMediaAllowed })
      });
      if (!response?.ok) throw new Error(response?.message || t("网页内容保存失败"));
      const partial = response.results?.filter((item) => item.status === "partial" || item.status === "failed") || [];
      await clearPageCaptureMarkers();
      pageCaptureBatch = null;
      pageCaptureEditHistory = [];
      pageCaptureOriginalCandidates = new Map();
      showFeedback(partial.length ? t("{message}；{count} 项存在媒体下载问题", { message: response.message, count: partial.length }) : response.message, partial.length > 0);
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
  } catch (error) {
    showFeedback(error.message || "标题更新失败", true);
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
    const response = await chrome.runtime.sendMessage({ type: "COMMIT_CAPTURE_DRAFT", duplicateAction });
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
  const value = message || "";
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
  const button = text(label, "button");
  button.type = "button";
  button.disabled = disabled;
  button.className = className;
  if (ariaLabel) button.setAttribute("aria-label", ariaLabel);
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

function hostname(value) {
  try {
    return new URL(value).hostname;
  } catch {
    return "";
  }
}

function parseCustomLabels(value) {
  return [...new Set(String(value ?? "").split(/[,，\n]+/).map((item) => item.trim()).filter(Boolean))];
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
