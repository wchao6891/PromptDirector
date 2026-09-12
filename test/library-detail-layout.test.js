import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const cssUrl = new URL("../extension/library.css", import.meta.url);

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
  const script = await readFile(new URL("../extension/library.js", import.meta.url), "utf8");
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
  assert.doesNotMatch(script, /item\.append\(navigation\)|prepend\(elements\.detailNavigation\)/);
  assert.match(mobileDrawer, /height:\s*100dvh/);
  assert.match(mobilePrimary, /display:\s*block/);
  assert.match(mobileGallery, /height:\s*58dvh/);
});

test("case navigation stays in the fixed detail shell outside variable media and text layouts", async () => {
  const source = await readFile(cssUrl, "utf8");
  const script = await readFile(new URL("../extension/library.js", import.meta.url), "utf8");
  const html = await readFile(new URL("../extension/library.html", import.meta.url), "utf8");
  const stage = rule(source, ".detail-visual-stage");
  const navigation = rule(source, ".detail-navigation");

  assert.match(html, /id="drawer-toolbar"/);
  assert.match(html, /id="detail-navigation"/);
  assert.match(stage, /position:\s*relative/);
  assert.match(navigation, /position:\s*absolute/);
  assert.match(navigation, /top:\s*50%/);
  assert.match(navigation, /width:\s*100%/);
  assert.match(navigation, /z-index:\s*[2-9]/);
  assert.doesNotMatch(script, /append\(elements\.detailNavigation\)|prepend\(elements\.detailNavigation\)|item\.append\(navigation\)/);
  const toolbar = html.slice(html.indexOf('<header id="drawer-toolbar"'), html.indexOf('</header>', html.indexOf('<header id="drawer-toolbar"')));
  assert.doesNotMatch(toolbar, /id="detail-navigation"/);
  assert.ok(html.indexOf('id="detail-navigation"') < html.indexOf('id="detail-content"'));
  assert.match(rule(source, ".detail-content"), /margin-inline:\s*var\(--detail-navigation-gutter\)/);
  assert.doesNotMatch(source, /has-document-navigation/);
});

test("documents keep the same case navigation and their real scroll surface", async () => {
  const source = await readFile(cssUrl, "utf8");
  const script = await readFile(new URL("../extension/library.js", import.meta.url), "utf8");
  const documentStage = rule(source, ".detail-visual-gallery.is-document-detail .detail-visual-stage");
  const documentItem = rule(source, ".detail-visual-gallery.is-document-detail .detail-visual-item");

  assert.match(script, /const hasArticleDocument = !capturedPost && usesArticleReader\(entry\)/);
  assert.match(script, /classList\.toggle\("has-text-header", Boolean\(entry\.compoundCase\) \|\| !hasMediaStage\)/);
  assert.doesNotMatch(script, /drawerToolbar\.prepend\(elements\.detailNavigation\)/);
  assert.match(script, /gallery\.classList\.toggle\("is-document-detail", asset\.kind === "document"\)/);
  assert.match(script, /stage\.scrollTop = 0/);
  assert.match(documentStage, /overflow:\s*auto/);
  assert.match(documentItem, /height:\s*auto/);
  assert.match(documentItem, /overflow:\s*visible/);
});

test("text-only posts retain their reader while structured articles show only genuinely unplaced media separately", async () => {
  const script = await readFile(new URL("../extension/library.js", import.meta.url), "utf8");
  const styles = await readFile(cssUrl, "utf8");
  const detail = script.slice(script.indexOf("async function renderDetail"), script.indexOf("function createLocalDiscovery"));
  assert.match(detail, /const capturedPost = usesPostReader\(entry\)/);
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
  const script = await readFile(new URL("../extension/library.js", import.meta.url), "utf8");
  const gallery = script.slice(script.indexOf("async function createDetailMediaGallery"), script.indexOf("function refreshActiveDetailAssetSections"));
  assert.match(gallery, /lockedImageStageHeight/);
  assert.match(gallery, /captureDetailScrollAnchor/);
  assert.match(gallery, /restoreDetailScrollAnchor/);
  assert.match(gallery, /trigger\.disabled \? mediaNavigation : trigger\)\.focus\(\{ preventScroll: true \}\)/);
  assert.match(gallery, /rail\.offsetHeight \+ mediaNavigation\.offsetHeight/);
  assert.match(gallery, /event\.stopPropagation\(\)/);
});

