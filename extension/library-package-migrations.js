import { createDefaultFacetCatalog } from "./facets.js";
import { normalizeSettings } from "./lib.js";
import { CURRENT_LIBRARY_PACKAGE_VERSION, LIBRARY_PACKAGE_FORMAT, isSupportedLibraryPackageVersion } from "./library-package-format.js";
import { normalizePortablePackageLexemes } from "./library-package-contract.js";
import { migrateLibraryState } from "./migration.js";
import { SCHEMA_VERSION, createDefaultTaxonomy } from "./taxonomy.js";

const AI_ASSIGNMENT_SOURCES = new Set(["deepseek_text", "local_image_review", "vision_model"]);

export function prepareLibraryPackageDraft(value = {}) {
  if (!value || value.format !== LIBRARY_PACKAGE_FORMAT || !isSupportedLibraryPackageVersion(value.version) || !Array.isArray(value.entries)) {
    throw new Error("这个来源不是受支持的 PromptDirector 资料包");
  }

  const sourceVersion = value.version;
  const lexical = normalizePortablePackageLexemes(value);
  const diagnostics = [];
  const seenEntryIds = new Set();
  const entries = [];
  let droppedAiAssignments = 0;
  let droppedMediaDescriptors = 0;
  for (const entry of lexical.entries) {
    const entryId = clean(entry?.id);
    if (!entryId || seenEntryIds.has(entryId)) {
      diagnostics.push({
        code: "case_skipped_invalid_identity",
        severity: "case",
        action: "skipped",
        entryId,
        reason: entryId ? "duplicate_identity" : "missing_identity"
      });
      continue;
    }
    if (!hasRecoverableCaseContent(entry)) {
      diagnostics.push({
        code: "case_skipped_no_usable_content",
        severity: "case",
        action: "skipped",
        entryId,
        reason: "no_usable_content"
      });
      continue;
    }
    seenEntryIds.add(entryId);
    entries.push({ ...entry, id: entryId });
  }

  const sourceFacetIds = new Set((lexical.facetCatalog?.facets ?? []).map((item) => clean(item?.id)).filter(Boolean));
  const sourceNodeIds = new Set((lexical.facetCatalog?.nodes ?? []).map((item) => clean(item?.id)).filter(Boolean));
  const sourceVocabularyKnown = sourceFacetIds.size > 0 || sourceNodeIds.size > 0;
  const preSalvagedEntries = entries.map((entry) => {
    const mediaIds = new Set((Array.isArray(entry.mediaAssets) ? entry.mediaAssets : entry.visuals ?? [])
      .map((item) => clean(item?.id)).filter(Boolean));
    if (entry.hasScreenshot && clean(entry.id)) mediaIds.add(clean(entry.id));
    const facetAssignments = (Array.isArray(entry.facetAssignments) ? entry.facetAssignments : []).filter((assignment) => {
      if (!AI_ASSIGNMENT_SOURCES.has(assignment?.source)) return true;
      const missingVocabulary = sourceVocabularyKnown &&
        (!sourceFacetIds.has(clean(assignment.facetId)) || !sourceNodeIds.has(clean(assignment.nodeId)));
      const missingMedia = Boolean(clean(assignment.visualId)) && !mediaIds.has(clean(assignment.visualId));
      if (!missingVocabulary && !missingMedia) return true;
      droppedAiAssignments += 1;
      diagnostics.push(aiAssignmentDiagnostic(entry.id, missingVocabulary ? "missing_vocabulary" : "missing_media"));
      return false;
    });
    return { ...entry, facetAssignments };
  });
  const sourceMediaIdsByEntry = new Map(preSalvagedEntries.map((entry) => [entry.id, new Set(
    (Array.isArray(entry.mediaAssets) ? entry.mediaAssets : entry.visuals ?? [])
      .map((asset) => clean(asset?.id)).filter(Boolean)
  )]));

  const migrated = migrateLibraryState({
    ...lexical,
    schemaVersion: packageSchemaVersion(lexical),
    taxonomy: lexical.taxonomy ?? createDefaultTaxonomy(),
    facetCatalog: lexical.facetCatalog ?? createDefaultFacetCatalog(),
    entries: preSalvagedEntries
  }).state;
  migrated.entries = migrated.entries.map((entry) => {
    const facetIds = new Set(migrated.facetCatalog.facets.map((item) => item.id));
    const nodeIds = new Set(migrated.facetCatalog.nodes.map((item) => item.id));
    const mediaIds = new Set(entry.mediaAssets.map((item) => item.id));
    for (const assetId of sourceMediaIdsByEntry.get(entry.id) ?? []) {
      if (mediaIds.has(assetId)) continue;
      droppedMediaDescriptors += 1;
      diagnostics.push({
        code: "media_descriptor_dropped",
        severity: "media",
        action: "dropped",
        entryId: entry.id,
        assetId,
        reason: "invalid_descriptor"
      });
    }
    const kept = [];
    for (const assignment of entry.facetAssignments ?? []) {
      const missingVocabulary = !facetIds.has(assignment.facetId) || !nodeIds.has(assignment.nodeId);
      const missingMedia = Boolean(assignment.visualId) && !mediaIds.has(assignment.visualId);
      if (AI_ASSIGNMENT_SOURCES.has(assignment.source) && (missingVocabulary || missingMedia)) {
        droppedAiAssignments += 1;
        diagnostics.push(aiAssignmentDiagnostic(entry.id, missingVocabulary ? "missing_vocabulary" : "missing_media"));
        continue;
      }
      kept.push(assignment);
    }
    return { ...entry, facetAssignments: kept };
  });

  return {
    sourceVersion,
    draft: {
      ...lexical,
      ...migrated,
      format: LIBRARY_PACKAGE_FORMAT,
      version: CURRENT_LIBRARY_PACKAGE_VERSION,
      schemaVersion: SCHEMA_VERSION,
      settings: normalizeSettings(lexical.settings)
    },
    diagnostics,
    stats: {
      inputCases: lexical.entries.length,
      keptCases: migrated.entries.length,
      skippedCases: lexical.entries.length - migrated.entries.length,
      droppedAiAssignments,
      droppedMediaDescriptors
    }
  };
}

function aiAssignmentDiagnostic(entryId, reason) {
  return {
    code: "ai_assignment_dropped",
    severity: "metadata",
    action: "dropped",
    entryId,
    reason
  };
}

function packageSchemaVersion(value = {}) {
  if (Number.isInteger(value.schemaVersion)) return value.schemaVersion;
  const versions = value.entries.map((entry) => Number(entry?.schemaVersion)).filter(Number.isInteger);
  return versions.length ? Math.min(...versions) : 0;
}

function hasRecoverableCaseContent(entry = {}) {
  if ([entry.title, entry.text, entry.note, entry.url].some((value) => clean(value))) return true;
  if ((Array.isArray(entry.mediaAssets) ? entry.mediaAssets : entry.visuals ?? []).some((asset) => asset && typeof asset === "object")) {
    return true;
  }
  return (entry.articleDocument?.blocks ?? []).some((block) => clean(block?.text) || clean(block?.assetId));
}

function clean(value) {
  return String(value ?? "").replace(/[\u0000-\u001f\u007f]/g, "").trim();
}
