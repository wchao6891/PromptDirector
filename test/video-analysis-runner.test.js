import test from "node:test";
import assert from "node:assert/strict";

import { runVideoAnalysisJob } from "../extension/video-analysis-runner.js";
import { AnalysisResponseError } from "../extension/analysis-response.js";
import { analyzeVideoWithChatCompletions } from "../extension/video-analysis.js";

function job(overrides = {}) {
  return {
    taskId: "task:video",
    attemptId: "attempt:video",
    deadlineAt: new Date(Date.now() + 5_000).toISOString(),
    instruction: "逆推画面",
    outputLocale: "zh-CN",
    sourceKind: "local-video",
    sourceFingerprint: "fingerprint:video",
    catalog: {},
    asset: { id: "video:one", storageMode: "managed", mimeType: "video/mp4", durationMs: 1_000 },
    route: {
      protocol: "chat_completions",
      providerLabel: "智谱 GLM",
      apiKey: "secret",
      endpoint: "https://example.com/chat/completions",
      model: "glm-5.3-flash",
      localVideo: "base64",
      preferPublicVideoUrl: false,
      publicVideoUrl: "direct"
    },
    ...overrides
  };
}

test("Offscreen runner loads the stored video, preserves one request, and reports the paid boundary", async () => {
  const phases = [];
  let calls = 0;
  const result = await runVideoAnalysisJob(job(), {
    loadVideo: async () => new Blob(["video"], { type: "video/mp4" }),
    fingerprint: async () => "fingerprint:video",
    progress: async (value) => phases.push(value),
    adapters: {
      chat_completions: async (input) => {
        calls += 1;
        await input.onStage("analyzing");
        return { reconstructionPrompt: "成片提示词", tags: [], uncertainties: [] };
      }
    }
  });

  assert.equal(calls, 1);
  assert.equal(result.reconstructionPrompt, "成片提示词");
  assert.ok(phases.some((item) => item.phase === "encoding" && item.providerMayHaveAccepted === false));
  assert.ok(phases.some((item) => item.phase === "analyzing" && item.providerMayHaveAccepted === true));
});

for (const locale of ["zh-CN", "en"]) test(`editable ${locale} method reaches the real request without a second audio request`, async () => {
  const method = locale === "en" ? "Personal method: track each visible movement." : "个人方法：核对每个可见动作。";
  const bodies = [];
  const route = { ...job().route, maxOutputTokens: 16384 };
  const result = await runVideoAnalysisJob(job({ instruction: method, outputLocale: locale, route }), {
    loadVideo: async () => new Blob(["offline-video-fixture"], { type: "video/mp4" }), fingerprint: async () => "fingerprint:video",
    adapters: { chat_completions: input => analyzeVideoWithChatCompletions(input, { fetchImpl: async (_url, options) => {
      bodies.push(JSON.parse(options.body));
      return new Response(JSON.stringify({ choices: [{ finish_reason: "stop", message: { content: JSON.stringify({
        reconstructionPrompt: locale === "en" ? "Offline fixture: the subject moves into a close-up." : "离线夹具：主体移动进入近景。",
        tags: [{ g: "style.render", t: "电影写实" }, { g: "camera.shot", t: "近景" }, { g: "light.palette", t: "冷暖对比" }, { g: "action.change", t: "渐变显现" }],
        uncertainties: [locale === "en" ? "Audio could not be identified." : "无法辨认音轨。"]
      }) } }] }), { status: 200 });
    } }) }
  });
  assert.equal(bodies.length, 1);
  assert.equal(bodies[0].model, route.model);
  assert.equal(bodies[0].max_tokens, route.maxOutputTokens);
  assert.ok(bodies[0].messages[0].content[0].text.includes(method));
  assert.equal(bodies[0].messages[0].content[1].type, "video_url");
  assert.equal(result.uncertainties.length, 1);
  assert.equal(result.analysisScope, "video");
});

test("video recovery shares three calls and one correction while preserving distinct request ids", async () => {
  const ids = [];
  const progress = [];
  await assert.rejects(runVideoAnalysisJob(job(), {
    wait: async () => {},
    loadVideo: async () => new Blob(["video"], { type: "video/mp4" }), fingerprint: async () => "fingerprint:video",
    progress: async value => progress.push(value),
    adapters: { chat_completions: async input => {
      await input.onRequestStart();
      ids.push(input.requestId);
      throw ids.length === 1
        ? new AnalysisResponseError("invalid_output", "格式无效", { finishReason: "stop" }, "correct")
        : new AnalysisResponseError("provider_error", "繁忙", { httpStatus: 503 }, "retry");
    } }
  }));
  assert.equal(ids.length, 3);
  assert.equal(new Set(ids).size, 3);
  assert.equal(progress.at(-1).requestBudget.providerCalls, 3);
  assert.equal(progress.at(-1).requestBudget.outputCorrectionRequests, 1);
  assert.ok(progress.some(item => item.phase === "correcting"));
});

