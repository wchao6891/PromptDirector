import { CONTENT_ROLES, contentRoleForEntry } from "./taxonomy.js";
import { normalizeAppliedSkillSnapshots } from "./creative-skills.js";
import { primaryVisionDescription } from "./visuals.js";
import { currentVideoReconstruction, entryMediaAssets } from "./media.js";
import { TEMP_REFERENCE_SOURCE_TYPES } from "./temp-references.js";
import { normalizeLocalRelativePath } from "./local-media.js";
import {
  hasCompleteReferenceAnalysis,
  referenceHasPromptText,
  referenceHasUsableLegacyDescription
} from "./reference-readiness.js";
import { validReconstructionPrompt } from "./image-prompt.js";
import { AI_PROVIDER_PRESETS } from "./ai-provider-presets.js";
import { createComposerActiveTurn } from "./composer-active-turn.js";
import {
  COMPOSER_AGENT_VERSION,
  AGENT_ROUTES,
  DEFAULT_AGENT_INSTRUCTION,
  DEFAULT_TASK_METHODS,
  LIBRARY_CONTENT_ROLES,
  normalizeComposerAgentSettings,
  normalizeAgentRoute,
  normalizePlannerResult,
  resetAgentInstruction,
  resetAgentTaskMethod,
  taskKeyForRoute,
  taskMethodFor,
  updateAgentInstruction,
  updateAgentTaskMethod
} from "./composer-agent.js";

export const COMPOSER_METHOD_VERSION = COMPOSER_AGENT_VERSION;
export const COMPOSER_AI_MODELS = Object.freeze(["deepseek-v4-flash", "deepseek-v4-pro"]);
export const COMPOSER_SERVICE_IDS = Object.freeze([
  ...AI_PROVIDER_PRESETS
    .filter((preset) => preset.capabilities.some((taskId) => ["creativePlanning", "imageGeneration", "videoGeneration"].includes(taskId)))
    .map((preset) => preset.id),
  "compatible"
]);
export const DEFAULT_COMPOSER_AI_PROFILE = Object.freeze({ serviceId: "deepseek", model: "deepseek-v4-flash", thinking: false });
export const UNASSIGNED_COMPOSER_AI_PROFILE = Object.freeze({ serviceId: "unassigned", model: "", thinking: false });
export const COMPOSER_INPUT_MAX_CHARACTERS = 750_000;
const COMPOSER_REQUEST_MAX_CHARACTERS = 775_000;
export { DEFAULT_AGENT_INSTRUCTION, DEFAULT_TASK_METHODS, normalizePlannerResult };

export function normalizeComposerSettings(value = {}) {
  const agent = normalizeComposerAgentSettings(value);
  return {
    ...agent,
    methodVersion: COMPOSER_METHOD_VERSION,
    outputLanguage: ["auto", "zh-CN", "en"].includes(value.outputLanguage) ? value.outputLanguage : "auto",
    lastTargetPlatform: String(value.lastTargetPlatform ?? "").trim(),
    lastAiProfile: normalizeComposerAiProfile(value.lastAiProfile),
    productionReviewEnabled: value.productionReviewEnabled !== false
  };
}

export function normalizeComposerAiProfile(value = {}) {
  const requestedServiceId = String(value?.serviceId ?? "").trim();
  if (requestedServiceId === UNASSIGNED_COMPOSER_AI_PROFILE.serviceId) return { ...UNASSIGNED_COMPOSER_AI_PROFILE };
  const serviceId = requestedServiceId && COMPOSER_SERVICE_IDS.includes(requestedServiceId)
    ? requestedServiceId
    : "deepseek";
  const requestedModel = String(value?.model ?? "").trim();
  return {
    serviceId,
    model: requestedServiceId && !COMPOSER_SERVICE_IDS.includes(requestedServiceId)
      ? DEFAULT_COMPOSER_AI_PROFILE.model
      : requestedModel || (serviceId === "deepseek" ? DEFAULT_COMPOSER_AI_PROFILE.model : ""),
    thinking: value?.thinking === true
  };
}

export function composerProfileForTaskAssignment(assignmentValue = {}, fallbackValue = {}) {
  const providerId = String(assignmentValue?.providerId ?? "").trim();
  const model = String(assignmentValue?.model ?? "").trim();
  if (!providerId || !model) return { ...UNASSIGNED_COMPOSER_AI_PROFILE };
  const serviceId = providerId === "custom-media" ? "compatible" : providerId;
  if (!COMPOSER_SERVICE_IDS.includes(serviceId)) return { ...UNASSIGNED_COMPOSER_AI_PROFILE };
  return normalizeComposerAiProfile({
    serviceId,
    model,
    thinking: fallbackValue?.thinking === true
  });
}

export function updateComposerMethod(settingsValue, { targetType, locale, text }) {
  return updateComposerTaskMethod(settingsValue, { taskKey: `compose.${targetType === "video" ? "video" : "image"}`, text, locale });
}

export function resetComposerMethod(settingsValue, targetType, locale) {
  return resetComposerTaskMethod(settingsValue, `compose.${targetType === "video" ? "video" : "image"}`, locale);
}

export function updateComposerAgentInstruction(settingsValue, text) {
  const settings = normalizeComposerSettings(settingsValue);
  return normalizeComposerSettings({ ...settings, ...updateAgentInstruction(settings, text) });
}

export function resetComposerAgentInstruction(settingsValue) {
  const settings = normalizeComposerSettings(settingsValue);
  return normalizeComposerSettings({ ...settings, ...resetAgentInstruction(settings) });
}

export function updateComposerTaskMethod(settingsValue, { taskKey, text }) {
  const settings = normalizeComposerSettings(settingsValue);
  return normalizeComposerSettings({ ...settings, ...updateAgentTaskMethod(settings, taskKey, text) });
}

export function resetComposerTaskMethod(settingsValue, taskKey) {
  const settings = normalizeComposerSettings(settingsValue);
  return normalizeComposerSettings({ ...settings, ...resetAgentTaskMethod(settings, taskKey) });
}

export function isComposerEligibleEntry(entry, targetType = "") {
  if (Array.isArray(entry?.memberEntries)) {
    return Boolean(referenceTextForEntry(entry, targetType) || imageRefsForEntry(entry).length);
  }
  if (targetType === "video" && entryMediaAssets(entry).some((asset) =>
    asset.kind === "video" && referenceSourcePartsForAsset(entry, asset.id).length
  )) return true;
  const contentRole = contentRoleForEntry(entry);
  if (![CONTENT_ROLES.promptImage, CONTENT_ROLES.promptVideo, CONTENT_ROLES.imageCase, CONTENT_ROLES.reference].includes(contentRole)) return false;
  return Boolean(String(entry?.text ?? "").trim() || imageRefsForEntry(entry).length);
}

