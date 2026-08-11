import { cleanName, createDefaultFacetCatalog, normalizeFacetCatalog, uniqueNames } from "./facets.js";
import { CLASSIFIER_VERSION } from "./classifier.js";
import { applyFixedAnalysisTags, mapLegacyAnalysisCandidate, prepareFacetRebuild } from "./tag-taxonomy.js";

export const ANALYSIS_CANDIDATE_VERSION = 1;
export const MAX_PROMOTED_ANALYSIS_TAGS = 6;

export function extractStructureCandidates(entry = {}) {
  const text = String(entry.text ?? "");
  const candidates = [];
  for (const object of extractJsonObjects(text)) {
    try {
      flattenJson(JSON.parse(object), [], candidates);
    } catch {
    }
  }
  for (const section of extractNamedSections(text)) {
    candidates.push(candidate({
      dimensionName: section.heading,
      tagName: section.value,
      evidence: `${section.heading}: ${section.value}`,
      source: "structure",
      confidence: 0.98
    }));
  }
  return normalizeAnalysisCandidates(candidates, "structure");
}

export function normalizeAnalysisCandidates(values, fallbackSource = "deepseek_text") {
  const result = [];
  const seen = new Set();
  for (const value of Array.isArray(values) ? values : []) {
    const item = candidate({ ...value, source: value?.source ?? fallbackSource });
    if (!item) continue;
    const key = candidateKey(item);
    if (seen.has(key)) continue;
    seen.add(key);
    result.push({ ...item, id: item.id || `candidate:${stableHash(key)}`, fingerprint: key });
  }
  return result;
}

export function sortAnalysisBreakdown(values, fallbackSource = "deepseek_text") {
  return normalizeAnalysisCandidates(values, fallbackSource)
    .map((item, index) => ({ item, index }))
    .sort((left, right) => compareAnalysisCandidate(left, right))
    .map(({ item }) => item);
}

export function mergeAnalysisCandidates(entry = {}, incoming = []) {
  const rejected = new Set(entry.rejectedCandidateKeys ?? []);
  const byKey = new Map((entry.analysisCandidates ?? []).map((item) => [item.fingerprint || candidateKey(item), item]));
  for (const item of normalizeAnalysisCandidates(incoming)) {
    if (!rejected.has(item.fingerprint)) byKey.set(item.fingerprint, item);
  }
  return { ...entry, analysisCandidates: [...byKey.values()] };
}

export function applyTextAnalysisTags(state = {}, entryId, incoming = []) {
  const applied = applyFixedAnalysisTags({
    ...state,
    facetCatalog: normalizeFacetCatalog(state.facetCatalog)
  }, entryId, incoming, { source: "deepseek_text" });
  const entry = applied.state.entries.find((item) => item.id === entryId);
  entry.analysisCandidates = (entry.analysisCandidates ?? []).filter((item) => (item?.source ?? "deepseek_text") !== "deepseek_text");
  entry.analysisBreakdown = (entry.analysisBreakdown ?? []).filter((item) => (item?.source ?? "deepseek_text") !== "deepseek_text");
  return applied;
}

