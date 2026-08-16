import test from "node:test";
import assert from "node:assert/strict";

import {
  COMPOSER_INPUT_MAX_CHARACTERS,
  COMPOSER_METHOD_VERSION,
  DEFAULT_AGENT_INSTRUCTION,
  DEFAULT_COMPOSER_AI_PROFILE,
  DEFAULT_TASK_METHODS,
  appendComposerMessage,
  appendDiagnosticEvent,
  appendPromptVersion,
  clearComposerFailure,
  composerInputUsage,
  createComposerSession,
  createReferenceSnapshots,
  imageReferenceModeAvailability,
  isMeaningfulComposerSession,
  normalizeComposerAiProfile,
  normalizeComposerSessions,
  normalizeComposerSettings,
  normalizePlannerResult,
  plannerRequestPayload,
  resetComposerAgentInstruction,
  resetComposerTaskMethod,
  setComposerFailure,
  updateComposerAgentInstruction,
  updateComposerTaskMethod,
  validateGeneratedPrompt
} from "../composer.js";
import {
  DeepSeekApiError,
  deepSeekErrorDetails,
  executeAgentTurn,
  planComposerTurn,
  readDeepSeekSse
} from "../deepseek.js";
import { CONTENT_IDS } from "../taxonomy.js";

const aiSettings = { apiKey: "secret", consent: true };

test("composer agent keeps one editable method per task without a harness contract", () => {
  const defaults = normalizeComposerSettings();
  assert.equal(defaults.methodVersion, COMPOSER_METHOD_VERSION);
  assert.equal(COMPOSER_METHOD_VERSION, "3.1.0");
  assert.equal(defaults.agentInstruction.text, DEFAULT_AGENT_INSTRUCTION);
  assert.match(defaults.taskMethods["compose.image"].text, /只修改|替换局部|保留未被点名/);
  assert.match(defaults.taskMethods["compose.video"].text, /起始状态.*可见变化.*结束状态/);
  assert.match(defaults.taskMethods.analyze_materials.text, /不声称联网/);
  assert.equal(Object.hasOwn(defaults, "harnessVersion"), false);
  assert.equal(defaults.productionReviewEnabled, true);

  const changed = updateComposerTaskMethod(defaults, { taskKey: "compose.image", text: "My private method" });
  assert.equal(changed.taskMethods["compose.image"].text, "My private method");
  assert.equal(changed.taskMethods["compose.image"].customized, true);
  assert.equal(resetComposerTaskMethod(changed, "compose.image").taskMethods["compose.image"].text, DEFAULT_TASK_METHODS["compose.image"]);

  const customAgent = updateComposerAgentInstruction(changed, "My agent instruction");
  assert.equal(customAgent.agentInstruction.text, "My agent instruction");
  assert.equal(resetComposerAgentInstruction(customAgent).agentInstruction.text, DEFAULT_AGENT_INSTRUCTION);
});

test("composer AI profile keeps DeepSeek choices strict and accepts configured visual models", () => {
  assert.deepEqual(normalizeComposerAiProfile(), DEFAULT_COMPOSER_AI_PROFILE);
  assert.deepEqual(normalizeComposerAiProfile({ model: "deepseek-v4-pro", thinking: true }), { serviceId: "deepseek", model: "deepseek-v4-pro", thinking: true });
  assert.deepEqual(normalizeComposerAiProfile({ model: "custom", thinking: "yes" }), DEFAULT_COMPOSER_AI_PROFILE);
  assert.deepEqual(normalizeComposerAiProfile({ serviceId: "openai", model: "gpt-5-mini", thinking: true }), { serviceId: "openai", model: "gpt-5-mini", thinking: true });
  assert.deepEqual(normalizeComposerAiProfile({ serviceId: "compatible", model: "vision-pro", thinking: true }), { serviceId: "compatible", model: "vision-pro", thinking: true });
  assert.deepEqual(normalizeComposerAiProfile({ serviceId: "kimi", model: "account-planning-model" }), { serviceId: "kimi", model: "account-planning-model", thinking: false });
  assert.deepEqual(createComposerSession({ generationParameters: { size: "1536x1024", quality: "high", aspectRatio: "16:9", imageSize: "2K", secret: "drop" } }).generationParameters, {
    size: "1536x1024",
    quality: "high",
    aspectRatio: "16:9",
    imageSize: "2K"
  });
  assert.deepEqual(createComposerSession({
    targetType: "video",
    outputMode: "create_video",
    generationParameters: { size: "720x1280", duration: "8", secret: "drop" }
  }).generationParameters, {
    size: "720x1280",
    duration: "8",
    aspectRatio: "",
    resolution: "",
    motion: ""
  });
});

