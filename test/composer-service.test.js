import test from "node:test";
import assert from "node:assert/strict";

import {
  composerImageEditCapabilities,
  composerImageAvailability,
  composerServiceCapabilities,
  composerServiceCatalog,
  composerVideoAvailability,
  executeComposerTurnWithService,
  normalizeImageGenerationRequest,
  normalizeVideoGenerationRequest,
  planComposerTurnWithService
} from "../composer-service.js";
import { createComposerSession, normalizeComposerSettings } from "../composer.js";

const settings = normalizeComposerSettings();

function response(payload, contentType = "application/json") {
  return {
    ok: true,
    status: 200,
    headers: { get: () => contentType },
    json: async () => payload
  };
}

function mediaResponse(kind) {
  const bytes = kind === "image"
    ? Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 0])
    : Uint8Array.from([0, 0, 0, 24, 102, 116, 121, 112, 105, 115, 111, 109]);
  return new Response(bytes, {
    headers: { "content-type": kind === "image" ? "application/octet-stream" : "video/mp4" }
  });
}

function visualSettings(overrides = {}) {
  return {
    ai: {},
    vision: {
      consent: true,
      openai: {
        apiKey: "openai-secret",
        model: "gpt-5-mini",
        videoGeneration: {
          model: "account-video-model",
          sizes: ["1280x720", "720x1280"],
          durations: ["4", "8"]
        }
      },
      compatible: {
        protocol: "responses",
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
      },
      providerProfiles: {
        openai: {
          discoveredModels: [{
            id: "gpt-5-mini",
            tasks: ["imageGeneration"],
            referenceImages: { supported: true, maxItems: 4, source: "declared", observedAt: "2026-08-09T00:00:00.000Z" }
          }]
        },
        "custom-media": {
          discoveredModels: [{
            id: "gpt-image-2",
            tasks: ["imageGeneration"],
            referenceImages: { supported: true, maxItems: 6, source: "observed_error", observedAt: "2026-08-09T00:00:00.000Z" }
          }]
        }
      },
      ...overrides
    }
  };
}

function geminiImageSettings(modelOverrides = {}) {
  return visualSettings({
    providerProfiles: {
      gemini: {
        id: "gemini",
        label: "Google Gemini",
        endpoint: "https://generativelanguage.googleapis.com",
        protocol: "gemini",
        apiKey: "gemini-secret-key",
        consent: true,
        capabilities: ["creativePlanning", "imageAnalysis", "imageGeneration"],
        models: {
          creativePlanning: "gemini-planning-model",
          imageGeneration: "account-nano-banana-model"
        },
        discoveredModels: [{
          id: "account-nano-banana-model",
          tasks: ["imageGeneration"],
          inputModalities: ["text", "image"],
          outputModalities: ["image"],
          supportedParameters: ["response_format", "aspect_ratio", "image_size"],
          supportedAspectRatios: ["1:1", "16:9"],
          supportedResolutions: ["1K", "2K"],
          referenceImages: { supported: true, maxItems: 3, source: "declared" },
          ...modelOverrides
        }]
      }
    }
  });
}

test("Micu planning uses lightweight JSON mode and sends high reasoning only when enabled", async () => {
  const requests = [];
  const fetchImpl = async (_url, options) => {
    requests.push(JSON.parse(options.body));
    return response({ output_text: JSON.stringify({ route: "compose", status: "ready" }) });
  };
  const base = referenceSession("compatible");
  const thinking = createComposerSession({ ...base, aiProfile: { ...base.aiProfile, thinking: true } });
  const plain = createComposerSession({ ...base, aiProfile: { ...base.aiProfile, thinking: false } });

  const planned = await planComposerTurnWithService({ session: thinking, userMessage: "", composerSettings: settings }, visualSettings(), { fetchImpl });
  await planComposerTurnWithService({ session: plain, userMessage: "", composerSettings: settings }, visualSettings(), { fetchImpl });

  assert.deepEqual(requests[0].text, { format: { type: "json_object" } });
  assert.match(
    requests[0].input.flatMap((message) => message.content).map((item) => item.text ?? "").join("\n"),
    /json/i
  );
  assert.equal(JSON.stringify(requests[0]).includes("json_schema"), false);
  assert.deepEqual(requests[0].reasoning, { effort: "high" });
  assert.equal(Object.hasOwn(requests[1], "reasoning"), false);
  assert.equal(planned.degraded, true);
  assert.match(planned.notice, /原始要求继续/);
});

test("OpenAI Responses uses the same reasoning switch while unknown compatible services do not guess support", async () => {
  const requests = [];
  const openai = referenceSession("openai");
  openai.aiProfile.thinking = true;
  await planComposerTurnWithService({ session: openai, userMessage: "", composerSettings: settings }, visualSettings(), {
    fetchImpl: async (_url, options) => {
      requests.push(JSON.parse(options.body));
      return response({ output_text: JSON.stringify({ route: "compose", status: "ready", instruction: "继续" }) });
    }
  });
  const other = referenceSession("compatible");
  other.aiProfile.thinking = true;
  await planComposerTurnWithService({ session: other, userMessage: "", composerSettings: settings }, visualSettings({
    compatible: {
      protocol: "responses", endpoint: "https://vision.example.com/v1/responses", apiKey: "secret", model: "vision-pro"
    }
  }), {
    fetchImpl: async (_url, options) => {
      requests.push(JSON.parse(options.body));
      return response({ output_text: JSON.stringify({ route: "compose", status: "ready", instruction: "继续" }) });
    }
  });
  assert.deepEqual(requests[0].reasoning, { effort: "high" });
  assert.equal(Object.hasOwn(requests[1], "reasoning"), false);
});

test("Kimi creative planning uses the assigned model without falling back to another provider", async () => {
  const requests = [];
  const kimiSettings = visualSettings({
    providerProfiles: {
      kimi: {
        id: "kimi",
        label: "Kimi",
        endpoint: "https://api.moonshot.cn/v1/chat/completions",
        protocol: "chat_completions",
        apiKey: "kimi-secret",
        consent: true,
        capabilities: ["creativePlanning", "imageAnalysis", "videoAnalysis"],
        models: { creativePlanning: "account-planning-model" },
        discoveredModels: [{
          id: "account-planning-model",
          tasks: ["creativePlanning", "imageAnalysis", "videoAnalysis"]
        }]
      }
    }
  });
  const session = createComposerSession({
    aiProfile: { serviceId: "kimi", model: "account-planning-model" },
    messages: [{ role: "user", type: "request", content: "整理创意方向" }]
  });

  const planned = await planComposerTurnWithService({
    session, userMessage: "", composerSettings: settings
  }, kimiSettings, {
    fetchImpl: async (url, options) => {
      requests.push({ url, headers: options.headers, body: JSON.parse(options.body) });
      return response({
        model: "account-planning-model",
        choices: [{ message: { content: JSON.stringify({ route: "compose", status: "ready", instruction: "保留核心冲突" }) } }]
      });
    }
  });

  assert.equal(requests.length, 1);
  assert.equal(requests[0].url, "https://api.moonshot.cn/v1/chat/completions");
  assert.equal(requests[0].headers.Authorization, "Bearer kimi-secret");
  assert.equal(requests[0].body.model, "account-planning-model");
  assert.equal(planned.instruction, "保留核心冲突");
});

test("a per-session DeepSeek switch uses that connected model instead of the global planning route", async () => {
  const requests = [];
  const settingsValue = visualSettings({
    providerProfiles: {
      deepseek: {
        id: "deepseek",
        label: "DeepSeek",
        endpoint: "https://api.deepseek.com/chat/completions",
        protocol: "chat_completions",
        structuredOutput: "json_object",
        apiKey: "deepseek-session-key",
        credentialConfigured: true,
        consent: true,
        capabilities: ["creativePlanning"],
        discoveredModels: [{
          id: "deepseek-account-beta",
          confidence: "manual_unverified",
          status: "available",
          tasks: []
        }],
        discovery: { discoveredAt: "2026-08-30T10:00:00.000Z" }
      }
    }
  });
  settingsValue.ai = {
    activeProvider: "compatible",
    consent: true,
    analysisModel: "glm-5.3-flash",
    compatible: {
      endpoint: "https://open.bigmodel.cn/api/paas/v4/chat/completions",
      apiKey: "zhipu-global-key",
      model: "glm-5.3-flash"
    }
  };
  const session = createComposerSession({
    aiProfile: { serviceId: "deepseek", model: "deepseek-account-beta" },
    messages: [{ role: "user", type: "request", content: "整理这个创意" }]
  });

  await planComposerTurnWithService({ session, userMessage: "", composerSettings: settings }, settingsValue, {
    fetchImpl: async (url, options) => {
      requests.push({ url, body: JSON.parse(options.body) });
      return response({
        model: "deepseek-account-beta",
        choices: [{ message: { content: JSON.stringify({ route: "compose", status: "ready" }) } }]
      });
    }
  });

  assert.equal(requests.length, 1);
  assert.equal(requests[0].url, "https://api.deepseek.com/chat/completions");
  assert.equal(requests[0].body.model, "deepseek-account-beta");
  assert.equal(JSON.stringify(requests[0]).includes("glm-5.3-flash"), false);
});

