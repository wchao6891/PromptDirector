import { createComposerWorkspaceTools } from './composer-workspace-tools.js';
import { readComposerCuratedCatalog } from './composer-curated-tools.js';
import { createComposerLibraryTools } from './composer-library-tools.js';
import { COMPOSER_INPUT_MAX_CHARACTERS } from './composer.js';
import { entryMediaAssets } from './media.js';
import { materializeLogicalCases, normalizeCompoundCases } from './compound-cases.js';
import { getDerivedMedia, getAllDerivedMetadata, getMediaBlob } from './media-store.js';
import { getScreenshotBlob } from './image-store.js';
import { blobToDataUrl } from './vision.js';
import { buildSearchIndex } from './search-index.js';

// This loader runs only after an actual native tool call. Files and credentials never enter search results.
export function createLocalComposerLibraryTools(options) {
  const caseTools = createComposerLibraryTools({
    ...options,
    maxCharacters: COMPOSER_INPUT_MAX_CHARACTERS,
    loadLibrary: async ({ name, args, signal }) => {
      const state = await chrome.runtime.sendMessage({ type: 'GET_STATE' });
      if (!state?.ok) throw new Error(state?.message || '无法读取案例库');
      const entries = materializeLogicalCases(state.entries, normalizeCompoundCases(state.compoundCases, state.entries));
      signal?.throwIfAborted();
      const needsIndex = name === 'search_cases';
      const documentEntries = needsIndex ? entries : args.part === 'document' ? entries.filter(entry => entry.id === args.caseId) : [];
      const ids = [...new Set(documentEntries.flatMap(entry => entryMediaAssets(entry)).filter(asset => asset.kind === 'document').map(asset => asset.id))];
      const documents = new Map(await Promise.all(ids.map(async id => [id, (await getDerivedMedia(id))?.searchText || ''])));
      const documentTextByEntryId = new Map(documentEntries.map(entry => [entry.id, entryMediaAssets(entry).map(asset => documents.get(asset.id)).filter(Boolean).join('\n')]));
      return { entries, documentTextByEntryId, organizerState: state.organizerState, facetCatalog: state.facetCatalog,
        searchIndex: needsIndex ? buildSearchIndex(entries, state.facetCatalog, documents, await getAllDerivedMetadata()) : undefined };
    },
    readImage: async (id, signal) => {
      signal?.throwIfAborted();
      const blob = await getMediaBlob(id) ?? await getScreenshotBlob(id);
      if (!blob) throw new Error('指定图片已不存在');
      return { dataUrl: await blobToDataUrl(blob), mimeType: blob.type };
    }
  });
  return createComposerWorkspaceTools({ ...options, caseTools, loadState: async () => {
    const state = await chrome.runtime.sendMessage({type:'GET_STATE'});
    if (!state?.ok) throw new Error(state?.message || '无法读取插件资料');
    return state;
  }, loadCurated: readComposerCuratedCatalog });
}
