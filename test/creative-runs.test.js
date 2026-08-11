import test from "node:test";
import assert from "node:assert/strict";

import {
  CREATIVE_EVALUATION_PROTOCOL_VERSION,
  CREATIVE_RUNS_VERSION,
  activateCreativeResultContext,
  addCreativeOutput,
  applyCreativeEvaluation,
  createCreativeRun,
  findCreativeOutputs,
  normalizeActiveCreativeResult,
  normalizeCreativeExperimentSettings,
  normalizeCreativeRuns,
  recordCreativeSignal,
  removeCreativeOutput,
  updateCreativeJudgment
} from "../creative-runs.js";

const promptVersion = {
  id: "prompt:v1",
  text: "A quiet cinematic portrait",
  title: "Quiet portrait",
  methodVersion: "1.2.0",
  outputLanguage: "en",
  instructionSnapshot: { instruction: "Keep the selected window light while changing the subject." },
  retrievedSources: [{ alias: "@Retrieved1", role: "guide", referenceKind: "document", text: "Use broad sources for soft light." }],
  createdAt: "2026-07-24T10:00:00.000Z"
};

const session = {
  id: "session:one",
  title: "Portrait study",
  targetType: "image",
  targetPlatform: "ChatGPT",
  outputLanguage: "en",
  referenceSnapshots: [{
    entryId: "entry:one",
    alias: "@Reference1",
    referenceKind: "prompt",
    referenceText: "soft window light"
  }],
  appliedSkills: [{
    skillId: "skill:one",
    versionId: "skill-version:one",
    callName: "quiet-light",
    portableId: "quiet-light",
    description: "Keep quiet window light",
    skillMarkdown: "# Quiet light\n\nKeep a broad soft source.",
    references: [{ path: "references/light.md", markdown: "# Light", runtime: true }],
    source: "generated",
    textMode: true
  }],
  currentInstruction: "Keep the selected window light while changing the subject.",
  messages: [{ role: "user", type: "request", content: "Create a quiet portrait" }],
  promptVersions: [promptVersion]
};

const visual = {
  id: "visual:one",
  sourceUrl: "https://example.com/create",
  sourceTitle: "Result",
  capturedAt: "2026-07-24T10:05:00.000Z",
  width: 1024,
  height: 1536,
  mimeType: "image/webp",
  byteSize: 12345
};

test("explicit result capture activation creates only a lightweight context", () => {
  const context = activateCreativeResultContext(session, promptVersion.id, "2026-07-24T10:01:00.000Z");
  assert.deepEqual(context, {
    sessionId: session.id,
    promptVersionId: promptVersion.id,
    activatedAt: "2026-07-24T10:01:00.000Z"
  });
  assert.equal(normalizeCreativeRuns([]).length, 0);
  assert.throws(() => activateCreativeResultContext(session, "missing"), /提示词版本/);
});

test("a captured image creates one reproducible run and output without API evaluation", () => {
  const context = activateCreativeResultContext(session, promptVersion.id);
  const run = createCreativeRun(context, session, [visual], "2026-07-24T10:06:00.000Z");

  assert.equal(run.version, CREATIVE_RUNS_VERSION);
  assert.equal(run.sessionId, session.id);
  assert.equal(run.promptVersionId, promptVersion.id);
  assert.equal(run.promptText, promptVersion.text);
  assert.equal(run.outputs.length, 1);
  assert.equal(run.outputs[0].visual.id, visual.id);
  assert.equal(run.outputs[0].evaluation, undefined);
  assert.deepEqual(run.outputs[0].signals.map((item) => item.type), ["captured"]);
  assert.equal(JSON.stringify(run).includes("@Reference1"), true);
  assert.equal(run.executionInstruction, "Keep the selected window light while changing the subject.");
  assert.equal(run.retrievedSources[0].role, "guide");
  assert.equal(JSON.stringify(run).includes("entry:one"), false);
  assert.equal(run.appliedSkills[0].versionId, "skill-version:one");
  assert.match(run.appliedSkills[0].skillMarkdown, /broad soft source/);
});