export function applyVisionAnalysis(state = {}, entryId, result = {}, metadata = {}) {
  let next = structuredClone(state);
  next.facetCatalog = normalizeFacetCatalog(next.facetCatalog);
  let entry = next.entries?.find((item) => item.id === entryId);
  if (!entry) throw new Error("没有找到需要分析的案例");
  const description = String(result.description ?? "").trim();
  if (!description) throw new Error("视觉模型没有返回画面描述，本次没有写入");
  const visualId = String(metadata.visualId ?? "").trim();
  const matchesVisual = (item) => item.source === "vision_model" && (!visualId || item.visualId === visualId);

  const beforeFacetIds = new Set(next.facetCatalog.facets.map((item) => item.id));
  const beforeNodeIds = new Set(next.facetCatalog.nodes.map((item) => item.id));
  const previousVisionAnalysis = entry.visionAnalysis ? structuredClone(entry.visionAnalysis) : null;
  const previousAssignments = (entry.facetAssignments ?? [])
    .filter(matchesVisual)
    .map((item) => structuredClone(item));

  entry.facetAssignments = (entry.facetAssignments ?? []).filter((item) => !matchesVisual(item));
  const assignmentStart = entry.facetAssignments.length;
  const tagged = applyFixedAnalysisTags(next, entryId, result.tags ?? [], {
    source: "vision_model",
    allowEmpty: true,
    maxTags: 6,
    replaceExisting: false
  });
  next = tagged.state;
  entry = next.entries.find((item) => item.id === entryId);
  if (visualId) {
    entry.facetAssignments = entry.facetAssignments.map((item, index) => index >= assignmentStart && item.source === "vision_model"
      ? { ...item, visualId }
      : item);
  }
  entry.visionAnalysis = {
    version: Math.max(1, Number(metadata.version) || 1),
    description,
    ...(result.canvas ? { canvas: structuredClone(result.canvas) } : {}),
    ...(Array.isArray(result.elements) ? { elements: structuredClone(result.elements) } : {}),
    ...(Array.isArray(result.dimensions) ? { dimensions: structuredClone(result.dimensions) } : {}),
    ...(Array.isArray(result.ocr) ? { ocr: structuredClone(result.ocr) } : {}),
    ...(String(result.reconstructionPrompt ?? "").trim() ? { reconstructionPrompt: String(result.reconstructionPrompt).trim() } : {}),
    ...(Array.isArray(result.limitations) ? { limitations: structuredClone(result.limitations) } : {}),
    ...(result.completeness ? { completeness: structuredClone(result.completeness) } : {}),
    tags: Array.isArray(result.tags) ? structuredClone(result.tags) : [],
    locale: metadata.locale === "en" ? "en" : "zh-CN",
    imageFingerprint: String(metadata.imageFingerprint ?? "").trim(),
    profileFingerprint: String(metadata.profileFingerprint ?? "").trim(),
    analyzedAt: String(metadata.analyzedAt ?? "").trim() || new Date().toISOString(),
    providerType: metadata.providerType === "compatible" ? "compatible" : "openai",
    model: String(metadata.model ?? "").trim(),
    ...(metadata.usage && typeof metadata.usage === "object" ? { usage: structuredClone(metadata.usage) } : {}),
    ...(String(metadata.batchJobId ?? "").trim() ? { batchJobId: String(metadata.batchJobId).trim() } : {}),
    userEdited: false
  };

  const createdFacets = next.facetCatalog.facets.filter((item) => !beforeFacetIds.has(item.id)).map((item) => structuredClone(item));
  const createdNodes = next.facetCatalog.nodes.filter((item) => !beforeNodeIds.has(item.id)).map((item) => structuredClone(item));
  return {
    state: next,
    appliedCount: tagged.appliedCount,
    undo: {
      entryId,
      ...(visualId ? { visualId } : {}),
      previousVisionAnalysis,
      previousAssignments,
      createdFacets,
      createdNodes
    }
  };
}

export function undoVisionAnalysis(state = {}, undo = {}) {
  const next = structuredClone(state);
  next.facetCatalog = normalizeFacetCatalog(next.facetCatalog);
  const entry = next.entries?.find((item) => item.id === undo.entryId);
  if (!entry || !Array.isArray(undo.previousAssignments)) throw new Error("这条案例没有可撤回的图片分析");
  const visualId = String(undo.visualId ?? "").trim();
  entry.facetAssignments = dedupeAssignments([
    ...(entry.facetAssignments ?? []).filter((item) => item.source !== "vision_model" || (visualId && item.visualId !== visualId)),
    ...undo.previousAssignments
  ]);
  if (undo.previousVisionAnalysis) entry.visionAnalysis = structuredClone(undo.previousVisionAnalysis);
  else delete entry.visionAnalysis;
  cleanupCreatedVisionVocabulary(next, undo);
  return next;
}

export function editVisionDescription(entry = {}, description) {
  if (!entry.visionAnalysis || entry.visionAnalysis.invalidated) throw new Error("这条案例还没有可编辑的画面描述");
  const value = String(description ?? "").trim();
  if (!value) throw new Error("画面描述不能为空");
  return { ...entry, visionAnalysis: { ...entry.visionAnalysis, description: value, userEdited: true } };
}

export function invalidateVisionForScreenshot(entry = {}) {
  const previousAssignments = (entry.facetAssignments ?? []).filter((item) => item.source === "vision_model");
  const previousVisionAnalysis = entry.visionAnalysis ? structuredClone(entry.visionAnalysis) : null;
  const next = {
    ...entry,
    facetAssignments: (entry.facetAssignments ?? []).filter((item) => item.source !== "vision_model")
  };
  delete next.visionAnalysis;
  return { entry: next, previousVisionAnalysis, previousAssignments };
}

