import test from "node:test";
import assert from "node:assert/strict";

import {
  acceptAnalysisCandidate,
  applyAnalysisCandidates,
  applyAnalysisImport,
  applyTextAnalysisTags,
  applyVisionAnalysis,
  editVisionReconstructionPrompt,
  extractStructureCandidates,
  invalidateVisionForScreenshot,
  mergeAnalysisCandidates,
  rejectAnalysisCandidate,
  restoreVisionAfterScreenshot,
  undoVisionAnalysis
} from "../analysis-candidates.js";
import { createDefaultFacetCatalog } from "../facets.js";
import {
  DeepSeekApiError,
  analyzeTextDetailedWithDeepSeek,
  analyzeTextWithDeepSeek,
  isRetryableDeepSeekError,
  mergeAiSettings,
  normalizeAiSettings,
  planComposerTurn
} from "../deepseek.js";
import { createComposerSession, normalizeComposerSettings } from "../composer.js";
import { applyFixedAnalysisTags } from "../tag-taxonomy.js";

test("structured fields become editable evidence-backed candidates without fixed dimensions", () => {
  const candidates = extractStructureCandidates({ text: '{"lighting":"large softbox","camera":{"lens":"35mm"}}\nCUSTOM LOOK: faded print\nPrice: $20' });
  assert.ok(candidates.some((item) => item.dimensionName === "lighting" && item.tagName === "large softbox"));
  assert.ok(candidates.some((item) => item.dimensionName === "camera" && item.groupName === "lens" && item.tagName === "35mm"));
  assert.ok(candidates.some((item) => item.dimensionName === "CUSTOM LOOK" && item.tagName === "faded print"));
  assert.equal(candidates.some((item) => item.dimensionName === "Price"), false);
  assert.ok(candidates.every((item) => item.status === "suggested" && item.evidence));
});

test("accepting a legacy candidate maps into the fixed tree while rejection prevents repetition", () => {
  const incoming = [{ dimensionName: "视觉风格", groupName: "电影流派", tagName: "黑色电影", evidence: "noir lighting", confidence: 0.9 }];
  const entry = mergeAnalysisCandidates({ id: "one", facetAssignments: [] }, incoming);
  let state = acceptAnalysisCandidate({ facetCatalog: createDefaultFacetCatalog(), entries: [entry] }, "one", entry.analysisCandidates[0].id);
  assert.equal(state.facetCatalog.facets.length, 10);
  const assignedNode = state.facetCatalog.nodes.find((item) => item.id === state.entries[0].facetAssignments[0].nodeId);
  assert.equal(assignedNode.parentId, "style.art");
  assert.equal(state.entries[0].facetAssignments[0].source, "manual");

  const second = mergeAnalysisCandidates({ id: "two", analysisCandidates: [] }, incoming);
  const rejected = rejectAnalysisCandidate(second, second.analysisCandidates[0].id);
  assert.equal(mergeAnalysisCandidates(rejected, incoming).analysisCandidates.length, 0);
});

test("DeepSeek text client requests one to ten compact fixed-path tags without sending dynamic vocabulary", async () => {
  let request;
  const returnedTags = Array.from({ length: 10 }, (_, index) => ({ g: "style.texture", t: `标签${index + 1}` }));
  const fetchStub = async (_url, options) => {
    request = JSON.parse(options.body);
    return { ok: true, json: async () => ({ choices: [{ message: { content: JSON.stringify({ tags: returnedTags }) } }] }) };
  };
  const result = await analyzeTextWithDeepSeek({ title: "test", text: "strong backlight" }, createDefaultFacetCatalog(), { apiKey: "secret", consent: true }, fetchStub);
  assert.deepEqual(result.map((item) => item.t), Array.from({ length: 10 }, (_, index) => `标签${index + 1}`));
  assert.deepEqual(Object.keys(result[0]).sort(), ["g", "t"]);
  assert.deepEqual(request.thinking, { type: "disabled" });
  assert.equal(request.messages.some((item) => /image|data:image/.test(item.content) && !/不分析或猜测图片/.test(item.content)), false);
  assert.equal(request.max_tokens, 1000);
  assert.match(request.messages[0].content, /1–10/);
  assert.doesNotMatch(JSON.stringify(request.messages), /标签1|currentVocabulary/);
  assert.doesNotMatch(request.messages[0].content, /confidence|importance|reviewReason|evidence/);
});

