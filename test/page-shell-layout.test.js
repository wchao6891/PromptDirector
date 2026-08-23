import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const libraryCss = await readFile(new URL("../library.css", import.meta.url), "utf8");
const skillsCss = await readFile(new URL("../skills-page.css", import.meta.url), "utf8");

function rule(source, selector) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return source.match(new RegExp(`(?:^|\\n)\\s*${escaped}\\s*\\{([^}]+)\\}`))?.[1] ?? "";
}

test("project filters keep a stable heading and project selection mode closes its top gap", () => {
  assert.doesNotMatch(libraryCss, /sidebar-filter-tools|active-filter-badge/);
  assert.doesNotMatch(libraryCss, /\.filter-heading #clear-filters/);
  assert.match(libraryCss, /\.filter-heading #create-collection[^}]*display:\s*inline-flex/);
  const selectionRule = rule(libraryCss, ".gallery-heading.project-selection-mode");
  assert.match(selectionRule, /top:\s*64px/);
  assert.match(selectionRule, /margin-top:\s*-8px/);
});

test("skill page action triggers share an aligned height and the top action row centers them", () => {
  assert.match(rule(skillsCss, ".skills-top-actions"), /align-items:\s*center/);
  assert.match(skillsCss, /\.skills-top-actions > button,\s*\.skill-detail-actions button\s*\{[^}]*min-height:\s*36px/);
  assert.match(rule(skillsCss, ".skill-detail-actions"), /align-items:\s*center/);
});
