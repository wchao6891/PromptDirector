import {
  CONTENT_ROLES,
  contentTypeForRole,
  createDefaultTaxonomy,
  isValidContentPath
} from "./taxonomy.js";
import { entryHasMedia, normalizeEntryMedia } from "./media.js";
import { entryHasVisual } from "./visuals.js";

export const CLASSIFIER_VERSION = 4;

const WEIGHT = Object.freeze({ weak: 1, supporting: 2, format: 3, strong: 4, modelBody: 5, decisive: 6 });
const THRESHOLD = Object.freeze({ tutorial: 6, tutorialTie: 8, videoPrompt: 4, imagePrompt: 5, imageCaseText: 360 });

const SIGNALS = Object.freeze({
  tutorialWrapper: /(?:教程|攻略|教学|如何|方法|步骤|第一步|第二步|然后|最后|参数说明|注意事项|\b(?:tutorial|guide|how to|step-by-step)\b)/i,
  tutorialMeta: /(?:原理|结构|框架|工作流|流程|技巧|策略|方法论|为什么|解析|拆解|指南|入门|介绍|概念|定义|特征|特点|叙事节奏|视觉重心|歧义|多义词|替代表达|\b(?:workflow|principles?|framework|structure|method|technique|tips?|why|explains?|showing how|breakdown|best practices?|ambiguous|multiple meanings?|cleaner alternative|wording change)\b)/i,
  tutorialSequence: /(?:第一步[\s\S]{0,160}(?:第二步|然后|最后)|\bfirst\b[\s\S]{0,160}\b(?:then|next|finally)\b|\b(?:once|after)\b[\s\S]{0,120}\b(?:use|upload|generate|create)\b|\bfinal step\b)/i,
  transferable: /(?:通用|普适|适用于|可复用|不同模型|不同场景|身份漂移|\b(?:reusable|transferable|across different|different (?:models|scenes|subjects)|applies to|identity drift|most creators)\b)/i,
  styleDefinition: /(?:风格(?:是|指|以|通常|具有|特点)|\b(?:style|aesthetic) (?:is|typically|often|generally)|\b(?:is|are) (?:a|an) (?:popular |distinctive |clean |visual |artistic |cinematic )?(?:style|aesthetic|technique)|\b(?:known for|characterized by|used to describe|refers to)\b)/i,
  styleCatalog: /(?:风格库|样式库|\b(?:styles? buoy|style library|style catalog)\b)/i,
  explanatory: /(?:原因|意味着|决定|导致|有助于|区别|误读|错误理解|\b(?:because|which causes?|that(?:'s| is) where|what makes|matters|means that|determines?|prevents?|avoids?|this helps|hope this helps|misreads?|wrong one)\b)/i,
  teachingContrast: /(?:如果[\s\S]{0,160}(?:结果|效果|变化)|\bif you\b[\s\S]{0,160}\b(?:result|effect|change|becomes?)\b)/i,
  promptLabel: /(?:提示词|\bprompt(?:ed|ing|s)?\b|--ar\b|negative prompt)/i,
  directInstruction: /^(?:\s*["“])?\s*(?:(?:\[|【)[^\]】]+(?:\]|】)|create|generate|transform|make|use the attached|use the provided|depict|render|保持|使用|创建|生成|将|把)/i,
  structuredPrompt: /(?:^|\n|[。.!?]\s+)(?:prompt|提示词|主体|角色|场景|镜头|风格|构图|光线|摄影机|character sheet|camera|scene|subject|style|lighting|composition|action|format|negative prompt)\s*[:：]/im,
  videoTimeline: /(?:\b\d+(?:\.\d+)?\s*[-–~至]\s*\d+(?:\.\d+)?\s*(?:s|秒)\b|\b\d+(?:\.\d+)?\s*(?:s|秒)\s*[:：])/i,
  videoDuration: /(?:\b\d+(?:\.\d+)?\s*(?:seconds?|secs?)\b|\d+(?:\.\d+)?\s*秒)/i,
  videoModel: /(?:视频|生视频|图生视频|文生视频|概念片|動画|映像|\b(?:video|seedance|kling|sora|veo|runway|luma)\b)/i,
  videoMotion: /(?:镜头运动|运镜|跟拍|推镜|拉镜|摇镜|移镜|升格|慢动作|逐帧|连续镜头|转场|\b(?:single continuous|continuous shot|camera (?:tracks?|moves?|follows?|circles?|pushes?|pulls?|pans?|tilts?|races?|plunges?)|dolly|pan shot|tracking shot|slow motion|frame-by-frame|frames? per second|fps|transition|sequence)\b)/i,
  imageModel: /(?:图片|图像|生图|文生图|图生图|\b(?:gpt[ -]?image|image prompt|midjourney|stable diffusion|flux|seedream|dall-e)\b)/i,
  imageArtifact: /(?:角色设定图|角色表|分镜图|参考图|\b(?:character|design|reference) sheet\b|\bstoryboard\b)/i,
  imageFormat: /(?:静帧|画幅|摄影图|肖像|构图|妆容|摄影|插画|绘画|\b(?:still image|portrait|photograph|photography|photo|painting|illustration|rendering|composition|aspect ratio)\b|--ar\b|negative prompt)/i
});

export function classifyContent(entry = {}, rules = [], taxonomy = createDefaultTaxonomy()) {
  const existing = normalizeExistingClassification(entry.classification, taxonomy);
  if (existing && existing.status === "confirmed" && ["manual", "local_import"].includes(existing.source)) {
    return existing;
  }

  const hostname = hostnameFor(entry.url);
  const sourceRule = (Array.isArray(rules) ? rules : []).find(
    (rule) => rule?.enabled !== false && rule.hostname === hostname && validPath(taxonomy, rule.pathIds)
  );
  if (sourceRule) {
    return classification(sourceRule.pathIds, "confirmed", "source_rule", "来源规则");
  }

  const body = String(entry.text ?? "");
  const title = String(entry.title ?? "");
  const url = String(entry.url ?? "");
  const promptScore = scorePromptShape(body, title);
  const tutorialScore = scoreTutorial(body, title, url);
  const videoScore = scoreMedium(body, title, url, "video");
  const imageScore = scoreMedium(body, title, url, "image");
  const medium = chooseMedium(videoScore, imageScore, SIGNALS.videoTimeline.test(body));

  if (tutorialScore >= THRESHOLD.tutorial &&
    (tutorialScore > promptScore || (tutorialScore >= THRESHOLD.tutorialTie && tutorialScore === promptScore))) {
    return classificationForRole(taxonomy, CONTENT_ROLES.tutorial, "存在可迁移的教学或风格元信息");
  }

  if (medium === "video" && (promptScore >= WEIGHT.supporting || videoScore >= THRESHOLD.videoPrompt)) {
    return classificationForRole(taxonomy, CONTENT_ROLES.promptVideo, "具体视频生成指令");
  }
  if (medium === "image" && (promptScore >= WEIGHT.supporting || imageScore >= THRESHOLD.imagePrompt)) {
    return classificationForRole(taxonomy, CONTENT_ROLES.promptImage, "具体图片生成指令");
  }
  if (entryHasMedia(entry, "document") || entry.sourceKind === "quick_note") {
    return classificationForRole(taxonomy, CONTENT_ROLES.reference, "本地文档或创作笔记");
  }
  if (entryHasVisual(entry) && body.trim().length <= THRESHOLD.imageCaseText) {
    return classificationForRole(taxonomy, CONTENT_ROLES.imageCase, "短文字配图默认作为可编辑图片案例");
  }
  return classification([], "needs_review", "auto", "证据不足，等待人工确认");
}

export function classifyImportedMedia(entry = {}, taxonomy = createDefaultTaxonomy()) {
  const existing = normalizeExistingClassification(entry.classification, taxonomy);
  if (existing?.status === "confirmed" && existing.source === "manual") return existing;
  if (entry.sourceKind === "quick_note") {
    return classificationForRole(taxonomy, CONTENT_ROLES.reference, "快速笔记按资料形态归类", "local_import");
  }
  const kinds = new Set(normalizeEntryMedia(entry).mediaAssets
    .filter((asset) => asset.usage !== "poster")
    .map((asset) => asset.kind));
  if (kinds.has("video")) {
    return classificationForRole(taxonomy, CONTENT_ROLES.videoCase, "本机视频按文件形态归类", "local_import");
  }
  if (kinds.has("image")) {
    return classificationForRole(taxonomy, CONTENT_ROLES.imageCase, "本机图片按文件形态归类", "local_import");
  }
  if (kinds.has("document")) {
    return classificationForRole(taxonomy, CONTENT_ROLES.reference, "本机文档按文件形态归类", "local_import");
  }
  return classification([], "needs_review", "local_import", "无法识别本机资料形态");
}

export function confirmClassification(entry, pathIds, taxonomy = createDefaultTaxonomy()) {
  if (!validPath(taxonomy, pathIds)) throw new Error("内容分类路径无效");
  return {
    ...entry,
    classification: classification(pathIds, "confirmed", "manual", "人工确认")
  };
}

export function classifyImageCase(taxonomy = createDefaultTaxonomy()) {
  const target = contentTypeForRole(taxonomy, CONTENT_ROLES.imageCase);
  return target
    ? classification([target.id], "confirmed", "manual", "只保存截图的图片案例")
    : classification([], "needs_review", "auto", "没有可用的图片资料分类");
}

export function createSourceRule(url, pathIds, taxonomy = createDefaultTaxonomy()) {
  const hostname = hostnameFor(url);
  if (!hostname || !validPath(taxonomy, pathIds)) throw new Error("无法创建来源分类规则");
  return { hostname, pathIds: [...pathIds], enabled: true };
}

function scorePromptShape(body, title) {
  let score = 0;
  if (SIGNALS.promptLabel.test(body)) score += WEIGHT.format;
  if (SIGNALS.promptLabel.test(title)) score += WEIGHT.supporting;
  if (SIGNALS.directInstruction.test(body)) score += WEIGHT.strong;
  if (SIGNALS.structuredPrompt.test(body)) score += WEIGHT.format;
  if (SIGNALS.videoTimeline.test(body)) score += WEIGHT.format;
  return score;
}

function scoreTutorial(body, title, url) {
  let score = 0;
  if (SIGNALS.styleDefinition.test(body)) score += WEIGHT.decisive;
  if (SIGNALS.styleCatalog.test(title) || SIGNALS.styleCatalog.test(url) || /\/styles?\//i.test(url)) {
    score += WEIGHT.decisive;
  }
  if (SIGNALS.tutorialMeta.test(body)) score += WEIGHT.supporting;
  if (SIGNALS.tutorialMeta.test(title)) score += WEIGHT.weak;
  if (SIGNALS.tutorialSequence.test(body)) score += WEIGHT.strong;
  if (SIGNALS.transferable.test(body)) score += WEIGHT.strong;
  if (SIGNALS.explanatory.test(body)) score += WEIGHT.supporting;
  if (SIGNALS.explanatory.test(title)) score += WEIGHT.weak;
  if (SIGNALS.teachingContrast.test(body)) score += WEIGHT.strong;
  if (SIGNALS.tutorialWrapper.test(body)) score += WEIGHT.supporting;
  if (SIGNALS.tutorialWrapper.test(title)) score += WEIGHT.weak;
  return score;
}

function scoreMedium(body, title, url, medium) {
  if (medium === "video") {
    return (SIGNALS.videoModel.test(body) ? WEIGHT.modelBody : 0) +
      (SIGNALS.videoModel.test(title) ? WEIGHT.supporting : 0) +
      (SIGNALS.videoModel.test(url) ? WEIGHT.weak : 0) +
      (SIGNALS.videoMotion.test(body) ? WEIGHT.strong : 0) +
      (SIGNALS.videoDuration.test(body) ? WEIGHT.format : 0) +
      (SIGNALS.videoTimeline.test(body) ? WEIGHT.modelBody : 0);
  }
  return (SIGNALS.imageModel.test(body) ? WEIGHT.modelBody : 0) +
    (SIGNALS.imageModel.test(title) ? WEIGHT.supporting : 0) +
    (SIGNALS.imageModel.test(url) ? WEIGHT.weak : 0) +
    (SIGNALS.imageArtifact.test(body) ? WEIGHT.format : 0) +
    (SIGNALS.imageFormat.test(body) ? WEIGHT.format : 0);
}

function chooseMedium(videoScore, imageScore, hasTimeline) {
  if (hasTimeline && videoScore >= imageScore) return "video";
  if (videoScore >= WEIGHT.supporting && videoScore > imageScore) return "video";
  if (imageScore >= WEIGHT.supporting && imageScore > videoScore) return "image";
  return null;
}

function classification(pathIds, status, source, reason) {
  return {
    pathIds: [...pathIds],
    status,
    source,
    reason,
    classifierVersion: CLASSIFIER_VERSION
  };
}

function normalizeExistingClassification(value, taxonomy) {
  if (!value || !validPath(taxonomy, value.pathIds)) return null;
  return classification(
    value.pathIds,
    value.status === "needs_review" ? "needs_review" : "confirmed",
    ["auto", "manual", "source_rule", "local_import"].includes(value.source) ? value.source : "auto",
    String(value.reason ?? "")
  );
}

function validPath(taxonomy, pathIds) {
  return isValidContentPath(taxonomy, pathIds);
}

function classificationForRole(taxonomy, role, reason, source = "auto") {
  const target = contentTypeForRole(taxonomy, role);
  return target
    ? classification([target.id], "confirmed", source, reason)
    : classification([], "needs_review", source, "没有匹配当前内容用途的分类");
}

function hostnameFor(value) {
  try {
    return new URL(String(value ?? "")).hostname.toLocaleLowerCase("en-US");
  } catch {
    return "";
  }
}
