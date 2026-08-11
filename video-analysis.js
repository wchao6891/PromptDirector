export const VIDEO_ANALYSIS_MODES = Object.freeze([
  { id: "creative-breakdown", label: "创意拆解" },
  { id: "content-summary", label: "内容总结" },
  { id: "ad-review", label: "广告评价" },
  { id: "custom", label: "自定义问题" }
]);

export const GEMINI_VIDEO_UPLOAD_ENDPOINT = "https://generativelanguage.googleapis.com/upload/v1beta/files";
export const GEMINI_VIDEO_API_ROOT = "https://generativelanguage.googleapis.com/v1beta";
export const GEMINI_FILE_POLL_INTERVAL_MS = 2_000;
export const GEMINI_FILE_POLL_LIMIT = 150;
const GEMINI_VIDEO_MIME_TYPES = new Set(["video/mp4", "video/mpeg", "video/quicktime", "video/avi", "video/x-flv", "video/mpg", "video/webm", "video/wmv", "video/3gpp"]);
const OPENROUTER_VIDEO_MIME_TYPES = new Set(["video/mp4", "video/mpeg", "video/quicktime", "video/webm"]);

export function requireVideoAnalysisConfirmation(value) {
  if (value !== true) throw new Error("请从视频分析确认框开始本次付费媒体分析");
  return true;
}

export function videoAnalysisPrompt(mode, customQuestion = "") {
  if (mode === "content-summary") return "完整理解视频的画面与声音，给出结构化内容总结，并为关键段落标注可点击的时间戳。只陈述视频中可验证的内容。";
  if (mode === "ad-review") return "从广告创意角度分析视频：前 3 秒钩子、叙事结构、画面节奏、声音、卖点、受众、转化动作与主要问题；为关键判断标注时间戳。";
  if (mode === "custom") {
    const question = clean(customQuestion);
    if (!question) throw new Error("请填写本次要分析的问题");
    return `${question}\n\n回答时请同时参考视频画面和声音；关键结论标注时间戳，不确定内容明确说明。`;
  }
  return "从创意导演视角完整拆解视频：分段叙事、镜头与构图、运动与剪辑、光色与美术、角色/产品呈现、声音、情绪曲线和可复用方法；为关键段落标注时间戳。";
}

export async function analyzeVideoWithGemini(input = {}, dependencies = {}) {
  const fetchImpl = dependencies.fetchImpl ?? fetch;
  const sleep = dependencies.sleep ?? ((milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)));
  const apiKey = clean(input.apiKey);
  const model = clean(input.model);
  if (!apiKey || !model) throw new Error("Gemini 视频分析尚未完成配置");
  const prompt = videoAnalysisPrompt(input.mode, input.customQuestion);
  const onStage = typeof input.onStage === "function" ? input.onStage : () => {};
  let filePart;
  let sourceKind;
  if (input.videoBlob instanceof Blob) {
    if (!GEMINI_VIDEO_MIME_TYPES.has(input.videoBlob.type)) throw new Error(`Gemini 当前不支持 ${input.videoBlob.type || "未知格式"} 视频；请先转换为 MP4、WebM、MOV 或 AVI`);
    sourceKind = "local-video";
    onStage("uploading");
    const uploaded = await uploadGeminiVideo(input.videoBlob, apiKey, fetchImpl);
    const ready = await waitForGeminiFile(uploaded, apiKey, fetchImpl, sleep, onStage);
    filePart = { file_data: { mime_type: ready.mimeType || input.videoBlob.type, file_uri: ready.uri } };
  } else {
    const youtubeUrl = publicYouTubeUrl(input.youtubeUrl);
    if (!youtubeUrl) throw new Error("该社媒链接无法直接交给视频理解服务，请先附加本地视频文件");
    sourceKind = "public-youtube-url";
    filePart = { file_data: { file_uri: youtubeUrl } };
  }
  onStage("analyzing");
  const response = await fetchImpl(`${GEMINI_VIDEO_API_ROOT}/models/${encodeURIComponent(model)}:generateContent`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-goog-api-key": apiKey },
    credentials: "omit",
    redirect: "error",
    body: JSON.stringify({ contents: [{ role: "user", parts: [filePart, { text: prompt }] }] })
  });
  const payload = await readJsonResponse(response, "Gemini 视频分析");
  const text = (payload.candidates ?? []).flatMap((candidate) => candidate?.content?.parts ?? []).map((part) => clean(part?.text)).filter(Boolean).join("\n\n");
  if (!text) throw new Error("Gemini 没有返回可保存的视频分析文字");
  onStage("completed");
  return {
    text,
    provider: "Google Gemini",
    model: clean(payload.modelVersion) || model,
    sourceKind,
    prompt,
    usage: normalizeGeminiUsage(payload.usageMetadata)
  };
}

