import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const source = await readFile(new URL("../library.js", import.meta.url), "utf8");
const html = await readFile(new URL("../library.html", import.meta.url), "utf8");
const css = await readFile(new URL("../library.css", import.meta.url), "utf8");

test("gallery cards keep static covers and opt into bounded local hover playback", () => {
  const card = source.slice(source.indexOf("function createCaseCard"), source.indexOf("function renderProjectFilters"));
  assert.match(card, /case-video-poster/);
  assert.match(card, /createVideoLinkCover/);
  assert.doesNotMatch(card, /createElement\("video"\)/);
  assert.match(card, /bindVideoHoverPreview/);
  assert.match(card, /mainVisual\.storageMode === "managed"/);
  assert.match(card, /case-video-duration/);
  const viewer = source.slice(source.indexOf("async function createMediaViewer"), source.indexOf("function createReferencedMediaViewer"));
  assert.match(viewer, /video\.controls\s*=\s*true/);
  assert.match(viewer, /video\.preload\s*=\s*"metadata"/);
  assert.match(viewer, /video\.autoplay\s*=\s*false/);
});

test("visual gallery cards contain only media and selection state", () => {
  const card = source.slice(source.indexOf("function createCaseCard"), source.indexOf("function createTextCaseCover"));
  assert.doesNotMatch(card, /mini-tags|createPalette|video-poster-badge/);
  assert.match(card, /case-video-cue/);
  assert.match(card, /share-check/);
  assert.match(css, /--visual-wall-gap:\s*2px/);
  assert.match(css, /--visual-card-radius:\s*2px/);
});