test("Zhipu creative planning is selectable from the registry and calls only its assigned GLM model", async () => {
  const requests = [];
  const zhipuSettings = visualSettings({
    providerProfiles: {
      zhipu: {
        id: "zhipu",
        label: "智谱 GLM",
        endpoint: "https://open.bigmodel.cn/api/paas/v4/chat/completions",
        protocol: "chat_completions",
        structuredOutput: "prompt_only",
        mediaInput: { imageBase64: "raw", localVideo: "unsupported", preferPublicVideoUrl: true, publicVideoUrl: "direct" },
        apiKey: "zhipu-secret",
        consent: true,
        capabilities: ["textTags", "skillExtraction", "creativePlanning", "imageAnalysis", "videoAnalysis"],
        models: { creativePlanning: "glm-4.6v" },
        discoveredModels: [{
          id: "glm-4.6v",
          tasks: ["textTags", "skillExtraction", "creativePlanning", "imageAnalysis", "videoAnalysis"]
        }]
      }
    }
  });
  const catalog = composerServiceCatalog({}, zhipuSettings.vision);
  assert.equal(catalog.find((item) => item.serviceId === "zhipu" && item.model === "glm-4.6v")?.planning, true);
  assert.equal(catalog.find((item) => item.serviceId === "zhipu" && item.model === "glm-4.6v")?.reasoning, false);
  const session = createComposerSession({
    aiProfile: { serviceId: "zhipu", model: "glm-4.6v" },
    messages: [{ role: "user", type: "request", content: "整理为广告创作方向" }]
  });

  const planned = await planComposerTurnWithService({
    session, userMessage: "", composerSettings: settings
  }, zhipuSettings, {
    fetchImpl: async (url, options) => {
      requests.push({ url, headers: options.headers, body: JSON.parse(options.body) });
      return response({
        model: "glm-4.6v",
        choices: [{ message: { content: JSON.stringify({ route: "compose", status: "ready", instruction: "强化前三秒冲突" }) } }]
      });
    }
  });

  assert.equal(requests.length, 1);
  assert.equal(requests[0].url, "https://open.bigmodel.cn/api/paas/v4/chat/completions");
  assert.equal(requests[0].headers.Authorization, "Bearer zhipu-secret");
  assert.equal(requests[0].body.model, "glm-4.6v");
  assert.equal(Object.hasOwn(requests[0].body, "response_format"), false);
  assert.equal(planned.instruction, "强化前三秒冲突");

  const imageSession = referenceSession("compatible");
  imageSession.aiProfile = { serviceId: "zhipu", model: "glm-4.6v", thinking: true };
  let imageRequest;
  await executeComposerTurnWithService({
    session: imageSession,
    userMessage: "",
    composerSettings: settings,
    route: "compose",
    instruction: "保持参考图构图"
  }, zhipuSettings, preparedImages, {
    stream: false,
    fetchImpl: async (_url, options) => {
      imageRequest = JSON.parse(options.body);
      return response({ model: "glm-4.6v", choices: [{ message: { content: "保持三人关系与长焦层次" }, finish_reason: "stop" }] });
    }
  });
  const imageParts = imageRequest.messages[1].content.filter((item) => item.type === "image_url");
  assert.equal(imageParts.length, 3);
  assert.deepEqual(imageParts[0], { type: "image_url", image_url: { url: "AAAA" } });
  assert.equal(Object.hasOwn(imageRequest, "thinking"), false);
  assert.equal(Object.hasOwn(imageRequest, "reasoning"), false);

  const flashSettings = visualSettings({
    providerProfiles: {
      zhipu: {
        ...zhipuSettings.vision.providerProfiles.zhipu,
        models: { creativePlanning: "glm-5.3-flash" },
        discoveredModels: [{
          id: "glm-5.3-flash",
          tasks: ["textTags", "skillExtraction", "creativePlanning", "imageAnalysis", "videoAnalysis"]
        }]
      }
    }
  });
  const flashSession = referenceSession("compatible");
  flashSession.aiProfile = { serviceId: "zhipu", model: "glm-5.3-flash" };
  let flashRequest;
  await executeComposerTurnWithService({
    session: flashSession,
    userMessage: "",
    composerSettings: settings,
    route: "compose",
    instruction: "分析参考图后给出构图方案"
  }, flashSettings, preparedImages, {
    stream: false,
    fetchImpl: async (_url, options) => {
      flashRequest = JSON.parse(options.body);
      return response({ model: "glm-5.3-flash", choices: [{ message: { content: "突出主体轮廓" }, finish_reason: "stop" }] });
    }
  });
  const flashImage = flashRequest.messages[1].content.find((item) => item.type === "image_url");
  assert.deepEqual(flashImage, {
    type: "image_url",
    image_url: { url: "data:image/png;base64,AAAA", detail: "high" }
  });
});

test("video generation keeps Zhipu planning separate from the assigned generation provider", async () => {
  const settingsValue = visualSettings({
    providerProfiles: {
      zhipu: {
        id: "zhipu", label: "智谱 GLM",
        endpoint: "https://open.bigmodel.cn/api/paas/v4/chat/completions",
        protocol: "chat_completions", apiKey: "zhipu-secret", consent: true,
        capabilities: ["creativePlanning"],
        models: { creativePlanning: "glm-4.6v" },
        discoveredModels: [{ id: "glm-4.6v", tasks: ["creativePlanning"] }]
      },
      minimax: {
        id: "minimax", label: "MiniMax",
        endpoint: "https://api.minimaxi.com/v1",
        protocol: "minimax_videos", apiKey: "minimax-secret", consent: true,
        capabilities: ["videoGeneration"],
        models: { videoGeneration: "hailuo-account-model" },
        discoveredModels: [{
          id: "hailuo-account-model", tasks: ["videoGeneration"],
          inputModalities: ["text"], outputModalities: ["video"],
          supportedResolutions: ["1080P"]
        }]
      }
    }
  });
  const session = createComposerSession({
    targetType: "video",
    outputMode: "create_video",
    aiProfile: { serviceId: "zhipu", model: "glm-4.6v" },
    generationAiProfile: { serviceId: "minimax", model: "hailuo-account-model" },
    generationParameters: { size: "1080P" },
    messages: [{ role: "user", type: "request", content: "生成品牌片头" }]
  });
  const calls = [];
  const result = await executeComposerTurnWithService({
    session, userMessage: "", composerSettings: settings, route: "compose", instruction: "标志从黑场聚合"
  }, settingsValue, [], {
    stream: false,
    pollIntervalMs: 0,
    fetchImpl: async (url, options = {}) => {
      calls.push({ url, body: options.body });
      if (url === "https://open.bigmodel.cn/api/paas/v4/chat/completions") {
        return response({ model: "glm-4.6v", choices: [{ message: { content: "黑场中标志快速聚合，镜头推进。" } }] });
      }
      if (url.endsWith("/video_generation") && options.method === "POST") return response({ task_id: "minimax-task" });
      if (url.includes("/query/video_generation")) return response({ status: "Success", file_id: "minimax-file" });
      if (url.includes("/files/retrieve")) return response({ file: { download_url: "https://cdn.example/result.mp4" } });
      if (url === "https://cdn.example/result.mp4") return mediaResponse("video");
      throw new Error(`unexpected ${url}`);
    }
  });

  assert.equal(calls[0].url, "https://open.bigmodel.cn/api/paas/v4/chat/completions");
  assert.match(String(calls.find((call) => call.url.endsWith("/video_generation"))?.body), /黑场中标志快速聚合/);
  assert.equal(result.serviceId, "minimax");
  assert.equal(result.requestModel, "hailuo-account-model");
});

test("an assigned provider without creative-planning capability fails instead of using DeepSeek", async () => {
  const providerSettings = visualSettings({
    providerProfiles: {
      kimi: {
        id: "kimi",
        label: "Kimi",
        endpoint: "https://api.moonshot.cn/v1/chat/completions",
        protocol: "chat_completions",
        apiKey: "kimi-secret",
        consent: true,
        capabilities: ["videoAnalysis"],
        models: {},
        discoveredModels: [{ id: "video-only-model", tasks: ["videoAnalysis"] }]
      }
    }
  });
  const session = createComposerSession({ aiProfile: { serviceId: "kimi", model: "video-only-model" } });

  await assert.rejects(() => planComposerTurnWithService({
    session, userMessage: "", composerSettings: settings
  }, providerSettings, {
    fetchImpl: async () => { throw new Error("不应发起请求"); }
  }), /未声明创作规划能力/);
});

test("an unassigned creative-planning route fails before any provider request", async () => {
  let calls = 0;
  const session = createComposerSession({ aiProfile: { serviceId: "unassigned", model: "" } });

  await assert.rejects(() => planComposerTurnWithService({
    session, userMessage: "", composerSettings: settings
  }, visualSettings(), {
    fetchImpl: async () => {
      calls += 1;
      throw new Error("不应发起请求");
    }
  }), /创作规划未配置/);
  assert.equal(calls, 0);
});