export async function analyzeVideoWithOpenRouter(input = {}, dependencies = {}) {
  const fetchImpl = dependencies.fetchImpl ?? fetch;
  const apiKey = clean(input.apiKey);
  const model = clean(input.model);
  if (!apiKey || !model) throw new Error("OpenRouter 视频分析尚未完成配置");
  const prompt = videoAnalysisPrompt(input.mode, input.customQuestion);
  const onStage = typeof input.onStage === "function" ? input.onStage : () => {};
  let videoUrl;
  let sourceKind;
  if (input.videoBlob instanceof Blob) {
    if (!OPENROUTER_VIDEO_MIME_TYPES.has(input.videoBlob.type)) {
      throw new Error(`OpenRouter 当前不支持 ${input.videoBlob.type || "未知格式"} 视频；请先转换为 MP4、WebM、MOV 或 MPEG`);
    }
    sourceKind = "local-video";
    onStage("encoding");
    videoUrl = await blobDataUrl(input.videoBlob);
  } else {
    videoUrl = safeHttpsUrl(input.youtubeUrl);
    if (!videoUrl) throw new Error("该视频链接不能安全发送给 OpenRouter，请改用 HTTPS 地址或附加本地视频文件");
    sourceKind = "public-video-url";
  }
  onStage("analyzing");
  const endpoint = openRouterChatEndpoint(input.endpoint);
  const response = await fetchImpl(endpoint, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
    credentials: "omit",
    redirect: "error",
    body: JSON.stringify({
      model,
      stream: false,
      messages: [{
        role: "user",
        content: [
          { type: "text", text: prompt },
          { type: "video_url", video_url: { url: videoUrl } }
        ]
      }]
    })
  });
  const payload = await readJsonResponse(response, "OpenRouter 视频分析");
  const text = openRouterMessageText(payload?.choices?.[0]?.message?.content);
  if (!text) throw new Error("OpenRouter 没有返回可保存的视频分析文字");
  onStage("completed");
  return {
    text,
    provider: "OpenRouter",
    model: clean(payload.model) || model,
    sourceKind,
    prompt,
    usage: normalizeOpenRouterUsage(payload.usage),
    cost: Number.isFinite(Number(payload.usage?.cost)) ? Number(payload.usage.cost) : null,
    routing: clean(payload.provider) ? { provider: clean(payload.provider) } : null
  };
}

async function uploadGeminiVideo(blob, apiKey, fetchImpl) {
  const start = await fetchImpl(GEMINI_VIDEO_UPLOAD_ENDPOINT, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-goog-api-key": apiKey,
      "x-goog-upload-protocol": "resumable",
      "x-goog-upload-command": "start",
      "x-goog-upload-header-content-length": String(blob.size),
      "x-goog-upload-header-content-type": blob.type || "video/mp4"
    },
    credentials: "omit",
    redirect: "error",
    body: JSON.stringify({ file: { display_name: "PromptDirector video analysis" } })
  });
  if (!start.ok) await readJsonResponse(start, "Gemini 视频上传初始化");
  const uploadUrl = safeGoogleUploadUrl(start.headers.get("x-goog-upload-url"));
  if (!uploadUrl) throw new Error("Gemini 没有返回安全的上传地址");
  const uploadedResponse = await fetchImpl(uploadUrl, {
    method: "POST",
    headers: {
      "content-length": String(blob.size),
      "x-goog-upload-offset": "0",
      "x-goog-upload-command": "upload, finalize"
    },
    credentials: "omit",
    redirect: "error",
    body: blob
  });
  const payload = await readJsonResponse(uploadedResponse, "Gemini 视频上传");
  if (!clean(payload.file?.name) || !clean(payload.file?.uri)) throw new Error("Gemini 上传结果缺少文件标识");
  return payload.file;
}