export function createReferenceSnapshots(entries, entryIds, locale = "zh-CN", targetType = "") {
  const byId = new Map((Array.isArray(entries) ? entries : []).map((entry) => [entry.id, entry]));
  const snapshots = [];
  const selections = (Array.isArray(entryIds) ? entryIds : []).flatMap((selectionValue) => {
    const selection = normalizeReferenceSelection(selectionValue);
    const entry = byId.get(selection.entryId);
    if (!Array.isArray(entry?.memberEntries) && selection.assetIds.length > 1) {
      return selection.assetIds.map((assetId) => ({ ...selection, assetIds: [assetId] }));
    }
    return [selection];
  });
  for (const selectionValue of selections) {
    const selection = normalizeReferenceSelection(selectionValue);
    const entryId = selection.entryId;
    const entry = byId.get(entryId);
    if (!isComposerEligibleEntry(entry, targetType)) continue;
    if (Array.isArray(entry.memberEntries)) {
      const referenceText = referenceTextForEntry(entry, targetType);
      const originalText = originalReferenceTextForEntry(entry, targetType);
      snapshots.push({
        referenceId: referenceSnapshotId(entry.id, ""),
        entryId: entry.id,
        assetId: "",
        alias: locale === "en" ? `@Reference${snapshots.length + 1}` : `@参考${snapshots.length + 1}`,
        title: String(entry.title ?? "").trim(),
        referenceKind: "prompt",
        referenceText,
        originalText,
        scope: selection.assetIds.length ? "asset" : "case",
        imageRefs: imageRefsForEntry(entry, selection.assetIds)
      });
      continue;
    }
    const contentRole = contentRoleForEntry(entry);
    const selectedAssets = selectedReferenceAssets(entry, selection.assetIds, targetType);
    if (selection.assetIds.length && selectedAssets.length !== selection.assetIds.length) {
      throw new Error("选择的参考素材已经失效，请重新选择");
    }
    if (selectedAssets.length === 1 && selectedAssets[0].kind === "video") {
      const asset = selectedAssets[0];
      const referenceSources = referenceSourcePartsForAsset(entry, asset.id, {
        sourceIds: selection.sourceIds,
        analysisIds: selection.analysisIds
      });
      if (!referenceSources.length) continue;
      const referenceText = formatReferenceSourceParts(referenceSources, locale);
      snapshots.push({
        referenceId: referenceSnapshotId(entry.id, asset.id),
        entryId: entry.id,
        assetId: asset.id,
        alias: locale === "en" ? `@Reference${snapshots.length + 1}` : `@参考${snapshots.length + 1}`,
        title: String(entry.title ?? "").trim(),
        referenceKind: "video_sources",
        referenceText,
        originalText: referenceSources.find((source) => source.kind === "original_prompt")?.text ?? "",
        scope: "asset",
        imageRefs: [],
        assets: [],
        referenceSources
      });
      continue;
    }
    const mediaPrompts = new Map((entry.mediaPrompts ?? []).map((item) => [item.assetId, String(item.text ?? "").trim()]));
    const selectedPrompts = selectedAssets.map((asset) => mediaPrompts.get(asset.id)).filter(Boolean);
    const originalPrompt = selectedAssets.length === 1 && selectedPrompts[0]
      ? selectedPrompts[0]
      : selectedPrompts.length === selectedAssets.length && selectedPrompts.length
        ? selectedPrompts.map((text, index) => `[图片${index + 1}独立提示词]\n${text}`).join("\n\n")
        : String(entry.text ?? "").trim();
    const visualFacts = imageVisualFacts(entry, selection.assetIds);
    const referenceKind = originalPrompt && visualFacts.length ? "prompt_vision"
        : contentRole === CONTENT_ROLES.imageCase ? "vision"
        : contentRole === CONTENT_ROLES.reference ? "reference" : "prompt";
    const baseText = referenceKind === "prompt_vision"
      ? formatPromptAndVisualFacts(originalPrompt, visualFacts)
      : referenceKind === "vision"
        ? visualFacts.map((fact, index) => `[图片${index + 1}可见事实]\n${fact}`).join("\n\n") || primaryVisionDescription(entry)
        : originalPrompt;
    const referenceText = String(baseText ?? "").trim();
    snapshots.push({
      referenceId: referenceSnapshotId(entry.id, selectedAssets.length === 1 ? selectedAssets[0].id : ""),
      entryId: entry.id,
      assetId: selectedAssets.length === 1 ? String(selectedAssets[0].id ?? "").trim() : "",
      alias: locale === "en" ? `@Reference${snapshots.length + 1}` : `@参考${snapshots.length + 1}`,
      title: String(entry.title ?? "").trim(),
      referenceKind,
      referenceText: String(referenceText ?? "").trim(),
      originalText: originalPrompt,
      scope: selection.assetIds.length ? "asset" : "case",
      imageRefs: imageRefsForEntry(entry, selection.assetIds),
      assets: selectedAssets.map(referenceAssetSnapshot)
    });
  }
  return snapshots;
}

function referenceSnapshotId(entryId, assetId) {
  return assetId ? `${entryId}:${assetId}` : String(entryId ?? "").trim();
}

function imageRefsForEntry(entry, assetIds = []) {
  const selected = new Set(Array.isArray(assetIds) ? assetIds : []);
  const entries = Array.isArray(entry?.memberEntries) ? entry.memberEntries : [entry];
  const seen = new Set();
  return entries.flatMap((item) => entryMediaAssets(item)
    .filter((asset) => asset.kind === "image" && asset.usage !== "poster" && (!selected.size || selected.has(asset.id)))
    .flatMap((asset) => {
      const visualId = String(asset.id ?? "").trim();
      if (!visualId || seen.has(visualId)) return [];
      seen.add(visualId);
      return [{ visualId, mimeType: String(asset.mimeType ?? "").trim() }];
    }));
}

function originalReferenceTextForEntry(entry, targetType) {
  if (!Array.isArray(entry?.memberEntries)) return String(entry?.text ?? "").trim();
  const type = targetType === "video" ? "video" : targetType === "image" ? "image" : "";
  return entry.memberEntries.flatMap((member) => {
    const role = contentRoleForEntry(member);
    const matches = (!type || type === "image") && role === CONTENT_ROLES.promptImage ||
      (!type || type === "video") && role === CONTENT_ROLES.promptVideo;
    const text = matches ? String(member.text ?? "").trim() : "";
    return text ? [text] : [];
  }).join("\n\n");
}

function imageVisualFacts(entry, assetIds = []) {
  const selected = new Set(Array.isArray(assetIds) ? assetIds : []);
  return entryMediaAssets(entry)
    .filter((asset) => asset.kind === "image" && asset.usage !== "poster" && !asset.visionAnalysis?.invalidated && (!selected.size || selected.has(asset.id)))
    .map((asset) => [
      String(asset.visionAnalysis?.description ?? "").trim(),
      validReconstructionPrompt(asset)
    ].filter(Boolean).join("\n重建提示词："))
    .filter(Boolean);
}

