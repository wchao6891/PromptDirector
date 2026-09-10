import test from "node:test";
import assert from "node:assert/strict";
import {
  analyzeVideoWithChatCompletions,
  analyzeVideoWithGemini,
  analyzeVideoWithOpenRouter,
  chatCompletionsVideoSourcePlan,
  publicYouTubeUrl,
  requireVideoAnalysisConfirmation,
  VIDEO_RECONSTRUCTION_CONTRACT_VERSION,
  videoAnalysisPrompt
} from "../extension/video-analysis.js";

test("a direct video request times out once without retrying or accepting a late response", async () => {
  let calls = 0;
  let resolveFetch;
  const pendingResponse = new Promise((resolve) => { resolveFetch = resolve; });
  const promise = analyzeVideoWithChatCompletions({
    apiKey: "zhipu-key",
    endpoint: "https://open.bigmodel.cn/api/paas/v4/chat/completions",
    providerLabel: "智谱 GLM",
    model: "glm-5.3-flash",
    mode: "content-summary",
    localVideo: "base64",
    videoBlob: new Blob([new Uint8Array([1, 2, 3])], { type: "video/mp4" })
  }, {
    requestTimeoutMs: 10,
    fetchImpl: async () => {
      calls += 1;
      return pendingResponse;
    }
  });

  await assert.rejects(promise, (error) => {
    assert.equal(error.code, "VIDEO_ANALYSIS_TIMEOUT");
    assert.equal(error.status, 408);
    assert.match(error.message, /等待已达 5 分钟/);
    assert.doesNotMatch(error.message, /zhipu-key/);
    return true;
  });
  assert.equal(calls, 1);

  resolveFetch(new Response(JSON.stringify({
    choices: [{ message: { content: "迟到结果" } }]
  }), { status: 200, headers: { "content-type": "application/json" } }));
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(calls, 1);
});

test("stopping a direct video request does not wait for a fetch mock that ignores AbortSignal", async () => {
  const controller = new AbortController();
  const pendingResponse = new Promise(() => {});
  let resolveStarted;
  const started = new Promise((resolve) => { resolveStarted = resolve; });
  const promise = analyzeVideoWithChatCompletions({
    apiKey: "zhipu-key",
    endpoint: "https://open.bigmodel.cn/api/paas/v4/chat/completions",
    providerLabel: "智谱 GLM",
    model: "glm-5.3-flash",
    mode: "content-summary",
    signal: controller.signal,
    localVideo: "base64",
    videoBlob: new Blob([new Uint8Array([1])], { type: "video/mp4" })
  }, {
    requestTimeoutMs: 1_000,
    fetchImpl: async () => {
      resolveStarted();
      return pendingResponse;
    }
  });

  await started;
  const stoppedAt = Date.now();
  controller.abort(new DOMException("Stopped by user", "AbortError"));
  await assert.rejects(promise, /Stopped by user|aborted/);
  assert.ok(Date.now() - stoppedAt < 100, "stop should settle without waiting for the request deadline");
});

for (const boundary of ["deadline", "stop"]) {
  test(`video ${boundary} still aborts the network after response headers arrive`, async () => {
    const controller = new AbortController();
    let requests = 0;
    let networkSignal;
    let reading;
    const bodyStarted = new Promise((resolve) => { reading = resolve; });
    const pending = analyzeVideoWithChatCompletions({
      apiKey: "test-only", endpoint: "https://example.com/chat/completions", model: "video-model",
      videoBlob: new Blob(["video"], { type: "video/mp4" }), signal: controller.signal
    }, {
      requestTimeoutMs: boundary === "deadline" ? 15 : 1_000,
      fetchImpl: async (_url, options) => {
        requests += 1;
        networkSignal = options.signal;
        return { ok: true, status: 200, json: async () => { reading(); return new Promise(() => {}); } };
      }
    });
    await bodyStarted;
    if (boundary === "stop") controller.abort();
    await assert.rejects(pending, boundary === "deadline" ? { code: "VIDEO_ANALYSIS_TIMEOUT" } : { name: "AbortError" });
    assert.equal(networkSignal.aborted, true);
    assert.equal(requests, 1);
  });
}

