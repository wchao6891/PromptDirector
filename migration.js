import { CLASSIFIER_VERSION, classifyContent, classifyImportedMedia } from "./classifier.js";
import { createDefaultFacetCatalog, normalizeFacetCatalog, uniqueNames } from "./facets.js";
import { CONTENT_IDS, SCHEMA_VERSION, isValidContentPath, normalizeTaxonomy } from "./taxonomy.js";
import { ORGANIZER_VERSION, normalizeOrganizerState } from "./organizer.js";
import { sortAnalysisBreakdown } from "./analysis-candidates.js";
import { normalizeEntryVisuals } from "./visuals.js";
import { normalizeCompoundCases } from "./compound-cases.js";
import { isFixedTagTree, migrateLegacyFacetState } from "./tag-taxonomy.js";
import { normalizeTrashState } from "./trash.js";

const LEGACY_CONTENT_IDS = new Set([
  "content:tutorial:image", "content:tutorial:video", "content:tutorial:general"
]);

export function migrateLibraryState(stored = {}) {
  const backup = structuredClone(stored);
  const resetRequired = !Number.isInteger(stored.schemaVersion) || stored.schemaVersion < 5;
  const taxonomy = normalizeTaxonomy(stored.taxonomy);
  const sourceFacetCatalog = resetRequired
    ? { facets: [], nodes: [] }
    : normalizeFacetCatalog(stored.facetCatalog);
  const classificationRules = normalizeRules(stored.classificationRules, taxonomy);
  const legacyNodes = new Map((stored.taxonomy?.nodes ?? []).map((item) => [item.id, item]));
  const legacyFacetNodes = new Map((stored.facetCatalog?.nodes ?? []).map((item) => [item.id, item]));
  let entries = (Array.isArray(stored.entries) ? stored.entries : []).map((entry) =>
    migrateEntry(entry, classificationRules, taxonomy, resetRequired, legacyNodes, legacyFacetNodes)
  );
  let facetCatalog;
  let facetTreeMigrated = false;
  if (resetRequired) {
    facetCatalog = createDefaultFacetCatalog();
  } else if (!isFixedTagTree(sourceFacetCatalog)) {
    const migrated = migrateLegacyFacetState(entries, sourceFacetCatalog, { preserveDeepSeek: true });
    facetCatalog = migrated.catalog;
    entries = migrated.entries;
    facetTreeMigrated = true;
  } else {
    facetCatalog = sourceFacetCatalog;
  }
  return {
    state: {
      ...stored,
      schemaVersion: SCHEMA_VERSION,
      taxonomy,
      facetCatalog,
      classificationRules,
      entries,
      trashState: normalizeTrashState(stored.trashState),
      compoundCases: normalizeCompoundCases(stored.compoundCases, entries),
      organizerState: normalizeOrganizerState(stored.organizerState, entries.map((entry) => entry.id))
    },
    backup,
    migratedCount: entries.filter((entry, index) => stored.entries?.[index]?.schemaVersion !== SCHEMA_VERSION).length,
    resetPerformed: resetRequired && hasExistingLibrary(stored),
    facetTreeMigrated
  };
}

export function needsMigration(stored = {}) {
  return stored.schemaVersion !== SCHEMA_VERSION || !stored.taxonomy || !stored.facetCatalog ||
    !stored.organizerState || stored.organizerState.version !== ORGANIZER_VERSION || !stored.trashState || !Array.isArray(stored.compoundCases) ||
    !isFixedTagTree(stored.facetCatalog) ||
    (stored.entries ?? []).some((entry) => entry.schemaVersion !== SCHEMA_VERSION);
}

function migrateEntry(entry, rules, taxonomy, resetRequired, legacyNodes, legacyFacetNodes) {
  const currentClassification = collapseClassification(entry.classification, taxonomy);
  const classification = migratedClassification(entry, currentClassification, rules, taxonomy);
  const labels = separateImportedMetadata(entry);
  if (!resetRequired) {
    return normalizeEntryVisuals({
      ...entry,
      schemaVersion: SCHEMA_VERSION,
      classification,
      facetAssignments: normalizeAssignments(entry.facetAssignments),
      analysisCandidates: keepNonTextAnalysis(entry.analysisCandidates),
      analysisBreakdown: sortAnalysisBreakdown(keepNonTextAnalysis(entry.analysisBreakdown)),
      rejectedCandidateKeys: uniqueNames(entry.rejectedCandidateKeys),
      negativeTerms: uniqueNames(entry.negativeTerms),
      customLabels: labels.customLabels,
      metadataLabels: labels.metadataLabels,
      analysisMeta: normalizeAnalysisMeta(entry.analysisMeta),
      visionAnalysis: normalizeVisionAnalysis(entry.visionAnalysis),
      curatedOrigin: normalizeCuratedOrigin(entry.curatedOrigin)
    });
  }
  const legacyFacetCandidates = uniqueNames([
    ...(entry.legacyTags ?? []),
    ...(entry.tagIds ?? []).map((id) => legacyNodes.get(id)?.name),
    ...(entry.manualTags ?? []),
    ...(entry.facetAssignments ?? []).filter((item) => item?.source === "manual").map((item) => legacyFacetNodes.get(item.nodeId)?.name)
  ]);
  const {
    autoTags: _autoTags, manualTags: _manualTags, excludedAutoTags: _excludedAutoTags,
    classificationVersion: _classificationVersion, tagIds: _tagIds, legacyTags: _legacyTags,
    ...preserved
  } = entry;
  return normalizeEntryVisuals({
    ...preserved,
    schemaVersion: SCHEMA_VERSION,
    classification,
    facetAssignments: [],
    analysisCandidates: [],
    analysisBreakdown: [],
    rejectedCandidateKeys: [],
    negativeTerms: uniqueNames(entry.negativeTerms),
    customLabels: labels.customLabels,
    metadataLabels: labels.metadataLabels,
    legacyFacetCandidates,
    analysisPending: true,
    analysisMeta: null
  });
}

