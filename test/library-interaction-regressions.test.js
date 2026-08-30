import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const [library, html, css, background, composerHtml, composerCss, i18n] = await Promise.all([
  readFile(new URL("../library.js", import.meta.url), "utf8"),
  readFile(new URL("../library.html", import.meta.url), "utf8"),
  readFile(new URL("../library.css", import.meta.url), "utf8"),
  readFile(new URL("../background.js", import.meta.url), "utf8"),
  readFile(new URL("../composer.html", import.meta.url), "utf8"),
  readFile(new URL("../composer-page.css", import.meta.url), "utf8"),
  readFile(new URL("../i18n.js", import.meta.url), "utf8")
]);

test("project visibility uses the clicked control and updates the wall without a redundant reload", () => {
  const projectFilters = library.slice(
    library.indexOf("function renderProjectFilters"),
    library.indexOf("async function createProjectCollection")
  );
  assert.match(projectFilters, /updateProjectVisibility\(collection, visibility\)/);
  assert.match(projectFilters, /perform\(button,\s*\{[\s\S]*SET_COLLECTION_VISIBILITY[\s\S]*\}, false\)/);
  assert.doesNotMatch(projectFilters, /perform\(null/);
});

test("structured filter clicks reuse the existing navigation instead of rebuilding it", () => {
  const structuredRender = library.slice(
    library.indexOf("function renderStructuredFilterResults"),
    library.indexOf("function updateLibrarySummary")
  );
  const filterRenderers = library.slice(
    library.indexOf("function renderContentFilters"),
    library.indexOf("function clearFilters")
  );
  assert.match(structuredRender, /renderGalleryResults\(\{ refreshNavigation: false \}\)/);
  assert.match(structuredRender, /syncStructuredFilterControls\(\)/);
  assert.match(filterRenderers, /renderStructuredFilterResults\(\)/);
  assert.doesNotMatch(filterRenderers, /addEventListener\("click",[^\n]+renderGallery\(\)/);
});

test("developer analysis import remains supported without appearing in the normal library UI", () => {
  assert.doesNotMatch(html, /id="import-candidates"|id="candidate-file"|高级工具|导入整库分析 JSON/);
  assert.match(background, /IMPORT_ANALYSIS_CANDIDATES/);
});

test("detail panels and selected projects use the themed surface and product accent", () => {
  assert.match(css, /\.detail-primary > \.detail-body\s*\{[^}]*min-height:\s*100dvh[^}]*align-self:\s*stretch/);
  assert.match(css, /\.project-filter\[aria-pressed="true"\]\s*\{[^}]*color:\s*var\(--accent-ink\)[^}]*background:\s*var\(--ui-project-active-surface\)[^}]*var\(--accent-emphasis\)/);
});