test("Chat Completions preserves Markdown line structure in a saved video analysis", async () => {
  const markdown = "### 镜头结构\n\n**00:01 开场**\n\n- 00:03 推进";
  const result = await analyzeVideoWithChatCompletions({
    apiKey: "zhipu-key",
    endpoint: "https://open.bigmodel.cn/api/paas/v4/chat/completions",
    providerLabel: "智谱 GLM",
    model: "glm-5.3-flash",
    mode: "creative-breakdown",
    localVideo: "base64",
    videoBlob: new Blob([new Uint8Array([1])], { type: "video/mp4" })
  }, {
    fetchImpl: async () => new Response(JSON.stringify({
      choices: [{ message: { content: markdown }, finish_reason: "stop" }]
    }), { status: 200, headers: { "content-type": "application/json" } })
  });

  assert.equal(result.text, markdown);
});

test("the provider acceptance stage is persisted only after the direct request starts", async () => {
  let calls = 0;
  const stages = [];
  await analyzeVideoWithChatCompletions({
    apiKey: "zhipu-key",
    endpoint: "https://open.bigmodel.cn/api/paas/v4/chat/completions",
    providerLabel: "智谱 GLM",
    model: "glm-5.3-flash",
    mode: "content-summary",
    localVideo: "base64",
    videoBlob: new Blob([new Uint8Array([1])], { type: "video/mp4" }),
    onStage: async (phase) => stages.push({ phase, calls })
  }, {
    fetchImpl: async () => {
      calls += 1;
      return new Response(JSON.stringify({
        choices: [{ message: { content: "00:01 开场" }, finish_reason: "stop" }]
      }), { status: 200, headers: { "content-type": "application/json" } });
    }
  });

  assert.deepEqual(stages, [
    { phase: "encoding", calls: 0 },
    { phase: "analyzing", calls: 1 }
  ]);
});

test("video analysis execution requires the current paid-media confirmation", () => {
  assert.throws(() => requireVideoAnalysisConfirmation(), /确认框/);
  assert.throws(() => requireVideoAnalysisConfirmation("true"), /确认框/);
  assert.equal(requireVideoAnalysisConfirmation(true), true);
});

test("only public HTTPS YouTube URLs are accepted for URL video understanding", () => {
  assert.equal(publicYouTubeUrl("https://youtu.be/abc"), "https://youtu.be/abc");
  assert.equal(publicYouTubeUrl("https://www.bilibili.com/video/BV1"), "");
  assert.equal(publicYouTubeUrl("javascript:alert(1)"), "");
});

test("custom video analysis requires an explicit question", () => {
  assert.throws(() => videoAnalysisPrompt("custom", ""), /填写/);
  assert.match(videoAnalysisPrompt("custom", "比较前后节奏"), /比较前后节奏/);
});

test("the production reconstruction prompt grounds audiovisual reconstruction in actual evidence", () => {
  const prompt = videoAnalysisPrompt("visual-reconstruction", "", {
    includeTags: true,
    durationMs: 12_345,
    width: 1920,
    height: 1080
  });
  assert.match(prompt, /12\.345 秒/);
  assert.match(prompt, /1920×1080/);
  assert.match(prompt, /开始状态、变化过程和结束状态/);
  assert.match(prompt, /音轨无法读取或辨认/);
  assert.match(prompt, /fixedPaths=/);
  assert.doesNotMatch(prompt, /\["sound"/);
});

test("a customized video method remains wrapped by the fixed structured-output contract", () => {
  const prompt = videoAnalysisPrompt("visual-reconstruction", "", {
    instruction: "优先拆解角色动作与镜头衔接",
    includeTags: true,
    locale: "zh-CN"
  });
  assert.match(prompt, /优先拆解角色动作与镜头衔接/);
  assert.match(prompt, /reconstructionPrompt、tags、uncertainties/);
  assert.match(prompt, /返回一个 JSON 对象/);
});

test("Gemini YouTube analysis reports the real source, model and usage", async () => {
  const calls = [];
  const result = await analyzeVideoWithGemini({
    apiKey: "key", model: "video-model", mode: "content-summary", youtubeUrl: "https://www.youtube.com/watch?v=abc"
  }, {
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      return new Response(JSON.stringify({
        modelVersion: "video-model-001",
        candidates: [{ content: { parts: [{ text: "00:01 开场" }] } }],
        usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 4, totalTokenCount: 14 }
      }), { status: 200, headers: { "content-type": "application/json" } });
    }
  });
  assert.equal(calls.length, 1);
  assert.match(calls[0].options.body, /youtube\.com/);
  assert.equal(result.sourceKind, "public-youtube-url");
  assert.equal(result.model, "video-model-001");
  assert.equal(result.usage.totalTokens, 14);
});

