import { analysisTaxonomyPayload, validateAnalysisTagResponse } from "./tag-taxonomy.js";

export const VIDEO_RECONSTRUCTION_CONTRACT_VERSION = "visual-reconstruction-tags-json-v3-1-evidence-guard";

export const VIDEO_ANALYSIS_MODES = Object.freeze([
  { id: "visual-reconstruction", label: "逆推提示词" },
  { id: "creative-breakdown", label: "创意拆解" },
  { id: "ad-review", label: "广告评价" },
  { id: "custom", label: "自定义问题" }
]);

export const GEMINI_VIDEO_UPLOAD_ENDPOINT = "https://generativelanguage.googleapis.com/upload/v1beta/files";
export const GEMINI_VIDEO_API_ROOT = "https://generativelanguage.googleapis.com/v1beta";
export const GEMINI_FILE_POLL_INTERVAL_MS = 2_000;
export const GEMINI_FILE_POLL_LIMIT = 150;
const GEMINI_VIDEO_MIME_TYPES = new Set(["video/mp4", "video/mpeg", "video/quicktime", "video/avi", "video/x-flv", "video/mpg", "video/webm", "video/wmv", "video/3gpp"]);
const CHAT_COMPLETIONS_VIDEO_MIME_TYPES = new Set(["video/mp4", "video/mpeg", "video/quicktime", "video/webm", "video/x-m4v"]);
const EMBEDDED_VIDEO_PROVIDERS = new Set(["youtube", "vimeo", "bilibili", "douyin", "x"]);

export function requireVideoAnalysisConfirmation(value) {
  if (value !== true) throw new Error("请从视频分析确认框开始本次付费媒体分析");
  return true;
}

export function videoAnalysisPrompt(mode, customQuestion = "", options = {}) {
  if (mode === "visual-reconstruction") return visualReconstructionPrompt(options);
  if (mode === "content-summary") return "只根据视频中可见画面给出结构化内容总结，并为关键段落标注时间戳；无法由画面确认的内容明确说明。";
  if (mode === "ad-review") return "只根据视频中可见画面，从广告创意角度分析前 3 秒钩子、叙事结构、画面节奏、卖点、受众、转化动作与主要问题；为关键判断标注时间戳，不推断未提供的音轨内容。";
  if (mode === "custom") {
    const question = cleanMultiline(customQuestion);
    if (!question) throw new Error("请填写本次要分析的问题");
    return `${question}\n\n只根据视频中可见画面回答；关键结论标注时间戳，不确定内容明确说明，不推断未提供的音轨内容。`;
  }
  return "只根据视频中可见画面，从创意导演视角完整拆解分段叙事、镜头与构图、运动与剪辑、光色与美术、角色或产品呈现、视觉情绪曲线和可复用方法；为关键段落标注时间戳，不推断未提供的音轨内容。";
}

export async function analyzeVideoWithGemini(input = {}, dependencies = {}) {
  const fetchImpl = dependencies.fetchImpl ?? fetch;
  const sleep = dependencies.sleep ?? ((milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)));
  const apiKey = clean(input.apiKey);
  const model = clean(input.model);
  if (!apiKey || !model) throw new Error("Gemini 视频分析尚未完成配置");
  const mode = clean(input.mode) || "creative-breakdown";
  const structuredReconstruction = mode === "visual-reconstruction";
  const includeTags = input.includeTags !== false;
  const prompt = cleanMultiline(input.instruction) || videoAnalysisPrompt(mode, input.customQuestion, {
    includeTags,
    catalog: input.catalog,
    locale: input.locale,
    durationMs: input.durationMs,
    durationSeconds: input.durationSeconds,
    width: input.width,
    height: input.height
  });
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
    signal: input.signal,
    body: JSON.stringify({
      contents: [{ role: "user", parts: [filePart, { text: prompt }] }],
      ...(structuredReconstruction ? { generationConfig: { responseMimeType: "application/json" } } : {})
    })
  });
  const payload = await readJsonResponse(response, "Gemini 视频分析");
  const text = (payload.candidates ?? []).flatMap((candidate) => candidate?.content?.parts ?? []).map((part) => clean(part?.text)).filter(Boolean).join("\n\n");
  if (!text) throw new Error("Gemini 没有返回可保存的视频分析文字");
  const finishReason = clean(payload.candidates?.[0]?.finishReason);
  const reconstruction = structuredReconstruction
    ? parseVideoReconstruction(text, { includeTags, catalog: input.catalog, finishReason })
    : null;
  onStage("completed");
  return {
    text,
    provider: "Google Gemini",
    model: clean(payload.modelVersion) || model,
    sourceKind,
    prompt,
    usage: normalizeGeminiUsage(payload.usageMetadata),
    finishReason,
    ...(reconstruction ? {
      contractVersion: VIDEO_RECONSTRUCTION_CONTRACT_VERSION,
      analysisScope: "visual",
      includeTags,
      reconstructionPrompt: reconstruction.reconstructionPrompt,
      tags: reconstruction.tags,
      uncertainties: reconstruction.uncertainties
    } : {})
  };
}