test("library refresh waits for detail rebuilding before returning control", () => {
  const refreshLibrary = library.slice(
    library.indexOf("async function refreshLibrary"),
    library.indexOf("async function loadImageDerivedMetadata")
  );
  assert.match(refreshLibrary, /if \(currentDetailId[\s\S]*await renderDetail\(\)/);
});

test("vision batch dialog only revives running or paused jobs and otherwise shows the fresh preview", () => {
  const previewSelectedVisionBatch = library.slice(
    library.indexOf("async function previewSelectedVisionBatch"),
    library.indexOf("function renderVisionBatchDialog")
  );
  const renderVisionBatchDialog = library.slice(
    library.indexOf("function renderVisionBatchDialog"),
    library.indexOf("async function startSelectedVisionBatch")
  );
  assert.match(previewSelectedVisionBatch, /visionBatchJob && \["running", "paused"\]\.includes\(visionBatchJob\.status\)/);
  assert.match(renderVisionBatchDialog, /const activeJob = visionBatchJob && \["running", "paused"\]\.includes\(visionBatchJob\.status\) \? visionBatchJob : null/);
  assert.match(renderVisionBatchDialog, /const source = activeJob \?\? preview \?\? visionBatchJob \?\? \{\}/);
  assert.match(renderVisionBatchDialog, /elements\.visionBatchStart\.hidden = Boolean\(activeJob\)/);
  assert.match(renderVisionBatchDialog, /elements\.visionBatchPause\.hidden = !activeJob \|\| activeJob\.status !== "running"/);
  assert.match(renderVisionBatchDialog, /elements\.visionBatchResume\.hidden = !activeJob \|\| activeJob\.status !== "paused"/);
  assert.match(renderVisionBatchDialog, /elements\.visionBatchCancel\.hidden = !active/);
  assert.match(renderVisionBatchDialog, /elements\.visionBatchProgress\.hidden = !job/);
  assert.match(renderVisionBatchDialog, /elements\.visionBatchProgressBar\.max = Math\.max\(1, requestCount \|\| job\?\.requestCount \|\| 1\)/);
  assert.match(renderVisionBatchDialog, /elements\.visionBatchProgressBar\.value = Math\.min\(processedCount, elements\.visionBatchProgressBar\.max\)/);
  assert.match(previewSelectedVisionBatch, /visionBatchJob\.kind !== "vision" \|\| visionBatchJob\.providerType !== visionSettings\.activeProvider/);
  assert.match(previewSelectedVisionBatch, /if \(providerChanged \|\| visionBatchJob\.model !== currentModel\)/);
  assert.match(previewSelectedVisionBatch, /chrome\.runtime\.sendMessage\(\{ type: "CANCEL_VISION_BATCH", jobId: visionBatchJob\.id \}\)/);
});

test("image-analysis UI keeps one prompt surface instead of duplicating the reconstruction prompt", () => {
  const createPromptSection = library.slice(
    library.indexOf("function createPromptSection"),
    library.indexOf("async function analyzeEntryVisualSet")
  );
  const createEntryEditor = library.slice(
    library.indexOf("function createEntryEditor"),
    library.indexOf("function removeReferenceCard")
  );
  assert.match(html, /id="vision-batch-reanalyze"[\s\S]*重新分析已有反推提示词/);
  assert.doesNotMatch(html, /id="vision-batch-reanalyze"[\s\S]*重新分析已有画面描述/);
  assert.match(html, /id="vision-batch-progress"[\s\S]*id="vision-batch-progress-bar"/);
  assert.doesNotMatch(library, /function createVisionDescription|vision-description|撤回本次分析/);
  assert.match(createPromptSection, /promptForEntryImage/);
  assert.match(createPromptSection, /复制提示词/);
  assert.doesNotMatch(createEntryEditor, /UPDATE_VISION_RECONSTRUCTION_PROMPT|vision-edit-field/);
  assert.doesNotMatch(createEntryEditor, /反推提示词/);
  assert.doesNotMatch(createEntryEditor, /画面描述/);
  assert.match(i18n, /"重新分析已有反推提示词": "Reanalyze existing reconstruction prompts"/);
  assert.match(i18n, /"反推提示词": "Reconstruction prompt"/);
});

test("analysis progress reports failures without exposing incomplete-result wording", () => {
  const renderAnalysisBatch = library.slice(
    library.indexOf("function renderAnalysisBatch"),
    library.indexOf("function analysisFailureSummary")
  );
  assert.doesNotMatch(renderAnalysisBatch, /待补全|重试失败\/待补全|部分完成/);
  assert.doesNotMatch(renderAnalysisBatch, /\$\{job\.counts\.partial \|\| 0\} partial/);
});

test("detail text analysis follows the currently displayed image prompt", () => {
  const createPromptSection = library.slice(
    library.indexOf("function createPromptSection"),
    library.indexOf("async function analyzeEntryVisualSet")
  );
  const analyzeSingleEntry = library.slice(
    library.indexOf("async function analyzeSingleEntry"),
    library.indexOf("async function privateAiSettings")
  );
  assert.match(createPromptSection, /canonicalTextAnalysisInput\(entry, activeImage\?\.id \|\| ""\)/);
  assert.match(createPromptSection, /analyze\.disabled = !analysisInput\.text/);
  assert.match(createPromptSection, /analyzeSingleEntry\(entry, analyze, analysisInput\)/);
  assert.match(analyzeSingleEntry, /fingerprint = await textFingerprint\(analysisInput\.text\)/);
  assert.match(analyzeSingleEntry, /assetId: analysisInput\.assetId/);
  assert.doesNotMatch(analyzeSingleEntry, /textFingerprint\(entry\.text\)/);
});

test("composer keeps only primary controls exposed and moves secondary choices into one settings menu", () => {
  assert.match(composerHtml, /class="composer-options-panel"/);
  assert.match(composerHtml, /id="composer-applied-skills"[^>]*hidden/);
  assert.match(composerHtml, /id="composer-attachment-local"/);
  assert.match(composerHtml, /id="composer-reference-tab-skills"/);
  assert.doesNotMatch(composerHtml, /id="composer-skill-manage"|id="composer-attachment-menu"/);
  assert.ok(composerHtml.indexOf("composer-type-switch") < composerHtml.indexOf("composer-options-panel"));
  assert.ok(composerHtml.indexOf("composer-reference-open") < composerHtml.indexOf("composer-options-panel"));
  assert.ok(composerHtml.indexOf("composer-route") > composerHtml.indexOf("composer-options-panel"));
  assert.ok(composerHtml.indexOf("composer-platform") > composerHtml.indexOf("composer-options-panel"));
  assert.ok(composerHtml.indexOf("composer-output-language") > composerHtml.indexOf("composer-options-panel"));
  assert.ok(composerHtml.indexOf("composer-production-review") > composerHtml.indexOf("composer-options-panel"));
  assert.ok(composerHtml.indexOf("composer-thinking") > composerHtml.indexOf("composer-options-panel"));
  assert.match(composerCss, /\.composer-input-tools\s*\{[^}]*flex-wrap:\s*nowrap/);
});
