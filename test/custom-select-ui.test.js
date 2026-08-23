import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const [manifest, foundation, sharePreview] = await Promise.all([
  readFile(new URL("../manifest.json", import.meta.url), "utf8"),
  readFile(new URL("../ui-foundation.css", import.meta.url), "utf8"),
  readFile(new URL("../share-preview.js", import.meta.url), "utf8")
]);

test("Chrome 134 customizable selects use the shared PromptDirector surface", () => {
  assert.equal(JSON.parse(manifest).minimum_chrome_version, "134");
  assert.match(foundation, /select,\s*select::picker\(select\)\s*\{\s*appearance: base-select/);
  assert.match(foundation, /select::picker\(select\)[\s\S]*background: var\(--ui-surface\)/);
  assert.match(foundation, /select option:checked[\s\S]*background: var\(--ui-accent-emphasis\)/);
  assert.match(foundation, /select:open::picker-icon/);
  assert.match(sharePreview, /appearance:base-select/);
  assert.match(sharePreview, /select option:checked\{color:var\(--ui-accent-emphasis-contrast\);background:var\(--ui-accent-emphasis\)\}/);
});
