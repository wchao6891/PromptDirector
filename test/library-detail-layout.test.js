import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const cssUrl = new URL("../library.css", import.meta.url);

function rule(source, selector) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return source.match(new RegExp(`(?:^|\\n)\\s*${escaped}\\s*\\{([^}]+)\\}`))?.[1] ?? "";
}

test("case visuals use an edge-to-edge immersive stage instead of a nested card", async () => {
  const source = await readFile(cssUrl, "utf8");
  const gallery = rule(source, ".detail-visual-gallery");
  const immersive = rule(source, ".detail-visual-gallery.is-immersive");
  const item = rule(source, ".detail-visual-item");
  const image = rule(source, ".detail-image");
  const caption = rule(source, ".detail-visual-caption");

  assert.match(gallery, /padding:\s*0/);
  assert.match(gallery, /background:\s*var\(--viewer-bg\)/);
  assert.match(immersive, /height:\s*100dvh/);
  assert.match(item, /border:\s*0/);
  assert.match(item, /border-radius:\s*0/);
  assert.match(image, /height:\s*100%/);
  assert.match(image, /max-height:\s*none/);
  assert.match(caption, /position:\s*absolute/);
  assert.match(caption, /bottom:\s*0/);
});

test("image details reserve an in-flow action row below the large image", async () => {
  const source = await readFile(cssUrl, "utf8");
  const imageItem = rule(source, ".detail-visual-gallery.is-image-detail .detail-visual-item");
  const image = rule(source, ".detail-visual-gallery.is-image-detail .detail-image");
  const caption = rule(source, ".detail-visual-gallery.is-image-detail .detail-visual-caption");
  const actions = rule(source, ".detail-visual-actions");

  assert.match(imageItem, /display:\s*grid/);
  assert.match(imageItem, /grid-template-rows:\s*minmax\(0,\s*1fr\) auto/);
  assert.match(image, /min-height:\s*0/);
  assert.match(caption, /position:\s*static/);
  assert.match(caption, /flex-wrap:\s*wrap/);
  assert.match(actions, /flex-wrap:\s*wrap/);
});

test("detail titles stay fully readable and project task actions wrap without overlap", async () => {
  const source = await readFile(cssUrl, "utf8");
  const title = rule(source, ".detail-title");
  const heading = rule(source, ".gallery-heading.project-selection-mode");
  const actions = rule(source, ".project-selection-actions");

  assert.match(title, /overflow-wrap:\s*anywhere/);
  assert.doesNotMatch(title, /-webkit-line-clamp/);
  assert.doesNotMatch(title, /text-overflow:\s*ellipsis/);
  assert.match(heading, /flex-wrap:\s*wrap/);
  assert.match(actions, /flex-wrap:\s*wrap/);
});

test("vision batch choices and compatible capability groups stay compact", async () => {
  const source = await readFile(cssUrl, "utf8");
  const option = rule(source, ".task-option");
  const compatibility = rule(source, ".compatibility-settings-grid");
  const mobile = source.slice(source.indexOf("@media (max-width: 390px)"));

  assert.match(option, /grid-template-columns:\s*auto 1fr/);
  assert.match(option, /border-radius:\s*7px/);
  assert.match(compatibility, /grid-template-columns:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\)/);
  assert.match(mobile, /\.compatibility-settings-grid\s*\{[^}]*grid-template-columns:\s*1fr/);
});

test("single case details use one scroll surface with a full-width discovery wall", async () => {
  const source = await readFile(cssUrl, "utf8");
  const script = await readFile(new URL("../library.js", import.meta.url), "utf8");
  const drawer = rule(source, ".detail-drawer");
  const content = rule(source, ".detail-content");
  const primary = rule(source, ".detail-primary");
  const body = rule(source, ".detail-body");
  const discovery = rule(source, ".detail-discovery-grid");
  const mobile = source.slice(
    source.indexOf("@media (max-width: 640px)"),
    source.indexOf("@media (prefers-reduced-motion: reduce)")
  );
  const mobileDrawer = rule(mobile, ".detail-drawer");
  const mobilePrimary = rule(mobile, ".detail-primary");
  const mobileGallery = rule(mobile, ".detail-visual-gallery.is-immersive");

  assert.match(drawer, /width:\s*100vw/);
  assert.match(drawer, /height:\s*100dvh/);
  assert.match(content, /overflow:\s*auto/);
  assert.match(primary, /grid-template-columns:\s*minmax\(0, 1fr\) var\(--detail-panel-width\)/);
  assert.match(body, /overflow:\s*visible/);
  assert.doesNotMatch(body, /padding-top:/);
  assert.match(discovery, /--masonry-gap:\s*var\(--visual-wall-gap\)/);
  assert.match(script, /primary\.append\(elements\.detailNavigation\)/);
  assert.match(mobileDrawer, /height:\s*100dvh/);
  assert.match(mobilePrimary, /display:\s*block/);
  assert.match(mobileGallery, /height:\s*58dvh/);
});

