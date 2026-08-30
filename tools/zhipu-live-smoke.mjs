import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import { createAiProviderModule } from "../ai-provider-module.js";
import { getAiProviderPreset } from "../ai-provider-presets.js";
import { analyzeTextDetailedWithDeepSeek } from "../deepseek.js";
import { createDefaultFacetCatalog } from "../facets.js";
import {
  aiConfigurationFromStorage,
  projectAiRuntime,
  resolveTextTaskSettings,
  resolveVideoAnalysisTask,
  resolveVisionTaskSettings
} from "../ai-runtime.js";
import { createComposerSession, normalizeComposerSettings } from "../composer.js";
import { executeComposerTurnWithService, planComposerTurnWithService } from "../composer-service.js";
import { extractCreativeSkillDraft } from "../creative-skill-service.js";
import { analyzeVideoWithChatCompletions } from "../video-analysis.js";
import { analyzeImageWithVision, createVisionRequestBudget } from "../vision.js";

const MODEL = String(process.env.PROMPTDIRECTOR_ZHIPU_MODEL ?? "glm-5.3-flash").trim();
const ALL_TASKS = ["textTags", "skillExtraction", "creativePlanning", "imageAnalysis", "videoAnalysis"];
const requestedTasks = String(process.env.PROMPTDIRECTOR_ZHIPU_TASKS ?? "").split(",").map((item) => item.trim()).filter(Boolean);
const TASKS = requestedTasks.length ? ALL_TASKS.filter((taskId) => requestedTasks.includes(taskId)) : ALL_TASKS;
if (!TASKS.length || requestedTasks.some((taskId) => !ALL_TASKS.includes(taskId))) {
  throw new Error(`PROMPTDIRECTOR_ZHIPU_TASKS 只接受：${ALL_TASKS.join(",")}`);
}
const IMAGE_URL = "https://cdn.bigmodel.cn/static/logo/register.png";
const VIDEO_URL = "https://cdn.bigmodel.cn/agent-demos/lark/113123.mov";
const USE_SYNTHETIC_LOCAL_VIDEO = process.env.PROMPTDIRECTOR_ZHIPU_SYNTHETIC_LOCAL_VIDEO === "1";
const COMPARE_COMPOSER = process.env.PROMPTDIRECTOR_ZHIPU_COMPARE_COMPOSER === "1";
const SYNTHETIC_LOCAL_VIDEO = fileURLToPath(new URL("../test/fixtures/zhipu-local-video-smoke.mp4", import.meta.url));
const apiKey = String(process.env.PROMPTDIRECTOR_ZHIPU_API_KEY ?? "").trim();

if (!apiKey) throw new Error("缺少 PROMPTDIRECTOR_ZHIPU_API_KEY；真实凭据不会从文件或默认值读取");

const preset = getAiProviderPreset("zhipu");
const provider = { ...preset, apiKey, consent: true };
const module = createAiProviderModule({ timeoutMs: 120_000 });
const receipt = {
  schema: "promptdirector-zhipu-live-smoke",
  version: 1,
  startedAt: new Date().toISOString(),
  provider: "zhipu",
  requestedModel: MODEL,
  requests: {},
  tasks: {},
  secretPersisted: false
};