test("xAI is a real per-turn composer service and image generation uses its configured endpoints", async () => {
  const xaiSettings = visualSettings({
    xai: { apiKey: "xai-secret", textModel: "grok-text", imageModel: "grok-image", mediaConsent: true }
  });
  const catalog = composerServiceCatalog({}, xaiSettings.vision);
  assert.equal(catalog.find((item) => item.serviceId === "xai")?.imageGeneration, true);
  const session = createComposerSession({
    aiProfile: { serviceId: "xai", model: "grok-text" },
    targetType: "image",
    outputMode: "create_image",
    messages: [{ role: "user", type: "request", content: "生成前卫品牌海报" }]
  });
  assert.equal(composerImageAvailability(session.aiProfile, xaiSettings.vision, session).available, true);
  const requests = [];
  const result = await executeComposerTurnWithService({
    session, userMessage: "", composerSettings: settings, route: "compose", instruction: "生成前卫品牌海报"
  }, xaiSettings, [], {
    stream: false,
    fetchImpl: async (url, options) => {
      requests.push({ url, body: JSON.parse(options.body) });
      if (url.endsWith("/chat/completions")) return response({ model: "grok-text", choices: [{ message: { content: "前卫品牌海报，锐利几何构图" }, finish_reason: "stop" }] });
      return response({ model: "grok-image", data: [{ b64_json: "AAAA" }] });
    }
  });
  assert.equal(requests[0].url, "https://api.x.ai/v1/chat/completions");
  assert.equal(requests[1].url, "https://api.x.ai/v1/images/generations");
  assert.equal(requests[1].body.model, "grok-image");
  assert.equal("response_format" in requests[1].body, false);
  assert.equal(result.kind, "image");
  assert.equal(result.serviceId, "xai");
});

test("xAI video generation submits once, polls its asynchronous task, and downloads only an xAI result", async () => {
  const xaiSettings = visualSettings({
    xai: {
      apiKey: "xai-secret",
      textModel: "grok-text",
      imageModel: "grok-image",
      videoModel: "grok-video",
      mediaConsent: true
    }
  });
  const session = createComposerSession({
    aiProfile: { serviceId: "xai", model: "grok-text" },
    targetType: "video",
    outputMode: "create_video",
    messages: [{ role: "user", type: "request", content: "生成一段前卫品牌片头" }]
  });
  assert.equal(composerVideoAvailability(session.aiProfile, xaiSettings.vision, session).available, true);
  const calls = [];
  const phases = [];
  const remoteVideos = [];
  const result = await executeComposerTurnWithService({
    session, userMessage: "", composerSettings: settings, route: "compose", instruction: "生成一段前卫品牌片头"
  }, xaiSettings, [], {
    stream: false,
    pollIntervalMs: 0,
    onPhase: (phase) => phases.push(phase),
    onRemoteVideo: (remote) => remoteVideos.push(remote),
    fetchImpl: async (url, options) => {
      calls.push({ url, method: options.method, headers: options.headers, body: options.body });
      if (url.endsWith("/chat/completions")) {
        return response({ model: "grok-text", choices: [{ message: { content: "锐利黑场中青柠色 P 形标志快速聚合" }, finish_reason: "stop" }] });
      }
      if (url.endsWith("/videos/generations")) {
        assert.deepEqual(JSON.parse(options.body), {
          model: "grok-video",
          prompt: "锐利黑场中青柠色 P 形标志快速聚合"
        });
        return response({ request_id: "xai-video-one" });
      }
      if (url.endsWith("/videos/xai-video-one")) {
        const polls = calls.filter((item) => item.url.endsWith("/videos/xai-video-one")).length;
        return response(polls === 1
          ? { status: "pending", progress: 40 }
          : { status: "done", model: "grok-video", video: { url: "https://vidgen.x.ai/result.mp4" } });
      }
      assert.equal(url, "https://vidgen.x.ai/result.mp4");
      assert.equal(Object.hasOwn(options.headers, "Authorization"), false);
      return mediaResponse("video");
    }
  });
  assert.deepEqual(remoteVideos, [{
    serviceId: "xai",
    remoteId: "xai-video-one",
    finalPrompt: "锐利黑场中青柠色 P 形标志快速聚合",
    requestParameters: {}
  }]);
  assert.deepEqual(phases, ["generation", "downloading"]);
  assert.equal(result.kind, "video");
  assert.equal(result.serviceId, "xai");
  assert.equal(result.videos[0].blob.type, "video/mp4");
});

test("xAI video generation rejects a result URL outside the authorized xAI boundary", async () => {
  const xaiSettings = visualSettings({
    xai: { apiKey: "xai-secret", textModel: "grok-text", videoModel: "grok-video", mediaConsent: true }
  });
  const session = createComposerSession({
    aiProfile: { serviceId: "xai", model: "grok-text" },
    targetType: "video",
    outputMode: "create_video",
    messages: [{ role: "user", type: "request", content: "生成短片" }]
  });
  await assert.rejects(() => executeComposerTurnWithService({
    session, userMessage: "", composerSettings: settings, route: "compose", instruction: "生成短片"
  }, xaiSettings, [], {
    pollIntervalMs: 0,
    fetchImpl: async (url) => {
      if (url.endsWith("/chat/completions")) return response({ choices: [{ message: { content: "一段短片" } }] });
      if (url.endsWith("/videos/generations")) return response({ request_id: "xai-video-two" });
      return response({ status: "done", video: { url: "https://untrusted.example/result.mp4" } });
    }
  }), /不属于已授权的 xAI 域名/);
});

test("visual planning rejects non-JSON without a repair request", async () => {
  let calls = 0;
  await assert.rejects(() => planComposerTurnWithService({
    session: referenceSession("compatible"), userMessage: "", composerSettings: settings
  }, visualSettings(), {
    fetchImpl: async () => {
      calls += 1;
      return response({ output_text: "不是 JSON" });
    }
  }), /没有返回有效的 Agent 计划/);
  assert.equal(calls, 1);
});

function referenceSession(serviceId = "openai", outputMode = "text_prompt") {
  return createComposerSession({
    aiProfile: { serviceId, model: serviceId === "openai" ? "gpt-5-mini" : "gpt-5.4-mini" },
    outputMode,
    messages: [{ role: "user", type: "request", content: "参考1保持三人构图和中间女性聚焦，参考2只负责画面风格" }],
    referenceSnapshots: [
      {
        entryId: "composition",
        alias: "@参考1",
        title: "不应发送的本地标题",
        referenceKind: "prompt",
        referenceText: "三人关系",
        originalText: "电影长焦，前景两人模糊，中间女性清晰聚焦",
        imageRefs: [{ visualId: "one", mimeType: "image/png" }, { visualId: "two", mimeType: "image/png" }]
      },
      {
        entryId: "style",
        alias: "@参考2",
        referenceKind: "prompt",
        referenceText: "高定插画风格",
        originalText: "蓝灰磨砂肌理与暖色轮廓光",
        imageRefs: [{ visualId: "three", mimeType: "image/jpeg" }]
      }
    ]
  });
}

function referenceSessionWithMode(serviceId, mode) {
  const base = referenceSession(serviceId, "create_image");
  return createComposerSession({
    ...base,
    imageReferenceMode: mode,
    referenceSnapshots: base.referenceSnapshots.map((reference) => ({
      ...reference,
      assets: reference.imageRefs.map((imageRef) => ({
        assetId: imageRef.visualId,
        imageFingerprint: `${imageRef.visualId}-fingerprint`,
        analysisImageFingerprint: `${imageRef.visualId}-fingerprint`,
        analysisVersion: 2,
        analysisFingerprint: `${imageRef.visualId}-profile`,
        reconstructionPrompt: `${imageRef.visualId} 的完整文字重建说明`
      }))
    }))
  });
}

const preparedImages = [
  { visualId: "one", dataUrl: "data:image/png;base64,AAAA" },
  { visualId: "two", dataUrl: "data:image/png;base64,BBBB" },
  { visualId: "three", dataUrl: "data:image/jpeg;base64,CCCC" }
];

test("visual planning stays text-only while execution sends every selected image with stable labels", async () => {
  const requests = [];
  const fetchImpl = async (_url, options) => {
    const body = JSON.parse(options.body);
    requests.push(body);
    if (requests.length === 1) return response({
      model: "gpt-5-mini",
      output_text: JSON.stringify({ route: "compose", status: "ready", instruction: "参考1负责构图和人物关系，参考2只负责风格。" })
    });
    return response({ model: "gpt-5-mini", output_text: "三人电影长焦画面，中间女性清晰聚焦，前景两人明显虚化。" });
  };
  const session = referenceSession();
  const planned = await planComposerTurnWithService({ session, userMessage: "", composerSettings: settings }, visualSettings(), { fetchImpl });
  const result = await executeComposerTurnWithService({
    session,
    userMessage: "",
    composerSettings: settings,
    route: planned.route,
    instruction: planned.instruction
  }, visualSettings(), preparedImages, { fetchImpl, stream: false });

  assert.equal(JSON.stringify(requests[0]).includes("input_image"), false);
  const execution = requests[1].input[0].content;
  assert.equal(execution.filter((item) => item.type === "input_image").length, 3);
  const labels = execution.filter((item) => item.type === "input_text").map((item) => item.text);
  assert.equal(labels.includes("@参考1/图片1"), true);
  assert.equal(labels.includes("@参考1/图片2"), true);
  assert.equal(labels.includes("@参考2/图片1"), true);
  assert.equal(JSON.stringify(requests).includes("不应发送的本地标题"), false);
  assert.equal(JSON.stringify(requests).includes("composition"), false);
  assert.match(result.finalPrompt, /三人.*中间女性清晰聚焦/);
});

