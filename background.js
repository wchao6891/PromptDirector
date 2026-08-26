import { showPageToast } from "./capture-region.js";
import { articleDocumentText, finalizeArticleDocumentAssets } from "./article-document.js";
import {
  classifyContent,
  classifyImportedMedia,
  confirmClassification,
  createSourceRule
} from "./classifier.js";
import { migrateLibraryState, needsMigration } from "./migration.js";
import {
  CONTENT_TYPE_VISIBILITY,
  CONTENT_ROLES,
  SCHEMA_VERSION,
  contentRoleForEntry,
  contentTypeForRole,
  createContentType,
  isValidContentPath,
  normalizeTaxonomy,
  removeContentTypeWithTransfer,
  updateContentType
} from "./taxonomy.js";
import {
  applyFacetChange,
  createFacetNode,
  normalizeFacetCatalog,
  previewFacetChange,
  recoverFullyArchivedFacets,
  restoreArchivedFacets,
  restoreArchivedNodes,
  uniqueNames
} from "./facets.js";
import { appendFacetUndo, facetUndoCount, undoFacetHistory } from "./facet-history.js";
import {
  acceptAnalysisCandidate,
  applyAnalysisCandidates,
  applyAnalysisImport,
  applyTextAnalysisTags,
  applyVisionAnalysis,
  editVisionReconstructionPrompt,
  rejectAnalysisCandidate,
  undoVisionAnalysis,
  setManualAssignment
} from "./analysis-candidates.js";
import {
  ANALYSIS_PROMPT_VERSION,
  analysisProfileFingerprint,
  analysisTaxonomyPrompt,
  analyzeTextDetailedWithDeepSeek,
  publicAiSettings,
  summarizeVisualSetWithAi
} from "./deepseek.js";
import {
  compileVisualSetSummaryInstruction,
  normalizeVisualSetSummaryV1,
  prepareVisualSetSummary
} from "./visual-analysis.js";
import { createAiProviderModule } from "./ai-provider-module.js";
import {
  analysisBatchSummary,
  analysisRebuildRecovery,
  backfillLegacyAnalysisMeta,
  cancelAnalysisBatch,
  claimAnalysisItems,
  createAnalysisBatchUndo,
  createAnalysisBatchJob,
  createVisionBatchJob,
  failAnalysisItem,
  failUnfinishedAnalysisItems,
  finalizeAnalysisRebuild,
  finalizePartialAnalysisRebuild,
  normalizeAnalysisBatchJob,
  pauseAnalysisBatch,
  previewAnalysisBatch,
  previewVisionBatch,
  reconcileVisionBatchResults,
  recoverInterruptedAnalysisBatch,
  restoreAnalysisBatchUndo,
  resumeAnalysisBatch,
  retryFailedAnalysisItems,
  stageAnalysisRebuildResults,
  succeedAnalysisItem,
  textFingerprint
} from "./analysis-batch.js";
import { canonicalTextAnalysisInput } from "./analysis-input.js";
import { buildAutomaticVisionJob } from "./automatic-vision.js";
import { coalesceAnalysisRequest, runScheduledAnalysisWithRetries } from "./analysis-scheduler.js";
import {
  completeAnalysisAttempt,
  failAnalysisAttempt,
  retryAnalysisAttempt,
  startAnalysisAttempt,
  stopAnalysisTask
} from "./analysis-tasks.js";
import {
  analysisTaskById,
  createOrJoinAnalysisTask,
  detachAnalysisTaskConsumer,
  normalizeAnalysisTaskRegistry,
  recoverInterruptedAnalysisTasks,
  replaceAnalysisTask
} from "./analysis-task-registry.js";
import { findPersistedVisionAnalysis } from "./vision-analysis-cache.js";
import {
  analysisRevisionMeta,
  entryTextRevision,
  markEntryTextChanged,
  updateEntryText
} from "./analysis-revision.js";
import { applyDetailOrganizationMappings } from "./tag-taxonomy.js";
import {
  buildEntry,
  defaultSettingsForLocale,
  findDuplicate,
  normalizeSettings,
  screenshotStorageKey
} from "./lib.js";
import {
  deleteScreenshotBlob,
  discardScreenshotReplacementBackup,
  getScreenshotBlob,
  undoScreenshotReplacement,
  saveScreenshotBlob
} from "./image-store.js";
import {
  deleteMediaBlob,
  deleteMediaBlobs,
  getAllDerivedMetadata,
  getDerivedMedia,
  getDerivedMetadata,
  getMediaBlob,
  saveDerivedMetadata,
  saveMediaBlob
} from "./media-store.js";
import { deleteLocalAssetHandle } from "./local-asset-store.js";
import {
  LOCAL_ASSET_REFERENCE_RECORD_TYPE,
  findExactMediaDuplicate,
  sha256Blob
} from "./local-media.js";
import { tempReferenceAssetIds, unreadReferenceImageAssets } from "./temp-references.js";
import {
  addStagedAsset,
  collectRetainedLocalAssetIds,
  normalizeImportStagingState,
  removeStagedAsset,
  stagedAssetById,
  stagedAssetMediaRecord
} from "./import-staging.js";
import {
  cancelImportJob,
  createImportJob,
  finishImportItem,
  markImportJobAnalysisQueued,
  normalizeImportJobsState,
  retryImportJob,
  startImportJob,
  undoImportJob
} from "./import-jobs.js";
import {
  createCreativeSkill,
  deleteCreativeSkill,
  normalizeCreativeSkillsState,
  restoreCreativeSkillVersion,
  saveCreativeSkillVersion,
  skillPackageAssetIds
} from "./creative-skills.js";
import {
  addEntryMedia,
  addTimeNote,
  entryMediaAssets,
  normalizeEntryMedia,
  removeTimeNote,
  setEntryMediaPrompt,
  setPrimaryMedia,
  updateLocalAssetReferenceMetadata
} from "./media.js";
import {
  cancelLibraryMaintenance,
  completeLibraryMaintenanceItem,
  createLibraryMaintenanceJob,
  extendLibraryMaintenanceJob,
  libraryMaintenanceSummary,
  mergeLibraryMaintenanceProgress,
  nextLibraryMaintenanceItem,
  normalizeLibraryMaintenanceJob,
  pauseLibraryMaintenance,
  resumeLibraryMaintenance,
  retryLibraryMaintenanceFailures
} from "./library-maintenance.js";
import {
  commitMetadataThenDeleteImages
} from "./image-transaction.js";
import { createEntrySaveUndo, normalizeLastSaveUndo, restoreScreenshotSaveEntry } from "./save-history.js";
import {
  mergeLibraryPackage,
  selectLibraryPackage,
  selectProjectPackage
} from "./library-package.js";
import {
  claimLibraryImportTransaction,
  createLibraryImportPlanToken,
  failLibraryImportTransaction,
  succeedLibraryImportTransaction
} from "./library-import-transaction.js";
import { mergeCuratedLibraryPackage } from "./curated-import.js";
import { prepareCuratedSubmissionState } from "./curated-submission.js";
import {
  createCollection,
  collectionEntryIds,
  collectionPathLabel,
  collectionSelectorLabelsById,
  moveCollection,
  normalizeOrganizerState,
  removeEntriesFromOrganizer,
  reorderCollections,
  replaceCollectionEntries,
  renameCollection,
  setEntriesCollection,
  setCollectionVisibility
} from "./organizer.js";
import {
  emptyTrash,
  listTrashItems,
  moveCollectionWithEntriesToTrash,
  moveCollectionsToTrash,
  moveEntriesToTrash,
  moveMediaToTrash,
  normalizeTrashState,
  restoreTrashItems,
  takeTrashItems
} from "./trash.js";
import { normalizeUiPreferences, resolveLocale } from "./preferences.js";
import { CHROME_WEB_STORE_URL } from "./product-links.js";
import { PALETTE_VERSION } from "./palette.js";
import {
  COMPOSER_METHOD_VERSION,
  appendDiagnosticEvent,
  createComposerSession,
  isMeaningfulComposerSession,
  normalizeComposerAiProfile,
  normalizeComposerSessions,
  normalizeComposerSettings,
  resetComposerAgentInstruction,
  sessionSummary,
  resetComposerTaskMethod,
  setComposerFailure,
  updateComposerAgentInstruction,
  updateComposerTaskMethod
} from "./composer.js";
import {
  activeCreativeJob,
  createCreativeJob,
  creativeJobById,
  interruptActiveCreativeJobs,
  normalizeCreativeJobsState,
  retryCreativeJob,
  updateCreativeJob
} from "./creative-jobs.js";
import { handleContextMenuCapture, syncContextMenus } from "./context-menus.js";
import {
  createCaptureDraft,
  draftParts,
  draftSourcePages,
  draftText,
  sourceContextForUrl
} from "./capture-draft.js";
import { createCaptureWorkspace } from "./capture-workspace.js";
import { RESTRICTED_PAGE_MESSAGE } from "./capture-permissions.js";
import {
  applyPageCaptureSelections,
  combinePageCaptureCandidates,
  collectPageCaptureSnapshot,
  mergePageCaptureRegionEdit,
  PAGE_CAPTURE_ADAPTERS,
  PAGE_CAPTURE_PLATFORM_ADAPTERS,
  normalizePageCaptureBatch,
  normalizePageCaptureCandidate,
  pageCaptureMediaFetchCandidates,
  resolvePageCaptureImage
} from "./page-capture.js";
import {
  collectPageCaptureSitePayload,
  installPageCaptureSiteObserver,
  normalizePageCaptureSitePayload
} from "./page-capture-site-adapters.js";
import { boundedMediaBlobFromResponse, fetchBoundedMedia, isSupportedDocumentMimeType } from "./bounded-media.js";
import {
  discardPageSessionMedia,
  PAGE_SESSION_MEDIA_CHUNK_BYTES,
  preparePageSessionMedia,
  readPageSessionMediaChunk
} from "./page-session-media.js";
import { PAGE_CAPTURE_LIMITS, PAGE_CAPTURE_QUALITY_LIMITS, PORTABLE_LIBRARY_LIMITS } from "./resource-limits.js";
import { publicAiServiceProfiles } from "./ai-service-profiles.js";
import {
  availableAiModelsForTask,
  availableAiProvidersForTask,
  mergeAiProviderRegistry,
  modelConcurrencyLimit,
  normalizeAiTaskAssignments,
  publicAiProviderRegistry
} from "./ai-provider-registry.js";
import {
  AI_RUNTIME_PROTOCOL_VERSION,
  aiConfigurationFromStorage,
  normalizeAiPreferences,
  projectAiRuntime,
  resolveTextTaskSettings,
  resolveVideoAnalysisTask,
  resolveVisionTaskSettings
} from "./ai-runtime.js";
import {
  analyzeVideoWithChatCompletions,
  analyzeVideoWithGemini,
  analyzeVideoWithOpenRouter,
  requireVideoAnalysisConfirmation
} from "./video-analysis.js";
import { detectMediaReferenceProvider } from "./media-reference-resolver.js";
import {
  createCompoundCase,
  normalizeCompoundCases,
  removeEntriesFromCompoundCases,
  splitCompoundCase,
  updateCompoundCase
} from "./compound-cases.js";
import {
  addEntryVisual,
  normalizeEntryVisuals,
  primaryVisual,
  setPrimaryVisual,
  updateEntryVisual
} from "./visuals.js";
import {
  VISION_ANALYSIS_VERSION,
  evaluateCreativeOutputWithVision,
  analyzeImageWithVision,
  blobToDataUrl,
  createVisionRequestBudget,
  imageFingerprint,
  publicVisionSettings,
  visionAnalysisProfileFingerprint
} from "./vision.js";
import {
  activateCreativeResultContext,
  addCreativeOutput,
  applyCreativeEvaluation,
  createCreativeRun,
  normalizeActiveCreativeResult,
  normalizeCreativeExperimentSettings,
  normalizeCreativeRuns,
  recordCreativeSignal,
  removeCreativeOutput,
  updateCreativeJudgment
} from "./creative-runs.js";
import { mergeCreativeExperimentPackage } from "./creative-experiment-package.js";
import {
  markSyncMetaDirty,
  normalizeSyncMeta,
  normalizeSyncSettings,
  syncErrorDetails
} from "./sync-model.js";
import {
  createOrUnlockSyncVault,
  openSyncVaultWithKey
} from "./sync-vault.js";
import { createManualSyncController } from "./manual-sync.js";
import {
  clearSyncPrivateState,
  getSyncCryptoKey,
  getSyncDirectoryHandle,
  saveSyncCryptoKey
} from "./sync-store.js";
import {
  createExtensionUpdateLifecycle,
  EXTENSION_UPDATE_STATUS_CHANGED
} from "./extension-update.js";

const STORAGE_KEYS = Object.freeze({
  schemaVersion: "schemaVersion",
  entries: "entries",
  trashState: "trashState",
  compoundCases: "compoundCases",
  settings: "settings",
  taxonomy: "taxonomy",
  facetCatalog: "facetCatalog",
  classificationRules: "classificationRules",
  migrationBackup: "migrationBackup",
  classificationResetBackup: "classificationResetBackup",
  facetMigrationBackup: "creativeFacetMigrationBackupV5",
  facetUndo: "facetUndo",
  aiProviderRegistry: "aiProviderRegistry",
  aiTaskAssignments: "aiTaskAssignments",
  aiPreferences: "aiPreferences",
  visionAnalysisUndo: "visionAnalysisUndo",
  automaticVisionBatchJob: "automaticVisionBatchJob",
  batchJob: "batchJob",
  analysisTasks: "analysisTasks",
  libraryImportTransactions: "libraryImportTransactions",
  libraryMaintenanceJob: "libraryMaintenanceJob",
  legacyAnalysisBatchJob: "analysisBatchJob",
  analysisBatchUndo: "analysisBatchUndo",
  analysisRebuildStaging: "analysisRebuildStaging",
  organizerState: "organizerState",
  uiPreferences: "uiPreferences",
  composerSettings: "composerSettings",
  composerSessions: "composerSessions",
  creativeExperimentSettings: "creativeExperimentSettings",
  creativeRuns: "creativeRuns",
  creativeJobs: "creativeJobs",
  importJobs: "importJobs",
  importStaging: "importStaging",
  creativeSkills: "creativeSkills",
  activeCreativeResult: "activeCreativeResult",
  lastSaveUndo: "lastSaveUndo",
  captureDraft: "captureDraft",
  syncSettings: "syncSettings",
  syncMeta: "syncMeta"
});
const SYNCED_STORAGE_KEYS = new Set([
  STORAGE_KEYS.entries,
  STORAGE_KEYS.trashState,
  STORAGE_KEYS.compoundCases,
  STORAGE_KEYS.settings,
  STORAGE_KEYS.taxonomy,
  STORAGE_KEYS.facetCatalog,
  STORAGE_KEYS.classificationRules,
  STORAGE_KEYS.organizerState,
  STORAGE_KEYS.composerSettings,
  STORAGE_KEYS.composerSessions,
  STORAGE_KEYS.creativeExperimentSettings,
  STORAGE_KEYS.creativeRuns,
  STORAGE_KEYS.creativeSkills
]);
const OFFSCREEN_DOCUMENT_PATH = "offscreen.html";
const DOWNLOAD_TIMEOUT_MS = 30_000;
let writeQueue = Promise.resolve();
let captureWriteQueue = Promise.resolve();
let creatingOffscreenDocument = null;
let visionAnalysisInFlight = false;
const aiProviderModule = createAiProviderModule();
const extensionUpdateLifecycle = createExtensionUpdateLifecycle({
  runtime: chrome.runtime,
  storage: chrome.storage.local,
  fetchFn: (...args) => fetch(...args),
  notify: (status) => chrome.runtime.sendMessage({
    type: EXTENSION_UPDATE_STATUS_CHANGED,
    status
  }).catch(() => undefined)
});
const VIDEO_ANALYSIS_ADAPTERS = Object.freeze({
  gemini: analyzeVideoWithGemini,
  chat_completions: analyzeVideoWithChatCompletions,
  openrouter: analyzeVideoWithOpenRouter
});
let activePageCapture = null;
let syncApplyInProgress = false;
const manualSyncController = createManualSyncController({
  readState,
  readMeta: async () => {
    const stored = await chrome.storage.local.get(STORAGE_KEYS.syncMeta);
    return stored[STORAGE_KEYS.syncMeta];
  },
  readMedia: getMediaBlob,
  writeMedia: saveMediaBlob,
  deleteMedia: deleteMediaBlob,
  commit: commitManualSyncResult,
  onProgress: notifySyncProgress,
  onStatus: notifySyncProgress
});
let maintenanceRunnerActive = false;
let maintenanceRunnerTimer = 0;
let automaticVisionRunnerActive = false;
let automaticVisionRunnerTimer = 0;
let analysisBatchRunnerActive = false;
let analysisBatchRunnerTimer = 0;
let importRunnerActive = false;
let importRunnerTimer = 0;
const analysisTaskRunners = new Map();
const LIBRARY_MAINTENANCE_ALARM = "prompt-director-library-maintenance";
const AUTOMATIC_VISION_ALARM = "prompt-director-automatic-vision";
const ANALYSIS_BATCH_ALARM = "prompt-director-analysis-batch";
const ANALYSIS_TASK_ALARM = "prompt-director-analysis-task";
const IMPORT_JOB_ALARM = "prompt-director-local-import";
const MAINTENANCE_SLICE_TARGET_MS = 250;
const captureRuntime = createCaptureWorkspace({
  chromeApi: chrome,
  captureDraftStorageKey: STORAGE_KEYS.captureDraft,
  uiPreferencesStorageKey: STORAGE_KEYS.uiPreferences,
  ensureOffscreenDocument,
  deleteVisual: deleteScreenshotBlob,
  resolveSourceContext: resolveCaptureSourceContext
});

chrome.runtime.onInstalled.addListener(async (details) => {
  await extensionUpdateLifecycle.handleInstalled(details);
  await restrictLocalStorageAccess();
  await syncContextMenus();
  await chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: false });

  const state = await readState();
  await commitLocalChanges({ [STORAGE_KEYS.settings]: state.settings }, { markSyncDirty: false });
  await migrateLegacyScreenshots(state.entries);
});

chrome.runtime.onUpdateAvailable.addListener((details) => {
  extensionUpdateLifecycle.handleUpdateAvailable(details)
    .catch((error) => console.error("PromptDirector update availability handling failed", error));
});

chrome.runtime.onStartup.addListener(() => {
  extensionUpdateLifecycle.handleStartup()
    .catch((error) => console.error("PromptDirector development update check failed", error));
});

restrictLocalStorageAccess().catch((error) => console.error("PromptDirector storage access restriction failed", error));
syncContextMenus().catch((error) => console.error("PromptDirector context menu sync failed", error));
chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: false }).catch((error) => console.error("PromptDirector side panel setup failed", error));
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === LIBRARY_MAINTENANCE_ALARM) scheduleLibraryMaintenanceRunner();
  if (alarm.name === AUTOMATIC_VISION_ALARM) scheduleAutomaticVisionRunner();
  if (alarm.name === ANALYSIS_BATCH_ALARM) scheduleAnalysisBatchRunner();
  if (alarm.name === IMPORT_JOB_ALARM) scheduleImportRunner();
});
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === ANALYSIS_TASK_ALARM) return runQueuedAnalysisTasks();
});
scheduleLibraryMaintenanceRunner();
scheduleAutomaticVisionRunner();
scheduleAnalysisBatchRunner();
recoverCreativeJobs().catch((error) => console.error("PromptDirector creative job recovery failed", error));
enqueue(recoverImportJobs).catch((error) => console.error("PromptDirector local import recovery failed", error));
enqueue(recoverAnalysisTasks).catch((error) => console.error("PromptDirector analysis task recovery failed", error));

chrome.contextMenus.onClicked.addListener((info, tab) => {
  handleContextMenuCapture(info, tab, {
    chromeApi: chrome,
    enqueueCapture,
    dispatch: (action, payload) => captureRuntime.dispatch(action, payload),
    showResult: showResultToast,
    formatError: userMessage,
    reportSidePanelError: (error) => console.error("PromptDirector side panel open failed", error)
  });
});

chrome.commands.onCommand.addListener(async (command) => {
  if (command !== "save-selection") return;
  const response = await enqueueCapture(() => captureRuntime.dispatch("add-active-selection"));
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab?.windowId) await chrome.sidePanel.open({ windowId: tab.windowId }).catch(() => undefined);
  await showResultToast(tab?.id, response.message, !response.ok);
});

chrome.action.onClicked.addListener((tab) => {
  if (!Number.isInteger(tab?.windowId)) return;
  chrome.sidePanel.open({ windowId: tab.windowId })
    .catch((error) => console.error("PromptDirector toolbar side panel open failed", error));
});

chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== "capture-region") return;
  port.onMessage.addListener(() => undefined);
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.target === "offscreen") return false;
  const interaction = {
    sidePanelOpening: openCreativeResultSidePanel(message, sender),
    sender
  };
  handleMessage(message, interaction)
    .then(sendResponse)
    .catch((error) => sendResponse({ ok: false, message: userMessage(error) }));
  return true;
});

function openCreativeResultSidePanel(message, sender) {
  if (message?.type !== "ACTIVATE_CREATIVE_RESULT") return null;
  const windowId = sender?.tab?.windowId;
  if (!Number.isInteger(windowId)) return Promise.resolve(false);
  return chrome.sidePanel.open({ windowId })
    .then(() => true)
    .catch((error) => {
      console.error("PromptDirector creative result side panel open failed", error);
      return false;
    });
}

async function handleMessage(message, interaction = {}) {
  switch (message?.type) {
    case "GET_STATE": {
      return enqueue(async () => ({ ok: true, ...publicLibraryState(await readState()) }));
    }
    case "GET_FOLDER_BACKUP_STATE":
      return enqueue(async () => ({ ok: true, ...folderBackupState(await readState()) }));
    case "GET_CAPTURE_WORKSPACE":
      return enqueueCapture(async () => captureWorkspace());
    case "GET_DATA_SAFETY_STATUS":
      return enqueue(async () => dataSafetyStatus(await readState()));
    case "GET_SYNC_RUN_STATUS":
      return Promise.resolve({ ok: true, syncStatus: manualSyncController.status() });
    case "CANCEL_SYNC": {
      const cancelRequested = manualSyncController.cancel();
      return Promise.resolve({
        ok: true,
        cancelRequested,
        message: cancelRequested ? "正在停止本次同步" : "当前没有正在运行的同步"
      });
    }
    case "GET_EXTENSION_UPDATE_STATUS":
      return extensionUpdateLifecycle.getStatus()
        .then((status) => ({ ok: true, status }));
    case "CHECK_EXTENSION_UPDATE":
      return extensionUpdateLifecycle.check()
        .then((status) => ({
          ok: status.checkStatus !== "error",
          status,
          message: status.lastError
        }));
    case "APPLY_EXTENSION_UPDATE":
      return extensionUpdateLifecycle.apply();
    case "CONNECT_SYNC_FOLDER":
      return enqueue(async () => connectSyncFolder(message.password));
    case "UNLOCK_SYNC_VAULT":
      return enqueue(async () => unlockSyncVault(message.password));
    case "SYNC_NOW":
      return enqueue(async () => performManualSynchronization((input) => manualSyncController.start(input)));
    case "DISCONNECT_SYNC_FOLDER":
      return enqueue(async () => disconnectSyncFolder());
    case "UPDATE_CAPTURE_DRAFT":
      return enqueueCapture(async () => captureRuntime.dispatch("persist-draft", { draft: message.draft }));
    case "ADD_ACTIVE_SELECTION_TO_DRAFT":
      return enqueueCapture(async () => captureRuntime.dispatch("add-active-selection", { tabId: message.tabId }));
    case "TRY_ACTIVE_SELECTION_TO_DRAFT":
      return enqueueCapture(async () => captureRuntime.dispatch("try-active-selection"));
    case "ADD_CLIPBOARD_TEXT_TO_DRAFT":
      return enqueueCapture(async () => captureRuntime.dispatch("add-clipboard-text", { text: message.text }));
    case "CAPTURE_ACTIVE_TAB_TO_DRAFT":
      return enqueueCapture(async () => captureRuntime.dispatch("capture-active-tab", { tabId: message.tabId }));
    case "CAPTURE_VISIBLE_VISUALS_TO_DRAFT":
      return enqueueCapture(async () => captureRuntime.dispatch("capture-visible-visuals", { tabId: message.tabId }));
    case "START_SMART_VISUAL_SELECTION":
      return enqueueCapture(async () => captureRuntime.dispatch("start-visible-visual-selection", { tabId: message.tabId }));
    case "CONFIRM_SMART_VISUAL_SELECTION":
      return enqueueCapture(async () => captureRuntime.dispatch("confirm-visible-visual-selection", { sessionId: message.sessionId }));
    case "CANCEL_SMART_VISUAL_SELECTION":
      return enqueueCapture(async () => captureRuntime.dispatch("cancel-visible-visual-selection", { sessionId: message.sessionId }));
    case "CANCEL_REGION_CAPTURE":
      return captureRuntime.dispatch("cancel-region-capture", { sessionId: message.sessionId });
    case "START_PAGE_CAPTURE":
      return enqueueCapture(async () => startPageCapture(message.mode, message.targetCount));
    case "CANCEL_PAGE_CAPTURE":
      return cancelPageCapture(message.sessionId);
    case "PREVIEW_PAGE_CAPTURE_REGION":
      return previewPageCaptureRegion(message.tabId, message.marker);
    case "CLEAR_PAGE_CAPTURE_MARKERS":
      return clearPageCaptureMarkers(message.tabId, message.removeRegionMarkers !== false);
    case "EDIT_PAGE_CAPTURE_REGION":
      return editPageCaptureRegion(message.tabId, message.candidate, message.mode);
    case "COMMIT_PAGE_CAPTURE":
      return enqueueCapture(async () => enqueue(async () => commitPageCapture(message.batch)));
    case "PAGE_CAPTURE_VIEWPORT_FALLBACKS":
      return capturePageCaptureViewportFallbacks(message, interaction.sender);
    case "SMART_VISUAL_SELECTION_CHANGED":
    case "SMART_VISUAL_SELECTION_ENDED":
    case "REGION_CAPTURE_CHANGED":
      return { ok: true };
    case "CAPTURE_CREATIVE_OUTPUTS":
      return captureAndCommitCreativeOutputs(message);
    case "UPDATE_CAPTURE_FRAGMENT":
      return enqueueCapture(async () => captureRuntime.dispatch("update-fragment", {
        fragmentId: message.fragmentId,
        text: message.text
      }));
    case "REMOVE_CAPTURE_FRAGMENT":
      return enqueueCapture(async () => captureRuntime.dispatch("remove-fragment", { fragmentId: message.fragmentId }));
    case "REORDER_CAPTURE_FRAGMENTS":
      return enqueueCapture(async () => captureRuntime.dispatch("reorder-fragments", { ids: message.ids }));
    case "REMOVE_CAPTURE_VISUAL":
      return enqueueCapture(async () => captureRuntime.dispatch("remove-visual", { visualId: message.visualId }));
    case "REORDER_CAPTURE_VISUALS":
      return enqueueCapture(async () => captureRuntime.dispatch("reorder-visuals", { ids: message.ids }));
    case "SET_CAPTURE_PRIMARY_VISUAL":
      return enqueueCapture(async () => captureRuntime.dispatch("set-primary-visual", { visualId: message.visualId }));
    case "CANCEL_CAPTURE_DRAFT":
      return enqueueCapture(async () => captureRuntime.dispatch("cancel"));
    case "COMMIT_CAPTURE_DRAFT":
      return enqueueCapture(async () => enqueue(async () => commitCaptureDraft(message.duplicateAction, {
        collectionId: message.collectionId,
        newCollectionName: message.newCollectionName
      })));
    case "START_CAPTURE_FOR_CASE":
      return enqueueCapture(async () => startCaptureForCase(message.caseId, message.partEntryId));
    case "CREATE_COMPOUND_CASE":
      return enqueue(async () => createCompoundCaseAction(message));
    case "UPDATE_COMPOUND_CASE":
      return enqueue(async () => updateCompoundCaseAction(message));
    case "SPLIT_COMPOUND_CASE":
      return enqueue(async () => splitCompoundCaseAction(message.compoundCaseId));
    case "SET_ENTRY_PRIMARY_VISUAL":
      return enqueue(async () => setEntryPrimaryVisual(message.entryId, message.visualId));
    case "DELETE_ENTRY_VISUAL":
      return enqueue(async () => deleteEntryVisual(message.entryId, message.visualId));
    case "ADD_UPLOADED_VISUAL":
      return enqueue(async () => addUploadedVisual(message.entryId, message.visual));
    case "SET_ENTRY_PRIMARY_MEDIA":
      return enqueue(async () => setEntryPrimaryMedia(message.entryId, message.assetId));
    case "DELETE_ENTRY_MEDIA":
      return enqueue(async () => deleteEntryMedia(message.entryId, message.assetId));
    case "ADD_UPLOADED_MEDIA":
      return enqueue(async () => addUploadedMedia(message.entryId, message.asset, message.posterAsset));
    case "CREATE_MEDIA_CASE":
      return enqueue(async () => createMediaCase(message.asset, message.posterAsset, message.title, message.text));
    case "CREATE_MEDIA_REFERENCE":
      return enqueue(async () => createMediaReferenceCase(message.asset, message.posterAsset, message.title, message));
    case "CREATE_QUICK_NOTE":
      return enqueue(async () => createQuickNote(message.title, message.text, message));
    case "ADD_TIME_NOTE":
      return enqueue(async () => addEntryTimeNote(message.entryId, message.note));
    case "ADD_VIDEO_KEYFRAME":
      return enqueue(async () => addVideoKeyframe(message.entryId, message.asset, message.note));
    case "DELETE_TIME_NOTE":
      return enqueue(async () => deleteEntryTimeNote(message.entryId, message.noteId));
    case "EXPORT_MARKDOWN":
    case "EXPORT_ARCHIVE":
      return enqueue(async () => exportArchive(await readState(), message.entryIds));
    case "EXPORT_PROJECT":
      return enqueue(async () => exportProjectArchive(await readState(), message.collectionId));
    case "EXPORT_CURATED_SUBMISSION":
      return enqueue(async () => exportCuratedSubmission(await readState(), message));
    case "EXPORT_CREATIVE_EXPERIMENTS":
      return enqueue(async () => exportCreativeExperiments(await readState()));
    case "PREVIEW_CREATIVE_EXPERIMENT_IMPORT":
      return enqueue(async () => previewCreativeExperimentImport(await readState(), message.experiments));
    case "APPLY_CREATIVE_EXPERIMENT_IMPORT":
      return enqueue(async () => applyCreativeExperimentImport(await readState(), message));
    case "PREVIEW_LIBRARY_IMPORT":
      return enqueue(async () => previewLibraryImport(await readState(), message.library, {
        preserveLibraryConfiguration: message.preserveLibraryConfiguration === true
      }));
    case "APPLY_LIBRARY_IMPORT":
      return enqueue(async () => applyLibraryImport(await readState(), message));
    case "PREVIEW_CURATED_IMPORT":
      return enqueue(async () => previewCuratedImport(await readState(), message));
    case "APPLY_CURATED_IMPORT":
      return enqueue(async () => applyCuratedImport(await readState(), message));
    case "UPDATE_SETTINGS":
      return enqueue(async () => {
        const state = await readState();
        const settings = normalizeSettings(message.settings);
        await commitLocalChanges({ [STORAGE_KEYS.settings]: settings });
        return {
          ok: true,
          message: "设置已保存，下次导出 ZIP 时生效",
          count: state.entries.length,
          settings
        };
      });
    case "UPDATE_UI_PREFERENCES":
      return enqueue(async () => {
        const uiPreferences = normalizeUiPreferences(message.preferences);
        await commitLocalChanges({ [STORAGE_KEYS.uiPreferences]: uiPreferences });
        return { ok: true, uiPreferences };
      });
    case "UPDATE_AI_PROVIDER_CONFIGURATION":
      return enqueue(async () => updateAiProviderConfiguration(message));
    case "VERIFY_AI_IMAGE_GENERATION_CREDENTIAL":
      return enqueue(async () => verifyAiImageGenerationCredential(message));
    case "DISCOVER_AI_PROVIDER_MODELS":
      return discoverAiProviderModels(message.providerId, message.force === true);
    case "GET_AI_TASK_RUNTIME":
      return enqueue(async () => getAiTaskRuntime(message.taskId, message.allowUnconfigured === true, message.assignment));
    case "GET_COMPOSER_AI_RUNTIME":
      return enqueue(async () => getComposerAiRuntime());
    case "GET_COMPOSER_SESSION":
      return enqueue(async () => getComposerSession(message.sessionId));
    case "START_CREATIVE_JOB":
      return enqueue(async () => startCreativeJobAction(message.request, message.jobId));
    case "GET_CREATIVE_JOB":
      return enqueue(async () => getCreativeJobAction(message.jobId));
    case "CANCEL_CREATIVE_JOB":
      return cancelCreativeJobAction(message.jobId);
    case "RETRY_CREATIVE_JOB":
      return enqueue(async () => retryCreativeJobAction(message.jobId));
    case "UPDATE_CREATIVE_JOB_PROGRESS":
      return enqueue(async () => updateCreativeJobProgress(message));
    case "GET_CREATIVE_JOB_EXECUTION_STATE":
      return creativeJobExecutionState();
    case "COMPLETE_CREATIVE_JOB":
      return enqueue(async () => completeCreativeJobAction(message));
    case "FAIL_CREATIVE_JOB":
      return enqueue(async () => failCreativeJobAction(message));
    case "START_IMPORT_JOB":
      return enqueue(async () => startImportJobAction(message));
    case "GET_IMPORT_JOB":
      return enqueue(async () => getImportJobAction(message.jobId));
    case "CANCEL_IMPORT_JOB":
      return enqueue(async () => cancelImportJobAction(message.jobId));
    case "RETRY_IMPORT_JOB":
      return enqueue(async () => retryImportJobAction(message.jobId));
    case "UNDO_IMPORT_JOB":
      return enqueue(async () => undoImportJobAction(message.jobId));
    case "ADD_TEMP_REFERENCES":
      return enqueue(async () => addTempReferencesAction(message));
    case "REMOVE_TEMP_REFERENCE":
      return enqueue(async () => removeTempReferenceAction(message));
    case "SAVE_TEMP_REFERENCE_AS_CASE":
      return enqueue(async () => saveTempReferenceAsCaseAction(message));
    case "START_OR_JOIN_ANALYSIS_TASK":
      return startOrJoinAnalysisTaskAction(message);
    case "GET_ANALYSIS_TASK":
      return enqueue(async () => getAnalysisTaskAction(message.taskId));
    case "DETACH_ANALYSIS_CONSUMER":
      return enqueue(async () => detachAnalysisConsumerAction(message));
    case "STOP_ANALYSIS_TASK":
      return stopAnalysisTaskAction(message);
    case "RETRY_ANALYSIS_TASK":
      return retryAnalysisTaskAction(message);
    case "CREATE_CREATIVE_SKILL":
      return enqueue(async () => createCreativeSkillAction(message));
    case "SAVE_CREATIVE_SKILL_VERSION":
      return enqueue(async () => saveCreativeSkillVersionAction(message));
    case "RESTORE_CREATIVE_SKILL_VERSION":
      return enqueue(async () => restoreCreativeSkillVersionAction(message));
    case "DELETE_CREATIVE_SKILL":
      return enqueue(async () => deleteCreativeSkillAction(message.skillId));
    case "UPDATE_COMPOSER_SETTINGS":
      return enqueue(async () => updateComposerSettings(message));
    case "UPSERT_COMPOSER_SESSION":
      return enqueue(async () => upsertComposerSession(message.session));
    case "DELETE_COMPOSER_SESSION":
      return enqueue(async () => deleteComposerSession(message.sessionId));
    case "SAVE_COMPOSER_RESULT":
      return enqueue(async () => saveComposerResult(message));
    case "ACTIVATE_CREATIVE_RESULT":
      return enqueue(async () => activateCreativeResult(message, interaction.sidePanelOpening));
    case "CLEAR_ACTIVE_CREATIVE_RESULT":
      return enqueue(async () => {
        await commitLocalChanges({ [STORAGE_KEYS.activeCreativeResult]: null });
        return { ok: true };
      });
    case "COMMIT_CREATIVE_OUTPUTS":
      return commitExistingCreativeOutputs();
    case "REGISTER_GENERATED_OUTPUTS":
      return enqueue(async () => registerGeneratedOutputs(message));
    case "UPDATE_CREATIVE_EXPERIMENT_SETTINGS":
      return enqueue(async () => updateCreativeExperimentSettings(message.settings));
    case "SAVE_CREATIVE_OUTPUT_TO_LIBRARY":
      return enqueue(async () => saveCreativeOutputToLibrary(message));
    case "RECORD_CREATIVE_SIGNAL":
      return enqueue(async () => updateCreativeSignal(message));
    case "UPDATE_CREATIVE_JUDGMENT":
      return enqueue(async () => updateCreativeJudgmentAction(message));
    case "DELETE_CREATIVE_OUTPUT":
      return enqueue(async () => deleteCreativeOutput(message));
    case "ANALYZE_CREATIVE_OUTPUT":
      return analyzeCreativeOutput(message.runId, message.visualId);
    case "ANALYZE_ENTRY_IMAGE":
      try {
        return await analyzeEntryImage(
          message.entryId,
          message.visualId,
          message.outputLocale,
          message.batchJobId,
          message.bypassCache === true,
          message.assignment,
          "interactive"
        );
      } catch (error) {
        return {
          ok: false,
          message: userMessage(error),
          status: Number(error?.status) || 0,
          usage: error?.usage,
          attempts: error?.attempts
        };
      }
    case "ANALYZE_ENTRY_VISUAL_SET":
      return analyzeEntryVisualSet(message);
    case "ANALYZE_ENTRY_VIDEO":
      return analyzeEntryVideo(message);
    case "UPDATE_VISION_RECONSTRUCTION_PROMPT":
      return enqueue(async () => updateVisionReconstructionPrompt(message.entryId, message.visualId, message.reconstructionPrompt));
    case "UPDATE_ENTRY_TEXT":
      return enqueue(async () => updateCaseText(message));
    case "UPDATE_ENTRY_MEDIA_PROMPT":
      return enqueue(async () => updateEntryMediaPromptAction(message));
    case "APPLY_ENTRY_MEDIA_PROMPT_SUGGESTIONS":
      return enqueue(async () => applyEntryMediaPromptSuggestions(message));
    case "UPDATE_ENTRY_TITLE":
      return enqueue(async () => updateCaseTitle(message));
    case "UPDATE_ENTRY_CUSTOM_LABELS":
      return enqueue(async () => updateEntryCustomLabels(message));
    case "UPDATE_LOCAL_ASSET_REFERENCE":
      return enqueue(async () => updateLocalAssetReferenceAction(message));
    case "BATCH_ADD_CUSTOM_LABELS":
      return enqueue(async () => batchAddCustomLabels(message));
    case "BATCH_SET_PROJECT":
      return enqueue(async () => batchSetProject(message));
    case "UNDO_VISION_ANALYSIS":
      return enqueue(async () => undoEntryVisionAnalysis(message.entryId));
    case "UNDO_LAST":
      return enqueue(async () => undoLastSave());
    case "DELETE_ENTRY":
      return enqueue(async () => deleteEntry(message.entryId));
    case "BATCH_MOVE_TO_TRASH":
      return enqueue(async () => moveEntryBatchToTrash(message.entryIds));
    case "DELETE_COLLECTION_WITH_ENTRIES":
      return enqueue(async () => deleteCollectionWithEntries(message));
    case "GET_TRASH_ITEMS":
      return enqueue(async () => getTrashItems(message));
    case "RESTORE_TRASH_ITEMS":
      return enqueue(async () => restoreSelectedTrashItems(message));
    case "PERMANENT_DELETE_TRASH_ITEMS":
      return enqueue(async () => permanentlyDeleteTrashItems(message));
    case "EMPTY_TRASH":
      return enqueue(async () => emptyTrashAction());
    case "CONFIRM_CLASSIFICATION":
      return enqueue(async () => updateClassification(message));
    case "RENAME_CONTENT_TYPE":
      return enqueue(async () => updateContentTypeName(message));
    case "CREATE_CONTENT_TYPE":
      return enqueue(async () => createLibraryContentType(message));
    case "UPDATE_CONTENT_TYPE":
      return enqueue(async () => updateLibraryContentType(message));
    case "SET_CONTENT_TYPE_VISIBILITY":
      return enqueue(async () => updateLibraryContentTypeVisibility(message));
    case "DELETE_CONTENT_TYPE":
      return enqueue(async () => deleteLibraryContentType(message));
    case "CREATE_FACET_NODE":
      return enqueue(async () => createFacetTag(message));
    case "APPLY_DETAIL_TAG_ORGANIZATION":
      return enqueue(async () => applyDetailTagOrganization(message));
    case "SET_ENTRY_FACET":
      return enqueue(async () => updateEntryFacet(message));
    case "CREATE_COLLECTION":
    case "RENAME_COLLECTION":
    case "DELETE_COLLECTION":
    case "REORDER_COLLECTIONS":
    case "MOVE_COLLECTION":
    case "REPLACE_COLLECTION_ENTRIES":
    case "SET_COLLECTION_VISIBILITY":
      return enqueue(async () => updateOrganizer(message));
    case "ACCEPT_ANALYSIS_CANDIDATE":
      return enqueue(async () => decideAnalysisCandidate(message, true));
    case "REJECT_ANALYSIS_CANDIDATE":
      return enqueue(async () => decideAnalysisCandidate(message, false));
    case "APPLY_ENTRY_ANALYSIS_RESULT":
      return enqueue(async () => applyEntryAnalysisResult(message));
    case "PREVIEW_ANALYSIS_BATCH":
      return enqueue(async () => previewDeepSeekBatch(message.outputLocale, message.mode));
    case "CREATE_ANALYSIS_BATCH":
      return enqueue(async () => createDeepSeekBatch(message.outputLocale, message.mode));
    case "CLAIM_ANALYSIS_ITEMS":
      return enqueue(async () => claimDeepSeekBatchItems(message.jobId));
    case "GET_ANALYSIS_BATCH_STATUS":
      return getDeepSeekBatchStatus(message.jobId);
    case "COMMIT_ANALYSIS_ITEM":
      return enqueue(async () => commitDeepSeekBatchItem(message));
    case "COMMIT_ANALYSIS_ITEMS":
      return enqueue(async () => commitDeepSeekBatchItems(message));
    case "FAIL_ANALYSIS_ITEM":
      return enqueue(async () => failDeepSeekBatchItem(message));
    case "PAUSE_ANALYSIS_BATCH":
      return enqueue(async () => updateDeepSeekBatch("pause", message.jobId));
    case "RESUME_ANALYSIS_BATCH":
      return enqueue(async () => updateDeepSeekBatch("resume", message.jobId));
    case "CANCEL_ANALYSIS_BATCH":
      return enqueue(async () => updateDeepSeekBatch("cancel", message.jobId));
    case "RETRY_ANALYSIS_FAILURES":
      return enqueue(async () => updateDeepSeekBatch("retry", message.jobId));
    case "APPLY_STAGED_ANALYSIS_REBUILD":
      return enqueue(async () => applyStagedAnalysisRebuild(message.jobId));
    case "RECOVER_ANALYSIS_BATCH":
      return enqueue(async () => recoverDeepSeekBatch());
    case "UNDO_ANALYSIS_BATCH":
      return enqueue(async () => undoDeepSeekBatch(message.jobId));
    case "PREVIEW_VISION_BATCH":
      return enqueue(async () => previewVisionBatchTask(message));
    case "CREATE_VISION_BATCH":
      return enqueue(async () => createVisionBatchTask(message));
    case "CLAIM_VISION_BATCH_ITEM":
      return enqueue(async () => claimVisionBatchItem(message.jobId));
    case "COMPLETE_VISION_BATCH_ITEM":
      return enqueue(async () => completeVisionBatchItem(message));
    case "FAIL_VISION_BATCH_ITEM":
      return enqueue(async () => failVisionBatchItem(message));
    case "PAUSE_VISION_BATCH":
      return enqueue(async () => updateVisionBatch("pause", message.jobId));
    case "RESUME_VISION_BATCH":
      return enqueue(async () => updateVisionBatch("resume", message.jobId));
    case "CANCEL_VISION_BATCH":
      return enqueue(async () => updateVisionBatch("cancel", message.jobId));
    case "RETRY_VISION_BATCH_FAILURES":
      return enqueue(async () => updateVisionBatch("retry", message.jobId));
    case "IMPORT_ANALYSIS_CANDIDATES":
      return enqueue(async () => importAnalysisCandidates(message.payload));
    case "PREVIEW_FACET_CHANGE":
      return enqueue(async () => previewFacetUpdate(message.change));
    case "APPLY_FACET_CHANGE":
      return enqueue(async () => applyFacetUpdate(message.preview));
    case "RESTORE_ARCHIVED_FACETS":
      return enqueue(async () => restoreFacetDimensions(message.facetIds));
    case "RESTORE_ARCHIVED_NODES":
      return enqueue(async () => restoreFacetTags(message.nodeIds));
    case "PREVIEW_REANALYZE":
    case "PREVIEW_LIBRARY_MAINTENANCE":
      return enqueue(async () => previewLibraryMaintenance());
    case "APPLY_REANALYZE":
    case "START_LIBRARY_MAINTENANCE":
      return enqueue(async () => startLibraryMaintenance());
    case "GET_LIBRARY_MAINTENANCE_STATUS":
      return libraryMaintenanceStatus();
    case "PAUSE_LIBRARY_MAINTENANCE":
      return enqueue(async () => updateLibraryMaintenance("pause"));
    case "RESUME_LIBRARY_MAINTENANCE":
      return enqueue(async () => updateLibraryMaintenance("resume"));
    case "CANCEL_LIBRARY_MAINTENANCE":
      return enqueue(async () => updateLibraryMaintenance("cancel"));
    case "RETRY_LIBRARY_MAINTENANCE":
      return enqueue(async () => updateLibraryMaintenance("retry"));
    case "UNDO_FACET_UPDATE":
      return enqueue(async () => undoFacetUpdate());
    default:
      return { ok: false, message: "未知操作" };
  }
}

async function captureWorkspace() {
  const draft = await captureRuntime.getDraft();
  const stored = await chrome.storage.local.get([
    STORAGE_KEYS.entries,
    STORAGE_KEYS.compoundCases,
    STORAGE_KEYS.taxonomy,
    STORAGE_KEYS.classificationRules,
    STORAGE_KEYS.organizerState,
    STORAGE_KEYS.activeCreativeResult,
    STORAGE_KEYS.composerSessions
  ]);
  const state = {
    entries: Array.isArray(stored[STORAGE_KEYS.entries]) ? stored[STORAGE_KEYS.entries] : [],
    taxonomy: normalizeTaxonomy(stored[STORAGE_KEYS.taxonomy]),
    classificationRules: Array.isArray(stored[STORAGE_KEYS.classificationRules]) ? stored[STORAGE_KEYS.classificationRules] : [],
    organizerState: normalizeOrganizerState(stored[STORAGE_KEYS.organizerState]),
    activeCreativeResult: normalizeActiveCreativeResult(stored[STORAGE_KEYS.activeCreativeResult]),
    composerSessions: normalizeComposerSessions(stored[STORAGE_KEYS.composerSessions])
  };
  const compound = normalizeCompoundCases(stored[STORAGE_KEYS.compoundCases], state.entries)
    .find((item) => item.id === draft.targetCaseId);
  const targetEntry = draft.targetCaseId
    ? state.entries.find((entry) => entry.id === draft.targetCaseId) ?? (compound ? {
      id: compound.id,
      title: compound.title,
      classification: draft.contentTypeId ? { pathIds: [draft.contentTypeId] } : undefined
    } : null)
    : null;
  const suggested = targetEntry?.classification ?? captureDraftClassification(draft, state);
  const partContentTypes = Object.fromEntries(draftParts(draft).map((part) => {
    const classification = classifyContent({
      text: part.text, title: part.sourceTitle, url: part.sourceUrl, visuals: part.visuals
    }, state.classificationRules, state.taxonomy);
    const id = classification?.pathIds?.[0] || "";
    const contentType = state.taxonomy.nodes.find((item) => item.id === id);
    const name = contentType?.name || "待确认";
    return [part.sourceUrl || "source:unknown", { id, name, customized: contentType?.customized === true }];
  }));
  const selectorLabelsByProject = collectionSelectorLabelsById(state.organizerState);
  return {
    ok: true,
    draft,
    targetEntry,
    suggestedContentTypeId: suggested?.pathIds?.[0] || "",
    contentTypes: state.taxonomy.nodes.map((item) => ({ id: item.id, name: item.name, customized: item.customized === true })),
    collections: state.organizerState.collections.map((item) => ({
      id: item.id,
      name: selectorLabelsByProject.get(item.id),
      parentId: item.parentId
    })),
    partContentTypes,
    activeCreativeResult: state.activeCreativeResult,
    activeCreativePrompt: activeCreativePromptSummary(state.activeCreativeResult, state.composerSessions),
    count: state.entries.length
  };
}

async function startPageCapture(mode = "loaded", targetCountValue = 0) {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id || !/^https?:/iu.test(tab.url || "")) {
    return { ok: false, message: RESTRICTED_PAGE_MESSAGE };
  }
  await clearPageCaptureMarkers(tab.id, true).catch(() => undefined);
  const sessionId = crypto.randomUUID();
  const listMode = mode === "list";
  const targetCount = listMode
    ? Math.min(PAGE_CAPTURE_LIMITS.maxCandidates, Math.max(1, Math.trunc(Number(targetCountValue) || 1)))
    : 0;
  activePageCapture = { sessionId, tabId: tab.id, cancelled: false };
  await chrome.runtime.sendMessage({ type: "PAGE_CAPTURE_CHANGED", sessionId, phase: mode === "whole" || listMode ? "scanning" : "starting" }).catch(() => undefined);
  const originalUrl = tab.url;
  let result = null;
  let stopReason = "";
  try {
    if (!listMode) {
      result = { result: await collectPageCaptureTab(tab, {
        sessionId,
        mode: mode === "whole" ? "whole" : "loaded",
        maxCandidates: mode === "loaded" ? PAGE_CAPTURE_QUALITY_LIMITS.maxRegionCandidates : PAGE_CAPTURE_LIMITS.maxCandidates
      }) };
    } else {
      const candidates = new Map();
      let currentTab = tab;
      let adapter = "";
      for (let pageIndex = 0; pageIndex < targetCount && !activePageCapture?.cancelled; pageIndex += 1) {
        const snapshot = await collectPageCaptureTab(currentTab, { sessionId, mode: "whole", maxCandidates: targetCount });
        if (!adapter) adapter = snapshot.adapter;
        else if (snapshot.adapter !== adapter) {
          stopReason = "layout-changed";
          break;
        }
        const before = candidates.size;
        for (const candidate of snapshot.candidates || []) {
          const key = `${candidate.canonicalUrl || ""}\n${candidate.sourceFacts?.itemId || ""}\n${candidate.title || ""}`;
          if (!candidates.has(key)) candidates.set(key, candidate);
          if (candidates.size >= targetCount) break;
        }
        if (candidates.size >= targetCount) {
          stopReason = "target-reached";
          break;
        }
        const nextUrl = await findNextPageCaptureListUrl(currentTab.id, currentTab.url);
        if (activePageCapture?.cancelled) {
          stopReason = "cancelled";
          break;
        }
        if (!nextUrl) {
          stopReason = candidates.size === before ? "no-new-items" : "no-next-page";
          break;
        }
        try {
          await chrome.tabs.update(currentTab.id, { url: nextUrl });
          await waitForPageCaptureTab(currentTab.id, nextUrl);
          currentTab = await chrome.tabs.get(currentTab.id);
        } catch {
          stopReason = "pagination-failed";
          break;
        }
      }
      if (activePageCapture?.cancelled) stopReason = "cancelled";
      result = { result: {
        id: sessionId,
        sourceUrl: originalUrl,
        adapter,
        candidates: [...candidates.values()].slice(0, targetCount),
        capturedAt: new Date().toISOString()
      } };
    }
  } finally {
    if (listMode) {
      try {
        const current = await chrome.tabs.get(tab.id);
        if (current.url !== originalUrl) {
          await chrome.tabs.update(tab.id, { url: originalUrl });
          await waitForPageCaptureTab(tab.id, originalUrl);
        }
      } catch {
      }
    }
    activePageCapture = null;
  }
  const batch = normalizePageCaptureBatch({
    ...result?.result,
    ...(listMode ? {
      captureMode: "list",
      saveMode: "",
      targetCount,
      stopReason: stopReason || ((result?.result?.candidates?.length || 0) >= targetCount ? "target-reached" : "no-new-items"),
      candidates: (result?.result?.candidates || []).slice(0, targetCount)
    } : {}),
    tabId: tab.id,
    status: "preview"
  });
  if (!batch.candidates.length) {
    const jimengHome = /^https:\/\/jimeng\.jianying\.com\/ai-tool\/home(?:\/|$)/iu.test(tab.url);
    return {
      ok: false,
      message: jimengHome
        ? "即梦主页作品信息尚未完整取得，请刷新页面后再次扫描"
        : "当前网页没有识别到可保存的正文、作品或媒体"
    };
  }
  return {
    ok: true,
    message: `已识别 ${batch.candidates.length} 项网页内容，请确认后保存`,
    batch
  };
}

async function collectPageCaptureTab(tab, options) {
  let siteData = await readPageCaptureSiteData(tab);
  await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    files: ["vendor/document-ingestion/Readability.js"]
  });
  const [injected] = await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    func: collectPageCaptureSnapshot,
    args: [{
      sessionId: options.sessionId,
      adapters: PAGE_CAPTURE_ADAPTERS,
      platformAdapters: PAGE_CAPTURE_PLATFORM_ADAPTERS,
      mode: options.mode,
      maxCandidates: options.maxCandidates,
      maxRegionCandidates: PAGE_CAPTURE_QUALITY_LIMITS.maxRegionCandidates,
      maxContentTargets: PAGE_CAPTURE_QUALITY_LIMITS.maxContentTargetsPerCandidate,
      maxMedia: PAGE_CAPTURE_LIMITS.maxMediaPerCandidate,
      maxScrollSteps: PAGE_CAPTURE_LIMITS.maxScrollSteps,
      maxInlinePixelDataCharacters: PAGE_CAPTURE_LIMITS.maxInlinePixelDataCharacters,
      editedRegion: options.editedRegion || null,
      siteData
    }]
  });
  let snapshot = injected?.result || {};
  if (siteData?.pageKind === "feed") {
    siteData = await readPageCaptureSiteData(tab, { installObserver: false }) || siteData;
    snapshot = { ...snapshot, candidates: siteData.candidates, siteStatus: siteData.completeness };
  }
  return addVisiblePageCaptureFallbacks(snapshot, tab);
}

async function findNextPageCaptureListUrl(tabId, currentUrlValue) {
  try {
    const [result] = await chrome.scripting.executeScript({
      target: { tabId },
      func: () => {
        const direct = document.querySelector('a[rel~="next"]');
        const paginationLinks = [...document.querySelectorAll('nav[aria-label*="pagination" i] a[href],[role="navigation"] a[href],[class*="pagination"] a[href]')];
        const next = direct || paginationLinks.find((link) => /^(?:next|下一页|下页|后页|›|»|→)$/iu.test(String(link.textContent || link.getAttribute("aria-label") || link.title || "").trim()));
        return next?.href || "";
      }
    });
    const nextUrl = new URL(result?.result || "", currentUrlValue);
    const currentUrl = new URL(currentUrlValue);
    return nextUrl.origin === currentUrl.origin && nextUrl.href !== currentUrl.href ? nextUrl.href : "";
  } catch {
    return "";
  }
}

async function waitForPageCaptureTab(tabId, expectedUrl) {
  const current = await chrome.tabs.get(tabId);
  if (current.status === "complete" && current.url === expectedUrl) return;
  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      chrome.tabs.onUpdated.removeListener(onUpdated);
      reject(new Error("列表翻页超时"));
    }, PAGE_CAPTURE_LIMITS.navigationTimeoutMs);
    const onUpdated = (updatedTabId, changeInfo, updatedTab) => {
      if (updatedTabId !== tabId || changeInfo.status !== "complete" || updatedTab.url !== expectedUrl) return;
      clearTimeout(timeout);
      chrome.tabs.onUpdated.removeListener(onUpdated);
      resolve();
    };
    chrome.tabs.onUpdated.addListener(onUpdated);
  });
}

async function readPageCaptureSiteData(tab, { installObserver = true } = {}) {
  if (!tab?.id || !/^https?:/iu.test(tab.url || "")) return null;
  try {
    if (installObserver) {
      await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        world: "MAIN",
        func: installPageCaptureSiteObserver,
        args: [{
          maxCandidates: PAGE_CAPTURE_LIMITS.maxCandidates,
          maxMedia: PAGE_CAPTURE_LIMITS.maxMediaPerCandidate
        }]
      });
    }
    const [sitePayloadResult] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      world: "MAIN",
      func: collectPageCaptureSitePayload,
      args: [{
        maxCandidates: PAGE_CAPTURE_LIMITS.maxCandidates,
        maxMedia: PAGE_CAPTURE_LIMITS.maxMediaPerCandidate,
        maxTextCharacters: PORTABLE_LIBRARY_LIMITS.maxLibraryJsonBytes
      }]
    });
    return normalizePageCaptureSitePayload(sitePayloadResult?.result, tab.url);
  } catch {
    return null;
  }
}

async function resolveCaptureSourceContext(tab) {
  const siteData = await readPageCaptureSiteData(tab);
  const candidates = Array.isArray(siteData?.candidates)
    ? siteData.candidates
    : siteData?.sourceFacts ? [siteData] : [];
  if (!candidates.length) return null;
  let workId = "";
  try {
    const lastPart = new URL(tab.url).pathname.split("/").filter(Boolean).at(-1) || "";
    if (/^\d{8,32}$/u.test(lastPart)) workId = lastPart;
  } catch {
  }
  const candidate = candidates.find((item) => item.sourceFacts?.itemId === workId) || (candidates.length === 1 ? candidates[0] : null);
  if (!candidate) return null;
  return {
    canonicalUrl: candidate.canonicalUrl,
    displayTitle: candidate.displayTitle || candidate.title,
    completeness: candidate.completeness,
    sourceFacts: candidate.sourceFacts
  };
}

async function addVisiblePageCaptureFallbacks(snapshot, tab) {
  const positions = [];
  const candidates = (Array.isArray(snapshot?.candidates) ? snapshot.candidates : []).map((candidate, candidateIndex) => ({
    ...candidate,
    media: (Array.isArray(candidate?.media) ? candidate.media : []).map((media, mediaIndex) => {
      if (media.kind === "image" && media.fallbackRect && !media.dataUrl) positions.push({ candidateIndex, mediaIndex, selection: media.fallbackRect });
      return media;
    })
  }));
  if (!positions.length || !Number.isInteger(tab.windowId)) return { ...snapshot, candidates };
  try {
    const [current] = await chrome.tabs.query({ active: true, windowId: tab.windowId });
    if (current?.id !== tab.id) return { ...snapshot, candidates };
    const dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, { format: "png" });
    await ensureOffscreenDocument();
    const response = await chrome.runtime.sendMessage({
      target: "offscreen",
      type: "CROP_PAGE_CAPTURE_PREVIEWS",
      dataUrl,
      selections: positions.map((item) => item.selection),
      maxDataUrlCharacters: PAGE_CAPTURE_LIMITS.maxInlinePixelDataCharacters
    });
    if (!response?.ok || response.dataUrls?.length !== positions.length) return { ...snapshot, candidates };
    response.dataUrls.forEach((pixelData, index) => {
      if (!pixelData) return;
      const position = positions[index];
      candidates[position.candidateIndex].media[position.mediaIndex] = {
        ...candidates[position.candidateIndex].media[position.mediaIndex],
        dataUrl: pixelData,
        previewDataUrl: pixelData
      };
    });
  } catch {
  }
  return { ...snapshot, candidates };
}

async function capturePageCaptureViewportFallbacks(message, sender) {
  if (!activePageCapture || message?.sessionId !== activePageCapture.sessionId || sender?.tab?.id !== activePageCapture.tabId) {
    return { ok: false, message: "整页扫描会话已经结束" };
  }
  const selections = (Array.isArray(message?.selections) ? message.selections : []).slice(0, PAGE_CAPTURE_LIMITS.maxCandidates);
  if (!selections.length || !Number.isInteger(sender.tab.windowId)) return { ok: true, dataUrls: [] };
  const [activeTab] = await chrome.tabs.query({ active: true, windowId: sender.tab.windowId });
  if (activeTab?.id !== sender.tab.id) return { ok: false, message: "扫描页面已不在前台" };
  const dataUrl = await chrome.tabs.captureVisibleTab(sender.tab.windowId, { format: "png" });
  await ensureOffscreenDocument();
  return chrome.runtime.sendMessage({
    target: "offscreen",
    type: "CROP_PAGE_CAPTURE_PREVIEWS",
    dataUrl,
    selections,
    maxDataUrlCharacters: PAGE_CAPTURE_LIMITS.maxInlinePixelDataCharacters
  });
}

async function cancelPageCapture(sessionIdValue) {
  const sessionId = String(sessionIdValue ?? "").trim();
  if (!activePageCapture || sessionId && sessionId !== activePageCapture.sessionId) return { ok: false, message: "整页扫描已经结束" };
  activePageCapture.cancelled = true;
  try {
    const response = await chrome.tabs.sendMessage(activePageCapture.tabId, {
      type: "PROMPTDIRECTOR_PAGE_CAPTURE", sessionId: activePageCapture.sessionId, action: "cancel"
    });
    return response?.ok ? { ok: true, message: "正在停止整页扫描，并恢复原滚动位置" } : { ok: false, message: "网页扫描器没有响应" };
  } catch {
    return { ok: false, message: "扫描页面已经关闭或刷新" };
  }
}

async function previewPageCaptureRegion(tabIdValue, markerValue) {
  const tabId = Number(tabIdValue);
  if (!Number.isInteger(tabId)) return { ok: false, message: "采集页面已经关闭" };
  try {
    const [result] = await chrome.scripting.executeScript({
      target: { tabId },
      func: renderPageCaptureRegionPreview,
      args: [String(markerValue || "")]
    });
    return result?.result
      ? { ok: true }
      : { ok: false, message: markerValue ? "原网页区域已经变化，请重新扫描" : "区域高亮已关闭" };
  } catch {
    return { ok: false, message: "无法在当前网页显示区域高亮" };
  }
}

async function clearPageCaptureMarkers(tabIdValue, removeRegionMarkers = true) {
  const tabId = Number(tabIdValue);
  if (!Number.isInteger(tabId)) return { ok: false, message: "采集页面已经关闭" };
  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      func: clearPageCapturePageState,
      args: [{ removeRegionMarkers, removePreview: true, removeEditor: true }]
    });
    return { ok: true };
  } catch {
    return { ok: false, message: "采集页面已经关闭或刷新" };
  }
}

async function clearPageCaptureEditorMarkers(tabIdValue) {
  const tabId = Number(tabIdValue);
  if (!Number.isInteger(tabId)) return;
  await chrome.scripting.executeScript({
    target: { tabId },
    func: clearPageCapturePageState,
    args: [{ removeRegionMarkers: false, removePreview: false, removeEditor: true }]
  });
}

function clearPageCapturePageState(optionsValue = {}) {
  const options = optionsValue && typeof optionsValue === "object" ? optionsValue : {};
  if (options.removePreview !== false) document.getElementById("promptdirector-page-capture-region-preview")?.remove();
  if (options.removeEditor !== false) document.getElementById("promptdirector-page-capture-region-editor")?.remove();
  for (const element of document.querySelectorAll("[data-promptdirector-page-edit-include],[data-promptdirector-page-edit-exclude],[data-promptdirector-page-edit-hover]")) {
    element.removeAttribute("data-promptdirector-page-edit-include");
    element.removeAttribute("data-promptdirector-page-edit-exclude");
    element.removeAttribute("data-promptdirector-page-edit-hover");
  }
  if (options.removeRegionMarkers) {
    for (const element of document.querySelectorAll("[data-promptdirector-capture-region]")) {
      element.removeAttribute("data-promptdirector-capture-region");
    }
  }
  return true;
}

async function editPageCaptureRegion(tabIdValue, candidateValue, modeValue) {
  const tabId = Number(tabIdValue);
  const candidate = normalizePageCaptureCandidate(candidateValue);
  const mode = modeValue === "exclude" ? "exclude" : "include";
  if (!Number.isInteger(tabId) || !candidate?.region?.marker) return { ok: false, message: "请先确认一个仍在当前网页中的主体" };
  const token = crypto.randomUUID();
  try {
    const [result] = await chrome.scripting.executeScript({
      target: { tabId },
      func: runPageCaptureRegionEditor,
      args: [candidate.region.marker, mode, token, candidate.region.edits || [], candidate.region.contentTargets || []]
    });
    if (!result?.result?.ok) return result?.result || { ok: false, message: "网页区域修正已取消" };
    if (!result.result.changed) return { ok: false, cancelled: true, message: "没有修改主体区域" };
    const tab = await chrome.tabs.get(tabId);
    const snapshot = await collectPageCaptureTab(tab, {
      sessionId: `edit:${token}`,
      mode: "loaded",
      maxCandidates: 1,
      editedRegion: { marker: candidate.region.marker, token, region: { ...candidate.region, edits: result.result.edits || [] } }
    });
    const revised = snapshot.candidates?.[0];
    if (!revised) return { ok: false, message: "修正后的区域没有可保存内容，原结果保持不变" };
    return {
      ok: true,
      candidate: mergePageCaptureRegionEdit(candidate, revised),
      message: mode === "include" ? "已加入遗漏区域并重建文章预览" : "已排除错误区域并重建文章预览"
    };
  } catch (error) {
    return { ok: false, message: userMessage(error) || "无法修正当前网页区域" };
  } finally {
    await clearPageCaptureEditorMarkers(tabId).catch(() => undefined);
  }
}

function runPageCaptureRegionEditor(markerValue, modeValue, tokenValue, priorEditsValue, contentTargetsValue) {
  const overlayId = "promptdirector-page-capture-region-editor";
  document.getElementById(overlayId)?.remove();
  const marker = String(markerValue || "");
  const mode = modeValue === "exclude" ? "exclude" : "include";
  const token = String(tokenValue || "");
  const baseRoot = [...document.querySelectorAll("[data-promptdirector-capture-region]")]
    .find((element) => element.getAttribute("data-promptdirector-capture-region") === marker);
  if (!baseRoot || !token) return { ok: false, message: "原网页区域已经变化，请重新扫描" };
  const includeAttribute = "data-promptdirector-page-edit-include";
  const excludeAttribute = "data-promptdirector-page-edit-exclude";
  const hoverAttribute = "data-promptdirector-page-edit-hover";
  const priorEdits = (Array.isArray(priorEditsValue) ? priorEditsValue : []).filter((edit) => ["include", "exclude"].includes(edit?.mode) && typeof edit?.path === "string");
  const contentTargets = (Array.isArray(contentTargetsValue) ? contentTargetsValue : []).filter((target) =>
    typeof target?.path === "string" && ["text", "image", "video", "document", "group"].includes(target?.kind));
  let edits = priorEdits.map((edit) => ({ mode: edit.mode, path: edit.path }));
  let groupMode = false;
  const root = document.createElement("div");
  root.id = overlayId;
  root.setAttribute("role", "dialog");
  root.setAttribute("aria-label", mode === "include" ? "添加遗漏区域" : "排除错误区域");
  Object.assign(root.style, {
    position: "fixed", left: "16px", right: "16px", top: "16px", zIndex: "2147483647",
    display: "flex", alignItems: "center", gap: "8px", padding: "10px 12px",
    border: "1px solid rgba(255,255,255,.22)", borderRadius: "10px", color: "#fff",
    background: "rgba(18,20,22,.96)", boxShadow: "0 12px 40px rgba(0,0,0,.42)",
    font: "600 13px/1.4 -apple-system,BlinkMacSystemFont,sans-serif"
  });
  const copy = document.createElement("span");
  copy.style.flex = "1";
  copy.textContent = mode === "include"
    ? "添加遗漏：点击正文、图片、视频或下载区，可连续选择"
    : "排除错误：点击主体内不需要的段落、图片或区域，可连续选择";
  const count = document.createElement("span");
  const makeButton = (label) => {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = label;
    Object.assign(button.style, { border: "1px solid rgba(255,255,255,.25)", borderRadius: "7px", padding: "6px 10px", color: "#fff", background: "rgba(255,255,255,.1)", cursor: "pointer" });
    return button;
  };
  const undo = makeButton("撤销");
  const group = makeButton("整组选择");
  const cancel = makeButton("取消");
  const finish = makeButton("完成");
  finish.style.background = "#86a31d";
  root.append(copy, count, group, undo, cancel, finish);
  const style = document.createElement("style");
  style.textContent = `[${includeAttribute}="${token}"]{outline:4px solid #8fcf3a!important;outline-offset:3px!important}[${excludeAttribute}="${token}"]{outline:4px solid #ff6b5f!important;outline-offset:3px!important;opacity:.48!important}[${hoverAttribute}="${token}"]{outline:3px dashed #ffd65c!important;outline-offset:2px!important}`;
  root.append(style);
  document.documentElement.append(root);
  baseRoot.scrollIntoView({ block: "center", inline: "nearest", behavior: "smooth" });
  const changes = [];
  const targetSelector = "img,video,iframe,a[download],a[href$='.pdf' i],a[href$='.md' i],a[href$='.txt' i],a[href$='.rtf' i],h1,h2,h3,h4,h5,h6,p,li,blockquote,pre,table,figure,article,section,div";
  const updateCount = () => {
    count.textContent = `本次修改 ${changes.length} 处`;
    undo.disabled = !changes.length;
  };
  const elementPath = (element) => {
    const parts = [];
    let current = element;
    while (current && current.nodeType === 1) {
      const tag = current.tagName.toLocaleLowerCase("en-US");
      const siblings = [...(current.parentElement?.children || [])].filter((item) => item.tagName === current.tagName);
      parts.unshift(`${tag}:nth-of-type(${Math.max(1, siblings.indexOf(current) + 1)})`);
      if (current === document.body) break;
      current = current.parentElement;
    }
    return parts.join(" > ");
  };
  const applyEdits = () => {
    document.querySelectorAll(`[${includeAttribute}],[${excludeAttribute}]`).forEach((element) => {
      element.removeAttribute(includeAttribute);
      element.removeAttribute(excludeAttribute);
    });
    for (const edit of edits) {
      let element = null;
      try { element = document.querySelector(edit.path); } catch { continue; }
      if (!element) continue;
      element.removeAttribute(edit.mode === "include" ? excludeAttribute : includeAttribute);
      element.setAttribute(edit.mode === "include" ? includeAttribute : excludeAttribute, token);
    }
  };
  const resolvedTargets = contentTargets.flatMap((target) => {
    try {
      const element = document.querySelector(target.path);
      return element ? [{ ...target, element }] : [];
    } catch {
      return [];
    }
  });
  const elementDepth = (element) => {
    let depth = 0;
    for (let current = element; current?.parentElement; current = current.parentElement) depth += 1;
    return depth;
  };
  const meaningfulFallback = (eventTarget) => {
    const closest = eventTarget.closest?.(targetSelector);
    if (!closest) return null;
    if (!closest.matches?.("div")) return closest;
    const text = String(closest.innerText || closest.textContent || "").replace(/\s+/gu, " ").trim();
    const hasMediaOrResource = Boolean(closest.querySelector?.("img,video,iframe,a[download],a[href$='.pdf' i],a[href$='.md' i],a[href$='.txt' i],a[href$='.rtf' i]"));
    const hasDirectText = [...(closest.childNodes || [])].some((node) => node.nodeType === 3 && String(node.textContent || "").trim());
    return hasDirectText || hasMediaOrResource || text ? closest : null;
  };
  const cleanup = (restore) => {
    document.removeEventListener("click", onClick, true);
    document.removeEventListener("keydown", onKeydown, true);
    document.removeEventListener("pointerover", onPointerOver, true);
    if (restore) {
      edits = priorEdits.map((edit) => ({ mode: edit.mode, path: edit.path }));
      applyEdits();
    }
    root.remove();
  };
  const targetFor = (eventTarget) => {
    if (!(eventTarget instanceof Element)) return null;
    const matching = resolvedTargets.filter((target) => target.element === eventTarget || target.element.contains?.(eventTarget));
    const leaf = matching.filter((target) => target.kind !== "group").sort((left, right) => elementDepth(right.element) - elementDepth(left.element))[0];
    const selectedTarget = groupMode
      ? matching.filter((target) => target.kind === "group" && (!leaf?.groupId || target.id === leaf.groupId))
        .sort((left, right) => elementDepth(right.element) - elementDepth(left.element))[0]
      : leaf;
    const element = selectedTarget?.element || meaningfulFallback(eventTarget);
    if (!element || root.contains(element) || element.closest("nav,header,footer,[role=navigation],[role=banner],[role=contentinfo]")) return null;
    if (mode === "exclude" && (!baseRoot.contains(element) || element === baseRoot)) return null;
    if (mode === "include" && baseRoot.contains(element) && element.getAttribute(excludeAttribute) !== token) return null;
    return element;
  };
  const onPointerOver = (event) => {
    document.querySelectorAll(`[${hoverAttribute}]`).forEach((element) => element.removeAttribute(hoverAttribute));
    const element = targetFor(event.target);
    if (element) element.setAttribute(hoverAttribute, token);
  };
  const onClick = (event) => {
    const element = targetFor(event.target);
    if (!element) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    const edit = { mode, path: elementPath(element) };
    edits.push(edit);
    changes.push(edit);
    applyEdits();
    updateCount();
  };
  const onKeydown = (event) => {
    if (event.key !== "Escape") return;
    event.preventDefault();
    cancel.click();
  };
  document.addEventListener("click", onClick, true);
  document.addEventListener("keydown", onKeydown, true);
  document.addEventListener("pointerover", onPointerOver, true);
  applyEdits();
  updateCount();
  return new Promise((resolve) => {
    group.addEventListener("click", (event) => {
      event.stopPropagation();
      groupMode = !groupMode;
      group.textContent = groupMode ? "整组选择：开" : "整组选择";
      group.style.background = groupMode ? "#5f7613" : "rgba(255,255,255,.1)";
    });
    undo.addEventListener("click", (event) => {
      event.stopPropagation();
      if (changes.pop()) edits.pop();
      applyEdits();
      updateCount();
    });
    cancel.addEventListener("click", (event) => {
      event.stopPropagation();
      cleanup(true);
      resolve({ ok: false, cancelled: true, message: "网页区域修正已取消" });
    });
    finish.addEventListener("click", (event) => {
      event.stopPropagation();
      const changed = changes.length > 0;
      cleanup(false);
      resolve({ ok: true, changed, token, edits });
    });
  });
}

function renderPageCaptureRegionPreview(markerValue) {
  const overlayId = "promptdirector-page-capture-region-preview";
  document.getElementById(overlayId)?.remove();
  const marker = String(markerValue || "");
  if (!marker) return true;
  const target = [...document.querySelectorAll("[data-promptdirector-capture-region]")]
    .find((element) => element.getAttribute("data-promptdirector-capture-region") === marker);
  if (!target) return false;
  target.scrollIntoView({ block: "center", inline: "nearest", behavior: "smooth" });
  const rect = target.getBoundingClientRect();
  const overlay = document.createElement("div");
  overlay.id = overlayId;
  overlay.setAttribute("aria-hidden", "true");
  Object.assign(overlay.style, {
    position: "fixed",
    left: `${Math.max(0, rect.left)}px`,
    top: `${Math.max(0, rect.top)}px`,
    width: `${Math.max(1, Math.min(window.innerWidth, rect.right) - Math.max(0, rect.left))}px`,
    height: `${Math.max(1, Math.min(window.innerHeight, rect.bottom) - Math.max(0, rect.top))}px`,
    border: "3px solid Highlight",
    borderRadius: "8px",
    background: "color-mix(in srgb, Highlight 12%, transparent)",
    boxSizing: "border-box",
    pointerEvents: "none",
    zIndex: "2147483647"
  });
  document.documentElement.append(overlay);
  return true;
}

async function commitPageCapture(batchValue) {
  let batch = normalizePageCaptureBatch(batchValue);
  if (Number.isInteger(batch.tabId) && batch.candidates.some((candidate) => candidate.media.some((media) => media.fallbackRect && !media.dataUrl))) {
    try {
      const tab = await chrome.tabs.get(batch.tabId);
      batch = normalizePageCaptureBatch(await addVisiblePageCaptureFallbacks(batch, tab));
    } catch {
    }
  }
  let selected = applyPageCaptureSelections(batch);
  if (batch.captureMode === "list" && batch.saveMode === "combined" && selected.length) {
    const combined = combinePageCaptureCandidates(selected, {
      title: batch.combinedTitle,
      canonicalUrl: batch.sourceUrl
    });
    selected = combined ? [combined] : [];
  }
  if (!selected.length) return { ok: false, message: "请至少选择一项网页内容" };
  const state = await readState();
  const results = [];
  let entries = [...state.entries];
  const savedAssetIds = [];
  let metadataCommitted = false;
  try {
    for (const candidate of selected) {
      const duplicate = entries.find((entry) => entry.url === candidate.canonicalUrl
        || (candidate.sourceFacts.itemId && entry.sourceFacts?.provider === candidate.sourceFacts.provider && entry.sourceFacts?.itemId === candidate.sourceFacts.itemId));
      if (duplicate) {
        results.push({ candidateId: candidate.id, status: "duplicate", entryId: duplicate.id, title: duplicate.title });
        continue;
      }
      const mediaAssets = [];
      const articleAssetIds = new Map();
      const warnings = [];
      for (const media of candidate.media) {
        if (media.kind === "document") {
          if (!isSupportedDocumentMimeType(media.mimeType)) {
            warnings.push(`${media.filename || media.alt || media.url}：已保留来源链接，未知或高风险文件不会自动下载`);
            continue;
          }
          const assetId = crypto.randomUUID();
          try {
            const blob = await fetchBoundedMedia(media.url, {
              kind: "document",
              expectedMimeType: media.mimeType,
              maxBytes: PORTABLE_LIBRARY_LIMITS.maxFileBytes,
              timeoutMs: 60_000,
              accept: "application/pdf,text/markdown,text/plain,text/html,application/rtf,text/rtf,application/x-rtf"
            });
            const contentHash = await sha256Blob(blob);
            const existing = entries.flatMap(entryMediaAssets).find((asset) => asset.contentHash === contentHash);
            if (existing) {
              if (!mediaAssets.some((asset) => asset.id === existing.id)) mediaAssets.push(existing);
              articleAssetIds.set(media.id, existing.id);
              warnings.push(`已复用重复文档：${media.filename || media.alt || media.url}`);
              continue;
            }
            await saveMediaBlob(assetId, blob);
            savedAssetIds.push(assetId);
            const documentAsset = {
              id: assetId,
              kind: "document",
              storageMode: "managed",
              sourceUrl: media.url,
              sourceTitle: media.filename || media.sourceTitle || media.alt || candidate.title,
              sourceAuthor: media.sourceAuthor || candidate.sourceFacts.author,
              originalWorkUrl: media.originalWorkUrl || candidate.canonicalUrl,
              mimeType: blob.type,
              byteSize: blob.size,
              contentHash,
              extractedTextFormat: ["text/markdown", "text/html", "application/rtf", "text/rtf", "application/x-rtf"].includes(blob.type) ? "markdown" : "plain",
              capturedAt: new Date().toISOString(),
              reviewStatus: "verified"
            };
            mediaAssets.push(documentAsset);
            articleAssetIds.set(media.id, documentAsset.id);
          } catch (error) {
            warnings.push(`${media.filename || media.alt || media.url}：本地副本未保存，已保留来源链接（${userMessage(error)}）`);
          }
          continue;
        }
        if (media.kind === "video") {
          const referenceUrl = media.url || candidate.canonicalUrl;
          const provider = detectMediaReferenceProvider(referenceUrl);
          const playbackMode = ["youtube", "vimeo", "bilibili", "douyin", "x"].includes(provider) ? "embed" : "source";
          const videoAsset = {
            id: crypto.randomUUID(),
            kind: "video",
            storageMode: "reference",
            sourceUrl: referenceUrl,
            sourceTitle: media.sourceTitle || candidate.title,
            sourceAuthor: media.sourceAuthor || candidate.sourceFacts.author,
            originalWorkUrl: media.originalWorkUrl || candidate.canonicalUrl,
            width: media.width,
            height: media.height,
            capturedAt: new Date().toISOString(),
            playbackCapability: playbackMode === "embed" ? "embedded" : "external",
            reference: { url: referenceUrl, provider, playbackMode },
            reviewStatus: "verified"
          };
          mediaAssets.push(videoAsset);
          articleAssetIds.set(media.id, videoAsset.id);
          continue;
        }
        const assetId = crypto.randomUUID();
        try {
          const resolved = await resolvePageCaptureImage(media, {
            sessionMediaAllowed: batch.sessionMediaAllowed,
            fetchMedia: async (url) => {
              let metadata = null;
              const blob = await fetchBoundedMedia(url, {
                kind: "image",
                maxBytes: PORTABLE_LIBRARY_LIMITS.maxImageBytes,
                maxPixels: PORTABLE_LIBRARY_LIMITS.maxImagePixels,
                timeoutMs: 60_000,
                accept: "image/avif,image/webp,image/png,image/jpeg,image/gif",
                onMetadata: (value) => { metadata = value; }
              });
              return { blob, metadata };
            },
            fetchSessionMedia: async (url) => fetchSelectedPageSessionImage(batch, candidate, url),
            decodeDataUrl: dataUrlToImageBlob
          });
          const blob = resolved.blob;
          const contentHash = await sha256Blob(blob);
          const existing = entries.flatMap(entryMediaAssets).find((asset) => asset.contentHash === contentHash);
          if (existing) {
            if (!mediaAssets.some((asset) => asset.id === existing.id)) mediaAssets.push(existing);
            articleAssetIds.set(media.id, existing.id);
            warnings.push(`已复用重复媒体：${media.alt || media.url}`);
            continue;
          }
          await saveMediaBlob(assetId, blob);
          savedAssetIds.push(assetId);
          const imageAsset = {
            id: assetId,
            kind: "image",
            storageMode: "managed",
            sourceUrl: resolved.sourceUrl || media.url || candidate.canonicalUrl,
            sourceTitle: media.sourceTitle || media.alt || candidate.title,
            sourceAuthor: media.sourceAuthor || candidate.sourceFacts.author,
            originalWorkUrl: media.originalWorkUrl || candidate.canonicalUrl,
            mimeType: blob.type,
            byteSize: blob.size,
            width: resolved.metadata?.width || media.width,
            height: resolved.metadata?.height || media.height,
            contentHash,
            captureMethod: resolved.captureMethod || media.captureMethod,
            capturedAt: new Date().toISOString(),
            reviewStatus: "verified"
          };
          mediaAssets.push(imageAsset);
          articleAssetIds.set(media.id, imageAsset.id);
          if (resolved.usedPixelFallback) warnings.push(`${media.alt || candidate.title}：原图不可用，已保存页面可见画面`);
        } catch (error) {
          warnings.push(`${media.alt || media.url}：${userMessage(error)}`);
        }
      }
      const articleText = articleDocumentText(candidate.articleDocument);
      const base = buildEntry({
        text: articleText || candidate.contentText || candidate.excerpt,
        title: candidate.title,
        url: candidate.canonicalUrl,
        allowEmptyText: mediaAssets.length > 0
      });
      if (!base.text && !mediaAssets.length) {
        results.push({ candidateId: candidate.id, status: "failed", title: candidate.title, warnings: [...warnings, "没有可保存的正文或媒体"] });
        continue;
      }
      const classificationMediaAssets = candidate.sourceFacts.pageType === "post" && base.text ? [] : mediaAssets;
      const entry = normalizeEntryMedia({
        ...base,
        schemaVersion: SCHEMA_VERSION,
        articleDocument: finalizeArticleDocumentAssets(candidate.articleDocument, articleAssetIds),
        sourceFacts: candidate.sourceFacts,
        sourcePages: [{ url: candidate.canonicalUrl, title: candidate.title }],
        mediaAssets,
        primaryMediaId: mediaAssets.find((asset) => asset.kind === "image")?.id || mediaAssets[0]?.id || "",
        classification: classifyContent({ ...base, mediaAssets: classificationMediaAssets }, state.classificationRules, state.taxonomy),
        customLabels: [], metadataLabels: [], facetAssignments: [], analysisCandidates: [], analysisBreakdown: [],
        rejectedCandidateKeys: [], negativeTerms: [], legacyFacetCandidates: [], analysisPending: false
      });
      entries.push(entry);
      results.push({ candidateId: candidate.id, status: warnings.length ? "partial" : "saved", entryId: entry.id, title: entry.title, warnings });
    }
    if (!results.some((item) => ["saved", "partial"].includes(item.status))) {
      return { ok: true, message: "所选内容均已存在或无法保存", results };
    }
    await commitLocalChanges({ [STORAGE_KEYS.entries]: entries });
    metadataCommitted = true;
    const postCommitWarnings = [];
    try { await notifySaved(entries.length); }
    catch (error) { postCommitWarnings.push(`保存成功，但状态提示更新失败：${userMessage(error)}`); }
    const newImageEntries = results.filter((item) => ["saved", "partial"].includes(item.status)).map((item) => item.entryId)
      .filter((entryId) => entries.find((entry) => entry.id === entryId)?.mediaAssets?.some((asset) => asset.kind === "image"));
    if (newImageEntries.length) {
      try { await queueAutomaticVisionAnalysis(newImageEntries); }
      catch (error) { postCommitWarnings.push(`案例已保存，但自动画面分析没有加入队列：${userMessage(error)}`); }
    }
    const savedCount = results.filter((item) => ["saved", "partial"].includes(item.status)).length;
    const duplicateCount = results.filter((item) => item.status === "duplicate").length;
    return {
      ok: true,
      message: `已保存 ${savedCount} 项${duplicateCount ? `，跳过 ${duplicateCount} 项重复内容` : ""}${postCommitWarnings.length ? `；${postCommitWarnings.join("；")}` : ""}`,
      results,
      warnings: postCommitWarnings
    };
  } catch (error) {
    if (!metadataCommitted) await Promise.allSettled(savedAssetIds.map((assetId) => deleteMediaBlob(assetId)));
    throw error;
  }
}

async function fetchSelectedPageSessionImage(batch, candidate, value) {
  if (!Number.isInteger(batch?.tabId)) throw new Error("原网页标签页已经不可用");
  const tab = await chrome.tabs.get(batch.tabId);
  let currentOrigin;
  let capturedOrigin;
  try {
    currentOrigin = new URL(tab.url).origin;
    capturedOrigin = new URL(batch.sourceUrl || candidate.canonicalUrl).origin;
  } catch {
    throw new Error("原网页地址已经不可用");
  }
  if (currentOrigin !== capturedOrigin) throw new Error("原网页已经跳转，未使用页面登录状态读取媒体");
  const allowedUrls = pageCaptureMediaFetchCandidatesForSession(candidate, value);
  if (!allowedUrls.includes(value)) throw new Error("页面媒体地址不在已选择内容中");
  const token = crypto.randomUUID();
  try {
    const [preparedResult] = await chrome.scripting.executeScript({
      target: { tabId: batch.tabId },
      world: "MAIN",
      func: preparePageSessionMedia,
      args: [{
        token,
        url: value,
        allowedUrls,
        maxBytes: PORTABLE_LIBRARY_LIMITS.maxImageBytes,
        chunkBytes: PAGE_SESSION_MEDIA_CHUNK_BYTES
      }]
    });
    const prepared = preparedResult?.result;
    if (!prepared || prepared.token !== token || !Number.isSafeInteger(prepared.chunkCount) || prepared.chunkCount <= 0) {
      throw new Error("页面没有返回有效媒体");
    }
    const chunks = [];
    let totalBytes = 0;
    for (let index = 0; index < prepared.chunkCount; index += 1) {
      const [chunkResult] = await chrome.scripting.executeScript({
        target: { tabId: batch.tabId },
        world: "MAIN",
        func: readPageSessionMediaChunk,
        args: [{ token, index }]
      });
      const binary = globalThis.atob(String(chunkResult?.result || ""));
      const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
      totalBytes += bytes.byteLength;
      if (totalBytes > PORTABLE_LIBRARY_LIMITS.maxImageBytes) throw new Error("页面媒体超过本地容量上限");
      chunks.push(bytes);
    }
    if (totalBytes !== prepared.totalBytes) throw new Error("页面媒体传输不完整");
    const combined = new Uint8Array(totalBytes);
    let offset = 0;
    for (const chunk of chunks) {
      combined.set(chunk, offset);
      offset += chunk.byteLength;
    }
    let metadata = null;
    const blob = await boundedMediaBlobFromResponse(new Response(combined, {
      headers: { "content-type": String(prepared.contentType || "application/octet-stream") }
    }), {
      kind: "image",
      maxBytes: PORTABLE_LIBRARY_LIMITS.maxImageBytes,
      maxPixels: PORTABLE_LIBRARY_LIMITS.maxImagePixels,
      onMetadata: (value) => { metadata = value; }
    });
    return { blob, metadata };
  } finally {
    await chrome.scripting.executeScript({
      target: { tabId: batch.tabId },
      world: "MAIN",
      func: discardPageSessionMedia,
      args: [{ token }]
    }).catch(() => undefined);
  }
}

function pageCaptureMediaFetchCandidatesForSession(candidate, selectedUrl) {
  const urls = new Set();
  for (const media of candidate?.media || []) {
    for (const url of pageCaptureMediaFetchCandidates(media)) urls.add(url);
  }
  return urls.has(selectedUrl) ? [...urls] : [];
}

async function startCaptureForCase(caseId, partEntryId = "") {
  const current = await captureRuntime.getDraft();
  if (current.fragments.length || current.visuals.length || current.targetCaseId) {
    return { ok: false, message: "当前还有未保存草稿，请先保存或丢弃" };
  }
  const state = await readState();
  const compound = normalizeCompoundCases(state.compoundCases, state.entries).find((item) => item.id === String(caseId ?? ""));
  const entryId = String(partEntryId || (compound ? compound.memberEntryIds[0] : caseId) || "");
  const entry = findEntry(state, entryId);
  const draft = createCaptureDraft({
    targetCaseId: compound?.id || entry.id,
    targetPartEntryId: partEntryId ? entry.id : "",
    title: compound?.title || entry.title,
    contentTypeId: entry.classification?.pathIds?.[0] || "",
    customLabels: entry.customLabels
  });
  await commitLocalChanges({ [STORAGE_KEYS.captureDraft]: draft });
  return { ok: true, message: `正在为“${compound?.title || entry.title}”继续采集`, draft, sourceUrl: entry.url };
}

async function createCompoundCaseAction(message) {
  const state = await readState();
  const result = createCompoundCase(state.compoundCases, state.entries, {
    id: message.compoundCaseId,
    title: message.title,
    memberEntryIds: message.memberEntryIds,
    coverVisualId: message.coverVisualId,
    customLabels: message.customLabels
  });
  await commitLocalChanges({ [STORAGE_KEYS.compoundCases]: result.compoundCases });
  return { ok: true, message: "案例已组合，可随时拆分", compoundCase: result.compoundCase };
}

async function updateCompoundCaseAction(message) {
  const state = await readState();
  const result = updateCompoundCase(state.compoundCases, state.entries, message.compoundCaseId, {
    title: message.title,
    memberEntryIds: message.memberEntryIds,
    coverVisualId: message.coverVisualId,
    customLabels: message.customLabels
  });
  await commitLocalChanges({ [STORAGE_KEYS.compoundCases]: result.compoundCases });
  return {
    ok: true,
    message: result.split ? "成员不足两个，已恢复为独立案例" : "组合内容已更新",
    compoundCase: result.compoundCase
  };
}

async function splitCompoundCaseAction(compoundCaseId) {
  const state = await readState();
  const result = splitCompoundCase(state.compoundCases, state.entries, compoundCaseId);
  await commitLocalChanges({ [STORAGE_KEYS.compoundCases]: result.compoundCases });
  return { ok: true, message: `已拆分为 ${result.memberEntryIds.length} 个独立案例`, memberEntryIds: result.memberEntryIds };
}

async function setEntryPrimaryVisual(entryId, visualId) {
  const state = await readState();
  const current = findEntry(state, entryId);
  const next = setPrimaryVisual(current, visualId);
  const updated = next.primaryVisualId === current.primaryVisualId ? next : touchEntry(next);
  const entries = state.entries.map((entry) => entry.id === current.id ? updated : entry);
  await commitLocalChanges({ [STORAGE_KEYS.entries]: entries });
  return { ok: true, message: "主图已更新", entry: updated };
}

async function deleteEntryVisual(entryId, visualId) {
  return moveEntryMediaToTrash(entryId, visualId, {
    missingMessage: "没有找到这张截图",
    successMessage: "截图已移入回收站，案例文字和其他截图保持不变"
  });
}

async function addUploadedVisual(entryId, visualValue) {
  const state = await readState();
  const current = findEntry(state, entryId);
  const visualId = String(visualValue?.id ?? "").trim();
  if (!visualId || !await getScreenshotBlob(visualId)) throw new Error("没有读取到待添加的图片");
  const updated = touchEntry(addEntryVisual(current, {
    ...visualValue,
    id: visualId,
    sourceUrl: current.url,
    sourceTitle: current.title,
    capturedAt: new Date().toISOString(),
    reviewStatus: "verified"
  }));
  const entries = state.entries.map((entry) => entry.id === current.id ? updated : entry);
  await commitLocalChanges({ [STORAGE_KEYS.entries]: entries });
  await queueAutomaticVisionAnalysis([updated.id]);
  return { ok: true, message: `图片已加入案例 · 共 ${updated.visuals.length} 张`, entry: updated };
}

async function setEntryPrimaryMedia(entryId, assetId) {
  const state = await readState();
  const current = findEntry(state, entryId);
  const next = setPrimaryMedia(current, assetId);
  const updated = next.primaryMediaId === current.primaryMediaId ? next : touchEntry(next);
  const entries = state.entries.map((entry) => entry.id === current.id ? updated : entry);
  await commitLocalChanges({ [STORAGE_KEYS.entries]: entries });
  return { ok: true, message: "主要媒体已更新", entry: updated };
}

async function deleteEntryMedia(entryId, assetId) {
  return moveEntryMediaToTrash(entryId, assetId, {
    missingMessage: "没有找到这个媒体",
    successMessage: "媒体已移入回收站，案例文字和其他资料保持不变"
  });
}

async function moveEntryMediaToTrash(entryId, assetId, messages) {
  const state = await readState();
  const current = normalizeEntryMedia(findEntry(state, entryId));
  const asset = current.mediaAssets.find((item) => item.id === String(assetId ?? ""));
  if (!asset) return { ok: false, message: messages.missingMessage };
  const moved = moveMediaToTrash({
    entries: state.entries,
    trashState: state.trashState
  }, current.id, [asset.id]);
  const entries = touchEntries(moved.entries, [current.id]);
  const updated = entries.find((entry) => entry.id === current.id);
  await commitLocalChanges({
    [STORAGE_KEYS.entries]: entries,
    [STORAGE_KEYS.trashState]: moved.trashState
  });
  return {
    ok: true,
    message: messages.successMessage,
    movedItemIds: moved.movedItemIds,
    entry: updated,
    trashState: moved.trashState
  };
}

async function updateLocalAssetReferenceAction(message = {}) {
  const state = await readState();
  const current = findEntry(state, String(message.entryId ?? "").trim());
  const updated = updateLocalAssetReferenceMetadata(current, message.assetId, {
    sourceTitle: message.sourceTitle,
    relativePath: message.relativePath,
    sourceFormat: message.sourceFormat,
    mimeType: message.mimeType,
    byteSize: message.byteSize,
    sourceLastModified: message.sourceLastModified
  });
  const entry = touchEntry(updated.entry);
  const entries = state.entries.map((item) => item.id === entry.id ? entry : item);
  await commitLocalChanges({ [STORAGE_KEYS.entries]: entries });
  return {
    ok: true,
    message: "本机源文件链接已更新",
    entry,
    asset: entry.mediaAssets.find((item) => item.id === updated.asset.id)
  };
}

async function addUploadedMedia(entryId, assetValue, posterValue = null) {
  const state = await readState();
  const current = findEntry(state, entryId);
  const assetId = String(assetValue?.id ?? "").trim();
  const storageMode = assetValue?.storageMode === "reference" ? "reference" : "managed";
  if (!assetId || (storageMode === "managed" && !await getMediaBlob(assetId))) {
    throw new Error("没有读取到待添加的媒体文件");
  }
  let updated = addEntryMedia(current, {
    ...assetValue,
    id: assetId,
    storageMode,
    sourceUrl: assetValue?.sourceUrl || current.url,
    sourceTitle: assetValue?.sourceTitle || current.title,
    capturedAt: new Date().toISOString(),
    reviewStatus: "verified"
  });
  if (posterValue?.id) {
    if (!await getMediaBlob(posterValue.id)) throw new Error("没有读取到视频封面");
    updated = addEntryMedia(updated, { ...posterValue, usage: "poster", derivedFromAssetId: assetId, storageMode: "managed" });
  }
  updated = touchEntry(updated);
  const entries = state.entries.map((entry) => entry.id === current.id ? updated : entry);
  await commitLocalChanges({ [STORAGE_KEYS.entries]: entries });
  if (assetValue?.kind === "image") await queueAutomaticVisionAnalysis([updated.id]);
  const contentCount = updated.mediaAssets.filter((item) => item.usage !== "poster").length;
  return { ok: true, message: `资料已加入案例 · 共 ${contentCount} 项`, entry: updated };
}

async function createMediaCase(assetValue, posterValue, titleValue, textValue = "") {
  const assetId = String(assetValue?.id ?? "").trim();
  if (!assetId || !await getMediaBlob(assetId)) throw new Error("没有读取到待保存的媒体文件");
  const state = await readState();
  const base = buildEntry({ text: textValue, title: titleValue, url: "", allowEmptyText: true });
  const mediaAssets = [{ ...assetValue, id: assetId, storageMode: "managed", capturedAt: new Date().toISOString(), reviewStatus: "verified" }];
  if (posterValue?.id) {
    if (!await getMediaBlob(posterValue.id)) throw new Error("没有读取到视频封面");
    mediaAssets.push({ ...posterValue, usage: "poster", derivedFromAssetId: assetId, storageMode: "managed" });
  }
  const classification = classifyImportedMedia({ ...base, mediaAssets }, state.taxonomy);
  const entry = normalizeEntryMedia({
    ...base,
    schemaVersion: SCHEMA_VERSION,
    mediaAssets,
    primaryMediaId: assetId,
    classification,
    customLabels: [], metadataLabels: [], facetAssignments: [], analysisCandidates: [], analysisBreakdown: [],
    rejectedCandidateKeys: [], negativeTerms: [], legacyFacetCandidates: [], analysisPending: false
  });
  const entries = [...state.entries, entry];
  await retireLastSaveUndo();
  await commitLocalChanges({
    [STORAGE_KEYS.entries]: entries,
    [STORAGE_KEYS.lastSaveUndo]: createEntrySaveUndo(entry.id)
  });
  await enqueueAutomaticLibraryMaintenance([entry]);
  await notifySaved(entries.length);
  if (assetValue?.kind === "image") await queueAutomaticVisionAnalysis([entry.id]);
  return { ok: true, message: "资料已保存", entry };
}

async function createMediaReferenceCase(assetValue, posterValue, titleValue, organization = {}) {
  const state = await readState();
  const sourceUrl = String(assetValue?.reference?.url || assetValue?.sourceUrl || "").trim();
  const base = buildEntry({ text: "", title: titleValue, url: sourceUrl, allowEmptyText: true });
  const mediaAssets = [{ ...assetValue, storageMode: "reference", sourceUrl, capturedAt: new Date().toISOString(), reviewStatus: "verified" }];
  if (posterValue?.id) {
    if (!await getMediaBlob(posterValue.id)) throw new Error("没有读取到视频封面");
    mediaAssets.push({ ...posterValue, usage: "poster", derivedFromAssetId: assetValue?.id, storageMode: "managed" });
  }
  const entry = normalizeEntryMedia({
    ...base,
    schemaVersion: SCHEMA_VERSION,
    mediaAssets,
    primaryMediaId: assetValue?.id,
    classification: classifyContent({ ...base, mediaAssets }, state.classificationRules, state.taxonomy),
    customLabels: uniqueNames(organization.customLabels), metadataLabels: [], facetAssignments: [], analysisCandidates: [], analysisBreakdown: [],
    rejectedCandidateKeys: [], negativeTerms: [], legacyFacetCandidates: [], analysisPending: false
  });
  const entries = [...state.entries, entry];
  const organizerState = organizerAfterCapturePlacement(state.organizerState, entries, [entry.id], organization);
  await commitLocalChanges({
    [STORAGE_KEYS.entries]: entries,
    [STORAGE_KEYS.organizerState]: organizerState
  });
  await notifySaved(entries.length);
  return { ok: true, message: "视频来源已保存；不能嵌入的平台会打开原网页", entry };
}

async function createQuickNote(titleValue, textValue, organization = {}) {
  const state = await readState();
  const entry = buildEntry({ text: textValue, title: titleValue, url: "" });
  entry.schemaVersion = SCHEMA_VERSION;
  entry.classification = classifyImportedMedia({ ...entry, sourceKind: "quick_note" }, state.taxonomy);
  entry.customLabels = uniqueNames(organization.customLabels);
  const entries = [...state.entries, entry];
  const organizerState = organizerAfterCapturePlacement(state.organizerState, entries, [entry.id], organization);
  await retireLastSaveUndo();
  await commitLocalChanges({
    [STORAGE_KEYS.entries]: entries,
    [STORAGE_KEYS.organizerState]: organizerState,
    [STORAGE_KEYS.lastSaveUndo]: createEntrySaveUndo(entry.id)
  });
  await notifySaved(entries.length);
  return { ok: true, message: "快速笔记已保存", entry };
}

async function addEntryTimeNote(entryId, noteValue) {
  const state = await readState();
  const current = findEntry(state, entryId);
  const updated = touchEntry(addTimeNote(current, noteValue));
  const entries = state.entries.map((entry) => entry.id === current.id ? updated : entry);
  await commitLocalChanges({ [STORAGE_KEYS.entries]: entries });
  return { ok: true, message: "时间点笔记已保存", entry: updated };
}

async function addVideoKeyframe(entryId, assetValue, noteValue) {
  const state = await readState();
  const current = normalizeEntryMedia(findEntry(state, entryId));
  const frameId = String(assetValue?.id ?? "").trim();
  if (!frameId || !await getMediaBlob(frameId)) throw new Error("没有读取到关键帧图片");
  let updated = addEntryMedia(current, {
    ...assetValue,
    id: frameId,
    kind: "image",
    storageMode: "managed",
    capturedAt: new Date().toISOString(),
    reviewStatus: "verified"
  });
  updated = addTimeNote(updated, { ...noteValue, frameAssetId: frameId });
  updated = touchEntry(updated);
  const entries = state.entries.map((entry) => entry.id === current.id ? updated : entry);
  await commitLocalChanges({ [STORAGE_KEYS.entries]: entries });
  return { ok: true, message: "当前画面和时间点笔记已保存", entry: updated };
}

async function deleteEntryTimeNote(entryId, noteId) {
  const state = await readState();
  const current = findEntry(state, entryId);
  const next = removeTimeNote(current, noteId);
  const updated = (next.timeNotes ?? []).length === (current.timeNotes ?? []).length ? next : touchEntry(next);
  const entries = state.entries.map((entry) => entry.id === current.id ? updated : entry);
  await commitLocalChanges({ [STORAGE_KEYS.entries]: entries });
  return { ok: true, message: "时间点笔记已删除", entry: updated };
}

async function commitCaptureDraft(duplicateAction = "", placementValue = {}) {
  const draft = await captureRuntime.getDraft();
  if (!draft.fragments.length && !draft.visuals.length) return { ok: false, message: "草稿里还没有可保存的文字或截图", draft };
  const state = await readState();
  const targetCompound = normalizeCompoundCases(state.compoundCases, state.entries)
    .find((compound) => compound.id === draft.targetCaseId) ?? null;
  const placement = capturePlacement(draft, placementValue);
  if (targetCompound) return commitCaptureIntoCompound(draft, draftParts(draft), state, targetCompound, placement);
  const text = draftText(draft);
  const sourcePages = mergeSourcePages(draftSourcePages(draft), draft.visuals.map((visual) => {
    const context = sourceContextForUrl(draft, visual.sourceUrl);
    return { url: visual.sourceUrl, title: context?.displayTitle || visual.sourceTitle };
  }));
  const firstVisual = draft.visuals[0];
  const sourceUrl = sourcePages[0]?.url || firstVisual?.sourceUrl || "";
  const sourceContext = sourceContextForUrl(draft, sourceUrl);
  const sourceFacts = sourceFactsForCaptureContext(sourceContext);
  const sourceTitle = draft.title || sourceContext?.displayTitle || sourcePages[0]?.title || firstVisual?.sourceTitle || "未命名案例";
  const candidateBase = buildEntry({ text, title: sourceTitle, url: sourceUrl, allowEmptyText: draft.visuals.length > 0 });
  const explicitTarget = draft.targetCaseId
    ? state.entries.find((entryValue) => entryValue.id === draft.targetCaseId) ?? null
    : null;
  if (draft.targetCaseId && !explicitTarget) throw new Error("要继续采集的案例已经不存在");
  const duplicate = !explicitTarget && text ? findDuplicate(state.entries, candidateBase) : null;
  if (duplicate && !["merge", "new"].includes(duplicateAction)) {
    return { ok: false, duplicate: true, existing: { id: duplicate.id, title: duplicate.title }, draft };
  }
  const target = explicitTarget ?? (duplicateAction === "merge" ? duplicate : null);
  let entry;
  let created = false;
  if (target) {
    entry = normalizeEntryVisuals(target);
    const nextText = text && !entry.text.includes(text) ? [entry.text, text].filter(Boolean).join("\n\n") : entry.text;
    entry = {
      ...markEntryTextChanged(entry, nextText),
      sourcePages: mergeSourcePages(entry.sourcePages, sourcePages),
      ...(sourceFacts ? { sourceFacts } : {}),
      customLabels: draft.customLabelsExplicit ? uniqueNames(draft.customLabels) : uniqueNames(entry.customLabels)
    };
    if (draft.contentTypeExplicit && isValidContentPath(state.taxonomy, [draft.contentTypeId])) {
      entry.classification = {
        pathIds: [draft.contentTypeId],
        status: "confirmed",
        source: "manual",
        reason: "保存前人工确认"
      };
    }
    for (const visual of draft.visuals) entry = addEntryVisual(entry, visual);
    if (draft.primaryVisualExplicit && draft.primaryVisualId) entry = setPrimaryVisual(entry, draft.primaryVisualId);
  } else {
    created = true;
    entry = normalizeEntryVisuals({
      ...candidateBase,
      schemaVersion: SCHEMA_VERSION,
      title: sourceTitle,
      sourcePages,
      ...(sourceFacts ? { sourceFacts } : {}),
      visuals: draft.visuals,
      primaryVisualId: draft.primaryVisualId,
      classification: draft.contentTypeExplicit && isValidContentPath(state.taxonomy, [draft.contentTypeId])
        ? { pathIds: [draft.contentTypeId], status: "confirmed", source: "manual", reason: "保存前人工确认" }
        : captureDraftClassification(draft, state),
      customLabels: uniqueNames(draft.customLabels),
      metadataLabels: [],
      facetAssignments: [], analysisCandidates: [], analysisBreakdown: [], rejectedCandidateKeys: [],
      negativeTerms: [], legacyFacetCandidates: [], analysisPending: false
    });
  }
  let entries = target
    ? state.entries.map((item) => item.id === entry.id ? entry : item)
    : [...state.entries, entry];
  const organizerState = organizerAfterCapturePlacement(state.organizerState, entries, [entry.id], placement);
  const existingEntryIds = new Set(state.entries.map((item) => item.id));
  const touchedEntryIds = new Set([
    ...(target ? [entry.id] : []),
    ...changedProjectEntryIds(state.organizerState, organizerState).filter((id) => existingEntryIds.has(id))
  ]);
  entries = touchEntries(entries, [...touchedEntryIds]);
  entry = entries.find((item) => item.id === entry.id) ?? entry;
  const nextDraft = createCaptureDraft();
  await retireLastSaveUndo();
  await commitLocalChanges({
    [STORAGE_KEYS.entries]: entries,
    [STORAGE_KEYS.organizerState]: organizerState,
    ...captureCommitState(draft, nextDraft),
    ...(created ? { [STORAGE_KEYS.lastSaveUndo]: createEntrySaveUndo(entry.id) } : {})
  });
  await notifySaved(entries.length);
  if (draft.visuals.length) await queueAutomaticVisionAnalysis([entry.id]);
  return { ok: true, message: target ? "内容已加入明确选择的案例" : "多段文字和截图已保存为新案例", entry, draft: nextDraft };
}

async function commitCaptureIntoCompound(draft, parts, state, targetCompound, placement = {}) {
  let entries = [...state.entries];
  let compounds = normalizeCompoundCases(state.compoundCases, entries);
  const memberIds = [...targetCompound.memberEntryIds];
  const updatedExistingIds = new Set();
  for (const [index, part] of parts.entries()) {
    const partTarget = findCapturePartTarget({
      entries,
      memberIds,
      part,
      preferredEntryId: index === 0 ? draft.targetPartEntryId : ""
    });
    if (partTarget) {
      const updated = mergeCapturePartIntoEntry(partTarget, part, draft, state);
      entries = entries.map((entry) => entry.id === updated.id ? updated : entry);
      updatedExistingIds.add(updated.id);
      continue;
    }
    const created = createEntryFromCapturePart(part, draft, state, {
      title: memberIds.length || index ? part.sourceTitle : draft.title || part.sourceTitle
    });
    entries.push(created);
    memberIds.push(created.id);
  }

  const updated = updateCompoundCase(compounds, entries, targetCompound.id, { memberEntryIds: memberIds });
  compounds = updated.compoundCases;
  const compoundCase = updated.compoundCase;
  const organizerState = organizerAfterCapturePlacement(state.organizerState, entries, compoundCase.memberEntryIds, placement);
  const existingEntryIds = new Set(state.entries.map((entry) => entry.id));
  for (const entryId of changedProjectEntryIds(state.organizerState, organizerState)) {
    if (existingEntryIds.has(entryId)) updatedExistingIds.add(entryId);
  }
  entries = touchEntries(entries, [...updatedExistingIds]);

  const nextDraft = createCaptureDraft();
  await retireLastSaveUndo();
  await commitLocalChanges({
    [STORAGE_KEYS.entries]: entries,
    [STORAGE_KEYS.compoundCases]: compounds,
    [STORAGE_KEYS.organizerState]: organizerState,
    ...captureCommitState(draft, nextDraft)
  });
  await notifySaved(entries.length);
  const affectedEntryIds = entries
    .filter((entry) => entryMediaAssets(entry).some((asset) => parts.some((part) => part.visuals.some((visual) => visual.id === asset.id))))
    .map((entry) => entry.id);
  if (affectedEntryIds.length) await queueAutomaticVisionAnalysis(affectedEntryIds);
  return {
    ok: true,
    message: `内容已加入组合案例 · 共 ${compoundCase.memberEntryIds.length} 个部分`,
    entry: compoundCase,
    compoundCase,
    draft: nextDraft
  };
}

function capturePlacement(draft, value = {}) {
  const hasCollectionId = Object.hasOwn(value, "collectionId");
  const hasNewCollectionName = Object.hasOwn(value, "newCollectionName");
  return {
    collectionId: String(hasCollectionId ? value.collectionId : draft.collectionId ?? "").trim(),
    newCollectionName: String(hasNewCollectionName ? value.newCollectionName : draft.newCollectionName ?? "").trim()
  };
}

function organizerAfterCapturePlacement(organizerValue, entries, entryIds, placement = {}) {
  let organizerState = normalizeOrganizerState(organizerValue, entries.map((entry) => entry.id));
  let collectionId = String(placement.collectionId ?? "").trim();
  const newCollectionName = String(placement.newCollectionName ?? "").trim();
  if (collectionId && newCollectionName) throw new Error("请选择已有项目或新建项目，不要同时填写");
  if (newCollectionName) {
    const created = createCollection(organizerState, newCollectionName);
    organizerState = created.state;
    collectionId = created.item.id;
  }
  if (!collectionId) return organizerState;
  const target = organizerState.collections.find((collection) => collection.id === collectionId);
  if (!target) throw new Error("保存目标项目已经不存在，请重新选择");
  target.entryIds = [...new Set([...target.entryIds, ...entryIds])];
  return normalizeOrganizerState(organizerState, entries.map((entry) => entry.id));
}

function captureCommitState(_draft, nextDraft) {
  return {
    [STORAGE_KEYS.captureDraft]: nextDraft
  };
}

function findCapturePartTarget({ entries, memberIds, part, preferredEntryId }) {
  if (preferredEntryId && memberIds.includes(preferredEntryId)) {
    const preferred = entries.find((entry) => entry.id === preferredEntryId) ?? null;
    if (preferred && (!part.sourceUrl || entryHasSource(preferred, part.sourceUrl))) return preferred;
  }
  if (!part.sourceUrl) return memberIds.length === 1 ? entries.find((entry) => entry.id === memberIds[0]) ?? null : null;
  return entries.find((entry) => memberIds.includes(entry.id) && entryHasSource(entry, part.sourceUrl)) ?? null;
}

function entryHasSource(entry, sourceUrl) {
  return entry.url === sourceUrl || (entry.sourcePages ?? []).some((source) => source.url === sourceUrl);
}

function mergeCapturePartIntoEntry(entryValue, part, draft, state) {
  let entry = normalizeEntryVisuals(entryValue);
  const nextText = part.text && !String(entry.text ?? "").includes(part.text)
    ? [entry.text, part.text].filter(Boolean).join("\n\n")
    : entry.text;
  entry = {
    ...markEntryTextChanged(entry, nextText),
    sourcePages: mergeSourcePages(entry.sourcePages, [{ url: part.sourceUrl, title: part.sourceTitle }]),
    ...(sourceFactsForCaptureContext(part.sourceContext) ? { sourceFacts: sourceFactsForCaptureContext(part.sourceContext) } : {}),
    customLabels: draft.customLabelsExplicit ? uniqueNames(draft.customLabels) : uniqueNames(entry.customLabels)
  };
  if (draft.contentTypeExplicit && isValidContentPath(state.taxonomy, [draft.contentTypeId])) {
    entry.classification = { pathIds: [draft.contentTypeId], status: "confirmed", source: "manual", reason: "保存前人工确认" };
  }
  for (const visual of part.visuals) entry = addEntryVisual(entry, visual);
  if (part.visuals.some((visual) => visual.id === draft.primaryVisualId)) entry = setPrimaryVisual(entry, draft.primaryVisualId);
  return entry;
}

function createEntryFromCapturePart(part, draft, state, options = {}) {
  const sourceTitle = String(options.title || part.sourceTitle || "未命名案例").trim();
  const base = buildEntry({
    text: part.text,
    title: sourceTitle,
    url: part.sourceUrl,
    allowEmptyText: part.visuals.length > 0
  });
  return normalizeEntryVisuals({
    ...base,
    schemaVersion: SCHEMA_VERSION,
    sourcePages: mergeSourcePages([], [{ url: part.sourceUrl, title: part.sourceTitle }]),
    ...(sourceFactsForCaptureContext(part.sourceContext) ? { sourceFacts: sourceFactsForCaptureContext(part.sourceContext) } : {}),
    visuals: part.visuals,
    primaryVisualId: part.visuals.some((visual) => visual.id === draft.primaryVisualId)
      ? draft.primaryVisualId
      : part.visuals[0]?.id || "",
    classification: draft.contentTypeExplicit && isValidContentPath(state.taxonomy, [draft.contentTypeId])
      ? { pathIds: [draft.contentTypeId], status: "confirmed", source: "manual", reason: "保存前人工确认" }
      : classifyContent({ text: part.text, title: part.sourceTitle, url: part.sourceUrl, visuals: part.visuals }, state.classificationRules, state.taxonomy),
    customLabels: uniqueNames(draft.customLabels),
    metadataLabels: [],
    facetAssignments: [], analysisCandidates: [], analysisBreakdown: [], rejectedCandidateKeys: [],
    negativeTerms: [], legacyFacetCandidates: [], analysisPending: false
  });
}

function sourceFactsForCaptureContext(context) {
  const facts = context?.sourceFacts;
  if (!facts || typeof facts !== "object" || !String(facts.provider || facts.itemId || facts.author || "").trim()) return null;
  return facts;
}

function captureDraftClassification(draft, state) {
  const text = draftText(draft);
  const firstSource = draftSourcePages(draft)[0];
  return classifyContent({
    text,
    title: draft.title || firstSource?.title || draft.visuals[0]?.sourceTitle || "",
    url: firstSource?.url || draft.visuals[0]?.sourceUrl || "",
    visuals: draft.visuals
  }, state.classificationRules, state.taxonomy);
}

function mergeSourcePages(leftValue, rightValue) {
  const seen = new Set();
  return [...(Array.isArray(leftValue) ? leftValue : []), ...(Array.isArray(rightValue) ? rightValue : [])].flatMap((item) => {
    const url = String(item?.url ?? "").trim();
    if (!url || seen.has(url)) return [];
    seen.add(url);
    return [{ url, title: String(item?.title ?? "").trim() }];
  });
}

async function undoLastSave() {
  const state = await readState();
  const undo = normalizeLastSaveUndo(state.lastSaveUndo);
  if (!undo) return { ok: false, message: "没有可安全撤回的保存操作" };

  if (undo.type === "delete_created_entry") {
    const removed = state.entries.find((item) => item.id === undo.entryId);
    if (!removed) {
      await chrome.storage.local.remove(STORAGE_KEYS.lastSaveUndo);
      return { ok: false, message: "这次保存已经不存在，撤回记录已清理" };
    }
    const entries = state.entries.filter((item) => item.id !== removed.id);
    const organizerState = removeEntriesFromOrganizer(state.organizerState, [removed.id]);
    const compoundCases = removeEntriesFromCompoundCases(state.compoundCases, state.entries, [removed.id]);
    const visionAnalysisUndo = await visionUndoWithout(removed.id);
    await commitLocalChanges({
      [STORAGE_KEYS.entries]: entries,
      [STORAGE_KEYS.compoundCases]: compoundCases,
      [STORAGE_KEYS.organizerState]: organizerState,
      [STORAGE_KEYS.visionAnalysisUndo]: visionAnalysisUndo
    });
    const visualIds = normalizeEntryMedia(removed).mediaAssets.filter((asset) => asset.storageMode === "managed").map((asset) => asset.id);
    await chrome.storage.local.remove([STORAGE_KEYS.lastSaveUndo, screenshotStorageKey(removed.id)]);
    await Promise.allSettled(visualIds.map((visualId) => deleteMediaBlob(visualId)));
    return { ok: true, message: "已撤回刚才保存的案例", removed, count: entries.length };
  }

  const current = state.entries.find((item) => item.id === undo.entryId);
  if (!current) {
    await discardSaveUndoBackup(undo).catch(() => undefined);
    await chrome.storage.local.remove(STORAGE_KEYS.lastSaveUndo);
    return { ok: false, message: "原案例已经不存在，撤回记录已清理" };
  }
  const updated = restoreScreenshotSaveEntry(current, undo);
  const replacedScreenshot = await getScreenshotBlob(current.id);
  let restoredScreenshot = null;
  if (undo.hadScreenshot) {
    restoredScreenshot = await undoScreenshotReplacement(current.id, { backupEntryId: undo.backupEntryId });
  } else {
    await deleteScreenshotBlob(current.id);
  }
  const entries = state.entries.map((item) => item.id === updated.id ? updated : item);
  try {
    await commitLocalChanges(
      { [STORAGE_KEYS.entries]: entries },
      { dirtyAssetIds: [current.id] }
    );
  } catch (error) {
    if (replacedScreenshot) await saveScreenshotBlob(current.id, replacedScreenshot).catch(() => undefined);
    if (restoredScreenshot) {
      await saveScreenshotBlob(undo.backupEntryId, restoredScreenshot).catch(() => undefined);
    }
    throw error;
  }
  await chrome.storage.local.remove(STORAGE_KEYS.lastSaveUndo);
  return { ok: true, message: "已恢复原案例更新前的截图与图片分析", entry: updated, count: entries.length };
}

async function deleteEntry(entryId) {
  const state = await readState();
  const entry = findEntry(state, entryId);
  return moveEntryBatchToTrash([entry.id], state);
}

async function deleteCollectionWithEntries(message) {
  const state = await readState();
  const organizerState = normalizeOrganizerState(state.organizerState, state.entries.map((entry) => entry.id));
  const collection = organizerState.collections.find((item) => item.id === String(message.collectionId ?? "").trim());
  if (!collection) throw new Error("项目不存在");
  if (String(message.confirmationName ?? "").trim() !== collection.name) throw new Error("项目名称不匹配，未执行删除");
  if (!collectionEntryIds(organizerState, collection.id, { subtree: true }).length) {
    throw new Error("这个项目及其子项目没有可删除的案例");
  }
  const moved = moveCollectionWithEntriesToTrash({
    entries: state.entries,
    trashState: state.trashState,
    organizerState,
    compoundCases: state.compoundCases
  }, collection.id);
  const visionAnalysisUndo = await visionUndoWithoutEntries(new Set(moved.movedEntryIds));
  await commitLocalChanges({
    [STORAGE_KEYS.entries]: moved.entries,
    [STORAGE_KEYS.trashState]: moved.trashState,
    [STORAGE_KEYS.compoundCases]: moved.compoundCases,
    [STORAGE_KEYS.organizerState]: moved.organizerState,
    [STORAGE_KEYS.visionAnalysisUndo]: visionAnalysisUndo
  });
  return {
    ok: true,
    message: `项目“${collection.name}”及其中 ${moved.movedEntryIds.length} 个案例已移入回收站`,
    movedEntryCount: moved.movedEntryIds.length,
    movedItemIds: moved.movedItemIds,
    ...publicDomainState({
      ...state,
      entries: moved.entries,
      trashState: moved.trashState,
      organizerState: moved.organizerState,
      compoundCases: moved.compoundCases
    })
  };
}

async function moveEntryBatchToTrash(entryIdsValue, stateValue) {
  const state = stateValue ?? await readState();
  const activeIds = new Set(state.entries.map((entry) => entry.id));
  const entryIds = uniqueNames(entryIdsValue).filter((entryId) => activeIds.has(entryId));
  if (!entryIds.length) return { ok: false, message: "没有找到可移入回收站的案例" };
  const moved = moveEntriesToTrash({
    entries: state.entries,
    trashState: state.trashState,
    organizerState: state.organizerState,
    compoundCases: state.compoundCases
  }, entryIds);
  const visionAnalysisUndo = await visionUndoWithoutEntries(new Set(entryIds));
  await commitLocalChanges({
    [STORAGE_KEYS.entries]: moved.entries,
    [STORAGE_KEYS.trashState]: moved.trashState,
    [STORAGE_KEYS.organizerState]: moved.organizerState,
    [STORAGE_KEYS.compoundCases]: moved.compoundCases,
    [STORAGE_KEYS.visionAnalysisUndo]: visionAnalysisUndo
  });
  return {
    ok: true,
    message: moved.movedItemIds.length === 1
      ? "案例已移入回收站"
      : `${moved.movedItemIds.length} 个案例已移入回收站`,
    movedEntryIds: entryIds,
    movedItemIds: moved.movedItemIds,
    ...publicDomainState({ ...state, ...moved })
  };
}

async function getTrashItems(message = {}) {
  const state = await readState();
  const items = listTrashItems(state.trashState, { kind: message.kind });
  return { ok: true, items, count: items.length, trashState: normalizeTrashState(state.trashState) };
}

async function restoreSelectedTrashItems(message = {}) {
  const state = await readState();
  const restored = restoreTrashItems({
    entries: state.entries,
    trashState: state.trashState,
    organizerState: state.organizerState,
    compoundCases: state.compoundCases
  }, message.itemIds, { collectionReplacements: message.collectionReplacements });
  if (!restored.restoredItemIds.length) {
    return {
      ok: false,
      message: restored.unresolved[0]?.reason || "没有找到可恢复的内容",
      unresolved: restored.unresolved,
      trashState: restored.trashState
    };
  }
  await commitLocalChanges({
    [STORAGE_KEYS.entries]: restored.entries,
    [STORAGE_KEYS.trashState]: restored.trashState,
    [STORAGE_KEYS.organizerState]: restored.organizerState,
    [STORAGE_KEYS.compoundCases]: restored.compoundCases
  });
  const unresolvedMessage = restored.unresolved.length ? `；另有 ${restored.unresolved.length} 项因关系冲突未恢复` : "";
  const warningMessage = restored.warnings?.length ? `；${restored.warnings[0].reason}` : "";
  return {
    ok: true,
    message: `已恢复 ${restored.restoredItemIds.length} 项${unresolvedMessage}${warningMessage}`,
    restoredItemIds: restored.restoredItemIds,
    unresolved: restored.unresolved,
    warnings: restored.warnings ?? [],
    ...publicDomainState({ ...state, ...restored })
  };
}

async function permanentlyDeleteTrashItems(message = {}) {
  const state = await readState();
  const retainedMediaIds = collectRetainedLocalAssetIds(state);
  const taken = takeTrashItems(state.trashState, message.itemIds, {
    retainedMediaIds: [...retainedMediaIds],
    retainedEntryIds: state.entries.map((entry) => entry.id)
  });
  return commitTrashCleanup(taken, { retainedLocalAssetIds: [...retainedMediaIds] });
}

async function emptyTrashAction() {
  const state = await readState();
  const retainedMediaIds = collectRetainedLocalAssetIds(state);
  const taken = emptyTrash(state.trashState, {
    retainedMediaIds: [...retainedMediaIds],
    retainedEntryIds: state.entries.map((entry) => entry.id)
  });
  return commitTrashCleanup(taken, { retainedLocalAssetIds: [...retainedMediaIds] });
}

async function commitTrashCleanup(taken, options = {}) {
  if (!taken.takenItems.length) return { ok: false, message: "回收站中没有可永久删除的内容" };
  const retainedLocalAssetIds = new Set(Array.isArray(options.retainedLocalAssetIds) ? options.retainedLocalAssetIds : []);
  const localReferenceIds = [...new Set(taken.takenItems.flatMap(localReferenceIdsInTrashItem))]
    .filter((assetId) => !retainedLocalAssetIds.has(assetId));
  const cleanup = await commitMetadataThenDeleteImages({
    imageIds: taken.cleanup.mediaIds,
    deleteImages: deleteMediaBlobs,
    commitMetadata: () => commitLocalChanges({ [STORAGE_KEYS.trashState]: taken.trashState })
  });
  if (cleanup.failedIds.length) {
    const retryableTrashState = normalizeTrashState({
      items: [...taken.trashState.items, ...taken.takenItems]
    });
    await commitLocalChanges({ [STORAGE_KEYS.trashState]: retryableTrashState });
    return {
      ok: false,
      message: "本机文件清理失败，内容仍保留在回收站，可稍后重试",
      failedMediaCount: cleanup.failedIds.length,
      trashState: retryableTrashState
    };
  }
  const screenshotResults = await Promise.allSettled(
    taken.cleanup.screenshotEntryIds.map((entryId) => chrome.storage.local.remove(screenshotStorageKey(entryId)))
  );
  const localReferenceResults = await Promise.allSettled(localReferenceIds.map((assetId) => deleteLocalAssetHandle(assetId)));
  const failedScreenshotCount = screenshotResults.filter((result) => result.status === "rejected").length;
  const failedLocalReferenceCount = localReferenceResults.filter((result) => result.status === "rejected").length;
  const warningParts = [
    failedScreenshotCount ? `${failedScreenshotCount} 个旧版截图缓存未能清理` : "",
    failedLocalReferenceCount ? `${failedLocalReferenceCount} 个本机链接记录未能清理` : ""
  ].filter(Boolean);
  const warning = warningParts.length ? `；${warningParts.join("；")}` : "";
  return {
    ok: true,
    message: `已永久删除 ${taken.takenItems.length} 项${warning}`,
    permanentlyDeletedItemIds: taken.takenItems.map((item) => item.id),
    deletedMediaCount: cleanup.deletedIds.length,
    deletedLocalReferenceCount: localReferenceIds.length - failedLocalReferenceCount,
    failedMediaCount: 0,
    failedLocalReferenceCount,
    failedLegacyScreenshotCount: failedScreenshotCount,
    trashState: taken.trashState
  };
}

function localReferenceIdsInTrashItem(item) {
  if (!item || !["entry", "media"].includes(item.kind)) return [];
  const assets = Array.isArray(item.snapshot?.mediaAssets)
    ? item.snapshot.mediaAssets
    : Array.isArray(item.snapshot?.visuals) ? item.snapshot.visuals : [];
  return assets.flatMap((asset) => asset?.recordType === LOCAL_ASSET_REFERENCE_RECORD_TYPE && asset?.id
    ? [String(asset.id).trim()]
    : []).filter(Boolean);
}

function enqueue(task) {
  const operation = writeQueue.then(task, task);
  writeQueue = operation.catch(() => undefined);
  return operation;
}

function enqueueCapture(task) {
  const operation = captureWriteQueue.then(task, task);
  captureWriteQueue = operation.catch(() => undefined);
  return operation;
}

async function restrictLocalStorageAccess() {
  if (typeof chrome.storage?.local?.setAccessLevel !== "function") return;
  await chrome.storage.local.setAccessLevel({ accessLevel: "TRUSTED_CONTEXTS" });
}

async function retireLastSaveUndo(options = {}) {
  const stored = await chrome.storage.local.get(STORAGE_KEYS.lastSaveUndo);
  const undo = normalizeLastSaveUndo(stored[STORAGE_KEYS.lastSaveUndo]);
  const preserveCurrentFixedBackup = undo?.type === "restore_replaced_screenshot" &&
    undo.entryId === options.preserveBackupEntryId &&
    undo.backupEntryId === `backup:${undo.entryId}`;
  if (undo?.type === "restore_replaced_screenshot" && !preserveCurrentFixedBackup) {
    await discardSaveUndoBackup(undo).catch(() => undefined);
  }
  await chrome.storage.local.remove(STORAGE_KEYS.lastSaveUndo);
}

async function discardSaveUndoBackup(undoValue) {
  const undo = normalizeLastSaveUndo(undoValue);
  if (undo?.type !== "restore_replaced_screenshot") return;
  await discardScreenshotReplacementBackup(undo.entryId, { backupEntryId: undo.backupEntryId });
}

async function readState() {
  const stored = await chrome.storage.local.get([
    ...Object.values(STORAGE_KEYS),
    "tagCatalog"
  ]);
  const aiConfiguration = aiConfigurationFromStorage(stored);
  const aiRuntime = projectAiRuntime(aiConfiguration);
  const aiStorageOutdated = !stored[STORAGE_KEYS.aiProviderRegistry]
    || Number(stored[STORAGE_KEYS.aiProviderRegistry]?.version) !== aiConfiguration.registry.version
    || !stored[STORAGE_KEYS.aiPreferences]
    || JSON.stringify(stored[STORAGE_KEYS.aiTaskAssignments] ?? {}) !== JSON.stringify(aiConfiguration.assignments);
  if (aiStorageOutdated) {
    await commitLocalChanges({
      [STORAGE_KEYS.aiProviderRegistry]: aiConfiguration.registry,
      [STORAGE_KEYS.aiTaskAssignments]: aiConfiguration.assignments,
      [STORAGE_KEYS.aiPreferences]: aiConfiguration.preferences
    });
    stored[STORAGE_KEYS.aiProviderRegistry] = aiConfiguration.registry;
    stored[STORAGE_KEYS.aiTaskAssignments] = aiConfiguration.assignments;
    stored[STORAGE_KEYS.aiPreferences] = aiConfiguration.preferences;
  }
  const shouldMigrate = needsMigration(stored);
  const migration = shouldMigrate ? migrateLibraryState(stored) : null;
  let state = migration?.state ?? {
    schemaVersion: SCHEMA_VERSION,
    entries: stored[STORAGE_KEYS.entries],
    trashState: stored[STORAGE_KEYS.trashState],
    compoundCases: stored[STORAGE_KEYS.compoundCases],
    taxonomy: stored[STORAGE_KEYS.taxonomy],
    facetCatalog: stored[STORAGE_KEYS.facetCatalog],
    classificationRules: stored[STORAGE_KEYS.classificationRules],
    organizerState: stored[STORAGE_KEYS.organizerState],
    settings: stored[STORAGE_KEYS.settings]
  };
  if (shouldMigrate) {
    const update = storagePayload(state);
    if (!stored[STORAGE_KEYS.migrationBackup]) {
      update[STORAGE_KEYS.migrationBackup] = migration?.backup;
    }
    if (migration.resetPerformed && !stored[STORAGE_KEYS.facetMigrationBackup]) {
      update[STORAGE_KEYS.facetMigrationBackup] = migration.backup;
    }
    if (migration.resetPerformed && !stored[STORAGE_KEYS.classificationResetBackup]) {
      update[STORAGE_KEYS.classificationResetBackup] = migration.backup;
    }
    await commitLocalChanges(update);
    await chrome.storage.local.remove("tagCatalog");
  }
  const recoveredVocabulary = recoverFullyArchivedFacets(state.facetCatalog);
  if (recoveredVocabulary.restoredFacetIds.length) {
    state = { ...state, facetCatalog: recoveredVocabulary.catalog };
    await commitLocalChanges({ [STORAGE_KEYS.facetCatalog]: state.facetCatalog });
    await chrome.storage.local.remove(STORAGE_KEYS.facetUndo);
    stored[STORAGE_KEYS.facetUndo] = null;
  }
  const uiPreferences = normalizeUiPreferences(stored[STORAGE_KEYS.uiPreferences]);
  const locale = resolveLocale(uiPreferences, chrome.i18n.getUILanguage());
  const composerSessions = normalizeComposerSessions(stored[STORAGE_KEYS.composerSessions]);
  if (JSON.stringify(stored[STORAGE_KEYS.composerSessions] ?? []) !== JSON.stringify(composerSessions)) {
    await commitLocalChanges({ [STORAGE_KEYS.composerSessions]: composerSessions }, { markSyncDirty: false });
  }
  const creativeRuns = normalizeCreativeRuns(stored[STORAGE_KEYS.creativeRuns]);
  const creativeJobs = normalizeCreativeJobsState(stored[STORAGE_KEYS.creativeJobs]);
  const importJobs = normalizeImportJobsState(stored[STORAGE_KEYS.importJobs]);
  const importStaging = normalizeImportStagingState(stored[STORAGE_KEYS.importStaging]);
  const creativeSkills = normalizeCreativeSkillsState(stored[STORAGE_KEYS.creativeSkills]);
  const creativeExperimentSettings = normalizeCreativeExperimentSettings(stored[STORAGE_KEYS.creativeExperimentSettings]);
  const activeCreativeResult = normalizeActiveCreativeResult(stored[STORAGE_KEYS.activeCreativeResult]);
  const syncSettings = normalizeSyncSettings(stored[STORAGE_KEYS.syncSettings]);
  if (!stored[STORAGE_KEYS.batchJob] && stored[STORAGE_KEYS.legacyAnalysisBatchJob]) {
    const migratedBatch = normalizeAnalysisBatchJob(stored[STORAGE_KEYS.legacyAnalysisBatchJob]);
    if (migratedBatch) {
      stored[STORAGE_KEYS.batchJob] = migratedBatch;
      await commitLocalChanges({ [STORAGE_KEYS.batchJob]: migratedBatch });
    }
    await chrome.storage.local.remove(STORAGE_KEYS.legacyAnalysisBatchJob);
  }
  if (JSON.stringify(stored[STORAGE_KEYS.creativeRuns] ?? []) !== JSON.stringify(creativeRuns) ||
      JSON.stringify(stored[STORAGE_KEYS.creativeJobs] ?? {}) !== JSON.stringify(creativeJobs) ||
      JSON.stringify(stored[STORAGE_KEYS.creativeExperimentSettings] ?? {}) !== JSON.stringify(creativeExperimentSettings) ||
      JSON.stringify(stored[STORAGE_KEYS.activeCreativeResult] ?? null) !== JSON.stringify(activeCreativeResult)) {
    await commitLocalChanges({
      [STORAGE_KEYS.creativeRuns]: creativeRuns,
      [STORAGE_KEYS.creativeJobs]: creativeJobs,
      [STORAGE_KEYS.creativeExperimentSettings]: creativeExperimentSettings,
      [STORAGE_KEYS.activeCreativeResult]: activeCreativeResult
    }, { markSyncDirty: false });
  }
  const storedBatchJob = normalizeAnalysisBatchJob(stored[STORAGE_KEYS.batchJob]);
  const textBatchSummary = storedBatchJob?.kind === "text_tags"
    ? {
        ...analysisBatchSummary(storedBatchJob),
        ...analysisRebuildRecovery(storedBatchJob, stored[STORAGE_KEYS.analysisRebuildStaging])
      }
    : null;
  const analysisUndo = stored[STORAGE_KEYS.analysisBatchUndo];
  return {
    ...domainState(state),
    settings: normalizeSettings(state.settings ?? {}, defaultSettingsForLocale(locale)),
    uiPreferences,
    aiSettings: publicAiSettings(aiRuntime.aiSettings),
    visionSettings: publicVisionSettings(aiRuntime.visionSettings),
    aiServiceProfiles: publicAiServiceProfiles(aiRuntime.aiServiceProfiles),
    aiProviderRegistry: publicAiProviderRegistry(aiConfiguration.registry),
    aiTaskAssignments: aiConfiguration.assignments,
    composerSettings: normalizeComposerSettings(stored[STORAGE_KEYS.composerSettings]),
    composerSessions,
    composerSessionSummaries: composerSessions.map(sessionSummary),
    creativeExperimentSettings,
    creativeRuns,
    creativeJobs,
    importJobs,
    importStaging,
    creativeSkills,
    activeCreativeResult,
    syncSettings,
    syncStatus: await publicSyncStatus(syncSettings),
    visionUndoEntryIds: Object.keys(stored[STORAGE_KEYS.visionAnalysisUndo] ?? {}),
    pendingContentCount: state.entries.filter(
      (entry) => entry.classification?.status === "needs_review"
    ).length,
    pendingSuggestionCount: state.entries.reduce((count, entry) =>
      count + reusableAnalysisItems(entry.analysisCandidates).length, 0),
    analysisPendingCount: state.entries.filter((entry) => entry.analysisPending).length,
    migrationBackupExists: Boolean(
      stored[STORAGE_KEYS.facetMigrationBackup] || stored[STORAGE_KEYS.migrationBackup] || shouldMigrate
    ),
    canUndoFacetUpdate: facetUndoCount(stored[STORAGE_KEYS.facetUndo]) > 0,
    facetUndoCount: facetUndoCount(stored[STORAGE_KEYS.facetUndo]),
    facetUndo: stored[STORAGE_KEYS.facetUndo] ?? null,
    restoredArchivedFacetCount: recoveredVocabulary.restoredFacetIds.length,
    analysisBatchJob: textBatchSummary,
    maintenanceJob: libraryMaintenanceSummary(stored[STORAGE_KEYS.libraryMaintenanceJob]),
    visionBatchJob: analysisBatchSummary(stored[STORAGE_KEYS.batchJob])?.kind === "vision"
      ? analysisBatchSummary(stored[STORAGE_KEYS.batchJob])
      : null,
    canUndoAnalysisBatch: Boolean(textBatchSummary && analysisUndo?.jobId === textBatchSummary.id),
    lastSaveUndo: normalizeLastSaveUndo(stored[STORAGE_KEYS.lastSaveUndo])
  };
}

async function createCreativeSkillAction(message) {
  const stored = await chrome.storage.local.get(STORAGE_KEYS.creativeSkills);
  const result = createCreativeSkill(stored[STORAGE_KEYS.creativeSkills], message.skill);
  await commitLocalChanges({ [STORAGE_KEYS.creativeSkills]: result.state });
  return { ok: true, message: "Skill 已保存", creativeSkills: result.state, skill: result.skill };
}

async function saveCreativeSkillVersionAction(message) {
  const stored = await chrome.storage.local.get(STORAGE_KEYS.creativeSkills);
  const result = saveCreativeSkillVersion(stored[STORAGE_KEYS.creativeSkills], message.skillId, message.version);
  await commitLocalChanges({ [STORAGE_KEYS.creativeSkills]: result.state });
  return { ok: true, message: "Skill 新版本已保存", creativeSkills: result.state, skill: result.skill };
}

async function restoreCreativeSkillVersionAction(message) {
  const stored = await chrome.storage.local.get(STORAGE_KEYS.creativeSkills);
  const result = restoreCreativeSkillVersion(stored[STORAGE_KEYS.creativeSkills], message.skillId, message.versionId);
  await commitLocalChanges({ [STORAGE_KEYS.creativeSkills]: result.state });
  return { ok: true, message: "已将所选版本恢复为新的当前版本", creativeSkills: result.state, skill: result.skill };
}

async function deleteCreativeSkillAction(skillId) {
  const stored = await chrome.storage.local.get(STORAGE_KEYS.creativeSkills);
  const result = deleteCreativeSkill(stored[STORAGE_KEYS.creativeSkills], skillId);
  await commitLocalChanges({ [STORAGE_KEYS.creativeSkills]: result.state });
  await deleteMediaBlobs(skillPackageAssetIds(result.skill)).catch(() => undefined);
  return { ok: true, message: "Skill 已删除", creativeSkills: result.state };
}

async function getComposerSession(sessionId) {
  const stored = await chrome.storage.local.get(STORAGE_KEYS.composerSessions);
  const session = normalizeComposerSessions(stored[STORAGE_KEYS.composerSessions]).find((item) => item.id === sessionId);
  return session ? { ok: true, session } : { ok: false, message: "没有找到这份创作草稿" };
}

async function startCreativeJobAction(request, jobId) {
  if (!["create_image", "create_video"].includes(request?.session?.outputMode)) {
    return { ok: false, message: "后台持久任务当前只用于创建图片或视频" };
  }
  const stored = await chrome.storage.local.get([
    STORAGE_KEYS.creativeJobs,
    STORAGE_KEYS.composerSessions
  ]);
  const created = createCreativeJob(stored[STORAGE_KEYS.creativeJobs], request, { id: jobId });
  const sessions = upsertSessionList(stored[STORAGE_KEYS.composerSessions], created.job.request.session);
  await commitLocalChanges({
    [STORAGE_KEYS.creativeJobs]: created.state,
    [STORAGE_KEYS.composerSessions]: sessions
  });
  try {
    await dispatchCreativeJob(created.job);
  } catch (error) {
    await failCreativeJobAction({
      jobId: created.job.id,
      error: { kind: "service", message: userMessage(error), retryable: true }
    });
    return { ok: false, message: userMessage(error), job: creativeJobById(created.state, created.job.id) };
  }
  return { ok: true, message: "创作任务已在后台开始", job: created.job };
}

async function getCreativeJobAction(jobId) {
  const stored = await chrome.storage.local.get(STORAGE_KEYS.creativeJobs);
  const creativeJobs = normalizeCreativeJobsState(stored[STORAGE_KEYS.creativeJobs]);
  const job = String(jobId ?? "").trim()
    ? creativeJobById(creativeJobs, jobId)
    : activeCreativeJob(creativeJobs) ?? creativeJobs.items.at(-1) ?? null;
  return { ok: true, job, creativeJobs };
}

async function retryCreativeJobAction(jobId) {
  const stored = await chrome.storage.local.get(STORAGE_KEYS.creativeJobs);
  const retried = retryCreativeJob(stored[STORAGE_KEYS.creativeJobs], jobId);
  await commitLocalChanges({ [STORAGE_KEYS.creativeJobs]: retried.state });
  try {
    await dispatchCreativeJob(retried.job);
  } catch (error) {
    await failCreativeJobAction({
      jobId: retried.job.id,
      error: { kind: "service", message: userMessage(error), retryable: true }
    });
    return { ok: false, message: userMessage(error), job: retried.job };
  }
  return { ok: true, message: "创作任务已重新开始", job: retried.job };
}

async function updateCreativeJobProgress(message) {
  const stored = await chrome.storage.local.get([
    STORAGE_KEYS.creativeJobs,
    STORAGE_KEYS.composerSessions
  ]);
  const current = creativeJobById(stored[STORAGE_KEYS.creativeJobs], message.jobId);
  if (!current || !["queued", "running"].includes(current.status)) {
    return { ok: false, message: "创作任务已经结束" };
  }
  const creativeJobs = updateCreativeJob(stored[STORAGE_KEYS.creativeJobs], current.id, {
    status: "running",
    phase: message.phase,
    ...(message.remoteVideo ? { remoteVideo: message.remoteVideo } : {})
  });
  const update = { [STORAGE_KEYS.creativeJobs]: creativeJobs };
  if (message.session) {
    const session = createComposerSession(message.session);
    if (session.id !== current.sessionId) return { ok: false, message: "创作任务与对话不匹配" };
    update[STORAGE_KEYS.composerSessions] = upsertSessionList(stored[STORAGE_KEYS.composerSessions], session);
  }
  await commitLocalChanges(update);
  return { ok: true, job: creativeJobById(creativeJobs, current.id) };
}

async function creativeJobExecutionState() {
  const stored = await chrome.storage.local.get([
    STORAGE_KEYS.entries,
    STORAGE_KEYS.compoundCases,
    STORAGE_KEYS.facetCatalog,
    STORAGE_KEYS.composerSettings,
    STORAGE_KEYS.aiProviderRegistry,
    STORAGE_KEYS.aiTaskAssignments,
    STORAGE_KEYS.aiPreferences
  ]);
  const aiRuntime = projectAiRuntime(aiConfigurationFromStorage(stored));
  return {
    ok: true,
    aiRuntimeProtocolVersion: AI_RUNTIME_PROTOCOL_VERSION,
    entries: stored[STORAGE_KEYS.entries],
    compoundCases: stored[STORAGE_KEYS.compoundCases],
    facetCatalog: stored[STORAGE_KEYS.facetCatalog],
    composerSettings: stored[STORAGE_KEYS.composerSettings],
    aiSettings: aiRuntime.aiSettings,
    visionSettings: aiRuntime.visionSettings,
    aiServiceProfiles: aiRuntime.aiServiceProfiles,
    aiTaskAssignments: aiRuntime.aiTaskAssignments
  };
}

async function completeCreativeJobAction(message) {
  const stored = await chrome.storage.local.get([
    STORAGE_KEYS.creativeJobs,
    STORAGE_KEYS.composerSessions,
    STORAGE_KEYS.creativeRuns
  ]);
  const current = creativeJobById(stored[STORAGE_KEYS.creativeJobs], message.jobId);
  if (!current || current.status !== "running") return { ok: false, message: "创作任务已经结束" };
  const session = createComposerSession(message.session);
  if (session.id !== current.sessionId) return { ok: false, message: "创作任务与对话不匹配" };
  const visuals = Array.isArray(message.visuals) ? message.visuals : [];
  for (const visual of visuals) {
    const id = String(visual?.id ?? "").trim();
    const video = visual?.kind === "video" || String(visual?.mimeType ?? "").startsWith("video/");
    const blob = id ? video ? await getMediaBlob(id) : await getScreenshotBlob(id) : null;
    if (!blob || !blob.type.startsWith(video ? "video/" : "image/") || !blob.size) {
      return { ok: false, message: `有一项生成${video ? "视频" : "图片"}没有完整写入本地存储` };
    }
  }

  let creativeRuns = normalizeCreativeRuns(stored[STORAGE_KEYS.creativeRuns]);
  if (visuals.length) {
    const promptVersionId = session.promptVersions.at(-1)?.id;
    if (!promptVersionId) return { ok: false, message: "生成媒体缺少对应的提示词版本" };
    let run = creativeRuns.find((item) => item.sessionId === session.id && item.promptVersionId === promptVersionId);
    if (run) {
      for (const visual of visuals) run = addCreativeOutput(run, visual, undefined, message.generation);
      creativeRuns = [run, ...creativeRuns.filter((item) => item.id !== run.id)];
    } else {
      run = createCreativeRun({ sessionId: session.id, promptVersionId }, session, visuals, undefined, message.generation);
      creativeRuns = [run, ...creativeRuns];
    }
    creativeRuns = normalizeCreativeRuns(creativeRuns);
  }
  const creativeJobs = updateCreativeJob(stored[STORAGE_KEYS.creativeJobs], current.id, {
    status: "completed",
    phase: "completed",
    error: null
  });
  await commitLocalChanges({
    [STORAGE_KEYS.creativeJobs]: creativeJobs,
    [STORAGE_KEYS.composerSessions]: upsertSessionList(stored[STORAGE_KEYS.composerSessions], session),
    [STORAGE_KEYS.creativeRuns]: creativeRuns
  });
  return { ok: true, job: creativeJobById(creativeJobs, current.id), creativeRuns };
}

async function failCreativeJobAction(message) {
  const stored = await chrome.storage.local.get([
    STORAGE_KEYS.creativeJobs,
    STORAGE_KEYS.composerSessions
  ]);
  const current = creativeJobById(stored[STORAGE_KEYS.creativeJobs], message.jobId);
  if (!current || !["queued", "running"].includes(current.status)) {
    return { ok: false, message: "创作任务已经结束" };
  }
  const details = normalizeCreativeJobFailure(message.error, current);
  const sessions = normalizeComposerSessions(stored[STORAGE_KEYS.composerSessions]);
  const sourceSession = sessions.find((item) => item.id === current.sessionId) ?? current.request.session;
  let session = appendDiagnosticEvent(sourceSession, {
    phase: current.phase === "planning" ? "planning" : "streaming",
    status: "failed",
    detail: details.message
  });
  session = setComposerFailure(session, {
    userMessageId: current.userMessageId,
    phase: current.phase === "planning" ? "planning" : "streaming",
    kind: details.kind,
    message: `${details.message}。本轮内容已保留。`,
    retryable: details.retryable
  });
  const creativeJobs = updateCreativeJob(stored[STORAGE_KEYS.creativeJobs], current.id, {
    status: "failed",
    error: details
  });
  await commitLocalChanges({
    [STORAGE_KEYS.creativeJobs]: creativeJobs,
    [STORAGE_KEYS.composerSessions]: upsertSessionList(sessions, session)
  });
  if (details.referenceLimit && current.request.session?.outputMode === "create_image") {
    await rememberObservedReferenceLimit(details.referenceLimit).catch(() => undefined);
  }
  await cleanupCreativeJobMask(current);
  return { ok: true, job: creativeJobById(creativeJobs, current.id), session };
}

async function cancelCreativeJobAction(jobId) {
  const stored = await chrome.storage.local.get(STORAGE_KEYS.creativeJobs);
  const current = creativeJobById(stored[STORAGE_KEYS.creativeJobs], jobId);
  if (!current) return { ok: false, message: "没有找到对应的创作任务" };
  if (!["queued", "running"].includes(current.status)) return { ok: true, job: current };
  let runnerStopped = false;
  let runnerMessage = "";
  try {
    await ensureOffscreenDocument();
    const response = await chrome.runtime.sendMessage({
      target: "offscreen",
      type: "CANCEL_CREATIVE_JOB",
      jobId: current.id
    });
    runnerStopped = response?.ok === true;
    runnerMessage = response?.message || "";
  } catch (error) {
    runnerMessage = userMessage(error);
  }
  return enqueue(async () => {
    const latest = await chrome.storage.local.get([
      STORAGE_KEYS.creativeJobs,
      STORAGE_KEYS.composerSessions
    ]);
    const active = creativeJobById(latest[STORAGE_KEYS.creativeJobs], current.id);
    if (!active || !["queued", "running"].includes(active.status)) return { ok: true, job: active };
    const creativeJobs = updateCreativeJob(latest[STORAGE_KEYS.creativeJobs], active.id, {
      status: "canceled",
      error: {
        kind: "canceled",
        message: "用户已取消本次创作",
        retryable: active.request.imageEdit?.mode !== "local"
      }
    });
    const sessions = normalizeComposerSessions(latest[STORAGE_KEYS.composerSessions]);
    const sourceSession = sessions.find((item) => item.id === active.sessionId) ?? active.request.session;
    const session = setComposerFailure(sourceSession, {
      userMessageId: active.userMessageId,
      phase: active.phase === "planning" ? "planning" : "streaming",
      kind: "stopped",
      message: "用户已取消本次创作",
      retryable: active.request.imageEdit?.mode !== "local"
    });
    await commitLocalChanges({
      [STORAGE_KEYS.creativeJobs]: creativeJobs,
      [STORAGE_KEYS.composerSessions]: upsertSessionList(sessions, session)
    });
    await cleanupCreativeJobMask(active);
    return {
      ok: true,
      message: runnerStopped
        ? "创作任务已取消"
        : `创作任务状态已解除${runnerMessage ? `；后台执行器未响应：${runnerMessage}` : ""}`,
      job: creativeJobById(creativeJobs, active.id)
    };
  });
}

async function dispatchCreativeJob(job) {
  await ensureOffscreenDocument();
  const response = await chrome.runtime.sendMessage({ target: "offscreen", type: "RUN_CREATIVE_JOB", job });
  if (!response?.ok) throw new Error(response?.message || "后台创作任务启动失败");
}

function upsertSessionList(values, sessionValue) {
  const session = createComposerSession(sessionValue);
  const sessions = normalizeComposerSessions(values);
  return normalizeComposerSessions([session, ...sessions.filter((item) => item.id !== session.id)]);
}

function normalizeCreativeJobFailure(value, job) {
  const allowedKinds = new Set(["network", "timeout", "rate_limit", "service", "response", "reference_limit", "expired", "unknown", "storage"]);
  const kind = allowedKinds.has(value?.kind) ? value.kind : "unknown";
  const message = String(value?.message ?? "创作任务失败").trim() || "创作任务失败";
  return {
    kind,
    message,
    retryable: value?.retryable === true && job.request.imageEdit?.mode !== "local",
    referenceLimit: normalizeObservedReferenceLimit(value?.referenceLimit)
  };
}

function normalizeObservedReferenceLimit(value) {
  const maximum = Number(value?.maximum);
  const actual = Number(value?.actual);
  if (!Number.isInteger(maximum) || maximum < 0) return null;
  return { maximum, actual: Number.isInteger(actual) && actual >= 0 ? actual : null };
}

async function rememberObservedReferenceLimit(value) {
  const referenceLimit = normalizeObservedReferenceLimit(value);
  if (!referenceLimit) return;
  const configuration = await loadAiConfiguration();
  const assignment = configuration.assignments.imageGeneration;
  const profile = configuration.registry.providers[assignment?.providerId];
  const modelId = String(assignment?.model ?? "").trim();
  if (!profile || !modelId) return;
  const before = profile.discoveredModels.find((model) => model.id === modelId);
  const descriptor = {
    ...(before ?? {
      id: modelId,
      name: modelId,
      status: "available",
      confidence: "manual_unverified",
      source: "observed_error",
      tasks: ["imageGeneration"],
      inputModalities: ["text", "image"],
      outputModalities: ["image"],
      supportedParameters: [],
      supportedResolutions: [],
      supportedAspectRatios: []
    }),
    tasks: [...new Set([...(before?.tasks ?? []), "imageGeneration"])],
    referenceImages: {
      supported: true,
      maxItems: referenceLimit.maximum,
      source: "observed_error",
      observedAt: new Date().toISOString()
    }
  };
  const registry = mergeAiProviderRegistry(configuration.registry, { providers: {
    [profile.id]: {
      discoveredModels: [descriptor, ...profile.discoveredModels.filter((model) => model.id !== modelId)]
    }
  } });
  await persistAiConfiguration({ ...configuration, registry });
}

async function cleanupCreativeJobMask(job) {
  const maskAssetId = String(job?.request?.imageEdit?.maskAssetId ?? "").trim();
  if (maskAssetId) await deleteScreenshotBlob(maskAssetId).catch(() => undefined);
}

async function startImportJobAction(message) {
  const state = await readState();
  const collectionId = String(message.collectionId ?? "").trim();
  if (collectionId && !state.organizerState.collections.some((item) => item.id === collectionId)) {
    throw new Error("没有找到导入目标项目");
  }
  let staging = normalizeImportStagingState(state.importStaging);
  const incoming = Array.isArray(message.stagedAssets) ? message.stagedAssets : [];
  if (!incoming.length) throw new Error("请选择要导入的本机资料");
  const keepById = new Map((Array.isArray(message.items) ? message.items : [])
    .map((item) => [String(item?.stagedAssetId ?? "").trim(), item?.keepDuplicate === true]));
  const jobItems = [];
  const batchAssets = [];
  for (const value of incoming) {
    const assetId = String(value?.assetId ?? "").trim();
    const name = String(value?.name ?? "").trim();
    const isLocalReference = value?.storageMode === "reference" &&
      value?.recordType === LOCAL_ASSET_REFERENCE_RECORD_TYPE;
    if (isLocalReference) {
      const staged = addStagedAsset(staging, value);
      staging = staged.state;
      jobItems.push({ stagedAssetId: staged.asset.id, keepDuplicate: true });
      continue;
    }
    const blob = assetId ? await getMediaBlob(assetId) : null;
    if (!(blob instanceof Blob)) throw new Error(`没有读取到待导入文件：${name || assetId || "未命名"}`);
    const file = new File([blob], name, { type: blob.type || value?.mimeType });
    const duplicate = await findExactMediaDuplicate(file, state.entries, {
      readBlob: getMediaBlob,
      candidateAssets: batchAssets
    });
    const staged = addStagedAsset(staging, {
      ...value,
      mimeType: blob.type || value?.mimeType,
      byteSize: blob.size,
      contentHash: duplicate.contentHash,
      duplicateAssetId: duplicate.duplicateAssetId
    });
    staging = staged.state;
    batchAssets.push({
      id: staged.asset.assetId,
      byteSize: staged.asset.byteSize,
      mimeType: staged.asset.mimeType,
      sourceTitle: staged.asset.name,
      contentHash: staged.asset.contentHash
    });
    jobItems.push({
      stagedAssetId: staged.asset.id,
      duplicateAssetId: staged.asset.duplicateAssetId,
      keepDuplicate: keepById.get(staged.asset.id) === true
    });
  }
  const created = createImportJob(state.importJobs, {
    collectionId,
    items: jobItems,
    options: {
      duplicateAction: "skip",
      autoAnalyze: message.options?.autoAnalyze === true,
      customLabels: uniqueNames(message.customLabels)
    }
  });
  const skippedCleanupIds = [];
  for (const item of created.job.items.filter((value) => value.status === "skipped")) {
    const staged = stagedAssetById(staging, item.stagedAssetId);
    if (!staged) continue;
    const removed = removeStagedAsset(staging, staged.id);
    staging = removed.state;
    skippedCleanupIds.push(...removed.removedAssetIds);
  }
  await commitLocalChanges({
    [STORAGE_KEYS.importJobs]: created.state,
    [STORAGE_KEYS.importStaging]: staging
  });
  await deleteUnreferencedMedia(skippedCleanupIds);
  await queueImportJobAnalysis(created.job);
  scheduleImportRunner();
  return { ok: true, message: "本机资料已加入后台导入", job: created.job };
}

async function getImportJobAction(jobId) {
  const stored = await chrome.storage.local.get(STORAGE_KEYS.importJobs);
  const importJobs = normalizeImportJobsState(stored[STORAGE_KEYS.importJobs]);
  const id = String(jobId ?? "").trim();
  const job = id
    ? importJobs.items.find((item) => item.id === id) ?? null
    : importJobs.items.find((item) => ["queued", "running"].includes(item.status)) ?? importJobs.items.at(-1) ?? null;
  return { ok: true, job, importJobs };
}

async function cancelImportJobAction(jobId) {
  const stored = await chrome.storage.local.get([STORAGE_KEYS.importJobs, STORAGE_KEYS.importStaging]);
  const canceled = cancelImportJob(stored[STORAGE_KEYS.importJobs], jobId);
  let staging = normalizeImportStagingState(stored[STORAGE_KEYS.importStaging]);
  const cleanupIds = [];
  const localReferenceCleanupIds = [];
  for (const item of canceled.job.items.filter((value) => value.status === "skipped" && value.skipReason === "canceled")) {
    const staged = stagedAssetById(staging, item.stagedAssetId);
    if (!staged) continue;
    const removed = removeStagedAsset(staging, staged.id);
    staging = removed.state;
    cleanupIds.push(...removed.removedAssetIds);
    if (staged.recordType === LOCAL_ASSET_REFERENCE_RECORD_TYPE) localReferenceCleanupIds.push(staged.assetId);
  }
  await commitLocalChanges({
    [STORAGE_KEYS.importJobs]: canceled.state,
    [STORAGE_KEYS.importStaging]: staging
  });
  await deleteUnreferencedMedia(cleanupIds);
  const committedState = await readState();
  const retainedLocalAssetIds = collectRetainedLocalAssetIds({ ...committedState, importStaging: staging });
  await Promise.allSettled(localReferenceCleanupIds
    .filter((assetId) => !retainedLocalAssetIds.has(assetId))
    .map((assetId) => deleteLocalAssetHandle(assetId)));
  return { ok: true, message: "已取消剩余导入项", job: canceled.job };
}

async function retryImportJobAction(jobId) {
  const stored = await chrome.storage.local.get(STORAGE_KEYS.importJobs);
  const retried = retryImportJob(stored[STORAGE_KEYS.importJobs], jobId);
  await commitLocalChanges({ [STORAGE_KEYS.importJobs]: retried.state });
  scheduleImportRunner();
  return { ok: true, message: "失败项已重新加入后台导入", job: retried.job };
}

async function undoImportJobAction(jobId) {
  const state = await readState();
  const undone = undoImportJob(state.importJobs, jobId);
  const removedIds = new Set(undone.createdEntryIds);
  const removedEntries = state.entries.filter((entry) => removedIds.has(entry.id));
  const entries = state.entries.filter((entry) => !removedIds.has(entry.id));
  const organizerState = removeEntriesFromOrganizer(
    normalizeOrganizerState(state.organizerState, state.entries.map((entry) => entry.id)),
    undone.createdEntryIds
  );
  const compoundCases = removeEntriesFromCompoundCases(state.compoundCases, state.entries, undone.createdEntryIds);
  await commitLocalChanges({
    [STORAGE_KEYS.entries]: entries,
    [STORAGE_KEYS.organizerState]: organizerState,
    [STORAGE_KEYS.compoundCases]: compoundCases,
    [STORAGE_KEYS.importJobs]: undone.state
  });
  const assetIds = removedEntries.flatMap((entry) => normalizeEntryMedia(entry).mediaAssets
    .filter((asset) => asset.storageMode !== "reference")
    .map((asset) => asset.id));
  const localReferenceIds = removedEntries.flatMap((entry) => normalizeEntryMedia(entry).mediaAssets
    .filter((asset) => asset.recordType === LOCAL_ASSET_REFERENCE_RECORD_TYPE)
    .map((asset) => asset.id));
  await deleteUnreferencedMedia(assetIds);
  const retainedLocalAssetIds = collectRetainedLocalAssetIds({ ...state, entries });
  await Promise.allSettled(localReferenceIds
    .filter((assetId) => !retainedLocalAssetIds.has(assetId))
    .map((assetId) => deleteLocalAssetHandle(assetId)));
  return { ok: true, message: `已撤销本次导入的 ${removedEntries.length} 个案例`, job: undone.job };
}

async function recoverImportJobs() {
  const stored = await chrome.storage.local.get(STORAGE_KEYS.importJobs);
  const recovered = normalizeImportJobsState(stored[STORAGE_KEYS.importJobs], { recoverRunning: true });
  if (stored[STORAGE_KEYS.importJobs]
      && JSON.stringify(stored[STORAGE_KEYS.importJobs]) !== JSON.stringify(recovered)) {
    await commitLocalChanges({ [STORAGE_KEYS.importJobs]: recovered });
  }
  if (recovered.items.some((job) => ["queued", "running"].includes(job.status) && job.items.some((item) => item.status === "queued"))) {
    scheduleImportRunner();
  }
}

function scheduleImportRunner() {
  if (importRunnerActive || importRunnerTimer) return;
  chrome.alarms.create(IMPORT_JOB_ALARM, { when: Date.now() + 1000 }).catch(() => undefined);
  importRunnerTimer = setTimeout(() => {
    importRunnerTimer = 0;
    void enqueue(runImportJobSlice).catch((error) => console.error("PromptDirector local import failed", error));
  }, 0);
}

async function runImportJobSlice() {
  if (importRunnerActive) return;
  importRunnerActive = true;
  try {
    const stored = await chrome.storage.local.get([STORAGE_KEYS.importJobs, STORAGE_KEYS.importStaging]);
    let jobs = normalizeImportJobsState(stored[STORAGE_KEYS.importJobs]);
    const active = jobs.items.find((job) => ["queued", "running"].includes(job.status) && job.items.some((item) => item.status === "queued"));
    if (!active) return;
    const started = startImportJob(jobs, active.id);
    jobs = started.state;
    await commitLocalChanges({ [STORAGE_KEYS.importJobs]: jobs });
    const item = started.job.items.find((value) => value.status === "queued");
    try {
      await importStagedItem(started.job, item);
    } catch (error) {
      const latest = await chrome.storage.local.get(STORAGE_KEYS.importJobs);
      const failed = finishImportItem(latest[STORAGE_KEYS.importJobs], started.job.id, item.id, {
        status: "failed",
        error: userMessage(error)
      });
      await commitLocalChanges({ [STORAGE_KEYS.importJobs]: failed.state });
      await queueImportJobAnalysis(failed.job);
    }
  } finally {
    importRunnerActive = false;
    const stored = await chrome.storage.local.get(STORAGE_KEYS.importJobs);
    const pending = normalizeImportJobsState(stored[STORAGE_KEYS.importJobs]).items.some((job) =>
      ["queued", "running"].includes(job.status) && job.items.some((item) => item.status === "queued"));
    if (pending) scheduleImportRunner();
    else await chrome.alarms.clear(IMPORT_JOB_ALARM).catch(() => undefined);
  }
}

async function importStagedItem(job, item) {
  const state = await readState();
  const staged = stagedAssetById(state.importStaging, item.stagedAssetId);
  if (!staged) throw new Error("暂存文件已经丢失，无法继续导入");
  if (staged.storageMode !== "reference" && !await getMediaBlob(staged.assetId)) {
    throw new Error(`本机媒体已经丢失：${staged.name}`);
  }
  if (staged.posterAssetId && !await getMediaBlob(staged.posterAssetId)) throw new Error(`视频或 GIF 封面已经丢失：${staged.name}`);
  const entry = importedEntryFromStagedAsset(state, staged, job, item);
  const entries = [...state.entries, entry];
  let organizerState = normalizeOrganizerState(state.organizerState, entries.map((value) => value.id));
  if (job.collectionId) {
    const target = organizerState.collections.find((collection) => collection.id === job.collectionId);
    if (!target) throw new Error("导入目标项目已经不存在");
    target.entryIds = [...new Set([...target.entryIds, entry.id])];
    organizerState = normalizeOrganizerState(organizerState, entries.map((value) => value.id));
  }
  const finished = finishImportItem(state.importJobs, job.id, item.id, { status: "imported", entryId: entry.id });
  const removed = removeStagedAsset(state.importStaging, staged.id);
  await commitLocalChanges({
    [STORAGE_KEYS.entries]: entries,
    [STORAGE_KEYS.organizerState]: organizerState,
    [STORAGE_KEYS.importJobs]: finished.state,
    [STORAGE_KEYS.importStaging]: removed.state
  });
  await enqueueAutomaticLibraryMaintenance([entry]);
  await notifySaved(entries.length);
  await queueImportJobAnalysis(finished.job);
}

function importedEntryFromStagedAsset(state, staged, job, item) {
  const base = buildEntry({
    text: staged.contentText || "",
    title: staged.name,
    url: "",
    libraryAddedAt: item.libraryAddedAt || job.libraryAddedAt,
    allowEmptyText: true
  });
  const asset = stagedAssetMediaRecord(staged, { capturedAt: new Date().toISOString() });
  const mediaAssets = [asset];
  if (staged.posterAssetId) {
    mediaAssets.push({
      ...(staged.posterAsset ?? {}),
      id: staged.posterAssetId,
      kind: "image",
      usage: "poster",
      derivedFromAssetId: staged.assetId,
      storageMode: "managed",
      capturedAt: new Date().toISOString(),
      reviewStatus: "verified"
    });
  }
  return normalizeEntryMedia({
    ...base,
    importBatchId: item.importBatchId || job.importBatchId,
    schemaVersion: SCHEMA_VERSION,
    mediaAssets,
    primaryMediaId: staged.assetId,
    classification: classifyImportedMedia({ ...base, mediaAssets }, state.taxonomy),
    customLabels: uniqueNames(job.options.customLabels), metadataLabels: [], facetAssignments: [], analysisCandidates: [], analysisBreakdown: [],
    rejectedCandidateKeys: [], negativeTerms: [], legacyFacetCandidates: [], analysisPending: false
  });
}

async function queueImportJobAnalysis(job) {
  if (!["completed", "failed", "canceled"].includes(job.status) || !job.options.autoAnalyze || job.analysisQueuedAt) return;
  const entryIds = job.items.filter((item) => item.status === "imported").map((item) => item.entryId).filter(Boolean);
  if (entryIds.length) await queueAutomaticVisionAnalysis(entryIds, { requireAutoImportSetting: false });
  const stored = await chrome.storage.local.get(STORAGE_KEYS.importJobs);
  const marked = markImportJobAnalysisQueued(stored[STORAGE_KEYS.importJobs], job.id);
  await commitLocalChanges({ [STORAGE_KEYS.importJobs]: marked.state });
}

async function addTempReferencesAction(message) {
  const sessionId = String(message.sessionId ?? "").trim();
  if (!sessionId) throw new Error("临时引用缺少创作会话编号");
  const stored = await chrome.storage.local.get(STORAGE_KEYS.composerSessions);
  const sessions = normalizeComposerSessions(stored[STORAGE_KEYS.composerSessions]);
  const existing = sessions.find((item) => item.id === sessionId);
  if (message.session && String(message.session.id ?? "").trim() !== sessionId) throw new Error("临时引用与创作会话不匹配");
  const baseline = existing ?? (message.session ? createComposerSession(message.session) : null);
  if (!baseline || baseline.id !== sessionId) throw new Error("创作会话尚未保存，请重新打开创作台");
  const additions = Array.isArray(message.tempReferences) ? message.tempReferences : [];
  if (!additions.length) throw new Error("没有可添加的临时引用");
  const knownIds = new Set(baseline.referenceSnapshots.map((item) => item.entryId));
  for (const reference of additions) {
    const referenceId = String(reference?.entryId ?? "").trim();
    if (!referenceId.startsWith("temp-reference:") || reference?.sourceType !== "temporary") {
      throw new Error("临时引用格式无效");
    }
    if (knownIds.has(referenceId)) throw new Error("这项临时引用已经加入创作台");
    const assetIds = tempReferenceAssetIds(reference);
    if (!assetIds.length) throw new Error("临时引用没有可用媒体");
    for (const assetId of assetIds) {
      if (!await getMediaBlob(assetId)) throw new Error("临时引用媒体已经失效，请重新添加");
    }
    knownIds.add(referenceId);
  }
  const session = createComposerSession({
    ...baseline,
    referenceSnapshots: [...baseline.referenceSnapshots, ...additions]
  });
  const next = normalizeComposerSessions([session, ...sessions.filter((item) => item.id !== session.id)]);
  await commitLocalChanges({ [STORAGE_KEYS.composerSessions]: next });
  return { ok: true, session, summaries: next.map(sessionSummary) };
}

async function removeTempReferenceAction(message) {
  const sessionId = String(message.sessionId ?? "").trim();
  const tempReferenceId = String(message.tempReferenceId ?? "").trim();
  const stored = await chrome.storage.local.get(STORAGE_KEYS.composerSessions);
  const sessions = normalizeComposerSessions(stored[STORAGE_KEYS.composerSessions]);
  const current = sessions.find((item) => item.id === sessionId);
  if (!current) throw new Error("没有找到这份创作草稿");
  const reference = current.referenceSnapshots.find((item) => item.entryId === tempReferenceId && item.sourceType === "temporary");
  if (!reference) throw new Error("没有找到这项临时引用");
  const session = createComposerSession({
    ...current,
    referenceSnapshots: current.referenceSnapshots.filter((item) => item.entryId !== tempReferenceId)
  });
  const next = normalizeComposerSessions([session, ...sessions.filter((item) => item.id !== session.id)]);
  await commitLocalChanges({ [STORAGE_KEYS.composerSessions]: next });
  await deleteUnreferencedMedia(tempReferenceAssetIds(reference));
  return { ok: true, session, summaries: next.map(sessionSummary) };
}

async function saveTempReferenceAsCaseAction(message) {
  const state = await readState();
  const sessionId = String(message.sessionId ?? "").trim();
  const tempReferenceId = String(message.tempReferenceId ?? "").trim();
  const current = state.composerSessions.find((item) => item.id === sessionId);
  if (!current) throw new Error("没有找到这份创作草稿");
  const reference = current.referenceSnapshots.find((item) => item.entryId === tempReferenceId && item.sourceType === "temporary");
  if (!reference) throw new Error("没有找到这项临时引用");
  const assetRefs = Array.isArray(reference.assetRefs) ? reference.assetRefs : [];
  if (!assetRefs.length) throw new Error("临时引用没有可保存的媒体");
  for (const asset of assetRefs) {
    if (!await getMediaBlob(asset.assetId)) throw new Error(`临时引用媒体已经失效：${asset.name || "未命名"}`);
  }
  const title = String(message.title ?? reference.title ?? assetRefs[0]?.name ?? "本机参考").trim();
  const base = buildEntry({ text: reference.referenceText || "", title, url: "", allowEmptyText: true });
  const mediaAssets = assetRefs.map((asset) => ({
    id: asset.assetId,
    kind: asset.kind,
    storageMode: "managed",
    mimeType: asset.mimeType,
    byteSize: asset.byteSize,
    sourceTitle: asset.name,
    capturedAt: new Date().toISOString(),
    reviewStatus: "verified"
  }));
  const entry = normalizeEntryMedia({
    ...base,
    schemaVersion: SCHEMA_VERSION,
    mediaAssets,
    primaryMediaId: mediaAssets[0].id,
    classification: classifyImportedMedia({ ...base, mediaAssets }, state.taxonomy),
    customLabels: [], metadataLabels: [], facetAssignments: [], analysisCandidates: [], analysisBreakdown: [],
    rejectedCandidateKeys: [], negativeTerms: [], legacyFacetCandidates: [], analysisPending: false
  });
  const libraryReference = {
    ...reference,
    entryId: entry.id,
    sourceType: "library",
    assetRefs: undefined
  };
  const session = createComposerSession({
    ...current,
    referenceSnapshots: current.referenceSnapshots.map((item) => item.entryId === tempReferenceId ? libraryReference : item)
  });
  const sessions = normalizeComposerSessions([session, ...state.composerSessions.filter((item) => item.id !== session.id)]);
  await commitLocalChanges({
    [STORAGE_KEYS.entries]: [...state.entries, entry],
    [STORAGE_KEYS.composerSessions]: sessions
  });
  if (mediaAssets.some((asset) => asset.kind === "image")) await queueAutomaticVisionAnalysis([entry.id]);
  return { ok: true, message: "临时引用已保存为案例", entry, session, summaries: sessions.map(sessionSummary) };
}

async function startOrJoinAnalysisTaskAction(message) {
  const created = await enqueue(async () => {
    const stored = await chrome.storage.local.get(STORAGE_KEYS.analysisTasks);
    const result = createOrJoinAnalysisTask(stored[STORAGE_KEYS.analysisTasks], message, {
      taskId: `analysis-task:${crypto.randomUUID()}`
    });
    await commitLocalChanges({ [STORAGE_KEYS.analysisTasks]: result.state }, { markSyncDirty: false });
    return result;
  });
  if (created.created) scheduleAnalysisTaskRun(created.task.id);
  return analysisTaskResponse(created.task);
}

async function getAnalysisTaskAction(taskId) {
  const stored = await chrome.storage.local.get(STORAGE_KEYS.analysisTasks);
  const task = analysisTaskById(stored[STORAGE_KEYS.analysisTasks], taskId);
  if (!task) return { ok: false, message: "没有找到图片分析任务" };
  return analysisTaskResponse(task);
}

async function detachAnalysisConsumerAction(message) {
  const stored = await chrome.storage.local.get(STORAGE_KEYS.analysisTasks);
  const detached = detachAnalysisTaskConsumer(
    stored[STORAGE_KEYS.analysisTasks],
    message.taskId,
    message.consumerId,
    message.clientRequestId
  );
  await commitLocalChanges({ [STORAGE_KEYS.analysisTasks]: detached.state }, { markSyncDirty: false });
  return analysisTaskResponse(detached.task);
}

async function stopAnalysisTaskAction(message) {
  const stopped = await enqueue(async () => {
    const stored = await chrome.storage.local.get(STORAGE_KEYS.analysisTasks);
    const state = normalizeAnalysisTaskRegistry(stored[STORAGE_KEYS.analysisTasks]);
    const current = analysisTaskById(state, message.taskId);
    if (!current) throw new Error("没有找到图片分析任务");
    const task = stopAnalysisTask(current);
    const next = replaceAnalysisTask(state, task);
    await commitLocalChanges({ [STORAGE_KEYS.analysisTasks]: next }, { markSyncDirty: false });
    return task;
  });
  analysisTaskRunners.get(stopped.id)?.controller.abort();
  await notifyAnalysisTaskUpdated(stopped);
  return analysisTaskResponse(stopped);
}

async function retryAnalysisTaskAction(message) {
  if (message.confirmDuplicateCharge !== true) throw new Error("重新分析前必须确认可能再次计费");
  const retried = await enqueue(async () => {
    const stored = await chrome.storage.local.get(STORAGE_KEYS.analysisTasks);
    const state = normalizeAnalysisTaskRegistry(stored[STORAGE_KEYS.analysisTasks]);
    const current = analysisTaskById(state, message.taskId);
    if (!current) throw new Error("没有找到图片分析任务");
    const previousAttemptId = current.attempts.at(-1)?.id ?? "";
    if (String(message.previousAttemptId ?? "").trim() !== previousAttemptId) {
      throw new Error("图片分析任务已经变化，请刷新后再重试");
    }
    const task = retryAnalysisAttempt(current, {
      attemptId: `analysis-attempt:${crypto.randomUUID()}`,
      confirmed: true
    });
    task.consumerIds = [...new Set([...task.consumerIds, String(message.consumerId ?? "").trim()].filter(Boolean))];
    task.clientRequestIds = [...new Set([...task.clientRequestIds, String(message.clientRequestId ?? "").trim()].filter(Boolean))];
    const next = replaceAnalysisTask(state, task);
    await commitLocalChanges({ [STORAGE_KEYS.analysisTasks]: next }, { markSyncDirty: false });
    return task;
  });
  scheduleAnalysisTaskRun(retried.id, retried.activeAttemptId);
  return analysisTaskResponse(retried);
}

function scheduleAnalysisTaskRun(taskId, preparedAttemptId = "") {
  if (analysisTaskRunners.has(taskId)) return;
  chrome.alarms.create(ANALYSIS_TASK_ALARM, { when: Date.now() + 50 });
  void runAnalysisTask(taskId, preparedAttemptId);
}

async function runQueuedAnalysisTasks() {
  const stored = await chrome.storage.local.get(STORAGE_KEYS.analysisTasks);
  const state = normalizeAnalysisTaskRegistry(stored[STORAGE_KEYS.analysisTasks]);
  for (const task of state.items.filter((item) => item.status === "queued")) scheduleAnalysisTaskRun(task.id);
}

async function runAnalysisTask(taskId, preparedAttemptId = "") {
  if (analysisTaskRunners.has(taskId)) return;
  const claimed = await enqueue(async () => {
    const stored = await chrome.storage.local.get(STORAGE_KEYS.analysisTasks);
    const state = normalizeAnalysisTaskRegistry(stored[STORAGE_KEYS.analysisTasks]);
    const current = analysisTaskById(state, taskId);
    if (!current) return null;
    let task = current;
    if (task.status === "queued") {
      task = startAnalysisAttempt(task, { attemptId: `analysis-attempt:${crypto.randomUUID()}` });
    } else if (!preparedAttemptId || task.status !== "running" || task.activeAttemptId !== preparedAttemptId) {
      return null;
    }
    const next = replaceAnalysisTask(state, task);
    await commitLocalChanges({ [STORAGE_KEYS.analysisTasks]: next }, { markSyncDirty: false });
    return task;
  });
  if (!claimed) return;
  const controller = new AbortController();
  analysisTaskRunners.set(taskId, { attemptId: claimed.activeAttemptId, controller });
  let actionResult;
  try {
    actionResult = await analyzeTempReferencesAction({
      ...claimed.request,
      taskId: claimed.id,
      attemptId: claimed.activeAttemptId,
      priority: claimed.priority,
      signal: controller.signal
    });
  } catch (error) {
    actionResult = { ok: false, message: userMessage(error) };
  }
  let settled;
  try {
    settled = await enqueue(async () => {
      const stored = await chrome.storage.local.get(STORAGE_KEYS.analysisTasks);
      const state = normalizeAnalysisTaskRegistry(stored[STORAGE_KEYS.analysisTasks]);
      const current = analysisTaskById(state, taskId);
      if (!current || current.activeAttemptId !== claimed.activeAttemptId || current.status !== "running") return current;
      const task = actionResult?.ok
        ? completeAnalysisAttempt(current, { attemptId: claimed.activeAttemptId, result: actionResult })
        : failAnalysisAttempt(current, { attemptId: claimed.activeAttemptId, error: actionResult?.message || "图片分析失败" });
      const next = replaceAnalysisTask(state, task);
      await commitLocalChanges({ [STORAGE_KEYS.analysisTasks]: next }, { markSyncDirty: false });
      return task;
    });
  } finally {
    analysisTaskRunners.delete(taskId);
  }
  if (settled) await notifyAnalysisTaskUpdated(settled);
}

async function recoverAnalysisTasks() {
  const stored = await chrome.storage.local.get(STORAGE_KEYS.analysisTasks);
  const current = normalizeAnalysisTaskRegistry(stored[STORAGE_KEYS.analysisTasks]);
  const recovered = recoverInterruptedAnalysisTasks(current);
  if (JSON.stringify(current) !== JSON.stringify(recovered)) {
    await commitLocalChanges({ [STORAGE_KEYS.analysisTasks]: recovered }, { markSyncDirty: false });
    for (const task of recovered.items.filter((item) => item.executionState === "execution_state_unknown")) {
      await notifyAnalysisTaskUpdated(task);
    }
  }
  for (const task of recovered.items.filter((item) => item.status === "queued")) scheduleAnalysisTaskRun(task.id);
}

async function analysisTaskAttemptIsActive(taskId, attemptId) {
  const stored = await chrome.storage.local.get(STORAGE_KEYS.analysisTasks);
  const task = analysisTaskById(stored[STORAGE_KEYS.analysisTasks], taskId);
  return Boolean(task && task.status === "running" && task.executionState === "running" && task.activeAttemptId === attemptId);
}

function analysisTaskResponse(task) {
  const attempt = task?.activeAttemptId
    ? task.attempts.find((item) => item.id === task.activeAttemptId)
    : task?.attempts?.at(-1);
  return {
    ok: true,
    task,
    attemptId: attempt?.id ?? "",
    ...(attempt?.result ? { result: attempt.result } : {})
  };
}

async function notifyAnalysisTaskUpdated(task) {
  await chrome.runtime.sendMessage({ type: "ANALYSIS_TASK_UPDATED", ...analysisTaskResponse(task) }).catch(() => undefined);
}

async function analyzeTempReferencesAction(message) {
  try {
    const sessionId = String(message.sessionId ?? "").trim();
    const requestedIds = [...new Set((Array.isArray(message.tempReferenceIds) ? message.tempReferenceIds : [])
      .map((value) => String(value ?? "").trim()).filter(Boolean))];
    if (!sessionId || !requestedIds.length) return { ok: false, message: "没有可分析的临时图片" };
    const stored = await chrome.storage.local.get([
      STORAGE_KEYS.composerSessions,
      STORAGE_KEYS.facetCatalog,
      STORAGE_KEYS.entries
    ]);
    const sessions = normalizeComposerSessions(stored[STORAGE_KEYS.composerSessions]);
    const session = sessions.find((item) => item.id === sessionId);
    if (!session) return { ok: false, message: "没有找到这份创作草稿" };
    const requested = new Set(requestedIds);
    const references = session.referenceSnapshots.filter((reference) =>
      requested.has(reference.entryId)
      && unreadReferenceImageAssets(reference).length
    );
    if (references.length !== requested.size) {
      return { ok: false, message: "参考图片已经变化，请确认后重试" };
    }
    const configuration = await loadAiConfiguration();
    const locale = message.outputLocale === "en" ? "en" : "zh-CN";
    const settledReferences = await Promise.allSettled(references.map(async (reference) => {
      const imageAssets = unreadReferenceImageAssets(reference);
      const assetResults = await Promise.all(imageAssets.map(async (asset) => {
        if (message.signal?.aborted) throw new DOMException("图片分析已停止", "AbortError");
        const blob = await getTempReferenceVisionBlob(asset);
        if (!blob) throw new Error(`参考图片已经失效：${asset.name || "未命名图片"}`);
        const { result, fingerprint } = await analyzeVisionBlobWithScheduler({
          blob,
          catalog: stored[STORAGE_KEYS.facetCatalog],
          locale,
          configuration,
          entries: stored[STORAGE_KEYS.entries],
          priority: message.priority
        });
        return {
          description: result.description,
          fingerprint: { assetId: asset.assetId, fingerprint },
          analysis: {
            assetId: asset.assetId,
            imageFingerprint: fingerprint,
            analysisImageFingerprint: fingerprint,
            analysisVersion: VISION_ANALYSIS_VERSION,
            analysisFingerprint: result.profileFingerprint,
            reconstructionPrompt: result.reconstructionPrompt
          }
        };
      }));
      return {
        referenceId: reference.entryId,
        descriptions: assetResults.map((item) => item.description),
        fingerprints: assetResults.map((item) => item.fingerprint),
        analyses: assetResults.map((item) => item.analysis)
      };
    }));
    const analyzed = settledReferences.flatMap((settled) => settled.status === "fulfilled" ? [settled.value] : []);
    const failures = settledReferences.flatMap((settled, index) => settled.status === "rejected"
      ? [{ referenceId: references[index].entryId, message: userMessage(settled.reason) }]
      : []);
    if (!analyzed.length) throw new Error(failures[0]?.message || "临时图片分析失败");

    return await enqueue(async () => {
      if (message.taskId && !await analysisTaskAttemptIsActive(message.taskId, message.attemptId)) {
        return { ok: false, message: "这次图片分析已经停止或失效，结果没有写入" };
      }
      const latestStored = await chrome.storage.local.get(STORAGE_KEYS.composerSessions);
      const latestSessions = normalizeComposerSessions(latestStored[STORAGE_KEYS.composerSessions]);
      const latestSession = latestSessions.find((item) => item.id === sessionId);
      if (!latestSession) return { ok: false, message: "分析期间创作草稿已经变化，本次结果没有写入" };
      for (const item of analyzed) {
        const current = latestSession.referenceSnapshots.find((reference) =>
          reference.entryId === item.referenceId
          && unreadReferenceImageAssets(reference).length
        );
        if (!current) return { ok: false, message: "分析期间参考图片已经变化，本次结果没有写入" };
        const currentAssets = unreadReferenceImageAssets(current);
        for (const expected of item.fingerprints) {
          const asset = currentAssets.find((value) => value.assetId === expected.assetId);
          const blob = asset ? await getTempReferenceVisionBlob(asset) : null;
          if (!blob || await imageFingerprint(blob) !== expected.fingerprint) {
            return { ok: false, message: "分析期间参考图片已经变化，本次结果没有写入" };
          }
        }
      }
      const resultByReferenceId = new Map(analyzed.map((item) => [item.referenceId, item]));
      const updatedSession = createComposerSession({
        ...latestSession,
        referenceSnapshots: latestSession.referenceSnapshots.map((reference) => {
          const result = resultByReferenceId.get(reference.entryId);
          return result ? {
            ...reference,
            referenceKind: "vision",
            referenceText: result.descriptions.join("\n\n"),
            assets: result.analyses
          } : reference;
        })
      });
      const next = normalizeComposerSessions([
        updatedSession,
        ...latestSessions.filter((item) => item.id !== updatedSession.id)
      ]);
      await commitLocalChanges({ [STORAGE_KEYS.composerSessions]: next });
      return {
        ok: true,
        quality: failures.length ? "partial" : "complete",
        failedCount: failures.length,
        failures,
        message: failures.length
          ? `已保存 ${analyzed.length} 项分析，另有 ${failures.length} 项失败，可直接重试`
          : `已完成 ${analyzed.length} 项临时图片分析`,
        session: updatedSession,
        summaries: next.map(sessionSummary)
      };
    });
  } catch (error) {
    return { ok: false, message: userMessage(error) };
  }
}

async function getTempReferenceVisionBlob(asset) {
  const blob = await getMediaBlob(asset.assetId) ?? await getScreenshotBlob(asset.assetId);
  if (!blob) return null;
  if (blob.type !== "image/gif") return blob;
  const derived = await getDerivedMedia(asset.assetId).catch(() => null);
  return derived?.thumbnail instanceof Blob ? derived.thumbnail : blob;
}

async function deleteUnreferencedMedia(assetIdsValue) {
  const candidates = new Set((Array.isArray(assetIdsValue) ? assetIdsValue : []).map(String).map((value) => value.trim()).filter(Boolean));
  if (!candidates.size) return;
  const state = await readState();
  const referenced = referencedMediaAssetIds(state);
  await deleteMediaBlobs([...candidates].filter((assetId) => !referenced.has(assetId)));
}

function referencedMediaAssetIds(state) {
  return collectRetainedLocalAssetIds(state);
}

function temporaryAssetIdsFromSession(session) {
  return (Array.isArray(session?.referenceSnapshots) ? session.referenceSnapshots : [])
    .filter((reference) => reference?.sourceType === "temporary")
    .flatMap(tempReferenceAssetIds);
}

async function updateComposerSettings(message) {
  const stored = await chrome.storage.local.get(STORAGE_KEYS.composerSettings);
  let settings = normalizeComposerSettings(stored[STORAGE_KEYS.composerSettings]);
  const allowedActions = ["save_agent", "reset_agent", "save_task", "reset_task", "preferences"];
  const action = allowedActions.includes(message.action) ? message.action : "preferences";
  if (action === "save_agent") settings = updateComposerAgentInstruction(settings, message.text);
  if (action === "reset_agent") settings = resetComposerAgentInstruction(settings);
  if (action === "save_task") settings = updateComposerTaskMethod(settings, { taskKey: message.taskKey, text: message.text });
  if (action === "reset_task") settings = resetComposerTaskMethod(settings, message.taskKey);
  if (["auto", "zh-CN", "en"].includes(message.outputLanguage)) settings.outputLanguage = message.outputLanguage;
  if (message.lastTargetPlatform !== undefined) settings.lastTargetPlatform = String(message.lastTargetPlatform ?? "").trim();
  if (message.lastAiProfile !== undefined) settings.lastAiProfile = normalizeComposerAiProfile(message.lastAiProfile);
  if (message.productionReviewEnabled !== undefined) settings.productionReviewEnabled = message.productionReviewEnabled !== false;
  await commitLocalChanges({ [STORAGE_KEYS.composerSettings]: settings });
  const responseMessage = action.startsWith("reset_")
    ? "已采用当前版本默认内容"
    : action === "preferences" ? "创作偏好已保存" : "Agent 设置已保存";
  return { ok: true, message: responseMessage, composerSettings: settings };
}

async function upsertComposerSession(value) {
  const stored = await chrome.storage.local.get(STORAGE_KEYS.composerSessions);
  const sessions = normalizeComposerSessions(stored[STORAGE_KEYS.composerSessions]);
  const session = createComposerSession(value);
  if (!isMeaningfulComposerSession(session)) return { ok: false, message: "空白新对话不会保存到历史" };
  const next = normalizeComposerSessions([session, ...sessions.filter((item) => item.id !== session.id)]);
  await commitLocalChanges({ [STORAGE_KEYS.composerSessions]: next });
  return { ok: true, session, summaries: next.map(sessionSummary) };
}

async function deleteComposerSession(sessionId) {
  const stored = await chrome.storage.local.get([
    STORAGE_KEYS.composerSessions,
    STORAGE_KEYS.activeCreativeResult
  ]);
  const sessions = normalizeComposerSessions(stored[STORAGE_KEYS.composerSessions]);
  const removedSession = sessions.find((item) => item.id === sessionId);
  const next = sessions.filter((item) => item.id !== sessionId);
  if (next.length === sessions.length) return { ok: false, message: "没有找到这份创作草稿" };
  const active = normalizeActiveCreativeResult(stored[STORAGE_KEYS.activeCreativeResult]);
  await commitLocalChanges({
    [STORAGE_KEYS.composerSessions]: next,
    ...(active?.sessionId === sessionId ? { [STORAGE_KEYS.activeCreativeResult]: null } : {})
  });
  await deleteUnreferencedMedia(temporaryAssetIdsFromSession(removedSession));
  return { ok: true, message: "创作草稿已删除", summaries: next.map(sessionSummary) };
}

async function saveComposerResult(message) {
  const state = await readState();
  const stored = await chrome.storage.local.get(STORAGE_KEYS.composerSessions);
  const session = normalizeComposerSessions(stored[STORAGE_KEYS.composerSessions]).find((item) => item.id === message.sessionId);
  if (!session) return { ok: false, message: "创作草稿已变化，请重新打开" };
  const version = session.promptVersions.find((item) => item.id === message.promptVersionId);
  if (!version) return { ok: false, message: "最终提示词尚未完整保存" };
  const title = String(message.title ?? version.title ?? session.title).trim() || "未命名提示词";
  const contentRole = session.targetType === "video" ? CONTENT_ROLES.promptVideo : CONTENT_ROLES.promptImage;
  const contentType = contentTypeForRole(state.taxonomy, contentRole);
  const entry = {
    ...buildEntry({ text: version.text, title, url: "" }),
    schemaVersion: SCHEMA_VERSION,
    classification: contentType
      ? { pathIds: [contentType.id], status: "confirmed", source: "composer", reason: "创作台保存" }
      : { pathIds: [], status: "needs_review", source: "composer", reason: "没有匹配当前创作用途的内容类型" },
    facetAssignments: [],
    analysisCandidates: [],
    analysisBreakdown: [],
    rejectedCandidateKeys: [],
    negativeTerms: [],
    legacyFacetCandidates: [],
    analysisPending: false,
    creationMeta: {
      sourceEntryIds: session.referenceSnapshots.map((item) => item.entryId),
      promptVersionId: version.id,
      methodVersion: version.methodVersion || COMPOSER_METHOD_VERSION,
      targetPlatform: session.targetPlatform,
      outputLanguage: version.outputLanguage || session.outputLanguage,
      createdAt: version.createdAt
    }
  };
  const entries = [...state.entries, entry];
  await commitLocalChanges({ [STORAGE_KEYS.entries]: entries });
  return { ok: true, message: "最终提示词已保存为新案例", entry };
}

async function activateCreativeResult(message, sidePanelOpening = null) {
  const stored = await chrome.storage.local.get(STORAGE_KEYS.composerSessions);
  const session = normalizeComposerSessions(stored[STORAGE_KEYS.composerSessions])
    .find((item) => item.id === String(message.sessionId ?? "").trim());
  if (!session) return { ok: false, message: "创作草稿已变化，请重新打开" };
  if (session.targetType === "video") {
    await commitLocalChanges({ [STORAGE_KEYS.activeCreativeResult]: null });
    return { ok: false, message: "当前版本只支持关联图片生成结果" };
  }
  const activeCreativeResult = activateCreativeResultContext(session, message.promptVersionId);
  await commitLocalChanges({ [STORAGE_KEYS.activeCreativeResult]: activeCreativeResult });
  const panelOpened = sidePanelOpening ? await sidePanelOpening : false;
  return {
    ok: true,
    message: panelOpened
      ? "已打开侧边栏，可选择本次生成图片"
      : "已准备添加生成图片，但侧边栏未自动打开，请点击插件图标",
    panelOpened,
    activeCreativeResult
  };
}

async function captureAndCommitCreativeOutputs(message) {
  const transaction = await enqueueCapture(async () => {
    const captured = await dispatchCaptureMessage(message.captureType, message.tabId);
    if (!captured?.ok || !captured.added) {
      return { ...captured, captured, committed: null, draft: captured?.draft };
    }
    const committed = await enqueue(() => commitCreativeOutputsTransaction());
    return {
      ok: committed.ok,
      message: committed.message,
      draft: captured.draft,
      captured,
      committed
    };
  });
  if (!transaction.ok || !transaction.committed) return transaction;
  const committed = await analyzeCommittedCreativeOutputs(transaction.committed);
  return { ...transaction, message: committed.message, committed };
}

async function commitExistingCreativeOutputs() {
  const committed = await enqueueCapture(() => enqueue(() => commitCreativeOutputsTransaction()));
  return analyzeCommittedCreativeOutputs(committed);
}

async function registerGeneratedOutputs(message) {
  const state = await readState();
  const sessionId = String(message.sessionId ?? "").trim();
  const promptVersionId = String(message.promptVersionId ?? "").trim();
  const session = state.composerSessions.find((item) => item.id === sessionId);
  if (!session) return { ok: false, message: "对应的创作草稿已经不存在" };
  if (!session.promptVersions.some((item) => item.id === promptVersionId)) {
    return { ok: false, message: "生成图片与提示词版本不匹配" };
  }
  const visuals = Array.isArray(message.visuals) ? message.visuals : [];
  if (!visuals.length) return { ok: false, message: "没有收到可登记的生成图片" };
  for (const visual of visuals) {
    const id = String(visual?.id ?? "").trim();
    const blob = id ? await getScreenshotBlob(id) : null;
    if (!blob || !blob.type.startsWith("image/") || !blob.size) {
      return { ok: false, message: "有一张生成图片没有完整写入本地存储" };
    }
  }
  let creativeRuns = normalizeCreativeRuns(state.creativeRuns);
  let run = creativeRuns.find((item) => item.sessionId === sessionId && item.promptVersionId === promptVersionId);
  if (run) {
    for (const visual of visuals) run = addCreativeOutput(run, visual, undefined, message.generation);
    creativeRuns = [run, ...creativeRuns.filter((item) => item.id !== run.id)];
  } else {
    run = createCreativeRun({ sessionId, promptVersionId }, session, visuals, undefined, message.generation);
    creativeRuns = [run, ...creativeRuns];
  }
  creativeRuns = normalizeCreativeRuns(creativeRuns);
  await commitLocalChanges({ [STORAGE_KEYS.creativeRuns]: creativeRuns });
  return { ok: true, message: `已保存 ${visuals.length} 张生成图片`, runId: run.id, creativeRuns };
}

function dispatchCaptureMessage(type, tabId) {
  const actions = {
    ADD_ACTIVE_SELECTION_TO_DRAFT: "add-active-selection",
    CAPTURE_ACTIVE_TAB_TO_DRAFT: "capture-active-tab",
    CAPTURE_VISIBLE_VISUALS_TO_DRAFT: "capture-visible-visuals"
  };
  const action = actions[type];
  if (!action) throw new Error("不支持的创作结果采集操作");
  return captureRuntime.dispatch(action, { tabId });
}

async function commitCreativeOutputsTransaction() {
  const state = await readState();
  const context = state.activeCreativeResult;
  if (!context) return { ok: false, message: "没有等待接收结果的提示词，请先在创作台复制一版提示词" };
  const session = state.composerSessions.find((item) => item.id === context.sessionId);
  if (!session) return { ok: false, message: "对应的创作草稿已经不存在" };
  const draft = await captureRuntime.getDraft();
  if (draft.fragments.length) return { ok: false, message: "本次生成结果只接收图片，请先清空待保存文字" };
  if (!draft.visuals.length) return { ok: false, message: "请先选择或框选生成图片" };

  let runs = normalizeCreativeRuns(state.creativeRuns);
  let run = runs.find((item) =>
    item.sessionId === context.sessionId && item.promptVersionId === context.promptVersionId
  );
  if (run) {
    for (const visual of draft.visuals) run = addCreativeOutput(run, visual);
    runs = [run, ...runs.filter((item) => item.id !== run.id)];
  } else {
    run = createCreativeRun(context, session, draft.visuals);
    runs = [run, ...runs];
  }
  runs = normalizeCreativeRuns(runs);
  const visualIds = draft.visuals.map((item) => item.id);
  await commitLocalChanges({
    [STORAGE_KEYS.creativeRuns]: runs,
    [STORAGE_KEYS.captureDraft]: createCaptureDraft(),
    [STORAGE_KEYS.activeCreativeResult]: null
  });
  return {
    ok: true,
    message: `已关联 ${visualIds.length} 张生成结果`,
    runId: run.id,
    visualIds,
    creativeRuns: runs,
    autoAnalyze: state.creativeExperimentSettings.enabled && state.creativeExperimentSettings.autoAnalyze
  };
}

async function analyzeCommittedCreativeOutputs(committed) {
  if (!committed.ok || !committed.autoAnalyze) return committed;

  const failures = [];
  for (const visualId of committed.visualIds) {
    const result = await analyzeCreativeOutput(committed.runId, visualId);
    if (!result.ok) failures.push(result.message);
  }
  if (!failures.length) {
    return { ...committed, message: `${committed.message}，高级视觉对照已完成` };
  }
  return {
    ...committed,
    message: `${committed.message}；视觉对照未完成：${failures[0]}`,
    analysisWarning: failures[0]
  };
}

async function updateCreativeExperimentSettings(value) {
  const settings = normalizeCreativeExperimentSettings(value);
  if (settings.autoAnalyze) {
    const vision = resolveVisionTaskSettings("imageAnalysis", await loadAiConfiguration());
    if (!vision.consent || !vision[vision.activeProvider].apiKey) {
      throw new Error("自动视觉对照需要先完成图片视觉设置并确认截图发送范围");
    }
  }
  await commitLocalChanges({ [STORAGE_KEYS.creativeExperimentSettings]: settings });
  return {
    ok: true,
    message: settings.enabled
      ? settings.autoAnalyze ? "创作实验已开启，保存结果后会使用当前视觉服务分析" : "创作实验已开启"
      : "创作实验已关闭",
    creativeExperimentSettings: settings
  };
}

async function saveCreativeOutputToLibrary(message) {
  const state = await readState();
  const located = findCreativeOutput(state.creativeRuns, message.runId, message.visualId);
  if (!located) return { ok: false, message: "没有找到这张创作结果" };
  let posterAssetId = "";
  let metadataCommitted = false;
  try {
  let run = located.run;
  const output = located.output;
  const videoOutput = output.visual.kind === "video";
  const outputAssets = [output.visual];
  if (videoOutput) {
    const thumbnail = (await getDerivedMedia(output.visual.id).catch(() => null))?.thumbnail;
    if (thumbnail instanceof Blob) {
      const posterId = `poster:${output.visual.id}`;
      await saveMediaBlob(posterId, thumbnail);
      posterAssetId = posterId;
      outputAssets[0] = { ...output.visual, posterAssetId: posterId };
      outputAssets.push({
        id: posterId,
        kind: "image",
        usage: "poster",
        derivedFromAssetId: output.visual.id,
        storageMode: "managed",
        mimeType: thumbnail.type,
        byteSize: thumbnail.size,
        width: output.visual.width,
        height: output.visual.height,
        capturedAt: output.visual.capturedAt,
        reviewStatus: "verified"
      });
    }
  }
  const existing = state.entries.find((entry) =>
    entry.creationMeta?.promptVersionId === run.promptVersionId
  );
  let entry;
  let entries;
  if (existing) {
    entry = {
      ...existing,
      creationMeta: {
        ...existing.creationMeta,
        creativeRunId: run.id,
        promptVersionId: run.promptVersionId
      }
    };
    for (const asset of outputAssets) entry = addEntryMedia(entry, asset, { makePrimary: false });
    entries = state.entries.map((item) => item.id === existing.id ? entry : item);
  } else {
    entry = {
      ...buildEntry({ text: run.promptText, title: run.title || "创作结果", url: "" }),
      schemaVersion: SCHEMA_VERSION,
      classification: (() => {
        const contentType = contentTypeForRole(state.taxonomy, videoOutput ? CONTENT_ROLES.promptVideo : CONTENT_ROLES.promptImage);
        return contentType
          ? { pathIds: [contentType.id], status: "confirmed", source: "composer", reason: "创作结果回流" }
          : { pathIds: [], status: "needs_review", source: "composer", reason: `没有匹配${videoOutput ? "视频" : "图片"}创作用途的内容类型` };
      })(),
      facetAssignments: [],
      analysisCandidates: [],
      analysisBreakdown: [],
      rejectedCandidateKeys: [],
      negativeTerms: [],
      legacyFacetCandidates: [],
      analysisPending: false,
      mediaAssets: outputAssets,
      primaryMediaId: output.visual.id,
      creationMeta: {
        creativeRunId: run.id,
        promptVersionId: run.promptVersionId,
        methodVersion: run.methodVersion || COMPOSER_METHOD_VERSION,
        targetPlatform: run.targetPlatform,
        outputLanguage: run.outputLanguage,
        createdAt: run.createdAt
      }
    };
    entries = [...state.entries, normalizeEntryMedia(entry)];
  }
  run = recordCreativeSignal(run, output.visual.id, "saved_to_library");
  const creativeRuns = replaceCreativeRun(state.creativeRuns, run);
  await commitLocalChanges({
    [STORAGE_KEYS.entries]: entries,
    [STORAGE_KEYS.creativeRuns]: creativeRuns
  });
  metadataCommitted = true;
  let warning = "";
  if (!videoOutput) {
    try { await queueAutomaticVisionAnalysis([entry.id]); }
    catch (error) { warning = `结果已保存，但自动画面分析没有加入队列：${userMessage(error)}`; }
  }
  return {
    ok: true,
    message: `${existing ? `结果${videoOutput ? "视频" : "图片"}已加入对应案例` : "结果与这版提示词已保存到灵感库"}${warning ? `；${warning}` : ""}`,
    entry,
    creativeRuns,
    ...(warning ? { warnings: [warning] } : {})
  };
  } catch (error) {
    if (posterAssetId && !metadataCommitted) await deleteMediaBlob(posterAssetId).catch(() => undefined);
    throw error;
  }
}

async function updateCreativeSignal(message) {
  const state = await readState();
  const located = findCreativeOutput(state.creativeRuns, message.runId, message.visualId);
  if (!located) return { ok: false, message: "没有找到这张创作结果" };
  const run = recordCreativeSignal(located.run, located.output.visual.id, message.signalType);
  const creativeRuns = replaceCreativeRun(state.creativeRuns, run);
  await commitLocalChanges({ [STORAGE_KEYS.creativeRuns]: creativeRuns });
  return { ok: true, creativeRuns };
}

async function updateCreativeJudgmentAction(message) {
  const state = await readState();
  const located = findCreativeOutput(state.creativeRuns, message.runId, message.visualId);
  if (!located) return { ok: false, message: "没有找到这项创作结果" };
  const run = updateCreativeJudgment(located.run, located.output.visual.id, message.judgment);
  const creativeRuns = replaceCreativeRun(state.creativeRuns, run);
  await commitLocalChanges({ [STORAGE_KEYS.creativeRuns]: creativeRuns });
  const judgment = run.outputs.find((item) => item.visual.id === located.output.visual.id)?.judgment ?? null;
  return {
    ok: true,
    message: judgment ? "本次人工判断已保存" : "本次人工判断已清空",
    creativeRuns,
    judgment
  };
}

async function deleteCreativeOutput(message) {
  const state = await readState();
  const located = findCreativeOutput(state.creativeRuns, message.runId, message.visualId);
  if (!located) return { ok: false, message: "没有找到这张创作结果" };
  const run = removeCreativeOutput(located.run, located.output.visual.id);
  const creativeRuns = replaceCreativeRun(state.creativeRuns, run);
  const usedByCase = state.entries.some((entry) =>
    entryMediaAssets(entry).some((visual) => visual.id === located.output.visual.id)
  );
  if (located.output.visual.kind === "video") {
    await commitLocalChanges({ [STORAGE_KEYS.creativeRuns]: creativeRuns });
    if (!usedByCase) await deleteMediaBlob(located.output.visual.id);
    return { ok: true, message: "生成结果已移除", creativeRuns };
  }
  await commitMetadataThenDeleteImages({
    imageIds: usedByCase ? [] : [located.output.visual.id],
    deleteImage: deleteScreenshotBlob,
    commitMetadata: () => commitLocalChanges({ [STORAGE_KEYS.creativeRuns]: creativeRuns })
  });
  return { ok: true, message: "生成结果已移除", creativeRuns };
}

async function analyzeCreativeOutput(runId, visualId) {
  if (visionAnalysisInFlight) return { ok: false, message: "已有一张图片正在分析，请等待完成" };
  visionAnalysisInFlight = true;
  try {
    const state = await readState();
    if (!state.creativeExperimentSettings.enabled) {
      return { ok: false, message: "请先在分析设置中开启“创作实验（高级）”" };
    }
    const located = findCreativeOutput(state.creativeRuns, runId, visualId);
    if (!located) return { ok: false, message: "没有找到这张创作结果" };
    const blob = await getScreenshotBlob(located.output.visual.id);
    if (!blob) return { ok: false, message: "没有读取到这张生成结果" };
    const fingerprint = await imageFingerprint(blob);
    const privateSettings = resolveVisionTaskSettings("imageAnalysis", await loadAiConfiguration());
    const result = await evaluateCreativeOutputWithVision({
      imageDataUrl: await blobToDataUrl(blob),
      locale: located.run.outputLanguage === "en" ? "en" : "zh-CN",
      settings: privateSettings,
      target: creativeEvaluationTarget(located.run)
    });
    return enqueue(async () => {
      const latest = await readState();
      const current = findCreativeOutput(latest.creativeRuns, runId, visualId);
      const currentBlob = await getScreenshotBlob(visualId);
      if (!current || !currentBlob || await imageFingerprint(currentBlob) !== fingerprint) {
        return { ok: false, message: "分析期间结果图片已经变化，本次对照没有写入" };
      }
      const run = applyCreativeEvaluation(current.run, visualId, {
        ...result,
        resultFingerprint: fingerprint,
        analyzedAt: new Date().toISOString()
      });
      const creativeRuns = replaceCreativeRun(latest.creativeRuns, run);
      await commitLocalChanges({ [STORAGE_KEYS.creativeRuns]: creativeRuns });
      return { ok: true, message: "视觉对照已完成", creativeRuns, evaluation: run.outputs.find((item) => item.visual.id === visualId)?.evaluation };
    });
  } catch (error) {
    return { ok: false, message: userMessage(error) };
  } finally {
    visionAnalysisInFlight = false;
  }
}

function activeCreativePromptSummary(context, sessions) {
  if (!context) return null;
  const session = sessions.find((item) => item.id === context.sessionId);
  const version = session?.promptVersions.find((item) => item.id === context.promptVersionId);
  if (!session || !version || session.targetType !== "image") return null;
  return {
    sessionId: session.id,
    promptVersionId: version.id,
    title: version.title || session.title,
    targetPlatform: session.targetPlatform
  };
}

function findCreativeOutput(runsValue, runIdValue, visualIdValue) {
  const run = normalizeCreativeRuns(runsValue).find((item) => item.id === String(runIdValue ?? "").trim());
  const output = run?.outputs.find((item) => item.visual.id === String(visualIdValue ?? "").trim());
  return run && output ? { run, output } : null;
}

function replaceCreativeRun(runsValue, run) {
  return normalizeCreativeRuns([run, ...normalizeCreativeRuns(runsValue).filter((item) => item.id !== run.id)]);
}

function creativeEvaluationTarget(run) {
  return {
    targetType: run.targetType,
    targetPlatform: run.targetPlatform || "通用",
    userRequest: run.briefSnapshot.filter((item) => item.role === "user").map((item) => item.content).join("\n"),
    finalPrompt: run.promptText,
    executionInstruction: run.executionInstruction
  };
}

async function updateClassification(message) {
  const state = await readState();
  if (!isValidContentPath(state.taxonomy, message.pathIds)) {
    return { ok: false, message: "内容分类路径无效" };
  }
  const current = findEntry(state, message.entryId);
  const recovery = await recoverPaletteAfterClassification(confirmClassification(current, message.pathIds, state.taxonomy));
  const updated = touchEntry(recovery.entry);
  const entries = state.entries.map((entry) => entry.id === current.id ? updated : entry);
  let classificationRules = state.classificationRules;
  if (message.rememberSource) {
    const rule = createSourceRule(current.url, message.pathIds, state.taxonomy);
    classificationRules = [
      ...state.classificationRules.filter((item) => item.hostname !== rule.hostname),
      rule
    ];
  }
  await commitLocalChanges({
    [STORAGE_KEYS.entries]: entries,
    [STORAGE_KEYS.classificationRules]: classificationRules
  });
  const confirmationMessage = message.rememberSource ? "分类已确认，并记住此来源" : "内容分类已确认";
  return {
    ok: true,
    message: [confirmationMessage, recovery.paletteMessage].filter(Boolean).join("，"),
    entry: updated,
    classificationRules
  };
}

async function recoverPaletteAfterClassification(entry) {
  const visual = primaryVisual(entry);
  if (!visual || visual.palette?.colors?.length) {
    return { entry };
  }
  try {
    await ensureOffscreenDocument();
    const result = await chrome.runtime.sendMessage({
      target: "offscreen", type: "ANALYZE_STORED_SCREENSHOT", entryId: visual.id
    });
    if (result?.ok && result.palette?.colors?.length) {
      return { entry: updateEntryVisual(entry, visual.id, (item) => ({ ...item, palette: result.palette })), paletteMessage: "色卡已从本地主图恢复" };
    }
    return { entry, paletteMessage: "本地截图暂时无法恢复色卡" };
  } catch {
    return { entry, paletteMessage: "本地截图暂时无法恢复色卡" };
  }
}

async function updateContentTypeName(message) {
  const state = await readState();
  const taxonomy = updateContentType(state.taxonomy, message.contentId, { name: message.name });
  await commitLocalChanges({ [STORAGE_KEYS.taxonomy]: taxonomy });
  return { ok: true, message: "内容类型显示名已更新，历史案例会同步显示新名称", taxonomy };
}

async function createLibraryContentType(message) {
  const state = await readState();
  const taxonomy = createContentType(state.taxonomy, {
    id: `content:${crypto.randomUUID()}`,
    name: message.name,
    role: message.role
  });
  await commitLocalChanges({ [STORAGE_KEYS.taxonomy]: taxonomy });
  return { ok: true, message: "内容类型已创建", taxonomy };
}

async function updateLibraryContentType(message) {
  const state = await readState();
  const taxonomy = updateContentType(state.taxonomy, message.contentId, {
    name: message.name,
    role: message.role
  });
  await commitLocalChanges({ [STORAGE_KEYS.taxonomy]: taxonomy });
  return { ok: true, message: "内容类型已更新，历史案例会继续使用这个分类", taxonomy };
}

async function updateLibraryContentTypeVisibility(message) {
  const state = await readState();
  const visibility = message.visibility === CONTENT_TYPE_VISIBILITY.categoryOnly
    ? CONTENT_TYPE_VISIBILITY.categoryOnly
    : CONTENT_TYPE_VISIBILITY.library;
  const taxonomy = updateContentType(state.taxonomy, message.contentId, { visibility });
  await commitLocalChanges({ [STORAGE_KEYS.taxonomy]: taxonomy });
  return {
    ok: true,
    message: visibility === CONTENT_TYPE_VISIBILITY.categoryOnly
      ? "这个内容类型现在仅在分类内显示"
      : "这个内容类型现在会显示在资料库中",
    taxonomy
  };
}

async function deleteLibraryContentType(message) {
  const state = await readState();
  const transferred = removeContentTypeWithTransfer(state, message.contentId, message.replacementId);
  await commitLocalChanges({
    [STORAGE_KEYS.entries]: transferred.entries,
    [STORAGE_KEYS.classificationRules]: transferred.classificationRules,
    [STORAGE_KEYS.taxonomy]: transferred.taxonomy
  });
  return {
    ok: true,
    message: transferred.movedCount
      ? `内容类型已删除，${transferred.movedCount} 条案例已转移`
      : "内容类型已删除",
    entries: transferred.entries,
    classificationRules: transferred.classificationRules,
    taxonomy: transferred.taxonomy
  };
}

async function createFacetTag(message) {
  const state = await readState();
  const before = domainState(state);
  const facetCatalog = createFacetNode(state.facetCatalog, {
    facetId: message.facetId,
    parentId: message.parentId || null,
    name: message.name,
    aliases: message.aliases,
    patterns: message.patterns
  });
  const next = { ...before, facetCatalog };
  await persistDomainState(next, before, { entriesChanged: false });
  return { ok: true, message: "创作标签已创建", facetCatalog, canUndoFacetUpdate: true };
}

async function applyDetailTagOrganization(message) {
  const state = await readState();
  const before = domainState(state);
  const applied = applyDetailOrganizationMappings(before, message.mappings);
  const changedIds = userVisibleEntryChanges(before.entries, applied.state.entries);
  const nextState = { ...applied.state, entries: touchEntries(applied.state.entries, changedIds) };
  await persistDomainState(nextState, before);
  return {
    ok: true,
    message: `已整理 ${applied.changedCount} 个三级标签，其中合并 ${applied.mergedCount} 个；旧名称仍可搜索`,
    ...publicDomainState(nextState),
    canUndoFacetUpdate: true
  };
}

async function updateAiProviderConfiguration(message = {}) {
  const current = await loadAiConfiguration();
  const registry = mergeAiProviderRegistry(current.registry, message.registry);
  for (const [taskId, assignment] of Object.entries(message.assignments ?? {})) {
    const requested = Number(assignment?.concurrency);
    const limit = modelConcurrencyLimit(assignment?.providerId, assignment?.model, registry);
    if (Number.isInteger(requested) && Number.isInteger(limit) && requested > limit) {
      throw new Error(`${taskId} 的并发数 ${requested} 超过所选模型官方上限 ${limit}`);
    }
  }
  const assignments = normalizeAiTaskAssignments(message.assignments ?? current.assignments, registry);
  const configuration = {
    registry,
    assignments,
    preferences: normalizeAiPreferences(message.preferences ?? current.preferences)
  };
  await persistAiConfiguration(configuration);
  return aiConfigurationResponse(configuration, "AI 服务与七项默认任务已统一保存");
}

async function verifyAiImageGenerationCredential(message = {}) {
  const providerId = String(message.providerId ?? "").trim();
  const configuration = providerId ? await loadAiConfiguration() : null;
  const profile = configuration?.registry?.providers?.[providerId];
  const endpoint = String(message.endpoint ?? profile?.imageGeneration?.endpoint ?? "").trim();
  const apiKey = String(message.apiKey ?? "").trim() || String(profile?.imageGeneration?.apiKey ?? "").trim();
  const model = String(message.model ?? profile?.models?.imageGeneration ?? profile?.imageGeneration?.model ?? "").trim();
  if (!endpoint || !apiKey || !model) throw new Error("图片生成 Key 校验缺少接口、Key 或模型");
  const result = await aiProviderModule.verifyModelAccess({
    id: "custom-media-image-credential-check",
    endpoint,
    apiKey,
    protocol: "images_generations"
  }, model);
  if (!result.available) {
    throw new Error(`当前保存的图片生成 API Key 的模型列表中没有 ${model}。米醋生图必须使用 vip_2_image（Image2）分组 Key；本次设置更改未保存，也没有发起生图请求。`);
  }
  return {
    ok: true,
    model,
    verification: result.verification,
    executionVerified: result.executionVerified,
    message: `模型目录中可见 ${model}；这只证明目录可见，不代表米醋已授权该 Key 进入生图分组`
  };
}

async function discoverAiProviderModels(providerIdValue, force = false) {
  const providerId = String(providerIdValue ?? "").trim();
  const configuration = await loadAiConfiguration();
  const profile = configuration.registry.providers[providerId];
  if (!profile) throw new Error("没有找到要刷新的 AI 厂商");
  if (!profile.endpoint || !profile.apiKey) throw new Error(`${profile.label} 需要先保存接口地址和 API Key`);
  let result;
  try {
    result = await aiProviderModule.discoverModels({
      ...profile,
      models: {
        ...profile.models,
        ...assignedModelsForProvider(configuration.assignments, providerId)
      }
    }, {
      etag: force ? "" : profile.discovery?.etag
    });
  } catch (error) {
    const visibleError = discoveryErrorMessage(error, profile.apiKey);
    await enqueue(async () => {
      const current = await loadAiConfiguration();
      const currentProfile = current.registry.providers[providerId];
      if (!sameProviderConnection(currentProfile, profile)) return;
      const registry = mergeAiProviderRegistry(current.registry, { providers: {
        [providerId]: {
          discovery: { ...currentProfile.discovery, error: visibleError }
        }
      } });
      await persistAiConfiguration({ ...current, registry });
    });
    throw new Error(visibleError, { cause: error });
  }
  return enqueue(async () => {
    const current = await loadAiConfiguration();
    const currentProfile = current.registry.providers[providerId];
    if (!sameProviderConnection(currentProfile, profile)) {
      throw new Error(`${profile.label} 的连接已在模型读取期间变更，请重新刷新`);
    }
    const registry = mergeAiProviderRegistry(current.registry, { providers: {
      [providerId]: {
        discoveredModels: result.models,
        discovery: {
          discoveredAt: result.discoveredAt,
          source: result.source,
          etag: result.cache?.etag,
          cacheControl: result.cache?.cacheControl,
          error: ""
        }
      }
    } });
    const next = { ...current, registry };
    await persistAiConfiguration(next);
    return aiConfigurationResponse(next, `${profile.label} 已发现 ${result.models.length} 个模型`);
  });
}

function assignedModelsForProvider(assignments = {}, providerId = "") {
  return Object.fromEntries(Object.entries(assignments).flatMap(([taskId, assignment]) =>
    assignment?.providerId === providerId && assignment.model ? [[taskId, assignment.model]] : []
  ));
}

function sameProviderConnection(current, requested) {
  return Boolean(current
    && current.endpoint === requested.endpoint
    && current.protocol === requested.protocol
    && current.apiKey === requested.apiKey);
}

function discoveryErrorMessage(error, apiKey) {
  const message = userMessage(error);
  const secret = String(apiKey ?? "").trim();
  return secret ? message.split(secret).join("[已隐藏 API Key]") : message;
}

async function loadAiConfiguration() {
  const stored = await chrome.storage.local.get([
    STORAGE_KEYS.aiProviderRegistry, STORAGE_KEYS.aiTaskAssignments, STORAGE_KEYS.aiPreferences
  ]);
  return aiConfigurationFromStorage(stored);
}

async function persistAiConfiguration(configuration) {
  await commitLocalChanges({
    [STORAGE_KEYS.aiProviderRegistry]: configuration.registry,
    [STORAGE_KEYS.aiTaskAssignments]: configuration.assignments,
    [STORAGE_KEYS.aiPreferences]: configuration.preferences
  });
}

function aiConfigurationResponse(configuration, message) {
  const runtime = projectAiRuntime(configuration);
  return {
    ok: true,
    message,
    aiProviderRegistry: publicAiProviderRegistry(configuration.registry),
    aiTaskAssignments: configuration.assignments,
    aiSettings: publicAiSettings(runtime.aiSettings),
    visionSettings: publicVisionSettings(runtime.visionSettings),
    aiServiceProfiles: publicAiServiceProfiles(runtime.aiServiceProfiles)
  };
}

async function getAiTaskRuntime(taskIdValue, allowUnconfigured = false, assignmentOverride = null) {
  const taskId = canonicalAiTaskId(taskIdValue);
  const storedConfiguration = await loadAiConfiguration();
  const requestedProviderId = String(assignmentOverride?.providerId ?? "").trim();
  const requestedModel = String(assignmentOverride?.model ?? "").trim();
  const configuration = requestedProviderId || requestedModel ? {
    ...storedConfiguration,
    assignments: normalizeAiTaskAssignments({
      ...storedConfiguration.assignments,
      [taskId]: {
        providerId: requestedProviderId || storedConfiguration.assignments[taskId]?.providerId,
        model: requestedModel || storedConfiguration.assignments[taskId]?.model,
        concurrency: assignmentOverride?.concurrency ?? storedConfiguration.assignments[taskId]?.concurrency
      }
    }, storedConfiguration.registry)
  } : storedConfiguration;
  const assignment = configuration.assignments[taskId];
  const providerLabel = configuration.registry.providers[assignment?.providerId]?.label || assignment?.providerId;
  const common = {
    ok: true,
    aiRuntimeProtocolVersion: AI_RUNTIME_PROTOCOL_VERSION,
    taskId,
    assignment,
    providerLabel,
    runtimeDescriptor: aiTaskRuntimeDescriptor(taskId, configuration),
    availableProviders: aiTaskProviderOptions(taskId, configuration)
  };
  if (["textTags", "skillExtraction", "creativePlanning"].includes(taskId)) {
    return { ...common, aiSettings: resolveTextTaskSettings(taskId, configuration, { requireConfigured: !allowUnconfigured }) };
  }
  if (["imageAnalysis", "imageGeneration"].includes(taskId)) {
    return { ...common, visionSettings: resolveVisionTaskSettings(taskId, configuration, { requireConfigured: !allowUnconfigured }) };
  }
  if (taskId === "videoAnalysis") {
    if (allowUnconfigured && !assignment?.providerId) return { ...common, videoAnalysis: null };
    return { ...common, videoAnalysis: resolveVideoAnalysisTask(configuration) };
  }
  if (taskId === "videoGeneration") return { ...common, runtime: projectAiRuntime(configuration) };
  throw new Error("未知 AI 任务");
}

function aiTaskProviderOptions(taskId, configuration) {
  return availableAiProvidersForTask(taskId, configuration.registry).filter((provider) =>
    configuration.registry.providers[provider.id]?.consent === true
  ).map((provider) => {
    const profile = configuration.registry.providers[provider.id];
    const models = [...new Set([
      profile?.models?.[taskId],
      ...availableAiModelsForTask(taskId, profile).map((model) => model.id)
    ].filter(Boolean))];
    return { id: provider.id, label: provider.label, models };
  });
}

function aiTaskRuntimeDescriptor(taskId, configuration) {
  const assignment = configuration.assignments[taskId] ?? {};
  const profile = configuration.registry.providers[assignment.providerId] ?? {};
  const model = (profile.discoveredModels ?? []).find((item) => item.id === assignment.model);
  let endpointOrigin = "";
  try { endpointOrigin = new URL(profile.endpoint).origin; } catch {}
  const imageSupport = model?.inputModalities?.includes("image")
    ? true
    : model?.inputModalities?.length ? false : taskId === "imageAnalysis" ? null : false;
  return {
    providerId: assignment.providerId || "",
    providerLabel: profile.label || assignment.providerId || "",
    model: assignment.model || "",
    endpointOrigin,
    capabilities: {
      text: true,
      image: imageSupport,
      imageSource: model?.confidence || "unknown",
      maxImages: Number.isInteger(model?.referenceImages?.maxItems) ? model.referenceImages.maxItems : null
    }
  };
}

async function getComposerAiRuntime() {
  const configuration = await loadAiConfiguration();
  const runtime = projectAiRuntime(configuration);
  return {
    ok: true,
    aiRuntimeProtocolVersion: AI_RUNTIME_PROTOCOL_VERSION,
    ...runtime
  };
}

function canonicalAiTaskId(value) {
  const map = {
    "text-tags": "textTags", "skill-extraction": "skillExtraction", "creative-planning": "creativePlanning",
    "image-analysis": "imageAnalysis", "video-analysis": "videoAnalysis",
    "image-generation": "imageGeneration", "video-generation": "videoGeneration"
  };
  const id = String(value ?? "").trim();
  return map[id] || id;
}

async function analyzeEntryImage(entryId, visualIdValue, outputLocale, batchJobIdValue = "", bypassCache = false, assignmentOverride = null, priority = "user_batch") {
    const state = await readState();
    const entry = findEntry(state, entryId);
    const visualId = String(visualIdValue ?? "").trim() || primaryVisual(entry)?.id;
    const visual = normalizeEntryVisuals(entry).visuals.find((item) => item.id === visualId);
    if (!visual) return { ok: false, message: "这条案例没有可分析的截图" };
    const blob = await getVisionImageBlob(visual.id);
    if (!blob) return { ok: false, message: "没有读取到这条案例的截图" };
    const loadedConfiguration = await loadAiConfiguration();
    const configuration = configurationForAssignment(loadedConfiguration, "imageAnalysis", assignmentOverride);
    const locale = outputLocale === "en" ? "en" : "zh-CN";
    const { result, fingerprint } = await analyzeVisionBlobWithScheduler({
      blob,
      catalog: state.facetCatalog,
      locale,
      measuredCanvas: { width: visual.width, height: visual.height },
      configuration,
      previousAnalysis: visual.visionAnalysis,
      entries: state.entries,
      bypassCache,
      priority
    });

    return await enqueue(async () => {
      const currentState = await readState();
      const current = findEntry(currentState, entry.id);
      const currentVisual = normalizeEntryVisuals(current).visuals.find((item) => item.id === visual.id);
      const currentBlob = await getVisionImageBlob(visual.id);
      if (!currentVisual || !currentBlob || await imageFingerprint(currentBlob) !== fingerprint) {
        return { ok: false, message: "分析期间截图已经变化，本次结果没有写入，请重新分析" };
      }
      const analysisState = domainState(currentState);
      analysisState.entries = analysisState.entries.map((item) => item.id === current.id
        ? { ...item, visionAnalysis: currentVisual?.visionAnalysis }
        : item);
      const applied = applyVisionAnalysis(analysisState, current.id, result, {
        version: VISION_ANALYSIS_VERSION,
        visualId: visual.id,
        imageFingerprint: fingerprint,
        profileFingerprint: result.profileFingerprint,
        catalogRevision: state.facetCatalog.revision,
        locale: outputLocale,
        providerType: result.providerType,
        model: result.model,
        usage: result.usage,
        cacheHit: result.cacheHit,
        attempts: result.attempts,
        batchJobId: String(batchJobIdValue ?? "").trim()
      });
      const analyzed = applied.state.entries.find((item) => item.id === current.id);
      const visionAnalysis = analyzed.visionAnalysis;
      delete analyzed.visionAnalysis;
      const normalized = updateEntryVisual(analyzed, visual.id, (item) => ({
        ...item,
        contentHash: fingerprint,
        visionAnalysis
      }));
      applied.state.entries = applied.state.entries.map((item) => item.id === current.id ? normalized : item);
      const undoStore = {
        ...((await chrome.storage.local.get(STORAGE_KEYS.visionAnalysisUndo))[STORAGE_KEYS.visionAnalysisUndo] ?? {})
      };
      undoStore[current.id] = applied.undo;
      await commitLocalChanges({
        ...storagePayload(applied.state),
        [STORAGE_KEYS.visionAnalysisUndo]: undoStore
      });
      return {
        ok: true,
        message: result.tagDiagnostics?.rejectedCount
          ? `画面分析已保存，并写入 ${applied.appliedCount} 个检索标签；另有 ${result.tagDiagnostics.rejectedCount} 个不符合当前分类体系的可选标签未采用`
          : `画面分析已保存，并写入 ${applied.appliedCount} 个检索标签`,
        entry: applied.state.entries.find((item) => item.id === current.id),
        usage: result.usage,
        cacheHit: result.cacheHit,
        attempts: result.attempts,
        quality: "complete",
        ...publicDomainState(applied.state),
        visionUndoEntryIds: Object.keys(undoStore)
      };
    });
}

function configurationForAssignment(configuration, taskId, assignmentOverride) {
  const providerId = String(assignmentOverride?.providerId ?? "").trim();
  const model = String(assignmentOverride?.model ?? "").trim();
  if (!providerId && !model) return configuration;
  return {
    ...configuration,
    assignments: normalizeAiTaskAssignments({
      ...configuration.assignments,
      [taskId]: {
        ...configuration.assignments[taskId],
        providerId: providerId || configuration.assignments[taskId]?.providerId,
        model: model || configuration.assignments[taskId]?.model,
        concurrency: assignmentOverride?.concurrency ?? configuration.assignments[taskId]?.concurrency
      }
    }, configuration.registry)
  };
}

async function analyzeVisionBlobWithScheduler({ blob, catalog, locale, measuredCanvas, configuration, previousAnalysis, entries = [], bypassCache = false, priority = "user_batch" }) {
  const fingerprint = await imageFingerprint(blob);
  const assignment = configuration.assignments.imageAnalysis;
  const settings = resolveVisionTaskSettings("imageAnalysis", configuration);
  const profileFingerprint = await visionAnalysisProfileFingerprint(settings, locale);
  const cached = findPersistedVisionAnalysis(entries, {
    fingerprint,
    profileFingerprint,
    locale,
    catalogRevision: catalog?.revision
  });
  if (!bypassCache && cached?.quality === "complete") return {
    fingerprint,
    result: {
      ...cached,
      cacheHit: true,
      attempts: { serviceRequests: 0, outputCorrectionRequests: 0 },
      usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 }
    }
  };
  const schedulerKey = `${assignment.providerId}:${assignment.model}:imageAnalysis`;
  const requestMode = bypassCache ? "reanalyze" : "analyze";
  const requestKey = `${schedulerKey}:${fingerprint}:${profileFingerprint}:${locale}:${catalog?.revision ?? 0}:${requestMode}`;
  const requestBudget = createVisionRequestBudget();
  let coalesced = false;
  let result;
  try {
    result = await coalesceAnalysisRequest(requestKey, () => runScheduledAnalysisWithRetries({
      key: schedulerKey,
      concurrency: assignment.concurrency,
      priority,
      task: async () => {
        return analyzeImageWithVision({
          imageDataUrl: await blobToDataUrl(blob),
          catalog,
          locale,
          measuredCanvas,
          previousAnalysis: null,
          settings,
          requestBudget
        });
      }
    }), { onCoalesced: () => { coalesced = true; } });
  } catch (error) {
    error.attempts = {
      serviceRequests: coalesced ? 0 : visionPrimaryRequestCount(requestBudget),
      outputCorrectionRequests: coalesced ? 0 : requestBudget.outputCorrectionRequests
    };
    throw error;
  }
  return {
    result: {
      ...result,
      cacheHit: result.cacheHit === true || coalesced,
      attempts: {
        serviceRequests: coalesced ? 0 : visionPrimaryRequestCount(requestBudget),
        outputCorrectionRequests: coalesced ? 0 : requestBudget.outputCorrectionRequests
      }
    },
    fingerprint
  };
}

function visionPrimaryRequestCount(requestBudget) {
  return Math.max(
    0,
    (Number(requestBudget?.providerCalls) || 0) - (Number(requestBudget?.outputCorrectionRequests) || 0)
  );
}

async function analyzeEntryVisualSet(message) {
  const state = await readState();
  const current = normalizeEntryMedia(findEntry(state, message.entryId));
  const locale = message.outputLocale === "en" ? "en" : "zh-CN";
  const selectedIds = new Set((Array.isArray(message.assetIds) ? message.assetIds : []).map((id) => String(id ?? "").trim()).filter(Boolean));
  const assets = current.mediaAssets.filter((asset) => asset.kind === "image" && asset.usage !== "poster" && (!selectedIds.size || selectedIds.has(asset.id)));
  const prepared = prepareVisualSetSummary(assets.map((asset) => ({
    assetId: asset.id,
    imageFingerprint: asset.contentHash,
    analysis: asset.visionAnalysis
  })), locale);
  if (!prepared.ready) return {
    ok: false,
    code: "missing_individual_analysis",
    missingAssetIds: prepared.missingAssetIds,
    message: `还有 ${prepared.missingAssetIds.length} 张图片缺少有效的独立分析，请先完成逐图分析`
  };
  const configuration = await loadAiConfiguration();
  const result = await summarizeVisualSetWithAi(prepared.input, resolveTextTaskSettings("creativePlanning", configuration), {
    instruction: compileVisualSetSummaryInstruction(locale)
  });
  const summary = normalizeVisualSetSummaryV1(result.value, assets.map((asset) => asset.id));
  const analysis = {
    id: `visual-set:${crypto.randomUUID()}`,
    ...summary,
    text: summary.reusablePrompt,
    mode: String(message.mode || "group"),
    batchIndex: Math.max(0, Number(message.batchIndex) || 0),
    batchCount: Math.max(1, Number(message.batchCount) || 1),
    provider: result.provider,
    model: result.model,
    usage: result.usage,
    createdAt: new Date().toISOString()
  };
  const updated = normalizeEntryMedia({ ...current, visualSetAnalyses: [...current.visualSetAnalyses, analysis] });
  const entries = state.entries.map((entry) => entry.id === current.id ? updated : entry);
  await commitLocalChanges({ [STORAGE_KEYS.entries]: entries });
  return { ok: true, message: "整组图片关系分析已保存", entry: updated, analysis };
}

async function analyzeEntryVideo(message) {
  requireVideoAnalysisConfirmation(message.singleConfirmation);
  const state = await readState();
  const entry = normalizeEntryMedia(findEntry(state, message.entryId));
  const assetId = String(message.assetId ?? "").trim() || entry.primaryMediaId;
  const asset = entry.mediaAssets.find((item) => item.id === assetId && item.kind === "video" && item.usage !== "poster");
  if (!asset) return { ok: false, message: "没有找到要分析的视频" };
  const route = resolveVideoAnalysisTask(await loadAiConfiguration());
  const videoBlob = asset.storageMode === "managed" ? await getMediaBlob(asset.id) : null;
  if (asset.storageMode === "managed" && !videoBlob) return { ok: false, message: "本地视频文件缺失，无法分析" };
  const sourceUrl = asset.reference?.url || asset.sourceUrl;
  const analyzeVideo = VIDEO_ANALYSIS_ADAPTERS[route.protocol];
  if (!analyzeVideo) throw new Error(`${route.provider} 的视频理解请求协议当前版本尚未适配`);
  const analysis = await analyzeVideo({
    apiKey: route.apiKey,
    endpoint: route.endpoint,
    providerLabel: route.providerLabel,
    model: route.model,
    mode: message.mode,
    customQuestion: message.customQuestion,
    videoBlob,
    youtubeUrl: sourceUrl,
    onStage: (phase) => chrome.runtime.sendMessage({
      type: "VIDEO_ANALYSIS_CHANGED", entryId: entry.id, assetId: asset.id, phase,
      provider: route.provider, model: route.model
    }).catch(() => undefined)
  });
  return await enqueue(async () => {
    const currentState = await readState();
    const current = normalizeEntryMedia(findEntry(currentState, entry.id));
    if (!current.mediaAssets.some((item) => item.id === asset.id)) {
      return { ok: false, message: "分析期间视频已被移除，本次结果没有写入" };
    }
    const record = {
      id: `video-analysis:${crypto.randomUUID()}`,
      assetId: asset.id,
      text: analysis.text,
      mode: String(message.mode || "creative-breakdown"),
      prompt: analysis.prompt,
      sourceKind: analysis.sourceKind,
      provider: analysis.provider,
      model: analysis.model,
      usage: analysis.usage,
      cost: analysis.cost ?? null,
      routing: analysis.routing ?? null,
      version: 1,
      createdAt: new Date().toISOString()
    };
    const updated = normalizeEntryMedia({ ...current, videoAnalyses: [...current.videoAnalyses, record] });
    await commitLocalChanges({
      [STORAGE_KEYS.entries]: currentState.entries.map((item) => item.id === current.id ? updated : item)
    });
    return { ok: true, message: "视频分析已保存为新版本", entry: updated, analysis: record };
  });
}

async function updateVisionReconstructionPrompt(entryId, visualIdValue, reconstructionPrompt) {
  const state = await readState();
  const current = findEntry(state, entryId);
  const visualId = String(visualIdValue ?? "").trim() || primaryVisual(current)?.id;
  const visual = normalizeEntryVisuals(current).visuals.find((item) => item.id === visualId);
  if (!visual?.visionAnalysis) throw new Error("这张截图还没有可编辑的反推提示词");
  const temporary = editVisionReconstructionPrompt({ visionAnalysis: visual.visionAnalysis }, reconstructionPrompt);
  const updated = updateEntryVisual(current, visual.id, (item) => ({ ...item, visionAnalysis: temporary.visionAnalysis }));
  const entries = state.entries.map((entry) => entry.id === current.id ? updated : entry);
  await commitLocalChanges({ [STORAGE_KEYS.entries]: entries });
  return { ok: true, message: "反推提示词已保存", entry: updated, entries };
}

async function updateEntryMediaPromptAction(message) {
  const state = await readState();
  const current = findEntry(state, message.entryId);
  const next = setEntryMediaPrompt(current, message.assetId, message.text, "manual");
  const updated = userVisibleEntryEqual(current, next) ? next : touchEntry(next);
  const entries = state.entries.map((entry) => entry.id === current.id ? updated : entry);
  await commitLocalChanges({ [STORAGE_KEYS.entries]: entries });
  return {
    ok: true,
    message: String(message.text ?? "").trim() ? "这张图片的独立提示词已保存" : "已恢复使用案例共享提示词",
    entry: updated
  };
}

async function applyEntryMediaPromptSuggestions(message) {
  const state = await readState();
  const current = findEntry(state, message.entryId);
  const suggestions = Array.isArray(message.suggestions) ? message.suggestions : [];
  let updated = current;
  let appliedCount = 0;
  for (const item of suggestions) {
    const text = String(item?.text ?? "").trim();
    if (!text) continue;
    updated = setEntryMediaPrompt(updated, item.assetId, text, "ai-suggestion");
    appliedCount += 1;
  }
  if (!appliedCount) return { ok: false, message: "没有需要保存的逐图提示词" };
  updated = touchEntry(updated);
  const entries = state.entries.map((entry) => entry.id === current.id ? updated : entry);
  await commitLocalChanges({ [STORAGE_KEYS.entries]: entries });
  return { ok: true, message: `已确认并保存 ${appliedCount} 条逐图提示词`, entry: updated };
}

async function undoEntryVisionAnalysis(entryId) {
  const state = await readState();
  const stored = await chrome.storage.local.get(STORAGE_KEYS.visionAnalysisUndo);
  const undoStore = { ...(stored[STORAGE_KEYS.visionAnalysisUndo] ?? {}) };
  const undo = undoStore[entryId];
  if (!undo) return { ok: false, message: "这条案例没有可撤回的图片分析" };
  const current = findEntry(state, entryId);
  const visualId = String(undo.visualId ?? "").trim() || primaryVisual(current)?.id;
  const visual = normalizeEntryVisuals(current).visuals.find((item) => item.id === visualId);
  const temporaryState = domainState(state);
  temporaryState.entries = temporaryState.entries.map((entry) => entry.id === entryId
    ? { ...entry, visionAnalysis: visual?.visionAnalysis }
    : entry);
  const next = undoVisionAnalysis(temporaryState, undo);
  const undoneEntry = next.entries.find((entry) => entry.id === entryId);
  const restoredVision = undoneEntry.visionAnalysis;
  delete undoneEntry.visionAnalysis;
  const normalized = updateEntryVisual(undoneEntry, visualId, (item) => {
    const updated = { ...item };
    if (restoredVision) updated.visionAnalysis = restoredVision;
    else delete updated.visionAnalysis;
    return updated;
  });
  next.entries = next.entries.map((entry) => entry.id === entryId ? normalized : entry);
  delete undoStore[entryId];
  await commitLocalChanges({
    ...storagePayload(next),
    [STORAGE_KEYS.visionAnalysisUndo]: undoStore
  });
  return {
    ok: true,
    message: "已撤回本次图片分析",
    entry: next.entries.find((item) => item.id === entryId),
    ...publicDomainState(next),
    visionUndoEntryIds: Object.keys(undoStore)
  };
}

async function updateEntryFacet(message) {
  const state = await readState();
  const current = findEntry(state, message.entryId);
  const node = state.facetCatalog.nodes.find((item) => item.id === message.nodeId && item.status === "active");
  if (!node || node.facetId !== message.facetId) return { ok: false, message: "创作标签无效" };
  const next = setManualAssignment(current, node.facetId, node.id, message.selected !== false);
  const updated = userVisibleEntryEqual(current, next) ? next : touchEntry(next);
  const entries = state.entries.map((entry) => entry.id === current.id ? updated : entry);
  await commitLocalChanges({ [STORAGE_KEYS.entries]: entries });
  return { ok: true, message: message.selected === false ? "标签已移除" : "创作标签已添加", entry: updated };
}

async function updateCaseText(message) {
  const state = await readState();
  const current = findEntry(state, message.entryId);
  const next = updateEntryText(current, message.text, message.textRevision);
  const updated = next.text === current.text ? next : touchEntry(next);
  const entries = state.entries.map((entry) => entry.id === current.id ? updated : entry);
  await commitLocalChanges({ [STORAGE_KEYS.entries]: entries });
  return {
    ok: true,
    message: updated.text === current.text ? "提示词没有变化" : "提示词已保存，需要时可重新分析标签",
    entry: updated
  };
}

async function updateCaseTitle(message) {
  const state = await readState();
  const current = findEntry(state, message.entryId);
  const title = String(message.title ?? "").replace(/[\u0000-\u001f\u007f]/g, "").trim();
  if (!title) return { ok: false, message: "案例标题不能为空" };
  const updated = title === current.title ? current : touchEntry({ ...current, title });
  const entries = state.entries.map((entry) => entry.id === current.id ? updated : entry);
  await commitLocalChanges({ [STORAGE_KEYS.entries]: entries });
  return { ok: true, message: title === current.title ? "标题没有变化" : "标题已保存", entry: updated };
}

async function updateEntryCustomLabels(message) {
  const state = await readState();
  const current = findEntry(state, message.entryId);
  const customLabels = uniqueNames(message.customLabels);
  const updated = stringListsEqual(customLabels, current.customLabels) ? current : touchEntry({ ...current, customLabels });
  const entries = state.entries.map((entry) => entry.id === current.id ? updated : entry);
  await commitLocalChanges({ [STORAGE_KEYS.entries]: entries });
  return { ok: true, message: "标签已保存", entry: updated, entries };
}

async function batchAddCustomLabels(message) {
  const state = await readState();
  const requested = new Set(uniqueNames(message.entryIds));
  const labels = uniqueNames(message.customLabels);
  if (!labels.length) return { ok: false, message: "请输入要添加的标签" };
  let updatedCount = 0;
  const updatedAt = new Date().toISOString();
  const entries = state.entries.map((entry) => {
    if (!requested.has(entry.id)) return entry;
    const customLabels = uniqueNames([...(entry.customLabels ?? []), ...labels]);
    if (stringListsEqual(customLabels, entry.customLabels)) return entry;
    updatedCount += 1;
    return touchEntry({ ...entry, customLabels }, updatedAt);
  });
  if (!updatedCount) return { ok: true, message: "所选案例已经包含这些标签", updatedCount: 0, entries };
  await commitLocalChanges({ [STORAGE_KEYS.entries]: entries });
  return { ok: true, message: `已为 ${updatedCount} 个案例添加标签`, updatedCount, entries };
}

async function batchSetProject(message) {
  const state = await readState();
  const validIds = new Set(state.entries.map((entry) => entry.id));
  const requestedEntryIds = uniqueNames(message.entryIds);
  const entryIds = requestedEntryIds.filter((entryId) => validIds.has(entryId));
  if (!entryIds.length) return { ok: false, message: "案例不存在，未更新项目关系" };
  const missingCount = requestedEntryIds.length - entryIds.length;
  const mode = ["remove", "move"].includes(message.mode) ? message.mode : "add";
  let organizerState = normalizeOrganizerState(state.organizerState, [...validIds]);
  if (!organizerState.collections.some((collection) => collection.id === String(message.collectionId ?? "").trim())) {
    return { ok: false, message: "项目不存在" };
  }
  const beforeOrganizer = organizerState;
  if (mode === "move") organizerState = removeEntriesFromOrganizer(organizerState, entryIds);
  organizerState = setEntriesCollection(organizerState, message.collectionId, entryIds, mode !== "remove");
  const changedEntryIds = changedProjectEntryIds(beforeOrganizer, organizerState);
  const updatedCount = changedEntryIds.length;
  const skippedCount = Math.max(0, requestedEntryIds.length - updatedCount);
  const unchangedCount = Math.max(0, entryIds.length - updatedCount);
  if (!updatedCount) {
    return {
      ok: true,
      message: `${mode === "remove" ? "所选案例原本不在这个项目中" : "所选案例已经在这个项目中"}${missingCount ? `；${missingCount} 个案例不存在` : ""}`,
      updatedCount,
      skippedCount,
      unchangedCount,
      missingCount,
      entries: state.entries,
      organizerState: beforeOrganizer
    };
  }
  const entries = touchEntries(state.entries, changedEntryIds);
  await commitLocalChanges({
    ...(changedEntryIds.length ? { [STORAGE_KEYS.entries]: entries } : {}),
    [STORAGE_KEYS.organizerState]: organizerState
  });
  return {
    ok: true,
    message: mode === "move"
      ? `已将 ${updatedCount} 个案例移动到项目`
      : mode === "remove"
        ? `已将 ${updatedCount} 个案例移出项目${unchangedCount ? `，${unchangedCount} 个原本不在该项目` : ""}${missingCount ? `；${missingCount} 个案例不存在` : ""}`
        : `已将 ${updatedCount} 个案例加入项目${unchangedCount ? `，${unchangedCount} 个已经在该项目` : ""}${missingCount ? `；${missingCount} 个案例不存在` : ""}`,
    updatedCount,
    skippedCount,
    unchangedCount,
    missingCount,
    entries,
    organizerState
  };
}

async function updateOrganizer(message) {
  const state = await readState();
  let organizerState = normalizeOrganizerState(state.organizerState, state.entries.map((entry) => entry.id));
  const beforeOrganizer = organizerState;
  let trashState = normalizeTrashState(state.trashState);
  let created = null;
  if (message.type === "CREATE_COLLECTION") {
    const result = createCollection(organizerState, message.name, message.parentId);
    organizerState = result.state;
    created = result.item;
  } else if (message.type === "RENAME_COLLECTION") {
    organizerState = renameCollection(organizerState, message.collectionId, message.name);
  } else if (message.type === "DELETE_COLLECTION") {
    const moved = moveCollectionsToTrash({ organizerState, trashState }, [message.collectionId]);
    if (!moved.movedItemIds.length) throw new Error("项目不存在");
    organizerState = normalizeOrganizerState(moved.organizerState, state.entries.map((entry) => entry.id));
    trashState = moved.trashState;
  } else if (message.type === "REORDER_COLLECTIONS") {
    organizerState = reorderCollections(organizerState, message.collectionIds);
  } else if (message.type === "MOVE_COLLECTION") {
    organizerState = moveCollection(organizerState, message.collectionId, message.parentId, message.index);
  } else if (message.type === "REPLACE_COLLECTION_ENTRIES") {
    const validIds = new Set(state.entries.map((entry) => entry.id));
    const entryIds = (Array.isArray(message.entryIds) ? message.entryIds : []).filter((id) => validIds.has(id));
    organizerState = replaceCollectionEntries(organizerState, message.collectionId, entryIds);
  } else if (message.type === "SET_COLLECTION_VISIBILITY") {
    organizerState = setCollectionVisibility(organizerState, message.collectionId, message.visibility);
  }
  const changedEntryIds = changedProjectEntryIds(beforeOrganizer, organizerState);
  const entries = touchEntries(state.entries, changedEntryIds);
  await commitLocalChanges({
    ...(changedEntryIds.length ? { [STORAGE_KEYS.entries]: entries } : {}),
    [STORAGE_KEYS.organizerState]: organizerState,
    ...(message.type === "DELETE_COLLECTION" ? { [STORAGE_KEYS.trashState]: trashState } : {})
  });
  return { ok: true, message: organizerMessage(message.type), entries, organizerState, trashState, created };
}

function organizerMessage(type) {
  return ({
    CREATE_COLLECTION: "项目已创建",
    RENAME_COLLECTION: "项目名称已保存",
    DELETE_COLLECTION: "项目已移入回收站，案例仍保留在资料库",
    REORDER_COLLECTIONS: "项目顺序已保存",
    MOVE_COLLECTION: "项目结构已保存",
    REPLACE_COLLECTION_ENTRIES: "项目案例已更新",
    SET_COLLECTION_VISIBILITY: "项目显示范围已更新"
  })[type] || "项目已更新";
}

async function decideAnalysisCandidate(message, accepted) {
  const state = await readState();
  const current = findEntry(state, message.entryId);
  if (accepted) {
    const next = acceptAnalysisCandidate(domainState(state), current.id, message.candidateId, message.edits);
    await persistDomainState(next, domainState(state));
    return { ok: true, message: "候选已确认，并归入可编辑词库", ...publicDomainState(next), canUndoFacetUpdate: true };
  }
  const updated = rejectAnalysisCandidate(current, message.candidateId);
  const entries = state.entries.map((entry) => entry.id === current.id ? updated : entry);
  await commitLocalChanges({ [STORAGE_KEYS.entries]: entries });
  return { ok: true, message: "候选已拒绝，同一候选不会重复出现", entry: updated };
}

async function applyEntryAnalysisResult(message) {
  const state = await readState();
  const entry = findEntry(state, message.entryId);
  const input = canonicalTextAnalysisInput(entry, message.assetId);
  if (message.textRevision && message.textRevision !== input.textRevision) {
    return { ok: false, message: "提示词原文已变化，本次分析结果没有写入" };
  }
  const currentFingerprint = await textFingerprint(input.text);
  if (message.fingerprint && message.fingerprint !== currentFingerprint) {
    return { ok: false, message: "提示词原文已变化，本次分析结果没有写入" };
  }
  const fingerprint = currentFingerprint;
  const applied = applyTextAnalysisTags(domainState(state), entry.id, message.tags);
  const updated = applied.state.entries.find((item) => item.id === entry.id);
  updated.analysisPending = false;
  updated.analyzedAt = new Date().toISOString();
  updated.analysisMeta = analysisMeta(message, fingerprint, updated.analyzedAt, updated);
  await persistDomainState(applied.state, domainState(state));
  return {
    ok: true,
    message: analysisResultMessage(applied),
    entry: updated,
    ...publicDomainState(applied.state),
    canUndoFacetUpdate: true
  };
}

async function previewDeepSeekBatch(outputLocale, mode = "incremental") {
  const state = await readState();
  const stored = await chrome.storage.local.get([
    STORAGE_KEYS.batchJob,
    STORAGE_KEYS.analysisRebuildStaging
  ]);
  const previous = normalizeAnalysisBatchJob(stored[STORAGE_KEYS.batchJob]);
  const previousSummary = analysisBatchSummary(previous);
  if (previous?.mode === "rebuild" && previousSummary?.counts.failed && !previous.partialApplied) {
    const recovery = analysisRebuildRecovery(previous, stored[STORAGE_KEYS.analysisRebuildStaging]);
    return {
      ok: false,
      message: recovery.recoverable
        ? `已有 ${recovery.stagedResultCount} 条重建结果安全暂存，请先继续完成剩余 ${previousSummary.counts.failed} 条`
        : "旧重建任务的暂存结果不完整，已阻止创建新的付费任务"
    };
  }
  const settings = resolveTextTaskSettings("textTags", await loadAiConfiguration(), { requireConfigured: false });
  const locale = outputLocale === "en" ? "en" : "zh-CN";
  const profileFingerprint = await analysisProfileFingerprint(settings, locale);
  const preview = await previewAnalysisBatch(state.entries, {
    analysisModel: settings.activeProvider === "compatible" ? settings.compatible.model : settings.analysisModel,
    profileFingerprint,
    mode,
    fixedTaxonomyCharacters: analysisTaxonomyPrompt(state.facetCatalog, locale).length
  });
  return { ok: true, message: "批量分析预览已生成", preview };
}

async function createDeepSeekBatch(outputLocale, mode = "incremental") {
  const state = await readState();
  const stored = await chrome.storage.local.get([
    STORAGE_KEYS.batchJob,
    STORAGE_KEYS.analysisRebuildStaging
  ]);
  const configuration = await loadAiConfiguration();
  const settings = resolveTextTaskSettings("textTags", configuration);
  if (!publicAiSettings(settings).configured) return { ok: false, message: "请先完成所选 AI 服务配置" };
  if (!settings.consent) return { ok: false, message: "请先确认：主动分析时会发送案例文字到所选 AI 服务" };
  const previous = normalizeAnalysisBatchJob(stored[STORAGE_KEYS.batchJob]);
  const previousSummary = analysisBatchSummary(previous);
  if (previous?.mode === "rebuild" && previousSummary?.counts.failed && !previous.partialApplied) {
    const recovery = analysisRebuildRecovery(previous, stored[STORAGE_KEYS.analysisRebuildStaging]);
    return {
      ok: false,
      message: recovery.recoverable
        ? `已有 ${recovery.stagedResultCount} 条重建结果安全暂存，请先继续完成剩余 ${previousSummary.counts.failed} 条`
        : "旧重建任务的暂存结果不完整，已阻止创建新的付费任务"
    };
  }
  if (previous && ["running", "paused"].includes(previous.status) &&
      previous.items.some((item) => ["pending", "running"].includes(item.status))) {
    return { ok: false, message: "已有未完成的批量任务，请继续或取消后再新建" };
  }
  const locale = outputLocale === "en" ? "en" : "zh-CN";
  const profileFingerprint = await analysisProfileFingerprint(settings, locale);
  const job = await createAnalysisBatchJob(state.entries, {
    analysisModel: settings.activeProvider === "compatible" ? settings.compatible.model : settings.analysisModel,
    outputLocale: locale,
    profileFingerprint,
    mode,
    catalogRevision: state.facetCatalog.revision,
    fixedTaxonomyCharacters: analysisTaxonomyPrompt(state.facetCatalog, locale).length,
    concurrency: configuration.assignments.textTags.concurrency,
    providerId: configuration.assignments.textTags.providerId,
    outputProtocol: "json_object"
  });
  const changes = { [STORAGE_KEYS.batchJob]: job };
  if (job.mode === "rebuild") {
    changes[STORAGE_KEYS.analysisRebuildStaging] = { version: 1, jobId: job.id, results: {} };
  } else {
    changes[STORAGE_KEYS.analysisBatchUndo] = createAnalysisBatchUndo(job, state);
  }
  await commitLocalChanges(changes);
  await ensureAnalysisBatchAlarm(true);
  scheduleAnalysisBatchRunner();
  return { ok: true, message: `已创建 ${job.items.length} 条批量分析任务`, analysisBatchJob: analysisBatchSummary(job) };
}

async function claimDeepSeekBatchItems(jobId) {
  const stored = await chrome.storage.local.get(STORAGE_KEYS.batchJob);
  const current = requireAnalysisBatch(stored[STORAGE_KEYS.batchJob], jobId, "text_tags");
  const claimed = claimAnalysisItems(current);
  if (claimed.claims.length) {
    await commitLocalChanges({ [STORAGE_KEYS.batchJob]: claimed.job });
  }
  return {
    ok: true,
    claims: claimed.claims,
    analysisBatchJob: analysisBatchSummary(claimed.job)
  };
}

async function getDeepSeekBatchStatus(jobId) {
  const stored = await chrome.storage.local.get(STORAGE_KEYS.batchJob);
  const job = requireAnalysisBatch(stored[STORAGE_KEYS.batchJob], jobId, "text_tags");
  return { ok: true, analysisBatchJob: analysisBatchSummary(job) };
}

async function commitDeepSeekBatchItem(message) {
  const stored = await chrome.storage.local.get([
    STORAGE_KEYS.batchJob,
    STORAGE_KEYS.analysisRebuildStaging
  ]);
  const job = requireAnalysisBatch(stored[STORAGE_KEYS.batchJob], message.jobId, "text_tags");
  requireClaim(job, message.entryId, message.claimId);
  if (message.error) {
    const failed = failAnalysisItem(job, message.entryId, message.claimId, message.error);
    await commitLocalChanges({ [STORAGE_KEYS.batchJob]: failed });
    return {
      ok: true,
      message: "已记录失败项",
      analysisBatchJob: analysisBatchSummary(failed)
    };
  }
  const state = await readState();
  const entry = findEntry(state, message.entryId);
  if (canonicalTextAnalysisInput(entry, message.assetId).textRevision !== Math.max(1, Number(message.textRevision) || 1)) {
    return failDeepSeekBatchItem({
      ...message,
      error: { message: "提示词原文已变化，请重新预览", status: 409 }
    });
  }
  const expectedRevision = job.resultCatalogRevision ?? job.catalogRevision;
  if (state.facetCatalog.revision !== expectedRevision) {
    const failed = failAnalysisItem(job, message.entryId, message.claimId, {
      message: "创作词库已在其他页面修改，请暂停后重新分析",
      status: 409
    });
    const paused = pauseAnalysisBatch(failed);
    await commitLocalChanges({ [STORAGE_KEYS.batchJob]: paused });
    return { ok: false, message: "创作词库已变化，批量任务已暂停", analysisBatchJob: analysisBatchSummary(paused) };
  }
  if (job.mode === "rebuild") {
    return commitStagedRebuildResults(job, stored[STORAGE_KEYS.analysisRebuildStaging], state, [message]);
  }
  const applied = applyTextAnalysisTags(domainState(state), entry.id, message.tags);
  const updated = applied.state.entries.find((item) => item.id === entry.id);
  updated.analysisPending = false;
  updated.analyzedAt = new Date().toISOString();
  updated.analysisMeta = analysisMeta({ ...message, profileFingerprint: job.profileFingerprint }, message.fingerprint, updated.analyzedAt, updated);
  const nextJob = succeedAnalysisItem(
    job,
    message.entryId,
    message.claimId,
    message.usage,
    applied.state.facetCatalog.revision,
    message
  );
  await commitLocalChanges({
    ...storagePayload(applied.state),
    [STORAGE_KEYS.batchJob]: nextJob
  });
  return {
    ok: true,
    message: analysisResultMessage(applied),
    analysisBatchJob: analysisBatchSummary(nextJob)
  };
}

async function commitDeepSeekBatchItems(message) {
  const results = Array.isArray(message.results) ? message.results : [];
  if (!results.length) return { ok: false, message: "批量分析结果为空" };
  const stored = await chrome.storage.local.get([
    STORAGE_KEYS.batchJob,
    STORAGE_KEYS.analysisRebuildStaging
  ]);
  let job = requireAnalysisBatch(stored[STORAGE_KEYS.batchJob], message.jobId, "text_tags");
  const state = await readState();
  const expectedRevision = job.resultCatalogRevision ?? job.catalogRevision;
  if (state.facetCatalog.revision !== expectedRevision) {
    const paused = pauseAnalysisBatch(job);
    await commitLocalChanges({ [STORAGE_KEYS.batchJob]: paused });
    return { ok: false, message: "创作词库已变化，批量任务已暂停", analysisBatchJob: analysisBatchSummary(paused) };
  }
  if (job.mode === "rebuild") {
    return commitStagedRebuildResults(job, stored[STORAGE_KEYS.analysisRebuildStaging], state, results);
  }
  let working = domainState(state);
  for (const result of results) {
    requireClaim(job, result.entryId, result.claimId);
    if (result.error) {
      job = failAnalysisItem(job, result.entryId, result.claimId, result.error);
      continue;
    }
    const entry = working.entries.find((item) => item.id === result.entryId);
    if (!entry || canonicalTextAnalysisInput(entry, result.assetId).textRevision !== Math.max(1, Number(result.textRevision) || 1)) {
      job = failAnalysisItem(job, result.entryId, result.claimId, {
        message: "提示词原文已变化，请重新预览",
        status: 409
      });
      continue;
    }
    const applied = applyTextAnalysisTags(working, entry.id, result.tags);
    working = applied.state;
    const updated = working.entries.find((item) => item.id === entry.id);
    updated.analysisPending = false;
    updated.analyzedAt = new Date().toISOString();
    updated.analysisMeta = analysisMeta({
      ...result,
      profileFingerprint: job.profileFingerprint
    }, result.fingerprint, updated.analyzedAt, updated);
    job = succeedAnalysisItem(job, result.entryId, result.claimId, result.usage, working.facetCatalog.revision, result);
  }
  await commitLocalChanges({
    ...storagePayload(working),
    [STORAGE_KEYS.batchJob]: job
  });
  return {
    ok: true,
    facetCatalog: working.facetCatalog,
    analysisBatchJob: analysisBatchSummary(job)
  };
}

async function commitStagedRebuildResults(jobValue, stagingValue, state, results) {
  const stagedResult = stageAnalysisRebuildResults(jobValue, stagingValue, state, results);
  let { job } = stagedResult;
  const { staging } = stagedResult;
  const summary = analysisBatchSummary(job);
  if (summary.status !== "completed" || summary.counts.failed) {
    await commitLocalChanges({
      [STORAGE_KEYS.batchJob]: job,
      [STORAGE_KEYS.analysisRebuildStaging]: staging
    });
    return { ok: true, analysisBatchJob: summary };
  }

  const finalized = finalizeAnalysisRebuild(job, staging, domainState(state));
  const working = finalized.state;
  job = finalized.job;
  const undo = createAnalysisBatchUndo(job, state);
  await commitLocalChanges({
    ...storagePayload(working),
    [STORAGE_KEYS.batchJob]: job,
    [STORAGE_KEYS.analysisBatchUndo]: undo,
    [STORAGE_KEYS.analysisRebuildStaging]: { version: 1, jobId: job.id, committed: true, results: {} }
  });
  await chrome.storage.local.remove(STORAGE_KEYS.analysisRebuildStaging);
  return {
    ok: true,
    message: "全部案例已成功，固定标签树已原子切换",
    facetCatalog: working.facetCatalog,
    analysisBatchJob: analysisBatchSummary(job)
  };
}

async function failDeepSeekBatchItem(message) {
  const stored = await chrome.storage.local.get(STORAGE_KEYS.batchJob);
  const job = requireAnalysisBatch(stored[STORAGE_KEYS.batchJob], message.jobId, "text_tags");
  requireClaim(job, message.entryId, message.claimId);
  const failed = failAnalysisItem(job, message.entryId, message.claimId, message.error);
  await commitLocalChanges({ [STORAGE_KEYS.batchJob]: failed });
  return { ok: true, message: "已记录失败项", analysisBatchJob: analysisBatchSummary(failed) };
}

async function updateDeepSeekBatch(action, jobId) {
  const stored = await chrome.storage.local.get([
    STORAGE_KEYS.batchJob,
    STORAGE_KEYS.analysisRebuildStaging
  ]);
  const current = requireAnalysisBatch(stored[STORAGE_KEYS.batchJob], jobId, "text_tags");
  if (action === "retry" && current.mode === "rebuild") {
    const recovery = analysisRebuildRecovery(current, stored[STORAGE_KEYS.analysisRebuildStaging]);
    if (!recovery.recoverable) {
      return { ok: false, message: "重建暂存结果不完整，已阻止重复付费；正式标签库保持不变" };
    }
  }
  const actions = {
    pause: pauseAnalysisBatch,
    resume: resumeAnalysisBatch,
    cancel: cancelAnalysisBatch,
    retry: retryFailedAnalysisItems
  };
  const next = actions[action](current);
  await commitLocalChanges({ [STORAGE_KEYS.batchJob]: next });
  if (next.status === "running") {
    await ensureAnalysisBatchAlarm(true);
    scheduleAnalysisBatchRunner();
  } else {
    await ensureAnalysisBatchAlarm(false);
  }
  if (action === "cancel" && current.mode === "rebuild") {
    await chrome.storage.local.remove(STORAGE_KEYS.analysisRebuildStaging);
  }
  const messages = {
    pause: "批量分析已暂停",
    resume: "批量分析已继续",
    cancel: "批量分析已取消",
    retry: current.mode === "rebuild" ? "仅剩余失败项已重新加入队列，已有暂存结果继续保留" : "失败项已重新加入队列"
  };
  return { ok: true, message: messages[action], analysisBatchJob: analysisBatchSummary(next) };
}

async function applyStagedAnalysisRebuild(jobId) {
  const stored = await chrome.storage.local.get([
    STORAGE_KEYS.batchJob,
    STORAGE_KEYS.analysisRebuildStaging
  ]);
  const job = requireAnalysisBatch(stored[STORAGE_KEYS.batchJob], jobId, "text_tags");
  const recovery = analysisRebuildRecovery(job, stored[STORAGE_KEYS.analysisRebuildStaging]);
  if (!recovery.recoverable) {
    return { ok: false, message: "没有可安全应用的重建缓存，正式标签库保持不变" };
  }
  const state = await readState();
  const expectedRevision = job.resultCatalogRevision ?? job.catalogRevision;
  if (state.facetCatalog.revision !== expectedRevision) {
    return { ok: false, message: "创作词库已在重建后修改，不能安全应用旧缓存" };
  }
  const staleCount = job.items.filter((item) => {
    if (item.status !== "succeeded") return false;
    const entry = state.entries.find((candidate) => candidate.id === item.entryId);
    return !entry || canonicalTextAnalysisInput(entry, item.assetId).textRevision !== item.textRevision;
  }).length;
  if (staleCount) {
    return { ok: false, message: `${staleCount} 条成功案例的原文已变化，不能安全应用旧缓存` };
  }
  const finalized = finalizePartialAnalysisRebuild(
    job,
    stored[STORAGE_KEYS.analysisRebuildStaging],
    domainState(state)
  );
  const undo = createAnalysisBatchUndo(job, state);
  await commitLocalChanges({
    ...storagePayload(finalized.state),
    [STORAGE_KEYS.batchJob]: finalized.job,
    [STORAGE_KEYS.analysisBatchUndo]: undo,
    [STORAGE_KEYS.analysisRebuildStaging]: { version: 1, jobId: job.id, committed: true, results: {} }
  });
  await chrome.storage.local.remove(STORAGE_KEYS.analysisRebuildStaging);
  const failedCount = analysisBatchSummary(job).counts.failed;
  return {
    ok: true,
    message: `已应用 ${recovery.stagedResultCount} 条成功结果，${failedCount} 条失败案例已转为待分析`,
    facetCatalog: finalized.state.facetCatalog,
    analysisBatchJob: analysisBatchSummary(finalized.job),
    canUndoAnalysisBatch: true
  };
}

async function recoverDeepSeekBatch() {
  const stored = await chrome.storage.local.get(STORAGE_KEYS.batchJob);
  const job = normalizeAnalysisBatchJob(stored[STORAGE_KEYS.batchJob]);
  if (!job || !job.items.some((item) => item.status === "running")) {
    return { ok: true, analysisBatchJob: analysisBatchSummary(job) };
  }
  const recovered = recoverInterruptedAnalysisBatch(job);
  await commitLocalChanges({ [STORAGE_KEYS.batchJob]: recovered });
  if (recovered.status === "running") {
    await ensureAnalysisBatchAlarm(true);
    scheduleAnalysisBatchRunner();
  }
  return { ok: true, message: "已从上次中断处继续", analysisBatchJob: analysisBatchSummary(recovered) };
}

async function undoDeepSeekBatch(jobId) {
  const stored = await chrome.storage.local.get([
    STORAGE_KEYS.batchJob,
    STORAGE_KEYS.analysisBatchUndo
  ]);
  const job = requireAnalysisBatch(stored[STORAGE_KEYS.batchJob], jobId, "text_tags");
  const undo = stored[STORAGE_KEYS.analysisBatchUndo];
  if (!undo || undo.jobId !== job.id) return { ok: false, message: "没有这次批量分析的撤回快照" };
  const state = await readState();
  const expectedRevision = job.resultCatalogRevision ?? job.catalogRevision;
  if (state.facetCatalog.revision !== expectedRevision) {
    return { ok: false, message: "创作词库已在批量分析后继续修改，不能安全自动撤回" };
  }
  const restored = restoreAnalysisBatchUndo(domainState(state), undo);
  await commitLocalChanges(storagePayload(restored));
  await chrome.storage.local.remove([
    STORAGE_KEYS.batchJob,
    STORAGE_KEYS.analysisBatchUndo,
    STORAGE_KEYS.analysisRebuildStaging
  ]);
  return {
    ok: true,
    message: "已撤回本次批量分析，人工修改与案例原文保持不变",
    ...publicDomainState(restored),
    analysisBatchJob: null,
    canUndoAnalysisBatch: false
  };
}

async function previewVisionBatchTask(message) {
  const state = await readState();
  const configuration = await loadAiConfiguration();
  const settings = resolveVisionTaskSettings("imageAnalysis", configuration, { requireConfigured: false });
  const provider = settings[settings.activeProvider];
  const preview = previewVisionBatch(state.entries, {
    entryIds: message.entryIds,
    includeAllImages: message.includeAllImages,
    reanalyze: message.reanalyze,
    providerType: settings.activeProvider,
    model: provider.model
  });
  return { ok: true, preview };
}

async function createVisionBatchTask(message) {
  const state = await readState();
  const stored = await chrome.storage.local.get(STORAGE_KEYS.batchJob);
  const configuration = await loadAiConfiguration();
  const settings = resolveVisionTaskSettings("imageAnalysis", configuration, { requireConfigured: false });
  const provider = settings[settings.activeProvider];
  if (!provider.apiKey) return { ok: false, message: "请先保存当前图片服务的 API Key" };
  if (!settings.consent) return { ok: false, message: "请先确认主动分析时会发送当前截图" };
  const previous = normalizeAnalysisBatchJob(stored[STORAGE_KEYS.batchJob]);
  if (previous && ["running", "paused"].includes(previous.status) &&
      previous.items.some((item) => ["pending", "running"].includes(item.status))) {
    return { ok: false, message: "已有未完成的批量任务，请继续或取消后再新建" };
  }
  const job = createVisionBatchJob(state.entries, {
    entryIds: message.entryIds,
    includeAllImages: message.includeAllImages,
    reanalyze: message.reanalyze,
    providerType: settings.activeProvider,
    providerId: configuration.assignments.imageAnalysis.providerId,
    model: provider.model,
    outputProtocol: settings.activeProvider === "compatible" ? settings.compatible.structuredOutput : "json_schema",
    outputLocale: message.outputLocale,
    concurrency: configuration.assignments.imageAnalysis.concurrency
  });
  await commitLocalChanges({ [STORAGE_KEYS.batchJob]: job });
  await chrome.storage.local.remove(STORAGE_KEYS.analysisBatchUndo);
  await ensureAnalysisBatchAlarm(true);
  scheduleAnalysisBatchRunner();
  return {
    ok: true,
    message: `已创建 ${job.requestCount} 张图片分析任务`,
    visionBatchJob: analysisBatchSummary(job)
  };
}

async function claimVisionBatchItem(jobId) {
  const [state, stored] = await Promise.all([
    readState(),
    chrome.storage.local.get(STORAGE_KEYS.batchJob)
  ]);
  let job = requireAnalysisBatch(stored[STORAGE_KEYS.batchJob], jobId, "vision");
  const reconciled = reconcileVisionBatchResults(job, state.entries);
  job = reconciled.job;
  if (reconciled.recoveredCount) {
    await commitLocalChanges({ [STORAGE_KEYS.batchJob]: job });
  }
  const loadedConfiguration = await loadAiConfiguration();
  const configuration = configurationForAssignment(loadedConfiguration, "imageAnalysis", job);
  const settings = resolveVisionTaskSettings("imageAnalysis", configuration, { requireConfigured: false });
  const currentSettings = resolveVisionTaskSettings("imageAnalysis", loadedConfiguration, { requireConfigured: false });
  const currentModel = currentSettings.activeProvider === "openai" ? currentSettings.openai.model : currentSettings.compatible.model;
  const snapshotModel = settings.activeProvider === "openai" ? settings.openai.model : settings.compatible.model;
  if (job.providerType !== currentSettings.activeProvider || job.model !== currentModel || job.providerType !== settings.activeProvider || job.model !== snapshotModel) {
    const canceled = cancelAnalysisBatch(job);
    await commitLocalChanges({ [STORAGE_KEYS.batchJob]: canceled });
    return { ok: false, message: "图片分析设置已变化，旧批量任务已取消，请重新开始" };
  }
  const snapshotReady = publicVisionSettings(settings)[settings.activeProvider]?.configured === true;
  if (!snapshotReady || !settings.consent) {
    const paused = pauseAnalysisBatch(job);
    await commitLocalChanges({ [STORAGE_KEYS.batchJob]: paused });
    return { ok: false, message: "任务快照所用服务当前不可用，任务已暂停" };
  }
  const claimed = claimAnalysisItems(job);
  if (claimed.claims.length) {
    await commitLocalChanges({ [STORAGE_KEYS.batchJob]: claimed.job });
  }
  return {
    ok: true,
    claims: claimed.claims,
    claim: claimed.claims[0] ?? null,
    visionBatchJob: analysisBatchSummary(claimed.job)
  };
}

async function completeVisionBatchItem(message) {
  const stored = await chrome.storage.local.get(STORAGE_KEYS.batchJob);
  const job = requireAnalysisBatch(stored[STORAGE_KEYS.batchJob], message.jobId, "vision");
  requireClaim(job, message.entryId, message.claimId, message.visualId);
  const usage = {
    promptTokens: Math.max(0, Number(message.usage?.inputTokens) || 0),
    completionTokens: Math.max(0, Number(message.usage?.outputTokens) || 0),
    totalTokens: Math.max(0, Number(message.usage?.totalTokens) || 0),
    cacheHits: message.cacheHit === true ? 1 : 0
  };
  const next = succeedAnalysisItem(job, message.entryId, message.claimId, usage, undefined, message);
  await commitLocalChanges({ [STORAGE_KEYS.batchJob]: next });
  return { ok: true, visionBatchJob: analysisBatchSummary(next) };
}

async function failVisionBatchItem(message) {
  const stored = await chrome.storage.local.get(STORAGE_KEYS.batchJob);
  const job = requireAnalysisBatch(stored[STORAGE_KEYS.batchJob], message.jobId, "vision");
  requireClaim(job, message.entryId, message.claimId, message.visualId);
  const failed = failAnalysisItem(job, message.entryId, message.claimId, message.error);
  await commitLocalChanges({ [STORAGE_KEYS.batchJob]: failed });
  return { ok: true, visionBatchJob: analysisBatchSummary(failed) };
}

async function updateVisionBatch(action, jobId) {
  const stored = await chrome.storage.local.get(STORAGE_KEYS.batchJob);
  const current = requireAnalysisBatch(stored[STORAGE_KEYS.batchJob], jobId, "vision");
  const actions = {
    pause: pauseAnalysisBatch,
    resume: resumeAnalysisBatch,
    cancel: cancelAnalysisBatch,
    retry: retryFailedAnalysisItems
  };
  const next = actions[action](current);
  await commitLocalChanges({ [STORAGE_KEYS.batchJob]: next });
  if (next.status === "running") {
    await ensureAnalysisBatchAlarm(true);
    scheduleAnalysisBatchRunner();
  } else {
    await ensureAnalysisBatchAlarm(false);
  }
  return {
    ok: true,
    message: ({ pause: "批量画面分析已暂停", resume: "批量画面分析已继续", cancel: "批量画面分析已取消", retry: "失败图片已重新加入队列" })[action],
    visionBatchJob: analysisBatchSummary(next)
  };
}

function scheduleAnalysisBatchRunner() {
  if (analysisBatchRunnerActive || analysisBatchRunnerTimer) return;
  analysisBatchRunnerTimer = setTimeout(() => {
    analysisBatchRunnerTimer = 0;
    void runPersistedAnalysisBatch();
  }, 0);
}

async function runPersistedAnalysisBatch() {
  if (analysisBatchRunnerActive) return;
  analysisBatchRunnerActive = true;
  let continueRunning = false;
  try {
    const stored = await chrome.storage.local.get(STORAGE_KEYS.batchJob);
    const initial = normalizeAnalysisBatchJob(stored[STORAGE_KEYS.batchJob]);
    if (!initial || initial.status !== "running") {
      await ensureAnalysisBatchAlarm(false);
      return;
    }
    if (initial.kind === "vision") {
      continueRunning = await runPersistedVisionBatchSlice(initial.id);
    } else {
      continueRunning = await runPersistedTextBatchSlice(initial.id);
    }
    await ensureAnalysisBatchAlarm(continueRunning);
  } catch (error) {
    console.error("PromptDirector persisted analysis batch failed", error);
    const stored = await chrome.storage.local.get(STORAGE_KEYS.batchJob).catch(() => ({}));
    const current = normalizeAnalysisBatchJob(stored[STORAGE_KEYS.batchJob]);
    if (current?.status === "running") {
      const taskLabel = current.kind === "vision" ? "图片服务" : "文字服务";
      const failed = failUnfinishedAnalysisItems(current, {
        message: `任务启动失败：${taskLabel}配置或后台运行状态无效，请检查 AI 服务后重试`,
        status: 500
      });
      await commitLocalChanges({ [STORAGE_KEYS.batchJob]: failed });
    }
    await ensureAnalysisBatchAlarm(false);
    continueRunning = false;
  } finally {
    analysisBatchRunnerActive = false;
    if (continueRunning) scheduleAnalysisBatchRunner();
  }
}

async function runPersistedTextBatchSlice(jobId) {
  const configuration = await loadAiConfiguration();
  const prepared = await enqueue(async () => {
    const stored = await chrome.storage.local.get(STORAGE_KEYS.batchJob);
    let job = requireAnalysisBatch(stored[STORAGE_KEYS.batchJob], jobId, "text_tags");
    if (job.status !== "running") return { job, claims: [], settings: null };
    const snapshotConfiguration = configurationForAssignment(configuration, "textTags", job);
    let settings;
    try {
      settings = resolveTextTaskSettings("textTags", snapshotConfiguration);
    } catch (error) {
      job = pauseAnalysisBatch(job);
      await commitLocalChanges({ [STORAGE_KEYS.batchJob]: job });
      console.warn("PromptDirector text batch paused because its service snapshot is unavailable", userMessage(error));
      return { job, claims: [], settings: null };
    }
    const currentProfile = await analysisProfileFingerprint(settings, job.outputLocale);
    if (job.profileFingerprint && currentProfile !== job.profileFingerprint) {
      job = pauseAnalysisBatch(job);
      await commitLocalChanges({ [STORAGE_KEYS.batchJob]: job });
      return { job, claims: [], settings: null };
    }
    job = recoverInterruptedAnalysisBatch(job);
    const claimed = claimAnalysisItems(job);
    await commitLocalChanges({ [STORAGE_KEYS.batchJob]: claimed.job });
    return { job: claimed.job, claims: claimed.claims, settings };
  });
  if (!prepared.claims.length || !prepared.settings) return false;
  const state = await readState();
  const entryById = new Map(state.entries.map((entry) => [entry.id, entry]));
  const results = await Promise.all(prepared.claims.map((claim) => analyzePersistedTextClaim(
    prepared.job,
    claim,
    entryById.get(claim.entryId),
    state.facetCatalog,
    prepared.settings
  )));
  const committed = await enqueue(() => commitDeepSeekBatchItems({ jobId, results }));
  return committed.analysisBatchJob?.status === "running";
}

async function analyzePersistedTextClaim(job, claim, entry, catalog, settings) {
  if (!entry) return persistedTextFailure(claim, "案例已不存在", 404);
  const analysisInput = canonicalTextAnalysisInput(entry, claim.assetId);
  let serviceRequests = 0;
  try {
    const result = await runScheduledAnalysisWithRetries({
      key: `${job.providerId}:${job.model || job.analysisModel}:textTags`,
      concurrency: job.concurrency,
      task: async () => {
        serviceRequests += 1;
        return analyzeTextDetailedWithDeepSeek(entry, catalog, {
          ...settings,
          outputLocale: job.outputLocale
        }, fetch, { analysisInput });
      }
    });
    return {
      entryId: claim.entryId,
      claimId: claim.claimId,
      fingerprint: await textFingerprint(analysisInput.text),
      textRevision: claim.textRevision,
      assetId: analysisInput.assetId,
      tags: result.tags,
      normalizationDiagnostics: result.normalizationDiagnostics,
      attempts: {
        serviceRequests,
        outputCorrectionRequests: Number(result.attempts?.outputCorrectionRequests) || 0
      },
      usage: result.usage,
      model: result.model
    };
  } catch (error) {
    return persistedTextFailure(
      claim,
      userMessage(error),
      Number(error?.status) || 0,
      error?.usage,
      {
        serviceRequests,
        outputCorrectionRequests: Math.max(0, Number(error?.attempts?.outputCorrectionRequests) || 0)
      }
    );
  }
}

function persistedTextFailure(claim, message, status, usage, attempts) {
  return {
    entryId: claim.entryId,
    claimId: claim.claimId,
    textRevision: claim.textRevision,
    error: { message, status, usage, attempts }
  };
}

async function runPersistedVisionBatchSlice(jobId) {
  const configuration = await loadAiConfiguration();
  const prepared = await enqueue(async () => {
    const state = await readState();
    const stored = await chrome.storage.local.get(STORAGE_KEYS.batchJob);
    let job = requireAnalysisBatch(stored[STORAGE_KEYS.batchJob], jobId, "vision");
    if (job.status !== "running") return { job, claims: [] };
    job = reconcileVisionBatchResults(recoverInterruptedAnalysisBatch(job), state.entries).job;
    const snapshotConfiguration = configurationForAssignment(configuration, "imageAnalysis", job);
    const settings = resolveVisionTaskSettings("imageAnalysis", snapshotConfiguration, { requireConfigured: false });
    const currentSettings = resolveVisionTaskSettings("imageAnalysis", configuration, { requireConfigured: false });
    const currentModel = currentSettings.activeProvider === "openai" ? currentSettings.openai.model : currentSettings.compatible.model;
    const snapshotModel = settings.activeProvider === "openai" ? settings.openai.model : settings.compatible.model;
    if (job.providerType !== currentSettings.activeProvider || job.model !== currentModel || job.providerType !== settings.activeProvider || job.model !== snapshotModel) {
      job = cancelAnalysisBatch(job);
      await commitLocalChanges({ [STORAGE_KEYS.batchJob]: job });
      return { job, claims: [] };
    }
    const snapshotReady = publicVisionSettings(settings)[settings.activeProvider]?.configured === true;
    if (!snapshotReady || !settings.consent) {
      job = pauseAnalysisBatch(job);
      await commitLocalChanges({ [STORAGE_KEYS.batchJob]: job });
      return { job, claims: [] };
    }
    const claimed = claimAnalysisItems(job);
    await commitLocalChanges({ [STORAGE_KEYS.batchJob]: claimed.job });
    return { job: claimed.job, claims: claimed.claims };
  });
  if (!prepared.claims.length) return false;
  await Promise.all(prepared.claims.map(async (claim) => {
    let result;
    try {
      result = await analyzeEntryImage(
        claim.entryId,
        claim.visualId,
        prepared.job.outputLocale,
        prepared.job.id,
        prepared.job.reanalyze,
        prepared.job,
        "user_batch"
      );
    } catch (error) {
      result = {
        ok: false,
        message: userMessage(error),
        status: Number(error?.status) || 0,
        usage: error?.usage,
        attempts: error?.attempts
      };
    }
    await enqueue(() => result.ok
      ? completeVisionBatchItem({
          jobId,
          entryId: claim.entryId,
          visualId: claim.visualId,
          claimId: claim.claimId,
          usage: result.usage,
          cacheHit: result.cacheHit,
          attempts: result.attempts,
          quality: result.quality
        })
      : failVisionBatchItem({
          jobId,
          entryId: claim.entryId,
          visualId: claim.visualId,
          claimId: claim.claimId,
          error: {
            message: result.message,
            status: result.status,
            usage: result.usage,
            attempts: result.attempts
          }
        }));
  }));
  const stored = await chrome.storage.local.get(STORAGE_KEYS.batchJob);
  return normalizeAnalysisBatchJob(stored[STORAGE_KEYS.batchJob])?.status === "running";
}

async function ensureAnalysisBatchAlarm(running) {
  if (running) await chrome.alarms.create(ANALYSIS_BATCH_ALARM, { periodInMinutes: 1 });
  else await chrome.alarms.clear(ANALYSIS_BATCH_ALARM);
}

async function queueAutomaticVisionAnalysis(entryIdsValue, options = {}) {
  const entryIds = [...new Set((Array.isArray(entryIdsValue) ? entryIdsValue : []).map(String).filter(Boolean))];
  if (!entryIds.length) return false;
  const [state, stored] = await Promise.all([
    readState(),
    chrome.storage.local.get(STORAGE_KEYS.automaticVisionBatchJob)
  ]);
  const configuration = await loadAiConfiguration();
  const settings = resolveVisionTaskSettings("imageAnalysis", configuration, { requireConfigured: false });
  const publicSettings = publicVisionSettings(settings);
  if ((options.requireAutoImportSetting !== false && !settings.autoAnalyzeImports) ||
      !settings.consent || !publicSettings[settings.activeProvider].configured) return false;
  const provider = settings[settings.activeProvider];
  const job = buildAutomaticVisionJob(state.entries, entryIds, {
    providerType: settings.activeProvider,
    providerId: configuration.assignments.imageAnalysis.providerId,
    model: provider.model,
    outputProtocol: settings.activeProvider === "compatible" ? settings.compatible.structuredOutput : "json_schema",
    concurrency: configuration.assignments.imageAnalysis.concurrency,
    outputLocale: resolveLocale(state.uiPreferences, chrome.i18n.getUILanguage()) === "en" ? "en" : "zh-CN"
  }, stored[STORAGE_KEYS.automaticVisionBatchJob]);
  if (!job) return false;
  await commitLocalChanges({ [STORAGE_KEYS.automaticVisionBatchJob]: job });
  await ensureAutomaticVisionAlarm(true);
  scheduleAutomaticVisionRunner();
  return true;
}

function scheduleAutomaticVisionRunner() {
  if (automaticVisionRunnerActive || automaticVisionRunnerTimer) return;
  automaticVisionRunnerTimer = setTimeout(() => {
    automaticVisionRunnerTimer = 0;
    void runAutomaticVisionItem();
  }, 0);
}

async function runAutomaticVisionItem() {
  if (automaticVisionRunnerActive) return;
  automaticVisionRunnerActive = true;
  let continueRunning = false;
  try {
    const stored = await chrome.storage.local.get([
      STORAGE_KEYS.automaticVisionBatchJob
    ]);
    let job = normalizeAnalysisBatchJob(stored[STORAGE_KEYS.automaticVisionBatchJob]);
    if (!job || job.kind !== "vision" || job.status !== "running") {
      await ensureAutomaticVisionAlarm(false);
      return;
    }
    const loadedConfiguration = await loadAiConfiguration();
    const configuration = configurationForAssignment(loadedConfiguration, "imageAnalysis", job);
    const settings = resolveVisionTaskSettings("imageAnalysis", configuration, { requireConfigured: false });
    const configured = publicVisionSettings(settings)[settings.activeProvider].configured;
    if (!settings.autoAnalyzeImports || !settings.consent || !configured) {
      job = pauseAnalysisBatch(job);
      await commitLocalChanges({ [STORAGE_KEYS.automaticVisionBatchJob]: job });
      await ensureAutomaticVisionAlarm(false);
      return;
    }
    const state = await readState();
    job = recoverInterruptedAnalysisBatch(job);
    job = reconcileVisionBatchResults(job, state.entries).job;
    const claimed = claimAnalysisItems(job);
    job = claimed.job;
    await commitLocalChanges({ [STORAGE_KEYS.automaticVisionBatchJob]: job });
    if (!claimed.claims.length) {
      await ensureAutomaticVisionAlarm(false);
      return;
    }
    await Promise.all(claimed.claims.map(async (claim) => {
      let result;
      try {
        result = await analyzeEntryImage(claim.entryId, claim.visualId, job.outputLocale, job.id, false, job, "background_import");
      } catch (error) {
        result = { ok: false, message: userMessage(error), status: Number(error?.status) || 0, usage: error?.usage };
      }
      await enqueue(async () => {
        const latestStored = await chrome.storage.local.get(STORAGE_KEYS.automaticVisionBatchJob);
        const latest = requireAnalysisBatch(latestStored[STORAGE_KEYS.automaticVisionBatchJob], job.id, "vision");
        requireClaim(latest, claim.entryId, claim.claimId, claim.visualId);
        const next = result.ok
          ? succeedAnalysisItem(latest, claim.entryId, claim.claimId, {
              promptTokens: result.usage?.inputTokens,
              completionTokens: result.usage?.outputTokens,
              totalTokens: result.usage?.totalTokens,
              cacheHits: result.cacheHit === true ? 1 : 0
            }, undefined, result)
          : failAnalysisItem(latest, claim.entryId, claim.claimId, {
              message: result.message,
              status: result.status,
              usage: result.usage,
              attempts: result.attempts
            });
        await commitLocalChanges({ [STORAGE_KEYS.automaticVisionBatchJob]: next });
        job = next;
      });
    }));
    continueRunning = job.status === "running";
    await ensureAutomaticVisionAlarm(continueRunning);
  } catch (error) {
    console.error("PromptDirector automatic vision analysis failed", error);
    await ensureAutomaticVisionAlarm(true);
  } finally {
    automaticVisionRunnerActive = false;
    if (continueRunning) scheduleAutomaticVisionRunner();
  }
}

async function ensureAutomaticVisionAlarm(running) {
  if (running) await chrome.alarms.create(AUTOMATIC_VISION_ALARM, { periodInMinutes: 1 });
  else await chrome.alarms.clear(AUTOMATIC_VISION_ALARM);
}

async function getVisionImageBlob(visualId) {
  return await getMediaBlob(visualId) ?? await getScreenshotBlob(visualId);
}

async function importAnalysisCandidates(payload) {
  if (!payload || !Array.isArray(payload.entries)) return { ok: false, message: "候选文件格式无效" };
  const state = await readState();
  const applied = applyAnalysisImport(domainState(state), payload);
  if (!applied.matchedCount) return { ok: false, message: "分析文件与当前案例库没有匹配的案例 ID" };
  const matchedIds = new Set(applied.matchedEntryIds);
  const analyzedAt = new Date().toISOString();
  const importedEntries = applied.state.entries.map((entry) => matchedIds.has(entry.id)
    ? { ...entry, analysisPending: false, analyzedAt }
    : entry);
  const analysisBaseline = await backfillLegacyAnalysisMeta(importedEntries);
  const importedState = { ...applied.state, entries: analysisBaseline.entries };
  await persistDomainState(importedState, domainState(state));
  const unmatched = applied.unmatchedCount
    ? `；另有 ${applied.unmatchedCount} 条未包含在本次分析的案例已保留原文和截图、清除旧候选，等待下次分析`
    : "";
  return {
    ok: true,
    message: `已整理 ${applied.matchedCount} 条案例：自动写入 ${applied.confirmedCount} 个明确标签${applied.suggestedCount ? `，仅保留 ${applied.suggestedCount} 个非常不确定项` : "，没有待确认项"}${unmatched}`,
    ...publicDomainState(importedState),
    canUndoFacetUpdate: true
  };
}

async function visionUndoWithout(entryId) {
  const stored = await chrome.storage.local.get(STORAGE_KEYS.visionAnalysisUndo);
  const next = { ...(stored[STORAGE_KEYS.visionAnalysisUndo] ?? {}) };
  delete next[entryId];
  return next;
}

async function visionUndoWithoutEntries(entryIds) {
  const stored = await chrome.storage.local.get(STORAGE_KEYS.visionAnalysisUndo);
  const next = { ...(stored[STORAGE_KEYS.visionAnalysisUndo] ?? {}) };
  for (const entryId of entryIds) delete next[entryId];
  return next;
}

async function previewFacetUpdate(change) {
  const state = await readState();
  const preview = previewFacetChange(domainState(state), change);
  return { ok: true, message: "请确认本次词库更新", preview };
}

async function applyFacetUpdate(preview) {
  const state = await readState();
  const applied = applyFacetChange(domainState(state), preview);
  await persistDomainState(applied.state, applied.undo, {
    entriesChanged: preview?.change?.type === "merge"
  });
  return { ok: true, message: "创作词库已更新，历史案例已同步", ...publicDomainState(applied.state), canUndoFacetUpdate: true };
}

async function restoreFacetDimensions(facetIds) {
  const state = await readState();
  const before = domainState(state);
  const facetCatalog = restoreArchivedFacets(state.facetCatalog, facetIds);
  if (facetCatalog.revision === state.facetCatalog.revision) {
    return { ok: false, message: "没有找到可恢复的已归档维度" };
  }
  const next = { ...before, facetCatalog };
  await persistDomainState(next, before, { entriesChanged: false });
  return {
    ok: true,
    message: "已归档维度已恢复，原案例标签重新可见",
    ...publicDomainState(next),
    canUndoFacetUpdate: true
  };
}

async function restoreFacetTags(nodeIds) {
  const state = await readState();
  const before = domainState(state);
  const facetCatalog = restoreArchivedNodes(state.facetCatalog, nodeIds);
  if (facetCatalog.revision === state.facetCatalog.revision) {
    return { ok: false, message: "没有找到可恢复的已归档标签" };
  }
  const next = { ...before, facetCatalog };
  await persistDomainState(next, before, { entriesChanged: false });
  return {
    ok: true,
    message: "已归档标签已恢复，原案例标签重新可见",
    ...publicDomainState(next),
    canUndoFacetUpdate: true
  };
}

async function previewLibraryMaintenance() {
  const [state, derivedMetadata] = await Promise.all([readState(), getAllDerivedMetadata()]);
  const targets = libraryMaintenanceTargets(state.entries, derivedMetadata);
  return {
    ok: true,
    message: "资料补全检查完成",
    preview: {
      caseCount: targets.classificationEntryIds.length,
      confirmed: targets.classificationEntryIds.length,
      suggested: 0,
      paletteCount: targets.paletteAssetIds.length,
      total: targets.classificationEntryIds.length + targets.paletteAssetIds.length,
      cases: []
    }
  };
}

async function startLibraryMaintenance() {
  const [state, derivedMetadata, stored] = await Promise.all([
    readState(),
    getAllDerivedMetadata(),
    chrome.storage.local.get(STORAGE_KEYS.libraryMaintenanceJob)
  ]);
  const current = normalizeLibraryMaintenanceJob(stored[STORAGE_KEYS.libraryMaintenanceJob]);
  if (current && ["running", "paused"].includes(current.status) && libraryMaintenanceSummary(current).remaining) {
    return { ok: false, message: "已有未完成的资料补全任务，请继续或取消后再开始" };
  }
  const targets = libraryMaintenanceTargets(state.entries, derivedMetadata);
  const job = createLibraryMaintenanceJob(targets);
  await commitLocalChanges({ [STORAGE_KEYS.libraryMaintenanceJob]: job });
  await ensureLibraryMaintenanceAlarm(job.status === "running");
  scheduleLibraryMaintenanceRunner();
  return {
    ok: true,
    message: job.status === "completed" ? "当前资料已经完整" : `已开始后台补全 ${libraryMaintenanceSummary(job).total} 项资料`,
    maintenanceJob: libraryMaintenanceSummary(job)
  };
}

async function enqueueAutomaticLibraryMaintenance(entriesValue) {
  const [derivedMetadata, stored] = await Promise.all([
    getAllDerivedMetadata(),
    chrome.storage.local.get(STORAGE_KEYS.libraryMaintenanceJob)
  ]);
  const targets = libraryMaintenanceTargets(entriesValue, derivedMetadata);
  if (!targets.classificationEntryIds.length && !targets.paletteAssetIds.length) return null;
  const job = extendLibraryMaintenanceJob(stored[STORAGE_KEYS.libraryMaintenanceJob], targets);
  await commitLocalChanges({ [STORAGE_KEYS.libraryMaintenanceJob]: job });
  await ensureLibraryMaintenanceAlarm(job.status === "running");
  if (job.status === "running") scheduleLibraryMaintenanceRunner();
  return libraryMaintenanceSummary(job);
}

async function libraryMaintenanceStatus() {
  const stored = await chrome.storage.local.get(STORAGE_KEYS.libraryMaintenanceJob);
  return { ok: true, maintenanceJob: libraryMaintenanceSummary(stored[STORAGE_KEYS.libraryMaintenanceJob]) };
}

async function updateLibraryMaintenance(action) {
  const stored = await chrome.storage.local.get(STORAGE_KEYS.libraryMaintenanceJob);
  const current = normalizeLibraryMaintenanceJob(stored[STORAGE_KEYS.libraryMaintenanceJob]);
  if (!current) return { ok: false, message: "没有可用的资料补全任务" };
  const actions = {
    pause: pauseLibraryMaintenance,
    resume: resumeLibraryMaintenance,
    cancel: cancelLibraryMaintenance,
    retry: retryLibraryMaintenanceFailures
  };
  const next = actions[action](current);
  await commitLocalChanges({ [STORAGE_KEYS.libraryMaintenanceJob]: next });
  await ensureLibraryMaintenanceAlarm(next.status === "running");
  if (next.status === "running") scheduleLibraryMaintenanceRunner();
  const messages = {
    pause: "资料补全已暂停",
    resume: "资料补全已继续",
    cancel: "资料补全已取消",
    retry: "失败项已重新加入后台任务"
  };
  return { ok: true, message: messages[action], maintenanceJob: libraryMaintenanceSummary(next) };
}

function libraryMaintenanceTargets(entriesValue, derivedMetadata) {
  const metadata = derivedMetadata instanceof Map ? derivedMetadata : new Map();
  const classificationEntryIds = [];
  const paletteAssetIds = [];
  const seenAssets = new Set();
  for (const entry of Array.isArray(entriesValue) ? entriesValue : []) {
    if (entry.classification?.status === "needs_review") classificationEntryIds.push(entry.id);
    for (const asset of entryMediaAssets(entry)) {
      if (asset.kind !== "image" || asset.usage === "poster" || seenAssets.has(asset.id)) continue;
      seenAssets.add(asset.id);
      const cachedPalette = metadata.get(asset.id)?.palette;
      const inlineCurrent = asset.palette?.colors?.length && asset.palette.version === PALETTE_VERSION;
      const cachedCurrent = cachedPalette?.colors?.length && cachedPalette.version === PALETTE_VERSION;
      if (!inlineCurrent && !cachedCurrent) paletteAssetIds.push(asset.id);
    }
  }
  return { classificationEntryIds, paletteAssetIds };
}

function scheduleLibraryMaintenanceRunner() {
  if (maintenanceRunnerActive || maintenanceRunnerTimer) return;
  maintenanceRunnerTimer = setTimeout(() => {
    maintenanceRunnerTimer = 0;
    void runLibraryMaintenanceSlice();
  }, 0);
}

async function runLibraryMaintenanceSlice() {
  if (maintenanceRunnerActive) return;
  maintenanceRunnerActive = true;
  let continueRunning = false;
  try {
    const stored = await chrome.storage.local.get(STORAGE_KEYS.libraryMaintenanceJob);
    let job = normalizeLibraryMaintenanceJob(stored[STORAGE_KEYS.libraryMaintenanceJob]);
    if (!job || job.status !== "running") {
      await ensureLibraryMaintenanceAlarm(false);
      return;
    }
    job = await enqueue(() => completeMaintenanceClassifications(job));
    const started = performance.now();
    let processedInSlice = 0;
    while (job.status === "running" && nextLibraryMaintenanceItem(job)?.kind === "palette" &&
      (!processedInSlice || performance.now() - started < MAINTENANCE_SLICE_TARGET_MS)) {
      const item = nextLibraryMaintenanceItem(job);
      let result;
      try {
        const cached = await getDerivedMetadata(item.id);
        if (cached?.palette?.version === PALETTE_VERSION && cached.palette.colors?.length) result = { ok: true };
        else {
          await ensureOffscreenDocument();
          const analyzed = await chrome.runtime.sendMessage({
            target: "offscreen",
            type: "ANALYZE_STORED_SCREENSHOT",
            entryId: item.id
          });
          if (!analyzed?.ok || !analyzed.palette?.colors?.length) throw new Error(analyzed?.message || "无法生成色卡");
          const metadata = await saveDerivedMetadata(item.id, {
            ...cached,
            width: analyzed.width,
            height: analyzed.height,
            mimeType: analyzed.mimeType,
            byteSize: analyzed.byteSize,
            palette: analyzed.palette
          });
          void chrome.runtime.sendMessage({
            type: "LIBRARY_DERIVED_METADATA_UPDATED",
            assetId: item.id,
            metadata
          }).catch(() => undefined);
          result = { ok: true };
        }
      } catch (error) {
        result = { ok: false, message: userMessage(error) };
      }
      job = completeLibraryMaintenanceItem(job, result);
      processedInSlice += 1;
    }
    job = await persistLibraryMaintenanceProgress(job);
    if (!job) return;
    const summary = libraryMaintenanceSummary(job);
    void chrome.runtime.sendMessage({ type: "LIBRARY_MAINTENANCE_PROGRESS", maintenanceJob: summary }).catch(() => undefined);
    await ensureLibraryMaintenanceAlarm(job.status === "running");
    continueRunning = job.status === "running";
  } catch (error) {
    console.error("PromptDirector library maintenance failed", error);
    await ensureLibraryMaintenanceAlarm(true);
  } finally {
    maintenanceRunnerActive = false;
    if (continueRunning) scheduleLibraryMaintenanceRunner();
  }
}

async function persistLibraryMaintenanceProgress(progress) {
  return enqueue(async () => {
    const stored = await chrome.storage.local.get(STORAGE_KEYS.libraryMaintenanceJob);
    const next = mergeLibraryMaintenanceProgress(stored[STORAGE_KEYS.libraryMaintenanceJob], progress);
    if (!next || next.id !== progress.id) return next;
    await commitLocalChanges({ [STORAGE_KEYS.libraryMaintenanceJob]: next });
    return next;
  });
}

async function completeMaintenanceClassifications(jobValue) {
  let job = jobValue;
  if (nextLibraryMaintenanceItem(job)?.kind !== "classification") return job;
  const state = await readState();
  const remainingIds = new Set(job.classificationEntryIds.slice(job.classificationCursor));
  const entries = state.entries.map((entry) => {
    if (!remainingIds.has(entry.id)) return entry;
    if (entry.classification?.status !== "needs_review") return entry;
    return {
      ...entry,
      analysisPending: false,
      classification: classifyContent(entry, state.classificationRules, state.taxonomy)
    };
  });
  await commitLocalChanges({ [STORAGE_KEYS.entries]: entries });
  while (nextLibraryMaintenanceItem(job)?.kind === "classification") {
    job = completeLibraryMaintenanceItem(job, { ok: true });
  }
  return job;
}

async function ensureLibraryMaintenanceAlarm(running) {
  if (running) {
    await chrome.alarms.create(LIBRARY_MAINTENANCE_ALARM, { periodInMinutes: 1 });
  } else await chrome.alarms.clear(LIBRARY_MAINTENANCE_ALARM);
}

async function undoFacetUpdate() {
  const state = await readState();
  const undone = undoFacetHistory(domainState(state), state.facetUndo);
  const update = storagePayload(undone.state);
  if (undone.remainingSteps) update[STORAGE_KEYS.facetUndo] = undone.history;
  await commitLocalChanges(update);
  if (!undone.remainingSteps) await chrome.storage.local.remove(STORAGE_KEYS.facetUndo);
  return {
    ok: true,
    message: "已撤回上一步",
    ...publicDomainState(undone.state),
    canUndoFacetUpdate: undone.remainingSteps > 0,
    facetUndoCount: undone.remainingSteps
  };
}

function findEntry(state, entryId) {
  const entry = state.entries.find((item) => item.id === entryId);
  if (!entry) throw new Error("没有找到这条案例");
  return entry;
}

function touchEntry(entry, updatedAt = new Date().toISOString()) {
  return { ...entry, libraryUpdatedAt: updatedAt };
}

function touchEntries(entriesValue, entryIdsValue, updatedAt = new Date().toISOString()) {
  const entryIds = new Set(Array.isArray(entryIdsValue) ? entryIdsValue : []);
  if (!entryIds.size) return entriesValue;
  return entriesValue.map((entry) => entryIds.has(entry.id) ? touchEntry(entry, updatedAt) : entry);
}

function stringListsEqual(leftValue, rightValue) {
  const left = Array.isArray(leftValue) ? leftValue : [];
  const right = Array.isArray(rightValue) ? rightValue : [];
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function userVisibleEntryEqual(left = {}, right = {}) {
  return JSON.stringify({
    title: left.title,
    text: left.text,
    customLabels: left.customLabels ?? [],
    classification: left.classification ?? null,
    facetAssignments: left.facetAssignments ?? [],
    mediaPrompts: left.mediaPrompts ?? []
  }) === JSON.stringify({
    title: right.title,
    text: right.text,
    customLabels: right.customLabels ?? [],
    classification: right.classification ?? null,
    facetAssignments: right.facetAssignments ?? [],
    mediaPrompts: right.mediaPrompts ?? []
  });
}

function userVisibleEntryChanges(beforeValue, afterValue) {
  const beforeById = new Map((Array.isArray(beforeValue) ? beforeValue : []).map((entry) => [entry.id, entry]));
  return (Array.isArray(afterValue) ? afterValue : [])
    .filter((entry) => beforeById.has(entry.id) && !userVisibleEntryEqual(beforeById.get(entry.id), entry))
    .map((entry) => entry.id);
}

function changedProjectEntryIds(beforeValue, afterValue) {
  const memberships = (value) => {
    const result = new Map();
    for (const collection of normalizeOrganizerState(value).collections) {
      for (const entryId of collection.entryIds) {
        const collectionIds = result.get(entryId) ?? [];
        collectionIds.push(collection.id);
        result.set(entryId, collectionIds);
      }
    }
    return result;
  };
  const before = memberships(beforeValue);
  const after = memberships(afterValue);
  const entryIds = new Set([...before.keys(), ...after.keys()]);
  return [...entryIds].filter((entryId) => {
    const left = (before.get(entryId) ?? []).toSorted();
    const right = (after.get(entryId) ?? []).toSorted();
    return !stringListsEqual(left, right);
  });
}

function requireAnalysisBatch(value, jobId, kind) {
  const job = normalizeAnalysisBatchJob(value);
  if (!job || (jobId && job.id !== jobId)) throw new Error("批量分析任务已变化，请刷新页面");
  if (kind && job.kind !== kind) throw new Error("另一种批量任务正在运行，请先完成或取消");
  return job;
}

function requireClaim(job, entryId, claimId, visualId = "") {
  const item = job.items.find((candidate) =>
    candidate.entryId === entryId &&
    candidate.claimId === claimId &&
    (!visualId || candidate.visualId === visualId)
  );
  if (!item || item.status !== "running" || item.claimId !== claimId) {
    throw new Error("这条批量分析结果已经失效，请刷新后继续");
  }
  return item;
}

function analysisMeta(message, fingerprint, analyzedAt, entry = {}) {
  return {
    ...(fingerprint ? { textFingerprint: fingerprint } : {}),
    textRevision: Math.max(1, Math.floor(Number(message.textRevision) || analysisRevisionMeta(entry).textRevision)),
    ...(String(message.assetId ?? "").trim() ? { assetId: String(message.assetId).trim() } : {}),
    promptVersion: ANALYSIS_PROMPT_VERSION,
    model: String(message.model ?? ""),
    analyzedAt,
    profileFingerprint: String(message.profileFingerprint ?? "").trim(),
    normalizationDiagnostics: (Array.isArray(message.normalizationDiagnostics) ? message.normalizationDiagnostics : []).map((item) => ({
      field: String(item?.field ?? ""),
      code: String(item?.code ?? ""),
      count: Math.max(0, Number(item?.count) || 0)
    })).filter((item) => item.field && item.code),
    attempts: {
      serviceRequests: Math.max(0, Number(message.attempts?.serviceRequests) || 0),
      outputCorrectionRequests: Math.max(0, Number(message.attempts?.outputCorrectionRequests) || 0)
    },
    usage: {
      promptTokens: Math.max(0, Number(message.usage?.promptTokens) || 0),
      completionTokens: Math.max(0, Number(message.usage?.completionTokens) || 0),
      totalTokens: Math.max(0, Number(message.usage?.totalTokens) || 0),
      cacheHitTokens: Math.max(0, Number(message.usage?.cacheHitTokens) || 0),
      cacheMissTokens: Math.max(0, Number(message.usage?.cacheMissTokens) || 0)
    }
  };
}

function analysisResultMessage(applied) {
  return `已写入 ${applied.appliedCount} 个检索标签`;
}

function reusableAnalysisItems(values) {
  return (Array.isArray(values) ? values : []).filter((item) => item?.source && item.source !== "deepseek_text");
}

function domainState(state) {
  return {
    schemaVersion: SCHEMA_VERSION,
    entries: state.entries,
    trashState: normalizeTrashState(state.trashState),
    compoundCases: normalizeCompoundCases(state.compoundCases, state.entries),
    taxonomy: state.taxonomy,
    facetCatalog: state.facetCatalog,
    classificationRules: state.classificationRules,
    organizerState: normalizeOrganizerState(state.organizerState, state.entries.map((entry) => entry.id))
  };
}

function publicDomainState(state) {
  return {
    entries: enrichContentMeanings(state.entries, state.taxonomy),
    trashState: normalizeTrashState(state.trashState),
    compoundCases: normalizeCompoundCases(state.compoundCases, state.entries),
    taxonomy: state.taxonomy,
    facetCatalog: state.facetCatalog,
    classificationRules: state.classificationRules,
    organizerState: normalizeOrganizerState(state.organizerState, state.entries.map((entry) => entry.id))
  };
}

function publicLibraryState(state) {
  const {
    facetUndo: _facetUndo,
    composerSessions: _composerSessions,
    lastSaveUndo,
    ...visibleState
  } = state;
  return {
    ...visibleState,
    entries: enrichContentMeanings(visibleState.entries, visibleState.taxonomy),
    canUndoLastSave: Boolean(lastSaveUndo)
  };
}

function folderBackupState(state) {
  return {
    entries: state.entries,
    trashState: normalizeTrashState(state.trashState),
    settings: state.settings,
    taxonomy: state.taxonomy,
    facetCatalog: state.facetCatalog,
    classificationRules: state.classificationRules,
    organizerState: state.organizerState,
    compoundCases: state.compoundCases,
    composerSettings: state.composerSettings,
    composerSessions: state.composerSessions,
    creativeExperimentSettings: state.creativeExperimentSettings,
    creativeRuns: state.creativeRuns,
    creativeSkills: state.creativeSkills
  };
}

function enrichContentMeanings(entriesValue, taxonomy) {
  const normalizedTaxonomy = normalizeTaxonomy(taxonomy);
  const names = new Map(normalizedTaxonomy.nodes.map((item) => [item.id, item.name]));
  const roles = new Map(normalizedTaxonomy.nodes.map((item) => [item.id, item.role]));
  return (Array.isArray(entriesValue) ? entriesValue : []).map((entry) => ({
    ...entry,
    contentRole: contentRoleForEntry(entry, normalizedTaxonomy, roles),
    contentTypeName: names.get(entry.classification?.pathIds?.[0]) || ""
  }));
}

function storagePayload(state) {
  return {
    [STORAGE_KEYS.schemaVersion]: SCHEMA_VERSION,
    [STORAGE_KEYS.entries]: state.entries,
    [STORAGE_KEYS.trashState]: normalizeTrashState(state.trashState),
    [STORAGE_KEYS.compoundCases]: normalizeCompoundCases(state.compoundCases, state.entries),
    [STORAGE_KEYS.taxonomy]: state.taxonomy,
    [STORAGE_KEYS.facetCatalog]: normalizeFacetCatalog(state.facetCatalog),
    [STORAGE_KEYS.classificationRules]: state.classificationRules,
    [STORAGE_KEYS.organizerState]: normalizeOrganizerState(state.organizerState, state.entries.map((entry) => entry.id))
  };
}

async function commitLocalChanges(update, options = {}) {
  const payload = { ...update };
  const changesSyncedContent = Object.keys(payload).some((key) => SYNCED_STORAGE_KEYS.has(key));
  if (!syncApplyInProgress && options.markSyncDirty !== false && changesSyncedContent) {
    const stored = await chrome.storage.local.get(STORAGE_KEYS.syncMeta);
    payload[STORAGE_KEYS.syncMeta] = markSyncMetaDirty(
      stored[STORAGE_KEYS.syncMeta],
      options.dirtyAssetIds
    );
  }
  await chrome.storage.local.set(payload);
}

async function persistDomainState(state, undo, historyOptions) {
  const update = storagePayload(state);
  if (undo) {
    const stored = await chrome.storage.local.get(STORAGE_KEYS.facetUndo);
    update[STORAGE_KEYS.facetUndo] = appendFacetUndo(
      stored[STORAGE_KEYS.facetUndo], undo, state, historyOptions
    );
  }
  await commitLocalChanges(update);
}

async function exportArchive(state, requestedEntryIds) {
  if (!Array.isArray(requestedEntryIds) || !requestedEntryIds.length) throw new Error("请先选择要分享的案例");
  const exportState = selectLibraryPackage(state, requestedEntryIds);
  await migrateLegacyScreenshots(exportState.entries);
  const archive = await createArchiveUrl(exportState, true);
  try {
    const downloadId = await chrome.downloads.download({
      url: archive.url,
      filename: sharedArchivePath(state.settings.outputPath),
      conflictAction: "uniquify",
      saveAs: false
    });
    await waitForDownload(downloadId);
  } finally {
    await chrome.runtime.sendMessage({
      target: "offscreen",
      type: "REVOKE_BLOB_URL",
      url: archive.url
    });
  }
  return {
    ok: true,
    message: `分享包已导出（${exportState.entries.length} 个案例、${archive.imageCount} 张截图）`,
    count: exportState.entries.length,
    settings: state.settings
  };
}

async function exportProjectArchive(state, collectionId) {
  const exportState = selectProjectPackage(state, collectionId);
  const project = exportState.organizerState.collections[0];
  await migrateLegacyScreenshots(exportState.entries);
  const archive = await createArchiveUrl(exportState, true);
  try {
    const downloadId = await chrome.downloads.download({
      url: archive.url,
      filename: projectArchivePath(state.settings.outputPath, project.name),
      conflictAction: "uniquify",
      saveAs: false
    });
    await waitForDownload(downloadId);
  } finally {
    await chrome.runtime.sendMessage({
      target: "offscreen",
      type: "REVOKE_BLOB_URL",
      url: archive.url
    });
  }
  return {
    ok: true,
    message: `项目“${project.name}”已导出（${exportState.entries.length} 个案例、${archive.imageCount} 张图片）`,
    count: exportState.entries.length,
    imageCount: archive.imageCount
  };
}

async function exportCuratedSubmission(state, message = {}) {
  const prepared = prepareCuratedSubmissionState(state, {
    entryIds: message.entryIds,
    collectionId: message.collectionId
  });
  await migrateLegacyScreenshots(prepared.entries);
  await ensureOffscreenDocument();
  const result = await chrome.runtime.sendMessage({
    target: "offscreen",
    type: "CREATE_CURATED_SUBMISSION_URLS",
    ...prepared.state
  });
  if (!result?.ok || !Array.isArray(result.outputs) || !result.outputs.length) {
    throw new Error(result?.message || "无法生成精选投稿包");
  }
  const downloadIds = [];
  try {
    for (const output of result.outputs) {
      const downloadId = await chrome.downloads.download({
        url: output.url,
        filename: output.filename,
        conflictAction: "uniquify",
        saveAs: false
      });
      downloadIds.push(downloadId);
      await waitForDownload(downloadId);
    }
  } finally {
    await Promise.allSettled(result.outputs.map((output) => chrome.runtime.sendMessage({
      target: "offscreen",
      type: "REVOKE_BLOB_URL",
      url: output.url
    })));
  }
  return {
    ok: true,
    submissionId: result.submissionId,
    count: result.caseCount,
    mediaCount: result.mediaCount,
    partCount: result.partCount,
    downloadIds,
    message: result.partCount > 1
      ? `投稿包已生成，共 ${result.partCount} 个分卷`
      : "投稿包已生成"
  };
}

async function exportCreativeExperiments(state) {
  if (!state.creativeRuns.some((run) => run.outputs.length)) {
    return { ok: false, message: "还没有可导出的真实生成结果" };
  }
  await ensureOffscreenDocument();
  const archive = await chrome.runtime.sendMessage({
    target: "offscreen",
    type: "CREATE_CREATIVE_EXPERIMENT_ARCHIVE_URL",
    composerSettings: state.composerSettings,
    composerSessions: state.composerSessions,
    creativeExperimentSettings: state.creativeExperimentSettings,
    creativeRuns: state.creativeRuns,
    creativeSkills: state.creativeSkills
  });
  if (!archive?.ok || !archive.url) throw new Error(archive?.message || "无法准备创作实验包");
  try {
    const downloadId = await chrome.downloads.download({
      url: archive.url,
      filename: experimentArchivePath(state.settings.outputPath),
      conflictAction: "uniquify",
      saveAs: false
    });
    await waitForDownload(downloadId);
  } finally {
    await chrome.runtime.sendMessage({
      target: "offscreen",
      type: "REVOKE_BLOB_URL",
      url: archive.url
    });
  }
  return {
    ok: true,
    message: `创作实验包已导出（${archive.runCount} 次运行、${archive.mediaCount ?? archive.imageCount} 项结果媒体）`
  };
}

function previewCreativeExperimentImport(state, experiments) {
  const result = mergeCreativeExperimentPackage(state, experiments);
  return {
    ok: true,
    sessionIdMap: result.sessionIdMap,
    runIdMap: result.runIdMap,
    importedRunCount: result.importedRunCount,
    importedOutputCount: result.importedOutputCount,
    visualIdMap: result.visualIdMap
  };
}

async function applyCreativeExperimentImport(state, message) {
  const result = mergeCreativeExperimentPackage(state, message.experiments, {
    sessionIdMap: message.sessionIdMap,
    runIdMap: message.runIdMap,
    visualIdMap: message.visualIdMap
  });
  await commitLocalChanges({
    [STORAGE_KEYS.composerSettings]: result.state.composerSettings,
    [STORAGE_KEYS.composerSessions]: result.state.composerSessions,
    [STORAGE_KEYS.creativeExperimentSettings]: result.state.creativeExperimentSettings,
    [STORAGE_KEYS.creativeRuns]: result.state.creativeRuns
  });
  return {
    ok: true,
    message: `已导入 ${result.importedRunCount} 次创作运行和 ${result.importedOutputCount} 项结果媒体`,
    creativeRuns: result.state.creativeRuns
  };
}

function previewLibraryImport(state, library, options = {}) {
  const result = mergeLibraryPackage(state, library, options);
  return {
    ok: true,
    planToken: createLibraryImportPlanToken(state, library),
    entryIdMap: result.entryIdMap,
    compoundIdMap: result.compoundIdMap,
    visualIdMap: result.visualIdMap,
    createdVisualIdMap: result.createdVisualIdMap,
    sessionIdMap: result.sessionIdMap,
    runIdMap: result.runIdMap,
    skillIdMap: result.skillIdMap,
    packageAssetIdMap: result.packageAssetIdMap,
    createdEntryIds: result.createdEntryIds,
    importDiagnostics: result.importDiagnostics,
    importStats: result.importStats,
    importedCount: result.importedCount,
    remappedCount: result.remappedCount,
    skippedCount: result.skippedCount,
    importedRunCount: result.importedRunCount,
    importedOutputCount: result.importedOutputCount,
    importedSkillCount: result.importedSkillCount,
    skippedSkillCount: result.skippedSkillCount
  };
}

async function applyLibraryImport(state, message) {
  const stored = await chrome.storage.local.get(STORAGE_KEYS.libraryImportTransactions);
  const claim = claimLibraryImportTransaction(stored[STORAGE_KEYS.libraryImportTransactions], {
    operationId: message.operationId,
    planToken: message.planToken,
    stateValue: state,
    sourceValue: message.library
  });
  if (claim.replayed) return claim.result;
  if (!claim.acquired) {
    throw Object.assign(new Error("这次导入仍在提交中，请稍后重试"), {
      code: "IMPORT_TRANSACTION_PENDING"
    });
  }
  await commitLocalChanges({
    [STORAGE_KEYS.libraryImportTransactions]: claim.state
  }, { markSyncDirty: false });

  let result;
  let response;
  try {
    result = mergeLibraryPackage(state, message.library, {
      entryIdMap: message.entryIdMap,
      compoundIdMap: message.compoundIdMap,
      visualIdMap: message.visualIdMap,
      sessionIdMap: message.sessionIdMap,
      runIdMap: message.runIdMap,
      skillIdMap: message.skillIdMap,
      packageAssetIdMap: message.packageAssetIdMap,
      preserveLibraryConfiguration: message.preserveLibraryConfiguration === true
    });
    response = libraryImportResponse(result);
    const completed = succeedLibraryImportTransaction(claim.state, claim.receipt, response);
    await commitLocalChanges({
      ...storagePayload(result.state),
      [STORAGE_KEYS.settings]: normalizeSettings(result.state.settings ?? state.settings),
      [STORAGE_KEYS.composerSettings]: normalizeComposerSettings(result.state.composerSettings ?? state.composerSettings),
      [STORAGE_KEYS.composerSessions]: normalizeComposerSessions(result.state.composerSessions ?? state.composerSessions),
      [STORAGE_KEYS.creativeExperimentSettings]: normalizeCreativeExperimentSettings(
        result.state.creativeExperimentSettings ?? state.creativeExperimentSettings
      ),
      [STORAGE_KEYS.creativeRuns]: normalizeCreativeRuns(result.state.creativeRuns ?? state.creativeRuns),
      [STORAGE_KEYS.creativeSkills]: normalizeCreativeSkillsState(result.state.creativeSkills ?? state.creativeSkills),
      [STORAGE_KEYS.libraryImportTransactions]: completed.state
    });
  } catch (error) {
    const failed = failLibraryImportTransaction(claim.state, claim.receipt);
    await commitLocalChanges({
      [STORAGE_KEYS.libraryImportTransactions]: failed
    }, { markSyncDirty: false }).catch(() => undefined);
    throw error;
  }

  const importedEntryIds = result.createdEntryIds;
  if (importedEntryIds.length) {
    const importedEntryIdSet = new Set(importedEntryIds);
    await enqueueAutomaticLibraryMaintenance(
      result.state.entries.filter((entry) => importedEntryIdSet.has(entry.id))
    ).catch((error) => console.error("Imported library maintenance could not be queued", error));
  }
  if (importedEntryIds.length && message.autoAnalyze === true) {
    await queueAutomaticVisionAnalysis(importedEntryIds)
      .catch((error) => console.error("Imported library analysis could not be queued", error));
  }
  return response;
}

function libraryImportResponse(result) {
  return {
    ok: true,
    message: result.importedCount || result.importedRunCount || result.importedSkillCount
      ? `已导入 ${result.importedCount} 个案例、${result.importedRunCount} 次创作运行和 ${result.importedSkillCount} 个 Skill${result.remappedCount ? `；其中 ${result.remappedCount} 个同源案例作为新副本导入，未覆盖旧数据` : ""}${result.skippedCount || result.skippedSkillCount ? `，跳过 ${result.skippedCount} 个已有案例和 ${result.skippedSkillCount} 个已有 Skill` : ""}`
      : `没有新增内容，${result.skippedCount} 个案例已经存在`,
    count: result.state.entries.length,
    importedCount: result.importedCount,
    remappedCount: result.remappedCount,
    skippedCount: result.skippedCount,
    importedRunCount: result.importedRunCount,
    importedOutputCount: result.importedOutputCount,
    importedSkillCount: result.importedSkillCount,
    skippedSkillCount: result.skippedSkillCount
  };
}

function previewCuratedImport(state, message) {
  const result = mergeCuratedLibraryPackage(state, message.library, {
    packageId: message.packageId,
    projectName: message.projectName,
    mode: message.mode
  });
  return curatedImportResponse(result);
}

async function applyCuratedImport(state, message) {
  const result = mergeCuratedLibraryPackage(state, message.library, {
    packageId: message.packageId,
    projectName: message.projectName,
    mode: message.mode,
    entryIdMap: message.entryIdMap,
    compoundIdMap: message.compoundIdMap,
    visualIdMap: message.visualIdMap,
    sessionIdMap: message.sessionIdMap,
    runIdMap: message.runIdMap
  });
  await commitLocalChanges({
    ...storagePayload(result.state),
    [STORAGE_KEYS.settings]: normalizeSettings(result.state.settings ?? state.settings),
    [STORAGE_KEYS.composerSettings]: normalizeComposerSettings(result.state.composerSettings ?? state.composerSettings),
    [STORAGE_KEYS.composerSessions]: normalizeComposerSessions(result.state.composerSessions ?? state.composerSessions),
    [STORAGE_KEYS.creativeExperimentSettings]: normalizeCreativeExperimentSettings(
      result.state.creativeExperimentSettings ?? state.creativeExperimentSettings
    ),
    [STORAGE_KEYS.creativeRuns]: normalizeCreativeRuns(result.state.creativeRuns ?? state.creativeRuns),
    [STORAGE_KEYS.creativeSkills]: normalizeCreativeSkillsState(result.state.creativeSkills ?? state.creativeSkills)
  });
  if (result.importedEntryIds.length) {
    const importedEntryIdSet = new Set(result.importedEntryIds);
    await enqueueAutomaticLibraryMaintenance(result.state.entries.filter((entry) => importedEntryIdSet.has(entry.id)));
  }
  if (result.importedEntryIds.length) await queueAutomaticVisionAnalysis(result.importedEntryIds);
  return curatedImportResponse(result);
}

function curatedImportResponse(result) {
  return {
    ok: true,
    entryIdMap: result.entryIdMap,
    compoundIdMap: result.compoundIdMap,
    visualIdMap: result.visualIdMap,
    sessionIdMap: result.sessionIdMap,
    runIdMap: result.runIdMap,
    importedCount: result.importedCount,
    existingCount: result.existingCount,
    sourceEntryIds: result.sourceEntryIds,
    importedSourceEntryIds: result.importedSourceEntryIds,
    entriesBySourceEntryId: result.entriesBySourceEntryId,
    importedEntryIds: result.importedEntryIds,
    importedVisualIds: result.importedVisualIds,
    projectId: result.projectId,
    count: result.state.entries.length
  };
}

function sharedArchivePath(outputPath) {
  const normalized = normalizeSettings({ outputPath }).outputPath;
  const separator = normalized.lastIndexOf("/");
  const directory = separator >= 0 ? normalized.slice(0, separator + 1) : "";
  const filename = separator >= 0 ? normalized.slice(separator + 1) : normalized;
  return `${directory}${filename.replace(/\.zip$/i, "")}-分享.zip`;
}

function projectArchivePath(outputPath, projectName) {
  const normalized = normalizeSettings({ outputPath }).outputPath;
  const separator = normalized.lastIndexOf("/");
  const directory = separator >= 0 ? normalized.slice(0, separator + 1) : "";
  const safeName = String(projectName ?? "项目").replace(/[<>:"/\\|?*\u0000-\u001f]/g, "-").trim() || "项目";
  return `${directory}PromptDirector-${safeName}-分享.zip`;
}

function experimentArchivePath(outputPath) {
  const normalized = normalizeSettings({ outputPath }).outputPath;
  const separator = normalized.lastIndexOf("/");
  const directory = separator >= 0 ? normalized.slice(0, separator + 1) : "";
  return `${directory}PromptDirector-创作实验.zip`;
}

async function createArchiveUrl(state, sharing = false) {
  await ensureOffscreenDocument();
  const manifest = chrome.runtime.getManifest();
  const locale = resolveLocale(state.uiPreferences, chrome.i18n.getUILanguage());
  const result = await chrome.runtime.sendMessage({
    target: "offscreen",
    type: "CREATE_ARCHIVE_URL",
    entries: state.entries,
    settings: state.settings,
    taxonomy: state.taxonomy,
    facetCatalog: state.facetCatalog,
    classificationRules: state.classificationRules,
    organizerState: state.organizerState,
    compoundCases: state.compoundCases,
    composerSettings: sharing ? undefined : state.composerSettings,
    composerSessions: sharing ? [] : state.composerSessions,
    creativeExperimentSettings: sharing ? undefined : state.creativeExperimentSettings,
    creativeRuns: sharing ? [] : state.creativeRuns,
    creativeSkills: sharing ? { version: 1, items: [] } : state.creativeSkills,
    uiPreferences: state.uiPreferences,
    locale,
    sharing,
    installUrl: CHROME_WEB_STORE_URL,
    sourceUrl: manifest.homepage_url || ""
  });
  if (!result?.ok || !result.url) {
    throw new Error(result?.message || "无法准备案例库 ZIP");
  }
  return result;
}

async function connectSyncFolder(password) {
  const directory = await getSyncDirectoryHandle();
  if (!directory) throw new Error("请先选择同步文件夹");
  await requireDirectoryPermission(directory);
  const vault = await createOrUnlockSyncVault(directory, String(password ?? ""));
  const stored = await chrome.storage.local.get(STORAGE_KEYS.syncSettings);
  const settings = normalizeSyncSettings({
    ...stored[STORAGE_KEYS.syncSettings],
    enabled: true,
    vaultId: vault.header.vaultId,
    lastError: "",
    lastErrorCode: ""
  });
  await saveSyncCryptoKey(vault.key);
  await commitLocalChanges({ [STORAGE_KEYS.syncSettings]: settings });
  return {
    ok: true,
    connected: true,
    message: "同步文件夹已连接，尚未读取或合并资料；需要时请点击“立即同步”"
  };
}

async function unlockSyncVault(password) {
  const directory = await getSyncDirectoryHandle();
  if (!directory) throw new Error("本机没有保存同步文件夹，请重新选择");
  await requireDirectoryPermission(directory);
  const vault = await createOrUnlockSyncVault(directory, String(password ?? ""));
  const stored = await chrome.storage.local.get(STORAGE_KEYS.syncSettings);
  const current = normalizeSyncSettings(stored[STORAGE_KEYS.syncSettings]);
  if (current.vaultId && current.vaultId !== vault.header.vaultId) {
    throw new Error("这个文件夹不是此前连接的同步库，请使用“更换同步文件夹”");
  }
  const settings = normalizeSyncSettings({
    ...current,
    enabled: true,
    vaultId: vault.header.vaultId,
    lastError: "",
    lastErrorCode: ""
  });
  await saveSyncCryptoKey(vault.key);
  await commitLocalChanges({ [STORAGE_KEYS.syncSettings]: settings });
  return {
    ok: true,
    unlocked: true,
    message: "同步库已解锁，尚未读取或合并资料；需要时请点击“立即同步”"
  };
}

async function performManualSynchronization(start) {
  const stored = await chrome.storage.local.get(STORAGE_KEYS.syncSettings);
  const settings = normalizeSyncSettings(stored[STORAGE_KEYS.syncSettings]);
  if (!settings.enabled) {
    throw new Error("请先在“数据与同步”中选择同步文件夹");
  }
  const directory = await getSyncDirectoryHandle();
  if (!directory) throw await recordSyncError(settings, "同步文件夹需要重新选择");
  const permission = await directoryPermission(directory);
  if (permission !== "granted") throw await recordSyncError(settings, "同步文件夹权限已失效，请重新授权");
  const key = await getSyncCryptoKey();
  if (!key) throw await recordSyncError(settings, "同步库已锁定，请输入密码解锁");
  try {
    const vault = await openSyncVaultWithKey(directory, key, settings.vaultId);
    const result = await start({ vault, settings });
    if (result.canceled) {
      return {
        ...result,
        ok: true,
        libraryChanged: false,
        message: "本次同步已停止，本机未提交的资料没有改变"
      };
    }
    if (result.upToDate) {
      return {
        ...result,
        ok: true,
        libraryChanged: false,
        message: "两端没有变化，没有写入同步文件夹"
      };
    }
    return {
      ...result,
      ok: true,
      libraryChanged: result.effects?.localBusinessChanged === true,
      message: syncResultMessage(result)
    };
  } catch (error) {
    throw await recordSyncError(settings, error);
  }
}

async function commitManualSyncResult({ state, settings, meta, trackingOnly }) {
  syncApplyInProgress = true;
  try {
    const update = {
      [STORAGE_KEYS.syncSettings]: normalizeSyncSettings(settings),
      [STORAGE_KEYS.syncMeta]: normalizeSyncMeta(meta)
    };
    if (!trackingOnly) {
      Object.assign(update, synchronizedStatePayload(await readState(), state));
    }
    await commitLocalChanges(update);
  } finally {
    syncApplyInProgress = false;
  }
}

function syncResultMessage(result = {}) {
  const summary = result.changeSummary ?? {};
  const changes = [
    summary.added ? `新增 ${summary.added} 项` : "",
    summary.updated ? `更新 ${summary.updated} 项` : "",
    summary.deleted ? `删除 ${summary.deleted} 项` : "",
    summary.conflicts ? `保留 ${summary.conflicts} 个冲突副本` : ""
  ].filter(Boolean).join("，");
  return changes ? `手动同步完成：${changes}` : "手动同步完成";
}

function notifySyncProgress(progress = {}) {
  chrome.runtime.sendMessage({
    type: "SYNC_PROGRESS",
    phase: progress.phase,
    current: Math.max(0, Number(progress.current) || 0),
    total: Math.max(0, Number(progress.total) || 0)
  }).catch(() => undefined);
}

function synchronizedStatePayload(current, synced) {
  const entries = Array.isArray(synced.entries) ? synced.entries : current.entries;
  const next = {
    schemaVersion: SCHEMA_VERSION,
    entries,
    trashState: normalizeTrashState(synced.trashState ?? current.trashState),
    compoundCases: normalizeCompoundCases(synced.compoundCases ?? current.compoundCases, entries),
    taxonomy: synced.taxonomy ?? current.taxonomy,
    facetCatalog: synced.facetCatalog ?? current.facetCatalog,
    classificationRules: synced.classificationRules ?? current.classificationRules,
    organizerState: normalizeOrganizerState(
      synced.organizerState ?? current.organizerState,
      entries.map((entry) => entry.id)
    )
  };
  const settings = normalizeSettings({
    ...current.settings,
    libraryTitle: synced.settings?.libraryTitle || current.settings.libraryTitle
  });
  return {
    ...storagePayload(next),
    [STORAGE_KEYS.settings]: settings,
    [STORAGE_KEYS.composerSettings]: normalizeComposerSettings(synced.composerSettings ?? current.composerSettings),
    [STORAGE_KEYS.composerSessions]: normalizeComposerSessions(synced.composerSessions ?? current.composerSessions),
    [STORAGE_KEYS.creativeExperimentSettings]: normalizeCreativeExperimentSettings(
      synced.creativeExperimentSettings ?? current.creativeExperimentSettings
    ),
    [STORAGE_KEYS.creativeRuns]: normalizeCreativeRuns(synced.creativeRuns ?? current.creativeRuns),
    [STORAGE_KEYS.creativeSkills]: normalizeCreativeSkillsState(synced.creativeSkills ?? current.creativeSkills)
  };
}

async function disconnectSyncFolder() {
  const stored = await chrome.storage.local.get(STORAGE_KEYS.syncSettings);
  const current = normalizeSyncSettings(stored[STORAGE_KEYS.syncSettings]);
  await clearSyncPrivateState();
  await commitLocalChanges({
    [STORAGE_KEYS.syncSettings]: normalizeSyncSettings({
      ...current,
      enabled: false,
      vaultId: "",
      lastError: "",
      lastErrorCode: ""
    })
  });
  await chrome.storage.local.remove(STORAGE_KEYS.syncMeta);
  return { ok: true, message: "已断开同步文件夹，本地案例没有删除" };
}

async function dataSafetyStatus(state) {
  const media = state.entries.flatMap((entry) => normalizeEntryMedia(entry).mediaAssets);
  return {
    ok: true,
    entryCount: state.entries.length,
    imageCount: state.entries.reduce((sum, entry) => sum + normalizeEntryVisuals(entry).visuals.length, 0),
    mediaCount: media.length,
    videoCount: media.filter((asset) => asset.kind === "video").length,
    documentCount: media.filter((asset) => asset.kind === "document").length,
    syncStatus: state.syncStatus
  };
}

async function publicSyncStatus(settingsValue) {
  const settings = normalizeSyncSettings(settingsValue);
  const metaStored = await chrome.storage.local.get(STORAGE_KEYS.syncMeta);
  const meta = normalizeSyncMeta(metaStored[STORAGE_KEYS.syncMeta]);
  const run = manualSyncController.status();
  const directory = await getSyncDirectoryHandle().catch(() => null);
  const permission = directory ? await directoryPermission(directory) : "missing";
  const unlocked = Boolean(await getSyncCryptoKey().catch(() => null));
  return {
    enabled: settings.enabled,
    connected: Boolean(settings.vaultId && directory),
    unlocked,
    permission,
    needsAuthorization: settings.enabled && permission !== "granted",
    lastSyncAt: settings.lastSyncAt,
    lastError: settings.lastError,
    lastErrorCode: settings.lastErrorCode,
    localDirty: meta.localDirty,
    dirtyAssetCount: meta.dirtyAssetIds.length,
    ...run
  };
}

async function requireDirectoryPermission(directory) {
  const permission = await directoryPermission(directory);
  if (permission !== "granted") {
    throw new Error("同步文件夹尚未授权，请重新选择文件夹");
  }
}

async function directoryPermission(directory) {
  if (typeof directory.queryPermission !== "function") return "granted";
  return directory.queryPermission({ mode: "readwrite" });
}

async function recordSyncError(settings, failure) {
  const details = syncErrorDetails(failure);
  const message = details.message || "同步失败";
  const error = new Error(message);
  syncApplyInProgress = true;
  try {
    await commitLocalChanges({
      [STORAGE_KEYS.syncSettings]: normalizeSyncSettings({
        ...settings,
        lastError: message,
        lastErrorCode: details.code
      })
    });
  } finally {
    syncApplyInProgress = false;
  }
  return error;
}

async function migrateLegacyScreenshots(entries) {
  for (const entryValue of entries) {
    const entry = normalizeEntryVisuals(entryValue);
    if (!entry.visuals.some((visual) => visual.id === entry.id)) continue;
    const legacyKey = screenshotStorageKey(entry.id);
    const stored = await chrome.storage.local.get(legacyKey);
    const legacyDataUrl = stored[legacyKey];
    if (!legacyDataUrl) continue;

    let blob = await getScreenshotBlob(entry.id);
    if (!blob) {
      blob = await dataUrlToImageBlob(legacyDataUrl);
      await saveScreenshotBlob(entry.id, blob);
    }
    await chrome.storage.local.remove(legacyKey);
  }
}

async function dataUrlToImageBlob(value) {
  if (!/^data:image\/(?:png|jpeg|webp);base64,/.test(String(value ?? ""))) {
    throw new Error("旧版截图数据损坏，无法迁移");
  }
  const response = await fetch(value);
  const blob = await response.blob();
  if (!blob.type.startsWith("image/")) throw new Error("旧版截图格式无效");
  return blob;
}

async function ensureOffscreenDocument() {
  const documentUrl = chrome.runtime.getURL(OFFSCREEN_DOCUMENT_PATH);
  const contexts = await chrome.runtime.getContexts({
    contextTypes: ["OFFSCREEN_DOCUMENT"],
    documentUrls: [documentUrl]
  });
  if (contexts.length) return;

  if (!creatingOffscreenDocument) {
    creatingOffscreenDocument = chrome.offscreen
      .createDocument({
        url: OFFSCREEN_DOCUMENT_PATH,
        reasons: ["BLOBS"],
        justification: "处理持久媒体创作、截图裁剪和本地文件打包"
      })
      .finally(() => {
        creatingOffscreenDocument = null;
      });
  }
  await creatingOffscreenDocument;
}

async function recoverCreativeJobs() {
  const stored = await chrome.storage.local.get([
    STORAGE_KEYS.creativeJobs,
    STORAGE_KEYS.composerSessions
  ]);
  const creativeJobs = normalizeCreativeJobsState(stored[STORAGE_KEYS.creativeJobs]);
  const active = activeCreativeJob(creativeJobs);
  if (!active) return;
  const documentUrl = chrome.runtime.getURL(OFFSCREEN_DOCUMENT_PATH);
  const contexts = await chrome.runtime.getContexts({
    contextTypes: ["OFFSCREEN_DOCUMENT"],
    documentUrls: [documentUrl]
  });
  if (contexts.length) {
    const response = await chrome.runtime.sendMessage({ target: "offscreen", type: "GET_CREATIVE_JOB_RUNNER" }).catch(() => null);
    if (response?.ok && response.jobId === active.id) return;
  }
  if (active.request.session.outputMode === "create_video" && active.remoteVideo && ["generation", "downloading"].includes(active.phase)) {
    try {
      await dispatchCreativeJob(active);
      return;
    } catch {
      // Continue to the explicit interrupted state below when the resumable runner cannot restart.
    }
  }
  const interrupted = interruptActiveCreativeJobs(creativeJobs);
  const sessions = normalizeComposerSessions(stored[STORAGE_KEYS.composerSessions]);
  const sourceSession = sessions.find((item) => item.id === active.sessionId) ?? active.request.session;
  const session = setComposerFailure(sourceSession, {
    userMessageId: active.userMessageId,
    phase: active.phase === "planning" ? "planning" : "streaming",
    kind: "storage",
    message: "浏览器曾在任务完成前退出，结果状态未知，请手动重试",
    retryable: true
  });
  await commitLocalChanges({
    [STORAGE_KEYS.creativeJobs]: interrupted,
    [STORAGE_KEYS.composerSessions]: upsertSessionList(sessions, session)
  });
}

function waitForDownload(downloadId) {
  return new Promise((resolve, reject) => {
    const timeoutId = setTimeout(
      () => finish(new Error("本地文件写入超时")),
      DOWNLOAD_TIMEOUT_MS
    );

    const onChanged = (delta) => {
      if (delta.id !== downloadId || !delta.state) return;
      if (delta.state.current === "complete") finish();
      if (delta.state.current === "interrupted") {
        finish(new Error(delta.error?.current || "本地文件写入被中断"));
      }
    };

    const finish = (error) => {
      clearTimeout(timeoutId);
      chrome.downloads.onChanged.removeListener(onChanged);
      if (error) reject(error);
      else resolve();
    };

    chrome.downloads.onChanged.addListener(onChanged);
    chrome.downloads
      .search({ id: downloadId })
      .then(([item]) => {
        if (item?.state === "complete") finish();
        if (item?.state === "interrupted") {
          finish(new Error(item.error || "本地文件写入被中断"));
        }
      })
      .catch(finish);
  });
}

async function showResultToast(tabId, message, isError) {
  if (!tabId) return;
  await chrome.scripting
    .executeScript({
      target: { tabId },
      func: showPageToast,
      args: [message, isError]
    })
    .catch(() => undefined);
}

async function notifySaved(count) {
  await chrome.action.setBadgeBackgroundColor({ color: "#176B56" });
  await chrome.action.setBadgeText({ text: String(count) });
  setTimeout(() => chrome.action.setBadgeText({ text: "" }), 1800);
}

async function notifyError(message) {
  await chrome.action.setBadgeBackgroundColor({ color: "#B42318" });
  await chrome.action.setBadgeText({ text: "!" });
  await chrome.action.setTitle({ title: `保存失败：${message}` });
  setTimeout(async () => {
    await chrome.action.setBadgeText({ text: "" });
    await chrome.action.setTitle({ title: "保存高亮提示词" });
  }, 3000);
}

function userMessage(error) {
  if (error instanceof Error) return error.message;
  return String(error || "保存失败");
}
