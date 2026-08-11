import test from "node:test";
import assert from "node:assert/strict";

import {
  AGENT_TASK_KEYS,
  COMPOSER_AGENT_VERSION,
  DEFAULT_AGENT_INSTRUCTION,
  DEFAULT_TASK_METHODS,
  compileAgentExecutionPrompt,
  compileAgentPlanningPrompt,
  composerAssemblyLayers,
  normalizeComposerAgentSettings,
  taskMethodFor,
  updateAgentTaskMethod
} from "../composer-agent.js";

test("light agent compiles routing, button questions, and local search without a dimension contract", () => {
  const settings = normalizeComposerAgentSettings();
  assert.equal(settings.agentVersion, COMPOSER_AGENT_VERSION);
  assert.equal(settings.agentInstruction.text, DEFAULT_AGENT_INSTRUCTION);
  assert.deepEqual(Object.keys(settings.taskMethods), [...AGENT_TASK_KEYS]);

  const planning = compileAgentPlanningPrompt({ settings, routeMode: "auto", targetType: "video", outputLanguage: "en" });
  for (const route of ["compose", "analyze_materials", "chat"]) assert.match(planning, new RegExp(`${route}:`));
  assert.doesNotMatch(planning, /extract_project_method/);
  assert.match(planning, /two to three|二到三个/);
  assert.match(planning, /librarySearch/);
  assert.doesNotMatch(planning, /dimensionUses|conflicts|preserveMode|productionReview/);

  const execution = compileAgentExecutionPrompt({ settings, route: "compose", targetType: "image", outputLanguage: "en", productionReviewEnabled: true });
  assert.match(execution, /self-contained|自包含/);
  assert.match(execution, /可见事实/);
  assert.match(execution, /只使用用户指定/);
  assert.match(execution, /不要输出审核报告/);
  assert.doesNotMatch(execution, /plan\.|dimensionUses|preservedFeatures/);
});

test("assembly inspector shows only the five lightweight inputs", () => {
  const layers = composerAssemblyLayers({
    settings: normalizeComposerAgentSettings(),
    routeMode: "auto",
    targetType: "image",
    outputLanguage: "zh-CN",
    skills: "1. /国风视觉\n保持有根的视觉方向。",
    references: "@参考1 手选原文\n\n@检索1 [guide] 教程原文"
  });
  assert.deepEqual(layers.map((item) => item.id), ["agent", "task", "skills", "references", "runtime"]);
  assert.match(layers.find((item) => item.id === "skills").content, /国风视觉/);
  assert.match(layers.find((item) => item.id === "references").content, /@参考1.*@检索1/s);
});

test("legacy editable methods migrate without carrying the old harness schema", () => {
  const untouched = normalizeComposerAgentSettings({ methods: {
    image: { "zh-CN": { text: "旧默认中文", customized: false }, en: { text: "Old default English", customized: false } }
  } });
  assert.equal(untouched.taskMethods["compose.image"].text, DEFAULT_TASK_METHODS["compose.image"]);

  const conflicting = normalizeComposerAgentSettings({ methods: {
    image: {
      "zh-CN": { text: "中文历史方法", customized: true },
      en: { text: "English legacy method", customized: true }
    }
  } });
  assert.equal(taskMethodFor(conflicting, "compose", "image", "zh-CN"), "中文历史方法");
  assert.equal(taskMethodFor(conflicting, "compose", "image", "en"), "English legacy method");

  const merged = updateAgentTaskMethod(conflicting, "compose.image", "Unified method");
  assert.equal(merged.taskMethods["compose.image"].text, "Unified method");
  assert.equal(merged.migrationCandidates["compose.image"], undefined);
});

test("editable instructions may intentionally be empty", () => {
  const settings = normalizeComposerAgentSettings({
    agentInstruction: { text: "" },
    taskMethods: { chat: { text: "" } }
  });
  assert.equal(settings.agentInstruction.text, "");
  assert.equal(taskMethodFor(settings, "chat", "image", "zh-CN"), "");
});

test("saved defaults follow the current agent version while customized instructions stay intact", () => {
  const migrated = normalizeComposerAgentSettings({
    agentInstruction: { text: "old default", customized: false, basedOnVersion: "3.0.0" },
    taskMethods: { "compose.image": { text: "old default method", customized: false, basedOnVersion: "3.0.0" } }
  });
  assert.equal(migrated.agentInstruction.text, DEFAULT_AGENT_INSTRUCTION);
  assert.equal(migrated.taskMethods["compose.image"].text, DEFAULT_TASK_METHODS["compose.image"]);

  const customized = normalizeComposerAgentSettings({
    agentInstruction: { text: "my instruction", customized: true, basedOnVersion: "3.0.0" }
  });
  assert.equal(customized.agentInstruction.text, "my instruction");
});