test("Gemini visual reconstruction uses the same editable structured contract as other video routes", async () => {
  let body;
  const result = await analyzeVideoWithGemini({
    apiKey: "key",
    model: "video-model",
    mode: "visual-reconstruction",
    includeTags: false,
    instruction: "RETURN_EDITABLE_RECONSTRUCTION",
    youtubeUrl: "https://www.youtube.com/watch?v=abc"
  }, {
    fetchImpl: async (_url, options) => {
      body = JSON.parse(options.body);
      return new Response(JSON.stringify({
        modelVersion: "video-model-001",
        candidates: [{
          finishReason: "STOP",
          content: { parts: [{ text: JSON.stringify({
            reconstructionPrompt: "一支可编辑的视频生成提示词。",
            tags: [],
            uncertainties: ["镜头运动方向无法确认"]
          }) }] }
        }]
      }), { status: 200, headers: { "content-type": "application/json" } });
    }
  });

  assert.equal(body.generationConfig.responseMimeType, "application/json");
  assert.match(body.contents[0].parts[1].text, /RETURN_EDITABLE_RECONSTRUCTION/);
  assert.match(body.contents[0].parts[1].text, /reconstructionPrompt、tags、uncertainties/);
  assert.equal(result.contractVersion, VIDEO_RECONSTRUCTION_CONTRACT_VERSION);
  assert.equal(result.reconstructionPrompt, "一支可编辑的视频生成提示词。");
  assert.deepEqual(result.tags, []);
});

test("non-YouTube social links are not disguised as full video analysis", async () => {
  await assert.rejects(analyzeVideoWithGemini({ apiKey: "key", model: "model", mode: "creative-breakdown", youtubeUrl: "https://x.com/user/status/1" }), /附加本地视频/);
});

for (const stopAt of ["upload-start", "upload-body", "processing"]) {
  test(`native Gemini cancellation during ${stopAt} never continues to video inference`, async () => {
    const controller = new AbortController();
    let requests = 0;
    await assert.rejects(analyzeVideoWithGemini({
      apiKey: "test-only", model: "video-model", videoBlob: new Blob(["video"], { type: "video/mp4" }),
      signal: controller.signal,
      onStage: (phase) => { if (stopAt === "processing" && phase === "processing") controller.abort(); }
    }, {
      sleep: async () => undefined,
      fetchImpl: async (url, options) => {
        assert.equal(options.signal, controller.signal);
        assert.doesNotMatch(url, /generateContent/);
        requests += 1;
        if (requests === 1) {
          if (stopAt === "upload-start") controller.abort();
          return new Response("{}", { headers: { "x-goog-upload-url": "https://generativelanguage.googleapis.com/upload/test" } });
        }
        if (stopAt === "upload-body") controller.abort();
        return new Response(JSON.stringify({ file: { name: "files/test", uri: "https://generativelanguage.googleapis.com/files/test", state: "PROCESSING" } }));
      }
    }), { name: "AbortError" });
    assert.equal(requests, stopAt === "upload-start" ? 1 : 2);
  });
}

test("OpenRouter sends local video as video_url without changing the selected model", async () => {
  const calls = [];
  const result = await analyzeVideoWithOpenRouter({
    apiKey: "router-key",
    endpoint: "https://openrouter.ai/api/v1",
    model: "declared/video-model",
    mode: "content-summary",
    videoBlob: new Blob([new Uint8Array([1, 2, 3])], { type: "video/mp4" })
  }, {
    fetchImpl: async (url, options) => {
      calls.push({ url, body: JSON.parse(options.body) });
      return new Response(JSON.stringify({
        model: "declared/video-model",
        provider: "declared-provider",
        choices: [{ message: { content: "00:01 开场" } }],
        usage: { prompt_tokens: 12, completion_tokens: 3, total_tokens: 15, cost: 0.012 }
      }), { status: 200, headers: { "content-type": "application/json" } });
    }
  });
  assert.equal(calls[0].url, "https://openrouter.ai/api/v1/chat/completions");
  assert.equal(calls[0].body.model, "declared/video-model");
  assert.match(calls[0].body.messages[0].content[1].video_url.url, /^data:video\/mp4;base64,/);
  assert.equal(result.usage.totalTokens, 15);
  assert.equal(result.cost, 0.012);
  assert.deepEqual(result.routing, { provider: "declared-provider" });
});