test("real video adapter corrects invalid completed output once without changing media, model or output budget", async () => {
  const bodies = [];
  const result = await runVideoAnalysisJob(job({ route: { ...job().route, maxOutputTokens: 4096 } }), {
    loadVideo: async () => new Blob(["video"], { type: "video/mp4" }), fingerprint: async () => "fingerprint:video",
    adapters: { chat_completions: input => analyzeVideoWithChatCompletions(input, { fetchImpl: async (_url, options) => {
      bodies.push(JSON.parse(options.body));
      return new Response(JSON.stringify({ choices: [{ finish_reason: "stop", message: { content: bodies.length === 1 ? "not JSON" : JSON.stringify({
        reconstructionPrompt: "离线夹具：近景中主体渐变显现，冷暖对比光线。",
        tags: [{ g: "style.render", t: "电影写实" }, { g: "camera.shot", t: "近景" }, { g: "light.palette", t: "冷暖对比" }, { g: "action.change", t: "渐变显现" }],
        uncertainties: []
      }) } }] }), { status: 200 });
    } }) }
  });
  assert.equal(bodies.length, 2);
  assert.equal(result.requestBudget.outputCorrectionRequests, 1);
  assert.notEqual(bodies[0].request_id, bodies[1].request_id);
  assert.equal(bodies[0].model, bodies[1].model);
  assert.equal(bodies[1].max_tokens, 4096);
  assert.deepEqual(bodies[0].messages[0].content[1], bodies[1].messages[0].content[1]);
  assert.equal(result.tags.length, 4);
  assert.equal(result.cost, null);
  assert.equal(result.usage.totalTokens, null);
});

test("Offscreen runner aborts at the persisted deadline and never retries", async () => {
  let calls = 0;
  let sawAbort = false;
  await assert.rejects(runVideoAnalysisJob(job({ deadlineAt: new Date(Date.now() + 15).toISOString() }), {
    loadVideo: async () => new Blob(["video"], { type: "video/mp4" }),
    fingerprint: async () => "fingerprint:video",
    adapters: {
      chat_completions: async (input) => {
        calls += 1;
        await new Promise((resolve) => input.signal.addEventListener("abort", () => {
          sawAbort = true;
          resolve();
        }, { once: true }));
        throw input.signal.reason;
      }
    }
  }), /5 分钟/);
  assert.equal(calls, 1);
  assert.equal(sawAbort, true);
});

test("stop settles immediately even if the adapter ignores AbortSignal; late content cannot win", async () => {
  const controller = new AbortController();
  let complete;
  let calls = 0;
  let started;
  const ready = new Promise((resolve) => { started = resolve; });
  const pending = runVideoAnalysisJob(job(), {
    signal: controller.signal,
    loadVideo: async () => new Blob(["video"], { type: "video/mp4" }),
    fingerprint: async () => "fingerprint:video",
    adapters: { chat_completions: () => {
      calls += 1;
      started();
      return new Promise((resolve) => { complete = resolve; });
    } }
  });
  await ready;
  controller.abort();
  await assert.rejects(pending, { name: "AbortError" });
  complete({ reconstructionPrompt: "迟到内容" });
  assert.equal(calls, 1);
});

test("an expired deadline or a changed video cannot start a provider request", async () => {
  let requests = 0;
  const context = {
    loadVideo: async () => new Blob(["changed"], { type: "video/mp4" }),
    fingerprint: async () => "different",
    adapters: { chat_completions: async () => { requests += 1; } }
  };
  await assert.rejects(runVideoAnalysisJob(job({ deadlineAt: new Date(0).toISOString() }), context), /等待/);
  await assert.rejects(runVideoAnalysisJob(job(), context), /文件在发送前已经变化/);
  assert.equal(requests, 0);
});

test("the Offscreen native Gemini route preserves the selected public YouTube source", async () => {
  const youtubeUrl = "https://www.youtube.com/watch?v=fixture";
  await runVideoAnalysisJob(job({
    sourceKind: "public-video-url", sourceFingerprint: "",
    asset: { id: "video", storageMode: "reference", referenceUrl: youtubeUrl },
    route: { protocol: "gemini", providerLabel: "Google Gemini", model: "video-model" }
  }), {
    loadVideo: async () => { throw new Error("A public source must not be loaded as a local blob"); },
    adapters: { gemini: async (input) => {
      assert.equal(input.youtubeUrl, youtubeUrl);
      assert.equal(input.videoBlob, null);
      return { reconstructionPrompt: "可见画面" };
    } }
  });
});
