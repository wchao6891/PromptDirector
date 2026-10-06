import { libraryFromNewerVersion, newerLibraryError } from './library-version-guard.js';
import { SCHEMA_VERSION, normalizeTaxonomy, contentRoleForEntry } from './taxonomy.js';
import { needsMigration } from './migration.js';
import { recoverFullyArchivedFacets } from './facets.js';
import { normalizeOrganizerState } from './organizer.js';
import { normalizeCompoundCases } from './compound-cases.js';
import { normalizeTrashState } from './trash.js';
import { normalizeSettings, defaultSettingsForLocale } from './lib.js';
import { normalizeUiPreferences, resolveLocale } from './preferences.js';
import { aiConfigurationFromStorage, aiConfigurationNeedsStorageUpdate, projectAiRuntime } from './ai-runtime.js';
import { publicAiSettings } from './deepseek.js';
import { publicVisionSettings } from './vision.js';
import { publicAiServiceProfiles } from './ai-service-profiles.js';
import { publicAiProviderRegistry } from './ai-provider-registry.js';
import { normalizeComposerSettings } from './composer.js';
import { normalizeCreativeExperimentSettings, normalizeCreativeRuns, normalizeActiveCreativeResult } from './creative-runs.js';
import { normalizeCreativeJobsState } from './creative-jobs.js';
import { normalizeCreativeSkillsState } from './creative-skills.js';
import { normalizeImportJobsState } from './import-jobs.js';
import { normalizeSyncSettings } from './sync-model.js';
import { facetUndoCount } from './facet-history.js';
import { normalizeAnalysisBatchJob, analysisBatchSummary, analysisRebuildRecovery } from './analysis-batch.js';
import { libraryMaintenanceSummary } from './library-maintenance.js';
import { validLibraryViewSummary } from './library-view-summary.js';

// One storage snapshot for everything used by gallery refresh. Large recovery
// copies, creative sessions and task histories are read by their own operations.
export const LIBRARY_VIEW_STORAGE_KEYS = Object.freeze([
  'schemaVersion', 'entries', 'libraryViewSummary', 'compoundCases', 'settings',
  'taxonomy', 'facetCatalog', 'classificationRules', 'organizerState',
  'uiPreferences', 'composerSettings', 'creativeExperimentSettings', 'importJobs',
  'aiProviderRegistry', 'aiTaskAssignments', 'aiPreferences', 'syncSettings',
  'batchJob', 'analysisBatchJob', 'libraryMaintenanceJob'
]);

export function libraryViewNeedsPreparation(stored) {
  return libraryCoreNeedsPreparation(stored) || !validLibraryViewSummary(stored.libraryViewSummary);
}

export function libraryCoreNeedsPreparation(stored) {
  const configuration = aiConfigurationFromStorage(stored);
  return needsMigration({ ...stored, trashState: stored.trashState ?? (stored.libraryViewSummary?.trashInitialized !== false ? { items: [] } : undefined) })
    || recoverFullyArchivedFacets(stored.facetCatalog).restoredFacetIds.length > 0
    || aiConfigurationNeedsStorageUpdate(stored, configuration)
    || (!stored.batchJob && Boolean(stored.analysisBatchJob));
}

export function createLibraryViewReader({ storage, prepare, uiLanguage, includeCreativeState = false }) {
  const keys = includeCreativeState ? [...LIBRARY_VIEW_STORAGE_KEYS,
    'composerSessionSummaries', 'creativeRuns', 'creativeJobs', 'creativeSkills', 'activeCreativeResult'] : LIBRARY_VIEW_STORAGE_KEYS;
  return async () => {
    let stored = await storage.get(keys);
    let restoredArchivedFacetCount = 0;
    if (libraryFromNewerVersion(stored)) throw newerLibraryError();
    if (libraryViewNeedsPreparation(stored) || (includeCreativeState && !Array.isArray(stored.composerSessionSummaries))) {
      const prepared = await prepare({ summaryOnly: !libraryCoreNeedsPreparation(stored), creativeSummary: includeCreativeState });
      if (!prepared?.ok) throw new Error(prepared?.message || '无法准备本地案例库');
      restoredArchivedFacetCount = prepared.restoredArchivedFacetCount || 0;
      // Repair keeps its established full backup/write path. Its response only
      // acknowledges completion; the page then reads one consistent snapshot.
      stored = await storage.get(keys);
      if (libraryCoreNeedsPreparation(stored)) {
        const repaired = await prepare({ summaryOnly: false, creativeSummary: includeCreativeState });
        if (!repaired?.ok) throw new Error(repaired?.message || '无法准备本地案例库');
        stored = await storage.get(keys);
      }
      if (libraryViewNeedsPreparation(stored)) throw new Error('资料库准备未完成，请重新打开案例库');
    }
    const state = projectLibraryViewState(stored, { uiLanguage, restoredArchivedFacetCount });
    return { ok: true, ...state,
      ...(includeCreativeState ? {
        composerSessionSummaries: stored.composerSessionSummaries || [],
        creativeRuns: normalizeCreativeRuns(stored.creativeRuns),
        creativeJobs: normalizeCreativeJobsState(stored.creativeJobs),
        creativeSkills: normalizeCreativeSkillsState(stored.creativeSkills),
        activeCreativeResult: normalizeActiveCreativeResult(stored.activeCreativeResult)
      } : {}),
      entries: enrichContentMeanings(state.entries, state.taxonomy) };
  };
}