test("local video-compatible services may use an HTTP loopback endpoint", async () => {
  const calls = [];
  await analyzeVideoWithChatCompletions({
    apiKey: "local-test-key",
    endpoint: "http://127.0.0.1:4177/v1/chat/completions",
    providerLabel: "本机服务",
    model: "local-video-model",
    videoBlob: new Blob([Uint8Array.from([1, 2, 3])], { type: "video/mp4" }),
    videoMimeType: "video/mp4",
    mode: "content-summary",
    instruction: "概括可见内容",
    catalog: { facets: [] }
  }, {
    fetchImpl: async (url, init) => {
      calls.push({ url, body: JSON.parse(init.body) });
      return new Response(JSON.stringify({
        choices: [{ message: { content: "可见主体向前移动。" }, finish_reason: "stop" }]
      }), { status: 200, headers: { "content-type": "application/json" } });
    }
  });
  assert.equal(calls[0].url, "http://127.0.0.1:4177/v1/chat/completions");
});

test("Kimi uses its configured Chat Completions endpoint and exposes provider-specific results", async () => {
  const calls = [];
  const result = await analyzeVideoWithChatCompletions({
    apiKey: "kimi-key",
    endpoint: "https://api.moonshot.cn/v1/chat/completions",
    providerLabel: "Kimi",
    model: "moonshot-account-video",
    mode: "ad-review",
    videoBlob: new Blob([new Uint8Array([4, 5, 6])], { type: "video/mp4" })
  }, {
    fetchImpl: async (url, options) => {
      calls.push({ url, headers: options.headers, body: JSON.parse(options.body) });
      return new Response(JSON.stringify({
        model: "moonshot-account-video-202608",
        choices: [{ message: { content: [{ type: "text", text: "00:03 钩子" }] } }],
        usage: { prompt_tokens: 9, completion_tokens: 5, total_tokens: 14 }
      }), { status: 200, headers: { "content-type": "application/json" } });
    }
  });

  assert.equal(calls[0].url, "https://api.moonshot.cn/v1/chat/completions");
  assert.equal(calls[0].body.model, "moonshot-account-video");
  assert.equal(calls[0].body.messages[0].content[1].type, "video_url");
  assert.match(calls[0].body.messages[0].content[1].video_url.url, /^data:video\/mp4;base64,/);
  assert.equal(result.provider, "Kimi");
  assert.equal(result.model, "moonshot-account-video-202608");
  assert.equal(result.usage.totalTokens, 14);
});

test("GLM-4.6V prefers its documented public URL and rejects undocumented local-only input", async () => {
  let body;
  const result = await analyzeVideoWithChatCompletions({
    apiKey: "zhipu-key",
    endpoint: "https://open.bigmodel.cn/api/paas/v4/chat/completions",
    providerLabel: "智谱 GLM",
    model: "glm-4.6v",
    mode: "content-summary",
    preferPublicVideoUrl: true,
    localVideo: "unsupported",
    publicVideoUrl: "direct",
    videoBlob: new Blob([new Uint8Array([1, 2, 3])], { type: "video/mp4" }),
    youtubeUrl: "https://assets.example/video.mp4"
  }, {
    fetchImpl: async (_url, options) => {
      body = JSON.parse(options.body);
      return new Response(JSON.stringify({
        choices: [{ message: { content: "00:01 开场" } }]
      }), { status: 200, headers: { "content-type": "application/json" } });
    }
  });

  assert.equal(body.messages[0].content[1].video_url.url, "https://assets.example/video.mp4");
  assert.equal(result.sourceKind, "public-video-url");
  await assert.rejects(() => analyzeVideoWithChatCompletions({
    apiKey: "zhipu-key",
    endpoint: "https://open.bigmodel.cn/api/paas/v4/chat/completions",
    providerLabel: "智谱 GLM",
    model: "glm-4.6v",
    mode: "content-summary",
    preferPublicVideoUrl: true,
    localVideo: "unsupported",
    publicVideoUrl: "direct",
    videoBlob: new Blob([new Uint8Array([1, 2, 3])], { type: "video/mp4" })
  }), /只确认了公网 HTTPS 视频文件直链/);
});

test("documented direct-video routes reject social playback pages before a paid request", async () => {
  let fetchCalls = 0;
  await assert.rejects(() => analyzeVideoWithChatCompletions({
    apiKey: "zhipu-key",
    endpoint: "https://open.bigmodel.cn/api/paas/v4/chat/completions",
    providerLabel: "智谱 GLM",
    model: "glm-5.3-flash",
    mode: "content-summary",
    videoUrl: "https://www.youtube.com/watch?v=abc",
    referenceProvider: "youtube",
    referencePlaybackMode: "embed",
    preferPublicVideoUrl: true,
    publicVideoUrl: "direct"
  }, { fetchImpl: async () => { fetchCalls += 1; } }), /只确认了公网视频文件直链/);
  assert.equal(fetchCalls, 0);
});

