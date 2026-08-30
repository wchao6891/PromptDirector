import test from "node:test";
import assert from "node:assert/strict";

import { createComposerSession, normalizeComposerSettings } from "../composer.js";
import { applyComposerServiceResult, prepareComposerTurnStart } from "../composer-turn-core.js";
import { resolveComposerTurnPolicy } from "../composer-turn-policy.js";

test("a manual text task starts streaming execution with the saved user request", () => {
  const session = createComposerSession({
    routeMode: "analyze_materials",
    messages: [{ id: "user:one", role: "user", type: "request", content: "分析这些参考的镜头规律" }]
  });
  const policy = resolveComposerTurnPolicy(session);
  const prepared = prepareComposerTurnStart(session, policy);

  assert.equal(prepared.startPhase, "streaming");
  assert.equal(prepared.executionRoute, "analyze_materials");
  assert.equal(prepared.session.currentInstruction, "分析这些参考的镜头规律");
  assert.equal(prepared.session.currentRoute, "analyze_materials");
  assert.equal(prepared.session.currentRouteSource, "manual");
});

test("an explicit media task starts generation without the generic planning phase", () => {
  const session = createComposerSession({
    targetType: "video",
    outputMode: "create_video",
    messages: [{ id: "user:video", role: "user", type: "request", content: "创建一个镜头推进的视频" }]
  });
  const policy = resolveComposerTurnPolicy({
    ...session,
    generationCapability: { available: true, requiresPromptAssembly: true }
  });
  const prepared = prepareComposerTurnStart(session, policy);

  assert.equal(prepared.startPhase, "generation");
  assert.equal(prepared.executionRoute, "compose");
  assert.equal(prepared.session.currentInstruction, "创建一个镜头推进的视频");
  assert.equal(prepared.session.currentRoute, "compose");
  assert.equal(prepared.session.currentRouteSource, "manual");
});

test("an automatic text task starts one direct automatic response", () => {
  const session = createComposerSession({
    routeMode: "auto",
    outputMode: "text_prompt",
    messages: [{ id: "user:auto", role: "user", type: "request", content: "帮我看看这些参考，合适的话装配成提示词" }]
  });
  const policy = resolveComposerTurnPolicy(session);
  const prepared = prepareComposerTurnStart(session, policy);

  assert.equal(prepared.startPhase, "streaming");
  assert.equal(prepared.executionRoute, "auto");
  assert.equal(prepared.session.currentInstruction, "帮我看看这些参考，合适的话装配成提示词");
  assert.equal(prepared.session.currentRoute, "");
  assert.equal(prepared.session.currentRouteSource, "auto");
});

test("an automatic response is saved according to the route chosen in that response", () => {
  const session = createComposerSession({
    routeMode: "auto",
    currentRouteSource: "auto",
    messages: [{ id: "user:auto-result", role: "user", type: "request", content: "装配成图片提示词" }]
  });
  const applied = applyComposerServiceResult(session, {
    route: "compose",
    kind: "prompt",
    finalPrompt: "一只白猫站在蓝色窗边，柔和逆光。",
    outputLanguage: "zh-CN",
    usage: {}
  }, normalizeComposerSettings(), "auto", "装配成图片提示词");

  assert.equal(applied.promptVersions.length, 1);
  assert.equal(applied.messages.at(-1).type, "prompt");
  assert.equal(applied.messages.at(-1).route, "compose");
  assert.equal(applied.messages.at(-1).instructionSnapshot.route, "compose");
});