function normalizeReferenceSelection(value) {
  if (typeof value === "string") return { entryId: value.trim(), assetIds: [], sourceIds: null, analysisIds: [] };
  return {
    entryId: String(value?.entryId ?? "").trim(),
    assetIds: [...new Set((Array.isArray(value?.assetIds) ? value.assetIds : [])
      .map((item) => String(item ?? "").trim()).filter(Boolean))],
    sourceIds: Array.isArray(value?.sourceIds)
      ? [...new Set(value.sourceIds.map((item) => String(item ?? "").trim()).filter(Boolean))]
      : null,
    analysisIds: [...new Set((Array.isArray(value?.analysisIds) ? value.analysisIds : [])
      .map((item) => String(item ?? "").trim()).filter(Boolean))]
  };
}

function selectedReferenceAssets(entry, assetIds = [], targetType = "") {
  const selected = new Set(Array.isArray(assetIds) ? assetIds : []);
  const assets = entryMediaAssets(entry).filter((asset) => asset.usage !== "poster" &&
    (asset.kind === "image" || targetType === "video" && asset.kind === "video"));
  if (selected.size) return assets.filter((asset) => selected.has(asset.id));
  if (targetType !== "video") return assets;
  const primary = assets.find((asset) => asset.id === entry?.primaryMediaId);
  return primary ? [primary] : assets.slice(0, 1);
}

function selectedImageAssets(entry, assetIds = []) {
  const selected = new Set(Array.isArray(assetIds) ? assetIds : []);
  return entryMediaAssets(entry).filter((asset) =>
    asset.kind === "image" && asset.usage !== "poster" && (!selected.size || selected.has(asset.id))
  );
}

export function referenceSourcePartsForAsset(entry, assetIdValue, options = {}) {
  const assetId = String(assetIdValue ?? "").trim();
  const asset = entryMediaAssets(entry).find((item) => item.id === assetId && item.usage !== "poster");
  if (!asset) return [];
  const allowedSourceIds = Array.isArray(options.sourceIds) ? new Set(options.sourceIds.map(String)) : null;
  const selectedAnalysisIds = new Set((Array.isArray(options.analysisIds) ? options.analysisIds : []).map(String));
  const mediaPrompt = (Array.isArray(entry?.mediaPrompts) ? entry.mediaPrompts : [])
    .find((item) => String(item?.assetId ?? "") === assetId && String(item?.text ?? "").trim());
  const originalText = String(mediaPrompt?.text ?? entry?.text ?? "").trim();
  const current = asset.kind === "video" ? currentVideoReconstruction(entry, assetId) : null;
  const notes = asset.kind === "video" ? videoNotesForAsset(entry, assetId) : [];
  const defaultParts = [
    originalText ? {
      id: `original:${assetId}`,
      kind: "original_prompt",
      label: "原始提示词",
      text: originalText,
      provenance: [{
        type: mediaPrompt ? "asset_prompt" : "case_text",
        ...(mediaPrompt?.textRevision ? { version: Math.max(1, Number(mediaPrompt.textRevision) || 1) } : {})
      }]
    } : null,
    current?.reconstructionPrompt ? {
      id: `reconstruction:${String(current.id ?? "current")}`,
      kind: "video_reconstruction",
      label: "AI 视觉逆推",
      text: String(current.reconstructionPrompt).trim(),
      analysisId: String(current.id ?? "").trim(),
      analysisVersion: Math.max(1, Number(current.version) || 1),
      provenance: [{ type: "video_analysis", recordId: String(current.id ?? "").trim(), version: Math.max(1, Number(current.version) || 1) }]
    } : null,
    notes.length ? {
      id: `notes:${assetId}`,
      kind: "time_notes",
      label: "人工时间点笔记",
      text: notes.map((note) => `[${formatReferenceNoteRange(note)}] ${String(note.text ?? "").trim()}`).join("\n"),
      recordIds: notes.map((note) => String(note.id ?? "").trim()).filter(Boolean),
      provenance: notes.map((note) => ({ type: "time_note", recordId: String(note.id ?? "").trim() })).filter((item) => item.recordId)
    } : null
  ].filter(Boolean);
  const otherParts = (Array.isArray(entry?.videoAnalyses) ? entry.videoAnalyses : []).flatMap((analysis) => {
    const analysisId = String(analysis?.id ?? "").trim();
    if (!analysisId || analysisId === String(current?.id ?? "") || String(analysis?.assetId ?? "") !== assetId || !selectedAnalysisIds.has(analysisId)) return [];
    const text = String(analysis?.reconstructionPrompt ?? analysis?.text ?? analysis?.description ?? analysis?.summary ?? "").trim();
    if (!text) return [];
    return [{
      id: `analysis:${analysisId}`,
      kind: "other_analysis",
      label: "其他分析",
      text,
      analysisId,
      analysisVersion: Math.max(1, Number(analysis.version) || 1),
      provenance: [{ type: "video_analysis", recordId: analysisId, version: Math.max(1, Number(analysis.version) || 1) }]
    }];
  });
  return [
    ...defaultParts.filter((part) => !allowedSourceIds || allowedSourceIds.has(part.id)),
    ...otherParts
  ]
    .map(normalizeReferenceSourcePart).filter(Boolean);
}

export function formatReferenceSourceParts(partsValue = [], locale = "zh-CN") {
  const groups = [];
  const byText = new Map();
  for (const part of (Array.isArray(partsValue) ? partsValue : []).map(normalizeReferenceSourcePart).filter(Boolean)) {
    const key = part.text.replace(/\r\n?/g, "\n").trim();
    let group = byText.get(key);
    if (!group) {
      group = { text: part.text, labels: [] };
      byText.set(key, group);
      groups.push(group);
    }
    const label = locale === "en" ? referenceSourceLabelEn(part.kind) : part.label;
    if (!group.labels.includes(label)) group.labels.push(label);
  }
  return groups.map((group) => `[${group.labels.join(" + ")}]\n${group.text}`).join("\n\n");
}

function videoNotesForAsset(entry, assetId) {
  return (Array.isArray(entry?.timeNotes) ? entry.timeNotes : [])
    .filter((note) => String(note?.assetId ?? "") === assetId && String(note?.text ?? "").trim())
    .toSorted((left, right) => Number(left.startMs) - Number(right.startMs) || String(left.createdAt ?? "").localeCompare(String(right.createdAt ?? "")));
}

function formatReferenceNoteRange(note) {
  return Number(note?.endMs) > Number(note?.startMs)
    ? `${formatReferenceTime(note.startMs)}-${formatReferenceTime(note.endMs)}`
    : formatReferenceTime(note?.startMs);
}

function referenceSourceLabelEn(kind) {
  return ({
    original_prompt: "Original prompt",
    video_reconstruction: "AI visual reconstruction",
    time_notes: "Human time notes",
    other_analysis: "Other analysis"
  })[kind] || "Source";
}

