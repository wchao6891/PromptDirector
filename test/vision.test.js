import test from "node:test";
import assert from "node:assert/strict";

import {
  DEFAULT_VISION_MODEL,
  analyzeImageWithVision,
  createVisionRequestBudget,
  evaluateCreativeOutputWithVision,
  mergeVisionSettings,
  normalizeVisionResult,
  normalizeVisionSettings,
  permissionPatternForVisionSettings,
  permissionPatternsForVisionSettings,
  probeCompatibleModels,
  publicVisionSettings
} from "../vision.js";
import { createDefaultFacetCatalog } from "../facets.js";
import { VISUAL_ANALYSIS_DIMENSIONS } from "../visual-analysis.js";

function sampleCatalog() {
  const catalog = createDefaultFacetCatalog();
  catalog.nodes.push({
    id: "detail:secret", facetId: "light", parentId: "light.direction", name: "secret-dynamic-tag",
    order: 0, aliases: [], patterns: [], status: "active", kind: "detail", origin: "manual", fixed: false
  });
  return catalog;
}

function completeVisionResult(description = "一名人物站在逆光环境中。", tags = [{ g: "light.direction", t: "逆光" }]) {
  return {
    description,
    canvas: {
      width: 1024,
      height: 1024,
      aspectRatio: "1:1",
      orientation: "square",
      dominantColors: [{ hex: "#101820", coveragePercent: 70, source: "estimated" }]
    },
    elements: [{
      id: "element-1",
      label: "主体",
      category: "subject",
      box_2d: [150, 250, 850, 750],
      coveragePercent: 35,
      depthLayer: "foreground",
      occludes: [],
      occludedBy: [],
      relationships: ["位于画面中央"],
      visualAttributes: ["逆光轮廓"]
    }],
    dimensions: VISUAL_ANALYSIS_DIMENSIONS.map((id) => ({
      id,
      applicable: id !== "sound",
      facts: id === "sound" ? [] : [`${id} fact`],
      measurements: []
    })),
    ocr: [],
    reconstructionPrompt: `${description} 主体居中，逆光。`,
    limitations: [],
    completeness: { checkedRegions: ["四角", "主体", "背景", "文字"], omittedVisibleElements: [] },
    tags
  };
}

test("vision settings keep provider credentials separate and use the supported OpenAI default", () => {
  const settings = normalizeVisionSettings({
    activeProvider: "compatible",
    consent: true,
    openai: { apiKey: " openai-key " },
    compatible: { endpoint: "https://vision.example.com/v1/chat/completions", apiKey: " other-key ", model: "vision-pro" }
  });
  assert.equal(settings.openai.model, DEFAULT_VISION_MODEL);
  assert.equal(settings.openai.apiKey, "openai-key");
  assert.equal(settings.compatible.apiKey, "other-key");
  assert.equal(settings.compatible.protocol, "chat_completions");
  assert.equal(permissionPatternForVisionSettings(settings), "https://vision.example.com/*");
  assert.equal(publicVisionSettings(settings).compatible.endpoint, undefined);
  assert.equal(publicVisionSettings(settings).autoAnalyzeImports, false);
  assert.equal(normalizeVisionSettings().compatible.protocol, "chat_completions");
});

test("automatic import analysis is an explicit persisted vision setting", () => {
  const enabled = normalizeVisionSettings({ autoAnalyzeImports: true });
  assert.equal(enabled.autoAnalyzeImports, true);
  assert.equal(publicVisionSettings(enabled).autoAnalyzeImports, true);

  const preserved = mergeVisionSettings(enabled, { consent: true });
  assert.equal(preserved.settings.autoAnalyzeImports, true);
});

test("compatible API key is cleared when the endpoint origin changes", () => {
  const current = normalizeVisionSettings({
    activeProvider: "compatible",
    compatible: {
      endpoint: "https://vision.example.com/v1/chat/completions",
      apiKey: "old-secret",
      model: "vision-pro"
    }
  });
  const changed = mergeVisionSettings(current, {
    activeProvider: "compatible",
    compatible: {
      endpoint: "https://other.example.net/v1/chat/completions",
      apiKey: "",
      model: "vision-pro"
    }
  });
  assert.equal(changed.credentialReset, true);
  assert.equal(changed.settings.compatible.apiKey, "");
  assert.equal(changed.settings.compatible.credentialOrigin, "");

  const sameOrigin = mergeVisionSettings(current, {
    compatible: { endpoint: "https://vision.example.com/v2/responses", apiKey: "" }
  });
  assert.equal(sameOrigin.credentialReset, false);
  assert.equal(sameOrigin.settings.compatible.apiKey, "old-secret");
  assert.equal(sameOrigin.settings.compatible.credentialOrigin, "https://vision.example.com");
});

