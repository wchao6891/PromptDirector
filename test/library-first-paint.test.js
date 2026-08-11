import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const [html, source, styles] = await Promise.all([
  readFile(new URL("../library.html", import.meta.url), "utf8"),
  readFile(new URL("../library.js", import.meta.url), "utf8"),
  readFile(new URL("../library.css", import.meta.url), "utf8")
]);

test("first paint shows one stable loading shell without fake library counts", () => {
  assert.match(html, /<body[^>]*data-library-state="loading"/);
  assert.match(html, /id="library-loading"[\s\S]*正在打开资料库/);
  assert.doesNotMatch(html, /正在读取本地案例/);
  assert.doesNotMatch(html, /id="result-count">0 个案例/);
  assert.doesNotMatch(html, /id="pending-count">0</);
  assert.match(styles, /body\[data-library-state="loading"\][\s\S]*\.library-loading/);
});

test("core cases render before PDF derived cache and the cache cannot trigger a full gallery refresh", () => {
  const refresh = source.slice(source.indexOf("async function refreshLibrary"), source.indexOf("async function loadDocumentDerivedCache"));
  assert.ok(refresh.indexOf("renderGallery();") < refresh.indexOf("loadDocumentDerivedCache(entries)"));
  assert.doesNotMatch(refresh, /await loadDocumentDerivedCache\(entries\)/);
  assert.match(refresh, /dataset\.libraryState/);

  const derived = source.slice(source.indexOf("async function loadDocumentDerivedCache"), source.indexOf("function renderGallery"));
  assert.doesNotMatch(derived, /renderGallery\(/);
});

test("tablet and phone headers have explicit safe layouts", () => {
  assert.match(styles, /@media \(max-width: 900px\)[\s\S]*\.topbar\s*\{[^}]*grid-template-areas/);
  assert.match(styles, /@media \(max-width: 640px\)[\s\S]*\.topbar\s*\{[^}]*grid-template-areas/);
  assert.match(styles, /@media \(max-width: 640px\)[\s\S]*padding:\s*10px 12px/);
});