test("saved video sources stay text-only during Composer execution and never trigger a video upload", async () => {
  let request;
  const session = createComposerSession({
    targetType: "video",
    aiProfile: { serviceId: "compatible", model: "gpt-5.4-mini" },
    messages: [{ role: "user", type: "request", content: "基于所选视频方法继续创作" }],
    referenceSnapshots: [{
      entryId: "private-case",
      assetId: "private-video",
      alias: "@参考1",
      referenceKind: "video_sources",
      referenceText: "[原始提示词]\n人物推门进入\n\n[AI 视觉逆推]\n镜头缓慢前推",
      originalText: "人物推门进入",
      referenceSources: [
        { id: "original:private-video", kind: "original_prompt", label: "原始提示词", text: "人物推门进入" },
        { id: "reconstruction:private-analysis", kind: "video_reconstruction", label: "AI 视觉逆推", text: "镜头缓慢前推" }
      ]
    }]
  });
  const result = await executeComposerTurnWithService({
    session,
    userMessage: "",
    composerSettings: settings,
    route: "compose",
    instruction: "整理为新的视频提示词"
  }, visualSettings(), [], {
    stream: false,
    fetchImpl: async (_url, options) => {
      request = JSON.parse(options.body);
      return response({ output_text: "人物推门进入，镜头缓慢前推。" });
    }
  });
  const serialized = JSON.stringify(request);
  assert.match(serialized, /原始提示词/);
  assert.match(serialized, /AI 视觉逆推/);
  assert.equal(serialized.match(/人物推门进入/g)?.length, 1);
  assert.equal(serialized.includes("input_video"), false);
  assert.equal(serialized.includes("video_url"), false);
  assert.equal(serialized.includes("data:video"), false);
  assert.equal(serialized.includes("private-case"), false);
  assert.equal(serialized.includes("private-video"), false);
  assert.equal(serialized.includes("private-analysis"), false);
  assert.equal(result.finalPrompt, "人物推门进入，镜头缓慢前推。");
});

test("DeepSeek refuses a pure-image reference instead of silently composing without seeing it", async () => {
  const session = createComposerSession({
    aiProfile: { serviceId: "deepseek", model: "deepseek-v4-flash" },
    referenceSnapshots: [{ entryId: "pure-image", alias: "@参考1", imageRefs: [{ visualId: "one" }] }]
  });
  await assert.rejects(() => executeComposerTurnWithService({
    session,
    userMessage: "",
    composerSettings: settings,
    route: "compose",
    instruction: "按参考图生成"
  }, { ai: { apiKey: "deepseek-secret", consent: true }, vision: {} }, [], { fetchImpl: async () => { throw new Error("不应调用"); } }), /只有原图.*DeepSeek 无法读取/);
});

test("OpenAI create-image mode sends original images through the Responses image tool", async () => {
  let request;
  const session = referenceSessionWithMode("openai", "conditioned");
  const result = await executeComposerTurnWithService({
    session,
    userMessage: "",
    composerSettings: settings,
    route: "compose",
    instruction: "参考1负责构图，参考2只负责风格"
  }, visualSettings(), preparedImages, {
    fetchImpl: async (_url, options) => {
      request = JSON.parse(options.body);
      return response({ model: "gpt-5-mini", output: [{ type: "image_generation_call", result: "aGVsbG8=" }] });
    }
  });
  assert.deepEqual(request.tools, [{ type: "image_generation", size: "auto", quality: "auto" }]);
  assert.equal(JSON.stringify(request).includes("完整文字重建说明"), true);
  assert.deepEqual(result.requestParameters, { size: "auto", quality: "auto" });
  assert.equal(request.input[0].content.filter((item) => item.type === "input_image").length, 3);
  assert.match(request.instructions, /必须调用 image_generation/);
  assert.equal(result.kind, "image");
  assert.equal(result.images.length, 1);
  assert.equal(result.finalPrompt, "参考1负责构图，参考2只负责风格");
});

test("Gemini image capability comes only from the assigned model metadata", () => {
  const values = geminiImageSettings().vision;
  const profile = { serviceId: "gemini", model: "account-nano-banana-model" };
  const capability = composerServiceCapabilities(profile, values).image;

  assert.equal(capability.generate, true);
  assert.deepEqual(capability.references, { supported: true, maxItems: 3, source: "declared" });
  assert.deepEqual(capability.edit, { whole: true, local: false });
  assert.deepEqual(capability.parameters.map((parameter) => [parameter.key, parameter.options.map((item) => item.value)]), [
    ["aspectRatio", ["1:1", "16:9"]],
    ["imageSize", ["1K", "2K"]]
  ]);
  assert.deepEqual(composerImageEditCapabilities(profile, values), { whole: true, local: false });
});

test("Gemini text-to-image uses one official Interactions request and keeps every final image block", async () => {
  const calls = [];
  const session = createComposerSession({
    aiProfile: { serviceId: "gemini", model: "gemini-planning-model" },
    generationAiProfile: { serviceId: "gemini", model: "account-nano-banana-model" },
    outputMode: "create_image",
    messages: [{ role: "user", type: "request", content: "创作一张电影感品牌海报" }]
  });
  session.generationParameters = { aspectRatio: "16:9", imageSize: "2K", quality: "high" };

  const result = await executeComposerTurnWithService({
    session, userMessage: "", composerSettings: settings, route: "compose", instruction: "电影感品牌海报，蓝灰色调"
  }, geminiImageSettings(), [], {
    fetchImpl: async (url, options) => {
      calls.push({ url, headers: options.headers, body: JSON.parse(options.body) });
      return response({
        id: "interaction-one",
        model: "account-nano-banana-model",
        status: "completed",
        output_image: { type: "image", mime_type: "image/jpeg", data: "d29ybGQ=" },
        steps: [
          { type: "thought", summary: [{ type: "image", mime_type: "image/png", data: "dGhvdWdodA==" }] },
          { type: "model_output", content: [
            { type: "text", text: "成品说明" },
            { type: "image", mime_type: "image/png", data: "aGVsbG8=" },
            { type: "image", mime_type: "image/jpeg", data: "d29ybGQ=" },
            { type: "image", mime_type: "image/png", data: "%%%invalid%%%" }
          ] }
        ],
        usage: { total_input_tokens: 12, total_output_tokens: 34, total_tokens: 51, total_thought_tokens: 5, total_cached_tokens: 2 }
      });
    }
  });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "https://generativelanguage.googleapis.com/v1beta/interactions");
  assert.equal(calls[0].headers["x-goog-api-key"], "gemini-secret-key");
  assert.equal(Object.hasOwn(calls[0].headers, "Authorization"), false);
  assert.equal(calls[0].body.model, "account-nano-banana-model");
  assert.deepEqual(calls[0].body.input, "电影感品牌海报，蓝灰色调");
  assert.deepEqual(calls[0].body.response_format, { type: "image", aspect_ratio: "16:9", image_size: "2K" });
  assert.equal(JSON.stringify(calls[0].body).includes("quality"), false);
  assert.equal(result.images.length, 2);
  assert.deepEqual(result.images.map((item) => item.blob.type), ["image/png", "image/jpeg"]);
  assert.equal(result.requestModel, "account-nano-banana-model");
  assert.equal(result.model, "account-nano-banana-model");
  assert.equal(result.finalPrompt, "成品说明");
  assert.deepEqual(result.usage, {
    promptTokens: 12, completionTokens: 34, totalTokens: 51, cacheHitTokens: 2, cacheMissTokens: 10
  });
});

test("Gemini image_size is not inferred from resolutions when the model does not declare that request parameter", async () => {
  const values = geminiImageSettings({
    supportedParameters: ["response_format", "aspect_ratio"],
    supportedAspectRatios: ["1:1"],
    supportedResolutions: ["1K"]
  });
  const session = createComposerSession({
    aiProfile: { serviceId: "gemini", model: "gemini-planning-model" },
    generationAiProfile: { serviceId: "gemini", model: "account-nano-banana-model" },
    outputMode: "create_image",
    generationParameters: { aspectRatio: "1:1", imageSize: "1K" },
    messages: [{ role: "user", type: "request", content: "生成图片" }]
  });
  const capability = composerServiceCapabilities(session.generationAiProfile, values.vision).image;
  assert.deepEqual(capability.parameters.map((parameter) => parameter.key), ["aspectRatio"]);
  let body;
  await executeComposerTurnWithService({
    session, userMessage: "", composerSettings: settings, route: "compose", instruction: "生成图片"
  }, values, [], {
    fetchImpl: async (_url, options) => {
      body = JSON.parse(options.body);
      return response({ steps: [{ type: "model_output", content: [{ type: "image", mime_type: "image/png", data: "aGVsbG8=" }] }] });
    }
  });
  assert.deepEqual(body.response_format, { type: "image", aspect_ratio: "1:1" });
  assert.equal(Object.hasOwn(body.response_format, "image_size"), false);
});

test("Gemini conditioned generation sends raw multi-image blocks and enforces the declared limit before charging", async () => {
  const session = referenceSession("gemini", "create_image");
  session.aiProfile = { serviceId: "gemini", model: "gemini-planning-model", thinking: false };
  session.generationAiProfile = { serviceId: "gemini", model: "account-nano-banana-model", thinking: false };
  const calls = [];
  const result = await executeComposerTurnWithService({
    session, userMessage: "", composerSettings: settings, route: "compose", instruction: "严格保持三张参考图各自职责"
  }, geminiImageSettings(), preparedImages, {
    fetchImpl: async (url, options) => {
      calls.push({ url, body: JSON.parse(options.body) });
      return response({ steps: [{ type: "model_output", content: [{ type: "image", mime_type: "image/png", data: "aGVsbG8=" }] }] });
    }
  });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].body.input.filter((item) => item.type === "image").length, 3);
  assert.deepEqual(calls[0].body.input.filter((item) => item.type === "image").map((item) => [item.mime_type, item.data]), [
    ["image/png", "AAAA"], ["image/png", "BBBB"], ["image/jpeg", "CCCC"]
  ]);
  assert.equal(calls[0].body.input.some((item) => item.type === "text" && item.text === "@参考1/图片1"), true);
  assert.equal(result.images.length, 1);

  const limited = geminiImageSettings({ referenceImages: { supported: true, maxItems: 2, source: "declared" } });
  let paidCalls = 0;
  await assert.rejects(() => executeComposerTurnWithService({
    session, userMessage: "", composerSettings: settings, route: "compose", instruction: "保持三张参考"
  }, limited, preparedImages, {
    fetchImpl: async () => { paidCalls += 1; throw new Error("不应调用"); }
  }), (error) => error.kind === "reference_limit" && error.referenceLimit?.maximum === 2);
  assert.equal(paidCalls, 0);
});

