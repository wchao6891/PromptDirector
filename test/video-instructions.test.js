import test from "node:test";
import assert from "node:assert/strict";
import { normalizeAiPreferences } from "../extension/ai-runtime.js";
import { videoAnalysisPrompt } from "../extension/video-analysis.js";

test("video methods expose full audiovisual coverage while preserving custom rules", () => {
  const defaults = normalizeAiPreferences({ version: 2 });
  assert.equal(defaults.version, 3);
  for (const word of ["空间", "表演", "音乐", "音画", "时间线"]) assert.ok(defaults.videoInstructionsByLocale["zh-CN"].includes(word), word);
  const custom = normalizeAiPreferences({ version: 2, videoInstructionsByLocale: { "zh-CN": "我的自定义方法" } });
  assert.equal(custom.videoInstructionsByLocale["zh-CN"], "我的自定义方法");
  assert.deepEqual(normalizeAiPreferences(defaults), defaults);
});

test("the reconstruction contract allows heard evidence without inventing audio and honors English", () => {
  const zh = videoAnalysisPrompt("visual-reconstruction", "", { instruction: "自定义方法", locale: "zh-CN" });
  assert.match(zh, /自定义方法/);
  assert.doesNotMatch(zh, /完全没有音轨证据|不得描述、推断或限制任何声音/);
  assert.match(zh, /无法.*音|音.*无法/);
  const en = videoAnalysisPrompt("visual-reconstruction", "", { instruction: "My custom method", locale: "en" });
  assert.match(en, /My custom method/);
  assert.match(en, /English/);
  assert.doesNotMatch(en, /必须是.*中文提示词/);
});

test("only exact prior defaults migrate, independently by language", () => {
  const old = "从创意导演与视频生成的角度，忠实逆推成片中可见的主体、场景、镜头时间线、运镜、动作、转场、光色、材质、文字与连续性约束。优先保留决定复现效果的证据，不补写画面之外的信息。";
  const defaults = normalizeAiPreferences({});
  const migrated = normalizeAiPreferences({ version: 2, videoInstructionsByLocale: { "zh-CN": old, en: "My personal method" } });
  assert.equal(migrated.videoInstructionsByLocale["zh-CN"], defaults.videoInstructionsByLocale["zh-CN"]);
  assert.equal(migrated.videoInstructionsByLocale.en, "My personal method");
  assert.equal(normalizeAiPreferences({ version: 2, videoInstructionsByLocale: { "zh-CN": old + " 自定义" } }).videoInstructionsByLocale["zh-CN"], old + " 自定义");
});
