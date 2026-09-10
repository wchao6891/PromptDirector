import test from "node:test";
import assert from "node:assert/strict";
import { composerSourceText } from "../extension/composer-source-text.js";
import { createReferenceSnapshots } from "../extension/composer.js";
import { CONTENT_IDS } from "../extension/taxonomy.js";

test("case retrieval and selected images respect edited or cleared AI prompts without reviving their historical copy", () => {
  for (const [prompt, expected] of [[undefined, "旧描述"], ["新的用户提示词", "新的用户提示词"], ["", ""]]) {
    const analysis = { version: 2, description: "旧描述", imageFingerprint: "same-image" };
    if (prompt !== undefined) Object.assign(analysis, { reconstructionPrompt: prompt, userEdited: true });
    const entry = {
      id: "case", text: "", primaryMediaId: "image",
      mediaAssets: [{ id: "image", kind: "image", usage: "content", mimeType: "image/png", contentHash: "same-image", visionAnalysis: analysis }]
    };
    assert.equal(composerSourceText(entry), expected);
    const reference = createReferenceSnapshots([entry], ["case"])[0];
    assert.equal(reference.imageRefs.length, 1);
    if (expected) assert.ok(reference.referenceText.includes(expected), reference);
    if (prompt !== undefined) assert.ok(!reference.referenceText.includes("旧描述"), reference);
  }
});

test("cross-media knowledge keeps time-note positions when reused in a compound reference", () => {
  const text = composerSourceText({memberEntries: [{timeNotes: [{startMs: 1200, endMs: 2500, text: "先展示角色轮廓"}]}]});
  assert.equal(text, "[0:01.200-0:02.500] 先展示角色轮廓");
  const frames = composerSourceText({memberEntries: [{
    mediaAssets: [{id: "frame", kind: "image", visionAnalysis: {description: "角色回头"}}],
    timeNotes: [{startMs: 1200, frameAssetId: "frame", text: ""}]
  }]});
  assert.match(frames, /\[0:01\.200\] \n关键帧描述：角色回头/);
});

test("a cleared secondary image never inherits the primary image's AI prompt", () => {
  const entry = {id: "case", primaryMediaId: "primary", classification: {pathIds: [CONTENT_IDS.imageCase]}, mediaAssets: [
    {id: "primary", kind: "image", mimeType: "image/png", visionAnalysis: {version: 2, reconstructionPrompt: "主图旧提示词"}},
    {id: "selected", kind: "image", mimeType: "image/png", visionAnalysis: {version: 2, reconstructionPrompt: "", userEdited: true}}
  ]};
  const reference = createReferenceSnapshots([entry], [{entryId: "case", assetIds: ["selected"]}])[0];
  assert.equal(reference.referenceText, "");
  assert.equal(reference.imageRefs[0].visualId, "selected");
});
