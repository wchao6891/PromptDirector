import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import {
  assignVisualPreviewSource,
  collectorViewState
} from "../collector-view.js";

test("cached screenshot URLs bind to newly created thumbnail nodes before they are connected", () => {
  const image = { isConnected: false, src: "" };

  assignVisualPreviewSource(image, "blob:cached-visual");

  assert.equal(image.src, "blob:cached-visual");
});

test("an empty collector starts with direct capture actions and no draft-management surface", () => {
  const view = collectorViewState({ fragments: [], visuals: [] });

  assert.equal(view.showStart, true);
  assert.equal(view.showPreview, false);
  assert.equal(view.showOrganizer, false);
  assert.equal(view.showFooter, false);
  assert.equal(view.saveLabel, "保存案例");
});

test("one captured item stays in quick preview until the user asks to edit it", () => {
  const draft = {
    fragments: [{ id: "fragment-a", text: "一段高亮文字" }],
    visuals: []
  };
  const quick = collectorViewState(draft, null, { organizing: false });
  const editing = collectorViewState(draft, null, { organizing: true });

  assert.equal(quick.showPreview, true);
  assert.equal(quick.showOrganizer, false);
  assert.equal(quick.summary, "1 段文字");
  assert.equal(quick.canReorderFragments, false);
  assert.equal(editing.showOrganizer, true);
});

test("quick preview exposes one-step removal for every captured text and image", async () => {
  const collectorSource = await readFile(new URL("../collector.js", import.meta.url), "utf8");
  const quickPreview = collectorSource.slice(
    collectorSource.indexOf("function createQuickPreview"),
    collectorSource.indexOf("function createFragmentCard")
  );

  assert.match(collectorSource, /import \{ createUiIcon \} from "\.\/ui-icons\.js"/);
  assert.match(quickPreview, /draft\.fragments\.forEach/);
  assert.match(quickPreview, /REMOVE_CAPTURE_FRAGMENT/);
  assert.match(quickPreview, /删除第 \$\{index \+ 1\} 段文字/);
  assert.match(quickPreview, /draft\.visuals\.forEach/);
  assert.match(quickPreview, /REMOVE_CAPTURE_VISUAL/);
  assert.match(quickPreview, /删除第 \$\{index \+ 1\} 张图片/);
  assert.match(quickPreview, /createUiIcon\("x"\)/);
  assert.match(collectorSource, /URL\.revokeObjectURL\(removedVisualUrl\)/);
  assert.match(collectorSource, /visualUrls\.delete\(payload\.visualId\)/);
});