export async function analyzeVideoWithOpenRouter(input = {}, dependencies = {}) {
  return analyzeVideoWithChatCompletions({
    ...input,
    providerLabel: clean(input.providerLabel) || "OpenRouter"
  }, dependencies);
}

export async function analyzeVideoWithChatCompletions(input = {}, dependencies = {}) {
  const fetchImpl = dependencies.fetchImpl ?? fetch;
  const apiKey = clean(input.apiKey);
  const model = clean(input.model);
  const providerLabel = clean(input.providerLabel) || "兼容视频服务";
  if (!apiKey || !model) throw new Error(`${providerLabel} 视频分析尚未完成配置`);
  const mode = clean(input.mode) || "creative-breakdown";
  const structuredReconstruction = mode === "visual-reconstruction";
  const includeTags = input.includeTags !== false;
  const requestId = clean(input.requestId);
  if (structuredReconstruction && !requestId) throw new Error("AI 视觉逆推缺少本次唯一请求标识，尚未发送");
  const prompt = cleanMultiline(input.instruction) || videoAnalysisPrompt(mode, input.customQuestion, {
    includeTags,
    catalog: input.catalog,
    locale: input.locale,
    durationMs: input.durationMs,
    durationSeconds: input.durationSeconds,
    width: input.width,
    height: input.height
  });
  const onStage = typeof input.onStage === "function" ? input.onStage : () => {};
  throwIfAborted(input.signal);
  const sourcePlan = chatCompletionsVideoSourcePlan(input);
  let videoUrl = sourcePlan.videoUrl;
  const sourceKind = sourcePlan.sourceKind;
  if (sourceKind === "local-video") {
    if (!CHAT_COMPLETIONS_VIDEO_MIME_TYPES.has(input.videoBlob.type)) {
      throw new Error(`${providerLabel} 当前不支持 ${input.videoBlob.type || "未知格式"} 视频；请先转换为 MP4、WebM、MOV 或 MPEG`);
    }
    onStage("encoding");
    throwIfAborted(input.signal);
    videoUrl = input.localVideo === "base64"
      ? await blobBase64(input.videoBlob)
      : await blobDataUrl(input.videoBlob);
    throwIfAborted(input.signal);
  }
  onStage("analyzing");
  const endpoint = chatCompletionsEndpoint(input.endpoint, providerLabel);
  const maxOutputTokens = positiveInteger(input.maxOutputTokens);
  const response = await fetchImpl(endpoint, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
    credentials: "omit",
    redirect: "error",
    signal: input.signal,
    body: JSON.stringify({
      model,
      stream: false,
      ...(requestId ? { request_id: requestId } : {}),
      ...(maxOutputTokens ? { max_tokens: maxOutputTokens } : {}),
      ...(structuredReconstruction ? { response_format: { type: "json_object" } } : {}),
      messages: [{
        role: "user",
        content: [
          { type: "text", text: prompt },
          { type: "video_url", video_url: { url: videoUrl } }
        ]
      }]
    })
  });
  let payload;
  try {
    payload = await readJsonResponse(response, `${providerLabel} 视频分析`);
  } catch (error) {
    const wrapped = new Error(`${providerLabel} 视频分析失败：${redactSecret(error?.message, apiKey)}`, { cause: error });
    wrapped.status = Number(error?.status) || 0;
    throw wrapped;
  }
  throwIfAborted(input.signal);
  const choice = payload?.choices?.[0];
  const finishReason = clean(choice?.finish_reason);
  const text = chatCompletionsMessageText(choice?.message?.content);
  if (!text) throw new Error(`${providerLabel} 没有返回可保存的视频分析文字`);
  const reconstruction = structuredReconstruction
    ? parseVideoReconstruction(text, { includeTags, catalog: input.catalog, finishReason })
    : null;
  onStage("completed");
  return {
    text,
    provider: providerLabel,
    model: clean(payload.model) || model,
    sourceKind,
    prompt,
    usage: normalizeChatCompletionsUsage(payload.usage),
    cost: Number.isFinite(Number(payload.usage?.cost)) ? Number(payload.usage.cost) : null,
    routing: clean(payload.provider) ? { provider: clean(payload.provider) } : null,
    finishReason,
    ...(requestId ? { requestId } : {}),
    ...(clean(payload.request_id) ? { responseRequestId: clean(payload.request_id) } : {}),
    ...(reconstruction ? {
      contractVersion: VIDEO_RECONSTRUCTION_CONTRACT_VERSION,
      analysisScope: "visual",
      includeTags,
      reconstructionPrompt: reconstruction.reconstructionPrompt,
      tags: reconstruction.tags,
      uncertainties: reconstruction.uncertainties
    } : {})
  };
}

