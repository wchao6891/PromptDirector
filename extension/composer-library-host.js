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
  const sendMessage = options.sendMessage ?? (message => chrome.runtime.sendMessage(message));
  const caseTools = createComposerLibraryTools({
    ...options,
    loadLibrary: async ({ name, args, signal }) => {
      const state = await readWorkspaceLibraryState(sendMessage);
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
    const response = await sendMessage({type:'SKILL_OPERATION',operation,input});
    if (!response?.ok) throw new Error(response?.message || '无法读取Skill');
    return response.data;
  }, loadState: async () => {
    const state = await readWorkspaceLibraryState(sendMessage);
    if (!state?.ok) throw new Error(state?.message || '无法读取插件资料');
    return state;
  }, loadCurated: readComposerCuratedCatalog });
  let progress;
  const taskProgress = () => progress ||= createComposerToolProgress({ storage: getLibraryStorage(), sessionId: options.session.id,
    userMessageId: options.userMessageId || options.session.activeTurn?.userMessageId || options.session.messages?.findLast(item => item.role === 'user')?.id });
  const tools = withComposerCaseOperations({ ...options, tools: workspace,
    invoke: (operation, input) => sendMessage({ type: 'CASE_OPERATION', operation, input }) });
  // Offscreen documents expose runtime messaging, but no chrome.storage API.
  // Execute library work and persist continuations in the worker's shared host.
  if (!globalThis.chrome?.storage?.local) {
    const invoke = async (operation, input, signal) => {
      signal?.throwIfAborted();
      const response = await chrome.runtime.sendMessage({ type: 'COMPOSER_LIBRARY_HOST', operation, input,
        sessionId: options.session.id, userMessageId: options.userMessageId || options.session.activeTurn?.userMessageId
          || options.session.messages?.findLast(item => item.role === 'user')?.id,
        vision: options.vision });
      if (!response?.ok) throw new Error(response?.message || '无法执行创作台资料工具');
      for (const event of response.events || []) await options.onEvent?.(event);
      signal?.throwIfAborted();
      return response.data;
    };
    return { ...tools, budget: options.budget,
      execute: (name, args, context = {}) => invoke('execute', { name, args, callId: context.callId }, context.signal),
      loadContinuation: input => invoke('loadContinuation', input),
      saveContinuation: input => invoke('saveContinuation', input),
      retainSkillVersions: input => invoke('retainSkillVersions', input),
      clearContinuation: () => invoke('clearContinuation') };
  }
  return { ...tools,
    budget: options.budget,
    loadContinuation: input => taskProgress().loadContinuation(input),
    saveContinuation: checkpoint => taskProgress().saveContinuation(checkpoint),
    retainSkillVersions: ids => taskProgress().retainSkillVersions(ids),
    clearContinuation: () => taskProgress().clearContinuation() };
}

export async function handleComposerLibraryHost(message, storage = getLibraryStorage(), hostOptions = {}) {
  const operations = ['execute', 'loadContinuation', 'saveContinuation', 'retainSkillVersions', 'clearContinuation'];
  if (!operations.includes(message.operation)) throw new Error('未知创作台资料工具动作');
  const { composerSessions } = await storage.get('composerSessions');
  const session = composerSessions?.find(item => item.id === message.sessionId);
  if (!session || !session.messages?.some(item => item.id === message.userMessageId && item.role === 'user')) {
    throw new Error('创作对话或用户要求已不存在，未执行工具动作');
  }
  const events = [];
  const tools = createLocalComposerLibraryTools({ ...hostOptions, session, userMessageId: message.userMessageId,
    vision: message.vision, onEvent: event => { events.push(event); } });
  const data = message.operation === 'execute'
    ? await tools.execute(message.input.name, message.input.args, { callId: message.input.callId })
    : await tools[message.operation](message.input);
  return { ok: true, data, events };
}

async function readWorkspaceLibraryState(sendMessage) {
  const reader = createLibraryViewReader({
    storage: getLibraryStorage(),
    prepare: ({ summaryOnly, creativeSummary } = {}) => sendMessage({ type: 'PREPARE_LIBRARY_VIEW_STATE', summaryOnly, creativeSummary }),
    uiLanguage: chrome.i18n.getUILanguage(),
    includeCreativeState: false
  });
  return reader();
}
