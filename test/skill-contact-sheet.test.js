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

test("extraction payload contains anonymous selected text and no local identity fields", () => {
  const entries = [{ id: "local:secret", title: "Secret Project", url: "https://private.example", text: "original prompt", mediaAssets: [{ usage: "content", visionAnalysis: { description: "visible composition" } }] }];
  const request = buildSkillExtractionRequest({ goal: "提炼构图", sources: anonymousSkillSources(entries, ["local:secret"]), locale: "zh-CN" });
  assert.match(request, /原提示词[\s\S]*original prompt/);
  assert.match(request, /已有画面分析[\s\S]*visible composition/);
  assert.doesNotMatch(request, /local:secret|Secret Project|private\.example/);
});