test("old heavy plans and review reports are discarded while user-visible conversation remains", () => {
  const session = createComposerSession({
    id: "legacy",
    currentPlan: { dimensionUses: [{ path: "subject.appearance" }] },
    messages: [
      { role: "user", type: "request", content: "替换角色" },
      { role: "assistant", type: "plan", content: "内部规划" },
      { role: "assistant", type: "chat", content: "可见回答" }
    ],
    promptVersions: [{
      text: "完整提示词",
      planSnapshot: { dimensionUses: [] },
      productionReview: { status: "passed", summary: "旧审核报告" }
    }]
  });

  assert.equal(Object.hasOwn(session, "currentPlan"), false);
  assert.deepEqual(session.messages.map((item) => item.content), ["替换角色", "可见回答"]);
  assert.equal(Object.hasOwn(session.promptVersions[0], "planSnapshot"), false);
  assert.equal(Object.hasOwn(session.promptVersions[0], "productionReview"), false);
});

test("empty sessions stay ephemeral while references and messages remain meaningful", () => {
  const empty = createComposerSession({ id: "empty" });
  const reference = createComposerSession({ id: "reference", referenceSnapshots: [{ entryId: "one", alias: "@参考1", referenceText: "soft light" }] });
  const message = createComposerSession({ id: "message", messages: [{ role: "user", content: "生成海报" }] });
  assert.equal(isMeaningfulComposerSession(empty), false);
  assert.equal(isMeaningfulComposerSession(reference), true);
  assert.deepEqual(normalizeComposerSessions([empty, reference, message]).map((item) => item.id).sort(), ["message", "reference"]);
});

test("composer failure state remains retryable", () => {
  const original = createComposerSession({ messages: [{ id: "user:one", role: "user", content: "生成海报" }] });
  const failed = setComposerFailure(original, {
    userMessageId: "user:one",
    phase: "planning",
    kind: "network",
    message: "无法连接 DeepSeek",
    retryable: true
  });
  assert.equal(createComposerSession(failed).lastFailure.retryable, true);
  assert.equal(clearComposerFailure(failed).lastFailure, null);
});

test("manual reference snapshots exclude tutorials and keep target-compatible compound content", () => {
  const entries = [
    { id: "tutorial", text: "how to", classification: { pathIds: [CONTENT_IDS.tutorial] } },
    { id: "prompt", title: "Prompt", text: "warm rim light", classification: { pathIds: [CONTENT_IDS.promptImage] } },
    { id: "image", classification: { pathIds: [CONTENT_IDS.imageCase] }, visionAnalysis: { description: "A quiet blue room" } },
    {
      id: "compound",
      memberEntries: [
        { text: "cinematic key visual", classification: { pathIds: [CONTENT_IDS.promptImage] } },
        { text: "private tutorial", classification: { pathIds: [CONTENT_IDS.tutorial] } },
        { text: "camera pushes forward", classification: { pathIds: [CONTENT_IDS.promptVideo] } }
      ]
    }
  ];
  const image = createReferenceSnapshots(entries, entries.map((item) => item.id), "zh-CN", "image");
  assert.deepEqual(image.map((item) => item.entryId), ["prompt", "image", "compound"]);
  assert.match(image.at(-1).referenceText, /cinematic key visual/);
  assert.doesNotMatch(image.at(-1).referenceText, /private tutorial|camera pushes forward/);
});