// Shared with the background's full state projection: the page cannot silently
// diverge on tags, projects, settings, task progress or public AI capabilities.
export function projectLibraryViewState(stored, { aiConfiguration, uiLanguage, syncStatus = {}, restoredArchivedFacetCount = 0 } = {}) {
  const entries = Array.isArray(stored.entries) ? stored.entries : [];
  const uiPreferences = normalizeUiPreferences(stored.uiPreferences);
  const locale = resolveLocale(uiPreferences, uiLanguage);
  const configuration = aiConfiguration ?? aiConfigurationFromStorage(stored);
  const aiRuntime = projectAiRuntime(configuration);
  const batch = normalizeAnalysisBatchJob(stored.batchJob);
  const summary = validLibraryViewSummary(stored.libraryViewSummary) ? stored.libraryViewSummary : null;
  const staging = stored.analysisRebuildStaging ?? (summary ? {
    jobId: summary.analysisStaging.jobId,
    results: Object.fromEntries(summary.analysisStaging.entryIds.map(id => [id, true]))
  } : null);
  const textBatch = batch?.kind === 'text_tags'
    ? { ...analysisBatchSummary(batch), ...analysisRebuildRecovery(batch, staging) }
    : null;
  const undoCount = Object.hasOwn(stored, 'facetUndo') ? facetUndoCount(stored.facetUndo) : summary?.facetUndoCount || 0;
  return {
    schemaVersion: SCHEMA_VERSION,
    entries,
    ...(Object.hasOwn(stored, 'trashState') ? { trashState: normalizeTrashState(stored.trashState) } : {}),
    trashCount: stored.trashState?.items?.length ?? summary?.trashCount ?? 0,
    compoundCases: normalizeCompoundCases(stored.compoundCases, entries),
    taxonomy: stored.taxonomy,
    facetCatalog: stored.facetCatalog,
    classificationRules: stored.classificationRules,
    organizerState: normalizeOrganizerState(stored.organizerState, entries.map(entry => entry.id)),
    settings: normalizeSettings(stored.settings ?? {}, defaultSettingsForLocale(locale)),
    uiPreferences,
    aiSettings: publicAiSettings(aiRuntime.aiSettings),
    visionSettings: publicVisionSettings(aiRuntime.visionSettings),
    aiServiceProfiles: publicAiServiceProfiles(aiRuntime.aiServiceProfiles),
    aiProviderRegistry: publicAiProviderRegistry(configuration.registry),
    aiTaskAssignments: configuration.assignments,
    aiPreferences: configuration.preferences,
    composerSettings: normalizeComposerSettings(stored.composerSettings),
    creativeExperimentSettings: normalizeCreativeExperimentSettings(stored.creativeExperimentSettings),
    importJobs: normalizeImportJobsState(stored.importJobs),
    syncSettings: normalizeSyncSettings(stored.syncSettings),
    syncStatus,
    visionUndoEntryIds: Object.entries(stored.visionAnalysisUndo ?? {})
      .filter(([, undo]) => undo?.appliedVisionAnalysis && Array.isArray(undo.appliedAssignments) && Number.isInteger(undo.appliedCatalogRevision))
      .map(([entryId]) => entryId),
    pendingContentCount: entries.filter(entry => entry.classification?.status === 'needs_review').length,
    pendingSuggestionCount: entries.reduce((count, entry) => count + (Array.isArray(entry.analysisCandidates) ? entry.analysisCandidates : []).filter(item => item?.source && item.source !== "deepseek_text").length, 0),
    analysisPendingCount: entries.filter(entry => entry.analysisPending).length,
    canUndoFacetUpdate: undoCount > 0,
    facetUndoCount: undoCount,
    restoredArchivedFacetCount,
    analysisBatchJob: textBatch,
    maintenanceJob: libraryMaintenanceSummary(stored.libraryMaintenanceJob),
    visionBatchJob: ['vision', 'video'].includes(batch?.kind) ? analysisBatchSummary(batch) : null,
    canUndoAnalysisBatch: Boolean(textBatch && (stored.analysisBatchUndo?.jobId ?? summary?.analysisUndo.jobId) === textBatch.id
      && (stored.analysisBatchUndo?.appliedEntries?.length ?? summary?.analysisUndo.appliedEntryCount))
  };
}

export function enrichContentMeanings(entriesValue, taxonomy) {
  const normalizedTaxonomy = normalizeTaxonomy(taxonomy);
  const names = new Map(normalizedTaxonomy.nodes.map(item => [item.id, item.name]));
  const roles = new Map(normalizedTaxonomy.nodes.map(item => [item.id, item.role]));
  return (Array.isArray(entriesValue) ? entriesValue : []).map(entry => ({
    ...entry,
    contentRole: contentRoleForEntry(entry, normalizedTaxonomy, roles),
    contentTypeName: names.get(entry.classification?.pathIds?.[0]) || ''
  }));
}