test("subsequent images append to the exact prompt run and preserve prior output identity", () => {
  const context = activateCreativeResultContext(session, promptVersion.id);
  const initial = createCreativeRun(context, session, [visual], "2026-07-24T10:06:00.000Z");
  const secondVisual = { ...visual, id: "visual:two", capturedAt: "2026-07-24T10:07:00.000Z" };
  const updated = addCreativeOutput(initial, secondVisual, "2026-07-24T10:07:00.000Z");

  assert.deepEqual(updated.outputs.map((item) => item.visual.id), ["visual:one", "visual:two"]);
  assert.equal(findCreativeOutputs([updated], session.id, promptVersion.id).length, 2);
});

test("generated edit metadata preserves lineage and service facts without transient image data", () => {
  const context = activateCreativeResultContext(session, promptVersion.id);
  const run = createCreativeRun(context, session, [visual], "2026-07-24T10:06:00.000Z", {
    parentVisualId: "visual:parent",
    editMode: "local",
    serviceId: "openai",
    requestModel: "gpt-image-requested",
    responseModel: "gpt-image-returned",
    requestParameters: { size: "1024x1536", quality: "high", apiKey: "drop" },
    modification: "只修改选区服装",
    baseImageDataUrl: "data:image/png;base64,should-not-persist",
    temporaryFileId: "file-secret"
  });
  assert.deepEqual(run.outputs[0].generation, {
    parentVisualId: "visual:parent",
    editMode: "local",
    serviceId: "openai",
    requestModel: "gpt-image-requested",
    responseModel: "gpt-image-returned",
    requestParameters: { size: "1024x1536", quality: "high" },
    modification: "只修改选区服装"
  });
  assert.equal(JSON.stringify(run).includes("should-not-persist"), false);
  assert.equal(JSON.stringify(run).includes("file-secret"), false);
});

test("behavior signals are explicit and absence never becomes a negative score", () => {
  const run = createCreativeRun(activateCreativeResultContext(session, promptVersion.id), session, [visual]);
  const reused = recordCreativeSignal(run, visual.id, "reused_as_reference", "2026-07-24T11:00:00.000Z");
  assert.deepEqual(reused.outputs[0].signals.map((item) => item.type), ["captured", "reused_as_reference"]);
  assert.equal(JSON.stringify(reused).includes("score"), false);
  assert.throws(() => recordCreativeSignal(run, visual.id, "disliked"), /行为类型/);
});

test("visual evaluation keeps checks and one deviation without confidence or score", () => {
  const run = createCreativeRun(activateCreativeResultContext(session, promptVersion.id), session, [visual]);
  const evaluated = applyCreativeEvaluation(run, visual.id, {
    resultFingerprint: "sha256",
    providerType: "compatible",
    model: "vision-model",
    analyzedAt: "2026-07-24T11:00:00.000Z",
    summary: "主体正确，光线偏硬。",
    checks: [
      { criterion: "主体", status: "met", evidence: "主体为单人肖像" },
      { criterion: "柔和窗光", status: "partial", evidence: "方向正确但阴影较硬" },
      { criterion: "未知信息", status: "unsupported", evidence: "ignore" }
    ],
    primaryDeviation: {
      criterion: "柔和窗光",
      finding: "阴影过硬",
      suggestedChange: "只将硬侧光改为大面积柔和窗光"
    },
    confidence: 0.9,
    score: 8
  });

  const evaluation = evaluated.outputs[0].evaluation;
  assert.equal(evaluation.protocolVersion, CREATIVE_EVALUATION_PROTOCOL_VERSION);
  assert.equal(evaluation.checks.length, 2);
  assert.equal(evaluation.primaryDeviation.suggestedChange, "只将硬侧光改为大面积柔和窗光");
  assert.equal(Object.hasOwn(evaluation, "confidence"), false);
  assert.equal(Object.hasOwn(evaluation, "score"), false);
});