async function waitForGeminiFile(file, apiKey, fetchImpl, sleep, onStage) {
  let current = file;
  for (let attempt = 0; attempt < GEMINI_FILE_POLL_LIMIT; attempt += 1) {
    const state = clean(current.state).toLocaleUpperCase("en-US");
    if (!state || state === "ACTIVE") return current;
    if (state === "FAILED") throw new Error("Gemini 无法处理这个视频文件");
    onStage("processing");
    await sleep(GEMINI_FILE_POLL_INTERVAL_MS);
    const response = await fetchImpl(`${GEMINI_VIDEO_API_ROOT}/${clean(current.name)}`, {
      headers: { "x-goog-api-key": apiKey }, credentials: "omit", redirect: "error"
    });
    current = await readJsonResponse(response, "Gemini 视频处理状态");
  }
  throw new Error("Gemini 处理视频超时，本次没有保存分析结果");
}

export function publicYouTubeUrl(value) {
  try {
    const url = new URL(value);
    const host = url.hostname.toLocaleLowerCase("en-US").replace(/^www\./, "");
    if (!["youtube.com", "youtu.be", "m.youtube.com"].includes(host)) return "";
    if (url.protocol !== "https:") return "";
    return url.href;
  } catch {
    return "";
  }
}

function safeGoogleUploadUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && (url.hostname === "googleapis.com" || url.hostname.endsWith(".googleapis.com")) ? url.href : "";
  } catch {
    return "";
  }
}

function openRouterChatEndpoint(value) {
  const endpoint = safeHttpsUrl(value || "https://openrouter.ai/api/v1");
  if (!endpoint) throw new Error("OpenRouter 接口地址无效");
  const url = new URL(endpoint);
  url.pathname = `${url.pathname.replace(/\/$/, "").replace(/\/chat\/completions$/, "")}/chat/completions`;
  url.search = "";
  return url.href;
}

function safeHttpsUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" ? url.href : "";
  } catch {
    return "";
  }
}

async function blobDataUrl(blob) {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  }
  return `data:${blob.type};base64,${btoa(binary)}`;
}

function openRouterMessageText(value) {
  if (typeof value === "string") return clean(value);
  return (Array.isArray(value) ? value : [])
    .map((part) => clean(part?.text ?? part?.content))
    .filter(Boolean)
    .join("\n\n");
}

function normalizeOpenRouterUsage(value = {}) {
  return {
    inputTokens: Math.max(0, Number(value.prompt_tokens ?? value.input_tokens) || 0),
    outputTokens: Math.max(0, Number(value.completion_tokens ?? value.output_tokens) || 0),
    totalTokens: Math.max(0, Number(value.total_tokens) || 0)
  };
}

async function readJsonResponse(response, label) {
  let payload = {};
  try { payload = await response.json(); } catch {}
  if (!response.ok) throw new Error(clean(payload?.error?.message) || `${label}失败（HTTP ${response.status}）`);
  return payload;
}

function normalizeGeminiUsage(value = {}) {
  return {
    inputTokens: Math.max(0, Number(value.promptTokenCount) || 0),
    outputTokens: Math.max(0, Number(value.candidatesTokenCount) || 0),
    totalTokens: Math.max(0, Number(value.totalTokenCount) || 0)
  };
}

function clean(value) {
  return String(value ?? "").replace(/[\u0000-\u001f\u007f]/g, " ").trim();
}
