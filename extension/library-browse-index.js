import { materializeLogicalCases } from './compound-cases.js';
import { entryMediaAssets } from './media.js';
import { caseListMetadata } from './library-list.js';
import { sortLibraryCases } from './library-view.js';

export const BROWSE_PROJECTION_VERSION = 1;
export const BROWSE_PROJECTION_META_KEY = 'caseViewMeta';
export const caseBrowseKey = id => `caseView:${id}`;

// Disposable browse metadata, never a replacement for a case record. Keep the inputs to the
// existing logical-case and table comparators, not localized labels or original content.
export function caseBrowseProjection(entry = {}) {
  const projected = pick(entry, ['id', 'title', 'url', 'savedAt', 'libraryAddedAt', 'libraryUpdatedAt', 'updatedAt']);
  if (entry.classification) projected.classification = pick(entry.classification, ['pathIds', 'status']);
  if (Array.isArray(entry.contentTypeIds)) projected.contentTypeIds = [...entry.contentTypeIds];
  projected.customLabels = [...(entry.customLabels ?? [])];
  projected.facetAssignments = (entry.facetAssignments ?? []).map(item => pick(item, ['facetId', 'nodeId', 'status']));
  // isEntryPending only needs to know whether a reusable candidate exists.
  const pending = (entry.analysisCandidates ?? []).find(item => item?.source && item.source !== 'deepseek_text');
  projected.analysisCandidates = pending ? [{ source: pending.source }] : [];
  projected.mediaAssets = entryMediaAssets(entry).map(asset => {
    const media = pick(asset, ['id', 'kind', 'usage', 'byteSize', 'mimeType', 'sourceFormat', 'sourceTitle',
      'storageMode', 'formatCategory', 'recordType', 'linkStatus']);
    // The shared compound materializer validates uncommon local attachments too.
    if (asset.importFailure) media.importFailure = pick(asset.importFailure, ['code', 'message']);
    return media;
  });
  return projected;
}

export function sortBrowseCases(entries = [], compoundCases = [], options = {}) {
  // The full library establishes this exact stable base order before applying its active sort.
  // Raw savedAt strings matter here: replacing them with parsed dates changes equal-key ties.
  const logical = materializeLogicalCases(entries, compoundCases)
    .sort((left, right) => String(right.savedAt).localeCompare(String(left.savedAt)));
  const tagNames = new Map((options.facetCatalog?.nodes ?? []).map(node => [node.id, node.name]));
  return sortLibraryCases(logical, {
    mode: options.mode,
    projectEntryIds: options.projectEntryIds,
    columnValues: entry => caseListMetadata(entry, {
      typeLabel: options.typeLabel?.(entry) ?? '',
      tagNames: [...(entry.customLabels ?? []), ...(entry.facetAssignments ?? [])
        .filter(item => item.status === 'confirmed').map(item => tagNames.get(item.nodeId)).filter(Boolean)]
    })
  });
}

function pick(value, keys) {
  return Object.fromEntries(keys.filter(key => value[key] !== undefined)
    .map(key => [key, structuredClone(value[key])]));
}
