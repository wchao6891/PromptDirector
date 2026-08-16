import test from "node:test";
import assert from "node:assert/strict";

import {
  articleDocumentText,
  finalizeArticleDocumentAssets,
  normalizeArticleDocument,
  removeArticleDocumentAsset,
  remapArticleDocumentAssets
} from "../article-document.js";

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
