import test from "node:test";
import assert from "node:assert/strict";

import { buildComposerDiagnostic, composerOutputChecks, diagnosticFilename } from "../composer-diagnostics.js";
import { createComposerSession } from "../composer.js";

test("local output checks catch aliases and fake placeholder instructions without another model call", () => {
  const checks = composerOutputChecks(createComposerSession({ targetType: "image" }), {
    text: "请替换括号中的内容，并参考 @参考1。"
  });
  assert.deepEqual(checks.filter((item) => item.status === "failed").map((item) => item.id), [
    "self-contained",
    "placeholder-consistency"
  ]);
});

test("local output checks flag an explicit video timeline in an image prompt", () => {
  const checks = composerOutputChecks(createComposerSession({ targetType: "image" }), {
    text: "0-4s: 主体入场。4-8s: 镜头推进。"
  });
  assert.equal(checks.find((item) => item.id === "target-type").status, "failed");
});

test("light review never creates a required structured diagnostic contract", () => {
  const checks = composerOutputChecks(createComposerSession({ productionReviewEnabled: true }), {
    text: "完整、自包含的提示词",
    productionReviewEnabled: true
  });
  assert.equal(checks.some((item) => item.id === "production-review"), false);
  assert.equal(checks.some((item) => item.id.startsWith("dimension-")), false);
  assert.equal(checks.every((item) => item.status === "passed"), true);
});

test("diagnostic export contains lightweight execution sources but never old plans or API settings", () => {
  const session = createComposerSession({
    id: "session:a",
    title: "测试 / 对话",
    currentInstruction: "保留场景，只替换人物",
    referenceSnapshots: [{ entryId: "entry:a", alias: "@参考1", referenceKind: "prompt", referenceText: "private source" }],
    retrievedSources: [{ entryId: "guide", alias: "@检索1", title: "布光攻略", role: "guide", referenceKind: "document", text: "先确定主光" }],
    messages: [{ role: "user", type: "request", content: "生成", createdAt: "2026-07-22T00:00:00.000Z" }],
    promptVersions: [{
      text: "完整提示词",
      productionReviewEnabled: true,
      retrievedSources: [{ entryId: "guide", alias: "@检索1", title: "布光攻略", role: "guide", referenceKind: "document", text: "先确定主光" }],
      instructionSnapshot: { agentVersion: "3.0.0", route: "compose", routeSource: "auto", instruction: "保留场景，只替换人物" },
      createdAt: "2026-07-22T00:00:01.000Z"
    }]
  });
  const diagnostic = buildComposerDiagnostic(session);
  assert.equal(diagnostic.session.references[0].referenceText, "private source");
  assert.equal(diagnostic.session.currentInstruction, "保留场景，只替换人物");
  assert.equal(diagnostic.session.retrievedSources[0].role, "guide");
  assert.equal(JSON.stringify(diagnostic).includes("dimensionUses"), false);
  assert.equal(JSON.stringify(diagnostic).includes("planSnapshot"), false);
  assert.equal(JSON.stringify(diagnostic).includes('"productionReview":'), false);
  assert.equal(JSON.stringify(diagnostic).includes("apiKey"), false);
  assert.equal(diagnosticFilename(session.title), "PromptDirector-诊断-测试 - 对话.json");
});

test("diagnostic export retains local checks and excludes legacy paid semantic review data", () => {
  const session = createComposerSession({
    messages: [{ role: "user", content: "生成海报" }],
    promptVersions: [{ text: "完整提示词", semanticReview: { status: "passed", summary: "旧复核" } }]
  });
  const diagnostic = buildComposerDiagnostic(session);
  assert.ok(diagnostic.session.promptVersions[0].checks.length > 0);
  assert.equal(JSON.stringify(diagnostic).includes("semanticReview"), false);
  assert.equal(JSON.stringify(diagnostic).includes("旧复核"), false);
});
