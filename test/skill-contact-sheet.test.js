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
      { id: "chosen", kind: "image", usage: "content", visionAnalysis: { description: "保留的构图" } },
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
  const entries = [{ id: "local:secret", title: "Secret Project", url: "https://private.example", text: "original prompt", mediaAssets: [{ usage: "content", visionAnalysis: { description: "visible composition" } }] }];
  const request = buildSkillExtractionRequest({ goal: "提炼构图", sources: anonymousSkillSources(entries, ["local:secret"]), locale: "zh-CN" });
  assert.match(request, /原提示词[\s\S]*original prompt/);
  assert.match(request, /已有画面分析[\s\S]*visible composition/);
  assert.doesNotMatch(request, /local:secret|Secret Project|private\.example/);
});
