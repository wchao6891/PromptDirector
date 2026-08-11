import { getScreenshotBlob } from "./image-store.js";
import {
  assignVisualPreviewSource,
  collectorViewState
} from "./collector-view.js";
import { runCaptureTransaction } from "./capture-workspace.js";
import {
  ensureClipboardReadPermission,
  readClipboardTextAfterFocus
} from "./capture-permissions.js";
import { initializeUi, t } from "./i18n.js";
import { confirmAppAction } from "./ui-dialogs.js";
import { ingestHtmlDocument } from "./document-ingestion.js";
import {
  applyPageCaptureSelections,
  normalizePageCaptureBatch,
  normalizePageCaptureSelection,
  pageCapturePermissionOrigins
} from "./page-capture.js";

await initializeUi();

const elements = Object.fromEntries([
  "add-selection", "add-screenshot", "add-smart-visuals", "collector-footer", "content-summary", "discard-draft", "draft-title",
  "content-type", "custom-labels", "duplicate-panel", "duplicate-title", "exit-target", "feedback", "fragment-help", "fragment-list",
  "fragment-section", "merge-duplicate", "open-library", "organizer", "organize-toggle", "preview-state",
  "quick-preview", "result-prompt-title", "result-screenshot", "result-smart-visuals", "result-start", "save-draft", "save-other-inspiration",
  "save-separate", "start-screenshot", "start-selection", "start-smart-visuals", "start-state", "normal-start",
  "other-capture-methods", "add-other-capture-methods", "smart-selection", "smart-selection-count", "smart-selection-help", "smart-selection-warning", "smart-selection-cancel", "smart-selection-confirm",
  "start-page-capture", "add-page-capture", "page-capture", "page-capture-title", "page-capture-help", "page-capture-list", "page-capture-scan", "page-capture-cancel", "page-capture-save",
  "page-capture-select-recommended", "page-capture-select-text", "page-capture-select-images", "page-capture-clear",
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
const visualUrls = new Map();

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== "local" || !(changes.captureDraft || changes.activeCreativeResult || changes.composerSessions)) return;
  refresh().catch(() => undefined);
});

await refresh();
await tryAutoSelection();

elements.openLibrary.addEventListener("click", () => void openLibraryTab());
window.addEventListener("focus", () => void tryAutoSelection());
elements.startSelection.addEventListener("click", () => extractText(elements.startSelection));
elements.startScreenshot.addEventListener("click", () => captureFromActivePage("CAPTURE_ACTIVE_TAB_TO_DRAFT", elements.startScreenshot));
elements.startSmartVisuals.addEventListener("click", () => beginSmartVisualSelection(elements.startSmartVisuals));
elements.startPageCapture.addEventListener("click", () => startPageCapture("loaded", elements.startPageCapture));
elements.resultScreenshot.addEventListener("click", () => captureFromActivePage("CAPTURE_ACTIVE_TAB_TO_DRAFT", elements.resultScreenshot, true));
elements.resultSmartVisuals.addEventListener("click", () => beginSmartVisualSelection(elements.resultSmartVisuals, true));
elements.saveOtherInspiration.addEventListener("click", () => clearActiveCreativeResult());
elements.addSelection.addEventListener("click", () => extractText(elements.addSelection));
elements.addScreenshot.addEventListener("click", () => captureFromActivePage("CAPTURE_ACTIVE_TAB_TO_DRAFT", elements.addScreenshot));
elements.addSmartVisuals.addEventListener("click", () => beginSmartVisualSelection(elements.addSmartVisuals));
elements.addPageCapture.addEventListener("click", () => startPageCapture("loaded", elements.addPageCapture));
elements.pageCaptureScan.addEventListener("click", () => startPageCapture("whole", elements.pageCaptureScan));
elements.pageCaptureCancel.addEventListener("click", cancelPageCapture);
elements.pageCaptureSave.addEventListener("click", savePageCapture);
elements.pageCaptureSelectRecommended.addEventListener("click", () => selectPageCaptureComponents("recommended"));
elements.pageCaptureSelectText.addEventListener("click", () => selectPageCaptureComponents("text"));
elements.pageCaptureSelectImages.addEventListener("click", () => selectPageCaptureComponents("images"));
elements.pageCaptureClear.addEventListener("click", () => selectPageCaptureComponents("clear"));
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

