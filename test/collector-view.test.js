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

test("the collector auto-reads only highlights and reserves clipboard access for the extract buttons", async () => {
  const [collectorSource, collectorHtml, backgroundSource] = await Promise.all([
    readFile(new URL("../collector.js", import.meta.url), "utf8"),
    readFile(new URL("../collector.html", import.meta.url), "utf8"),
    readFile(new URL("../background.js", import.meta.url), "utf8")
  ]);

  assert.match(collectorSource, /TRY_ACTIVE_SELECTION_TO_DRAFT/);
  assert.match(collectorSource, /ADD_CLIPBOARD_TEXT_TO_DRAFT/);
  assert.match(collectorSource, /window\.addEventListener\("focus", \(\) => void tryAutoSelection\(\)\)/);
  const autoFlow = collectorSource.slice(collectorSource.indexOf("async function tryAutoSelection"), collectorSource.indexOf("async function extractText"));
  assert.doesNotMatch(autoFlow, /clipboard|readClipboardTextAfterFocus|ensureClipboardReadPermission/);
  const explicitFlow = collectorSource.slice(collectorSource.indexOf("async function extractText"), collectorSource.indexOf("function render"));
  assert.match(explicitFlow, /ADD_ACTIVE_SELECTION_TO_DRAFT/);
  assert.match(explicitFlow, /ensureClipboardReadPermission/);
  assert.match(explicitFlow, /readClipboardTextAfterFocus/);
  assert.match(collectorSource, /CAPTURE_VISIBLE_VISUALS_TO_DRAFT/);
  assert.match(collectorSource, /contentTypeExplicit: true/);
  assert.match(collectorSource, /customLabelsExplicit: true/);
  assert.match(backgroundSource, /case "TRY_ACTIVE_SELECTION_TO_DRAFT"/);
  assert.match(backgroundSource, /case "ADD_CLIPBOARD_TEXT_TO_DRAFT"/);
  assert.doesNotMatch(backgroundSource, /lastCommittedClipboardFingerprint/);
  assert.match(collectorHtml, /id="start-selection"[^>]*>[\s\S]*?<strong[^>]*>提取文字<\/strong>/);
  assert.match(collectorHtml, /id="add-selection"[^>]*>＋ 提取文字<\/button>/);
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