test("Gemini local mask edits and failed image responses never trigger a paid retry", async () => {
  const session = createComposerSession({
    aiProfile: { serviceId: "gemini", model: "gemini-planning-model" },
    generationAiProfile: { serviceId: "gemini", model: "account-nano-banana-model" },
    outputMode: "create_image",
    messages: [{ role: "user", type: "request", content: "修改图片" }]
  });
  const localEdit = {
    mode: "local",
    modification: "只修改衣服",
    baseImage: { visualId: "base", dataUrl: "data:image/png;base64,AAAA" },
    mask: { dataUrl: "data:image/png;base64,BBBB" }
  };
  let calls = 0;
  await assert.rejects(() => executeComposerTurnWithService({
    session, userMessage: "", composerSettings: settings, route: "compose", instruction: "只修改衣服", imageEdit: localEdit
  }, geminiImageSettings(), [], {
    fetchImpl: async () => { calls += 1; throw new Error("不应调用"); }
  }), /Gemini.*局部遮罩编辑/);
  assert.equal(calls, 0);

  const unassigned = createComposerSession({
    aiProfile: { serviceId: "gemini", model: "gemini-planning-model" },
    generationAiProfile: { serviceId: "gemini", model: "" },
    outputMode: "create_image",
    messages: [{ role: "user", type: "request", content: "生成图片" }]
  });
  await assert.rejects(() => executeComposerTurnWithService({
    session: unassigned, userMessage: "", composerSettings: settings, route: "compose", instruction: "生成图片"
  }, geminiImageSettings(), [], {
    fetchImpl: async () => { calls += 1; throw new Error("不应调用"); }
  }), /API Key 和所选模型配置/);
  assert.equal(calls, 0);

  const httpError = await executeComposerTurnWithService({
    session, userMessage: "", composerSettings: settings, route: "compose", instruction: "生成图片"
  }, geminiImageSettings(), [], {
    fetchImpl: async () => {
      calls += 1;
      return { ok: false, status: 403, json: async () => ({ error: { message: "key gemini-secret-key has no billing" } }) };
    }
  }).then(() => null, (error) => error);
  assert.equal(calls, 1);
  assert.equal(httpError.status, 403);
  assert.match(httpError.message, /请求失败/);
  assert.equal(httpError.message.includes("gemini-secret-key"), false);

  calls = 0;
  const noImage = await executeComposerTurnWithService({
    session, userMessage: "", composerSettings: settings, route: "compose", instruction: "生成图片"
  }, geminiImageSettings(), [], {
    fetchImpl: async () => { calls += 1; return response({ status: "completed", steps: [{ type: "model_output", content: [{ type: "text", text: "无法生成" }] }] }); }
  }).then(() => null, (error) => error);
  assert.equal(calls, 1);
  assert.equal(noImage.retryable, false);
  assert.match(noImage.message, /没有返回有效图片/);
});

test("prompt-only mode lets prompt assembly see originals but sends zero originals to the final OpenAI image request", async () => {
  const requests = [];
  const session = referenceSessionWithMode("openai", "prompt_only");
  const result = await executeComposerTurnWithService({
    session,
    userMessage: "",
    composerSettings: settings,
    route: "compose",
    instruction: "参考1负责构图，参考2只负责风格"
  }, visualSettings(), preparedImages, {
    stream: false,
    fetchImpl: async (_url, options) => {
      const body = JSON.parse(options.body);
      requests.push(body);
      return requests.length === 1
        ? response({ model: "gpt-5-mini", output_text: "三人长焦构图，蓝灰磨砂肌理。" })
        : response({ model: "gpt-5-mini", output: [{ type: "image_generation_call", result: "aGVsbG8=" }] });
    }
  });
  assert.equal(requests.length, 2);
  assert.equal(requests[0].input[0].content.filter((item) => item.type === "input_image").length, 3);
  assert.equal(requests[0].tools, undefined);
  assert.equal(requests[1].input[0].content.filter((item) => item.type === "input_image").length, 0);
  assert.deepEqual(requests[1].tools, [{ type: "image_generation", size: "auto", quality: "auto" }]);
  assert.equal(result.finalPrompt, "三人长焦构图，蓝灰磨砂肌理。");
});

test("text-only mode sends zero originals to prompt assembly and uses generations instead of edits", async () => {
  const calls = [];
  const session = referenceSessionWithMode("compatible", "text_only");
  await executeComposerTurnWithService({
    session,
    userMessage: "",
    composerSettings: settings,
    route: "compose",
    instruction: "按已保存分析重建"
  }, visualSettings(), preparedImages, {
    stream: false,
    fetchImpl: async (url, options) => {
      const body = JSON.parse(options.body);
      calls.push({ url, authorization: options.headers.Authorization, body });
      return calls.length === 1
        ? response({ output_text: "纯文字重建后的完整生图提示词。" })
        : response({ data: [{ b64_json: "aGVsbG8=" }] });
    }
  });
  assert.equal(calls[0].url, "https://www.micuapi.ai/v1/responses");
  assert.equal(calls[0].authorization, "Bearer chat-secret");
  assert.equal(JSON.stringify(calls[0].body).includes("input_image"), false);
  assert.equal(JSON.stringify(calls[0].body).includes("完整文字重建说明"), true);
  assert.equal(calls[1].url, "https://www.micuapi.ai/v1/images/generations");
  assert.equal(calls[1].authorization, "Bearer image-secret");
});

test("text-only mode uses an existing case prompt without requiring analysis or sending image payloads", async () => {
  const calls = [];
  const base = referenceSession("compatible", "create_image");
  const session = createComposerSession({
    ...base,
    imageReferenceMode: "text_only",
    referenceSnapshots: base.referenceSnapshots.map((reference) => ({
      ...reference,
      assets: reference.imageRefs.map((imageRef) => ({ assetId: imageRef.visualId }))
    }))
  });
  assert.equal(session.imageReferenceMode, "text_only");

  await executeComposerTurnWithService({
    session,
    userMessage: "",
    composerSettings: settings,
    route: "compose",
    instruction: "直接使用案例提示词创建图片"
  }, visualSettings(), [], {
    stream: false,
    fetchImpl: async (url, options) => {
      const body = JSON.parse(options.body);
      calls.push({ url, body });
      return calls.length === 1
        ? response({ output_text: "使用案例原提示词整理出的最终生图提示词。" })
        : response({ data: [{ b64_json: "aGVsbG8=" }] });
    }
  });

  assert.equal(calls.length, 2);
  assert.equal(calls[0].url, "https://www.micuapi.ai/v1/responses");
  assert.equal(JSON.stringify(calls[0].body).includes("input_image"), false);
  assert.equal(JSON.stringify(calls[0].body).includes("三人构图"), true);
  assert.equal(calls[1].url, "https://www.micuapi.ai/v1/images/generations");
});

test("Micu assembles a prompt, then sends every selected original image to edits with the separate key", async () => {
  const calls = [];
  const session = referenceSession("compatible", "create_image");
  const result = await executeComposerTurnWithService({
    session,
    userMessage: "",
    composerSettings: settings,
    route: "compose",
    instruction: "参考1负责构图，参考2只负责风格"
  }, visualSettings(), preparedImages, {
    stream: false,
    fetchImpl: async (url, options) => {
      calls.push({ url, authorization: options.headers.Authorization, headers: options.headers, body: options.body });
      return calls.length === 1
        ? response({ model: "requested-chat-model", output_text: "三人构图，中间女性清晰聚焦，蓝灰高定插画风格。" })
        : response({ data: [{ b64_json: "aGVsbG8=" }] });
    }
  });
  assert.equal(calls.length, 2);
  assert.equal(calls[0].url, "https://www.micuapi.ai/v1/responses");
  assert.equal(calls[0].authorization, "Bearer chat-secret");
  assert.equal(calls[1].url, "https://www.micuapi.ai/v1/images/edits");
  assert.equal(calls[1].authorization, "Bearer image-secret");
  assert.equal(calls[1].headers["Content-Type"], undefined);
  assert.equal(calls[1].body instanceof FormData, true);
  assert.equal(calls[1].body.get("model"), "gpt-image-2");
  assert.match(calls[1].body.get("prompt"), /@参考1\/图片1[\s\S]*@参考1\/图片2[\s\S]*@参考2\/图片1/);
  assert.equal(calls[1].body.get("size"), "1536x1024");
  assert.equal(calls[1].body.get("n"), "1");
  assert.equal(calls[1].body.get("response_format"), "b64_json");
  assert.equal(calls[1].body.getAll("image[]").length, 3);
  assert.equal(result.model, "");
  assert.equal(result.requestModel, "gpt-image-2");
  assert.equal(result.images.length, 1);
});