test("page capture replaces failed remote thumbnails with an explicit unavailable preview", async () => {
  const collectorSource = await readFile(new URL("../collector.js", import.meta.url), "utf8");
  const pageCaptureRenderer = collectorSource.slice(
    collectorSource.indexOf("function renderPageCapture"),
    collectorSource.indexOf("function updatePageCaptureSelection")
  );
  assert.match(pageCaptureRenderer, /media\.previewDataUrl \|\| media\.dataUrl \|\| media\.url/);
  assert.match(pageCaptureRenderer, /image\.addEventListener\("error"/);
  assert.match(pageCaptureRenderer, /preview\.replaceChildren\(textNode\("span", t\("预览不可用"\)\)\)/);
  assert.match(pageCaptureRenderer, /pageCaptureMediaSourceLabel\(media\.sourceKind, media\.captureMethod\)/);
  const collectorHtml = await readFile(new URL("../collector.html", import.meta.url), "utf8");
  assert.match(collectorHtml, /id="page-capture-help"[^>]*>确认一个主体后即可保存/);
});

test("page capture uses the final save as media authorization and keeps uncertain media separate", async () => {
  const [collectorSource, collectorHtml, backgroundSource] = await Promise.all([
    readFile(new URL("../collector.js", import.meta.url), "utf8"),
    readFile(new URL("../collector.html", import.meta.url), "utf8"),
    readFile(new URL("../background.js", import.meta.url), "utf8")
  ]);
  const pageCaptureRenderer = collectorSource.slice(
    collectorSource.indexOf("function renderPageCapture"),
    collectorSource.indexOf("function pageCaptureExtractionLabel")
  );
  assert.match(pageCaptureRenderer, /confirmPageCaptureCandidate/);
  assert.match(pageCaptureRenderer, /selectedTextBlockIds: candidate\.textBlocks\.map/);
  assert.match(pageCaptureRenderer, /pageCaptureDefaultMediaIds\(candidate\)/);
  assert.match(pageCaptureRenderer, /mediaDecision: "pending"/);
  assert.match(pageCaptureRenderer, /finalizePageCaptureSelectionsForSave/);
  assert.match(pageCaptureRenderer, /t\("保存案例 · 含 \{count\} 项媒体"/);
  assert.match(pageCaptureRenderer, /可能遗漏媒体/);
  assert.match(pageCaptureRenderer, /batchStructureStatus === "review"/);
  assert.match(pageCaptureRenderer, /updatePageCaptureMediaSelection/);
  assert.match(pageCaptureRenderer, /openPageCaptureMediaViewer/);
  assert.match(pageCaptureRenderer, /possibleOmissions/);
  assert.match(collectorHtml, /id="page-capture-media-review"/);
  assert.doesNotMatch(collectorHtml, /id="page-capture-confirm-media"/);
  assert.match(collectorHtml, /id="page-capture-save-text-only"/);
  assert.match(collectorHtml, /id="page-capture-media-viewer"/);
  assert.match(collectorHtml, /id="page-capture-media-stage"/);
  assert.match(pageCaptureRenderer, /page-capture-preview-details/);
  assert.doesNotMatch(collectorHtml, /page-capture-select-text|page-capture-select-images/);
  assert.match(backgroundSource, /case "PREVIEW_PAGE_CAPTURE_REGION"/);
  assert.match(backgroundSource, /previewPageCaptureRegion/);
});

test("page capture can correct the confirmed DOM region and previews one ordered article", async () => {
  const [collectorSource, collectorHtml, backgroundSource, librarySource] = await Promise.all([
    readFile(new URL("../collector.js", import.meta.url), "utf8"),
    readFile(new URL("../collector.html", import.meta.url), "utf8"),
    readFile(new URL("../background.js", import.meta.url), "utf8"),
    readFile(new URL("../library.js", import.meta.url), "utf8")
  ]);
  assert.match(collectorHtml, /id="page-capture-add-region"/);
  assert.match(collectorHtml, /id="page-capture-exclude-region"/);
  assert.match(collectorHtml, /id="page-capture-undo-region"/);
  assert.match(collectorHtml, /id="page-capture-reset-region"/);
  assert.match(collectorSource, /createPageCaptureArticlePreview/);
  assert.match(collectorSource, /EDIT_PAGE_CAPTURE_REGION/);
  assert.match(backgroundSource, /runPageCaptureRegionEditor/);
  assert.match(backgroundSource, /contentTargetsValue/);
  assert.match(backgroundSource, /整组选择/);
  assert.match(backgroundSource, /data-promptdirector-page-edit-include/);
  assert.match(backgroundSource, /data-promptdirector-page-edit-exclude/);
  assert.match(backgroundSource, /data-promptdirector-page-edit-hover/);
  assert.match(backgroundSource, /case "CLEAR_PAGE_CAPTURE_MARKERS"/);
  assert.match(backgroundSource, /clearPageCapturePageState/);
  assert.match(collectorSource, /await clearPageCaptureMarkers\(\)/);
  assert.match(librarySource, /createArticleDocumentReader/);
});

test("multi-page material reveals only the controls that have something to organize", () => {
  const view = collectorViewState({
    fragments: [
      { id: "fragment-a", text: "第一段" },
      { id: "fragment-b", text: "第二段" }
    ],
    visuals: [
      { id: "visual-a" },
      { id: "visual-b" }
    ]
  }, null, { organizing: true });

  assert.equal(view.summary, "2 段文字 · 2 张图片");
  assert.equal(view.canReorderFragments, true);
  assert.equal(view.canReorderVisuals, true);
  assert.equal(view.canChoosePrimary, true);
});

test("continuing an existing case keeps the target explicit at the final action", () => {
  const view = collectorViewState({
    targetCaseId: "case-a",
    fragments: [{ id: "fragment-a", text: "补充文字" }],
    visuals: []
  }, { id: "case-a", title: "雪地漂移参考" });

  assert.equal(view.targetLabel, "正在补充《雪地漂移参考》");
  assert.equal(view.saveLabel, "保存到这个案例");
});

test("collector translates only built-in capture content types", async () => {
  const [collectorSource, backgroundSource] = await Promise.all([
    readFile(new URL("../collector.js", import.meta.url), "utf8"),
    readFile(new URL("../background.js", import.meta.url), "utf8")
  ]);
  assert.match(collectorSource, /item\.customized \? item\.name : t\(item\.name\)/);
  assert.match(collectorSource, /partContentType\?\.customized \? partContentType\.name : t\(partContentType\?\.name \|\| "待确认"\)/);
  assert.match(backgroundSource, /customized: item\.customized === true/);
});

test("the collector auto-reads only highlights and reserves clipboard access for the extract buttons", async () => {
  const [collectorSource, collectorHtml, backgroundSource] = await Promise.all([
    readFile(new URL("../collector.js", import.meta.url), "utf8"),
    readFile(new URL("../collector.html", import.meta.url), "utf8"),
    readFile(new URL("../background.js", import.meta.url), "utf8")
  ]);

  assert.match(collectorSource, /TRY_ACTIVE_SELECTION_TO_DRAFT/);
  assert.match(collectorSource, /readClipboardContentAfterFocus/);
  const focusFlow = collectorSource.slice(
    collectorSource.indexOf('window.addEventListener("focus"'),
    collectorSource.indexOf('chrome.tabs.onActivated.addListener')
  );
  assert.match(focusFlow, /void tryAutoSelection\(\)/);
  assert.match(focusFlow, /void refreshPageCapturePermissionState\(\)/);
  const autoFlow = collectorSource.slice(collectorSource.indexOf("async function tryAutoSelection"), collectorSource.indexOf("async function extractClipboardOrSelection"));
  assert.doesNotMatch(autoFlow, /clipboard|readClipboardContentAfterFocus|ensureClipboardReadPermission/);
  const explicitFlow = collectorSource.slice(collectorSource.indexOf("async function extractClipboardOrSelection"), collectorSource.indexOf("function render"));
  assert.match(explicitFlow, /ADD_ACTIVE_SELECTION_TO_DRAFT/);
  assert.match(explicitFlow, /ensureClipboardReadPermission/);
  assert.match(explicitFlow, /readClipboardContentAfterFocus/);
  assert.match(explicitFlow, /prepareLocalMedia/);
  assert.match(explicitFlow, /saveScreenshotBlob/);
  assert.match(collectorSource, /CAPTURE_VISIBLE_VISUALS_TO_DRAFT/);
  assert.match(collectorSource, /contentTypeExplicit: true/);
  assert.match(collectorSource, /customLabelsExplicit: true/);
  assert.match(backgroundSource, /case "TRY_ACTIVE_SELECTION_TO_DRAFT"/);
  assert.match(backgroundSource, /case "ADD_CLIPBOARD_TEXT_TO_DRAFT"/);
  assert.doesNotMatch(backgroundSource, /lastCommittedClipboardFingerprint/);
  assert.match(collectorHtml, /id="start-selection"[^>]*>[\s\S]*?<strong[^>]*>提取文字\/图片<\/strong>/);
  assert.match(collectorHtml, /id="add-selection"[^>]*>[\s\S]*?提取文字\/图片<\/button>/);
  assert.doesNotMatch(collectorHtml, /自动识别已复制文字|id="clipboard-access"|id="enable-clipboard"/);
  assert.doesNotMatch(collectorSource, /querySelectorAll\("button"\)/);
  assert.ok(collectorHtml.indexOf('id="start-smart-visuals"') < collectorHtml.indexOf('id="start-selection"'));
  assert.ok(collectorHtml.indexOf('id="start-selection"') < collectorHtml.indexOf('id="other-capture-methods"'));
  assert.match(collectorHtml, /id="other-capture-methods"[\s\S]*id="start-screenshot"/);
  assert.doesNotMatch(collectorHtml, /id="normal-start"[\s\S]*?class="start-copy"/);
  assert.doesNotMatch(collectorHtml, /点击图片或暂停的视频画面|优先网页高亮，其次剪贴板|智能选图无法识别时使用/);
  assert.match(collectorHtml, /id="start-smart-visuals"[\s\S]*icon-image/);
  assert.match(collectorHtml, /id="start-selection"[\s\S]*icon-file-text/);
  assert.match(collectorHtml, /id="start-screenshot"[\s\S]*icon-maximize-2/);
  assert.ok(collectorHtml.indexOf('id="add-smart-visuals"') < collectorHtml.indexOf('id="add-selection"'));
  assert.ok(collectorHtml.indexOf('id="add-selection"') < collectorHtml.indexOf('id="add-other-capture-methods"'));
  assert.doesNotMatch(collectorHtml.match(/id="add-other-capture-methods"[\s\S]*?<\/details>/)?.[0] || "", /id="add-selection"/);
  assert.match(collectorSource, /fallbackAction === "capture-region"/);
  assert.doesNotMatch(collectorSource, /otherCaptureMethods\.open = smartVisualFallback/);
  assert.match(collectorSource, /addOtherCaptureMethods\.open = smartVisualFallback/);
  assert.match(collectorSource, /if \(draft\) render\(\)/);
});

test("every captured draft exposes project and the shared multi-tag editor before save", async () => {
  const [collectorSource, collectorHtml, draftSource] = await Promise.all([
    readFile(new URL("../collector.js", import.meta.url), "utf8"),
    readFile(new URL("../collector.html", import.meta.url), "utf8"),
    readFile(new URL("../capture-draft.js", import.meta.url), "utf8")
  ]);
  const metadata = collectorHtml.slice(
    collectorHtml.indexOf('<section id="capture-metadata"'),
    collectorHtml.indexOf('<div id="capture-add-more-actions"')
  );
  assert.match(metadata, /id="capture-collection"/);
  assert.match(metadata, /id="capture-new-collection-name"/);
  assert.match(metadata, /添加标签/);
  assert.doesNotMatch(metadata, /自由标签|可选|不用预先创建|输入任意新标签/);
  assert.match(metadata, /id="custom-labels"/);
  assert.doesNotMatch(metadata, /<details/);
  assert.match(collectorSource, /collections = response\.collections \?\? \[\]/);
  assert.match(collectorSource, /const selectedCollection = elements\.captureCollection\.value/);
  assert.match(collectorSource, /newCollectionName: selectedCollection === NEW_COLLECTION_OPTION_VALUE/);
  assert.match(collectorSource, /const customLabelEditor = createTagEditor/);
  assert.match(collectorSource, /customLabels: customLabelEditor\.values/);
  assert.match(collectorSource, /type: "COMMIT_CAPTURE_DRAFT",[\s\S]*\.\.\.metadata/);
  assert.match(collectorSource, /type: "COMMIT_PAGE_CAPTURE",[\s\S]*\.\.\.captureMetadataForCommit\(\)/);
  assert.match(collectorSource, /pageCaptureActions\.before\(elements\.captureMetadata\)/);
  assert.match(collectorSource, /captureAddMoreActions\.before\(elements\.captureMetadata\)/);
  assert.match(draftSource, /collectionId: clean\(value\.collectionId\)/);
  assert.match(draftSource, /newCollectionName: clean\(value\.newCollectionName\)/);
});