test("DeepSeek corrects one empty tag response and counts both paid requests", async () => {
  const requests = [];
  const responses = [
    {
      usage: { prompt_tokens: 11, completion_tokens: 1, total_tokens: 12 },
      choices: [{ finish_reason: "stop", message: { content: '{"tags":[]}' } }]
    },
    {
      usage: { prompt_tokens: 13, completion_tokens: 2, total_tokens: 15 },
      choices: [{ finish_reason: "stop", message: { content: '{"tags":[{"g":"light.direction","t":"逆光"}]}' } }]
    }
  ];
  const result = await analyzeTextDetailedWithDeepSeek(
    { title: "test", text: "strong backlight" },
    createDefaultFacetCatalog(),
    { apiKey: "secret", consent: true },
    async (_url, options) => {
      requests.push(JSON.parse(options.body));
      return { ok: true, json: async () => responses.shift() };
    }
  );

  assert.deepEqual(result.tags, [{ g: "light.direction", t: "逆光" }]);
  assert.deepEqual(result.usage, {
    promptTokens: 24,
    completionTokens: 3,
    totalTokens: 27,
    cacheHitTokens: 0,
    cacheMissTokens: 0
  });
  assert.equal(requests.length, 2);
  assert.equal(requests[0].messages.length + 1, requests[1].messages.length);
  assert.equal(requests[1].messages.at(-1).role, "user");
  assert.match(requests[1].messages.at(-2).content, /1–10/);
  assert.match(requests[1].messages.at(-2).content, /不能返回空 tags/);
  assert.match(requests[1].messages.at(-2).content, /省略 t/);
});

test("DeepSeek rejects a second empty response without retrying forever", async () => {
  let requestCount = 0;
  const diagnostics = [];
  await assert.rejects(
    () => analyzeTextDetailedWithDeepSeek(
      { title: "test", text: "strong backlight" },
      createDefaultFacetCatalog(),
      { apiKey: "secret", consent: true },
      async () => {
        requestCount += 1;
        return {
          ok: true,
          json: async () => ({
            usage: { prompt_tokens: 5, completion_tokens: 1, total_tokens: 6 },
            choices: [{ finish_reason: "stop", message: { content: '{"tags":[]}' } }]
          })
        };
      },
      { onDiagnostic: (event) => diagnostics.push(event) }
    ),
    (error) => {
      assert.match(error.message, /必须返回 1–10 个标签/);
      assert.equal(error.usage.totalTokens, 12);
      return true;
    }
  );
  assert.equal(requestCount, 2);
  assert.deepEqual(
    diagnostics.filter((event) => event.stage === "validation_failed").map((event) => event.category),
    ["count", "count"]
  );
});

test("a failed correction request keeps prior usage and cannot restart the whole case", async () => {
  let requestCount = 0;
  await assert.rejects(
    () => analyzeTextDetailedWithDeepSeek(
      { title: "test", text: "strong backlight" },
      createDefaultFacetCatalog(),
      { apiKey: "secret", consent: true },
      async () => {
        requestCount += 1;
        if (requestCount === 1) {
          return {
            ok: true,
            json: async () => ({
              usage: { prompt_tokens: 5, completion_tokens: 1, total_tokens: 6 },
              choices: [{ finish_reason: "stop", message: { content: '{"tags":[]}' } }]
            })
          };
        }
        return {
          ok: false,
          status: 503,
          headers: { get: () => null },
          json: async () => ({ error: { message: "busy" } })
        };
      }
    ),
    (error) => {
      assert.ok(error instanceof DeepSeekApiError);
      assert.equal(error.usage.totalTokens, 6);
      assert.equal(isRetryableDeepSeekError(error), false);
      return true;
    }
  );
  assert.equal(requestCount, 2);
});

test("a stalled correction request times out without restarting the whole case", async () => {
  let requestCount = 0;
  const startedAt = Date.now();
  const diagnostics = [];
  await assert.rejects(
    () => analyzeTextDetailedWithDeepSeek(
      { title: "test", text: "strong backlight" },
      createDefaultFacetCatalog(),
      { apiKey: "secret", consent: true },
      async (_url, options) => {
        requestCount += 1;
        if (requestCount === 1) {
          return {
            ok: true,
            json: async () => ({
              usage: { prompt_tokens: 5, completion_tokens: 1, total_tokens: 6 },
              choices: [{ finish_reason: "stop", message: { content: '{"tags":[]}' } }]
            })
          };
        }
        return new Promise((_resolve, reject) => {
          options.signal.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), { once: true });
        });
      },
      { timeoutMs: 10, onDiagnostic: (event) => diagnostics.push(event) }
    ),
    (error) => {
      assert.ok(error instanceof DeepSeekApiError);
      assert.equal(error.status, 408);
      assert.equal(error.usage.totalTokens, 6);
      assert.equal(isRetryableDeepSeekError(error), false);
      return true;
    }
  );
  assert.equal(requestCount, 2);
  assert.ok(Date.now() - startedAt < 500);
  assert.deepEqual(diagnostics.map((event) => [event.stage, event.attempt]), [
    ["request_started", "initial"],
    ["response_received", "initial"],
    ["validation_failed", "initial"],
    ["request_started", "correction"],
    ["request_failed", "correction"]
  ]);
  assert.equal(diagnostics.at(-1).category, "timeout");
  assert.equal(diagnostics.at(-1).status, 408);
});