test("Micu prompt assembly keeps the planning model while final generation uses the image model", async () => {
  const calls = [];
  const session = createComposerSession({
    aiProfile: { serviceId: "compatible", model: "gpt-5.6-terra" },
    generationAiProfile: { serviceId: "compatible", model: "gpt-image-2" },
    outputMode: "create_image",
    messages: [{ role: "user", type: "request", content: "创建电影感人物海报" }]
  });
  await executeComposerTurnWithService({
    session, userMessage: "", composerSettings: settings, route: "compose", instruction: "创建电影感人物海报"
  }, visualSettings(), [], {
    stream: false,
    fetchImpl: async (url, options) => {
      calls.push({ url, authorization: options.headers.Authorization, body: JSON.parse(options.body) });
      return calls.length === 1
        ? response({ output_text: "电影感人物海报，横向构图。" })
        : response({ data: [{ b64_json: "aGVsbG8=" }] });
    }
  });
  assert.equal(calls[0].url, "https://www.micuapi.ai/v1/responses");
  assert.equal(calls[0].body.model, "gpt-5.6-terra");
  assert.equal(calls[0].authorization, "Bearer chat-secret");
  assert.equal(calls[1].url, "https://www.micuapi.ai/v1/images/generations");
  assert.equal(calls[1].body.model, "gpt-image-2");
  assert.equal(calls[1].authorization, "Bearer image-secret");
});

test("Micu single-reference edits use the single image multipart field", async () => {
  const calls = [];
  const session = createComposerSession({
    aiProfile: { serviceId: "compatible", model: "gpt-5.4-mini" },
    outputMode: "create_image",
    messages: [{ role: "user", type: "request", content: "参考这张图重新创作" }],
    referenceSnapshots: [{
      entryId: "single-reference",
      alias: "@参考1",
      originalText: "保持构图",
      imageRefs: [{ visualId: "single", mimeType: "image/png" }]
    }]
  });
  await executeComposerTurnWithService({
    session, userMessage: "", composerSettings: settings, route: "compose", instruction: "参考这张图重新创作"
  }, visualSettings(), [{ visualId: "single", dataUrl: "data:image/png;base64,AAAA" }], {
    stream: false,
    fetchImpl: async (url, options) => {
      calls.push({ url, body: options.body });
      return calls.length === 1
        ? response({ output_text: "保持参考构图，重新创作完整画面。" })
        : response({ data: [{ b64_json: "aGVsbG8=" }] });
    }
  });
  assert.equal(calls[1].url, "https://www.micuapi.ai/v1/images/edits");
  assert.equal(calls[1].body.getAll("image").length, 1);
  assert.equal(calls[1].body.getAll("image[]").length, 0);
});

test("Micu without selected images uses generations with explicit stable output parameters", async () => {
  const calls = [];
  const session = createComposerSession({
    aiProfile: { serviceId: "compatible", model: "gpt-5.4-mini" },
    outputMode: "create_image",
    messages: [{ role: "user", type: "request", content: "创作一张电影感人物图" }]
  });
  await executeComposerTurnWithService({
    session, userMessage: "", composerSettings: settings, route: "compose", instruction: "创作一张电影感人物图"
  }, visualSettings(), [], {
    stream: false,
    fetchImpl: async (url, options) => {
      calls.push({ url, authorization: options.headers.Authorization, body: JSON.parse(options.body) });
      return calls.length === 1
        ? response({ output_text: "电影感人物图。" })
        : response({ data: [{ b64_json: "aGVsbG8=" }] });
    }
  });
  assert.equal(calls[1].url, "https://www.micuapi.ai/v1/images/generations");
  assert.deepEqual(calls[1].body, {
    model: "gpt-image-2",
    prompt: "电影感人物图。",
    n: 1,
    size: "1536x1024",
    response_format: "b64_json"
  });
});

test("compatible reference edits use the recorded model limit before any paid request", async () => {
  const fourK = visualSettings();
  fourK.vision.compatible.imageGeneration.model = "gpt-image-2-openai";
  fourK.vision.compatible.imageGeneration.size = "3840x2160";
  fourK.vision.providerProfiles["custom-media"].discoveredModels[0].id = "gpt-image-2-openai";
  await assert.rejects(() => executeComposerTurnWithService({
    session: referenceSession("compatible", "create_image"), userMessage: "", composerSettings: settings,
    route: "compose", instruction: "保持参考职责"
  }, fourK, preparedImages, { fetchImpl: async () => { throw new Error("不应调用"); } }), /参考图.*最高支持 2K/);

  const imageRefs = Array.from({ length: 7 }, (_, index) => ({ visualId: `many-${index}`, mimeType: "image/png" }));
  const session = createComposerSession({
    aiProfile: { serviceId: "compatible", model: "gpt-5.4-mini" }, outputMode: "create_image",
    messages: [{ role: "user", type: "request", content: "融合全部参考" }],
    referenceSnapshots: [{ entryId: "many", alias: "@参考1", originalText: "保持对应关系", imageRefs }]
  });
  const images = imageRefs.map((item) => ({ visualId: item.visualId, dataUrl: "data:image/png;base64,AAAA" }));
  await assert.rejects(() => executeComposerTurnWithService({
    session, userMessage: "", composerSettings: settings, route: "compose", instruction: "融合全部参考"
  }, visualSettings(), images, { fetchImpl: async () => { throw new Error("不应调用"); } }), /最多读取 6 张参考图/);
});

test("image availability explains missing reference editing instead of exposing only a disabled switch", () => {
  const session = referenceSession("compatible", "text_prompt");
  const missingEdits = visualSettings();
  missingEdits.vision.compatible.imageGeneration.editsEndpoint = "";
  assert.match(composerImageAvailability(session.aiProfile, missingEdits.vision, session).message, /图片编辑接口/);
});

test("verified Micu sizes enable image generation without duplicated size settings", () => {
  const session = referenceSession("compatible", "text_prompt");
  const missingSize = visualSettings();
  missingSize.vision.compatible.imageGeneration.sizes = [];
  const capability = composerServiceCapabilities(session.aiProfile, missingSize.vision).image;
  assert.equal(capability.generate, true);
  assert.equal(composerImageAvailability(session.aiProfile, missingSize.vision, session).available, true);
  assert.deepEqual(capability.parameters.find((item) => item.key === "size").options.map((item) => item.value), [
    "1024x1024", "1280x720", "720x1280", "1024x1536", "1536x1024",
    "2048x2048", "2048x1152", "1152x2048"
  ]);
});

test("image capability contracts expose only protocol-declared parameters", () => {
  const values = visualSettings().vision;
  const openai = composerServiceCapabilities({ serviceId: "openai", model: "gpt-5-mini" }, values).image;
  assert.deepEqual(openai.parameters.map((item) => item.key), ["size", "quality"]);
  assert.deepEqual(openai.parameters.find((item) => item.key === "size").options.map((item) => item.aspectRatio), ["auto", "1:1", "3:2", "2:3"]);
  assert.deepEqual(openai.edit, { whole: true, local: true });
  assert.deepEqual(openai.references, { supported: true, maxItems: 4, source: "declared" });

  const micu = composerServiceCapabilities({ serviceId: "compatible", model: "gpt-5.4-mini" }, values).image;
  assert.deepEqual(micu.parameters.map((item) => item.key), ["size"]);
  assert.deepEqual(micu.parameters[0].options.map((item) => item.value), [
    "1024x1024", "1280x720", "720x1280", "1024x1536", "1536x1024",
    "2048x2048", "2048x1152", "1152x2048"
  ]);
  assert.equal(micu.references.maxItems, 6);
  assert.equal(micu.references.source, "observed_error");
});

test("verified Micu image models expose their official sizes without guessing for other compatible services", () => {
  const pro = visualSettings();
  pro.vision.compatible.imageGeneration.model = "gpt-image-2-openai";
  const proSizes = composerServiceCapabilities({ serviceId: "compatible", model: "gpt-5.4-mini" }, pro.vision)
    .image.parameters.find((item) => item.key === "size").options.map((item) => item.value);
  assert.deepEqual(proSizes.slice(-2), ["3840x2160", "2160x3840"]);

  const generic = visualSettings();
  generic.vision.compatible.endpoint = "https://images.example.com/v1/responses";
  generic.vision.compatible.imageGeneration.endpoint = "https://images.example.com/v1/images/generations";
  generic.vision.compatible.imageGeneration.editsEndpoint = "https://images.example.com/v1/images/edits";
  generic.vision.compatible.imageGeneration.model = "gpt-image-2";
  generic.vision.compatible.imageGeneration.sizes = ["1536x1024"];
  const genericSizes = composerServiceCapabilities({ serviceId: "compatible", model: "vision-model" }, generic.vision)
    .image.parameters.find((item) => item.key === "size").options.map((item) => item.value);
  assert.deepEqual(genericSizes, ["1536x1024"]);

  generic.vision.compatible.imageGeneration.sizes = [];
  const blocked = composerServiceCapabilities({ serviceId: "compatible", model: "vision-model" }, generic.vision).image;
  assert.equal(blocked.generate, false);
  assert.match(composerImageAvailability({ serviceId: "compatible", model: "vision-model" }, generic.vision, referenceSession("compatible")).message, /服务支持的尺寸选项/);
});