test("image prompt references carry the original prompt and every saved visual fact", () => {
  const [reference] = createReferenceSnapshots([{
    id: "three-person-composition",
    title: "private title must stay local",
    text: "电影级长焦镜头，主体清晰，周围人物虚化。",
    classification: { pathIds: [CONTENT_IDS.promptImage] },
    primaryMediaId: "image-a",
    mediaAssets: [
      {
        id: "image-a", kind: "image", usage: "content",
        visionAnalysis: { description: "三人构图：中间女性清晰聚焦，靠近镜头的两名前景人物明显失焦。" }
      },
      {
        id: "image-b", kind: "image", usage: "content",
        visionAnalysis: { description: "长焦压缩空间，前景虚影包围中间主体。" }
      }
    ]
  }], ["three-person-composition"], "zh-CN", "image");

  assert.equal(reference.referenceKind, "prompt_vision");
  assert.match(reference.referenceText, /\[图片1可见事实\][\s\S]*中间女性清晰聚焦/);
  assert.match(reference.referenceText, /\[图片2可见事实\][\s\S]*前景虚影/);
  assert.match(reference.referenceText, /\[案例原提示词\][\s\S]*电影级长焦镜头/);
  assert.doesNotMatch(reference.referenceText, /private title/);
});

test("asset-scoped reference snapshot freezes the active secondary image, its own prompt, and its own V2 analysis", () => {
  const entry = {
    id: "multi-image",
    title: "多图案例",
    text: "案例共享提示词",
    classification: { pathIds: [CONTENT_IDS.promptImage] },
    primaryMediaId: "image-main",
    mediaPrompts: [
      { assetId: "image-secondary", text: "副图独立提示词", source: "manual", updatedAt: "2026-08-09T00:00:00.000Z" }
    ],
    mediaAssets: [
      { id: "image-main", kind: "image", usage: "content", mimeType: "image/webp" },
      {
        id: "image-secondary",
        kind: "image",
        usage: "content",
        mimeType: "image/png",
        contentHash: "a".repeat(64),
        visionAnalysis: {
          version: 2,
          imageFingerprint: "a".repeat(64),
          profileFingerprint: "b".repeat(64),
          description: "副图中央是一只白猫。",
          reconstructionPrompt: "正方形画面，白猫居中，柔和窗光。"
        }
      }
    ]
  };
  const [reference] = createReferenceSnapshots([entry], [{ entryId: entry.id, assetIds: ["image-secondary"] }], "zh-CN", "image");
  assert.equal(reference.scope, "asset");
  assert.equal(reference.referenceId, "multi-image:image-secondary");
  assert.equal(reference.assetId, "image-secondary");
  assert.equal(reference.originalText, "副图独立提示词");
  assert.deepEqual(reference.imageRefs, [{ visualId: "image-secondary", mimeType: "image/png" }]);
  assert.equal(reference.referenceText.includes("副图独立提示词"), true);
  assert.equal(reference.referenceText.includes("白猫居中"), true);
  assert.equal(reference.referenceText.includes("案例共享提示词"), false);
  assert.equal(reference.assets[0].assetId, "image-secondary");
  assert.equal(reference.assets[0].analysisVersion, 2);
});

test("multiple selected images from one case become independent reference snapshots", () => {
  const entry = {
    id: "case-with-three",
    title: "三图案例",
    text: "共享说明",
    classification: { pathIds: [CONTENT_IDS.promptImage] },
    mediaPrompts: [
      { assetId: "one", text: "第一张" },
      { assetId: "two", text: "第二张" }
    ],
    mediaAssets: [
      { id: "one", kind: "image", usage: "content", mimeType: "image/png" },
      { id: "two", kind: "image", usage: "content", mimeType: "image/png" }
    ]
  };
  const references = createReferenceSnapshots([entry], [{ entryId: entry.id, assetIds: ["one", "two"] }], "zh-CN", "image");
  assert.equal(references.length, 2);
  assert.deepEqual(references.map((item) => item.referenceId), ["case-with-three:one", "case-with-three:two"]);
  assert.deepEqual(references.map((item) => item.originalText), ["第一张", "第二张"]);
  assert.deepEqual(references.map((item) => item.alias), ["@参考1", "@参考2"]);
});

