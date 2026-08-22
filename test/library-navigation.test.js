import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const html = await readFile(new URL("../library.html", import.meta.url), "utf8");
const source = await readFile(new URL("../library.js", import.meta.url), "utf8");

test("top navigation keeps search-adjacent actions focused on adding, creating, and settings", () => {
  const actions = html.slice(html.indexOf('<div class="top-actions">'), html.indexOf('<input id="media-file"'));
  assert.match(actions, /id="add-menu"/);
  assert.doesNotMatch(actions, /id="open-curated"|id="open-skills"/);
  assert.match(actions, /id="start-compose"/);
  assert.match(actions, /id="open-settings"[^>]*aria-label="设置"[^>]*title="设置"/);
  assert.doesNotMatch(actions, /id="package-menu"|id="select-cases"|id="open-batch-tools"|id="open-import-job"|id="open-about"/);
  assert.match(html.slice(html.indexOf('id="gallery-heading"'), html.indexOf('id="case-list"')), /id="select-cases"[^>]*aria-label="选择案例"[^>]*title="选择案例"/);
  assert.doesNotMatch(actions, /id="share-cases"|id="combine-cases"|id="manage-facets"/);
  assert.match(html, /<aside[^>]*id="filter-sidebar"[\s\S]*id="manage-facets"/);
  const workspace = html.slice(html.indexOf('<nav class="workspace-navigation"'), html.indexOf('</nav>', html.indexOf('<nav class="workspace-navigation"')));
  assert.match(workspace, /id="workspace-library"[^>]*aria-current="page"/);
  assert.match(workspace, /id="open-curated"/);
  assert.match(workspace, /id="open-skills"/);
  assert.ok(workspace.indexOf('id="workspace-library"') < workspace.indexOf('id="open-curated"'));
  assert.doesNotMatch(html, /动态视图|save-dynamic-view|dynamic-view-list/);
});

test("about information is inline at the bottom of general settings", async () => {
  const about = html.slice(html.indexOf('<footer class="settings-about"'), html.indexOf("</footer>", html.indexOf('<footer class="settings-about"')));
  const script = await readFile(new URL("../library.js", import.meta.url), "utf8");
  assert.equal((about.match(/<a\b/g) ?? []).length, 2);
  assert.match(about, /id="about-version">PromptDirector</);
  assert.doesNotMatch(about, /PromptDirector\s+\d+\.\d+\.\d+/);
  assert.match(script, /aboutVersion\.textContent\s*=\s*`PromptDirector \$\{chrome\.runtime\.getManifest\(\)\.version\}`/);
  assert.match(about, /github\.com\/wchao6891\/PromptDirector/);
  assert.match(about, /id="update-release-link"[^>]*github\.com\/wchao6891\/PromptDirector\/releases[^>]*hidden/);
  assert.match(about, /Apache-2\.0/);
  assert.doesNotMatch(about, /href="LICENSE"|href="NOTICE"|THIRD_PARTY_NOTICES/);
  assert.doesNotMatch(html, /id="about-dialog"|id="open-about"/);
});