test("unknown reference limits never become zero while explicit unsupported state blocks only conditioned images", () => {
  const unknown = visualSettings();
  unknown.vision.providerProfiles["custom-media"].discoveredModels[0].referenceImages = {
    supported: true, maxItems: null, source: "unknown"
  };
  const session = referenceSessionWithMode("compatible", "conditioned");
  const generationProfile = { serviceId: "compatible", model: "gpt-image-2" };
  const capability = composerServiceCapabilities(generationProfile, unknown.vision).image;
  assert.deepEqual(capability.references, { supported: true, maxItems: null, source: "unknown" });
  const availability = composerImageAvailability(generationProfile, unknown.vision, session);
  assert.equal(availability.available, true);
  assert.doesNotMatch(availability.message, /0 张|最多读取 0/);

  unknown.vision.providerProfiles["custom-media"].discoveredModels[0].referenceImages = {
    supported: false, maxItems: null, source: "declared"
  };
  const blocked = composerImageAvailability(generationProfile, unknown.vision, session);
  assert.equal(blocked.available, false);
  assert.match(blocked.message, /不接收原图/);
  const promptOnly = createComposerSession({ ...session, imageReferenceMode: "prompt_only" });
  assert.equal(composerImageAvailability(generationProfile, unknown.vision, promptOnly).available, true);
});

test("dedicated compatible image generation remains available without an image-analysis assignment", () => {
  const values = visualSettings().vision;
  values.compatible.endpoint = "";
  values.compatible.model = "";
  values.compatible.apiKey = "";
  const profile = { serviceId: "compatible", model: "gpt-image-2" };
  assert.equal(composerServiceCapabilities(profile, values).image.generate, true);
  assert.equal(composerImageAvailability(profile, values, createComposerSession({
    targetType: "image",
    generationAiProfile: profile,
    outputMode: "text_prompt"
  })).available, true);
});

test("image requests reject unsupported declared values and omit undeclared values", () => {
  const values = visualSettings().vision;
  const invalid = normalizeImageGenerationRequest(
    { serviceId: "openai", model: "gpt-5-mini" },
    values,
    { size: "2048x2048", quality: "high", providerSecret: "leak" }
  );
  assert.deepEqual(invalid.parameters, { quality: "high" });
  assert.match(invalid.issues[0], /2048x2048.*不受当前服务支持/);
  assert.deepEqual(invalid.ignored, ["providerSecret"]);

  const micu = normalizeImageGenerationRequest(
    { serviceId: "compatible", model: "gpt-5.4-mini" },
    values,
    { size: "1536x1024", quality: "high" }
  );
  assert.deepEqual(micu.parameters, { size: "1536x1024" });
  assert.deepEqual(micu.ignored, ["quality"]);
  assert.deepEqual(micu.issues, []);
});

test("Micu image failure does not automatically repeat a chargeable request", async () => {
  let calls = 0;
  const session = createComposerSession({
    aiProfile: { serviceId: "compatible", model: "gpt-5.4-mini" }, outputMode: "create_image",
    messages: [{ role: "user", type: "request", content: "生成图片" }]
  });
  await assert.rejects(() => executeComposerTurnWithService({
    session, userMessage: "", composerSettings: settings, route: "compose", instruction: "生成图片"
  }, visualSettings(), [], {
    stream: false,
    fetchImpl: async () => {
      calls += 1;
      if (calls === 1) return response({ output_text: "最终提示词" });
      return { ok: false, status: 503, json: async () => ({ error: { message: "upstream unavailable" } }) };
    }
  }), /upstream unavailable/);
  assert.equal(calls, 2);
});

test("Micu distributor mismatch explains the image key group and never retries", async () => {
  let calls = 0;
  let imageAuthorization = "";
  const session = createComposerSession({
    aiProfile: { serviceId: "compatible", model: "gpt-5.4-mini" }, outputMode: "create_image",
    messages: [{ role: "user", type: "request", content: "生成图片" }]
  });
  const error = await executeComposerTurnWithService({
    session, userMessage: "", composerSettings: settings, route: "compose", instruction: "生成图片"
  }, visualSettings(), [], {
    stream: false,
    fetchImpl: async (_url, options) => {
      calls += 1;
      if (calls === 1) return response({ output_text: "最终提示词" });
      imageAuthorization = options.headers.Authorization;
      return {
        ok: false,
        status: 503,
        headers: { get: () => "application/json" },
        json: async () => ({ error: { message: "分组 vip_2 下模型 gpt-image-2 无可用渠道（distributor） (request id: request-123)" } })
      };
    }
  }).then(() => null, (value) => value);
  assert.equal(calls, 2);
  assert.equal(imageAuthorization, "Bearer image-secret");
  assert.equal(error.kind, "configuration");
  assert.equal(error.retryable, false);
  assert.match(error.message, /独立图片生成 Key（尾号 cret）/);
  assert.match(error.message, /vip_2_image.*模型目录里能看到/);
  assert.match(error.message, /与本轮分辨率和参考图模式无关/);
  assert.match(error.message, /request-123/);
});

test("a structured too-many-reference response exposes an observed model limit without retrying", async () => {
  let calls = 0;
  const error = await executeComposerTurnWithService({
    session: referenceSession("compatible", "create_image"), userMessage: "", composerSettings: settings,
    route: "compose", instruction: "保持参考"
  }, visualSettings(), preparedImages, {
    fetchImpl: async () => {
      calls += 1;
      if (calls === 1) return response({ output_text: "最终提示词" });
      return {
        ok: false,
        status: 400,
        headers: { get: () => "application/json" },
        json: async () => ({ error: { message: "Too many reference images (7 > 6 max)." } })
      };
    }
  }).then(() => null, (value) => value);
  assert.equal(calls, 2);
  assert.equal(error.kind, "reference_limit");
  assert.deepEqual(error.referenceLimit, { actual: 7, maximum: 6 });
  assert.equal(error.retryable, false);
});

test("Micu whole and masked edits put the generated base first and count it toward the recorded model limit", async () => {
  const calls = [];
  const session = referenceSession("compatible", "create_image");
  const imageEdit = {
    mode: "local",
    parentVisualId: "generated-parent",
    originalPrompt: "三人构图，中间女性聚焦",
    modification: "只把中间女性的外套改成红色",
    baseImage: { visualId: "generated-parent", dataUrl: "data:image/png;base64,UEFSRU5U" },
    mask: { dataUrl: "data:image/png;base64,TUFTSw==" }
  };
  await executeComposerTurnWithService({
    session, userMessage: "", composerSettings: settings, route: "compose",
    instruction: imageEdit.modification, imageEdit
  }, visualSettings(), preparedImages, {
    stream: false,
    fetchImpl: async (url, options) => {
      calls.push({ url, body: options.body });
      return calls.length === 1
        ? response({ output_text: "保持三人构图，只把中间女性外套改成红色。" })
        : response({ data: [{ b64_json: "aGVsbG8=" }] });
    }
  });
  const multipart = calls[1].body;
  assert.equal(multipart.getAll("image[]").length, 4);
  assert.match(multipart.get("image[]").name, /edit-base/);
  assert.equal(multipart.get("mask").type, "image/png");
  assert.match(multipart.get("prompt"), /图1 = 当前结果底图/);

  const sixOriginals = Array.from({ length: 6 }, (_, index) => ({
    visualId: `original-${index}`,
    dataUrl: "data:image/png;base64,AAAA"
  }));
  const tooManySession = createComposerSession({
    ...session,
    referenceSnapshots: [{
      entryId: "ten", alias: "@参考1", originalText: "保持参考",
      imageRefs: sixOriginals.map((item) => ({ visualId: item.visualId }))
    }]
  });
  await assert.rejects(() => executeComposerTurnWithService({
    session: tooManySession, userMessage: "", composerSettings: settings, route: "compose",
    instruction: "修改", imageEdit: { ...imageEdit, mode: "whole", mask: null }
  }, visualSettings(), sixOriginals, { fetchImpl: async () => { throw new Error("不应调用"); } }), /包含当前底图.*最多 6 张/);
});

test("OpenAI masked edit uses input_image_mask and deletes both temporary files", async () => {
  const calls = [];
  const controller = new AbortController();
  const session = referenceSession("openai", "create_image");
  const imageEdit = {
    mode: "local",
    parentVisualId: "generated-parent",
    originalPrompt: "三人构图",
    modification: "只修改选区服装",
    baseImage: { visualId: "generated-parent", dataUrl: "data:image/png;base64,UEFSRU5U" },
    mask: { dataUrl: "data:image/png;base64,TUFTSw==" }
  };
  const result = await executeComposerTurnWithService({
    session, userMessage: "", composerSettings: settings, route: "compose",
    instruction: imageEdit.modification, imageEdit
  }, visualSettings(), preparedImages, {
    fetchImpl: async (url, options) => {
      calls.push({ url, method: options.method, body: options.body, signalAborted: options.signal?.aborted });
      if (url.endsWith("/files") && options.method === "POST") {
        return response({ id: calls.filter((item) => item.url.endsWith("/files")).length === 1 ? "file-base" : "file-mask" });
      }
      if (url.includes("/files/") && options.method === "DELETE") return response({ deleted: true });
      const body = JSON.parse(options.body);
      assert.equal(body.input[0].content[1].file_id, "file-base");
      assert.deepEqual(body.tools, [{ type: "image_generation", input_image_mask: { file_id: "file-mask" }, size: "auto", quality: "auto" }]);
      controller.abort();
      return response({ model: "gpt-image-returned", output: [{ type: "image_generation_call", result: "aGVsbG8=" }] });
    },
    signal: controller.signal
  });
  assert.equal(result.model, "gpt-image-returned");
  assert.deepEqual(calls.filter((item) => item.method === "DELETE").map((item) => item.url).sort(), [
    "https://api.openai.com/v1/files/file-base",
    "https://api.openai.com/v1/files/file-mask"
  ]);
  assert.ok(calls.filter((item) => item.method === "DELETE").every((item) => item.signalAborted === false));
});

