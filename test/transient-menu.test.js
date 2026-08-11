import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const source = await readFile(new URL("../transient-menu.js", import.meta.url), "utf8");
const library = await readFile(new URL("../library.js", import.meta.url), "utf8");
const composer = await readFile(new URL("../composer-page.js", import.meta.url), "utf8");
const html = await readFile(new URL("../library.html", import.meta.url), "utf8");

test("transient menus share outside-click, action, peer-open, and Escape dismissal", () => {
  assert.match(source, /addEventListener\("pointerdown", onPointerDown, true\)/);
  assert.match(source, /addEventListener\("toggle", onToggle, true\)/);
  assert.match(source, /event\.key !== "Escape"/);
  assert.match(source, /closest\("button, a\[href\]"\)/);
  assert.match(source, /!action\.closest\("\.package-preferences"\)/);
  assert.match(library, /bindTransientMenus\(document, "\.package-menu, \.project-menu, \.detail-analysis-menu"\)/);
  assert.match(composer, /bindTransientMenus\(document, "\.composer-options"\)/);
  assert.doesNotMatch(composer, /\.composer-result-more/);
});

test("analysis settings expose only the current interface language", () => {
  assert.doesNotMatch(html, /analysis-locale-tabs/);
  assert.match(library, /activeAnalysisLocale = currentLocale\(\) === "en" \? "en" : "zh-CN"/);
  assert.match(library, /panel\.hidden = panel\.dataset\.analysisLocalePanel !== activeAnalysisLocale/);
});

test("first-level categories have a dedicated default manager page", () => {
  assert.match(html, /data-manager-tab="content-types"[^>]*aria-selected="true"/);
  assert.match(html, /id="manager-content-types"/);
  assert.match(html, /id="content-type-list"/);
  assert.match(html, /id="add-content-type"/);
  assert.match(html, /id="content-type-editor"/);
  assert.match(library, /activeManagerTab = "content-types"/);

  const vocabularyPanel = html.slice(
    html.indexOf('id="manager-vocabulary"'),
    html.indexOf('id="manager-batch"')
  );
  assert.doesNotMatch(vocabularyPanel, /create-content-form|rename-content-form|content-type-list|create-facet-form|rename-facet-form/);
  assert.match(vocabularyPanel, /一级维度固定/);
});