function normalizeReferenceSourcePart(value) {
  const id = String(value?.id ?? "").trim();
  const text = String(value?.text ?? "").replace(/\r\n?/g, "\n").trim();
  const kind = ["original_prompt", "video_reconstruction", "time_notes", "other_analysis"].includes(value?.kind)
    ? value.kind : "";
  if (!id || !kind || !text) return null;
  return {
    id,
    kind,
    label: String(value?.label ?? "").trim() || referenceSourceLabelEn(kind),
    text,
    ...(String(value?.analysisId ?? "").trim() ? { analysisId: String(value.analysisId).trim() } : {}),
    ...(Number(value?.analysisVersion) > 0 ? { analysisVersion: Math.max(1, Number(value.analysisVersion) || 1) } : {}),
    ...(Array.isArray(value?.recordIds) ? { recordIds: uniqueStrings(value.recordIds) } : {}),
    provenance: (Array.isArray(value?.provenance) ? value.provenance : []).flatMap((item) => {
      const type = String(item?.type ?? "").trim();
      if (!type) return [];
      return [{
        type,
        ...(String(item?.recordId ?? "").trim() ? { recordId: String(item.recordId).trim() } : {}),
        ...(Number(item?.version) > 0 ? { version: Math.max(1, Number(item.version) || 1) } : {})
      }];
    })
  };
}

function referenceAssetSnapshot(asset) {
  const analysis = asset.visionAnalysis && !asset.visionAnalysis.invalidated ? asset.visionAnalysis : null;
  const analysisImageFingerprint = String(analysis?.imageFingerprint ?? "").trim();
  return {
    assetId: String(asset.id ?? "").trim(),
    imageFingerprint: String(asset.contentHash ?? "").trim() || analysisImageFingerprint,
    analysisImageFingerprint,
    analysisVersion: Math.max(0, Number(analysis?.version) || 0),
    analysisFingerprint: String(analysis?.profileFingerprint ?? "").trim(),
    reconstructionPrompt: validReconstructionPrompt(asset)
  };
}

function formatPromptAndVisualFacts(prompt, facts) {
  return [
    ...facts.map((fact, index) => `[图片${index + 1}可见事实]\n${fact}`),
    `[案例原提示词]\n${prompt}`
  ].join("\n\n");
}

function referenceTextForEntry(entry, targetType) {
  if (!Array.isArray(entry?.memberEntries)) return "";
  const type = targetType === "video" ? "video" : targetType === "image" ? "image" : "";
  const values = [];
  for (const member of entry.memberEntries) {
    const contentRole = contentRoleForEntry(member);
    if ((!type || type === "image") && contentRole === CONTENT_ROLES.promptImage && String(member.text ?? "").trim()) {
      values.push(String(member.text).trim());
    }
    if ((!type || type === "image") && contentRole === CONTENT_ROLES.imageCase && primaryVisionDescription(member)) {
      values.push(primaryVisionDescription(member));
    }
    if ((!type || type === "video") && contentRole === CONTENT_ROLES.promptVideo && String(member.text ?? "").trim()) {
      values.push(String(member.text).trim());
    }
    if ((!type || type === "video") && videoNoteReferenceText(member)) values.push(videoNoteReferenceText(member));
  }
  return values.join("\n\n");
}

function videoNoteReferenceText(entry) {
  const videoIds = new Set((entry?.mediaAssets ?? entry?.visuals ?? [])
    .filter((asset) => asset?.kind === "video" || String(asset?.mimeType ?? "").startsWith("video/"))
    .map((asset) => asset.id));
  const notes = (Array.isArray(entry?.timeNotes) ? entry.timeNotes : []).filter((note) => videoIds.has(note.assetId));
  if (!notes.length) return "";
  const assets = new Map((entry?.mediaAssets ?? entry?.visuals ?? []).map((asset) => [asset.id, asset]));
  return notes.map((note) => {
    const range = note.endMs > note.startMs
      ? `${formatReferenceTime(note.startMs)}-${formatReferenceTime(note.endMs)}`
      : formatReferenceTime(note.startMs);
    const frameDescription = String(assets.get(note.frameAssetId)?.visionAnalysis?.description ?? "").trim();
    return `[${range}] ${String(note.text ?? "").trim()}${frameDescription ? `\n关键帧描述：${frameDescription}` : ""}`;
  }).filter((value) => !/\]\s*$/.test(value)).join("\n");
}

function formatReferenceTime(milliseconds) {
  const total = Math.max(0, Math.floor(Number(milliseconds) || 0));
  const minutes = Math.floor(total / 60_000);
  const seconds = Math.floor(total % 60_000 / 1000);
  const remainder = total % 1000;
  return `${minutes}:${String(seconds).padStart(2, "0")}.${String(remainder).padStart(3, "0")}`;
}

export function createComposerSession(input = {}) {
  const now = new Date().toISOString();
  const targetType = input.targetType === "video" ? "video" : "image";
  const snapshots = normalizeReferenceSnapshots(input.referenceSnapshots);
  const assemblySnapshots = normalizeComposerAssemblySnapshots(input.assemblySnapshots, input.assemblySnapshot);
  const referenceModeAvailability = imageReferenceModeAvailability(snapshots);
  const requestedReferenceMode = ["conditioned", "prompt_only", "text_only"].includes(input.imageReferenceMode)
    ? input.imageReferenceMode
    : "conditioned";
  return {
    id: String(input.id ?? "").trim() || globalThis.crypto.randomUUID(),
    title: String(input.title ?? "").trim() || (targetType === "video" ? "未命名视频提示词" : "未命名图片提示词"),
    targetType,
    targetPlatform: String(input.targetPlatform ?? "").trim(),
    outputLanguage: ["auto", "zh-CN", "en"].includes(input.outputLanguage) ? input.outputLanguage : "auto",
    routeMode: normalizeAgentRoute(input.routeMode),
    aiProfile: normalizeComposerAiProfile(input.aiProfile),
    generationAiProfile: normalizeComposerAiProfile(input.generationAiProfile ?? input.aiProfile),
    outputMode: input.outputMode === "create_image" && targetType === "image"
      ? "create_image"
      : input.outputMode === "create_video" && targetType === "video" ? "create_video" : "text_prompt",
    generationParameters: normalizeGenerationParameters(input.generationParameters, targetType),
    imageReferenceMode: requestedReferenceMode === "conditioned" || referenceModeAvailability.canDisableImages
      ? requestedReferenceMode
      : "conditioned",
    productionReviewEnabled: input.productionReviewEnabled !== false,
    referenceSnapshots: snapshots,
    appliedSkills: normalizeAppliedSkillSnapshots(input.appliedSkills),
    messages: normalizeMessages(input.messages),
    currentInstruction: String(input.currentInstruction ?? "").trim(),
    retrievedSources: normalizeRetrievedSources(input.retrievedSources),
    retrievalSnapshot: normalizeRetrievalSnapshot(input.retrievalSnapshot),
    assemblySnapshots,
    assemblySnapshot: assemblySnapshots.at(-1) ?? null,
    currentRoute: AGENT_ROUTES.includes(input.currentRoute) ? input.currentRoute : "",
    currentRouteSource: input.currentRouteSource === "manual" ? "manual" : input.currentRouteSource === "auto" ? "auto" : "",
    activeTurn: createComposerActiveTurn(input.activeTurn),
    promptVersions: normalizePromptVersions(input.promptVersions),
    diagnosticEvents: normalizeDiagnosticEvents(input.diagnosticEvents),
    lastFailure: normalizeComposerFailure(input.lastFailure),
    createdAt: validIso(input.createdAt) || now,
    updatedAt: validIso(input.updatedAt) || now
  };
}

