import { normalizeVisual } from "./visuals.js";
import { normalizeMediaAsset } from "./media.js";
import { normalizeAppliedSkillSnapshots } from "./creative-skills.js";

export const CREATIVE_RUNS_VERSION = 4;
export const CREATIVE_EVALUATION_PROTOCOL_VERSION = 1;

export const CREATIVE_SIGNAL_TYPES = Object.freeze([
  "captured",
  "saved_to_library",
  "reused_as_reference",
  "continued_revision",
  "deleted"
]);

export const CREATIVE_CHECK_STATUSES = Object.freeze([
  "met",
  "partial",
  "missed",
  "conflict",
  "unknown"
]);

export function normalizeCreativeExperimentSettings(value = {}) {
  const enabled = value?.enabled === true;
  return {
    enabled,
    autoAnalyze: enabled && value?.autoAnalyze === true
  };
}

export function normalizeActiveCreativeResult(value) {
  const sessionId = clean(value?.sessionId);
  const promptVersionId = clean(value?.promptVersionId);
  if (!sessionId || !promptVersionId) return null;
  return {
    sessionId,
    promptVersionId,
    activatedAt: validIso(value?.activatedAt) || new Date().toISOString()
  };
}

export function activateCreativeResultContext(sessionValue, promptVersionId, activatedAt) {
  const sessionId = clean(sessionValue?.id);
  const versionId = clean(promptVersionId);
  if (!sessionId) throw new Error("创作草稿无效");
  if (!(sessionValue?.promptVersions ?? []).some((item) => clean(item?.id) === versionId)) {
    throw new Error("没有找到对应的提示词版本");
  }
  return normalizeActiveCreativeResult({ sessionId, promptVersionId: versionId, activatedAt });
}

export function createCreativeRun(contextValue, sessionValue, visualsValue, createdAt, generationValue) {
  const context = normalizeActiveCreativeResult(contextValue);
  if (!context || context.sessionId !== clean(sessionValue?.id)) throw new Error("本次结果与创作草稿不匹配");
  const version = (sessionValue?.promptVersions ?? []).find((item) => clean(item?.id) === context.promptVersionId);
  if (!version) throw new Error("没有找到对应的提示词版本");
  const visuals = uniqueVisuals(visualsValue);
  if (!visuals.length) throw new Error("请先选择或框选生成结果");
  const now = validIso(createdAt) || new Date().toISOString();
  const run = {
    id: globalThis.crypto.randomUUID(),
    version: CREATIVE_RUNS_VERSION,
    sessionId: context.sessionId,
    promptVersionId: context.promptVersionId,
    title: clean(version.title) || clean(sessionValue?.title),
    targetType: sessionValue?.targetType === "video" ? "video" : "image",
    targetPlatform: clean(sessionValue?.targetPlatform),
    outputLanguage: normalizeLocale(version.outputLanguage || sessionValue?.outputLanguage),
    promptText: clean(version.text),
    methodVersion: clean(version.methodVersion),
    executionInstruction: clean(version.instructionSnapshot?.instruction || sessionValue?.currentInstruction),
    retrievedSources: normalizeRetrievedSources(version.retrievedSources),
    referenceSnapshots: normalizeReferenceSnapshots(sessionValue?.referenceSnapshots),
    appliedSkills: normalizeAppliedSkillSnapshots(sessionValue?.appliedSkills),
    briefSnapshot: normalizeMessages(sessionValue?.messages),
    createdAt: now,
    updatedAt: now,
    events: [],
    outputs: visuals.map((visual) => createOutput(visual, now, generationValue))
  };
  return normalizeCreativeRun(run);
}

export function addCreativeOutput(runValue, visualValue, capturedAt, generationValue) {
  const run = requireRun(runValue);
  const visual = normalizeOutputMedia(visualValue);
  if (!visual) throw new Error("生成结果缺少有效媒体");
  if (run.outputs.some((item) => item.visual.id === visual.id)) return run;
  const now = validIso(capturedAt) || new Date().toISOString();
  run.outputs.push(createOutput(visual, now, generationValue));
  run.updatedAt = now;
  return run;
}