test("compatible API key can be explicitly rebound to a new endpoint origin", () => {
  const changed = mergeVisionSettings({
    compatible: {
      endpoint: "https://vision.example.com/v1/chat/completions",
      apiKey: "old-secret",
      model: "vision-pro"
    }
  }, {
    compatible: {
      endpoint: "https://other.example.net/v1/chat/completions",
      apiKey: "new-secret"
    }
  });
  assert.equal(changed.credentialReset, false);
  assert.equal(changed.settings.compatible.apiKey, "new-secret");
  assert.equal(changed.settings.compatible.credentialOrigin, "https://other.example.net");
});

test("compatible image generation keeps its own credential and requests the verified result host", () => {
  const current = normalizeVisionSettings({
    activeProvider: "compatible",
    compatible: {
      endpoint: "https://www.micuapi.ai/v1/responses",
      apiKey: "chat-secret",
      model: "gpt-5.4-mini",
      imageGeneration: {
        protocol: "images_generations",
        endpoint: "https://www.micuapi.ai/v1/images/generations",
        editsEndpoint: "https://www.micuapi.ai/v1/images/edits",
        apiKey: "image-secret",
        model: "gpt-image-2",
        size: "1536x1024"
      }
    }
  });
  assert.equal(current.compatible.apiKey, "chat-secret");
  assert.equal(current.compatible.imageGeneration.apiKey, "image-secret");
  assert.equal(current.compatible.imageGeneration.editsEndpoint, "https://www.micuapi.ai/v1/images/edits");
  assert.deepEqual(permissionPatternsForVisionSettings(current), [
    "https://www.micuapi.ai/*",
    "https://oss.filenest.top/*"
  ]);
  const cleared = mergeVisionSettings(current, { clearApiKey: "compatible_image", consent: true });
  assert.equal(cleared.settings.compatible.apiKey, "chat-secret");
  assert.equal(cleared.settings.compatible.imageGeneration.apiKey, "");
  assert.equal(publicVisionSettings(current).compatible.imageGeneration.model, "gpt-image-2");
  assert.equal(publicVisionSettings(current).compatible.imageGeneration.configured, true);
  assert.equal(publicVisionSettings(current).compatible.imageGeneration.endpoint, undefined);
  assert.equal(publicVisionSettings(current).compatible.imageGeneration.editsEndpoint, undefined);
});

test("adding a same-origin edits endpoint preserves the existing image key", () => {
  const current = normalizeVisionSettings({
    compatible: {
      imageGeneration: {
        protocol: "images_generations",
        endpoint: "https://www.micuapi.ai/v1/images/generations",
        apiKey: "image-secret",
        model: "gpt-image-2",
        size: "1536x1024"
      }
    }
  });
  const merged = mergeVisionSettings(current, {
    compatible: { imageGeneration: { editsEndpoint: "https://www.micuapi.ai/v1/images/edits" } }
  });
  assert.equal(merged.imageCredentialReset, false);
  assert.equal(merged.settings.compatible.imageGeneration.apiKey, "image-secret");
});

test("compatible endpoint must be exact HTTPS without query or fragment", () => {
  assert.throws(() => permissionPatternForVisionSettings(normalizeVisionSettings({
    activeProvider: "compatible", compatible: { endpoint: "http://vision.example.com/v1/chat/completions" }
  })), /HTTPS/);
  assert.throws(() => permissionPatternForVisionSettings(normalizeVisionSettings({
    activeProvider: "compatible", compatible: { endpoint: "https://vision.example.com/v1/chat/completions?mode=fast" }
  })), /查询参数/);
});

