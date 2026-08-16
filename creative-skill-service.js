import { COMPOSER_INPUT_MAX_CHARACTERS, createComposerSession, normalizeComposerSettings } from "./composer.js";
import { executeComposerTurnWithService } from "./composer-service.js";
import { entryMediaAssets } from "./media.js";

export function defaultSkillExtractionInstruction(localeValue = "zh-CN") {
  return localeValue === "en"
    ? "Extract only reusable methods that serve the stated goal. Separate transferable rules from source-specific details. Preserve useful variables and decision boundaries. Do not judge completeness, score the user, or summarize unrelated commonalities. Write imperative instructions for another capable creative agent."
    : "只提取服务于目标的可复用方法，区分可迁移规律与案例专属内容，保留有用变量和判断边界。不要评价完整性，不要给用户打分，也不要总结与目标无关的共同点。用命令式写给另一个有能力的创作 Agent。";
}

export function defaultSkillVisualInstruction(localeValue = "zh-CN") {
  return localeValue === "en"
    ? "Describe reusable visual choices that serve the goal. Distinguish transferable patterns from source-specific details, do not judge completeness, and ignore contact-sheet borders and labels."
    : "描述服务于目标的可复用视觉选择，区分可迁移规律与案例专属内容，不评价完整性；忽略联系表边框和编号本身。";
}

export function buildSkillExtractionRequest(input = {}) {
  const locale = input.locale === "en" ? "en" : "zh-CN";
  const goal = clean(input.goal);
  if (!goal) throw new Error(locale === "en" ? "Describe what you want to extract" : "请先说明希望提炼什么");
  const sources = (Array.isArray(input.sources) ? input.sources : []).flatMap((source, index) => {
    const prompt = multiline(source?.prompt);
    const analysis = multiline(source?.analysis);
    return prompt || analysis ? [{ number: index + 1, prompt, analysis }] : [];
  });
  if (!sources.length) throw new Error(locale === "en" ? "The selected cases have no usable text" : "所选案例没有可用于提炼的文字资料");
  const vision = (Array.isArray(input.visualAnalyses) ? input.visualAnalyses : []).map(multiline).filter(Boolean);
  const sourceText = sources.map((source) => [
    locale === "en" ? `Source ${source.number}` : `匿名来源 ${source.number}`,
    source.prompt ? `${locale === "en" ? "Original prompt" : "原提示词"}:\n${source.prompt}` : "",
    source.analysis ? `${locale === "en" ? "Existing visual analysis" : "已有画面分析"}:\n${source.analysis}` : ""
  ].filter(Boolean).join("\n")).join("\n\n");
  const visualText = vision.length ? `\n\n${locale === "en" ? "Confirmed visual contact-sheet analyses" : "已确认的视觉联系表分析"}:\n${vision.map((item, index) => `${index + 1}. ${item}`).join("\n")}` : "";
  const extractionInstruction = multiline(input.instructionOverride) || defaultSkillExtractionInstruction(locale);
  if (locale === "en") return [
    "Create the executable Markdown body of a portable creative Skill.",
    `Extraction goal: ${goal}`,
    extractionInstruction,
    "Do not include YAML frontmatter, provenance, local identifiers, project names, URLs, or claims about unseen images.",
    sourceText + visualText
  ].join("\n\n");
  return [
    "请生成一份可移植创作 Skill 的可执行 Markdown 正文。",
    `本次提炼目标：${goal}`,
    extractionInstruction,
    "不要输出 YAML frontmatter、来源证据、本地编号、项目名、网址，也不要声称看过未提供的图片。",
    sourceText + visualText
  ].join("\n\n");
}

export const SKILL_EXTRACTION_BATCH_TARGET_CHARACTERS = Math.floor(COMPOSER_INPUT_MAX_CHARACTERS * 0.45);

