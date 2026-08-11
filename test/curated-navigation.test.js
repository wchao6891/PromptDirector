import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("curated cases use same-tab navigation and return without creating duplicate tabs", async () => {
  const library = await readFile(new URL("../library.js", import.meta.url), "utf8");
  const curated = await readFile(new URL("../curated-page.js", import.meta.url), "utf8");
  const html = await readFile(new URL("../curated.html", import.meta.url), "utf8");

  assert.match(library, /navigateWithinPromptDirector\("curated\.html"\)/);
  const promptDirectorNavigation = library.slice(
    library.indexOf("elements.openCurated"),
    library.indexOf("chrome.runtime.onMessage.addListener")
  );
  assert.doesNotMatch(promptDirectorNavigation, /chrome\.tabs\.create|openerTabId/);
  assert.match(html, /<button id="return-library"/);
  assert.doesNotMatch(html, /id="back-to-themes"/);
  assert.doesNotMatch(html, /href="library\.html"/);
  assert.match(curated, /activeThemeId \? backToThemes\(\) : returnToLibrary\(\)/);
  assert.match(curated, /activeThemeId \? "返回主题" : "返回我的案例库"/);

  const returnFlow = curated.slice(
    curated.indexOf("function returnToLibrary"),
    curated.indexOf("async function refreshCatalog")
  );
  assert.match(returnFlow, /location\.assign\(chrome\.runtime\.getURL\("library\.html"\)\)/);
  assert.doesNotMatch(returnFlow, /chrome\.tabs\.(?:create|update|remove)|openerTabId/);
});

