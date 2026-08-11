import test from "node:test";
import assert from "node:assert/strict";

import {
  CLASSIFIER_VERSION,
  classifyContent,
  classifyImportedMedia,
  classifyImageCase,
  confirmClassification
} from "../classifier.js";
import { CONTENT_IDS, CONTENT_ROLES, createContentType, createDefaultTaxonomy, removeContentType } from "../taxonomy.js";

test("universal prompt-structure teaching stays tutorial", () => {
  const result = classifyContent({
    text: "提示词结构教学：先定义主体，再补充环境、镜头和约束。这个框架适用于不同模型与题材。",
    title: "通用提示词写作方法"
  });

  assert.deepEqual(result.pathIds, [CONTENT_IDS.tutorial]);
  assert.equal(result.status, "confirmed");
  assert.equal(result.source, "auto");
});

test("screenshot-only references use the fixed image-case type", () => {
  const result = classifyImageCase();
  assert.deepEqual(result.pathIds, [CONTENT_IDS.imageCase]);
  assert.equal(result.status, "confirmed");
  assert.equal(result.source, "manual");
});

test("generic classification keeps semantic web content behavior", () => {
  const pdf = classifyContent({
    title: "摄影资料.pdf",
    mediaAssets: [{ id: "pdf", kind: "document", mimeType: "application/pdf" }]
  });
  const note = classifyContent({ text: "下次测试低机位和更克制的色彩。", sourceKind: "quick_note" });
  const tutorial = classifyContent({
    title: "镜头教程.md",
    text: "镜头运动教学：第一步明确视线，第二步选择推镜，最后检查空间连续性。",
    mediaAssets: [{ id: "md", kind: "document", mimeType: "text/markdown" }]
  });

  assert.deepEqual(pdf.pathIds, [CONTENT_IDS.reference]);
  assert.deepEqual(note.pathIds, [CONTENT_IDS.reference]);
  assert.deepEqual(tutorial.pathIds, [CONTENT_IDS.tutorial]);
});

test("local imports use their file shape instead of guessing from the document body", () => {
  const tutorialDocument = classifyImportedMedia({
    title: "镜头教程.md",
    text: "教程：第一步明确视线，第二步选择推镜，最后检查空间连续性。",
    mediaAssets: [{ id: "md", kind: "document", mimeType: "text/markdown", storageMode: "managed" }]
  });
  const image = classifyImportedMedia({
    title: "参考图.png",
    text: "视频提示词教程",
    mediaAssets: [{ id: "image", kind: "image", mimeType: "image/png", storageMode: "managed" }]
  });
  const video = classifyImportedMedia({
    title: "镜头.mov",
    text: "图片提示词教程",
    mediaAssets: [{ id: "video", kind: "video", mimeType: "video/quicktime", storageMode: "managed" }]
  });
  const note = classifyImportedMedia({ text: "教程和提示词备忘", sourceKind: "quick_note" });

  assert.deepEqual(tutorialDocument.pathIds, [CONTENT_IDS.reference]);
  assert.deepEqual(image.pathIds, [CONTENT_IDS.imageCase]);
  assert.deepEqual(video.pathIds, [CONTENT_IDS.videoCase]);
  assert.deepEqual(note.pathIds, [CONTENT_IDS.reference]);
  assert.equal(tutorialDocument.source, "local_import");
});

test("workflow in a title does not turn an explicit image prompt into a tutorial", () => {
  const result = classifyContent({
    text: "Midjourney prompt: product hero image --ar 1:1",
    title: "Image workflow"
  });

  assert.deepEqual(result.pathIds, [CONTENT_IDS.promptImage]);
});

test("a tutorial word in the title cannot override an explicit prompt body", () => {
  const result = classifyContent({
    text: "Midjourney prompt: editorial portrait --ar 4:5",
    title: "A complete tutorial collection"
  });

  assert.deepEqual(result.pathIds, [CONTENT_IDS.promptImage]);
});

test("all universal tutorial media variants stay in the single tutorial type", () => {
  const video = classifyContent({
    text: "视频提示词教学：镜头运动应服务叙事节奏。先确定视线，再选择跟拍或推镜；这个方法适用于不同场景。"
  });
  const image = classifyContent({
    text: "生图教学：画幅决定视觉重心。人物肖像通常先确定构图，再选择光线；这些原则也适用于 Midjourney。"
  });
  const general = classifyContent({
    text: "提示词写作攻略：第一步明确主体，第二步补充限制条件，最后检查表达。"
  });

  assert.deepEqual(video.pathIds, [CONTENT_IDS.tutorial]);
  assert.deepEqual(image.pathIds, [CONTENT_IDS.tutorial]);
  assert.deepEqual(general.pathIds, [CONTENT_IDS.tutorial]);
});

test("a how-to wrapper around a concrete GPT Image prompt remains an image prompt", () => {
  const result = classifyContent({
    title: "How to turn an AI character into a real iPhone photo with GPT Image 2? Prompt below!",
    text: "Transform the person in the reference image into a real person. Create a casual iPhone photo with slight motion blur, imperfect framing, natural skin texture, and evening street light. Keep the same identity and clothes."
  });

  assert.deepEqual(result.pathIds, [CONTENT_IDS.promptImage]);
});

test("a Midjourney style definition is tutorial metadata, not an image prompt", () => {
  const result = classifyContent({
    title: "Epic scale Midjourney style | Style library",
    text: "Epic scale is a visual style used to describe art that conveys grandeur and monumental scope. It is characterized by vast compositions, tiny figures, dramatic perspective, and mythic environments."
  });

  assert.deepEqual(result.pathIds, [CONTENT_IDS.tutorial]);
});