test("image reference modes default to conditioned and unlock text-only modes for prompt-backed or independently analyzed assets", () => {
  const analyzedReference = {
    entryId: "case-a",
    alias: "@参考1",
    scope: "asset",
    referenceText: "完整分析",
    imageRefs: [{ visualId: "image-a", mimeType: "image/webp" }],
    assets: [{
      assetId: "image-a",
      imageFingerprint: "a".repeat(64),
      analysisVersion: 2,
      analysisFingerprint: "b".repeat(64),
      reconstructionPrompt: "可独立生图的文字"
    }]
  };
  const defaultSession = createComposerSession({ referenceSnapshots: [analyzedReference] });
  assert.equal(defaultSession.imageReferenceMode, "conditioned");
  assert.deepEqual(imageReferenceModeAvailability(defaultSession.referenceSnapshots), {
    canDisableImages: true,
    missingAssetIds: []
  });
  assert.equal(createComposerSession({
    ...defaultSession,
    imageReferenceMode: "text_only"
  }).imageReferenceMode, "text_only");

  const promptBackedReference = {
    entryId: "case-with-prompt",
    alias: "@参考1",
    originalText: "雨夜石桥上的巨龙",
    referenceText: "雨夜石桥上的巨龙",
    imageRefs: [{ visualId: "prompt-image", mimeType: "image/webp" }],
    assets: [{ assetId: "prompt-image" }]
  };
  assert.deepEqual(imageReferenceModeAvailability([promptBackedReference]), {
    canDisableImages: true,
    missingAssetIds: []
  });
  assert.equal(createComposerSession({
    referenceSnapshots: [promptBackedReference],
    imageReferenceMode: "text_only"
  }).imageReferenceMode, "text_only");

  const unavailable = imageReferenceModeAvailability([{
    entryId: "pure-image",
    alias: "@参考1",
    imageRefs: [{ visualId: "image-a", mimeType: "image/webp" }],
    assets: [{ assetId: "image-a", analysisVersion: 1, reconstructionPrompt: "旧描述" }]
  }]);
  assert.equal(unavailable.canDisableImages, false);
  assert.deepEqual(unavailable.missingAssetIds, ["image-a"]);
  assert.equal(createComposerSession({
    referenceSnapshots: [{ entryId: "pure-image", alias: "@参考1", imageRefs: [{ visualId: "image-a" }], assets: [] }],
    imageReferenceMode: "text_only"
  }).imageReferenceMode, "conditioned");

  const mixed = imageReferenceModeAvailability([
    promptBackedReference,
    {
      entryId: "another-pure-image",
      alias: "@参考2",
      imageRefs: [{ visualId: "image-b", mimeType: "image/webp" }],
      assets: [{ assetId: "image-b" }]
    }
  ]);
  assert.equal(mixed.canDisableImages, false);
  assert.deepEqual(mixed.missingAssetIds, ["image-b"]);
});

test("a saved V2 analysis remains eligible for text-only mode when an older asset omitted its duplicate content hash", () => {
  const fingerprint = "c".repeat(64);
  const session = createComposerSession({
    imageReferenceMode: "text_only",
    referenceSnapshots: [{
      entryId: "legacy-content-hash",
      alias: "@参考1",
      imageRefs: [{ visualId: "image-a", mimeType: "image/webp" }],
      assets: [{
        assetId: "image-a",
        imageFingerprint: "",
        analysisImageFingerprint: fingerprint,
        analysisVersion: 2,
        analysisFingerprint: "profile-v2",
        reconstructionPrompt: "可独立重建原图的完整提示词"
      }]
    }]
  });
  assert.equal(session.imageReferenceMode, "text_only");
  assert.deepEqual(imageReferenceModeAvailability(session.referenceSnapshots), {
    canDisableImages: true,
    missingAssetIds: []
  });
});