test("local editing is shown only for verified OpenAI and Micu protocols", () => {
  assert.deepEqual(composerImageEditCapabilities({ serviceId: "openai", model: "gpt-5-mini" }, visualSettings().vision), { whole: true, local: true });
  assert.deepEqual(composerImageEditCapabilities({ serviceId: "compatible", model: "gpt-5.4-mini" }, visualSettings().vision), { whole: true, local: true });
  const unknown = visualSettings({
    compatible: {
      protocol: "responses", endpoint: "https://vision.example.com/v1/responses", apiKey: "secret", model: "vision",
      imageGeneration: { protocol: "images_generations", endpoint: "https://vision.example.com/v1/images/generations", editsEndpoint: "https://vision.example.com/v1/images/edits", apiKey: "image", model: "image", size: "1024x1024" }
    }
  });
  assert.deepEqual(composerImageEditCapabilities({ serviceId: "compatible", model: "vision" }, unknown.vision), { whole: false, local: false });
});

test("compatible image generation downloads a URL result and identifies an image with a generic content type", async () => {
  const session = createComposerSession({
    aiProfile: { serviceId: "compatible", model: "gpt-5.4-mini" }, outputMode: "create_image",
    messages: [{ role: "user", type: "request", content: "生成图片" }]
  });
  const png = Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 0]);
  const controller = new AbortController();
  const phases = [];
  const result = await executeComposerTurnWithService({
    session,
    userMessage: "",
    composerSettings: settings,
    route: "compose",
    instruction: "保持参考职责"
  }, visualSettings(), [], {
    stream: false,
    signal: controller.signal,
    onPhase: (phase) => phases.push(phase),
    fetchImpl: async (url, options) => {
      if (url === "https://oss.filenest.top/result.png") {
        assert.equal(options.signal instanceof AbortSignal, true);
        assert.equal(options.signal.aborted, false);
        return mediaResponse("image");
      }
      if (url.endsWith("/images/generations")) return response({ data: [{ url: "https://oss.filenest.top/result.png" }] });
      return response({ output_text: "三人构图与风格职责明确。" });
    }
  });
  assert.equal(result.images[0].blob.type, "image/png");
  assert.equal(result.images[0].blob.size, png.length);
  assert.deepEqual(phases, ["downloading"]);
});

test("video capabilities expose only the configured OpenAI contract and reject undeclared values", () => {
  const values = visualSettings().vision;
  const capability = composerServiceCapabilities({ serviceId: "openai", model: "gpt-5-mini" }, values).video;
  assert.equal(capability.generate, true);
  assert.deepEqual(capability.inputs, {
    text: true,
    firstFrame: true,
    lastFrame: false,
    referenceImages: { supported: true, maxItems: 1 },
    referenceVideo: false,
    edit: false,
    extend: false,
    motion: false
  });
  assert.deepEqual(capability.parameters.map((item) => [item.key, item.options.map((option) => option.value)]), [
    ["size", ["1280x720", "720x1280"]],
    ["duration", ["4", "8"]]
  ]);
  assert.equal(composerServiceCapabilities({ serviceId: "compatible", model: "gpt-5.4-mini" }, values).video, null);

  const session = createComposerSession({
    targetType: "video",
    outputMode: "create_video",
    aiProfile: { serviceId: "openai", model: "gpt-5-mini" },
    generationParameters: { size: "4096x2160", duration: "8", motion: "cinematic" }
  });
  const requested = { size: "4096x2160", duration: "8", motion: "cinematic" };
  const normalized = normalizeVideoGenerationRequest(session.aiProfile, values, requested);
  assert.deepEqual(normalized.parameters, { duration: "8" });
  assert.match(normalized.issues[0], /4096x2160.*不受当前服务支持/);
  assert.deepEqual(normalized.ignored, ["motion"]);
  assert.match(composerVideoAvailability(session.aiProfile, values, { ...session, generationParameters: requested }).message, /4096x2160/);
});

test("OpenAI video generation submits once, polls, downloads, and persists a resumable remote id", async () => {
  const calls = [];
  const phases = [];
  const remoteVideos = [];
  const session = createComposerSession({
    targetType: "video",
    outputMode: "create_video",
    aiProfile: { serviceId: "openai", model: "gpt-5-mini" },
    generationParameters: { size: "1280x720", duration: "4" },
    messages: [{ role: "user", type: "request", content: "创建一段四秒镜头" }],
    referenceSnapshots: [{
      entryId: "first-frame",
      alias: "@参考1",
      referenceKind: "vision",
      referenceText: "沿用人物和构图",
      imageRefs: [{ visualId: "one", mimeType: "image/png" }]
    }]
  });
  const result = await executeComposerTurnWithService({
    session, userMessage: "", composerSettings: settings, route: "compose", instruction: "人物缓慢回头"
  }, visualSettings(), [preparedImages[0]], {
    stream: false,
    pollIntervalMs: 0,
    onPhase: (phase) => phases.push(phase),
    onRemoteVideo: (remote) => remoteVideos.push(remote),
    fetchImpl: async (url, options) => {
      calls.push({ url, method: options.method, body: options.body });
      if (calls.length === 1) return response({ model: "gpt-5-mini", output_text: "人物缓慢回头，镜头保持稳定。" });
      if (url === "https://api.openai.com/v1/videos" && options.method === "POST") {
        assert.equal(options.body instanceof FormData, true);
        assert.equal(options.body.get("model"), "account-video-model");
        assert.equal(options.body.get("prompt"), "人物缓慢回头，镜头保持稳定。");
        assert.equal(options.body.get("size"), "1280x720");
        assert.equal(options.body.get("seconds"), "4");
        assert.equal(options.body.getAll("input_reference").length, 1);
        return response({ id: "video-remote-one", status: "queued" });
      }
      if (url.endsWith("/video-remote-one/content")) {
        return mediaResponse("video");
      }
      const statusCalls = calls.filter((item) => item.url.endsWith("/video-remote-one") && item.method === "GET").length;
      return response(statusCalls === 1
        ? { id: "video-remote-one", status: "in_progress" }
        : { id: "video-remote-one", status: "completed", model: "account-video-model" });
    }
  });
  assert.equal(calls.filter((item) => item.url === "https://api.openai.com/v1/videos" && item.method === "POST").length, 1);
  assert.deepEqual(remoteVideos, [{
    serviceId: "openai",
    remoteId: "video-remote-one",
    finalPrompt: "人物缓慢回头，镜头保持稳定。",
    requestParameters: { size: "1280x720", duration: "4" }
  }]);
  assert.deepEqual(phases, ["generation", "downloading"]);
  assert.equal(result.kind, "video");
  assert.equal(result.videos[0].blob.type, "video/mp4");
  assert.deepEqual(result.requestParameters, { size: "1280x720", duration: "4" });
});

test("a persisted remote video resumes without planning or a second paid submission", async () => {
  const calls = [];
  const session = createComposerSession({
    targetType: "video",
    outputMode: "create_video",
    aiProfile: { serviceId: "openai", model: "gpt-5-mini" },
    generationParameters: { size: "1280x720", duration: "4" },
    messages: [{ role: "user", type: "request", content: "继续任务" }]
  });
  const result = await executeComposerTurnWithService({
    session, userMessage: "", composerSettings: settings, route: "compose", instruction: "不会再次规划"
  }, visualSettings(), [], {
    pollIntervalMs: 0,
    remoteVideo: {
      serviceId: "openai",
      remoteId: "video-existing",
      finalPrompt: "已经提交的最终提示词",
      requestParameters: { size: "1280x720", duration: "4" }
    },
    fetchImpl: async (url, options) => {
      calls.push({ url, method: options.method });
      if (url.endsWith("/content")) {
        return mediaResponse("video");
      }
      return response({ id: "video-existing", status: "completed" });
    }
  });
  assert.deepEqual(calls.map((item) => item.method), ["GET", "GET"]);
  assert.equal(calls.some((item) => item.url === "https://api.openai.com/v1/videos"), false);
  assert.equal(result.finalPrompt, "已经提交的最终提示词");
});

test("an expired remote video returns an explicit retryable regeneration error", async () => {
  const session = createComposerSession({
    targetType: "video",
    outputMode: "create_video",
    aiProfile: { serviceId: "openai", model: "gpt-5-mini" },
    messages: [{ role: "user", type: "request", content: "继续任务" }]
  });
  await assert.rejects(async () => executeComposerTurnWithService({
    session, userMessage: "", composerSettings: settings, route: "compose", instruction: "继续"
  }, visualSettings(), [], {
    remoteVideo: {
      serviceId: "openai",
      remoteId: "video-expired",
      finalPrompt: "旧提示词",
      requestParameters: { size: "1280x720", duration: "4" }
    },
    fetchImpl: async (url) => url.endsWith("/content")
      ? { ok: false, status: 404, json: async () => ({ error: { message: "expired" } }) }
      : response({ id: "video-expired", status: "completed" })
  }), (error) => error.kind === "expired" && error.retryable === true && /重新生成/.test(error.message));
});
