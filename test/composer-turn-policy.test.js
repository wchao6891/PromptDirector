import test from "node:test";
import assert from "node:assert/strict";

import { resolveComposerTurnPolicy } from "../composer-turn-policy.js";

test("a manually selected text task executes directly in one model call", () => {
  assert.deepEqual(resolveComposerTurnPolicy({
    routeMode: "analyze_materials",
    outputMode: "text_prompt"
  }), {
    route: "analyze_materials",
    routeSource: "manual",
    path: "direct_text",
    expectedModelCalls: 1,
    stages: ["requesting_model", "receiving_text"],
    preflightIssues: []
  });
});

test("automatic text routing is resolved inside the same streamed model response", () => {
  assert.deepEqual(resolveComposerTurnPolicy({
    routeMode: "auto",
    outputMode: "text_prompt"
  }), {
    route: "auto",
    routeSource: "auto",
    path: "direct_auto",
    expectedModelCalls: 1,
    stages: ["requesting_model", "receiving_text"],
    preflightIssues: []
  });
});

test("an explicit media output uses the generation task without a planning call", () => {
  assert.deepEqual(resolveComposerTurnPolicy({
    routeMode: "chat",
    outputMode: "create_image",
    generationCapability: { available: true, requiresPromptAssembly: false }
  }), {
    route: "compose",
    routeSource: "manual",
    path: "direct_generation",
    expectedModelCalls: 1,
    stages: ["submitting_generation", "generation", "persisting"],
    preflightIssues: []
  });
});

test("a prompt-only generation endpoint adds one visible assembly stage", () => {
  assert.deepEqual(resolveComposerTurnPolicy({
    routeMode: "auto",
    outputMode: "create_video",
    generationCapability: { available: true, requiresPromptAssembly: true }
  }), {
    route: "compose",
    routeSource: "manual",
    path: "assemble_then_generate",
    expectedModelCalls: 2,
    stages: ["assembling_prompt", "submitting_generation", "generation", "persisting"],
    preflightIssues: []
  });
});

test("generation preflight blocks paid calls without deleting unsupported references", () => {
  assert.deepEqual(resolveComposerTurnPolicy({
    routeMode: "auto",
    outputMode: "create_video",
    generationCapability: {
      available: false,
      issue: "当前服务没有声明可用的视频生成能力",
      requiresPromptAssembly: true
    },
    referenceCapabilities: {
      issues: ["当前视频模型不接收原图", "当前视频模型不接收原图"]
    }
  }), {
    route: "compose",
    routeSource: "manual",
    path: "assemble_then_generate",
    expectedModelCalls: 0,
    stages: [],
    preflightIssues: ["当前服务没有声明可用的视频生成能力", "当前视频模型不接收原图"]
  });
});
