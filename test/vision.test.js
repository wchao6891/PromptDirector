import test from "node:test";
import assert from "node:assert/strict";

import {
  DEFAULT_VISION_MODEL,
  analyzeImageWithVision,
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

function completeVisionResult(description = "一名人物站在逆光环境中。", tags = []) {
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

test("vision result requires a complete reconstruction record and keeps at most six optional compact tags", () => {
  const values = Array.from({ length: 6 }, (_, index) => ({ g: "light.direction", t: `标签${index + 1}` }));
  const result = normalizeVisionResult(completeVisionResult("  主体处于逆光中。  ", values));
  assert.equal(result.description, "主体处于逆光中。");
  assert.equal(result.tags.length, 6);
  assert.deepEqual(Object.keys(result.tags[0]).sort(), ["g", "t"]);
  const overLimit = normalizeVisionResult(completeVisionResult("有效描述", [...values, values[0]]));
  assert.equal(overLimit.tags.length, 6);
  assert.equal(overLimit.tagDiagnostics.rejectedCount, 1);
  assert.throws(() => normalizeVisionResult(completeVisionResult("")), /画面描述/);
  assert.throws(() => normalizeVisionResult({ description: "旧版简述", tags: [] }), /画布信息/);
});

test("an invalid optional search tag cannot discard an otherwise complete paid visual analysis", () => {
  const result = normalizeVisionResult(completeVisionResult("主体分析完整。", [
    { g: "invented.path", t: "模型自造路径" }
  ]), sampleCatalog());
  assert.equal(result.description, "主体分析完整。");
  assert.deepEqual(result.tags, []);
  assert.equal(result.tagDiagnostics.rejectedCount, 1);
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
  assert.ok(request.text.format.schema.properties.elements.items.properties.box_2d);
  assert.equal(request.text.format.schema.properties.elements.items.properties.bbox, undefined);
  assert.ok(request.text.format.schema.properties.tags.items.properties.g.enum.includes("light.direction"));
  assert.equal(request.text.format.schema.properties.tags.items.properties.g.enum.includes("detail:secret"), false);
  const content = request.input[0].content;
  assert.deepEqual(content.find((item) => item.type === "input_image"), {
    type: "input_image", image_url: "data:image/webp;base64,AAAA", detail: "high"
  });
  const sentText = content.filter((item) => item.type === "input_text").map((item) => item.text).join("\n");
  assert.match(sentText, /优先描述空间关系/);
  assert.match(sentText, /light\.direction/);
  assert.doesNotMatch(sentText, /secret-dynamic-tag/);
  assert.doesNotMatch(sentText, /example\.com|原提示词|案例标题/);
  assert.doesNotMatch(sentText, /1280x720|serviceDeclaredGeneration/);
  assert.equal(result.description, "一名人物站在逆光环境中。");
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

test("compatible request uses Chat Completions image messages and refuses redirects", async () => {
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
        endpoint: "https://vision.example.com/v1/chat/completions",
        apiKey: "secret",
        model: "vision-pro"
      }
    }
  }, fetchStub);
  const body = JSON.parse(options.body);
  assert.equal(options.redirect, "error");
  assert.equal(body.messages[0].content.some((item) => item.type === "image_url" && item.image_url.detail === "high"), true);
  assert.equal(body.max_tokens, 12000);
});

test("compatible Responses request sends the OpenAI image shape and parses structured output", async () => {
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
        model: "gpt-5.4-mini"
      }
    }
  }, async (url, options) => {
    captured = { url, options, body: JSON.parse(options.body) };
    return {
      ok: true,
      json: async () => ({
        model: "gpt-5.4-mini",
        output: [{
          type: "message",
          content: [{
            type: "output_text",
            text: JSON.stringify(completeVisionResult("雾中的庭院。", [{ g: "light.direction", t: "逆光" }]))
          }]
        }]
      })
    };
  });
  assert.equal(captured.url, "https://www.micuapi.ai/v1/responses");
  assert.equal(captured.options.redirect, "error");
  assert.equal(captured.body.store, false);
  assert.equal(captured.body.messages, undefined);
  assert.equal(captured.body.input[0].content.some((item) => item.type === "input_image" && item.detail === "high"), true);
  assert.equal(captured.body.text.format.type, "json_schema");
  assert.equal(result.description, "雾中的庭院。");
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
  await assert.rejects(() => analyzeImageWithVision(input, async () => ({
    ok: true,
    json: async () => ({ output_text: "not-json" })
  })), /JSON 无效/);
  await assert.rejects(() => analyzeImageWithVision(input, async () => ({
    ok: true,
    json: async () => ({ output_text: JSON.stringify(completeVisionResult("")) })
  })), /没有返回画面描述/);
  await assert.rejects(() => analyzeImageWithVision(input, async () => ({
    ok: false,
    status: 429,
    json: async () => ({ error: { message: "rate limited" } })
  })), /rate limited/);
});