test("curated discovery loads theme cards before any package and supports theme or single saves", async () => {
  const curated = await readFile(new URL("../curated-page.js", import.meta.url), "utf8");
  const background = await readFile(new URL("../background.js", import.meta.url), "utf8");
  const html = await readFile(new URL("../curated.html", import.meta.url), "utf8");
  const css = await readFile(new URL("../curated.css", import.meta.url), "utf8");
  const foundation = await readFile(new URL("../ui-foundation.css", import.meta.url), "utf8");
  const detail = curated.slice(curated.indexOf("function renderDetail"), curated.indexOf("async function saveCuratedCase"));

  const refreshFlow = curated.slice(curated.indexOf("async function refreshCatalog"), curated.indexOf("async function loadCachedCatalog"));
  assert.doesNotMatch(refreshFlow, /fetchCuratedPackage|loadThemePackage/);
  assert.doesNotMatch(curated, /loadCatalogPackages/);
  assert.match(curated, /catalog\.themes/);
  assert.match(curated, /async function openTheme/);
  assert.match(curated, /async function loadThemePackage/);
  assert.match(curated, /async function saveTheme/);
  assert.match(curated, /prepareCuratedEntriesPackage/);
  assert.match(curated, /createStableMasonry\(elements\.curatedGrid/);
  assert.match(curated, /prepareCuratedEntryPackage\(record\.library, record\.entry\.id\)/);
  assert.match(curated, /preserveLibraryConfiguration:\s*true/);
  assert.match(background, /previewLibraryImport\(await readState\(\), message\.library, \{[\s\S]*preserveLibraryConfiguration/);
  assert.match(background, /preserveLibraryConfiguration:\s*message\.preserveLibraryConfiguration === true/);
  assert.match(curated, /function openDetail/);
  assert.match(curated, /document\.documentElement\.classList\.add\("detail-open"\)/);
  assert.match(curated, /event\.key === "ArrowLeft"/);
  assert.match(curated, /event\.key === "ArrowRight"/);
  assert.match(curated, /className = "case-image-wrap case-image-wrap-fixed"/);
  assert.match(curated, /className = "case-shot"/);
  assert.match(curated, /caseImageObserver\.observe\(image\)/);
  assert.match(curated, /renderedCount \+ PAGE_SIZE/);
  assert.match(detail, /metadata\.append\(textElement\("span", "", sourceRightsLabel\(record\.entry\)\)\)/);
  assert.doesNotMatch(detail, /查看原始来源|detail-source|record\.item\.title/);
  assert.doesNotMatch(html, /id="curated-search"|id="refresh-catalog"/);
  assert.match(html, /id="retry-catalog"[^>]*hidden/);
  assert.match(html, /id="active-theme-count"/);
  assert.match(html, /id="theme-grid"/);
  assert.match(html, /id="themes-view"/);
  assert.match(html, /id="cases-view"/);
  assert.match(html, /id="save-theme"/);
  assert.match(html, /class="theme-save-summary"/);
  assert.match(html, /id="detail-drawer"/);
  assert.match(html, /id="detail-drawer"[^>]*role="dialog"[^>]*aria-modal="true"/);
  assert.match(html, /选择一期主题，再浏览或保存其中的案例/);
  assert.doesNotMatch(curated, /installCuratedItem|安装到我的案例库/);
  assert.doesNotMatch(html, /id="curated-filter"/);
  assert.match(css, /\.curated-grid\s*\{[^}]*position:\s*relative/);
  assert.match(css, /\.theme-grid\s*\{[^}]*grid-template-columns/);
  assert.match(css, /\.case-image-wrap-fixed \.case-shot\s*\{[^}]*object-fit:\s*cover/);
  assert.match(css, /\.detail-drawer\s*\{[^}]*width:\s*100vw;[^}]*height:\s*100dvh/);
  assert.match(css, /\.detail-content\s*\{[^}]*grid-template-columns:\s*minmax\(0, 1fr\) var\(--detail-panel-width\)/);
  assert.match(css, /\.detail-figure\s*\{[^}]*height:\s*100dvh/);
  assert.match(css, /\.detail-figure\s*\{[^}]*background:\s*var\(--viewer-bg\)/);
  assert.match(css, /\.detail-body\s*\{[^}]*background:\s*var\(--card\)/);
  assert.match(foundation, /:root\[data-theme="dark"\][\s\S]*--viewer-bg:\s*var\(--ui-browser\)/);
  assert.match(foundation, /:root\[data-theme="system"\][\s\S]*--viewer-bg:\s*var\(--ui-browser\)/);
  assert.match(css, /@media \(max-width: 700px\)[\s\S]*--masonry-card-min-width:\s*145px/);
  assert.match(css, /@media \(max-width: 700px\)[\s\S]*\.detail-figure\s*\{[^}]*height:\s*58dvh/);
});

test("curated catalog refreshes on entry and exposes retry only for permission or failure", async () => {
  const curated = await readFile(new URL("../curated-page.js", import.meta.url), "utf8");
  const startup = curated.slice(curated.indexOf("await loadLocalState()"), curated.indexOf("function returnToLibrary"));
  const refresh = curated.slice(curated.indexOf("async function refreshCatalog"), curated.indexOf("async function loadCachedCatalog"));
  assert.match(startup, /hasCatalogPermission\(\).*refreshCatalog\(false\)/s);
  assert.match(startup, /showStatus\([^\n]+true, true\)/);
  assert.match(refresh, /elements\.retryCatalog\.hidden = true/);
  assert.match(refresh, /showStatus\([^\n]+true, true\)/);
  assert.doesNotMatch(curated, /addEventListener\("input", renderCases\)/);
});

test("curated and local single-case details reuse the existing composer reference route", async () => {
  const curated = await readFile(new URL("../curated-page.js", import.meta.url), "utf8");
  const library = await readFile(new URL("../library.js", import.meta.url), "utf8");

  assert.match(curated, /url\.searchParams\.set\("references", savedEntry\.id\)/);
  assert.match(curated, /location\.assign\(url\.href\)/);
  assert.doesNotMatch(curated.slice(curated.indexOf("async function openComposerForRecord"), curated.indexOf("function updateThemeSaveUi")), /chrome\.tabs\.create/);
  assert.match(curated, /await saveCuratedCase\(record/);
  assert.match(library, /url\.searchParams\.set\("references", entry\.id\)/);
  assert.match(library, /isComposerEligibleEntry/);
});
