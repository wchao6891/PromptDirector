import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const [library, html, css, background, composerHtml, composerCss] = await Promise.all([
  readFile(new URL("../library.js", import.meta.url), "utf8"),
  readFile(new URL("../library.html", import.meta.url), "utf8"),
  readFile(new URL("../library.css", import.meta.url), "utf8"),
  readFile(new URL("../background.js", import.meta.url), "utf8"),
  readFile(new URL("../composer.html", import.meta.url), "utf8"),
  readFile(new URL("../composer-page.css", import.meta.url), "utf8")
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
  assert.match(css, /\.project-filter\[aria-pressed="true"\]\s*\{[^}]*color:\s*var\(--accent-ink\)[^}]*background:\s*var\(--accent-soft\)[^}]*var\(--accent\)/);
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