export function restoreVisionAfterScreenshot(entry = {}, snapshot = {}) {
  const next = {
    ...entry,
    facetAssignments: dedupeAssignments([
      ...(entry.facetAssignments ?? []).filter((item) => item.source !== "vision_model"),
      ...(Array.isArray(snapshot.previousAssignments) ? snapshot.previousAssignments : [])
    ])
  };
  if (snapshot.previousVisionAnalysis) next.visionAnalysis = structuredClone(snapshot.previousVisionAnalysis);
  else delete next.visionAnalysis;
  return next;
}

export function applyAnalysisCandidates(state = {}, entryId, incoming = [], options = {}) {
  const reviewThreshold = Math.max(0, Math.min(1, Number(options.reviewThreshold ?? 0.55)));
  let next = structuredClone(state);
  next.facetCatalog = normalizeFacetCatalog(next.facetCatalog);
  let entry = next.entries?.find((item) => item.id === entryId);
  if (!entry) throw new Error("没有找到需要分析的案例");
  if (options.replaceExistingDeepSeek) {
    entry.facetAssignments = (entry.facetAssignments ?? []).filter((item) => item.source !== "deepseek_text");
    entry.analysisCandidates = (entry.analysisCandidates ?? []).filter((item) => item.source !== "deepseek_text");
  }
  let confirmedCount = 0;
  const pending = [];
  const proposals = sortAnalysisBreakdown(incoming);
  const priorBreakdown = Array.isArray(entry.analysisBreakdown) ? entry.analysisBreakdown : [];
  entry.analysisBreakdown = options.replaceExistingDeepSeek
    ? [...priorBreakdown.filter((item) => item?.source !== "deepseek_text"), ...proposals]
    : mergeBreakdown(priorBreakdown, proposals);
  const promotedKeys = new Set(proposals
    .filter((proposal) => proposal.decision !== "needs_review" && proposal.confidence >= reviewThreshold)
    .slice(0, MAX_PROMOTED_ANALYSIS_TAGS)
    .map(candidateKey));

  for (const proposal of proposals) {
    if (proposal.decision === "needs_review" || proposal.confidence < reviewThreshold) {
      pending.push(proposal);
      continue;
    }
    if (!promotedKeys.has(candidateKey(proposal))) continue;
    const materialized = materializeCandidate(next, entry.id, proposal, {
      source: proposal.source,
      confidence: proposal.confidence,
      evidence: proposal.evidence,
      importance: proposal.importance
    });
    if (!materialized) {
      pending.push(proposal);
      continue;
    }
    next = materialized;
    entry = next.entries.find((item) => item.id === entryId);
    confirmedCount += 1;
  }

  Object.assign(entry, mergeAnalysisCandidates(entry, pending));
  return { state: next, confirmedCount, suggestedCount: pending.length, retainedCount: proposals.length };
}