export function createComposerAssemblySnapshot(value = {}) {
  return normalizeComposerAssemblySnapshot({
    ...value,
    id: String(value.id ?? "").trim() || globalThis.crypto.randomUUID(),
    createdAt: validIso(value.createdAt) || new Date().toISOString(),
    status: "prepared"
  });
}

export function completeComposerAssemblySnapshot(snapshotValue, result = {}) {
  const snapshot = normalizeComposerAssemblySnapshot(snapshotValue);
  if (!snapshot) return null;
  return normalizeComposerAssemblySnapshot({
    ...snapshot,
    status: "completed",
    actual: {
      status: "completed",
      route: result.route,
      kind: result.kind,
      serviceId: result.serviceId || snapshot.serviceId,
      model: result.model || snapshot.model,
      promptTokens: result.usage?.promptTokens,
      completionTokens: result.usage?.completionTokens,
      finishReason: result.finishReason,
      protocolDegraded: result.protocolDegraded === true,
      stages: uniqueStrings(result.actualStages),
      completedAt: new Date().toISOString()
    }
  });
}

export function failComposerAssemblySnapshot(snapshotValue, error = {}) {
  const snapshot = normalizeComposerAssemblySnapshot(snapshotValue);
  if (!snapshot) return null;
  return normalizeComposerAssemblySnapshot({
    ...snapshot,
    status: error.kind === "stopped" ? "stopped" : "failed",
    actual: {
      status: error.kind === "stopped" ? "stopped" : "failed",
      serviceId: snapshot.serviceId,
      model: snapshot.model,
      finishReason: String(error.kind ?? "failed"),
      stages: uniqueStrings(error.actualStages),
      completedAt: new Date().toISOString()
    }
  });
}

function normalizeComposerAssemblySnapshot(value) {
  if (!value || typeof value !== "object") return null;
  const id = String(value.id ?? "").trim();
  const turnId = String(value.turnId ?? "").trim();
  const userMessageId = String(value.userMessageId ?? "").trim();
  if (!id || !turnId || !userMessageId) return null;
  const status = ["prepared", "completed", "failed", "stopped"].includes(value.status)
    ? value.status
    : "prepared";
  const actualStatus = ["completed", "failed", "stopped"].includes(value.actual?.status)
    ? value.actual.status
    : "";
  return {
    id,
    turnId,
    userMessageId,
    createdAt: validIso(value.createdAt) || new Date().toISOString(),
    status,
    serviceId: String(value.serviceId ?? "").trim(),
    serviceLabel: String(value.serviceLabel ?? "").trim(),
    model: String(value.model ?? "").trim(),
    route: ["auto", ...AGENT_ROUTES].includes(value.route) ? value.route : "auto",
    routeSource: value.routeSource === "manual" ? "manual" : "auto",
    targetType: value.targetType === "video" ? "video" : "image",
    outputMode: ["text_prompt", "create_image", "create_video"].includes(value.outputMode) ? value.outputMode : "text_prompt",
    outputLanguage: value.outputLanguage === "en" ? "en" : "zh-CN",
    productionReviewEnabled: value.productionReviewEnabled !== false,
    agentInstruction: String(value.agentInstruction ?? ""),
    taskMethod: String(value.taskMethod ?? ""),
    userRequest: String(value.userRequest ?? "").trim(),
    skills: (Array.isArray(value.skills) ? value.skills : []).flatMap((item, index) => {
      const callName = String(item?.callName ?? "").trim();
      if (!callName) return [];
      return [{
        skillId: String(item?.skillId ?? "").trim(),
        callName,
        order: Math.max(1, Math.floor(Number(item?.order) || index + 1)),
        version: String(item?.version ?? "").trim(),
        instructions: String(item?.instructions ?? "")
      }];
    }),
    references: (Array.isArray(value.references) ? value.references : []).flatMap((item) => {
      const alias = String(item?.alias ?? "").trim();
      if (!alias) return [];
      return [{
        alias,
        title: String(item?.title ?? "").trim(),
        referenceKind: String(item?.referenceKind ?? "").trim(),
        referenceText: String(item?.referenceText ?? ""),
        sourceLabels: uniqueStrings(item?.sourceLabels),
        imageCount: Math.max(0, Math.floor(Number(item?.imageCount) || 0))
      }];
    }),
    retrieval: normalizeRetrievalSnapshot(value.retrieval),
    retrievedSources: normalizeRetrievedSources(value.retrievedSources),
    media: {
      imageReferenceMode: ["conditioned", "prompt_only", "text_only"].includes(value.media?.imageReferenceMode)
        ? value.media.imageReferenceMode
        : "conditioned",
      selectedImageCount: Math.max(0, Math.floor(Number(value.media?.selectedImageCount) || 0)),
      expectedSentImageCount: Math.max(0, Math.floor(Number(value.media?.expectedSentImageCount) || 0)),
      omittedImageCount: Math.max(0, Math.floor(Number(value.media?.omittedImageCount) || 0)),
      omittedReason: String(value.media?.omittedReason ?? "").trim(),
      editMode: ["whole", "local"].includes(value.media?.editMode) ? value.media.editMode : "",
      baseImageIncluded: value.media?.baseImageIncluded === true,
      maskIncluded: value.media?.maskIncluded === true
    },
    expectedModelCalls: Math.max(0, Math.floor(Number(value.expectedModelCalls) || 0)),
    prerequisiteAnalysisRequests: Math.max(0, Math.floor(Number(value.prerequisiteAnalysisRequests) || 0)),
    plannedStages: uniqueStrings(value.plannedStages),
    actual: actualStatus ? {
      status: actualStatus,
      route: AGENT_ROUTES.includes(value.actual?.route) ? value.actual.route : "",
      kind: String(value.actual?.kind ?? "").trim(),
      serviceId: String(value.actual?.serviceId ?? "").trim(),
      model: String(value.actual?.model ?? "").trim(),
      promptTokens: Math.max(0, Math.floor(Number(value.actual?.promptTokens) || 0)),
      completionTokens: Math.max(0, Math.floor(Number(value.actual?.completionTokens) || 0)),
      finishReason: String(value.actual?.finishReason ?? "").trim(),
      protocolDegraded: value.actual?.protocolDegraded === true,
      stages: uniqueStrings(value.actual?.stages),
      completedAt: validIso(value.actual?.completedAt)
    } : null
  };
}

