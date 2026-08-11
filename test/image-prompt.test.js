import test from "node:test";
import assert from "node:assert/strict";

import {
  promptForEntryImage,
  validReconstructionPrompt,
  visualAnalysisPromptReplacement
} from "../image-prompt.js";

const fingerprint = "a".repeat(64);

function imageAsset(overrides = {}) {
  return {
    id: "image-a",
    kind: "image",
    usage: "content",
    contentHash: fingerprint,
    visionAnalysis: {
      version: 2,
      imageFingerprint: fingerprint,
      reconstructionPrompt: "V2 完整重建提示词",
      ...overrides
    }
  };
}

test("image-only cases expose their V2 reconstruction as the single prompt", () => {
  const entry = { text: "", mediaAssets: [imageAsset()], primaryMediaId: "image-a" };
  assert.equal(promptForEntryImage(entry, "image-a"), "V2 完整重建提示词");
});

test("captured, imported, and manually edited prompts remain authoritative", () => {
  const asset = imageAsset();
  assert.equal(promptForEntryImage({ text: "采集进入的案例提示词", mediaAssets: [asset] }, asset.id), "采集进入的案例提示词");
  assert.equal(promptForEntryImage({
    text: "案例提示词",
    mediaAssets: [asset],
    mediaPrompts: [{ assetId: asset.id, text: "用户逐图提示词", source: "manual" }]
  }, asset.id), "用户逐图提示词");
});

test("an old AI analysis prompt stays visible until the user confirms its V2 replacement", () => {
  const asset = imageAsset();
  const entry = {
    text: "",
    mediaAssets: [asset],
    mediaPrompts: [{ assetId: asset.id, text: "旧版简短分析提示词", source: "ai-suggestion" }]
  };
  assert.equal(promptForEntryImage(entry, asset.id), "旧版简短分析提示词");
  assert.deepEqual(visualAnalysisPromptReplacement(entry, asset.id), {
    assetId: asset.id,
    text: "V2 完整重建提示词",
    previousText: "旧版简短分析提示词"
  });
  assert.equal(visualAnalysisPromptReplacement({
    ...entry,
    mediaPrompts: [{ assetId: asset.id, text: "用户逐图提示词", source: "manual" }]
  }, asset.id), null);
});

test("an invalidated or fingerprint-mismatched analysis cannot replace a prompt", () => {
  assert.equal(validReconstructionPrompt(imageAsset({ invalidated: true })), "");
  assert.equal(validReconstructionPrompt({
    ...imageAsset(),
    contentHash: "c".repeat(64)
  }), "");
});