test("planner payload sends selected and retrieved text without local titles, IDs, or the rest of the library", () => {
  const session = createComposerSession({
    outputLanguage: "zh-CN",
    referenceSnapshots: [{ entryId: "manual", alias: "@参考1", title: "private title", referenceText: "warm rim light" }],
    retrievedSources: [{ entryId: "private-search", alias: "@检索1", title: "secret guide", role: "guide", referenceKind: "document", text: "先确定主光方向" }]
  });
  const payload = plannerRequestPayload(session, "主体改成猫", normalizeComposerSettings());
  assert.deepEqual(payload.references, [{ alias: "@参考1", referenceKind: "prompt", referenceText: "warm rim light", imageCount: 0 }]);
  assert.deepEqual(payload.retrievedSources, [{ alias: "@检索1", role: "guide", referenceKind: "document", text: "先确定主光方向" }]);
  assert.equal(JSON.stringify(payload).includes("private title"), false);
  assert.equal(JSON.stringify(payload).includes("secret guide"), false);
  assert.equal(JSON.stringify(payload).includes("private-search"), false);
});

test("lightweight planning lets a featured case keep the scene while a Jimeng reference replaces only the character", async () => {
  const requests = [];
  const fetchImpl = async (_url, options) => {
    const body = JSON.parse(options.body);
    requests.push(body);
    return body.stream
      ? sseResponse("自拍片场中的短发女性，保持原镜头与背景关系")
      : jsonResponse({
          route: "compose",
          status: "ready",
          suggestedTitle: "角色替换",
          instruction: "保留@参考1的场景、镜头和背景关系，只用@参考2替换人物外观与服装。",
          question: null,
          librarySearch: null
        });
  };
  const session = createComposerSession({
    productionReviewEnabled: true,
    referenceSnapshots: [
      { entryId: "featured", alias: "@参考1", referenceText: "自拍片场，固定镜头，人物位于化妆镜前。" },
      { entryId: "jimeng-character", alias: "@参考2", referenceText: "短发女性角色，黑色夹克。" }
    ]
  });
  const input = { session, userMessage: "保留参考1，只把角色换成参考2", composerSettings: normalizeComposerSettings() };
  const planned = await planComposerTurn(input, aiSettings, { fetchImpl });
  const generated = await executeAgentTurn({ ...input, route: planned.route, instruction: planned.instruction }, aiSettings, { fetchImpl });

  assert.match(generated.finalPrompt, /自拍片场中的短发女性/);
  assert.equal(requests.length, 2);
  const executionPayload = JSON.parse(requests[1].messages.at(-1).content);
  assert.deepEqual(executionPayload.references.map((item) => item.alias), ["@参考1", "@参考2"]);
  assert.equal(executionPayload.instruction, planned.instruction);
  assert.equal(JSON.stringify(executionPayload).includes("dimensionUses"), false);
});

test("planner keeps button questions but malformed optional fields fall back to the original request", () => {
  const question = normalizePlannerResult({
    route: "compose",
    status: "needs_clarification",
    question: { text: "采用连续一镜还是多镜头？", options: ["连续一镜", "多镜头", "自由处理"] }
  });
  assert.equal(question.status, "needs_clarification");
  assert.equal(question.question.recommendedAnswer, "连续一镜");
  assert.equal(question.question.options.length, 3);

  const fallback = normalizePlannerResult({ route: "unknown", status: "needs_clarification", question: { text: "缺少选项" } }, {
    route: "compose",
    instruction: "按原始要求生成"
  });
  assert.equal(fallback.status, "ready");
  assert.equal(fallback.route, "compose");
  assert.equal(fallback.instruction, "按原始要求生成");
  assert.equal(fallback.degraded, true);
  assert.match(fallback.notice, /原始要求继续/);
});

