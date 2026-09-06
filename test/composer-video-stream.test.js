import test from "node:test";
import assert from "node:assert/strict";
import { createComposerSession } from "../composer.js";
import { executeComposerTurnWithService } from "../composer-service.js";

const model = "glm-5.3-flash";
const session = createComposerSession({
  targetType: "video", aiProfile: { serviceId: "zhipu", model },
  messages: [{ role: "user", type: "request", content: "描述动作" }],
  referenceSnapshots: [{ entryId: "case", alias: "@参考1", referenceKind: "video_sources",
    assetRefs: [{ assetId: "video", kind: "video", mimeType: "video/mp4" }] }]
});
const settings = { ai: {}, vision: { providerProfiles: { zhipu: {
  id: "zhipu", label: "智谱 GLM", protocol: "chat_completions",
  endpoint: "https://open.bigmodel.cn/api/paas/v4", apiKey: "test-only", consent: true,
  discoveredModels: [{ id: model, tasks: ["creativePlanning", "videoAnalysis"], inputModalities: ["text", "video"], outputModalities: ["text"] }]
} } } };

for (const boundary of ["length", "abort"]) {
  test(`video stream ${boundary} preserves received text, rejects completion, and never resends`, async () => {
    const controller = new AbortController();
    let calls = 0;
    let canceled = false;
    let partial = "";
    const execute = executeComposerTurnWithService({ session, route: "analyze_materials", instruction: "描述动作" }, settings, [], {
      signal: controller.signal, stream: true,
      preparedVideos: [{ assetId: "video", dataUrl: "data:video/mp4;base64,dmlkZW8=", mimeType: "video/mp4" }],
      onDelta: (_delta, text) => {
        partial = text;
        if (boundary === "abort") controller.abort();
      },
      fetchImpl: async () => {
        calls += 1;
        return new Response(new ReadableStream({
          start(stream) {
            stream.enqueue(new TextEncoder().encode(`data: ${JSON.stringify({choices: [{delta: {content: "主体向右移动"}, finish_reason: boundary === "length" ? "length" : null}]})}\n\n`));
            if (boundary === "length") stream.close();
          },
          cancel() { canceled = true; }
        }), { headers: { "Content-Type": "text/event-stream" } });
      }
    });
    await assert.rejects(execute, boundary === "length" ? /截断/ : { name: "AbortError" });
    assert.equal(partial, "主体向右移动");
    assert.equal(calls, 1);
    if (boundary === "abort") assert.equal(canceled, true);
  });
}

for (const boundary of ["provider-error", "content_filter", "eof", "unterminated-stop"]) {
  test(`video stream ${boundary} cannot turn partial provider output into a false success`, async () => {
    let calls = 0;
    let partial = "";
    const first = `data: ${JSON.stringify({ choices: [{ delta: { content: "主体向右移动" }, finish_reason: null }] })}\n\n`;
    const last = boundary === "provider-error" ? `data: ${JSON.stringify({ error: { message: "test-only upstream failure" } })}\n\n`
      : boundary === "content_filter" ? `data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: "content_filter" }] })}\n\n`
      : boundary === "unterminated-stop" ? `data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: "stop" }] })}` : "";
    const execution = executeComposerTurnWithService({ session, route: "analyze_materials", instruction: "描述动作" }, settings, [], {
      stream: true,
      preparedVideos: [{ assetId: "video", dataUrl: "data:video/mp4;base64,dmlkZW8=", mimeType: "video/mp4" }],
      onDelta: (_delta, text) => { partial = text; },
      fetchImpl: async () => {
        calls += 1;
        return new Response(first + last, { headers: { "Content-Type": "text/event-stream" } });
      }
    });
    if (boundary === "unterminated-stop") assert.equal((await execution).text, "主体向右移动");
    else await assert.rejects(execution, /失败|中断|完整|阻止/);
    assert.equal(partial, "主体向右移动");
    assert.equal(calls, 1);
  });
}
