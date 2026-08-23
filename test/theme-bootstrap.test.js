import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const bootstrap = await readFile(new URL("../theme-bootstrap.js", import.meta.url), "utf8");
const uiRuntime = await readFile(new URL("../i18n.js", import.meta.url), "utf8");

const pages = [
  "library.html",
  "curated.html",
  "curated-skills.html",
  "composer.html",
  "skills.html",
  "collector.html"
];

test("theme bootstrap resolves a real first-paint background and color scheme before CSS", () => {
  assert.match(bootstrap, /matchMedia\("\(prefers-color-scheme: dark\)"\)/);
  assert.match(bootstrap, /dataset\.theme/);
  assert.match(bootstrap, /dataset\.resolvedTheme/);
  assert.match(bootstrap, /style\.backgroundColor\s*=/);
  assert.match(bootstrap, /style\.colorScheme\s*=/);
  assert.match(bootstrap, /document\.addEventListener\("DOMContentLoaded"/);
  assert.match(bootstrap, /root\.dataset\.theme !== theme/);
  assert.match(bootstrap, /: "dark"/);
  assert.match(bootstrap, /"#0f1113"/);
  assert.match(bootstrap, /storedMotion === "none"[\s\S]*?"reduced"/);
});

test("ui initialization replaces provisional first-paint colors with live semantic theme roles", () => {
  assert.match(uiRuntime, /document\.documentElement\.style\.backgroundColor = "var\(--ui-browser\)"/);
  assert.match(uiRuntime, /document\.body\.style\.backgroundColor = "var\(--ui-page\)"/);
  assert.match(uiRuntime, /document\.body\.style\.color = "var\(--ui-text\)"/);
  assert.match(uiRuntime, /dataset\.resolvedTheme = preferences\.theme/);
});

test("every first-party shell loads bootstrap, shared foundation, then page styles", async () => {
  for (const page of pages) {
    const html = await readFile(new URL(`../${page}`, import.meta.url), "utf8");
    const bootstrapIndex = html.indexOf('<script src="theme-bootstrap.js"></script>');
    const foundationIndex = html.indexOf('<link rel="stylesheet" href="ui-foundation.css" />');
    const stylesheetIndex = html.indexOf('<link rel="stylesheet"', foundationIndex + 1);
    assert.ok(bootstrapIndex >= 0, `${page} 缺少 theme bootstrap`);
    assert.ok(foundationIndex > bootstrapIndex, `${page} 应在 bootstrap 后加载共享视觉基础`);
    assert.ok(stylesheetIndex > foundationIndex, `${page} 应在共享视觉基础后加载页面样式`);
  }
});