test("planner returns an explicit local search request without performing a third model call", async () => {
  const result = await planComposerTurn({
    session: createComposerSession(),
    userMessage: "从我的案例和教程里找霓虹夜景参考",
    composerSettings: normalizeComposerSettings()
  }, aiSettings, { fetchImpl: async () => jsonResponse({
    route: "compose",
    status: "ready",
    instruction: "结合手选参考与本地检索资料生成夜景画面。",
    librarySearch: { query: "霓虹 夜景", contentRoles: ["case", "guide", "invalid"] }
  }) });
  assert.deepEqual(result.librarySearch, { query: "霓虹 夜景", contentRoles: ["case", "guide"] });
});

test("automatic routing accepts analysis while a manual route cannot be rewritten", async () => {
  const automatic = await planComposerTurn({
    session: createComposerSession({ routeMode: "auto" }),
    userMessage: "分析资料差异",
    composerSettings: normalizeComposerSettings()
  }, aiSettings, { fetchImpl: async () => jsonResponse({ route: "analyze_materials", status: "ready", instruction: "比较本轮资料的风格差异。" }) });
  assert.equal(automatic.route, "analyze_materials");

  await assert.rejects(() => planComposerTurn({
    session: createComposerSession({ routeMode: "chat" }),
    userMessage: "解释这个概念",
    composerSettings: normalizeComposerSettings()
  }, aiSettings, { fetchImpl: async () => jsonResponse({ route: "compose", status: "ready", instruction: "生成提示词" }) }), /改写了用户手动选择的任务/);
});

test("light review changes only the execution instruction and never requires a report", async () => {
  const systemPrompts = [];
  for (const enabled of [true, false]) {
    await executeAgentTurn({
      session: createComposerSession({ productionReviewEnabled: enabled }),
      userMessage: "生成电影海报",
      composerSettings: normalizeComposerSettings({ productionReviewEnabled: enabled }),
      route: "compose",
      instruction: "生成一张电影海报"
    }, aiSettings, { fetchImpl: async (_url, options) => {
      const body = JSON.parse(options.body);
      systemPrompts.push(body.messages[0].content);
      assert.equal(JSON.stringify(body).includes('"productionReview"'), false);
      return sseResponse("电影海报，清晰主体与环境关系");
    } });
  }
  assert.match(systemPrompts[0], /不要输出审核报告/);
  assert.match(systemPrompts[1], /不要额外进行生产审核改写/);
});

test("composer reports exact characters and blocks oversized requests before fetch", async () => {
  const session = createComposerSession();
  const settings = normalizeComposerSettings();
  const usage = composerInputUsage(session, "生成海报", settings);
  assert.equal(usage.characters, JSON.stringify(plannerRequestPayload(session, "生成海报", settings)).length);

  let fetched = false;
  await assert.rejects(() => planComposerTurn({
    session,
    userMessage: "x".repeat(COMPOSER_INPUT_MAX_CHARACTERS),
    composerSettings: settings
  }, aiSettings, { fetchImpl: async () => { fetched = true; return jsonResponse({}); } }), /超过/);
  assert.equal(fetched, false);
});

test("planning can be stopped before DeepSeek returns", async () => {
  const controller = new AbortController();
  const promise = planComposerTurn({
    session: createComposerSession(),
    userMessage: "生成海报",
    composerSettings: normalizeComposerSettings()
  }, aiSettings, { signal: controller.signal, fetchImpl: async (_url, options) => new Promise((_resolve, reject) => {
    options.signal.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), { once: true });
  }) });
  controller.abort();
  await assert.rejects(promise, /Aborted/);
});

test("DeepSeek failures expose safe retry categories", () => {
  assert.equal(deepSeekErrorDetails(new DeepSeekApiError("rate", 429)).kind, "rate_limit");
  assert.equal(deepSeekErrorDetails(new DeepSeekApiError("timeout", 408)).kind, "timeout");
  assert.equal(deepSeekErrorDetails(new DOMException("Aborted", "AbortError")).kind, "stopped");
  assert.equal(deepSeekErrorDetails(new Error("unexpected response")).kind, "unknown");
});