export function applyAnalysisImport(state = {}, payload = {}) {
  if (payload?.format === "prompt-case-library") {
    throw new Error("你选择的是资料库导出 library.json，不是整库分析 JSON；它用于其他本地程序读取，不能作为标签分析文件导入");
  }
  if (payload?.format && !["prompt-case-library-analysis", "prompt-case-candidate-import"].includes(payload.format)) {
    throw new Error("这不是受支持的整库分析 JSON");
  }
  if (!Array.isArray(payload?.entries)) throw new Error("分析文件格式无效");
  const policy = payload.policy ?? {};
  let next = structuredClone(state);
  if (policy.replaceCreativeVocabulary && !(next.entries ?? []).length) {
    throw new Error("当前案例库为空，分析 JSON 只有标签、没有原截图；请先恢复原案例库，再导入整库分析 JSON");
  }
  const knownIds = new Set((next.entries ?? []).map((entry) => entry.id));
  const resolvedEntries = resolveAnalysisEntries(next.entries ?? [], payload.entries);
  const resolvedIds = new Set(resolvedEntries.map((item) => item.entryId));
  if (policy.replaceCreativeVocabulary && resolvedEntries.length !== payload.entries.length) {
    throw new Error(`分析文件中的 ${payload.entries.length - resolvedEntries.length} 条案例无法对应当前案例库，已取消以避免标签错位`);
  }
  if (policy.replaceCreativeVocabulary) {
    const prepared = prepareFacetRebuild(next.entries, next.facetCatalog);
    next.facetCatalog = prepared.catalog;
    next.entries = prepared.entries;
  } else if (policy.replaceExistingCandidates) {
    next.entries = next.entries.map((entry) => resolvedIds.has(entry.id) ? { ...entry, analysisCandidates: [] } : entry);
  }

  let matchedCount = 0;
  let confirmedCount = 0;
  let suggestedCount = 0;
  for (const { item, entryId } of resolvedEntries) {
    matchedCount += 1;
    const current = next.entries.find((entry) => entry.id === entryId);
    if (Array.isArray(item.classificationPathIds) && item.classificationPathIds.length === 1 &&
      (current.classification?.status === "needs_review" || policy.replaceUncertainClassifications)) {
      current.classification = {
        pathIds: [...item.classificationPathIds],
        status: item.classificationDecision === "needs_review" ? "needs_review" : "confirmed",
        source: "auto",
        reason: "整库文字分析",
        classifierVersion: current.classification?.classifierVersion ?? CLASSIFIER_VERSION
      };
    }
    const applied = applyAnalysisCandidates(next, entryId, item.candidates, policy);
    next = applied.state;
    confirmedCount += applied.confirmedCount;
    suggestedCount += applied.suggestedCount;
  }
  return {
    state: next,
    matchedEntryIds: resolvedEntries.map((item) => item.entryId),
    matchedCount,
    unmatchedCount: Math.max(0, knownIds.size - resolvedIds.size),
    confirmedCount,
    suggestedCount
  };
}

function resolveAnalysisEntries(entries, importedEntries) {
  const currentById = new Map(entries.map((entry) => [entry.id, entry]));
  const lookups = [
    uniqueLookup(entries, (entry) => identityKey(entry, "savedAt")),
    uniqueLookup(entries, (entry) => identityKey(entry, "textUrl")),
    uniqueLookup(entries, (entry) => identityKey(entry, "textTitle")),
    uniqueLookup(entries, (entry) => identityKey(entry, "text")),
    uniqueLookup(entries, (entry) => identityKey(entry, "urlTitle")),
    uniqueLookup(entries, (entry) => identityKey(entry, "url")),
    uniqueLookup(entries, (entry) => identityKey(entry, "title"))
  ];
  const used = new Set();
  const result = [];
  for (const item of importedEntries) {
    const exactId = String(item?.entryId ?? item?.id ?? "");
    let entry = currentById.get(exactId);
    const match = item?.match ?? item;
    if (!entry || used.has(entry.id)) {
      entry = null;
      const modes = ["savedAt", "textUrl", "textTitle", "text", "urlTitle", "url", "title"];
      for (let index = 0; index < modes.length; index += 1) {
        const key = identityKey(match, modes[index]);
        const candidate = key ? lookups[index].get(key) : null;
        if (candidate && !used.has(candidate.id)) {
          entry = candidate;
          break;
        }
      }
    }
    if (!entry || used.has(entry.id)) continue;
    used.add(entry.id);
    result.push({ item, entryId: entry.id });
  }
  return result;
}

function uniqueLookup(entries, keyFor) {
  const lookup = new Map();
  for (const entry of entries) {
    const key = keyFor(entry);
    if (!key) continue;
    lookup.set(key, lookup.has(key) ? null : entry);
  }
  return lookup;
}

function identityKey(value, mode) {
  const title = normalizeIdentity(value?.title);
  const url = normalizeIdentity(value?.url);
  const text = normalizeIdentity(value?.text);
  if (mode === "savedAt") {
    const timestamp = Date.parse(String(value?.savedAt ?? ""));
    const content = text || url || title;
    return Number.isFinite(timestamp) && content ? `${timestamp}\n${content}` : "";
  }
  if (mode === "textUrl") return text && url ? `${text}\n${url}` : "";
  if (mode === "textTitle") return text && title ? `${text}\n${title}` : "";
  if (mode === "text") return text.length >= 20 ? text : "";
  if (mode === "urlTitle") return url && title ? `${url}\n${title}` : "";
  if (mode === "url") return url ? url : "";
  return title ? title : "";
}