async function extractText(button) {
  await withButton(button, async () => {
    try {
      const selection = await runCaptureTransaction({
        type: "ADD_ACTIVE_SELECTION_TO_DRAFT",
        chromeApi: chrome,
        onStatus: showFeedback
      });
      if (selection.captured?.added || selection.captured?.reason !== "empty-selection") {
        draft = selection.draft;
        showFeedback(selection.message || "已提取网页高亮文字");
        await refresh();
        return;
      }

      showFeedback("当前网页没有高亮文字；Chrome 将询问一次剪贴板读取权限");
      if (!await ensureClipboardReadPermission(chrome.permissions)) {
        showFeedback("未获得剪贴板读取权限，未提取任何文字", true);
        return;
      }
      let clipboardText;
      try {
        clipboardText = await readClipboardTextAfterFocus();
      } catch {
        showFeedback("剪贴板读取失败，请保持采集台获得焦点后再试", true);
        return;
      }
      const response = await chrome.runtime.sendMessage({
        type: "ADD_CLIPBOARD_TEXT_TO_DRAFT",
        text: clipboardText
      });
      if (!response?.ok || !response.added) {
        showFeedback(response?.message || "剪贴板里没有可提取的文字", true);
        return;
      }
      draft = response.draft;
      showFeedback("已提取剪贴板文字");
      await refresh();
    } catch (error) {
      if (error?.draft) draft = error.draft;
      if (draft) render();
      showFeedback(error.message || "文字提取失败", true);
    }
  });
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
  elements.fragmentList.replaceChildren(...draft.fragments.map((fragment, index) =>
    createFragmentCard(fragment, index, view.canReorderFragments)));
  elements.visualList.replaceChildren(...draft.visuals.map((visual, index) =>
    createVisualCard(visual, index, view)));
}

function renderPageCapture() {
  const selections = new Map(pageCaptureBatch.selections.map((selection) => [selection.candidateId, selection]));
  const selectedCount = pageCaptureBatch.selections.reduce((total, selection) => total + Number(selection.includeText) + selection.selectedMediaIds.length, 0);
  elements.pageCaptureTitle.textContent = t("已识别 {count} 项 · 已确认 {selected} 项内容", { count: pageCaptureBatch.candidates.length, selected: selectedCount });
  elements.pageCaptureHelp.textContent = pageCaptureBatch.status === "scanning"
    ? t("正在扫描已加载内容；可随时停止，结束后会恢复原滚动位置。")
    : t("扫描不会自动保存。请确认正文、图片或视频，未勾选的内容不会进入案例库。");
  elements.pageCaptureSave.disabled = !selectedCount || pageCaptureBatch.status === "saving";
  elements.pageCaptureList.replaceChildren(...pageCaptureBatch.candidates.map((candidate) => {
    const card = document.createElement("article");
    card.className = "page-capture-item";
    const heading = document.createElement("header");
    const copy = document.createElement("div");
    const title = document.createElement("strong");
    title.textContent = candidate.title;
    const meta = document.createElement("small");
    meta.textContent = `${pageCaptureTypeLabel(candidate.pageType)} · ${hostname(candidate.canonicalUrl) || t("当前网页")}${candidate.sourceFacts.author ? ` · ${candidate.sourceFacts.author}` : ""}`;
    copy.append(title, meta);
    heading.append(copy);
    card.append(heading);
    const selection = selections.get(candidate.id) || { candidateId: candidate.id, includeText: false, selectedMediaIds: [] };
    if (candidate.contentText || candidate.excerpt) {
      const textChoice = document.createElement("label");
      textChoice.className = "page-capture-component page-capture-text";
      const input = document.createElement("input");
      input.type = "checkbox";
      input.checked = selection.includeText;
      input.addEventListener("change", () => updatePageCaptureSelection(candidate.id, { includeText: input.checked }));
      const textCopy = document.createElement("span");
      const words = [...String(candidate.contentText || candidate.excerpt)].length;
      textCopy.append(textNode("strong", t("正文")), textNode("small", t("{count} 字", { count: words })), textNode("p", candidate.excerpt || candidate.contentText.slice(0, 180)));
      textChoice.append(input, textCopy);
      card.append(textChoice);
    }
    if (candidate.media.length) {
      const mediaGrid = document.createElement("div");
      mediaGrid.className = "page-capture-media-grid";
      for (const media of candidate.media) {
        const mediaChoice = document.createElement("label");
        mediaChoice.className = "page-capture-component page-capture-media";
        const input = document.createElement("input");
        input.type = "checkbox";
        input.checked = selection.selectedMediaIds.includes(media.id);
        input.addEventListener("change", () => {
          const ids = new Set(selection.selectedMediaIds);
          if (input.checked) ids.add(media.id); else ids.delete(media.id);
          updatePageCaptureSelection(candidate.id, { selectedMediaIds: [...ids] });
        });
        const preview = document.createElement("span");
        preview.className = "page-capture-media-preview";
        const previewUrl = media.kind === "video" ? media.posterUrl : media.dataUrl || media.url;
        if (previewUrl) {
          const image = document.createElement("img");
          image.src = previewUrl;
          image.alt = "";
          image.referrerPolicy = "no-referrer";
          preview.append(image);
        } else {
          preview.textContent = media.kind === "video" ? "VIDEO" : "IMAGE";
        }
        const mediaCopy = document.createElement("span");
        const dimensions = media.width && media.height ? ` · ${media.width}×${media.height}` : "";
        mediaCopy.append(textNode("strong", media.kind === "video" ? t("视频引用") : t("图片")), textNode("small", `${media.alt || hostname(media.url || media.posterUrl) || t("可见媒体")}${dimensions}`));
        mediaChoice.append(input, preview, mediaCopy);
        mediaGrid.append(mediaChoice);
      }
      card.append(mediaGrid);
    }
    return card;
  }));
}