try {
  const discovery = await module.discoverModels(provider);
  const model = discovery.models.find((item) => item.id === MODEL && item.status !== "unavailable");
  const providerCatalogModels = discovery.models.filter((item) => item.source.includes("provider_models"));
  receipt.discovery = {
    passed: Boolean(model),
    candidateModelCount: discovery.models.length,
    providerCatalogModelCount: providerCatalogModels.length,
    providerCatalogModelIds: providerCatalogModels.map((item) => item.id),
    requestedModelStatus: model?.status ?? "missing",
    requestedModelSource: model?.source ?? "",
    requestedModelCatalogVisible: providerCatalogModels.some((item) => item.id === MODEL),
    tasks: model?.tasks ?? [],
    inputModalities: model?.inputModalities ?? [],
    outputModalities: model?.outputModalities ?? []
  };
  if (!model && process.env.PROMPTDIRECTOR_ZHIPU_PROBE_UNLISTED === "1") {
    const response = await fetch(preset.endpoint, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 8,
        messages: [{ role: "user", content: "只回复 OK" }]
      })
    });
    receipt.requests.accessProbe = 1;
    const payload = await response.json().catch(() => ({}));
    receipt.accessProbe = {
      passed: response.ok && Boolean(payload?.choices?.[0]?.message?.content),
      status: response.status,
      model: String(payload?.model ?? MODEL),
      usage: safeUsage(payload?.usage)
    };
    if (!receipt.accessProbe.passed) {
      throw new Error(`未列出模型权限探针失败：HTTP ${response.status} ${String(payload?.error?.message ?? payload?.msg ?? "").slice(0, 300)}`);
    }
    throw new Error(`${MODEL} 虽未出现在 /models 目录，但真实调用成功；需要先修正模型发现契约再继续五项验收`);
  }
  if (!model) throw new Error(`${MODEL} 不在当前账号模型目录中，尚未执行付费请求`);

  const configuration = aiConfigurationFromStorage({
    aiProviderRegistry: {
      version: 5,
      providers: {
        zhipu: {
          apiKey,
          consent: true,
          models: Object.fromEntries(TASKS.map((taskId) => [taskId, MODEL])),
          discoveredModels: discovery.models,
          discovery: { discoveredAt: discovery.discoveredAt, source: discovery.source }
        }
      }
    },
    aiTaskAssignments: Object.fromEntries(TASKS.map((taskId) => [taskId, {
      providerId: "zhipu",
      model: MODEL,
      evidence: "declared"
    }]))
  });
  const runtime = projectAiRuntime(configuration);
  const catalog = createDefaultFacetCatalog();

  if (TASKS.includes("textTags")) await runTask("textTags", async (fetchImpl) => {
    const result = await analyzeTextDetailedWithDeepSeek({
      id: "live-text",
      title: "三秒广告钩子",
      text: "黑场中角色突然亮相，镜头快速推进，随后展示产品核心卖点。"
    }, catalog, resolveTextTaskSettings("textTags", configuration), fetchImpl, { timeoutMs: 120_000 });
    return resultFact(result, { tagCount: result.tags.length });
  });

  if (TASKS.includes("skillExtraction")) await runTask("skillExtraction", async (fetchImpl) => {
    const result = await extractCreativeSkillDraft({
      goal: "提炼前三秒广告钩子的可复用方法",
      locale: "zh-CN",
      targetType: "video",
      aiProfile: { serviceId: "zhipu", model: MODEL, thinking: false },
      sources: [{
        prompt: "黑场后主体突然出现，镜头快速推进并在三秒内呈现核心卖点。",
        analysis: "冲突建立快，主体和利益点出现顺序明确。"
      }]
    }, {
      ai: resolveTextTaskSettings("skillExtraction", configuration),
      vision: runtime.visionSettings,
      composer: normalizeComposerSettings()
    }, { fetchImpl, stream: false });
    return resultFact(result, { markdownCharacters: result.markdown.length });
  });

  if (TASKS.includes("creativePlanning")) await runTask("creativePlanning", async (fetchImpl) => {
    const session = createComposerSession({
      targetType: "video",
      routeMode: "auto",
      outputLanguage: "zh-CN",
      aiProfile: { serviceId: "zhipu", model: MODEL, thinking: false },
      messages: [{ role: "user", type: "request", content: "为新品设计一个前三秒视频广告钩子" }]
    });
    const result = await executeComposerTurnWithService({
      session,
      userMessage: "",
      composerSettings: normalizeComposerSettings(),
      route: "auto",
      instruction: "为新品设计一个前三秒视频广告钩子"
    }, { ai: runtime.aiSettings, vision: runtime.visionSettings }, [], { fetchImpl, stream: false });
    return resultFact(result, { route: result.route, kind: result.kind });
  });

  if (TASKS.includes("imageAnalysis")) await runTask("imageAnalysis", async (fetchImpl) => {
    const imageResponse = await fetch(IMAGE_URL, { redirect: "error" });
    if (!imageResponse.ok) throw new Error(`官方测试图片读取失败：HTTP ${imageResponse.status}`);
    const mimeType = String(imageResponse.headers.get("content-type") || "image/png").split(";")[0];
    const base64 = Buffer.from(await imageResponse.arrayBuffer()).toString("base64");
    const result = await analyzeImageWithVision({
      imageDataUrl: `data:${mimeType};base64,${base64}`,
      catalog,
      locale: "zh-CN",
      settings: resolveVisionTaskSettings("imageAnalysis", configuration),
      requestBudget: createVisionRequestBudget(1)
    }, fetchImpl);
    return resultFact(result, {
      reconstructionCharacters: result.reconstructionPrompt.length,
      tagCount: result.tags.length
    });
  });

  if (TASKS.includes("videoAnalysis")) await runTask("videoAnalysis", async (fetchImpl) => {
    const settings = resolveVideoAnalysisTask(configuration);
    const localVideoBytes = USE_SYNTHETIC_LOCAL_VIDEO ? await readFile(SYNTHETIC_LOCAL_VIDEO) : null;
    const result = await analyzeVideoWithChatCompletions({
      ...settings,
      ...(localVideoBytes
        ? { videoBlob: new Blob([localVideoBytes], { type: "video/mp4" }) }
        : { videoUrl: VIDEO_URL }),
      preferPublicVideoUrl: true,
      mode: "custom",
      customQuestion: "请只用一句中文概括视频内容。"
    }, { fetchImpl });
    return resultFact(result, { sourceKind: result.sourceKind, textCharacters: result.text.length });
  });

  if (COMPARE_COMPOSER) await runComposerComparison(runtime);
} catch (error) {
  receipt.fatalError = safeError(error);
}

receipt.finishedAt = new Date().toISOString();
receipt.passed = receipt.discovery?.passed === true
  && TASKS.every((taskId) => receipt.tasks[taskId]?.passed === true)
  && TASKS.every((taskId) => receipt.requests[taskId] === 1)
  && (!COMPARE_COMPOSER || receipt.composerComparison?.passed === true);