test("custom analysis instructions are appended without replacing the fixed JSON protocol", async () => {
  let request;
  const fetchStub = async (_url, options) => {
    request = JSON.parse(options.body);
    return { ok: true, json: async () => ({ choices: [{ message: { content: '{"tags":[{"g":"camera.lens","t":"35mm"}]}' } }] }) };
  };
  await analyzeTextWithDeepSeek(
    { title: "test", text: "strong backlight", contentTypeName: "工作文档", contentRole: "general" },
    createDefaultFacetCatalog(),
    {
      apiKey: "secret",
      consent: true,
      outputLocale: "en",
      analysisInstructionsByLocale: { en: "Prefer filmmaking terminology." }
    },
    fetchStub
  );
  assert.ok(request.messages.some((item) => item.content.includes("Prefer filmmaking terminology.")));
  assert.ok(request.messages.some((item) => item.content.includes('"tags"')));
  assert.equal(request.messages.some((item) => /confidence|importance|reviewReason|evidence/.test(item.content)), false);
  assert.equal(request.messages.at(-2).content, "Prefer filmmaking terminology.");
  assert.equal(request.messages.at(-1).role, "user");
  assert.deepEqual(JSON.parse(request.messages.at(-1).content), {
    contentType: "工作文档",
    title: "test",
    text: "strong backlight"
  });
});

test("DeepSeek analysis labels follow the selected interface language", async () => {
  const requests = [];
  const fetchStub = async (_url, options) => {
    requests.push(JSON.parse(options.body));
    return { ok: true, json: async () => ({ choices: [{ message: { content: '{"tags":[{"g":"light.direction","t":"backlight"}]}' } }] }) };
  };
  const entry = { title: "test", text: "strong backlight" };
  const settings = { apiKey: "secret", consent: true };

  await analyzeTextWithDeepSeek(entry, createDefaultFacetCatalog(), { ...settings, outputLocale: "en" }, fetchStub);
  await analyzeTextWithDeepSeek(entry, createDefaultFacetCatalog(), { ...settings, outputLocale: "zh-CN" }, fetchStub);

  assert.match(requests[0].messages[0].content, /detail tag t in English/);
  assert.match(requests[1].messages[0].content, /三级标签 t 使用简体中文/);
});

test("DeepSeek requires explicit text-sharing consent before sending anything", async () => {
  let called = false;
  await assert.rejects(
    () => analyzeTextWithDeepSeek(
      { title: "test", text: "strong backlight" },
      createDefaultFacetCatalog(),
      { apiKey: "secret", consent: false },
      async () => { called = true; }
    ),
    /发送到 DeepSeek/
  );
  assert.equal(called, false);
});

test("DeepSeek text analysis accepts an external abort signal", async () => {
  const controller = new AbortController();
  const request = analyzeTextDetailedWithDeepSeek(
    { title: "test", text: "strong backlight" },
    createDefaultFacetCatalog(),
    { apiKey: "secret", consent: true },
    async (_url, options) => new Promise((_resolve, reject) => {
      options.signal.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), { once: true });
    }),
    { signal: controller.signal }
  );

  controller.abort();
  await assert.rejects(request, (error) => error?.name === "AbortError");
});

test("local OpenAI-compatible text analysis works without a key and never changes local save behavior", async () => {
  let request;
  const result = await analyzeTextWithDeepSeek(
    { title: "test", text: "strong backlight" },
    createDefaultFacetCatalog(),
    {
      activeProvider: "compatible", consent: true,
      compatible: { endpoint: "http://localhost:1234/v1/chat/completions", model: "local-model" }
    },
    async (url, options) => {
      assert.equal(url, "http://localhost:1234/v1/chat/completions");
      assert.equal(options.headers.Authorization, undefined);
      request = JSON.parse(options.body);
      return { ok: true, headers: { get: () => null }, json: async () => ({
        model: "local-model", choices: [{ finish_reason: "stop", message: { content: '{"tags":[{"g":"light.direction","t":"backlight"}]}' } }]
      }) };
    }
  );
  assert.equal(request.model, "local-model");
  assert.deepEqual(result, [{ g: "light.direction", t: "backlight" }]);
});

test("text compatible API key is cleared when the endpoint origin changes", () => {
  const { settings, credentialReset } = mergeAiSettings({
    activeProvider: "compatible",
    consent: true,
    compatible: { endpoint: "https://first.example/v1/chat/completions", model: "model-a", apiKey: "private-key" }
  }, {
    activeProvider: "compatible",
    consent: true,
    compatible: { endpoint: "https://second.example/v1/chat/completions", model: "model-b" }
  });
  assert.equal(credentialReset, true);
  assert.equal(settings.compatible.apiKey, "");
});