export function recordCreativeSignal(runValue, visualIdValue, typeValue, at) {
  const run = requireRun(runValue);
  const visualId = clean(visualIdValue);
  const type = clean(typeValue);
  if (!CREATIVE_SIGNAL_TYPES.includes(type)) throw new Error("不支持的创作结果行为类型");
  const output = run.outputs.find((item) => item.visual.id === visualId);
  if (!output) throw new Error("没有找到这张创作结果");
  output.signals.push({ type, at: validIso(at) || new Date().toISOString() });
  run.updatedAt = output.signals.at(-1).at;
  return run;
}

export function applyCreativeEvaluation(runValue, visualIdValue, evaluationValue) {
  const run = requireRun(runValue);
  const output = run.outputs.find((item) => item.visual.id === clean(visualIdValue));
  if (!output) throw new Error("没有找到这张创作结果");
  if (output.visual.kind !== "image") throw new Error("视频结果不使用图片视觉对照");
  output.evaluation = normalizeCreativeEvaluation(evaluationValue);
  run.updatedAt = output.evaluation.analyzedAt;
  return run;
}

export function updateCreativeJudgment(runValue, visualIdValue, judgmentValue, updatedAt) {
  const run = requireRun(runValue);
  const output = run.outputs.find((item) => item.visual.id === clean(visualIdValue));
  if (!output) throw new Error("没有找到这项创作结果");
  const judgment = normalizeCreativeJudgment(judgmentValue, updatedAt);
  if (judgment) output.judgment = judgment;
  else delete output.judgment;
  run.updatedAt = validIso(updatedAt) || new Date().toISOString();
  return run;
}

export function removeCreativeOutput(runValue, visualIdValue) {
  const run = requireRun(runValue);
  const visualId = clean(visualIdValue);
  const output = run.outputs.find((item) => item.visual.id === visualId);
  if (!output) throw new Error("没有找到这张创作结果");
  const at = new Date().toISOString();
  run.events.push({ visualId, type: "deleted", at });
  run.outputs = run.outputs.filter((item) => item.visual.id !== visualId);
  run.updatedAt = at;
  return run;
}

export function findCreativeOutputs(runsValue, sessionIdValue, promptVersionIdValue) {
  const sessionId = clean(sessionIdValue);
  const promptVersionId = clean(promptVersionIdValue);
  return normalizeCreativeRuns(runsValue)
    .filter((run) => run.sessionId === sessionId && run.promptVersionId === promptVersionId)
    .flatMap((run) => run.outputs.map((output) => ({ runId: run.id, ...structuredClone(output) })));
}

export function normalizeCreativeRuns(values = []) {
  const seen = new Set();
  return (Array.isArray(values) ? values : []).flatMap((value) => {
    const run = normalizeCreativeRun(value);
    if (!run || seen.has(run.id)) return [];
    seen.add(run.id);
    return [run];
  }).sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
}

export function normalizeCreativeEvaluation(value = {}) {
  const summary = clean(value?.summary);
  const resultFingerprint = clean(value?.resultFingerprint);
  if (!summary || !resultFingerprint) throw new Error("视觉对照结果不完整");
  const checks = (Array.isArray(value?.checks) ? value.checks : []).flatMap((item) => {
    const criterion = clean(item?.criterion);
    const status = clean(item?.status);
    const evidence = clean(item?.evidence);
    if (!criterion || !CREATIVE_CHECK_STATUSES.includes(status) || !evidence) return [];
    return [{ criterion, status, evidence }];
  });
  const deviation = value?.primaryDeviation;
  const criterion = clean(deviation?.criterion);
  const finding = clean(deviation?.finding);
  const suggestedChange = clean(deviation?.suggestedChange);
  const primaryDeviation = criterion && finding && suggestedChange
    ? { criterion, finding, suggestedChange }
    : null;
  return {
    protocolVersion: CREATIVE_EVALUATION_PROTOCOL_VERSION,
    resultFingerprint,
    providerType: value?.providerType === "compatible" ? "compatible" : "openai",
    model: clean(value?.model),
    analyzedAt: validIso(value?.analyzedAt) || new Date().toISOString(),
    usage: normalizeUsage(value?.usage),
    summary,
    checks,
    primaryDeviation
  };
}

