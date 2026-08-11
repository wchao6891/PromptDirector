import test from "node:test";
import assert from "node:assert/strict";
import { normalizeEntryMedia, removeEntryMedia, setEntryMediaPrompt } from "../media.js";

const entry = {
  id: "case-1",
  text: "共享提示词",
  mediaAssets: [
    { id: "image-1", kind: "image", mimeType: "image/png" },
    { id: "image-2", kind: "image", mimeType: "image/png" }
  ]
};

test("an image prompt is an explicit override and never guessed from shared prompt paragraphs", () => {
  const updated = setEntryMediaPrompt(entry, "image-2", "第二张图片提示词");
  assert.equal(updated.text, "共享提示词");
  assert.deepEqual(updated.mediaPrompts.map(({ assetId, text, source }) => ({ assetId, text, source })), [
    { assetId: "image-2", text: "第二张图片提示词", source: "manual" }
  ]);
});

test("deleting media removes only its matching prompt override", () => {
  const withPrompts = normalizeEntryMedia({ ...entry, mediaPrompts: [
    { assetId: "image-1", text: "一" },
    { assetId: "image-2", text: "二" }
  ] });
  const updated = removeEntryMedia(withPrompts, "image-2");
  assert.deepEqual(updated.mediaPrompts.map((item) => item.assetId), ["image-1"]);
});

test("AI prompt suggestions stay identifiable and do not replace the shared prompt", () => {
  const updated = setEntryMediaPrompt(entry, "image-1", "一张可编辑的逐图建议", "ai-suggestion");
  assert.equal(updated.text, "共享提示词");
  assert.deepEqual(updated.mediaPrompts.map(({ assetId, text, source }) => ({ assetId, text, source })), [
    { assetId: "image-1", text: "一张可编辑的逐图建议", source: "ai-suggestion" }
  ]);
});
