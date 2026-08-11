import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const foundation = await readFile(new URL("../ui-foundation.css", import.meta.url), "utf8");
const sprite = await readFile(new URL("../assets/ui-icons.svg", import.meta.url), "utf8");

test("shared visual foundation owns the locked dark theme and control scale", () => {
  assert.match(foundation, /--ui-browser:\s*#0f1113/);
  assert.match(foundation, /--ui-page:\s*#131416/);
  assert.match(foundation, /--ui-surface:\s*#1c1e21/);
  assert.match(foundation, /--ui-raised:\s*#23262a/);
  assert.match(foundation, /--ui-hover:\s*#2a2d32/);
  assert.match(foundation, /--ui-muted:\s*#828282/);
  assert.match(foundation, /--ui-accent:\s*#d1fe17/);
  assert.match(foundation, /--ui-control-height:\s*36px/);
  assert.match(foundation, /--ui-compact-height:\s*30px/);
  assert.match(foundation, /--ui-control-radius:\s*4px/);
  assert.match(foundation, /--ui-container-radius:\s*6px/);
});

test("page styles keep domain layout without redefining shared theme roles", async () => {
  for (const pageStyle of ["library.css", "curated.css", "collector.css", "skills-page.css", "composer-page.css"]) {
    const source = await readFile(new URL(`../${pageStyle}`, import.meta.url), "utf8");
    assert.doesNotMatch(source, /--paper:\s*#/i, `${pageStyle} 不应重新定义页面主题色`);
    assert.doesNotMatch(source, /--accent:\s*#/i, `${pageStyle} 不应重新定义品牌色`);
    assert.doesNotMatch(source, /(?:^|\n)button\s*\{/i, `${pageStyle} 不应重新定义通用按钮`);
  }
});

test("local Lucide sprite contains the shared navigation and action icons", () => {
  assert.match(sprite, /lucide-static/);
  for (const name of ["arrow-left", "chevron-left", "chevron-right", "check", "menu", "settings", "x"]) {
    assert.match(sprite, new RegExp(`id="icon-${name}"`));
  }
});
