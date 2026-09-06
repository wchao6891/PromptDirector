import test from "node:test";
import assert from "node:assert/strict";
import { updateArticleText } from "../article-edit.js";
import { articleDocumentText, normalizeArticleDocument } from "../article-document.js";

const entry = () => {
  const articleDocument = normalizeArticleDocument({ blocks: [
    { id: "head", kind: "heading", text: "标题", level: 2 },
    { id: "text", kind: "paragraph", text: "正文" },
    { id: "image", kind: "image", assetId: "original", sourceUrl: "https://example.com/original.png" },
    { id: "code", kind: "code", text: "if (ready) {\n  save();\n}" },
    { id: "skill", kind: "document", assetId: "skill", sourceUrl: "https://example.com/skill.md" }
  ] });
  return { id: "entry", text: articleDocumentText(articleDocument), textRevision: 1, articleDocument,
    customLabels: ["保留"], mediaPrompts: [{ assetId: "original", text: "独立提示词" }] };
};

test("article edits update displayed body and search text without moving originals or skills", () => {
  const current = entry();
  const updated = updateArticleText(current, [{ blockId: "text", text: "真实正文修订" }, { blockId: "code", text: "if (ready) {\n    preserve();\n}" }], 1);
  assert.match(updated.text, /真实正文修订/);
  assert.match(updated.text, /\n    preserve/);
  assert.equal(updated.textRevision, 2);
  assert.deepEqual(updated.articleDocument.blocks.map(block => block.id), current.articleDocument.blocks.map(block => block.id));
  assert.deepEqual(updated.articleDocument.blocks[2], current.articleDocument.blocks[2]);
  assert.deepEqual(updated.articleDocument.blocks[4], current.articleDocument.blocks[4]);
  assert.deepEqual(updated.mediaPrompts, current.mediaPrompts);
  assert.deepEqual(updated.customLabels, current.customLabels);
  assert.equal(current.articleDocument.blocks[1].text, "正文");
});

test("article saves reject stale drafts and cannot replace resource blocks", () => {
  assert.throws(() => updateArticleText(entry(), [], 0), /正文已发生变化/);
  assert.throws(() => updateArticleText(entry(), [{ blockId: "image", text: "replace" }], 1), /无效段落/);
  assert.throws(() => updateArticleText(entry(), [{ blockId: "text", text: "a" }, { blockId: "text", text: "b" }], 1), /无效段落/);
  assert.deepEqual(updateArticleText(entry(), [], 1), entry());
});
