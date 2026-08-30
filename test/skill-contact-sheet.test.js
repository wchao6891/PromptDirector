import test from "node:test";
import assert from "node:assert/strict";

import { contactSheetPlan, selectedSkillContentImages } from "../skill-contact-sheet.js";
import { anonymousSkillSources, buildSkillExtractionRequest } from "../creative-skill-service.js";

test("skill visual selection includes every content image and excludes posters", () => {
  const images = selectedSkillContentImages([{ id: "a", mediaAssets: [
    { id: "one", kind: "image", usage: "content" },
    { id: "poster", kind: "image", usage: "poster" },
    { id: "two", kind: "image", usage: "content" }
  ] }], ["a"]);
  assert.deepEqual(images.map((item) => item.visualId), ["one", "two"]);
  assert.deepEqual(images.map((item) => item.imageNumber), [1, 2]);
});

test("one image stays direct while larger selections use at most nine images per contact sheet", () => {
  assert.equal(contactSheetPlan([{ visualId: "one" }])[0].kind, "single");
  const plan = contactSheetPlan(Array.from({ length: 20 }, (_, index) => ({ visualId: String(index) })));
  assert.deepEqual(plan.map((item) => item.items.length), [9, 9, 2]);
  assert.equal(plan.every((item) => item.kind === "contact-sheet"), true);
});

test("compound Skill sources include only explicitly selected assets", () => {
  const entries = [{
    id: "compound",
    text: "共享案例文字",
    mediaAssets: [
      { id: "chosen", kind: "image", usage: "content", visionAnalysis: { reconstructionPrompt: "保留的构图" } },
      { id: "hidden", kind: "image", usage: "content", visionAnalysis: { description: "不应发送的构图" } },
      { id: "doc", kind: "document", usage: "content" }
    ],
    mediaPrompts: [
      { assetId: "chosen", text: "选中图片提示词" },
      { assetId: "hidden", text: "未选图片提示词" }
    ]
  }];
  const selections = [{ entryId: "compound", includeEntryText: false, assetIds: ["chosen", "doc"] }];
  const images = selectedSkillContentImages(entries, selections);
  assert.deepEqual(images.map((item) => item.visualId), ["chosen"]);
  const sources = anonymousSkillSources(entries, selections, { documentTextByAsset: new Map([["doc", "所选文档正文"]]) });
  assert.equal(sources.length, 1);
  assert.match(sources[0].prompt, /选中图片提示词[\s\S]*所选文档正文/);
  assert.match(sources[0].analysis, /保留的构图/);
  assert.doesNotMatch(JSON.stringify(sources), /共享案例文字|未选图片提示词|不应发送的构图|compound|chosen|doc/);
});

test("extraction payload contains anonymous selected text and no local identity fields", () => {
  const entries = [{ id: "local:secret", title: "Secret Project", url: "https://private.example", text: "original prompt", mediaAssets: [{ usage: "content", visionAnalysis: { reconstructionPrompt: "visible composition" } }] }];
  const request = buildSkillExtractionRequest({ goal: "提炼构图", sources: anonymousSkillSources(entries, ["local:secret"]), locale: "zh-CN" });
  assert.match(request, /原提示词[\s\S]*original prompt/);
  assert.match(request, /已有画面分析[\s\S]*visible composition/);
  assert.doesNotMatch(request, /local:secret|Secret Project|private\.example/);
});

test("selected video Skill sources stay asset-specific anonymous and exclude history tags and binary media", () => {
  const entries = [{
    id: "private:case-id",
    title: "PRIVATE_TITLE_SENTINEL",
    url: "https://private.example/video",
    text: "案例级回退",
    mediaAssets: [
      { id: "private:video-one", kind: "video", usage: "content", mimeType: "video/mp4", assetPath: "private/video.mp4" },
      { id: "private:video-two", kind: "video", usage: "content", mimeType: "video/mp4" }
    ],
    mediaPrompts: [
      { assetId: "private:video-one", text: "所选视频原始提示词" },
      { assetId: "private:video-two", text: "另一视频提示词" }
    ],
    timeNotes: [
      { id: "private:note-one", assetId: "private:video-one", startMs: 0, text: "所选视频人工笔记", createdAt: "2026-08-30T00:00:00.000Z" },
      { id: "private:note-two", assetId: "private:video-two", startMs: 0, text: "另一视频笔记", createdAt: "2026-08-30T00:00:00.000Z" }
    ],
    videoAnalyses: [
      completeSkillReconstruction("private:old", "private:video-one", "旧逆推", "2026-08-30T00:00:01.000Z"),
      completeSkillReconstruction("private:current", "private:video-one", "当前视觉逆推", "2026-08-30T00:00:03.000Z"),
      { id: "private:review", assetId: "private:video-one", mode: "ad-review", text: "默认不进入的审片", createdAt: "2026-08-30T00:00:04.000Z" },
      completeSkillReconstruction("private:other", "private:video-two", "另一视频逆推", "2026-08-30T00:00:05.000Z")
    ],
    facetAssignments: [{ source: "vision_model", facetId: "PRIVATE_TAG_SENTINEL" }]
  }];
  const selections = [{ entryId: "private:case-id", includeEntryText: false, assetIds: ["private:video-one"] }];
  assert.deepEqual(selectedSkillContentImages(entries, selections), []);
  const [source] = anonymousSkillSources(entries, selections);
  assert.deepEqual(source.parts.map((part) => part.kind), ["original_prompt", "video_reconstruction", "time_notes"]);
  const request = buildSkillExtractionRequest({ goal: "提炼视频方法", sources: [source], locale: "zh-CN" });
  assert.match(request, /\[原始提示词\][\s\S]*所选视频原始提示词/);
  assert.match(request, /\[AI 视觉逆推\][\s\S]*当前视觉逆推/);
  assert.match(request, /\[人工时间点笔记\][\s\S]*所选视频人工笔记/);
  assert.doesNotMatch(request, /旧逆推|审片|另一视频|PRIVATE_TAG_SENTINEL|PRIVATE_TITLE_SENTINEL|private:|private\.example|video\.mp4/);

  const [customized] = anonymousSkillSources(entries, [{
    ...selections[0],
    sourceIds: ["reconstruction:private:current", "notes:private:video-one"],
    analysisIds: ["private:review"]
  }]);
  assert.deepEqual(customized.parts.map((part) => part.kind), ["video_reconstruction", "time_notes", "other_analysis"]);
  assert.doesNotMatch(customized.prompt, /所选视频原始提示词/);
  assert.match(customized.analysis, /当前视觉逆推[\s\S]*所选视频人工笔记[\s\S]*默认不进入的审片/);
});

test("Skill source exact dedupe keeps both labels without repeating the body", () => {
  const request = buildSkillExtractionRequest({
    goal: "提炼共同方法",
    locale: "zh-CN",
    sources: [{
      parts: [
        { kind: "original_prompt", text: "相同正文" },
        { kind: "video_reconstruction", text: "相同正文" }
      ]
    }]
  });
  assert.match(request, /\[原始提示词 \+ AI 视觉逆推\]\n相同正文/);
  assert.equal(request.match(/相同正文/g)?.length, 1);
});

function completeSkillReconstruction(id, assetId, reconstructionPrompt, createdAt) {
  return {
    id,
    assetId,
    mode: "visual-reconstruction",
    requestId: `request:${id}`,
    contractVersion: "visual-v3-1",
    reconstructionPrompt,
    tags: [],
    uncertainties: [],
    includeTags: false,
    analysisScope: "visual",
    finishReason: "stop",
    createdAt
  };
}
