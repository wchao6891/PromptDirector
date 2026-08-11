import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("the library exposes one search surface instead of a second sidebar tag search", async () => {
  const [html, script, styles] = await Promise.all([
    readFile(new URL("../library.html", import.meta.url), "utf8"),
    readFile(new URL("../library.js", import.meta.url), "utf8"),
    readFile(new URL("../library.css", import.meta.url), "utf8")
  ]);

  assert.equal((html.match(/id="search-input"/g) ?? []).length, 1);
  assert.doesNotMatch(html, /id="search-help"/);
  assert.doesNotMatch(html, /id="tag-search"/);
  assert.doesNotMatch(script, /tagSearch|tag-search/);
  assert.doesNotMatch(script, /searchInput\.addEventListener\("input",\s*renderGallery\)/);
  assert.match(script, /compositionstart/);
  assert.match(script, /requestAnimationFrame/);
  assert.doesNotMatch(styles, /\.tag-search/);
  assert.doesNotMatch(styles, /\.search-help/);
});