function textNode(tagName, value) {
  const node = document.createElement(tagName);
  node.textContent = value;
  return node;
}

function updatePageCaptureSelection(candidateId, patch) {
  const current = pageCaptureBatch.selections.find((item) => item.candidateId === candidateId)
    || { candidateId, includeText: false, selectedMediaIds: [] };
  const next = normalizePageCaptureSelection({ ...current, ...patch }, pageCaptureBatch.candidates);
  pageCaptureBatch = normalizePageCaptureBatch({
    ...pageCaptureBatch,
    selections: [...pageCaptureBatch.selections.filter((item) => item.candidateId !== candidateId), ...(next ? [next] : [])]
  });
  render();
}

function selectPageCaptureComponents(mode) {
  const current = new Map(pageCaptureBatch.selections.map((item) => [item.candidateId, item]));
  const selections = pageCaptureBatch.candidates.flatMap((candidate) => {
    if (mode === "clear") return [];
    const previous = current.get(candidate.id) || { candidateId: candidate.id, includeText: false, selectedMediaIds: [] };
    const value = mode === "text"
      ? { candidateId: candidate.id, includeText: Boolean(candidate.contentText || candidate.excerpt), selectedMediaIds: [] }
      : mode === "images"
        ? { ...previous, selectedMediaIds: candidate.media.filter((item) => item.kind === "image").map((item) => item.id) }
        : {
            candidateId: candidate.id,
            includeText: Boolean(candidate.contentText || candidate.excerpt),
            selectedMediaIds: candidate.media.map((item) => item.id)
          };
    const selection = normalizePageCaptureSelection(value, pageCaptureBatch.candidates);
    return selection ? [selection] : [];
  });
  pageCaptureBatch = normalizePageCaptureBatch({ ...pageCaptureBatch, selections });
  render();
}

async function cancelPageCapture() {
  if (pageCaptureBatch?.status !== "scanning" || !pageCaptureSession?.sessionId) {
    pageCaptureBatch = null;
    pageCaptureSession = null;
    return render();
  }
  const response = await chrome.runtime.sendMessage({ type: "CANCEL_PAGE_CAPTURE", sessionId: pageCaptureSession.sessionId });
  showFeedback(response?.message || t("正在停止整页扫描"), !response?.ok);
}