test("localhost compatible services allow HTTP without an API key and list models first", async () => {
  const settings = normalizeVisionSettings({
    activeProvider: "compatible", consent: true,
    compatible: { endpoint: "http://localhost:1234/v1/chat/completions", model: "local-vision" }
  });
  assert.equal(permissionPatternForVisionSettings(settings), "http://localhost:1234/*");
  assert.equal(publicVisionSettings(settings).compatible.configured, true);
  const probe = await probeCompatibleModels(settings.compatible, async (url, options) => {
    assert.equal(url, "http://localhost:1234/v1/models");
    assert.equal(options.headers.Authorization, undefined);
    return { ok: true, json: async () => ({ data: [{ id: "local-vision" }, { id: "text-only" }] }) };
  });
  assert.deepEqual(probe.models, ["local-vision", "text-only"]);
});

test("vision result keeps partial paid output visible and keeps at most six optional compact tags", () => {
  const values = Array.from({ length: 6 }, (_, index) => ({ g: "light.direction", t: `标签${index + 1}` }));
  const result = normalizeVisionResult(completeVisionResult("  主体处于逆光中。  ", values));
  assert.equal(result.description, "主体处于逆光中。");
  assert.equal(result.tags.length, 6);
  assert.deepEqual(Object.keys(result.tags[0]).sort(), ["g", "t"]);
  const overLimit = normalizeVisionResult(completeVisionResult("有效描述", [...values, values[0]]));
  assert.equal(overLimit.tags.length, 6);
  assert.equal(overLimit.tagDiagnostics.rejectedCount, 1);
  const missingDescription = normalizeVisionResult(completeVisionResult(""));
  assert.equal(missingDescription.quality, "partial");
  assert.ok(missingDescription.missingFields.includes("description"));
  assert.throws(
    () => normalizeVisionResult({ description: "旧版简述", tags: [] }),
    /至少一个有效检索标签/
  );
});

test("vision request schema is minimized to reconstructionPrompt plus tags", async () => {
  let body;
  await analyzeImageWithVision({
    imageDataUrl: "data:image/png;base64,AAAA",
    catalog: createDefaultFacetCatalog(),
    settings: {
      activeProvider: "compatible",
      consent: true,
      compatible: {
        protocol: "chat_completions",
        endpoint: "https://api.deepseek.com/chat/completions",
        apiKey: "secret",
        model: "deepseek-v4-vision"
      }
    }
  }, async (_url, options) => {
    body = JSON.parse(options.body);
    return {
      ok: true,
      json: async () => ({
        model: "deepseek-v4-vision",
        choices: [{ message: { content: JSON.stringify({ reconstructionPrompt: "主体居中", tags: [{ g: "light.direction", t: "逆光" }] }) } }]
      })
    };
  });

  const schema = body.response_format?.json_schema?.schema ?? body.text?.format?.schema ?? body.response_format;
  assert.deepEqual(Object.keys(schema.properties).sort(), ["reconstructionPrompt", "tags"]);
  assert.deepEqual(schema.required, ["reconstructionPrompt", "tags"]);
  const prompt = body.messages[0].content.find((item) => item.type === "text").text;
  assert.match(prompt, /reconstructionPrompt/);
  assert.match(prompt, /tags/);
  assert.doesNotMatch(prompt, /"description"|"canvas"|"elements"|"dimensions"|"ocr"|"completeness"|partial/);
});

test("partial vision normalization accepts root casing and snake-case aliases without inventing fields", () => {
  const partial = normalizeVisionResult({
    Description: "可见人物站在窗边。",
    reconstruction_prompt: "人物站在窗边，侧逆光。",
    Tags: [{ group_id: "light.direction", detail: "侧逆光" }],
    extra_model_note: "ignored"
  });
  assert.equal(partial.quality, "partial");
  assert.equal(partial.reconstructionPrompt, "人物站在窗边，侧逆光。");
  assert.deepEqual(partial.tags, [{ g: "light.direction", t: "侧逆光" }]);
  assert.ok(partial.missingFields.includes("elements"));
});

test("an invalid-only tag response fails atomically even when the reconstruction prompt is usable", () => {
  assert.throws(() => normalizeVisionResult(completeVisionResult("主体分析完整。", [
    { g: "invented.path", t: "模型自造路径" }
  ]), sampleCatalog()), /至少一个有效检索标签/);
});