test("video source preflight exposes unsupported local input before confirmation", () => {
  assert.throws(() => chatCompletionsVideoSourcePlan({
    providerLabel: "智谱 GLM",
    hasLocalVideo: true,
    localVideo: "unsupported",
    publicVideoUrl: "direct"
  }), /不能直接发送本地视频/);
});

test("GLM-5.3-Flash sends an eligible local video as raw Base64", async () => {
  let body;
  const result = await analyzeVideoWithChatCompletions({
    apiKey: "zhipu-key",
    endpoint: "https://open.bigmodel.cn/api/paas/v4/chat/completions",
    providerLabel: "智谱 GLM",
    model: "glm-5.3-flash",
    mode: "content-summary",
    localVideo: "base64",
    videoBlob: new Blob([new Uint8Array([1, 2, 3])], { type: "video/mp4" })
  }, { fetchImpl: async (_url, options) => {
    body = JSON.parse(options.body);
    return new Response(JSON.stringify({ choices: [{ message: { content: "00:01 开场" } }] }), {
      status: 200, headers: { "content-type": "application/json" }
    });
  } });
  assert.equal(body.messages[0].content[1].video_url.url, "AQID");
  assert.equal(result.sourceKind, "local-video");
});

test("GLM video reconstruction performs one evidence-grounded call with the active Attempt request id", async () => {
  const calls = [];
  const result = await analyzeVideoWithChatCompletions({
    apiKey: "zhipu-key",
    endpoint: "https://open.bigmodel.cn/api/paas/v4/chat/completions",
    providerLabel: "智谱 GLM",
    model: "glm-5.3-flash",
    mode: "visual-reconstruction",
    includeTags: true,
    requestId: "attempt:visual-one",
    maxOutputTokens: 4096,
    durationMs: 20_000,
    width: 1280,
    height: 720,
    originalPrompt: "ORIGINAL_PROMPT_MUST_NOT_BE_SENT",
    localVideo: "base64",
    videoBlob: new Blob([new Uint8Array([1, 2, 3])], { type: "video/mp4" })
  }, { fetchImpl: async (url, options) => {
    calls.push({ url, options, body: JSON.parse(options.body) });
    return new Response(JSON.stringify({
      request_id: "provider-request-one",
      model: "glm-5.3-flash",
      choices: [{
        finish_reason: "stop",
        message: { content: JSON.stringify({
          reconstructionPrompt: "一支只描述可见画面的逐镜头生成提示词。",
          tags: [
            { g: "style.render", t: "电影写实" },
            { g: "camera.shot", t: "近景" },
            { g: "light.palette", t: "冷暖对比" },
            { g: "action.change", t: "渐变显现" }
          ],
          uncertainties: ["相对运动来源无法仅凭画面确认"]
        }) }
      }],
      usage: { prompt_tokens: 100, completion_tokens: 50, total_tokens: 150 }
    }), { status: 200, headers: { "content-type": "application/json" } });
  } });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].body.request_id, "attempt:visual-one");
  assert.equal(calls[0].body.max_tokens, 4096);
  assert.deepEqual(calls[0].body.response_format, { type: "json_object" });
  assert.equal(calls[0].body.messages[0].content[1].video_url.url, "AQID");
  assert.doesNotMatch(calls[0].options.body, /ORIGINAL_PROMPT_MUST_NOT_BE_SENT/);
  assert.equal(result.contractVersion, VIDEO_RECONSTRUCTION_CONTRACT_VERSION);
  assert.equal(result.analysisScope, "video");
  assert.equal(result.requestId, "attempt:visual-one");
  assert.equal(result.finishReason, "stop");
  assert.equal(result.reconstructionPrompt, "一支只描述可见画面的逐镜头生成提示词。");
  assert.equal(result.tags.length, 4);
  assert.deepEqual(result.uncertainties, ["相对运动来源无法仅凭画面确认"]);
});