export function skillExtractionWorkload(input = {}) {
  const sources = normalizeSkillSources(input.sources);
  const batches = partitionSkillSources(sources, input.maxBatchCharacters);
  const textCharacters = sources.reduce((sum, source) => sum + source.prompt.length + source.analysis.length, 0);
  return {
    sourceCount: sources.length,
    textCharacters,
    batches,
    textBatchCount: batches.length,
    synthesisRequestCount: batches.length > 1 ? 1 : 0,
    requestCount: batches.length + (batches.length > 1 ? 1 : 0),
    overSingleRequest: batches.length > 1,
    tokenEstimate: estimateSkillTokens([
      clean(input.goal),
      multiline(input.instructionOverride) || defaultSkillExtractionInstruction(input.locale),
      ...sources.flatMap((source) => [source.prompt, source.analysis])
    ].join("\n"))
  };
}

export function estimateSkillTokens(value = "") {
  const text = String(value ?? "");
  const cjk = (text.match(/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/gu) ?? []).length;
  const other = text.replace(/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}\s]/gu, "").length;
  return {
    min: cjk + Math.ceil(other / 4),
    max: cjk * 2 + Math.ceil(other / 2),
    kind: "local-range"
  };
}

export async function extractCreativeSkillDraftBatched(input = {}, settingsValue = {}, options = {}) {
  const workload = skillExtractionWorkload(input);
  if (!workload.batches.length) return extractCreativeSkillDraft(input, settingsValue, options);
  const partials = [];
  let usage = {};
  let lastModel = "";
  for (const [index, sources] of workload.batches.entries()) {
    options.onProgress?.({ phase: "text-batch", current: index + 1, total: workload.batches.length });
    const result = await extractCreativeSkillDraft({ ...input, sources }, settingsValue, options);
    partials.push(result.markdown);
    lastModel = result.model;
    usage = addUsage(usage, result.usage);
  }
  if (partials.length === 1) return { ...skillDraftMetadata(partials[0], input.goal), markdown: partials[0], usage, model: lastModel };
  options.onProgress?.({ phase: "synthesis", current: 1, total: 1 });
  const synthesized = await extractCreativeSkillDraft({
    ...input,
    sources: partials.map((markdown) => ({ prompt: markdown, analysis: "" })),
    visualAnalyses: [],
    goal: input.locale === "en"
      ? `${clean(input.goal)}. The following intermediate drafts cover the complete source set. Merge repeated rules, retain useful differences and boundaries, and produce one executable method.`
      : `${clean(input.goal)}。以下内容是完整来源经分批提炼得到的中间草稿；合并重复规则、保留有用差异与边界，形成一份统一可执行方法。`
  }, settingsValue, options);
  return { ...synthesized, usage: addUsage(usage, synthesized.usage) };
}

export async function extractCreativeSkillDraft(input = {}, settingsValue = {}, options = {}) {
  const request = buildSkillExtractionRequest(input);
  const composerSettings = normalizeComposerSettings(settingsValue.composer);
  const session = createComposerSession({
    targetType: input.targetType === "video" ? "video" : "image",
    outputLanguage: input.locale === "en" ? "en" : "zh-CN",
    routeMode: "chat",
    aiProfile: input.aiProfile ?? composerSettings.lastAiProfile,
    productionReviewEnabled: false
  });
  const result = await executeComposerTurnWithService({
    session,
    userMessage: request,
    route: "chat",
    instruction: request,
    composerSettings
  }, { ai: settingsValue.ai, vision: settingsValue.vision }, [], options);
  const markdown = stripFence(result.text);
  if (!markdown) throw new Error("模型没有返回可编辑的 Skill 草稿");
  return { ...skillDraftMetadata(markdown, input.goal), markdown, usage: result.usage, model: result.model };
}