test("OpenAI vision request sends the image and fixed paths without dynamic detail vocabulary", async () => {
  let request;
  const fetchStub = async (url, options) => {
    assert.equal(url, "https://api.openai.com/v1/responses");
    request = JSON.parse(options.body);
    return {
      ok: true,
      json: async () => ({
        model: "gpt-5-mini",
        usage: { input_tokens: 25, output_tokens: 30, total_tokens: 55 },
        output_text: JSON.stringify(completeVisionResult("一名人物站在逆光环境中。", [{ g: "light.direction", t: "逆光" }]))
      })
    };
  };
  const result = await analyzeImageWithVision({
    imageDataUrl: "data:image/webp;base64,AAAA",
    catalog: sampleCatalog(),
    locale: "zh-CN",
    settings: {
      activeProvider: "openai", consent: true,
      instructionsByLocale: { "zh-CN": "优先描述空间关系。" },
      openai: { apiKey: "secret", model: "gpt-5-mini" }
    }
  }, fetchStub);

  assert.equal(request.store, false);
  assert.equal(request.max_output_tokens, 12000);
  assert.equal(request.text.format.type, "json_schema");
  assert.deepEqual(Object.keys(request.text.format.schema.properties).sort(), ["reconstructionPrompt", "tags"]);
  assert.equal(request.text.format.schema.properties.reconstructionPrompt.type, "string");
  assert.equal(request.text.format.schema.properties.tags.maxItems, 6);
  const content = request.input[0].content;
  assert.deepEqual(content.find((item) => item.type === "input_image"), {
    type: "input_image", image_url: "data:image/webp;base64,AAAA", detail: "high"
  });
  const sentText = content.filter((item) => item.type === "input_text").map((item) => item.text).join("\n");
  assert.match(sentText, /优先描述空间关系/);
  assert.match(sentText, /reconstructionPrompt/);
  assert.match(sentText, /tags/);
  assert.match(sentText, /主体/);
  assert.match(sentText, /场景/);
  assert.match(sentText, /动作/);
  assert.match(sentText, /风格材质/);
  assert.match(sentText, /构图镜头/);
  assert.match(sentText, /光线色彩/);
  assert.match(sentText, /情绪/);
  assert.match(sentText, /可见文字图形/);
  assert.match(sentText, /媒介画质/);
  assert.match(sentText, /制作表现/);
  assert.doesNotMatch(sentText, /"description"|"canvas"|"elements"|"dimensions"|"ocr"|"completeness"|partial/);
  assert.equal(result.reconstructionPrompt, "一名人物站在逆光环境中。 主体居中，逆光。");
  assert.equal(result.tags.length, 1);
  assert.equal(result.usage.totalTokens, 55);
});

test("Gemini native vision adapter sends inline image data and preserves the unified V2 result", async () => {
  let request;
  const result = await analyzeImageWithVision({
    imageDataUrl: "data:image/png;base64,AAAA",
    catalog: sampleCatalog(),
    settings: {
      activeProvider: "compatible",
      consent: true,
      compatible: { endpoint: "https://generativelanguage.googleapis.com", apiKey: "key", model: "gemini-account-model" },
      nativeProvider: { id: "gemini", endpoint: "https://generativelanguage.googleapis.com", apiKey: "key", model: "gemini-account-model" }
    }
  }, async (url, options) => {
    assert.equal(url, "https://generativelanguage.googleapis.com/v1beta/models/gemini-account-model:generateContent");
    assert.equal(options.headers["x-goog-api-key"], "key");
    request = JSON.parse(options.body);
    return new Response(JSON.stringify({
      candidates: [{ content: { parts: [{ text: JSON.stringify(completeVisionResult()) }] } }],
      usageMetadata: { promptTokenCount: 5, candidatesTokenCount: 7, totalTokenCount: 12 }
    }), { status: 200, headers: { "content-type": "application/json" } });
  });
  assert.equal(request.contents[0].parts[1].inlineData.mimeType, "image/png");
  assert.equal(result.providerType, "gemini");
  assert.equal(result.version, undefined);
  assert.equal(result.usage.totalTokens, 12);
});