function separateImportedMetadata(entry = {}) {
  const customLabels = uniqueNames(entry.customLabels);
  const metadataLabels = uniqueNames(entry.metadataLabels);
  if ((Number(entry.schemaVersion) || 0) >= 24) return { customLabels, metadataLabels };
  const hostname = sourceHostname(entry);
  const imported = [];
  if (hostname === "higgsfield.ai" && String(entry.id ?? "").startsWith("higgsfield-")) {
    if (customLabels.includes("Higgsfield Community")) {
      imported.push(...customLabels.filter((label) =>
        label === "Higgsfield Community" || /^(?:作者|模型|氛围板|水印)：/.test(label)
      ));
    }
  } else if (hostname === "mp.weixin.qq.com" && String(entry.id ?? "").startsWith("entry:wechat:")) {
    const modelIndex = customLabels.findIndex((label) => label === "Midjourney");
    const issueIndex = customLabels.findIndex((label) => /^Vol\.\d+$/i.test(label));
    if (modelIndex === 1 && issueIndex === 2) imported.push(customLabels[0], customLabels[modelIndex], customLabels[issueIndex]);
  }
  const importedSet = new Set(imported.filter(Boolean));
  return {
    customLabels: customLabels.filter((label) => !importedSet.has(label)),
    metadataLabels: uniqueNames([...metadataLabels, ...importedSet])
  };
}

function sourceHostname(entry) {
  const values = [entry.url, ...(entry.sourcePages ?? []).map((source) => source?.url)];
  for (const value of values) {
    try {
      const hostname = new URL(String(value ?? "")).hostname.toLocaleLowerCase("en-US");
      if (hostname) return hostname;
    } catch { /* Ignore malformed historical source URLs. */ }
  }
  return "";
}

function migratedClassification(entry, current, rules, taxonomy) {
  if (shouldRepairLocalImport(entry)) {
    return classifyImportedMedia({ ...entry, classification: current }, taxonomy);
  }
  if (current?.status === "needs_review" && current.source === "auto") {
    const reconsidered = classifyContent({ ...entry, classification: null }, rules, taxonomy);
    if (reconsidered.status === "confirmed") return reconsidered;
  }
  return current ?? classifyContent(entry, rules, taxonomy);
}

function shouldRepairLocalImport(entry) {
  if ((Number(entry?.schemaVersion) || 0) >= SCHEMA_VERSION) return false;
  if (String(entry?.url ?? "").trim()) return false;
  if (entry?.classification?.source === "manual") return false;
  return (Array.isArray(entry?.mediaAssets) ? entry.mediaAssets : entry?.visuals ?? [])
    .some((asset) => asset?.usage !== "poster" && asset?.storageMode !== "reference" &&
      ["image", "video", "document"].includes(asset?.kind));
}

function keepNonTextAnalysis(values) {
  return (Array.isArray(values) ? values : []).filter((item) =>
    item?.source && item.source !== "deepseek_text"
  );
}

function normalizeAnalysisMeta(value) {
  if (!value || typeof value !== "object") return null;
  const textFingerprint = String(value.textFingerprint ?? "").trim();
  const textRevision = Math.max(1, Math.floor(Number(value.textRevision) || 1));
  const promptVersion = Math.max(0, Number(value.promptVersion) || 0);
  if ((!textFingerprint && !textRevision) || !promptVersion) return null;
  const usage = value.usage && typeof value.usage === "object"
    ? Object.fromEntries(["promptTokens", "completionTokens", "totalTokens", "cacheHitTokens", "cacheMissTokens"]
      .map((key) => [key, Math.max(0, Number(value.usage[key]) || 0)]))
    : undefined;
  return {
    ...(textFingerprint ? { textFingerprint } : {}),
    textRevision,
    promptVersion,
    model: String(value.model ?? "").trim(),
    analyzedAt: String(value.analyzedAt ?? "").trim(),
    profileFingerprint: String(value.profileFingerprint ?? "").trim(),
    ...(usage ? { usage } : {})
  };
}

