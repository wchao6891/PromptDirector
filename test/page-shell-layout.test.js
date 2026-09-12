import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const libraryCss = await readFile(new URL("../extension/library.css", import.meta.url), "utf8");
const skillsCss = await readFile(new URL("../extension/skills-page.css", import.meta.url), "utf8");

function rule(source, selector) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return source.match(new RegExp(`(?:^|\\n)\\s*${escaped}\\s*\\{([^}]+)\\}`))?.[1] ?? "";
}

test("project filters keep a stable heading and every management mode follows the measured topbar", () => {
  assert.doesNotMatch(libraryCss, /sidebar-filter-tools|active-filter-badge/);
  assert.doesNotMatch(libraryCss, /\.filter-heading #clear-filters/);
  assert.match(libraryCss, /\.filter-heading #create-collection[^}]*display:\s*inline-flex/);
  const headingRule = rule(libraryCss, ".gallery-heading");
  assert.match(headingRule, /position:\s*sticky/);
  assert.match(headingRule, /top:\s*var\(--library-topbar-height\)/);
  assert.match(headingRule, /background:\s*var\(--paper\)/);
});

test("skill page action triggers share an aligned height and the top action row centers them", () => {
  assert.match(rule(skillsCss, ".skills-top-actions"), /align-items:\s*center/);
  assert.match(skillsCss, /\.skills-top-actions > button,\s*\.skill-detail-actions button\s*\{[^}]*min-height:\s*36px/);
  assert.match(rule(skillsCss, ".skill-detail-actions"), /align-items:\s*center/);
});