test("compatible request disables thinking on DeepSeek chat completions and refuses redirects", async () => {
  let options;
  const fetchStub = async (_url, input) => {
    options = input;
    return {
      ok: true,
      json: async () => ({ choices: [{ message: { content: JSON.stringify(completeVisionResult("A centered subject.")) } }] })
    };
  };
  await analyzeImageWithVision({
    imageDataUrl: "data:image/png;base64,AAAA",
    catalog: createDefaultFacetCatalog(),
    locale: "en",
    settings: {
      activeProvider: "compatible", consent: true,
      compatible: {
        protocol: "chat_completions",
        endpoint: "https://api.deepseek.com/v1/chat/completions",
        apiKey: "secret",
        model: "vision-pro"
      }
    }
  }, fetchStub);
  const body = JSON.parse(options.body);
  assert.equal(options.redirect, "error");
  assert.deepEqual(body.thinking, { type: "disabled" });
  assert.equal(body.messages[0].content.some((item) => item.type === "image_url" && item.image_url.detail === "high"), true);
  assert.equal(body.max_tokens, 12000);
});

test("compatible json_object vision requests keep image input and local reconstruction validation", async () => {
  let body;
  const input = {
    imageDataUrl: "data:image/png;base64,AAAA",
    catalog: createDefaultFacetCatalog(),
    locale: "zh-CN",
    settings: {
      activeProvider: "compatible", consent: true,
      compatible: {
        protocol: "chat_completions",
        structuredOutput: "json_object",
        endpoint: "https://api.deepseek.com/chat/completions",
        apiKey: "secret",
        model: "opaque-account-model"
      }
    }
  };
  const success = await analyzeImageWithVision(input, async (_url, options) => {
    body = JSON.parse(options.body);
    return {
      ok: true,
      json: async () => ({
        model: "opaque-account-model",
        choices: [{ message: { content: JSON.stringify(completeVisionResult("一张完整分析。")) } }]
      })
    };
  });

  assert.deepEqual(body.response_format, { type: "json_object" });
  assert.equal(body.messages[0].content.some((item) => item.type === "image_url"), true);
  const instruction = body.messages[0].content.find((item) => item.type === "text").text;
  assert.match(instruction, /reconstructionPrompt/);
  assert.match(instruction, /tags/);
  assert.doesNotMatch(instruction, /"description"|"canvas"|"elements"|"dimensions"|"ocr"|"completeness"|partial/);
  assert.equal(success.reconstructionPrompt, "一张完整分析。 主体居中，逆光。");

  await assert.rejects(() => analyzeImageWithVision(input, async () => ({
    ok: true,
    json: async () => ({ choices: [{ message: { content: JSON.stringify({ reconstructionPrompt: "缺少标签", tags: [] }) } }] })
  })), /至少一个有效检索标签/);
});

test("Zhipu-compatible vision sends raw image Base64 without OpenAI-only detail fields", async () => {
  let body;
  await analyzeImageWithVision({
    imageDataUrl: "data:image/png;base64,AAAA",
    catalog: createDefaultFacetCatalog(),
    locale: "zh-CN",
    settings: {
      activeProvider: "compatible", consent: true,
      compatible: {
        protocol: "chat_completions",
        structuredOutput: "prompt_only",
        imageBase64: "raw",
        endpoint: "https://open.bigmodel.cn/api/paas/v4/chat/completions",
        apiKey: "zhipu-secret",
        model: "glm-4.6v"
      }
    }
  }, async (_url, options) => {
    body = JSON.parse(options.body);
    return {
      ok: true,
      json: async () => ({ choices: [{ message: { content: JSON.stringify(completeVisionResult()) } }] })
    };
  });

  const image = body.messages[0].content.find((item) => item.type === "image_url");
  assert.deepEqual(image, { type: "image_url", image_url: { url: "AAAA" } });
  assert.equal(Object.hasOwn(body, "response_format"), false);
  assert.match(body.messages[0].content.find((item) => item.type === "text").text, /reconstructionPrompt/);
});