test("compound details retain their existing split layout", async () => {
  const source = await readFile(cssUrl, "utf8");
  const compound = rule(source, ".detail-content.is-compound-detail");
  const compoundBody = rule(source, ".detail-content.is-compound-detail > .detail-body");
  assert.match(compound, /grid-template-columns:\s*minmax\(0, 1fr\) var\(--detail-panel-width\)/);
  assert.match(compoundBody, /overflow:\s*auto/);
});

test("case detail shell and transparent media stage follow the active UI theme", async () => {
  const source = await readFile(cssUrl, "utf8");
  const foundation = await readFile(new URL("../extension/ui-foundation.css", import.meta.url), "utf8");
  const html = await readFile(new URL("../extension/library.html", import.meta.url), "utf8");
  const drawer = rule(source, ".detail-drawer");
  const body = rule(source, ".detail-body");
  assert.match(foundation, /--viewer-bg:\s*var\(--ui-browser\)/);
  assert.match(foundation, /--viewer-checker-a:\s*#eef1ef/);
  assert.match(foundation, /--viewer-checker-b:\s*#d6dcd8/);
  assert.match(foundation, /:root\[data-theme="dark"\][\s\S]*--viewer-bg:\s*var\(--ui-browser\)/);
  assert.match(foundation, /:root\[data-theme="dark"\][\s\S]*--viewer-checker-a:\s*#17191c/);
  assert.match(foundation, /:root\[data-theme="system"\][\s\S]*--viewer-bg:\s*var\(--ui-browser\)/);
  assert.match(drawer, /background:\s*var\(--viewer-bg\)/);
  assert.match(body, /background:\s*var\(--card\)/);
  assert.doesNotMatch(source, /\.detail-visual-gallery\.is-(?:image|video)-detail \.detail-visual-caption\s*\{[^}]*background:\s*#[0-9a-f]+/i);
  assert.match(source, /\.detail-visual-gallery\.is-video-detail \.detail-visual-caption\s*\{[^}]*background:\s*var\(--card\)/);
  assert.match(source, /\.case-image-wrap\.has-alpha-channel,[\s\S]*\.image-lightbox\.has-alpha-channel\s*\{/);
  assert.match(source, /background-size:\s*24px 24px/);
  assert.match(html, /id="detail-drawer"[^>]*role="dialog"[^>]*aria-modal="true"/);
});

test("case detail supports one remembered right sidebar and forces narrow screens back to fullscreen", async () => {
  const source = await readFile(cssUrl, "utf8");
  const script = await readFile(new URL("../extension/library.js", import.meta.url), "utf8");
  const html = await readFile(new URL("../extension/library.html", import.meta.url), "utf8");
  const sidebar = rule(source, ".detail-drawer.detail-sidebar-mode");
  const resizer = rule(source, ".detail-sidebar-mode > .detail-resizer");
  const narrow = source.slice(source.indexOf("@media (max-width: 640px)"));

  assert.match(html, /id="detail-mode-toggle"/);
  assert.match(html, /id="detail-resizer"[^>]*role="separator"/);
  assert.match(sidebar, /width:\s*var\(--detail-sidebar-width, 760px\)/);
  assert.match(sidebar, /min-width:\s*520px/);
  assert.match(source, /\.detail-sidebar-mode \.detail-primary,[\s\S]*?\.detail-sidebar-mode \.detail-content\.is-compound-detail\s*\{[^}]*display:\s*block/);
  assert.doesNotMatch(source, /@container\s*\(max-width:\s*840px\)/);
  assert.match(resizer, /cursor:\s*col-resize/);
  assert.match(script, /uiPreferences\.detailMode === "sidebar" && !mobileLayout\.matches/);
  assert.match(script, /updateUiPreferences\(\{ \.\.\.uiPreferences, detailMode \}\)/);
  assert.match(narrow, /\.detail-drawer\.detail-sidebar-mode\s*\{[^}]*width:\s*100vw/);
  assert.match(narrow, /#detail-mode-toggle, \.detail-resizer\s*\{[^}]*display:\s*none/);
});

test("case and media switches invalidate old detail DOM before asynchronous rendering", async () => {
  const script = await readFile(new URL("../extension/library.js", import.meta.url), "utf8");
  const openDetail = script.slice(script.indexOf("async function openDetail"), script.indexOf("async function closeDetail"));
  const closeDetail = script.slice(script.indexOf("async function closeDetail"), script.indexOf("function moveDetail"));
  const invalidation = script.slice(script.indexOf("function invalidateDetailContent"), script.indexOf("function createLocalDiscovery"));
  const gallery = script.slice(script.indexOf("async function createDetailMediaGallery"), script.indexOf("function refreshActiveDetailAssetSections"));

  assert.ok(openDetail.indexOf("invalidateDetailContent(entryId)") < openDetail.indexOf('classList.add("open")'));
  assert.match(invalidation, /removeAttribute\("data-entry-id"\)/);
  assert.match(invalidation, /detailContent\.replaceChildren\(loading\)/);
  assert.match(closeDetail, /detailRenderGeneration \+= 1/);
  assert.match(closeDetail, /detailContent\.replaceChildren\(\)/);
  assert.ok(gallery.indexOf("stage.replaceChildren(pendingItem)") < gallery.indexOf("await createMediaViewer"));
  assert.match(gallery, /const token = \+\+renderToken/);
  assert.match(gallery, /if \(token !== renderToken \|\| currentDetailId !== ownerEntryId\)/);
  assert.match(gallery, /ownerGeneration !== detailRenderGeneration/);
});

test("case details open the source beside metadata without starting a capture workflow", async () => {
  const source = await readFile(new URL("../extension/library.js", import.meta.url), "utf8");
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
  const source = await readFile(new URL("../extension/library.js", import.meta.url), "utf8");
  const styles = await readFile(cssUrl, "utf8");
  const header = source.slice(source.indexOf("function createDetailHeader"), source.indexOf("function createComposerAction"));
  const prompt = source.slice(source.indexOf("function createPromptSection"), source.indexOf("function createEntryEditor"));
  assert.match(header, /createEntryEditor\(entry, \{ inline: true \}\)/);
  assert.match(prompt, /detail-core-actions/);
  assert.match(prompt, /createPromptCopyAction\(text\)/);
  assert.match(prompt, /createComposerAction\(entry\)/);
  assert.doesNotMatch(prompt, /detail-analysis-menu/);
  assert.doesNotMatch(prompt, /完善分析/);
  assert.doesNotMatch(prompt, /detail-analysis-actions/);
  assert.match(prompt, /section\.append\(createPromptPanel\(/);
  assert.match(prompt, /return createMediaPromptSection\(entry, activeAsset, options\)/);
  assert.match(prompt, /actions\.unshift\(analyze\)/);
  assert.match(prompt, /coreActions\.append\(createComposerAction\(entry\)\)/);
  assert.match(rule(styles, ".detail-core-actions"), /grid-template-columns:\s*minmax\(0,\s*1fr\)/);
});

test("video detail exposes one reverse-prompt action and no history or per-run prompt controls", async () => {
  const source = await readFile(new URL("../extension/library.js", import.meta.url), "utf8");
  const workspace = source.slice(
    source.indexOf("function createVideoAnalysisWorkspace"),
    source.indexOf("function createVideoAnalysisTaskStatus")
  );
  assert.match(workspace, /逆推视频提示词/);
  assert.equal((workspace.match(/startVideoAnalysis\(/g) ?? []).length, 1);
  assert.doesNotMatch(workspace, /creative-breakdown|ad-review|custom|createVideoAnalysisHistory|video-analysis-instruction|同时生成 AI 标签/);
});