test("closed dialogs cannot enter the page layout", async () => {
  const css = await readFile(new URL("../ui-foundation.css", import.meta.url), "utf8");
  assert.match(css, /dialog:not\(\[open\]\)\s*\{\s*display:\s*none\s*!important/);
});

test("sidebar separates projects, content types, and on-demand attribute filters", () => {
  const sidebar = html.slice(html.indexOf('<aside id="filter-sidebar"'), html.indexOf('</aside>'));
  assert.match(sidebar, /class="workspace-navigation"/);
  assert.match(sidebar, /id="project-section"/);
  assert.match(sidebar, /id="content-filters"/);
  assert.match(sidebar, /id="facet-filters"/);
  assert.match(sidebar, /data-i18n="属性筛选"/);
  assert.doesNotMatch(source.slice(source.indexOf("function renderContentFilters"), source.indexOf("function renderFacetFilters")), /All types|\"全部\"/);
  assert.doesNotMatch(source.slice(source.indexOf("function renderFacetFilters"), source.indexOf("function createFacetFilterButton")), /name:\s*currentLocale\(\) === "en" \? "All"/);
});

test("desktop sidebar width is adjustable and persists as a bounded UI preference", async () => {
  const css = await readFile(new URL("../library.css", import.meta.url), "utf8");
  assert.match(html, /id="sidebar-resizer"[^>]*role="separator"[^>]*tabindex="0"/);
  assert.match(css, /grid-template-columns: var\(--sidebar-width, 244px\) 6px minmax\(0, 1fr\)/);
  assert.match(css, /@media \(max-width: 900px\)[\s\S]*?\.sidebar-resizer \{ display: none; \}/);
  assert.match(source, /event\.key === "ArrowRight" \? 16 : -16/);
  assert.match(source, /updateUiPreferences\(\{ \.\.\.uiPreferences, sidebarWidth \}\)/);
  assert.match(source, /Math\.floor\(innerWidth \* 0\.45\)/);
});

test("share and combine are contextual actions after entering selection mode", () => {
  const selection = html.slice(html.indexOf('id="gallery-heading"'), html.indexOf('<p id="feedback"'));
  assert.match(selection, /id="selection-add-project"/);
  assert.match(selection, /id="selection-new-project"/);
  assert.match(selection, /id="selection-combine"/);
  assert.match(selection, /id="selection-analyze"/);
  assert.match(selection, /id="share-export"/);
});

test("global filter clearing lives in the fixed sidebar tools instead of a document-flow filter bar", () => {
  const sidebar = html.slice(html.indexOf('<aside id="filter-sidebar"'), html.indexOf('</aside>'));
  assert.doesNotMatch(html, /id="active-filter-bar"|id="active-filters"/);
  assert.match(sidebar, /id="clear-filters"/);
  assert.match(sidebar, /id="active-filter-badge"/);
  assert.match(sidebar, /清除全部筛选/);
  assert.match(sidebar, /id="clear-filters"[^>]*disabled/);
  assert.match(source, /elements\.clearFilters\.disabled = activeFilterCount === 0/);
  assert.match(source, /toggleFilters\.dataset\.filterCount/);
});

test("classification manager keeps taxonomy work while settings owns AI services", () => {
  const manager = html.slice(html.indexOf('<dialog id="manager-dialog"'), html.indexOf('</dialog>', html.indexOf('<dialog id="manager-dialog"')));
  const settings = html.slice(html.indexOf('<dialog id="settings-dialog"'), html.indexOf('</dialog>', html.indexOf('<dialog id="settings-dialog"')));
  assert.match(manager, /data-manager-tab="pending"/);
  assert.match(manager, /data-manager-tab="content-types"/);
  assert.match(manager, /data-manager-tab="vocabulary"/);
  assert.doesNotMatch(manager, /data-manager-tab="batch"|data-manager-tab="analysis-settings"/);
  assert.match(settings, /data-settings-tab="general"/);
  assert.match(settings, /data-settings-tab="ai"/);
  assert.match(settings, /data-settings-tab="tasks"/);
  assert.match(settings, /data-settings-panel="tasks"/);
  assert.match(settings, /id="preview-analysis-batch"/);
  assert.match(settings, /id="preview-reanalyze"/);
  assert.match(settings, /id="ai-settings-form"/);
  assert.match(settings, /id="vision-settings-form"/);
  assert.match(settings, /id="composer-settings-form"/);
  assert.doesNotMatch(settings, /id="deepseek-api-key"|id="text-ai-provider"|id="vision-provider"|id="vision-compatible-endpoint"/);
});

test("collector opens a new library tab and disables the side panel for that tab", async () => {
  const collector = await readFile(new URL("../collector.js", import.meta.url), "utf8");
  assert.match(collector, /chrome\.tabs\.create\(\{\s*url:\s*chrome\.runtime\.getURL\("library\.html"\),\s*active:\s*false\s*\}\)/);
  assert.match(collector, /chrome\.sidePanel\?\.setOptions\?\.\(\{\s*tabId:\s*tab\.id,\s*enabled:\s*false\s*\}\)/);
  assert.match(collector, /chrome\.tabs\.update\(tab\.id,\s*\{\s*active:\s*true\s*\}\)/);
  assert.doesNotMatch(collector, /location\.assign\(chrome\.runtime\.getURL\("library\.html"\)\)/);
});

test("Skill details keep creation primary and place refine and export in one More menu", async () => {
  const [skillsHtml, skillsSource] = await Promise.all([
    readFile(new URL("../skills.html", import.meta.url), "utf8"),
    readFile(new URL("../skills-page.js", import.meta.url), "utf8")
  ]);
  assert.match(skillsHtml, /id="skill-detail-more"/);
  assert.match(skillsHtml, /id="skill-export"/);
  assert.match(skillsSource, /function exportSkill/);
  assert.match(skillsSource, /exportGeneratedSkillPackage/);
  assert.match(skillsSource, /elements\.skillSearch\.hidden = !listView/);
  assert.match(skillsSource, /elements\.skillImport\.hidden = !listView/);
  assert.match(skillsSource, /elements\.skillCreate\.hidden = !listView/);
  assert.match(skillsHtml, /id="skill-test"/);
  assert.match(skillsHtml, /id="skill-detail-edit"/);
  assert.match(skillsHtml, /id="skill-detail-refine"/);
  assert.doesNotMatch(skillsHtml, /PORTABLE CREATIVE METHODS|CREATIVE SKILL|IMPORT SKILL|VERSIONS/);
});