test("compatible empty vision results get exactly one structured-output correction request", async () => {
  const input = {
    imageDataUrl: "data:image/png;base64,AAAA",
    catalog: createDefaultFacetCatalog(),
    settings: {
      activeProvider: "compatible", consent: true,
      compatible: {
        protocol: "chat_completions",
        structuredOutput: "json_object",
        endpoint: "http://localhost:1234/v1/chat/completions",
        model: "fixture-model"
      }
    }
  };
  const cases = [
    ["length", /输出达到长度上限/],
    ["content_filter", /内容过滤/],
    ["insufficient_system_resource", /资源暂时不足/],
    ["stop", /返回了空的 JSON 内容/],
    [undefined, /响应缺少可用内容/]
  ];
  let calls = 0;
  for (const [finishReason, expected] of cases) {
    await assert.rejects(() => analyzeImageWithVision(input, async () => {
      calls += 1;
      return {
        ok: true,
        json: async () => ({
          choices: [{ finish_reason: finishReason, message: { content: "" } }]
        })
      };
    }), expected);
  }
  assert.equal(calls, cases.length * 2);
});

test("vision provider calls share one budget across service retries and output correction", async () => {
  const input = {
    imageDataUrl: "data:image/png;base64,AAAA",
    catalog: createDefaultFacetCatalog(),
    requestBudget: createVisionRequestBudget(),
    settings: {
      activeProvider: "compatible", consent: true,
      compatible: {
        protocol: "chat_completions",
        structuredOutput: "json_object",
        endpoint: "http://localhost:1234/v1/chat/completions",
        model: "fixture-model"
      }
    }
  };
  let providerCalls = 0;
  const failingFetch = async () => {
    providerCalls += 1;
    if (providerCalls === 2) {
      return {
        ok: false,
        status: 503,
        headers: { get: () => null },
        json: async () => ({ error: { message: "temporary" } })
      };
    }
    return {
      ok: true,
      status: 200,
      headers: { get: () => null },
      json: async () => ({ choices: [{ message: { content: "{}" } }] })
    };
  };

  await assert.rejects(() => analyzeImageWithVision(input, failingFetch), (error) => error.status === 503);
  await assert.rejects(
    () => analyzeImageWithVision(input, failingFetch),
    (error) => error.code === "vision_request_budget_exhausted"
  );
  assert.equal(providerCalls, 3);
  assert.deepEqual(input.requestBudget, {
    maxProviderCalls: 3,
    providerCalls: 3,
    outputCorrectionRequests: 1
  });
});

test("third-party compatible Responses disables reasoning by task policy and parses structured output", async () => {
  let captured;
  const result = await analyzeImageWithVision({
    imageDataUrl: "data:image/png;base64,AAAA",
    catalog: sampleCatalog(),
    locale: "zh-CN",
    settings: {
      activeProvider: "compatible", consent: true,
      compatible: {
        protocol: "responses",
        endpoint: "https://www.micuapi.ai/v1/responses",
        apiKey: "secret",
        model: "gpt-5.6-terra"
      }
    }
  }, async (url, options) => {
    captured = { url, options, body: JSON.parse(options.body) };
    return {
      ok: true,
      json: async () => ({
        model: "gpt-5.6-terra",
        output: [{
          type: "message",
          content: [{
            type: "output_text",
            text: JSON.stringify({ reconstructionPrompt: "雾中的庭院。", tags: [{ g: "light.direction", t: "逆光" }] })
          }]
        }]
      })
    };
  });
  assert.equal(captured.url, "https://www.micuapi.ai/v1/responses");
  assert.equal(captured.options.redirect, "error");
  assert.equal(captured.body.store, false);
  assert.deepEqual(captured.body.reasoning, { effort: "none" });
  assert.equal(captured.body.messages, undefined);
  assert.equal(captured.body.input[0].content.some((item) => item.type === "input_image" && item.detail === "high"), true);
  assert.equal(captured.body.text.format.type, "json_schema");
  assert.equal(result.reconstructionPrompt, "雾中的庭院。");
  assert.equal(result.tags.length, 1);
});

test("vision analysis requires consent before making a request", async () => {
  let called = false;
  await assert.rejects(() => analyzeImageWithVision({
    imageDataUrl: "data:image/png;base64,AAAA",
    catalog: createDefaultFacetCatalog(),
    settings: { activeProvider: "openai", openai: { apiKey: "secret" }, consent: false }
  }, async () => { called = true; }), /发送截图/);
  assert.equal(called, false);
});