export async function analyzeCreativeSkillVisualBatch(input = {}, settingsValue = {}, options = {}) {
  const locale = input.locale === "en" ? "en" : "zh-CN";
  const goal = clean(input.goal);
  const dataUrl = String(input.dataUrl ?? "").trim();
  if (!goal || !dataUrl.startsWith("data:image/")) throw new Error(locale === "en" ? "The visual batch is incomplete" : "视觉批次数据不完整");
  const labels = (Array.isArray(input.items) ? input.items : []).map((item) =>
    `C${Math.max(1, Number(item.caseNumber) || 1)}.${Math.max(1, Number(item.imageNumber) || 1)}`
  ).join(", ");
  const instruction = multiline(input.instructionOverride) || defaultSkillVisualInstruction(locale);
  const request = locale === "en"
    ? `Analyze only the visible creative content for this Skill extraction goal: ${goal}. Labels ${labels || "C1.1"} preserve case and image order. ${instruction}`
    : `只围绕这个 Skill 提炼目标分析可见创作内容：${goal}。标记 ${labels || "C1.1"} 用于保留案例归属和图片顺序。${instruction}`;
  const composerSettings = normalizeComposerSettings(settingsValue.composer);
  const profile = input.aiProfile;
  if (!profile || profile.serviceId === "deepseek") throw new Error(locale === "en" ? "Select a configured vision model" : "请先配置并选择视觉能力模型");
  const visualId = `skill-contact-sheet:${crypto.randomUUID()}`;
  const session = createComposerSession({
    targetType: "image",
    outputLanguage: locale,
    routeMode: "chat",
    aiProfile: profile,
    productionReviewEnabled: false,
    referenceSnapshots: [{
      entryId: visualId,
      alias: "@VISUAL",
      referenceKind: "vision",
      referenceText: request,
      imageRefs: [{ visualId, mimeType: String(input.mimeType ?? "image/jpeg") }]
    }]
  });
  const result = await executeComposerTurnWithService({
    session,
    userMessage: request,
    route: "chat",
    instruction: request,
    composerSettings
  }, { ai: settingsValue.ai, vision: settingsValue.vision }, [{ visualId, dataUrl }], options);
  const description = multiline(result.text);
  if (!description) throw new Error(locale === "en" ? "The vision model returned no usable analysis" : "视觉模型没有返回可用分析");
  return { description, usage: result.usage, model: result.model };
}

export function anonymousSkillSources(entriesValue = [], selectionsValue = [], options = {}) {
  const selections = normalizeSourceSelections(selectionsValue);
  const documents = options.documentTextByAsset instanceof Map ? options.documentTextByAsset : new Map();
  return (Array.isArray(entriesValue) ? entriesValue : []).flatMap((entry) => {
    const selection = selections.get(String(entry?.id ?? ""));
    if (!selection) return [];
    const selectedAssets = entryMediaAssets(entry).filter((asset) => selection.assetIds === null || selection.assetIds.has(String(asset.id)));
    const mediaPrompts = new Map((Array.isArray(entry?.mediaPrompts) ? entry.mediaPrompts : [])
      .map((item) => [String(item?.assetId ?? ""), multiline(item?.text)]));
    const prompt = [
      selection.includeEntryText ? multiline(entry?.text) : "",
      ...selectedAssets.map((asset) => mediaPrompts.get(String(asset.id)) || ""),
      ...selectedAssets.filter((asset) => asset.kind === "document").map((asset) => multiline(documents.get(String(asset.id))))
    ].filter(Boolean).join("\n\n");
    const selectedIds = new Set(selectedAssets.map((asset) => String(asset.id)));
    const analysis = [
      ...selectedAssets.filter((asset) => !asset?.visionAnalysis?.invalidated)
        .map((asset) => multiline(asset?.visionAnalysis?.description)),
      ...(Array.isArray(entry?.timeNotes) ? entry.timeNotes : [])
        .filter((note) => selectedIds.has(String(note?.assetId ?? ""))).map((note) => multiline(note?.text)),
      ...(Array.isArray(entry?.videoAnalyses) ? entry.videoAnalyses : [])
        .filter((item) => selectedIds.has(String(item?.assetId ?? ""))).map((item) => multiline(item?.description || item?.summary || item?.text))
    ].filter(Boolean).join("\n");
    return prompt || analysis ? [{ prompt, analysis }] : [];
  });
}

function normalizeSourceSelections(values) {
  const source = Array.isArray(values) ? values : [];
  if (source.every((item) => typeof item === "string" || typeof item === "number")) {
    return new Map(source.map((entryId) => [String(entryId), { includeEntryText: true, assetIds: null }]));
  }
  return new Map(source.flatMap((selection) => {
    const entryId = clean(selection?.entryId);
    if (!entryId) return [];
    return [[entryId, {
      includeEntryText: selection?.includeEntryText !== false,
      assetIds: new Set((Array.isArray(selection?.assetIds) ? selection.assetIds : []).map(String))
    }]];
  }));
}

