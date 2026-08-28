import { libraryTitleForLocale, libraryTitleForStorage, renderLibraryJson, screenshotStorageKey } from "./lib.js";
import { readImageDimensions } from "./image-metadata.js";
import { deleteScreenshotBlob, getScreenshotBlob, saveScreenshotBlob } from "./image-store.js";
import {
  assertStorageCapacity,
  deleteMediaBlob,
  getAllDerivedMetadata,
  getDerivedMedia,
  getDerivedMetadata,
  getMediaBlob,
  saveDerivedMetadata,
  saveDerivedMedia,
  saveMediaBlob,
  savePortableAssetBlob
} from "./media-store.js";
import { projectPackageEntryIds } from "./library-package.js";
import {
  LIBRARY_TRANSFER_MODES,
  LIBRARY_TRANSFER_SOURCES,
  inspectLibraryTransfer,
  libraryTransferWriteBytes
} from "./library-transfer.js";
import { caseSemanticFingerprint } from "./library-semantic-identity.js";
import {
  buildFolderBackupWritePlan,
  inspectFolderBackupEnvelope,
  verifyFolderBackupCompletion,
  verifyFolderRescueCompletion
} from "./library-export-plan.js";
import { buildLibraryImportReport, importReportDescription } from "./library-import-dialog.js";
import { parseCreativeExperimentPackage } from "./creative-experiment-package.js";
import { readZipBlob } from "./zip.js";
import {
  ASSET_IMPORT_FAILURE_CODES,
  PORTABLE_LIBRARY_LIMITS,
  assertImageDimensions,
  formatBytes,
  importFailureDetails
} from "./resource-limits.js";
import { resolvePortableAssetFormat } from "./asset-formats.js";
import {
  facetNodes,
  formatFacetNodePath,
  normalizeFacetCatalog,
  uniqueNames
} from "./facets.js";
import { createDetailOrganizationChunks, detailNavigation } from "./tag-taxonomy.js";
import {
  entryAttributeSummary,
  entryContentTypeIds,
  entrySourceMetadataRows,
  filterEntries,
  groupEntryAssignments,
  isEntryPending
} from "./library-model.js";
import {
  ANALYSIS_PROMPT_VERSION,
  DEFAULT_ANALYSIS_INSTRUCTIONS_BY_LOCALE,
  analysisProfileFingerprint,
  analysisProtocolDescription,
  analyzeTextDetailedWithDeepSeek,
  normalizeAiSettings,
  organizeDetailTagsWithDeepSeek
} from "./deepseek.js";
import { runScheduledAnalysisWithRetries } from "./analysis-scheduler.js";
import {
  COMPOSER_METHOD_VERSION,
  DEFAULT_TASK_METHODS,
  isComposerEligibleEntry,
  normalizeComposerSettings
} from "./composer.js";
import { textFingerprint } from "./analysis-batch.js";
import { canonicalTextAnalysisInput } from "./analysis-input.js";
import { entryTextRevision, textAnalysisReason } from "./analysis-revision.js";
import { createSimilarityIndex, rankSimilarEntries } from "./local-similarity.js";
import {
  bindUiPreferenceReload,
  currentLocale,
  initializeUi,
  t,
  translateUiMessage,
  updateUiPreferences
} from "./i18n.js";
import { createStableMasonry } from "./stable-masonry.js";
import {
  DEFAULT_VISION_INSTRUCTIONS_BY_LOCALE,
  normalizeVisionSettings,
  blobToDataUrl,
  visionProtocolDescription
} from "./vision.js";
import { MICU_COMPATIBLE_PROVIDER_PRESET } from "./compatible-provider-presets.js";
import { contactSheetPlan, renderContactSheetBatch, selectedSkillContentImages } from "./skill-contact-sheet.js";
import {
  entryHasVisual,
  entryPalette,
  primaryVisual,
  primaryVisionAnalysis,
  primaryVisionDescription
} from "./visuals.js";
import {
  entryMediaAssets,
  entryHasMedia,
  normalizeEntryMedia,
  normalizeMediaAsset,
  posterAssetForVideo,
  primaryMediaAsset,
  removeEntryMedia
} from "./media.js";
import { saveSyncDirectoryHandle } from "./sync-store.js";
import { SYNC_ERROR_CODES } from "./sync-model.js";
import {
  expandLogicalCaseIds,
  materializeLogicalCases,
  normalizeCompoundCases
} from "./compound-cases.js";
import {
  LIBRARY_BATCH_ACTIONS,
  buildLibraryBatchPayload,
  clearLibrarySelection,
  selectAllFilteredLogicalCases,
  toggleLibraryCaseSelection
} from "./library-selection.js";
import { bindTransientMenus } from "./transient-menu.js";
import { bindVideoHoverPreview } from "./video-hover-preview.js";
import { CONTENT_ROLES, CONTENT_TYPE_VISIBILITY, contentRoleForEntry } from "./taxonomy.js";
import { createUiIcon } from "./ui-icons.js";
import { confirmAppAction, promptAppText, showAppDialog } from "./ui-dialogs.js";
import {
  AI_ASSIGNMENT_TASKS,
  availableAiModelsForTask,
  availableAiProvidersForTask,
  modelConcurrencyLimit
} from "./ai-provider-registry.js";
import { buildSearchIndex, searchIndexedEntries } from "./search-index.js";
import {
  mediaReferenceProviderLabel,
  officialMediaEmbedUrl,
  resolveMediaReference
} from "./media-reference-resolver.js";
import { ensureYouTubePlaybackPermission, youtubePlaybackError } from "./media-playback.js";
import { createPdfPreview, createPdfViewer, extractPdfSearchText } from "./document-viewer.js";
import { markdownPlainText, renderMarkdownDocument } from "./markdown-renderer.js";
import {
  COLLECTION_VISIBILITY,
  collectionEntryIds,
  collectionPath,
  collectionPathLabel,
  collectionPathLabelsById,
  collectionSelectorLabelsById,
  collectionSubtreeEntryIdsById,
  collectionSubtreeIds,
  isEntryVisibleInLibrary
} from "./organizer.js";
import { promptForEntryImage, visualAnalysisPromptReplacement } from "./image-prompt.js";
import {
  CAPTURE_PERMISSION_ONBOARDING_STORAGE_KEY,
  CLIPBOARD_READ_PERMISSIONS,
  CONTINUOUS_CAPTURE_ORIGINS,
  inspectCapturePermissionBundle
} from "./capture-permissions.js";
import {
  LOCAL_ASSET_FILE_ACCEPT,
  LOCAL_ASSET_REFERENCE_RECORD_TYPE,
  createUnsupportedLocalAssetReference,
  extractLocalDocumentText,
  findExactMediaDuplicate,
  prepareLocalMedia as prepareSharedLocalMedia,
  sha256Blob
} from "./local-media.js";
import {
  LOCAL_ASSET_LINK_STATUS,
  deleteLocalAssetHandle,
  getLocalAssetHandleRecord,
  inspectLocalAssetHandle,
  saveLocalAssetHandle
} from "./local-asset-store.js";
import {
  LIBRARY_RETURN_STORAGE_KEY,
  parseLibraryReturnSnapshot,
  serializeLibraryReturnSnapshot
} from "./navigation-state.js";
import { CURATED_SUBMISSION_URL } from "./curated-config.js";
import { moveProjectLogicalCase, sortLibraryCases } from "./library-view.js";
import { createTagEditor, normalizeTagValue } from "./tag-editor.js";
import { attachProjectCombobox } from "./project-combobox.js";
import { SIDEBAR_WIDTH_LIMITS, normalizeSidebarWidth } from "./preferences.js";

let uiPreferences = await initializeUi();
bindUiPreferenceReload();
bindTransientMenus(document, ".package-menu, .project-menu, .detail-analysis-menu, .detail-project-menu, .selection-menu");
const libraryWindowId = (await chrome.windows.getCurrent()).id;

const elements = Object.fromEntries([
  "about-version", "add-folder", "add-media", "add-video-reference", "ai-settings-form", "ai-settings-status", "ai-routing-summary", "ai-provider-list", "ai-assignment-list", "open-ai-routing", "analysis-instructions-en", "analysis-instructions-zh", "analysis-protocol", "apply-reanalyze", "case-list", "project-folder-list", "cancel-library-maintenance",
  "content-filters", "content-type-count", "content-type-name", "content-type-replacement", "content-type-replacement-field", "content-type-role", "content-type-role-help",
  "content-type-list", "content-type-editor", "content-type-editor-title", "content-type-delete-transfer", "content-type-delete-message",
  "add-content-type", "cancel-content-type-edit", "cancel-delete-content-type", "confirm-delete-content-type", "save-content-type",
  "collection-filters", "create-collection",
  "analysis-batch-summary", "analysis-diagnostics", "analysis-diagnostic-events", "analysis-progress", "analysis-progress-bar", "analysis-runtime-version", "apply-staged-analysis-rebuild", "batch-status-badge", "cancel-analysis-batch", "composer-agent-instruction", "composer-method-default-text", "composer-method-migration", "composer-method-version", "composer-settings-form", "composer-settings-status", "composer-task-key", "composer-task-method", "copy-analysis-diagnostics", "restore-composer-agent", "restore-composer-task", "save-composer-agent",
  "creative-experiment-auto-analyze", "creative-experiment-enabled", "creative-experiment-status", "save-creative-experiment",
  "creative-experiment-file", "export-creative-experiments", "import-creative-experiments",
  "create-node-form", "delete-content-type", "detail-close", "detail-content", "detail-drawer", "detail-navigation", "detail-next",
  "detail-prev", "drawer-backdrop", "drawer-toolbar", "empty-filter", "empty-library", "empty-state",
  "facet-filters", "feedback", "filter-sidebar", "sidebar-resizer", "gallery-heading", "gallery-sort", "gallery-view-controls", "manage-case-order", "project-manual-sort-option", "legacy-candidates",
  "image-lightbox", "image-lightbox-close", "image-lightbox-image", "library-title", "load-more", "load-sentinel", "manage-facets", "manager-close", "manager-dialog", "manager-feedback",
  "manager-pending", "manager-content-types", "manager-vocabulary", "new-node-aliases",
  "new-node-name", "new-node-parent", "pending-count", "pending-filter",
  "add-quick-note", "organize-detail-tags", "organize-detail-status", "pause-analysis-batch", "pause-library-maintenance", "preview-analysis-batch", "preview-analysis-reanalyze", "preview-reanalyze", "reanalyze-preview", "result-count", "resume-analysis-batch", "resume-library-maintenance", "retry-analysis-failures", "retry-library-maintenance", "start-analysis-reanalyze",
  "project-selection-actions", "project-selection-cancel", "project-selection-clear", "project-selection-count", "project-selection-save", "project-selection-select-all", "project-selection-select-filtered", "project-selection-title", "project-order-status", "restore-analysis-default", "search-input", "share-bar", "share-cancel", "share-count", "share-export", "start-analysis-batch", "start-compose", "toggle-filters", "undo-analysis-batch", "undo-facet", "vocabulary-facet", "workspace-library",
  "share-dialog", "share-dialog-close", "share-dialog-title", "share-dialog-meta", "share-dialog-options", "share-dialog-export", "share-dialog-submit", "share-dialog-disclosure", "share-dialog-result", "share-dialog-result-text", "share-dialog-show-files", "share-dialog-open-form",
  "add-menu", "export-path-setting", "media-file", "media-folder", "library-name-setting", "save-library-settings", "select-cases", "selection-select-filtered", "selection-clear", "selection-label-input", "selection-add-labels", "selection-add-project", "selection-remove-project", "selection-new-project", "selection-combine", "selection-analyze", "selection-project-target", "selection-trash", "open-settings", "settings-dialog", "settings-close", "settings-update-badge", "update-channel", "update-status", "update-checked-at", "update-available-version", "update-explanation", "check-extension-update", "apply-extension-update", "update-release-link", "update-feedback",
  "project-section", "project-root-drop", "manage-project-order", "selection-simple-actions", "selection-selected-actions", "show-analysis-diagnostics", "ui-locale", "ui-theme", "ui-motion", "vocabulary-tree",
  "vision-instructions-en", "vision-instructions-zh", "vision-protocol", "vision-settings-form", "vision-settings-status", "restore-vision-default",
  "open-curated", "open-skills", "open-trash", "trash-count", "trash-dialog", "trash-close", "trash-list", "trash-feedback", "trash-restore-all", "trash-empty", "data-safety-dialog", "data-safety-count", "data-safety-status", "data-safety-feedback",
  "sync-settings", "data-safety-password", "sync-password", "connect-sync-folder", "unlock-sync-vault", "sync-now", "cancel-sync", "create-folder-backup", "restore-folder-backup", "restore-library-replacement-point", "import-library-package", "library-package-file", "disconnect-sync-folder", "capture-web-permission-status", "capture-clipboard-permission-status", "revoke-capture-web-permission", "revoke-capture-clipboard-permission", "capture-permission-settings-feedback",
  "vision-batch-dialog", "vision-batch-close", "vision-batch-summary", "vision-batch-service", "vision-batch-all-images", "vision-batch-reanalyze",
  "vision-batch-progress", "vision-batch-progress-bar", "vision-batch-start", "vision-batch-pause", "vision-batch-resume", "vision-batch-retry", "vision-batch-cancel", "vision-batch-feedback",
  "library-drop-target", "import-dialog", "import-dialog-title", "import-close", "import-source", "import-choose-files", "import-last-job", "import-actions", "import-preparing", "import-confirmation", "import-supported-count", "import-skipped-count", "import-duplicate-count", "import-byte-size", "import-project", "import-project-hint", "import-auto-analyze", "import-label-editor", "import-file-list", "import-feedback", "import-job-panel", "import-job-title", "import-job-count", "import-job-progress", "import-job-feedback", "import-cancel", "import-retry", "import-undo", "import-view-project", "import-start"
].map((id) => [camel(id), document.querySelector(`#${id}`)]));

elements.mediaFile.accept = LOCAL_ASSET_FILE_ACCEPT;
elements.mediaFolder.accept = LOCAL_ASSET_FILE_ACCEPT;

const managerTabs = [...document.querySelectorAll("[data-manager-tab]")];
const settingsTabs = [...document.querySelectorAll("[data-settings-tab]")];
const settingsPanels = [...document.querySelectorAll("[data-settings-panel]")];
const aiRoutingTabs = [...document.querySelectorAll("[data-ai-routing-tab]")];
const aiRoutingPanels = [...document.querySelectorAll("[data-ai-routing-panel]")];
const analysisLocalePanels = [...document.querySelectorAll("[data-analysis-locale-panel]")];
const analysisKindTabs = [...document.querySelectorAll("[data-analysis-kind]")];
const analysisKindPanels = [...document.querySelectorAll("[data-analysis-kind-panel]")];
const aiAdvancedSettingsSummary = document.querySelector(".ai-advanced-settings > summary");
const pendingSwitch = document.querySelector(".pending-switch");
const managerPanels = {
  pending: elements.managerPending,
  "content-types": elements.managerContentTypes,
  vocabulary: elements.managerVocabulary
};
const workspace = document.querySelector(".workspace");
const galleryMasonry = createStableMasonry(elements.caseList, {
  layoutDependencies: [document.querySelector(".topbar")],
  onLayout: () => scheduleLoadCheck()
});
const PAGE_SIZE = 24;
const DETAIL_TAG_PREVIEW_LIMIT = 6;
const thumbnailUrls = new Map();
const originalUrls = new Map();
const loadingImages = new Map();
const thumbnailQueue = [];
const thumbnailConcurrency = Math.max(1, Math.min(2, Math.floor((navigator.hardwareConcurrency || 2) / 4)));
let activeThumbnails = 0;
const detailMediaUrls = new Set();
const detailControllerCleanups = new Set();
const documentPreviewUrls = new Map();
const documentDerived = new Map();
let imageDerivedMetadata = new Map();
let imageDerivedMetadataLoaded = false;
let imageDerivedMetadataLoadPromise = null;
const loadingDocumentPreviews = new Map();
const documentPreviewQueue = [];
const documentPreviewConcurrency = Math.max(1, Math.min(2, Math.floor((navigator.hardwareConcurrency || 2) / 4)));
let activeDocumentPreviews = 0;

let entries = [];
let compoundCases = [];
let logicalCases = [];
let taxonomy = { nodes: [] };
let classificationRules = [];
let facetCatalog = { facets: [], nodes: [] };
let settings = {};
let organizerState = { collections: [] };
let importJobsState = { items: [] };
let aiSettings = { configured: false, consent: false, analysisModel: "deepseek-v4-flash" };
let visionSettings = normalizeVisionSettings();
let aiServiceProfiles = { gemini: { configured: false, model: "" }, xai: { configured: false, textModel: "", imageModel: "", videoModel: "" } };
let aiProviderRegistry = { version: 1, providers: {} };
let aiTaskAssignments = {};
let aiModelCatalogRefreshStarted = false;
let creativeExperimentSettings = { enabled: false, autoAnalyze: false };
let visibleEntries = [];
let renderedCount = 0;
let selectedContentId = "";
let selectedCollectionId = "";
let caseSortMode = "added-desc";
let caseOrderManagementActive = false;
let projectOrderManagementActive = false;
let projectOrderSaving = false;
let projectDragState = null;
const expandedProjectIds = new Set();
let selectionProjectTargetTouched = false;
let selectedFacets = new Map();
let activeManagerTab = "content-types";
let selectedVocabularyFacet = "";
let editingContentTypeId = "";
let creatingContentType = false;
let deletingContentType = false;
let reanalysisPreview = null;
let maintenanceJob = null;
let maintenancePollTimer = 0;
let currentDetailId = null;
let detailRenderGeneration = 0;
let detailReturnFocus = null;
let detailQueueMode = "";
let canUndoFacetUpdate = false;
let activeAnalysisLocale = currentLocale() === "en" ? "en" : "zh-CN";
let activeAnalysisKind = "text";
let activeSettingsTab = "general";
let activeAiRoutingTab = "tasks";
let activeVideoAnalysisUi = null;
let selectionMode = "";
let projectSelectionId = "";
const selectedCaseIds = new Set();
let trashItems = [];
let shareDialogContext = null;
let shareLocalAssetRecords = [];
let submissionDownloadIds = [];
let analysisBatchJob = null;
let visionBatchJob = null;
let canUndoAnalysisBatch = false;
let analysisBatchPreview = null;
let analysisDiagnostics = [];
let analysisDiagnosticStartedAt = 0;
let analysisDiagnosticWrite = Promise.resolve();
let composerSettings = normalizeComposerSettings();
let galleryGeneration = 0;
let loadCheckFrame = 0;
let mediaHydrationFrame = 0;
let searchRenderFrame = 0;
let searchComposing = false;
let indexedGalleryEntries = [];
let gallerySearchIndex = [];
let librarySearchIndexById = new Map();
let logicalIdByEntryId = new Map();
let localSimilarityIndex = createSimilarityIndex([], facetCatalog);
let documentCacheGeneration = 0;
const caseCardCache = new Map();
let lightboxTrigger = null;
let feedbackTimer = 0;
const FEEDBACK_DURATION_MS = 3000;
const ERROR_FEEDBACK_DURATION_MS = 8000;
let syncStatus = {};
let dataSafetyOperationActive = false;
let dataSafetyOperationType = "";
const activeDetailMediaIdByEntry = new Map();
let promptEditState = null;
const visionStatusByEntry = new Map();
let activeFilterCount = 0;
let libraryReturnRestored = false;
let libraryReturnScrollY = null;
let pendingLocalImport = null;
let activeImportJob = null;
let latestImportJob = null;
let importPollTimer = 0;
let importDragDepth = 0;
let externalLibraryRefreshTimer = 0;
let externalLibraryRefreshPending = false;
let extensionUpdateStatus = null;

const importTagEditor = createTagEditor({
  placeholder: "例如：风格不错，很喜欢",
  onChange(values) {
    if (!pendingLocalImport) return false;
    pendingLocalImport.customLabels = values;
    return true;
  }
});
elements.importLabelEditor.replaceChildren(importTagEditor.element);
const importProjectCombobox = attachProjectCombobox(elements.importProject, { projects: [] });

function projectComboboxCollections() {
  const labelsById = collectionSelectorLabelsById(organizerState);
  return organizerState.collections.map((collection) => ({
    ...collection,
    pathLabel: labelsById.get(collection.id)
  }));
}

const mobileLayout = matchMedia("(max-width: 640px)");
if (mobileLayout.matches) workspace.classList.add("filters-collapsed");
mobileLayout.addEventListener("change", (event) => {
  if (event.matches) workspace.classList.add("filters-collapsed");
  renderFilterToggleState();
});

const imageObserver = new IntersectionObserver((records) => {
  for (const record of records) {
    if (record.isIntersecting) hydrateCardImage(record.target);
  }
}, { rootMargin: "500px" });

const documentObserver = new IntersectionObserver((records) => {
  for (const record of records) {
    if (record.isIntersecting) hydrateDocumentPreview(record.target);
  }
}, { rootMargin: "400px" });

const loadObserver = new IntersectionObserver((records) => {
  if (records.some((record) => record.isIntersecting)) renderNextBatch(galleryGeneration);
}, { rootMargin: "700px" });
window.addEventListener("scroll", () => {
  scheduleLoadCheck();
  scheduleVisibleMediaHydration();
}, { passive: true });
chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== "local" || !["entries", "organizerState", "compoundCases", "batchJob"].some((key) => changes[key])) return;
  externalLibraryRefreshPending = true;
  scheduleExternalLibraryRefresh();
});
chrome.runtime.onMessage.addListener((message) => {
  if (message?.type !== "EXTENSION_UPDATE_STATUS_CHANGED") return;
  renderExtensionUpdateStatus(message.status);
});
document.addEventListener("visibilitychange", () => {
  if (!document.hidden && externalLibraryRefreshPending) scheduleExternalLibraryRefresh();
});
window.addEventListener("focus", () => {
  if (externalLibraryRefreshPending) scheduleExternalLibraryRefresh();
});

bindEvents();
renderAnalysisDiagnostics();
elements.uiLocale.value = uiPreferences.locale;
elements.uiTheme.value = uiPreferences.theme;
elements.uiMotion.value = uiPreferences.motion;
elements.showAnalysisDiagnostics.checked = uiPreferences.analysisDiagnostics;
elements.aboutVersion.textContent = `PromptDirector ${chrome.runtime.getManifest().version}`;
void refreshExtensionUpdateStatus();
await refreshLibrary();
await openRequestedLibraryTarget();
await resumeImportJob();
openRequestedSettings();

window.addEventListener("pagehide", saveLibraryReturnSnapshot);

window.addEventListener("unload", () => {
  galleryMasonry.destroy();
  if (mediaHydrationFrame) cancelAnimationFrame(mediaHydrationFrame);
  if (maintenancePollTimer) clearTimeout(maintenancePollTimer);
  if (importPollTimer) clearTimeout(importPollTimer);
  for (const url of [...thumbnailUrls.values(), ...originalUrls.values(), ...documentPreviewUrls.values()]) URL.revokeObjectURL(url);
});

function scheduleExternalLibraryRefresh() {
  if (document.hidden || externalLibraryRefreshTimer) return;
  externalLibraryRefreshTimer = window.setTimeout(async () => {
    externalLibraryRefreshTimer = 0;
    if (!externalLibraryRefreshPending) return;
    externalLibraryRefreshPending = false;
    await refreshLibrary();
  }, 80);
}

function consumePendingExternalLibraryRefresh() {
  externalLibraryRefreshPending = false;
  if (!externalLibraryRefreshTimer) return;
  clearTimeout(externalLibraryRefreshTimer);
  externalLibraryRefreshTimer = 0;
}

async function previewDeepSeekAnalysisBatch(mode = "incremental") {
  const button = mode === "rebuild" ? elements.previewAnalysisReanalyze : elements.previewAnalysisBatch;
  button.disabled = true;
  elements.batchStatusBadge.textContent = t("正在检查");
  elements.analysisBatchSummary.textContent = t("正在检查新增和原文变化的文字…");
  try {
    const response = await chrome.runtime.sendMessage({ type: "PREVIEW_ANALYSIS_BATCH", outputLocale: currentLocale(), mode });
    if (!response?.ok) throw new Error(response?.message || "无法生成批量预览");
    analysisBatchPreview = response.preview;
    renderAnalysisBatch();
    showFeedback(response.preview.caseCount ? "预览已生成；确认后才会发送文字" : mode === "rebuild" ? "没有可重建的文字案例" : "没有需要分析的文字案例");
  } catch (error) {
    showFeedback(error.message, true);
  } finally {
    button.disabled = false;
  }
}

function renderAnalysisBatch() {
  const job = analysisBatchJob;
  const preview = analysisBatchPreview;
  const active = Boolean(job && ["running", "paused"].includes(job.status));
  const unfinishedRebuild = Boolean(job?.mode === "rebuild" && ["completed", "partial"].includes(job?.status) && job?.counts.failed && !job.partialApplied);
  const partialRebuildApplied = Boolean(job?.mode === "rebuild" && job?.partialApplied);
  if (preview && !active && !unfinishedRebuild) {
    elements.batchStatusBadge.textContent = t("本次预览");
    const reasons = preview.reasonCounts ?? {};
    const incrementalReasons = currentLocale() === "en"
      ? `Missing ${reasons.missing_analysis || 0} · changed ${reasons.text_changed || 0}.`
      : `未分析 ${reasons.missing_analysis || 0} 条 · 原文变化 ${reasons.text_changed || 0} 条。`;
    elements.analysisBatchSummary.textContent = preview.caseCount
      ? (currentLocale() === "en"
        ? `${preview.caseCount} requests · fixed taxonomy ${preview.fixedTaxonomyCharacters} chars/request · case text ${preview.caseTextCharacters.toLocaleString("en")} chars. ${preview.mode === "rebuild" ? "Results stay staged until every case succeeds." : incrementalReasons}`
        : `${preview.caseCount} 次请求 · 每次固定分类提示 ${preview.fixedTaxonomyCharacters} 字符 · 案例原文共 ${preview.caseTextCharacters.toLocaleString("zh-CN")} 字符。${preview.mode === "rebuild" ? "全部成功前只暂存，不改变正式标签库。" : incrementalReasons}`)
      : t(preview.mode === "rebuild" ? "没有可重建的文字案例。" : "没有需要分析的案例：现有文字均已分析且原文未变化。");
  } else if (!job) {
    elements.batchStatusBadge.textContent = t("尚未开始");
    elements.analysisBatchSummary.textContent = t("先生成预览，不会直接产生 API 请求。");
  } else {
    const statusNames = { running: "分析中", paused: "已暂停", completed: unfinishedRebuild ? "重建待完成" : partialRebuildApplied ? "成功结果已应用" : "已完成", partial: "有失败项", failed: "分析失败", canceled: "上次已取消" };
    elements.batchStatusBadge.textContent = t(statusNames[job.status] || job.status);
    const progress = currentLocale() === "en"
      ? [`${job.counts.succeeded}/${job.total} completed`, `${job.counts.running} active`, `${job.counts.pending} queued`, `${job.counts.failed} failed`, `${job.requestAttempts || 0} actual requests`, `${job.outputCorrectionRequests || 0} output corrections`, `input ${job.usage.promptTokens} / output ${job.usage.completionTokens} tokens`, `${job.cacheHitCount || 0} result cache hits`, `prompt cache ${job.usage.cacheHitTokens} tokens`, analysisFailureCategorySummary(job, "en")].filter(Boolean).join(" · ")
      : [`${job.counts.succeeded}/${job.total} 已完成`, `${job.counts.running} 处理中`, `${job.counts.pending} 等待中`, `${job.counts.failed} 失败`, `真实请求 ${job.requestAttempts || 0} 次`, `结构补全 ${job.outputCorrectionRequests || 0} 次`, `输入 ${job.usage.promptTokens} / 输出 ${job.usage.completionTokens} tokens`, `结果缓存命中 ${job.cacheHitCount || 0} 次`, `提示缓存命中 ${job.usage.cacheHitTokens} tokens`, analysisFailureCategorySummary(job, "zh-CN")].filter(Boolean).join(" · ");
    const recovery = unfinishedRebuild
      ? (currentLocale() === "en"
        ? `${job.stagedResultCount ?? job.counts.succeeded} successful results are safely staged. ${analysisFailureSummary(job, "en")}`
        : `${job.stagedResultCount ?? job.counts.succeeded} 条成功结果已安全暂存。${analysisFailureSummary(job, "zh-CN")}`)
      : partialRebuildApplied
        ? (currentLocale() === "en"
          ? `Complete successful results are active. ${job.counts.failed} failed cases were not written and can be retried.`
          : `完整成功结果已经生效，${job.counts.failed} 条失败案例未写入，可单独重试。`)
        : "";
    elements.analysisBatchSummary.textContent = [progress, recovery].filter(Boolean).join(" · ");
  }
  const running = job?.status === "running";
  const paused = job?.status === "paused";
  elements.previewAnalysisBatch.hidden = active || unfinishedRebuild;
  elements.startAnalysisBatch.hidden = active || unfinishedRebuild || !preview || preview.mode === "rebuild";
  elements.startAnalysisReanalyze.hidden = active || unfinishedRebuild || !preview || preview.mode !== "rebuild";
  elements.startAnalysisBatch.disabled = !preview?.caseCount || !aiSettings.configured || !aiSettings.consent;
  elements.startAnalysisReanalyze.disabled = !preview?.caseCount || !aiSettings.configured || !aiSettings.consent;
  elements.pauseAnalysisBatch.hidden = !running;
  elements.resumeAnalysisBatch.hidden = !paused || !(job?.counts.pending || job?.counts.running);
  elements.cancelAnalysisBatch.hidden = !active;
  elements.retryAnalysisFailures.textContent = unfinishedRebuild
    ? (currentLocale() === "en" ? `Finish rebuild (${job.counts.failed})` : `继续完成重建（${job.counts.failed} 条）`)
    : currentLocale() === "en"
      ? `Retry failed (${job?.counts.failed || 0})`
      : `重试失败（${job?.counts.failed || 0} 条）`;
  elements.retryAnalysisFailures.hidden = !job?.counts.failed || running || partialRebuildApplied || (unfinishedRebuild && job.stagingValid !== true);
  elements.applyStagedAnalysisRebuild.textContent = unfinishedRebuild
    ? (currentLocale() === "en"
      ? `Apply ${job.stagedResultCount ?? job.counts.succeeded} complete results (${job.counts.failed} failed)`
      : `应用完整成功结果（${job.counts.failed} 条失败不写入）`)
    : t("应用已成功结果");
  elements.applyStagedAnalysisRebuild.hidden = !unfinishedRebuild || job.stagingValid !== true;
  elements.undoAnalysisBatch.hidden = !job || !canUndoAnalysisBatch || running || paused;
  elements.analysisProgress.hidden = !active;
  elements.analysisProgressBar.max = Math.max(1, job?.total || 1);
  elements.analysisProgressBar.value = Math.min((job?.counts?.succeeded || 0) + (job?.counts?.failed || 0), job?.total || 0);
}

function analysisFailureSummary(job, locale) {
  const counts = new Map();
  for (const item of job?.items ?? []) {
    if (item.status !== "failed") continue;
    const message = String(item.error || (locale === "en" ? "Analysis failed" : "分析失败")).trim();
    counts.set(message, (counts.get(message) || 0) + 1);
  }
  const summaries = [...counts.entries()].slice(0, 3).map(([message, count]) => `${message.slice(0, 80)} (${count})`);
  if (!summaries.length) return locale === "en" ? "Retry only the failed cases to finish the atomic switch." : "只需重试失败案例，全部成功后自动切换。";
  return locale === "en" ? `Failures: ${summaries.join("; ")}` : `失败原因：${summaries.join("；")}`;
}

function analysisFailureCategorySummary(job, locale) {
  const labels = locale === "en"
    ? { authorization: "authorization", rate_limit: "rate limit", timeout: "timeout", service: "service", network: "network", output: "output" }
    : { authorization: "授权", rate_limit: "限流", timeout: "超时", service: "服务", network: "网络", output: "输出格式" };
  const values = Object.entries(job?.failureCategories ?? {}).filter(([, count]) => count > 0);
  if (!values.length) return "";
  const summary = values.map(([category, count]) => `${labels[category] || category} ${count}`).join(locale === "en" ? ", " : "、");
  return locale === "en" ? `Failure types: ${summary}` : `失败类型：${summary}`;
}

function bindEvents() {
  elements.searchInput.addEventListener("compositionstart", () => { searchComposing = true; });
  elements.searchInput.addEventListener("compositionend", () => { searchComposing = false; scheduleSearchRender(); });
  elements.searchInput.addEventListener("input", () => { if (!searchComposing) scheduleSearchRender(); });
  elements.pendingFilter.addEventListener("change", renderStructuredFilterResults);
  elements.addMedia.addEventListener("click", () => { elements.addMenu.open = false; void openLocalImportSource(); });
  elements.importChooseFiles.addEventListener("click", () => void chooseLocalImportFiles());
  elements.mediaFile.addEventListener("change", importLocalMediaCases);
  elements.addFolder.addEventListener("click", () => void chooseLocalImportFolder());
  elements.mediaFolder.addEventListener("change", importLocalMediaFolder);
  elements.importLastJob.addEventListener("click", () => void openLatestImportJob());
  elements.importClose.addEventListener("click", closeImportDialog);
  elements.importCancel.addEventListener("click", cancelImportFlow);
  elements.importStart.addEventListener("click", startLocalImportJob);
  elements.importRetry.addEventListener("click", retryLocalImportJob);
  elements.importUndo.addEventListener("click", undoLocalImportJob);
  elements.importViewProject.addEventListener("click", viewImportedProject);
  elements.importDialog.addEventListener("cancel", (event) => {
    if (activeImportJob && ["queued", "running"].includes(activeImportJob.status)) return;
    event.preventDefault();
    void closeImportDialog();
  });
  document.addEventListener("dragenter", handleLibraryDragEnter);
  document.addEventListener("dragover", handleLibraryDragOver);
  document.addEventListener("dragleave", handleLibraryDragLeave);
  document.addEventListener("drop", handleLibraryDrop);
  elements.addVideoReference.addEventListener("click", () => { elements.addMenu.open = false; addVideoReference(); });
  elements.addQuickNote.addEventListener("click", () => { elements.addMenu.open = false; createQuickNote(); });
  elements.openSettings.addEventListener("click", () => openSettingsDialog("general"));
  elements.settingsClose.addEventListener("click", () => elements.settingsDialog.close());
  elements.checkExtensionUpdate.addEventListener("click", checkExtensionUpdate);
  elements.applyExtensionUpdate.addEventListener("click", applyExtensionUpdate);
  elements.revokeCaptureWebPermission.addEventListener("click", () => void revokeCapturePermission("web"));
  elements.revokeCaptureClipboardPermission.addEventListener("click", () => void revokeCapturePermission("clipboard"));
  elements.settingsDialog.addEventListener("cancel", (event) => {
    if (dataSafetyOperationActive) event.preventDefault();
  });
  settingsTabs.forEach((button) => button.addEventListener("click", () => {
    activeSettingsTab = button.dataset.settingsTab || "general";
    renderSettingsPanels({ resetActiveScroll: true });
  }));
  aiRoutingTabs.forEach((button) => button.addEventListener("click", () => {
    activeAiRoutingTab = button.dataset.aiRoutingTab || "tasks";
    renderAiRoutingView();
  }));
  aiAdvancedSettingsSummary?.addEventListener("click", () => preserveSettingsAnchor(aiAdvancedSettingsSummary));
  elements.createCollection.addEventListener("click", () => createProjectCollection(elements.createCollection));
  elements.gallerySort.addEventListener("change", () => {
    caseSortMode = elements.gallerySort.value;
    caseOrderManagementActive = false;
    renderGalleryResults({ refreshNavigation: false });
  });
  elements.manageCaseOrder.addEventListener("click", toggleCaseOrderManagement);
  elements.manageProjectOrder.addEventListener("click", toggleProjectOrderManagement);
  elements.projectSelectionSelectFiltered.addEventListener("click", () => selectVisionCases("filtered"));
  elements.projectSelectionSelectAll.addEventListener("click", () => selectVisionCases("all"));
  elements.projectSelectionClear.addEventListener("click", clearVisionSelection);
  elements.projectSelectionCancel.addEventListener("click", exitProjectSelection);
  elements.projectSelectionSave.addEventListener("click", completeTaskSelection);
  elements.loadMore.addEventListener("click", () => renderNextBatch(galleryGeneration));
  for (const select of [elements.uiLocale, elements.uiTheme, elements.uiMotion]) {
    select.addEventListener("change", async () => {
      await updateUiPreferences({
        locale: elements.uiLocale.value,
        theme: elements.uiTheme.value,
        motion: elements.uiMotion.value,
        analysisDiagnostics: uiPreferences.analysisDiagnostics,
        sidebarWidth: uiPreferences.sidebarWidth
      });
    });
  }
  elements.showAnalysisDiagnostics.addEventListener("change", updateAnalysisDiagnosticsPreference);
  elements.toggleFilters.addEventListener("click", () => {
    workspace.classList.toggle("filters-collapsed");
    renderFilterToggleState();
  });
  bindSidebarResize();
  elements.workspaceLibrary.addEventListener("click", clearFilters);
  elements.openCurated.addEventListener("click", () => {
    navigateWithinPromptDirector("curated.html");
  });
  elements.openSkills.addEventListener("click", () => {
    const url = new URL(chrome.runtime.getURL("skills.html"));
    url.searchParams.set("source", "library");
    navigateWithinPromptDirector(url);
  });
  chrome.runtime.onMessage.addListener(handleDataSafetyProgress);
  chrome.runtime.onMessage.addListener(handleLibraryMaintenanceMessage);
  chrome.runtime.onMessage.addListener(handleVideoAnalysisProgress);
  elements.connectSyncFolder.addEventListener("click", chooseSyncFolder);
  elements.unlockSyncVault.addEventListener("click", () =>
    runDataSafetyAction(elements.unlockSyncVault, { type: "UNLOCK_SYNC_VAULT", password: elements.syncPassword.value }, false)
  );
  elements.syncNow.addEventListener("click", startManualSync);
  elements.cancelSync.addEventListener("click", cancelManualSync);
  elements.createFolderBackup.addEventListener("click", createCompleteFolderBackup);
  elements.restoreFolderBackup.addEventListener("click", restoreCompleteFolderBackup);
  elements.restoreLibraryReplacementPoint.addEventListener("click", restoreLastLibraryReplacementPoint);
  elements.importLibraryPackage.addEventListener("click", () => elements.libraryPackageFile.click());
  elements.libraryPackageFile.addEventListener("change", importSharedLibraryPackage);
  elements.disconnectSyncFolder.addEventListener("click", async () => {
    if (!await confirmAppAction({ title: t("断开同步文件夹？"), description: t("本地案例不会删除。"), confirmLabel: t("断开") })) return;
    await runDataSafetyAction(elements.disconnectSyncFolder, { type: "DISCONNECT_SYNC_FOLDER" });
  });
  elements.visionBatchClose.addEventListener("click", () => elements.visionBatchDialog.close());
  elements.visionBatchDialog.addEventListener("click", (event) => {
    if (event.target === elements.visionBatchDialog) elements.visionBatchDialog.close();
  });
  for (const checkbox of [elements.visionBatchAllImages, elements.visionBatchReanalyze]) {
    checkbox.addEventListener("change", previewSelectedVisionBatch);
  }
  elements.visionBatchStart.addEventListener("click", startSelectedVisionBatch);
  elements.visionBatchPause.addEventListener("click", () => updateVisionBatchAction("PAUSE_VISION_BATCH"));
  elements.visionBatchResume.addEventListener("click", () => updateVisionBatchAction("RESUME_VISION_BATCH"));
  elements.visionBatchRetry.addEventListener("click", () => updateVisionBatchAction("RETRY_VISION_BATCH_FAILURES"));
  elements.visionBatchCancel.addEventListener("click", () => updateVisionBatchAction("CANCEL_VISION_BATCH"));
  elements.saveLibrarySettings.addEventListener("click", saveLibrarySettings);
  elements.libraryNameSetting.addEventListener("input", updateLibrarySettingsSaveState);
  elements.exportPathSetting.addEventListener("input", updateLibrarySettingsSaveState);
  elements.selectCases.addEventListener("click", enterSelectMode);
  elements.startCompose.addEventListener("click", () => openComposerPage(selectedCollectionId));
  elements.shareCancel.addEventListener("click", exitSelectionMode);
  elements.shareExport.addEventListener("click", completeSelection);
  elements.shareDialogClose.addEventListener("click", closeShareDialog);
  elements.shareDialog.addEventListener("click", (event) => {
    if (event.target === elements.shareDialog) closeShareDialog();
  });
  elements.shareDialogDisclosure.addEventListener("change", () => {
    elements.shareDialogSubmit.disabled = !elements.shareDialogDisclosure.checked;
  });
  elements.shareDialogExport.addEventListener("click", exportFromShareDialog);
  elements.shareDialogSubmit.addEventListener("click", submitFromShareDialog);
  elements.shareDialogShowFiles.addEventListener("click", showSubmissionFiles);
  elements.shareDialogOpenForm.addEventListener("click", () => chrome.tabs.create({ url: CURATED_SUBMISSION_URL, active: true }));
  elements.selectionCombine.addEventListener("click", saveCompoundSelection);
  elements.selectionSelectFiltered.addEventListener("click", selectAllFilteredCases);
  elements.selectionClear.addEventListener("click", clearSelectedCases);
  elements.selectionLabelInput.addEventListener("input", updateSelectionBar);
  elements.selectionLabelInput.addEventListener("keydown", (event) => {
    if (event.key !== "Enter") return;
    event.preventDefault();
    void addLabelsToSelection();
  });
  elements.selectionAddLabels.addEventListener("click", addLabelsToSelection);
  elements.selectionAddProject.addEventListener("click", addSelectionToProject);
  elements.selectionRemoveProject.addEventListener("click", removeSelectionFromProject);
  elements.selectionNewProject.addEventListener("click", createProjectFromSelection);
  elements.selectionAnalyze.addEventListener("click", analyzeSelectedCases);
  elements.selectionTrash.addEventListener("click", moveSelectionToTrash);
  elements.selectionProjectTarget.addEventListener("change", () => {
    selectionProjectTargetTouched = true;
    updateSelectionBar();
  });
  elements.openTrash.addEventListener("click", openTrashDialog);
  elements.trashClose.addEventListener("click", () => elements.trashDialog.close());
  elements.trashRestoreAll.addEventListener("click", restoreAllTrashItems);
  elements.trashEmpty.addEventListener("click", emptyTrashFromDialog);
  elements.trashDialog.addEventListener("click", (event) => {
    if (event.target === elements.trashDialog) elements.trashDialog.close();
  });
  elements.manageFacets.addEventListener("click", () => {
    elements.managerFeedback.hidden = true;
    activeManagerTab = "content-types";
    renderManager();
    elements.managerDialog.showModal();
  });
  elements.managerClose.addEventListener("click", () => elements.managerDialog.close());
  elements.managerDialog.addEventListener("click", (event) => {
    if (event.target === elements.managerDialog) elements.managerDialog.close();
  });
  managerTabs.forEach((button) => button.addEventListener("click", () => {
    activeManagerTab = button.dataset.managerTab;
    renderManager();
  }));
  analysisKindTabs.forEach((button) => button.addEventListener("click", () => {
    preserveSettingsAnchor(button.closest(".analysis-kind-tabs"), () => {
      activeAnalysisKind = button.dataset.analysisKind;
      renderAnalysisSettings();
    });
  }));
  elements.vocabularyFacet.addEventListener("change", () => {
    selectedVocabularyFacet = elements.vocabularyFacet.value;
    renderVocabulary();
  });
  elements.addContentType.addEventListener("click", () => {
    creatingContentType = true;
    editingContentTypeId = "";
    deletingContentType = false;
    renderContentTypeManager();
    elements.contentTypeName.focus();
  });
  elements.cancelContentTypeEdit.addEventListener("click", closeContentTypeEditor);
  elements.contentTypeRole.addEventListener("change", renderContentTypeRoleHelp);
  elements.contentTypeEditor.addEventListener("submit", async (event) => {
    event.preventDefault();
    const message = creatingContentType ? {
      type: "CREATE_CONTENT_TYPE",
      name: elements.contentTypeName.value,
      role: elements.contentTypeRole.value
    } : {
      type: "UPDATE_CONTENT_TYPE",
      contentId: editingContentTypeId,
      name: elements.contentTypeName.value,
      role: elements.contentTypeRole.value
    };
    const response = await perform(elements.saveContentType, message);
    if (response) closeContentTypeEditor();
  });
  elements.deleteContentType.addEventListener("click", () => {
    deletingContentType = true;
    renderContentTypeEditor();
  });
  elements.cancelDeleteContentType.addEventListener("click", () => {
    deletingContentType = false;
    renderContentTypeEditor();
  });
  elements.confirmDeleteContentType.addEventListener("click", async () => {
    const selected = taxonomy.nodes.find((item) => item.id === editingContentTypeId);
    if (!selected) return;
    const response = await perform(elements.confirmDeleteContentType, {
      type: "DELETE_CONTENT_TYPE",
      contentId: selected.id,
      replacementId: elements.contentTypeReplacement.value
    });
    if (response) closeContentTypeEditor();
  });
  elements.createNodeForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    await perform(elements.createNodeForm.querySelector("button"), {
      type: "CREATE_FACET_NODE",
      facetId: selectedVocabularyFacet,
      parentId: elements.newNodeParent.value || null,
      name: elements.newNodeName.value,
      aliases: splitInput(elements.newNodeAliases.value)
    });
    elements.newNodeName.value = "";
    elements.newNodeAliases.value = "";
  });
  elements.undoFacet.addEventListener("click", () => perform(elements.undoFacet, { type: "UNDO_FACET_UPDATE" }));
  elements.previewReanalyze.addEventListener("click", previewReanalysis);
  elements.applyReanalyze.addEventListener("click", async () => {
    await startLibraryMaintenance();
  });
  elements.pauseLibraryMaintenance.addEventListener("click", () => updateLibraryMaintenance("PAUSE_LIBRARY_MAINTENANCE"));
  elements.resumeLibraryMaintenance.addEventListener("click", () => updateLibraryMaintenance("RESUME_LIBRARY_MAINTENANCE"));
  elements.retryLibraryMaintenance.addEventListener("click", () => updateLibraryMaintenance("RETRY_LIBRARY_MAINTENANCE"));
  elements.cancelLibraryMaintenance.addEventListener("click", () => updateLibraryMaintenance("CANCEL_LIBRARY_MAINTENANCE"));
  elements.aiSettingsForm.addEventListener("submit", saveAiRulePreferences);
  elements.openAiRouting.addEventListener("click", () => openAiProviderDialog());
  elements.restoreAnalysisDefault.addEventListener("click", () => {
    const target = activeAnalysisLocale === "en" ? elements.analysisInstructionsEn : elements.analysisInstructionsZh;
    target.value = DEFAULT_ANALYSIS_INSTRUCTIONS_BY_LOCALE[activeAnalysisLocale];
    target.focus();
    showFeedback(t("已恢复编辑框默认内容，点击保存后生效"));
  });
  elements.visionSettingsForm.addEventListener("submit", saveAiRulePreferences);
  elements.restoreVisionDefault.addEventListener("click", () => {
    const target = activeAnalysisLocale === "en" ? elements.visionInstructionsEn : elements.visionInstructionsZh;
    target.value = DEFAULT_VISION_INSTRUCTIONS_BY_LOCALE[activeAnalysisLocale];
    target.focus();
    showFeedback(t("已恢复编辑框默认内容，点击保存后生效"));
  });
  elements.previewAnalysisBatch.addEventListener("click", () => previewDeepSeekAnalysisBatch("incremental"));
  elements.previewAnalysisReanalyze.addEventListener("click", () => previewDeepSeekAnalysisBatch("rebuild"));
  elements.organizeDetailTags.addEventListener("click", organizeDetailTags);
  elements.startAnalysisBatch.addEventListener("click", startDeepSeekAnalysisBatch);
  elements.startAnalysisReanalyze.addEventListener("click", startDeepSeekAnalysisBatch);
  elements.pauseAnalysisBatch.addEventListener("click", () => controlAnalysisBatch("PAUSE_ANALYSIS_BATCH"));
  elements.resumeAnalysisBatch.addEventListener("click", () => controlAnalysisBatch("RESUME_ANALYSIS_BATCH"));
  elements.cancelAnalysisBatch.addEventListener("click", () => controlAnalysisBatch("CANCEL_ANALYSIS_BATCH"));
  elements.retryAnalysisFailures.addEventListener("click", () => controlAnalysisBatch("RETRY_ANALYSIS_FAILURES"));
  elements.applyStagedAnalysisRebuild.addEventListener("click", applyStagedAnalysisRebuild);
  elements.copyAnalysisDiagnostics.addEventListener("click", () => copyTextWithFeedback(
    elements.copyAnalysisDiagnostics,
    analysisDiagnosticText(),
    "诊断日志已复制",
    "无法复制诊断日志"
  ));
  elements.undoAnalysisBatch.addEventListener("click", () => controlAnalysisBatch("UNDO_ANALYSIS_BATCH"));
  elements.detailClose.addEventListener("click", closeDetail);
  elements.drawerBackdrop.addEventListener("click", closeDetail);
  elements.detailPrev.addEventListener("click", () => moveDetail(-1));
  elements.detailNext.addEventListener("click", () => moveDetail(1));
  elements.imageLightboxClose.addEventListener("click", closeImageLightbox);
  elements.imageLightboxImage.addEventListener("click", closeImageLightbox);
  elements.imageLightbox.addEventListener("click", (event) => {
    if (event.target === elements.imageLightbox) closeImageLightbox();
  });
  elements.imageLightbox.addEventListener("close", () => {
    elements.imageLightboxImage.removeAttribute("src");
    lightboxTrigger?.focus();
    lightboxTrigger = null;
  });
  elements.composerTaskKey.addEventListener("change", renderComposerMethodSettings);
  elements.composerSettingsForm.addEventListener("submit", saveComposerMethodSettings);
  elements.saveComposerAgent.addEventListener("click", saveComposerAgentInstruction);
  elements.restoreComposerAgent.addEventListener("click", restoreComposerAgentInstruction);
  elements.creativeExperimentEnabled.addEventListener("change", () => {
    elements.creativeExperimentAutoAnalyze.disabled = !elements.creativeExperimentEnabled.checked;
    if (!elements.creativeExperimentEnabled.checked) elements.creativeExperimentAutoAnalyze.checked = false;
  });
  elements.saveCreativeExperiment.addEventListener("click", saveCreativeExperimentSettings);
  elements.exportCreativeExperiments.addEventListener("click", () =>
    perform(elements.exportCreativeExperiments, { type: "EXPORT_CREATIVE_EXPERIMENTS" }));
  elements.importCreativeExperiments.addEventListener("click", () => elements.creativeExperimentFile.click());
  elements.creativeExperimentFile.addEventListener("change", importCreativeExperimentArchive);
  elements.restoreComposerTask.addEventListener("click", restoreComposerTaskDefault);
  document.addEventListener("keydown", (event) => {
    if (!currentDetailId || elements.managerDialog.open || elements.imageLightbox.open) return;
    if (event.key === "Escape") closeDetail();
    const editingText = event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement || event.target?.isContentEditable;
    if (!editingText && event.key === "ArrowLeft") moveDetail(-1);
    if (!editingText && event.key === "ArrowRight") moveDetail(1);
  });
}

async function refreshLibrary() {
  let response;
  try {
    const [state, _derived, diagnosticState] = await Promise.all([
      chrome.runtime.sendMessage({ type: "GET_STATE" }),
      loadImageDerivedMetadata(),
      chrome.storage.local.get("analysisDiagnostics")
    ]);
    response = state;
    analysisDiagnostics = normalizeAnalysisDiagnostics(diagnosticState.analysisDiagnostics);
    analysisDiagnosticStartedAt = analysisDiagnostics[0]?.at || 0;
    renderAnalysisDiagnostics();
  } catch (error) {
    document.body.dataset.libraryState = "ready";
    showFeedback(error?.message || "无法读取本地案例库", true);
    return;
  }
  if (!response?.ok) {
    document.body.dataset.libraryState = "ready";
    showFeedback(response?.message || "无法读取本地案例库", true);
    return;
  }
  entries = response.entries ?? [];
  compoundCases = normalizeCompoundCases(response.compoundCases, entries);
  taxonomy = response.taxonomy ?? { nodes: [] };
  classificationRules = response.classificationRules ?? [];
  facetCatalog = normalizeFacetCatalog(response.facetCatalog);
  settings = response.settings ?? {};
  organizerState = response.organizerState ?? { collections: [] };
  importJobsState = response.importJobs ?? { items: [] };
  trashItems = Array.isArray(response.trashState?.items) ? response.trashState.items : [];
  elements.trashCount.hidden = trashItems.length === 0;
  elements.trashCount.textContent = String(trashItems.length);
  aiSettings = response.aiSettings ?? aiSettings;
  visionSettings = response.visionSettings ?? visionSettings;
  aiServiceProfiles = response.aiServiceProfiles ?? aiServiceProfiles;
  aiProviderRegistry = response.aiProviderRegistry ?? aiProviderRegistry;
  aiTaskAssignments = response.aiTaskAssignments ?? aiTaskAssignments;
  if (!aiModelCatalogRefreshStarted) {
    aiModelCatalogRefreshStarted = true;
    void refreshAiModelCatalogsForSession();
  }
  composerSettings = normalizeComposerSettings(response.composerSettings);
  creativeExperimentSettings = response.creativeExperimentSettings ?? creativeExperimentSettings;
  syncStatus = response.syncStatus ?? {};
  canUndoFacetUpdate = Boolean(response.canUndoFacetUpdate);
  analysisBatchJob = response.analysisBatchJob ?? null;
  maintenanceJob = response.maintenanceJob ?? maintenanceJob;
  visionBatchJob = response.visionBatchJob ?? null;
  canUndoAnalysisBatch = Boolean(response.canUndoAnalysisBatch);
  restoreLibraryReturnSnapshot();
  const displayedLibraryTitle = libraryTitleForLocale(settings.libraryTitle, currentLocale());
  elements.libraryTitle.textContent = displayedLibraryTitle;
  if (document.activeElement !== elements.libraryNameSetting) elements.libraryNameSetting.value = displayedLibraryTitle;
  if (document.activeElement !== elements.exportPathSetting) elements.exportPathSetting.value = settings.outputPath || "";
  elements.libraryNameSetting.dataset.savedValue = displayedLibraryTitle;
  elements.libraryNameSetting.dataset.storedValue = settings.libraryTitle || "";
  elements.exportPathSetting.dataset.savedValue = settings.outputPath || "";
  updateLibrarySettingsSaveState();
  if (selectedCollectionId && !organizerState.collections.some((item) => item.id === selectedCollectionId)) selectedCollectionId = "";
  if (["project", "vision"].includes(selectionMode) && !organizerState.collections.some((item) => item.id === projectSelectionId)) {
    selectionMode = "";
    projectSelectionId = "";
    selectedCaseIds.clear();
    updateSelectionBar();
    showFeedback("项目不存在", true);
  }
  sanitizeSelections();
  caseCardCache.clear();
  rebuildLibraryDerivedState();
  renderGallery();
  document.body.dataset.libraryState = "ready";
  restoreLibraryScrollPosition();
  const cacheGeneration = ++documentCacheGeneration;
  void loadDocumentDerivedCache(entries).then(() => {
    if (cacheGeneration !== documentCacheGeneration) return;
    rebuildLibrarySearchIndex();
    gallerySearchIndex = searchIndexForEntries(indexedGalleryEntries);
    updateCachedDocumentCards();
    if (elements.searchInput.value.trim()) scheduleSearchRender();
  }).catch(() => undefined);
  if (elements.managerDialog.open) renderManager();
  if (elements.visionBatchDialog.open) renderVisionBatchDialog();
  if (elements.settingsDialog.open && activeSettingsTab === "tasks") renderBatchManager();
  if (currentDetailId && logicalCases.some((entry) => entry.id === currentDetailId) && !promptEditState?.dirty) await renderDetail();
  scheduleMaintenanceStatusPoll();
  if (response.restoredArchivedFacetCount) {
    showFeedback(`已自动恢复 ${response.restoredArchivedFacetCount} 个误归档维度，原案例标签没有丢失`);
  }
  await maybeShowRestoreOnboarding();
}

async function loadImageDerivedMetadata() {
  if (imageDerivedMetadataLoaded) return imageDerivedMetadata;
  imageDerivedMetadataLoadPromise ||= getAllDerivedMetadata().catch(() => new Map());
  imageDerivedMetadata = await imageDerivedMetadataLoadPromise;
  imageDerivedMetadataLoaded = true;
  return imageDerivedMetadata;
}

async function loadDocumentDerivedCache(entryValues) {
  const ids = [...new Set(entryValues.flatMap((entry) => entryMediaAssets(entry))
    .filter((asset) => asset.kind === "document" && asset.mimeType === "application/pdf")
    .map((asset) => asset.id))];
  const active = new Set(ids);
  for (const id of [...documentDerived.keys()]) if (!active.has(id)) documentDerived.delete(id);
  const missing = ids.filter((id) => !documentDerived.has(id));
  const values = await Promise.all(missing.map(async (id) => [id, await getDerivedMedia(id).catch(() => null)]));
  for (const [id, value] of values) if (value) documentDerived.set(id, value);
}

function documentSearchText() {
  return new Map([...documentDerived].map(([id, value]) => [id, value.searchText]));
}

function updateCachedDocumentCards() {
  for (const image of elements.caseList.querySelectorAll("img[data-document-id]")) {
    const derived = documentDerived.get(image.dataset.documentId);
    const pages = image.parentElement?.querySelector(".pdf-cover-label span");
    if (pages && derived?.pageCount) pages.textContent = t("{count} 页", { count: derived.pageCount });
  }
}

function rebuildLibraryDerivedState() {
  logicalCases = materializeLogicalCases(entries, compoundCases)
    .toSorted((left, right) => String(right.savedAt).localeCompare(String(left.savedAt)));
  logicalIdByEntryId = new Map();
  for (const entry of logicalCases) {
    for (const entryId of entry.memberEntryIds ?? [entry.id]) logicalIdByEntryId.set(entryId, entry.id);
  }
  rebuildLocalSimilarityIndex();
  rebuildLibrarySearchIndex();
}

function rebuildLocalSimilarityIndex() {
  localSimilarityIndex = createSimilarityIndex(logicalCases.filter((entry) => !entry.compoundCase), facetCatalog, {
    visualForEntry: discoveryVisualId,
    colorsForEntry: discoveryColors
  });
}

function rebuildLibrarySearchIndex() {
  librarySearchIndexById = new Map(buildSearchIndex(logicalCases, facetCatalog, documentSearchText(), imageDerivedMetadata)
    .map((item) => [item.id, item]));
}

function searchIndexForEntries(entryValues) {
  return entryValues.map((entry) => librarySearchIndexById.get(entry.id)).filter(Boolean);
}

function renderGallery() {
  const modeEntries = selectedCollectionId || selectionMode === "project"
    ? logicalCases
    : logicalCases.filter((entry) => (entry.memberEntryIds ?? [entry.id])
      .some((entryId) => isEntryVisibleInLibrary(organizerState, entryId)));
  const projectEntryIds = selectedCollectionId && selectionMode !== "project"
    ? new Set(selectionMode === "vision"
      ? collectionEntryIds(organizerState, selectedCollectionId, { subtree: true })
      : organizerState.collections.find((item) => item.id === selectedCollectionId)?.entryIds ?? [])
    : null;
  let galleryEntries = projectEntryIds
    ? modeEntries.filter((entry) => entry.memberEntryIds
      ? entry.memberEntryIds.some((id) => projectEntryIds.has(id))
      : projectEntryIds.has(entry.id))
    : modeEntries;
  indexedGalleryEntries = galleryEntries;
  gallerySearchIndex = searchIndexForEntries(galleryEntries);
  renderGalleryResults({ refreshNavigation: true });
}

function scheduleSearchRender() {
  if (searchRenderFrame) cancelAnimationFrame(searchRenderFrame);
  searchRenderFrame = requestAnimationFrame(() => {
    searchRenderFrame = 0;
    renderGalleryResults({ refreshNavigation: false });
  });
}

function renderStructuredFilterResults() {
  renderGalleryResults({ refreshNavigation: false });
}

function renderGalleryResults({ refreshNavigation }) {
  galleryGeneration += 1;
  const generation = galleryGeneration;
  loadObserver.disconnect();
  if (loadCheckFrame) cancelAnimationFrame(loadCheckFrame);
  const galleryEntries = indexedGalleryEntries;
  const pendingCount = galleryEntries.filter(isEntryPending).length;
  if (!pendingCount) elements.pendingFilter.checked = false;
  pendingSwitch.hidden = !pendingCount;
  if (selectedContentId && !galleryEntries.some((entry) => entryContentTypeIds(entry).includes(selectedContentId))) {
    selectedContentId = "";
  }
  const query = elements.searchInput.value.trim();
  const libraryContentIds = new Set(taxonomy.nodes
    .filter((item) => item.visibility !== CONTENT_TYPE_VISIBILITY.categoryOnly)
    .map((item) => item.id));
  const browseEntries = selectedContentId
    ? galleryEntries
    : galleryEntries.filter((entry) => isEntryPending(entry)
      || entryContentTypeIds(entry).some((id) => libraryContentIds.has(id)));
  const hasStructuredFilters = Boolean(selectedContentId || selectedFacets.size || elements.pendingFilter.checked);
  if (!query && !hasStructuredFilters) visibleEntries = browseEntries;
  else {
    const searchMatches = query ? searchIndexedEntries(gallerySearchIndex, query) : null;
    visibleEntries = filterEntries(searchMatches
      ? browseEntries.filter((entry) => searchMatches.has(entry.id))
      : browseEntries, {
      query: "",
      contentId: selectedContentId,
      facetSelections: selectedFacets,
      pendingOnly: elements.pendingFilter.checked
    }, facetCatalog);
  }
  syncGallerySortControl();
  const project = selectedCollectionId
    ? organizerState.collections.find((item) => item.id === selectedCollectionId)
    : null;
  const childProjects = project ? projectChildren(project.id) : [];
  visibleEntries = sortLibraryCases(visibleEntries, {
    mode: caseSortMode,
    projectEntryIds: project?.entryIds ?? []
  });
  renderedCount = 0;
  imageObserver.disconnect();
  reconcileInitialCaseCards();
  renderProjectFolderCards(childProjects);
  if (refreshNavigation) {
    renderProjectFilters();
    elements.workspaceLibrary.setAttribute("aria-current", selectedCollectionId ? "false" : "page");
    renderContentFilters(galleryEntries);
    renderFacetFilters(galleryEntries);
  }
  syncStructuredFilterControls();
  renderActiveFilters();
  galleryMasonry.reset();
  galleryMasonry.append([...elements.caseList.children]);
  observePendingCardMedia([...elements.caseList.children]);
  scheduleVisibleMediaHydration();
  renderedCount = elements.caseList.children.length;
  updateLoadMore();
  requestAnimationFrame(() => {
    if (generation !== galleryGeneration) return;
    loadObserver.observe(elements.loadSentinel);
    scheduleLoadCheck(generation);
  });
  elements.emptyState.hidden = visibleEntries.length > 0 || childProjects.length > 0;
  elements.emptyLibrary.hidden = logicalCases.length > 0;
  elements.emptyFilter.hidden = logicalCases.length === 0;
  renderEmptyFilter();
  elements.libraryTitle.textContent = project?.name || libraryTitleForLocale(settings.libraryTitle, currentLocale());
  elements.resultCount.textContent = project
    ? `${visibleEntries.length} 个直接案例 · ${childProjects.length} 个子项目`
    : translateUiMessage(`${visibleEntries.length} 个案例`);
  elements.pendingCount.textContent = String(pendingCount);
}

function renderProjectFolderCards(childProjects) {
  if (!elements.projectFolderList) return;
  const cards = childProjects.map((collection) => {
    const button = el("button", "project-folder-card");
    button.type = "button";
    button.dataset.collectionId = collection.id;
    button.setAttribute("aria-label", `进入子项目 ${collection.name}`);
    const directCases = collection.entryIds.length;
    const nestedProjects = collectionSubtreeIds(organizerState, collection.id).length - 1;
    const copy = el("span", "project-folder-copy");
    copy.append(
      rawTextEl("span", "project-folder-name", collection.name),
      rawTextEl("span", "project-folder-meta", `${directCases} 个直接案例${nestedProjects ? ` · ${nestedProjects} 个下级项目` : ""}`)
    );
    button.append(createUiIcon("folder"), copy, createUiIcon("chevron-right"));
    button.lastElementChild.classList.add("project-folder-arrow");
    button.addEventListener("click", () => {
      selectedCollectionId = collection.id;
      expandedProjectIds.add(collection.parentId);
      caseOrderManagementActive = false;
      renderGallery();
      window.scrollTo({ top: 0, behavior: uiPreferences.motion === "reduced" ? "auto" : "smooth" });
    });
    return button;
  });
  elements.projectFolderList.replaceChildren(...cards);
}

function projectManualOrderAvailable() {
  return Boolean(selectedCollectionId && !selectionMode &&
    !selectedContentId && !selectedFacets.size && !elements.pendingFilter.checked && !elements.searchInput.value.trim());
}

function syncGallerySortControl() {
  const available = projectManualOrderAvailable();
  if (!available) caseOrderManagementActive = false;
  elements.projectManualSortOption.hidden = !available;
  elements.projectManualSortOption.disabled = !available;
  if (!available && caseSortMode === "project-manual") caseSortMode = "added-desc";
  elements.gallerySort.value = caseSortMode;
  elements.manageCaseOrder.hidden = !available;
  elements.selectCases.hidden = caseOrderManagementActive;
  const label = caseOrderManagementActive ? "完成案例排序" : "管理案例顺序";
  elements.manageCaseOrder.setAttribute("aria-label", label);
  elements.manageCaseOrder.title = label;
  elements.manageCaseOrder.replaceChildren(createUiIcon(caseOrderManagementActive ? "circle-check-big" : "sliders-horizontal"));
}

function toggleCaseOrderManagement() {
  if (!projectManualOrderAvailable()) return;
  caseOrderManagementActive = !caseOrderManagementActive;
  if (caseOrderManagementActive) caseSortMode = "project-manual";
  renderGalleryResults({ refreshNavigation: false });
}

function reconcileInitialCaseCards() {
  const desired = visibleEntries.slice(0, PAGE_SIZE).map(caseCardForEntry);
  for (const [index, card] of desired.entries()) {
    const current = elements.caseList.children[index];
    if (current !== card) elements.caseList.insertBefore(card, current ?? null);
  }
  while (elements.caseList.children.length > desired.length) elements.caseList.lastElementChild.remove();
}

function observePendingCardMedia(cards) {
  for (const card of cards) {
    for (const image of card.querySelectorAll("img[data-visual-id]")) {
      if (!image.src) imageObserver.observe(image);
    }
    for (const image of card.querySelectorAll("img[data-document-id]")) {
      if (!image.src) documentObserver.observe(image);
    }
  }
}

function scheduleVisibleMediaHydration() {
  if (mediaHydrationFrame) return;
  mediaHydrationFrame = requestAnimationFrame(() => {
    mediaHydrationFrame = 0;
    hydrateVisiblePendingMedia("img[data-visual-id]:not([src])", 500, hydrateCardImage);
    hydrateVisiblePendingMedia("img[data-document-id]:not([src])", 400, hydrateDocumentPreview);
  });
}

function hydrateVisiblePendingMedia(selector, runway, hydrate) {
  for (const image of elements.caseList.querySelectorAll(selector)) {
    const bounds = image.getBoundingClientRect();
    if (bounds.bottom >= -runway && bounds.top <= window.innerHeight + runway) void hydrate(image);
  }
}

function caseCardForEntry(entry) {
  let card = caseCardCache.get(entry.id);
  if (!card) {
    card = createCaseCard(entry);
    caseCardCache.set(entry.id, card);
  }
  syncCaseCardInteraction(card, entry);
  return card;
}

function syncCaseCardInteraction(card, entry) {
  const selectable = Boolean(selectionMode);
  const ineligible = selectionMode === "vision" && !isVisionSelectableEntry(entry);
  card.classList.toggle("share-selectable", selectable);
  card.classList.toggle("selection-ineligible", ineligible);
  card.classList.toggle("selected-for-share", selectedCaseIds.has(entry.id));
  card.setAttribute("aria-label", translateUiMessage(selectable ? `选择案例：${entry.title}` : `查看案例：${entry.title}`));
  card.setAttribute("aria-pressed", selectable ? String(selectedCaseIds.has(entry.id)) : "false");
  card.setAttribute("aria-disabled", String(ineligible));
  const manualOrder = caseOrderManagementActive && projectManualOrderAvailable() && caseSortMode === "project-manual";
  const reorderControls = card.querySelector(".case-reorder-controls");
  card.classList.toggle("manual-project-order", manualOrder);
  if (reorderControls) {
    const index = visibleEntries.findIndex((item) => item.id === entry.id);
    const [moveUp, moveDown] = reorderControls.querySelectorAll("button");
    moveUp.disabled = !manualOrder || index <= 0;
    moveDown.disabled = !manualOrder || index < 0 || index >= visibleEntries.length - 1;
  }
}

function renderNextBatch(generation = galleryGeneration) {
  if (generation !== galleryGeneration || renderedCount >= visibleEntries.length) {
    updateLoadMore();
    return;
  }
  const next = visibleEntries.slice(renderedCount, renderedCount + PAGE_SIZE);
  const cards = next.map(caseCardForEntry);
  const fragment = document.createDocumentFragment();
  fragment.append(...cards);
  elements.caseList.append(fragment);
  galleryMasonry.append([...elements.caseList.children].slice(renderedCount));
  observePendingCardMedia(cards);
  scheduleVisibleMediaHydration();
  renderedCount += next.length;
  updateLoadMore();
  scheduleLoadCheck(generation);
}

function scheduleLoadCheck(generation = galleryGeneration) {
  if (loadCheckFrame) cancelAnimationFrame(loadCheckFrame);
  loadCheckFrame = requestAnimationFrame(() => {
    loadCheckFrame = 0;
    if (generation !== galleryGeneration || renderedCount >= visibleEntries.length) return;
    const sentinelTop = elements.loadSentinel.getBoundingClientRect().top;
    const preloadRunway = window.innerHeight;
    if (sentinelTop <= window.innerHeight + preloadRunway) renderNextBatch(generation);
  });
}

function updateLoadMore() {
  const remaining = Math.max(0, visibleEntries.length - renderedCount);
  elements.loadMore.hidden = !remaining;
  elements.loadMore.textContent = remaining
    ? translateUiMessage(`加载更多（剩余 ${remaining} 条）`)
    : "";
}

function renderEmptyFilter() {
  if (logicalCases.length === 0 || visibleEntries.length > 0) return;
  const collection = selectedCollectionId
    ? organizerState.collections.find((item) => item.id === selectedCollectionId)
    : null;
  if (!collection || collection.entryIds.length) {
    elements.emptyFilter.replaceChildren(
      textEl("strong", "", "没有匹配的案例"),
      textEl("p", "", "调整筛选条件，或保存新的图片、视频提示词。")
    );
    return;
  }
  const add = textEl("button", "", "从案例库添加案例");
  add.addEventListener("click", () => enterProjectSelection(collection.id));
  elements.emptyFilter.replaceChildren(rawTextEl("strong", "", collection.name), add);
}

function createCaseCard(entry) {
  const card = el("article", "case-card");
  card.tabIndex = 0;
  card.dataset.entryId = entry.id;
  const open = () => {
    if (selectionMode === "vision" && !isVisionSelectableEntry(entry)) {
      showFeedback("这个案例没有可分析的内容图", true);
      return;
    }
    return selectionMode ? toggleCaseSelection(entry.id, card) : openDetail(entry.id, { returnFocus: card });
  };
  card.addEventListener("click", open);
  card.addEventListener("keydown", (event) => {
    if (event.key === "Enter" || event.key === " ") { event.preventDefault(); open(); }
  });

  const mainVisual = primaryMediaAsset(entry);
  if (mainVisual?.kind === "image") {
    const wrap = el("div", "case-image-wrap");
    const dimensions = imageDimensions(mainVisual);
    if (dimensions) {
      wrap.style.aspectRatio = `${dimensions.width} / ${dimensions.height}`;
      wrap.classList.add("case-image-wrap-fixed");
    }
    const image = document.createElement("img");
    image.className = "case-shot";
    image.alt = translateUiMessage(`${entry.title} 对应画面`);
    image.dataset.visualId = mainVisual.id;
    image.decoding = "async";
    image.loading = "lazy";
    const cached = thumbnailUrls.get(mainVisual.id);
    if (cached) image.src = cached;
    wrap.append(image);
    card.append(wrap);
  } else if (mainVisual?.kind === "video") {
    const poster = posterAssetForVideo(entry, mainVisual);
    if (poster) {
      const wrap = el("div", "case-image-wrap case-video-poster");
      const dimensions = imageDimensions(poster);
      if (dimensions) {
        wrap.style.aspectRatio = `${dimensions.width} / ${dimensions.height}`;
        wrap.classList.add("case-image-wrap-fixed");
      }
      const image = document.createElement("img");
      image.className = "case-shot";
      image.alt = translateUiMessage(`${entry.title} 视频封面`);
      image.dataset.visualId = poster.id;
      image.decoding = "async";
      image.loading = "lazy";
      const cached = thumbnailUrls.get(poster.id);
      if (cached) image.src = cached;
      const cue = textEl("span", "case-video-cue", "▶");
      cue.setAttribute("aria-hidden", "true");
      wrap.append(image, cue);
      if (mainVisual.durationMs) wrap.append(rawTextEl("span", "case-video-duration", formatMediaTime(mainVisual.durationMs)));
      if (mainVisual.storageMode === "managed") {
        bindVideoHoverPreview(wrap, { loadBlob: () => getMediaBlob(mainVisual.id) });
      }
      card.append(wrap);
    } else card.append(mainVisual.storageMode === "managed"
      ? createLocalVideoCaseCover(entry, mainVisual)
      : createVideoLinkCover(entry, mainVisual));
  } else if (mainVisual?.kind === "document") {
    card.append(mainVisual.mimeType === "application/pdf" ? createPdfCaseCover(entry, mainVisual) : createTextCaseCover(entry, mainVisual));
  } else if (mainVisual?.kind === "audio") {
    card.append(createAudioCaseCover(entry, mainVisual));
  } else if (mainVisual?.kind === "attachment") {
    card.append(createSourceFileCaseCover(entry, mainVisual));
  } else {
    card.append(entry.text?.trim() ? createTextCaseCover(entry) : textEl("div", "case-shot-missing", "无媒体"));
  }
  const reorderControls = el("span", "case-reorder-controls");
  const moveUp = el("button", "case-move-up");
  const moveDown = el("button", "case-move-down");
  moveUp.append(createUiIcon("chevron-left"));
  moveDown.append(createUiIcon("chevron-right"));
  moveUp.type = moveDown.type = "button";
  moveUp.setAttribute("aria-label", `上移案例：${entry.title}`);
  moveDown.setAttribute("aria-label", `下移案例：${entry.title}`);
  moveUp.title = t("上移案例：{title}", { title: entry.title });
  moveDown.title = t("下移案例：{title}", { title: entry.title });
  moveUp.addEventListener("click", (event) => {
    event.stopPropagation();
    void reorderProjectCase(entry, "up", moveUp);
  });
  moveDown.addEventListener("click", (event) => {
    event.stopPropagation();
    void reorderProjectCase(entry, "down", moveDown);
  });
  reorderControls.addEventListener("keydown", (event) => event.stopPropagation());
  reorderControls.append(moveUp, moveDown);
  card.append(reorderControls, textEl("span", "share-check", "✓"));
  return card;
}

async function reorderProjectCase(entry, direction, button) {
  if (!caseOrderManagementActive || !projectManualOrderAvailable() || caseSortMode !== "project-manual") return;
  const collection = organizerState.collections.find((item) => item.id === selectedCollectionId);
  const index = visibleEntries.findIndex((item) => item.id === entry.id);
  const adjacent = visibleEntries[index + (direction === "up" ? -1 : 1)];
  if (!collection || !adjacent) return;
  const entryIds = moveProjectLogicalCase(collection.entryIds, entry, adjacent, direction);
  const response = await perform(button, {
    type: "REPLACE_COLLECTION_ENTRIES",
    collectionId: collection.id,
    entryIds
  }, false);
  if (!response?.ok) return;
  organizerState = response.organizerState ?? organizerState;
  renderGallery();
}

function createTextCaseCover(entry, asset = null) {
  const mimeLabels = { "text/plain": "TXT", "text/markdown": "MD", "text/html": "HTML" };
  const label = asset ? (["srt", "vtt", "ass", "ssa", "sbv", "lrc"].includes(asset.sourceFormat)
    ? `${assetFormatLabel(asset)} 字幕`
    : mimeLabels[asset.mimeType] || assetFormatLabel(asset) || "DOC") : "NOTE";
  const cover = el("div", "case-text-cover");
  cover.append(rawTextEl("span", "case-text-kind", t(label)), rawTextEl("strong", "case-text-title", entry.title || (asset ? asset.sourceTitle : t("快速笔记"))));
  const source = String(entry.text ?? "").trim();
  const summary = asset?.mimeType === "text/markdown" ? markdownPlainText(source) : source;
  cover.append(rawTextEl("p", "case-text-excerpt", summary || t("打开查看文档内容")));
  return cover;
}

function createAudioCaseCover(entry, asset) {
  const cover = el("div", "case-asset-cover case-audio-cover");
  const format = assetFormatLabel(asset);
  cover.append(
    rawTextEl("span", "case-text-kind", `AUDIO · ${format}`),
    rawTextEl("strong", "case-text-title", asset.sourceTitle || entry.title || t("音频"))
  );
  const metadata = rawTextEl("p", "case-asset-meta", mediaMetadataText(asset));
  const audio = document.createElement("audio");
  audio.className = "case-audio-player";
  audio.controls = true;
  audio.preload = "metadata";
  audio.addEventListener("click", (event) => event.stopPropagation());
  audio.addEventListener("keydown", (event) => event.stopPropagation());
  audio.addEventListener("loadedmetadata", () => {
    if (!asset.durationMs && Number.isFinite(audio.duration)) {
      metadata.textContent = mediaMetadataText({ ...asset, durationMs: Math.round(audio.duration * 1000) });
    }
  });
  void mediaObjectUrl(asset.id).then((url) => { if (url) audio.src = url; });
  cover.append(metadata, audio);
  return cover;
}

function createSourceFileCaseCover(entry, asset) {
  const cover = el("div", "case-asset-cover case-source-file-cover");
  cover.append(
    rawTextEl("span", "case-text-kind", `${assetCategoryLabel(asset)} · ${assetFormatLabel(asset)}`),
    rawTextEl("strong", "case-text-title", asset.sourceTitle || entry.title || t("创作源文件")),
    rawTextEl("p", "case-asset-path", asset.relativePath || t("本机资料")),
    rawTextEl("p", "case-asset-meta", mediaMetadataText(asset))
  );
  if (asset.recordType === LOCAL_ASSET_REFERENCE_RECORD_TYPE) {
    cover.append(rawTextEl("span", "case-local-link-badge", t("本机链接")));
  }
  return cover;
}

function assetCategoryLabel(asset) {
  return ({
    "design-source": "设计源文件",
    "motion-project": "动效工程",
    "editing-project": "剪辑工程",
    "audio-project": "音频工程",
    font: "字体",
    "3d-vfx": "三维 / 特效",
    "local-link": "本机源文件"
  })[asset?.formatCategory] || (asset?.kind === "document" ? "文档" : "创作源文件");
}

function assetFormatLabel(asset) {
  const source = String(asset?.sourceFormat || asset?.sourceTitle?.split(".").at(-1) || "FILE").trim();
  return source ? source.toLocaleUpperCase("en-US") : "FILE";
}

function mediaMetadataText(asset) {
  return [asset?.durationMs ? formatMediaTime(asset.durationMs) : "", assetFormatLabel(asset), asset?.byteSize ? formatBytes(asset.byteSize) : ""]
    .filter(Boolean).join(" · ");
}

function createLocalVideoCaseCover(entry, asset) {
  const cover = el("div", "case-asset-cover case-local-video-cover");
  cover.append(
    rawTextEl("span", "case-text-kind", `${t("本地视频")} · ${assetFormatLabel(asset)}`),
    rawTextEl("strong", "case-text-title", asset.sourceTitle || entry.title || t("本地视频")),
    rawTextEl("p", "case-asset-meta", mediaMetadataText(asset)),
    rawTextEl("p", "case-text-excerpt", t(asset.playbackCapability === "external"
      ? "浏览器无法预览，打开详情可用系统播放器"
      : "打开查看本地视频"))
  );
  return cover;
}

async function mediaObjectUrl(assetId) {
  if (originalUrls.has(assetId)) return originalUrls.get(assetId);
  const blob = await getMediaBlob(assetId);
  if (!blob) return "";
  const url = URL.createObjectURL(blob);
  originalUrls.set(assetId, url);
  return url;
}

function createVideoLinkCover(entry, asset) {
  const provider = mediaReferenceProviderLabel(asset.reference?.provider);
  const cover = el("div", "case-video-link-cover");
  cover.append(rawTextEl("span", "case-text-kind", provider), rawTextEl("strong", "case-text-title", entry.title || asset.sourceTitle || provider));
  const source = safeHttpUrl(asset.reference?.url || asset.sourceUrl);
  cover.append(rawTextEl("p", "case-text-excerpt", source ? new URL(source).hostname : t("打开查看视频来源")));
  return cover;
}

function createPdfCaseCover(entry, asset) {
  const cover = el("div", "case-document-cover case-pdf-cover");
  const image = document.createElement("img");
  image.className = "case-shot pdf-preview";
  image.alt = `${entry.title} PDF 首页`;
  image.dataset.documentId = asset.id;
  image.decoding = "async";
  const cached = documentPreviewUrls.get(asset.id);
  if (cached) image.src = cached;
  const label = el("div", "pdf-cover-label");
  const derived = documentDerived.get(asset.id);
  label.append(rawTextEl("strong", "", "PDF"), rawTextEl("span", "", derived?.pageCount ? `${derived.pageCount} 页` : asset.sourceTitle || "文档"));
  cover.append(image, label);
  return cover;
}

async function hydrateDocumentPreview(image) {
  documentObserver.unobserve(image);
  const assetId = image.dataset.documentId;
  if (!assetId) return;
  let loading = loadingDocumentPreviews.get(assetId);
  if (!loading) {
    loading = scheduleDocumentPreview(() => prepareDocumentPreview(assetId));
    loadingDocumentPreviews.set(assetId, loading);
  }
  try {
    const derived = await loading;
    if (derived?.thumbnail) {
      let url = documentPreviewUrls.get(assetId);
      if (!url) {
        url = URL.createObjectURL(derived.thumbnail);
        documentPreviewUrls.set(assetId, url);
      }
      image.src = url;
      const pages = image.parentElement?.querySelector(".pdf-cover-label span");
      if (pages && derived.pageCount) pages.textContent = t("{count} 页", { count: derived.pageCount });
    }
  } catch (error) {
    image.hidden = true;
    image.parentElement?.classList.add("pdf-preview-error");
    image.parentElement?.setAttribute("title", error.message || "PDF 预览失败");
  } finally {
    loadingDocumentPreviews.delete(assetId);
  }
}

function scheduleDocumentPreview(task) {
  return new Promise((resolve, reject) => {
    documentPreviewQueue.push({ task, resolve, reject });
    runNextDocumentPreviews();
  });
}

function runNextDocumentPreviews() {
  while (activeDocumentPreviews < documentPreviewConcurrency && documentPreviewQueue.length) {
    const queued = documentPreviewQueue.shift();
    activeDocumentPreviews += 1;
    Promise.resolve()
      .then(queued.task)
      .then(queued.resolve, queued.reject)
      .finally(() => {
        activeDocumentPreviews -= 1;
        runNextDocumentPreviews();
      });
  }
}

async function prepareDocumentPreview(assetId) {
  const cached = documentDerived.get(assetId) ?? await getDerivedMedia(assetId);
  if (cached?.thumbnail) return cached;
  const blob = await getMediaBlob(assetId);
  if (!blob) throw new Error("PDF 文件缺失");
  const preview = await createPdfPreview(blob);
  const derived = await saveDerivedMedia(assetId, { ...cached, ...preview });
  documentDerived.set(assetId, derived);
  extractAndCachePdfText(assetId, blob, derived);
  return derived;
}

async function extractAndCachePdfText(assetId, blob, derived) {
  if (derived.searchText) return;
  try {
    const searchText = await extractPdfSearchText(blob);
    const updated = await saveDerivedMedia(assetId, { ...derived, searchText });
    documentDerived.set(assetId, updated);
    rebuildLibrarySearchIndex();
    gallerySearchIndex = searchIndexForEntries(indexedGalleryEntries);
    if (elements.searchInput.value.trim()) scheduleSearchRender();
  } catch {}
}

function renderProjectFilters() {
  const fragment = document.createDocumentFragment();
  const subtreeEntryIdsByProject = collectionSubtreeEntryIdsById(organizerState);
  const pathLabelsByProject = collectionPathLabelsById(organizerState);
  const childrenByParent = indexProjectChildren();
  const projectOrderingUnavailable = Boolean(selectionMode);
  elements.manageProjectOrder.hidden = false;
  elements.manageProjectOrder.disabled = projectOrderingUnavailable;
  const managementLabel = projectOrderingUnavailable
    ? "结束案例选择后可管理项目结构"
    : projectOrderManagementActive ? "完成项目结构管理" : "管理项目结构";
  elements.manageProjectOrder.setAttribute("aria-label", managementLabel);
  elements.manageProjectOrder.title = managementLabel;
  elements.manageProjectOrder.replaceChildren(createUiIcon(projectOrderManagementActive ? "circle-check-big" : "sliders-horizontal"));
  elements.projectRootDrop.hidden = !projectOrderManagementActive;
  if (selectedCollectionId) {
    for (const ancestor of collectionPath(organizerState, selectedCollectionId).slice(0, -1)) expandedProjectIds.add(ancestor.id);
  }
  const visibleCollections = [];
  const pendingCollections = [...(childrenByParent.get(null) ?? [])]
    .reverse()
    .map((collection) => ({ collection, depth: 0 }));
  while (pendingCollections.length) {
    const current = pendingCollections.pop();
    visibleCollections.push(current);
    if (!expandedProjectIds.has(current.collection.id)) continue;
    const children = childrenByParent.get(current.collection.id) ?? [];
    for (let index = children.length - 1; index >= 0; index -= 1) {
      pendingCollections.push({ collection: children[index], depth: current.depth + 1 });
    }
  }
  for (const [projectIndex, { collection, depth }] of visibleCollections.entries()) {
    const children = childrenByParent.get(collection.id) ?? [];
    const siblings = childrenByParent.get(collection.parentId) ?? [];
    const row = el("div", "project-row");
    row.dataset.collectionId = collection.id;
    row.style.setProperty("--project-depth", String(depth));
    row.setAttribute("role", "treeitem");
    row.setAttribute("aria-level", String(depth + 1));
    row.setAttribute("aria-setsize", String(siblings.length));
    row.setAttribute("aria-posinset", String(siblings.findIndex((item) => item.id === collection.id) + 1));
    if (children.length) row.setAttribute("aria-expanded", String(expandedProjectIds.has(collection.id)));
    row.classList.toggle("project-ordering", projectOrderManagementActive);
    row.tabIndex = projectOrderManagementActive ? 0 : -1;
    row.setAttribute("aria-label", projectOrderManagementActive ? `移动项目：${pathLabelsByProject.get(collection.id)}，树中位置 ${projectIndex + 1}` : collection.name);
    const disclosure = el("button", "project-disclosure");
    disclosure.type = "button";
    disclosure.tabIndex = -1;
    disclosure.disabled = projectOrderManagementActive;
    disclosure.setAttribute("aria-label", expandedProjectIds.has(collection.id) ? `折叠 ${collection.name}` : `展开 ${collection.name}`);
    disclosure.classList.toggle("is-placeholder", !children.length);
    if (children.length) disclosure.append(createUiIcon(expandedProjectIds.has(collection.id) ? "chevron-down" : "chevron-right"));
    disclosure.addEventListener("click", () => {
      if (expandedProjectIds.has(collection.id)) expandedProjectIds.delete(collection.id);
      else expandedProjectIds.add(collection.id);
      renderProjectFilters();
    });
    const logicalCount = new Set((subtreeEntryIdsByProject.get(collection.id) ?? [])
      .map((id) => logicalIdByEntryId.get(id)).filter(Boolean)).size;
    const filter = el("button", "project-filter");
    filter.type = "button";
    filter.tabIndex = projectOrderManagementActive ? -1 : 0;
    filter.disabled = ["project", "vision", "combine"].includes(selectionMode);
    filter.setAttribute("aria-pressed", String(selectedCollectionId === collection.id));
    filter.setAttribute("aria-label", `${collection.name} ${logicalCount}`);
    const meta = el("span", "project-filter-meta");
    meta.append(rawTextEl("span", "project-filter-count", String(logicalCount)));
    filter.addEventListener("click", () => {
      if (projectOrderManagementActive) return;
      caseOrderManagementActive = false;
      selectedCollectionId = selectedCollectionId === collection.id ? "" : collection.id;
      renderGallery();
    });
    if (collection.visibility === COLLECTION_VISIBILITY.projectOnly) {
      meta.append(textEl("span", "project-visibility", "仅项目"));
    }
    filter.append(rawTextEl("span", "project-filter-name", collection.name), meta);
    const menu = el("details", "project-menu");
    menu.hidden = projectOrderManagementActive || ["project", "vision", "combine"].includes(selectionMode);
    const summary = el("summary", "");
    summary.append(createUiIcon("ellipsis"));
    summary.setAttribute("aria-label", `${t("管理项目")}：${collection.name}`);
    summary.title = `${t("管理项目")}：${collection.name}`;
    const actions = el("div", "project-menu-panel");
    const manage = textEl("button", "project-menu-primary", "管理案例");
    const share = textEl("button", "button-secondary", "分享项目");
    const analyze = textEl("button", "button-secondary", "批量分析");
    const visibility = textEl(
      "button",
      "button-secondary",
      collection.visibility === COLLECTION_VISIBILITY.projectOnly ? "资料库可见" : "仅项目可见"
    );
    const rename = textEl("button", "button-secondary", "重命名");
    const remove = textEl("button", "quiet-danger", "仅删除项目");
    const removeWithEntries = textEl("button", "quiet-danger", "删除项目及案例");
    manage.addEventListener("click", () => enterProjectSelection(collection.id));
    share.addEventListener("click", () => shareProjectCollection(collection));
    analyze.addEventListener("click", () => enterVisionSelection(collection));
    visibility.addEventListener("click", () => updateProjectVisibility(collection, visibility));
    rename.addEventListener("click", () => renameProjectCollection(collection));
    remove.addEventListener("click", () => deleteProjectCollection(collection));
    removeWithEntries.addEventListener("click", () => deleteProjectCollectionWithEntries(collection, removeWithEntries));
    actions.append(manage, analyze, share, visibility, rename, remove, removeWithEntries);
    menu.append(summary, actions);
    if (projectOrderManagementActive) bindProjectOrderInteractions(row, collection);
    else bindProjectTreeNavigation(row, collection);
    row.append(disclosure, filter, menu);
    fragment.append(row);
  }
  elements.collectionFilters.replaceChildren(fragment);
}

function projectChildren(parentId = null) {
  return indexProjectChildren().get(parentId || null) ?? [];
}

function indexProjectChildren() {
  const result = new Map();
  for (const collection of organizerState.collections) {
    const children = result.get(collection.parentId) ?? [];
    children.push(collection);
    result.set(collection.parentId, children);
  }
  for (const children of result.values()) {
    children.sort((left, right) => left.order - right.order || left.name.localeCompare(right.name, "zh-CN"));
  }
  return result;
}

function toggleProjectOrderManagement() {
  if (selectionMode) return;
  cancelProjectDrag();
  projectOrderManagementActive = !projectOrderManagementActive;
  if (projectOrderManagementActive) {
    for (const parentId of indexProjectChildren().keys()) if (parentId) expandedProjectIds.add(parentId);
  }
  renderProjectFilters();
}

function bindProjectOrderInteractions(row, collection) {
  row.addEventListener("pointerdown", (event) => {
    if (projectOrderSaving || event.button > 0) return;
    event.preventDefault();
    row.focus({ preventScroll: true });
    projectDragState = {
      pointerId: event.pointerId,
      row,
      collectionId: collection.id,
      startY: event.clientY,
      moved: false,
      drop: null
    };
    try { row.setPointerCapture(event.pointerId); } catch {}
  });
  row.addEventListener("pointermove", (event) => {
    const drag = projectDragState;
    if (!drag || drag.row !== row || drag.pointerId !== event.pointerId) return;
    if (!drag.moved && Math.abs(event.clientY - drag.startY) < 4) return;
    event.preventDefault();
    drag.moved = true;
    row.classList.add("is-dragging");
    elements.collectionFilters.classList.add("is-project-dragging");
    clearProjectDropIndicators();
    const hit = document.elementFromPoint(event.clientX, event.clientY);
    if (hit?.closest?.("#project-root-drop")) {
      elements.projectRootDrop.classList.add("is-drop-target");
      drag.drop = { parentId: null, index: projectChildren(null).filter((item) => item.id !== collection.id).length };
      return;
    }
    const targetRow = hit?.closest?.(".project-row");
    if (!targetRow || targetRow === row) return;
    const target = organizerState.collections.find((item) => item.id === targetRow.dataset.collectionId);
    if (!target) return;
    const rect = targetRow.getBoundingClientRect();
    const ratio = (event.clientY - rect.top) / Math.max(1, rect.height);
    const position = ratio < .28 ? "before" : ratio > .72 ? "after" : "inside";
    targetRow.classList.add(`drop-${position}`);
    drag.drop = projectDropPlan(collection.id, target, position);
  });
  const finish = (event) => {
    const drag = projectDragState;
    if (!drag || drag.row !== row || drag.pointerId !== event.pointerId) return;
    const moved = drag.moved;
    const drop = drag.drop;
    cancelProjectDrag();
    if (!moved || !drop) return;
    void persistProjectCollectionMove(collection.id, drop.parentId, drop.index);
  };
  row.addEventListener("pointerup", finish);
  row.addEventListener("pointercancel", () => {
    cancelProjectDrag();
    renderProjectFilters();
  });
  row.addEventListener("keydown", (event) => {
    if (!projectOrderManagementActive || projectOrderSaving || !["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const siblings = projectChildren(collection.parentId);
    const index = siblings.findIndex((item) => item.id === collection.id);
    if (event.key === "Home" || event.key === "End") {
      const target = event.key === "Home" ? siblings[0] : siblings.at(-1);
      return focusProjectRow(target?.id);
    }
    if (event.key === "ArrowUp" && index > 0) return void persistProjectCollectionMove(collection.id, collection.parentId, index - 1);
    if (event.key === "ArrowDown" && index >= 0 && index < siblings.length - 1) return void persistProjectCollectionMove(collection.id, collection.parentId, index + 1);
    if (event.key === "ArrowRight" && index > 0) {
      const parent = siblings[index - 1];
      expandedProjectIds.add(parent.id);
      return void persistProjectCollectionMove(collection.id, parent.id, projectChildren(parent.id).length);
    }
    if (event.key === "ArrowLeft" && collection.parentId) {
      const parent = organizerState.collections.find((item) => item.id === collection.parentId);
      if (!parent) return;
      const parentSiblings = projectChildren(parent.parentId).filter((item) => item.id !== collection.id);
      const parentIndex = parentSiblings.findIndex((item) => item.id === parent.id);
      return void persistProjectCollectionMove(collection.id, parent.parentId, parentIndex + 1);
    }
  });
}

function projectDropPlan(collectionId, target, position) {
  if (position === "inside") {
    return { parentId: target.id, index: projectChildren(target.id).filter((item) => item.id !== collectionId).length };
  }
  const siblings = projectChildren(target.parentId).filter((item) => item.id !== collectionId);
  const targetIndex = siblings.findIndex((item) => item.id === target.id);
  return { parentId: target.parentId, index: targetIndex + (position === "after" ? 1 : 0) };
}

function clearProjectDropIndicators() {
  elements.projectRootDrop.classList.remove("is-drop-target");
  for (const item of elements.collectionFilters.querySelectorAll(".drop-before, .drop-inside, .drop-after")) {
    item.classList.remove("drop-before", "drop-inside", "drop-after");
  }
}

function cancelProjectDrag() {
  const drag = projectDragState;
  if (!drag) return;
  if (drag.row.hasPointerCapture?.(drag.pointerId)) {
    try { drag.row.releasePointerCapture(drag.pointerId); } catch {}
  }
  drag.row.classList.remove("is-dragging");
  elements.collectionFilters.classList.remove("is-project-dragging");
  clearProjectDropIndicators();
  projectDragState = null;
}

async function persistProjectCollectionMove(collectionId, parentId, index) {
  if (projectOrderSaving) return;
  projectOrderSaving = true;
  try {
    const response = await chrome.runtime.sendMessage({ type: "MOVE_COLLECTION", collectionId, parentId, index });
    if (!response?.ok) throw new Error(response?.message || "项目结构保存失败");
    organizerState = response.organizerState ?? organizerState;
    const project = organizerState.collections.find((item) => item.id === collectionId);
    elements.projectOrderStatus.textContent = `已移动“${project?.name || "项目"}”到 ${collectionPathLabel(organizerState, collectionId)}`;
    renderProjectFilters();
    queueMicrotask(() => focusProjectRow(collectionId));
  } catch (error) {
    showFeedback(error.message || "项目结构保存失败", true);
    renderProjectFilters();
  } finally {
    projectOrderSaving = false;
  }
}

function bindProjectTreeNavigation(row, collection) {
  row.addEventListener("keydown", (event) => {
    const rows = [...elements.collectionFilters.querySelectorAll(".project-row")];
    const index = rows.indexOf(row);
    if (event.key === "ArrowDown" || event.key === "ArrowUp" || event.key === "Home" || event.key === "End") {
      event.preventDefault();
      const target = event.key === "Home" ? rows[0]
        : event.key === "End" ? rows.at(-1)
        : rows[index + (event.key === "ArrowDown" ? 1 : -1)];
      target?.querySelector(".project-filter")?.focus();
    } else if (event.key === "ArrowRight") {
      event.preventDefault();
      if (projectChildren(collection.id).length && !expandedProjectIds.has(collection.id)) {
        expandedProjectIds.add(collection.id);
        renderProjectFilters();
        queueMicrotask(() => focusProjectRow(collection.id, true));
      } else if (projectChildren(collection.id).length) focusProjectRow(projectChildren(collection.id)[0].id, true);
    } else if (event.key === "ArrowLeft") {
      event.preventDefault();
      if (expandedProjectIds.has(collection.id)) {
        expandedProjectIds.delete(collection.id);
        renderProjectFilters();
        queueMicrotask(() => focusProjectRow(collection.id, true));
      } else if (collection.parentId) focusProjectRow(collection.parentId, true);
    } else if (event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) {
      const match = rows.find((candidate, candidateIndex) => candidateIndex > index && candidate.querySelector(".project-filter-name")?.textContent?.toLocaleLowerCase().startsWith(event.key.toLocaleLowerCase()))
        ?? rows.find((candidate) => candidate.querySelector(".project-filter-name")?.textContent?.toLocaleLowerCase().startsWith(event.key.toLocaleLowerCase()));
      match?.querySelector(".project-filter")?.focus();
    }
  });
}

function focusProjectRow(collectionId, filter = false) {
  const row = elements.collectionFilters.querySelector(`[data-collection-id="${CSS.escape(collectionId || "")}"]`);
  (filter ? row?.querySelector(".project-filter") : row)?.focus({ preventScroll: true });
}

async function updateProjectVisibility(collection, button) {
  const visibility = collection.visibility === COLLECTION_VISIBILITY.projectOnly
    ? COLLECTION_VISIBILITY.library
    : COLLECTION_VISIBILITY.projectOnly;
  const response = await perform(button, {
    type: "SET_COLLECTION_VISIBILITY",
    collectionId: collection.id,
    visibility
  }, false);
  if (!response?.ok) return;
  organizerState = response.organizerState;
  renderGallery();
}

async function createProjectCollection(button) {
  const parent = organizerState.collections.find((item) => item.id === selectedCollectionId);
  const name = await promptAppText({
    title: t("新建项目"),
    description: parent
      ? t("将创建在“{project}”下面", { project: collectionPathLabel(organizerState, parent.id) })
      : t("将创建为根项目"),
    label: t("项目名称"),
    confirmLabel: t("新建")
  });
  if (!name?.trim()) return;
  const response = await perform(button, { type: "CREATE_COLLECTION", name, parentId: parent?.id ?? null });
  if (response?.created?.id) enterProjectSelection(response.created.id);
}

async function renameProjectCollection(collection) {
  const name = await promptAppText({ title: t("重命名项目"), label: t("项目名称"), value: collection.name, confirmLabel: t("保存"), selectFirst: true });
  if (!name?.trim() || name.trim() === collection.name) return;
  await perform(elements.createCollection, { type: "RENAME_COLLECTION", collectionId: collection.id, name });
}

async function deleteProjectCollection(collection) {
  const subtreeIds = collectionSubtreeIds(organizerState, collection.id);
  if (!await confirmAppAction({ title: translateUiMessage(`将项目“${collection.name}”及其 ${subtreeIds.length - 1} 个子项目移入回收站？`), description: t("其中案例仍会保留在资料库，可从回收站恢复项目。"), confirmLabel: t("移入回收站"), danger: true })) return;
  if (subtreeIds.includes(selectedCollectionId)) selectedCollectionId = "";
  await perform(elements.createCollection, { type: "DELETE_COLLECTION", collectionId: collection.id });
}

async function deleteProjectCollectionWithEntries(collection, button) {
  const subtreeIds = collectionSubtreeIds(organizerState, collection.id);
  const memberIds = new Set(collectionEntryIds(organizerState, collection.id, { subtree: true }));
  const memberEntries = entries.filter((entry) => memberIds.has(entry.id));
  const otherProjectEntryIds = new Set(organizerState.collections
    .filter((item) => !subtreeIds.includes(item.id))
    .flatMap((item) => item.entryIds));
  const sharedCount = memberEntries.filter((entry) => otherProjectEntryIds.has(entry.id)).length;
  const mediaCount = new Set(memberEntries.flatMap((entry) =>
    normalizeEntryMedia(entry).mediaAssets.map((asset) => asset.id)
  )).size;
  if (!await confirmAppAction({
    title: `将项目“${collection.name}”及全部案例移入回收站？`,
    description: `将归档 ${subtreeIds.length} 个项目、${memberEntries.length} 个去重案例和 ${mediaCount} 项媒体；其中 ${sharedCount} 个案例也属于其他项目。可从回收站恢复。`,
    confirmLabel: "全部移入回收站",
    danger: true
  })) return;
  if (subtreeIds.includes(selectedCollectionId)) selectedCollectionId = "";
  await perform(button, {
    type: "DELETE_COLLECTION_WITH_ENTRIES",
    collectionId: collection.id,
    confirmationName: collection.name
  });
}

async function enterProjectSelection(collectionId) {
  const collection = organizerState.collections.find((item) => item.id === collectionId);
  if (!collection) return showFeedback("项目不存在", true);
  if (!await closeDetail()) return;
  selectionMode = "project";
  projectSelectionId = collection.id;
  caseOrderManagementActive = false;
  projectOrderManagementActive = false;
  selectedCollectionId = collection.id;
  selectedCaseIds.clear();
  const members = new Set(collection.entryIds);
  logicalCases.forEach((entry) => {
    if (entry.memberEntryIds ? entry.memberEntryIds.every((id) => members.has(id)) : members.has(entry.id)) {
      selectedCaseIds.add(entry.id);
    }
  });
  selectedContentId = "";
  selectedFacets.clear();
  elements.pendingFilter.checked = false;
  elements.searchInput.value = "";
  updateSelectionBar();
  renderGallery();
}

async function enterVisionSelection(collection) {
  if (visionBatchJob && ["running", "paused"].includes(visionBatchJob.status)) {
    renderVisionBatchDialog();
    if (!elements.visionBatchDialog.open) elements.visionBatchDialog.showModal();
    return;
  }
  if (!collectionEntryIds(organizerState, collection?.id, { subtree: true }).length) return showFeedback("这个项目及其子项目还没有可分析的案例", true);
  if (!await closeDetail()) return;
  selectionMode = "vision";
  projectSelectionId = collection.id;
  caseOrderManagementActive = false;
  projectOrderManagementActive = false;
  selectedCollectionId = collection.id;
  replaceSelectedCaseIds(getVisionSelectableEntries("all").map((entry) => entry.id));
  selectedContentId = "";
  selectedFacets.clear();
  elements.pendingFilter.checked = false;
  elements.searchInput.value = "";
  renderGallery();
}

async function enterSelectMode() {
  if (!await closeDetail()) return;
  selectionMode = "select";
  caseOrderManagementActive = false;
  projectOrderManagementActive = false;
  selectionProjectTargetTouched = false;
  elements.selectionProjectTarget.value = selectedCollectionId || "";
  selectedCaseIds.clear();
  updateSelectionBar();
  renderGallery();
}

function exitSelectionMode() {
  selectionMode = "";
  projectSelectionId = "";
  selectedCaseIds.clear();
  elements.selectionLabelInput.value = "";
  selectionProjectTargetTouched = false;
  updateSelectionBar();
  renderGallery();
  requestAnimationFrame(() => elements.selectCases.focus());
}

function exitProjectSelection() {
  selectionMode = "";
  projectSelectionId = "";
  selectedCaseIds.clear();
  updateSelectionBar();
  renderGallery();
}

function toggleCaseSelection(entryId, card) {
  replaceSelectedCaseIds(toggleLibraryCaseSelection([...selectedCaseIds], entryId));
  const selected = selectedCaseIds.has(entryId);
  card.classList.toggle("selected-for-share", selected);
  card.setAttribute("aria-pressed", String(selected));
}

function selectAllFilteredCases() {
  if (selectionMode !== "select") return;
  replaceSelectedCaseIds(selectAllFilteredLogicalCases(visibleEntries.map((entry) => entry.id)));
  renderGallery();
}

function clearSelectedCases() {
  replaceSelectedCaseIds(clearLibrarySelection());
  renderGallery();
  requestAnimationFrame(() => elements.selectionSelectFiltered.focus());
}

function replaceSelectedCaseIds(values) {
  selectedCaseIds.clear();
  values.forEach((id) => selectedCaseIds.add(id));
  updateSelectionBar();
}

function updateSelectionBar() {
  const taskSelecting = ["project", "vision", "combine"].includes(selectionMode);
  const project = taskSelecting
    ? organizerState.collections.find((item) => item.id === projectSelectionId)
    : null;
  const visionSelection = selectionMode === "vision";
  const filteredEligibleCount = visionSelection ? getVisionSelectableEntries("filtered").length : 0;
  const allEligibleCount = visionSelection ? getVisionSelectableEntries("all").length : 0;
  elements.shareBar.hidden = !selectionMode || taskSelecting;
  elements.galleryHeading.classList.toggle("selection-mode", Boolean(selectionMode && !taskSelecting));
  elements.galleryHeading.classList.toggle("project-selection-mode", taskSelecting);
  elements.selectionSimpleActions.hidden = false;
  elements.projectSelectionActions.hidden = !taskSelecting;
  elements.projectSelectionTitle.hidden = !taskSelecting;
  elements.resultCount.hidden = Boolean(selectionMode);
  elements.selectCases.hidden = Boolean(selectionMode);
  elements.galleryViewControls.hidden = Boolean(selectionMode);
  elements.projectSelectionTitle.textContent = selectionMode === "combine"
    ? `${t("组合案例")} · ${translateUiMessage(`已选择 ${selectedCaseIds.size} 个案例`)}`
    : project
    ? selectionMode === "vision"
      ? `${t("批量分析画面")} · ${project.name}`
      : `${translateUiMessage(`为“${project.name}”选择案例`)} · ${translateUiMessage(`已选择 ${selectedCaseIds.size} 个案例`)}`
    : "";
  elements.projectSelectionSave.textContent = ["vision", "combine"].includes(selectionMode) ? t("继续") : t("保存项目案例");
  elements.projectSelectionSave.disabled = selectionMode === "combine" ? selectedCaseIds.size < 2 : selectionMode === "vision" && !selectedCaseIds.size;
  elements.projectSelectionCount.hidden = !visionSelection;
  elements.projectSelectionCount.textContent = visionSelection
    ? translateUiMessage(`已选 ${selectedCaseIds.size} / 当前 ${filteredEligibleCount} / 全部 ${allEligibleCount}`)
    : "";
  elements.projectSelectionSelectFiltered.hidden = !visionSelection;
  elements.projectSelectionSelectFiltered.disabled = filteredEligibleCount === 0;
  elements.projectSelectionSelectFiltered.textContent = translateUiMessage(`选中当前筛选（${filteredEligibleCount}）`);
  elements.projectSelectionSelectAll.hidden = !visionSelection;
  elements.projectSelectionSelectAll.disabled = allEligibleCount === 0;
  elements.projectSelectionSelectAll.textContent = translateUiMessage(`选中全部可分析（${allEligibleCount}）`);
  elements.projectSelectionClear.hidden = !visionSelection;
  elements.projectSelectionClear.disabled = selectedCaseIds.size === 0;
  elements.shareCount.textContent = currentLocale() === "en" ? `Selected ${selectedCaseIds.size}` : `已选 ${selectedCaseIds.size}`;
  const selectedProject = selectionProjectTargetTouched
    ? elements.selectionProjectTarget.value
    : elements.selectionProjectTarget.value || selectedCollectionId;
  const options = [option("", t("选择项目…"))];
  const selectorLabelsByProject = collectionSelectorLabelsById(organizerState);
  for (const collection of organizerState.collections) {
    options.push(option(collection.id, selectorLabelsByProject.get(collection.id)));
  }
  elements.selectionProjectTarget.replaceChildren(...options);
  elements.selectionProjectTarget.value = organizerState.collections.some((item) => item.id === selectedProject) ? selectedProject : "";
  const targetCollection = organizerState.collections.find((item) => item.id === elements.selectionProjectTarget.value);
  const selectedEntryIds = expandLogicalCaseIds([...selectedCaseIds], compoundCases);
  const targetEntryIds = new Set(targetCollection?.entryIds ?? []);
  const removableCount = selectedEntryIds.filter((id) => targetEntryIds.has(id)).length;
  const projectActionUnavailable = !selectedCaseIds.size || !targetCollection;
  elements.selectionAddProject.disabled = projectActionUnavailable;
  elements.selectionRemoveProject.disabled = projectActionUnavailable || removableCount === 0;
  elements.selectionRemoveProject.title = projectActionUnavailable
    ? "请先选择案例和目标项目"
    : removableCount === 0 ? "所选案例都不在该项目中" : `可移出 ${removableCount} 个案例`;
  elements.selectionSelectFiltered.disabled = selectionMode !== "select" || visibleEntries.length === 0;
  elements.selectionSelectFiltered.hidden = selectedCaseIds.size > 0;
  elements.selectionSelectFiltered.textContent = currentLocale() === "en" ? `Select current (${visibleEntries.length})` : `全选当前（${visibleEntries.length}）`;
  elements.selectionSelectFiltered.setAttribute("aria-label", currentLocale() === "en"
    ? `Select all ${visibleEntries.length} cases in the current filtered results`
    : `全选当前筛选结果，共 ${visibleEntries.length} 个案例`);
  elements.selectionClear.disabled = selectedCaseIds.size === 0;
  elements.selectionSelectedActions.hidden = selectedCaseIds.size === 0;
  elements.selectionAddLabels.disabled = !selectedCaseIds.size || !splitInput(elements.selectionLabelInput.value).length;
  elements.selectionCombine.disabled = selectedCaseIds.size < 2;
  elements.selectionCombine.title = selectedCaseIds.size < 2 ? t("至少选择 2 个案例") : "";
  elements.selectionNewProject.disabled = !selectedCaseIds.size;
  const selectionHasAnalyzableImage = [...selectedCaseIds]
    .some((id) => isVisionSelectableEntry(logicalCases.find((entry) => entry.id === id)));
  elements.selectionAnalyze.disabled = !selectionHasAnalyzableImage;
  elements.selectionAnalyze.title = selectionHasAnalyzableImage ? "" : t("所选案例中没有可分析的图片");
  elements.shareExport.textContent = t("分享");
  elements.shareExport.disabled = !selectedCaseIds.size;
  elements.selectionTrash.disabled = !selectedCaseIds.size;
  if (!selectedCaseIds.size) {
    for (const menu of document.querySelectorAll(".selection-menu[open]")) menu.open = false;
  }
  elements.createCollection.disabled = taskSelecting;
}

function clearVisionSelection() {
  if (selectionMode !== "vision") return;
  selectedCaseIds.clear();
  renderGallery();
}

function selectVisionCases(scope = "filtered") {
  if (selectionMode !== "vision") return;
  selectedCaseIds.clear();
  for (const entry of getVisionSelectableEntries(scope)) selectedCaseIds.add(entry.id);
  renderGallery();
}

function getVisionSelectableEntries(scope = "filtered") {
  if (scope === "filtered") return visibleEntries.filter(isVisionSelectableEntry);
  const collection = organizerState.collections.find((item) => item.id === projectSelectionId || item.id === selectedCollectionId);
  if (!collection) return logicalCases.filter(isVisionSelectableEntry);
  const memberIds = new Set(collectionEntryIds(organizerState, collection.id, { subtree: true }));
  return logicalCases.filter((entry) =>
    isVisionSelectableEntry(entry) &&
    (entry.memberEntryIds?.length
      ? entry.memberEntryIds.every((id) => memberIds.has(id))
      : memberIds.has(entry.id))
  );
}

function isVisionSelectableEntry(entry) {
  const sourceEntries = entry.memberEntryIds?.length
    ? entry.memberEntryIds.map((id) => entries.find((item) => item.id === id)).filter(Boolean)
    : [entry];
  return sourceEntries.some((item) => entryMediaAssets(item).some((asset) => asset.kind === "image" && asset.usage !== "poster"));
}

function completeSelection() {
  return openShareDialog({ entryIds: [...selectedCaseIds], title: t("分享案例") });
}

async function addSelectionToProject() {
  return updateSelectionProjectMembership("add", elements.selectionAddProject);
}

async function removeSelectionFromProject() {
  return updateSelectionProjectMembership("remove", elements.selectionRemoveProject);
}

async function updateSelectionProjectMembership(mode, button) {
  const collection = organizerState.collections.find((item) => item.id === elements.selectionProjectTarget.value);
  if (!collection || !selectedCaseIds.size) return;
  button.disabled = true;
  try {
    const message = buildLibraryBatchPayload([...selectedCaseIds], compoundCases, {
      type: LIBRARY_BATCH_ACTIONS.setProject,
      collectionId: collection.id,
      mode
    });
    const response = await chrome.runtime.sendMessage(message);
    if (!response?.ok) throw new Error(response?.message || (mode === "remove" ? "移出项目失败" : "加入项目失败"));
    organizerState = response.organizerState ?? organizerState;
    showFeedback(response.message || (mode === "remove" ? `已移出项目“${collection.name}”` : `已加入项目“${collection.name}”`));
    exitSelectionMode();
  } catch (error) {
    showFeedback(error.message || (mode === "remove" ? "移出项目失败" : "加入项目失败"), true);
    updateSelectionBar();
  }
}

async function addLabelsToSelection() {
  if (!selectedCaseIds.size) return;
  const customLabels = splitInput(elements.selectionLabelInput.value);
  if (!customLabels.length) return elements.selectionLabelInput.focus();
  const message = buildLibraryBatchPayload([...selectedCaseIds], compoundCases, {
    type: LIBRARY_BATCH_ACTIONS.addCustomLabels,
    customLabels
  });
  const response = await perform(elements.selectionAddLabels, message, false);
  if (!response?.ok) return;
  elements.selectionLabelInput.value = "";
  exitSelectionMode();
  await refreshLibrary();
}

async function moveSelectionToTrash() {
  if (!selectedCaseIds.size) return;
  const logicalCount = selectedCaseIds.size;
  const message = buildLibraryBatchPayload([...selectedCaseIds], compoundCases, {
    type: LIBRARY_BATCH_ACTIONS.moveToTrash
  });
  if (!await confirmAppAction({
    title: `将所选 ${logicalCount} 个案例移入回收站？`,
    description: "案例及其媒体会保留在回收站，可以恢复。",
    confirmLabel: "移入回收站",
    danger: true
  })) return;
  const response = await perform(elements.selectionTrash, message, false);
  if (!response?.ok) return;
  exitSelectionMode();
  await refreshLibrary();
}

async function createProjectFromSelection() {
  if (!selectedCaseIds.size) return;
  const name = await promptAppText({
    title: t("以所选案例新建项目"),
    label: t("项目名称"),
    confirmLabel: t("新建并加入"),
    selectFirst: true
  });
  if (!name?.trim()) return;
  const parentId = organizerState.collections.some((item) => item.id === elements.selectionProjectTarget.value)
    ? elements.selectionProjectTarget.value
    : null;
  const createResponse = await perform(elements.selectionNewProject, { type: "CREATE_COLLECTION", name: name.trim(), parentId }, false);
  if (!createResponse?.ok || !createResponse.created?.id) return;
  organizerState = createResponse.organizerState ?? organizerState;
  const entryIds = expandLogicalCaseIds([...selectedCaseIds], compoundCases);
  const addResponse = await perform(elements.selectionNewProject, {
    type: "REPLACE_COLLECTION_ENTRIES",
    collectionId: createResponse.created.id,
    entryIds
  }, false);
  if (!addResponse?.ok) return;
  organizerState = addResponse.organizerState ?? organizerState;
  showFeedback(`已新建项目“${createResponse.created.name}”并加入所选案例`);
  exitSelectionMode();
}

async function analyzeSelectedCases() {
  const eligibleIds = [...selectedCaseIds].filter((id) => {
    const entry = logicalCases.find((item) => item.id === id);
    return entry && isVisionSelectableEntry(entry);
  });
  if (!eligibleIds.length) return showFeedback("所选案例中没有可分析的图片", true);
  selectedCaseIds.clear();
  eligibleIds.forEach((id) => selectedCaseIds.add(id));
  await openVisionBatchConfirmation();
}

function completeTaskSelection() {
  if (selectionMode === "vision") return openVisionBatchConfirmation();
  if (selectionMode === "combine") return saveCompoundSelection();
  return saveProjectSelection();
}

async function saveCompoundSelection() {
  const selected = [...selectedCaseIds].map((id) => logicalCases.find((entry) => entry.id === id)).filter(Boolean);
  if (selected.length < 2) return showFeedback("至少选择两个案例", true);
  const selectedCompounds = selected.filter((entry) => entry.compoundCase);
  if (selectedCompounds.length > 1) return showFeedback("一次不能合并两个已有复合案例；请先拆分其中一个", true);
  const defaultTitle = selectedCompounds[0]?.title || selected[0]?.title || "未命名组合案例";
  const orderSummary = selected.map((entry, index) => `${index + 1}. ${entry.title}`).join("\n");
  const title = await promptAppText({
    title: "组合案例",
    description: `案例会按当前选择顺序组合，并可随时拆分：\n${orderSummary}`,
    label: "组合后的案例名称",
    value: defaultTitle,
    confirmLabel: "创建组合",
    selectFirst: true
  });
  if (!title?.trim()) return;
  const memberEntryIds = expandLogicalCaseIds(selected.map((entry) => entry.id), compoundCases);
  const message = selectedCompounds.length
    ? { type: "UPDATE_COMPOUND_CASE", compoundCaseId: selectedCompounds[0].id, title: title.trim(), memberEntryIds }
    : { type: "CREATE_COMPOUND_CASE", title: title.trim(), memberEntryIds };
  const response = await perform(elements.projectSelectionSave, message, false);
  if (!response?.ok) return;
  selectionMode = "";
  selectedCaseIds.clear();
  updateSelectionBar();
  await refreshLibrary();
}

async function saveProjectSelection() {
  const collectionId = projectSelectionId;
  const collection = organizerState.collections.find((item) => item.id === collectionId);
  const selectedEntryIds = expandLogicalCaseIds([...selectedCaseIds], compoundCases);
  const selected = new Set(selectedEntryIds);
  const retainedOrder = (collection?.entryIds ?? []).filter((entryId) => selected.has(entryId));
  const retained = new Set(retainedOrder);
  const entryIds = [...retainedOrder, ...selectedEntryIds.filter((entryId) => !retained.has(entryId))];
  elements.projectSelectionSave.disabled = true;
  try {
    const response = await chrome.runtime.sendMessage({
      type: "REPLACE_COLLECTION_ENTRIES",
      collectionId,
      entryIds
    });
    if (!response?.ok) throw new Error(response?.message || "项目案例保存失败");
    organizerState = response.organizerState ?? organizerState;
    selectionMode = "";
    projectSelectionId = "";
    selectedCollectionId = collectionId;
    selectedCaseIds.clear();
    updateSelectionBar();
    showFeedback(response.message);
    await refreshLibrary();
  } catch (error) {
    showFeedback(error.message, true);
  } finally {
    elements.projectSelectionSave.disabled = false;
  }
}

async function shareProjectCollection(collection) {
  const memberIds = new Set(collectionEntryIds(organizerState, collection.id, { subtree: true }));
  const count = new Set([...memberIds].map((id) => logicalIdByEntryId.get(id)).filter(Boolean)).size;
  openShareDialog({ collectionId: collection.id, title: collection.name, count });
}

function openShareDialog({ entryIds = [], collectionId = "", title = "", count = 0 } = {}) {
  const selectedCount = count || entryIds.length;
  if (!selectedCount) return showFeedback(t("请先选择要分享的案例"), true);
  shareDialogContext = { entryIds, collectionId, title, count: selectedCount };
  shareLocalAssetRecords = [];
  submissionDownloadIds = [];
  elements.shareDialogTitle.textContent = title || t("分享案例");
  elements.shareDialogMeta.textContent = t("{count} 个案例", { count: selectedCount });
  elements.shareDialogDisclosure.checked = false;
  elements.shareDialogSubmit.disabled = true;
  elements.shareDialogExport.disabled = true;
  elements.shareDialogResult.hidden = true;
  elements.shareDialogOptions.hidden = false;
  elements.shareDialog.showModal();
  void prepareShareLocalAssetRecords();
}

function closeShareDialog() {
  if (elements.shareDialog.open) elements.shareDialog.close();
  shareDialogContext = null;
  shareLocalAssetRecords = [];
  submissionDownloadIds = [];
}

async function prepareShareLocalAssetRecords() {
  if (!shareDialogContext) return;
  const context = shareDialogContext;
  try {
    const requestedIds = context.collectionId
      ? projectPackageEntryIds({ entries, compoundCases, organizerState }, context.collectionId)
      : expandLogicalCaseIds(context.entryIds, compoundCases);
    const idSet = new Set(requestedIds);
    const linked = entries.filter((entry) => idSet.has(entry.id)).flatMap((entry) =>
      entryMediaAssets(entry)
        .filter((asset) => asset.recordType === LOCAL_ASSET_REFERENCE_RECORD_TYPE)
        .map((asset) => ({ entry, asset }))
    );
    const records = await Promise.all(linked.map(async (item) => ({
      ...item,
      record: await getLocalAssetHandleRecord(item.asset.id)
    })));
    if (shareDialogContext !== context) return;
    shareLocalAssetRecords = records;
    elements.shareDialogMeta.textContent = linked.length
      ? `${t("{count} 个案例", { count: context.count })} · ${linked.length} 个本机源文件将在导出时检查权限`
      : t("{count} 个案例", { count: context.count });
    elements.shareDialogExport.disabled = false;
    elements.shareDialogExport.focus();
  } catch (error) {
    if (shareDialogContext !== context) return;
    elements.shareDialogMeta.textContent = error.message || "无法检查本机源文件链接";
    elements.shareDialogExport.disabled = true;
  }
}

async function authorizeShareLocalAssets() {
  for (const item of shareLocalAssetRecords) {
    const { entry, asset, record } = item;
    if (!record) {
      showFeedback(`“${asset.sourceTitle || entry.title}”的本机链接已丢失，请先在详情中重新链接`, true);
      return false;
    }
    let inspection = await inspectLocalAssetHandle(record, Number.isFinite(Number(asset.sourceLastModified)) ? asset : undefined);
    if (inspection.status === LOCAL_ASSET_LINK_STATUS.NEEDS_PERMISSION) {
      if (typeof record.handle.requestPermission !== "function") {
        showFeedback(`当前浏览器无法重新授权“${asset.sourceTitle}”，请先重新链接源文件`, true);
        return false;
      }
      const permission = await record.handle.requestPermission({ mode: "read" });
      if (permission !== "granted") {
        showFeedback(`你取消了“${asset.sourceTitle}”的读取授权，分享包未导出`, true);
        return false;
      }
      inspection = await inspectLocalAssetHandle(record, Number.isFinite(Number(asset.sourceLastModified)) ? asset : undefined);
    }
    if (inspection.status === LOCAL_ASSET_LINK_STATUS.MISSING) {
      showFeedback(`“${asset.sourceTitle || entry.title}”已移动、改名或删除，请先重新链接；分享包未导出`, true);
      return false;
    }
    if (inspection.status === LOCAL_ASSET_LINK_STATUS.CHANGED) {
      const file = inspection.file;
      const confirmed = await confirmAppAction({
        title: "源文件自上次链接后发生变化",
        description: `“${asset.sourceTitle}”现在是 ${formatBytes(file.size)}。确认后会更新文件信息并把当前版本放入分享包；取消则不导出。`,
        confirmLabel: "使用当前版本"
      });
      if (!confirmed) return false;
      await saveLocalAssetHandle(asset.id, record.handle, file);
      const response = await chrome.runtime.sendMessage({
        type: "UPDATE_LOCAL_ASSET_REFERENCE",
        entryId: entry.id,
        assetId: asset.id,
        sourceTitle: file.name,
        relativePath: file.name,
        sourceFormat: file.name.split(".").at(-1)?.toLocaleLowerCase("en-US") || asset.sourceFormat,
        mimeType: file.type || asset.mimeType || "application/octet-stream",
        byteSize: file.size,
        sourceLastModified: file.lastModified
      });
      if (!response?.ok) throw new Error(response?.message || `无法更新“${file.name}”的文件信息`);
      item.asset = response.asset ?? { ...asset, sourceTitle: file.name, byteSize: file.size, sourceLastModified: file.lastModified };
      item.record = await getLocalAssetHandleRecord(asset.id);
    }
  }
  return true;
}

async function exportFromShareDialog() {
  if (!shareDialogContext) return;
  const context = shareDialogContext;
  elements.shareDialogExport.disabled = true;
  try {
    if (!await authorizeShareLocalAssets()) {
      if (shareDialogContext === context) elements.shareDialogExport.disabled = false;
      return;
    }
    if (shareDialogContext !== context) return;
    const message = context.collectionId
      ? { type: "EXPORT_PROJECT", collectionId: context.collectionId }
      : { type: "EXPORT_ARCHIVE", entryIds: context.entryIds };
    const response = await chrome.runtime.sendMessage(message);
    if (!response?.ok) throw new Error(response?.message || t("无法导出分享包"));
    showFeedback(response.message);
    const selected = Boolean(context.entryIds.length);
    closeShareDialog();
    if (selected) exitSelectionMode();
  } catch (error) {
    showFeedback(error.message || t("无法导出分享包"), true);
    if (shareDialogContext === context) elements.shareDialogExport.disabled = false;
  }
}

async function submitFromShareDialog() {
  if (!shareDialogContext || !elements.shareDialogDisclosure.checked) return;
  elements.shareDialogSubmit.disabled = true;
  elements.shareDialogExport.disabled = true;
  const label = elements.shareDialogSubmit.querySelector("span");
  const original = label.textContent;
  label.textContent = t("正在生成投稿包");
  try {
    const response = await chrome.runtime.sendMessage({
      type: "EXPORT_CURATED_SUBMISSION",
      entryIds: shareDialogContext.entryIds,
      collectionId: shareDialogContext.collectionId
    });
    if (!response?.ok) throw new Error(response?.message || t("无法生成精选投稿包"));
    submissionDownloadIds = response.downloadIds ?? [];
    elements.shareDialogResultText.textContent = response.partCount > 1
      ? t("投稿包已生成，共 {count} 个分卷", { count: response.partCount })
      : t("投稿包已生成");
    elements.shareDialogResult.hidden = false;
    elements.shareDialogOptions.hidden = true;
  } catch (error) {
    showFeedback(error.message || t("无法生成精选投稿包"), true);
    elements.shareDialogSubmit.disabled = false;
    elements.shareDialogExport.disabled = false;
  } finally {
    label.textContent = original;
  }
}

async function showSubmissionFiles() {
  const downloadId = submissionDownloadIds.at(-1);
  if (!Number.isInteger(downloadId)) return;
  await chrome.downloads.show(downloadId);
}

async function openComposerPage(collectionId = "") {
  try {
    const url = new URL(chrome.runtime.getURL("composer.html"));
    if (collectionId) url.searchParams.set("project", collectionId);
    navigateWithinPromptDirector(url);
  } catch (error) {
    showFeedback(error.message || "无法打开创作台", true);
  }
}

function navigateWithinPromptDirector(destination) {
  saveLibraryReturnSnapshot();
  const url = destination instanceof URL ? destination.href : chrome.runtime.getURL(destination);
  location.assign(url);
}

function saveLibraryReturnSnapshot() {
  try {
    sessionStorage.setItem(LIBRARY_RETURN_STORAGE_KEY, serializeLibraryReturnSnapshot({
      collectionId: selectedCollectionId,
      contentId: selectedContentId,
      facetNodeIds: [...selectedFacets.values()].flatMap((nodeIds) => [...nodeIds]),
      pendingOnly: elements.pendingFilter.checked,
      query: elements.searchInput.value,
      scrollY: window.scrollY,
      sortMode: caseSortMode
    }));
  } catch {
  }
}

function restoreLibraryReturnSnapshot() {
  if (libraryReturnRestored) return;
  libraryReturnRestored = true;
  let snapshot = null;
  try {
    snapshot = parseLibraryReturnSnapshot(sessionStorage.getItem(LIBRARY_RETURN_STORAGE_KEY));
  } catch {
  }
  if (!snapshot) return;
  selectedCollectionId = organizerState.collections.some((item) => item.id === snapshot.collectionId)
    ? snapshot.collectionId
    : "";
  caseSortMode = snapshot.sortMode;
  selectedContentId = snapshot.contentId;
  selectedFacets = new Map();
  const nodesById = new Map(facetCatalog.nodes.map((node) => [node.id, node]));
  for (const nodeId of snapshot.facetNodeIds) {
    const node = nodesById.get(nodeId);
    if (!node || node.status === "archived") continue;
    if (!selectedFacets.has(node.facetId)) selectedFacets.set(node.facetId, new Set());
    selectedFacets.get(node.facetId).add(node.id);
  }
  elements.pendingFilter.checked = snapshot.pendingOnly;
  elements.searchInput.value = snapshot.query;
  libraryReturnScrollY = snapshot.scrollY;
}

function restoreLibraryScrollPosition() {
  if (!Number.isFinite(libraryReturnScrollY)) return;
  const scrollY = libraryReturnScrollY;
  libraryReturnScrollY = null;
  requestAnimationFrame(() => requestAnimationFrame(() => window.scrollTo({ top: scrollY, left: 0, behavior: "auto" })));
}

function openRequestedSettings() {
  const requested = new URLSearchParams(location.search).get("settings");
  if (!requested || !["vision", "composer"].includes(requested)) return;
  openSettingsDialog("ai", requested);
  const tab = document.querySelector(`[data-analysis-kind="${requested}"]`);
  tab?.click();
  history.replaceState(null, "", "library.html");
}

async function openRequestedLibraryTarget() {
  const params = new URLSearchParams(location.search);
  const caseId = params.get("case") || "";
  const projectId = params.get("project") || "";
  if (!caseId && !projectId) return;
  try { sessionStorage.removeItem(LIBRARY_RETURN_STORAGE_KEY); } catch {}
  selectedContentId = "";
  selectedFacets.clear();
  caseOrderManagementActive = false;
  projectOrderManagementActive = false;
  elements.pendingFilter.checked = false;
  elements.searchInput.value = "";
  libraryReturnScrollY = null;
  if (caseId && logicalCases.some((entry) => entry.id === caseId)) {
    selectedCollectionId = "";
    renderGallery();
    await openDetail(caseId);
  } else if (projectId && organizerState.collections.some((collection) => collection.id === projectId)) {
    selectedCollectionId = projectId;
    renderGallery();
  } else {
    showFeedback(caseId ? "保存的案例不存在" : "保存的项目不存在", true);
  }
  history.replaceState(null, "", "library.html");
}

async function openVisionBatchConfirmation() {
  if (!selectedCaseIds.size) return showFeedback("请先选择至少一个带图片的案例", true);
  elements.visionBatchFeedback.textContent = "";
  elements.visionBatchAllImages.checked = false;
  elements.visionBatchReanalyze.checked = false;
  await previewSelectedVisionBatch();
  if (!elements.visionBatchDialog.open) elements.visionBatchDialog.showModal();
}

async function previewSelectedVisionBatch() {
  if (visionBatchJob && ["running", "paused"].includes(visionBatchJob.status)) {
    const currentModel = visionSettings.activeProvider === "openai" ? visionSettings.openai.model : visionSettings.compatible.model;
    if (visionBatchJob.providerType !== visionSettings.activeProvider || visionBatchJob.model !== currentModel) {
      try {
        const response = await chrome.runtime.sendMessage({ type: "CANCEL_VISION_BATCH", jobId: visionBatchJob.id });
        if (!response?.ok) throw new Error(response?.message || "无法取消旧批量任务");
        visionBatchJob = response.visionBatchJob;
      } catch (error) {
        showVisionBatchFeedback(error.message || "无法取消旧批量任务", true);
        return;
      }
      return previewSelectedVisionBatch();
    }
    renderVisionBatchDialog();
    return;
  }
  const response = await chrome.runtime.sendMessage({
    type: "PREVIEW_VISION_BATCH",
    entryIds: expandLogicalCaseIds([...selectedCaseIds], compoundCases),
    includeAllImages: elements.visionBatchAllImages.checked,
    reanalyze: elements.visionBatchReanalyze.checked
  });
  if (!response?.ok) return showVisionBatchFeedback(response?.message || "无法生成图片分析预览", true);
  renderVisionBatchDialog(response.preview);
}

function renderVisionBatchDialog(preview = null) {
  const activeJob = visionBatchJob && ["running", "paused"].includes(visionBatchJob.status) ? visionBatchJob : null;
  const job = activeJob ?? (preview ? null : visionBatchJob);
  const active = Boolean(activeJob);
  const source = activeJob ?? preview ?? visionBatchJob ?? {};
  const counts = job?.counts ?? {};
  const requestCount = job?.requestCount ?? preview?.requestCount ?? 0;
  const caseCount = preview?.caseCount ?? new Set(job?.items?.map((item) => item.entryId) ?? []).size;
  const processedCount = Math.min(
    requestCount,
    (counts.succeeded ?? 0) + (counts.failed ?? 0)
  );
  elements.visionBatchSummary.textContent = job
    ? active
      ? currentLocale() === "en"
        ? `${counts.succeeded ?? 0}/${requestCount} completed · ${counts.running ?? 0} processing · ${counts.pending ?? 0} waiting · ${counts.failed ?? 0} failed`
        : `${counts.succeeded ?? 0}/${requestCount} 已完成 · ${counts.running ?? 0} 处理中 · ${counts.pending ?? 0} 等待中 · ${counts.failed ?? 0} 失败`
      : currentLocale() === "en"
        ? `${counts.succeeded ?? 0}/${requestCount} completed · ${counts.failed ?? 0} failed · ${job.requestAttempts || 0} requests · ${job.cacheHitCount || 0} cache hits${analysisFailureCategorySummary(job, "en") ? ` · ${analysisFailureCategorySummary(job, "en")}` : ""}`
        : `${counts.succeeded ?? 0}/${requestCount} 已完成 · ${counts.failed ?? 0} 失败 · 请求 ${job.requestAttempts || 0} 次 · 缓存 ${job.cacheHitCount || 0} 次${analysisFailureCategorySummary(job, "zh-CN") ? ` · ${analysisFailureCategorySummary(job, "zh-CN")}` : ""}`
    : currentLocale() === "en"
      ? `${caseCount} cases · ${requestCount} image requests`
      : `${caseCount} 个案例 · ${requestCount} 次图片请求`;
  elements.visionBatchService.textContent = [source.providerType, source.model].filter(Boolean).join(" · ");
  elements.visionBatchAllImages.disabled = Boolean(active);
  elements.visionBatchReanalyze.disabled = Boolean(active);
  elements.visionBatchProgress.hidden = !job;
  elements.visionBatchProgressBar.max = Math.max(1, requestCount || job?.requestCount || 1);
  elements.visionBatchProgressBar.value = Math.min(processedCount, elements.visionBatchProgressBar.max);
  elements.visionBatchStart.hidden = Boolean(activeJob);
  elements.visionBatchStart.disabled = !requestCount;
  elements.visionBatchPause.hidden = !activeJob || activeJob.status !== "running";
  elements.visionBatchResume.hidden = !activeJob || activeJob.status !== "paused";
  elements.visionBatchRetry.hidden = !job || !counts.failed || job.status === "running";
  elements.visionBatchRetry.textContent = currentLocale() === "en"
    ? `Retry failed (${counts.failed || 0} expected items)`
    : `重试失败项（预计新增 ${counts.failed || 0} 项）`;
  elements.visionBatchCancel.hidden = !active;
  if (job && !active) {
    const total = job.usage?.totalTokens ?? 0;
    const failureMessage = job.items?.find((item) => item.status === "failed")?.error || "";
    const label = job.status === "completed" ? (currentLocale() === "en" ? "Completed" : "全部完成")
      : job.status === "failed" ? (currentLocale() === "en" ? "Failed" : "全部失败")
      : job.status === "canceled" ? (currentLocale() === "en" ? "Canceled" : "已取消")
      : (currentLocale() === "en" ? "Completed with failures" : "已完成，可重试失败项");
    showVisionBatchFeedback(`${label}${failureMessage ? ` · ${failureMessage}` : ""} · ${total} tokens` , job.status === "failed");
  }
}

async function startSelectedVisionBatch() {
  elements.visionBatchStart.disabled = true;
  try {
    const response = await chrome.runtime.sendMessage({
      type: "CREATE_VISION_BATCH",
      entryIds: expandLogicalCaseIds([...selectedCaseIds], compoundCases),
      includeAllImages: elements.visionBatchAllImages.checked,
      reanalyze: elements.visionBatchReanalyze.checked,
      outputLocale: currentLocale()
    });
    if (!response?.ok) throw new Error(response?.message || "无法创建批量画面分析");
    visionBatchJob = response.visionBatchJob;
    renderVisionBatchDialog();
  } catch (error) {
    showVisionBatchFeedback(error.message, true);
  } finally {
    elements.visionBatchStart.disabled = false;
  }
}

async function updateVisionBatchAction(type) {
  if (!visionBatchJob) return;
  try {
    const response = await chrome.runtime.sendMessage({ type, jobId: visionBatchJob.id });
    if (!response?.ok) throw new Error(response?.message || "无法更新批量任务");
    visionBatchJob = response.visionBatchJob;
    showVisionBatchFeedback(response.message);
    renderVisionBatchDialog();
    return response;
  } catch (error) {
    showVisionBatchFeedback(error.message, true);
    return null;
  }
}

function showVisionBatchFeedback(message, isError = false) {
  elements.visionBatchFeedback.textContent = message;
  elements.visionBatchFeedback.classList.toggle("error", isError);
}

function openSettingsDialog(tab = "general", analysisKind = activeAnalysisKind) {
  activeSettingsTab = tab;
  if (tab === "ai" && analysisKind) activeAnalysisKind = analysisKind;
  renderSettingsPanels({ resetActiveScroll: true });
  if (!elements.settingsDialog.open) elements.settingsDialog.showModal();
}

function renderSettingsPanels({ resetActiveScroll = false } = {}) {
  settingsTabs.forEach((button) => button.setAttribute("aria-selected", String(button.dataset.settingsTab === activeSettingsTab)));
  settingsPanels.forEach((panel) => { panel.hidden = panel.dataset.settingsPanel !== activeSettingsTab; });
  if (resetActiveScroll) resetActiveSettingsPanelScroll();
  if (activeSettingsTab === "ai") renderAnalysisSettings();
  if (activeSettingsTab === "tasks") renderBatchManager();
  if (activeSettingsTab === "general") {
    void renderDataSafetyStatus();
    void renderCapturePermissionStatus();
    void refreshExtensionUpdateStatus();
  }
}

async function refreshExtensionUpdateStatus() {
  try {
    const response = await chrome.runtime.sendMessage({ type: "GET_EXTENSION_UPDATE_STATUS" });
    if (!response?.ok || !response.status) throw new Error(response?.status?.lastError || response?.message || "无法读取更新状态");
    renderExtensionUpdateStatus(response.status);
  } catch (error) {
    if (!extensionUpdateStatus) renderExtensionUpdateStatus(null, error?.message || "无法读取更新状态");
  }
}

async function checkExtensionUpdate() {
  elements.checkExtensionUpdate.disabled = true;
  elements.checkExtensionUpdate.setAttribute("aria-busy", "true");
  showUpdateFeedback("正在检查更新…");
  try {
    const response = await chrome.runtime.sendMessage({ type: "CHECK_EXTENSION_UPDATE" });
    if (response?.status) renderExtensionUpdateStatus(response.status);
    if (!response?.ok) throw new Error(response?.status?.lastError || response?.message || "检查更新失败");
    showUpdateFeedback(updateCheckFeedback(response.status));
  } catch (error) {
    showUpdateFeedback(error?.message || "检查更新失败", true);
  } finally {
    elements.checkExtensionUpdate.disabled = false;
    elements.checkExtensionUpdate.removeAttribute("aria-busy");
  }
}

async function applyExtensionUpdate() {
  const status = extensionUpdateStatus;
  if (!status?.canApply || !status.applyBehavior) return;
  const development = status.applyBehavior === "reload_development_directory";
  const confirmed = await confirmAppAction(development ? {
    title: "安全重载当前目录？",
    description: "当前资料库页面会关闭，Chrome 会重新载入你已经选择的本地目录。不会下载或覆盖代码，本地案例和素材不会丢失。",
    confirmLabel: "安全重载"
  } : {
    title: "立即应用更新并重启 PromptDirector？",
    description: "当前资料库页面会关闭，但本地案例和素材不会丢失。",
    confirmLabel: "应用并重启"
  });
  if (!confirmed) return;
  elements.applyExtensionUpdate.disabled = true;
  elements.applyExtensionUpdate.setAttribute("aria-busy", "true");
  showUpdateFeedback(development ? "正在安全重载当前目录…" : "正在应用更新并重启…");
  try {
    const response = await chrome.runtime.sendMessage({ type: "APPLY_EXTENSION_UPDATE" });
    if (response?.status) renderExtensionUpdateStatus(response.status);
    if (!response?.ok) throw new Error(response?.status?.lastError || response?.message || "无法应用更新");
  } catch (error) {
    showUpdateFeedback(error?.message || "无法应用更新", true);
    elements.applyExtensionUpdate.disabled = false;
    elements.applyExtensionUpdate.removeAttribute("aria-busy");
  }
}

function renderExtensionUpdateStatus(nextStatus, fallbackError = "") {
  if (nextStatus) extensionUpdateStatus = { ...(extensionUpdateStatus ?? {}), ...nextStatus };
  const status = extensionUpdateStatus;
  const currentVersion = status?.currentVersion || chrome.runtime.getManifest().version;
  elements.aboutVersion.textContent = `PromptDirector ${currentVersion}`;
  if (!status) {
    elements.updateChannel.textContent = t("安装方式暂不可用");
    elements.updateStatus.textContent = t(fallbackError ? "状态不可用" : "正在检查");
    elements.updateStatus.className = `update-status-badge${fallbackError ? " is-error" : ""}`;
    elements.updateCheckedAt.textContent = t("最近检查：—");
    elements.updateAvailableVersion.textContent = t("可用版本：—");
    elements.updateExplanation.textContent = t("重新打开设置时会再次读取更新状态。");
    showUpdateFeedback(translateUiMessage(fallbackError), Boolean(fallbackError));
    return;
  }

  const development = status.channel === "development";
  elements.updateChannel.textContent = t(development ? "本地开发版 · 手动替换代码" : "商店版 · Chrome 自动更新");
  const updateVersion = status.pendingVersion || status.latestVersion || "—";
  elements.updateCheckedAt.textContent = t("最近检查：{time}", { time: formatUpdateCheckTime(status.checkedAt) });
  elements.updateAvailableVersion.textContent = t("可用版本：{version}", { version: updateVersion });

  const display = updateStatusDisplay(status);
  elements.updateStatus.textContent = t(display.label);
  elements.updateStatus.className = `update-status-badge ${display.className}`.trim();
  elements.updateExplanation.textContent = t(updateExplanation(status));

  const releaseUrl = development && status.updateAvailable ? safeHttpUrl(status.releaseUrl) : "";
  elements.updateReleaseLink.hidden = !releaseUrl;
  if (releaseUrl) elements.updateReleaseLink.href = releaseUrl;
  else elements.updateReleaseLink.removeAttribute("href");

  elements.applyExtensionUpdate.hidden = !status.canApply;
  elements.applyExtensionUpdate.disabled = false;
  elements.applyExtensionUpdate.removeAttribute("aria-busy");
  elements.applyExtensionUpdate.classList.toggle("button-secondary", development);
  elements.applyExtensionUpdate.textContent = t(status.applyBehavior === "reload_development_directory"
    ? "重新载入目录"
    : "应用更新并重启");

  const hasUpdate = Boolean(status.updateAvailable);
  elements.settingsUpdateBadge.hidden = !hasUpdate;
  elements.openSettings.setAttribute("aria-label", t(hasUpdate ? "设置，有可用更新" : "设置"));
  elements.openSettings.title = hasUpdate ? t("设置 · {status}", { status: t(display.label) }) : t("设置");
  showUpdateFeedback(translateUiMessage(status.lastError || ""), Boolean(status.lastError));
}

function updateStatusDisplay(status) {
  if (status.updateKind === "store_downloaded") return { label: "已下载，可应用", className: "is-available" };
  if (status.updateKind === "development_release" || status.updateAvailable) return { label: "发现新版本", className: "is-available" };
  if (status.checkStatus === "error") return { label: "检查失败", className: "is-error" };
  if (status.checkStatus === "no_update") return { label: "已是最新", className: "is-current" };
  if (status.checkStatus === "throttled") return { label: "刚刚检查过", className: "is-current" };
  return { label: "自动更新", className: "" };
}

function updateExplanation(status) {
  if (status.channel === "development") {
    return status.updateAvailable
      ? "发现新的 GitHub Release。扩展无法自行覆盖本机目录；请从链接下载并替换代码，再安全重载。固定 ID 升级无需导出、导入案例。"
      : "本地开发版不会被扩展自行覆盖。安全重载只会重新载入当前目录，不会下载或安装新版本；固定 ID 升级无需导出、导入案例。";
  }
  return status.updateKind === "store_downloaded"
    ? "新版本已由 Chrome 下载。立即应用会关闭当前资料库页面并重启扩展；案例和素材不会丢失。"
    : "商店版由 Chrome 自动更新，无需反复下载插件；更新下载完成后也可以在这里立即应用。";
}

function updateCheckFeedback(status) {
  if (status?.updateAvailable) return t(status.channel === "development" ? "发现新版本，可打开 Release 下载。" : "新版本已下载，可以立即应用。");
  if (status?.checkStatus === "throttled") return t("刚刚检查过，已保留最近结果。");
  return t("已是最新版本。");
}

function formatUpdateCheckTime(value) {
  if (!value) return t("尚未检查");
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return t("尚未检查");
  return date.toLocaleString(currentLocale() === "en" ? "en" : "zh-CN");
}

function showUpdateFeedback(message, isError = false) {
  elements.updateFeedback.textContent = message || "";
  elements.updateFeedback.classList.toggle("error", isError);
}

function resetActiveSettingsPanelScroll() {
  const panel = settingsPanels.find((item) => item.dataset.settingsPanel === activeSettingsTab);
  if (!panel) return;
  panel.scrollTop = 0;
  panel.scrollLeft = 0;
}

function preserveSettingsAnchor(anchor, action = null) {
  const panel = settingsPanels.find((item) => item.dataset.settingsPanel === activeSettingsTab);
  if (!panel || !anchor) return action?.();
  const beforeTop = anchor.getBoundingClientRect().top;
  action?.();
  requestAnimationFrame(() => {
    if (!anchor.isConnected || panel.hidden) return;
    panel.scrollTop += anchor.getBoundingClientRect().top - beforeTop;
  });
}

function backupResourceDiagnostic(code, value, error, context = {}) {
  return {
    code,
    severity: "media",
    action: "dropped",
    ...context,
    assetId: String(value?.assetId || value?.id || "").trim(),
    path: String(value?.assetPath || value?.archivePath || value?.path || "").trim(),
    reason: "unreadable_source",
    message: String(error?.message || "资源无法读取").trim()
  };
}

function folderBackupRescueDescription(reportValue = {}) {
  const diagnostics = Array.isArray(reportValue?.diagnostics) ? reportValue.diagnostics : [];
  const visible = diagnostics.slice(0, 12).map((item) => {
    const subject = String(item?.title || item?.path || item?.assetId || "未命名资源").trim();
    const reason = String(item?.message || item?.reason || "无法完整备份").trim();
    return `“${subject}”：${reason}`;
  });
  const remaining = Math.max(0, diagnostics.length - visible.length);
  const details = [...visible, ...(remaining ? [`另有 ${remaining} 项问题`] : [])].join("；");
  return `预检发现 ${diagnostics.length} 项无法完整写入的资源。继续将剔除这些项目并生成明确标识的救援备份，不会写完整备份标记。${details ? ` ${details}` : ""}`;
}

async function createCompleteFolderBackup() {
  if (dataSafetyOperationActive) return showDataSafetyFeedback("当前操作仍在进行，请等待完成", true);
  if (typeof window.showDirectoryPicker !== "function") return showDataSafetyFeedback("当前浏览器不支持资料夹备份，请使用最新版 Chrome", true);
  setDataSafetyBusy(true);
  try {
    const response = await chrome.runtime.sendMessage({ type: "GET_FOLDER_BACKUP_STATE" });
    if (!response?.ok) throw new Error(response?.message || "无法读取资料库");
    const plannedFiles = new Map();
    const preflightDiagnostics = [];
    const resolvedEntries = [];
    let mediaCount = 0;
    let byteSize = 0;
    const materializeAsset = async (entry, asset, scopeId = entry.id) => {
      if (asset.storageMode === "reference" && asset.recordType !== LOCAL_ASSET_REFERENCE_RECORD_TYPE) return asset;
      const blob = asset.recordType === LOCAL_ASSET_REFERENCE_RECORD_TYPE
        ? await localAssetReferenceBackupBlob(entry, asset)
        : await getMediaBlob(asset.id);
      if (!(blob instanceof Blob)) throw new Error(`“${entry.title || "未命名案例"}”的媒体缺失，完整备份已停止`);
      const portableFormat = resolvePortableAssetFormat(asset, blob);
      const assetPath = folderAssetPath(scopeId, asset, portableFormat);
      showDataSafetyFeedback(`正在检查第 ${mediaCount + 1} 项媒体 · ${formatBytes(byteSize + blob.size)}`);
      plannedFiles.set(assetPath, blob);
      mediaCount += 1;
      byteSize += blob.size;
      return portableManagedBackupAsset(asset, blob, assetPath, await sha256Blob(blob), portableFormat);
    };
    const materializeEntry = async (entryValue, scopeId = "") => {
      let entry = normalizeEntryMedia(entryValue);
      const mediaAssets = [];
      for (const asset of [...entry.mediaAssets]) {
        try {
          mediaAssets.push(await materializeAsset(entry, asset, scopeId || entry.id));
        } catch (error) {
          if (error?.name === "AbortError") throw error;
          preflightDiagnostics.push(backupResourceDiagnostic("library_media_dropped", asset, error, {
            entryId: entry.id,
            title: entry.title
          }));
          entry = removeEntryMedia(entry, asset.id);
        }
      }
      return { ...entry, mediaAssets };
    };
    for (const entryValue of response.entries ?? []) {
      resolvedEntries.push(await materializeEntry(entryValue));
    }
    const trashState = structuredClone(response.trashState ?? { version: 1, items: [] });
    for (const item of trashState.items ?? []) {
      if (item.kind === "entry") {
        item.snapshot = await materializeEntry(item.snapshot, `trash-entry-${item.targetId}`);
      } else if (item.kind === "media") {
        const pseudoEntry = {
          id: item.relationships?.entryId || `trash-media-${item.targetId}`,
          title: item.snapshot?.sourceTitle || "回收站媒体",
          mediaAssets: item.snapshot?.mediaAssets ?? [],
          primaryMediaId: ""
        };
        const materialized = await materializeEntry(pseudoEntry, `trash-media-${pseudoEntry.id}`);
        item.snapshot.mediaAssets = materialized.mediaAssets;
      }
    }
    const creativeRuns = [];
    for (const run of response.creativeRuns ?? []) {
      const outputs = [];
      for (const output of run.outputs ?? []) {
        try {
          const blob = await getMediaBlob(output.visual.id);
          if (!blob) throw new Error("创作结果媒体缺失");
          const portableFormat = resolvePortableAssetFormat(output.visual, blob);
          const assetPath = `creative-results/${safeFolderPart(run.id)}/${safeFolderPart(output.visual.id)}.${portableFormat.extension}`;
          plannedFiles.set(assetPath, blob);
          outputs.push({
            ...output,
            visual: {
              ...output.visual,
              assetPath,
              sourceFormat: portableFormat.extension,
              mimeType: portableFormat.mimeType,
              formatCategory: portableFormat.formatCategory,
              playbackCapability: portableFormat.playbackCapability
            }
          });
          mediaCount += 1;
          byteSize += blob.size;
        } catch (error) {
          if (error?.name === "AbortError") throw error;
          preflightDiagnostics.push(backupResourceDiagnostic("creative_output_dropped", output.visual, error, {
            runId: run.id,
            title: run.title
          }));
        }
      }
      const retainedVisualIds = new Set(outputs.map((output) => output.visual.id));
      creativeRuns.push({
        ...run,
        outputs,
        events: (run.events ?? []).filter((event) => retainedVisualIds.has(event.visualId))
      });
    }
    const creativeSkills = structuredClone(response.creativeSkills ?? { version: 1, items: [] });
    for (const skill of creativeSkills.items ?? []) {
      const packageFiles = [];
      for (const file of skill.packageFiles ?? []) {
        try {
          const blob = await getMediaBlob(file.assetId);
          if (!blob) throw new Error(`外部 Skill 原包文件缺失：${file.path}`);
          const archivePath = skillFolderPath(skill.portableId, file.assetId, file.path);
          plannedFiles.set(archivePath, blob);
          packageFiles.push({
            ...file,
            archivePath,
            byteSize: blob.size,
            mimeType: blob.type || file.mimeType || "application/octet-stream"
          });
          mediaCount += 1;
          byteSize += blob.size;
        } catch (error) {
          if (error?.name === "AbortError") throw error;
          preflightDiagnostics.push(backupResourceDiagnostic("skill_file_dropped", file, error, {
            skillId: skill.id,
            title: skill.callName
          }));
        }
      }
      skill.packageFiles = packageFiles;
    }
    const composerSessions = structuredClone(response.composerSessions ?? []);
    for (const session of composerSessions) {
      for (const reference of session.referenceSnapshots ?? []) {
        if (reference?.sourceType !== "temporary") continue;
        const retainedAssetRefs = [];
        const retainedAssetIds = new Set();
        for (const asset of reference.assetRefs ?? []) {
          try {
            const blob = await getMediaBlob(asset.assetId);
            if (!blob) throw new Error(`临时附件“${asset.name || reference.title || "未命名附件"}”缺失`);
            const portableFormat = resolvePortableAssetFormat({
              ...asset,
              id: asset.assetId,
              sourceTitle: asset.name
            }, blob);
            const archivePath = tempReferenceFolderPath(session.id, asset.assetId, portableFormat);
            plannedFiles.set(archivePath, blob);
            retainedAssetRefs.push({
              ...asset,
              archivePath,
              byteSize: blob.size,
              mimeType: portableFormat.mimeType,
              sourceFormat: portableFormat.extension
            });
            retainedAssetIds.add(asset.assetId);
            mediaCount += 1;
            byteSize += blob.size;
          } catch (error) {
            if (error?.name === "AbortError") throw error;
            preflightDiagnostics.push(backupResourceDiagnostic("temporary_asset_dropped", asset, error, {
              sessionId: session.id,
              title: reference.title
            }));
          }
        }
        reference.assetRefs = retainedAssetRefs;
        reference.imageRefs = (reference.imageRefs ?? [])
          .filter((image) => retainedAssetIds.has(image.visualId));
      }
    }
    const libraryJson = renderLibraryJson(
      resolvedEntries, response.settings, response.taxonomy, response.facetCatalog,
      response.classificationRules, response.organizerState,
      {
        trashState,
        composerSettings: response.composerSettings,
        composerSessions,
        creativeExperimentSettings: response.creativeExperimentSettings,
        creativeRuns,
        creativeSkills
      },
      response.compoundCases
    );
    plannedFiles.set("library.json", new Blob([libraryJson], { type: "application/json" }));
    const plannedLibrary = JSON.parse(libraryJson);
    const initialMediaSizes = [...backupMediaPaths(plannedLibrary)].map((path) => plannedFiles.get(path)?.size ?? 0);
    const initialTotalBytes = initialMediaSizes.reduce((sum, size) => sum + size, 0);
    const initialLargestMedia = Math.max(1, ...initialMediaSizes);
    const inspectPlannedBackup = (sourceType, sourceReport) => inspectLibraryTransfer({
      sourceType,
      library: plannedLibrary,
      files: plannedFiles,
      limits: {
        ...PORTABLE_LIBRARY_LIMITS,
        maxArchiveBytes: Math.max(1, initialTotalBytes),
        maxFileBytes: initialLargestMedia,
        maxImageBytes: initialLargestMedia,
        maxVideoBytes: initialLargestMedia
      },
      validateImage: validateImportedImage,
      sourceReport
    });
    let preflight;
    if (preflightDiagnostics.length) {
      preflight = await inspectPlannedBackup(LIBRARY_TRANSFER_SOURCES.RESCUE_BACKUP, {
        status: "partial",
        diagnostics: preflightDiagnostics,
        stats: {}
      });
    } else {
      try {
        preflight = await inspectPlannedBackup(LIBRARY_TRANSFER_SOURCES.COMPLETE_BACKUP);
      } catch (error) {
        if (error?.name === "AbortError") throw error;
        preflightDiagnostics.push(backupResourceDiagnostic("backup_preflight_degraded", null, error));
        preflight = await inspectPlannedBackup(LIBRARY_TRANSFER_SOURCES.RESCUE_BACKUP, {
          status: "partial",
          diagnostics: preflightDiagnostics,
          stats: {}
        });
      }
    }
    const exportState = preflight.state;
    const finalLibraryJson = renderLibraryJson(
      exportState.entries, exportState.settings, exportState.taxonomy, exportState.facetCatalog,
      exportState.classificationRules, exportState.organizerState,
      {
        trashState: exportState.trashState,
        composerSettings: exportState.composerSettings,
        composerSessions: exportState.composerSessions,
        creativeExperimentSettings: exportState.creativeExperimentSettings,
        creativeRuns: exportState.creativeRuns,
        creativeSkills: exportState.creativeSkills
      },
      exportState.compoundCases
    );
    const finalLibrary = JSON.parse(finalLibraryJson);
    const finalFiles = new Map();
    for (const path of backupMediaPaths(finalLibrary)) {
      const blob = plannedFiles.get(path);
      if (!(blob instanceof Blob)) throw new Error(`预检后的资源“${path}”不可读取`);
      finalFiles.set(path, blob);
    }
    finalFiles.set("library.json", new Blob([finalLibraryJson], { type: "application/json" }));
    const finalMediaSizes = [...backupMediaPaths(finalLibrary)].map((path) => finalFiles.get(path)?.size ?? 0);
    byteSize = finalMediaSizes.reduce((sum, size) => sum + size, 0);
    mediaCount = finalMediaSizes.length;
    const largestPlannedMedia = Math.max(1, ...finalMediaSizes);
    const plannedTotalBytes = byteSize;
    const trashCaseCount = (exportState.trashState?.items ?? []).filter((item) => item.kind === "entry").length;
    const trashProjectCount = (exportState.trashState?.items ?? []).filter((item) => item.kind === "collection").length;
    const writePlan = await buildFolderBackupWritePlan({
      files: finalFiles,
      report: preflight.report,
      metadata: {
      createdAt: new Date().toISOString(),
      caseCount: exportState.entries.length,
      trashCaseCount,
      trashProjectCount,
      mediaCount,
      byteSize
      }
    });
    if (writePlan.mode === "rescue") {
      const approved = await confirmAppAction({
        title: "生成救援备份？",
        description: folderBackupRescueDescription(writePlan.report),
        confirmLabel: "生成救援备份"
      });
      if (!approved) {
        showDataSafetyFeedback("已取消备份，没有创建任何资料夹");
        return;
      }
    }
    const parent = await window.showDirectoryPicker({ mode: "readwrite" });
    const permission = typeof parent.requestPermission === "function" ? await parent.requestPermission({ mode: "readwrite" }) : "granted";
    if (permission !== "granted") throw new Error("没有获得所选资料夹的写入权限");
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const directoryName = writePlan.mode === "rescue" ? `PromptDirector-Rescue-${stamp}` : `PromptDirector-Backup-${stamp}`;
    const directory = await parent.getDirectoryHandle(directoryName, { create: true });
    let writtenCount = 0;
    for (const [path, blob] of writePlan.files) {
      writtenCount += 1;
      showDataSafetyFeedback(`正在写入第 ${writtenCount} / ${writePlan.files.size} 个文件`);
      await writeDirectoryFile(directory, path, blob);
    }
    const writtenFiles = await readDirectoryFiles(directory);
    if (writePlan.mode === "rescue") await verifyFolderRescueCompletion(writePlan.marker, writtenFiles);
    else await verifyFolderBackupCompletion(writePlan.marker, writtenFiles);
    const writtenLibraryFile = writtenFiles.get("library.json");
    if (!(writtenLibraryFile instanceof Blob)) throw new Error("无法回读刚写入的 library.json");
    const writtenLibrary = JSON.parse(await writtenLibraryFile.text());
    const writtenVerification = await inspectLibraryTransfer({
      sourceType: writePlan.mode === "rescue"
        ? LIBRARY_TRANSFER_SOURCES.RESCUE_BACKUP
        : LIBRARY_TRANSFER_SOURCES.COMPLETE_BACKUP,
      library: writtenLibrary,
      files: writtenFiles,
      limits: {
        ...PORTABLE_LIBRARY_LIMITS,
        maxArchiveBytes: Math.max(1, plannedTotalBytes),
        maxFileBytes: largestPlannedMedia,
        maxImageBytes: largestPlannedMedia,
        maxVideoBytes: largestPlannedMedia
      },
      validateImage: validateImportedImage,
      sourceReport: writePlan.report
    });
    assertFolderBackupRoundtrip(exportState.entries, exportState.trashState, writtenVerification.state);
    await writeDirectoryFile(directory, writePlan.markerPath, new Blob([JSON.stringify(writePlan.marker, null, 2)], { type: "application/json" }));
    const completionLabel = writePlan.mode === "rescue" ? "救援备份已完成" : "完整备份已完成";
    showDataSafetyFeedback(`${completionLabel} · ${exportState.entries.length} 个案例 · ${mediaCount} 项媒体 · ${formatBytes(byteSize)}`);
  } catch (error) {
    if (error?.name !== "AbortError") showDataSafetyFeedback(`${error.message}；未写入完成标记的资料夹不会被当作有效备份`, true);
  } finally {
    setDataSafetyBusy(false);
  }
}

async function restoreCompleteFolderBackup() {
  if (dataSafetyOperationActive) return showDataSafetyFeedback("当前操作仍在进行，请等待完成", true);
  if (typeof window.showDirectoryPicker !== "function") return showDataSafetyFeedback("当前浏览器不支持资料夹恢复，请使用最新版 Chrome", true);
  const savedIds = [];
  let applyStarted = false;
  let applySucceeded = false;
  setDataSafetyBusy(true);
  try {
    const directory = await window.showDirectoryPicker({ mode: "read" });
    const files = await readDirectoryFiles(directory);
    const envelope = await inspectFolderBackupEnvelope(files);
    const completion = envelope.marker;
    const libraryFile = envelope.libraryFile;
    let library;
    try { library = JSON.parse(await libraryFile.text()); }
    catch { throw new Error("library.json 已损坏，无法恢复"); }
    const backupPaths = backupMediaPaths(library);
    const backupMediaSizes = [...backupPaths].map((path) => files.get(path)?.size ?? 0);
    const totalBytes = backupMediaSizes.reduce((sum, size) => sum + size, 0);
    if (envelope.mode === "complete" && (
      completion.mediaCount !== backupPaths.size || completion.byteSize !== totalBytes
    )) {
      throw new Error("完整备份的媒体数量或大小校验失败，未写入资料库");
    }
    const largestMediaBytes = Math.max(1, ...backupMediaSizes);
    const restoreLimits = {
      ...PORTABLE_LIBRARY_LIMITS,
      maxArchiveBytes: Math.max(1, totalBytes),
      maxFileBytes: largestMediaBytes,
      maxImageBytes: largestMediaBytes,
      maxVideoBytes: largestMediaBytes
    };
    const inspection = await inspectLibraryTransfer({
      sourceType: envelope.mode === "complete"
        ? LIBRARY_TRANSFER_SOURCES.COMPLETE_BACKUP
        : LIBRARY_TRANSFER_SOURCES.RESCUE_BACKUP,
      library,
      files,
      limits: restoreLimits,
      validateImage: validateImportedImage,
      sourceReport: envelope.report
    });
    const restoredLibrary = inspection.state;
    const restoredResources = inspection.resources;
    const completeBackup = inspection.sourceType === LIBRARY_TRANSFER_SOURCES.COMPLETE_BACKUP;
    const recoveryLabel = t(completeBackup ? "完整恢复" : "救援恢复");
    showDataSafetyFeedback(t("{label}预检完成 · {caseCount} 个案例 · {mediaCount} 项本地媒体 · {byteSize}", {
      label: recoveryLabel,
      caseCount: restoredLibrary.entries.length,
      mediaCount: restoredResources.assets.size,
      byteSize: formatBytes(totalBytes)
    }));
    let preview = await chrome.runtime.sendMessage({
      type: "PREVIEW_LIBRARY_IMPORT",
      library: restoredLibrary,
      sourceType: inspection.sourceType,
      mode: LIBRARY_TRANSFER_MODES.SAFE_MERGE,
      importReport: inspection.report,
      resourceIndex: inspection.resourceIndex
    });
    if (!preview?.ok) throw new Error(preview?.message || "无法检查资料夹备份");
    const conflicts = Array.isArray(preview.conflicts) ? preview.conflicts : [];
    const fields = [
      ...(completeBackup ? [{
        id: "mode",
        label: t("恢复方式"),
        type: "select",
        value: LIBRARY_TRANSFER_MODES.SAFE_MERGE,
        options: [
          { value: LIBRARY_TRANSFER_MODES.SAFE_MERGE, label: t("安全合并（推荐）") },
          { value: LIBRARY_TRANSFER_MODES.EXACT_REPLACE, label: t("恢复成备份当时状态") }
        ],
        help: t("安全合并保留本机资料；精确替换会替换完整备份管理的案例、项目、回收站和关联资料。")
      }] : []),
      ...conflicts.map((conflict, index) => ({
        id: `conflict-${index}`,
        label: t("冲突案例：本机“{localTitle}” / 备份“{incomingTitle}”", {
          localTitle: conflict.localTitle,
          incomingTitle: conflict.incomingTitle
        }),
        type: "select",
        value: conflict.resolution || "keep-local",
        options: [
          { value: "keep-local", label: t("保留本机版本（推荐）") },
          { value: "use-incoming", label: t("使用备份版本") },
          { value: "keep-both", label: t("两个版本都保留") }
        ]
      }))
    ];
    const choice = await showAppDialog({
      title: t(completeBackup ? "选择资料库恢复方式" : "检查救援恢复方案"),
      description: completeBackup
        ? t("已检查 {caseCount} 个案例；发现 {conflictCount} 个内容冲突。安全合并为默认方式。", {
            caseCount: restoredLibrary.entries.length,
            conflictCount: conflicts.length
          })
        : t("这是不完整来源，只能安全合并。已检查 {caseCount} 个案例；发现 {conflictCount} 个内容冲突。", {
            caseCount: restoredLibrary.entries.length,
            conflictCount: conflicts.length
          }),
      fields,
      confirmLabel: t("继续检查"),
      onReady: ({ controls, form }) => {
        const modeControl = controls.get("mode");
        if (!modeControl) return;
        const updateConflictVisibility = () => {
          const exact = modeControl.value === LIBRARY_TRANSFER_MODES.EXACT_REPLACE;
          conflicts.forEach((_, index) => {
            const wrapper = form.querySelector(`[data-field-id="conflict-${index}"]`);
            if (wrapper) wrapper.hidden = exact;
          });
        };
        modeControl.addEventListener("change", updateConflictVisibility);
        updateConflictVisibility();
      }
    });
    if (choice === null) {
      showDataSafetyFeedback(t("已取消恢复，资料库没有变化"));
      return;
    }
    const mode = completeBackup && choice.mode === LIBRARY_TRANSFER_MODES.EXACT_REPLACE
      ? LIBRARY_TRANSFER_MODES.EXACT_REPLACE
      : LIBRARY_TRANSFER_MODES.SAFE_MERGE;
    const conflictResolutions = Object.fromEntries(conflicts.map((conflict, index) => [
      conflict.entryId,
      ["keep-local", "use-incoming", "keep-both"].includes(choice[`conflict-${index}`])
        ? choice[`conflict-${index}`]
        : "keep-local"
    ]));
    preview = await chrome.runtime.sendMessage({
      type: "PREVIEW_LIBRARY_IMPORT",
      library: restoredLibrary,
      sourceType: inspection.sourceType,
      mode,
      conflictResolutions,
      importReport: inspection.report,
      resourceIndex: inspection.resourceIndex
    });
    if (!preview?.ok) throw new Error(translateUiMessage(preview?.message || "无法生成资料夹恢复计划"));
    const resourceWrites = Array.isArray(preview.resourceWrites) ? preview.resourceWrites : [];
    const createdMediaBytes = libraryTransferWriteBytes(resourceWrites, restoredResources);
    const storageEstimate = typeof navigator.storage?.estimate === "function"
      ? await navigator.storage.estimate()
      : {};
    assertStorageCapacity(storageEstimate, createdMediaBytes);
    const report = buildLibraryImportReport(preview, {
      mediaCount: resourceWrites.length,
      byteLabel: formatBytes(createdMediaBytes)
    });
    showDataSafetyFeedback(`${translateUiMessage(report.summary)} · ${t(report.status === "partial" ? "发现可恢复问题，详情见确认框" : "检查通过")}`);
    const exactReplace = mode === LIBRARY_TRANSFER_MODES.EXACT_REPLACE;
    const reportDescription = localizedImportReportDescription(report);
    const approved = await confirmAppAction({
      title: exactReplace
        ? t("将资料库恢复成备份当时状态？")
        : t(completeBackup ? "安全合并资料库备份？" : "按救援方案恢复资料库？"),
      description: exactReplace
        ? `${reportDescription}${t("将写入 {byteSize} 资源，并替换完整备份管理的案例、项目、回收站和关联资料。开始前会自动建立回退点；API Key、同步密码、设备信息和文件夹授权保持本机状态。", { byteSize: formatBytes(createdMediaBytes) })}`
        : `${reportDescription}${t("只会提交预检确认的健康内容；冲突按你的选择处理，其他本机资料不会被覆盖。")}`,
      confirmLabel: t(exactReplace ? "建立回退点并精确恢复" : completeBackup ? "开始安全合并" : "开始救援恢复"),
      danger: exactReplace
    });
    if (!approved) {
      showDataSafetyFeedback(t("已取消恢复，资料库没有变化"));
      return;
    }
    const operationId = createLibraryImportOperationId();
    for (const item of resourceWrites) {
      const blob = item.resourceType === "skill"
        ? restoredResources.skillAssets.get(item.sourceId)
        : restoredResources.assets.get(item.sourceId);
      if (!(blob instanceof Blob)) throw new Error("预检后的备份资源已经变化，请重新检查");
      await savePortableAssetBlob(item.targetId, blob);
      savedIds.push(item.targetId);
    }
    applyStarted = true;
    const response = await applyLibraryImportWithReceipt({
      type: "APPLY_LIBRARY_IMPORT", library: restoredLibrary,
      operationId,
      planToken: preview.planToken,
      plan: preview.plan
    });
    if (!response?.ok) throw new Error(response?.message || "资料夹恢复失败");
    applySucceeded = true;
    await refreshLibrary();
    showDataSafetyFeedback(`${translateUiMessage(response.message)} · ${t("{label}已按预检方案完成", { label: recoveryLabel })}`);
    await renderDataSafetyStatus();
  } catch (error) {
    const retained = applySucceeded
      ? new Set(savedIds)
      : applyStarted ? await committedMediaIds(savedIds) : new Set();
    await Promise.allSettled(savedIds.filter((id) => !retained.has(id)).map((id) => deleteMediaBlob(id)));
    if (error?.name !== "AbortError") showDataSafetyFeedback(error.message, true);
  } finally {
    setDataSafetyBusy(false);
  }
}

async function restoreLastLibraryReplacementPoint() {
  if (dataSafetyOperationActive) return showDataSafetyFeedback(t("当前操作仍在进行，请等待完成"), true);
  const approved = await confirmAppAction({
    title: t("回退上次精确恢复？"),
    description: t("资料库会回到上次精确恢复前的状态；当前状态也会保存成新的回退点，因此仍可再次切换回来。"),
    confirmLabel: t("确认回退"),
    danger: true
  });
  if (!approved) return;
  await runDataSafetyAction(
    elements.restoreLibraryReplacementPoint,
    { type: "RESTORE_LIBRARY_REPLACEMENT_POINT" }
  );
}

async function importSharedLibraryPackage() {
  const file = elements.libraryPackageFile.files?.[0];
  if (!file) return;
  if (dataSafetyOperationActive) {
    elements.libraryPackageFile.value = "";
    return showDataSafetyFeedback("当前操作仍在进行，请等待完成", true);
  }
  const savedIds = [];
  let applyStarted = false;
  let applySucceeded = false;
  setDataSafetyBusy(true);
  try {
    showDataSafetyFeedback(`正在检查 ${file.name}`);
    const packageLimits = {
      ...PORTABLE_LIBRARY_LIMITS,
      maxArchiveBytes: file.size,
      maxFileBytes: file.size,
      maxImageBytes: file.size,
      maxVideoBytes: file.size
    };
    const files = await readZipBlob(file, packageLimits);
    const libraryFile = files.get("library.json");
    if (!libraryFile) throw new Error("分享包缺少 library.json");
    if (libraryFile.size > PORTABLE_LIBRARY_LIMITS.maxLibraryJsonBytes) {
      throw new Error(`library.json 超过 ${formatBytes(PORTABLE_LIBRARY_LIMITS.maxLibraryJsonBytes)} 上限`);
    }
    let library;
    try { library = JSON.parse(await libraryFile.text()); }
    catch { throw new Error("分享包中的 library.json 已损坏"); }
    const inspection = await inspectLibraryTransfer({
      sourceType: LIBRARY_TRANSFER_SOURCES.SHARE_PACKAGE,
      library,
      files,
      limits: packageLimits,
      validateImage: validateImportedImage
    });
    const importLibrary = inspection.state;
    const importResources = inspection.resources;
    const preview = await chrome.runtime.sendMessage({
      type: "PREVIEW_LIBRARY_IMPORT",
      library: importLibrary,
      importReport: inspection.report,
      resourceIndex: inspection.resourceIndex,
      preserveLibraryConfiguration: true
    });
    if (!preview?.ok) throw new Error(preview?.message || "无法检查分享包");
    const resourceWrites = Array.isArray(preview.resourceWrites) ? preview.resourceWrites : [];
    const createdMediaBytes = resourceWrites.reduce((sum, item) =>
      sum + (importResources.assets.get(item.sourceId)?.size ?? 0), 0);
    const report = buildLibraryImportReport(preview, {
      mediaCount: resourceWrites.length,
      byteLabel: formatBytes(createdMediaBytes)
    });
    showDataSafetyFeedback(`${report.summary} · ${report.status === "partial" ? "发现可恢复问题，详情见确认框" : "检查通过"}`);
    const approved = await confirmAppAction({
      title: "导入分享包？",
      description: `${localizedImportReportDescription(report)}${t("现有资料不会被覆盖。")}`,
      confirmLabel: "开始导入"
    });
    if (!approved) return showDataSafetyFeedback("已取消导入，资料库没有变化");
    const operationId = createLibraryImportOperationId();
    for (const item of resourceWrites) {
      const blob = importResources.assets.get(item.sourceId);
      if (!(blob instanceof Blob)) throw new Error("预检后的分享包资源已经变化，请重新检查");
      await savePortableAssetBlob(item.targetId, blob);
      savedIds.push(item.targetId);
    }
    applyStarted = true;
    const response = await applyLibraryImportWithReceipt({
      type: "APPLY_LIBRARY_IMPORT",
      library: importLibrary,
      operationId,
      planToken: preview.planToken,
      plan: preview.plan
    });
    if (!response?.ok) throw new Error(response?.message || "分享包导入失败");
    applySucceeded = true;
    await refreshLibrary();
    showDataSafetyFeedback(`${response.message} · 分享包媒体已校验`);
    await renderDataSafetyStatus();
  } catch (error) {
    const retained = applySucceeded
      ? new Set(savedIds)
      : applyStarted ? await committedMediaIds(savedIds) : new Set();
    await Promise.allSettled(savedIds.filter((id) => !retained.has(id)).map((id) => deleteMediaBlob(id)));
    showDataSafetyFeedback(error.message || "分享包导入失败", true);
  } finally {
    elements.libraryPackageFile.value = "";
    setDataSafetyBusy(false);
  }
}

function createLibraryImportOperationId() {
  return `library-import:${crypto.randomUUID()}`;
}

async function applyLibraryImportWithReceipt(message) {
  try {
    return await chrome.runtime.sendMessage(message);
  } catch (firstError) {
    try {
      return await chrome.runtime.sendMessage(message);
    } catch {
      throw firstError;
    }
  }
}

function backupMediaPaths(library) {
  return new Set([
    ...(library?.entries ?? []).flatMap((entry) => (entry.mediaAssets ?? entry.visuals ?? [])
      .map((asset) => asset.assetPath || asset.screenshotPath).filter(Boolean)),
    ...(library?.creativeRuns ?? []).flatMap((run) => (run.outputs ?? [])
      .map((output) => output.visual?.assetPath || output.visual?.screenshotPath).filter(Boolean)),
    ...(library?.creativeSkills?.items ?? []).flatMap((skill) => (skill.packageFiles ?? [])
      .map((file) => file.archivePath).filter(Boolean)),
    ...(library?.composerSessions ?? []).flatMap((session) => (session.referenceSnapshots ?? [])
      .filter((reference) => reference?.sourceType === "temporary")
      .flatMap((reference) => (reference.assetRefs ?? []).map((asset) => asset.archivePath).filter(Boolean))),
    ...(library?.trashState?.items ?? []).flatMap((item) => {
      if (item?.kind === "entry") {
        return (item.snapshot?.mediaAssets ?? item.snapshot?.visuals ?? [])
          .map((asset) => asset.assetPath || asset.screenshotPath).filter(Boolean);
      }
      if (item?.kind === "media") {
        return (item.snapshot?.mediaAssets ?? [])
          .map((asset) => asset.assetPath || asset.screenshotPath).filter(Boolean);
      }
      return [];
    })
  ]);
}

function assertFolderBackupRoundtrip(entriesValue, trashStateValue, parsed) {
  const expectedEntries = Array.isArray(entriesValue) ? entriesValue : [];
  if (parsed.entries.length !== expectedEntries.length) throw new Error("完整备份自检失败：案例数量不一致");
  const parsedEntries = new Map(parsed.entries.map((entry) => [entry.id, entry]));
  for (const entry of expectedEntries) {
    const restored = parsedEntries.get(entry.id);
    if (!restored || caseSemanticFingerprint(entry) !== caseSemanticFingerprint(restored)) {
      throw new Error(`完整备份自检失败：“${entry.title || entry.id}”回读后内容不一致`);
    }
  }
  const expectedTrash = Array.isArray(trashStateValue?.items) ? trashStateValue.items : [];
  const actualTrash = Array.isArray(parsed.trashState?.items) ? parsed.trashState.items : [];
  if (actualTrash.length !== expectedTrash.length) throw new Error("完整备份自检失败：回收站数量不一致");
  const actualById = new Map(actualTrash.map((item) => [item.id, item]));
  for (const expected of expectedTrash) {
    const actual = actualById.get(expected.id);
    if (!actual || actual.kind !== expected.kind || actual.targetId !== expected.targetId) {
      throw new Error("完整备份自检失败：回收站关系不一致");
    }
    if (stableBackupValue(expected.relationships) !== stableBackupValue(actual.relationships)) {
      throw new Error("完整备份自检失败：回收站关联关系不一致");
    }
    if (expected.kind === "entry" && caseSemanticFingerprint(expected.snapshot) !== caseSemanticFingerprint(actual.snapshot)) {
      throw new Error(`完整备份自检失败：回收站案例“${expected.snapshot?.title || expected.targetId}”内容不一致`);
    }
    if (expected.kind === "collection" && stableBackupValue(expected.snapshot) !== stableBackupValue(actual.snapshot)) {
      throw new Error(`完整备份自检失败：回收站项目“${expected.snapshot?.name || expected.targetId}”内容不一致`);
    }
    if (expected.kind === "media" && stableBackupValue(expected.snapshot) !== stableBackupValue(actual.snapshot)) {
      throw new Error(`完整备份自检失败：回收站媒体“${expected.targetId}”内容不一致`);
    }
  }
}

function stableBackupValue(value) {
  if (Array.isArray(value)) return `[${value.map(stableBackupValue).join(",")}]`;
  if (!value || typeof value !== "object") return JSON.stringify(value);
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableBackupValue(value[key])}`).join(",")}}`;
}

async function localAssetReferenceBackupBlob(entry, asset) {
  const record = await getLocalAssetHandleRecord(asset.id);
  if (!record) throw new Error(`“${asset.sourceTitle || entry.title || "未命名素材"}”的本机链接已丢失，完整备份已停止`);
  let inspection = await inspectLocalAssetHandle(record, asset);
  if (inspection.status === LOCAL_ASSET_LINK_STATUS.NEEDS_PERMISSION) {
    if (typeof record.handle.requestPermission !== "function") {
      throw new Error(`“${asset.sourceTitle || entry.title || "未命名素材"}”需要重新授权，完整备份已停止`);
    }
    const permission = await record.handle.requestPermission({ mode: "read" });
    if (permission !== "granted") {
      throw new Error(`没有获得“${asset.sourceTitle || entry.title || "未命名素材"}”的读取权限，完整备份已停止`);
    }
    inspection = await inspectLocalAssetHandle(record, asset);
  }
  if (![LOCAL_ASSET_LINK_STATUS.READY, LOCAL_ASSET_LINK_STATUS.CHANGED].includes(inspection.status) || !(inspection.file instanceof Blob)) {
    throw new Error(`“${asset.sourceTitle || entry.title || "未命名素材"}”无法读取，完整备份已停止`);
  }
  return inspection.file;
}

function portableManagedBackupAsset(asset, blob, assetPath, contentHash, portableFormat) {
  const {
    recordType: _recordType,
    linkStatus: _linkStatus,
    importFailure: _importFailure,
    sourceLastModified: _sourceLastModified,
    linkedAt: _linkedAt,
    localPath: _localPath,
    absolutePath: _absolutePath,
    fileHandle: _fileHandle,
    handle: _handle,
    reference: _reference,
    relativePath: _relativePath,
    ...portable
  } = asset;
  return {
    ...portable,
    storageMode: "managed",
    sourceFormat: portableFormat.extension,
    mimeType: portableFormat.mimeType,
    formatCategory: portableFormat.formatCategory,
    playbackCapability: portableFormat.playbackCapability,
    byteSize: blob.size,
    contentHash,
    assetPath
  };
}

function skillFolderPath(portableId, assetId, packagePath) {
  const parts = String(packagePath ?? "").split("/").filter(Boolean).map(safeFolderPart);
  if (!parts.length) throw new Error("外部 Skill 原包路径无效");
  return ["skills", safeFolderPart(portableId), safeFolderPart(assetId), ...parts].join("/");
}

function tempReferenceFolderPath(sessionId, assetId, portableFormat) {
  return `temp-references/${safeFolderPart(sessionId)}/${safeFolderPart(assetId)}.${portableFormat.extension}`;
}

async function writeDirectoryFile(root, path, data) {
  const parts = path.split("/").filter(Boolean);
  const filename = parts.pop();
  let directory = root;
  for (const part of parts) directory = await directory.getDirectoryHandle(part, { create: true });
  const handle = await directory.getFileHandle(filename, { create: true });
  const writable = await handle.createWritable();
  try {
    await writable.write(data);
    await writable.close();
  } catch (error) {
    await writable.abort().catch(() => undefined);
    throw error;
  }
}

async function readDirectoryFiles(directory, prefix = "") {
  const files = new Map();
  for await (const [name, handle] of directory.entries()) {
    const path = prefix ? `${prefix}/${name}` : name;
    if (handle.kind === "file") files.set(path, await handle.getFile());
    else {
      const nested = await readDirectoryFiles(handle, path);
      for (const item of nested) files.set(...item);
    }
  }
  return files;
}

function folderAssetPath(entryId, asset, portableFormat) {
  return `${portableFormat.directory}/${safeFolderPart(entryId)}/${safeFolderPart(asset.id)}.${portableFormat.extension}`;
}

function safeFolderPart(value) {
  const safe = String(value ?? "").replace(/[^A-Za-z0-9._-]/g, "-");
  if (!safe || safe === "." || safe === "..") throw new Error("媒体编号无效");
  return safe;
}

async function importCreativeExperimentArchive() {
  const file = elements.creativeExperimentFile.files?.[0];
  if (!file) return;
  const savedAssets = [];
  let applied = false;
  elements.importCreativeExperiments.disabled = true;
  try {
    showFeedback(`正在检查 ${file.name}…`);
    const files = await readZipBlob(file);
    const dataFile = files.get("experiments.json");
    if (!dataFile) throw new Error("ZIP 中没有 experiments.json");
    let experiments;
    try {
      experiments = JSON.parse(await dataFile.text());
    } catch {
      throw new Error("experiments.json 已损坏，无法读取");
    }
    const parsed = parseCreativeExperimentPackage(experiments, files);
    await validateImportedImageDimensions(parsed.images);
    const preview = await chrome.runtime.sendMessage({
      type: "PREVIEW_CREATIVE_EXPERIMENT_IMPORT",
      experiments
    });
    if (!preview?.ok) throw new Error(preview?.message || "无法检查创作实验包");
    for (const [sourceId, targetId] of Object.entries(preview.visualIdMap ?? {})) {
      const asset = parsed.assets.get(sourceId);
      if (!asset) throw new Error("创作实验包中的媒体映射不完整");
      if (asset.type.startsWith("video/")) await saveMediaBlob(targetId, asset);
      else await saveScreenshotBlob(targetId, asset);
      savedAssets.push({ id: targetId, video: asset.type.startsWith("video/") });
    }
    const response = await chrome.runtime.sendMessage({
      type: "APPLY_CREATIVE_EXPERIMENT_IMPORT",
      experiments,
      sessionIdMap: preview.sessionIdMap,
      runIdMap: preview.runIdMap,
      visualIdMap: preview.visualIdMap
    });
    if (!response?.ok) throw new Error(response?.message || "创作实验包导入失败");
    applied = true;
    await refreshLibrary();
    showFeedback(response.message);
  } catch (error) {
    if (!applied) await Promise.allSettled(savedAssets.map((asset) => asset.video ? deleteMediaBlob(asset.id) : deleteScreenshotBlob(asset.id)));
    showFeedback(error.message, true);
  } finally {
    elements.creativeExperimentFile.value = "";
    elements.importCreativeExperiments.disabled = false;
  }
}

async function committedMediaIds(ids) {
  try {
    const response = await chrome.runtime.sendMessage({ type: "GET_STATE" });
    if (!response?.ok) return new Set(ids);
    const targets = new Set(ids);
    const retained = [
      ...(response.entries ?? []).flatMap((entry) => entry.mediaAssets ?? entry.visuals ?? []).map((asset) => asset.id),
      ...(response.creativeSkills?.items ?? []).flatMap((skill) => skill.packageFiles ?? []).map((file) => file.assetId),
      ...(response.creativeRuns ?? []).flatMap((run) => run.outputs ?? []).map((output) => output.visual?.id),
      ...(response.composerSessions ?? []).flatMap((session) => session.referenceSnapshots ?? [])
        .flatMap((reference) => reference.assetRefs ?? []).map((asset) => asset.assetId),
      ...(response.trashState?.items ?? []).flatMap((item) => {
        if (item?.kind === "entry") return item.snapshot?.mediaAssets ?? item.snapshot?.visuals ?? [];
        if (item?.kind === "media") return item.snapshot?.mediaAssets ?? [];
        return [];
      }).map((asset) => asset.id)
    ];
    return new Set(retained.filter((id) => targets.has(id)));
  } catch {
    return new Set(ids);
  }
}

async function validateImportedImageDimensions(images) {
  for (const image of images.values()) {
    await validateImportedImage(image);
  }
}

async function validateImportedImage(image) {
  const metadata = await readImageDimensions(image);
  assertImageDimensions(metadata.width, metadata.height);
}

async function hydrateCardImage(image) {
  const visualId = image.dataset.visualId;
  if (!visualId || image.src) return;
  try {
    let promise = loadingImages.get(visualId);
    if (!promise) {
      promise = scheduleThumbnail(() => createThumbnailUrl(visualId));
      loadingImages.set(visualId, promise);
    }
    const url = await promise;
    if (url && image.isConnected) {
      const dimensions = imageDimensions({ id: visualId });
      const wrap = image.closest(".case-image-wrap");
      if (dimensions && wrap && !wrap.style.aspectRatio) {
        wrap.style.aspectRatio = `${dimensions.width} / ${dimensions.height}`;
        wrap.classList.add("case-image-wrap-fixed");
      }
      image.src = url;
    }
  } catch {
    image.closest(".case-image-wrap")?.replaceWith(textEl("div", "case-shot-missing", "截图读取失败"));
  } finally {
    loadingImages.delete(visualId);
  }
}

function scheduleThumbnail(task) {
  return new Promise((resolve, reject) => {
    thumbnailQueue.push({ task, resolve, reject });
    runNextThumbnails();
  });
}

function runNextThumbnails() {
  while (activeThumbnails < thumbnailConcurrency && thumbnailQueue.length) {
    const queued = thumbnailQueue.shift();
    activeThumbnails += 1;
    Promise.resolve()
      .then(queued.task)
      .then(queued.resolve, queued.reject)
      .finally(() => {
        activeThumbnails -= 1;
        runNextThumbnails();
      });
  }
}

async function createThumbnailUrl(visualId) {
  if (thumbnailUrls.has(visualId)) return thumbnailUrls.get(visualId);
  const derived = await getDerivedMedia(visualId).catch(() => null);
  if (derived?.thumbnail) {
    await cacheImageDimensions(visualId, derived.thumbnail);
    const url = URL.createObjectURL(derived.thumbnail);
    thumbnailUrls.set(visualId, url);
    return url;
  }
  const blob = await screenshotBlob(visualId);
  if (!blob) return "";
  if (blob.size > PORTABLE_LIBRARY_LIMITS.maxImageBytes) {
    throw new Error(`图片超过 ${formatBytes(PORTABLE_LIBRARY_LIMITS.maxImageBytes)} 上限`);
  }
  const metadata = await readImageDimensions(blob);
  assertImageDimensions(metadata.width, metadata.height);
  await cacheImageDimensions(visualId, blob, metadata);
  let bitmap;
  try {
    bitmap = await createImageBitmap(blob);
  } catch {
    const url = URL.createObjectURL(blob);
    thumbnailUrls.set(visualId, url);
    return url;
  }
  try {
    assertImageDimensions(bitmap.width, bitmap.height);
    const maxWidth = 640;
    if (bitmap.width <= maxWidth) {
      const url = URL.createObjectURL(blob);
      thumbnailUrls.set(visualId, url);
      return url;
    }
    const canvas = document.createElement("canvas");
    canvas.width = maxWidth;
    canvas.height = Math.max(1, Math.round(bitmap.height * maxWidth / bitmap.width));
    canvas.getContext("2d", { alpha: false }).drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const thumbnail = await canvasBlob(canvas, "image/webp", 0.76);
    await saveDerivedMedia(visualId, { ...derived, thumbnail }).catch(() => undefined);
    const url = URL.createObjectURL(thumbnail);
    thumbnailUrls.set(visualId, url);
    return url;
  } finally {
    bitmap.close();
  }
}

async function cacheImageDimensions(visualId, blob, dimensionsValue = null) {
  if (imageDerivedMetadata.get(visualId)?.width && imageDerivedMetadata.get(visualId)?.height) return;
  const dimensions = dimensionsValue ?? await readImageDimensions(blob);
  assertImageDimensions(dimensions.width, dimensions.height);
  const cached = imageDerivedMetadata.get(visualId) ?? await getDerivedMetadata(visualId).catch(() => null);
  const saved = await saveDerivedMetadata(visualId, {
    ...cached,
    width: dimensions.width,
    height: dimensions.height,
    mimeType: blob.type,
    byteSize: blob.size
  }).catch(() => null);
  if (saved) imageDerivedMetadata.set(visualId, saved);
}

function renderContentFilters(sourceEntries = entries) {
  const contentTypes = taxonomy.nodes;
  const counts = new Map();
  for (const entry of sourceEntries) {
    for (const id of entryContentTypeIds(entry)) counts.set(id, (counts.get(id) ?? 0) + 1);
  }
  elements.contentFilters.replaceChildren(...contentTypes.map((item) => {
    const id = item.id;
    const name = contentLabel(id);
    const count = counts.get(id) ?? 0;
    const row = el("div", "content-filter-row");
    const button = el("button", "content-filter-option");
    button.type = "button";
    button.dataset.contentFilterId = id;
    button.setAttribute("aria-pressed", String(selectedContentId === id));
    button.setAttribute("aria-label", `${name} ${count}`);
    const meta = el("span", "content-filter-meta");
    meta.append(rawTextEl("span", "content-filter-count", String(count)));
    if (item.visibility === CONTENT_TYPE_VISIBILITY.categoryOnly) {
      meta.append(textEl("span", "content-visibility", "仅分类"));
    }
    button.append(
      createUiIcon(contentRoleIconName(item.role)),
      rawTextEl("span", "content-filter-name", name),
      meta
    );
    button.addEventListener("click", () => {
      selectedContentId = selectedContentId === id ? "" : id;
      renderStructuredFilterResults();
    });
    const menu = el("details", "content-filter-menu project-menu");
    const summary = el("summary", "");
    summary.append(createUiIcon("ellipsis"));
    summary.setAttribute("aria-label", `${t("管理分类")}：${name}`);
    summary.title = `${t("管理分类")}：${name}`;
    const actions = el("div", "project-menu-panel");
    const visibility = textEl(
      "button",
      "button-secondary",
      item.visibility === CONTENT_TYPE_VISIBILITY.categoryOnly ? "在资料库中显示" : "仅在分类内显示"
    );
    visibility.addEventListener("click", () => updateContentTypeVisibility(item, visibility));
    actions.append(visibility);
    menu.append(summary, actions);
    row.append(button, menu);
    return row;
  }));
}

async function updateContentTypeVisibility(contentType, button) {
  const visibility = contentType.visibility === CONTENT_TYPE_VISIBILITY.categoryOnly
    ? CONTENT_TYPE_VISIBILITY.library
    : CONTENT_TYPE_VISIBILITY.categoryOnly;
  const response = await perform(button, {
    type: "SET_CONTENT_TYPE_VISIBILITY",
    contentId: contentType.id,
    visibility
  }, false);
  if (!response?.ok) return;
  taxonomy = response.taxonomy;
  renderGallery();
}

function contentRoleIconName(role) {
  if ([CONTENT_ROLES.promptVideo, CONTENT_ROLES.videoCase].includes(role)) return "video";
  if ([CONTENT_ROLES.promptImage, CONTENT_ROLES.imageCase].includes(role)) return "image";
  if (role === CONTENT_ROLES.tutorial) return "library";
  return "file-text";
}

function renderFacetFilters(sourceEntries = entries) {
  const activeNodes = new Map(facetCatalog.nodes
    .filter((item) => item.status === "active")
    .map((item) => [item.id, item]));
  const nodeCounts = new Map();
  const facetCounts = new Map();
  for (const entry of sourceEntries) {
    const usedNodes = new Set();
    const usedFacets = new Set();
    for (const assignment of entry.facetAssignments ?? []) {
      if (assignment.status !== "confirmed") continue;
      usedFacets.add(assignment.facetId);
      let node = activeNodes.get(assignment.nodeId);
      while (node && !usedNodes.has(node.id)) {
        usedNodes.add(node.id);
        node = activeNodes.get(node.parentId);
      }
    }
    usedNodes.forEach((nodeId) => nodeCounts.set(nodeId, (nodeCounts.get(nodeId) ?? 0) + 1));
    usedFacets.forEach((facetId) => facetCounts.set(facetId, (facetCounts.get(facetId) ?? 0) + 1));
  }
  const countFor = (nodeId) => nodeCounts.get(nodeId) ?? 0;
  const selectedNodeIds = new Set([...selectedFacets.values()].flatMap((value) => [...value]));
  const navigation = detailNavigation(facetCatalog, sourceEntries, selectedNodeIds);
  const sections = [];
  for (const facet of facetCatalog.facets.filter((item) => item.status === "active").sort((a, b) => a.order - b.order)) {
    const selected = selectedFacets.get(facet.id) ?? new Set();
    const usageCount = facetCounts.get(facet.id) ?? 0;
    const nodes = facetNodes(facetCatalog, facet.id);
    const details = el("details", "facet-filter");
    details.dataset.facetId = facet.id;
    details.dataset.usageCount = String(usageCount);
    details.style.setProperty("--facet-color", facet.color);
    details.open = Boolean(selected.size);
    const summary = el("summary", "");
    summary.append(rawTextEl("span", "", facetDisplayName(facet)), rawTextEl("span", "facet-filter-count", selected.size ? translateUiMessage(`已选 ${selected.size}`) : `${usageCount}`));
    details.append(summary);
    const body = el("div", "facet-filter-body");
    for (const parent of nodes.filter((item) => !item.parentId)) {
      const visibleChildren = navigation.byGroup.get(parent.id) ?? [];
      const group = el("div", "facet-group");
      const heading = el("div", "facet-group-title");
      heading.append(createFacetFilterButton(parent, selected, countFor(parent.id), facet));
      group.append(heading);
      const childWrap = el("div", "facet-children");
      for (const child of visibleChildren) {
        childWrap.append(createFacetFilterButton(child, selected, countFor(child.id), facet));
      }
      if (childWrap.childElementCount) group.append(childWrap);
      body.append(group);
    }
    details.append(body);
    sections.push({ details, usageCount, selectedCount: selected.size, order: facet.order });
  }
  sections.sort((a, b) => a.order - b.order);
  elements.facetFilters.replaceChildren(...sections.map((item) => item.details));
}

function createFacetFilterButton(node, selected, count, facet) {
  const button = el("button", "filter-option facet-option-row");
  button.type = "button";
  button.dataset.facetId = facet.id;
  button.dataset.facetNodeId = node.id;
  button.style.setProperty("--facet-color", facet.color);
  button.setAttribute("aria-pressed", String(selected.has(node.id)));
  const displayName = facetDisplayName(node);
  button.setAttribute("aria-label", `${displayName} ${count}`);
  const check = el("span", "facet-option-check");
  check.append(createUiIcon("check"));
  button.append(check, rawTextEl("span", "facet-option-name", displayName), rawTextEl("span", "facet-option-count", String(count)));
  button.addEventListener("click", () => {
    const next = new Set(selectedFacets.get(facet.id) ?? []);
    next.has(node.id) ? next.delete(node.id) : next.add(node.id);
    if (next.size) selectedFacets.set(facet.id, next); else selectedFacets.delete(facet.id);
    renderStructuredFilterResults();
  });
  return button;
}

function syncStructuredFilterControls() {
  for (const button of elements.contentFilters.querySelectorAll("[data-content-filter-id]")) {
    button.setAttribute("aria-pressed", String(button.dataset.contentFilterId === selectedContentId));
  }
  for (const button of elements.facetFilters.querySelectorAll("[data-facet-id][data-facet-node-id]")) {
    const selected = selectedFacets.get(button.dataset.facetId) ?? new Set();
    button.setAttribute("aria-pressed", String(selected.has(button.dataset.facetNodeId)));
  }
  for (const details of elements.facetFilters.querySelectorAll(".facet-filter[data-facet-id]")) {
    const selectedCount = selectedFacets.get(details.dataset.facetId)?.size ?? 0;
    const count = details.querySelector(".facet-filter-count");
    if (count) count.textContent = selectedCount
      ? translateUiMessage(`已选 ${selectedCount}`)
      : details.dataset.usageCount || "0";
    if (selectedCount) details.open = true;
  }
}

function renderActiveFilters() {
  activeFilterCount = Number(Boolean(selectedCollectionId)) +
    Number(Boolean(selectedContentId)) +
    [...selectedFacets.values()].reduce((count, ids) => count + ids.size, 0) +
    Number(elements.pendingFilter.checked) +
    Number(Boolean(elements.searchInput.value.trim()));
  renderFilterToggleState();
}

function renderFilterToggleState() {
  const collapsed = workspace.classList.contains("filters-collapsed");
  if (collapsed && activeFilterCount) elements.toggleFilters.dataset.filterCount = String(activeFilterCount);
  else delete elements.toggleFilters.dataset.filterCount;
  const label = activeFilterCount
    ? currentLocale() === "en"
      ? `Expand or collapse filters, ${activeFilterCount} active`
      : `展开或收起筛选，当前 ${activeFilterCount} 个筛选`
    : t("展开或收起筛选");
  elements.toggleFilters.setAttribute("aria-label", label);
  elements.toggleFilters.title = label;
}

function sidebarWidthLimit() {
  return Math.max(SIDEBAR_WIDTH_LIMITS.min, Math.min(SIDEBAR_WIDTH_LIMITS.max, Math.floor(innerWidth * 0.45)));
}

function applySidebarWidth(value) {
  const width = Math.min(normalizeSidebarWidth(value), sidebarWidthLimit());
  workspace.style.setProperty("--sidebar-width", `${width}px`);
  elements.sidebarResizer.setAttribute("aria-valuemax", String(sidebarWidthLimit()));
  elements.sidebarResizer.setAttribute("aria-valuenow", String(width));
  return width;
}

async function saveSidebarWidth(value) {
  const sidebarWidth = normalizeSidebarWidth(value);
  uiPreferences = await updateUiPreferences({ ...uiPreferences, sidebarWidth });
  applySidebarWidth(sidebarWidth);
}

function bindSidebarResize() {
  applySidebarWidth(uiPreferences.sidebarWidth);
  let pointerId = null;
  let originX = 0;
  let originWidth = uiPreferences.sidebarWidth;
  elements.sidebarResizer.addEventListener("pointerdown", (event) => {
    if (innerWidth <= 900 || workspace.classList.contains("filters-collapsed")) return;
    pointerId = event.pointerId;
    originX = event.clientX;
    originWidth = Number.parseInt(getComputedStyle(workspace).getPropertyValue("--sidebar-width"), 10) || uiPreferences.sidebarWidth;
    elements.sidebarResizer.setPointerCapture(pointerId);
    elements.sidebarResizer.classList.add("is-resizing");
    event.preventDefault();
  });
  elements.sidebarResizer.addEventListener("pointermove", (event) => {
    if (event.pointerId !== pointerId) return;
    applySidebarWidth(originWidth + event.clientX - originX);
  });
  const finishPointerResize = (event) => {
    if (event.pointerId !== pointerId) return;
    const width = Number(elements.sidebarResizer.getAttribute("aria-valuenow"));
    pointerId = null;
    elements.sidebarResizer.classList.remove("is-resizing");
    void saveSidebarWidth(width);
  };
  elements.sidebarResizer.addEventListener("pointerup", finishPointerResize);
  elements.sidebarResizer.addEventListener("pointercancel", finishPointerResize);
  elements.sidebarResizer.addEventListener("keydown", (event) => {
    if (innerWidth <= 900 || !["ArrowLeft", "ArrowRight"].includes(event.key)) return;
    event.preventDefault();
    const current = Number(elements.sidebarResizer.getAttribute("aria-valuenow"));
    const next = applySidebarWidth(current + (event.key === "ArrowRight" ? 16 : -16));
    void saveSidebarWidth(next);
  });
  addEventListener("resize", () => applySidebarWidth(uiPreferences.sidebarWidth), { passive: true });
}

function clearFilters() {
  selectedCollectionId = "";
  caseOrderManagementActive = false;
  projectOrderManagementActive = false;
  selectedContentId = "";
  selectedFacets.clear();
  elements.pendingFilter.checked = false;
  elements.searchInput.value = "";
  renderGallery();
}

async function openDetail(entryId, { preserveQueue = false, returnFocus = null } = {}) {
  if (currentDetailId && currentDetailId !== entryId && !await confirmPromptEditDiscard()) return false;
  const changedEntry = currentDetailId !== entryId;
  if (!preserveQueue) detailQueueMode = elements.pendingFilter.checked ? "pending" : "";
  currentDetailId = entryId;
  if (returnFocus) detailReturnFocus = returnFocus;
  document.documentElement.classList.add("detail-open");
  elements.detailDrawer.classList.add("open");
  elements.detailDrawer.setAttribute("aria-hidden", "false");
  elements.drawerBackdrop.hidden = false;
  await renderDetail({ resetScroll: changedEntry });
  elements.detailClose.focus();
  return true;
}

async function closeDetail() {
  if (!await confirmPromptEditDiscard()) return false;
  const returnFocus = detailReturnFocus;
  if (elements.imageLightbox.open) elements.imageLightbox.close();
  currentDetailId = null;
  detailReturnFocus = null;
  detailQueueMode = "";
  document.documentElement.classList.remove("detail-open");
  elements.detailDrawer.removeAttribute("data-entry-id");
  elements.detailDrawer.classList.remove("open");
  elements.detailDrawer.setAttribute("aria-hidden", "true");
  elements.drawerBackdrop.hidden = true;
  releaseDetailControllers();
  releaseDetailMediaUrls();
  returnFocus?.focus();
  return true;
}

function moveDetail(offset) {
  const index = visibleEntries.findIndex((entry) => entry.id === currentDetailId);
  if (index < 0) return;
  const target = visibleEntries[index + offset];
  if (target) openDetail(target.id, { preserveQueue: true });
}

async function confirmPromptEditDiscard() {
  if (!promptEditState?.dirty) {
    promptEditState = null;
    return true;
  }
  if (!await confirmAppAction({
    title: "放弃未保存的提示词修改？",
    description: "离开后，本次尚未保存的文字修改会丢失。",
    confirmLabel: "放弃修改",
    danger: true
  })) return false;
  promptEditState = null;
  return true;
}

async function renderDetail({ resetScroll = false } = {}) {
  const renderGeneration = ++detailRenderGeneration;
  const renderEntryId = currentDetailId;
  releaseDetailControllers();
  releaseDetailMediaUrls();
  const entry = logicalCases.find((item) => item.id === currentDetailId);
  if (!entry) return closeDetail();
  const visibleIndex = visibleEntries.findIndex((item) => item.id === entry.id);
  elements.detailPrev.disabled = visibleIndex <= 0;
  elements.detailNext.disabled = visibleIndex < 0 || visibleIndex >= visibleEntries.length - 1;
  const content = document.createDocumentFragment();
  const body = el("div", "detail-body");
  const hasPrimaryMedia = entryHasMedia(entry);
  const capturedPost = isCapturedPost(entry);
  const hasArticleDocument = !capturedPost && Boolean(entry.articleDocument?.blocks?.length);
  const usesStageNavigation = !capturedPost && !hasArticleDocument && (entryHasMedia(entry, "image") || entryHasMedia(entry, "video"));
  elements.detailContent.classList.toggle("has-primary-media", hasPrimaryMedia && !hasArticleDocument && !capturedPost);
  elements.detailContent.classList.toggle("is-compound-detail", Boolean(entry.compoundCase));
  elements.drawerToolbar.classList.toggle("has-document-navigation", Boolean(entry.compoundCase) || !usesStageNavigation);
  if (entry.compoundCase) {
    elements.drawerToolbar.prepend(elements.detailNavigation);
    await renderCompoundDetail(entry, content, body);
    if (renderGeneration !== detailRenderGeneration || currentDetailId !== renderEntryId) return;
    content.append(body);
    elements.detailDrawer.dataset.entryId = entry.id;
    elements.detailContent.replaceChildren(content);
    if (resetScroll) elements.detailContent.scrollTop = 0;
    return;
  }
  const primary = el("div", "detail-primary");
  if (usesStageNavigation) primary.append(elements.detailNavigation);
  else elements.drawerToolbar.prepend(elements.detailNavigation);
  if (hasPrimaryMedia && !hasArticleDocument && !capturedPost) primary.append(await createDetailMediaGallery(entry, { immersive: true }));
  else if (!entry.text?.trim() && !capturedPost) primary.append(textEl("div", "detail-placeholder", "这条案例还没有内容"));
  body.append(createDetailHeader(entry));
  if (capturedPost) {
    body.append(await createCapturedPostView(entry));
  } else if (hasArticleDocument) {
    body.append(await createArticleDocumentReader(entry));
    const unplacedMedia = await createUnplacedMediaShelf(entry);
    if (unplacedMedia) body.append(unplacedMedia);
  }
  if (isEntryPending(entry)) body.append(createPendingReviewPanel(entry));
  const prompt = capturedPost ? null : createPromptSection(entry);
  if (prompt) body.append(prompt);
  const visualSetAnalyses = createVisualSetAnalyses(entry);
  if (visualSetAnalyses) body.append(visualSetAnalyses);
  const attributes = createDetailAttributes(entry);
  if (attributes) body.append(attributes);
  body.append(createDetailQuickOrganization(entry));
  const breakdown = createFullAnalysis(entry);
  if (breakdown) body.append(breakdown);
  const metadata = createDetailMetadata(entry, { includeDelete: true });
  if (metadata) body.append(metadata);
  else body.append(createDetailFooterActions(entry));
  primary.append(body);
  content.append(primary);
  const discovery = createLocalDiscovery(entry);
  if (discovery) content.append(discovery.section);
  if (renderGeneration !== detailRenderGeneration || currentDetailId !== renderEntryId) return;
  elements.detailDrawer.dataset.entryId = entry.id;
  elements.detailContent.replaceChildren(content);
  if (resetScroll) elements.detailContent.scrollTop = 0;
  discovery?.mount();
}

function createLocalDiscovery(entry) {
  const ranked = rankSimilarEntries(localSimilarityIndex, entry.id, localSimilarityIndex.profiles.size);
  if (!ranked.length) return null;
  const section = el("section", "detail-discovery");
  const heading = el("header", "detail-discovery-heading");
  heading.append(textEl("h2", "", "相似资料"), rawTextEl("span", "", `${ranked.length} 个案例`));
  const grid = el("div", "detail-discovery-grid");
  const sentinel = el("div", "detail-discovery-sentinel");
  sentinel.setAttribute("aria-hidden", "true");
  section.append(heading, grid, sentinel);
  let renderedCount = 0;
  let loadFrame = 0;
  let masonry = null;
  let mediaObserver = null;
  let loadObserver = null;
  let paginationActivated = false;

  function createDiscoveryCard(item) {
    const button = el("button", "case-card local-discovery-item");
    button.type = "button";
    const media = el("span", "local-discovery-media case-image-wrap");
    const dimensions = imageDimensions({ id: item.visualId });
    if (dimensions) {
      media.style.aspectRatio = `${dimensions.width} / ${dimensions.height}`;
      media.classList.add("case-image-wrap-fixed");
    }
    const image = document.createElement("img");
    image.className = "case-shot";
    image.alt = `${item.entry.title || "相似案例"} 对应画面`;
    image.dataset.visualId = item.visualId;
    image.decoding = "async";
    image.loading = "lazy";
    const cached = thumbnailUrls.get(item.visualId);
    if (cached) image.src = cached;
    media.append(image);
    button.setAttribute("aria-label", `查看相似案例：${item.entry.title || "未命名案例"}`);
    button.append(media);
    button.addEventListener("click", () => openDetail(item.entry.id, { preserveQueue: true }));
    return button;
  }

  function renderNextDiscoveryBatch() {
    if (!masonry || renderedCount >= ranked.length) return;
    const next = ranked.slice(renderedCount, renderedCount + PAGE_SIZE);
    const cards = next.map(createDiscoveryCard);
    grid.append(...cards);
    masonry.append(cards);
    for (const image of grid.querySelectorAll("img[data-visual-id]:not([src])")) mediaObserver.observe(image);
    renderedCount += next.length;
    sentinel.hidden = renderedCount >= ranked.length;
    if (paginationActivated) scheduleDiscoveryLoadCheck();
  }

  function scheduleDiscoveryLoadCheck() {
    if (!paginationActivated || loadFrame || renderedCount >= ranked.length) return;
    loadFrame = requestAnimationFrame(() => {
      loadFrame = 0;
      const bounds = elements.detailContent.getBoundingClientRect();
      if (sentinel.getBoundingClientRect().top <= bounds.bottom + bounds.height) renderNextDiscoveryBatch();
    });
  }

  function activatePagination() {
    if (elements.detailContent.scrollTop <= 1) return;
    if (!paginationActivated) paginationActivated = true;
    scheduleDiscoveryLoadCheck();
  }

  function cleanup() {
    if (loadFrame) cancelAnimationFrame(loadFrame);
    loadFrame = 0;
    mediaObserver?.disconnect();
    loadObserver?.disconnect();
    elements.detailContent.removeEventListener("scroll", activatePagination);
    masonry?.destroy();
    detailControllerCleanups.delete(cleanup);
  }

  function mount() {
    masonry = createStableMasonry(grid, {
      scrollContainer: elements.detailContent,
      onLayout: scheduleDiscoveryLoadCheck
    });
    mediaObserver = new IntersectionObserver((records) => {
      for (const record of records) {
        if (!record.isIntersecting) continue;
        mediaObserver.unobserve(record.target);
        void hydrateCardImage(record.target);
      }
    }, { root: elements.detailContent, rootMargin: "25% 0px" });
    loadObserver = new IntersectionObserver((records) => {
      if (paginationActivated && records.some((record) => record.isIntersecting)) renderNextDiscoveryBatch();
    }, { root: elements.detailContent, rootMargin: "700px" });
    loadObserver.observe(sentinel);
    detailControllerCleanups.add(cleanup);
    renderNextDiscoveryBatch();
    elements.detailContent.addEventListener("scroll", activatePagination, { passive: true });
  }

  return { mount, section };
}

async function renderCompoundDetail(entry, content, body) {
  if (entryHasMedia(entry)) content.append(await createDetailMediaGallery(entry, { immersive: true }));
  else content.append(textEl("div", "detail-placeholder", "这个复合案例没有媒体"));
  body.append(createDetailHeader(entry), createCompoundActions(entry), createCompoundOrganizer(entry));
  for (const [index, member] of entry.memberEntries.entries()) {
    const section = el("section", "compound-part");
    const heading = el("div", "compound-part-heading");
    const title = el("div", "");
    const memberTitle = rawTextEl("h3", "", member.title);
    memberTitle.title = member.title;
    title.append(rawTextEl("span", "compound-part-index", translateUiMessage(`部分 ${index + 1}`)), memberTitle);
    title.append(rawTextEl("p", "detail-meta", contentName(member)));
    const headingActions = el("div", "compound-part-heading-actions");
    if (index === 0) {
      headingActions.append(textEl("span", "compound-primary-badge", "主要案例"));
    } else {
      const makePrimary = textEl("button", "button-secondary", "设为主要案例");
      makePrimary.addEventListener("click", () => perform(makePrimary, {
        type: "UPDATE_COMPOUND_CASE",
        compoundCaseId: entry.id,
        memberEntryIds: [member.id, ...entry.memberEntryIds.filter((id) => id !== member.id)],
        coverVisualId: primaryVisual(member)?.id || ""
      }));
      headingActions.append(makePrimary);
    }
    heading.append(title, headingActions);
    section.append(heading);
    if (entryHasMedia(member)) section.append(await createDetailMediaGallery(member));
    if (isEntryPending(member)) section.append(createPendingReviewPanel(member));
    const prompt = createPromptSection(member, { compoundMember: true });
    if (prompt) section.append(prompt);
    const attributes = createDetailAttributes(member);
    if (attributes) section.append(attributes);
    const metadata = createDetailMetadata(member);
    if (metadata) section.append(metadata);
    section.append(createEntryEditor(member));
    body.append(section);
  }
  body.append(createDetailQuickOrganization(entry), createDetailFooterActions(entry));
}

function createCompoundActions(entry) {
  const actions = el("section", "compound-case-actions");
  const split = textEl("button", "button-secondary", "拆分为独立案例");
  split.addEventListener("click", async () => {
    if (!await confirmAppAction({ title: "拆分组合案例？", description: "所有原案例、图片、标签和项目关系都会保留。", confirmLabel: "拆分" })) return;
    const response = await perform(split, { type: "SPLIT_COMPOUND_CASE", compoundCaseId: entry.id });
    if (response?.ok) closeDetail();
  });
  actions.append(split);
  return actions;
}

function createCompoundOrganizer(entry) {
  const details = el("details", "detail-section compound-organizer");
  details.append(textEl("summary", "", "整理内容"));
  const body = el("div", "entry-editor-body");
  const title = labeledInput("案例名称", entry.title);
  let memberIds = [...entry.memberEntryIds];
  const order = el("div", "compound-member-order");
  const renderOrder = () => {
    order.replaceChildren(...memberIds.map((id, index) => {
      const member = entries.find((item) => item.id === id);
      const row = el("div", "compound-member-row");
      row.append(rawTextEl("span", "", `${index + 1}. ${member?.title || t("已移除案例")}`));
      const actions = el("span", "item-actions");
      const up = rawTextEl("button", "button-secondary", "↑");
      const down = rawTextEl("button", "button-secondary", "↓");
      const remove = textEl("button", "button-secondary", "移出");
      up.disabled = index === 0;
      down.disabled = index === memberIds.length - 1;
      up.addEventListener("click", () => { [memberIds[index - 1], memberIds[index]] = [memberIds[index], memberIds[index - 1]]; renderOrder(); });
      down.addEventListener("click", () => { [memberIds[index + 1], memberIds[index]] = [memberIds[index], memberIds[index + 1]]; renderOrder(); });
      remove.addEventListener("click", () => { memberIds = memberIds.filter((item) => item !== id); renderOrder(); });
      actions.append(up, down, remove);
      row.append(actions);
      return row;
    }));
  };
  renderOrder();
  const actions = el("div", "compound-organizer-actions");
  const save = textEl("button", "", "保存整理");
  save.addEventListener("click", async () => {
    const response = await perform(save, {
      type: "UPDATE_COMPOUND_CASE",
      compoundCaseId: entry.id,
      title: title.input.value,
      memberEntryIds: memberIds
    });
    if (response?.ok && !response.compoundCase) closeDetail();
  });
  actions.append(save);
  body.append(title.label, textEl("span", "form-label", "部分顺序"), order, actions);
  details.append(body);
  return details;
}

function isCapturedPost(entry) {
  return entry?.sourceFacts?.pageType === "post";
}

function articleReferencedAssetIds(entry) {
  return new Set((entry?.articleDocument?.blocks || []).flatMap((block) => block.assetId ? [block.assetId] : []));
}

async function createCapturedPostView(entryValue) {
  const entry = normalizeEntryMedia(entryValue);
  const section = el("section", "captured-post-view");
  const heading = el("div", "captured-post-heading");
  const facts = [
    entry.sourceFacts?.author,
    entry.sourceFacts?.handle ? `@${entry.sourceFacts.handle}` : "",
    entry.sourceFacts?.publishedAt ? formatDate(entry.sourceFacts.publishedAt) : ""
  ].filter(Boolean).join(" · ");
  heading.append(textEl("h3", "", "帖子文字"), rawTextEl("small", "", facts));
  section.append(heading);
  if (promptEditState?.entryId === entry.id && !promptEditState.assetId) {
    const textarea = document.createElement("textarea");
    textarea.className = "captured-post-editor";
    textarea.value = promptEditState.draftText;
    textarea.setAttribute("aria-label", "编辑帖子文字");
    textarea.addEventListener("input", () => {
      promptEditState.draftText = textarea.value;
      promptEditState.dirty = textarea.value !== promptEditState.originalText;
    });
    const actions = el("div", "captured-post-actions");
    const save = textEl("button", "", "保存文字");
    const cancel = textEl("button", "button-secondary", "取消");
    save.addEventListener("click", async () => {
      save.disabled = true;
      try {
        const response = await chrome.runtime.sendMessage({
          type: "UPDATE_ENTRY_TEXT",
          entryId: entry.id,
          text: textarea.value,
          textRevision: entryTextRevision(entry)
        });
        if (!response?.ok) throw new Error(response?.message || "帖子文字保存失败");
        promptEditState = null;
        showFeedback(response.message);
        await refreshLibrary();
      } catch (error) {
        showFeedback(error.message || "帖子文字保存失败", true);
        save.disabled = false;
      }
    });
    cancel.addEventListener("click", () => {
      promptEditState = null;
      renderDetail();
    });
    actions.append(save, cancel);
    section.append(textarea, actions);
    queueMicrotask(() => textarea.focus());
  } else {
    section.append(rawTextEl("p", "captured-post-text", entry.text || t("这条帖子没有可显示的文字")));
    const actions = el("div", "captured-post-actions");
    const copy = textEl("button", "button-secondary", "复制文字");
    const edit = textEl("button", "button-secondary", "编辑文字");
    copy.disabled = !entry.text;
    copy.addEventListener("click", () => copyTextWithFeedback(copy, entry.text, "帖子文字已复制", "浏览器未允许复制，请选中文字后复制"));
    edit.addEventListener("click", () => {
      promptEditState = { entryId: entry.id, assetId: "", originalText: entry.text || "", draftText: entry.text || "", dirty: false };
      renderDetail();
    });
    actions.append(copy, edit);
    section.append(actions);
  }
  const media = entry.mediaAssets.filter((asset) => asset.usage !== "poster");
  if (media.length) {
    const grid = el("div", "captured-post-media");
    for (const asset of media) grid.append(await createCompactCapturedMedia(entry, asset, { post: true }));
    section.append(grid);
  }
  return section;
}

async function createUnplacedMediaShelf(entryValue) {
  const entry = normalizeEntryMedia(entryValue);
  const referenced = articleReferencedAssetIds(entry);
  const media = entry.mediaAssets.filter((asset) => asset.usage !== "poster" && !referenced.has(asset.id));
  if (!media.length) return null;
  const section = el("section", "detail-section unplaced-media-section");
  section.append(textEl("h3", "", "未定位媒体"), textEl("p", "detail-helper", "这些媒体由你明确保存，但无法确认它们在原文中的位置。"));
  const shelf = el("div", "unplaced-media-shelf");
  for (const asset of media) shelf.append(await createCompactCapturedMedia(entry, asset));
  section.append(shelf);
  return section;
}

async function createCompactCapturedMedia(entry, asset, { post = false } = {}) {
  const card = el("article", `compact-captured-media compact-captured-${asset.kind}`);
  if (asset.kind === "image" && asset.storageMode === "managed") {
    const image = document.createElement("img");
    image.src = await originalScreenshotUrl(asset.id);
    image.alt = asset.sourceTitle || entry.title;
    image.loading = "lazy";
    image.addEventListener("click", () => openImageLightbox(image, entry));
    card.append(image);
  } else if (asset.kind === "video") {
    const poster = posterAssetForVideo(entry, asset);
    const posterBlob = poster ? await getMediaBlob(poster.id) : null;
    const link = el("a", "compact-media-link");
    link.href = (post ? entry.url : "") || asset.reference?.url || asset.sourceUrl || entry.url || "#";
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    if (posterBlob) {
      const image = document.createElement("img");
      image.src = rememberDetailBlobUrl(posterBlob);
      image.alt = `${entry.title} 视频封面`;
      link.append(image);
    }
    link.append(rawTextEl("strong", "", t(post ? "打开原帖观看视频" : "打开视频来源")));
    card.append(link);
  } else {
    const link = rawTextEl("a", "compact-media-link compact-document-link", asset.sourceTitle || t("打开文档来源"));
    link.href = asset.sourceUrl || entry.url || "#";
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    card.append(link);
  }
  return card;
}

async function createArticleDocumentReader(entryValue) {
  const entry = normalizeEntryMedia(entryValue);
  const reader = el("article", "article-document-reader");
  const assets = new Map(entry.mediaAssets.map((asset) => [asset.id, asset]));
  for (const block of entry.articleDocument?.blocks || []) {
    if (block.kind === "heading") {
      reader.append(rawTextEl(`h${Math.min(6, Math.max(1, Number(block.level) || 2))}`, "", block.text));
      continue;
    }
    if (["paragraph", "list", "quote", "code", "table"].includes(block.kind)) {
      const tagName = block.kind === "quote" ? "blockquote" : block.kind === "code" || block.kind === "table" ? "pre" : "p";
      const text = block.kind === "list" ? block.text.split("\n").map((item) => `• ${item}`).join("\n") : block.text;
      reader.append(rawTextEl(tagName, block.kind === "table" ? "article-table-text" : "", text));
      continue;
    }
    const asset = block.assetId ? assets.get(block.assetId) : null;
    if (block.kind === "image") {
      const figure = el("figure", "article-document-media");
      if (asset?.kind === "image" && asset.storageMode === "managed") {
        const image = document.createElement("img");
        image.className = "article-document-image";
        image.alt = block.label || entry.title;
        image.src = await originalScreenshotUrl(asset.id);
        image.loading = "lazy";
        image.addEventListener("click", () => openImageLightbox(image, entry));
        figure.append(image);
      } else figure.append(articleSourceLink(block.sourceUrl, block.label || "打开原图"));
      if (block.label) figure.append(rawTextEl("figcaption", "", block.label));
      reader.append(figure);
      continue;
    }
    if (block.kind === "video") {
      const figure = el("figure", "article-document-media article-document-video");
      if (asset?.kind === "video" && asset.storageMode !== "reference") figure.append(await createMediaViewer(asset, "", entry));
      else if (asset?.kind === "video") figure.append(await createCompactCapturedMedia(entry, asset));
      else figure.append(articleSourceLink(block.sourceUrl, block.label || "打开视频来源"));
      if (block.label) figure.append(rawTextEl("figcaption", "", block.label));
      reader.append(figure);
      continue;
    }
    if (["document", "link"].includes(block.kind)) {
      const card = el("div", "article-document-resource");
      card.append(
        rawTextEl("span", "article-document-resource-type", block.kind === "document" ? "DOC" : "LINK"),
        rawTextEl("strong", "", block.label || asset?.sourceTitle || t("文章资源"))
      );
      const sourceUrl = block.sourceUrl || asset?.sourceUrl || "";
      if (sourceUrl) card.append(articleSourceLink(sourceUrl, asset ? "打开来源" : "打开链接"));
      if (asset?.kind === "document" && asset.storageMode === "managed") card.append(rawTextEl("small", "", t("本地副本已保存在案例媒体中")));
      reader.append(card);
    }
  }
  return reader;
}

function articleSourceLink(urlValue, label) {
  const url = String(urlValue || "");
  if (!url) return rawTextEl("span", "detail-placeholder", t("来源暂时不可用"));
  const link = rawTextEl("a", "button-secondary media-open-link", label);
  link.href = url;
  link.target = "_blank";
  link.rel = "noopener noreferrer";
  return link;
}

async function createDetailMediaGallery(entryValue, { immersive = false } = {}) {
  const normalizedEntry = normalizeEntryMedia(entryValue);
  const entry = { ...normalizedEntry, mediaAssets: normalizedEntry.mediaAssets.filter((asset) => asset.usage !== "poster") };
  const gallery = el("section", "detail-visual-gallery");
  gallery.classList.toggle("is-immersive", immersive);
  const stage = el("div", "detail-visual-stage");
  const rail = el("div", "detail-visual-rail");
  const notes = el("section", "time-notes");
  const videoAnalysis = el("section", "video-analysis-history");
  rail.setAttribute("aria-label", "案例媒体");
  const imageUrls = await Promise.all(entry.mediaAssets.map((asset) =>
    asset.kind === "image" && asset.storageMode === "managed" ? originalScreenshotUrl(asset.id) : ""
  ));
  let activeIndex = Math.max(0, entry.mediaAssets.findIndex((asset) => asset.id === (activeDetailMediaIdByEntry.get(entry.id) || entry.primaryMediaId)));
  let renderToken = 0;
  let activeController = null;
  let lockedImageStageHeight = 0;
  let lockedImageStageWidth = 0;
  const resizeObserver = new ResizeObserver(() => {
    const asset = entry.mediaAssets[activeIndex];
    const image = stage.querySelector(".detail-image");
    if (asset?.kind === "image" && image) syncImageStageSize(asset, image);
  });
  resizeObserver.observe(gallery);
  resizeObserver.observe(elements.detailDrawer);
  const cleanup = () => {
    activeController?.destroy?.();
    activeController = null;
    resizeObserver.disconnect();
    detailControllerCleanups.delete(cleanup);
  };
  detailControllerCleanups.add(cleanup);

  function syncImageStageSize(asset, image) {
    const dimensions = imageDimensions(asset) || (image.naturalWidth && image.naturalHeight
      ? { width: image.naturalWidth, height: image.naturalHeight }
      : null);
    if (!dimensions) return;
    const galleryWidth = gallery.clientWidth || elements.detailDrawer.clientWidth;
    if (!galleryWidth) return;
    const railHeight = entry.mediaAssets.length > 1 ? rail.offsetHeight : 0;
    const toolbarHeight = elements.detailDrawer.querySelector(".drawer-toolbar")?.offsetHeight || 0;
    const containerHeight = immersive ? gallery.clientHeight : elements.detailDrawer.clientHeight - toolbarHeight;
    if (containerHeight <= railHeight + 1) return;
    const availableHeight = containerHeight - railHeight;
    if (immersive) {
      stage.style.height = `${availableHeight}px`;
      return;
    }
    if (lockedImageStageWidth && Math.abs(lockedImageStageWidth - galleryWidth) > 1) lockedImageStageHeight = 0;
    lockedImageStageWidth = galleryWidth;
    if (!lockedImageStageHeight) lockedImageStageHeight = Math.min(galleryWidth * dimensions.height / dimensions.width, availableHeight);
    stage.style.height = `${lockedImageStageHeight}px`;
  }

  function captureDetailScrollAnchor(anchor) {
    return anchor ? {
      anchor,
      top: anchor.getBoundingClientRect().top,
      scrollTop: elements.detailContent.scrollTop
    } : null;
  }

  function restoreDetailScrollAnchor(snapshot) {
    if (!snapshot?.anchor?.isConnected) return;
    const delta = snapshot.anchor.getBoundingClientRect().top - snapshot.top;
    elements.detailContent.scrollTop = snapshot.scrollTop + delta;
    snapshot.scrollTop = elements.detailContent.scrollTop;
    snapshot.top = snapshot.anchor.getBoundingClientRect().top;
  }

  async function renderActive() {
    const token = ++renderToken;
    const asset = entry.mediaAssets[activeIndex];
    activeDetailMediaIdByEntry.set(entry.id, asset.id);
    gallery.classList.toggle("is-image-detail", asset.kind === "image");
    gallery.classList.toggle("is-video-detail", asset.kind === "video");
    gallery.classList.toggle("is-document-detail", asset.kind === "document");
    gallery.classList.toggle("is-audio-detail", asset.kind === "audio");
    gallery.classList.toggle("is-attachment-detail", asset.kind === "attachment");
    gallery.classList.toggle("is-video-reference", asset.kind === "video" && asset.storageMode === "reference");
    if (asset.kind !== "image") stage.style.removeProperty("height");
    activeController?.destroy?.();
    activeController = null;
    const item = el("figure", `detail-visual-item${asset.id === entry.primaryMediaId ? " is-primary" : ""}`);
    const body = await createMediaViewer(asset, imageUrls[activeIndex], entry);
    if (token !== renderToken) {
      body.mediaController?.destroy?.();
      return;
    }
    const localVideo = body instanceof HTMLVideoElement ? body : body.querySelector?.("video") ?? null;
    if (asset.kind === "video") {
      const videoSurface = body.matches?.(".detail-video") ? body : body.querySelector?.(".detail-video");
      if (videoSurface && asset.width > 0 && asset.height > 0) videoSurface.style.aspectRatio = `${asset.width} / ${asset.height}`;
      if (localVideo) localVideo.addEventListener("loadedmetadata", () => {
        if (localVideo.videoWidth > 0 && localVideo.videoHeight > 0) {
          localVideo.style.aspectRatio = `${localVideo.videoWidth} / ${localVideo.videoHeight}`;
        }
      }, { once: true });
    }
    activeController = body.mediaController || (localVideo ? localVideoController(localVideo) : null);
    const caption = el("figcaption", "detail-visual-caption");
    const position = asset.id === entry.primaryMediaId ? `主要媒体 · ${activeIndex + 1}/${entry.mediaAssets.length}` : `${activeIndex + 1}/${entry.mediaAssets.length}`;
    caption.append(rawTextEl("span", "", [position, mediaMetadataText(asset)].filter(Boolean).join(" · ")));
    const actions = el("span", "detail-visual-actions");
    if (!entry.compoundCase && asset.id !== entry.primaryMediaId) {
      const primary = textEl("button", "button-secondary", "设为主要媒体");
      primary.addEventListener("click", () => perform(primary, { type: "SET_ENTRY_PRIMARY_MEDIA", entryId: entry.id, assetId: asset.id }));
      actions.append(primary);
    }
    if (entry.compoundCase && asset.kind === "image" && asset.id !== entry.primaryMediaId) {
      const primary = textEl("button", "button-secondary", "设为组合主图");
      primary.addEventListener("click", () => perform(primary, {
        type: "UPDATE_COMPOUND_CASE",
        compoundCaseId: entry.id,
        coverVisualId: asset.id
      }));
      actions.append(primary);
    }
    if (!entry.compoundCase) {
      if (asset.kind === "video" && asset.storageMode === "reference") {
        actions.append(createLocalMediaUploadControl(entry, { label: "附加本地视频", accept: "video/*" }));
      }
      const remove = textEl("button", "button-danger-secondary", "此媒体移入回收站");
      remove.addEventListener("click", async () => {
        if (!await confirmAppAction({ title: "将这项媒体移入回收站？", description: "案例文字、笔记和其他媒体会保留；这项媒体可从回收站恢复。", confirmLabel: "媒体移入回收站", danger: true })) return;
        clearMediaAssetCache(asset.id);
        await perform(remove, { type: "DELETE_ENTRY_MEDIA", entryId: entry.id, assetId: asset.id });
      });
      actions.append(remove);
    }
    caption.append(actions);
    item.append(body, caption);
    stage.scrollTop = 0;
    stage.replaceChildren(item);
    if (asset.kind === "image" && body instanceof HTMLImageElement) {
      if (body.complete && body.naturalWidth) syncImageStageSize(asset, body);
      else body.addEventListener("load", () => syncImageStageSize(asset, body), { once: true });
    }
    renderTimeNotes(notes, entry, asset, () => activeController);
    renderVideoAnalysisPanel(videoAnalysis, entry, asset, () => activeController);
    for (const [index, button] of [...rail.children].entries()) {
      button.classList.toggle("is-active", index === activeIndex);
      button.setAttribute("aria-pressed", String(index === activeIndex));
    }
    refreshActiveDetailAssetSections(entry);
  }

  for (const [index, asset] of entry.mediaAssets.entries()) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "detail-visual-thumb";
    button.setAttribute("aria-label", `${asset.id === entry.primaryMediaId ? "主要媒体，" : ""}查看第 ${index + 1} 项媒体`);
    if (asset.kind === "image") {
      const image = document.createElement("img");
      image.alt = "";
      image.src = imageUrls[index];
      button.append(image);
    } else {
      const labels = {
        video: "▶ 视频",
        audio: `♪ ${assetFormatLabel(asset)}`,
        document: `${assetFormatLabel(asset)} 文档`,
        attachment: `${assetFormatLabel(asset)} 源文件`
      };
      button.append(textEl("span", "media-thumb-label", labels[asset.kind] || "资料"));
    }
    button.addEventListener("click", async () => {
      const railScrollLeft = rail.scrollLeft;
      const preservedAnchor = captureDetailScrollAnchor(button);
      activeIndex = index;
      activeDetailMediaIdByEntry.set(entry.id, asset.id);
      await renderActive();
      rail.scrollLeft = railScrollLeft;
      button.focus({ preventScroll: true });
      restoreDetailScrollAnchor(preservedAnchor);
      requestAnimationFrame(() => restoreDetailScrollAnchor(preservedAnchor));
    });
    rail.append(button);
  }
  gallery.append(stage);
  if (entry.mediaAssets.length > 1) gallery.append(rail);
  gallery.append(notes, videoAnalysis);
  await renderActive();
  return gallery;
}

function refreshActiveDetailAssetSections(entry) {
  if (currentDetailId !== entry.id) return;
  const body = elements.detailContent.querySelector(".detail-primary > .detail-body");
  if (!body) return;
  const prompt = createPromptSection(entry);
  const currentPrompt = body.querySelector(":scope > .prompt-section");
  if (prompt && currentPrompt) currentPrompt.replaceWith(prompt);
  else if (prompt) body.querySelector(":scope > .detail-header")?.after(prompt);
  else currentPrompt?.remove();

}

function handleVideoAnalysisProgress(message) {
  if (message?.type !== "VIDEO_ANALYSIS_CHANGED" || !activeVideoAnalysisUi) return;
  if (message.entryId !== activeVideoAnalysisUi.entryId || message.assetId !== activeVideoAnalysisUi.assetId) return;
  const label = ({ uploading: "正在上传本地视频…", processing: "服务正在处理视频…", analyzing: "正在理解画面与声音…", completed: "分析完成，正在保存版本…" })[message.phase];
  if (label) activeVideoAnalysisUi.status.textContent = `${label} · ${message.provider} · ${message.model}`;
}

function renderVideoAnalysisPanel(container, entry, asset, getController) {
  if (asset.kind !== "video" || entry.compoundCase) return container.replaceChildren();
  const header = el("div", "video-analysis-header");
  const title = textEl("h3", "", "视频分析");
  const analyze = textEl("button", "", "分析视频");
  analyze.addEventListener("click", () => startVideoAnalysis(entry, asset));
  header.append(title, analyze);
  const records = (entry.videoAnalyses ?? []).filter((item) => !item.assetId || item.assetId === asset.id).slice().reverse();
  const list = el("div", "video-analysis-list");
  for (const [index, record] of records.entries()) {
    const item = el("article", "video-analysis-record");
    const heading = el("header", "");
    heading.append(
      rawTextEl("strong", "", `${videoAnalysisModeLabel(record.mode)} · 版本 ${records.length - index}`),
      rawTextEl("span", "", `${record.provider || t("未知服务")} · ${record.model || t("未知模型")} · ${formatDate(record.createdAt)}`)
    );
    item.append(heading, renderTimestampedAnalysis(record.text, entry, asset, getController));
    if (record.usage?.totalTokens) item.append(rawTextEl("small", "", `本次用量：${record.usage.totalTokens} tokens`));
    list.append(item);
  }
  if (!records.length) list.append(textEl("p", "video-analysis-empty", "尚无分析记录。每次重跑都会保存为新版本。"));
  container.replaceChildren(header, list);
}

function renderTimestampedAnalysis(text, entry, asset, getController) {
  const body = el("div", "video-analysis-text");
  const content = String(text ?? "");
  const matcher = /(?<!\d)(?:(\d{1,2}):)?([0-5]?\d):([0-5]\d)(?!\d)/g;
  let cursor = 0;
  for (const match of content.matchAll(matcher)) {
    if (match.index > cursor) body.append(document.createTextNode(content.slice(cursor, match.index)));
    const hours = Number(match[1] || 0);
    const milliseconds = (hours * 3600 + Number(match[2]) * 60 + Number(match[3])) * 1000;
    const jump = rawTextEl("button", "analysis-time-jump", match[0]);
    jump.addEventListener("click", async () => {
      if (asset.reference?.provider === "youtube") {
        await chrome.tabs.create({ url: youtubeWatchUrl(asset.reference?.url || asset.sourceUrl, milliseconds), active: true });
        return;
      }
      await getController()?.seekToMs(milliseconds).catch(() => showFeedback("播放器暂时无法跳转到这个时间点", true));
    });
    body.append(jump);
    cursor = match.index + match[0].length;
  }
  if (cursor < content.length) body.append(document.createTextNode(content.slice(cursor)));
  return body;
}

async function startVideoAnalysis(entry, asset) {
  const assignment = aiTaskAssignments.videoAnalysis ?? {};
  const provider = aiProviderRegistry.providers?.[assignment.providerId];
  const model = assignment.model || provider?.models?.videoAnalysis || "";
  if (!provider?.configured || !provider.capabilities?.includes("videoAnalysis") || !model) {
    openSettingsDialog("ai");
    showFeedback("请先在 AI 服务与任务分工中连接并分配视频分析服务", true);
    return;
  }
  if (provider.consent !== true) {
    openSettingsDialog("ai");
    showFeedback("请先允许所选 AI 服务接收本次明确提交的资料", true);
    return;
  }
  const sourceKind = asset.storageMode === "managed" ? "本地视频文件（将上传）" : asset.reference?.provider === "youtube" ? "公共 YouTube URL" : "当前社媒引用链接";
  await showAppDialog({
    title: "分析视频",
    description: `来源：${sourceKind} · 服务：${provider.label} · 模型：${model}。将发送视频或公开 YouTube URL 与本次问题；费用由服务商账户产生。`,
    fields: [
      { id: "mode", label: "分析方式", type: "select", value: "creative-breakdown", options: [
        { value: "creative-breakdown", label: "创意拆解" },
        { value: "content-summary", label: "内容总结" },
        { value: "ad-review", label: "广告评价" },
        { value: "custom", label: "自定义问题" }
      ] },
      { id: "customQuestion", label: "自定义问题（仅自定义时必填）", type: "textarea", rows: 4, placeholder: "例如：比较前后两段节奏，找出转化弱点" }
    ],
    confirmLabel: "开始分析",
    pendingLabel: "正在准备视频分析…",
    onSubmit: async (values, context) => {
      const permission = permissionPatternForProvider(provider.endpoint);
      if (!await chrome.permissions.request({ origins: [permission] })) throw new Error("没有获得所选 AI 服务的访问权限，未发送视频");
      const status = context.status();
      activeVideoAnalysisUi = { entryId: entry.id, assetId: asset.id, status };
      try {
        const response = await chrome.runtime.sendMessage({
          type: "ANALYZE_ENTRY_VIDEO", entryId: entry.id, assetId: asset.id,
          mode: values.mode, customQuestion: values.customQuestion, singleConfirmation: true
        });
        if (!response?.ok) throw new Error(response?.message || "视频分析失败");
        showFeedback(response.message);
        await refreshLibrary();
        return response;
      } finally {
        activeVideoAnalysisUi = null;
      }
    }
  });
}

function videoAnalysisModeLabel(value) {
  return ({ "creative-breakdown": "创意拆解", "content-summary": "内容总结", "ad-review": "广告评价", custom: "自定义问题" })[value] || "视频分析";
}

async function createMediaViewer(asset, imageUrl, entry) {
  if (asset.kind === "image") {
    const image = document.createElement("img");
    image.className = "detail-image";
    image.alt = `${entry.title} 图片`;
    image.src = imageUrl;
    image.tabIndex = 0;
    image.role = "button";
    image.addEventListener("click", () => openImageLightbox(image, entry));
    image.addEventListener("keydown", (event) => {
      if (event.key !== "Enter" && event.key !== " ") return;
      event.preventDefault();
      openImageLightbox(image, entry);
    });
    return image;
  }
  if (asset.recordType === LOCAL_ASSET_REFERENCE_RECORD_TYPE) return createLocalAssetReferenceViewer(asset, entry);
  if (asset.storageMode === "reference") return createReferencedMediaViewer(asset, entry);
  const blob = await getMediaBlob(asset.id);
  if (!blob) return textEl("div", "detail-placeholder", "本地媒体文件缺失；请从完整备份恢复");
  const url = URL.createObjectURL(blob);
  detailMediaUrls.add(url);
  if (asset.kind === "video") {
    const wrap = el("div", "detail-video-wrap");
    const video = document.createElement("video");
    video.className = "detail-video";
    video.controls = true;
    video.preload = "metadata";
    video.autoplay = false;
    video.playsInline = true;
    video.src = url;
    const fallback = textEl("a", "button-secondary media-open-link", "无法解码时用系统播放器打开");
    fallback.href = url;
    fallback.download = asset.sourceTitle || `video-${asset.id}`;
    video.addEventListener("error", () => wrap.classList.add("has-playback-error"));
    wrap.append(video, fallback);
    return wrap;
  }
  if (asset.kind === "audio") {
    const wrap = el("div", "detail-audio-wrap");
    const audio = document.createElement("audio");
    audio.className = "detail-audio";
    audio.controls = true;
    audio.preload = "metadata";
    audio.autoplay = false;
    audio.src = url;
    const metadata = rawTextEl("p", "asset-file-meta", mediaMetadataText(asset));
    audio.addEventListener("loadedmetadata", () => {
      if (!asset.durationMs && Number.isFinite(audio.duration)) {
        metadata.textContent = mediaMetadataText({ ...asset, durationMs: Math.round(audio.duration * 1000) });
      }
    });
    wrap.append(
      rawTextEl("span", "asset-kind-badge", `音频 · ${assetFormatLabel(asset)}`),
      rawTextEl("strong", "asset-file-title", asset.sourceTitle || entry.title || t("音频")),
      metadata,
      audio,
      managedAssetDownloadLink(asset, url)
    );
    return wrap;
  }
  if (asset.kind === "attachment") return createManagedSourceFileViewer(asset, url);
  const wrap = el("div", "detail-document");
  const open = textEl("a", "button-secondary media-open-link", "下载本机副本");
  open.href = url;
  open.download = asset.sourceTitle || `document-${asset.id}`;
  if (asset.mimeType === "application/pdf") {
    try {
      wrap.append(await createPdfViewer(blob, entry.title));
    } catch (error) {
      wrap.append(rawTextEl("div", "detail-placeholder document-error", `无法在插件内读取这个 PDF：${error.message || "文件可能已损坏或需要密码"}`));
    }
  } else if (asset.extractedTextFormat === "markdown" || asset.mimeType === "text/markdown") {
    const text = String(entry.text ?? "").trim() || await readDocumentText(blob, asset.mimeType);
    const reader = el("article", "document-text-reader");
    reader.append(rawTextEl("div", "document-type-badge", documentTypeLabel(asset.mimeType, asset.sourceFormat)));
    reader.append(renderMarkdownDocument(text, {
      loadRemoteImage: (urlValue) => loadRemoteMarkdownImage(asset.id, urlValue)
    }));
    wrap.append(reader);
  } else {
    const text = String(entry.text ?? "").trim() || await readDocumentText(blob, asset.mimeType);
    const reader = el("article", "document-text-reader");
    reader.append(rawTextEl("div", "document-type-badge", documentTypeLabel(asset.mimeType, asset.sourceFormat)), rawTextEl("pre", "", text || t("这个文档没有可显示的文字")));
    wrap.append(reader);
  }
  wrap.append(open);
  return wrap;
}

function managedAssetDownloadLink(asset, url) {
  const download = rawTextEl("a", "button-secondary media-open-link", t("下载本机副本"));
  download.href = url;
  download.download = asset.sourceTitle || `source-${asset.id}`;
  return download;
}

function createManagedSourceFileViewer(asset, url) {
  const panel = el("div", "detail-source-file");
  panel.append(
    rawTextEl("span", "asset-kind-badge", `${assetCategoryLabel(asset)} · ${assetFormatLabel(asset)}`),
    rawTextEl("strong", "asset-file-title", asset.sourceTitle || t("创作源文件")),
    rawTextEl("p", "asset-file-path", asset.relativePath || t("本机资料")),
    rawTextEl("p", "asset-file-meta", mediaMetadataText(asset)),
    rawTextEl("p", "asset-inert-note", "这是归档源文件。PromptDirector 不会执行或内嵌打开它。"),
    managedAssetDownloadLink(asset, url)
  );
  return panel;
}

async function createLocalAssetReferenceViewer(asset, entry) {
  const panel = el("div", "detail-source-file detail-local-asset-reference");
  const expected = Number.isFinite(Number(asset.sourceLastModified)) ? asset : undefined;
  let record = null;
  let inspection;
  try {
    record = await getLocalAssetHandleRecord(asset.id);
    inspection = await inspectLocalAssetHandle(record, expected);
  } catch (error) {
    inspection = { status: LOCAL_ASSET_LINK_STATUS.MISSING, permission: "unknown", error };
  }
  const statusLabels = {
    [LOCAL_ASSET_LINK_STATUS.READY]: "链接可用",
    [LOCAL_ASSET_LINK_STATUS.CHANGED]: "源文件已变化，请确认后重新链接",
    [LOCAL_ASSET_LINK_STATUS.NEEDS_PERMISSION]: "需要你重新授权读取",
    [LOCAL_ASSET_LINK_STATUS.MISSING]: "源文件已移动、改名或链接缺失"
  };
  panel.dataset.linkStatus = inspection.status;
  panel.append(
    rawTextEl("span", "asset-kind-badge", `${t("本机链接")} · ${assetFormatLabel(asset)}`),
    rawTextEl("strong", "asset-file-title", asset.sourceTitle || t("本机源文件")),
    rawTextEl("p", "asset-file-path", asset.relativePath || asset.sourceTitle || t("未记录相对路径")),
    rawTextEl("p", "asset-file-meta", mediaMetadataText(asset)),
    rawTextEl("p", "asset-link-status", t(statusLabels[inspection.status] || "链接状态未知")),
    rawTextEl("p", "asset-inert-note", t("这里只保存文件信息与本机授权。不会自动读取、上传、执行或内嵌源文件；导出分享包时会再次明确检查权限。"))
  );
  const actions = el("div", "asset-file-actions");
  if (inspection.status === LOCAL_ASSET_LINK_STATUS.NEEDS_PERMISSION) {
    const authorize = rawTextEl("button", "button-secondary", t("重新授权读取"));
    authorize.addEventListener("click", () => void authorizeLocalAssetReference(asset, record, authorize));
    actions.append(authorize);
  }
  if (inspection.status === LOCAL_ASSET_LINK_STATUS.READY) {
    const download = rawTextEl("button", "button-secondary", t("下载本机副本"));
    download.addEventListener("click", () => void downloadLocalAssetReference(asset, record, download));
    actions.append(download);
  }
  const relink = rawTextEl("button", "button-secondary", t("重新链接源文件"));
  relink.title = t("由你选择新的本机文件；确认后更新文件名、大小、格式与修改时间");
  relink.addEventListener("click", () => void relinkLocalAssetReference(entry, asset, relink));
  actions.append(relink);
  panel.append(actions);
  return panel;
}

async function authorizeLocalAssetReference(asset, record, button) {
  button.disabled = true;
  try {
    if (!record) throw new Error("没有找到原本的本机链接，请重新选择源文件");
    if (typeof record.handle.requestPermission !== "function") throw new Error("当前浏览器不支持重新授权，请重新链接源文件");
    const permission = await record.handle.requestPermission({ mode: "read" });
    if (permission !== "granted") throw new Error("你没有允许读取本机源文件，链接保持不变");
    await renderDetail();
  } catch (error) {
    showFeedback(error.message || "无法恢复本机文件权限", true);
  } finally {
    button.disabled = false;
  }
}

async function relinkLocalAssetReference(entry, asset, button) {
  if (typeof window.showOpenFilePicker !== "function") return showFeedback("当前浏览器不支持持久本机链接，请使用最新版 Chrome", true);
  button.disabled = true;
  try {
    const [handle] = await window.showOpenFilePicker({ multiple: false });
    if (!handle) return;
    const file = await handle.getFile();
    const reference = createUnsupportedLocalAssetReference(file, asset.id, { relativePath: file.name });
    const changed = file.name !== asset.sourceTitle || file.size !== asset.byteSize || file.lastModified !== asset.sourceLastModified;
    if (changed && !await confirmAppAction({
      title: "确认更新本机源文件链接？",
      description: `将链接更新为“${file.name}”（${formatBytes(file.size)}）。只更新本机文件信息，不会立即上传或执行文件。`,
      confirmLabel: "确认重新链接"
    })) return;
    await saveLocalAssetHandle(asset.id, handle, file);
    const response = await chrome.runtime.sendMessage({
      type: "UPDATE_LOCAL_ASSET_REFERENCE",
      entryId: entry.id,
      assetId: asset.id,
      sourceTitle: reference.sourceTitle,
      relativePath: reference.relativePath,
      sourceFormat: reference.sourceFormat,
      mimeType: reference.mimeType,
      byteSize: reference.byteSize,
      sourceLastModified: file.lastModified
    });
    if (!response?.ok) throw new Error(response?.message || "无法更新本机源文件信息");
    showFeedback("本机源文件链接已更新");
    await refreshLibrary();
  } catch (error) {
    if (error?.name !== "AbortError") showFeedback(error.message || "无法重新链接源文件", true);
  } finally {
    button.disabled = false;
  }
}

async function downloadLocalAssetReference(asset, record, button) {
  button.disabled = true;
  try {
    if (!record) throw new Error("本机源文件链接已丢失，请重新链接");
    const file = await record.handle.getFile();
    const url = URL.createObjectURL(file);
    const link = document.createElement("a");
    link.href = url;
    link.download = file.name;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 0);
  } catch (error) {
    showFeedback(error.message || "无法读取本机源文件", true);
  } finally {
    button.disabled = false;
  }
}

async function loadRemoteMarkdownImage(assetId, urlValue) {
  const url = new URL(urlValue);
  const cached = await getDerivedMedia(assetId);
  const existing = cached?.remoteImages?.find((item) => item.url === url.href)?.blob;
  if (existing) return rememberDetailBlobUrl(existing);
  const permission = `${url.origin}/*`;
  if (!await chrome.permissions.request({ origins: [permission] })) throw new Error("没有获得这张图片的读取权限");
  const response = await fetch(url.href, { credentials: "omit", redirect: "follow" });
  if (!response.ok) throw new Error(`图片服务器返回 HTTP ${response.status}`);
  const blob = await response.blob();
  if (!blob.type.startsWith("image/") || !blob.size) throw new Error("这个地址没有返回图片");
  if (blob.size > PORTABLE_LIBRARY_LIMITS.maxImageBytes) throw new Error("图片过大，未保存到本机");
  await saveDerivedMedia(assetId, {
    ...cached,
    remoteImages: [...(cached?.remoteImages ?? []).filter((item) => item.url !== url.href), { url: url.href, blob }]
  });
  return rememberDetailBlobUrl(blob);
}

function rememberDetailBlobUrl(blob) {
  const url = URL.createObjectURL(blob);
  detailMediaUrls.add(url);
  return url;
}

async function createReferencedMediaViewer(asset, entry) {
  const url = asset.reference?.url || asset.sourceUrl;
  const provider = asset.reference?.provider || "generic";
  const providerLabel = mediaReferenceProviderLabel(provider);
  const embedUrl = officialMediaEmbedUrl(url, provider);
  if (provider === "youtube" && embedUrl && !await ensureYouTubePlaybackPermission(chrome, { request: false })) {
    return createPlaybackFallback(entry, asset, {
      providerLabel,
      reason: "首次在案例库播放 YouTube，需要授权播放器域名。只影响当前扩展发起的播放器，不读取网页内容。",
      actionLabel: "授权并在案例库播放",
      onAction: async (button) => {
        button.disabled = true;
        try {
          if (!await ensureYouTubePlaybackPermission(chrome, { request: true })) throw new Error("未获得 YouTube 播放权限");
          await renderDetail();
        } catch (error) {
          showFeedback(error.message || "YouTube 播放授权失败", true);
          button.disabled = false;
        }
      }
    });
  }
  if (embedUrl) {
    const wrap = el("div", "detail-video-wrap referenced-video-embed");
    const status = textEl("p", "media-playback-status", "播放器正在加载…");
    const frame = document.createElement("iframe");
    frame.className = "detail-video detail-video-embed";
    frame.title = t("{provider} 外部视频播放器", { provider: providerLabel });
    frame.src = provider === "vimeo" ? `${embedUrl}${embedUrl.includes("?") ? "&" : "?"}api=1&player_id=${encodeURIComponent(asset.id)}` : embedUrl;
    frame.allow = "autoplay; encrypted-media; fullscreen; picture-in-picture";
    frame.allowFullscreen = true;
    frame.referrerPolicy = "strict-origin-when-cross-origin";
    const controller = provider === "vimeo"
      ? vimeoMediaController(frame)
      : provider === "youtube"
        ? youtubeMediaController(frame, status, asset.id)
        : basicEmbedController(frame, status, providerLabel);
    const source = textEl("a", "button-secondary media-reference-fallback", "打开来源");
    source.href = provider === "youtube" ? youtubeWatchUrl(url) : url;
    source.target = "_blank";
    source.rel = "noopener noreferrer";
    const actions = el("div", "media-playback-actions");
    actions.append(source);
    wrap.append(frame, status, actions);
    wrap.mediaController = controller;
    return wrap;
  }
  return createPlaybackFallback(entry, asset, { providerLabel, reason: "此来源没有可验证的官方内嵌播放器" });
}

async function createPlaybackFallback(entry, asset, { providerLabel, reason, actionLabel = "", onAction = null }) {
  const url = asset.reference?.url || asset.sourceUrl;
  const card = el("div", "platform-link-card platform-playback-fallback");
  const poster = posterAssetForVideo(entry, asset);
  const posterBlob = poster ? await getMediaBlob(poster.id) : null;
  if (posterBlob) {
    const image = document.createElement("img");
    image.src = rememberDetailBlobUrl(posterBlob);
    image.alt = `${entry.title || providerLabel} 封面`;
    card.append(image);
  }
  const label = el("span", "platform-link-label");
  label.append(
    textEl("small", "", providerLabel.toLocaleUpperCase("en-US")),
    rawTextEl("strong", "", entry.title || asset.sourceTitle || `${providerLabel} 视频`),
    rawTextEl("span", "", reason)
  );
  const actions = el("span", "platform-link-actions");
  if (actionLabel && onAction) {
    const action = textEl("button", "", actionLabel);
    action.addEventListener("click", () => onAction(action));
    actions.append(action);
  }
  actions.append(createLocalMediaUploadControl(entry, { label: "附加本地视频", accept: "video/*" }));
  if (url) {
    const open = textEl("a", "button-secondary", "打开来源");
    open.href = providerLabel === "YouTube" ? youtubeWatchUrl(url) : url;
    open.target = "_blank";
    open.rel = "noopener noreferrer";
    actions.append(open);
  }
  label.append(actions);
  card.append(label);
  return card;
}

function youtubeMediaController(frame, status, playerId) {
  let currentTimeMs = null;
  let ready = false;
  const origin = "https://www.youtube-nocookie.com";
  const timeoutId = setTimeout(() => {
    if (!ready) status.textContent = t("播放器响应超时，可重试或打开来源");
  }, 8000);
  const onMessage = (event) => {
    if (event.origin !== origin || event.source !== frame.contentWindow) return;
    const payload = typeof event.data === "string" ? safeJson(event.data) : event.data;
    if (payload?.event === "onReady") {
      ready = true;
      clearTimeout(timeoutId);
      status.textContent = t("可以播放");
    } else if (payload?.event === "onError") {
      const failure = youtubePlaybackError(payload.info);
      clearTimeout(timeoutId);
      status.textContent = failure.blockReason;
      status.classList.add("error");
    } else if (payload?.event === "infoDelivery" && Number.isFinite(payload.info?.currentTime)) {
      currentTimeMs = Math.max(0, Math.round(payload.info.currentTime * 1000));
    }
  };
  const subscribe = () => frame.contentWindow?.postMessage(JSON.stringify({ event: "listening", id: playerId }), origin);
  frame.addEventListener("load", subscribe);
  window.addEventListener("message", onMessage);
  return {
    getCurrentTimeMs: async () => {
      if (!Number.isFinite(currentTimeMs)) throw new Error("播放器尚未报告当前时间");
      return currentTimeMs;
    },
    seekToMs: async (value) => frame.contentWindow?.postMessage(JSON.stringify({
      event: "command", func: "seekTo", args: [Math.max(0, Number(value) || 0) / 1000, true], id: playerId
    }), origin),
    destroy: () => {
      clearTimeout(timeoutId);
      frame.removeEventListener("load", subscribe);
      window.removeEventListener("message", onMessage);
    }
  };
}

function basicEmbedController(frame, status, providerLabel) {
  let timeoutId = setTimeout(() => {
    status.textContent = t("{provider} 播放器响应超时，可打开来源", { provider: providerLabel });
  }, 8000);
  const loaded = () => {
    clearTimeout(timeoutId);
    timeoutId = null;
    status.textContent = t("播放器已加载");
  };
  frame.addEventListener("load", loaded, { once: true });
  return {
    destroy: () => {
      if (timeoutId) clearTimeout(timeoutId);
      frame.removeEventListener("load", loaded);
    }
  };
}

function renderTimeNotes(container, entry, asset, getController) {
  if (asset.kind !== "video" || entry.compoundCase) return container.replaceChildren();
  const header = el("div", "time-note-header");
  const heading = textEl("h3", "", "时间点笔记");
  const add = textEl("button", "", "添加时间笔记");
  header.append(heading, add);
  const list = el("div", "time-note-list");
  for (const note of (entry.timeNotes ?? []).filter((item) => item.assetId === asset.id)) {
    const row = el("div", "time-note-row");
    const jump = textEl("button", "time-note-jump", note.endMs
      ? `${formatMediaTime(note.startMs)}–${formatMediaTime(note.endMs)}`
      : formatMediaTime(note.startMs));
    jump.addEventListener("click", async () => {
      if (asset.reference?.provider === "youtube") {
        await chrome.tabs.create({ url: youtubeWatchUrl(asset.reference?.url || asset.sourceUrl, note.startMs), active: true });
        return;
      }
      const controller = getController();
      if (!controller) return showFeedback("这个外部播放器无法直接跳转，请按笔记时间打开原网页", true);
      await controller.seekToMs(note.startMs).catch(() => showFeedback("播放器暂时无法跳转", true));
    });
    const remove = textEl("button", "button-secondary", "删除");
    remove.addEventListener("click", () => perform(remove, { type: "DELETE_TIME_NOTE", entryId: entry.id, noteId: note.id }));
    row.append(jump, rawTextEl("p", "", note.text), remove);
    list.append(row);
  }

  const form = el("div", "time-note-form");
  form.hidden = true;
  const text = document.createElement("textarea");
  text.rows = 2;
  text.placeholder = t("记录这个画面、动作变化或提示词用法");
  const start = document.createElement("input");
  start.type = "number";
  start.min = "0";
  start.step = "0.1";
  start.placeholder = t("时间（秒）");
  const save = textEl("button", "", "保存笔记");
  const cancel = textEl("button", "button-secondary", "取消");
  const advanced = el("details", "time-note-advanced");
  advanced.append(textEl("summary", "", "更多记录选项"));
  const advancedBody = el("div", "time-note-advanced-body");
  const end = document.createElement("input");
  end.type = "number";
  end.min = "0";
  end.step = "0.1";
  end.placeholder = t("片段结束秒数（可选）");
  advancedBody.append(end);
  const controller = getController();
  if (controller?.video) {
    const keyframe = textEl("button", "button-secondary", "保存当前帧");
    keyframe.addEventListener("click", () => saveVideoKeyframe(keyframe, controller.video, entry, asset, text));
    advancedBody.append(keyframe);
  }
  advanced.append(advancedBody);
  add.addEventListener("click", async () => {
    form.hidden = false;
    add.hidden = true;
    const currentMs = await getController()?.getCurrentTimeMs().catch(() => null);
    if (Number.isFinite(currentMs)) start.value = String(Math.round(currentMs / 100) / 10);
    text.focus();
  });
  cancel.addEventListener("click", () => {
    form.hidden = true;
    add.hidden = false;
  });
  save.addEventListener("click", async () => {
    if (!text.value.trim()) return showFeedback("请先写下这段画面的笔记", true);
    const response = await perform(save, {
      type: "ADD_TIME_NOTE",
      entryId: entry.id,
      note: {
        assetId: asset.id,
        startMs: Math.max(0, Math.round(Number(start.value || 0) * 1000)),
        ...(end.value ? { endMs: Math.max(0, Math.round(Number(end.value) * 1000)) } : {}),
        text: text.value
      }
    });
    if (response?.ok) {
      form.hidden = true;
      add.hidden = false;
    }
  });
  const actions = el("div", "time-note-form-actions");
  actions.append(cancel, save);
  form.append(text, start, advanced, actions);
  container.replaceChildren(header, list, form);
}

async function saveVideoKeyframe(button, video, entry, asset, text) {
  if (video.readyState < 2 || !video.videoWidth || !video.videoHeight) {
    return showFeedback("请先播放或定位到可见画面，再保存当前帧", true);
  }
  const frameId = globalThis.crypto.randomUUID();
  button.disabled = true;
  try {
    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    canvas.getContext("2d").drawImage(video, 0, 0, canvas.width, canvas.height);
    const blob = await canvasBlob(canvas, "image/webp");
    await saveMediaBlob(frameId, blob);
    const currentMs = Math.max(0, Math.round(video.currentTime * 1000));
    const response = await chrome.runtime.sendMessage({
      type: "ADD_VIDEO_KEYFRAME", entryId: entry.id,
      asset: {
        id: frameId, kind: "image", storageMode: "managed", mimeType: blob.type,
        byteSize: blob.size, width: canvas.width, height: canvas.height,
        sourceTitle: `${entry.title} · ${formatMediaTime(currentMs)}`
      },
      note: { assetId: asset.id, startMs: currentMs, text: text.value.trim() || `关键帧 ${formatMediaTime(currentMs)}` }
    });
    if (!response?.ok) throw new Error(response?.message || "关键帧保存失败");
    showFeedback(response.message);
    await refreshLibrary();
  } catch (error) {
    await deleteMediaBlob(frameId).catch(() => undefined);
    showFeedback(error.message || "关键帧保存失败", true);
  } finally {
    button.disabled = false;
  }
}

function localVideoController(video) {
  return {
    video,
    getCurrentTimeMs: async () => Math.max(0, Math.round(video.currentTime * 1000)),
    seekToMs: async (value) => {
      video.currentTime = Math.max(0, Number(value) || 0) / 1000;
      await video.play().catch(() => undefined);
    }
  };
}

function vimeoMediaController(frame) {
  const pending = new Map();
  const onMessage = (event) => {
    if (event.origin !== "https://player.vimeo.com" || event.source !== frame.contentWindow) return;
    const payload = typeof event.data === "string" ? safeJson(event.data) : event.data;
    const queue = pending.get(payload?.method);
    if (!queue?.length) return;
    queue.shift()?.resolve(Number(payload.value));
    if (!queue.length) pending.delete(payload.method);
  };
  window.addEventListener("message", onMessage);
  const call = (method, value) => new Promise((resolve, reject) => {
    const queue = pending.get(method) ?? [];
    const request = { resolve, reject };
    queue.push(request);
    pending.set(method, queue);
    frame.contentWindow?.postMessage({ method, ...(value === undefined ? {} : { value }) }, "https://player.vimeo.com");
    setTimeout(() => {
      const current = pending.get(method);
      if (!current?.includes(request)) return;
      const remaining = current.filter((item) => item !== request);
      if (remaining.length) pending.set(method, remaining);
      else pending.delete(method);
      reject(new Error("Vimeo 播放器暂时没有响应"));
    }, 1800);
  });
  return {
    getCurrentTimeMs: async () => Math.max(0, Math.round(await call("getCurrentTime") * 1000)),
    seekToMs: async (value) => { await call("setCurrentTime", Math.max(0, Number(value) || 0) / 1000); },
    destroy: () => {
      window.removeEventListener("message", onMessage);
      for (const queue of pending.values()) queue.forEach((request) => request.reject(new Error("播放器已关闭")));
      pending.clear();
    }
  };
}

function safeJson(value) {
  try { return JSON.parse(value); } catch { return null; }
}

function youtubeWatchUrl(value, startMs = 0) {
  try {
    const url = new URL(value);
    const id = url.hostname === "youtu.be"
      ? url.pathname.slice(1).split("/")[0]
      : url.searchParams.get("v") || url.pathname.match(/\/(?:shorts|embed)\/([^/?]+)/)?.[1];
    if (!id) return url.href;
    const watch = new URL("https://www.youtube.com/watch");
    watch.searchParams.set("v", id);
    const seconds = Math.max(0, Math.floor(Number(startMs) / 1000));
    if (seconds) watch.searchParams.set("t", `${seconds}s`);
    return watch.href;
  } catch {
    return String(value ?? "");
  }
}

function formatMediaTime(milliseconds) {
  const seconds = Math.max(0, Math.floor(Number(milliseconds) / 1000));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const rest = seconds % 60;
  return hours ? `${hours}:${String(minutes).padStart(2, "0")}:${String(rest).padStart(2, "0")}` : `${minutes}:${String(rest).padStart(2, "0")}`;
}

function openImageLightbox(trigger, entry) {
  if (!trigger.src) return;
  lightboxTrigger = trigger;
  elements.imageLightboxImage.src = trigger.src;
  elements.imageLightboxImage.alt = translateUiMessage(`${entry.title} 原图`);
  elements.imageLightbox.showModal();
  elements.imageLightboxClose.focus();
}

function closeImageLightbox() {
  if (elements.imageLightbox.open) elements.imageLightbox.close();
}

function createDetailHeader(entry) {
  const section = el("section", "detail-section detail-header-section");
  const title = rawTextEl("h2", "detail-title", entry.title);
  title.title = entry.title;
  section.append(title, createEntryEditor(entry, { inline: true }));
  const meta = el("div", "detail-meta");
  meta.append(textEl("span", "", contentName(entry)), rawTextEl("span", "", formatDate(entry.savedAt)));
  section.append(meta);
  section.append(createPalette(paletteForEntry(entry)?.colors));
  const mainVisual = primaryVisual(entry);
  if (mainVisual?.kind === "image" && !entry.compoundCase) {
    const statusValue = visionStatusByEntry.get(entry.id);
    const status = el("p", `vision-analysis-status${statusValue?.kind ? ` ${statusValue.kind}` : ""}`);
    status.setAttribute("role", "status");
    status.setAttribute("aria-live", "polite");
    status.textContent = statusValue?.message ? translateUiMessage(statusValue.message) : "";
    status.hidden = !status.textContent;
    section.append(status);
  }
  return section;
}

function createDetailQuickOrganization(entry) {
  const section = el("section", "detail-section detail-quick-organization");

  const projects = el("div", "detail-organization-group");
  const projectHeading = el("div", "detail-organization-heading");
  projectHeading.append(textEl("strong", "", "项目"));
  projects.append(projectHeading);
  const entryIds = expandLogicalCaseIds([entry.id], compoundCases);
  const selectedProjectsForEntry = () => organizerState.collections.filter((collection) => {
    const members = new Set(collection.entryIds);
    return entryIds.every((id) => members.has(id));
  });
  const selectedProjects = selectedProjectsForEntry();
  const projectMenu = el("details", "detail-project-menu");
  const projectSummary = el("summary", "");
  const projectSummaryText = rawTextEl(
    "span",
    "detail-project-summary-text",
    selectedProjects.length === 0
      ? t("选择项目")
      : selectedProjects.length === 1
        ? collectionPathLabel(organizerState, selectedProjects[0].id)
        : t("已加入 {count} 个项目", { count: selectedProjects.length })
  );
  const syncProjectSummary = () => {
    const selected = selectedProjectsForEntry();
    projectSummaryText.textContent = selected.length === 0
      ? t("选择项目")
      : selected.length === 1
        ? collectionPathLabel(organizerState, selected[0].id)
        : t("已加入 {count} 个项目", { count: selected.length });
  };
  projectSummary.append(projectSummaryText, createUiIcon("chevron-down"));
  const projectPopover = el("div", "detail-project-popover");
  const projectList = el("div", "detail-project-list");
  const selectorLabelsByProject = collectionSelectorLabelsById(organizerState);
  for (const collection of organizerState.collections) {
    const members = new Set(collection.entryIds);
    const matchingCount = entryIds.filter((id) => members.has(id)).length;
    const selected = matchingCount === entryIds.length;
    const partiallySelected = matchingCount > 0 && !selected;
    const label = el("label", "detail-project-option");
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.checked = selected;
    checkbox.indeterminate = partiallySelected;
    checkbox.addEventListener("change", async () => {
      const nextIds = new Set(collection.entryIds);
      for (const id of entryIds) checkbox.checked ? nextIds.add(id) : nextIds.delete(id);
      const response = await perform(checkbox, {
        type: "REPLACE_COLLECTION_ENTRIES",
        collectionId: collection.id,
        entryIds: [...nextIds]
      }, false);
      if (!response) {
        checkbox.checked = selected;
        checkbox.indeterminate = partiallySelected;
        return;
      }
      consumePendingExternalLibraryRefresh();
      organizerState = response.organizerState ?? organizerState;
      syncProjectSummary();
    });
    label.append(checkbox, rawTextEl("span", "", selectorLabelsByProject.get(collection.id)));
    projectList.append(label);
  }
  const newProject = el("div", "detail-new-project");
  const newProjectName = document.createElement("input");
  newProjectName.placeholder = t("输入新项目名称");
  newProjectName.setAttribute("aria-label", "新项目名称");
  const createProject = textEl("button", "button-secondary", "新建并加入");
  const submitProject = async () => {
    const name = newProjectName.value.trim();
    if (!name) {
      newProjectName.focus();
      return;
    }
    const created = await perform(createProject, { type: "CREATE_COLLECTION", name }, false);
    if (!created?.created?.id) return;
    organizerState = created.organizerState ?? organizerState;
    await perform(createProject, {
      type: "REPLACE_COLLECTION_ENTRIES",
      collectionId: created.created.id,
      entryIds
    });
  };
  createProject.addEventListener("click", submitProject);
  newProjectName.addEventListener("keydown", (event) => {
    if (event.key !== "Enter") return;
    event.preventDefault();
    void submitProject();
  });
  newProject.append(newProjectName, createProject);
  projectPopover.append(projectList, newProject);
  projectMenu.append(projectSummary, projectPopover);
  projects.append(projectMenu);

  const labels = el("div", "detail-organization-group");
  const labelHeading = el("div", "detail-organization-heading");
  labelHeading.append(textEl("strong", "", "添加标签"));
  labels.append(labelHeading);
  const customLabels = uniqueNames(entry.compoundCase?.customLabels ?? entry.customLabels);
  const editor = createTagEditor({
    values: customLabels,
    onChange: (values, trigger) => saveDetailCustomLabels(entry, trigger, values)
  });
  labels.append(editor.element);

  section.append(projects, labels);
  return section;
}

function createDetailDeleteAction(entry) {
  const deleteButton = el("button", "button-danger-secondary detail-delete-action");
  deleteButton.type = "button";
  deleteButton.setAttribute("aria-label", `将“${entry.title}”移入回收站`);
  deleteButton.append(createUiIcon("trash-2"), textEl("span", "", "移入回收站"));
  deleteButton.addEventListener("click", async () => {
    if (!await confirmAppAction({
      title: `将“${entry.title}”移入回收站？`,
      description: "案例及其媒体会移入回收站，可随时恢复。",
      confirmLabel: "移入回收站",
      danger: true
    })) return;
    await deleteCaseIncrementally(deleteButton, entry.id);
  });
  return deleteButton;
}

function createDetailFooterActions(entry) {
  const footer = el("section", "detail-footer-actions");
  const deleteButton = createDetailDeleteAction(entry);
  footer.append(deleteButton);
  return footer;
}

async function saveDetailCustomLabels(entry, button, customLabels) {
  const response = entry.compoundCase
    ? await perform(button, {
      type: "UPDATE_COMPOUND_CASE",
      compoundCaseId: entry.id,
      customLabels: uniqueNames(customLabels)
    }, false)
    : await perform(button, {
      type: "UPDATE_ENTRY_CUSTOM_LABELS",
      entryId: entry.id,
      customLabels: uniqueNames(customLabels)
    }, false);
  if (!response?.ok) return false;
  consumePendingExternalLibraryRefresh();
  if (entry.compoundCase && response.compoundCase) {
    compoundCases = compoundCases.map((item) => item.id === response.compoundCase.id ? response.compoundCase : item);
  } else if (Array.isArray(response.entries)) {
    entries = response.entries;
  }
  rebuildLibraryDerivedState();
  return true;
}

function createComposerAction(entry) {
  const targetType = composerTargetType(entry);
  const activeAssetId = activeDetailMediaIdByEntry.get(entry.id) || entry.primaryMediaId;
  const activeAsset = entryMediaAssets(entry).find((asset) => asset.id === activeAssetId && asset.usage !== "poster");
  const create = textEl("button", "detail-create-action", "以此创作");
  create.type = "button";
  create.disabled = !isComposerEligibleEntry(entry, targetType);
  create.title = create.disabled ? composerIneligibleReason(entry) : "作为单一参考进入创作台";
  create.addEventListener("click", () => openSingleCaseComposer(entry, targetType, activeAsset?.kind === "image" ? activeAsset.id : ""));
  return create;
}

function composerTargetType(entry) {
  const role = contentRoleForEntry(entry);
  if (role === CONTENT_ROLES.promptVideo || primaryMediaAsset(entry)?.kind === "video") return "video";
  return "image";
}

function composerIneligibleReason(entry) {
  const role = contentRoleForEntry(entry);
  if (role === CONTENT_ROLES.imageCase) return "请先完成画面分析，再将案例作为参考";
  if (!String(entry?.text ?? "").trim()) return "当前案例缺少可作为参考的文字内容";
  return "当前案例类型暂不能作为创作参考";
}

async function openSingleCaseComposer(entry, targetType, assetId = "") {
  try {
    if (!isComposerEligibleEntry(entry, targetType)) throw new Error(composerIneligibleReason(entry));
    const url = new URL(chrome.runtime.getURL("composer.html"));
    url.searchParams.set("references", entry.id);
    if (assetId) url.searchParams.set("asset", assetId);
    url.searchParams.set("type", targetType);
    navigateWithinPromptDirector(url);
  } catch (error) {
    showFeedback(error.message || "无法打开创作台", true);
  }
}

async function analyzeEntryVision(entry, button) {
  const provider = visionSettings.activeProvider === "compatible" ? visionSettings.compatible : visionSettings.openai;
  if (!provider?.configured || !visionSettings.consent) {
    openVisionSettings();
    showFeedback("请先完成图片视觉设置并确认截图发送范围");
    return;
  }
  const visual = primaryVisual(entry);
  const vision = primaryVisionAnalysis(entry);
  if (!visual) return;
  if (vision) {
    const message = currentLocale() === "en"
      ? `Reanalyzing will replace the ${vision.userEdited ? "manually revised reconstruction prompt" : "previous model reconstruction prompt"} and vision-model tags. Manual tags and DeepSeek text tags remain unchanged. Continue?`
      : `重新分析会替换${vision.userEdited ? "手动修订过的反推提示词" : "旧模型反推提示词"}和视觉模型标签；人工标签与 DeepSeek 文字标签不会改变。继续吗？`;
    if (!await confirmAppAction({ title: "重新分析主图？", description: message, confirmLabel: "重新分析主图" })) return;
  }
  const originalLabel = button.textContent;
  button.disabled = true;
  button.textContent = t("正在分析画面…");
  setVisionAnalysisStatus(entry.id, "loading", "正在发送当前截图，请保持页面打开。");
  try {
    const response = await chrome.runtime.sendMessage({
      type: "ANALYZE_ENTRY_IMAGE",
      entryId: entry.id,
      visualId: visual.id,
      outputLocale: currentLocale(),
      bypassCache: Boolean(vision)
    });
    if (!response?.ok) throw new Error(response?.message || "图片分析失败");
    const replacement = visualAnalysisPromptReplacement(response.entry, visual.id);
    if (replacement) await reviewVisualAnalysisPromptReplacements(entry.id, [{ ...replacement, index: 1 }]);
    setVisionAnalysisStatus(entry.id, "success", response.message || "画面分析已保存");
    showFeedback(response.message || "画面分析已保存");
    await refreshLibrary();
  } catch (error) {
    setVisionAnalysisStatus(entry.id, "error", error.message || "图片分析失败");
    showFeedback(error.message || "图片分析失败", true);
  } finally {
    button.disabled = false;
    button.textContent = originalLabel;
  }
}

async function reviewVisualAnalysisPromptReplacements(entryId, suggestions) {
  const values = (Array.isArray(suggestions) ? suggestions : []).filter((item) => item?.assetId && item?.text);
  if (!values.length) return null;
  return showAppDialog({
    title: "确认更新图片提示词",
    description: "这些图片当前使用的是旧版图片分析提示词。新版 V2 高保真提示词只会在你确认后替换；用户复制、采集、导入或手动编辑的提示词不会被覆盖。",
    confirmLabel: "确认替换",
    fields: values.map((item) => ({
      id: `prompt_${item.index}`,
      label: `图片 ${item.index}`,
      type: "textarea",
      rows: 6,
      value: item.text
    })),
    onSubmit: async (formValues) => {
      const replacements = values.map((item) => ({
        assetId: item.assetId,
        text: String(formValues[`prompt_${item.index}`] ?? "").trim()
      })).filter((item) => item.text);
      if (!replacements.length) return { skipped: true };
      const response = await chrome.runtime.sendMessage({
        type: "APPLY_ENTRY_MEDIA_PROMPT_SUGGESTIONS",
        entryId,
        suggestions: replacements
      });
      if (!response?.ok) throw new Error(response?.message || "图片提示词更新失败");
      return response;
    }
  });
}

function setVisionAnalysisStatus(entryId, kind, message) {
  visionStatusByEntry.set(entryId, { kind, message });
  if (currentDetailId !== entryId) return;
  const status = elements.detailContent.querySelector(".vision-analysis-status");
  if (!status) return;
  status.className = `vision-analysis-status ${kind}`;
  status.textContent = translateUiMessage(message || "");
  status.hidden = !status.textContent;
}

function openVisionSettings() {
  openSettingsDialog("ai", "vision");
}

function createPendingReviewPanel(entry) {
  const panel = el("section", "detail-section pending-review-panel");
  panel.append(textEl("h3", "", "待确认"));
  if (entry.classification?.status === "needs_review") {
    const classification = createClassificationControl(entry, {
      className: "pending-classification-inline",
      buttonLabel: "保存分类",
      onSave: (button, select) => performPendingReview(button, {
        type: "CONFIRM_CLASSIFICATION",
        entryId: entry.id,
        pathIds: [select.value],
        rememberSource: false
      }, entry.id)
    });
    panel.append(classification);
  }
  for (const item of reusableAnalysisItems(entry.analysisCandidates)) panel.append(createAnalysisCandidate(entry, item, true));
  return panel;
}

function createClassificationControl(entry, { className = "entry-editor-row", buttonLabel = "保存分类", onSave } = {}) {
  const row = el("div", className);
  const select = document.createElement("select");
  select.setAttribute("aria-label", entry.classification?.status === "needs_review" ? `确认“${entry.title}”的分类` : "内容类型");
  select.append(option("", currentLocale() === "en" ? "Choose a content type" : "选择内容类型"), ...taxonomy.nodes.map((item) => option(item.id, contentLabel(item.id), entry.classification?.pathIds?.[0] === item.id)));
  const save = textEl("button", "", buttonLabel);
  save.disabled = !select.value;
  select.addEventListener("change", () => { save.disabled = !select.value; });
  save.addEventListener("click", () => onSave?.(save, select));
  row.append(select, save);
  return row;
}

async function performPendingReview(button, message, entryId) {
  const queueIds = visibleEntries.map((entry) => entry.id);
  const currentIndex = queueIds.indexOf(entryId);
  const orderedNextIds = currentIndex < 0
    ? queueIds
    : [...queueIds.slice(currentIndex + 1), ...queueIds.slice(0, currentIndex)];
  button.disabled = true;
  try {
    const response = await chrome.runtime.sendMessage(message);
    if (!response?.ok) throw new Error(response?.message || "操作失败");
    showFeedback(response.message || "操作完成");
    await refreshLibrary();
    if (currentDetailId !== entryId || detailQueueMode !== "pending") return;
    const current = entries.find((entry) => entry.id === entryId);
    if (current && isEntryPending(current)) {
      await renderDetail();
      elements.detailContent.querySelector(".pending-review-panel select, .pending-review-panel button")?.focus();
      return;
    }
    const remainingIds = new Set(visibleEntries.filter(isEntryPending).map((entry) => entry.id));
    const nextId = orderedNextIds.find((id) => remainingIds.has(id)) ?? [...remainingIds][0];
    if (nextId) {
      await openDetail(nextId, { preserveQueue: true });
      return;
    }
    closeDetail();
    showFeedback("待确认已处理完");
  } catch (error) {
    showFeedback(error.message, true);
  } finally {
    button.disabled = false;
  }
}

function createMediaActions(entryValue) {
  const entry = normalizeEntryMedia(entryValue);
  const wrap = el("div", "screenshot-actions");
  const contentCount = entry.mediaAssets.filter((asset) => asset.usage !== "poster").length;
  wrap.append(rawTextEl("strong", "", contentCount ? t("{count} 项媒体", { count: contentCount }) : t("还没有媒体")));
  const uploadControl = createLocalMediaUploadControl(entry, { label: "从本机添加图片、视频或文档" });
  const addLink = textEl("button", "button-secondary", "添加视频链接");
  addLink.addEventListener("click", () => addVideoReference(entry.id));
  wrap.append(uploadControl, addLink);
  return wrap;
}

function createLocalMediaUploadControl(entry, { label, accept = elements.mediaFile.accept } = {}) {
  const wrap = el("span", "local-media-upload-control");
  const input = document.createElement("input");
  input.type = "file";
  input.accept = accept;
  input.className = "sr-only";
  const button = textEl("button", "button-secondary", label || "从本机添加媒体");
  button.addEventListener("click", async () => {
    if (typeof window.showOpenFilePicker !== "function") return input.click();
    try {
      const [handle] = await window.showOpenFilePicker({ multiple: false });
      if (!handle) return;
      button.disabled = true;
      await uploadLocalMediaToEntry(await handle.getFile(), entry.id);
    } catch (error) {
      if (error?.name !== "AbortError") showFeedback(error.message || "无法读取所选文件", true);
    } finally {
      button.disabled = false;
    }
  });
  input.addEventListener("change", async () => {
    const file = input.files?.[0];
    if (!file) return;
    button.disabled = true;
    try {
      await uploadLocalMediaToEntry(file, entry.id);
    } finally {
      button.disabled = false;
      input.value = "";
    }
  });
  wrap.append(button, input);
  return wrap;
}

async function uploadLocalMediaToEntry(file, entryId) {
  const assetId = globalThis.crypto.randomUUID();
  let prepared = null;
  try {
    prepared = await prepareLocalMedia(file, assetId);
    const { blob, asset, poster } = prepared;
    await saveMediaBlob(assetId, blob);
    if (poster) await saveMediaBlob(poster.asset.id, poster.blob);
    const response = await chrome.runtime.sendMessage({
      type: "ADD_UPLOADED_MEDIA", entryId, asset, posterAsset: poster?.asset
    });
    if (!response?.ok) throw new Error(response?.message || "媒体添加失败");
    showFeedback(response.message);
    await refreshLibrary();
  } catch (error) {
    await deleteMediaBlob(assetId).catch(() => undefined);
    if (prepared?.poster?.asset?.id) await deleteMediaBlob(prepared.poster.asset.id).catch(() => undefined);
    showFeedback(error.message || "媒体添加失败", true);
  }
}

async function openLocalImportSource() {
  if (activeImportJob && ["queued", "running"].includes(activeImportJob.status)) {
    renderImportJob();
    if (!elements.importDialog.open) elements.importDialog.showModal();
    return;
  }
  if (activeImportJob) {
    latestImportJob = activeImportJob;
    activeImportJob = null;
  }
  try {
    const response = await chrome.runtime.sendMessage({ type: "GET_IMPORT_JOB" });
    if (!response?.ok) throw new Error(response?.message || "无法读取导入任务");
    if (response.job && ["queued", "running"].includes(response.job.status)) {
      activeImportJob = response.job;
      renderImportJob();
      if (!elements.importDialog.open) elements.importDialog.showModal();
      scheduleImportJobPoll();
      return;
    }
    latestImportJob = response.job ?? latestImportJob;
  } catch (error) {
    showFeedback(error.message || "无法读取导入任务", true);
  }
  renderImportSource();
  if (!elements.importDialog.open) elements.importDialog.showModal();
}

function renderImportSource() {
  elements.importDialogTitle.textContent = t("导入本机资料");
  elements.importSource.hidden = false;
  elements.importPreparing.hidden = true;
  elements.importConfirmation.hidden = true;
  elements.importJobPanel.hidden = true;
  elements.importActions.hidden = true;
  elements.importLastJob.hidden = !latestImportJob;
}

async function chooseLocalImportFiles() {
  if (typeof window.showOpenFilePicker !== "function") {
    elements.mediaFile.click();
    return;
  }
  try {
    const handles = await window.showOpenFilePicker({ multiple: true });
    const files = await Promise.all(handles.map(async (handle) => ({
      handle,
      file: await handle.getFile(),
      relativePath: handle.name
    })));
    await prepareLocalImport(files, { source: "files" });
  } catch (error) {
    if (error?.name !== "AbortError") showImportFeedback(error.message || "无法读取所选文件", true);
  }
}

async function chooseLocalImportFolder() {
  if (typeof window.showDirectoryPicker !== "function") {
    elements.mediaFolder.click();
    return;
  }
  try {
    const root = await window.showDirectoryPicker({ mode: "read" });
    const files = await readImportDirectoryHandle(root, root.name);
    await prepareLocalImport(files, { source: "folder" });
  } catch (error) {
    if (error?.name !== "AbortError") showImportFeedback(error.message || "无法读取所选文件夹", true);
  }
}

async function readImportDirectoryHandle(directory, parentPath) {
  const files = [];
  for await (const [name, handle] of directory.entries()) {
    const relativePath = `${parentPath}/${name}`;
    if (handle.kind === "file") files.push({ handle, file: await handle.getFile(), relativePath });
    else if (handle.kind === "directory") files.push(...await readImportDirectoryHandle(handle, relativePath));
  }
  return files;
}

async function importLocalMediaCases() {
  const files = [...(elements.mediaFile.files ?? [])].map((file) => ({ file, relativePath: file.name }));
  elements.mediaFile.value = "";
  await prepareLocalImport(files, { source: "files" });
}

async function importLocalMediaFolder() {
  const files = [...(elements.mediaFolder.files ?? [])].map((file) => ({
    file,
    relativePath: file.webkitRelativePath || file.name
  }));
  elements.mediaFolder.value = "";
  await prepareLocalImport(files, { source: "folder" });
}

async function prepareLocalImport(fileItems, { source = "files" } = {}) {
  if (!fileItems.length) return;
  if (activeImportJob && ["queued", "running"].includes(activeImportJob.status)) {
    renderImportJob();
    if (!elements.importDialog.open) elements.importDialog.showModal();
    return;
  }
  activeImportJob = null;
  await discardPendingLocalImport();
  const browsingScrollY = window.scrollY;
  const rootName = source === "folder" ? commonImportRoot(fileItems) : "";
  const draft = { source, rootName, browsingScrollY, customLabels: [], stagedAssets: [], skipped: [] };
  pendingLocalImport = draft;
  elements.importDialogTitle.textContent = t("确认导入");
  elements.importSource.hidden = true;
  elements.importActions.hidden = false;
  renderImportProjectOptions(rootName);
  const visionProvider = visionSettings.activeProvider === "compatible" ? visionSettings.compatible : visionSettings.openai;
  const canAutoAnalyze = Boolean(visionSettings.consent && visionProvider?.configured);
  elements.importAutoAnalyze.checked = false;
  elements.importAutoAnalyze.disabled = !canAutoAnalyze;
  elements.importAutoAnalyze.title = elements.importAutoAnalyze.disabled ? "先在设置的 AI 服务中配置并授权图片分析" : "";
  elements.importPreparing.hidden = false;
  elements.importConfirmation.hidden = true;
  elements.importJobPanel.hidden = true;
  elements.importStart.hidden = false;
  elements.importCancel.textContent = t("取消");
  elements.importRetry.hidden = true;
  elements.importUndo.hidden = true;
  elements.importViewProject.hidden = true;
  showImportFeedback("");
  if (!elements.importDialog.open) elements.importDialog.showModal();
  elements.addMedia.disabled = true;
  elements.importChooseFiles.disabled = true;
  elements.addFolder.disabled = true;
  try {
    for (const item of fileItems) {
      if (pendingLocalImport !== draft) break;
      await prepareImportFile(item, draft);
    }
    if (pendingLocalImport === draft) renderImportConfirmation();
  } finally {
    elements.addMedia.disabled = false;
    elements.importChooseFiles.disabled = false;
    elements.addFolder.disabled = false;
    if (pendingLocalImport === draft) {
      elements.importPreparing.hidden = true;
      elements.importConfirmation.hidden = false;
    }
  }
}

async function prepareImportFile({ file, handle = null, relativePath, forceImport = false }, draft) {
  const assetId = globalThis.crypto.randomUUID();
  let prepared = null;
  try {
    prepared = await prepareLocalMedia(file, assetId, { relativePath, forceImport });
    const duplicateProbe = new File([prepared.blob], file.name, {
      type: prepared.blob.type,
      lastModified: file.lastModified
    });
    const duplicate = await findExactMediaDuplicate(duplicateProbe, entries, {
      readBlob: getMediaBlob,
      candidateAssets: draft.stagedAssets.map((asset) => ({
        id: asset.assetId,
        byteSize: asset.byteSize,
        mimeType: asset.mimeType,
        sourceTitle: asset.name,
        contentHash: asset.contentHash
      }))
    });
    await saveMediaBlob(assetId, prepared.blob);
    if (prepared.poster) await saveMediaBlob(prepared.poster.asset.id, prepared.poster.blob);
    if (pendingLocalImport !== draft) {
      await deleteMediaBlob(assetId).catch(() => undefined);
      if (prepared.poster) await deleteMediaBlob(prepared.poster.asset.id).catch(() => undefined);
      return;
    }
    draft.stagedAssets.push({
      id: `staged:${globalThis.crypto.randomUUID()}`,
      assetId,
      name: file.name,
      relativePath: prepared.asset.relativePath,
      kind: prepared.asset.kind,
      storageMode: prepared.asset.storageMode,
      mimeType: prepared.asset.mimeType,
      byteSize: prepared.blob.size,
      contentHash: duplicate.contentHash,
      duplicateAssetId: duplicate.duplicateAssetId,
      keepDuplicate: false,
      ...(prepared.asset.width ? { width: prepared.asset.width } : {}),
      ...(prepared.asset.height ? { height: prepared.asset.height } : {}),
      ...(prepared.asset.durationMs ? { durationMs: prepared.asset.durationMs } : {}),
      ...(prepared.asset.playbackCapability ? { playbackCapability: prepared.asset.playbackCapability } : {}),
      ...(prepared.contentText ? { contentText: prepared.contentText } : {}),
      ...(prepared.contentFormat ? { contentFormat: prepared.contentFormat } : {}),
      ...(prepared.asset.sourceFormat || prepared.sourceFormat ? { sourceFormat: prepared.asset.sourceFormat || prepared.sourceFormat } : {}),
      ...(prepared.asset.formatCategory ? { formatCategory: prepared.asset.formatCategory } : {}),
      ...(prepared.warnings?.length ? { warnings: prepared.warnings } : {}),
      ...(prepared.poster ? { posterAssetId: prepared.poster.asset.id, posterAsset: prepared.poster.asset } : {})
    });
  } catch (error) {
    await deleteMediaBlob(assetId).catch(() => undefined);
    if (prepared?.poster?.asset?.id) await deleteMediaBlob(prepared.poster.asset.id).catch(() => undefined);
    if (pendingLocalImport === draft) {
      const failure = importFailureDetails(error);
      const { code, message, forceAllowed, ...details } = failure;
      draft.skipped.push({
        name: file.name || relativePath || "未命名文件",
        relativePath,
        file,
        handle,
        reason: message,
        code,
        details,
        ...(code === ASSET_IMPORT_FAILURE_CODES.TOO_LARGE && (forceAllowed || error?.canForceImport === true)
          ? { forceAllowed: true }
          : {})
      });
    }
  }
}

function renderImportProjectOptions(rootName = "") {
  const matching = rootName && organizerState.collections.find((item) => item.parentId === null && item.name.trim() === rootName);
  const selected = organizerState.collections.find((item) => item.id === selectedCollectionId);
  importProjectCombobox.setProjects(projectComboboxCollections());
  const selectedProject = matching || (!rootName ? selected : null);
  if (!selectedProject || !importProjectCombobox.setSelected(selectedProject.id)) {
    elements.importProject.value = rootName;
    delete elements.importProject.dataset.projectId;
  }
  importTagEditor.input.value = "";
  importTagEditor.setValues(pendingLocalImport?.customLabels ?? []);
  elements.importProjectHint.textContent = rootName
    ? "已按根文件夹建议项目；可以修改或清空。"
    : "";
}

function normalizeImportLabel(value) {
  return normalizeTagValue(value);
}

function importLabelKey(value) {
  return normalizeImportLabel(value).toLocaleLowerCase();
}

function renderImportConfirmation() {
  const staged = pendingLocalImport?.stagedAssets ?? [];
  const skipped = pendingLocalImport?.skipped ?? [];
  const duplicates = staged.filter((item) => item.duplicateAssetId);
  elements.importSupportedCount.textContent = String(staged.length);
  elements.importSkippedCount.textContent = String(skipped.length);
  elements.importDuplicateCount.textContent = String(duplicates.length);
  elements.importByteSize.textContent = formatBytes(importSelectedByteSize(staged));
  elements.importStart.disabled = !staged.some((item) => !item.duplicateAssetId || item.keepDuplicate);
  const fragment = document.createDocumentFragment();
  for (const item of staged) fragment.append(createImportFileRow(item));
  for (const item of skipped) fragment.append(createSkippedImportRow(item));
  elements.importFileList.replaceChildren(fragment);
  if (!staged.length) showImportFeedback("没有可导入的受支持文件", true);
  else if (duplicates.length) showImportFeedback("精确重复项默认跳过；勾选“仍导入”可保留副本");
  else showImportFeedback("");
}

function createImportFileRow(item) {
  const row = el("label", `import-file-row${item.duplicateAssetId && !item.keepDuplicate ? " is-skipped" : ""}`);
  const keep = document.createElement("input");
  keep.type = "checkbox";
  keep.checked = item.duplicateAssetId ? item.keepDuplicate : true;
  keep.disabled = !item.duplicateAssetId;
  keep.title = item.duplicateAssetId ? "仍导入这项重复资料" : "将导入";
  keep.addEventListener("change", () => {
    item.keepDuplicate = keep.checked;
    renderImportConfirmation();
  });
  const details = el("span");
  details.append(textEl("strong", "", item.name), textEl("small", "", item.relativePath));
  const status = item.duplicateAssetId ? (item.keepDuplicate ? "仍导入" : "精确重复") : formatBytes(item.byteSize);
  row.append(keep, details, textEl("em", "", status));
  return row;
}

function createSkippedImportRow(item) {
  const canForceImport = item.code === ASSET_IMPORT_FAILURE_CODES.TOO_LARGE
    && item.forceAllowed === true
    && item.file instanceof Blob;
  const canKeepLocalLink = item.code === ASSET_IMPORT_FAILURE_CODES.UNSUPPORTED_FORMAT
    && item.file instanceof Blob;
  const row = el("div", `import-file-row is-skipped${canForceImport || canKeepLocalLink ? " has-action" : ""}`);
  const spacer = document.createElement("span");
  const details = el("span");
  details.append(textEl("strong", "", item.name), textEl("small", "import-file-reason", item.reason));
  if (!canForceImport && !canKeepLocalLink) {
    row.append(spacer, details, textEl("em", "", "未导入"));
    return row;
  }
  if (canKeepLocalLink) {
    const keepLink = rawTextEl("button", "button-secondary import-file-force", t("保留本机链接"));
    keepLink.type = "button";
    keepLink.title = t("只保存文件信息与授权句柄，不复制或执行源文件；分享时才读取源文件");
    keepLink.addEventListener("click", () => void preserveUnsupportedImportReference(item, keepLink));
    row.append(spacer, details, keepLink);
    return row;
  }
  const force = rawTextEl("button", "button-secondary import-file-force", t("强制导入"));
  force.type = "button";
    force.title = t("忽略这项限制并再次检查；可能占用更多本机空间");
  force.addEventListener("click", () => void forcePrepareSkippedImport(item, force));
  row.append(spacer, details, force);
  return row;
}

async function preserveUnsupportedImportReference(item, button) {
  const draft = pendingLocalImport;
  if (!draft || !(item?.file instanceof Blob)) return;
  button.disabled = true;
  try {
    let handle = item.handle;
    let file = item.file;
    let relativePath = item.relativePath || file.name;
    if (!handle) {
      if (typeof window.showOpenFilePicker !== "function") {
        throw new Error("当前浏览器无法保存可跨重启使用的本机链接；请使用最新版 Chrome 后重新选择文件");
      }
      [handle] = await window.showOpenFilePicker({ multiple: false });
      file = await handle.getFile();
      relativePath = file.name;
      if (file.name !== item.file.name || file.size !== item.file.size || file.lastModified !== item.file.lastModified) {
        const confirmed = await confirmAppAction({
          title: "改为链接刚选择的文件？",
          description: `原失败项是“${item.file.name}”，刚选择的是“${file.name}”。只保存本机链接，不复制或执行文件。`,
          confirmLabel: "链接这个文件"
        });
        if (!confirmed) return;
      }
    }
    const assetId = globalThis.crypto.randomUUID();
    const reference = createUnsupportedLocalAssetReference(file, assetId, { relativePath });
    await saveLocalAssetHandle(assetId, handle, file);
    if (pendingLocalImport !== draft) {
      await deleteLocalAssetHandle(assetId).catch(() => undefined);
      return;
    }
    draft.skipped = draft.skipped.filter((candidate) => candidate !== item);
    draft.stagedAssets.push({
      id: `staged:${globalThis.crypto.randomUUID()}`,
      assetId,
      name: reference.sourceTitle,
      relativePath: reference.relativePath,
      kind: reference.kind,
      storageMode: reference.storageMode,
      mimeType: reference.mimeType,
      byteSize: reference.byteSize,
      sourceFormat: reference.sourceFormat,
      formatCategory: reference.formatCategory,
      recordType: reference.recordType,
      linkStatus: "linked",
      sourceLastModified: file.lastModified,
      importFailure: reference.importFailure,
      keepDuplicate: false
    });
    showImportFeedback(`已保留“${reference.sourceTitle}”的本机链接；导出分享包时才会请求读取源文件`);
    renderImportConfirmation();
  } catch (error) {
    if (error?.name !== "AbortError") showImportFeedback(error.message || "无法保留本机链接", true);
  } finally {
    button.disabled = false;
  }
}

async function forcePrepareSkippedImport(item, button) {
  const draft = pendingLocalImport;
  if (!draft || !item?.file) return;
  button.disabled = true;
  draft.skipped = draft.skipped.filter((candidate) => candidate !== item);
  showImportFeedback(`正在重新检查“${item.name}”…`);
  await prepareImportFile({ file: item.file, relativePath: item.relativePath, forceImport: true }, draft);
  if (pendingLocalImport === draft) renderImportConfirmation();
}

function importSelectedByteSize(staged) {
  return staged.filter((item) => !item.duplicateAssetId || item.keepDuplicate)
    .reduce((sum, item) => sum + item.byteSize + Number(item.posterAsset?.byteSize || 0), 0);
}

async function startLocalImportJob() {
  if (!pendingLocalImport?.stagedAssets.length) return;
  if (importTagEditor.input.value.trim()) await importTagEditor.commit();
  elements.importStart.disabled = true;
  showImportFeedback("正在把资料交给后台导入…");
  try {
    const projectName = String(elements.importProject.value || "").trim();
    const existingCollection = organizerState.collections.find((item) => item.id === elements.importProject.dataset.projectId);
    let collectionId = existingCollection?.id || "";
    if (projectName && !collectionId) {
      const response = await chrome.runtime.sendMessage({ type: "CREATE_COLLECTION", name: projectName });
      if (!response?.ok || !response.created?.id) throw new Error(response?.message || "无法创建目标项目");
      organizerState = response.organizerState ?? organizerState;
      collectionId = response.created.id;
    }
    const response = await chrome.runtime.sendMessage({
      type: "START_IMPORT_JOB",
      collectionId,
      customLabels: [...(pendingLocalImport.customLabels ?? [])],
      stagedAssets: pendingLocalImport.stagedAssets,
      items: pendingLocalImport.stagedAssets.map((item) => ({
        stagedAssetId: item.id,
        keepDuplicate: item.keepDuplicate === true
      })),
      options: { autoAnalyze: elements.importAutoAnalyze.checked === true }
    });
    if (!response?.ok) throw new Error(response?.message || "无法开始导入");
    activeImportJob = response.job;
    pendingLocalImport = null;
    renderImportJob();
    scheduleImportJobPoll();
  } catch (error) {
    elements.importStart.disabled = false;
    showImportFeedback(error.message || "无法开始导入", true);
  }
}

function renderImportJob() {
  const job = activeImportJob;
  if (!job) return;
  elements.importDialogTitle.textContent = t("导入任务");
  elements.importSource.hidden = true;
  elements.importActions.hidden = false;
  elements.importPreparing.hidden = true;
  elements.importConfirmation.hidden = true;
  elements.importJobPanel.hidden = false;
  elements.importStart.hidden = true;
  const imported = job.items.filter((item) => item.status === "imported").length;
  const skipped = job.items.filter((item) => item.status === "skipped").length;
  const failed = job.items.filter((item) => item.status === "failed").length;
  const finished = imported + skipped + failed;
  const active = ["queued", "running"].includes(job.status);
  const labels = { queued: "等待导入", running: "正在导入", completed: "导入完成", failed: "部分导入失败", canceled: "导入已取消" };
  elements.importJobTitle.textContent = t(labels[job.status] || "导入任务");
  elements.importJobCount.textContent = `${finished}/${job.items.length}`;
  elements.importJobProgress.max = Math.max(1, job.items.length);
  elements.importJobProgress.value = finished;
  elements.importJobFeedback.textContent = t("{imported} 已导入 · {skipped} 已跳过 · {failed} 失败", { imported, skipped, failed });
  elements.importCancel.textContent = t(active ? "取消剩余项" : "关闭");
  elements.importRetry.hidden = active || !failed;
  elements.importUndo.hidden = active || !job.createdEntryIds?.length || Boolean(job.undoneAt);
  elements.importViewProject.hidden = !job.collectionId || !job.createdEntryIds?.length || Boolean(job.undoneAt);
}

async function resumeImportJob() {
  try {
    const response = await chrome.runtime.sendMessage({ type: "GET_IMPORT_JOB" });
    if (!response?.ok || !response.job) return;
    latestImportJob = response.job;
    if (!["queued", "running"].includes(response.job.status)) return;
    activeImportJob = response.job;
    renderImportJob();
    if (!elements.importDialog.open) elements.importDialog.showModal();
    scheduleImportJobPoll();
  } catch {
    // The library remains usable if a previous task cannot be restored.
  }
}

async function openLatestImportJob() {
  try {
    if (!latestImportJob) {
      const response = await chrome.runtime.sendMessage({ type: "GET_IMPORT_JOB" });
      if (!response?.ok) throw new Error(response?.message || "无法读取上次导入");
      latestImportJob = response.job ?? null;
    }
    if (!latestImportJob) return showFeedback("还没有导入任务");
    activeImportJob = latestImportJob;
    renderImportJob();
    if (!elements.importDialog.open) elements.importDialog.showModal();
    scheduleImportJobPoll();
  } catch (error) {
    showFeedback(error.message || "无法读取上次导入", true);
  }
}

function scheduleImportJobPoll() {
  if (importPollTimer || !activeImportJob || !["queued", "running"].includes(activeImportJob.status)) return;
  importPollTimer = setTimeout(async () => {
    importPollTimer = 0;
    try {
      const response = await chrome.runtime.sendMessage({ type: "GET_IMPORT_JOB", jobId: activeImportJob.id });
      if (!response?.ok || !response.job) throw new Error(response?.message || "无法读取导入进度");
      const previousStatus = activeImportJob.status;
      activeImportJob = response.job;
      latestImportJob = response.job;
      renderImportJob();
      if (["queued", "running"].includes(activeImportJob.status)) scheduleImportJobPoll();
      else if (["queued", "running"].includes(previousStatus)) await refreshAfterImport(activeImportJob);
    } catch (error) {
      elements.importJobFeedback.textContent = error.message || "暂时无法读取导入进度";
      scheduleImportJobPoll();
    }
  }, 650);
}

async function refreshAfterImport(job) {
  const scrollY = pendingLocalImport?.browsingScrollY ?? window.scrollY;
  await refreshLibrary();
  requestAnimationFrame(() => window.scrollTo({ top: scrollY, behavior: "instant" }));
  const imported = job.items.filter((item) => item.status === "imported").length;
  showFeedback(`导入完成 · ${imported} 个案例`);
}

async function cancelImportFlow() {
  if (activeImportJob && ["queued", "running"].includes(activeImportJob.status)) {
    elements.importCancel.disabled = true;
    try {
      const response = await chrome.runtime.sendMessage({ type: "CANCEL_IMPORT_JOB", jobId: activeImportJob.id });
      if (!response?.ok) throw new Error(response?.message || "无法取消导入");
      activeImportJob = response.job;
      renderImportJob();
      await refreshAfterImport(activeImportJob);
    } catch (error) {
      elements.importJobFeedback.textContent = error.message || "无法取消导入";
    } finally {
      elements.importCancel.disabled = false;
    }
    return;
  }
  if (activeImportJob) return closeImportDialog();
  await closeImportDialog();
}

async function retryLocalImportJob() {
  if (!activeImportJob) return;
  elements.importRetry.disabled = true;
  try {
    const response = await chrome.runtime.sendMessage({ type: "RETRY_IMPORT_JOB", jobId: activeImportJob.id });
    if (!response?.ok) throw new Error(response?.message || "无法重试失败项");
    activeImportJob = response.job;
    renderImportJob();
    scheduleImportJobPoll();
  } catch (error) {
    elements.importJobFeedback.textContent = error.message || "无法重试失败项";
  } finally {
    elements.importRetry.disabled = false;
  }
}

async function undoLocalImportJob() {
  if (!activeImportJob) return;
  elements.importUndo.disabled = true;
  try {
    const response = await chrome.runtime.sendMessage({ type: "UNDO_IMPORT_JOB", jobId: activeImportJob.id });
    if (!response?.ok) throw new Error(response?.message || "无法撤销本次导入");
    activeImportJob = response.job;
    renderImportJob();
    await refreshAfterImport(activeImportJob);
  } catch (error) {
    elements.importJobFeedback.textContent = error.message || "无法撤销本次导入";
  } finally {
    elements.importUndo.disabled = false;
  }
}

function viewImportedProject() {
  const collectionId = activeImportJob?.collectionId;
  if (!collectionId) return;
  caseOrderManagementActive = false;
  selectedCollectionId = collectionId;
  renderGallery();
  window.scrollTo({ top: 0, behavior: "instant" });
  latestImportJob = activeImportJob;
  activeImportJob = null;
  elements.importDialog.close();
}

async function closeImportDialog() {
  if (!activeImportJob) await discardPendingLocalImport();
  if (activeImportJob && !["queued", "running"].includes(activeImportJob.status)) {
    latestImportJob = activeImportJob;
    activeImportJob = null;
  }
  if (elements.importDialog.open) elements.importDialog.close();
}

async function discardPendingLocalImport() {
  const staged = pendingLocalImport?.stagedAssets ?? [];
  pendingLocalImport = null;
  await Promise.allSettled(staged.flatMap((item) => [item.assetId, item.posterAssetId].filter(Boolean)).map(deleteMediaBlob));
  await Promise.allSettled(staged
    .filter((item) => item.recordType === LOCAL_ASSET_REFERENCE_RECORD_TYPE)
    .map((item) => deleteLocalAssetHandle(item.assetId)));
}

function showImportFeedback(message, isError = false) {
  elements.importFeedback.textContent = message;
  elements.importFeedback.classList.toggle("error", isError);
}

function commonImportRoot(items) {
  const roots = new Set(items.map((item) => String(item.relativePath || "").replaceAll("\\", "/").split("/")[0]).filter(Boolean));
  return roots.size === 1 ? [...roots][0] : "";
}

function hasFileTransfer(event) {
  return [...(event.dataTransfer?.types ?? [])].includes("Files");
}

function handleLibraryDragEnter(event) {
  if (!hasFileTransfer(event)) return;
  event.preventDefault();
  importDragDepth += 1;
  elements.libraryDropTarget.hidden = false;
}

function handleLibraryDragOver(event) {
  if (!hasFileTransfer(event)) return;
  event.preventDefault();
  event.dataTransfer.dropEffect = "copy";
}

function handleLibraryDragLeave(event) {
  if (!hasFileTransfer(event)) return;
  importDragDepth = Math.max(0, importDragDepth - 1);
  if (!importDragDepth) elements.libraryDropTarget.hidden = true;
}

async function handleLibraryDrop(event) {
  if (!hasFileTransfer(event)) return;
  event.preventDefault();
  importDragDepth = 0;
  elements.libraryDropTarget.hidden = true;
  const items = await droppedLocalFiles(event.dataTransfer);
  await prepareLocalImport(items, { source: items.some((item) => item.relativePath.includes("/")) ? "folder" : "files" });
}

async function droppedLocalFiles(dataTransfer) {
  const handleRoots = (await Promise.all([...dataTransfer?.items ?? []].map(async (item) => {
    if (item.kind !== "file" || typeof item.getAsFileSystemHandle !== "function") return null;
    try { return await item.getAsFileSystemHandle(); } catch { return null; }
  }))).filter(Boolean);
  if (handleRoots.length) {
    const nested = await Promise.all(handleRoots.map((handle) => readDroppedHandle(handle, "")));
    return nested.flat();
  }
  const roots = [...(dataTransfer?.items ?? [])].flatMap((item) => {
    const entry = item.kind === "file" ? item.webkitGetAsEntry?.() : null;
    return entry ? [entry] : [];
  });
  if (!roots.length) return [...(dataTransfer?.files ?? [])].map((file) => ({ file, relativePath: file.name }));
  const nested = await Promise.all(roots.map((entry) => readDroppedEntry(entry, "")));
  return nested.flat();
}

async function readDroppedHandle(handle, parentPath) {
  const relativePath = parentPath ? `${parentPath}/${handle.name}` : handle.name;
  if (handle.kind === "file") return [{ handle, file: await handle.getFile(), relativePath }];
  if (handle.kind !== "directory") return [];
  const nested = [];
  for await (const child of handle.values()) nested.push(...await readDroppedHandle(child, relativePath));
  return nested;
}

async function readDroppedEntry(entry, parentPath) {
  const relativePath = parentPath ? `${parentPath}/${entry.name}` : entry.name;
  if (entry.isFile) {
    const file = await new Promise((resolve, reject) => entry.file(resolve, reject));
    return [{ file, relativePath }];
  }
  if (!entry.isDirectory) return [];
  const reader = entry.createReader();
  const children = [];
  while (true) {
    const batch = await new Promise((resolve, reject) => reader.readEntries(resolve, reject));
    if (!batch.length) break;
    children.push(...batch);
  }
  const nested = await Promise.all(children.map((child) => readDroppedEntry(child, relativePath)));
  return nested.flat();
}

async function addVideoReference(entryId = "") {
  const organizationFields = entryId ? [] : caseCreationOrganizationFields();
  let projectInput = null;
  const result = await showAppDialog({
    title: "添加视频链接",
    description: "支持 YouTube、Vimeo、Bilibili、抖音和 X。这里只保存来源引用卡，不下载视频文件。",
    confirmLabel: "解析并保存",
    pendingLabel: "正在解析链接并保存…",
    fields: [{
      id: "url",
      label: "视频网页地址",
      type: "url",
      placeholder: "https://…",
      autocomplete: "url",
      required: true
    }, ...organizationFields],
    onReady: ({ controls }) => {
      projectInput = controls.get("projectName");
      attachProjectSuggestions(projectInput);
    },
    onSubmit: async ({ url, projectName, customLabels }) => saveVideoReference(
      url,
      entryId,
      caseCreationOrganization(projectName, customLabels, projectInput?.dataset.projectId)
    )
  });
  if (result) {
    showFeedback(result.message);
    await refreshLibrary();
  }
}

async function saveVideoReference(value, entryId = "", organization = {}) {
  let posterAssetId = "";
  try {
    const metadata = await resolveMediaReference(value, {
      fetch: globalThis.fetch.bind(globalThis),
      requestOrigins: (origins) => chrome.permissions.request({ origins })
    });
    const url = new URL(metadata.canonicalUrl);
    const provider = metadata.provider;
    const providerLabel = mediaReferenceProviderLabel(provider);
    const videoAssetId = globalThis.crypto.randomUUID();
    let posterAsset = null;
    const posterBlob = metadata.posterUrl ? await fetchVideoReferencePoster(metadata.posterUrl).catch(() => null) : null;
    if (posterBlob) {
      posterAssetId = globalThis.crypto.randomUUID();
      const dimensions = await readImageDimensions(posterBlob);
      assertImageDimensions(dimensions.width, dimensions.height);
      posterAsset = normalizeMediaAsset({
        id: posterAssetId, kind: "image", usage: "poster", derivedFromAssetId: videoAssetId,
        storageMode: "managed", mimeType: posterBlob.type, byteSize: posterBlob.size,
        width: dimensions.width, height: dimensions.height, sourceUrl: metadata.posterUrl,
        sourceTitle: `${metadata.title || providerLabel} 视频封面`, reviewStatus: "verified"
      });
      await saveMediaBlob(posterAssetId, posterBlob);
    }
    const asset = normalizeMediaAsset({
      id: videoAssetId,
      kind: "video",
      storageMode: "reference",
      sourceUrl: url.href,
      sourceTitle: metadata.title || url.hostname,
      ...(metadata.durationMs ? { durationMs: metadata.durationMs } : {}),
      ...(posterAsset ? { posterAssetId: posterAsset.id } : {}),
      reference: {
        url: url.href,
        provider,
        playbackMode: metadata.playbackMode,
        metadataStatus: metadata.metadataStatus,
        ...(metadata.author ? { author: metadata.author } : {})
      },
      playbackCapability: "external",
      reviewStatus: "verified"
    });
    const response = await chrome.runtime.sendMessage(entryId
      ? { type: "ADD_UPLOADED_MEDIA", entryId, asset, posterAsset }
      : { type: "CREATE_MEDIA_REFERENCE", asset, posterAsset, title: metadata.title || url.hostname, ...organization });
    if (!response?.ok) throw new Error(response?.message || "视频链接保存失败");
    return response;
  } catch (error) {
    if (posterAssetId) await deleteMediaBlob(posterAssetId).catch(() => undefined);
    throw new Error(error.message || "视频链接无效");
  }
}

async function fetchVideoReferencePoster(value) {
  const imageUrl = new URL(value);
  const permission = `${imageUrl.origin}/*`;
  if (!await chrome.permissions.request({ origins: [permission] })) return null;
  const posterResponse = await fetch(imageUrl.href, { credentials: "omit", redirect: "follow" });
  if (!posterResponse.ok) return null;
  const posterBlob = await posterResponse.blob();
  if (!posterBlob.type.startsWith("image/") || !posterBlob.size || posterBlob.size > PORTABLE_LIBRARY_LIMITS.maxImageBytes) return null;
  return posterBlob;
}

async function createQuickNote() {
  let projectInput = null;
  const result = await showAppDialog({
    title: "快速笔记",
    description: "标题和正文一次填写，保存后会作为资料文档显示在案例库。",
    confirmLabel: "保存笔记",
    pendingLabel: "正在保存…",
    fields: [
      { id: "title", label: "标题（可留空）", type: "text", required: false, autocomplete: "off" },
      { id: "text", label: "笔记正文", type: "textarea", rows: 8, required: true, placeholder: "写下创作想法、判断或待办…" },
      ...caseCreationOrganizationFields()
    ],
    onReady: ({ controls }) => {
      projectInput = controls.get("projectName");
      attachProjectSuggestions(projectInput);
    },
    onSubmit: async ({ title, text, projectName, customLabels }) => {
      const response = await chrome.runtime.sendMessage({
        type: "CREATE_QUICK_NOTE",
        title,
        text,
        ...caseCreationOrganization(projectName, customLabels, projectInput?.dataset.projectId)
      });
      if (!response?.ok) throw new Error(response?.message || "笔记保存失败");
      return response;
    }
  });
  if (result) {
    const response = result;
    showFeedback(response.message);
    await refreshLibrary();
  }
}

function caseCreationOrganizationFields() {
  return [
    {
      id: "projectName",
      label: "项目",
      type: "text",
      required: false,
      autocomplete: "off",
      placeholder: "选择已有项目或输入新项目名"
    },
    {
      id: "customLabels",
      label: "添加标签",
      type: "text",
      required: false,
      autocomplete: "off",
      placeholder: "例如：风格不错，很喜欢"
    }
  ];
}

function attachProjectSuggestions(input) {
  if (!input) return;
  attachProjectCombobox(input, { projects: projectComboboxCollections(), destroyOnDialogClose: true });
}

function caseCreationOrganization(projectNameValue, customLabelsValue, projectIdValue = "") {
  const projectName = String(projectNameValue ?? "").trim();
  const existing = organizerState.collections.find((item) => item.id === String(projectIdValue ?? "").trim());
  const customLabels = String(customLabelsValue ?? "")
    .split(/[,，\n\r]+/u)
    .map(normalizeImportLabel)
    .filter(Boolean)
    .filter((label, index, values) => values.findIndex((item) => importLabelKey(item) === importLabelKey(label)) === index);
  return {
    ...(existing ? { collectionId: existing.id } : projectName ? { newCollectionName: projectName } : {}),
    customLabels
  };
}

async function prepareLocalMedia(file, assetId, options = {}) {
  return prepareSharedLocalMedia(file, assetId, {
    relativePath: options.relativePath || file.name,
    forceImport: options.forceImport === true,
    estimateStorage: () => navigator.storage?.estimate?.() ?? {},
    readImageDimensions,
    readVideoMedia,
    extractPdfText: extractPdfSearchText,
    parseHtml: (source) => new DOMParser().parseFromString(source, "text/html")
  });
}

async function readDocumentText(blob, mimeType) {
  const extension = mimeType === "text/markdown" ? "md"
    : mimeType === "text/html" ? "html"
      : ["application/rtf", "text/rtf", "application/x-rtf"].includes(mimeType) ? "rtf"
        : "txt";
  return extractLocalDocumentText(blob, {
    extension,
    parseHtml: (source) => new DOMParser().parseFromString(source, "text/html")
  });
}

function documentTypeLabel(mimeType, sourceFormat = "") {
  const extension = String(sourceFormat || "").toLocaleLowerCase("en-US");
  if (["srt", "vtt", "ass", "ssa", "sbv", "lrc"].includes(extension)) return `${extension.toLocaleUpperCase("en-US")} 字幕`;
  return ({
    "text/plain": "TXT",
    "text/markdown": "Markdown",
    "text/html": "HTML",
    "application/rtf": "RTF",
    "text/rtf": "RTF",
    "application/x-rtf": "RTF"
  })[mimeType] || "文档";
}

function readVideoMedia(blob, mimeType, videoAssetId = "") {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(blob);
    const video = document.createElement("video");
    let settled = false;
    const finish = (metadata, poster = null) => {
      if (settled) return;
      settled = true;
      URL.revokeObjectURL(url);
      video.removeAttribute("src");
      resolve({ metadata, poster });
    };
    const metadata = () => ({
      ...(Number.isFinite(video.videoWidth) && video.videoWidth > 0 ? { width: video.videoWidth } : {}),
      ...(Number.isFinite(video.videoHeight) && video.videoHeight > 0 ? { height: video.videoHeight } : {}),
      ...(Number.isFinite(video.duration) && video.duration > 0 ? { durationMs: Math.round(video.duration * 1000) } : {}),
      playbackCapability: "native"
    });
    video.preload = "auto";
    video.muted = true;
    video.playsInline = true;
    video.onloadeddata = async () => {
      if (!videoAssetId || !video.videoWidth || !video.videoHeight) return finish(metadata());
      try {
        const canvas = document.createElement("canvas");
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        canvas.getContext("2d").drawImage(video, 0, 0, canvas.width, canvas.height);
        const posterBlob = await canvasBlob(canvas, "image/webp", 0.84);
        const posterId = globalThis.crypto.randomUUID();
        finish(metadata(), {
          blob: posterBlob,
          asset: {
            id: posterId, kind: "image", usage: "poster", derivedFromAssetId: videoAssetId,
            storageMode: "managed", mimeType: posterBlob.type, byteSize: posterBlob.size,
            width: canvas.width, height: canvas.height, sourceTitle: "视频封面",
            capturedAt: new Date().toISOString(), reviewStatus: "verified"
          }
        });
      } catch { finish(metadata()); }
    };
    video.onloadedmetadata = () => setTimeout(() => finish(metadata()), 2500);
    video.onerror = () => finish({ playbackCapability: "external" });
    video.src = url;
    if (!video.canPlayType(mimeType)) setTimeout(() => finish({ playbackCapability: "external" }), 800);
  });
}

function createDetailAttributes(entry) {
  const grouped = groupEntryAssignments(entry, facetCatalog, "confirmed");
  const tags = [];
  let stableOrder = 0;
  for (const facet of facetCatalog.facets.filter((item) => item.status === "active").sort((a, b) => a.order - b.order)) {
    const values = (grouped.get(facet.id) ?? []).toSorted((left, right) => Number(right.importance ?? 0) - Number(left.importance ?? 0));
    values.forEach((item) => tags.push({ facet, label: item.name, path: item.path, priority: 0, importance: Number(item.importance ?? 0), stableOrder: stableOrder++ }));
    if (facet.id === "negative") entry.negativeTerms?.forEach((term) => tags.push({ facet, label: term, priority: 1, importance: 0, stableOrder: stableOrder++ }));
  }
  if (!tags.length) return null;
  tags.sort((left, right) => left.priority - right.priority || right.importance - left.importance || left.stableOrder - right.stableOrder);
  const section = el("section", "detail-section attribute-section");
  section.append(textEl("h3", "", "AI 标签"));
  const visible = el("div", "detail-tags");
  tags.slice(0, DETAIL_TAG_PREVIEW_LIMIT).forEach((item) => visible.append(detailTag(item)));
  section.append(visible);
  const remaining = tags.slice(DETAIL_TAG_PREVIEW_LIMIT);
  if (remaining.length) {
    const overflow = el("details", "detail-tag-overflow");
    overflow.append(textEl("summary", "", `更多标签 ${remaining.length}`));
    const rest = el("div", "detail-tags");
    remaining.forEach((item) => rest.append(detailTag(item)));
    overflow.append(rest);
    section.append(overflow);
  }
  return section;
}

function createDetailMetadata(entry, { includeDelete = false } = {}) {
  const rows = entrySourceMetadataRows(entry, currentLocale() === "en" ? "Source" : "来源");
  const sourceUrl = safeHttpUrl(entry.url);
  if (!rows.length && !sourceUrl) return null;
  const section = el("section", "detail-section metadata-section");
  const heading = el("div", "metadata-heading");
  heading.append(textEl("h3", "", currentLocale() === "en" ? "Source details" : "来源信息"));
  const actions = el("div", "metadata-actions");
  if (sourceUrl) {
    const openSource = textEl("a", "button-secondary source-open-action", currentLocale() === "en" ? "Open source" : "打开来源");
    openSource.href = sourceUrl;
    openSource.target = "_blank";
    openSource.rel = "noopener noreferrer";
    actions.append(openSource);
  }
  if (includeDelete) actions.append(createDetailDeleteAction(entry));
  if (actions.childElementCount) heading.append(actions);
  section.append(heading);
  const list = el("dl", "metadata-list");
  rows.forEach((row) => {
    const item = el("div", "metadata-row");
    item.append(rawTextEl("dt", "metadata-key", row.label), rawTextEl("dd", "metadata-value", row.value));
    list.append(item);
  });
  if (rows.length) section.append(list);
  return section;
}

function createFullAnalysis(entry) {
  const items = (Array.isArray(entry.analysisBreakdown) ? entry.analysisBreakdown : []).filter((item) =>
    item?.source && item.source !== "deepseek_text"
  );
  if (!items.length) return null;
  const details = el("details", "detail-section full-analysis");
  details.append(rawTextEl("summary", "", currentLocale() === "en"
    ? `View complete analysis (${items.length})`
    : `查看完整分析（${items.length}）`));
  const list = el("div", "full-analysis-list");
  items.forEach((item) => {
    const row = el("article", "full-analysis-item");
    const path = [item.dimensionName, item.groupName, item.tagName].filter(Boolean).join(" / ");
    row.append(rawTextEl("strong", "", path), rawTextEl("p", "", item.evidence));
    const scores = [];
    if (Number.isFinite(item.importance)) scores.push(currentLocale() === "en" ? `importance ${Math.round(item.importance * 100)}%` : `重要度 ${Math.round(item.importance * 100)}%`);
    if (Number.isFinite(item.confidence)) scores.push(currentLocale() === "en" ? `confidence ${Math.round(item.confidence * 100)}%` : `置信度 ${Math.round(item.confidence * 100)}%`);
    if (scores.length) row.append(rawTextEl("small", "", scores.join(" · ")));
    list.append(row);
  });
  details.append(list);
  return details;
}

function createVisualSetAnalyses(entry) {
  const analyses = Array.isArray(entry.visualSetAnalyses) ? entry.visualSetAnalyses : [];
  if (!analyses.length) return null;
  const details = el("details", "detail-section full-analysis visual-set-analysis");
  details.append(rawTextEl("summary", "", `整组图片关系分析（${analyses.length}）`));
  const list = el("div", "full-analysis-list");
  for (const analysis of analyses.toReversed()) {
    const row = el("article", "full-analysis-item");
    row.append(
      rawTextEl("strong", "", `批次 ${analysis.batchIndex + 1}/${analysis.batchCount}`),
      rawTextEl("p", "", analysis.text),
      rawTextEl("small", "", [analysis.provider, analysis.model, new Date(analysis.createdAt).toLocaleString()].filter(Boolean).join(" · "))
    );
    list.append(row);
  }
  details.append(list);
  return details;
}

function detailTag({ facet, label, path = label }) {
  const tag = rawTextEl("span", "attribute-pill", label);
  tag.style.setProperty("--facet-color", facet.color);
  const fullPath = [facet.name, path].filter(Boolean).join(" / ");
  tag.title = fullPath;
  tag.setAttribute("aria-label", fullPath);
  return tag;
}

function createAnalysisCandidate(entry, item, queueAware = false) {
  const row = el("div", "suggestion");
  const copy = el("div", "");
  const dimension = labeledInput("维度", item.dimensionName);
  const group = labeledInput("分组（可选）", item.groupName || "");
  const tag = labeledInput("标签", item.tagName);
  const sourceLabel = item.source === "deepseek_text" ? "AI 文字分析" : item.source === "local_image_review" ? "本地人工看图" : "本地结构提取";
  const reason = item.reviewReason ? ` · 待确认原因：${item.reviewReason}` : "";
  copy.append(textEl("strong", "", `${item.dimensionName}${item.groupName ? ` / ${item.groupName}` : ""} / ${item.tagName}`), textEl("p", "", `${sourceLabel} · 证据：${item.evidence}${reason}`), dimension.label, group.label, tag.label);
  const actions = el("div", "suggestion-actions");
  const accept = textEl("button", "", "确认");
  const reject = textEl("button", "reject", "拒绝");
  accept.addEventListener("click", () => {
    const message = {
      type: "ACCEPT_ANALYSIS_CANDIDATE", entryId: entry.id, candidateId: item.id,
      edits: { dimensionName: dimension.input.value, groupName: group.input.value, tagName: tag.input.value }
    };
    return queueAware ? performPendingReview(accept, message, entry.id) : perform(accept, message);
  });
  reject.addEventListener("click", () => {
    const message = { type: "REJECT_ANALYSIS_CANDIDATE", entryId: entry.id, candidateId: item.id };
    return queueAware ? performPendingReview(reject, message, entry.id) : perform(reject, message);
  });
  actions.append(accept, reject);
  row.append(copy, actions);
  return row;
}

function createPromptSection(entry, options = {}) {
  if (!entry.text && !entryHasMedia(entry)) return null;
  const section = el("section", "detail-section prompt-section");
  const activeAssetId = activeDetailMediaIdByEntry.get(entry.id) || entry.primaryMediaId;
  const activeImage = entryMediaAssets(entry).find((asset) => asset.id === activeAssetId && asset.kind === "image" && asset.usage !== "poster");
  const imageAssets = entryMediaAssets(entry).filter((asset) => asset.kind === "image" && asset.usage !== "poster");
  const managedImageAssets = imageAssets.filter((asset) => asset.storageMode === "managed");
  const separatesCurrentAndShared = Boolean(activeImage && (imageAssets.length > 1 || options.compoundMember));
  const mediaPrompt = activeImage ? (entry.mediaPrompts || []).find((item) => item.assetId === activeImage.id) : null;
  const displayedPrompt = activeImage ? promptForEntryImage(entry, activeImage.id) : String(entry.text ?? "").trim();
  const analysisInput = canonicalTextAnalysisInput(entry, activeImage?.id || "");
  if (promptEditState?.entryId === entry.id) {
    const textarea = document.createElement("textarea");
    textarea.className = "prompt-text prompt-editor";
    textarea.value = promptEditState.draftText;
    textarea.setAttribute("aria-label", t("编辑提示词"));
    textarea.addEventListener("input", () => {
      promptEditState.draftText = textarea.value;
      promptEditState.dirty = textarea.value !== promptEditState.originalText;
    });
    const actions = el("div", "prompt-edit-actions");
    const save = textEl("button", "", "保存");
    const cancel = textEl("button", "button-secondary", "取消");
    save.addEventListener("click", async () => {
      save.disabled = true;
      try {
        const response = await chrome.runtime.sendMessage(promptEditState.assetId ? {
          type: "UPDATE_ENTRY_MEDIA_PROMPT",
          entryId: entry.id,
          assetId: promptEditState.assetId,
          text: textarea.value
        } : {
          type: "UPDATE_ENTRY_TEXT",
          entryId: entry.id,
          text: textarea.value,
          textRevision: entryTextRevision(entry)
        });
        if (!response?.ok) throw new Error(response?.message || "提示词保存失败");
        promptEditState = null;
        showFeedback(response.message);
        await refreshLibrary();
      } catch (error) {
        showFeedback(error.message || "提示词保存失败", true);
      } finally {
        save.disabled = false;
      }
    });
    cancel.addEventListener("click", () => {
      promptEditState = null;
      renderDetail();
    });
    actions.append(save, cancel);
    section.append(textEl("h3", "", promptEditState.assetId ? "编辑当前图片提示词" : "编辑案例共享提示词"), textarea, actions);
    queueMicrotask(() => textarea.focus());
    return section;
  }
  const heading = el("div", "prompt-section-heading");
  heading.append(textEl("h3", "", activeImage
    ? separatesCurrentAndShared ? (mediaPrompt ? "当前图片提示词" : entry.text ? "当前图片 · 使用共享提示词" : "当前图片提示词") : "提示词"
    : "提示词"));
  const copy = textEl("button", "button-secondary", "复制提示词");
  const vision = primaryVisionAnalysis(entry);
  const primary = primaryVisual(entry);
  const analyzeVisual = primary?.kind === "image" && !entry.compoundCase
    ? textEl("button", "button-secondary", vision ? "重新分析主图" : "分析主图")
    : null;
  const analyze = textEl("button", "button-secondary", "分析检索标签");
  const edit = textEl("button", "button-secondary", separatesCurrentAndShared ? "编辑当前图片" : "编辑");
  const editShared = separatesCurrentAndShared && entry.text ? textEl("button", "button-secondary", "编辑共享提示词") : null;
  const promptReplacement = activeImage ? visualAnalysisPromptReplacement(entry, activeImage.id) : null;
  const replaceAnalyzedPrompt = promptReplacement ? textEl("button", "button-secondary", "更新为 V2 提示词") : null;
  copy.disabled = !displayedPrompt;
  analyze.disabled = !analysisInput.text;
  copy.addEventListener("click", () => copyTextWithFeedback(
    copy,
    displayedPrompt,
    "完整提示词已复制",
    "浏览器未允许复制，请选中文本后复制"
  ));
  analyzeVisual?.addEventListener("click", () => analyzeEntryVision(entry, analyzeVisual));
  analyze.addEventListener("click", () => analyzeSingleEntry(entry, analyze, analysisInput));
  edit.addEventListener("click", () => {
    promptEditState = { entryId: entry.id, assetId: separatesCurrentAndShared ? activeImage?.id || "" : "", originalText: displayedPrompt, draftText: displayedPrompt, dirty: false };
    renderDetail();
  });
  editShared?.addEventListener("click", () => {
    promptEditState = { entryId: entry.id, assetId: "", originalText: entry.text || "", draftText: entry.text || "", dirty: false };
    renderDetail();
  });
  replaceAnalyzedPrompt?.addEventListener("click", async () => {
    replaceAnalyzedPrompt.disabled = true;
    try {
      const reviewed = await reviewVisualAnalysisPromptReplacements(entry.id, [{ ...promptReplacement, index: 1 }]);
      if (reviewed?.message) showFeedback(reviewed.message);
      await refreshLibrary();
    } catch (error) {
      showFeedback(error.message || "图片提示词更新失败", true);
    } finally {
      replaceAnalyzedPrompt.disabled = false;
    }
  });
  heading.append(editShared || document.createDocumentFragment(), edit);
  const coreActions = el("div", "detail-core-actions");
  coreActions.append(copy, createComposerAction(entry));
  const analysisMenu = el("details", "detail-analysis-menu");
  analysisMenu.append(textEl("summary", "button-secondary", "完善分析"));
  const analysisActions = el("div", "detail-analysis-actions");
  if (replaceAnalyzedPrompt) analysisActions.append(replaceAnalyzedPrompt);
  if (analyzeVisual) analysisActions.append(analyzeVisual);
  if (managedImageAssets.length > 1 && !entry.compoundCase) {
    const analyzeSet = textEl("button", "button-secondary", "批量图片分析");
    analyzeSet.addEventListener("click", () => analyzeEntryVisualSet(entry, analyzeSet));
    analysisActions.append(analyzeSet);
  }
  analysisActions.append(analyze);
  analysisMenu.append(analysisActions);
  section.append(
    heading,
    rawTextEl("pre", `prompt-text${displayedPrompt ? "" : " is-empty"}`, displayedPrompt || t("暂无提示词")),
    coreActions,
    analysisMenu
  );
  if (textAnalysisReason(entry) === "text_changed") section.append(textEl("small", "prompt-analysis-stale", "提示词已修改，需要重新分析标签"));
  return section;
}

async function analyzeEntryVisualSet(entry, button) {
  const images = selectedSkillContentImages([entry], [entry.id]);
  const assets = entryMediaAssets(entry).filter((asset) => images.some((image) => image.visualId === asset.id));
  const imageAssignment = aiTaskAssignments.imageAnalysis ?? {};
  const imageProvider = aiProviderRegistry.providers?.[imageAssignment.providerId];
  const summaryAssignment = aiTaskAssignments.creativePlanning ?? {};
  const summaryProvider = aiProviderRegistry.providers?.[summaryAssignment.providerId];
  const completedAssetIds = new Set();
  const savedPromptSuggestions = new Map(assets.flatMap((asset, index) => {
    const replacement = visualAnalysisPromptReplacement(entry, asset.id);
    return replacement ? [[asset.id, { ...replacement, index: index + 1 }]] : [];
  }));
  let dialogControls = null;
  const stateFor = (asset) => {
    const analysis = asset?.visionAnalysis;
    const currentFingerprint = asset?.contentHash || (!analysis?.invalidated && Number(analysis?.version) === 2
      ? analysis?.imageFingerprint : "");
    const fingerprintMatches = Boolean(currentFingerprint && analysis?.imageFingerprint
      && currentFingerprint === analysis.imageFingerprint);
    if (analysis?.invalidated || !fingerprintMatches) return { valid: false, label: "分析已过期" };
    if (Number(analysis?.version) === 2 && analysis?.quality !== "partial" && analysis?.reconstructionPrompt) return { valid: true, label: "有效 V2，可直接复用" };
    if (analysis?.quality === "partial") return { valid: false, label: "分析失败，请重试" };
    return { valid: false, label: "未分析" };
  };
  const missingAssets = assets.filter((asset) => !stateFor(asset).valid);
  const cardByAssetId = new Map();
  let updateSelectionSummary = () => undefined;
  const result = await showAppDialog({
    title: "批量图片分析",
    description: `${images.length} 张图片 · 默认补齐 ${missingAssets.length} 张缺失或过期分析。图片分析：${imageProvider?.label || "未配置"} · ${imageAssignment.model || "模型未填写"}；整组总结：${summaryProvider?.label || "未配置"} · ${summaryAssignment.model || "模型未填写"}。`,
    dialogClass: "visual-analysis-dialog",
    bodyClass: "visual-analysis-dialog-body",
    confirmLabel: "开始分析",
    pendingLabel: "正在保存逐图结果；已成功的图片不会重复请求…",
    fields: [{ id: "includeSummary", label: "完成后生成整个案例总结（复用已有有效分析）", type: "checkbox", value: true }],
    renderBody: ({ body, controls }) => {
      const workspace = el("section", "visual-analysis-workspace");
      const toolbar = el("div", "visual-analysis-toolbar");
      const selectMissing = textEl("button", "button-secondary", "选择缺失/过期");
      const selectAll = textEl("button", "button-secondary", "全选");
      const clear = textEl("button", "button-secondary", "清空");
      for (const control of [selectMissing, selectAll, clear]) control.type = "button";
      const count = rawTextEl("span", "visual-analysis-selection-count", "");
      toolbar.append(selectMissing, selectAll, clear, count);
      const grid = el("div", "visual-analysis-grid");
      assets.forEach((asset, index) => {
        const fieldId = `asset_${index}`;
        const card = el("article", "visual-analysis-card");
        card.dataset.assetId = asset.id;
        card.dataset.state = stateFor(asset).valid ? "valid" : "pending";
        const input = document.createElement("input");
        input.type = "checkbox";
        input.id = `visual-analysis-${asset.id}`;
        input.checked = !stateFor(asset).valid;
        input.setAttribute("aria-label", `选择图片 ${index + 1}`);
        controls.set(fieldId, input);
        const label = document.createElement("label");
        label.htmlFor = input.id;
        const image = document.createElement("img");
        image.alt = `图片 ${index + 1}`;
        image.dataset.assetId = asset.id;
        const meta = el("span", "visual-analysis-card-meta");
        meta.append(rawTextEl("strong", "", `图片 ${index + 1}`), rawTextEl("small", "visual-analysis-card-status", stateFor(asset).label));
        label.append(image, meta);
        const inspect = textEl("button", "visual-analysis-inspect button-secondary", "查看");
        inspect.type = "button";
        inspect.setAttribute("aria-label", `查看图片 ${index + 1} 原图`);
        input.addEventListener("change", () => updateSelectionSummary());
        card.append(input, label, inspect);
        grid.append(card);
        cardByAssetId.set(asset.id, card);
      });
      const requestSummary = rawTextEl("p", "visual-analysis-request-summary", "");
      updateSelectionSummary = () => {
        const selectedCount = assets.filter((asset, index) => controls.get(`asset_${index}`)?.checked).length;
        count.textContent = t("已选 {selected}/{total}", { selected: selectedCount, total: assets.length });
        requestSummary.textContent = t("将发送 {count} 次图片分析请求 · {summary}", { count: selectedCount, summary: controls.get("includeSummary")?.checked ? t("1 次纯文字总结") : t("不生成整组总结") });
      };
      const setChecks = (predicate) => {
        assets.forEach((asset, index) => {
          const input = controls.get(`asset_${index}`);
          if (input && !input.disabled) input.checked = predicate(asset);
        });
        updateSelectionSummary();
      };
      selectMissing.addEventListener("click", () => setChecks((asset) => !stateFor(asset).valid));
      selectAll.addEventListener("click", () => setChecks(() => true));
      clear.addEventListener("click", () => setChecks(() => false));
      controls.get("includeSummary")?.addEventListener("change", updateSelectionSummary);
      workspace.append(toolbar, grid, requestSummary);
      body.append(workspace);
      updateSelectionSummary();
    },
    onReady: ({ controls }) => {
      dialogControls = controls;
      assets.forEach(async (asset, index) => {
        const card = cardByAssetId.get(asset.id);
        const image = card?.querySelector("img");
        if (!image) return;
        image.src = await originalScreenshotUrl(asset.id);
        card.querySelector(".visual-analysis-inspect")?.addEventListener("click", () => openImageLightbox(image, entry));
      });
    },
    onSubmit: async (values, { status }) => {
      const selectedAssets = assets.filter((asset, index) => values[`asset_${index}`] && !completedAssetIds.has(asset.id));
      const excludedMissing = missingAssets.filter((asset) => !values[`asset_${assets.indexOf(asset)}`] && !completedAssetIds.has(asset.id));
      if (values.includeSummary && excludedMissing.length) {
        throw new Error(`整组总结还缺 ${excludedMissing.length} 张独立分析；请勾选这些图片，或关闭整组总结`);
      }
      if (selectedAssets.length && (!imageProvider?.credentialConfigured || !imageProvider?.consent || !imageAssignment.model)) {
        throw new Error("图片分析服务尚未完成 API Key、模型或发送授权配置");
      }
      if (values.includeSummary && (!summaryProvider?.credentialConfigured || !summaryProvider?.consent || !summaryAssignment.model)) {
        throw new Error("整组总结所用的创作规划服务尚未完成配置");
      }
      const promptSuggestions = [];
      const failures = [];
      await Promise.allSettled(selectedAssets.map(async (asset) => {
        const imageIndex = assets.findIndex((item) => item.id === asset.id);
        const card = cardByAssetId.get(asset.id);
        const statusLabel = card?.querySelector(".visual-analysis-card-status");
        if (card) card.dataset.state = "processing";
        if (statusLabel) statusLabel.textContent = t("正在分析…");
        try {
          const response = await chrome.runtime.sendMessage({
            type: "ANALYZE_ENTRY_IMAGE",
            entryId: entry.id,
            visualId: asset.id,
            outputLocale: currentLocale(),
            bypassCache: stateFor(asset).valid
          });
          if (!response?.ok) throw new Error(response?.message || "逐图分析失败");
          const partial = response.quality === "partial";
          if (partial) throw new Error("图片分析结果不完整，请重试");
          completedAssetIds.add(asset.id);
          const input = dialogControls?.get(`asset_${imageIndex}`);
          if (input) {
            input.checked = false;
            input.disabled = true;
          }
          if (card) card.dataset.state = "completed";
          if (statusLabel) statusLabel.textContent = t("本次已完成");
          updateSelectionSummary();
          const replacement = visualAnalysisPromptReplacement(response.entry, asset.id);
          if (replacement) savedPromptSuggestions.set(asset.id, { ...replacement, index: imageIndex + 1 });
        } catch (error) {
          const message = error.message || "请重试";
          failures.push({ index: imageIndex + 1, message });
          if (card) card.dataset.state = "failed";
          if (statusLabel) statusLabel.textContent = t("失败 · {message}", { message });
        }
      }));
      if (failures.length) {
        const statusLine = status();
        statusLine.classList.add("error");
        statusLine.textContent = t("{failed} 张失败，已成功 {completed} 张且不会重复请求。可直接重试失败项。", {
          failed: failures.length,
          completed: completedAssetIds.size
        });
        await refreshLibrary();
        return false;
      }
      if (values.includeSummary) {
        const response = await chrome.runtime.sendMessage({
          type: "ANALYZE_ENTRY_VISUAL_SET",
          entryId: entry.id,
          assetIds: images.map((image) => image.visualId),
          mode: "group",
          batchIndex: 0,
          batchCount: 1,
          outputLocale: currentLocale()
        });
        if (!response?.ok) throw new Error(response?.message || "整组关系分析失败");
      }
      promptSuggestions.push(...savedPromptSuggestions.values());
      return { mode: values.includeSummary ? "both" : "per-image", promptSuggestions };
    }
  });
  if (!result) {
    if (completedAssetIds.size) await refreshLibrary();
    return;
  }
  if (result.promptSuggestions?.length) {
    const reviewed = await reviewVisualAnalysisPromptReplacements(entry.id, result.promptSuggestions);
    if (reviewed?.message) showFeedback(reviewed.message);
  }
  button.disabled = true;
  showFeedback("批量图片分析已保存；用户已有提示词没有被覆盖");
  await refreshLibrary();
}

function createEntryEditor(entry, options = {}) {
  const section = el("details", `${options.inline ? "entry-editor-inline" : "detail-section"} entry-editor`);
  section.append(textEl("summary", "", "编辑案例"));
  const body = el("div", "entry-editor-body");
  const titleField = el("label", "entry-edit-field");
  const titleInput = document.createElement("input");
  titleInput.value = entry.title || "";
  titleField.append(textEl("span", "sr-only", "案例标题"), titleInput);
  const saveTitle = textEl("button", "button-secondary", "保存");
  saveTitle.addEventListener("click", () => {
    const title = titleInput.value;
    return perform(saveTitle, { type: "UPDATE_ENTRY_TITLE", entryId: entry.id, title: title.trim() });
  });
  const titleRow = el("div", "entry-edit-row");
  titleRow.append(titleField, saveTitle);
  body.append(textEl("h4", "", "案例标题"), titleRow);
  if (entry.classification?.status !== "needs_review") {
    const classification = createClassificationControl(entry, {
      buttonLabel: "保存",
      onSave: (button, select) => perform(button, { type: "CONFIRM_CLASSIFICATION", entryId: entry.id, pathIds: [select.value], rememberSource: false })
    });
    body.append(textEl("h4", "", "内容类型"), classification);
  }
  const grouped = groupEntryAssignments(entry, facetCatalog, "confirmed");
  const selected = el("div", "selected-edit-tags");
  for (const facet of facetCatalog.facets.filter((item) => item.status === "active").sort((a, b) => a.order - b.order)) {
    for (const item of grouped.get(facet.id) ?? []) {
      const remove = rawTextEl("button", "", `${facetNodeDisplayPath(item.nodeId)} ×`);
      remove.style.setProperty("--facet-color", facet.color);
      remove.title = facetDisplayName(facet);
      remove.addEventListener("click", () => perform(remove, { type: "SET_ENTRY_FACET", entryId: entry.id, facetId: facet.id, nodeId: item.nodeId, selected: false }));
      selected.append(remove);
    }
  }
  if (selected.childElementCount) body.append(textEl("h4", "", "已有 AI 标签"), selected);
  const activeFacets = facetCatalog.facets.filter((item) => item.status === "active").sort((a, b) => a.order - b.order);
  if (activeFacets.length) {
    const addRow = el("div", "entry-tag-add");
    const facetSelect = document.createElement("select");
    facetSelect.setAttribute("aria-label", t("选择创作维度"));
    facetSelect.append(option("", t("选择维度")), ...activeFacets.map((facet) => option(facet.id, facetDisplayName(facet))));
    const tagSelect = document.createElement("select");
    tagSelect.setAttribute("aria-label", t("选择创作标签"));
    tagSelect.disabled = true;
    tagSelect.append(option("", t("先选择维度")));
    const add = textEl("button", "", "添加标签");
    add.disabled = true;
    facetSelect.addEventListener("change", () => {
      const facetId = facetSelect.value;
      const nodes = facetId ? facetNodes(facetCatalog, facetId) : [];
      tagSelect.replaceChildren(option("", t(facetId ? "选择标签" : "先选择维度")), ...nodes.map((node) => option(node.id, facetNodeDisplayPath(node.id))));
      tagSelect.disabled = !nodes.length;
      add.disabled = true;
    });
    tagSelect.addEventListener("change", () => { add.disabled = !tagSelect.value; });
    add.addEventListener("click", () => perform(add, { type: "SET_ENTRY_FACET", entryId: entry.id, facetId: facetSelect.value, nodeId: tagSelect.value, selected: true }));
    addRow.append(facetSelect, tagSelect, add);
    body.append(textEl("h4", "", "添加 AI 标签"), addRow);
  }
  body.append(textEl("h4", "", "媒体与来源"), createMediaActions(entry));
  const analysisCandidates = reusableAnalysisItems(entry.analysisCandidates);
  if (analysisCandidates.length && !isEntryPending(entry)) {
    const suggestions = el("details", "detail-suggestions");
    suggestions.append(textEl("summary", "", `待确认建议 ${analysisCandidates.length}`));
    for (const item of analysisCandidates) suggestions.append(createAnalysisCandidate(entry, item));
    body.append(suggestions);
  }
  section.append(body);
  return section;
}

function renderManager() {
  const pendingCount = entries.filter(isEntryPending).length;
  const pendingTab = managerTabs.find((button) => button.dataset.managerTab === "pending");
  pendingTab.hidden = !pendingCount;
  pendingTab.textContent = t("待确认 {count}", { count: pendingCount });
  if (!pendingCount && activeManagerTab === "pending") activeManagerTab = "content-types";
  managerTabs.forEach((button) => button.setAttribute("aria-selected", String(button.dataset.managerTab === activeManagerTab)));
  Object.entries(managerPanels).forEach(([name, panel]) => { panel.hidden = name !== activeManagerTab; });
  if (activeManagerTab === "pending") renderPendingManager();
  if (activeManagerTab === "content-types") renderContentTypeManager();
  if (activeManagerTab === "vocabulary") renderVocabulary();
}

function renderPendingManager() {
  const content = document.createDocumentFragment();
  const pendingEntries = entries.filter(isEntryPending);
  if (!pendingEntries.length) content.append(textEl("div", "empty-state", "没有待确认内容。"));
  for (const entry of pendingEntries) {
    const card = el("article", "pending-case");
    const head = el("div", "pending-case-head");
    const mainVisual = primaryVisual(entry);
    if (mainVisual) {
      const imageWrap = el("div", "case-image-wrap pending-shot-wrap");
      if (mainVisual.width && mainVisual.height) imageWrap.style.aspectRatio = `${mainVisual.width} / ${mainVisual.height}`;
      const image = document.createElement("img");
      image.className = "case-shot pending-shot";
      image.alt = `${entry.title} 待确认画面`;
      image.dataset.visualId = mainVisual.id;
      image.loading = "lazy";
      image.decoding = "async";
      const cached = thumbnailUrls.get(entry.id);
      if (cached) image.src = cached;
      imageObserver.observe(image);
      imageWrap.append(image);
      head.append(imageWrap);
    }
    const summary = el("div", "pending-case-summary");
    summary.append(rawTextEl("h3", "", entry.title), rawTextEl("p", "", excerpt(entry.text, 180)));
    head.append(summary);
    card.append(head);
    if (entry.classification?.status === "needs_review") card.append(createClassificationControl(entry, {
      className: "pending-classification",
      buttonLabel: "确认分类",
      onSave: (button, select) => perform(button, { type: "CONFIRM_CLASSIFICATION", entryId: entry.id, pathIds: [select.value], rememberSource: false })
    }));
    for (const item of reusableAnalysisItems(entry.analysisCandidates)) card.append(createAnalysisCandidate(entry, item));
    content.append(card);
  }
  elements.managerPending.replaceChildren(content);
}

function renderVocabulary() {
  const facets = facetCatalog.facets.filter((item) => item.status === "active").sort((a, b) => a.order - b.order);
  if (!facets.some((item) => item.id === selectedVocabularyFacet)) selectedVocabularyFacet = facets[0]?.id || "";
  elements.vocabularyFacet.replaceChildren(...facets.map((item) => option(item.id, item.name, item.id === selectedVocabularyFacet)));
  const currentFacet = facetById(selectedVocabularyFacet);
  elements.createNodeForm.hidden = !currentFacet;
  elements.undoFacet.hidden = !canUndoFacetUpdate;
  elements.undoFacet.textContent = t("撤回上一步");
  const nodes = facetNodes(facetCatalog, selectedVocabularyFacet);
  const nodeById = new Map(nodes.map((item) => [item.id, item]));
  const pathLabels = new Map(nodes.map((item) => {
    const parent = item.parentId ? nodeById.get(item.parentId) : null;
    return [item.id, parent ? `${parent.name} / ${item.name}` : item.name];
  }));
  const parents = nodes.filter((item) => !item.parentId);
  elements.newNodeParent.replaceChildren(option("", "作为二级分组"), ...parents.map((item) => option(item.id, item.name)));
  const groups = parents.map((parent) => {
    const group = el("section", "vocabulary-group");
    group.append(createVocabularyNode(parent, nodes, true, pathLabels));
    const children = el("div", "vocabulary-children");
    nodes.filter((item) => item.parentId === parent.id).forEach((item) => children.append(createVocabularyNode(item, nodes, false, pathLabels)));
    group.append(children);
    return group;
  });
  const archiveRecovery = createArchivedVocabularyRecovery();
  elements.vocabularyTree.replaceChildren(
    ...(groups.length
      ? groups
      : [textEl("p", "vocabulary-empty", currentFacet ? "这个维度还没有标签。" : "先在下方设置中创建一个维度。")]),
    ...(archiveRecovery ? [archiveRecovery] : [])
  );
}

function renderContentTypeManager() {
  const cards = taxonomy.nodes.map((item) => {
    const card = el("article", "content-type-card");
    card.dataset.contentTypeId = item.id;
    const copy = el("div", "content-type-card-copy");
    const caseCount = contentTypeCaseCount(item.id);
    copy.append(
      rawTextEl("h3", "", contentLabel(item.id)),
      rawTextEl("p", "content-type-purpose", contentRoleDescription(item.role)),
      rawTextEl("small", "", currentLocale() === "en" ? `${caseCount} cases` : `${caseCount} 个案例`)
    );
    const edit = textEl("button", "button-secondary", "编辑");
    edit.type = "button";
    edit.addEventListener("click", () => {
      creatingContentType = false;
      editingContentTypeId = item.id;
      deletingContentType = false;
      renderContentTypeManager();
      elements.contentTypeName.focus();
    });
    card.append(copy, edit);
    return card;
  });
  elements.contentTypeList.replaceChildren(...cards);
  renderContentTypeEditor();
}

function renderContentTypeEditor() {
  const selected = taxonomy.nodes.find((item) => item.id === editingContentTypeId);
  const showEditor = creatingContentType || Boolean(selected);
  elements.contentTypeEditor.hidden = !showEditor;
  if (!showEditor) return;

  const role = selected?.role || CONTENT_ROLES.general;
  elements.contentTypeEditorTitle.textContent = creatingContentType ? t("新增一级分类") : contentLabel(selected.id);
  elements.saveContentType.textContent = creatingContentType ? t("创建一级分类") : t("保存修改");
  elements.contentTypeName.value = selected?.name || "";
  elements.contentTypeRole.replaceChildren(...contentRoleOptions().map(([value, label]) => option(value, label, value === role)));
  elements.deleteContentType.hidden = creatingContentType;
  elements.contentTypeCount.hidden = creatingContentType;
  elements.contentTypeCount.textContent = selected
    ? (currentLocale() === "en" ? `${contentTypeCaseCount(selected.id)} cases use this category.` : `${contentTypeCaseCount(selected.id)} 个案例正在使用这个分类。`)
    : "";
  renderContentTypeRoleHelp();

  elements.contentTypeDeleteTransfer.hidden = creatingContentType || !deletingContentType;
  if (!selected || !deletingContentType) return;
  const caseCount = contentTypeCaseCount(selected.id);
  const ruleCount = classificationRules.filter((rule) => rule.pathIds?.[0] === selected.id).length;
  const needsReplacement = caseCount > 0 || ruleCount > 0;
  const candidates = taxonomy.nodes.filter((item) => item.id !== selected.id);
  const replacement = elements.contentTypeReplacement.value;
  elements.contentTypeReplacement.replaceChildren(...candidates.map((item) => option(item.id, contentLabel(item.id), item.id === replacement)));
  elements.contentTypeReplacementField.hidden = !needsReplacement;
  elements.contentTypeDeleteMessage.textContent = needsReplacement
    ? (currentLocale() === "en"
        ? "Only the first-level category will change. Text, images, tags, projects, and compound relationships remain intact."
        : "只会转移一级分类；文字、图片、标签、项目和组合关系都会保留。")
    : t("这个分类没有案例，可以直接删除。");
  elements.confirmDeleteContentType.textContent = needsReplacement ? t("确认删除并转移") : t("确认删除");
  elements.confirmDeleteContentType.disabled = taxonomy.nodes.length <= 1 || (needsReplacement && !candidates.length);
}

function closeContentTypeEditor() {
  editingContentTypeId = "";
  creatingContentType = false;
  deletingContentType = false;
  renderContentTypeManager();
}

function renderContentTypeRoleHelp() {
  elements.contentTypeRoleHelp.textContent = contentRoleDescription(elements.contentTypeRole.value);
}

function contentTypeCaseCount(contentTypeId) {
  return entries.filter((entry) => entryContentTypeIds(entry).includes(contentTypeId)).length;
}

function contentRoleOptions() {
  return [
    [CONTENT_ROLES.general, t("普通资料")],
    [CONTENT_ROLES.tutorial, t("教程攻略")],
    [CONTENT_ROLES.imageCase, t("图片参考")],
    [CONTENT_ROLES.videoCase, t("视频案例")],
    [CONTENT_ROLES.reference, t("资料文档")],
    [CONTENT_ROLES.promptImage, t("图片提示词")],
    [CONTENT_ROLES.promptVideo, t("视频提示词")]
  ];
}

function contentRoleDescription(role) {
  return t({
    [CONTENT_ROLES.general]: "保存日常文件、工作资料和普通文字，不进入专用提示词创作流程。",
    [CONTENT_ROLES.tutorial]: "保存教程、攻略和操作说明，可用于查找和批量整理。",
    [CONTENT_ROLES.imageCase]: "保存图片、截图和视觉参考，可参与图片创作参考。",
    [CONTENT_ROLES.videoCase]: "保存本机视频和镜头资料，可记录时间点并参与视频创作参考。",
    [CONTENT_ROLES.reference]: "保存 PDF、Markdown、文本和创作笔记，可阅读、检索并按需作为创作参考。",
    [CONTENT_ROLES.promptImage]: "保存用于生成图片的提示词，可进入图片创作流程。",
    [CONTENT_ROLES.promptVideo]: "保存用于生成视频的提示词，可进入视频创作流程。"
  }[role] || "保存普通资料，不进入专用提示词创作流程。");
}

function createArchivedVocabularyRecovery() {
  const archivedFacets = facetCatalog.facets.filter((facet) => facet.status === "archived");
  const archivedNodes = facetCatalog.nodes.filter((node) =>
    node.facetId === selectedVocabularyFacet && node.status === "archived"
  );
  if (!archivedFacets.length && !archivedNodes.length) return null;

  const details = el("details", "archived-vocabulary");
  const total = archivedFacets.length + archivedNodes.length;
  details.append(rawTextEl("summary", "", currentLocale() === "en"
    ? `Archived vocabulary (${total})`
    : `已归档内容（${total}）`));
  details.append(textEl("p", "", "归档内容仍保留在本机，恢复后原案例标签会重新显示。"));
  const list = el("div", "archived-recovery-list");

  for (const facet of archivedFacets) {
    const restore = rawTextEl("button", "button-secondary", currentLocale() === "en"
      ? `Restore dimension: ${facet.name}`
      : `恢复维度：${facet.name}`);
    restore.addEventListener("click", () => perform(restore, {
      type: "RESTORE_ARCHIVED_FACETS", facetIds: [facet.id]
    }));
    list.append(restore);
  }
  for (const node of archivedNodes) {
    const restore = rawTextEl("button", "button-secondary", currentLocale() === "en"
      ? `Restore tag: ${node.name}`
      : `恢复标签：${node.name}`);
    restore.addEventListener("click", () => perform(restore, {
      type: "RESTORE_ARCHIVED_NODES", nodeIds: [node.id]
    }));
    list.append(restore);
  }
  details.append(list);
  return details;
}

function createVocabularyNode(node, facetNodesList, isGroup = false, pathLabels = new Map()) {
  const details = el("details", `vocabulary-node${isGroup ? " vocabulary-group-node" : ""}`);
  const relatedNodeIds = new Set([node.id]);
  if (isGroup) facetNodesList.filter((item) => item.parentId === node.id).forEach((item) => relatedNodeIds.add(item.id));
  const usageCount = entriesUsingNodes(relatedNodeIds);
  const summary = el("summary", "vocabulary-node-summary");
  summary.append(rawTextEl("span", "vocabulary-node-name", node.name));
  if (usageCount) summary.append(textEl("span", "vocabulary-node-count", String(usageCount)));
  details.append(summary);
  let actionsRendered = false;
  details.addEventListener("toggle", () => {
    if (!details.open || actionsRendered) return;
    details.append(createVocabularyNodeActions(node, facetNodesList, pathLabels));
    actionsRendered = true;
  });
  return details;
}

function createVocabularyNodeActions(node, facetNodesList, pathLabels) {
  const actions = el("div", "node-actions");
  const renameLabel = labeledInput(`重命名“${node.name}”`, node.name);
  const renameButton = textEl("button", "", "保存名称");
  renameButton.addEventListener("click", () => applyFacetChange(renameButton, { type: "rename", nodeId: node.id, name: renameLabel.input.value }));
  actions.append(renameLabel.label, renameButton);
  if (node.parentId) {
    const parentLabel = labeledSelect("移动到分组", facetNodesList.filter((item) => !item.parentId).map((item) => [item.id, item.name]), node.parentId);
    const move = textEl("button", "button-secondary", "移动");
    move.addEventListener("click", () => applyFacetChange(move, { type: "move", nodeId: node.id, parentId: parentLabel.select.value }));
    actions.append(parentLabel.label, move);
  }
  const mergeTargets = facetNodesList.filter((item) => item.id !== node.id && Boolean(item.parentId) === Boolean(node.parentId));
  if (mergeTargets.length) {
    const mergeWrap = el("div", "node-lazy-action");
    const revealMerge = textEl("button", "button-secondary", "合并标签…");
    revealMerge.addEventListener("click", () => {
      const mergeLabel = labeledSelect("合并到", mergeTargets.map((item) => [item.id, pathLabels.get(item.id) || item.name]));
      const merge = textEl("button", "button-secondary", "确认合并");
      merge.addEventListener("click", () => applyFacetChange(merge, { type: "merge", sourceNodeId: node.id, targetNodeId: mergeLabel.select.value }));
      mergeWrap.replaceChildren(mergeLabel.label, merge);
    }, { once: true });
    mergeWrap.append(revealMerge);
    actions.append(mergeWrap);
  }
  const aliases = labeledInput("别名（逗号分隔）", node.aliases.join("，"), "wide");
  const patterns = labeledInput("额外识别词（按原文精确匹配）", node.patterns.join("，"), "wide");
  const terms = textEl("button", "button-secondary", "保存识别词");
  terms.addEventListener("click", () => applyFacetChange(terms, {
    type: "terms", nodeId: node.id,
    aliases: splitInput(aliases.input.value), patterns: splitInput(patterns.input.value)
  }));
  const termFields = el("div", "node-term-fields");
  termFields.append(aliases.label, patterns.label);
  actions.append(termFields, terms);
  const archive = textEl("button", "button-secondary quiet-archive", "归档标签…");
  archive.addEventListener("click", () => applyFacetChange(archive, { type: "archive", nodeId: node.id }));
  actions.append(archive);
  return actions;
}

async function applyFacetChange(button, change) {
  button.disabled = true;
  try {
    const response = await chrome.runtime.sendMessage({ type: "PREVIEW_FACET_CHANGE", change });
    if (!response?.ok) throw new Error(response?.message || "无法保存修改");
    if (["archive_facet", "archive"].includes(response.preview?.change?.type) &&
      !await confirmArchiveChange(response.preview)) return;
    await perform(button, { type: "APPLY_FACET_CHANGE", preview: response.preview });
  } catch (error) {
    showFeedback(error.message, true);
  } finally {
    button.disabled = false;
  }
}

async function confirmArchiveChange(preview) {
  const tagCount = Number(preview.affectedNodeCount) || 0;
  const caseCount = Number(preview.affectedEntryCount) || 0;
  const summary = translateUiMessage(preview.summary);
  const message = currentLocale() === "en"
    ? `${summary}\n\nThis will hide ${tagCount} tags from filters and affect ${caseCount} cases. The tags attached to cases will not be deleted and can be restored from Archived vocabulary.\n\nContinue?`
    : `${summary}\n\n这会从筛选中隐藏 ${tagCount} 个标签，影响 ${caseCount} 个案例的可见标签。案例上的标签关系不会删除，可从“已归档内容”恢复。\n\n确认继续？`;
  return confirmAppAction({ title: t("归档这些标签？"), description: message, confirmLabel: t("确认归档") });
}

function renderBatchManager() {
  renderAnalysisBatch();
  const maintenanceActive = Boolean(maintenanceJob && ["running", "paused"].includes(maintenanceJob.status));
  const maintenanceMissing = Boolean(reanalysisPreview && (
    reanalysisPreview.confirmed || reanalysisPreview.suggested || reanalysisPreview.paletteCount
  ));
  elements.previewReanalyze.hidden = maintenanceActive;
  elements.previewReanalyze.textContent = t(reanalysisPreview || maintenanceJob ? "重新检查" : "检查缺失项");
  elements.previewReanalyze.classList.toggle("button-secondary", Boolean(reanalysisPreview || maintenanceJob));
  elements.applyReanalyze.hidden = maintenanceActive || !maintenanceMissing;
  elements.applyReanalyze.disabled = !maintenanceMissing;
  elements.pauseLibraryMaintenance.hidden = maintenanceJob?.status !== "running";
  elements.resumeLibraryMaintenance.hidden = maintenanceJob?.status !== "paused";
  elements.cancelLibraryMaintenance.hidden = !maintenanceActive;
  elements.retryLibraryMaintenance.hidden = !maintenanceJob?.failed || maintenanceActive;
  renderReanalysisPreview();
  const legacy = entries.filter((entry) => entry.legacyFacetCandidates?.length);
  elements.legacyCandidates.hidden = !legacy.length;
  if (!legacy.length) {
    elements.legacyCandidates.replaceChildren();
    return;
  }
  elements.legacyCandidates.replaceChildren(
    textEl("h3", "", "旧标签迁移候选"),
    textEl("p", "", legacy.length
      ? `${legacy.length} 条案例含旧标签候选。它们不会自动成为事实，请在案例详情中按正确维度重新选择。`
      : "没有等待处理的旧扁平标签。")
  );
}

function renderAnalysisSettings() {
  analysisKindTabs.forEach((button) => button.setAttribute("aria-selected", String(button.dataset.analysisKind === activeAnalysisKind)));
  analysisKindPanels.forEach((panel) => { panel.hidden = panel.dataset.analysisKindPanel !== activeAnalysisKind; });
  elements.showAnalysisDiagnostics.checked = uiPreferences.analysisDiagnostics;
  elements.analysisInstructionsZh.value = aiSettings.analysisInstructionsByLocale?.["zh-CN"] || DEFAULT_ANALYSIS_INSTRUCTIONS_BY_LOCALE["zh-CN"];
  elements.analysisInstructionsEn.value = aiSettings.analysisInstructionsByLocale?.en || DEFAULT_ANALYSIS_INSTRUCTIONS_BY_LOCALE.en;
  elements.aiSettingsStatus.textContent = t("规则保存在本机，只在对应任务运行时使用。");
  elements.visionInstructionsZh.value = visionSettings.instructionsByLocale?.["zh-CN"] || DEFAULT_VISION_INSTRUCTIONS_BY_LOCALE["zh-CN"];
  elements.visionInstructionsEn.value = visionSettings.instructionsByLocale?.en || DEFAULT_VISION_INSTRUCTIONS_BY_LOCALE.en;
  elements.visionSettingsStatus.textContent = t("规则保存在本机，只在对应任务运行时使用。");
  renderComposerMethodSettings();
  renderAnalysisLocale();
  renderAiRoutingSummary();
}

function renderAiRoutingSummary() {
  if (!elements.aiRoutingSummary) return;
  const profiles = Object.values(aiProviderRegistry.providers ?? {});
  const connected = profiles.filter(providerConnectionReady);
  elements.aiRoutingSummary.textContent = connected.length
    ? t("已连接 {count} 个服务；文字、图片、视频与生成任务各自明确分配，不会静默切换。", { count: connected.length })
    : t("尚未连接 AI 服务；本地资料整理仍可使用。");
  const categoryLabels = { official: "官方服务", aggregator: "聚合平台", custom: "自定义兼容服务" };
  const providerGroups = Object.entries(categoryLabels).flatMap(([category, label]) => {
    const members = profiles.filter((profile) => profile.category === category);
    if (!members.length) return [];
    const group = el("section", "ai-provider-group");
    group.dataset.providerCategory = category;
    group.append(rawTextEl("h5", "", t(label)), ...members.map((profile) => {
        const row = el("div", "ai-provider-row");
        row.dataset.providerId = profile.id;
        const status = `${providerConnectionLabel(profile)} · ${providerCatalogLabel(profile)}`;
        const configure = textEl("button", "button-secondary", profile.credentialConfigured ? "编辑配置" : "配置");
        configure.type = "button";
        configure.addEventListener("click", () => openAiProviderDialog(profile.id));
        const refresh = textEl("button", "button-secondary", "刷新模型");
        refresh.type = "button";
        refresh.disabled = !profile.credentialConfigured;
        refresh.addEventListener("click", () => refreshAiProviderModels(profile.id, refresh));
        row.append(rawTextEl("strong", "", providerDisplayLabel(profile)), textEl("span", "", status), configure, refresh);
        return row;
      }));
    return [group];
  });
  elements.aiProviderList?.replaceChildren(...providerGroups);
  elements.aiAssignmentList?.replaceChildren(...AI_ASSIGNMENT_TASKS.map((task) => {
    const assignment = aiTaskAssignments[task.id] ?? {};
    const profile = aiProviderRegistry.providers?.[assignment.providerId];
    const row = el("div", "ai-assignment-row");
    const modelState = assignedModelState(profile, assignment.model);
    const change = textEl("button", "button-secondary", assignment.providerId ? "更换" : "配置");
    change.type = "button";
    change.addEventListener("click", () => openAiTaskAssignmentDialog(task.id));
    row.append(
      rawTextEl("strong", "", t(task.label)),
      rawTextEl("span", "", !assignment.providerId
        ? t("尚未分配")
        : profile ? `${providerDisplayLabel(profile)} · ${assignment.model || t("模型未填写")}${modelState}` : t("已分配服务不存在")),
      change
    );
    return row;
  }));
  renderAiRoutingView();
}

function renderAiRoutingView() {
  aiRoutingTabs.forEach((button) => button.setAttribute("aria-selected", String(button.dataset.aiRoutingTab === activeAiRoutingTab)));
  aiRoutingPanels.forEach((panel) => { panel.hidden = panel.dataset.aiRoutingPanel !== activeAiRoutingTab; });
}

function providerConnectionReady(profile = {}) {
  return profile.credentialConfigured === true && profile.consent === true;
}

function providerConnectionLabel(profile = {}) {
  if (!profile.credentialConfigured) return t("尚未连接");
  if (!profile.consent) return t("API Key 已保存，尚未确认发送授权");
  return t("已连接");
}

function providerCatalogLabel(profile = {}) {
  const models = profile.discoveredModels ?? [];
  const unavailable = models.filter((model) => model.status === "unavailable").length;
  if (profile.discovery?.error) {
    return t("模型目录读取失败：{error}；保留 {count} 个模型{unavailable}", {
      error: translateUiMessage(profile.discovery.error),
      count: models.length,
      unavailable: unavailable ? t("，其中 {count} 个下架或当前不可用", { count: unavailable }) : ""
    });
  }
  if (!profile.discovery?.discoveredAt) return t("模型目录未读取");
  return t("模型目录已读取 · {count} 个模型 · 尚未执行模型调用验证{unavailable}", {
    count: models.length,
    unavailable: unavailable ? t(" · {count} 个下架或当前不可用", { count: unavailable }) : ""
  });
}

function assignedModelState(profile, modelValue) {
  const model = String(modelValue ?? "").trim();
  if (!profile || !model) return "";
  const discovered = (profile.discoveredModels ?? []).find((item) => item.id === model);
  if (discovered?.status === "unavailable") return t("（已下架或当前不可用）");
  if (profile.discovery?.discoveredAt && !discovered) return t("（当前目录不可用）");
  return "";
}

async function openAiTaskAssignmentDialog(taskId) {
  const task = AI_ASSIGNMENT_TASKS.find((item) => item.id === taskId);
  if (!task) return;
  const current = aiTaskAssignments[taskId] ?? {};
  const capable = Object.values(aiProviderRegistry.providers ?? {}).filter((profile) =>
    providerConnectionReady(profile) && taskModelOptions(profile, taskId).length
  );
  if (!capable.length) {
    showFeedback(t("尚无已连接且可用于“{task}”的模型，请先连接服务并刷新模型目录", { task: t(task.label) }), true);
    return openAiProviderDialog();
  }
  const selectedProviderId = capable.some((profile) => profile.id === current.providerId)
    ? current.providerId : capable[0].id;
  const modelOptions = (providerId) => taskModelOptions(aiProviderRegistry.providers?.[providerId], taskId);
  const initialModels = modelOptions(selectedProviderId);
  const supportsBatchConcurrency = ["textTags", "imageAnalysis"].includes(taskId);
  const defaultConcurrency = ["textTags", "skillExtraction", "creativePlanning"].includes(taskId) ? 20 : 10;
  const initialConcurrency = Number.isInteger(Number(current.concurrency)) ? Number(current.concurrency) : defaultConcurrency;
  const result = await showAppDialog({
    title: t(task.label),
    description: t("这里设置全局默认；创作台中的本轮切换不会改动此处。"),
    fields: [
      { id: "providerId", label: t("AI 服务"), type: "select", value: selectedProviderId, options: capable.map((profile) => ({ value: profile.id, label: providerDisplayLabel(profile) })) },
      { id: "model", label: t("模型"), type: "select", value: initialModels.some((item) => item.value === current.model) ? current.model : initialModels[0]?.value || "", options: initialModels },
      ...(supportsBatchConcurrency ? [
        { id: "concurrency", label: t("批量分析并发数"), type: "number", min: 2, step: 1, value: initialConcurrency, help: t("文字任务默认 20，图片和视频任务默认 10；调整只对新任务生效。") },
        { id: "highConcurrencyConfirmed", label: t("我确认高于 20 的并发可能明显增加瞬时费用、内存占用和错误数量"), type: "checkbox", value: false }
      ] : [])
    ],
    confirmLabel: t("保存任务默认"),
    cancelLabel: t("取消"),
    dismissOnBackdrop: false,
    confirmDismissWhenDirty: true,
    dirtyDismissMessage: t("有未保存的更改，再次关闭或取消将放弃这些更改"),
    discardLabel: t("确认放弃"),
    onReady: ({ dialog, controls }) => {
      localizeAiDialogClose(dialog);
      const provider = controls.get("providerId");
      const model = controls.get("model");
      const concurrency = controls.get("concurrency");
      const highConcurrencyConfirmed = controls.get("highConcurrencyConfirmed");
      const modelField = model?.closest(".app-dialog-field");
      const capabilityHelp = document.createElement("small");
      capabilityHelp.className = "model-capability-help";
      modelField?.append(capabilityHelp);
      const syncCapabilityHelp = () => {
        const profile = aiProviderRegistry.providers?.[provider.value];
        const descriptor = profile?.discoveredModels?.find((item) => item.id === model.value);
        const officialLimit = Number(descriptor?.concurrencyLimit?.value);
        const limitText = Number.isInteger(officialLimit)
          ? t("官方并发上限：{count}", { count: officialLimit })
          : t("服务商未提供固定并发上限");
        capabilityHelp.textContent = [modelAssignmentHelp(profile, taskId, model.value), limitText].filter(Boolean).join(" · ");
        capabilityHelp.hidden = !capabilityHelp.textContent;
        if (concurrency) concurrency.max = Number.isInteger(officialLimit) ? String(officialLimit) : "";
        if (highConcurrencyConfirmed) {
          const wrapper = highConcurrencyConfirmed.closest(".app-dialog-field");
          if (wrapper) wrapper.hidden = Number(concurrency?.value) <= 20;
        }
      };
      provider?.addEventListener("change", () => {
        const options = modelOptions(provider.value);
        if (model instanceof HTMLSelectElement) {
          model.replaceChildren(...options.map((item) => {
            const option = document.createElement("option");
            option.value = item.value;
            option.textContent = item.label;
            return option;
          }));
        }
        model.value = options[0]?.value || "";
        syncCapabilityHelp();
      });
      model?.addEventListener("change", syncCapabilityHelp);
      concurrency?.addEventListener("input", syncCapabilityHelp);
      syncCapabilityHelp();
    },
    onSubmit: async (values) => {
      if (!String(values.model ?? "").trim()) throw new Error(t("请选择或填写模型"));
      const concurrency = supportsBatchConcurrency ? Number(values.concurrency) : initialConcurrency;
      if (supportsBatchConcurrency && (!Number.isInteger(concurrency) || concurrency < 2)) throw new Error(t("批量分析并发数必须是大于或等于 2 的整数"));
      if (supportsBatchConcurrency && concurrency > 20 && values.highConcurrencyConfirmed !== true) throw new Error(t("并发高于 20，请先确认费用和稳定性风险"));
      const officialLimit = modelConcurrencyLimit(values.providerId, values.model, aiProviderRegistry);
      if (supportsBatchConcurrency && Number.isInteger(officialLimit) && concurrency > officialLimit) {
        throw new Error(t("批量分析并发数不能超过所选模型的官方上限 {count}", { count: officialLimit }));
      }
      const response = await chrome.runtime.sendMessage({
        type: "UPDATE_AI_PROVIDER_CONFIGURATION",
        assignments: { ...aiTaskAssignments, [taskId]: { providerId: values.providerId, model: values.model, concurrency } }
      });
      if (!response?.ok) throw new Error(translateUiMessage(response?.message) || t("任务默认保存失败"));
      applyAiConfigurationResponse(response);
      return response;
    }
  });
  if (result) showFeedback(t("{task}默认模型已保存", { task: t(task.label) }));
}

async function openAiProviderDialog(initialProviderId = "") {
  const profiles = Object.values(aiProviderRegistry.providers ?? {});
  const firstProviderId = profiles.some((profile) => profile.id === initialProviderId)
    ? initialProviderId
    : profiles[0]?.id || "deepseek";
  const keyFor = (providerId) => providerId.replaceAll("-", "_");
  const fields = [{
    id: "providerEditor",
    label: t("编辑服务"),
    type: "select",
    value: firstProviderId,
    options: profiles.map((profile) => ({
      value: profile.id,
      label: `${providerCategoryLabel(profile.category)} · ${providerDisplayLabel(profile)}`
    }))
  }];
  for (const profile of profiles) {
    const key = keyFor(profile.id);
    const custom = profile.id.startsWith("custom");
    const micuImageService = providerUsesMicuImageGroup(profile);
    fields.push({
      id: `provider_${key}_apiKey`,
      label: micuImageService
        ? t("图片分析 API Key（米醋 vip_2，只用于看图）")
        : profile.id === "custom-media" ? t("图片分析 API Key") : "API Key",
      type: "secret",
      autocomplete: "off",
      placeholder: profile.credentialConfigured ? t("已保存；留空保持不变") : t("粘贴服务商提供的 API Key"),
      help: micuImageService ? t("这把 Key 只用于图片分析，不会发送给最终生图接口。") : ""
    });
    if (profile.id === "custom-media") fields.push({
      id: `provider_${key}_imageApiKey`,
      label: micuImageService
        ? t("图片生成 API Key（米醋 vip_2_image，需单独创建）")
        : t("图片生成 API Key（可与分析 Key 不同）"),
      type: "secret",
      autocomplete: "off",
      placeholder: profile.imageGeneration?.credentialConfigured
        ? t("已保存{hint}；留空保持不变", { hint: profile.imageGeneration.credentialHint ? t("（尾号 {hint}）", { hint: profile.imageGeneration.credentialHint }) : "" })
        : micuImageService ? t("粘贴米醋 vip_2_image 分组 Key") : t("留空则复用上方 API Key"),
      help: micuImageService ? t("留空会保留已保存的生图 Key。模型目录可见不等于已获得 Image2 生图分组授权，最终以米醋生成接口返回为准。") : ""
    });
    if (custom) fields.push(
      { id: `provider_${key}_endpoint`, label: t(profile.id === "custom-media" ? "图片分析接口（高级）" : "接口地址（高级）"), type: "url", value: profile.endpoint, advanced: true },
      { id: `provider_${key}_protocol`, label: t("兼容协议（高级）"), type: "select", value: profile.protocol, advanced: true, options: [
        { value: "native", label: t("服务原生协议") },
        { value: "responses", label: "OpenAI Responses" },
        { value: "chat_completions", label: "OpenAI Chat Completions" }
      ] }
    );
    fields.push(...profile.capabilities.map((taskId) => {
      const catalogRequired = profile.catalogRequiredTasks?.includes(taskId) === true;
      const assignedModel = aiTaskAssignments?.[taskId]?.providerId === profile.id
        ? aiTaskAssignments[taskId].model
        : "";
      const configuredModel = profile.models?.[taskId]
        || (profile.id === "custom-media" && taskId === "imageGeneration" ? profile.imageGeneration?.model : "")
        || assignedModel;
      const options = discoveredModelOptions(profile, taskId, catalogRequired ? "" : configuredModel);
      return {
        id: `provider_${key}_model_${taskId}`,
        label: t("{task}模型（高级）", { task: taskDisplayLabel(taskId) }),
        type: catalogRequired || options.length ? "select" : "text",
        value: options.some((option) => option.value === configuredModel) ? configuredModel : "",
        options,
        advanced: true
      };
    }));
    if (profile.id === "custom-media") fields.push(
      { id: `provider_${key}_imageProtocol`, label: t("图片生成协议（高级）"), type: "select", value: profile.imageGeneration?.protocol || "none", advanced: true, options: [
        { value: "none", label: t("不启用图片生成") },
        { value: "responses_tool", label: t("OpenAI Responses 生图工具") },
        { value: "images_generations", label: "Images Generations / Edits" }
      ] },
      { id: `provider_${key}_imageEndpoint`, label: t("图片生成接口（高级）"), type: "url", value: profile.imageGeneration?.endpoint || "", advanced: true },
      { id: `provider_${key}_imageEditsEndpoint`, label: t("多图参考 / 编辑接口（高级）"), type: "url", value: profile.imageGeneration?.editsEndpoint || "", advanced: true },
      { id: `provider_${key}_imageSizes`, label: t("此服务支持的图片尺寸（能力声明，不是本轮输出值）"), type: "text", value: (profile.imageGeneration?.sizes ?? []).join(", "), advanced: true },
      { id: `provider_${key}_imageQualities`, label: t("此服务支持的质量选项（能力声明，不是本轮输出值）"), type: "text", value: (profile.imageGeneration?.qualities ?? []).join(", "), advanced: true }
    );
    fields.push({ id: `provider_${key}_consent`, label: t("我确认：主动使用 {provider} 时发送本次任务所需内容", { provider: providerDisplayLabel(profile) }), type: "checkbox", value: profile.consent === true });
  }
  const advancedFieldIds = new Set(fields.flatMap((field) => field.advanced === true ? [field.id] : []));
  const result = await showAppDialog({
    title: t("连接 AI 服务"),
    description: t("官方服务通常只需填写 API Key。账号专属模型与兼容服务连接参数位于高级连接。"),
    fields,
    confirmLabel: t("保存配置"),
    cancelLabel: t("取消"),
    pendingLabel: t("正在保存…"),
    dialogClass: "ai-provider-dialog",
    dismissOnBackdrop: false,
    confirmDismissWhenDirty: true,
    dirtyDismissMessage: t("有未保存的更改，再次关闭或取消将放弃这些更改"),
    discardLabel: t("确认放弃"),
    renderBody: ({ body }) => {
      const details = document.createElement("details");
      details.className = "ai-advanced-settings app-dialog-advanced-settings";
      const summary = document.createElement("summary");
      const title = document.createElement("strong");
      title.textContent = t("高级连接");
      const description = document.createElement("span");
      description.textContent = t("仅在接口地址、协议或模型发生变化时修改");
      summary.append(title, description);
      const advancedBody = document.createElement("div");
      advancedBody.className = "ai-advanced-settings-body";
      const micuPreset = textEl("button", "button-secondary", "填入米醋个人中转预设");
      micuPreset.type = "button";
      micuPreset.dataset.providerPreset = "micu-personal";
      micuPreset.hidden = true;
      advancedBody.append(micuPreset);
      for (const fieldId of advancedFieldIds) {
        const wrapper = body.querySelector(`[data-field-id="${fieldId}"]`);
        if (wrapper) advancedBody.append(wrapper);
      }
      details.append(summary, advancedBody);
      body.append(details);
    },
    onReady: ({ dialog, controls }) => {
      localizeAiDialogClose(dialog);
      const editor = controls.get("providerEditor");
      const advanced = dialog.querySelector(".app-dialog-advanced-settings");
      const micuPreset = dialog.querySelector('[data-provider-preset="micu-personal"]');
      micuPreset?.addEventListener("click", () => {
        const prefix = "provider_custom_media_";
        const preset = MICU_COMPATIBLE_PROVIDER_PRESET;
        const imagePreset = preset.imageGeneration;
        controls.get(`${prefix}endpoint`).value = preset.endpoint;
        controls.get(`${prefix}protocol`).value = preset.protocol;
        controls.get(`${prefix}imageProtocol`).value = imagePreset.protocol;
        controls.get(`${prefix}imageEndpoint`).value = imagePreset.endpoint;
        controls.get(`${prefix}imageEditsEndpoint`).value = imagePreset.editsEndpoint;
        const model = controls.get(`${prefix}model_imageGeneration`);
        if (model instanceof HTMLSelectElement && ![...model.options].some((option) => option.value === imagePreset.defaultModel)) {
          model.append(option(imagePreset.defaultModel, imagePreset.defaultModel));
        }
        if (model) model.value = imagePreset.defaultModel;
        controls.get(`${prefix}imageSizes`).value = imagePreset.models[imagePreset.defaultModel].sizes.join(", ");
        controls.get(`${prefix}apiKey`).focus();
      });
      const syncProviderFields = () => {
        for (const profile of profiles) {
          const prefix = `provider_${keyFor(profile.id)}_`;
          for (const [id, input] of controls) {
            if (id.startsWith(prefix)) input.parentElement.hidden = profile.id !== editor.value;
          }
        }
        if (micuPreset) micuPreset.hidden = editor.value !== "custom-media";
        advanced.hidden = ![...advanced.querySelectorAll("[data-field-id]")].some((wrapper) => !wrapper.hidden);
      };
      const syncModelCapabilityHelp = () => {
        for (const profile of profiles) {
          const key = keyFor(profile.id);
          for (const taskId of profile.capabilities) {
            const input = controls.get(`provider_${key}_model_${taskId}`);
            if (!input) continue;
            const wrapper = input.closest(".app-dialog-field");
            let help = wrapper.querySelector(":scope > .model-capability-help");
            if (!help) {
              help = document.createElement("small");
              help.className = "model-capability-help";
              wrapper.append(help);
              input.addEventListener("change", syncModelCapabilityHelp);
            }
            help.textContent = modelAssignmentHelp(profile, taskId, input.value);
            help.hidden = !help.textContent;
          }
        }
      };
      editor.addEventListener("change", syncProviderFields);
      syncProviderFields();
      syncModelCapabilityHelp();
    },
    onSubmit: async (values) => {
      const registryUpdate = { providers: {} };
      const origins = new Set();
      const profile = aiProviderRegistry.providers?.[values.providerEditor];
      const key = keyFor(profile.id);
      const apiKey = values[`provider_${key}_apiKey`];
      const endpoint = profile.id.startsWith("custom") ? values[`provider_${key}_endpoint`] : profile.endpoint;
      const models = Object.fromEntries(profile.capabilities.flatMap((taskId) => {
        const model = String(values[`provider_${key}_model_${taskId}`] ?? "").trim();
        return model ? [[taskId, model]] : [];
      }));
      const imageGeneration = profile.id === "custom-media" ? {
        protocol: values[`provider_${key}_imageProtocol`],
        endpoint: values[`provider_${key}_imageEndpoint`],
        editsEndpoint: values[`provider_${key}_imageEditsEndpoint`],
        apiKey: values[`provider_${key}_imageApiKey`],
        model: values[`provider_${key}_model_imageGeneration`],
        sizes: commaSeparatedValues(values[`provider_${key}_imageSizes`]),
        qualities: commaSeparatedValues(values[`provider_${key}_imageQualities`])
      } : null;
      let imageCredentialVerification = null;
      if (imageGeneration && providerUsesMicuImageGroup({ ...profile, imageGeneration })
        && !imageGeneration.apiKey && !profile.imageGeneration?.credentialConfigured) {
        throw new Error(t("米醋 gpt-image-2 需要单独的 vip_2_image 分组 Key，不能复用上方文字 / 分析 Key"));
      }
      registryUpdate.providers[profile.id] = {
        endpoint,
        protocol: profile.id.startsWith("custom") ? values[`provider_${key}_protocol`] : profile.protocol,
        apiKey,
        models,
        consent: values[`provider_${key}_consent`],
        ...(imageGeneration ? { imageGeneration } : {})
      };
      if ((apiKey || profile.credentialConfigured) && endpoint) origins.add(permissionPatternForProvider(endpoint));
      if (imageGeneration?.endpoint && (imageGeneration.apiKey || profile.imageGeneration?.credentialConfigured || apiKey || profile.credentialConfigured)) {
        origins.add(permissionPatternForProvider(imageGeneration.endpoint));
      }
      if (imageGeneration?.editsEndpoint && (imageGeneration.apiKey || profile.imageGeneration?.credentialConfigured || apiKey || profile.credentialConfigured)) {
        origins.add(permissionPatternForProvider(imageGeneration.editsEndpoint));
      }
      if (origins.size && !await chrome.permissions.request({ origins: [...origins] })) throw new Error(t("没有获得新增 AI 服务的访问权限，设置未保存"));
      if (imageGeneration && providerUsesMicuImageGroup({ ...profile, imageGeneration })
        && (imageGeneration.apiKey || profile.imageGeneration?.credentialConfigured)) {
        imageCredentialVerification = await chrome.runtime.sendMessage({
          type: "VERIFY_AI_IMAGE_GENERATION_CREDENTIAL",
          providerId: profile.id,
          endpoint: imageGeneration.endpoint,
          apiKey: imageGeneration.apiKey,
          model: imageGeneration.model
        });
        if (!imageCredentialVerification?.ok) throw new Error(translateUiMessage(imageCredentialVerification?.message) || t("米醋图片生成 Key 的模型目录检查失败"));
      }
      const response = await chrome.runtime.sendMessage({
        type: "UPDATE_AI_PROVIDER_CONFIGURATION",
        registry: registryUpdate,
        assignments: aiTaskAssignments
      });
      if (!response?.ok) throw new Error(translateUiMessage(response?.message) || t("AI 服务配置保存失败"));
      applyAiConfigurationResponse(response);
      const savedMessage = imageCredentialVerification?.message
        ? `${t("配置已保存")}；${t("模型目录中可见 {model}；这只证明目录可见，不代表米醋已授权该 Key 进入生图分组", { model: imageGeneration.model })}`
        : t("配置已保存");
      if (!(apiKey || profile.credentialConfigured)) return { ...response, message: savedMessage };
      try {
        const discovery = await chrome.runtime.sendMessage({
          type: "DISCOVER_AI_PROVIDER_MODELS",
          providerId: profile.id,
          force: true
        });
        if (!discovery?.ok) throw new Error(translateUiMessage(discovery?.message) || t("模型目录读取失败"));
        applyAiConfigurationResponse(discovery);
        return { ...discovery, message: `${savedMessage}；${t("{provider} 已发现 {count} 个模型", { provider: providerDisplayLabel(profile), count: discovery.aiProviderRegistry?.providers?.[profile.id]?.discoveredModels?.length || 0 })}` };
      } catch (error) {
        return {
          ...response,
          message: `${savedMessage}；${t("模型目录暂时读取失败，可稍后手动刷新")}`,
          discoveryWarning: translateUiMessage(error.message) || t("模型目录读取失败")
        };
      }
    }
  });
  if (result) {
    showFeedback(result.message);
    elements.openAiRouting.focus();
  }
}

function providerCategoryLabel(category) {
  return t({ official: "官方服务", aggregator: "聚合平台", custom: "自定义兼容服务" }[category] || "自定义兼容服务");
}

function localizeAiDialogClose(dialog) {
  const close = dialog.querySelector(".app-dialog-close");
  close?.setAttribute("aria-label", t("关闭"));
  if (close) close.title = t("关闭");
}

function providerDisplayLabel(profile = {}) {
  return t(profile.label || "自定义兼容服务");
}

function taskDisplayLabel(taskId) {
  return t(AI_ASSIGNMENT_TASKS.find((task) => task.id === taskId)?.label || taskId);
}

function providerUsesMicuImageGroup(profile = {}) {
  if (profile.imageGeneration?.protocol !== "images_generations") return false;
  try {
    const endpoint = profile.imageGeneration?.endpoint || profile.endpoint;
    return new URL(endpoint).hostname.toLocaleLowerCase("en-US").endsWith("micuapi.ai");
  } catch {
    return false;
  }
}

function commaSeparatedValues(value) {
  return [...new Set(String(value ?? "").split(",").map((item) => item.trim()).filter(Boolean))];
}

function applyAiConfigurationResponse(response) {
  aiProviderRegistry = response.aiProviderRegistry ?? aiProviderRegistry;
  aiTaskAssignments = response.aiTaskAssignments ?? aiTaskAssignments;
  aiSettings = response.aiSettings ?? aiSettings;
  visionSettings = response.visionSettings ?? visionSettings;
  aiServiceProfiles = response.aiServiceProfiles ?? aiServiceProfiles;
  renderAnalysisSettings();
}

function discoveredModelOptions(profile, taskId, selectedValue = "") {
  const options = availableAiModelsForTask(taskId, profile)
    .map((model) => ({
      value: model.id,
      label: `${model.name || model.id}${modelPriceLabel(model.pricing)}`
    }));
  const selected = String(selectedValue ?? "").trim();
  if (selected && !options.some((option) => option.value === selected)
    && (!profile?.discovery?.discoveredAt || profile?.category === "custom")) {
    options.unshift({ value: selected, label: t("{model}（模型目录尚未读取）", { model: selected }) });
  }
  return options;
}

function modelAssignmentHelp(profile, taskId, selectedValue) {
  const selected = String(selectedValue ?? "").trim();
  if (!selected) return "";
  const model = availableAiModelsForTask(taskId, profile).find((item) => item.id === selected);
  if (!model || ["declared", "protocol_inferred"].includes(model.assignmentEvidence)) return "";
  return t("当前模型未声明这项能力；是否可用以真实执行结果为准");
}

function taskModelOptions(profile, taskId) {
  if (!profile?.capabilities?.includes(taskId)) return [];
  const manualModel = profile.catalogRequiredTasks?.includes(taskId) ? "" : profile.models?.[taskId] || "";
  return discoveredModelOptions(profile, taskId, manualModel);
}

function modelPriceLabel(pricing) {
  if (!pricing || typeof pricing !== "object") return "";
  const first = Object.entries(pricing).find(([, value]) => typeof value === "string" || typeof value === "number");
  return first ? ` · ${first[0]} ${first[1]}` : "";
}

async function refreshAiProviderModels(providerId, button) {
  const profile = aiProviderRegistry.providers?.[providerId];
  if (!profile?.credentialConfigured) return showFeedback(t("请先保存该厂商的 API Key"));
  button.disabled = true;
  const oldText = button.textContent;
  button.textContent = t("正在读取…");
  try {
    const response = await chrome.runtime.sendMessage({ type: "DISCOVER_AI_PROVIDER_MODELS", providerId, force: true });
    if (!response?.ok) throw new Error(translateUiMessage(response?.message) || t("模型目录读取失败"));
    applyAiConfigurationResponse(response);
    showFeedback(t("{provider} 已发现 {count} 个模型", {
      provider: providerDisplayLabel(profile),
      count: response.aiProviderRegistry?.providers?.[providerId]?.discoveredModels?.length || 0
    }));
  } catch (error) {
    showFeedback(translateUiMessage(error.message) || t("模型目录读取失败"));
  } finally {
    if (button.isConnected) {
      button.disabled = false;
      button.textContent = oldText;
    }
  }
}

async function refreshAiModelCatalogsForSession() {
  const profiles = Object.values(aiProviderRegistry.providers ?? {}).filter((profile) => profile.credentialConfigured);
  for (const profile of profiles) {
    try {
      const response = await chrome.runtime.sendMessage({ type: "DISCOVER_AI_PROVIDER_MODELS", providerId: profile.id, force: false });
      if (!response?.ok) continue;
      applyAiConfigurationResponse(response);
    } catch {}
  }
}

function permissionPatternForProvider(value) {
  const url = new URL(value);
  if (!["http:", "https:"].includes(url.protocol)) throw new Error("AI 接口必须使用 HTTP 或 HTTPS 地址");
  return `${url.origin}/*`;
}

function renderAnalysisLocale() {
  analysisLocalePanels.forEach((panel) => { panel.hidden = panel.dataset.analysisLocalePanel !== activeAnalysisLocale; });
  elements.analysisProtocol.textContent = analysisProtocolDescription(activeAnalysisLocale);
  elements.visionProtocol.textContent = visionProtocolDescription(activeAnalysisLocale);
  renderComposerMethodStatus();
}

function renderComposerMethodSettings() {
  if (!elements.composerTaskKey) return;
  const taskKey = elements.composerTaskKey.value;
  const normalized = normalizeComposerSettings(composerSettings);
  elements.composerMethodVersion.textContent = `v${normalized.methodVersion}`;
  elements.composerAgentInstruction.value = normalized.agentInstruction.text;
  elements.composerTaskMethod.value = normalized.taskMethods[taskKey].text;
  elements.creativeExperimentEnabled.checked = Boolean(creativeExperimentSettings.enabled);
  elements.creativeExperimentAutoAnalyze.checked = Boolean(creativeExperimentSettings.autoAnalyze);
  elements.creativeExperimentAutoAnalyze.disabled = !creativeExperimentSettings.enabled;
  elements.creativeExperimentStatus.textContent = creativeExperimentSettings.enabled
    ? creativeExperimentSettings.autoAnalyze
      ? t("已开启；每次保存生成结果后会调用当前视觉服务。")
      : t("已开启；可在结果卡手动发起视觉对照。")
    : t("默认关闭。普通结果关联不会调用任何模型。");
  renderComposerMethodStatus();
}

function renderComposerMethodStatus() {
  if (!elements.composerTaskKey) return;
  const taskKey = elements.composerTaskKey.value;
  const normalized = normalizeComposerSettings(composerSettings);
  elements.composerMethodDefaultText.textContent = DEFAULT_TASK_METHODS[taskKey];
  const selected = normalized.taskMethods[taskKey];
  elements.composerMethodMigration.textContent = normalized.migrationCandidates[taskKey]?.length > 1
    ? t("这个任务仍有两个历史语言版本；当前会按输出语言继续使用，保存上方单一方法后完成合并。")
    : "";
  elements.composerSettingsStatus.textContent = [
    normalized.agentInstruction.customized ? t("系统指令已自定义") : t("系统指令使用当前默认版本"),
    selected.customized ? t("当前任务方法已自定义") : t("当前任务方法使用当前默认版本")
  ].join(" · ");
}

async function saveComposerMethodSettings(event) {
  event.preventDefault();
  const button = event.submitter ?? elements.composerSettingsForm.querySelector('button[type="submit"]');
  button.disabled = true;
  try {
    const taskKey = elements.composerTaskKey.value;
    const response = await chrome.runtime.sendMessage({ type: "UPDATE_COMPOSER_SETTINGS", action: "save_task", taskKey, text: elements.composerTaskMethod.value });
    if (!response?.ok) throw new Error(response?.message || "无法保存创作方法");
    composerSettings = normalizeComposerSettings(response.composerSettings);
    renderComposerMethodSettings();
    showFeedback(response.message);
  } catch (error) {
    elements.composerSettingsStatus.textContent = error.message;
  } finally {
    button.disabled = false;
  }
}

async function saveComposerAgentInstruction() {
  const response = await chrome.runtime.sendMessage({ type: "UPDATE_COMPOSER_SETTINGS", action: "save_agent", text: elements.composerAgentInstruction.value });
  if (!response?.ok) return showFeedback(response?.message || "无法保存 Agent 系统指令", true);
  composerSettings = normalizeComposerSettings(response.composerSettings);
  renderComposerMethodSettings();
  showFeedback(response.message);
}

async function restoreComposerAgentInstruction() {
  if (composerSettings.agentInstruction.customized && !await confirmAppAction({ title: "恢复默认系统指令？", description: "当前自定义内容会被替换。", confirmLabel: "恢复默认" })) return;
  const response = await chrome.runtime.sendMessage({ type: "UPDATE_COMPOSER_SETTINGS", action: "reset_agent" });
  if (!response?.ok) return showFeedback(response?.message || "无法恢复默认系统指令", true);
  composerSettings = normalizeComposerSettings(response.composerSettings);
  renderComposerMethodSettings();
  showFeedback(response.message);
}

async function restoreComposerTaskDefault() {
  const taskKey = elements.composerTaskKey.value;
  if (composerSettings.taskMethods[taskKey].customized && !await confirmAppAction({ title: "恢复默认任务方法？", description: "当前自定义内容会被替换。", confirmLabel: "恢复默认" })) return;
  const response = await chrome.runtime.sendMessage({ type: "UPDATE_COMPOSER_SETTINGS", action: "reset_task", taskKey });
  if (!response?.ok) return showFeedback(response?.message || "无法恢复默认方法", true);
  composerSettings = normalizeComposerSettings(response.composerSettings);
  renderComposerMethodSettings();
  showFeedback(response.message);
}

async function saveCreativeExperimentSettings() {
  const button = elements.saveCreativeExperiment;
  button.disabled = true;
  try {
    const response = await chrome.runtime.sendMessage({
      type: "UPDATE_CREATIVE_EXPERIMENT_SETTINGS",
      settings: {
        enabled: elements.creativeExperimentEnabled.checked,
        autoAnalyze: elements.creativeExperimentAutoAnalyze.checked
      }
    });
    if (!response?.ok) throw new Error(response?.message || "无法保存创作实验设置");
    creativeExperimentSettings = response.creativeExperimentSettings;
    renderComposerMethodSettings();
    showFeedback(response.message);
  } catch (error) {
    elements.creativeExperimentStatus.textContent = error.message;
  } finally {
    button.disabled = false;
  }
}

async function saveAiRulePreferences(event) {
  event.preventDefault();
  const button = event.submitter ?? event.currentTarget.querySelector("button[type='submit']");
  button.disabled = true;
  try {
    const response = await chrome.runtime.sendMessage({
      type: "UPDATE_AI_PROVIDER_CONFIGURATION",
      preferences: {
        textInstructionsByLocale: {
          "zh-CN": elements.analysisInstructionsZh.value,
          en: elements.analysisInstructionsEn.value
        },
        visionInstructionsByLocale: {
          "zh-CN": elements.visionInstructionsZh.value,
          en: elements.visionInstructionsEn.value
        },
        autoAnalyzeImports: visionSettings.autoAnalyzeImports === true
      }
    });
    if (!response?.ok) throw new Error(response?.message || t("分析规则保存失败"));
    applyAiConfigurationResponse(response);
    const message = t("分析规则已保存");
    elements.aiSettingsStatus.textContent = message;
    elements.visionSettingsStatus.textContent = message;
    showFeedback(message);
  } catch (error) {
    showFeedback(translateUiMessage(error.message), true);
  } finally {
    button.disabled = false;
  }
}

async function startDeepSeekAnalysisBatch() {
  const mode = analysisBatchPreview?.mode === "rebuild" ? "rebuild" : "incremental";
  const button = mode === "rebuild" ? elements.startAnalysisReanalyze : elements.startAnalysisBatch;
  const warning = currentLocale() === "en"
    ? `Rebuild tags for ${analysisBatchPreview?.caseCount || 0} text cases (${(analysisBatchPreview?.totalCharacters || 0).toLocaleString("en")} characters) and incur new API charges? The active library changes only after all cases succeed.`
    : `将为 ${analysisBatchPreview?.caseCount || 0} 条文字案例重建标签，共 ${(analysisBatchPreview?.totalCharacters || 0).toLocaleString("zh-CN")} 字符，并产生新的 API 费用。全部成功前正式标签库不会改变。确认继续吗？`;
  if (mode === "rebuild" && !await confirmAppAction({ title: "重建文字标签？", description: warning, confirmLabel: "确认并开始" })) return;
  button.disabled = true;
  try {
    const response = await chrome.runtime.sendMessage({ type: "CREATE_ANALYSIS_BATCH", outputLocale: currentLocale(), mode });
    if (!response?.ok) throw new Error(response?.message || "无法创建批量任务");
    analysisBatchJob = response.analysisBatchJob;
    canUndoAnalysisBatch = mode !== "rebuild";
    analysisBatchPreview = null;
    beginAnalysisDiagnostics();
    renderAnalysisBatch();
    showFeedback(response.message);
  } catch (error) {
    showFeedback(error.message, true);
  } finally {
    button.disabled = false;
  }
}

async function organizeDetailTags() {
  const chunks = createDetailOrganizationChunks(facetCatalog, entries);
  if (!chunks.length) {
    elements.organizeDetailStatus.textContent = t("当前没有需要整理的三级标签组。");
    return;
  }
  const tagCount = chunks.reduce((sum, chunk) => sum + chunk.d.length, 0);
  const inputBytes = chunks.reduce((sum, chunk) => sum + new TextEncoder().encode(JSON.stringify(chunk)).length, 0);
  const warning = currentLocale() === "en"
    ? `Organize ${tagCount} detail tags in ${chunks.length} paid requests (${inputBytes.toLocaleString("en")} serialized input bytes)? Cases and prompts are not sent.`
    : `将用 ${chunks.length} 次付费请求整理 ${tagCount} 个三级标签，序列化输入共 ${inputBytes.toLocaleString("zh-CN")} 字节；不会发送案例原文。确认继续吗？`;
  if (!await confirmAppAction({ title: "整理三级标签？", description: warning, confirmLabel: "确认并开始" })) return;
  elements.organizeDetailTags.disabled = true;
  const mappings = [];
  const usage = { promptTokens: 0, completionTokens: 0, totalTokens: 0, cacheHitTokens: 0 };
  try {
    const settings = await privateAiSettings();
    for (let index = 0; index < chunks.length; index += 1) {
      elements.organizeDetailStatus.textContent = t("正在整理 {current}/{total}…", { current: index + 1, total: chunks.length });
      const result = await organizeDetailTagsWithDeepSeek(chunks[index], settings);
      mappings.push(...result.mappings);
      for (const key of Object.keys(usage)) usage[key] += Math.max(0, Number(result.usage?.[key]) || 0);
    }
    const response = await chrome.runtime.sendMessage({ type: "APPLY_DETAIL_TAG_ORGANIZATION", mappings });
    if (!response?.ok) throw new Error(response?.message || "无法应用三级标签整理结果");
    elements.organizeDetailStatus.textContent = t("{message} · 输入 {input} / 输出 {output} tokens", { message: translateUiMessage(response.message), input: usage.promptTokens, output: usage.completionTokens });
    await refreshLibrary();
  } catch (error) {
    elements.organizeDetailStatus.textContent = error.message || "三级标签整理失败，正式标签库没有改变";
    showFeedback(elements.organizeDetailStatus.textContent, true);
  } finally {
    elements.organizeDetailTags.disabled = false;
  }
}

async function controlAnalysisBatch(type) {
  if (!analysisBatchJob?.id) return;
  const buttons = {
    PAUSE_ANALYSIS_BATCH: elements.pauseAnalysisBatch,
    RESUME_ANALYSIS_BATCH: elements.resumeAnalysisBatch,
    CANCEL_ANALYSIS_BATCH: elements.cancelAnalysisBatch,
    RETRY_ANALYSIS_FAILURES: elements.retryAnalysisFailures,
    UNDO_ANALYSIS_BATCH: elements.undoAnalysisBatch
  };
  const button = buttons[type];
  if (button) button.disabled = true;
  try {
    if (type === "RETRY_ANALYSIS_FAILURES") {
      analysisBatchPreview = null;
      beginAnalysisDiagnostics();
      renderAnalysisBatch();
    }
    const response = await chrome.runtime.sendMessage({ type, jobId: analysisBatchJob.id });
    if (!response?.ok) throw new Error(response?.message || "无法更新批量任务");
    showFeedback(response.message);
    await refreshLibrary();
  } catch (error) {
    showFeedback(error.message, true);
  } finally {
    if (button) button.disabled = false;
  }
}

async function applyStagedAnalysisRebuild() {
  if (!analysisBatchJob?.id || analysisBatchJob.stagingValid !== true) return;
  const button = elements.applyStagedAnalysisRebuild;
  button.disabled = true;
  try {
    const response = await chrome.runtime.sendMessage({
      type: "APPLY_STAGED_ANALYSIS_REBUILD",
      jobId: analysisBatchJob.id
    });
    if (!response?.ok) throw new Error(response?.message || "无法应用重建缓存");
    analysisBatchPreview = null;
    if (response.facetCatalog) facetCatalog = normalizeFacetCatalog(response.facetCatalog);
    if (response.analysisBatchJob) analysisBatchJob = response.analysisBatchJob;
    canUndoAnalysisBatch = response.canUndoAnalysisBatch === true;
    showFeedback(response.message);
    await refreshLibrary();
  } catch (error) {
    showFeedback(error.message || "无法应用重建缓存", true);
  } finally {
    button.disabled = false;
  }
}

async function analyzeEntryWithRetry(entry, catalog, settingsValue, outputLocale = currentLocale(), signal, onDiagnostic, analysisInput) {
  const reportDiagnostic = typeof onDiagnostic === "function"
    ? (event) => onDiagnostic(event.stage, event)
    : undefined;
  let serviceRequests = 0;
  try {
    const result = await runScheduledAnalysisWithRetries({
      key: `${settingsValue.providerId}:${settingsValue.analysisModel || settingsValue.compatible?.model}:textTags`,
      concurrency: settingsValue.concurrency,
      wait: (milliseconds) => wait(milliseconds, signal),
      task: async () => {
        serviceRequests += 1;
        return analyzeTextDetailedWithDeepSeek(entry, catalog, { ...settingsValue, outputLocale }, fetch, {
          signal,
          onDiagnostic: reportDiagnostic,
          analysisInput
        });
      }
    });
    return {
      ...result,
      attempts: {
        serviceRequests,
        outputCorrectionRequests: Number(result.attempts?.outputCorrectionRequests) || 0
      }
    };
  } catch (error) {
    error.attempts = {
      serviceRequests,
      outputCorrectionRequests: Math.max(0, Number(error?.attempts?.outputCorrectionRequests) || 0)
    };
    throw error;
  }
}

async function analyzeSingleEntry(entry, button, analysisInput = canonicalTextAnalysisInput(entry)) {
  button.disabled = true;
  try {
    const settingsValue = await privateAiSettings();
    const fingerprint = await textFingerprint(analysisInput.text);
    const result = await analyzeEntryWithRetry(entry, facetCatalog, settingsValue, currentLocale(), undefined, undefined, analysisInput);
    const profileFingerprint = await analysisProfileFingerprint(settingsValue, currentLocale());
    const response = await chrome.runtime.sendMessage({
      type: "APPLY_ENTRY_ANALYSIS_RESULT",
      entryId: entry.id,
      fingerprint,
      textRevision: analysisInput.textRevision,
      assetId: analysisInput.assetId,
      tags: result.tags,
      normalizationDiagnostics: result.normalizationDiagnostics,
      attempts: result.attempts,
      usage: result.usage,
      model: result.model,
      profileFingerprint
    });
    if (!response?.ok) throw new Error(response?.message || "无法应用分析结果");
    showFeedback(response.message);
    await refreshLibrary();
  } catch (error) {
    showFeedback(error.message || "分析失败", true);
  } finally {
    button.disabled = false;
  }
}

async function privateAiSettings(assignment = null) {
  const response = await chrome.runtime.sendMessage({ type: "GET_AI_TASK_RUNTIME", taskId: "textTags", assignment });
  if (!response?.ok) throw new Error(response?.message || "无法读取文字标签服务");
  return {
    ...normalizeAiSettings(response.aiSettings),
    providerId: String(response.assignment?.providerId ?? "").trim(),
    concurrency: Math.max(2, Number(response.assignment?.concurrency) || 20)
  };
}

function wait(milliseconds, signal) {
  if (!signal) return new Promise((resolve) => setTimeout(resolve, milliseconds));
  if (signal.aborted) return Promise.reject(new DOMException("Aborted", "AbortError"));
  return new Promise((resolve, reject) => {
    const timeoutId = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, milliseconds);
    const onAbort = () => {
      clearTimeout(timeoutId);
      reject(new DOMException("Aborted", "AbortError"));
    };
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

async function previewReanalysis() {
  elements.previewReanalyze.disabled = true;
  elements.reanalyzePreview.textContent = t("正在检查本机资料…");
  try {
    const response = await chrome.runtime.sendMessage({ type: "PREVIEW_REANALYZE" });
    if (!response?.ok) throw new Error(response?.message || "无法检查资料");
    reanalysisPreview = response.preview;
    renderBatchManager();
  } catch (error) {
    showFeedback(error.message, true);
  } finally {
    elements.previewReanalyze.disabled = false;
  }
}

async function startLibraryMaintenance() {
  elements.applyReanalyze.disabled = true;
  try {
    const response = await chrome.runtime.sendMessage({ type: "START_LIBRARY_MAINTENANCE" });
    if (!response?.ok) throw new Error(response?.message || "无法开始资料补全");
    maintenanceJob = response.maintenanceJob;
    reanalysisPreview = null;
    showFeedback(response.message);
    renderBatchManager();
    scheduleMaintenanceStatusPoll();
  } catch (error) {
    showFeedback(error.message, true);
    renderBatchManager();
  }
}

async function updateLibraryMaintenance(type) {
  try {
    const response = await chrome.runtime.sendMessage({ type });
    if (!response?.ok) throw new Error(response?.message || "无法更新资料补全任务");
    maintenanceJob = response.maintenanceJob;
    showFeedback(response.message);
    renderBatchManager();
    scheduleMaintenanceStatusPoll();
  } catch (error) {
    showFeedback(error.message, true);
  }
}

function scheduleMaintenanceStatusPoll() {
  if (maintenancePollTimer) clearTimeout(maintenancePollTimer);
  maintenancePollTimer = 0;
  if (!maintenanceJob || !["running", "paused"].includes(maintenanceJob.status)) return;
  maintenancePollTimer = setTimeout(async () => {
    maintenancePollTimer = 0;
    const response = await chrome.runtime.sendMessage({ type: "GET_LIBRARY_MAINTENANCE_STATUS" }).catch(() => null);
    if (response?.ok) {
      maintenanceJob = response.maintenanceJob;
      if (elements.settingsDialog.open && activeSettingsTab === "tasks") renderBatchManager();
    }
    scheduleMaintenanceStatusPoll();
  }, 1000);
}

function handleLibraryMaintenanceMessage(message) {
  if (message?.type === "LIBRARY_DERIVED_METADATA_UPDATED" && message.assetId && message.metadata) {
    imageDerivedMetadata.set(message.assetId, message.metadata);
    for (const palette of document.querySelectorAll("[data-palette-id]")) {
      if (palette.dataset.paletteId === message.assetId) syncPalette(palette, message.metadata.palette?.colors);
    }
    return;
  }
  if (message?.type === "LIBRARY_MAINTENANCE_PROGRESS") {
    maintenanceJob = message.maintenanceJob;
    if (elements.settingsDialog.open && activeSettingsTab === "tasks") renderBatchManager();
    if (maintenanceJob?.status === "completed") {
      void getAllDerivedMetadata().then((metadata) => {
        imageDerivedMetadata = metadata;
        imageDerivedMetadataLoaded = true;
        rebuildLocalSimilarityIndex();
        rebuildLibrarySearchIndex();
        gallerySearchIndex = searchIndexForEntries(indexedGalleryEntries);
      }).catch(() => undefined);
    }
    scheduleMaintenanceStatusPoll();
  }
}

function renderReanalysisPreview() {
  if (maintenanceJob?.total) {
    if (maintenanceJob.status === "completed" && !maintenanceJob.failed) {
      elements.reanalyzePreview.textContent = t("资料索引已完整");
      return;
    }
    const status = ({ running: "补全中", paused: "已暂停", completed: "补全完成", canceled: "已取消" })[maintenanceJob.status] || maintenanceJob.status;
    elements.reanalyzePreview.textContent = t("{status} · 已处理 {processed}/{total} · 成功 {succeeded} · 失败 {failed}", { status: translateUiMessage(status), processed: maintenanceJob.processed, total: maintenanceJob.total, succeeded: maintenanceJob.succeeded, failed: maintenanceJob.failed });
    return;
  }
  if (!reanalysisPreview) {
    elements.reanalyzePreview.textContent = "";
    return;
  }
  const wrapper = el("div", "");
  const nothingMissing = !reanalysisPreview.confirmed && !reanalysisPreview.suggested && !reanalysisPreview.paletteCount;
  wrapper.append(textEl("strong", "", nothingMissing
    ? t("资料索引已完整")
    : t("需要更新索引：{types} 条内容类型，{palettes} 张图片色卡。", {
        types: reanalysisPreview.confirmed,
        palettes: reanalysisPreview.paletteCount
      })));
  const list = el("div", "reanalyze-case-list");
  reanalysisPreview.cases.forEach((item) => list.append(rawTextEl("p", "", `${item.title}：${t("确认")} ${item.confirmed}，${currentLocale() === "en" ? "suggestions" : "建议"} ${item.suggested}`)));
  wrapper.append(list);
  elements.reanalyzePreview.replaceChildren(wrapper);
}

function updateLibrarySettingsSaveState() {
  const titleChanged = elements.libraryNameSetting.value !== (elements.libraryNameSetting.dataset.savedValue ?? "");
  const pathChanged = elements.exportPathSetting.value !== (elements.exportPathSetting.dataset.savedValue ?? "");
  elements.saveLibrarySettings.disabled = !(titleChanged || pathChanged);
}

async function saveLibrarySettings() {
  const libraryTitle = libraryTitleForStorage(
    elements.libraryNameSetting.value,
    elements.libraryNameSetting.dataset.storedValue,
    currentLocale()
  );
  const response = await perform(elements.saveLibrarySettings, {
    type: "UPDATE_SETTINGS",
    settings: {
      libraryTitle,
      outputPath: elements.exportPathSetting.value
    }
  }, false);
  if (!response?.ok) return;
  const displayedLibraryTitle = libraryTitleForLocale(response.settings.libraryTitle, currentLocale());
  elements.libraryNameSetting.value = displayedLibraryTitle;
  elements.libraryNameSetting.dataset.savedValue = displayedLibraryTitle;
  elements.libraryNameSetting.dataset.storedValue = response.settings.libraryTitle || "";
  elements.exportPathSetting.dataset.savedValue = elements.exportPathSetting.value;
  updateLibrarySettingsSaveState();
}

async function perform(button, message, refresh = true) {
  button.disabled = true;
  try {
    const response = await chrome.runtime.sendMessage(message);
    if (!response?.ok) throw new Error(response?.message || "操作失败");
    showFeedback(response.message || "操作完成");
    if (refresh) await refreshLibrary();
    return response;
  } catch (error) {
    showFeedback(error.message, true);
    return null;
  } finally {
    button.disabled = false;
  }
}

async function deleteCaseIncrementally(button, entryId) {
  button.disabled = true;
  try {
    const deletingEntry = entries.find((item) => item.id === entryId);
    const response = await chrome.runtime.sendMessage({ type: "DELETE_ENTRY", entryId });
    if (!response?.ok) throw new Error(response?.message || "删除案例失败");
    closeDetail();
    const visibleCard = [...elements.caseList.children].find((card) => card.dataset.entryId === entryId) ?? null;
    entries = response.entries ?? entries.filter((item) => item.id !== entryId);
    organizerState = response.organizerState ?? organizerState;
    compoundCases = normalizeCompoundCases(response.compoundCases, entries);
    rebuildLibraryDerivedState();
    caseCardCache.delete(entryId);
    selectedCaseIds.delete(entryId);
    for (const asset of normalizeEntryMedia(deletingEntry ?? {}).mediaAssets) clearMediaAssetCache(asset.id);
    if (visibleCard) {
      galleryMasonry.remove(visibleCard);
      indexedGalleryEntries = indexedGalleryEntries.filter((item) => item.id !== entryId);
      visibleEntries = visibleEntries.filter((item) => item.id !== entryId);
      renderedCount = elements.caseList.children.length;
      gallerySearchIndex = searchIndexForEntries(indexedGalleryEntries);
      renderProjectFilters();
      renderContentFilters(indexedGalleryEntries);
      renderFacetFilters(indexedGalleryEntries);
      renderActiveFilters();
      updateLoadMore();
      if (renderedCount < Math.min(PAGE_SIZE, visibleEntries.length)) renderNextBatch(galleryGeneration);
      updateGalleryCounts();
    } else renderGallery();
    updateSelectionBar();
    showFeedback(response.message);
  } catch (error) {
    showFeedback(error.message || "删除案例失败", true);
  } finally {
    button.disabled = false;
  }
}

function updateGalleryCounts() {
  const pendingCount = indexedGalleryEntries.filter(isEntryPending).length;
  elements.resultCount.textContent = translateUiMessage(`${visibleEntries.length} 个案例`);
  elements.pendingCount.textContent = String(pendingCount);
  pendingSwitch.hidden = !pendingCount;
  elements.emptyState.hidden = visibleEntries.length > 0;
  elements.emptyLibrary.hidden = logicalCases.length > 0;
  elements.emptyFilter.hidden = logicalCases.length === 0;
}

async function openTrashDialog() {
  elements.trashFeedback.textContent = "";
  if (!elements.trashDialog.open) elements.trashDialog.showModal();
  await loadTrashItems();
}

async function loadTrashItems() {
  elements.trashRestoreAll.disabled = true;
  try {
    const response = await chrome.runtime.sendMessage({ type: "GET_TRASH_ITEMS" });
    if (!response?.ok) throw new Error(response?.message || "无法读取回收站");
    trashItems = Array.isArray(response.items) ? response.items : [];
    renderTrashItems();
  } catch (error) {
    showTrashFeedback(error.message || "无法读取回收站", true);
  } finally {
    elements.trashRestoreAll.disabled = trashItems.length === 0;
  }
}

function renderTrashItems() {
  elements.trashCount.hidden = trashItems.length === 0;
  elements.trashCount.textContent = String(trashItems.length);
  elements.trashEmpty.disabled = trashItems.length === 0;
  elements.trashRestoreAll.disabled = trashItems.length === 0;
  if (!trashItems.length) {
    elements.trashList.replaceChildren(textEl("strong", "trash-empty-title", "回收站为空"));
    return;
  }
  const kindNames = { entry: "案例", collection: "项目", media: "媒体" };
  elements.trashList.replaceChildren(...trashItems.map((item) => {
    const row = el("article", "trash-item");
    const preview = trashItemPreview(item);
    const cover = el("div", "trash-item-cover");
    if (preview.imageAsset) {
      const image = document.createElement("img");
      image.alt = `${preview.title} 封面`;
      image.decoding = "async";
      cover.append(image);
      void hydrateTrashCover(image, preview.imageAsset.id);
    } else {
      cover.append(createUiIcon(preview.icon));
      cover.setAttribute("aria-label", `${kindNames[item.kind] || "内容"}封面`);
    }
    const copy = el("div", "trash-item-copy");
    const title = rawTextEl("strong", "", preview.title || `${kindNames[item.kind] || "内容"} ${item.targetId}`);
    title.title = title.textContent;
    copy.append(
      title,
      rawTextEl("small", "", `${kindNames[item.kind] || "内容"} · ${formatDate(item.deletedAt)}`)
    );
    if (preview.labels.length) {
      const labels = el("div", "trash-item-labels");
      labels.append(...preview.labels.map((value) => rawTextEl("span", "", value)));
      copy.append(labels);
    }
    const actions = el("div", "trash-item-actions");
    const restore = el("button", "icon-button button-secondary");
    restore.type = "button";
    restore.setAttribute("aria-label", `恢复：${preview.title}`);
    restore.title = t("恢复");
    restore.append(createUiIcon("refresh-cw"));
    const remove = el("button", "icon-button quiet-danger");
    remove.type = "button";
    remove.setAttribute("aria-label", `永久删除：${preview.title}`);
    remove.title = t("永久删除");
    remove.append(createUiIcon("trash-2"));
    restore.addEventListener("click", () => restoreTrashItem(item, restore));
    remove.addEventListener("click", () => permanentlyDeleteTrashItem(item, remove));
    actions.append(restore, remove);
    row.append(cover, copy, actions);
    return row;
  }));
}

function trashItemPreview(item) {
  const entry = trashPreviewEntry(item);
  const mediaAssets = entry ? entryMediaAssets(entry) : [];
  const primary = item.kind === "media"
    ? mediaAssets.find((asset) => asset.id === item.targetId) ?? mediaAssets.find((asset) => asset.usage !== "poster")
    : primaryMediaAsset(entry ?? {});
  const imageAsset = primary?.kind === "image"
    ? primary
    : primary?.kind === "video" ? posterAssetForVideo(entry ?? {}, primary) : null;
  const title = item.kind === "collection"
    ? String(item.snapshot?.name ?? "项目")
    : item.kind === "media"
      ? String(primary?.sourceTitle || entry?.title || "媒体")
      : String(entry?.title ?? "案例");
  const icon = item.kind === "collection"
    ? "folder"
    : ({ image: "image", video: "video", audio: "play", document: "file-text", attachment: "paperclip" }[primary?.kind] || "file-text");
  return {
    title,
    imageAsset,
    icon,
    labels: item.kind === "entry" ? uniqueNames(entry?.customLabels) : []
  };
}

function trashPreviewEntry(item) {
  if (item.kind === "entry") return item.snapshot ?? null;
  if (item.kind === "media") {
    return {
      title: entries.find((entry) => entry.id === item.relationships?.entryId)?.title || "媒体",
      mediaAssets: item.snapshot?.mediaAssets ?? [],
      primaryMediaId: item.targetId
    };
  }
  for (const entryId of item.snapshot?.entryIds ?? []) {
    const activeEntry = entries.find((entry) => entry.id === entryId);
    if (activeEntry && primaryMediaAsset(activeEntry)) return activeEntry;
    const deletedEntry = trashItems.find((candidate) => candidate.kind === "entry" && candidate.targetId === entryId)?.snapshot;
    if (deletedEntry && primaryMediaAsset(deletedEntry)) return deletedEntry;
  }
  return null;
}

async function hydrateTrashCover(image, assetId) {
  try {
    let url = await createThumbnailUrl(assetId).catch(() => "");
    if (!url) {
      const blob = await getMediaBlob(assetId);
      if (blob) {
        url = URL.createObjectURL(blob);
        thumbnailUrls.set(assetId, url);
      }
    }
    if (url && image.isConnected) image.src = url;
    else if (image.isConnected) image.replaceWith(createUiIcon("image"));
  } catch {
    if (image.isConnected) image.replaceWith(createUiIcon("image"));
  }
}

async function restoreTrashItem(item, button) {
  const response = await performTrashAction(button, {
    type: "RESTORE_TRASH_ITEMS",
    itemIds: relatedTrashGroupIds(item)
  });
  if (!response?.ok) return;
  const unresolved = Array.isArray(response.unresolved) ? response.unresolved : [];
  if (unresolved.length) {
    showTrashFeedback(unresolved[0].reason || "当前关系已变化，暂时无法安全恢复", true);
  } else {
    showTrashFeedback(response.message || "已恢复");
  }
  await refreshLibrary();
  await loadTrashItems();
}

async function restoreAllTrashItems() {
  if (!trashItems.length) return;
  const response = await performTrashAction(elements.trashRestoreAll, {
    type: "RESTORE_TRASH_ITEMS",
    itemIds: trashItems.map((item) => item.id)
  });
  if (!response?.ok) return;
  const unresolved = Array.isArray(response.unresolved) ? response.unresolved : [];
  const reasons = [...new Set(unresolved.map((item) => item.reason).filter(Boolean))];
  showTrashFeedback([response.message || "恢复完成", ...reasons].join("；"), unresolved.length > 0);
  await refreshLibrary();
  await loadTrashItems();
}

function relatedTrashGroupIds(startItem) {
  const selected = new Set([startItem.id]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const item of trashItems) {
      if (!selected.has(item.id)) continue;
      if (item.kind === "collection") {
        const memberIds = new Set(item.snapshot?.entryIds ?? []);
        for (const candidate of trashItems) {
          if (candidate.kind === "collection" && (
            candidate.snapshot?.parentId === item.targetId || item.snapshot?.parentId === candidate.targetId
          ) && !selected.has(candidate.id)) {
            selected.add(candidate.id);
            changed = true;
          }
          if (candidate.kind === "entry" && memberIds.has(candidate.targetId) && !selected.has(candidate.id)) {
            selected.add(candidate.id);
            changed = true;
          }
        }
      }
      if (item.kind === "entry") {
        const relatedCollectionIds = new Set((item.relationships?.collections ?? []).map((value) => value.id));
        for (const candidate of trashItems) {
          if (candidate.kind === "collection" && relatedCollectionIds.has(candidate.targetId) && !selected.has(candidate.id)) {
            selected.add(candidate.id);
            changed = true;
          }
          if (candidate.kind === "media" && candidate.relationships?.entryId === item.targetId && !selected.has(candidate.id)) {
            selected.add(candidate.id);
            changed = true;
          }
        }
      }
      if (item.kind === "media") {
        const entryItem = trashItems.find((candidate) => (
          candidate.kind === "entry" && candidate.targetId === item.relationships?.entryId
        ));
        if (entryItem && !selected.has(entryItem.id)) {
          selected.add(entryItem.id);
          changed = true;
        }
      }
    }
  }
  return [...selected];
}

async function permanentlyDeleteTrashItem(item, button) {
  const itemIds = relatedTrashGroupIds(item);
  if (!await confirmAppAction({
    title: "永久删除这项内容？",
    description: itemIds.length > 1
      ? `这项内容与另外 ${itemIds.length - 1} 项归档内容相互关联，将一起永久删除；本机文件也会被移除。`
      : "本机保存的相关文件也会被移除，此操作无法恢复。",
    confirmLabel: "永久删除",
    danger: true
  })) return;
  const response = await performTrashAction(button, { type: "PERMANENT_DELETE_TRASH_ITEMS", itemIds });
  if (!response?.ok) return;
  showTrashFeedback(response.message || "已永久删除");
  await loadTrashItems();
}

async function emptyTrashFromDialog() {
  if (!trashItems.length) return;
  if (!await confirmAppAction({
    title: `清空回收站中的 ${trashItems.length} 项内容？`,
    description: "相关本机文件会被永久移除，且无法恢复。",
    confirmLabel: "永久清空",
    danger: true
  })) return;
  const response = await performTrashAction(elements.trashEmpty, { type: "EMPTY_TRASH" });
  if (!response?.ok) return;
  showTrashFeedback(response.message || "回收站已清空");
  await loadTrashItems();
}

function showTrashFeedback(message, isError = false) {
  elements.trashFeedback.textContent = message;
  elements.trashFeedback.classList.toggle("error", isError);
}

async function performTrashAction(button, message) {
  button.disabled = true;
  try {
    const response = await chrome.runtime.sendMessage(message);
    if (!response?.ok) throw new Error(response?.message || "回收站操作失败");
    return response;
  } catch (error) {
    showTrashFeedback(error.message || "回收站操作失败", true);
    return null;
  } finally {
    button.disabled = false;
  }
}

async function openDataSafety() {
  elements.dataSafetyFeedback.textContent = "";
  openSettingsDialog("general");
  await renderDataSafetyStatus();
}

async function renderDataSafetyStatus() {
  const response = await chrome.runtime.sendMessage({ type: "GET_DATA_SAFETY_STATUS" });
  if (!response?.ok) {
    elements.dataSafetyStatus.textContent = response?.message || t("无法读取同步状态");
    return;
  }
  syncStatus = response.syncStatus ?? {};
  elements.dataSafetyCount.textContent = currentLocale() === "en"
    ? `${response.entryCount} cases · ${response.mediaCount} media (${response.videoCount} videos)`
    : `${response.entryCount} 个案例 · ${response.mediaCount} 项媒体（${response.videoCount} 个视频）`;
  elements.dataSafetyStatus.textContent = syncStatusMessage(syncStatus);
  const missingLocation = syncStatus.lastErrorCode === SYNC_ERROR_CODES.LOCATION_NOT_FOUND;
  const needsFolder = missingLocation || !syncStatus.connected || syncStatus.permission !== "granted";
  const needsUnlock = !missingLocation && syncStatus.connected && syncStatus.permission === "granted" && !syncStatus.unlocked;
  const syncRunning = syncStatus.active === true || dataSafetyOperationType === "SYNC_NOW";
  const canSync = !missingLocation && syncStatus.connected && syncStatus.permission === "granted" && syncStatus.unlocked && !syncRunning;
  elements.connectSyncFolder.hidden = !needsFolder;
  elements.connectSyncFolder.textContent = t(missingLocation ? "重新选择同步文件夹" : "连接同步文件夹");
  elements.unlockSyncVault.hidden = !needsUnlock;
  elements.syncNow.hidden = !canSync;
  elements.syncNow.disabled = !canSync;
  elements.cancelSync.hidden = !syncRunning;
  elements.cancelSync.disabled = syncStatus.cancelRequested === true;
  elements.dataSafetyPassword.hidden = !(needsFolder || needsUnlock);
  elements.disconnectSyncFolder.hidden = !syncStatus.connected;
  elements.restoreLibraryReplacementPoint.hidden = !response.canRestoreReplacementPoint;
  elements.restoreLibraryReplacementPoint.disabled = dataSafetyOperationActive || !response.canRestoreReplacementPoint;
  elements.restoreLibraryReplacementPoint.title = response.replacementPointCreatedAt
    ? t("回退点建立于 {date}", { date: new Date(response.replacementPointCreatedAt).toLocaleString() })
    : "";
  if (missingLocation) elements.syncSettings.open = true;
}

async function renderCapturePermissionStatus() {
  elements.capturePermissionSettingsFeedback.textContent = "";
  elements.capturePermissionSettingsFeedback.classList.remove("error");
  try {
    const status = await inspectCapturePermissionBundle(chrome.permissions);
    renderCapturePermissionItem(
      elements.captureWebPermissionStatus,
      elements.revokeCaptureWebPermission,
      status.webCaptureGranted
    );
    renderCapturePermissionItem(
      elements.captureClipboardPermissionStatus,
      elements.revokeCaptureClipboardPermission,
      status.clipboardGranted
    );
  } catch (error) {
    elements.capturePermissionSettingsFeedback.textContent = error?.message || "无法读取采集权限状态";
    elements.capturePermissionSettingsFeedback.classList.add("error");
  }
}

function renderCapturePermissionItem(statusElement, button, granted) {
  statusElement.textContent = t(granted ? "已授权" : "未授权");
  statusElement.classList.toggle("is-granted", granted);
  button.disabled = !granted;
}

async function revokeCapturePermission(kind) {
  const web = kind === "web";
  const button = web ? elements.revokeCaptureWebPermission : elements.revokeCaptureClipboardPermission;
  const request = web
    ? { origins: [...CONTINUOUS_CAPTURE_ORIGINS] }
    : { permissions: [...CLIPBOARD_READ_PERMISSIONS] };
  button.disabled = true;
  elements.capturePermissionSettingsFeedback.textContent = t("正在撤销权限…");
  elements.capturePermissionSettingsFeedback.classList.remove("error");
  try {
    const removed = await chrome.permissions.remove(request);
    if (!removed) throw new Error("Chrome 没有撤销这项权限，请稍后重试");
    await chrome.storage.local.remove(CAPTURE_PERMISSION_ONBOARDING_STORAGE_KEY);
    await renderCapturePermissionStatus();
    elements.capturePermissionSettingsFeedback.textContent = web
      ? "已撤销网页采集与截图权限"
      : "已撤销剪贴板提取权限";
  } catch (error) {
    elements.capturePermissionSettingsFeedback.textContent = error?.message || "权限撤销失败";
    elements.capturePermissionSettingsFeedback.classList.add("error");
    button.disabled = false;
  }
}

async function chooseSyncFolder() {
  if (dataSafetyOperationActive) return;
  const password = elements.syncPassword.value;
  if (password.length < 8) {
    showDataSafetyFeedback(t("同步密码至少需要 8 个字符"), true);
    elements.syncPassword.focus();
    return;
  }
  if (typeof window.showDirectoryPicker !== "function") {
    showDataSafetyFeedback(t("当前浏览器不支持同步文件夹，请使用最新版 Chrome"), true);
    return;
  }
  elements.connectSyncFolder.disabled = true;
  try {
    const directory = await window.showDirectoryPicker({ mode: "readwrite" });
    const permission = typeof directory.requestPermission === "function"
      ? await directory.requestPermission({ mode: "readwrite" })
      : "granted";
    if (permission !== "granted") throw new Error(t("没有获得同步文件夹读写权限"));
    await saveSyncDirectoryHandle(directory);
    await runDataSafetyAction(
      elements.connectSyncFolder,
      { type: "CONNECT_SYNC_FOLDER", password },
      false,
      { keepDisabled: true }
    );
  } catch (error) {
    if (error?.name !== "AbortError") showDataSafetyFeedback(error.message, true);
  } finally {
    elements.connectSyncFolder.disabled = false;
  }
}

async function startManualSync() {
  if (dataSafetyOperationActive) {
    showDataSafetyFeedback(t("当前操作仍在进行，请等待完成"), true);
    return;
  }
  const description = syncStatus.localDirty
    ? "本机有尚未同步的变化。开始后会读取同步文件夹、合并两端变化并写回结果；完成前可以停止。"
    : "开始后会检查同步文件夹并合并两端变化；如果没有变化，不会写入快照或刷新案例库。完成前可以停止。";
  const confirmed = await confirmAppAction({
    title: "开始一次手动同步？",
    description,
    confirmLabel: "开始同步"
  });
  if (!confirmed) return;
  await runDataSafetyAction(elements.syncNow, { type: "SYNC_NOW" }, "changed");
}

async function cancelManualSync() {
  if (dataSafetyOperationType !== "SYNC_NOW" && syncStatus.active !== true) return;
  elements.cancelSync.disabled = true;
  showDataSafetyFeedback("正在停止同步；已提交的数据不会被回滚，尚未提交的本机资料不会改变…");
  try {
    const response = await chrome.runtime.sendMessage({ type: "CANCEL_SYNC" });
    if (!response?.ok) throw new Error(response?.message || "无法停止同步");
  } catch (error) {
    elements.cancelSync.disabled = false;
    showDataSafetyFeedback(error.message || "无法停止同步", true);
  }
}

async function runDataSafetyAction(button, message, refresh = true, options = {}) {
  if (dataSafetyOperationActive) {
    showDataSafetyFeedback(t("当前操作仍在进行，请等待完成"), true);
    return null;
  }
  const originalLabel = button.textContent;
  setDataSafetyBusy(true, message.type);
  button.setAttribute("aria-busy", "true");
  if (message.type === "CONNECT_SYNC_FOLDER") {
    button.textContent = t("正在连接…");
    showDataSafetyFeedback("正在验证文件夹与密码，不会读取或合并资料…");
  } else if (message.type === "UNLOCK_SYNC_VAULT") {
    button.textContent = t("正在解锁…");
    showDataSafetyFeedback("正在验证同步密码，不会读取或合并资料…");
  } else if (message.type === "SYNC_NOW") {
    button.textContent = t("正在同步…");
    showDataSafetyFeedback(t("正在同步本地与文件夹资料…"));
  }
  try {
    if (["CONNECT_SYNC_FOLDER", "UNLOCK_SYNC_VAULT"].includes(message.type) &&
        String(message.password ?? "").length < 8) {
      throw new Error(t("同步密码至少需要 8 个字符"));
    }
    const response = await chrome.runtime.sendMessage(message);
    if (!response?.ok) throw new Error(response?.message || t("操作失败"));
    elements.syncPassword.value = "";
    showDataSafetyFeedback(response.message || t("操作完成"));
    const shouldRefresh = refresh === true || (refresh === "changed" && response.libraryChanged === true);
    if (shouldRefresh) await refreshLibrary();
    await renderDataSafetyStatus();
    return response;
  } catch (error) {
    showDataSafetyFeedback(error.message, true);
    await renderDataSafetyStatus();
    return null;
  } finally {
    button.textContent = originalLabel;
    button.removeAttribute("aria-busy");
    setDataSafetyBusy(false);
    if (options.keepDisabled) button.disabled = true;
  }
}

function setDataSafetyBusy(active, operationType = "") {
  dataSafetyOperationActive = active;
  dataSafetyOperationType = active ? operationType : "";
  elements.settingsClose.disabled = active;
  for (const button of [
    elements.importLibraryPackage,
    elements.createFolderBackup,
    elements.restoreFolderBackup,
    elements.restoreLibraryReplacementPoint,
    elements.connectSyncFolder,
    elements.unlockSyncVault,
    elements.syncNow,
    elements.disconnectSyncFolder
  ]) {
    button.disabled = active;
  }
  const syncRunning = active && operationType === "SYNC_NOW";
  elements.cancelSync.hidden = !syncRunning;
  elements.cancelSync.disabled = !syncRunning;
}

function handleDataSafetyProgress(message) {
  if (message?.type !== "SYNC_PROGRESS" || !dataSafetyOperationActive || !elements.settingsDialog.open || activeSettingsTab !== "general") return;
  const current = Math.max(0, Number(message.current) || 0);
  const total = Math.max(0, Number(message.total) || 0);
  const count = total ? ` ${Math.min(current, total)}/${total}` : "";
  const english = currentLocale() === "en";
  const labels = english
    ? { reading: "Checking changes", uploading: "Preparing changed media", downloading: "Restoring changed media", merging: "Merging library changes", committing: "Saving sync result", canceling: "Stopping sync" }
    : { reading: "正在检查变化", uploading: "正在准备变化的媒体", downloading: "正在恢复变化的媒体", merging: "正在合并资料变更", committing: "正在保存同步结果", canceling: "正在停止同步" };
  showDataSafetyFeedback(`${labels[message.phase] || (english ? "Syncing" : "正在同步")}${count}`);
}

function showDataSafetyFeedback(message, isError = false) {
  elements.dataSafetyFeedback.textContent = message;
  elements.dataSafetyFeedback.classList.toggle("error", isError);
}

function localizedImportReportDescription(report) {
  const sentences = importReportDescription(report).split("。").map((item) => item.trim()).filter(Boolean);
  const separator = currentLocale() === "en" ? ". " : "。";
  return sentences.map(translateUiMessage).join(separator) + (currentLocale() === "en" ? ". " : "。");
}

function syncStatusMessage(status) {
  if (!status.connected) return t("尚未连接同步文件夹");
  if (status.permission !== "granted") return t("同步文件夹需要重新授权");
  if (!status.unlocked) return t("同步库已锁定，请输入密码解锁");
  if (status.lastErrorCode === SYNC_ERROR_CODES.LOCATION_NOT_FOUND) {
    return t("同步文件夹中的文件或目录不存在，请重新选择同步文件夹后再同步");
  }
  if (status.active) return status.cancelRequested ? "正在停止本次同步…" : "正在执行一次手动同步…";
  if (status.lastError) return status.lastError;
  if (status.state === "canceled") return "上次手动同步已停止，本机未提交的资料没有改变";
  if (status.state === "up-to-date") return "已检查：两端没有变化，没有写入同步文件夹";
  if (status.localDirty) return "本机有尚未同步的变化；只有点击并确认后才会同步";
  if (!status.lastSyncAt) return t("同步库已连接，尚未完成首次同步");
  const date = new Date(status.lastSyncAt);
  const formatted = Number.isNaN(date.getTime()) ? status.lastSyncAt : date.toLocaleString(currentLocale() === "en" ? "en" : "zh-CN");
  return currentLocale() === "en" ? `Last synced ${formatted}` : `上次成功同步：${formatted}`;
}

async function maybeShowRestoreOnboarding() {
  if (entries.length || elements.settingsDialog.open) return;
  const key = "dataSafetyOnboardingSeen";
  const stored = await chrome.storage.local.get(key);
  if (stored[key]) return;
  await chrome.storage.local.set({ [key]: true });
  await openDataSafety();
}

async function screenshotBlob(entryId) {
  const direct = await getScreenshotBlob(entryId);
  if (direct) return direct;
  const key = screenshotStorageKey(entryId);
  const stored = await chrome.storage.local.get(key);
  const value = stored[key];
  if (!/^data:image\/(?:png|jpeg|webp);base64,/.test(String(value ?? ""))) return null;
  const blob = await (await fetch(value)).blob();
  await saveScreenshotBlob(entryId, blob);
  await chrome.storage.local.remove(key);
  return blob;
}

async function originalScreenshotUrl(entryId) {
  if (originalUrls.has(entryId)) return originalUrls.get(entryId);
  const blob = await screenshotBlob(entryId);
  if (!blob) return "";
  const url = URL.createObjectURL(blob);
  originalUrls.set(entryId, url);
  return url;
}

function clearScreenshotUrls(entryId) {
  for (const map of [thumbnailUrls, originalUrls]) {
    const url = map.get(entryId);
    if (url) URL.revokeObjectURL(url);
    map.delete(entryId);
  }
}

function clearMediaAssetCache(assetId) {
  clearScreenshotUrls(assetId);
  const documentUrl = documentPreviewUrls.get(assetId);
  if (documentUrl) URL.revokeObjectURL(documentUrl);
  documentPreviewUrls.delete(assetId);
  documentDerived.delete(assetId);
}

function releaseDetailMediaUrls() {
  for (const url of detailMediaUrls) URL.revokeObjectURL(url);
  detailMediaUrls.clear();
}

function releaseDetailControllers() {
  for (const cleanup of [...detailControllerCleanups]) cleanup();
}

function createPalette(colors = [], assetId = "") {
  const palette = el("div", "palette");
  if (assetId) palette.dataset.paletteId = assetId;
  syncPalette(palette, colors);
  return palette;
}

function syncPalette(palette, colorsValue = []) {
  const colors = (Array.isArray(colorsValue) ? colorsValue : []).filter(Boolean);
  palette.replaceChildren();
  palette.hidden = !colors.length && !palette.dataset.paletteId;
  palette.classList.toggle("is-empty", !colors.length);
  palette.setAttribute("aria-label", colors.length ? translateUiMessage(`代表色卡：${colors.join("、")}`) : t("暂无色卡"));
  colors.forEach((color) => {
    const swatch = el("span", "swatch");
    swatch.style.backgroundColor = color;
    swatch.title = color;
    palette.append(swatch);
  });
}

function imageDimensions(asset) {
  const width = Math.max(0, Number(asset?.width) || Number(imageDerivedMetadata.get(asset?.id)?.width) || 0);
  const height = Math.max(0, Number(asset?.height) || Number(imageDerivedMetadata.get(asset?.id)?.height) || 0);
  return width && height ? { width, height } : null;
}

function paletteForEntry(entry) {
  const inline = entryPalette(entry);
  if (inline?.colors?.length) return inline;
  const visual = primaryVisual(entry);
  return visual?.id ? imageDerivedMetadata.get(visual.id)?.palette : null;
}

function discoveryVisualId(entry) {
  const primary = primaryMediaAsset(entry);
  if (primary?.kind === "image") return primary.id;
  if (primary?.kind === "video") return posterAssetForVideo(entry, primary)?.id || "";
  return "";
}

function discoveryColors(entry) {
  const visualId = discoveryVisualId(entry);
  if (!visualId) return [];
  const asset = entryMediaAssets(entry).find((item) => item.id === visualId);
  return asset?.palette?.colors ?? imageDerivedMetadata.get(visualId)?.palette?.colors ?? [];
}

function sanitizeSelections() {
  const validNodes = new Set([
    ...facetCatalog.facets.filter((item) => item.status === "active").map((item) => item.id),
    ...facetCatalog.nodes.filter((item) => item.status === "active").map((item) => item.id)
  ]);
  for (const [facetId, ids] of selectedFacets) {
    const next = new Set([...ids].filter((id) => validNodes.has(id)));
    if (next.size) selectedFacets.set(facetId, next); else selectedFacets.delete(facetId);
  }
  if (selectedContentId && !taxonomy.nodes.some((item) => item.id === selectedContentId)) selectedContentId = "";
}

function entriesUsingNodes(nodeIds) {
  return entries.filter((entry) => (entry.facetAssignments ?? []).some((item) => nodeIds.has(item.nodeId))).length;
}

function reusableAnalysisItems(values) {
  return (Array.isArray(values) ? values : []).filter((item) => item?.source && item.source !== "deepseek_text");
}

function contentName(entry) {
  if (entry.compoundCase) {
    const names = entryContentTypeIds(entry).map(contentLabel);
    return names.length > 1 ? translateUiMessage(`复合 · ${names.length} 类`) : names[0] || t("待确认");
  }
  return entry.classification?.status === "needs_review" ? t("待确认") : contentLabel(entry.classification?.pathIds?.[0]);
}

function contentLabel(id) {
  const node = taxonomy.nodes.find((item) => item.id === id);
  return node ? (node.customized ? node.name : t(node.name)) : t("待确认");
}

function facetDisplayName(item) {
  return item?.names?.[currentLocale()] || item?.name || "";
}

function facetNodeDisplayPath(nodeId) {
  const parts = [];
  const visited = new Set();
  let node = nodeById(nodeId);
  while (node && !visited.has(node.id)) {
    visited.add(node.id);
    parts.unshift(facetDisplayName(node));
    node = node.parentId ? nodeById(node.parentId) : null;
  }
  return parts.join(" / ");
}

function facetById(id) { return facetCatalog.facets.find((item) => item.id === id); }
function nodeById(id) { return facetCatalog.nodes.find((item) => item.id === id); }

function labeledInput(text, value = "", className = "") {
  const label = el("label", className);
  const input = document.createElement("input");
  input.value = value;
  label.append(textEl("span", "", text), input);
  return { label, input };
}

function labeledSelect(text, values, selected = "") {
  const label = el("label", "");
  const select = document.createElement("select");
  select.append(...values.map(([id, name]) => option(id, name, id === selected)));
  label.append(textEl("span", "", text), select);
  return { label, select };
}

function splitInput(value) { return String(value ?? "").split(/[,，;；]+/).map((item) => item.trim()).filter(Boolean); }
function excerpt(value, length) { const text = String(value ?? "").replace(/\s+/g, " ").trim(); return text.length > length ? `${text.slice(0, length)}…` : text; }
function formatDate(value) { const date = new Date(value); return Number.isNaN(date.getTime()) ? t("未知时间") : new Intl.DateTimeFormat(currentLocale(), { dateStyle: "medium", timeStyle: "short" }).format(date); }
function canvasBlob(canvas, type, quality) { return new Promise((resolve, reject) => canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error("缩略图生成失败")), type, quality)); }
function option(value, label, selected = false) { const item = document.createElement("option"); item.value = value; item.textContent = label; item.selected = selected; return item; }
function rawOption(value, label, selected = false) { return option(value, label, selected); }
function el(tag, className) { const item = document.createElement(tag); if (className) item.className = className; return item; }
function textEl(tag, className, text) { const item = el(tag, className); item.textContent = t(text); return item; }
function rawTextEl(tag, className, text) { const item = el(tag, className); item.textContent = text; return item; }
function camel(value) { return value.replace(/-([a-z])/g, (_match, letter) => letter.toUpperCase()); }

function beginAnalysisDiagnostics() {
  analysisDiagnostics = [];
  analysisDiagnosticStartedAt = Date.now();
  recordAnalysisDiagnostic("run_started");
}

function recordAnalysisDiagnostic(stage, detail = {}) {
  const at = Date.now();
  if (!analysisDiagnosticStartedAt) analysisDiagnosticStartedAt = at;
  analysisDiagnostics = [...analysisDiagnostics, {
    at,
    elapsedMs: Number.isFinite(detail.elapsedMs) ? Math.max(0, Math.round(detail.elapsedMs)) : at - analysisDiagnosticStartedAt,
    stage: String(stage || "unknown"),
    attempt: detail.attempt === "correction" ? "correction" : detail.attempt === "initial" ? "initial" : "",
    tagCount: Number.isInteger(detail.tagCount) && detail.tagCount >= 0 ? detail.tagCount : null,
    count: Number.isInteger(detail.count) && detail.count >= 0 ? detail.count : null,
    status: Number.isInteger(detail.status) && detail.status >= 0 ? detail.status : 0,
    category: [
      "aborted", "timeout", "service", "unknown_path", "duplicate", "too_long",
      "extra_fields", "count", "format", "invalid"
    ].includes(detail.category) ? detail.category : "",
    failed: Boolean(detail.failed)
  }].slice(-20);
  renderAnalysisDiagnostics();
  const snapshot = structuredClone(analysisDiagnostics);
  analysisDiagnosticWrite = analysisDiagnosticWrite
    .then(() => chrome.storage.local.set({ analysisDiagnostics: snapshot }))
    .catch(() => undefined);
}

function normalizeAnalysisDiagnostics(value) {
  if (!Array.isArray(value)) return [];
  return value.filter((event) => event && Number.isFinite(event.at) && typeof event.stage === "string").slice(-20);
}

function renderAnalysisDiagnostics() {
  if (!elements.analysisDiagnostics || !elements.analysisRuntimeVersion || !elements.analysisDiagnosticEvents) return;
  const visible = uiPreferences.analysisDiagnostics === true;
  elements.analysisDiagnostics.hidden = !visible;
  if (!visible) {
    elements.analysisDiagnostics.open = false;
    return;
  }
  elements.analysisRuntimeVersion.textContent = `PromptDirector ${chrome.runtime.getManifest().version} / Analysis v${ANALYSIS_PROMPT_VERSION}`;
  elements.analysisDiagnosticEvents.replaceChildren();
  if (!analysisDiagnostics.length) {
    elements.analysisDiagnosticEvents.append(rawTextEl("li", "analysis-diagnostics-empty", t("尚无本次分析事件")));
    return;
  }
  for (const event of analysisDiagnostics) {
    const item = document.createElement("li");
    item.dataset.stage = event.stage;
    const time = new Intl.DateTimeFormat(currentLocale(), {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false
    }).format(event.at);
    item.append(
      rawTextEl("span", "", time),
      rawTextEl("span", "", `+${(Math.max(0, event.elapsedMs || 0) / 1000).toFixed(1)}s`),
      rawTextEl("span", "", analysisDiagnosticLabel(event))
    );
    elements.analysisDiagnosticEvents.append(item);
  }
}

async function updateAnalysisDiagnosticsPreference() {
  const enabled = elements.showAnalysisDiagnostics.checked;
  elements.showAnalysisDiagnostics.disabled = true;
  try {
    const next = await updateUiPreferences({ ...uiPreferences, analysisDiagnostics: enabled });
    Object.assign(uiPreferences, next);
    renderAnalysisDiagnostics();
  } catch (error) {
    elements.showAnalysisDiagnostics.checked = uiPreferences.analysisDiagnostics;
    showFeedback(error?.message || "无法保存故障诊断设置", true);
  } finally {
    elements.showAnalysisDiagnostics.disabled = false;
  }
}

function analysisDiagnosticLabel(event) {
  const attempt = event.attempt === "correction" ? "纠错" : "首次";
  if (event.stage === "run_started") return "开始本次分析";
  if (event.stage === "runner_started") return "执行器开始";
  if (event.stage === "job_recovered") return "任务状态已读取";
  if (event.stage === "items_claimed") return event.count ? `领取 ${event.count} 条任务` : "没有更多待处理任务";
  if (event.stage === "request_started") return `${attempt}请求开始`;
  if (event.stage === "response_received") return `${attempt}响应：${event.tagCount ?? "?"} 个标签`;
  if (event.stage === "validation_failed") {
    const categories = {
      unknown_path: "未知分类路径",
      duplicate: "重复标签",
      too_long: "标签过长",
      extra_fields: "包含额外字段",
      count: "标签数量不合法",
      format: "格式不合法",
      invalid: "结果不合法"
    };
    const prefix = attempt === "纠错" ? "纠错" : "标签";
    return `${prefix}校验失败：${categories[event.category] || "结果不合法"}`;
  }
  if (event.stage === "validation_succeeded") return `${attempt}结果校验通过`;
  if (event.stage === "request_failed") {
    const category = event.category === "timeout" ? "超时" : event.category === "aborted" ? "已中止" : "服务失败";
    return `${attempt}请求${category}${event.status ? `（HTTP ${event.status}）` : ""}`;
  }
  if (event.stage === "commit_started") return "提交开始";
  if (event.stage === "commit_completed") return event.failed ? "失败结果已入任务状态" : "提交完成";
  return event.stage;
}

function analysisDiagnosticText() {
  const header = `PromptDirector ${chrome.runtime.getManifest().version} / Analysis v${ANALYSIS_PROMPT_VERSION}`;
  return [header, ...analysisDiagnostics.map((event) => {
    const time = new Date(event.at).toISOString();
    return `${time} +${(Math.max(0, event.elapsedMs || 0) / 1000).toFixed(1)}s ${analysisDiagnosticLabel(event)}`;
  })].join("\n");
}

function showFeedback(message, isError = false) {
  if (feedbackTimer) window.clearTimeout(feedbackTimer);
  feedbackTimer = 0;
  const value = translateUiMessage(message || "");
  elements.feedback.textContent = value;
  elements.feedback.classList.toggle("error", isError);
  elements.managerFeedback.textContent = value;
  elements.managerFeedback.classList.toggle("error", isError);
  elements.managerFeedback.hidden = !value || !elements.managerDialog.open;
  if (value) {
    feedbackTimer = window.setTimeout(() => {
      elements.feedback.textContent = "";
      elements.feedback.classList.remove("error");
      elements.managerFeedback.textContent = "";
      elements.managerFeedback.classList.remove("error");
      elements.managerFeedback.hidden = true;
      feedbackTimer = 0;
    }, isError ? ERROR_FEEDBACK_DURATION_MS : FEEDBACK_DURATION_MS);
  }
}

async function copyTextWithFeedback(button, value, successMessage, failureMessage) {
  const original = button.textContent;
  try {
    await navigator.clipboard.writeText(String(value ?? ""));
    button.textContent = t("已复制");
    showFeedback(successMessage);
  } catch {
    showFeedback(failureMessage, true);
  } finally {
    window.setTimeout(() => {
      if (button.isConnected) button.textContent = original;
    }, 1200);
  }
}

function safeHttpUrl(value) {
  try {
    const url = new URL(String(value ?? ""));
    return ["http:", "https:"].includes(url.protocol) ? url.href : "";
  } catch {
    return "";
  }
}