test("creative output evaluation sends only the result image and current target evidence", async () => {
  let body;
  const result = await evaluateCreativeOutputWithVision({
    imageDataUrl: "data:image/webp;base64,AAAA",
    locale: "zh-CN",
    target: {
      targetType: "image",
      targetPlatform: "ChatGPT",
      userRequest: "保留柔和窗光，主体改成猫",
      finalPrompt: "A cat in soft window light",
      executionInstruction: "保留柔和窗光，只把主体改成猫。",
      fullLibrary: ["must not send"],
      apiKey: "must not send"
    },
    settings: {
      activeProvider: "openai",
      consent: true,
      openai: { apiKey: "secret", model: "gpt-5-mini" }
    }
  }, async (_url, options) => {
    body = JSON.parse(options.body);
    return {
      ok: true,
      json: async () => ({
        model: "gpt-5-mini",
        output_text: JSON.stringify({
          summary: "主体正确，窗光略硬。",
          checks: [
            { criterion: "猫主体", status: "met", evidence: "画面主体为猫" },
            { criterion: "柔和窗光", status: "partial", evidence: "方向正确但阴影偏硬" }
          ],
          primaryDeviation: {
            criterion: "柔和窗光",
            finding: "阴影偏硬",
            suggestedChange: "只把硬侧光改为大面积柔和窗光"
          }
        })
      })
    };
  });

  const sent = JSON.stringify(body);
  assert.match(sent, /保留柔和窗光/);
  assert.match(sent, /A cat in soft window light/);
  assert.match(sent, /input_image/);
  assert.doesNotMatch(sent, /must not send/);
  assert.equal(result.checks[0].status, "met");
  assert.equal(result.primaryDeviation.suggestedChange, "只把硬侧光改为大面积柔和窗光");
  assert.equal(Object.hasOwn(result, "score"), false);
  assert.equal(Object.hasOwn(result, "confidence"), false);
});

test("creative output evaluation rejects unsupported statuses and missing summaries", async () => {
  const input = {
    imageDataUrl: "data:image/png;base64,AAAA",
    target: { userRequest: "猫", finalPrompt: "cat", executionInstruction: "只修改主体。" },
    settings: { activeProvider: "openai", consent: true, openai: { apiKey: "secret" } }
  };
  await assert.rejects(() => evaluateCreativeOutputWithVision(input, async () => ({
    ok: true,
    json: async () => ({
      output_text: JSON.stringify({
        summary: "",
        checks: [{ criterion: "主体", status: "good", evidence: "猫" }],
        primaryDeviation: { criterion: "", finding: "", suggestedChange: "" }
      })
    })
  })), /对照摘要/);
});

test("vision service refusal, invalid JSON, missing description and HTTP errors are explicit", async () => {
  const input = {
    imageDataUrl: "data:image/png;base64,AAAA",
    catalog: createDefaultFacetCatalog(),
    settings: { activeProvider: "openai", openai: { apiKey: "secret" }, consent: true }
  };
  await assert.rejects(() => analyzeImageWithVision(input, async () => ({
    ok: true,
    json: async () => ({ output: [{ content: [{ type: "refusal", refusal: "not allowed" }] }] })
  })), /拒绝分析/);
  let invalidJsonCalls = 0;
  await assert.rejects(() => analyzeImageWithVision(input, async () => {
    invalidJsonCalls += 1;
    return {
      ok: true,
      json: async () => ({ output_text: "not-json" })
    };
  }), /JSON 无效/);
  assert.equal(invalidJsonCalls, 2);
  const partial = await analyzeImageWithVision(input, async () => ({
    ok: true,
    json: async () => ({ output_text: JSON.stringify(completeVisionResult("")) })
  }));
  assert.equal(partial.quality, "partial");
  assert.ok(partial.missingFields.includes("description"));
  const rateLimited = await analyzeImageWithVision(input, async () => ({
    ok: false,
    status: 429,
    json: async () => ({ error: { message: "rate limited" } })
  })).catch((error) => error);
  assert.match(rateLimited.message, /请求过于频繁/);
  assert.equal(rateLimited.status, 429);
  assert.match(rateLimited.detail, /rate limited/);
  assert.doesNotMatch(rateLimited.message, /rate limited/);
});
