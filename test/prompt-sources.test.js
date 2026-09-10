import test from "node:test";
import assert from "node:assert/strict";
import { detailPromptSources } from "../extension/prompt-sources.js";
import { setEntryMediaPrompt } from "../extension/media.js";

test("article body never becomes an image prompt; actual per-media prompts remain available", () => {
  const asset = { id: "image", kind: "image" };
  const entry = { text: "正文只显示一次", sourceFacts: { pageType: "article" }, articleDocument: { blocks: [{ kind: "paragraph", text: "正文只显示一次" }] } };
  assert.equal(detailPromptSources(entry, asset).original, "");
  entry.mediaPrompts = [{ assetId: "image", source: "manual", text: "配图实际提示词" }];
  assert.equal(detailPromptSources(entry, asset).original, "配图实际提示词");
});

test("adding and editing an original beside adopted AI preserves both sources", () => {
  const asset = { id: "image", kind: "image", usage: "content" };
  const entry = { text: "共享", mediaAssets: [asset], mediaPrompts: [{ assetId: asset.id, source: "ai-suggestion", text: "AI 人工修订" }] };
  const added = setEntryMediaPrompt(entry, asset.id, "独立原始", "manual", { preserveOtherSource: true });
  assert.equal(detailPromptSources(added, asset).ai, "AI 人工修订");
  assert.equal(detailPromptSources(added, asset).original, "独立原始");
  const edited = setEntryMediaPrompt(added, asset.id, "再次修订 AI", "ai-suggestion", { preserveOtherSource: true });
  assert.equal(detailPromptSources(edited, asset).ai, "再次修订 AI");
  assert.equal(detailPromptSources(edited, asset).original, "独立原始");
  const cleared = setEntryMediaPrompt(edited, asset.id, "", "manual", { preserveOtherSource: true });
  assert.equal(detailPromptSources(cleared, asset).original, "共享");
  assert.equal(detailPromptSources(cleared, asset).ai, "再次修订 AI");
});

test("video-specific original editing preserves shared text and the other media", () => {
  const asset = { id: "video", kind: "video", usage: "content" };
  const entry = { text: "案例原始", mediaAssets: [asset, { id: "other", kind: "image", usage: "content" }],
    mediaPrompts: [{ assetId: "video", source: "manual", text: "视频原始" }, { assetId: "other", source: "manual", text: "其他图片" }] };
  assert.equal(detailPromptSources(entry, asset).originalAssetId, asset.id);
  const edited = setEntryMediaPrompt(entry, asset.id, "修订视频原始");
  assert.equal(detailPromptSources(edited, asset).original, "修订视频原始");
  assert.equal(edited.text, "案例原始");
  assert.equal(edited.mediaPrompts.find(item => item.assetId === "other").text, "其他图片");
  assert.equal(entry.mediaPrompts[0].text, "视频原始");
});

for (const kind of ["image", "video"]) for (const original of ["", "原始内容"]) for (const ai of ["", "AI 内容"]) {
  test(`${kind}: original=${Boolean(original)}, AI=${Boolean(ai)} remain independent`, () => {
    const asset = { id: "asset", kind, usage: "content", contentHash: "hash", visionAnalysis: { version: 2, imageFingerprint: "hash", reconstructionPrompt: ai } };
    const entry = { text: original, mediaAssets: [asset], videoAnalyses: [{ id: "record", assetId: "asset", mode: "visual-reconstruction",
      reconstructionPrompt: ai, requestId: "fixture", contractVersion: "fixture", analysisScope: "visual", includeTags: false, tags: [], uncertainties: [], finishReason: "stop" }] };
    const before = structuredClone(entry);
    const result = detailPromptSources(entry, asset);
    assert.equal(result.original, original);
    assert.equal(result.ai, ai);
    assert.deepEqual(entry, before);
  });
}

test("per-image manual text outranks shared text but adopted AI is never relabeled as original", () => {
  const asset = { id: "image", kind: "image", usage: "content" };
  const entry = { text: "共享", mediaAssets: [asset], mediaPrompts: [{ assetId: "image", source: "manual", text: "逐图" }] };
  assert.equal(detailPromptSources(entry, asset).original, "逐图");
  entry.mediaPrompts[0].source = "ai-suggestion";
  assert.equal(detailPromptSources(entry, asset).original, "共享");
  assert.equal(detailPromptSources(entry, asset).ai, "逐图");
  assert.equal(detailPromptSources(entry, asset).aiSource, "media-prompt");
});