function normalizeCreativeRun(value) {
  const id = clean(value?.id);
  const sessionId = clean(value?.sessionId);
  const promptVersionId = clean(value?.promptVersionId);
  const promptText = clean(value?.promptText);
  if (!id || !sessionId || !promptVersionId || !promptText) return null;
  const outputs = [];
  const seen = new Set();
  for (const item of Array.isArray(value?.outputs) ? value.outputs : []) {
    const output = normalizeOutput(item);
    if (!output || seen.has(output.visual.id)) continue;
    seen.add(output.visual.id);
    outputs.push(output);
  }
  const createdAt = validIso(value?.createdAt) || new Date().toISOString();
  return {
    id,
    version: CREATIVE_RUNS_VERSION,
    sessionId,
    promptVersionId,
    title: clean(value?.title),
    targetType: value?.targetType === "video" ? "video" : "image",
    targetPlatform: clean(value?.targetPlatform),
    outputLanguage: normalizeLocale(value?.outputLanguage),
    promptText,
    methodVersion: clean(value?.methodVersion),
    executionInstruction: clean(value?.executionInstruction),
    retrievedSources: normalizeRetrievedSources(value?.retrievedSources),
    referenceSnapshots: normalizeReferenceSnapshots(value?.referenceSnapshots),
    appliedSkills: normalizeAppliedSkillSnapshots(value?.appliedSkills),
    briefSnapshot: normalizeMessages(value?.briefSnapshot),
    createdAt,
    updatedAt: validIso(value?.updatedAt) || createdAt,
    events: (Array.isArray(value?.events) ? value.events : []).flatMap((item) => {
      const visualId = clean(item?.visualId);
      const type = clean(item?.type);
      if (!visualId || !CREATIVE_SIGNAL_TYPES.includes(type)) return [];
      return [{ visualId, type, at: validIso(item?.at) || createdAt }];
    }),
    outputs
  };
}

function requireRun(value) {
  const run = normalizeCreativeRun(value);
  if (!run) throw new Error("创作结果记录无效");
  return run;
}

function createOutput(visual, capturedAt, generationValue) {
  const output = {
    visual,
    capturedAt: validIso(capturedAt) || visual.capturedAt || new Date().toISOString(),
    signals: [{ type: "captured", at: validIso(capturedAt) || new Date().toISOString() }]
  };
  const generation = normalizeGenerationMetadata(generationValue);
  if (generation) output.generation = generation;
  return output;
}

function normalizeOutput(value) {
  const visual = normalizeOutputMedia(value?.visual);
  if (!visual) return null;
  const capturedAt = validIso(value?.capturedAt) || visual.capturedAt;
  const signals = (Array.isArray(value?.signals) ? value.signals : []).flatMap((item) => {
    const type = clean(item?.type);
    if (!CREATIVE_SIGNAL_TYPES.includes(type)) return [];
    return [{ type, at: validIso(item?.at) || capturedAt }];
  });
  const output = {
    visual,
    capturedAt,
    signals: signals.length ? signals : [{ type: "captured", at: capturedAt }]
  };
  const generation = normalizeGenerationMetadata(value?.generation);
  if (generation) output.generation = generation;
  if (value?.evaluation) {
    try {
      output.evaluation = normalizeCreativeEvaluation(value.evaluation);
    } catch {
    }
  }
  const judgment = normalizeCreativeJudgment(value?.judgment);
  if (judgment) output.judgment = judgment;
  return output;
}

function normalizeCreativeJudgment(value, updatedAt) {
  if (!value || typeof value !== "object") return null;
  const keep = clean(value.keep);
  const improve = clean(value.improve);
  if (!keep && !improve) return null;
  return {
    keep,
    improve,
    updatedAt: validIso(updatedAt) || validIso(value.updatedAt) || new Date().toISOString()
  };
}

function uniqueVisuals(values) {
  const seen = new Set();
  return (Array.isArray(values) ? values : []).flatMap((value) => {
    const visual = normalizeOutputMedia(value);
    if (!visual || seen.has(visual.id)) return [];
    seen.add(visual.id);
    return [visual];
  });
}

function normalizeOutputMedia(value) {
  if (value?.kind === "video" || String(value?.mimeType ?? "").startsWith("video/")) return normalizeMediaAsset(value);
  return normalizeVisual(value);
}