test("time notes seek the local player and support optional segment ends", () => {
  const notes = source.slice(source.indexOf("function renderTimeNotes"), source.indexOf("function officialEmbedUrl"));
  assert.match(notes, /seekToMs\(note\.startMs\)/);
  assert.match(notes, /添加时间笔记/);
  assert.match(notes, /更多记录选项/);
  assert.match(notes, /endMs/);
  assert.match(notes, /ADD_TIME_NOTE/);
  assert.match(notes, /DELETE_TIME_NOTE/);
  assert.match(notes, /ADD_VIDEO_KEYFRAME/);
  assert.match(notes, /drawImage\(video/);
});

test("social video references prefer official embeds and never download a platform video", () => {
  const viewer = source.slice(source.indexOf("function createReferencedMediaViewer"), source.indexOf("function renderTimeNotes"));
  assert.match(viewer, /platform-link-card/);
  assert.match(viewer, /referenced-video-embed/);
  assert.match(viewer, /target = "_blank"/);
  assert.doesNotMatch(viewer, /复制直链|readVideoMedia|saveMediaBlob/);
});

test("YouTube references request scoped playback permission and keep an honest source fallback", () => {
  const viewer = source.slice(source.indexOf("function createReferencedMediaViewer"), source.indexOf("function renderTimeNotes"));
  assert.match(viewer, /youtubeWatchUrl/);
  assert.match(viewer, /platform-link-card/);
  assert.match(viewer, /posterAssetForVideo/);
  assert.match(viewer, /ensureYouTubePlaybackPermission\(chrome, \{ request: true \}\)/);
  assert.match(viewer, /youtubeMediaController/);
  assert.match(viewer, /打开来源/);
});

test("PDF uses the local document viewer rather than a blob iframe", () => {
  const viewer = source.slice(source.indexOf("async function createMediaViewer"), source.indexOf("function createReferencedMediaViewer"));
  assert.match(viewer, /createPdfViewer/);
  assert.doesNotMatch(viewer, /frame\.src\s*=\s*url/);
});

test("the PDF display layer disables dynamic expression evaluation", async () => {
  const documentViewer = await readFile(new URL("../document-viewer.js", import.meta.url), "utf8");
  assert.match(documentViewer, /isEvalSupported:\s*false/);
});

test("notes and text documents render readable card excerpts instead of no-media placeholders", () => {
  const card = source.slice(source.indexOf("function createCaseCard"), source.indexOf("function renderProjectFilters"));
  assert.match(card, /createTextCaseCover/);
  assert.match(card, /case-text-excerpt/);
});

test("Markdown uses a safe local reading renderer instead of a preformatted text dump", async () => {
  const renderer = await readFile(new URL("../markdown-renderer.js", import.meta.url), "utf8");
  const viewer = source.slice(source.indexOf("async function createMediaViewer"), source.indexOf("async function loadRemoteMarkdownImage"));
  const markdownBranch = viewer.slice(viewer.indexOf('asset.mimeType === "text/markdown"'), viewer.indexOf("  } else {", viewer.indexOf('asset.mimeType === "text/markdown"')));
  assert.match(viewer, /renderMarkdownDocument/);
  assert.doesNotMatch(markdownBranch, /rawTextEl\("pre"/);
  assert.match(renderer, /createElement\("table"\)/);
  assert.match(renderer, /type\s*=\s*"checkbox"/);
  assert.doesNotMatch(renderer, /innerHTML|insertAdjacentHTML/);
});

test("video cards resolve a saved local poster and referenced video details stay content-sized", () => {
  const card = source.slice(source.indexOf("function createCaseCard"), source.indexOf("function renderProjectFilters"));
  assert.match(card, /posterAssetForVideo/);
  assert.match(card, /dataset\.visualId/);
  assert.match(card, /mainVisual\.storageMode === "managed"\s*\? createLocalVideoCaseCover\(entry, mainVisual\)/);
  const localVideoCover = source.slice(source.indexOf("function createLocalVideoCaseCover"), source.indexOf("function createVideoLinkCover"));
  assert.match(localVideoCover, /本地视频/);
  assert.match(localVideoCover, /浏览器无法预览，打开详情可用系统播放器/);
  assert.doesNotMatch(localVideoCover, /视频来源|reference/);
  assert.match(source, /is-video-reference/);
  assert.match(source, /releaseDetailControllers/);
  assert.match(source, /removeEventListener\("message", onMessage\)/);
});

test("one top search surface keeps only a concise placeholder hint", () => {
  assert.equal((html.match(/type="search"/g) ?? []).length, 1);
  assert.match(html, /placeholder="[^"]*type:video[^"]*"/);
  assert.doesNotMatch(html, /id="search-help"|source:x\.com.*tag:电影感.*has:video/);
});

test("the gallery keeps one current-result count instead of a duplicate global media summary", () => {
  const gallery = source.slice(source.indexOf("function renderGalleryResults"), source.indexOf("function projectManualOrderAvailable"));
  assert.match(gallery, /elements\.resultCount\.textContent/);
  assert.match(gallery, /visibleEntries\.length/);
  assert.doesNotMatch(html, /id="library-summary"/);
});

test("fixed-ratio gallery covers crop mismatched source images inside the card", () => {
  const card = source.slice(source.indexOf("function createCaseCard"), source.indexOf("function renderProjectFilters"));
  assert.match(card, /classList\.add\("case-image-wrap-fixed"\)/);
  assert.match(css, /\.case-image-wrap\s*\{[^}]*overflow:\s*hidden/);
  assert.match(css, /\.case-image-wrap-fixed \.case-shot\s*\{[^}]*height:\s*100%;[^}]*object-fit:\s*cover/);
});

test("complete folder backup writes a completion marker after library metadata", () => {
  const backup = source.slice(source.indexOf("async function createCompleteFolderBackup"), source.indexOf("async function restoreCompleteFolderBackup"));
  assert.ok(backup.indexOf('"library.json"') < backup.indexOf('"complete.json"'));
  assert.match(backup, /await writeDirectoryFile\(directory, assetPath, blob\)/);
  assert.match(backup, /portableManagedBackupAsset\(asset, blob, assetPath, await sha256Blob\(blob\)\)/);
  assert.match(backup, /materializeEntry\(item\.snapshot, `trash-entry-/);
  assert.match(backup, /buildFolderBackupCompletion\(writtenFiles/);
  assert.match(backup, /verifyFolderBackupCompletion\(completion, writtenFiles\)/);
  assert.ok(backup.indexOf("parseCompleteFolderBackup(writtenLibrary, writtenFiles") < backup.indexOf('"complete.json"'));
  assert.match(source, /"application\/rtf":\s*"rtf"/);
});

test("complete folder restore validates aggregate and real per-media sizes before preview", () => {
  const restore = source.slice(source.indexOf("async function restoreCompleteFolderBackup"), source.indexOf("function backupMediaPaths"));
  const aggregateValidation = restore.indexOf("completion.mediaCount !== backupPaths.size");
  const packageParsing = restore.indexOf("parseCompleteFolderBackup(library, files");
  assert.ok(aggregateValidation >= 0 && aggregateValidation < packageParsing);
  assert.match(restore, /PREVIEW_LIBRARY_IMPORT[^}]*library:\s*restoredLibrary/);
  assert.match(restore, /APPLY_LIBRARY_IMPORT[^}]*library:\s*restoredLibrary/);
});

test("the library includes a local quick-note entry that does not invoke AI", () => {
  assert.match(html, /id="add-quick-note"/);
  const quickNote = source.slice(source.indexOf("async function createQuickNote"), source.indexOf("async function prepareLocalMedia"));
  assert.match(quickNote, /CREATE_QUICK_NOTE/);
  assert.match(quickNote, /caseCreationOrganizationFields\(\)/);
  assert.match(quickNote, /caseCreationOrganization\(projectName, customLabels, projectInput\?\.dataset\.projectId\)/);
  assert.doesNotMatch(quickNote, /ANALY|DeepSeek|OpenAI/);
});

test("new video references and quick notes accept an existing or new project plus user tags", () => {
  const video = source.slice(source.indexOf("async function addVideoReference"), source.indexOf("async function fetchVideoReferencePoster"));
  const note = source.slice(source.indexOf("async function createQuickNote"), source.indexOf("async function prepareLocalMedia"));
  assert.match(video, /caseCreationOrganizationFields\(\)/);
  assert.match(video, /caseCreationOrganization\(\s*projectName,\s*customLabels,\s*projectInput\?\.dataset\.projectId\s*\)/);
  assert.match(video, /CREATE_MEDIA_REFERENCE[\s\S]*?\.\.\.organization/);
  assert.match(note, /CREATE_QUICK_NOTE[\s\S]*?\.\.\.caseCreationOrganization\(projectName, customLabels, projectInput\?\.dataset\.projectId\)/);
  assert.match(note, /label:\s*"添加标签"/);
  assert.match(note, /newCollectionName:\s*projectName/);
  assert.match(note, /collectionId:\s*existing\.id/);
  assert.match(note, /attachProjectSuggestions/);
});

test("similar material stays local, image-led, and free of project-age resurfacing", () => {
  const discovery = source.slice(source.indexOf("function createLocalDiscovery"), source.indexOf("async function renderCompoundDetail"));
  assert.match(discovery, /rankSimilarEntries/);
  assert.match(discovery, /local-discovery-media/);
  assert.doesNotMatch(discovery, /local-discovery-copy|相似色卡|同类\$\{name\}/);
  assert.match(discovery, /相似资料/);
  assert.match(discovery, /localSimilarityIndex\.profiles\.size/);
  assert.match(discovery, /renderedCount \+ PAGE_SIZE/);
  assert.match(discovery, /createStableMasonry\(grid, \{[\s\S]*scrollContainer: elements\.detailContent/);
  assert.match(discovery, /IntersectionObserver\([\s\S]*root: elements\.detailContent/);
  assert.doesNotMatch(discovery, /organizerState|ageDays|久未使用/);
  assert.doesNotMatch(discovery, /不请求 AI，不播放轮播动画/);
  assert.doesNotMatch(discovery, /setInterval|fetch\(/);
});

test("the home wall shows every library-visible content type and hides only explicit category-only types", () => {
  const gallery = source.slice(source.indexOf("function renderGalleryResults"), source.indexOf("function projectManualOrderAvailable"));
  assert.match(gallery, /CONTENT_TYPE_VISIBILITY\.categoryOnly/);
  assert.match(gallery, /const browseEntries = selectedContentId/);
  assert.match(gallery, /isEntryPending\(entry\)/);
  assert.match(gallery, /entryContentTypeIds\(entry\)\.some/);
  assert.doesNotMatch(gallery, /hasVisualGalleryPreview/);
});

test("prompt text supports explicit editing and revision-safe saving", () => {
  const prompt = source.slice(source.indexOf("function createPromptSection"), source.indexOf("function createEntryEditor"));
  const editor = source.slice(source.indexOf("function createEntryEditor"), source.indexOf("function renderManager"));
  assert.match(prompt, /编辑提示词/);
  assert.match(prompt, /UPDATE_ENTRY_TEXT/);
  assert.match(prompt, /textRevision/);
  assert.match(prompt, /textarea/);
  assert.match(editor, /案例标题/);
  assert.match(editor, /UPDATE_ENTRY_TITLE/);
  assert.match(editor, /title\.trim\(\)/);
});

test("image details size the stage from the active media ratio", () => {
  const gallery = source.slice(source.indexOf("async function createDetailMediaGallery"), source.indexOf("async function createMediaViewer"));
  assert.match(gallery, /syncImageStageSize/);
  assert.match(gallery, /ResizeObserver/);
  assert.match(css, /\.detail-visual-gallery\.is-image-detail/);
});

test("primary image and search-tag analysis share one secondary analysis menu", () => {
  const header = source.slice(source.indexOf("function createDetailHeader"), source.indexOf("function composerTargetType"));
  const gallery = source.slice(source.indexOf("async function createDetailMediaGallery"), source.indexOf("async function createMediaViewer"));
  const prompt = source.slice(source.indexOf("function createPromptSection"), source.indexOf("function createEntryEditor"));
  assert.doesNotMatch(header, /vision-analyze-button|分析主图|重新分析主图/);
  assert.doesNotMatch(gallery, /vision-analyze-button|分析主图|重新分析主图/);
  assert.match(prompt, /复制提示词/);
  assert.match(prompt, /分析主图/);
  assert.match(prompt, /分析检索标签/);
  assert.match(prompt, /analyzeEntryVision\(entry,\s*analyzeVisual\)/);
  assert.match(prompt, /const copy = textEl\("button",\s*"button-secondary"/);
  assert.match(prompt, /detail-analysis-menu/);
  assert.match(prompt, /完善分析/);
  assert.match(prompt, /detail-core-actions/);
  assert.match(prompt, /createComposerAction\(entry\)/);
});

test("deleting a visible case uses a differential masonry removal", () => {
  const deletion = source.slice(source.indexOf("async function deleteCaseIncrementally"), source.indexOf("function updateGalleryCounts"));
  assert.match(deletion, /galleryMasonry\.remove\(visibleCard\)/);
  assert.doesNotMatch(deletion, /refreshLibrary\(\)/);
  assert.match(deletion, /caseCardCache\.delete\(entryId\)/);
});
