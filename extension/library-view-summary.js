import { facetUndoCount } from './facet-history.js';

export const LIBRARY_VIEW_SUMMARY_KEY = 'libraryViewSummary';
export const LIBRARY_VIEW_SUMMARY_SOURCES = Object.freeze(['facetUndo', 'trashState', 'analysisBatchUndo', 'analysisRebuildStaging']);

export function composerSessionSummaries(values) {
  return (Array.isArray(values) ? values : []).map(session => ({
    id: session.id, title: session.title, targetType: session.targetType, updatedAt: session.updatedAt,
    referenceCount: session.referenceSnapshots?.length || 0, hasPrompt: Boolean(session.promptVersions?.length)
  }));
}

// Small derived values share the exact commit of their source. They never
// replace recovery data or the user's trash; those are loaded on demand.
export function updateLibraryViewSummary(previous, update) {
  const summary = { ...(previous?.version === 1 ? previous : {}), version: 1 };
  if (Object.hasOwn(update, 'facetUndo')) summary.facetUndoCount = facetUndoCount(update.facetUndo);
  if (Object.hasOwn(update, 'trashState')) { summary.trashCount = update.trashState?.items?.length || 0; summary.trashInitialized = Boolean(update.trashState); }
  if (Object.hasOwn(update, 'analysisBatchUndo')) summary.analysisUndo = {
    jobId: update.analysisBatchUndo?.jobId || '', appliedEntryCount: update.analysisBatchUndo?.appliedEntries?.length || 0
  };
  if (Object.hasOwn(update, 'analysisRebuildStaging')) summary.analysisStaging = {
    jobId: update.analysisRebuildStaging?.jobId || '', entryIds: Object.keys(update.analysisRebuildStaging?.results || {})
  };
  return summary;
}

export function completeLibraryViewSummary(stored) {
  return updateLibraryViewSummary(null, Object.fromEntries(LIBRARY_VIEW_SUMMARY_SOURCES.map(key => [key, stored[key]])));
}

export function validLibraryViewSummary(value) {
  return value?.version === 1 && Number.isSafeInteger(value.facetUndoCount) && Number.isSafeInteger(value.trashCount)
    && value.analysisUndo && Array.isArray(value.analysisStaging?.entryIds);
}