function pageCaptureTypeLabel(value) {
  return t(({ article: "文章", artwork: "作品", post: "帖子", gallery: "画廊", feed: "信息流", video: "视频", generic: "网页内容" })[value] || "网页内容");
}

function createQuickPreview() {
  const nodes = [];
  if (draft.fragments.length) {
    const first = draft.fragments[0];
    const card = div("quick-item quick-text");
    const marker = text("Aa", "strong");
    const copy = div("quick-copy");
    copy.append(text(first.text, "p"), text(first.sourceTitle || hostname(first.sourceUrl) || "当前网页", "small"));
    if (draft.fragments.length > 1) copy.append(text(`还有 ${draft.fragments.length - 1} 段文字`, "em"));
    card.append(marker, copy);
    nodes.push(card);
  }
  if (draft.visuals.length) {
    const card = div("quick-item quick-visuals");
    const strip = div("quick-image-strip");
    draft.visuals.forEach((visual, index) => {
      const image = document.createElement("img");
      image.alt = visual.sourceTitle || `截图 ${index + 1}`;
      loadVisual(image, visual.id);
      strip.append(image);
    });
    const copy = div("quick-copy");
    copy.append(text(`${draft.visuals.length} 张图片`, "strong"), text(draft.visuals[0].sourceTitle || hostname(draft.visuals[0].sourceUrl) || "当前网页", "small"));
    card.append(strip, copy);
    nodes.push(card);
  }
  return nodes;
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
      if (mode === "whole" && pageCaptureBatch) {
        pageCaptureBatch = normalizePageCaptureBatch({ ...pageCaptureBatch, status: "scanning" });
        render();
      }
      const response = await chrome.runtime.sendMessage({ type: "START_PAGE_CAPTURE", mode });
      if (!response?.ok) throw new Error(response?.message || t("网页采集失败"));
      const candidates = response.batch.candidates.map((candidate) => {
        if (!candidate.contentHtml) return candidate;
        try {
          const documentResult = ingestHtmlDocument(candidate.contentHtml);
          return { ...candidate, contentText: documentResult.contentText || candidate.contentText };
        } catch {
          return candidate;
        }
      });
      pageCaptureBatch = normalizePageCaptureBatch({ ...response.batch, candidates, status: "preview" });
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

async function savePageCapture() {
  if (!pageCaptureBatch) return;
  await withButton(elements.pageCaptureSave, async () => {
    const selected = applyPageCaptureSelections(pageCaptureBatch);
    const origins = pageCapturePermissionOrigins(selected);
    pageCaptureBatch = normalizePageCaptureBatch({ ...pageCaptureBatch, status: "saving" });
    render();
    try {
      if (origins.length) {
        const granted = await chrome.permissions.request({ origins });
        if (!granted) showFeedback(t("媒体域名权限未获授权；仍会保存正文和可用引用，并逐项显示下载失败原因。"), true);
      }
      const response = await chrome.runtime.sendMessage({ type: "COMMIT_PAGE_CAPTURE", batch: pageCaptureBatch });
      if (!response?.ok) throw new Error(response?.message || t("网页内容保存失败"));
      const partial = response.results?.filter((item) => item.status === "partial" || item.status === "failed") || [];
      pageCaptureBatch = null;
      showFeedback(partial.length ? t("{message}；{count} 项存在媒体下载问题", { message: response.message, count: partial.length }) : response.message, partial.length > 0);
      await refresh();
    } catch (error) {
      pageCaptureBatch = normalizePageCaptureBatch({ ...pageCaptureBatch, status: "preview", error: error.message });
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
  await withButton(button, async () => {
    try {
      const response = await chrome.runtime.sendMessage({ type, ...payload });
      if (!response?.ok) throw new Error(response?.message || "内容更新失败");
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
  elements.feedback.textContent = message || "";
  elements.feedback.classList.toggle("error", error);
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