function normalizeComposerAssemblySnapshots(values, latestValue) {
  const snapshots = new Map();
  for (const value of Array.isArray(values) ? values : []) {
    const snapshot = normalizeComposerAssemblySnapshot(value);
    if (snapshot) snapshots.set(snapshot.id, snapshot);
  }
  const latest = normalizeComposerAssemblySnapshot(latestValue);
  if (latest) snapshots.set(latest.id, latest);
  return [...snapshots.values()].sort((a, b) => a.createdAt.localeCompare(b.createdAt)).slice(-50);
}

function normalizeRetrievalSnapshot(value) {
  if (!value || typeof value !== "object") return null;
  const query = String(value.query ?? "").trim();
  const contentRoles = [...new Set((Array.isArray(value.contentRoles) ? value.contentRoles : [])
    .filter((role) => ["case", "guide"].includes(role)))];
  const status = ["completed", "empty"].includes(value.status) ? value.status : "";
  if (!query || !contentRoles.length || !status) return null;
  return {
    query,
    contentRoles,
    status,
    sourceCount: Math.max(0, Math.floor(Number(value.sourceCount) || 0)),
    requestedAt: validIso(value.requestedAt)
  };
}

export function imageReferenceModeAvailability(referenceSnapshots = []) {
  const missingAssetIds = [];
  for (const reference of Array.isArray(referenceSnapshots) ? referenceSnapshots : []) {
    const promptBacked = referenceHasPromptText(reference);
    const assets = new Map((Array.isArray(reference?.assets) ? reference.assets : []).map((item) => [item.assetId, item]));
    for (const imageRef of Array.isArray(reference?.imageRefs) ? reference.imageRefs : []) {
      if (promptBacked) continue;
      const assetId = String(imageRef?.visualId ?? "").trim();
      const asset = assets.get(assetId);
      if (referenceHasUsableLegacyDescription(reference, asset) || hasCompleteReferenceAnalysis(asset)) continue;
      if (assetId && !missingAssetIds.includes(assetId)) missingAssetIds.push(assetId);
    }
  }
  return { canDisableImages: missingAssetIds.length === 0, missingAssetIds };
}

export function normalizeGenerationParameters(value = {}, targetType = "image") {
  const source = value && typeof value === "object" ? value : {};
  if (targetType === "video") {
    return {
      size: cleanParameter(source.size),
      duration: cleanParameter(source.duration),
      aspectRatio: cleanParameter(source.aspectRatio),
      resolution: cleanParameter(source.resolution),
      motion: cleanParameter(source.motion)
    };
  }
  return {
    size: cleanParameter(source.size),
    quality: cleanParameter(source.quality),
    aspectRatio: cleanParameter(source.aspectRatio),
    imageSize: cleanParameter(source.imageSize)
  };
}