test("visual reconstruction without AI tags still uses one call and requires an empty tags field", async () => {
  let calls = 0;
  const result = await analyzeVideoWithChatCompletions({
    apiKey: "zhipu-key",
    endpoint: "https://open.bigmodel.cn/api/paas/v4/chat/completions",
    providerLabel: "智谱 GLM",
    model: "glm-5.3-flash",
    mode: "visual-reconstruction",
    includeTags: false,
    requestId: "attempt:no-tags",
    localVideo: "base64",
    videoBlob: new Blob([new Uint8Array([7, 8, 9])], { type: "video/mp4" })
  }, { fetchImpl: async () => {
    calls += 1;
    return new Response(JSON.stringify({
      choices: [{ finish_reason: "stop", message: { content: JSON.stringify({
        reconstructionPrompt: "完整视觉重建提示词",
        tags: [],
        uncertainties: []
      }) } }]
    }), { status: 200, headers: { "content-type": "application/json" } });
  } });
  assert.equal(calls, 1);
  assert.deepEqual(result.tags, []);
  assert.equal(result.includeTags, false);
});

test("truncated or malformed visual reconstruction responses fail instead of returning partial records", async () => {
  const input = {
    apiKey: "zhipu-key",
    endpoint: "https://open.bigmodel.cn/api/paas/v4/chat/completions",
    providerLabel: "智谱 GLM",
    model: "glm-5.3-flash",
    mode: "visual-reconstruction",
    includeTags: false,
    requestId: "attempt:invalid",
    localVideo: "base64",
    videoBlob: new Blob([new Uint8Array([1])], { type: "video/mp4" })
  };
  await assert.rejects(analyzeVideoWithChatCompletions(input, {
    fetchImpl: async () => new Response(JSON.stringify({
      choices: [{ finish_reason: "length", message: { content: "{\"reconstructionPrompt\":\"截断" } }]
    }), { status: 200, headers: { "content-type": "application/json" } })
  }), /截断/);
  await assert.rejects(analyzeVideoWithChatCompletions(input, {
    fetchImpl: async () => new Response(JSON.stringify({
      choices: [{ finish_reason: "stop", message: { content: JSON.stringify({ reconstructionPrompt: "缺字段" }) } }]
    }), { status: 200, headers: { "content-type": "application/json" } })
  }), /字段不完整/);
});

test("an aborted visual reconstruction does not reach the paid request", async () => {
  const controller = new AbortController();
  controller.abort();
  let calls = 0;
  await assert.rejects(analyzeVideoWithChatCompletions({
    apiKey: "zhipu-key",
    endpoint: "https://open.bigmodel.cn/api/paas/v4/chat/completions",
    providerLabel: "智谱 GLM",
    model: "glm-5.3-flash",
    mode: "visual-reconstruction",
    requestId: "attempt:aborted",
    signal: controller.signal,
    localVideo: "base64",
    videoBlob: new Blob([new Uint8Array([1])], { type: "video/mp4" })
  }, { fetchImpl: async () => { calls += 1; } }), /abort/i);
  assert.equal(calls, 0);
});

test("GLM local video preflight does not invent an unpublished 8 MB API limit", () => {
  assert.deepEqual(chatCompletionsVideoSourcePlan({
    providerLabel: "智谱 GLM",
    hasLocalVideo: true,
    videoByteSize: 9 * 1024 * 1024,
    videoMimeType: "video/mp4",
    localVideo: "base64",
    publicVideoUrl: "direct"
  }), { videoUrl: "", sourceKind: "local-video" });
});

test("local formats the Chat Completions adapter cannot encode are blocked before a paid request", () => {
  assert.throws(() => chatCompletionsVideoSourcePlan({
    providerLabel: "智谱 GLM",
    hasLocalVideo: true,
    videoMimeType: "video/unknown",
    localVideo: "base64"
  }), /不能编码发送/);
});

test("generic Chat Completions video errors name the selected provider without exposing its key", async () => {
  await assert.rejects(analyzeVideoWithChatCompletions({
    apiKey: "never-print-this-key",
    endpoint: "https://compatible.example/v1",
    providerLabel: "兼容视频服务",
    model: "account-video",
    mode: "content-summary",
    youtubeUrl: "https://video.example/watch/1"
  }, {
    fetchImpl: async () => new Response(JSON.stringify({
      error: { message: "quota unavailable for never-print-this-key" }
    }), {
      status: 429,
      headers: { "content-type": "application/json" }
    })
  }), (error) => {
    assert.match(error.message, /兼容视频服务.*HTTP 429/);
    assert.doesNotMatch(JSON.stringify(error), /quota unavailable/);
    assert.doesNotMatch(error.message, /never-print-this-key/);
    assert.equal(error.status, 429);
    return true;
  });
});