export function chatCompletionsVideoSourcePlan(input = {}) {
  const providerLabel = clean(input.providerLabel) || "兼容视频服务";
  const publicVideoUrl = safeHttpsUrl(input.videoUrl || input.youtubeUrl);
  const hasLocalVideo = input.videoBlob instanceof Blob || input.hasLocalVideo === true;
  const embeddedPage = input.referencePlaybackMode === "embed"
    || EMBEDDED_VIDEO_PROVIDERS.has(clean(input.referenceProvider).toLocaleLowerCase("en-US"));
  const directPublicUrlRequired = input.publicVideoUrl === "direct";
  const assertUsablePublicUrl = () => {
    if (directPublicUrlRequired && embeddedPage) {
      throw new Error(`${providerLabel} 当前模型只确认了公网视频文件直链，不能分析 YouTube、Bilibili、抖音、X 或 Vimeo 播放页`);
    }
  };
  if (input.preferPublicVideoUrl === true && publicVideoUrl) {
    assertUsablePublicUrl();
    return { videoUrl: publicVideoUrl, sourceKind: "public-video-url" };
  }
  if (hasLocalVideo) {
    if (input.localVideo === "unsupported") {
      throw new Error(`${providerLabel} 当前模型只确认了公网 HTTPS 视频文件直链，不能直接发送本地视频`);
    }
    const videoMimeType = clean(input.videoMimeType || input.videoBlob?.type).toLocaleLowerCase("en-US");
    if (videoMimeType && !CHAT_COMPLETIONS_VIDEO_MIME_TYPES.has(videoMimeType)) {
      throw new Error(`${providerLabel} 当前不能编码发送 ${videoMimeType} 视频；请先转换为 MP4、WebM、MOV、M4V 或 MPEG`);
    }
    return { videoUrl: "", sourceKind: "local-video" };
  }
  if (!publicVideoUrl) {
    throw new Error(`该视频链接不能安全发送给 ${providerLabel}，请改用 HTTPS 地址或附加本地视频文件`);
  }
  assertUsablePublicUrl();
  return { videoUrl: publicVideoUrl, sourceKind: "public-video-url" };
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

function chatCompletionsEndpoint(value, providerLabel) {
  const endpoint = safeHttpsUrl(value);
  if (!endpoint) throw new Error(`${providerLabel} 接口地址无效`);
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
  return `data:${blob.type};base64,${await blobBase64(blob)}`;
}

async function blobBase64(blob) {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  }
  return btoa(binary);
}

function chatCompletionsMessageText(value) {
  if (typeof value === "string") return clean(value);
  return (Array.isArray(value) ? value : [])
    .map((part) => clean(part?.text ?? part?.content))
    .filter(Boolean)
    .join("\n\n");
}

