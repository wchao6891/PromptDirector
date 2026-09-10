import test from "node:test";
import assert from "node:assert/strict";
import { analyzeTextDetailedWithDeepSeek } from "../extension/deepseek.js";
import { analyzeImageWithVision } from "../extension/vision.js";
import { analyzeVideoWithChatCompletions } from "../extension/video-analysis.js";
import { createDefaultFacetCatalog } from "../extension/facets.js";
import { runScheduledAnalysisWithRetries } from "../extension/analysis-scheduler.js";
import { inspectAnalysisResponse, fetchAnalysisJson } from "../extension/analysis-response.js";
import { normalizeEntryMedia } from "../extension/media.js";

const catalog = createDefaultFacetCatalog();
test("unknown video cost remains unknown through save and normalization", () => {
  const entry = normalizeEntryMedia({ id: "fixture", videoAnalyses: [{ id: "analysis", text: "fixture", cost: null }] });
  assert.equal(entry.videoAnalyses[0].cost, null);
});
const settings = { activeProvider: "compatible", consent: true, compatible: {
  endpoint: "https://fixture.example/v1/chat/completions", apiKey: "fixture-not-a-key", model: "fixture-model"
} };
const content = JSON.stringify({ reconstructionPrompt: "离线夹具：人物站在逆光下。", tags: [{ g: "light.direction", t: "逆光" }], uncertainties: [] });
const routes = {
  text: (fetchImpl) => analyzeTextDetailedWithDeepSeek({ id: "fixture", text: "离线文字夹具" }, catalog, settings, fetchImpl),
  image: (fetchImpl) => analyzeImageWithVision({ settings, catalog, imageDataUrl: "data:image/png;base64,AQID" }, fetchImpl),
  video: (fetchImpl) => analyzeVideoWithChatCompletions({ apiKey: "fixture-not-a-key", model: "fixture-model",
    endpoint: settings.compatible.endpoint, mode: "visual-reconstruction", requestId: "fixture-attempt", catalog,
    videoBlob: new Blob([new Uint8Array([1, 2, 3])], { type: "video/mp4" }) }, { fetchImpl })
};

for (const [kind, run] of Object.entries(routes)) {
  for (const text of ["", content]) test(`${kind}: truncated output never becomes complete or an empty service error`, async () => {
    let calls = 0;
    await assert.rejects(run(async () => {
      calls++;
      return new Response(JSON.stringify({ choices: [{ finish_reason: "length", message: { content: text } }] }), { status: 200 });
    }), (error) => error.code === "output_truncated" && error.diagnostic?.finishReason === "length" && error.diagnostic?.httpStatus === 200);
    assert.equal(calls, 1, "repeating an unchanged truncated request cannot repair its budget");
  });
  test(`${kind}: HTTP 200 error envelope remains a provider error without leaking its message`, async () => {
    await assert.rejects(run(async () => new Response(JSON.stringify({ error: { code: 429, message: "fixture-not-a-key private input" } }), { status: 200 })), error => {
      assert.equal(error.code, "provider_error");
      assert.equal(error.diagnostic.httpStatus, 200);
      assert.equal(error.diagnostic.providerCode, "429");
      assert.doesNotMatch(JSON.stringify(error), /fixture-not-a-key|private input/);
      return true;
    });
  });
}

test("one text operation never exceeds three calls across nested service recovery and correction", async () => {
  let calls = 0;
  await assert.rejects(runScheduledAnalysisWithRetries({
    key: "regression:text-budget", concurrency: 1, wait: async () => {}, jitter: () => 0,
    task: (requestBudget) => analyzeTextDetailedWithDeepSeek({ id: "fixture", text: "离线预算夹具" }, catalog, settings, async () => {
      calls++;
      return new Response(JSON.stringify(calls % 2
        ? { choices: [{ finish_reason: "stop", message: { content: "not JSON" } }] }
        : { error: { message: "busy" } }), { status: calls % 2 ? 200 : 503 });
    }, { requestBudget })
  }));
  assert.equal(calls, 3);
});

test("stopping image analysis after headers aborts body reading without a correction", async () => {
  const controller = new AbortController();
  let networkSignal;
  let calls = 0;
  const result = analyzeImageWithVision({ settings, catalog, imageDataUrl: "data:image/png;base64,AQID", signal: controller.signal }, async (_url, options) => {
    calls++;
    networkSignal = options.signal;
    return { ok: true, status: 200, json: () => {
      controller.abort();
      return new Promise(() => {});
    } };
  });
  await assert.rejects(result, error => error.name === "AbortError");
  assert.equal(networkSignal.aborted, true);
  assert.equal(calls, 1);
});

test("image body has an injectable deadline even when transport ignores abort", async () => {
  await assert.rejects(analyzeImageWithVision({ settings, catalog, imageDataUrl: "data:image/png;base64,AQID", timeoutMs: 10 }, async () => ({
    ok: true, status: 200, json: () => new Promise(() => {})
  })), error => error.code === "request_timeout" && error.diagnostic.httpStatus === 200);
});

for (const [protocol, payload] of [
  ["responses", { status: "incomplete", incomplete_details: { reason: "max_output_tokens" }, output_text: content }],
  ["gemini", { candidates: [{ finishReason: "MAX_TOKENS", content: { parts: [{ text: content }] } }] }]
]) test(`${protocol}: even valid JSON cannot override provider truncation`, () => {
  assert.throws(() => inspectAnalysisResponse(payload, { protocol }), error => error.code === "output_truncated" && error.recovery === "none");
});

test("Gemini thought parts never enter final analysis text", () => {
  const result = inspectAnalysisResponse({ candidates: [{ finishReason: "STOP", content: { parts: [
    { thought: true, text: "private reasoning" }, { text: content }
  ] } }] }, { protocol: "gemini" });
  assert.equal(result.text, content);
  assert.equal(result.diagnostic.reasoningPresent, true);
});

test("HTTP 200 rate limit obeys Retry-After while quota and disconnected requests never auto-retry", async () => {
  const error = await fetchAnalysisJson(async () => new Response(JSON.stringify({ error: { code: 429 } }), {
    status: 200, headers: { "Retry-After": "2" }
  }), "https://fixture.example", {}).catch(error => error);
  assert.equal(error.retryAfterMs, 2000);
  assert.equal(error.recovery, "retry");
  for (const fetchImpl of [
    async () => new Response(JSON.stringify({ error: { code: "insufficient_quota" } }), { status: 429 }),
    async () => { throw new TypeError("private network details"); }
  ]) {
    let calls = 0;
    await assert.rejects(runScheduledAnalysisWithRetries({ key: "nonretry", task: () => {
      calls++;
      return fetchAnalysisJson(fetchImpl, "https://fixture.example", {});
    } }), error => error.recovery === "none");
    assert.equal(calls, 1);
  }
});