test("a named style-catalog entry is tutorial even when its definition starts with Style colon", () => {
  const result = classifyContent({
    title: "Styles Buoy for an image model",
    text: "Castlevania Concept Art Style: A dark gothic fantasy concept-art style rendered with painterly linework, moody color, atmospheric fog, and dramatic vertical perspective."
  });

  assert.deepEqual(result.pathIds, [CONTENT_IDS.tutorial]);
});

test("a style-catalog URL cannot override a concrete prompt body", () => {
  const result = classifyContent({
    title: "Midjourney prompt",
    url: "https://example.com/styles/editorial-portrait",
    text: "Create an editorial portrait with hard side light, restrained color, visible skin texture, and a quiet studio background --ar 4:5"
  });

  assert.deepEqual(result.pathIds, [CONTENT_IDS.promptImage]);
});

test("a concrete Seedance generation specification remains a video prompt", () => {
  const result = classifyContent({
    title: "Seedance 2.0 prompt share",
    text: "Use the attached character sheet as the exact identity anchor. A single continuous handheld shot follows her through the market, then circles behind her as she runs. Wind moves her coat and the camera pulls back for the final reveal."
  });

  assert.deepEqual(result.pathIds, [CONTENT_IDS.promptVideo]);
});

test("a Style field inside a concrete video specification is not mistaken for a style tutorial", () => {
  const result = classifyContent({
    title: "Video prompt",
    text: "Style: A hand-painted cinematic look. A single continuous handheld shot follows the warrior, then the camera circles behind her and pulls back for the final reveal."
  });

  assert.deepEqual(result.pathIds, [CONTENT_IDS.promptVideo]);
});

test("Japanese Seedance video specifications use the video prior without making it absolute", () => {
  const result = classifyContent({
    title: "Seedance 2.0 動画プロンプト共有",
    text: "使用参照: @image1。15秒、1:1。高密度な劇場版2Dセルアニメーション。映像では同じ主人公を維持し、カメラが人物を追い、最後に上空へ引く。"
  });

  assert.deepEqual(result.pathIds, [CONTENT_IDS.promptVideo]);
});

test("Seedance workflow teaching with transferable reasoning is tutorial", () => {
  const result = classifyContent({
    title: "Seedance camera movement tutorial",
    text: "Why word choice matters: camera verbs define spatial direction, while subject verbs define action. Start with the visual anchor, then describe one movement at a time. This structure helps preserve continuity across different scenes."
  });

  assert.deepEqual(result.pathIds, [CONTENT_IDS.tutorial]);
});

test("a cross-model consistency workflow is tutorial", () => {
  const result = classifyContent({
    title: "GPT Image 2 + Seedance 2 workflow",
    text: "GPT Image builds the character and Seedance brings it to life. Most creators treat these as separate steps, which causes identity drift. The reusable method is to create a character sheet first, then use it as the identity anchor for each shot."
  });

  assert.deepEqual(result.pathIds, [CONTENT_IDS.tutorial]);
});

test("classifies timeline video prompts and explicit image prompts", () => {
  const video = classifyContent({
    text: "0-4s: camera tracks the hero. 4-8s: slow dolly out.",
    title: "Seedance prompt"
  });
  const image = classifyContent({
    text: "Flux image prompt, editorial product photography --ar 4:5"
  });

  assert.deepEqual(video.pathIds, [CONTENT_IDS.promptVideo]);
  assert.deepEqual(image.pathIds, [CONTENT_IDS.promptImage]);
});

test("leaves unclear content waiting for confirmation instead of guessing", () => {
  const result = classifyContent({ text: "Make it beautiful and memorable." });

  assert.deepEqual(result.pathIds, []);
  assert.equal(result.status, "needs_review");
  assert.equal(result.classifierVersion, CLASSIFIER_VERSION);
});

test("a short ambiguous caption with a saved screenshot defaults to an editable image case", () => {
  const result = classifyContent({ text: "A strange style I want to remember.", hasScreenshot: true });

  assert.deepEqual(result.pathIds, [CONTENT_IDS.imageCase]);
  assert.equal(result.status, "confirmed");
  assert.equal(result.source, "auto");
});

test("manual confirmation survives future automatic classification", () => {
  const manual = confirmClassification(
    { text: "0-4s: camera tracks the hero" },
    [CONTENT_IDS.promptImage]
  );
  const recalculated = classifyContent(manual);

  assert.deepEqual(recalculated.pathIds, [CONTENT_IDS.promptImage]);
  assert.equal(recalculated.source, "manual");
});

test("an explicit hostname rule is applied before local classification", () => {
  const result = classifyContent(
    {
      text: "An otherwise unclear saved example",
      url: "https://community.example.com/project/12"
    },
    [{ hostname: "community.example.com", pathIds: [CONTENT_IDS.promptVideo] }]
  );

  assert.deepEqual(result.pathIds, [CONTENT_IDS.promptVideo]);
  assert.equal(result.source, "source_rule");
});

test("automatic classification targets a user category by stable creative role", () => {
  let taxonomy = removeContentType(createDefaultTaxonomy(), CONTENT_IDS.promptImage);
  taxonomy = createContentType(taxonomy, {
    id: "content:campaign-prompts",
    name: "广告生图稿",
    role: CONTENT_ROLES.promptImage
  });
  const result = classifyContent({ text: "Midjourney prompt: editorial product image --ar 4:5" }, [], taxonomy);
  assert.deepEqual(result.pathIds, ["content:campaign-prompts"]);
});