export function normalizeComposerSessions(values = []) {
  const seen = new Set();
  return (Array.isArray(values) ? values : []).flatMap((value) => {
    try {
      const session = createComposerSession(value);
      if (seen.has(session.id) || !isMeaningfulComposerSession(session)) return [];
      seen.add(session.id);
      return [session];
    } catch {
      return [];
    }
  }).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export function isMeaningfulComposerSession(sessionValue = {}) {
  const session = createComposerSession(sessionValue);
  return Boolean(
    session.messages.length
    || session.promptVersions.length
    || session.referenceSnapshots.length
    || session.appliedSkills.length
  );
}

export function sessionSummary(sessionValue) {
  const session = createComposerSession(sessionValue);
  return {
    id: session.id,
    title: session.title,
    targetType: session.targetType,
    updatedAt: session.updatedAt,
    referenceCount: session.referenceSnapshots.length,
    hasPrompt: session.promptVersions.length > 0
  };
}

export function validateGeneratedPrompt(generatedText) {
  const text = String(generatedText ?? "").trim();
  if (!text) throw new Error("DeepSeek 没有返回完整提示词");
  if (/@(?:参考|Reference)\s*\d+|参考(?:上文|图|视频|素材)|attached reference/i.test(text)) {
    throw new Error("最终提示词仍依赖参考素材，本次结果不能复制或保存");
  }
  return text;
}

export function plannerRequestPayload(sessionValue, userMessage, settingsValue) {
  const session = createComposerSession(sessionValue);
  const settings = normalizeComposerSettings(settingsValue);
  const incoming = String(userMessage ?? "").trim();
  const latestUserText = incoming || [...session.messages].reverse().find((item) => item.role === "user")?.content || "";
  const locale = resolveOutputLocale(session.outputLanguage, latestUserText);
  const messages = incoming
    ? [...session.messages, { role: "user", type: "request", content: incoming }]
    : session.messages;
  return {
    routeMode: session.routeMode,
    targetType: session.targetType,
    targetPlatform: session.targetPlatform || "通用",
    outputLanguage: locale,
    productionReviewEnabled: session.productionReviewEnabled,
    agentVersion: settings.agentVersion,
    methodVersion: settings.methodVersion,
    taskMethod: taskMethodFor(
      settings,
      session.routeMode === "auto" ? "compose" : session.routeMode,
      session.targetType,
      locale
    ),
    skills: session.appliedSkills.map((skill, index) => ({
      order: index + 1,
      callName: skill.callName,
      description: skill.description,
      instructions: skill.skillMarkdown,
      references: skill.references.map((reference) => ({ path: reference.path, markdown: reference.markdown })),
      sourceType: skill.source,
      textMode: skill.textMode
    })),
    references: session.referenceSnapshots.map(({ alias, referenceKind, referenceText, imageRefs, referenceSources }) => ({
      alias,
      referenceKind,
      referenceText,
      ...(referenceSources.length ? { sources: referenceSources.map(({ kind, label }) => ({ kind, label })) } : {}),
      imageCount: imageRefs.length
    })),
    retrievedSources: session.retrievedSources.map(({ alias, role, referenceKind, text }) => ({ alias, role, referenceKind, text })),
    messages: messages.filter((item) => item.type !== "prompt").map(({ role, type, content }) => ({ role, type, content })),
    previousPrompt: session.promptVersions.at(-1)?.text ?? ""
  };
}

export function composerInputUsage(sessionValue, userMessage, settingsValue) {
  const payload = plannerRequestPayload(sessionValue, userMessage, settingsValue);
  const characters = JSON.stringify(payload).length;
  return {
    characters,
    maxCharacters: COMPOSER_INPUT_MAX_CHARACTERS,
    overLimit: characters > COMPOSER_INPUT_MAX_CHARACTERS
  };
}

export function assertComposerInputBudget(sessionValue, userMessage, settingsValue) {
  const usage = composerInputUsage(sessionValue, userMessage, settingsValue);
  if (usage.overLimit) {
    throw new Error(`创作输入内容超过 ${usage.maxCharacters.toLocaleString("en-US")} 字符上限；请减少所选案例或清理过长历史后重试`);
  }
  return usage;
}

export function assertComposerRequestBudget(messages) {
  const characters = (Array.isArray(messages) ? messages : [])
    .reduce((sum, item) => sum + String(item?.content ?? "").length, 0);
  if (characters > COMPOSER_REQUEST_MAX_CHARACTERS) {
    throw new Error("创作请求内容超过服务安全边界；请缩短对话历史或减少本轮参考后重试");
  }
  return { characters, maxCharacters: COMPOSER_REQUEST_MAX_CHARACTERS };
}

export function resolveOutputLocale(value, latestText = "") {
  if (value === "zh-CN" || value === "en") return value;
  return /[\u3400-\u9fff]/.test(String(latestText ?? "")) ? "zh-CN" : "en";
}

export function createInstructionSnapshot(settingsValue, route, targetType, outputLanguage, routeSource = "auto", instruction = "") {
  const settings = normalizeComposerSettings(settingsValue);
  const normalizedRoute = normalizeAgentRoute(route, "chat");
  const locale = outputLanguage === "en" ? "en" : "zh-CN";
  return normalizeInstructionSnapshot({
    agentVersion: settings.agentVersion,
    route: normalizedRoute,
    routeSource,
    agentInstruction: settings.agentInstruction.text,
    taskMethod: taskMethodFor(settings, normalizedRoute, targetType, locale),
    instruction: String(instruction ?? "").trim(),
    outputLanguage: locale
  });
}

export function appendComposerMessage(sessionValue, message) {
  const session = createComposerSession(sessionValue);
  if (message?.type === "plan") return session;
  const content = String(message?.content ?? "").trim();
  if (!content) return session;
  const role = message.role === "assistant" ? "assistant" : "user";
  session.messages.push({
    id: String(message.id ?? "").trim() || globalThis.crypto.randomUUID(),
    role,
    type: ["request", "question", "answer", "prompt", "analysis", "method_draft", "chat", "status"].includes(message.type) ? message.type : "request",
    content,
    route: AGENT_ROUTES.includes(message.route) ? message.route : "",
    routeSource: message.routeSource === "manual" ? "manual" : message.routeSource === "auto" ? "auto" : "",
    artifact: normalizeMessageArtifact(message.artifact),
    instructionSnapshot: normalizeInstructionSnapshot(message.instructionSnapshot),
    recommendedAnswer: String(message.recommendedAnswer ?? "").trim(),
    options: uniqueStrings(message.options).slice(0, 3),
    createdAt: validIso(message.createdAt) || new Date().toISOString()
  });
  if (role === "user") session.updatedAt = new Date().toISOString();
  return session;
}

export function appendPromptVersion(sessionValue, value = {}) {
  const session = createComposerSession(sessionValue);
  const text = String(value.text ?? "").trim();
  if (!text) throw new Error("最终提示词不能为空");
  session.promptVersions.push({
    id: globalThis.crypto.randomUUID(),
    text,
    title: String(value.title ?? "").trim(),
    methodVersion: String(value.methodVersion ?? COMPOSER_METHOD_VERSION),
    outputLanguage: value.outputLanguage === "en" ? "en" : value.outputLanguage === "zh-CN" ? "zh-CN" : "",
    usage: normalizeUsage(value.usage),
    validation: normalizeValidation(value.validation),
    productionReviewEnabled: value.productionReviewEnabled === true,
    retrievedSources: normalizeRetrievedSources(value.retrievedSources),
    instructionSnapshot: normalizeInstructionSnapshot(value.instructionSnapshot),
    createdAt: new Date().toISOString()
  });
  session.updatedAt = new Date().toISOString();
  return session;
}

export function appendDiagnosticEvent(sessionValue, value = {}) {
  const session = createComposerSession(sessionValue);
  const phase = String(value.phase ?? "").trim();
  const status = String(value.status ?? "").trim();
  if (!phase || !status) return session;
  session.diagnosticEvents.push({
    at: validIso(value.at) || new Date().toISOString(),
    phase,
    status,
    detail: String(value.detail ?? "").trim()
  });
  session.diagnosticEvents = session.diagnosticEvents.slice(-100);
  return session;
}

export function setComposerFailure(sessionValue, value = {}) {
  const session = createComposerSession(sessionValue);
  session.lastFailure = normalizeComposerFailure(value);
  if (!session.lastFailure) throw new Error("无法保存本轮失败状态");
  return session;
}

export function clearComposerFailure(sessionValue) {
  const session = createComposerSession(sessionValue);
  session.lastFailure = null;
  return session;
}

function normalizeReferenceSnapshots(values) {
  const seen = new Set();
  return (Array.isArray(values) ? values : []).flatMap((item) => {
    const entryId = String(item?.entryId ?? "").trim();
    const assetId = String(item?.assetId ?? item?.assets?.[0]?.assetId ?? "").trim();
    const referenceId = String(item?.referenceId ?? "").trim() || referenceSnapshotId(entryId, assetId);
    const alias = String(item?.alias ?? "").trim();
    const referenceText = String(item?.referenceText ?? "").trim();
    const imageRefs = normalizeReferenceImageRefs(item?.imageRefs);
    const assetRefs = normalizeReferenceAssetRefs(item?.assetRefs);
    const assets = normalizeReferenceAssets(item?.assets);
    if (!entryId || !referenceId || !alias || (!referenceText && !imageRefs.length && !assetRefs.length) || seen.has(referenceId)) return [];
    seen.add(referenceId);
    const referenceKind = ["vision", "video_notes", "video_sources", "prompt_vision", "reference"].includes(item?.referenceKind)
      ? item.referenceKind
      : "prompt";
    return [{
      referenceId,
      entryId,
      assetId,
      alias,
      title: String(item?.title ?? "").trim(),
      sourceType: item?.sourceType === TEMP_REFERENCE_SOURCE_TYPES.temporary
        ? TEMP_REFERENCE_SOURCE_TYPES.temporary
        : TEMP_REFERENCE_SOURCE_TYPES.library,
      referenceKind,
      referenceText,
      originalText: String(item?.originalText ?? "").trim(),
      scope: item?.scope === "asset" ? "asset" : "case",
      imageRefs,
      assetRefs,
      assets,
      referenceSources: (Array.isArray(item?.referenceSources) ? item.referenceSources : [])
        .map(normalizeReferenceSourcePart).filter(Boolean)
    }];
  });
}

function normalizeReferenceAssets(values) {
  const seen = new Set();
  return (Array.isArray(values) ? values : []).flatMap((item) => {
    const assetId = String(item?.assetId ?? "").trim();
    if (!assetId || seen.has(assetId)) return [];
    seen.add(assetId);
    const analysisVersion = Math.max(0, Number(item?.analysisVersion) || 0);
    const analysisImageFingerprint = String(item?.analysisImageFingerprint ?? item?.imageFingerprint ?? "").trim();
    const imageFingerprint = String(item?.imageFingerprint ?? "").trim()
      || (analysisVersion === 2 ? analysisImageFingerprint : "");
    return [{
      assetId,
      imageFingerprint,
      analysisImageFingerprint,
      analysisVersion,
      analysisFingerprint: String(item?.analysisFingerprint ?? "").trim(),
      reconstructionPrompt: String(item?.reconstructionPrompt ?? "").trim()
    }];
  });
}

function normalizeReferenceImageRefs(values) {
  const seen = new Set();
  return (Array.isArray(values) ? values : []).flatMap((item) => {
    const visualId = String(item?.visualId ?? "").trim();
    if (!visualId || seen.has(visualId)) return [];
    seen.add(visualId);
    return [{ visualId, mimeType: String(item?.mimeType ?? "").trim() }];
  });
}

function normalizeReferenceAssetRefs(values) {
  const seen = new Set();
  return (Array.isArray(values) ? values : []).flatMap((item) => {
    const assetId = String(item?.assetId ?? "").trim();
    const kind = item?.kind === "image" ? "image" : item?.kind === "document" ? "document" : "";
    if (!assetId || !kind || seen.has(assetId)) return [];
    seen.add(assetId);
    const archivePath = safeReferenceArchivePath(item?.archivePath);
    return [{
      assetId,
      kind,
      mimeType: String(item?.mimeType ?? "").trim(),
      name: String(item?.name ?? "").trim(),
      byteSize: Math.max(0, Math.floor(Number(item?.byteSize) || 0)),
      ...(archivePath ? { archivePath } : {})
    }];
  });
}

function safeReferenceArchivePath(value) {
  const path = String(value ?? "").trim();
  if (!path) return "";
  try {
    return normalizeLocalRelativePath(path);
  } catch {
    return "";
  }
}

function normalizeMessages(values) {
  return (Array.isArray(values) ? values : []).flatMap((item) => {
    const content = String(item?.content ?? "").trim();
    if (!content || item?.type === "plan") return [];
    return [{
      id: String(item.id ?? "").trim() || globalThis.crypto.randomUUID(),
      role: item.role === "assistant" ? "assistant" : "user",
      type: ["request", "question", "answer", "prompt", "analysis", "method_draft", "chat", "status"].includes(item.type) ? item.type : "request",
      content,
      route: AGENT_ROUTES.includes(item.route) ? item.route : "",
      routeSource: item.routeSource === "manual" ? "manual" : item.routeSource === "auto" ? "auto" : "",
      artifact: normalizeMessageArtifact(item.artifact),
      instructionSnapshot: normalizeInstructionSnapshot(item.instructionSnapshot),
      recommendedAnswer: String(item.recommendedAnswer ?? "").trim(),
      options: uniqueStrings(item.options).slice(0, 3),
      createdAt: validIso(item.createdAt) || new Date().toISOString()
    }];
  });
}

function normalizeDiagnosticEvents(values) {
  return (Array.isArray(values) ? values : []).flatMap((item) => {
    const phase = String(item?.phase ?? "").trim();
    const status = String(item?.status ?? "").trim();
    if (!phase || !status) return [];
    return [{
      at: validIso(item.at) || new Date(0).toISOString(),
      phase,
      status,
      detail: String(item?.detail ?? "").trim()
    }];
  }).slice(-100);
}

function normalizePromptVersions(values) {
  return (Array.isArray(values) ? values : []).flatMap((item) => {
    const text = String(item?.text ?? "").trim();
    if (!text) return [];
    return [{
      id: String(item.id ?? "").trim() || globalThis.crypto.randomUUID(),
      text,
      title: String(item.title ?? "").trim(),
      methodVersion: String(item.methodVersion ?? COMPOSER_METHOD_VERSION),
      outputLanguage: item.outputLanguage === "en" ? "en" : item.outputLanguage === "zh-CN" ? "zh-CN" : "",
      usage: normalizeUsage(item.usage),
      validation: normalizeValidation(item.validation),
      productionReviewEnabled: item.productionReviewEnabled === true,
      retrievedSources: normalizeRetrievedSources(item.retrievedSources),
      instructionSnapshot: normalizeInstructionSnapshot(item.instructionSnapshot),
      createdAt: validIso(item.createdAt) || new Date().toISOString()
    }];
  });
}

function normalizeValidation(values) {
  return (Array.isArray(values) ? values : []).flatMap((item) => {
    const id = String(item?.id ?? "").trim();
    const message = String(item?.message ?? "").trim();
    const status = ["passed", "failed", "warning"].includes(item?.status) ? item.status : "";
    return id && message && status ? [{ id, status, message }] : [];
  });
}

function normalizeComposerFailure(value) {
  if (!value || typeof value !== "object") return null;
  const userMessageId = String(value.userMessageId ?? "").trim();
  const phase = ["saving", "planning", "streaming"].includes(value.phase) ? value.phase : "";
  const kind = ["storage", "network", "timeout", "rate_limit", "service", "response", "unknown", "stopped"].includes(value.kind)
    ? value.kind
    : "unknown";
  const message = String(value.message ?? "").trim();
  if (!userMessageId || !phase || !message) return null;
  return {
    userMessageId,
    phase,
    kind,
    message,
    retryable: value.retryable === true,
    at: validIso(value.at) || new Date().toISOString()
  };
}

function normalizeMessageArtifact(value) {
  return null;
}

function normalizeInstructionSnapshot(value) {
  if (!value || typeof value !== "object") return null;
  return {
    agentVersion: String(value.agentVersion ?? "").trim(),
    route: AGENT_ROUTES.includes(value.route) ? value.route : "",
    routeSource: value.routeSource === "manual" ? "manual" : "auto",
    agentInstruction: String(value.agentInstruction ?? ""),
    taskMethod: String(value.taskMethod ?? ""),
    instruction: String(value.instruction ?? "").trim(),
    outputLanguage: value.outputLanguage === "en" ? "en" : "zh-CN"
  };
}

function normalizeRetrievedSources(values) {
  const seen = new Set();
  return (Array.isArray(values) ? values : []).flatMap((item) => {
    const entryId = String(item?.entryId ?? "").trim();
    const alias = String(item?.alias ?? "").trim();
    const role = LIBRARY_CONTENT_ROLES.includes(item?.role) ? item.role : "";
    const text = String(item?.text ?? "").trim();
    if (!entryId || !alias || !role || !text || seen.has(entryId)) return [];
    seen.add(entryId);
    const referenceKind = ["prompt", "vision", "video_notes", "document", "method"].includes(item?.referenceKind)
      ? item.referenceKind
      : "document";
    return [{ entryId, alias, title: String(item?.title ?? "").trim(), role, referenceKind, text }];
  });
}

function uniqueStrings(values) {
  return [...new Set((Array.isArray(values) ? values : []).map((item) => String(item ?? "").trim()).filter(Boolean))];
}

function cleanParameter(value) {
  return String(value ?? "").replace(/[\u0000-\u001f\u007f]/g, "").trim();
}

function normalizeUsage(value = {}) {
  return {
    promptTokens: Math.max(0, Math.round(Number(value.promptTokens) || 0)),
    completionTokens: Math.max(0, Math.round(Number(value.completionTokens) || 0)),
    totalTokens: Math.max(0, Math.round(Number(value.totalTokens) || 0))
  };
}

function validIso(value) {
  const text = String(value ?? "");
  return Number.isNaN(Date.parse(text)) ? "" : new Date(text).toISOString();
}
