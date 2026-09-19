import test from "node:test";
import assert from "node:assert/strict";
import { aiConfigurationFromStorage, projectAiRuntime } from "../extension/ai-runtime.js";
import { createComposerSession } from "../extension/composer.js";
import { executeComposerTurnWithService } from "../extension/composer-service.js";
import { readDeepSeekSse } from "../extension/deepseek.js";
import { runComposerToolLoop } from "../extension/composer-tool-loop.js";

function runtime(protocol) {
  const endpoint = `https://compatible.example/v1/${protocol === "responses" ? "responses" : "chat/completions"}`;
  const configuration = aiConfigurationFromStorage({
    aiProviderRegistry: { version: 4, providers: { "custom-text": {
      endpoint, protocol, apiKey: "fixture-key", consent: true,
      models: { creativePlanning: "account-model" },
      discoveredModels: [{ id: "account-model", status: "available", confidence: "declared",
        tasks: ["creativePlanning"], inputModalities: ["text", "image"], outputModalities: ["text"] }]
    } } },
    aiTaskAssignments: { creativePlanning: { providerId: "custom-text", model: "account-model" } }
  });
  const projected = projectAiRuntime(configuration);
  return { endpoint, settings: { ai: projected.aiSettings, vision: projected.visionSettings } };
}

const image = { visualId: "selected-image", dataUrl: "data:image/png;base64,AQID" };
function session() {
  return createComposerSession({
    aiProfile: { serviceId: "custom-text", model: "account-model" },
    referenceSnapshots: [{ entryId: "selected-case", alias: "@参考1", originalText: "原始文字",
      imageRefs: [{ visualId: image.visualId, mimeType: "image/png" }] }],
    messages: [{ role: "user", type: "request", content: "分析选中的图片" }]
  });
}

function streamedResponse(text) {
  const bytes = new TextEncoder().encode(text);
  // One-byte chunks also split Chinese UTF-8 and CRLF boundaries.
  return new Response(new ReadableStream({ start(controller) {
    for (const byte of bytes) controller.enqueue(Uint8Array.of(byte));
    controller.close();
  } }), { headers: { "Content-Type": "text/event-stream" } });
}

for (const protocol of ["chat_completions", "responses"]) {
  for (const framing of ["lf", "crlf", "cr", "multiline"]) {
    test(`compatible text service preserves selected image and completed ${protocol} reply with ${framing} framing`, async () => {
      const { endpoint, settings } = runtime(protocol);
      const events = protocol === "responses" ? [
        { type: "response.output_text.delta", delta: "图片分析结果" },
        { type: "response.completed", response: { status: "completed", model: "account-model" } }
      ] : [
        { choices: [{ delta: { content: "图片分析结果" }, finish_reason: null }] },
        { choices: [{ delta: {}, finish_reason: "stop" }] }
      ];
      const separator = framing === "crlf" ? "\r\n" : framing === "cr" ? "\r" : "\n";
      const data = events.map(event => {
        const json = JSON.stringify(event, null, framing === "multiline" ? 2 : undefined);
        return json.split("\n").map(line => `data: ${line}`).join(separator) + separator + separator;
      }).join("");
      const calls = [];
      const result = await executeComposerTurnWithService({ session: session(), route: "analyze_materials", instruction: "分析参考" }, settings, [image], {
        fetchImpl: async (url, options) => { calls.push({ url, body: JSON.parse(options.body) }); return streamedResponse(data); }
      });
      assert.equal(result.text, "图片分析结果");
      assert.equal(calls.length, 1, "one paid request, no protocol retry");
      assert.equal(calls[0].url, endpoint);
      assert.equal(calls[0].body.model, "account-model");
      const content = protocol === "responses" ? calls[0].body.input[0].content : calls[0].body.messages[1].content;
      const images = content.filter(part => ["input_image", "image_url"].includes(part.type));
      assert.equal(images.length, 1);
      assert.equal(protocol === "responses" ? images[0].image_url : images[0].image_url.url, image.dataUrl);
    });
  }
  test(`compatible ${protocol} does not save a reply whose terminal event was cut off`, async () => {
    const { settings } = runtime(protocol);
    const delta = protocol === "responses" ? { type: "response.output_text.delta", delta: "部分结果" }
      : { choices: [{ delta: { content: "部分结果" } }] };
    const terminal = protocol === "responses" ? { type: "response.completed", response: { status: "completed" } }
      : { choices: [{ delta: {}, finish_reason: "stop" }] };
    let calls = 0;
    await assert.rejects(executeComposerTurnWithService({ session: session(), route: "analyze_materials" }, settings, [image], {
      fetchImpl: async () => { calls++; return streamedResponse(`data: ${JSON.stringify(delta)}\n\ndata: ${JSON.stringify(terminal).slice(0, -1)}`); }
    }), /完整|中断/);
    assert.equal(calls, 1);
  });
}

test("text generation reads standard CR-only events and the required completion marker", async () => {
  const events = [
    { choices: [{ delta: { content: "中文回复" } }] },
    { choices: [{ delta: {}, finish_reason: "stop" }] }
  ];
  const response = streamedResponse(events.map(event => `data: ${JSON.stringify(event)}\r\r`).join("") + "data: [DONE]\r\r");
  assert.equal((await readDeepSeekSse(response)).content, "中文回复");
});

for (const complete of [true, false]) {
  test(`tool execution requires a complete CR-only event: ${complete}`, async () => {
    let requests = 0;
    let executions = 0;
    const event = { choices: [{ delta: { tool_calls: [{ index: 0, id: "call-1", type: "function",
      function: { name: "search_cases", arguments: '{"query":"雨夜"}' } }] }, finish_reason: "tool_calls" }] };
    const run = runComposerToolLoop({
      body: { model: "fixture", messages: [{ role: "user", content: "查资料" }] }, protocol: "chat_completions", maxCharacters: 10000,
      request: async () => {
        requests++;
        return requests === 1 ? streamedResponse(`data: ${complete ? JSON.stringify(event) + "\r\r" : JSON.stringify(event).slice(0, -1)}`)
          : new Response(JSON.stringify({ choices: [{ message: { content: "找到资料" }, finish_reason: "stop" }] }), { headers: { "Content-Type": "application/json" } });
      },
      runtime: { specs: [{ name: "search_cases", parameters: { type: "object", properties: { query: { type: "string" } } } }],
        execute: async (_name, args) => { executions++; assert.equal(args.query, "雨夜"); return { data: { count: 1 } }; } }
    });
    if (complete) {
      assert.equal((await run).content, "找到资料");
      assert.equal(executions, 1);
      assert.equal(requests, 2);
    } else {
      await assert.rejects(run, /中断|JSON/);
      assert.equal(executions, 0);
      assert.equal(requests, 1);
    }
  });
}
