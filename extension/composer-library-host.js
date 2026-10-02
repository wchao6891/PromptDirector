import { createLibraryViewReader } from './library-view-state.js';
import { getLibraryStorage } from './library-storage.js';
import { createComposerWorkspaceTools } from './composer-workspace-tools.js';
import { readComposerCuratedCatalog } from './composer-curated-tools.js';
import { createComposerLibraryTools } from './composer-library-tools.js';
import { entryMediaAssets } from './media.js';
import { materializeLogicalCases, normalizeCompoundCases } from './compound-cases.js';
import { getDerivedMedia, getAllDerivedMetadata, getMediaBlob } from './media-store.js';
import { getScreenshotBlob } from './image-store.js';
import { blobToDataUrl } from './vision.js';
import { createSearchIndexCache } from './search-index.js';
import { filterCaseSearchEntries } from './case-search.js';
import { withComposerCaseOperations } from './composer-case-operations.js';
import {sha256Blob} from './blob-digest.js';
import { createComposerToolProgress } from './composer-tool-progress.js';
import { operationBudget, resourceBudgetError } from './resource-policy.js';

const searchCache = createSearchIndexCache();

// This loader runs only after an actual native tool call. Files and credentials never enter search results.
export function createLocalComposerLibraryTools(options) {
  const caseTools = createComposerLibraryTools({
    ...options,
    loadLibrary: async ({ name, args, signal }) => {
      const state = await readWorkspaceLibraryState();
      if (!state?.ok) throw new Error(state?.message || '无法读取案例库');
      const entries = materializeLogicalCases(state.entries, normalizeCompoundCases(state.compoundCases, state.entries));
      signal?.throwIfAborted();
      const needsIndex = name === 'search_cases';
      const { minDurationMs, maxDurationMs, hasOriginalPrompt, ...indexScope } = args;
      if (needsIndex) filterCaseSearchEntries([], state.organizerState, args);
      const scoped = needsIndex ? filterCaseSearchEntries(entries, state.organizerState, indexScope) : entries;
      const documentEntries = needsIndex ? scoped : args.part === 'document' ? entries.filter(entry => entry.id === args.caseId) : [];
      const ids = [...new Set(documentEntries.flatMap(entry => entryMediaAssets(entry)).filter(asset => asset.kind === 'document').map(asset => asset.id))];
      const documents = new Map(await Promise.all(ids.map(async id => [id, (await getDerivedMedia(id))?.searchText || ''])));
      const documentTextByEntryId = new Map(documentEntries.map(entry => [entry.id, entryMediaAssets(entry).map(asset => documents.get(asset.id)).filter(Boolean).join('\n')]));
      const search = needsIndex ? searchCache.build(scoped, state.facetCatalog, documents, await getAllDerivedMetadata(), new Set(entries.map(e => e.id))) : null;
      return { entries, documentTextByEntryId, organizerState: state.organizerState, facetCatalog: state.facetCatalog,
        searchIndex: search?.index, searchResultVersion: search?.resultVersion };
    },
    readImage: async (id, signal) => {
      signal?.throwIfAborted();
      const blob = await getMediaBlob(id) ?? await getScreenshotBlob(id);
      if (!blob) throw new Error('指定图片已不存在');
      if (blob.size * 4 > operationBudget(options.budget).workingBytes) throw resourceBudgetError('原图超过本次模型内联读取预算；原件保留，请使用文件分块读取');
      return { dataUrl: await blobToDataUrl(blob), mimeType: blob.type, sha256: await sha256Blob(blob) };
    },
    readImageDigest: async (id,signal) => {
      signal?.throwIfAborted();
      const blob=await getMediaBlob(id)??await getScreenshotBlob(id);
      if(!blob) throw new Error('指定图片已不存在');
      return sha256Blob(blob);
    }
  });
  const workspace = createComposerWorkspaceTools({ ...options, caseTools, invokeSkill: async (operation,input) => {
    const response = await chrome.runtime.sendMessage({type:'SKILL_OPERATION',operation,input});
    if (!response?.ok) throw new Error(response?.message || '无法读取Skill');
    return response.data;
  }, loadState: async () => {
    const state = await readWorkspaceLibraryState();
    if (!state?.ok) throw new Error(state?.message || '无法读取插件资料');
    return state;
  }, loadCurated: readComposerCuratedCatalog });
  let progress;
  const taskProgress = () => progress ||= createComposerToolProgress({ storage: getLibraryStorage(), sessionId: options.session.id,
    userMessageId: options.userMessageId || options.session.activeTurn?.userMessageId || options.session.messages?.findLast(item => item.role === 'user')?.id });
  return { ...withComposerCaseOperations({ ...options, tools: workspace,
    invoke: (operation, input) => chrome.runtime.sendMessage({ type: 'CASE_OPERATION', operation, input }) }),
    budget: options.budget,
    loadContinuation: input => taskProgress().loadContinuation(input),
    saveContinuation: checkpoint => taskProgress().saveContinuation(checkpoint),
    retainSkillVersions: ids => taskProgress().retainSkillVersions(ids),
    clearContinuation: () => taskProgress().clearContinuation() };
}

async function readWorkspaceLibraryState() {
  const reader = createLibraryViewReader({
    storage: getLibraryStorage(),
    prepare: ({ summaryOnly, creativeSummary } = {}) => chrome.runtime.sendMessage({ type: 'PREPARE_LIBRARY_VIEW_STATE', summaryOnly, creativeSummary }),
    uiLanguage: chrome.i18n.getUILanguage(),
    includeCreativeState: false
  });
  return reader();
}