test("DeepSeek SSE handles fragmented UTF-8, usage, and DONE", async () => {
  const bytes = new TextEncoder().encode("data: {\"choices\":[{\"delta\":{\"content\":\"你好\"},\"finish_reason\":null}]}\n\ndata: {\"choices\":[{\"delta\":{},\"finish_reason\":\"stop\"}],\"usage\":{\"prompt_tokens\":4,\"completion_tokens\":2,\"total_tokens\":6}}\n\ndata: [DONE]\n\n");
  const response = new Response(new ReadableStream({
    start(controller) {
      controller.enqueue(bytes.slice(0, 17));
      controller.enqueue(bytes.slice(17, 54));
      controller.enqueue(bytes.slice(54));
      controller.close();
    }
  }), { status: 200 });
  const deltas = [];
  const result = await readDeepSeekSse(response, (delta) => deltas.push(delta));
  assert.equal(result.content, "你好");
  assert.deepEqual(result.usage, { promptTokens: 4, completionTokens: 2, totalTokens: 6, cacheHitTokens: 0, cacheMissTokens: 0 });
  assert.deepEqual(deltas, ["你好"]);
});

test("generated prompts remain self-contained", () => {
  assert.equal(validateGeneratedPrompt("完整、自包含的提示词"), "完整、自包含的提示词");
  assert.throws(() => validateGeneratedPrompt("参考 @参考1 的画面"), /仍依赖参考素材/);
  assert.throws(() => validateGeneratedPrompt(""), /没有返回完整提示词/);
});

test("completed versions keep lightweight instruction and retrieval snapshots", () => {
  const session = appendPromptVersion(createComposerSession(), {
    text: "完整提示词",
    productionReviewEnabled: true,
    retrievedSources: [{ entryId: "guide", alias: "@检索1", title: "布光攻略", role: "guide", referenceKind: "document", text: "先确定主光" }],
    instructionSnapshot: { agentVersion: "3.0.0", route: "compose", routeSource: "auto", instruction: "保留场景，替换角色", outputLanguage: "zh-CN" }
  });
  assert.equal(session.promptVersions[0].instructionSnapshot.instruction, "保留场景，替换角色");
  assert.equal(session.promptVersions[0].retrievedSources[0].role, "guide");
  assert.equal(Object.hasOwn(session.promptVersions[0], "productionReview"), false);
});

test("diagnostic events and one visible assistant response preserve conversation order", () => {
  let session = createComposerSession({ messages: [{ role: "user", content: "第一次" }] });
  session = appendDiagnosticEvent(session, { phase: "planning", status: "completed", detail: "轻量规划完成" });
  session = appendComposerMessage(session, { role: "assistant", type: "chat", content: "唯一回答", route: "chat" });
  session = appendComposerMessage(session, { role: "assistant", type: "plan", content: "旧内部规划" });
  const normalized = createComposerSession(session);
  assert.deepEqual(normalized.messages.map((item) => item.content), ["第一次", "唯一回答"]);
  assert.equal(normalized.diagnosticEvents.length, 1);
});

function jsonResponse(content) {
  return new Response(JSON.stringify({
    choices: [{ finish_reason: "stop", message: { content: JSON.stringify(content) } }],
    usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 }
  }), { status: 200, headers: { "Content-Type": "application/json" } });
}

function sseResponse(content) {
  const encoder = new TextEncoder();
  return new Response(new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode(`data: ${JSON.stringify({ choices: [{ delta: { content }, finish_reason: null }] })}\n\n`));
      controller.enqueue(encoder.encode(`data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: "stop" }], usage: { prompt_tokens: 20, completion_tokens: 12, total_tokens: 32 } })}\n\n`));
      controller.enqueue(encoder.encode("data: [DONE]\n\n"));
      controller.close();
    }
  }), { status: 200, headers: { "Content-Type": "text/event-stream" } });
}