function skillDraftMetadata(markdown, goalValue) {
  const heading = String(markdown ?? "").match(/^#\s+(.+)$/mu)?.[1]?.trim() || "";
  return {
    callName: heading.slice(0, 80),
    description: clean(goalValue).slice(0, 240)
  };
}

export function creativeRunEvidenceCandidates(runsValue = [], skillIdValue = "") {
  const skillId = clean(skillIdValue);
  return (Array.isArray(runsValue) ? runsValue : []).flatMap((run) => {
    const usedSkill = (Array.isArray(run?.appliedSkills) ? run.appliedSkills : [])
      .some((skill) => clean(skill?.skillId) === skillId);
    if (!skillId || !usedSkill) return [];
    return (Array.isArray(run?.outputs) ? run.outputs : []).flatMap((output) => {
      const keep = multiline(output?.judgment?.keep);
      const improve = multiline(output?.judgment?.improve);
      const visualId = clean(output?.visual?.id);
      if (!visualId || (!keep && !improve)) return [];
      return [{
        id: `${clean(run.id)}:${visualId}`,
        runId: clean(run.id),
        visualId,
        title: clean(run.title) || clean(run.promptText).slice(0, 80),
        prompt: multiline(run.promptText),
        keep,
        improve,
        capturedAt: clean(output.capturedAt || run.createdAt)
      }];
    });
  });
}

export function selectedCreativeRunEvidenceSources(runsValue = [], evidenceIdsValue = [], skillIdValue = "") {
  const selected = new Set((Array.isArray(evidenceIdsValue) ? evidenceIdsValue : []).map(clean));
  return creativeRunEvidenceCandidates(runsValue, skillIdValue)
    .filter((item) => selected.has(item.id))
    .map((item) => ({
      prompt: item.prompt,
      analysis: [
        item.keep ? `值得保留：${item.keep}` : "",
        item.improve ? `需要改进：${item.improve}` : ""
      ].filter(Boolean).join("\n")
    }));
}

function stripFence(value) {
  return multiline(value).replace(/^```(?:markdown|md)?\s*/i, "").replace(/\s*```$/, "").trim();
}

function normalizeSkillSources(values) {
  return (Array.isArray(values) ? values : []).flatMap((source) => {
    const prompt = multiline(source?.prompt);
    const analysis = multiline(source?.analysis);
    return prompt || analysis ? [{ prompt, analysis }] : [];
  });
}

function partitionSkillSources(values, maxCharactersValue) {
  const maxCharacters = Math.max(10_000, Math.min(COMPOSER_INPUT_MAX_CHARACTERS, Math.floor(Number(maxCharactersValue) || SKILL_EXTRACTION_BATCH_TARGET_CHARACTERS)));
  const fragments = values.flatMap((source) => splitSkillSource(source, maxCharacters));
  const batches = [];
  let current = [];
  let characters = 0;
  for (const source of fragments) {
    const size = source.prompt.length + source.analysis.length;
    if (current.length && characters + size > maxCharacters) {
      batches.push(current);
      current = [];
      characters = 0;
    }
    current.push(source);
    characters += size;
  }
  if (current.length) batches.push(current);
  return batches;
}

function splitSkillSource(source, maxCharacters) {
  if (source.prompt.length + source.analysis.length <= maxCharacters) return [source];
  const chunks = [];
  for (let offset = 0; offset < source.prompt.length; offset += maxCharacters) {
    chunks.push({ prompt: source.prompt.slice(offset, offset + maxCharacters), analysis: "" });
  }
  for (let offset = 0; offset < source.analysis.length; offset += maxCharacters) {
    chunks.push({ prompt: "", analysis: source.analysis.slice(offset, offset + maxCharacters) });
  }
  return chunks;
}

function addUsage(left = {}, right = {}) {
  const keys = new Set([...Object.keys(left || {}), ...Object.keys(right || {})]);
  return Object.fromEntries([...keys].map((key) => [key, (Number(left?.[key]) || 0) + (Number(right?.[key]) || 0)]));
}

function multiline(value) {
  return String(value ?? "").replace(/\r\n?/g, "\n").trim();
}

function clean(value) {
  return multiline(value).replace(/\s+/g, " ");
}