function visualReconstructionPrompt(options = {}) {
  const includeTags = options.includeTags !== false;
  const durationSeconds = positiveNumber(options.durationSeconds) || positiveNumber(options.durationMs) / 1000;
  const width = positiveInteger(options.width);
  const height = positiveInteger(options.height);
  const metadata = [
    durationSeconds > 0 ? `时长 ${durationSeconds.toFixed(3)} 秒` : "",
    width && height ? `画面 ${width}×${height}` : ""
  ].filter(Boolean);
  const tagInstruction = includeTags
    ? [
        "tags 必须为 4–8 个对象；每个对象只含 g、t，g 必须来自 fixedPaths 的视觉分类路径，t 是稳定、具体、互不重复的中文检索短标签。",
        `fixedPaths=${visualAnalysisTaxonomyPayload(options.catalog, options.locale)}`
      ].join("\n")
    : "本次不生成标签，tags 必须是空数组。";
  return [
    "你是视频生成提示词逆向工程师。目标是重建这支成片中实际可见的视觉结果，不猜测原作者未实现的意图。返回一个 JSON 对象。",
    metadata.length ? `媒体元数据由客户端直接读取：${metadata.join("，")}。这些值高于模型对画幅与时长的猜测。` : "",
    "JSON 只能有 reconstructionPrompt、tags、uncertainties 三个字段。reconstructionPrompt 必须是完整、可编辑、可直接用于视频生成的中文提示词；uncertainties 只列会显著影响视觉重建、但无法从画面确认的项目。",
    tagInstruction,
    "reconstructionPrompt 依次包含：整体视觉目标与媒介形式；稳定主体和场景；按真实时长划分的逐镜头时间线；风格、光色和材质；主体连续性、动作物理与生成约束；需要复现的片内叙事文字。每个真实镜头或连续段只写一次，并在同一条中写时间、景别、机位、有证据的运镜、主体动作和切换方式。",
    "只描述画面证据。平台或模型附加的 AI 角标、水印、播放器控件、网页边框不属于创意内容，不得写进任何字段；只有教程标题、剧情字幕、产品信息等片内叙事文字才保留。",
    "当前请求只验证视觉画面，完全没有音轨证据。三个输出字段都不得描述、推断或限制任何声音信息，也不得用声音是否存在来补全画面；音频能力由产品界面在结果之外另行说明。",
    "时间线先保留每段最显著的可见变化及其开始状态、变化过程和结束状态，再补材质等次要细节。每个动作、运镜、变形、出现或消失都必须在视频中看到相应的连续变化；只看到起点或终点时，只描述已见状态，不补写未完整发生的动作，也不把相对运动武断归因给主体或摄影机。不得续写最后一帧之后可能发生的事。",
    "先识别会影响视觉重建但证据不足的判断。此类判断只能进入 uncertainties；reconstructionPrompt 必须改写为所有可能解释都成立的可见共同事实，不能断言其中任一解释，也不能以互斥选项补成生成约束。确定项不得在 uncertainties 中重复。",
    "返回前逐项核对时间线中的动作主语、起止状态和转场判断：没有直接画面证据的动作删除；与 uncertainties 冲突的断言降级为可见共同事实。不要输出创作评价、方法论、品牌猜测、幕后意图、Markdown 或 JSON 以外文字。先完整写完 reconstructionPrompt；如果输出空间不足，先减少 uncertainties，再减少 tags，禁止截断主提示词。"
  ].filter(Boolean).join("\n");
}

function visualAnalysisTaxonomyPayload(catalog, locale) {
  const payload = JSON.parse(analysisTaxonomyPayload(catalog, locale));
  payload.f = (Array.isArray(payload.f) ? payload.f : []).filter((facet) => facet?.[0] !== "sound");
  return JSON.stringify(payload);
}