function normalizeAssignments(values) {
  const byNode = new Map();
  for (const item of Array.isArray(values) ? values : []) {
    if (!item?.facetId || !item?.nodeId) continue;
    byNode.set(String(item.nodeId), {
      facetId: String(item.facetId), nodeId: String(item.nodeId),
      status: item.status === "suggested" ? "suggested" : "confirmed",
      source: ["manual", "structure", "deepseek_text", "local_image_review", "vision_model", "migration"].includes(item.source) ? item.source : "migration",
      confidence: Math.max(0, Math.min(1, Number(item.confidence ?? 0))),
      evidence: String(item.evidence ?? "迁移保留").trim(),
      ...(String(item.visualId ?? "").trim() ? { visualId: String(item.visualId).trim() } : {}),
      ...(Number.isFinite(Number(item.importance))
        ? { importance: Math.max(0, Math.min(1, Number(item.importance))) }
        : {})
    });
  }
  return [...byNode.values()];
}

function normalizeVisionAnalysis(value) {
  if (!value || typeof value !== "object") return undefined;
  const description = String(value.description ?? "").trim();
  if (!description) return undefined;
  const usage = value.usage && typeof value.usage === "object"
    ? Object.fromEntries(["inputTokens", "outputTokens", "totalTokens"]
      .map((key) => [key, Math.max(0, Number(value.usage[key]) || 0)]))
    : undefined;
  return {
    version: Math.max(1, Number(value.version) || 1),
    description,
    locale: value.locale === "en" ? "en" : "zh-CN",
    imageFingerprint: String(value.imageFingerprint ?? "").trim(),
    analyzedAt: String(value.analyzedAt ?? "").trim(),
    providerType: value.providerType === "compatible" ? "compatible" : "openai",
    model: String(value.model ?? "").trim(),
    ...(usage ? { usage } : {}),
    ...(String(value.batchJobId ?? "").trim() ? { batchJobId: String(value.batchJobId).trim() } : {}),
    userEdited: value.userEdited === true,
    ...(value.invalidated === true ? { invalidated: true } : {})
  };
}

function normalizeCuratedOrigin(value) {
  if (!value || typeof value !== "object") return undefined;
  const required = ["catalogId", "packageId", "packageVersion", "author", "license"];
  const normalized = Object.fromEntries(required.map((key) => [key, String(value[key] ?? "").trim()]));
  if (required.some((key) => !normalized[key])) return undefined;
  const installedAt = String(value.installedAt ?? "").trim();
  const sourceEntryId = String(value.sourceEntryId ?? "").trim();
  return {
    ...normalized,
    ...(sourceEntryId ? { sourceEntryId } : {}),
    ...(installedAt && !Number.isNaN(Date.parse(installedAt))
      ? { installedAt: new Date(installedAt).toISOString() }
      : {})
  };
}

function normalizeRules(value, taxonomy) {
  const rules = (Array.isArray(value) ? value : []).flatMap((rule) => {
    const pathIds = collapseContentPath(rule?.pathIds, taxonomy);
    if (!rule?.hostname || !pathIds.length) return [];
    return [{ hostname: String(rule.hostname).toLocaleLowerCase("en-US"), pathIds, enabled: rule.enabled !== false }];
  });
  return [...new Map(rules.map((rule) => [rule.hostname, rule])).values()];
}

function collapseClassification(value, taxonomy) {
  if (!value) return null;
  if (value.status === "needs_review") {
    return { pathIds: [], status: "needs_review", source: validSource(value.source), reason: String(value.reason ?? "保留待确认状态"), classifierVersion: CLASSIFIER_VERSION };
  }
  const pathIds = collapseContentPath(value.pathIds, taxonomy);
  return pathIds.length ? {
    pathIds, status: "confirmed", source: validSource(value.source),
    reason: String(value.reason ?? "保留原有主分类"), classifierVersion: CLASSIFIER_VERSION
  } : null;
}

function collapseContentPath(pathIds, taxonomy) {
  if (isValidContentPath(taxonomy, pathIds)) return [...pathIds];
  const ids = new Set(Array.isArray(pathIds) ? pathIds : []);
  if (ids.has(CONTENT_IDS.promptImage)) return [CONTENT_IDS.promptImage];
  if (ids.has(CONTENT_IDS.promptVideo)) return [CONTENT_IDS.promptVideo];
  if (ids.has(CONTENT_IDS.imageCase)) return [CONTENT_IDS.imageCase];
  if (ids.has(CONTENT_IDS.videoCase)) return [CONTENT_IDS.videoCase];
  if (ids.has(CONTENT_IDS.reference)) return [CONTENT_IDS.reference];
  if (ids.has(CONTENT_IDS.tutorial) || [...LEGACY_CONTENT_IDS].some((id) => ids.has(id))) return [CONTENT_IDS.tutorial];
  return [];
}

function validSource(value) {
  return ["auto", "manual", "source_rule", "local_import"].includes(value) ? value : "auto";
}

function hasExistingLibrary(stored) {
  return Boolean(stored.schemaVersion || stored.taxonomy || (stored.entries ?? []).length);
}