test("composer planner sends only prompt originals and vision descriptions as untrusted text references", async () => {
  let request;
  const fetchStub = async (_url, options) => {
    request = JSON.parse(options.body);
    return {
      ok: true,
      json: async () => ({
        model: "deepseek-v4-pro",
        usage: { prompt_tokens: 120, completion_tokens: 45, total_tokens: 165 },
        choices: [{ message: { content: JSON.stringify({
          route: "compose",
          status: "ready",
          suggestedTitle: "暖光庭院",
          instruction: "只借鉴@参考1的轮廓光层次，主体采用用户要求的武侠庭院。",
          librarySearch: null
        }) } }]
      })
    };
  };
  const session = createComposerSession({
    targetType: "image",
    referenceSnapshots: [
      { entryId: "one", alias: "@参考1", referenceKind: "prompt", referenceText: "strong backlight on a branded robot" },
      { entryId: "two", alias: "@Reference2", referenceKind: "vision", referenceText: "A quiet courtyard in mist." }
    ]
  });
  const result = await planComposerTurn({ session, userMessage: "@参考1 只借鉴灯光，主体改为武侠庭院", composerSettings: normalizeComposerSettings() }, { apiKey: "secret", consent: true }, { fetchImpl: fetchStub });

  const payload = JSON.parse(request.messages[1].content);
  assert.deepEqual(payload.references, [
    { alias: "@参考1", referenceKind: "prompt", referenceText: "strong backlight on a branded robot", imageCount: 0 },
    { alias: "@Reference2", referenceKind: "vision", referenceText: "A quiet courtyard in mist.", imageCount: 0 }
  ]);
  assert.equal(JSON.stringify(payload).includes("https://"), false);
  assert.equal(JSON.stringify(payload).includes("palette"), false);
  assert.match(request.messages[0].content, /自然语言说明/);
  assert.match(request.messages[0].content, /只问一个问题/);
  assert.doesNotMatch(request.messages[0].content, /dimensionUses|preserveMode/);
  assert.equal(request.model, "deepseek-v4-flash");
  assert.deepEqual(request.thinking, { type: "disabled" });
  assert.equal(Object.hasOwn(request, "reasoning_effort"), false);
  assert.equal(result.status, "ready");
  assert.equal(result.instruction, "只借鉴@参考1的轮廓光层次，主体采用用户要求的武侠庭院。");
  assert.equal(result.usage.totalTokens, 165);
});

test("composer planner uses Pro thinking only when the conversation explicitly selects it", async () => {
  let request;
  const fetchStub = async (_url, options) => {
    request = JSON.parse(options.body);
    return new Response(JSON.stringify({
      choices: [{ finish_reason: "stop", message: { content: JSON.stringify({
        route: "compose",
        status: "ready",
        suggestedTitle: "海报",
        instruction: "按用户要求生成一张海报。"
      }) } }]
    }), { status: 200, headers: { "Content-Type": "application/json" } });
  };
  const session = createComposerSession({ aiProfile: { model: "deepseek-v4-pro", thinking: true } });
  await planComposerTurn(
    { session, userMessage: "生成一张海报", composerSettings: normalizeComposerSettings() },
    { apiKey: "secret", consent: true },
    { fetchImpl: fetchStub }
  );
  assert.equal(request.model, "deepseek-v4-pro");
  assert.deepEqual(request.thinking, { type: "enabled" });
  assert.equal(request.reasoning_effort, "high");
});

test("text analysis applies one to ten validated tags directly and never creates review candidates", () => {
  const state = {
    facetCatalog: createDefaultFacetCatalog(),
    entries: [{
      id: "one",
      facetAssignments: [],
      analysisCandidates: [{ dimensionName: "旧维度", tagName: "旧待确认", source: "deepseek_text" }],
      analysisBreakdown: [{ dimensionName: "旧维度", tagName: "旧拆解", source: "deepseek_text" }]
    }]
  };
  const applied = applyTextAnalysisTags(state, "one", [
    ...Array.from({ length: 8 }, (_, index) => ({ g: "style.render", t: `标签${index + 1}` }))
  ]);

  assert.equal(applied.appliedCount, 8);
  assert.deepEqual(applied.state.entries[0].facetAssignments.map((item) => item.source), Array(8).fill("deepseek_text"));
  assert.deepEqual(applied.state.entries[0].analysisCandidates, []);
  assert.deepEqual(applied.state.entries[0].analysisBreakdown, []);
});