test("normalization removes invalid contexts, duplicate outputs, and unsupported experiment flags", () => {
  assert.equal(normalizeActiveCreativeResult({ sessionId: "one" }), null);
  assert.deepEqual(normalizeCreativeExperimentSettings({ enabled: true, autoAnalyze: true }), {
    enabled: true,
    autoAnalyze: true
  });
  assert.deepEqual(normalizeCreativeExperimentSettings({ enabled: false, autoAnalyze: true }), {
    enabled: false,
    autoAnalyze: false
  });

  const run = createCreativeRun(activateCreativeResultContext(session, promptVersion.id), session, [visual]);
  const normalized = normalizeCreativeRuns([{ ...run, outputs: [...run.outputs, run.outputs[0]] }, { id: "" }]);
  assert.equal(normalized.length, 1);
  assert.equal(normalized[0].outputs.length, 1);

  const removed = removeCreativeOutput(normalized[0], visual.id);
  assert.equal(removed.outputs.length, 0);
});

test("video outputs preserve local media and generation parameters but reject image evaluation", () => {
  const videoSession = { ...session, targetType: "video" };
  const video = {
    id: "video:one",
    kind: "video",
    usage: "content",
    storageMode: "managed",
    mimeType: "video/mp4",
    byteSize: 54321,
    width: 1280,
    height: 720,
    durationMs: 4000,
    capturedAt: "2026-08-08T10:00:00.000Z"
  };
  const run = createCreativeRun(
    activateCreativeResultContext(videoSession, promptVersion.id),
    videoSession,
    [video],
    "2026-08-08T10:01:00.000Z",
    {
      serviceId: "openai",
      requestModel: "account-video-model",
      requestParameters: { size: "1280x720", duration: "4", apiKey: "drop" }
    }
  );
  assert.equal(run.targetType, "video");
  assert.equal(run.outputs[0].visual.kind, "video");
  assert.deepEqual(run.outputs[0].generation.requestParameters, { size: "1280x720", duration: "4" });
  assert.throws(() => applyCreativeEvaluation(run, video.id, {
    resultFingerprint: "hash",
    summary: "不应分析"
  }), /视频结果不使用图片视觉对照/);
});

test("user judgments are optional, editable, clearable, and never inferred from missing input", () => {
  const run = createCreativeRun(activateCreativeResultContext(session, promptVersion.id), session, [visual]);
  const judged = updateCreativeJudgment(run, visual.id, {
    keep: "保留柔和窗光",
    improve: "减弱背景反差"
  }, "2026-08-08T12:00:00.000Z");
  assert.deepEqual(judged.outputs[0].judgment, {
    keep: "保留柔和窗光",
    improve: "减弱背景反差",
    updatedAt: "2026-08-08T12:00:00.000Z"
  });
  const edited = updateCreativeJudgment(judged, visual.id, { keep: "保留人物姿态", improve: "" });
  assert.equal(edited.outputs[0].judgment.keep, "保留人物姿态");
  assert.equal(edited.outputs[0].judgment.improve, "");
  const cleared = updateCreativeJudgment(edited, visual.id, { keep: "", improve: "" });
  assert.equal(cleared.outputs[0].judgment, undefined);
  assert.equal(createCreativeRun(activateCreativeResultContext(session, promptVersion.id), session, [visual]).outputs[0].judgment, undefined);
});

test("run snapshots keep the applied Skill after the live Skill changes or disappears", () => {
  const run = createCreativeRun(activateCreativeResultContext(session, promptVersion.id), session, [visual]);
  const serialized = JSON.stringify(run);
  const changedLiveState = { items: [] };
  assert.equal(changedLiveState.items.length, 0);
  assert.equal(JSON.parse(serialized).appliedSkills[0].versionId, "skill-version:one");
  assert.match(JSON.parse(serialized).appliedSkills[0].skillMarkdown, /broad soft source/);
});
