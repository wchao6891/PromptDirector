import { applyVisionAnalysis } from './analysis-candidates.js';
import { updateEntryVisual } from './visuals.js';
import { normalizeEntryMedia, replaceCurrentVideoReconstruction } from './media.js';
import { applyFixedAnalysisTags } from './tag-taxonomy.js';
import { VISUAL_ANALYSIS_VERSION } from './visual-analysis.js';

export function applyCompletedImageResult(state, entry, visual, result, metadata = {}) {
  const analysisState = { ...state, entries: state.entries.map(item => item.id === entry.id
    ? { ...item, visionAnalysis: visual?.visionAnalysis } : item) };
  const applied = applyVisionAnalysis(analysisState, entry.id, result, { version: VISUAL_ANALYSIS_VERSION, visualId: visual.id, ...metadata });
  const analyzed = applied.state.entries.find(item => item.id === entry.id);
  const visionAnalysis = analyzed.visionAnalysis;
  delete analyzed.visionAnalysis;
  const normalized = updateEntryVisual(analyzed, visual.id, item => ({ ...item, contentHash: metadata.imageFingerprint, visionAnalysis }));
  applied.state.entries = applied.state.entries.map(item => item.id === entry.id ? normalized : item);
  return applied;
}

export function applyCompletedVideoResult(state, entry, asset, record) {
  let updated = replaceCurrentVideoReconstruction(entry, asset.id, record);
  const preserved = (updated.facetAssignments ?? []).filter(item => item.source !== 'vision_model' || item.visualId !== asset.id);
  const entryIndex = state.entries.findIndex(item => item.id === entry.id);
  const input = { ...state, entries: state.entries.map((item, index) => index === entryIndex ? { ...updated, facetAssignments: preserved } : item) };
  const applied = applyFixedAnalysisTags(input, entry.id, record.tags, { source: 'vision_model', maxTags: 8, replaceExisting: false });
  updated = normalizeEntryMedia(applied.state.entries[entryIndex]);
  updated.facetAssignments = updated.facetAssignments.map((item, index) => index >= preserved.length && item.source === 'vision_model'
    ? { ...item, visualId: asset.id } : item);
  applied.state.entries[entryIndex] = updated;
  return applied;
}