test("an empty text analysis is rejected without changing existing tags", () => {
  const state = {
    facetCatalog: {
      version: 2, revision: 1,
      facets: [{ id: "style", name: "视觉风格", color: "#111111", order: 0, aliases: [], status: "active" }],
      nodes: [
        { id: "manual", facetId: "style", parentId: null, name: "人工风格", order: 0, aliases: [], patterns: [], status: "active" },
        { id: "automatic", facetId: "style", parentId: null, name: "旧自动风格", order: 1, aliases: [], patterns: [], status: "active" }
      ]
    },
    entries: [{
      id: "one",
      facetAssignments: [
        { facetId: "style", nodeId: "manual", status: "confirmed", source: "manual" },
        { facetId: "style", nodeId: "automatic", status: "confirmed", source: "deepseek_text" }
      ],
      analysisCandidates: []
    }]
  };
  assert.throws(() => applyTextAnalysisTags(state, "one", []), /1–10/);
  assert.deepEqual(state.entries[0].facetAssignments.map((item) => item.nodeId), ["manual", "automatic"]);
});

test("text analysis can assign a fixed group directly or create a detail below it", () => {
  const state = {
    facetCatalog: createDefaultFacetCatalog(),
    entries: [{ id: "one", facetAssignments: [], analysisCandidates: [], analysisBreakdown: [] }]
  };
  const applied = applyTextAnalysisTags(state, "one", [
    { g: "mood.atmosphere" },
    { g: "mood.atmosphere", t: "梦境柔焦" }
  ]);
  assert.equal(applied.appliedCount, 2);
  assert.equal(applied.state.entries[0].facetAssignments[0].nodeId, "mood.atmosphere");
  const assigned = applied.state.facetCatalog.nodes.find((item) => item.id === applied.state.entries[0].facetAssignments[1].nodeId);
  assert.equal(assigned.parentId, "mood.atmosphere");
});

test("vision analysis replaces only vision tags and can be undone once", () => {
  let state = { facetCatalog: createDefaultFacetCatalog(), entries: [{ id: "image", facetAssignments: [] }] };
  state = applyFixedAnalysisTags(state, "image", [{ g: "style.render", t: "人工风格" }], { source: "manual" }).state;
  state = applyFixedAnalysisTags(state, "image", [{ g: "style.render", t: "文字标签" }], { source: "deepseek_text", replaceExisting: false }).state;
  state = applyFixedAnalysisTags(state, "image", [{ g: "style.render", t: "旧视觉标签" }], { source: "vision_model", replaceExisting: false }).state;
  state.entries[0].visionAnalysis = { reconstructionPrompt: "旧反推提示词", imageFingerprint: "old", userEdited: true };
  const beforeNodeIds = state.entries[0].facetAssignments.map((item) => item.nodeId);
  const applied = applyVisionAnalysis(state, "image", {
    reconstructionPrompt: "新反推提示词：逆光人物站在潮湿街道中央，电影写实风格。",
    tags: [
      { g: "style.render", t: "人工风格" },
      { g: "light.direction", t: "逆光" }
    ]
  }, { imageFingerprint: "new", locale: "zh-CN", providerType: "openai", model: "gpt-5-mini" });
  const entry = applied.state.entries[0];
  assert.equal(entry.visionAnalysis.reconstructionPrompt, "新反推提示词：逆光人物站在潮湿街道中央，电影写实风格。");
  assert.equal(Object.hasOwn(entry.visionAnalysis, "description"), false);
  assert.equal(entry.visionAnalysis.quality, "complete");
  assert.equal(entry.visionAnalysis.tags.length, 2);
  assert.deepEqual(entry.facetAssignments.map((item) => item.source).sort(), ["deepseek_text", "manual", "vision_model"]);
  assert.equal(entry.facetAssignments.find((item) => item.nodeId === beforeNodeIds[0]).source, "manual");
  assert.equal(applied.appliedCount, 2);

  const undone = undoVisionAnalysis(applied.state, applied.undo);
  assert.equal(undone.entries[0].visionAnalysis.reconstructionPrompt, "旧反推提示词");
  assert.deepEqual(undone.entries[0].facetAssignments.map((item) => item.nodeId).sort(), beforeNodeIds.sort());
  assert.equal(undone.facetCatalog.nodes.some((item) => item.name === "逆光" && item.parentId === "light.direction"), false);
});

test("screenshot replacement invalidates vision references and undo restores them", () => {
  const entry = {
    id: "image",
    text: "",
    facetAssignments: [
      { facetId: "style", nodeId: "manual", source: "manual", status: "confirmed" },
      { facetId: "light", nodeId: "backlight", source: "vision_model", status: "confirmed" }
    ],
    visionAnalysis: { description: "逆光人物", imageFingerprint: "old" }
  };
  const invalidated = invalidateVisionForScreenshot(entry);
  assert.equal(invalidated.entry.visionAnalysis, undefined);
  assert.deepEqual(invalidated.entry.facetAssignments.map((item) => item.source), ["manual"]);
  const restored = restoreVisionAfterScreenshot(invalidated.entry, invalidated);
  assert.equal(restored.visionAnalysis.description, "逆光人物");
  assert.deepEqual(restored.facetAssignments.map((item) => item.source).sort(), ["manual", "vision_model"]);
});

