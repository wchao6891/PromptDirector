import test from "node:test";
import assert from "node:assert/strict";

import {
  articleDocumentText,
  articleBlockIsMarkdown,
  finalizeArticleDocumentAssets,
  normalizeArticleDocument,
  removeArticleDocumentAsset,
  remapArticleDocumentAssets
} from "../extension/article-document.js";

test("Markdown body retains code indentation and hard breaks instead of paragraph cleanup", () => {
  const text = "# 方法\n\n段落  \n换行\n\n```js\n  const x = 1;\n    run(x);\n```";
  const document = normalizeArticleDocument({ blocks: [{ id: "body", kind: "paragraph", mimeType: "text/markdown", text }] });
  assert.equal(document.blocks[0].text, text);
  assert.equal(articleDocumentText(document), text);
  assert.equal(articleBlockIsMarkdown(document.blocks[0]), true);
});

test("existing Agent Markdown bodies are recognized without treating arbitrary prose as Markdown", () => {
  const block = { id: "body", kind: "paragraph", text: "## 标题" };
  const entry = { agentProvenance: { kind: "creation" }, primaryMediaId: "md", mediaAssets: [
    { id: "md", kind: "document", mimeType: "text/markdown" }
  ], articleDocument: { blocks: [block, { id: "file", kind: "document", assetId: "md" }] } };
  assert.equal(articleBlockIsMarkdown(block, entry), true);
  assert.equal(articleBlockIsMarkdown(block), false);
  assert.equal(articleBlockIsMarkdown({ ...block, mimeType: "text/plain" }, entry), false);
  assert.equal(articleBlockIsMarkdown(block, { ...entry, agentProvenance: undefined }), false);
  assert.equal(articleBlockIsMarkdown(block, { ...entry, primaryMediaId: "other" }), false);
  assert.equal(articleBlockIsMarkdown(block, { ...entry, articleDocument: { blocks: [block, { kind: "paragraph", text: "other" }] } }), false);
});

test("article documents preserve readable block order while discarding invalid blocks", () => {
  const document = normalizeArticleDocument({
    version: 1,
    blocks: [
      { id: "heading", kind: "heading", level: 2, text: "创作过程", sourceOrder: 0 },
      { id: "paragraph", kind: "paragraph", text: "先确定光线，再安排人物。", sourceOrder: 1 },
      { id: "image", kind: "image", assetId: "capture:image", sourceUrl: "https://example.com/full.webp", sourceOrder: 2 },
      { id: "download", kind: "document", assetId: "capture:pdf", sourceUrl: "https://example.com/brief.pdf", label: "下载 Brief", sourceOrder: 3 },
      { id: "empty", kind: "paragraph", text: "", sourceOrder: 4 }
    ]
  });

  assert.deepEqual(document.blocks.map((block) => block.id), ["heading", "paragraph", "image", "download"]);
  assert.equal(articleDocumentText(document), "创作过程\n\n先确定光线，再安排人物。");
});

test("article media references remap on save and disappear when an asset is removed", () => {
  const source = normalizeArticleDocument({
    version: 1,
    blocks: [
      { id: "paragraph", kind: "paragraph", text: "正文", sourceOrder: 0 },
      { id: "image", kind: "image", assetId: "capture:image", sourceUrl: "https://example.com/full.webp", sourceOrder: 1 },
      { id: "video", kind: "video", assetId: "capture:video", sourceUrl: "https://example.com/watch", sourceOrder: 2 }
    ]
  });
  const saved = remapArticleDocumentAssets(source, new Map([
    ["capture:image", "asset:image"],
    ["capture:video", "asset:video"]
  ]));

  assert.deepEqual(saved.blocks.map((block) => block.assetId || ""), ["", "asset:image", "asset:video"]);
  const removed = removeArticleDocumentAsset(saved, "asset:image");
  assert.deepEqual(removed.blocks.map((block) => block.id), ["paragraph", "video"]);
});

test("failed media saves keep their original article link without a stale asset id", () => {
  const finalized = finalizeArticleDocumentAssets({
    version: 1,
    blocks: [
      { id: "image", kind: "image", assetId: "capture:missing", sourceUrl: "https://example.com/missing.webp", sourceOrder: 0 }
    ]
  }, new Map());

  assert.equal(finalized.blocks[0].sourceUrl, "https://example.com/missing.webp");
  assert.equal("assetId" in finalized.blocks[0], false);
});

test("legacy cases can omit an article document", () => {
  assert.equal(normalizeArticleDocument(null), null);
  assert.equal(normalizeArticleDocument({ blocks: [] }), null);
});

test("table cells retain ordered editable blocks across asset remapping and removal", () => {
  const value = { blocks: [
    { id: "table", kind: "table", text: "old flattened text", rows: [[
      { rowspan: 2, colspan: 1, width: 320, blockIds: ["before", "image", "after"] },
      { blockIds: [] }
    ]] },
    { id: "before", kind: "paragraph", text: "Before image" },
    { id: "image", kind: "image", assetId: "capture:image" },
    { id: "after", kind: "paragraph", text: "After image" }
  ] };
  const saved = finalizeArticleDocumentAssets(value, { "capture:image": "saved:image" });
  assert.deepEqual(saved.blocks[0].rows[0][0].blockIds, ["before", "image", "after"]);
  assert.equal(saved.blocks[0].rows[0][0].rowspan, 2);
  assert.equal(saved.blocks[0].rows[0][0].width, 320);
  assert.equal(saved.blocks[2].assetId, "saved:image");
  assert.equal(articleDocumentText(saved), "Before image\nAfter image");
  const removed = removeArticleDocumentAsset(saved, "saved:image");
  assert.deepEqual(removed.blocks[0].rows[0][0].blockIds, ["before", "after"]);
  assert.equal(removed.blocks[0].rows[0].length, 2);
});