function normalizeReferenceSnapshots(values) {
  return (Array.isArray(values) ? values : []).flatMap((item) => {
    const alias = clean(item?.alias);
    const referenceText = clean(item?.referenceText);
    const imageRefs = normalizeImageRefs(item?.imageRefs);
    if (!alias || (!referenceText && !imageRefs.length)) return [];
    return [{
      alias,
      title: clean(item?.title),
      referenceKind: clean(item?.referenceKind) || "prompt",
      referenceText,
      originalText: clean(item?.originalText),
      imageRefs
    }];
  });
}

function normalizeRetrievedSources(values) {
  return (Array.isArray(values) ? values : []).flatMap((item) => {
    const alias = clean(item?.alias);
    const role = ["case", "guide"].includes(item?.role) ? item.role : "";
    const text = clean(item?.text);
    if (!alias || !role || !text) return [];
    return [{
      alias,
      title: clean(item?.title),
      role,
      referenceKind: clean(item?.referenceKind),
      text
    }];
  });
}

function normalizeImageRefs(values) {
  const seen = new Set();
  return (Array.isArray(values) ? values : []).flatMap((item) => {
    const visualId = clean(item?.visualId);
    if (!visualId || seen.has(visualId)) return [];
    seen.add(visualId);
    return [{ visualId, mimeType: clean(item?.mimeType) }];
  });
}

function normalizeGenerationMetadata(value) {
  if (!value || typeof value !== "object") return null;
  const parentVisualId = clean(value.parentVisualId);
  const editMode = ["whole", "local"].includes(value.editMode) ? value.editMode : "";
  const serviceId = ["openai", "compatible", "deepseek", "xai", "gemini", "openrouter", "minimax", "volcengine"].includes(value.serviceId) ? value.serviceId : "";
  const requestModel = clean(value.requestModel);
  const responseModel = clean(value.responseModel);
  const requestParameters = normalizeGenerationParameters(value.requestParameters);
  const modification = clean(value.modification);
  const usage = normalizeGenerationUsage(value.usage);
  const cost = Number(value.cost);
  const routing = value.routing && typeof value.routing === "object" ? {
    provider: clean(value.routing.provider),
    model: clean(value.routing.model)
  } : null;
  if (!parentVisualId && !editMode && !serviceId && !requestModel && !responseModel && !Object.keys(requestParameters).length && !modification) return null;
  return {
    ...(parentVisualId ? { parentVisualId } : {}),
    ...(editMode ? { editMode } : {}),
    ...(serviceId ? { serviceId } : {}),
    ...(requestModel ? { requestModel } : {}),
    ...(responseModel ? { responseModel } : {}),
    ...(Object.keys(requestParameters).length ? { requestParameters } : {}),
    ...(Object.keys(usage).length ? { usage } : {}),
    ...(Number.isFinite(cost) && cost >= 0 ? { cost } : {}),
    ...(routing?.provider || routing?.model ? { routing } : {}),
    ...(modification ? { modification } : {})
  };
}

function normalizeGenerationUsage(value) {
  if (!value || typeof value !== "object") return {};
  return Object.fromEntries(["promptTokens", "completionTokens", "totalTokens", "inputTokens", "outputTokens"]
    .map((key) => [key, Math.max(0, Number(value[key]) || 0)])
    .filter(([, amount]) => amount > 0));
}

function normalizeGenerationParameters(value) {
  if (!value || typeof value !== "object") return {};
  return Object.fromEntries(["size", "quality", "aspectRatio", "resolution", "duration", "motion"]
    .map((key) => [key, clean(value[key])])
    .filter(([, parameter]) => parameter));
}

function normalizeMessages(values) {
  return (Array.isArray(values) ? values : []).flatMap((item) => {
    const content = clean(item?.content);
    if (!content) return [];
    return [{
      role: item?.role === "assistant" ? "assistant" : "user",
      type: clean(item?.type) || "request",
      content
    }];
  });
}

function normalizeUsage(value) {
  if (!value || typeof value !== "object") return {};
  return Object.fromEntries(
    ["inputTokens", "outputTokens", "totalTokens"]
      .map((key) => [key, Math.max(0, Number(value[key]) || 0)])
  );
}

function normalizeLocale(value) {
  return value === "en" ? "en" : value === "zh-CN" ? "zh-CN" : "auto";
}

function validIso(value) {
  const text = clean(value);
  return text && Number.isFinite(Date.parse(text)) ? text : "";
}

function clean(value) {
  return String(value ?? "").replace(/[\u0000-\u001f\u007f]/g, "").trim();
}