test("vision analysis atomically requires a reconstruction prompt and at least one valid search tag", () => {
  const original = {
    facetCatalog: createDefaultFacetCatalog(),
    entries: [{
      id: "atomic",
      facetAssignments: [{ facetId: "style", nodeId: "style.render", status: "confirmed", source: "manual" }],
      visionAnalysis: { reconstructionPrompt: "上一版完整提示词", quality: "complete" }
    }]
  };
  assert.throws(() => applyVisionAnalysis(original, "atomic", {
    reconstructionPrompt: "只有提示词，没有标签",
    tags: []
  }), /至少.*标签|1–6|标签/);
  assert.throws(() => applyVisionAnalysis(original, "atomic", {
    reconstructionPrompt: "",
    tags: [{ g: "style.render", t: "电影写实" }]
  }), /反推提示词|重建提示词/);
  assert.equal(original.entries[0].visionAnalysis.reconstructionPrompt, "上一版完整提示词");
  assert.equal(original.entries[0].facetAssignments.length, 1);
});

test("vision analysis stores one to six tags and safely caps an over-limit result", () => {
  for (const returned of [1, 3, 6]) {
    const applied = applyVisionAnalysis({
      facetCatalog: createDefaultFacetCatalog(),
      entries: [{ id: `image-${returned}`, facetAssignments: [] }]
    }, `image-${returned}`, {
      reconstructionPrompt: `prompt ${returned}`,
      tags: Array.from({ length: returned }, (_, index) => ({ g: "style.render", t: `标签${index + 1}` }))
    }, { imageFingerprint: "image" });
    assert.equal(applied.appliedCount, returned);
    assert.equal(applied.state.entries[0].facetAssignments.length, returned);
  }
  const capped = applyVisionAnalysis({
    facetCatalog: createDefaultFacetCatalog(), entries: [{ id: "too-many", facetAssignments: [] }]
  }, "too-many", {
    reconstructionPrompt: "prompt", tags: Array.from({ length: 7 }, (_, index) => ({ g: "style.render", t: `标签${index}` }))
  });
  assert.equal(capped.appliedCount, 6);
  assert.equal(capped.state.entries[0].facetAssignments.length, 6);
});

test("manual visual edits update only the reconstruction prompt", () => {
  const original = {
    visionAnalysis: {
      reconstructionPrompt: "旧反推提示词",
      tags: [{ tagId: "style.cinematic", label: "电影感" }],
      quality: "complete"
    }
  };
  const edited = editVisionReconstructionPrompt(original, "新的详细反推提示词");
  assert.equal(edited.visionAnalysis.reconstructionPrompt, "新的详细反推提示词");
  assert.equal(edited.visionAnalysis.description, undefined);
  assert.deepEqual(edited.visionAnalysis.tags, original.visionAnalysis.tags);
  assert.equal(edited.visionAnalysis.userEdited, true);
});

test("image analysis can retain a reusable breakdown while promoting only six results", () => {
  const incoming = Array.from({ length: 10 }, (_, index) => ({
    dimensionName: "视觉风格",
    groupName: "渲染方式",
    tagName: `标签${index + 1}`,
    evidence: `evidence ${index + 1}`,
    confidence: 0.9,
    importance: (index + 1) / 10,
    decision: "confirmed",
    source: "local_image_review"
  }));
  const applied = applyAnalysisCandidates({
    facetCatalog: createDefaultFacetCatalog(),
    entries: [{ id: "complete", facetAssignments: [], analysisCandidates: [] }]
  }, "complete", incoming, { replaceExistingDeepSeek: true });
  const entry = applied.state.entries[0];

  assert.equal(entry.analysisBreakdown.length, 10);
  assert.deepEqual(entry.analysisBreakdown.slice(0, 3).map((item) => item.tagName), ["标签10", "标签9", "标签8"]);
  assert.equal(entry.facetAssignments.length, 6);
  assert.deepEqual(entry.facetAssignments.map((item) => item.source), Array(6).fill("local_image_review"));
  assert.equal(applied.confirmedCount, 6);
  assert.equal(applied.retainedCount, 10);
});

test("structured import suggestions still support automatic approval", () => {
  const state = {
    facetCatalog: createDefaultFacetCatalog(),
    entries: [{ id: "legacy", facetAssignments: [], analysisCandidates: [] }]
  };
  const applied = applyAnalysisCandidates(state, "legacy", [
    { dimensionName: "镜头与构图", groupName: "运镜方式", tagName: "跟拍", evidence: "tracking shot", confidence: 0.8, status: "suggested", source: "structure" }
  ], { reviewThreshold: 0.55 });

  assert.equal(applied.confirmedCount, 1);
  assert.equal(applied.suggestedCount, 0);
});