test("single case navigation is positioned inside the primary case area", async () => {
  const source = await readFile(cssUrl, "utf8");
  const html = await readFile(new URL("../library.html", import.meta.url), "utf8");
  const primary = rule(source, ".detail-primary");
  const navigation = rule(source, ".detail-primary > .detail-navigation");

  assert.match(html, /id="drawer-toolbar"/);
  assert.match(html, /id="detail-navigation"/);
  assert.match(primary, /position:\s*relative/);
  assert.match(navigation, /position:\s*absolute/);
  assert.match(navigation, /top:\s*50dvh/);
  assert.match(navigation, /z-index:\s*[2-9]/);
});

test("document navigation moves into the top toolbar and long documents use a real scroll surface", async () => {
  const source = await readFile(cssUrl, "utf8");
  const script = await readFile(new URL("../library.js", import.meta.url), "utf8");
  const toolbarNavigation = rule(source, ".drawer-toolbar.has-document-navigation .detail-navigation");
  const documentStage = rule(source, ".detail-visual-gallery.is-document-detail .detail-visual-stage");
  const documentItem = rule(source, ".detail-visual-gallery.is-document-detail .detail-visual-item");

  assert.match(script, /const hasArticleDocument = !capturedPost && Boolean\(entry\.articleDocument\?\.blocks\?\.length\)/);
  assert.match(script, /const usesStageNavigation = !capturedPost && !hasArticleDocument && \(entryHasMedia\(entry, "image"\) \|\| entryHasMedia\(entry, "video"\)\)/);
  assert.match(script, /else elements\.drawerToolbar\.prepend\(elements\.detailNavigation\)/);
  assert.match(script, /gallery\.classList\.toggle\("is-document-detail", asset\.kind === "document"\)/);
  assert.match(script, /stage\.scrollTop = 0/);
  assert.match(toolbarNavigation, /top:\s*14px/);
  assert.match(toolbarNavigation, /right:\s*58px/);
  assert.match(toolbarNavigation, /width:\s*auto/);
  assert.match(documentStage, /overflow:\s*auto/);
  assert.match(documentItem, /height:\s*auto/);
  assert.match(documentItem, /overflow:\s*visible/);
});

test("captured posts use a compact post view while articles show only genuinely unplaced media separately", async () => {
  const script = await readFile(new URL("../library.js", import.meta.url), "utf8");
  const styles = await readFile(cssUrl, "utf8");
  const detail = script.slice(script.indexOf("async function renderDetail"), script.indexOf("function createLocalDiscovery"));
  assert.match(detail, /const capturedPost = isCapturedPost\(entry\)/);
  assert.match(detail, /createCapturedPostView\(entry\)/);
  assert.match(detail, /createUnplacedMediaShelf\(entry\)/);
  assert.match(script, /function articleReferencedAssetIds/);
  assert.match(script, /function createCapturedPostView/);
  assert.match(script, /帖子文字/);
  assert.match(script, /打开原帖/);
  assert.doesNotMatch(detail, /单独查看文章媒体/);
  assert.match(rule(styles, ".captured-post-view"), /background:\s*var\(--card\)/);
  assert.match(rule(styles, ".unplaced-media-shelf"), /grid-template-columns:/);
});

