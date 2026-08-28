import test from "node:test";
import assert from "node:assert/strict";

import { analyzeTextDetailedWithDeepSeek } from "../deepseek.js";
import { createFixedFacetCatalog } from "../tag-taxonomy.js";

test("detail text analysis sends the canonical primary-image prompt to DeepSeek", async () => {
  const requests = [];
  const result = await analyzeTextDetailedWithDeepSeek({
    id: "entry",
    title: "案例",
    text: "共享提示词",
    primaryMediaId: "image-a",
    mediaAssets: [{ id: "image-a", kind: "image" }],
    mediaPrompts: [{ assetId: "image-a", text: "当前图片提示词", updatedAt: "2026-08-21T09:30:00.000Z" }]
  }, createFixedFacetCatalog(), {
    apiKey: "test-key",
    consent: true,
    analysisModel: "deepseek-v4-flash"
  }, async (_url, options) => {
    requests.push(JSON.parse(options.body));
    return {
      ok: true,
      json: async () => ({
        choices: [{ finish_reason: "stop", message: { content: JSON.stringify({ tags: [{ g: "subject.character", t: "角色" }] }) } }],
        usage: { total_tokens: 9 }
      })
    };
  });

  assert.equal(result.tags.length, 1);
  const userMessage = requests[0].messages.find((item) => item.role === "user");
  assert.match(userMessage.content, /当前图片提示词/);
  assert.doesNotMatch(userMessage.content, /共享提示词/);
});

test("prompt-only compatible text analysis relies on the JSON instruction without sending response_format", async () => {
  let request;
  const result = await analyzeTextDetailedWithDeepSeek({
    id: "entry", title: "广告案例", text: "主体在前三秒出现"
  }, createFixedFacetCatalog(), {
    activeProvider: "compatible",
    consent: true,
    analysisModel: "glm-4.6v",
    compatible: {
      endpoint: "https://open.bigmodel.cn/api/paas/v4/chat/completions",
      apiKey: "zhipu-secret",
      model: "glm-4.6v",
      structuredOutput: "prompt_only"
    }
  }, async (_url, options) => {
    request = JSON.parse(options.body);
    return {
      ok: true,
      json: async () => ({
        model: "glm-4.6v",
        choices: [{ finish_reason: "stop", message: { content: JSON.stringify({ tags: [{ g: "subject.character", t: "角色" }] }) } }]
      })
    };
  });

  assert.equal(result.model, "glm-4.6v");
  assert.equal(Object.hasOwn(request, "response_format"), false);
  assert.equal(Object.hasOwn(request, "thinking"), false);
  assert.match(request.messages[0].content, /JSON/);
});

test("compatible forced-thinking models can supply a model-specific structured output budget", async () => {
  let request;
  await analyzeTextDetailedWithDeepSeek({
    id: "entry", title: "广告案例", text: "主体在前三秒出现"
  }, createFixedFacetCatalog(), {
    activeProvider: "compatible",
    consent: true,
    analysisModel: "glm-5.3-flash",
    compatible: {
      endpoint: "https://open.bigmodel.cn/api/paas/v4/chat/completions",
      apiKey: "zhipu-secret",
      model: "glm-5.3-flash",
      structuredOutput: "json_object",
      structuredOutputTokenBudget: 4096
    }
  }, async (_url, options) => {
    request = JSON.parse(options.body);
    return {
      ok: true,
      json: async () => ({
        model: "glm-5.3-flash",
        choices: [{ finish_reason: "stop", message: { content: JSON.stringify({ tags: [{ g: "subject.character", t: "角色" }] }) } }]
      })
    };
  });

  assert.equal(request.max_tokens, 4096);
  assert.equal(Object.hasOwn(request, "thinking"), false);
  assert.deepEqual(request.response_format, { type: "json_object" });
});

test("compatible analysis errors name the selected provider and redact its API key", async () => {
  await assert.rejects(() => analyzeTextDetailedWithDeepSeek({
    id: "entry", title: "广告案例", text: "主体在前三秒出现"
  }, createFixedFacetCatalog(), {
    activeProvider: "compatible",
    consent: true,
    compatible: {
      label: "智谱 GLM",
      endpoint: "https://open.bigmodel.cn/api/paas/v4/chat/completions",
      apiKey: "never-print-this-zhipu-key",
      model: "glm-5.3-flash",
      structuredOutput: "json_object"
    }
  }, async () => ({
    ok: false,
    status: 400,
    headers: new Headers(),
    json: async () => ({ error: { message: "invalid never-print-this-zhipu-key" } })
  })), (error) => {
    assert.match(error.message, /智谱 GLM 分析失败/);
    assert.doesNotMatch(error.message, /DeepSeek/);
    assert.doesNotMatch(error.message, /never-print-this-zhipu-key/);
    return true;
  });
});