process.stdout.write(`${JSON.stringify(receipt, null, 2)}\n`);
if (!receipt.passed) process.exitCode = 1;

async function runTask(taskId, operation) {
  let calls = 0;
  const fetchImpl = async (...args) => {
    calls += 1;
    receipt.requests[taskId] = calls;
    if (calls > 1) throw new Error(`${taskId} 已阻止第二次真实模型请求`);
    return fetch(...args);
  };
  try {
    receipt.tasks[taskId] = { passed: true, ...(await operation(fetchImpl)) };
  } catch (error) {
    receipt.tasks[taskId] = { passed: false, error: safeError(error) };
  } finally {
    receipt.requests[taskId] = calls;
  }
}

async function runComposerComparison(runtime) {
  const instruction = "为一款太空采矿策略游戏生成前三秒竖屏视频广告提示词：黑场后采矿舰被陨石击中，镜头快速推进，第三秒出现可升级激光钻头；写实科幻，9:16。";
  const composerSettings = normalizeComposerSettings();
  const createSession = () => createComposerSession({
    targetType: "video",
    routeMode: "auto",
    outputLanguage: "zh-CN",
    aiProfile: { serviceId: "zhipu", model: MODEL, thinking: false },
    messages: [{ role: "user", type: "request", content: instruction }]
  });
  const settings = { ai: runtime.aiSettings, vision: runtime.visionSettings };
  const legacyRequest = countedFetch(2);
  const directRequest = countedFetch(1);
  try {
    const legacyStarted = performance.now();
    const planned = await planComposerTurnWithService({
      session: createSession(),
      userMessage: "",
      composerSettings
    }, settings, { fetchImpl: legacyRequest.fetchImpl });
    if (planned.status !== "ready") throw new Error("旧两段链路提出了澄清问题，无法完成同输入成对对照");
    let legacyFirstDelta = null;
    const legacyResult = await executeComposerTurnWithService({
      session: createSession(),
      userMessage: "",
      composerSettings,
      route: planned.route,
      instruction: planned.instruction
    }, settings, [], {
      fetchImpl: legacyRequest.fetchImpl,
      onDelta: () => { legacyFirstDelta ??= performance.now(); }
    });
    const legacyFinished = performance.now();

    const directStarted = performance.now();
    let directFirstDelta = null;
    const directResult = await executeComposerTurnWithService({
      session: createSession(),
      userMessage: "",
      composerSettings,
      route: "auto",
      instruction
    }, settings, [], {
      fetchImpl: directRequest.fetchImpl,
      onDelta: () => { directFirstDelta ??= performance.now(); }
    });
    const directFinished = performance.now();
    receipt.composerComparison = {
      passed: legacyRequest.calls() === 2 && directRequest.calls() === 1,
      legacyTwoStage: comparisonFact(legacyResult, legacyRequest.calls(), legacyStarted, legacyFirstDelta, legacyFinished, planned.usage),
      directSingleResponse: comparisonFact(directResult, directRequest.calls(), directStarted, directFirstDelta, directFinished)
    };
  } catch (error) {
    receipt.composerComparison = { passed: false, error: safeError(error) };
  }
}

function countedFetch(maximum) {
  let calls = 0;
  return {
    calls: () => calls,
    fetchImpl: (...args) => {
      calls += 1;
      if (calls > maximum) throw new Error(`创作台成对验证阻止了第 ${calls} 次额外请求`);
      return fetch(...args);
    }
  };
}

function comparisonFact(result, requests, started, firstDelta, finished, priorUsage = {}) {
  const output = String(result?.finalPrompt ?? result?.text ?? "");
  return {
    requests,
    route: result?.route,
    kind: result?.kind,
    firstDeltaMs: firstDelta === null ? null : Math.round(firstDelta - started),
    totalMs: Math.round(finished - started),
    usage: sumUsage(priorUsage, result?.usage),
    outputSha256: createHash("sha256").update(output).digest("hex")
  };
}

function sumUsage(...values) {
  const result = {};
  for (const value of values) {
    for (const [key, amount] of Object.entries(safeUsage(value))) result[key] = (result[key] || 0) + amount;
  }
  return result;
}

function resultFact(result, extra = {}) {
  const output = String(result?.markdown ?? result?.instruction ?? result?.reconstructionPrompt ?? result?.text
    ?? (Array.isArray(result?.tags) ? JSON.stringify(result.tags) : ""));
  return {
    model: String(result?.model ?? MODEL),
    outputSha256: createHash("sha256").update(output).digest("hex"),
    usage: safeUsage(result?.usage),
    ...extra
  };
}

function safeUsage(value = {}) {
  return Object.fromEntries(Object.entries(value && typeof value === "object" ? value : {})
    .filter(([, item]) => Number.isFinite(Number(item)))
    .map(([key, item]) => [key, Number(item)]));
}

function safeError(error) {
  return String(error?.message ?? error ?? "未知错误").replaceAll(apiKey, "[REDACTED]").slice(0, 800);
}