test("batch replacement removes old DeepSeek labels without downgrading manual labels", () => {
  let state = { facetCatalog: createDefaultFacetCatalog(), entries: [{ id: "one", facetAssignments: [], analysisCandidates: [] }] };
  state = applyFixedAnalysisTags(state, "one", [{ g: "style.render", t: "写实" }], { source: "manual" }).state;
  state = applyFixedAnalysisTags(state, "one", [{ g: "style.render", t: "旧风格" }], { source: "deepseek_text", replaceExisting: false }).state;
  state.entries[0].analysisCandidates = [{ id: "pending", dimensionName: "视觉风格", tagName: "旧候选", evidence: "old", source: "deepseek_text" }];
  const manualNodeId = state.entries[0].facetAssignments.find((item) => item.source === "manual").nodeId;
  const applied = applyAnalysisCandidates(state, "one", [
    { dimensionName: "视觉风格", groupName: "渲染方式", tagName: "写实", evidence: "photorealistic", confidence: 0.9, decision: "confirmed" }
  ], { replaceExistingDeepSeek: true });
  const assignments = applied.state.entries[0].facetAssignments;
  assert.equal(assignments.length, 1);
  assert.equal(assignments[0].nodeId, manualNodeId);
  assert.equal(assignments[0].source, "manual");
  assert.equal(applied.state.entries[0].analysisCandidates.length, 0);
});

test("a corpus import can replace the generated vocabulary and clear old candidate noise", () => {
  const state = {
    facetCatalog: {
      version: 1, revision: 1,
      facets: [{ id: "old-facet", name: "subject", color: "#000000", order: 0, aliases: [], status: "active" }],
      nodes: [{ id: "old-tag", name: "old", facetId: "old-facet", parentId: null, order: 0, aliases: [], patterns: [], status: "active" }]
    },
    entries: [{
      id: "one",
      facetAssignments: [{ facetId: "old-facet", nodeId: "old-tag", status: "confirmed", source: "deepseek_text" }],
      analysisCandidates: [{ id: "old", dimensionName: "old", tagName: "noise", evidence: "old", confidence: 0.9 }]
    }]
  };
  const applied = applyAnalysisImport(state, {
    policy: { replaceCreativeVocabulary: true, replaceExistingCandidates: true, reviewThreshold: 0.55 },
    entries: [{ entryId: "one", candidates: [
      { dimensionName: "视觉风格", tagName: "黑色电影", evidence: "film noir", confidence: 0.9, decision: "confirmed" }
    ] }]
  });

  assert.equal(applied.matchedCount, 1);
  assert.equal(applied.confirmedCount, 1);
  assert.equal(applied.state.facetCatalog.facets.length, 10);
  assert.equal(applied.state.facetCatalog.facets.some((item) => item.id === "old-facet"), false);
  assert.equal(applied.state.entries[0].analysisCandidates.length, 0);
});

test("replacing imported AI vocabulary preserves manual and visual tags", () => {
  let state = {
    facetCatalog: createDefaultFacetCatalog(),
    entries: [{ id: "one", text: "A cel-shaded hero in rain.", facetAssignments: [], analysisCandidates: [] }]
  };
  state = applyFixedAnalysisTags(state, "one", [{ g: "subject.character", t: "英雄" }], {
    source: "manual",
    replaceExisting: false
  }).state;
  state = applyFixedAnalysisTags(state, "one", [{ g: "scene.weather", t: "雨天" }], {
    source: "vision_model",
    replaceExisting: false
  }).state;
  state = applyFixedAnalysisTags(state, "one", [{ g: "style.render", t: "旧渲染词" }], {
    source: "deepseek_text",
    replaceExisting: false
  }).state;

  const applied = applyAnalysisImport(state, {
    policy: { replaceCreativeVocabulary: true },
    entries: [{
      entryId: "one",
      candidates: [{
        dimensionName: "视觉风格", groupName: "渲染方式", tagName: "赛璐珞",
        evidence: "cel-shaded", confidence: 0.9, decision: "confirmed"
      }]
    }]
  });
  const entry = applied.state.entries[0];
  const nodeById = new Map(applied.state.facetCatalog.nodes.map((item) => [item.id, item]));
  const assignments = entry.facetAssignments.map((item) => ({ source: item.source, name: nodeById.get(item.nodeId)?.name }));

  assert.ok(assignments.some((item) => item.source === "manual" && item.name === "英雄"));
  assert.ok(assignments.some((item) => item.source === "vision_model" && item.name === "雨天"));
  assert.ok(assignments.some((item) => item.source === "deepseek_text" && item.name === "赛璐珞"));
  assert.equal(assignments.some((item) => item.name === "旧渲染词"), false);
});