function normalizeIdentity(value) {
  return String(value ?? "").normalize("NFKC").replace(/\\([\\`*{}\[\]()#+.!|_-])/g, "$1").replace(/\s+/g, " ").trim().toLocaleLowerCase("zh-CN");
}

export function acceptAnalysisCandidate(state = {}, entryId, candidateId, edits = {}) {
  let next = structuredClone(state);
  next.facetCatalog = normalizeFacetCatalog(next.facetCatalog);
  let entry = next.entries?.find((item) => item.id === entryId);
  const proposal = entry?.analysisCandidates?.find((item) => item.id === candidateId);
  if (!entry || !proposal) throw new Error("没有找到这条标签候选");
  const materialized = materializeCandidate(next, entry.id, { ...proposal, ...edits }, {
    source: "manual",
    confidence: 1,
    importance: 1,
    evidence: `${proposal.evidence}（人工确认）`
  });
  if (materialized) next = materialized;
  else entry.customLabels = uniqueNames([...(entry.customLabels ?? []), cleanName(edits.tagName ?? proposal.tagName)]);
  entry = next.entries.find((item) => item.id === entryId);
  entry.analysisCandidates = entry.analysisCandidates.filter((item) => item.id !== candidateId);
  return next;
}

export function rejectAnalysisCandidate(entry = {}, candidateId) {
  const target = entry.analysisCandidates?.find((item) => item.id === candidateId);
  if (!target) throw new Error("没有找到这条标签候选");
  return {
    ...entry,
    analysisCandidates: entry.analysisCandidates.filter((item) => item.id !== candidateId),
    rejectedCandidateKeys: uniqueNames([...(entry.rejectedCandidateKeys ?? []), target.fingerprint || candidateKey(target)])
  };
}

export function setManualAssignment(entry = {}, facetId, nodeId, selected) {
  const current = (entry.facetAssignments ?? []).filter((item) => item?.nodeId !== nodeId);
  if (selected) current.push({ facetId, nodeId, status: "confirmed", source: "manual", confidence: 1, importance: 1, evidence: "人工选择" });
  return { ...entry, facetAssignments: current };
}

function candidate(value) {
  const dimensionName = cleanName(value?.dimensionName);
  const groupName = cleanName(value?.groupName);
  const tagName = clip(cleanName(value?.tagName), 80);
  const evidence = clip(cleanName(value?.evidence), 240);
  if (!dimensionName || !tagName || !evidence) return null;
  return {
    id: cleanName(value?.id),
    dimensionName,
    groupName,
    tagName,
    evidence,
    source: ["structure", "local_image_review"].includes(value?.source) ? value.source : "deepseek_text",
    confidence: Math.max(0, Math.min(1, Number(value?.confidence ?? 0.7))),
    status: "suggested",
    decision: value?.decision === "needs_review" || value?.requiresReview === true ? "needs_review" : "confirmed",
    reviewReason: clip(cleanName(value?.reviewReason), 160),
    ...(Number.isFinite(Number(value?.importance))
      ? { importance: Math.max(0, Math.min(1, Number(value.importance))) }
      : {})
  };
}

function materializeCandidate(state, entryId, proposal, assignment = {}) {
  const tag = mapLegacyAnalysisCandidate(proposal);
  if (!tag) return null;
  return applyFixedAnalysisTags(state, entryId, [tag], {
    source: assignment.source ?? proposal.source,
    replaceExisting: false
  }).state;
}

function cleanupCreatedVisionVocabulary(state, undo) {
  const createdNodes = new Map((undo.createdNodes ?? []).map((item) => [item.id, item]));
  const usedNodeIds = new Set((state.entries ?? []).flatMap((entry) =>
    (entry.facetAssignments ?? []).map((item) => item.nodeId)
  ));
  const nodeDepth = (node) => node.parentId ? 1 : 0;
  for (const snapshot of [...createdNodes.values()].toSorted((left, right) => nodeDepth(right) - nodeDepth(left))) {
    const current = state.facetCatalog.nodes.find((item) => item.id === snapshot.id);
    if (!current || usedNodeIds.has(current.id) || !sameVocabularyItem(current, snapshot)) continue;
    const hasChildren = state.facetCatalog.nodes.some((item) => item.parentId === current.id && item.id !== current.id);
    if (!hasChildren) state.facetCatalog.nodes = state.facetCatalog.nodes.filter((item) => item.id !== current.id);
  }
  for (const snapshot of undo.createdFacets ?? []) {
    const current = state.facetCatalog.facets.find((item) => item.id === snapshot.id);
    const hasNodes = state.facetCatalog.nodes.some((item) => item.facetId === snapshot.id);
    if (current && !hasNodes && sameVocabularyItem(current, snapshot)) {
      state.facetCatalog.facets = state.facetCatalog.facets.filter((item) => item.id !== current.id);
    }
  }
  state.facetCatalog.revision += 1;
}

function sameVocabularyItem(left, right) {
  const comparable = (value) => ({
    ...value,
    aliases: value.aliases ?? [],
    patterns: value.patterns ?? [],
    fixed: value.fixed === true,
    protected: value.protected === true
  });
  return JSON.stringify(comparable(left)) === JSON.stringify(comparable(right));
}

function compareAnalysisCandidate(left, right) {
  const leftImportance = left.item.importance;
  const rightImportance = right.item.importance;
  if (leftImportance === undefined && rightImportance === undefined) return left.index - right.index;
  const importanceDifference = Number(rightImportance ?? -1) - Number(leftImportance ?? -1);
  if (importanceDifference) return importanceDifference;
  const confidenceDifference = right.item.confidence - left.item.confidence;
  return confidenceDifference || left.index - right.index;
}

function mergeBreakdown(current, incoming) {
  const byKey = new Map(normalizeAnalysisCandidates(current).map((item) => [candidateKey(item), item]));
  for (const item of incoming) byKey.set(candidateKey(item), item);
  return sortAnalysisBreakdown([...byKey.values()]);
}

function flattenJson(value, path, output) {
  if (Array.isArray(value)) {
    for (const item of value) flattenJson(item, path, output);
    return;
  }
  if (value && typeof value === "object") {
    for (const [key, child] of Object.entries(value)) flattenJson(child, [...path, key], output);
    return;
  }
  if (!path.length || value === null || value === undefined || typeof value === "boolean") return;
  const tagName = cleanName(String(value));
  if (!tagName || tagName.length > 80) return;
  output.push(candidate({
    dimensionName: path[0],
    groupName: path.length > 1 ? path.slice(1, -1).concat(path.at(-1)).join(" / ") : "",
    tagName,
    evidence: `JSON ${path.join(".")}: ${tagName}`,
    source: "structure",
    confidence: 1
  }));
}

function extractJsonObjects(text) {
  const fenced = [...text.matchAll(/```(?:json)?\s*([\s\S]*?)```/gi)].map((match) => match[1]);
  const balanced = [];
  let start = -1;
  let depth = 0;
  let quoted = false;
  let escaped = false;
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (quoted) {
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === '"') quoted = false;
      continue;
    }
    if (character === '"') quoted = true;
    else if (character === "{") { if (!depth) start = index; depth += 1; }
    else if (character === "}" && depth && !--depth && start >= 0) { balanced.push(text.slice(start, index + 1)); start = -1; }
  }
  return [...new Set([...fenced, ...balanced])];
}

function extractNamedSections(text) {
  const result = [];
  for (const raw of text.split(/\r?\n/)) {
    const match = raw.trim().match(/^(?:#{1,6}\s*)?([\p{L}][\p{L}\p{N} _/&-]{1,40})\s*[:：]\s*(.{1,120})$/u);
    if (!match) continue;
    const heading = cleanName(match[1]);
    const explicitHeading = /^\s*#{1,6}\s*/.test(raw);
    const upperCaseBlock = /[A-Z]/.test(heading) && heading === heading.toLocaleUpperCase("en-US");
    if (explicitHeading || upperCaseBlock) result.push({ heading, value: cleanName(match[2]) });
  }
  return result;
}

function candidateKey(item) {
  return [item.dimensionName, item.groupName, item.tagName].map(canonical).join("|");
}

function dedupeAssignments(values) {
  const byNode = new Map();
  for (const item of values) {
    const current = byNode.get(item.nodeId);
    if (!current || sourcePriority(item.source) > sourcePriority(current.source)) byNode.set(item.nodeId, item);
  }
  return [...byNode.values()];
}

function sourcePriority(source) {
  if (source === "manual") return 4;
  if (["vision_model", "local_image_review"].includes(source)) return 3;
  if (source === "deepseek_text") return 2;
  return 1;
}

function canonical(value) {
  return cleanName(value).toLocaleLowerCase("zh-CN").replace(/[\s._·—–-]+/g, "");
}

function clip(value, length) {
  return value.length <= length ? value : `${value.slice(0, length - 1)}…`;
}

function stableHash(value) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}