function parseVideoReconstruction(text, { includeTags, catalog, finishReason }) {
  const normalizedFinishReason = clean(finishReason).toLocaleLowerCase("en-US");
  if (normalizedFinishReason === "length") throw new Error("视频逆推结果被模型截断，本次没有保存");
  if (normalizedFinishReason !== "stop") throw new Error("视频逆推没有完整结束，本次没有保存");
  let value;
  try {
    value = JSON.parse(text);
  } catch {
    throw new Error("视频逆推没有返回有效 JSON，本次没有保存");
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("视频逆推返回结构无效，本次没有保存");
  }
  const expectedFields = ["reconstructionPrompt", "tags", "uncertainties"];
  const fields = Object.keys(value).toSorted();
  if (fields.length !== expectedFields.length || fields.some((field, index) => field !== expectedFields.toSorted()[index])) {
    throw new Error("视频逆推返回字段不完整，本次没有保存");
  }
  const reconstructionPrompt = cleanMultiline(value.reconstructionPrompt);
  if (!reconstructionPrompt) throw new Error("视频逆推没有返回可独立使用的提示词，本次没有保存");
  if (!Array.isArray(value.uncertainties) || value.uncertainties.some((item) => typeof item !== "string" || !cleanMultiline(item))) {
    throw new Error("视频逆推的不确定项格式无效，本次没有保存");
  }
  const uncertainties = [...new Set(value.uncertainties.map(cleanMultiline))];
  if (!Array.isArray(value.tags)) throw new Error("视频逆推的标签格式无效，本次没有保存");
  if (!includeTags) {
    if (value.tags.length) throw new Error("本次未请求 AI 标签，但服务返回了标签；结果未保存");
    return { reconstructionPrompt, tags: [], uncertainties };
  }
  if (value.tags.length < 4 || value.tags.length > 8 || value.tags.some((tag) => {
    if (!tag || typeof tag !== "object" || Array.isArray(tag)) return true;
    const keys = Object.keys(tag).toSorted();
    return keys.length !== 2 || keys[0] !== "g" || keys[1] !== "t" || !clean(tag.g) || !clean(tag.t) || clean(tag.g).startsWith("sound.");
  })) {
    throw new Error("视频逆推必须返回 4–8 个有效视觉标签，本次没有保存");
  }
  const tags = validateAnalysisTagResponse({ tags: value.tags }, catalog, { maxTags: 8 });
  if (tags.length !== value.tags.length) throw new Error("视频逆推标签包含重复或无效分类，本次没有保存");
  return { reconstructionPrompt, tags, uncertainties };
}

function normalizeChatCompletionsUsage(value = {}) {
  return {
    inputTokens: Math.max(0, Number(value.prompt_tokens ?? value.input_tokens) || 0),
    outputTokens: Math.max(0, Number(value.completion_tokens ?? value.output_tokens) || 0),
    totalTokens: Math.max(0, Number(value.total_tokens) || 0)
  };
}

function redactSecret(value, secretValue) {
  const message = clean(value);
  const secret = clean(secretValue);
  return secret ? message.split(secret).join("[已隐藏 API Key]") : message;
}

async function readJsonResponse(response, label) {
  let payload = {};
  try { payload = await response.json(); } catch {}
  if (!response.ok) {
    const error = new Error(clean(payload?.error?.message) || `${label}失败（HTTP ${response.status}）`);
    error.status = Math.max(0, Number(response.status) || 0);
    throw error;
  }
  return payload;
}

function normalizeGeminiUsage(value = {}) {
  return {
    inputTokens: Math.max(0, Number(value.promptTokenCount) || 0),
    outputTokens: Math.max(0, Number(value.candidatesTokenCount) || 0),
    totalTokens: Math.max(0, Number(value.totalTokenCount) || 0)
  };
}

function positiveInteger(value) {
  const number = Number(value);
  return Number.isSafeInteger(number) && number > 0 ? number : 0;
}

function positiveNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : 0;
}

function throwIfAborted(signal) {
  if (!signal?.aborted) return;
  if (typeof signal.throwIfAborted === "function") signal.throwIfAborted();
  throw new DOMException("The operation was aborted", "AbortError");
}

function cleanMultiline(value) {
  return String(value ?? "").replace(/\r\n?/g, "\n").replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "").trim();
}

function clean(value) {
  return String(value ?? "").replace(/[\u0000-\u001f\u007f]/g, " ").trim();
}