test("media switching preserves the detail scroll anchor and locks image stage height", async () => {
  const script = await readFile(new URL("../library.js", import.meta.url), "utf8");
  const gallery = script.slice(script.indexOf("async function createDetailMediaGallery"), script.indexOf("function refreshActiveDetailAssetSections"));
  assert.match(gallery, /lockedImageStageHeight/);
  assert.match(gallery, /captureDetailScrollAnchor/);
  assert.match(gallery, /restoreDetailScrollAnchor/);
  assert.match(gallery, /button\.focus\(\{ preventScroll: true \}\)/);
});

test("compound details retain their existing split layout", async () => {
  const source = await readFile(cssUrl, "utf8");
  const compound = rule(source, ".detail-content.is-compound-detail");
  const compoundBody = rule(source, ".detail-content.is-compound-detail > .detail-body");
  assert.match(compound, /grid-template-columns:\s*minmax\(0, 1fr\) var\(--detail-panel-width\)/);
  assert.match(compoundBody, /overflow:\s*auto/);
});

test("case detail shell follows UI themes while the media stage stays neutral", async () => {
  const source = await readFile(cssUrl, "utf8");
  const foundation = await readFile(new URL("../ui-foundation.css", import.meta.url), "utf8");
  const html = await readFile(new URL("../library.html", import.meta.url), "utf8");
  const drawer = rule(source, ".detail-drawer");
  const body = rule(source, ".detail-body");
  assert.match(foundation, /--viewer-bg:\s*#0f1113/);
  assert.match(foundation, /:root\[data-theme="dark"\][\s\S]*--viewer-bg:\s*var\(--ui-browser\)/);
  assert.match(foundation, /:root\[data-theme="system"\][\s\S]*--viewer-bg:\s*var\(--ui-browser\)/);
  assert.match(drawer, /background:\s*var\(--viewer-bg\)/);
  assert.match(body, /background:\s*var\(--card\)/);
  assert.match(html, /id="detail-drawer"[^>]*role="dialog"[^>]*aria-modal="true"/);
});

test("case details open the source beside metadata without starting a capture workflow", async () => {
  const source = await readFile(new URL("../library.js", import.meta.url), "utf8");
  const metadata = source.slice(source.indexOf("function createDetailMetadata"), source.indexOf("function createFullAnalysis"));
  const detail = source.slice(source.indexOf("async function renderDetail"), source.indexOf("function createLocalDiscovery"));
  assert.doesNotMatch(source, /PREPARE_SCREENSHOT_RECAPTURE|重新框选截图|继续跨页采集|START_CAPTURE_FOR_CASE|回来源继续采集/);
  assert.match(metadata, /safeHttpUrl\(entry\.url\)/);
  assert.match(metadata, /打开来源/);
  assert.match(metadata, /target\s*=\s*"_blank"/);
  assert.match(metadata, /noopener noreferrer/);
  assert.doesNotMatch(detail, /createSourceQuickActions/);
});

test("detail editing and core prompt actions stay beside the content they change", async () => {
  const source = await readFile(new URL("../library.js", import.meta.url), "utf8");
  const styles = await readFile(cssUrl, "utf8");
  const header = source.slice(source.indexOf("function createDetailHeader"), source.indexOf("function createComposerAction"));
  const prompt = source.slice(source.indexOf("function createPromptSection"), source.indexOf("function createEntryEditor"));
  const promptDisplay = prompt.slice(prompt.indexOf('const heading = el("div", "prompt-section-heading")'));
  assert.match(header, /createEntryEditor\(entry, \{ inline: true \}\)/);
  assert.match(prompt, /detail-core-actions/);
  assert.match(prompt, /复制提示词/);
  assert.match(prompt, /createComposerAction\(entry\)/);
  assert.match(prompt, /detail-analysis-menu/);
  assert.match(prompt, /完善分析/);
  assert.match(promptDisplay, /section\.append\(\s*heading,\s*rawTextEl\("pre",[\s\S]*?coreActions\s*\)/);
  assert.match(promptDisplay, /if \(activeVideo && !entry\.compoundCase\) section\.append\(createVideoAnalysisWorkspace\(entry, activeVideo\)\)/);
  assert.match(promptDisplay, /section\.append\(analysisMenu\)/);
  assert.ok(promptDisplay.indexOf("createVideoAnalysisWorkspace") < promptDisplay.indexOf("section.append(analysisMenu)"));
  assert.match(rule(styles, ".detail-core-actions"), /grid-template-columns:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\)/);
});