test("a corpus import survives changed extension IDs by matching the original source content", () => {
  const state = {
    facetCatalog: createDefaultFacetCatalog(),
    entries: [{
      id: "current-id",
      title: "同一案例",
      url: "https://example.com/case",
      text: "A continuous tracking shot.",
      classification: { pathIds: ["content:prompt:video"], status: "confirmed", source: "manual" },
      facetAssignments: [],
      analysisCandidates: []
    }]
  };
  const applied = applyAnalysisImport(state, {
    format: "prompt-case-library-analysis",
    policy: { replaceCreativeVocabulary: true },
    entries: [{
      entryId: "old-extension-id",
      match: { title: "同一案例", url: "https://example.com/case", text: "A continuous tracking shot." },
      candidates: [{ dimensionName: "镜头与构图", groupName: "运镜方式", tagName: "跟拍", evidence: "tracking shot", confidence: 0.92 }]
    }]
  });

  assert.equal(applied.matchedCount, 1);
  assert.equal(applied.state.entries[0].id, "current-id");
  assert.equal(applied.state.entries[0].facetAssignments.length, 1);
});

test("duplicate image references with changed IDs stay aligned by their original save time", () => {
  const entries = ["10:00:00", "10:01:00"].map((time, index) => ({
    id: `current-${index}`,
    title: "同一图片页",
    url: "https://example.com/gallery",
    text: "",
    savedAt: `2026-07-18T${time}+08:00`,
    classification: { pathIds: ["content:image-case"], status: "confirmed", source: "auto" },
    facetAssignments: [],
    analysisCandidates: []
  }));
  const importedEntries = ["10:00:00", "10:01:00"].map((time, index) => ({
    entryId: `old-${index}`,
    match: { title: "同一图片页", url: "https://example.com/gallery", text: "", savedAt: `2026-07-18 ${time} GMT+8` },
    candidates: [{ dimensionName: "视觉风格", groupName: "艺术流派", tagName: `风格${index + 1}`, evidence: "本地看图", confidence: 0.9 }]
  }));
  const applied = applyAnalysisImport({ facetCatalog: createDefaultFacetCatalog(), entries }, {
    format: "prompt-case-library-analysis",
    policy: { replaceCreativeVocabulary: true },
    entries: importedEntries
  });

  assert.equal(applied.matchedCount, 2);
  assert.equal(applied.state.entries[0].facetAssignments.length, 1);
  assert.equal(applied.state.entries[1].facetAssignments.length, 1);
  assert.notEqual(applied.state.entries[0].facetAssignments[0].nodeId, applied.state.entries[1].facetAssignments[0].nodeId);
});

test("a complete analysis file applies even when newer cases exist and clears their stale automatic labels", () => {
  const state = {
    facetCatalog: {
      version: 2,
      revision: 1,
      facets: [{ id: "old-facet", name: "subject", color: "#111111", order: 0, aliases: [], status: "active" }],
      nodes: [{ id: "old-node", facetId: "old-facet", parentId: null, name: "raw subject", order: 0, aliases: [], patterns: [], status: "active" }]
    },
    entries: [
      { id: "analyzed", title: "已分析案例", savedAt: "2026-07-18T10:00:00Z", facetAssignments: [], analysisCandidates: [] },
      {
        id: "newer", title: "后来新增案例", savedAt: "2026-07-18T11:00:00Z",
        facetAssignments: [{ facetId: "old-facet", nodeId: "old-node", status: "confirmed", source: "deepseek_text" }],
        analysisCandidates: [{ id: "stale", dimensionName: "subject", tagName: "raw subject", evidence: "old", confidence: 0.8 }]
      }
    ]
  };
  const applied = applyAnalysisImport(state, {
    format: "prompt-case-library-analysis",
    policy: { replaceCreativeVocabulary: true },
    entries: [{
      entryId: "analyzed",
      candidates: [{ dimensionName: "主体与角色", groupName: "人物与角色类型", tagName: "英雄", evidence: "hero", confidence: 0.9 }]
    }]
  });

  assert.equal(applied.matchedCount, 1);
  assert.equal(applied.unmatchedCount, 1);
  assert.equal(applied.state.facetCatalog.facets.length, 10);
  assert.equal(applied.state.entries.find((item) => item.id === "newer").facetAssignments.length, 0);
  assert.equal(applied.state.entries.find((item) => item.id === "newer").analysisCandidates.length, 0);
});

test("selecting the exported library JSON explains that it is not an analysis file", () => {
  assert.throws(() => applyAnalysisImport({ facetCatalog: createDefaultFacetCatalog(), entries: [] }, {
    format: "prompt-case-library",
    entries: [{ id: "case-one" }]
  }), /资料库导出 library\.json.*不是整库分析 JSON/);
});

test("a tag identical to its group reuses the group node instead of failing the import", () => {
  const state = {
    facetCatalog: createDefaultFacetCatalog(),
    entries: [{ id: "format", facetAssignments: [], analysisCandidates: [] }]
  };
  const applied = applyAnalysisCandidates(state, "format", [
    { dimensionName: "输出规格", groupName: "帧率", tagName: "帧率", evidence: "24fps", confidence: 0.9 }
  ]);

  assert.equal(applied.state.entries[0].facetAssignments[0].nodeId, "output.fps");
});
