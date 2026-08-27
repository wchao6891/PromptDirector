import {
  appendComposerMessage,
  appendDiagnosticEvent,
  clearComposerFailure,
  COMPOSER_INPUT_MAX_CHARACTERS,
  composerInputUsage,
  createComposerSession,
  createReferenceSnapshots,
  imageReferenceModeAvailability,
  isMeaningfulComposerSession,
  isComposerEligibleEntry,
  normalizeComposerAiProfile,
  plannerRequestPayload,
  setComposerFailure,
  normalizeComposerSettings
} from "./composer.js";
import {
  buildComposerDiagnostic,
  composerOutputChecks,
  diagnosticFilename
} from "./composer-diagnostics.js";
import {
  createAppliedSkillSnapshot,
  findCreativeSkillsBySlashQuery,
  normalizeCreativeSkillsState,
  reorderAppliedSkills
} from "./creative-skills.js";
import {
  normalizeAiSettings
} from "./deepseek.js";
import { requireAiRuntimeProtocolVersion } from "./ai-runtime.js";
import { confirmAppAction } from "./ui-dialogs.js";
import {
  ComposerServiceError,
  composerImageEditCapabilities,
  composerImageAvailability,
  composerServiceCapabilities,
  composerServiceCatalog,
  composerServiceErrorDetails,
  composerVideoAvailability,
  executeComposerTurnWithService,
  normalizeImageGenerationRequest,
  normalizeVideoGenerationRequest,
  selectedComposerService
} from "./composer-service.js";
import { applyComposerServiceResult, planComposerSession } from "./composer-turn-core.js";
import { createComposerImageWorkspace } from "./composer-image-workspace.js";
import { createComposerAnalysisTaskBridge } from "./composer-analysis-task-bridge.js";
import { composerAssemblyLayers } from "./composer-agent.js";
import { retrieveComposerSources } from "./composer-retrieval.js";
import { deleteScreenshotBlob, getScreenshotBlob, saveScreenshotBlob } from "./image-store.js";
import { readImageDimensions } from "./image-metadata.js";
import { deleteMediaBlobs, getDerivedMedia, getMediaBlob, saveDerivedMedia, saveMediaBlob } from "./media-store.js";
import { prepareLocalMedia } from "./local-media.js";
import { extractPdfSearchText } from "./document-viewer.js";
import {
  composerPasteFiles,
  createTempReference,
  imageTempReferenceBlock,
  namePastedTempReferenceFile,
  TEMP_REFERENCE_FILE_ACCEPT,
  TEMP_REFERENCE_SOURCE_TYPES,
  tempReferenceAssetIds,
  unreadReferenceImageAssets,
  validateTempReferenceFile
} from "./temp-references.js";
import { primaryVisual, primaryVisionDescription } from "./visuals.js";
import { entryMediaAssets, normalizeEntryMedia, posterAssetForVideo, primaryMediaAsset } from "./media.js";
import { buildSearchIndex } from "./search-index.js";
import { materializeLogicalCases, normalizeCompoundCases } from "./compound-cases.js";
import { bindTransientMenus } from "./transient-menu.js";
import { renderMarkdownDocument } from "./markdown-renderer.js";
import { assertImageDimensions } from "./resource-limits.js";
import { blobToDataUrl, normalizeVisionSettings } from "./vision.js";
import { CONTENT_ROLES, contentRoleForEntry } from "./taxonomy.js";
import { collectionEntryIds, collectionSelectorLabelsById } from "./organizer.js";
import { createUiIcon, setUiIcon } from "./ui-icons.js";
import {
  bindUiPreferenceReload,
  currentLocale,
  initializeUi,
  t,
  translateUiMessage
} from "./i18n.js";

await initializeUi();
bindUiPreferenceReload();
bindTransientMenus(document, ".composer-options, .composer-session-menu");

const elements = Object.fromEntries([
  "composer-shell", "composer-nav", "composer-nav-open", "composer-nav-close", "composer-new", "composer-session-list",
  "composer-title", "composer-save-state", "composer-platform", "composer-output-language", "composer-route", "composer-production-review", "composer-reference-open", "composer-reference-count",
  "composer-applied-skills", "composer-skill-menu", "composer-assembly-open", "composer-timeline", "composer-aliases", "composer-retrieval-sources", "composer-instruction", "composer-action", "composer-feedback", "composer-send-note",
  "composer-attachment-files", "composer-attachment-local", "composer-temp-reference-row", "composer-temp-references", "composer-temp-reference-save-all",
  "composer-model-trigger", "composer-model-label", "composer-model-menu", "composer-model-dynamic", "composer-model-flash", "composer-model-pro", "composer-model-openai", "composer-model-openai-label", "composer-model-compatible", "composer-model-compatible-label", "composer-model-xai", "composer-model-xai-label", "composer-thinking", "composer-create-image", "composer-create-media-label", "composer-create-image-note", "composer-generation-settings", "composer-generation-settings-title", "composer-image-size-field", "composer-image-size", "composer-image-quality-field", "composer-image-quality", "composer-image-reference-mode-field", "composer-image-reference-mode", "composer-video-duration-field", "composer-video-duration", "composer-generation-parameter-note",
  "composer-diagnostic-export", "composer-reference-workspace", "composer-reference-close", "composer-reference-cancel", "composer-reference-tab-cases", "composer-reference-tab-skills", "composer-project-list", "composer-projects-panel", "composer-case-picker", "composer-reference-footer", "composer-workspace-title", "composer-workspace-description",
  "composer-case-selection-count", "composer-reference-search", "composer-reference-project-filter", "composer-case-list", "composer-selection-strip",
  "composer-reference-clear", "composer-reference-apply", "composer-reference-feedback", "composer-assembly-dialog", "composer-assembly-close", "composer-assembly-content",
  "composer-image-blocker", "composer-image-blocker-description", "composer-image-blocker-choose-service", "composer-image-blocker-analyze", "composer-image-blocker-cancel"
].map((id) => [camel(id), document.querySelector(`#${id}`)]));

let entries = [];
let physicalEntries = [];
let compoundCases = [];
let organizerState = { collections: [] };
let creativeSkills = normalizeCreativeSkillsState();
let facetCatalog = { facets: [], nodes: [] };
let composerSettings = normalizeComposerSettings();
let composerAiSettings = normalizeAiSettings();
let composerVisionSettings = normalizeVisionSettings();
let composerAiTaskAssignments = {};
let composerAiRuntimeProtocolVersion = null;
let sessionSummaries = [];
let creativeRuns = [];
let creativeJobs = { version: 1, items: [] };
let lastCreativeJob = null;
let creativeExperimentSettings = { enabled: false, autoAnalyze: false };
let composerSearchIndex = [];
let composerDocumentTextByEntryId = new Map();
let reuseRetrievedSourcesNextTurn = false;
let creativeStateRefreshRevision = 0;
let composerInitializationComplete = false;
let creativeStateRefreshPending = false;
let initialProjectFilterId = "";

const imageWorkspace = createComposerImageWorkspace({
  translate: t,
  loadBlob: getScreenshotBlob,
  onSave: (item) => saveCreativeOutput(item.run.id, item.output.visual.id),
  onUseAsReference: (item) => useCreativeOutputAsReference(item.run, item.output),
  onReroll: (item) => rerollCreativeOutput(item.run, item.output),
  onEdit: (request) => editCreativeOutput(request.item.run, request.item.output, request),
  onDelete: (item) => deleteCreativeOutput(item.run.id, item.output.visual.id)
});
let composerSession = null;
let activeOperation = null;
const composerAnalysisTaskBridge = createComposerAnalysisTaskBridge({
  sendMessage: (message) => chrome.runtime.sendMessage(message)
});
let referenceDraftSelections = new Map();
let referenceDraftOrder = [];
let referencePreviewAssetIds = new Map();
let workspaceMode = "references";
let feedbackTimer = 0;
const COMPOSER_TITLE_MAX_CHARACTERS = 36;
const thumbnailUrls = new Map();
const openJudgmentIds = new Set();
const judgmentFeedbackById = new Map();
const imageObserver = new IntersectionObserver((items) => {
  for (const item of items) {
    if (!item.isIntersecting) continue;
    imageObserver.unobserve(item.target);
    hydrateCaseImage(item.target);
  }
}, { rootMargin: "240px" });

bindEvents();
try {
  await initializeComposer();
  composerInitializationComplete = true;
  if (creativeStateRefreshPending) {
    creativeStateRefreshPending = false;
    await refreshCreativeResultState();
  }
} catch (error) {
  composerInitializationComplete = true;
  composerFeedback(error.message || t("无法读取创作资料"), true);
}

function bindEvents() {
  elements.composerAttachmentFiles.accept = TEMP_REFERENCE_FILE_ACCEPT;
  elements.composerNew.addEventListener("click", safely(() => createNewSession()));
  elements.composerAction.addEventListener("click", safely(handleComposerAction));
  elements.composerModelTrigger.addEventListener("click", toggleComposerModelMenu);
  elements.composerModelFlash.addEventListener("click", safely(() => updateComposerAiProfile({ serviceId: "deepseek", model: "deepseek-v4-flash" })));
  elements.composerModelPro.addEventListener("click", safely(() => updateComposerAiProfile({ serviceId: "deepseek", model: "deepseek-v4-pro" })));
  elements.composerModelOpenai.addEventListener("click", safely(() => updateComposerAiProfile({ serviceId: "openai", model: composerVisionSettings.openai.model, thinking: false })));
  elements.composerModelCompatible.addEventListener("click", safely(() => updateComposerAiProfile({ serviceId: "compatible", model: composerVisionSettings.compatible.model, thinking: false })));
  elements.composerModelXai.addEventListener("click", safely(() => updateComposerAiProfile({ serviceId: "xai", model: composerVisionSettings.xai?.textModel, thinking: false })));
  elements.composerThinking.addEventListener("change", safely(() => updateComposerAiProfile({ thinking: elements.composerThinking.checked })));
  elements.composerCreateImage.addEventListener("change", safely(updateComposerOutputMode));
  elements.composerImageSize.addEventListener("change", safely(updateImageGenerationParameters));
  elements.composerImageQuality.addEventListener("change", safely(updateImageGenerationParameters));
  elements.composerImageReferenceMode.addEventListener("change", safely(updateImageReferenceMode));
  elements.composerVideoDuration.addEventListener("change", safely(updateImageGenerationParameters));
  elements.composerDiagnosticExport.addEventListener("click", safely(exportComposerDiagnostic));
  elements.composerAttachmentLocal.addEventListener("click", () => elements.composerAttachmentFiles.click());
  elements.composerAttachmentFiles.addEventListener("change", safely(async () => {
    const files = Array.from(elements.composerAttachmentFiles.files ?? []);
    elements.composerAttachmentFiles.value = "";
    await addTempReferences(files);
  }));
  elements.composerTempReferenceSaveAll.addEventListener("click", safely(saveAllTempReferences));
  elements.composerInstruction.addEventListener("input", () => {
    resizeComposerInput();
    renderSlashSkillMenu();
    renderSendState();
  });
  elements.composerInstruction.addEventListener("keydown", (event) => {
    if (!elements.composerSkillMenu.hidden && ["ArrowDown", "ArrowUp", "Enter", "Escape"].includes(event.key)) {
      if (handleSkillMenuKey(event)) return;
    }
    if (event.key !== "Enter" || event.shiftKey || event.isComposing) return;
    event.preventDefault();
    safely(handleComposerAction)();
  });
  elements.composerInstruction.addEventListener("paste", (event) => {
    const files = composerPasteFiles(event.clipboardData);
    if (!files.length) return;
    event.preventDefault();
    const normalized = files.map((file) => namePastedTempReferenceFile(file, `pasted-${crypto.randomUUID()}`));
    safely(() => addTempReferences(normalized))();
  });
  const inputBox = elements.composerInstruction.closest(".composer-input-box");
  inputBox.addEventListener("dragover", (event) => {
    if (!Array.from(event.dataTransfer?.types ?? []).includes("Files")) return;
    event.preventDefault();
    inputBox.classList.add("drag-active");
  });
  inputBox.addEventListener("dragleave", () => inputBox.classList.remove("drag-active"));
  inputBox.addEventListener("drop", (event) => {
    inputBox.classList.remove("drag-active");
    const files = composerPasteFiles(event.dataTransfer);
    if (!files.length) return;
    event.preventDefault();
    safely(() => addTempReferences(files))();
  });
  elements.composerPlatform.addEventListener("change", safely(updateComposerPreferences));
  elements.composerOutputLanguage.addEventListener("change", safely(updateComposerPreferences));
  elements.composerRoute.addEventListener("change", safely(updateComposerPreferences));
  elements.composerProductionReview.addEventListener("change", safely(updateComposerPreferences));
  document.querySelectorAll('input[name="composer-type"]').forEach((input) => input.addEventListener("change", safely(updateComposerPreferences)));
  elements.composerReferenceOpen.addEventListener("click", openReferenceWorkspace);
  elements.composerReferenceTabCases.addEventListener("click", () => setReferenceWorkspaceMode("references"));
  elements.composerReferenceTabSkills.addEventListener("click", () => setReferenceWorkspaceMode("skills"));
  elements.composerAssemblyOpen.addEventListener("click", openAssemblyDialog);
  elements.composerAssemblyClose.addEventListener("click", () => elements.composerAssemblyDialog.close());
  elements.composerImageBlockerChooseService.addEventListener("click", () => {
    elements.composerImageBlocker.close();
    openComposerModelMenu();
  });
  elements.composerImageBlockerAnalyze.addEventListener("click", safely(handleBlockedReferenceAnalysisAction));
  elements.composerImageBlocker.addEventListener("close", safely(detachBlockedReferenceAnalysis));
  elements.composerReferenceClose.addEventListener("click", closeReferenceWorkspace);
  elements.composerReferenceCancel.addEventListener("click", closeReferenceWorkspace);
  elements.composerReferenceSearch.addEventListener("input", renderCasePicker);
  document.addEventListener("visibilitychange", () => {
    document.body.classList.toggle("composer-page-paused", document.hidden);
    if (!document.hidden && composerAnalysisTaskBridge.snapshot().attached) safely(refreshBlockedReferenceAnalysis)();
  });
  elements.composerReferenceProjectFilter.addEventListener("change", renderCasePicker);
  elements.composerReferenceClear.addEventListener("click", () => {
    referenceDraftSelections.clear();
    referenceDraftOrder = [];
    syncRenderedReferenceCards();
    renderReferenceSelection();
  });
  elements.composerReferenceApply.addEventListener("click", safely(applySelectedReferences));
  elements.composerNavOpen.addEventListener("click", () => elements.composerShell.classList.add("nav-open"));
  elements.composerNavClose.addEventListener("click", () => elements.composerShell.classList.remove("nav-open"));
  document.addEventListener("click", (event) => {
    if (!elements.composerModelMenu.hidden && !event.target.closest(".composer-model-control")) closeComposerModelMenu();
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") closeComposerModelMenu();
  });
  addEventListener("beforeunload", () => {
    composerAnalysisTaskBridge.detach().catch(() => undefined);
    for (const url of thumbnailUrls.values()) URL.revokeObjectURL(url);
  });
  chrome.runtime.onMessage.addListener((message) => {
    if (message?.type !== "ANALYSIS_TASK_UPDATED") return;
    safely(() => acceptBlockedReferenceAnalysisUpdate(message))();
  });
  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== "local") return;
    if (changes.aiProviderRegistry || changes.aiTaskAssignments || changes.aiPreferences) safely(refreshComposerServiceSettings)();
    if (changes.creativeRuns || changes.creativeJobs || changes.composerSessions || changes.entries || changes.compoundCases || changes.creativeExperimentSettings || changes.creativeSkills) {
      if (!composerInitializationComplete) creativeStateRefreshPending = true;
      else safely(refreshCreativeResultState)();
    }
  });
}

async function refreshCreativeResultState() {
  const revision = ++creativeStateRefreshRevision;
  const response = await chrome.runtime.sendMessage({ type: "GET_STATE" });
  if (!response?.ok || revision !== creativeStateRefreshRevision) return;
  const nextPhysicalEntries = response.entries ?? physicalEntries;
  const nextCompoundCases = normalizeCompoundCases(response.compoundCases ?? compoundCases, nextPhysicalEntries);
  const nextEntries = materializeLogicalCases(nextPhysicalEntries, nextCompoundCases);
  creativeRuns = response.creativeRuns ?? creativeRuns;
  creativeJobs = response.creativeJobs ?? creativeJobs;
  creativeExperimentSettings = response.creativeExperimentSettings ?? creativeExperimentSettings;
  creativeSkills = normalizeCreativeSkillsState(response.creativeSkills);
  if (!await syncCreativeJobState(revision)) return;
  renderActiveState();
  renderSlashSkillMenu();

  const searchState = await createComposerSearchState(nextEntries);
  if (revision !== creativeStateRefreshRevision) return;
  physicalEntries = nextPhysicalEntries;
  compoundCases = nextCompoundCases;
  entries = nextEntries;
  composerDocumentTextByEntryId = searchState.documentTextByEntryId;
  composerSearchIndex = searchState.searchIndex;
}

async function syncCreativeJobState(expectedRevision = null) {
  const current = () => expectedRevision === null || expectedRevision === creativeStateRefreshRevision;
  const items = Array.isArray(creativeJobs?.items) ? creativeJobs.items : [];
  const active = items.find((item) => ["queued", "running"].includes(item.status)) ?? null;
  lastCreativeJob = composerSession
    ? [...items].reverse().find((item) => item.sessionId === composerSession.id) ?? null
    : items.at(-1) ?? null;
  if (active) {
    if (!composerSession || composerSession.id === active.sessionId) {
      const response = await chrome.runtime.sendMessage({ type: "GET_COMPOSER_SESSION", sessionId: active.sessionId });
      if (!current()) return false;
      if (!composerSession || composerSession.id === active.sessionId) {
        composerSession = response?.ok ? response.session : active.request.session;
      }
    }
    activeOperation = {
      kind: "compose",
      durable: true,
      jobId: active.id,
      sessionId: active.sessionId,
      phase: active.phase === "planning" ? "planning" : "streaming",
      requestPhase: active.phase,
      executionRoute: active.request.session.currentRoute || "compose",
      userMessageId: active.userMessageId,
      session: composerSession?.id === active.sessionId ? composerSession : active.request.session,
      streamingText: ""
    };
    return true;
  }
  if (activeOperation?.durable) activeOperation = null;
  if (!lastCreativeJob || lastCreativeJob.sessionId !== composerSession?.id) return current();
  const response = await chrome.runtime.sendMessage({ type: "GET_COMPOSER_SESSION", sessionId: composerSession.id });
  if (!current()) return false;
  if (response?.ok) composerSession = response.session;
  if (["failed", "canceled", "interrupted"].includes(lastCreativeJob.status) && lastCreativeJob.error?.message) {
    composerFeedback(lastCreativeJob.error.message, true);
  }
  return true;
}

async function initializeComposer() {
  const response = await chrome.runtime.sendMessage({ type: "GET_STATE" });
  if (!response?.ok) throw new Error(response?.message || "无法读取创作资料");
  ({ ai: composerAiSettings, vision: composerVisionSettings } = await privateComposerServiceSettings());
  physicalEntries = response.entries ?? [];
  compoundCases = normalizeCompoundCases(response.compoundCases, physicalEntries);
  entries = materializeLogicalCases(physicalEntries, compoundCases);
  organizerState = response.organizerState ?? { collections: [] };
  facetCatalog = response.facetCatalog ?? facetCatalog;
  await rebuildComposerSearchIndex();
  composerSettings = normalizeComposerSettings(response.composerSettings);
  sessionSummaries = response.composerSessionSummaries ?? [];
  creativeRuns = Array.isArray(response.creativeRuns) ? response.creativeRuns : [];
  creativeJobs = response.creativeJobs ?? creativeJobs;
  creativeExperimentSettings = response.creativeExperimentSettings ?? creativeExperimentSettings;
  creativeSkills = normalizeCreativeSkillsState(response.creativeSkills);
  elements.composerDiagnosticExport.hidden = response.uiPreferences?.analysisDiagnostics !== true;

  const params = new URLSearchParams(location.search);
  const requestedProjectId = params.get("project");
  if ((organizerState.collections ?? []).some((item) => item.id === requestedProjectId)) {
    initialProjectFilterId = requestedProjectId;
  }
  const sessionId = params.get("session");
  const requestedSkillId = params.get("skill");
  const requestedType = ["image", "video"].includes(params.get("type")) ? params.get("type") : "";
  if (!sessionId && requestedType) {
    document.querySelectorAll('input[name="composer-type"]').forEach((input) => { input.checked = input.value === requestedType; });
  }
  if (sessionId) {
    const existing = await chrome.runtime.sendMessage({ type: "GET_COMPOSER_SESSION", sessionId });
    if (existing?.ok) composerSession = existing.session;
  }
  await syncCreativeJobState();
  if (!composerSession) {
    const requestedIds = uniqueIds((params.get("references") ?? "").split(","));
    const requestedAssetId = String(params.get("asset") ?? "").trim();
    const requestedSelections = requestedAssetId && requestedIds.length === 1
      ? [{ entryId: requestedIds[0], assetIds: [requestedAssetId] }]
      : requestedIds.map((entryId) => {
          const entry = entries.find((item) => item.id === entryId);
          const assets = selectableReferenceImages(entry);
          const primary = assets.find((asset) => asset.id === entry?.primaryMediaId) ?? assets[0];
          return { entryId, assetIds: primary ? [primary.id] : [] };
        });
    await createNewSession(requestedSelections, false);
  } else renderComposer();
  if (!sessionId && requestedSkillId) {
    const requestedSkill = creativeSkills.items.find((item) => item.id === requestedSkillId);
    if (requestedSkill) await applyCreativeSkill(requestedSkill);
    else composerFeedback("没有找到这份创作 Skill", true);
  }
  renderSlashSkillMenu();
}

async function createNewSession(referenceIds = [], focus = true) {
  const targetType = selectedTargetType();
  reuseRetrievedSourcesNextTurn = false;
  composerSession = createComposerSession({
    title: targetType === "video" ? t("未命名视频提示词") : t("未命名图片提示词"),
    targetType,
    targetPlatform: composerSettings.lastTargetPlatform,
    outputLanguage: composerSettings.outputLanguage,
    routeMode: "auto",
    aiProfile: composerProfileForAssignment(composerAiTaskAssignments.creativePlanning, composerSettings.lastAiProfile),
    generationAiProfile: composerProfileForAssignment(
      composerAiTaskAssignments[targetType === "video" ? "videoGeneration" : "imageGeneration"],
      composerSettings.lastAiProfile
    ),
    productionReviewEnabled: composerSettings.productionReviewEnabled,
    referenceSnapshots: createReferenceSnapshots(entries, referenceIds, currentLocale(), targetType)
  });
  if (isMeaningfulComposerSession(composerSession)) {
    composerSession = await saveSession(composerSession);
    replaceComposerSessionUrl(composerSession.id);
  } else history.replaceState(null, "", "composer.html");
  renderComposer();
  if (focus) elements.composerInstruction.focus();
}

function renderComposer() {
  if (!composerSession) return;
  document.querySelectorAll('input[name="composer-type"]').forEach((input) => {
    input.checked = input.value === composerSession.targetType;
  });
  elements.composerTitle.textContent = composerSession.title;
  elements.composerPlatform.value = composerSession.targetPlatform;
  elements.composerOutputLanguage.value = composerSession.outputLanguage;
  elements.composerRoute.value = composerSession.routeMode;
  elements.composerProductionReview.checked = composerSession.productionReviewEnabled;
  elements.composerProductionReview.disabled = !["auto", "compose"].includes(composerSession.routeMode);
  renderComposerAiProfile();
  const libraryReferences = composerSession.referenceSnapshots.filter((reference) => reference.sourceType !== TEMP_REFERENCE_SOURCE_TYPES.temporary);
  elements.composerReferenceCount.textContent = String(libraryReferences.length);
  elements.composerAliases.replaceChildren(...libraryReferences.map(referenceAliasButton));
  elements.composerAliases.hidden = libraryReferences.length === 0;
  renderTempReferences();
  renderRetrievedSources();
  renderAppliedSkills();
  renderSessions();
  renderTimeline();
  renderSendState();
  renderComposerSaveState();
  resizeComposerInput();
}

function renderTempReferences() {
  const references = (composerSession?.referenceSnapshots ?? [])
    .filter((reference) => reference.sourceType === TEMP_REFERENCE_SOURCE_TYPES.temporary);
  elements.composerTempReferenceRow.hidden = references.length === 0;
  elements.composerTempReferenceSaveAll.disabled = Boolean(activeOperation) || references.length === 0;
  elements.composerTempReferences.replaceChildren(...references.map(tempReferenceCard));
}

function tempReferenceCard(reference) {
  const asset = reference.assetRefs[0];
  const card = el("article", "composer-temp-reference-card");
  const insert = el("button", "composer-temp-reference-main");
  insert.type = "button";
  insert.title = `${reference.alias} ${reference.title}`;
  insert.addEventListener("click", () => insertComposerAlias(reference.alias));
  const preview = el("span", "composer-temp-reference-preview");
  if (asset?.kind === "image") {
    const image = document.createElement("img");
    image.alt = "";
    preview.append(image);
    safely(() => hydrateTempReferenceImage(image, asset.assetId))();
  } else {
    preview.append(rawTextEl("span", "", tempReferenceTypeLabel(asset)));
  }
  const copy = el("span", "composer-temp-reference-copy");
  copy.append(rawTextEl("small", "", reference.alias), rawTextEl("strong", "", reference.title || t("未命名文件")));
  insert.append(preview, copy);
  const actions = el("span", "composer-temp-reference-actions");
  const save = el("button", "icon-button");
  save.type = "button";
  save.disabled = Boolean(activeOperation);
  save.title = t("保存到案例库");
  save.setAttribute("aria-label", `保存到案例库：${reference.title}`);
  save.append(createUiIcon("save"));
  save.addEventListener("click", () => safely(() => saveTempReferenceAsCase(reference.entryId))());
  const remove = el("button", "icon-button");
  remove.type = "button";
  remove.disabled = Boolean(activeOperation);
  remove.title = t("移除临时附件");
  remove.setAttribute("aria-label", `移除临时附件：${reference.title}`);
  remove.append(createUiIcon("x"));
  remove.addEventListener("click", () => safely(() => removeTempReference(reference.entryId))());
  actions.append(save, remove);
  card.append(insert, actions);
  return card;
}

async function hydrateTempReferenceImage(image, assetId) {
  const cached = thumbnailUrls.get(assetId);
  if (cached) {
    image.src = cached;
    return;
  }
  const [blob, derived] = await Promise.all([getMediaBlob(assetId), getDerivedMedia(assetId)]);
  if (!(blob instanceof Blob) || !image.isConnected) return;
  const displayBlob = blob.type === "image/gif" && derived?.thumbnail instanceof Blob ? derived.thumbnail : blob;
  const url = URL.createObjectURL(displayBlob);
  thumbnailUrls.set(assetId, url);
  image.src = url;
}

function tempReferenceTypeLabel(asset) {
  const type = String(asset?.mimeType ?? "").toLocaleLowerCase("en-US");
  if (type === "application/pdf") return "PDF";
  if (type === "text/markdown") return "MD";
  if (type === "text/html") return "HTML";
  return "TXT";
}

async function addTempReferences(filesValue) {
  if (!composerSession) return;
  if (activeOperation) throw new Error("生成期间不能添加临时附件");
  const files = Array.from(filesValue ?? []);
  if (!files.length) return;
  files.forEach(validateTempReferenceFile);
  const prepared = await Promise.all(files.map(async (file, index) => {
    const referenceId = `temp-reference:${crypto.randomUUID()}`;
    const assetId = `temp-reference-asset:${crypto.randomUUID()}`;
    const aliasIndex = composerSession.referenceSnapshots.length + index + 1;
    const alias = currentLocale() === "en" ? `@Reference${aliasIndex}` : `@参考${aliasIndex}`;
    const preparedFile = await prepareLocalMedia(file, assetId, {
      allowVideo: false,
      relativePath: file.name,
      extractPdfText: extractPdfSearchText
    });
    return {
      preparedFile,
      reference: createTempReference({ file, assetId, referenceId, alias, extractedText: preparedFile.contentText })
    };
  }));
  const savedAssetIds = [];
  try {
    for (const item of prepared) {
      const [assetId] = tempReferenceAssetIds(item.reference);
      await saveMediaBlob(assetId, item.preparedFile.blob);
      savedAssetIds.push(assetId);
      const thumbnail = item.preparedFile.poster?.blob instanceof Blob ? item.preparedFile.poster.blob : undefined;
      const searchText = String(item.preparedFile.contentText ?? "").trim();
      if (thumbnail || searchText) {
        await saveDerivedMedia(assetId, { ...(thumbnail ? { thumbnail } : {}), ...(searchText ? { searchText } : {}) });
      }
    }
    const response = await chrome.runtime.sendMessage({
      type: "ADD_TEMP_REFERENCES",
      sessionId: composerSession.id,
      session: composerSession,
      tempReferences: prepared.map((item) => item.reference)
    });
    applyTempReferenceResponse(response, "无法添加临时附件");
    replaceComposerSessionUrl(composerSession.id);
    renderComposer();
    composerFeedback(`已添加 ${prepared.length} 个临时附件`);
  } catch (error) {
    await deleteMediaBlobs(savedAssetIds).catch(() => undefined);
    throw error;
  }
}

async function removeTempReference(tempReferenceId) {
  if (!composerSession || activeOperation) return;
  const response = await chrome.runtime.sendMessage({
    type: "REMOVE_TEMP_REFERENCE",
    sessionId: composerSession.id,
    tempReferenceId
  });
  applyTempReferenceResponse(response, "无法移除临时附件");
  renderComposer();
}

async function saveTempReferenceAsCase(tempReferenceId) {
  if (!composerSession || activeOperation) return;
  const response = await chrome.runtime.sendMessage({
    type: "SAVE_TEMP_REFERENCE_AS_CASE",
    sessionId: composerSession.id,
    tempReferenceId
  });
  applyTempReferenceResponse(response, "无法保存临时附件");
  renderComposer();
  composerFeedback(response.message || "已保存到案例库");
}

async function saveAllTempReferences() {
  const references = (composerSession?.referenceSnapshots ?? [])
    .filter((reference) => reference.sourceType === TEMP_REFERENCE_SOURCE_TYPES.temporary);
  if (!references.length || activeOperation) return;
  elements.composerTempReferenceSaveAll.disabled = true;
  try {
    for (const reference of references) await saveTempReferenceAsCase(reference.entryId);
    composerFeedback(`已保存 ${references.length} 个附件到案例库`);
  } finally {
    elements.composerTempReferenceSaveAll.disabled = false;
  }
}

function applyTempReferenceResponse(response, fallbackMessage) {
  if (!response?.ok || !response.session) throw new Error(response?.message || fallbackMessage);
  composerSession = createComposerSession(response.session);
  sessionSummaries = response.summaries ?? sessionSummaries;
}

function renderAppliedSkills() {
  const skills = composerSession?.appliedSkills ?? [];
  elements.composerAppliedSkills.hidden = skills.length === 0;
  elements.composerAppliedSkills.replaceChildren(...skills.map((skill, index) => {
    const chip = el("span", "composer-skill-chip");
    chip.append(rawTextEl("strong", "", `/${skill.callName}`));
    const up = rawTextEl("button", "", "↑");
    up.type = "button";
    up.title = t("提高 Skill 优先级");
    up.disabled = index === 0;
    up.addEventListener("click", () => safely(() => moveAppliedSkill(skill.skillId, -1))());
    const down = rawTextEl("button", "", "↓");
    down.type = "button";
    down.title = t("降低 Skill 优先级");
    down.disabled = index === skills.length - 1;
    down.addEventListener("click", () => safely(() => moveAppliedSkill(skill.skillId, 1))());
    const remove = rawTextEl("button", "", "×");
    remove.type = "button";
    remove.title = t("移除 /{callName}", { callName: skill.callName });
    remove.addEventListener("click", () => safely(() => removeAppliedSkill(skill.skillId))());
    chip.append(up, down, remove);
    return chip;
  }));
}

async function moveAppliedSkill(skillId, direction) {
  if (!composerSession || activeOperation) return;
  composerSession = createComposerSession({
    ...composerSession,
    appliedSkills: reorderAppliedSkills(composerSession.appliedSkills, skillId, direction),
    currentInstruction: "",
    retrievedSources: [],
    currentRoute: "",
    currentRouteSource: ""
  });
  composerSession = await saveSession(composerSession);
  renderComposer();
}

function slashSkillQuery() {
  const input = elements.composerInstruction;
  const before = input.value.slice(0, input.selectionStart);
  const match = before.match(/(?:^|\s)\/([^\s/]*)$/u);
  return match ? { query: match[1], start: input.selectionStart - match[1].length - 1, end: input.selectionStart } : null;
}

function renderSlashSkillMenu() {
  const query = slashSkillQuery();
  if (!query) {
    elements.composerSkillMenu.hidden = true;
    return;
  }
  const applied = new Set(composerSession?.appliedSkills.map((item) => item.skillId) ?? []);
  const matches = findCreativeSkillsBySlashQuery(creativeSkills, query.query).filter((skill) => !applied.has(skill.id)).slice(0, 8);
  if (!matches.length) {
    elements.composerSkillMenu.hidden = true;
    return;
  }
  elements.composerSkillMenu.replaceChildren(...matches.map((skill, index) => {
    const button = el("button");
    button.type = "button";
    button.role = "option";
    button.dataset.skillId = skill.id;
    button.setAttribute("aria-selected", String(index === 0));
    const copy = el("span");
    copy.append(rawTextEl("strong", "", `/${skill.callName}`), rawTextEl("small", "", skill.description || t("创作 Skill")));
    button.append(copy, rawTextEl("small", "", `v${skill.versions.findIndex((item) => item.id === skill.currentVersionId) + 1}`));
    button.addEventListener("mousedown", (event) => event.preventDefault());
    button.addEventListener("click", () => safely(() => selectSlashSkill(skill))());
    return button;
  }));
  elements.composerSkillMenu.hidden = false;
}

function handleSkillMenuKey(event) {
  if (event.key === "Escape") {
    event.preventDefault();
    elements.composerSkillMenu.hidden = true;
    return true;
  }
  const options = [...elements.composerSkillMenu.querySelectorAll("button")];
  if (!options.length) return false;
  const current = Math.max(0, options.findIndex((item) => item.getAttribute("aria-selected") === "true"));
  if (event.key === "ArrowDown" || event.key === "ArrowUp") {
    event.preventDefault();
    const next = (current + (event.key === "ArrowDown" ? 1 : -1) + options.length) % options.length;
    options.forEach((item, index) => item.setAttribute("aria-selected", String(index === next)));
    options[next].scrollIntoView({ block: "nearest" });
    return true;
  }
  if (event.key === "Enter") {
    event.preventDefault();
    const skill = creativeSkills.items.find((item) => item.id === options[current].dataset.skillId);
    if (skill) safely(() => selectSlashSkill(skill))();
    return true;
  }
  return false;
}

async function selectSlashSkill(skill) {
  const query = slashSkillQuery();
  if (query) {
    const input = elements.composerInstruction;
    input.value = `${input.value.slice(0, query.start)}${input.value.slice(query.end)}`.replace(/\s{2,}/g, " ");
    input.setSelectionRange(query.start, query.start);
  }
  elements.composerSkillMenu.hidden = true;
  await applyCreativeSkill(skill);
  elements.composerInstruction.focus();
}

function renderSessions() {
  const summaries = new Map(sessionSummaries.map((summary) => [summary.id, summary]));
  const current = sessionSummaryFromCurrent();
  if (current) summaries.set(current.id, current);
  const ordered = [...summaries.values()].sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
  const groups = [
    { id: "today", label: "今天", items: [] },
    { id: "yesterday", label: "昨天", items: [] },
    { id: "recent", label: "近 7 天", items: [] },
    { id: "older", label: "更早", items: [] }
  ];
  const byId = new Map(groups.map((group) => [group.id, group]));
  for (const summary of ordered) byId.get(sessionDateGroup(summary.updatedAt)).items.push(summary);
  elements.composerSessionList.replaceChildren(...groups.filter((group) => group.items.length).map((group) => {
    const section = el("section", "composer-session-group");
    section.dataset.sessionGroup = group.id;
    section.append(rawTextEl("h3", "composer-session-group-label", t(group.label)));
    const list = el("div", "composer-session-group-list");
    list.append(...group.items.map(renderSessionRow));
    section.append(list);
    return section;
  }));
}

function renderSessionRow(summary) {
    const row = el("div", "composer-session-item");
    row.dataset.sessionId = summary.id;
    row.setAttribute("aria-current", String(summary.id === composerSession?.id));
    const load = document.createElement("button");
    load.type = "button";
    load.className = "ui-content-row";
    const running = activeOperation?.kind === "compose" && activeOperation.sessionId === summary.id;
    load.append(rawTextEl("strong", "", summary.title));
    if (running) load.append(rawTextEl("small", "composer-session-running", operationLabel(activeOperation.phase)));
    load.addEventListener("click", safely(() => loadComposerSession(summary.id)));
    const menu = el("details", "composer-session-menu");
    const trigger = rawTextEl("summary", "", "…");
    trigger.setAttribute("aria-label", t("更多操作：{title}", { title: summary.title }));
    const panel = el("div", "composer-session-menu-panel");
    panel.setAttribute("role", "menu");
    const remove = rawTextEl("button", "composer-session-delete quiet-danger", t("删除"));
    remove.type = "button";
    remove.disabled = running;
    remove.setAttribute("role", "menuitem");
    remove.addEventListener("click", (event) => {
      event.stopPropagation();
      menu.open = false;
      safely(() => deleteSession(summary.id))();
    });
    panel.append(remove);
    menu.append(trigger, panel);
    row.append(load, menu);
    return row;
}

function sessionDateGroup(value, now = new Date()) {
  const updatedAt = new Date(value);
  if (Number.isNaN(updatedAt.getTime())) return "older";
  const localDay = (date) => Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) / 86_400_000;
  const elapsedDays = localDay(now) - localDay(updatedAt);
  if (elapsedDays <= 0) return "today";
  if (elapsedDays === 1) return "yesterday";
  return elapsedDays <= 6 ? "recent" : "older";
}

function renderTimeline() {
  if (!composerSession) return;
  const session = displayedComposerSession();
  const inner = el("div", "composer-chat-inner");
  const streamingText = currentStreamingText();
  const operation = currentComposerOperation();
  if (!session.messages.length && !streamingText && !operation && !session.lastFailure) inner.append(createWelcome());
  let promptIndex = 0;
  for (const message of session.messages) {
    const version = message.type === "prompt" ? session.promptVersions[promptIndex++] : null;
    inner.append(createMessage(message, version, false, session));
  }
  if (streamingText) {
    const route = operation?.session?.currentRoute || "compose";
    const type = route === "compose" ? "prompt" : route === "analyze_materials" ? "analysis" : "chat";
    inner.append(createMessage({ role: "assistant", type, route, content: streamingText }, null, true, session));
  } else if (operation) {
    inner.append(createMessage({ role: "assistant", type: "status", content: operationLabel(operation.phase) }, null, false, session));
  } else if (session.lastFailure) {
    inner.append(createFailureMessage(session.lastFailure));
  }
  elements.composerTimeline.replaceChildren(inner);
  releaseUnusedCreativeOutputUrls();
  requestAnimationFrame(() => { elements.composerTimeline.scrollTop = elements.composerTimeline.scrollHeight; });
}

function releaseUnusedCreativeOutputUrls() {
  const retained = new Set(creativeRuns
    .filter((run) => run.sessionId === composerSession?.id)
    .flatMap((run) => run.outputs.flatMap((output) => [
      `creative:${output.visual.id}`,
      `creative-poster:${output.visual.id}`
    ])));
  for (const [key, url] of thumbnailUrls) {
    if (!key.startsWith("creative:") && !key.startsWith("creative-poster:")) continue;
    if (retained.has(key)) continue;
    URL.revokeObjectURL(url);
    thumbnailUrls.delete(key);
  }
}

function createWelcome() {
  const wrap = el("section", "composer-welcome");
  const body = el("div", "");
  const image = document.createElement("img");
  image.src = "assets/icons/icon-128.png";
  image.alt = "";
  body.append(
    image,
    rawTextEl("h1", "", currentLocale() === "en" ? "What do you want to create?" : "你想创作什么画面？"),
    rawTextEl("p", "", currentLocale() === "en"
      ? "Start with the default method, or add creative Skills and selected references when useful."
      : "可以直接使用默认创作方法，也可以按需应用创作 Skill 或加入私人案例。")
  );
  const suggestions = el("div", "composer-welcome-suggestions");
  const values = composerSession.targetType === "video"
    ? ["写一个15秒情绪递进的电影感视频提示词", "把一个画面发展成连续一镜到底"]
    : ["写一个具有明确叙事瞬间的电影感画面", "把普通人物照片重构成有导演感的场景"];
  for (const value of values) {
    const button = rawTextEl("button", "", t(value));
    button.type = "button";
    button.addEventListener("click", () => {
      elements.composerInstruction.value = t(value);
      resizeComposerInput();
      elements.composerInstruction.focus();
    });
    suggestions.append(button);
  }
  body.append(suggestions);
  wrap.append(body);
  return wrap;
}

function createMessage(message, version, streaming, session) {
  const article = el("article", `composer-message ${message.role} ${message.type}`);
  const content = el("div", "composer-message-content");
  if (message.role === "assistant") {
    const routeLabels = { compose: t("提示词装配"), analyze_materials: t("本地资料分析"), chat: t("普通对话") };
    const label = routeLabels[message.route] || t("创作助手");
    content.append(rawTextEl("small", "composer-message-label", label));
  }
  const messageClass = streaming ? " composer-streaming-caret" : message.type === "status" ? " composer-status-dots" : "";
  content.append(renderFinalAssistantText(message, streaming, messageClass));
  if (message.type === "question" && message.options?.length) {
    if (message.recommendedAnswer) content.append(rawTextEl("p", "composer-question-recommendation", `${t("推荐")}：${message.recommendedAnswer}`));
    const options = el("div", "composer-question-options");
    options.append(...message.options.map((option) => {
      const button = rawTextEl("button", "button-secondary", option);
      button.type = "button";
      button.disabled = Boolean(activeOperation);
      button.addEventListener("click", () => {
        elements.composerInstruction.value = option;
        safely(handleComposerAction)();
      });
      return button;
    }));
    content.append(options);
  }
  if (version) {
    const sourceSnapshot = createRetrievedSourceSnapshot(version.retrievedSources);
    if (sourceSnapshot) content.append(sourceSnapshot);
    const actions = el("div", "composer-message-actions");
    const copy = textEl("button", "button-secondary", "复制");
    const addResult = session.targetType === "image" ? textEl("button", "button-secondary", "添加生成图片") : null;
    const save = textEl("button", "button-secondary", "保存为案例");
    const checks = composerOutputChecks(session, version);
    const failures = checks.filter((check) => check.status === "failed");
    copy.disabled = failures.length > 0;
    if (addResult) addResult.disabled = failures.length > 0;
    save.disabled = failures.length > 0;
    copy.addEventListener("click", () => copyPrompt(version, copy));
    addResult?.addEventListener("click", () => prepareCreativeResult(session.id, version, addResult));
    save.addEventListener("click", () => savePromptVersion(session.id, version, save));
    actions.append(copy);
    if (addResult) actions.append(addResult);
    actions.append(save);
    content.append(actions);
    const outputCards = createCreativeOutputCards(session.id, version.id);
    if (outputCards.length) {
      const results = el("section", "composer-result-list");
      results.append(...outputCards);
      content.append(results);
    }
    if (failures.length) {
      const checkList = el("div", "composer-checks");
      for (const check of failures) checkList.append(rawTextEl("span", "composer-check failed", check.message));
      content.append(checkList);
    }
  }
  article.append(content);
  return article;
}

function renderFinalAssistantText(message, streaming, messageClass = "") {
  if (message.role !== "assistant" || streaming || !["chat", "analysis"].includes(message.type)) {
    return rawTextEl("p", `composer-message-text${messageClass}`, message.content);
  }
  const rendered = renderMarkdownDocument(message.content);
  rendered.classList.add("composer-message-text");
  return rendered;
}

function createFailureMessage(failure) {
  const article = el("article", `composer-message assistant ${failure.kind === "stopped" ? "status" : "failure"}`);
  const content = el("div", "composer-message-content");
  content.append(
    rawTextEl("small", "composer-message-label", t("创作助手")),
    rawTextEl("p", "composer-message-text", failure.message)
  );
  if (failure.retryable) {
    const actions = el("div", "composer-message-actions");
    const retry = textEl("button", "button-secondary", "重试本轮");
    retry.addEventListener("click", () => safely(retryComposerTurn)());
    actions.append(retry);
    content.append(actions);
  }
  article.append(content);
  return article;
}

async function handleComposerAction() {
  if (activeOperation?.kind === "compose" && activeOperation.sessionId === composerSession?.id) {
    await stopActiveOperation();
    return;
  }
  await sendComposerTurn();
}

async function sendComposerTurn() {
  if (!composerSession) return;
  if (activeOperation) return composerFeedback("另一项创作任务正在运行，请先等待或停止", true);
  const instruction = elements.composerInstruction.value.trim();
  if (!instruction) return composerFeedback("请先输入本轮任务", true);
  if (showImageTempReferenceBlock()) return;
  const answeringQuestion = composerSession.messages.at(-1)?.type === "question";
  const wasEmpty = composerSession.messages.length === 0 && composerSession.promptVersions.length === 0;
  let working = appendComposerMessage(clearComposerFailure(composerSession), {
    role: "user",
    type: answeringQuestion ? "answer" : "request",
    content: instruction,
    route: composerSession.routeMode === "auto" ? "" : composerSession.routeMode,
    routeSource: composerSession.routeMode === "auto" ? "auto" : "manual"
  });
  working = createComposerSession({
    ...working,
    currentInstruction: "",
    retrievedSources: reuseRetrievedSourcesNextTurn ? working.retrievedSources : [],
    currentRoute: "",
    currentRouteSource: ""
  });
  reuseRetrievedSourcesNextTurn = false;
  const userMessageId = working.messages.at(-1).id;
  if (wasEmpty) working.title = conversationTitle(instruction);
  elements.composerInstruction.value = "";
  if (["create_image", "create_video"].includes(working.outputMode)) {
    composerSession = working;
    renderComposer();
    try {
      await startPersistentCreativeJob({ session: working, userMessageId, startPhase: "planning", imageEdit: null });
    } catch (error) {
      composerSession = setComposerFailure(working, {
        userMessageId,
        phase: "saving",
        kind: "storage",
        message: error.message || t("无法启动后台创作任务"),
        retryable: true
      });
      composerSession = await saveSession(composerSession).catch(() => composerSession);
      renderComposer();
    }
    return;
  }
  const planningService = selectedComposerService(working.aiProfile, composerAiSettings, composerVisionSettings).shortLabel;
  working = appendDiagnosticEvent(working, { phase: "planning", status: "started", detail: `${planningService} 正在规划` });
  const controller = new AbortController();
  activeOperation = {
    kind: "compose",
    sessionId: working.id,
    phase: "planning",
    requestPhase: "planning",
    userMessageId,
    controller,
    session: working,
    streamingText: ""
  };
  composerSession = working;
  renderComposer();
  try {
    activeOperation.session = await saveSession(working);
    await runComposerTurn(activeOperation, "planning");
  } catch (error) {
    const operation = activeOperation;
    if (operation?.sessionId === working.id) {
      const details = composerServiceErrorDetails(error);
      composerSession = setComposerFailure(operation.session, {
        userMessageId,
        phase: "saving",
        kind: details.kind === "unknown" ? "storage" : details.kind,
        message: error.message || t("无法保存创作草稿"),
        retryable: true
      });
      activeOperation = null;
    }
    renderComposer();
  }
}

function showImageTempReferenceBlock() {
  const service = selectedComposerService(composerSession.aiProfile, composerAiSettings, composerVisionSettings);
  const block = imageTempReferenceBlock(composerSession.referenceSnapshots, service);
  if (!block.blocked) return false;
  const serviceLabel = currentImageAnalysisServiceLabel();
  elements.composerImageBlockerDescription.textContent = t("本轮有 {count} 张尚未分析的参考图片，但 {service} 只能读取文字。可切换到视觉创作服务；也可调用当前图片分析服务（{analysisService}），预计发起 {count} 次额外请求，费用由服务商按你的账号计费。", { count: block.imageCount, service: service.shortLabel, analysisService: serviceLabel });
  renderImageBlockerTaskState();
  elements.composerImageBlocker.showModal();
  return true;
}

function currentImageAnalysisServiceLabel() {
  const assignment = composerAiTaskAssignments?.imageAnalysis ?? {};
  const profiles = composerVisionSettings.providerProfiles ?? {};
  const providerId = String(assignment.providerId ?? "").trim();
  const profile = providerId ? profiles[providerId] ?? null : null;
  const assignedModel = String(assignment.model ?? "").trim();
  if (providerId) {
    const providerLabel = profile?.label
      || (providerId === "openai" ? "OpenAI" : providerId === "custom-media" ? "兼容图片服务" : providerId);
    const model = assignedModel
      || String(profile?.models?.imageAnalysis ?? "").trim()
      || (providerId === "openai" ? String(composerVisionSettings.openai?.model ?? "").trim() : "")
      || (providerId === "custom-media" ? String(composerVisionSettings.compatible?.model ?? "").trim() : "");
    return model ? `${providerLabel} · ${model}` : `${providerLabel} · 未配置模型`;
  }
  const fallbackProvider = composerVisionSettings.activeProvider === "openai"
    ? { label: "OpenAI", model: composerVisionSettings.openai?.model }
    : { label: "兼容图片服务", model: composerVisionSettings.compatible?.model };
  const fallbackModel = String(fallbackProvider.model ?? "").trim();
  return fallbackModel
    ? `${fallbackProvider.label} · ${fallbackModel}`
    : `${fallbackProvider.label} · 未配置模型`;
}

async function handleBlockedReferenceAnalysisAction() {
  const task = composerAnalysisTaskBridge.snapshot();
  if (task.attached && analysisTaskIsActive(task.status)) return stopBlockedReferenceAnalysis();
  if (task.canRetry) return retryBlockedReferenceAnalysis();
  return startBlockedReferenceAnalysis();
}

async function startBlockedReferenceAnalysis() {
  if (!composerSession) return;
  const references = composerSession.referenceSnapshots.filter((reference) =>
    unreadReferenceImageAssets(reference).length
  );
  if (!references.length) {
    elements.composerImageBlocker.close();
    return sendComposerTurn();
  }
  const imageCount = references.reduce((total, reference) => total + unreadReferenceImageAssets(reference).length, 0);
  elements.composerImageBlockerDescription.textContent = t("正在创建图片分析任务，共 {count} 张。关闭此窗口只会取消本页自动继续，不会停止后台任务。", { count: imageCount });
  const starting = composerAnalysisTaskBridge.start({
    sessionId: composerSession.id,
    tempReferenceIds: references.map((reference) => reference.entryId),
    outputLocale: composerAnalysisOutputLocale()
  });
  renderImageBlockerTaskState();
  try {
    await handleBlockedReferenceAnalysisState(await starting);
  } catch (error) {
    await composerAnalysisTaskBridge.detach().catch(() => undefined);
    renderImageBlockerTaskState();
    elements.composerImageBlockerDescription.textContent = `${error.message || "无法创建图片分析任务"}。本轮输入和附件均已保留，未自动重试。`;
  }
}

async function stopBlockedReferenceAnalysis() {
  const previous = composerAnalysisTaskBridge.snapshot();
  elements.composerImageBlockerDescription.textContent = t("正在请求停止图片分析。关闭窗口仍只会断开本页，不代表停止成功。");
  renderImageBlockerTaskState({ ...previous, status: "stop-requested" });
  try {
    const stopped = await composerAnalysisTaskBridge.stop();
    renderImageBlockerTaskState(stopped);
    elements.composerImageBlockerDescription.textContent = previous.status === "queued"
      ? t("任务已在发出服务请求前停止，本轮不会自动发送。")
      : t("已请求停止任务。本轮不会自动发送；若服务商此前已接收请求，仍可能产生费用。可关闭窗口，或明确确认后重新分析。");
  } catch (error) {
    renderImageBlockerTaskState();
    elements.composerImageBlockerDescription.textContent = `${error.message || "停止请求未确认"}。任务执行状态未知，本轮不会自动发送，也不会自动重试。`;
  }
}

async function retryBlockedReferenceAnalysis() {
  const confirmed = await confirmAppAction({
    title: t("重新发起图片分析？"),
    description: t("上一轮请求可能已经被服务商接收。重新分析会创建新的执行尝试，并可能再次计费；旧尝试的结果不会写回本轮。"),
    confirmLabel: t("确认重新分析")
  });
  if (!confirmed) return;
  elements.composerImageBlockerDescription.textContent = t("正在创建新的图片分析尝试。完成前不会发送本轮消息。");
  const retrying = composerAnalysisTaskBridge.retry({ confirmed: true });
  renderImageBlockerTaskState();
  try {
    await handleBlockedReferenceAnalysisState(await retrying);
  } catch (error) {
    await composerAnalysisTaskBridge.detach().catch(() => undefined);
    renderImageBlockerTaskState();
    elements.composerImageBlockerDescription.textContent = `${error.message || "无法重新创建图片分析任务"}。本轮输入和附件均已保留，未自动重试。`;
  }
}

async function detachBlockedReferenceAnalysis() {
  await composerAnalysisTaskBridge.detach();
}

async function refreshBlockedReferenceAnalysis() {
  if (!composerAnalysisTaskBridge.snapshot().attached) return;
  await handleBlockedReferenceAnalysisState(await composerAnalysisTaskBridge.refresh());
}

async function acceptBlockedReferenceAnalysisUpdate(message) {
  if (!composerAnalysisTaskBridge.snapshot().attached) return;
  if (!composerAnalysisTaskBridge.acceptUpdate(message)) return;
  await handleBlockedReferenceAnalysisState(composerAnalysisTaskBridge.snapshot());
}

async function handleBlockedReferenceAnalysisState(task) {
  if (!task.attached) return;
  renderImageBlockerTaskState(task);
  if (task.status === "completed") {
    const result = composerAnalysisTaskBridge.consumeCompletion();
    if (!result) return;
    applyTempReferenceResponse(result, "临时图片分析失败");
    renderComposer();
    elements.composerImageBlocker.close();
    composerFeedback(t("图片分析已完成，正在继续本轮创作"));
    await sendComposerTurn();
    return;
  }
  if (task.executionState === "execution_state_unknown") {
    elements.composerImageBlockerDescription.textContent = t("浏览器后台曾中断，上一轮是否执行完成无法确认。系统不会自动重试或发送本轮；如要重试，请明确确认，新的尝试可能再次计费。");
    return;
  }
  if (task.status === "failed") {
    elements.composerImageBlockerDescription.textContent = t("图片分析未完成。本轮输入和附件均已保留，系统不会自动重试或发送；可确认后重新分析。");
    return;
  }
  if (task.status === "stopped") {
    elements.composerImageBlockerDescription.textContent = t("图片分析已停止，本轮不会自动发送。可关闭窗口，或明确确认后重新分析。");
    return;
  }
  if (task.status === "queued") {
    elements.composerImageBlockerDescription.textContent = t("图片分析正在等待执行，尚未开始服务请求。关闭窗口只会取消本页自动继续；点击“停止分析”才会请求停止任务。");
    return;
  }
  if (["running", "stop-requested"].includes(task.status)) {
    elements.composerImageBlockerDescription.textContent = task.status === "stop-requested"
      ? t("正在请求停止图片分析。本轮不会自动发送。")
      : t("图片分析正在执行。关闭窗口只会取消本页自动继续；点击“停止分析”才会请求停止任务。服务商已接收的请求仍可能计费。");
  }
}

function renderImageBlockerTaskState(task = composerAnalysisTaskBridge.snapshot()) {
  const active = task.attached && analysisTaskIsActive(task.status);
  elements.composerImageBlockerChooseService.disabled = active;
  elements.composerImageBlockerAnalyze.disabled = task.status === "stop-requested";
  elements.composerImageBlockerAnalyze.textContent = active
    ? t("停止分析")
    : task.canRetry ? t("重新分析") : t("调用图片分析并继续");
}

function analysisTaskIsActive(status) {
  return ["starting", "queued", "running", "stop-requested"].includes(status);
}

function composerAnalysisOutputLocale() {
  return elements.composerOutputLanguage.value === "en"
    ? "en"
    : elements.composerOutputLanguage.value === "zh-CN" ? "zh-CN" : currentLocale() === "en" ? "en" : "zh-CN";
}

async function retryComposerTurn() {
  if (!composerSession || activeOperation) return;
  if (lastCreativeJob?.sessionId === composerSession.id &&
      ["failed", "canceled", "interrupted"].includes(lastCreativeJob.status) &&
      lastCreativeJob.error?.retryable) {
    if (!await confirmAppAction({ title: t("重新发起付费请求？"), description: t("上一次请求可能已经产生费用。重试会创建一个新任务，并可能再次计费。"), confirmLabel: t("继续重试") })) return;
    const response = await chrome.runtime.sendMessage({ type: "RETRY_CREATIVE_JOB", jobId: lastCreativeJob.id });
    if (!response?.ok) throw new Error(response?.message || "无法重新开始创作任务");
    creativeJobs = { ...creativeJobs, items: [...(creativeJobs.items ?? []), response.job] };
    setActiveCreativeJob(response.job);
    renderComposer();
    return;
  }
  if (!composerSession.lastFailure?.retryable) return;
  const failure = composerSession.lastFailure;
  const startPhase = failure.phase === "streaming" && composerSession.currentInstruction && composerSession.currentRoute ? "streaming" : "planning";
  let working = clearComposerFailure(composerSession);
  working = appendDiagnosticEvent(working, {
    phase: startPhase,
    status: startPhase === "streaming" ? "retrying" : "started",
    detail: startPhase === "streaming" ? "重试生成" : "重试规划"
  });
  const controller = new AbortController();
  activeOperation = {
    kind: "compose",
    sessionId: working.id,
    phase: startPhase,
    requestPhase: startPhase,
    userMessageId: failure.userMessageId,
    controller,
    session: working,
    streamingText: ""
  };
  composerSession = working;
  renderComposer();
  try {
    activeOperation.session = await saveSession(working);
    await runComposerTurn(activeOperation, startPhase);
  } catch (error) {
    const operation = activeOperation;
    if (operation) {
      composerSession = setComposerFailure(operation.session, {
        userMessageId: failure.userMessageId,
        phase: "saving",
        kind: "storage",
        message: error.message || t("无法保存创作草稿"),
        retryable: true
      });
      activeOperation = null;
      renderComposer();
    }
  }
}

async function runComposerTurn(operation, startPhase = "planning") {
  if (!operation || operation.kind !== "compose") return;
  try {
    const settingsValue = await privateComposerServiceSettings();
    if (startPhase === "streaming" && operation.session.currentInstruction && operation.session.currentRoute) {
      await runAgentExecution(operation, settingsValue, operation.session.currentRoute, operation.session.currentInstruction);
      return;
    }
    const planning = await planComposerSession({
      session: operation.session,
      composerSettings,
      settings: settingsValue,
      signal: operation.controller.signal,
      retrieveSources: retrieveSourcesForTurn
    });
    let working = planning.session;
    const planned = planning.planned;
    if (planning.needsClarification) {
      operation.session = await saveSession(working);
      return;
    }
    if (planned.librarySearch && !planning.retrievedCount && composerSession?.id === working.id) composerFeedback(t("本地资料库没有找到匹配来源，已使用现有参考继续"));
    if (planned.notice && composerSession?.id === working.id) composerFeedback(t(planned.notice));
    operation.session = await saveSession(working);
    await runAgentExecution(operation, settingsValue, planned.route, planned.instruction);
  } catch (error) {
    await persistComposerFailure(operation, error);
  } finally {
    if (activeOperation === operation) activeOperation = null;
    renderComposer();
  }
}

function retrieveSourcesForTurn(session, search) {
  const baseSession = createComposerSession({ ...session, retrievedSources: [] });
  const remainingCharacters = Math.max(
    0,
    COMPOSER_INPUT_MAX_CHARACTERS - composerInputUsage(baseSession, "", composerSettings).characters
  );
  return retrieveComposerSources({
    query: search.query,
    contentRoles: search.contentRoles,
    targetType: session.targetType,
    characterBudget: remainingCharacters,
    entries,
    collections: organizerState.collections,
    facetCatalog,
    excludedEntryIds: session.referenceSnapshots.map((item) => item.entryId),
    searchIndex: composerSearchIndex,
    documentTextByEntryId: composerDocumentTextByEntryId
  });
}

async function rebuildComposerSearchIndex() {
  const state = await createComposerSearchState(entries);
  composerDocumentTextByEntryId = state.documentTextByEntryId;
  composerSearchIndex = state.searchIndex;
}

async function createComposerSearchState(sourceEntries) {
  const documentIds = [...new Set(sourceEntries.flatMap((entry) => entryMediaAssets(entry))
    .filter((asset) => asset.kind === "document")
    .map((asset) => asset.id))];
  const derived = await Promise.all(documentIds.map(async (id) => [id, await getDerivedMedia(id).catch(() => null)]));
  const documentText = new Map(derived.flatMap(([id, value]) => value?.searchText ? [[id, value.searchText]] : []));
  const documentTextByEntryId = new Map(sourceEntries.flatMap((entry) => {
    const text = entryMediaAssets(entry).map((asset) => documentText.get(asset.id)).filter(Boolean).join("\n").trim();
    return text ? [[entry.id, text]] : [];
  }));
  return {
    documentTextByEntryId,
    searchIndex: buildSearchIndex(sourceEntries, facetCatalog, documentText)
  };
}

async function runAgentExecution(operation, settingsValue, route, instruction) {
  operation.phase = "streaming";
  operation.requestPhase = "streaming";
  operation.executionRoute = route;
  operation.session = appendDiagnosticEvent(operation.session, { phase: "streaming", status: "started", detail: routeOperationLabel(route) });
  operation.session = await saveSession(operation.session);
  renderActiveState();
  const preparedImages = operation.session.imageReferenceMode === "text_only"
    ? []
    : await prepareSelectedReferenceImages(operation.session);
  const result = await executeComposerTurnWithService({
      session: operation.session,
      userMessage: "",
      composerSettings,
      route,
      instruction,
      imageEdit: operation.imageEdit
    }, settingsValue, preparedImages, {
      signal: operation.controller.signal,
      onDelta: (_delta, content) => {
        operation.streamingText = content;
        if (composerSession?.id === operation.sessionId) renderStreamingText();
      }
  });
  operation.streamingText = "";
  operation.session = appendDiagnosticEvent(operation.session, {
    phase: "streaming",
    status: "completed",
    detail: `输入 ${result.usage.promptTokens} / 输出 ${result.usage.completionTokens} tokens`
  });
  const working = applyComposerServiceResult(operation.session, result, composerSettings, route, instruction);
  operation.session = await saveSession(working);
  if (route !== "compose") return;
  if (result.kind === "image") {
    creativeRuns = await persistGeneratedImages(
      operation.session,
      operation.session.promptVersions.at(-1)?.id,
      result.images,
      {
        parentVisualId: operation.imageEdit?.parentVisualId,
        editMode: operation.imageEdit?.mode,
        serviceId: result.serviceId,
        requestModel: result.requestModel,
        responseModel: result.model,
        requestParameters: result.requestParameters,
        modification: operation.imageEdit?.modification
      }
    );
  }
}

async function persistComposerFailure(operation, error) {
  const details = composerServiceErrorDetails(error);
  const phase = operation.requestPhase === "streaming" ? "streaming" : "planning";
  let working = appendDiagnosticEvent(operation.session, {
    phase,
    status: details.kind === "stopped" ? "stopped" : "failed",
    detail: details.message
  });
  working = setComposerFailure(working, {
    userMessageId: operation.userMessageId,
    phase,
    kind: details.kind,
    message: details.kind === "stopped" ? details.message : `${details.message}。本轮内容已保留。`,
    retryable: operation.imageEdit ? false : details.retryable
  });
  operation.streamingText = "";
  try {
    operation.session = await saveSession(working);
  } catch {
    operation.session = working;
    if (composerSession?.id === operation.sessionId) composerSession = working;
  }
}

async function stopActiveOperation() {
  if (!activeOperation) return;
  if (activeOperation.durable) {
    const operation = activeOperation;
    operation.phase = "stopping";
    renderActiveState();
    const response = await chrome.runtime.sendMessage({ type: "CANCEL_CREATIVE_JOB", jobId: operation.jobId });
    if (!response?.ok) {
      operation.phase = operation.requestPhase === "planning" ? "planning" : "streaming";
      renderActiveState();
      throw new Error(response?.message || "后台任务无法停止");
    }
    lastCreativeJob = response.job;
    activeOperation = null;
    await refreshCreativeResultState();
    renderComposer();
    return;
  }
  activeOperation.phase = "stopping";
  activeOperation.controller.abort();
  renderActiveState();
}

async function startPersistentCreativeJob({ session, userMessageId, startPhase, imageEdit, jobId = "" }) {
  requireAiRuntimeProtocolVersion(composerAiRuntimeProtocolVersion);
  const response = await chrome.runtime.sendMessage({
    type: "START_CREATIVE_JOB",
    jobId,
    request: { session, userMessageId, startPhase, imageEdit }
  });
  if (!response?.ok) throw new Error(response?.message || "后台创作任务启动失败");
  creativeJobs = { ...creativeJobs, items: [...(creativeJobs.items ?? []), response.job] };
  lastCreativeJob = response.job;
  setActiveCreativeJob(response.job);
  renderComposer();
  return response.job;
}

function setActiveCreativeJob(job) {
  activeOperation = {
    kind: "compose",
    durable: true,
    jobId: job.id,
    sessionId: job.sessionId,
    phase: job.phase === "planning" ? "planning" : "streaming",
    requestPhase: job.phase,
    executionRoute: job.request.session.currentRoute || "compose",
    userMessageId: job.userMessageId,
    session: job.request.session,
    streamingText: ""
  };
}

function renderActiveState() {
  renderSessions();
  renderSendState();
  renderTimeline();
  if (elements.composerReferenceWorkspace.hidden === false) renderProjects();
}

function renderStreamingText() {
  const node = elements.composerTimeline.querySelector(".composer-streaming-caret");
  if (node) node.textContent = currentStreamingText();
  else renderTimeline();
  elements.composerTimeline.scrollTop = elements.composerTimeline.scrollHeight;
}

function currentStreamingText() {
  return activeOperation?.kind === "compose" && activeOperation.sessionId === composerSession?.id
    ? activeOperation.streamingText
    : "";
}

function currentComposerOperation() {
  return activeOperation?.kind === "compose" && activeOperation.sessionId === composerSession?.id
    ? activeOperation
    : null;
}

function displayedComposerSession() {
  return currentComposerOperation()?.session ?? composerSession;
}

function toggleComposerModelMenu(event) {
  event.stopPropagation();
  if (elements.composerModelTrigger.disabled) return;
  const open = elements.composerModelMenu.hidden;
  if (open) openComposerModelMenu();
  else closeComposerModelMenu();
}

function openComposerModelMenu() {
  if (elements.composerModelTrigger.disabled) return;
  elements.composerModelMenu.hidden = false;
  elements.composerModelTrigger.setAttribute("aria-expanded", "true");
  elements.composerModelTrigger.focus();
}

function closeComposerModelMenu() {
  elements.composerModelMenu.hidden = true;
  elements.composerModelTrigger.setAttribute("aria-expanded", "false");
}

function renderComposerAiProfile() {
  const profile = activeComposerProfile();
  const catalog = composerServiceCatalog(composerAiSettings, composerVisionSettings);
  const service = selectedComposerService(profile, composerAiSettings, composerVisionSettings);
  const reasoningAvailable = service.reasoning === true;
  const name = translateUiMessage(service.shortLabel || service.label).replace("未选择模型", t("未选择模型"));
  elements.composerModelLabel.textContent = composerSession?.outputMode === "create_image"
    ? `${name} · ${t("生图")}`
    : composerSession?.outputMode === "create_video" ? `${name} · ${t("视频")}`
    : reasoningAvailable && profile.thinking ? `${name} · ${t("思考")}` : name;
  elements.composerModelLabel.title = translateUiMessage(service.label).replace("未选择模型", t("未选择模型"));
  const selected = (serviceId, model) => profile.serviceId === serviceId && (!model || profile.model === model);
  elements.composerModelFlash.setAttribute("aria-checked", String(selected("deepseek", "deepseek-v4-flash")));
  elements.composerModelPro.setAttribute("aria-checked", String(selected("deepseek", "deepseek-v4-pro")));
  elements.composerModelOpenai.setAttribute("aria-checked", String(selected("openai")));
  elements.composerModelCompatible.setAttribute("aria-checked", String(selected("compatible")));
  elements.composerModelXai.setAttribute("aria-checked", String(selected("xai")));
  const openai = catalog.find((item) => item.serviceId === "openai");
  const compatible = catalog.find((item) => item.serviceId === "compatible");
  const xai = catalog.find((item) => item.serviceId === "xai");
  elements.composerModelOpenaiLabel.textContent = translateUiMessage(openai?.label || "OpenAI").replace("未选择模型", t("未选择模型"));
  elements.composerModelCompatibleLabel.textContent = translateUiMessage(compatible?.label || t("兼容视觉服务"))
    .replace("兼容服务", t("兼容服务"))
    .replace("未选择模型", t("未选择模型"));
  elements.composerModelXaiLabel.textContent = translateUiMessage(xai?.label || "xAI").replace("未选择模型", t("未选择模型"));
  elements.composerModelOpenai.querySelector("small").textContent = t(openai?.configured ? "读取手选原图与对应提示词" : "未配置，前往分析设置");
  elements.composerModelCompatible.querySelector("small").textContent = t(compatible?.configured ? "读取手选原图与对应提示词" : "未配置，前往分析设置");
  elements.composerModelXai.querySelector("small").textContent = xai?.configured
    ? t("读取文字与手选原图，并按已配置能力创建图片或视频")
    : t("未配置，前往 AI 服务与任务分工");
  renderGenerationModelChoices(profile);
  elements.composerThinking.checked = reasoningAvailable && profile.thinking;
  elements.composerModelTrigger.disabled = Boolean(activeOperation);
  elements.composerModelFlash.disabled = Boolean(activeOperation);
  elements.composerModelPro.disabled = Boolean(activeOperation);
  elements.composerModelOpenai.disabled = Boolean(activeOperation);
  elements.composerModelCompatible.disabled = Boolean(activeOperation);
  elements.composerModelXai.disabled = Boolean(activeOperation);
  elements.composerThinking.disabled = Boolean(activeOperation) || !reasoningAvailable;
  const videoTask = composerSession?.targetType === "video";
  const generationProfile = generationRouteProfile(videoTask);
  const mediaAvailability = videoTask
    ? composerVideoAvailability(generationProfile, composerVisionSettings, { ...composerSession, aiProfile: generationProfile })
    : composerImageAvailability(generationProfile, composerVisionSettings, { ...composerSession, aiProfile: generationProfile });
  elements.composerCreateMediaLabel.textContent = t(videoTask ? "创建视频" : "创建图片");
  elements.composerCreateImage.checked = composerSession?.outputMode === (videoTask ? "create_video" : "create_image");
  elements.composerCreateImage.disabled = Boolean(activeOperation) || !mediaAvailability.available;
  elements.composerCreateImageNote.textContent = translateUiMessage(mediaAvailability.message);
  elements.composerProductionReview.disabled = Boolean(activeOperation) || !["auto", "compose"].includes(composerSession?.routeMode);
  renderImageGenerationSettings();
}

function renderGenerationModelChoices(selectedProfile) {
  const generationMode = ["create_image", "create_video"].includes(composerSession?.outputMode);
  for (const button of [elements.composerModelFlash, elements.composerModelPro, elements.composerModelOpenai, elements.composerModelCompatible, elements.composerModelXai]) {
    button.hidden = generationMode;
  }
  elements.composerModelDynamic.hidden = !generationMode;
  if (!generationMode) return elements.composerModelDynamic.replaceChildren();
  const videoTask = composerSession.outputMode === "create_video";
  const taskId = videoTask ? "videoGeneration" : "imageGeneration";
  const choices = Object.values(composerVisionSettings.providerProfiles ?? {}).flatMap((provider) => {
    const model = provider.models?.[taskId];
    if (!provider.credentialConfigured || !provider.consent || !provider.capabilities?.includes(taskId) || !model) return [];
    const candidate = composerProfileForAssignment({ providerId: provider.id, model }, selectedProfile);
    const capability = composerServiceCapabilities(candidate, composerVisionSettings)[videoTask ? "video" : "image"];
    return capability?.generate ? [{ provider, candidate }] : [];
  });
  elements.composerModelDynamic.replaceChildren(...choices.map(({ provider, candidate }) => {
    const button = document.createElement("button");
    button.type = "button";
    button.setAttribute("role", "menuitemradio");
    button.setAttribute("aria-checked", String(candidate.serviceId === selectedProfile.serviceId && candidate.model === selectedProfile.model));
    const copy = document.createElement("span");
    copy.append(rawTextEl("b", "", provider.label || provider.id), rawTextEl("small", "", candidate.model));
    button.append(copy, rawTextEl("span", "", "✓"));
    button.addEventListener("click", () => safely(() => updateComposerAiProfile(candidate))());
    return button;
  }));
  if (!choices.length) elements.composerModelDynamic.append(rawTextEl("p", "composer-model-empty", t("没有已连接且支持当前生成任务的模型")));
}

function renderImageGenerationSettings() {
  const videoTask = composerSession?.targetType === "video";
  const generationProfile = generationRouteProfile(videoTask);
  const capability = composerServiceCapabilities(generationProfile, composerVisionSettings)[videoTask ? "video" : "image"];
  const hasImageSize = capability?.parameters?.some((parameter) => ["size", "aspectRatio", "imageSize"].includes(parameter.key));
  const visible = videoTask
    ? composerSession?.outputMode === "create_video" && Boolean(capability?.generate)
    : Boolean(capability?.generate && hasImageSize);
  elements.composerGenerationSettings.hidden = !visible;
  if (!visible) return;
  elements.composerGenerationSettingsTitle.textContent = t(videoTask ? "本轮视频参数" : "本轮图片参数");
  const state = videoTask
    ? normalizeVideoGenerationRequest(generationProfile, composerVisionSettings, composerSession.generationParameters)
    : normalizeImageGenerationRequest(generationProfile, composerVisionSettings, composerSession.generationParameters);
  if (videoTask) {
    renderGenerationParameterField(elements.composerImageSizeField, elements.composerImageSize, capability, "size", composerSession.generationParameters.size, {
      showAutomatic: true,
      fallbackLabel: "画幅与分辨率"
    });
    elements.composerImageQualityField.hidden = true;
    elements.composerImageReferenceModeField.hidden = true;
    renderGenerationParameterField(elements.composerVideoDurationField, elements.composerVideoDuration, capability, "duration", composerSession.generationParameters.duration, {
      fallbackLabel: "时长"
    });
  } else {
    const primaryKey = generationParameterKey(capability, ["size", "aspectRatio"]);
    const secondaryKey = generationParameterKey(capability, ["quality", "imageSize"]);
    renderGenerationParameterField(elements.composerImageSizeField, elements.composerImageSize, capability, primaryKey, composerSession.generationParameters[primaryKey], {
      showAutomatic: true,
      fallbackLabel: "画幅与分辨率"
    });
    elements.composerVideoDurationField.hidden = true;
    renderGenerationParameterField(elements.composerImageQualityField, elements.composerImageQuality, capability, secondaryKey, composerSession.generationParameters[secondaryKey], {
      fallbackLabel: "质量"
    });
    const referenceMode = imageReferenceModeAvailability(composerSession.referenceSnapshots);
    elements.composerImageReferenceModeField.hidden = composerSession.outputMode !== "create_image"
      || !composerSession.referenceSnapshots.some((item) => item.imageRefs?.length);
    elements.composerImageReferenceMode.value = composerSession.imageReferenceMode;
    elements.composerImageReferenceMode.disabled = Boolean(activeOperation) || !referenceMode.canDisableImages;
  }
  const messages = [
    ...state.issues,
    ...(!videoTask && !imageReferenceModeAvailability(composerSession.referenceSnapshots).canDisableImages
      ? [`还有 ${imageReferenceModeAvailability(composerSession.referenceSnapshots).missingAssetIds.length} 张参考图既没有案例提示词，也没有有效分析文字，暂时必须带原图`]
      : []),
    ...(!videoTask && composerSession.referenceSnapshots.some((item) => item.imageRefs?.length)
      ? [t("参考图画幅无需与输出画幅一致。")]
      : []),
    ...(state.ignored.length ? [`当前服务不会发送：${state.ignored.join("、")}`] : [])
  ];
  elements.composerGenerationParameterNote.textContent = messages.map(translateUiMessage).join(currentLocale() === "en" ? "; " : "；");
  elements.composerGenerationParameterNote.classList.toggle("error", state.issues.length > 0);
}

async function updateImageReferenceMode() {
  if (!composerSession || activeOperation || composerSession.outputMode !== "create_image") return;
  const mode = elements.composerImageReferenceMode.value;
  const availability = imageReferenceModeAvailability(composerSession.referenceSnapshots);
  if (mode !== "conditioned" && !availability.canDisableImages) {
    renderImageGenerationSettings();
    return composerFeedback(`还有 ${availability.missingAssetIds.length} 张参考图既没有案例提示词，也没有有效分析文字，不能关闭原图`, true);
  }
  composerSession = await saveSession(createComposerSession({ ...composerSession, imageReferenceMode: mode }));
  renderComposer();
}

function generationParameterKey(capability, preferredKeys) {
  return preferredKeys.find((key) => capability.parameters.some((item) => item.key === key)) ?? preferredKeys[0];
}

function renderGenerationParameterField(field, select, capability, key, selectedValue, { showAutomatic = false, fallbackLabel = "" } = {}) {
  const parameter = capability.parameters.find((item) => item.key === key);
  field.dataset.parameterKey = key;
  const label = field.querySelector("span");
  if (label) label.textContent = translateUiMessage(parameter?.label || fallbackLabel);
  field.hidden = !parameter && !showAutomatic;
  const supportedOptions = parameter?.options?.length
    ? parameter.options
    : showAutomatic ? [{ value: "", label: "由服务决定" }] : [];
  const selected = String(selectedValue ?? "").trim();
  const selectedSupported = supportedOptions.some((item) => item.value === selected);
  const options = parameter && selected && !selectedSupported
    ? [{ value: selected, label: `${selected}（当前模型不支持，请重选）`, incompatible: true }, ...supportedOptions]
    : supportedOptions;
  select.replaceChildren(...options.map((item) => {
    const option = document.createElement("option");
    option.value = item.value;
    option.textContent = translateUiMessage(item.label);
    option.dataset.incompatible = String(item.incompatible === true);
    return option;
  }));
  if (parameter) select.value = selected || parameter.defaultValue;
  select.disabled = Boolean(activeOperation) || options.length <= 1;
  field.classList.toggle("is-readonly", options.length <= 1);
}

async function updateComposerAiProfile(change) {
  if (!composerSession || activeOperation) return;
  const generationMode = ["create_image", "create_video"].includes(composerSession.outputMode);
  const baseProfile = generationMode ? composerSession.generationAiProfile : composerSession.aiProfile;
  const aiProfile = normalizeComposerAiProfile({ ...baseProfile, ...change });
  const service = selectedComposerService(aiProfile, composerAiSettings, composerVisionSettings);
  const videoTask = composerSession.targetType === "video";
  const generationParameters = generationMode
    ? {
        ...composerSession.generationParameters,
        ...(videoTask
          ? normalizeVideoGenerationRequest(aiProfile, composerVisionSettings, composerSession.generationParameters).parameters
          : normalizeImageGenerationRequest(aiProfile, composerVisionSettings, composerSession.generationParameters).parameters)
      }
    : composerSession.generationParameters;
  const activeGenerationMode = videoTask ? "create_video" : "create_image";
  const serviceSupportsGeneration = videoTask ? service.videoGeneration : service.imageGeneration;
  composerSession = createComposerSession({
    ...composerSession,
    ...(generationMode ? { generationAiProfile: aiProfile } : { aiProfile }),
    generationParameters,
    outputMode: composerSession.outputMode === activeGenerationMode && serviceSupportsGeneration
      ? activeGenerationMode
      : "text_prompt"
  });
  composerSession = await saveSession(composerSession);
  closeComposerModelMenu();
  renderComposer();
}

async function updateComposerOutputMode() {
  if (!composerSession || activeOperation) return;
  const videoTask = composerSession.targetType === "video";
  const enabled = elements.composerCreateImage.checked;
  const aiProfile = enabled ? generationRouteProfile(videoTask) : composerSession.generationAiProfile;
  const service = selectedComposerService(aiProfile, composerAiSettings, composerVisionSettings);
  const mediaAvailability = videoTask
    ? composerVideoAvailability(aiProfile, composerVisionSettings, { ...composerSession, aiProfile })
    : composerImageAvailability(aiProfile, composerVisionSettings, { ...composerSession, aiProfile });
  const serviceSupportsGeneration = videoTask ? service.videoGeneration : service.imageGeneration;
  if (enabled && (!serviceSupportsGeneration || !mediaAvailability.available)) {
    renderComposerAiProfile();
    return composerFeedback(mediaAvailability.message, true);
  }
  const parameterState = videoTask
    ? normalizeVideoGenerationRequest(aiProfile, composerVisionSettings, composerSession.generationParameters)
    : normalizeImageGenerationRequest(aiProfile, composerVisionSettings, composerSession.generationParameters);
  composerSession = await saveSession(createComposerSession({
    ...composerSession,
    generationAiProfile: aiProfile,
    outputMode: enabled ? (videoTask ? "create_video" : "create_image") : "text_prompt",
    generationParameters: enabled
      ? parameterState.parameters
      : composerSession.generationParameters
  }));
  renderComposer();
}

function generationRouteProfile(videoTask) {
  const current = normalizeComposerAiProfile(composerSession.generationAiProfile);
  const currentAvailability = videoTask
    ? composerVideoAvailability(current, composerVisionSettings, composerSession)
    : composerImageAvailability(current, composerVisionSettings, composerSession);
  if (currentAvailability.available) return current;
  return composerProfileForAssignment(
    composerAiTaskAssignments[videoTask ? "videoGeneration" : "imageGeneration"],
    current
  );
}

function activeComposerProfile() {
  return normalizeComposerAiProfile(["create_image", "create_video"].includes(composerSession?.outputMode)
    ? composerSession?.generationAiProfile
    : composerSession?.aiProfile);
}

function composerProfileForAssignment(assignment, fallback) {
  const providerId = String(assignment?.providerId ?? "");
  const serviceId = providerId === "deepseek" ? "deepseek"
    : providerId === "openai" ? "openai"
      : providerId === "xai" ? "xai"
        : providerId.startsWith("custom") ? "compatible"
          : ["kimi", "gemini", "openrouter", "minimax", "volcengine"].includes(providerId) ? providerId : "";
  if (!serviceId) return normalizeComposerAiProfile(fallback);
  return normalizeComposerAiProfile({ serviceId, model: assignment?.model, thinking: fallback?.thinking === true });
}

async function updateImageGenerationParameters() {
  if (!composerSession || activeOperation) return;
  const videoTask = composerSession.targetType === "video";
  if (videoTask && composerSession.outputMode !== "create_video") return;
  const generationParameters = videoTask
    ? {
        ...composerSession.generationParameters,
        size: elements.composerImageSize.value,
        duration: elements.composerVideoDuration.value
      }
    : {
        ...composerSession.generationParameters,
        size: "",
        aspectRatio: "",
        quality: "",
        imageSize: "",
        [elements.composerImageSizeField.dataset.parameterKey || "size"]: elements.composerImageSize.value,
        [elements.composerImageQualityField.dataset.parameterKey || "quality"]: elements.composerImageQuality.value
      };
  composerSession = await saveSession(createComposerSession({
    ...composerSession,
    generationParameters
  }));
  renderComposer();
}

async function updateComposerPreferences() {
  if (!composerSession) return;
  if (activeOperation?.kind === "compose" && activeOperation.sessionId === composerSession.id) {
    renderComposer();
    return composerFeedback(t("生成期间不能修改当前对话设置"), true);
  }
  const previousType = composerSession.targetType;
  const previousRouteMode = composerSession.routeMode;
  const previousReviewEnabled = composerSession.productionReviewEnabled;
  const previousOutputLanguage = composerSession.outputLanguage;
  const previousTargetPlatform = composerSession.targetPlatform;
  const targetType = selectedTargetType();
  const previousDefault = previousType === "video" ? t("未命名视频提示词") : t("未命名图片提示词");
  const nextTitle = composerSession.title === previousDefault
    ? (targetType === "video" ? t("未命名视频提示词") : t("未命名图片提示词"))
    : composerSession.title;
  const keepExecution = previousType === targetType
    && previousRouteMode === elements.composerRoute.value
    && previousReviewEnabled === elements.composerProductionReview.checked
    && previousOutputLanguage === elements.composerOutputLanguage.value
    && previousTargetPlatform === elements.composerPlatform.value.trim();
  composerSession = createComposerSession({
    ...composerSession,
    title: nextTitle,
    targetType,
    targetPlatform: elements.composerPlatform.value.trim(),
    outputLanguage: elements.composerOutputLanguage.value,
    routeMode: elements.composerRoute.value,
    productionReviewEnabled: elements.composerProductionReview.checked,
    currentInstruction: keepExecution ? composerSession.currentInstruction : "",
    retrievedSources: keepExecution ? composerSession.retrievedSources : [],
    currentRoute: keepExecution ? composerSession.currentRoute : "",
    currentRouteSource: keepExecution ? composerSession.currentRouteSource : ""
  });
  const response = await chrome.runtime.sendMessage({
    type: "UPDATE_COMPOSER_SETTINGS",
    action: "preferences",
    outputLanguage: composerSession.outputLanguage,
    lastTargetPlatform: composerSession.targetPlatform,
    productionReviewEnabled: composerSession.productionReviewEnabled
  });
  if (response?.ok) composerSettings = normalizeComposerSettings(response.composerSettings);
  composerSession = await saveSession(composerSession);
  renderComposer();
}

async function loadComposerSession(sessionId) {
  if (!sessionId || sessionId === composerSession?.id) return;
  const response = await chrome.runtime.sendMessage({ type: "GET_COMPOSER_SESSION", sessionId });
  if (!response?.ok) return composerFeedback(response?.message || t("没有找到这份创作草稿"), true);
  composerSession = response.session;
  reuseRetrievedSourcesNextTurn = false;
  replaceComposerSessionUrl(sessionId);
  elements.composerShell.classList.remove("nav-open");
  closeReferenceWorkspace();
  renderComposer();
}

async function deleteSession(sessionId) {
  if (activeOperation?.kind === "compose" && activeOperation.sessionId === sessionId) {
    return composerFeedback(t("请先停止这个对话的生成，再删除"), true);
  }
  const summary = sessionSummaries.find((item) => item.id === sessionId);
  if (!await confirmAppAction({ title: t("删除这段对话？"), description: translateUiMessage(summary?.title || composerSession?.title || ""), confirmLabel: t("删除"), danger: true })) return;
  const response = await chrome.runtime.sendMessage({ type: "DELETE_COMPOSER_SESSION", sessionId });
  if (!response?.ok) return composerFeedback(response?.message || t("无法删除创作草稿"), true);
  sessionSummaries = response.summaries ?? [];
  if (composerSession?.id === sessionId) {
    const next = sessionSummaries[0];
    if (next) await loadComposerSession(next.id);
    else await createNewSession();
  }
  else renderSessions();
}

function renderComposerSaveState() {
  if (!isMeaningfulComposerSession(composerSession)) {
    elements.composerSaveState.textContent = t("新对话");
    return;
  }
  if (composerSession.lastFailure?.phase === "saving") {
    elements.composerSaveState.textContent = t("保存失败");
    return;
  }
  elements.composerSaveState.textContent = sessionSummaries.some((summary) => summary.id === composerSession.id)
    ? t("已自动保存")
    : t("正在保存…");
}

async function saveSession(session) {
  const current = composerSession?.id === session.id;
  if (!isMeaningfulComposerSession(session)) {
    if (current) elements.composerSaveState.textContent = t("新对话");
    return createComposerSession(session);
  }
  if (current) elements.composerSaveState.textContent = t("正在保存…");
  try {
    const response = await chrome.runtime.sendMessage({ type: "UPSERT_COMPOSER_SESSION", session });
    if (!response?.ok) throw new Error(response?.message || t("无法保存创作草稿"));
    sessionSummaries = response.summaries ?? sessionSummaries;
    if (composerSession?.id === response.session.id) composerSession = response.session;
    if (current) {
      elements.composerSaveState.textContent = t("已自动保存");
      replaceComposerSessionUrl(response.session.id);
    }
    return response.session;
  } catch (error) {
    if (current) elements.composerSaveState.textContent = t("保存失败");
    throw error;
  }
}

function replaceComposerSessionUrl(sessionId) {
  history.replaceState(null, "", `composer.html?session=${encodeURIComponent(sessionId)}`);
}

function openReferenceWorkspace() {
  clearComposerFeedback();
  referenceDraftSelections = new Map();
  referenceDraftOrder = [];
  referencePreviewAssetIds = new Map();
  for (const item of (composerSession?.referenceSnapshots ?? []).filter((reference) => reference.sourceType !== TEMP_REFERENCE_SOURCE_TYPES.temporary)) {
    const assetIds = [item.assetId, ...(item.imageRefs ?? []).map((imageRef) => imageRef.visualId)].filter(Boolean);
    const selected = referenceDraftSelections.get(item.entryId) ?? new Set();
    assetIds.forEach((assetId) => selected.add(assetId));
    referenceDraftSelections.set(item.entryId, selected);
    if (assetIds.length) assetIds.forEach((assetId) => addDraftOrder(item.entryId, assetId));
    else addDraftOrder(item.entryId, "");
    if (assetIds[0]) referencePreviewAssetIds.set(item.entryId, assetIds[0]);
  }
  elements.composerReferenceWorkspace.hidden = false;
  elements.composerReferenceWorkspace.inert = false;
  elements.composerReferenceWorkspace.setAttribute("aria-hidden", "false");
  setReferenceWorkspaceMode("references");
  elements.composerReferenceSearch.focus();
}

function openSkillWorkspace() {
  clearComposerFeedback();
  elements.composerReferenceWorkspace.hidden = false;
  elements.composerReferenceWorkspace.inert = false;
  elements.composerReferenceWorkspace.setAttribute("aria-hidden", "false");
  setReferenceWorkspaceMode("skills");
}

function setReferenceWorkspaceMode(mode) {
  workspaceMode = mode === "skills" ? "skills" : "references";
  elements.composerReferenceWorkspace.dataset.mode = workspaceMode;
  renderReferencePicker();
}

function closeReferenceWorkspace() {
  if (elements.composerReferenceWorkspace.contains(document.activeElement)) {
    elements.composerReferenceOpen.focus({ preventScroll: true });
  }
  elements.composerReferenceWorkspace.inert = true;
  elements.composerReferenceWorkspace.setAttribute("aria-hidden", "true");
  elements.composerReferenceWorkspace.hidden = true;
  clearComposerFeedback();
}

function renderReferencePicker() {
  const referencesMode = workspaceMode === "references";
  elements.composerProjectsPanel.hidden = referencesMode;
  elements.composerCasePicker.hidden = !referencesMode;
  elements.composerReferenceFooter.hidden = !referencesMode;
  elements.composerReferenceTabCases.setAttribute("aria-pressed", String(referencesMode));
  elements.composerReferenceTabSkills.setAttribute("aria-pressed", String(!referencesMode));
  elements.composerWorkspaceTitle.textContent = t("本次参考");
  elements.composerWorkspaceDescription.textContent = referencesMode
    ? t("只选择本次对话需要借鉴的案例。")
    : t("可同时应用多个 Skill；列表顺序就是本轮装配顺序。");
  if (referencesMode) {
    renderProjectFilter();
    renderCasePicker();
    renderReferenceSelection();
  } else renderSkills();
}

function renderProjectFilter() {
  const selected = elements.composerReferenceProjectFilter.value || initialProjectFilterId;
  const selectorLabelsByProject = collectionSelectorLabelsById(organizerState);
  const options = [["", t("全部项目")], ...(organizerState.collections ?? []).map((item) => [item.id, selectorLabelsByProject.get(item.id)])];
  elements.composerReferenceProjectFilter.replaceChildren(...options.map(([value, label]) => {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = label;
    return option;
  }));
  elements.composerReferenceProjectFilter.value = options.some(([value]) => value === selected) ? selected : "";
  initialProjectFilterId = "";
}

function renderSkills() {
  const skills = creativeSkills.items;
  if (!skills.length) {
    const empty = el("div", "composer-reference-empty");
    const open = textEl("button", "button-secondary", "打开 Skill 中心");
    open.addEventListener("click", () => safely(openSkillCenter)());
    empty.append(
      rawTextEl("p", "", t("还没有已保存的创作 Skill。")),
      open
    );
    elements.composerProjectList.replaceChildren(empty);
    return;
  }
  const applied = new Set(composerSession.appliedSkills.map((item) => item.skillId));
  const cards = skills.map((skill) => {
    const card = el("article", "ui-skill-card composer-skill-card");
    const header = el("header", "");
    const title = el("div", "");
    title.append(rawTextEl("h2", "ui-skill-card-title", skill.callName), rawTextEl("code", "", `/${skill.callName}`));
    header.append(title, rawTextEl("small", "", `v${skill.versions.findIndex((item) => item.id === skill.currentVersionId) + 1}`));
    card.append(header, rawTextEl("p", "ui-skill-card-summary composer-project-state", skill.description || t("暂无说明")));
    const actions = el("div", "ui-skill-card-actions");
    const edit = textEl("button", "button-secondary", "查看与编辑");
    edit.addEventListener("click", () => safely(() => openSkillCenter(skill.id))());
    const apply = textEl("button", applied.has(skill.id) ? "composer-project-active" : "", applied.has(skill.id) ? "已应用" : "应用 Skill");
    apply.disabled = activeOperation?.kind === "compose" && activeOperation.sessionId === composerSession?.id;
    apply.addEventListener("click", () => safely(() => applied.has(skill.id) ? removeAppliedSkill(skill.id) : applyCreativeSkill(skill))());
    actions.append(edit, apply);
    card.append(actions);
    return card;
  });
  elements.composerProjectList.replaceChildren(...cards);
}

function renderCasePicker() {
  const query = elements.composerReferenceSearch.value.trim().toLocaleLowerCase();
  const projectId = elements.composerReferenceProjectFilter.value;
  const projectIds = projectId
    ? new Set(collectionEntryIds(organizerState, projectId, { subtree: true }))
    : null;
  const targetType = composerSession?.targetType === "video" ? "video" : "image";
  const eligible = entries.filter((entry) => isComposerEligibleEntry(entry, targetType)).filter((entry) => {
    if (projectIds && !(entry.memberEntryIds ? entry.memberEntryIds.some((id) => projectIds.has(id)) : projectIds.has(entry.id))) return false;
    if (!query) return true;
    return `${entry.title ?? ""}\n${entry.text ?? ""}\n${primaryVisionDescription(entry)}`.toLocaleLowerCase().includes(query);
  });
  if (!eligible.length) {
    elements.composerCaseList.replaceChildren(rawTextEl("p", "composer-reference-empty", t("没有匹配的可用案例。")));
    return;
  }
  elements.composerCaseList.replaceChildren(...eligible.map(createCaseOption));
}

function createCaseOption(entry) {
  const option = el("article", "composer-case-option");
  option.dataset.entryId = entry.id;
  const imageAssets = selectableReferenceImages(entry);
  const primaryAsset = imageAssets.find((asset) => asset.id === entry.primaryMediaId) ?? imageAssets[0];
  const previewAsset = imageAssets.find((asset) => asset.id === referencePreviewAssetIds.get(entry.id)) ?? primaryAsset;
  if (previewAsset) referencePreviewAssetIds.set(entry.id, previewAsset.id);
  option.dataset.selected = String(referenceDraftSelections.has(entry.id));
  const checkbox = document.createElement("input");
  checkbox.type = "checkbox";
  checkbox.className = "composer-case-preview-checkbox";
  checkbox.setAttribute("aria-label", `选择当前预览图片：${entry.title || t("未命名案例")}`);
  checkbox.checked = Boolean(previewAsset && referenceDraftSelections.get(entry.id)?.has(previewAsset.id));
  checkbox.addEventListener("change", () => {
    const assetId = referencePreviewAssetIds.get(entry.id);
    if (!assetId) return;
    setDraftAssetSelected(entry.id, assetId, checkbox.checked);
    syncCaseOptionSelection(option, entry);
    renderReferenceSelection();
  });
  const visual = el("div", "composer-case-visual");
  const selectPreview = el("button", "composer-case-select-preview");
  selectPreview.type = "button";
  selectPreview.setAttribute("aria-label", "选择或取消当前预览图片");
  selectPreview.addEventListener("click", () => {
    const assetId = referencePreviewAssetIds.get(entry.id);
    if (!assetId) return;
    const selected = referenceDraftSelections.get(entry.id)?.has(assetId) === true;
    setDraftAssetSelected(entry.id, assetId, !selected);
    syncCaseOptionSelection(option, entry);
    renderReferenceSelection();
  });
  const inspect = textEl("button", "composer-case-inspect", "查看原图");
  inspect.type = "button";
  inspect.addEventListener("click", () => openReferenceImagePreview(entry, referencePreviewAssetIds.get(entry.id)));
  visual.append(selectPreview, inspect);
  option.append(checkbox, visual);
  renderCasePreviewImage(option, entry, previewAsset?.id || "");
  const copy = el("span", "composer-case-copy");
  const contentRole = contentRoleForEntry(entry);
  const type = contentRole === CONTENT_ROLES.promptVideo
    ? t("视频提示词")
    : contentRole === CONTENT_ROLES.imageCase ? t("画面描述") : t("图片提示词");
  const preview = entry.text || primaryVisionDescription(entry);
  copy.append(rawTextEl("strong", "", entry.title || t("未命名案例")), rawTextEl("small", "", type), rawTextEl("p", "", excerpt(preview, 240)));
  option.append(copy);
  if (imageAssets.length > 1) {
    const assetPicker = el("div", "composer-case-assets");
    assetPicker.setAttribute("aria-label", `${entry.title || t("未命名案例")}的图片`);
    for (const [index, asset] of imageAssets.entries()) {
      const assetOption = el("label", "composer-case-asset");
      assetOption.dataset.assetId = asset.id;
      const assetCheckbox = document.createElement("input");
      assetCheckbox.type = "checkbox";
      assetCheckbox.checked = referenceDraftSelections.get(entry.id)?.has(asset.id) === true;
      assetCheckbox.setAttribute("aria-label", `选择第 ${index + 1} 张图片`);
      const image = document.createElement("img");
      image.alt = "";
      image.loading = "lazy";
      image.decoding = "async";
      image.dataset.visualId = asset.id;
      const cached = thumbnailUrls.get(asset.id);
      if (cached) image.src = cached;
      else imageObserver.observe(image);
      assetCheckbox.addEventListener("change", () => {
        referencePreviewAssetIds.set(entry.id, asset.id);
        setDraftAssetSelected(entry.id, asset.id, assetCheckbox.checked);
        renderCasePreviewImage(option, entry, asset.id);
        syncCaseOptionSelection(option, entry);
        renderReferenceSelection();
      });
      assetOption.append(assetCheckbox, image, rawTextEl("span", "", String(index + 1)));
      assetPicker.append(assetOption);
    }
    option.append(assetPicker);
  }
  return option;
}

function setDraftAssetSelected(entryId, assetId, selected) {
  if (!entryId || !assetId) return;
  const selection = referenceDraftSelections.get(entryId) ?? new Set();
  if (selected) {
    selection.add(assetId);
    referenceDraftSelections.set(entryId, selection);
    addDraftOrder(entryId, assetId);
    return;
  }
  selection.delete(assetId);
  removeDraftOrder(entryId, assetId);
  if (!selection.size) referenceDraftSelections.delete(entryId);
}

function renderCasePreviewImage(option, entry, assetId) {
  const surface = option.querySelector(".composer-case-select-preview");
  if (!surface) return;
  const asset = selectableReferenceImages(entry).find((item) => item.id === assetId);
  if (!asset) return surface.replaceChildren(rawTextEl("span", "", t("这条案例没有截图")));
  const image = document.createElement("img");
  image.className = "composer-case-image";
  image.alt = translateUiMessage(`${entry.title || t("未命名案例")} 对应画面`);
  image.loading = "lazy";
  image.decoding = "async";
  image.dataset.visualId = asset.id;
  const cached = thumbnailUrls.get(asset.id);
  if (cached) image.src = cached;
  else imageObserver.observe(image);
  surface.replaceChildren(image);
}

function syncCaseOptionSelection(option, entry) {
  const selected = referenceDraftSelections.get(entry.id) ?? new Set();
  const previewAssetId = referencePreviewAssetIds.get(entry.id) || "";
  option.dataset.selected = String(selected.size > 0);
  const previewCheckbox = option.querySelector(".composer-case-preview-checkbox");
  if (previewCheckbox) previewCheckbox.checked = selected.has(previewAssetId);
  for (const input of option.querySelectorAll(".composer-case-asset input[type='checkbox']")) {
    input.checked = selected.has(input.closest(".composer-case-asset")?.dataset.assetId || "");
  }
}

function syncRenderedReferenceCards() {
  for (const option of elements.composerCaseList.querySelectorAll(".composer-case-option[data-entry-id]")) {
    const entry = entries.find((item) => item.id === option.dataset.entryId);
    if (entry) syncCaseOptionSelection(option, entry);
  }
}

async function openReferenceImagePreview(entry, assetId) {
  if (!assetId) return;
  try {
    const blob = await getScreenshotBlob(assetId);
    if (!blob) throw new Error("无法读取原图");
    const url = URL.createObjectURL(blob);
    const dialog = el("dialog", "composer-reference-preview-dialog");
    const close = textEl("button", "icon-button", "×");
    close.type = "button";
    close.setAttribute("aria-label", "关闭原图预览");
    const image = document.createElement("img");
    image.src = url;
    image.alt = `${entry.title || t("未命名案例")} 原图`;
    dialog.append(close, image);
    const dispose = () => {
      URL.revokeObjectURL(url);
      dialog.remove();
    };
    close.addEventListener("click", () => dialog.close());
    dialog.addEventListener("close", dispose, { once: true });
    document.body.append(dialog);
    dialog.showModal();
  } catch (error) {
    setReferenceFeedback(error.message || "无法查看原图", true);
  }
}

function selectableReferenceImages(entry) {
  return entryMediaAssets(entry).filter((asset) => asset.kind === "image" && asset.usage !== "poster");
}

function draftOrderKey(entryId, assetId = "") {
  return `${entryId}\u0000${assetId}`;
}

function addDraftOrder(entryId, assetId = "") {
  const key = draftOrderKey(entryId, assetId);
  if (!referenceDraftOrder.includes(key)) referenceDraftOrder.push(key);
}

function removeDraftOrder(entryId, assetId = "") {
  const key = draftOrderKey(entryId, assetId);
  referenceDraftOrder = referenceDraftOrder.filter((item) => item !== key);
}

function removeDraftEntry(entryId) {
  referenceDraftSelections.delete(entryId);
  referenceDraftOrder = referenceDraftOrder.filter((item) => !item.startsWith(`${entryId}\u0000`));
}

function orderedDraftItems() {
  const items = [];
  for (const [entryId, assetIds] of referenceDraftSelections) {
    if (assetIds.size) assetIds.forEach((assetId) => items.push({ entryId, assetId, key: draftOrderKey(entryId, assetId) }));
    else items.push({ entryId, assetId: "", key: draftOrderKey(entryId, "") });
  }
  const order = new Map(referenceDraftOrder.map((key, index) => [key, index]));
  return items.sort((left, right) => (order.get(left.key) ?? Number.MAX_SAFE_INTEGER) - (order.get(right.key) ?? Number.MAX_SAFE_INTEGER));
}

async function hydrateCaseImage(image) {
  const visualId = image.dataset.visualId;
  if (!visualId || image.src) return;
  try {
    const blob = await getScreenshotBlob(visualId);
    if (!blob || !image.isConnected) return;
    const url = URL.createObjectURL(blob);
    thumbnailUrls.set(visualId, url);
    image.src = url;
  } catch {
    image.closest(".composer-case-select-preview")?.replaceChildren(rawTextEl("span", "", t("截图读取失败")));
  }
}

function renderReferenceSelection() {
  const selectedItems = orderedDraftItems();
  const limit = draftReferenceLimitState(selectedItems);
  elements.composerCaseSelectionCount.textContent = translateUiMessage(
    `已选择 ${selectedItems.length} 张/项参考${limit.maximum !== null ? ` · 当前生图模型 ${limit.imageCount}/${limit.maximum}` : ""}`
  );
  elements.composerReferenceApply.disabled = limit.exceeded;
  if (limit.exceeded) {
    elements.composerReferenceFeedback.textContent = t("所选模型最多接收 {maximum} 张参考图；当前 {count} 张。选择已保留，请减少后再应用。", { maximum: limit.maximum, count: limit.imageCount });
    elements.composerReferenceFeedback.classList.add("error");
  } else if (elements.composerReferenceFeedback.textContent.includes("最多接收")) {
    elements.composerReferenceFeedback.textContent = "";
    elements.composerReferenceFeedback.classList.remove("error");
  }
  elements.composerSelectionStrip.replaceChildren(...selectedItems.slice(0, 8).map((item, index) => {
    const entry = entries.find((candidate) => candidate.id === item.entryId);
    const assets = selectableReferenceImages(entry);
    const assetIndex = item.assetId ? assets.findIndex((asset) => asset.id === item.assetId) : -1;
    const chip = el("span", "composer-selection-chip");
    chip.append(rawTextEl("b", "", `${entry?.title || t("未命名案例")}${assetIndex >= 0 ? ` · 图${assetIndex + 1}` : ""}`));
    const moveLeft = textEl("button", "", "←");
    moveLeft.type = "button";
    moveLeft.disabled = index === 0;
    moveLeft.setAttribute("aria-label", "向前移动参考");
    moveLeft.addEventListener("click", () => moveDraftItem(item.key, -1));
    const moveRight = textEl("button", "", "→");
    moveRight.type = "button";
    moveRight.disabled = index === selectedItems.length - 1;
    moveRight.setAttribute("aria-label", "向后移动参考");
    moveRight.addEventListener("click", () => moveDraftItem(item.key, 1));
    const remove = textEl("button", "", "×");
    remove.type = "button";
    remove.setAttribute("aria-label", "移除参考");
    remove.addEventListener("click", () => {
      const selection = referenceDraftSelections.get(item.entryId);
      if (item.assetId) selection?.delete(item.assetId);
      else referenceDraftSelections.delete(item.entryId);
      if (selection && !selection.size) referenceDraftSelections.delete(item.entryId);
      removeDraftOrder(item.entryId, item.assetId);
      syncRenderedReferenceCards();
      renderReferenceSelection();
    });
    chip.append(moveLeft, moveRight, remove);
    return chip;
  }));
  if (selectedItems.length > 8) elements.composerSelectionStrip.append(rawTextEl("span", "", `+${selectedItems.length - 8}`));
}

function draftReferenceLimitState(items = orderedDraftItems()) {
  const imageCount = items.filter((item) => item.assetId).length;
  if (composerSession?.outputMode !== "create_image" || composerSession.imageReferenceMode !== "conditioned") {
    return { imageCount, maximum: null, exceeded: false };
  }
  const capability = composerServiceCapabilities(composerSession.generationAiProfile, composerVisionSettings).image;
  const maximum = Number.isInteger(capability?.references?.maxItems) ? capability.references.maxItems : null;
  return { imageCount, maximum, exceeded: maximum !== null && imageCount > maximum };
}

function setReferenceFeedback(message, error = false) {
  elements.composerReferenceFeedback.textContent = String(message ?? "");
  elements.composerReferenceFeedback.classList.toggle("error", error);
}

function moveDraftItem(key, direction) {
  const index = referenceDraftOrder.indexOf(key);
  const target = index + direction;
  if (index < 0 || target < 0 || target >= referenceDraftOrder.length) return;
  [referenceDraftOrder[index], referenceDraftOrder[target]] = [referenceDraftOrder[target], referenceDraftOrder[index]];
  renderReferenceSelection();
}

async function applySelectedReferences() {
  if (!composerSession) return;
  if (activeOperation?.kind === "compose" && activeOperation.sessionId === composerSession.id) {
    return composerFeedback(t("生成期间不能修改当前对话的参考资料"), true);
  }
  const temporaryReferences = composerSession.referenceSnapshots
    .filter((item) => item.sourceType === TEMP_REFERENCE_SOURCE_TYPES.temporary);
  const selected = orderedDraftItems();
  const limit = draftReferenceLimitState(selected);
  if (limit.exceeded) {
    return setReferenceFeedback(`所选模型最多接收 ${limit.maximum} 张参考图；当前 ${limit.imageCount} 张。系统不会自动删图。`, true);
  }
  composerSession = createComposerSession({
    ...composerSession,
    referenceSnapshots: [
      ...createReferenceSnapshots(entries, selected.map((item) => ({ entryId: item.entryId, assetIds: item.assetId ? [item.assetId] : [] })), currentLocale(), composerSession.targetType),
      ...temporaryReferences
    ],
    currentInstruction: "",
    retrievedSources: [],
    currentRoute: "",
    currentRouteSource: ""
  });
  composerSession = await saveSession(composerSession);
  for (const entryId of referenceDraftSelections.keys()) {
    const entry = entries.find((item) => item.id === entryId);
    if (!entry?.creationMeta?.creativeRunId) continue;
    const run = creativeRuns.find((item) => item.id === entry.creationMeta.creativeRunId);
    const reusableIds = new Set(run?.outputs.map((output) => output.visual.id) ?? []);
    for (const visualId of normalizeEntryVisualIds(entry).filter((id) => reusableIds.has(id))) {
      const response = await chrome.runtime.sendMessage({
        type: "RECORD_CREATIVE_SIGNAL",
        runId: entry.creationMeta.creativeRunId,
        visualId,
        signalType: "reused_as_reference"
      });
      if (response?.ok) creativeRuns = response.creativeRuns ?? creativeRuns;
    }
  }
  closeReferenceWorkspace();
  renderComposer();
  composerFeedback(t("参考资料已更新"));
}

async function applyCreativeSkill(skill) {
  if (!composerSession) return;
  if (activeOperation?.kind === "compose" && activeOperation.sessionId === composerSession.id) {
    return composerFeedback("生成期间不能修改当前对话的 Skill", true);
  }
  if (composerSession.appliedSkills.some((item) => item.skillId === skill.id)) return;
  composerSession = createComposerSession({
    ...composerSession,
    appliedSkills: [...composerSession.appliedSkills, createAppliedSkillSnapshot(skill)],
    currentInstruction: "",
    retrievedSources: [],
    currentRoute: "",
    currentRouteSource: ""
  });
  composerSession = await saveSession(composerSession);
  closeReferenceWorkspace();
  renderComposer();
  composerFeedback(`已应用 Skill：/${skill.callName}`);
}

async function removeAppliedSkill(skillId) {
  if (!composerSession) return;
  composerSession = createComposerSession({ ...composerSession, appliedSkills: composerSession.appliedSkills.filter((item) => item.skillId !== skillId), currentInstruction: "", retrievedSources: [], currentRoute: "", currentRouteSource: "" });
  composerSession = await saveSession(composerSession);
  renderComposer();
  if (!elements.composerReferenceWorkspace.hidden && workspaceMode === "skills") renderSkills();
}

async function openSkillCenter(skillId = "") {
  const url = new URL(chrome.runtime.getURL("skills.html"));
  url.searchParams.set("source", "composer");
  if (composerSession?.id) url.searchParams.set("session", composerSession.id);
  if (skillId) url.searchParams.set("skill", skillId);
  location.assign(url.href);
}

function openAssemblyDialog() {
  if (!composerSession) return;
  const payload = plannerRequestPayload(composerSession, "", composerSettings);
  const selectedReferences = composerSession.referenceSnapshots.map((item) => `${item.alias} ${item.title}\n${item.referenceText}`);
  const retrievedReferences = composerSession.retrievedSources.map((item) => `${item.alias} [${item.role}] ${item.title}\n${item.text}`);
  const layers = composerAssemblyLayers({
    settings: composerSettings,
    targetType: composerSession.targetType,
    routeMode: composerSession.routeMode,
    outputLanguage: payload.outputLanguage,
    productionReviewEnabled: composerSession.productionReviewEnabled,
    skills: payload.skills.map((skill) => `${skill.order}. /${skill.callName}\n${skill.instructions}`).join("\n\n"),
    references: [...selectedReferences, ...retrievedReferences].join("\n\n")
  });
  elements.composerAssemblyContent.replaceChildren(...layers.map((layer) => {
    if (["agent", "task"].includes(layer.id)) return assemblyLayer(t(layer.title), layer.content, t("编辑"), async () => {
      const url = new URL(chrome.runtime.getURL("library.html"));
      url.searchParams.set("settings", "composer");
      location.assign(url.href);
    });
    if (layer.id === "skills") return assemblyLayer(t(layer.title), layer.content || "本次对话未应用创作 Skill。", t("选择"), async () => {
      elements.composerAssemblyDialog.close();
      openSkillWorkspace();
    });
    if (layer.id === "references") return assemblyLayer(t(layer.title), layer.content || t("本次对话没有选择参考案例。"), t("编辑"), () => {
      elements.composerAssemblyDialog.close();
      openReferenceWorkspace();
    });
    return assemblyLayer(t(layer.title), layer.content);
  }));
  elements.composerAssemblyDialog.showModal();
}

function assemblyLayer(title, content, actionLabel, action) {
  const layer = el("section", "composer-assembly-layer");
  const body = document.createElement("pre");
  body.textContent = content;
  layer.append(rawTextEl("h3", "", title), body);
  if (actionLabel && action) {
    const button = textEl("button", "button-secondary", actionLabel);
    button.addEventListener("click", safely(action));
    layer.append(button);
  }
  return layer;
}

async function exportComposerDiagnostic() {
  if (!composerSession) return;
  if (!await confirmAppAction({ title: t("导出对话诊断？"), description: t("诊断包会包含当前对话、所选参考文字和输出结果，但不会包含 API Key。"), confirmLabel: t("导出") })) return;
  const diagnostic = buildComposerDiagnostic(composerSession);
  const blob = new Blob([JSON.stringify(diagnostic, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  try {
    const link = document.createElement("a");
    link.href = url;
    link.download = diagnosticFilename(composerSession.title);
    link.click();
    composerFeedback(t("当前对话诊断包已导出"));
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
}

async function copyPrompt(version, button) {
  try {
    await navigator.clipboard.writeText(version.text);
    const original = button.textContent;
    button.textContent = t("已复制");
    setTimeout(() => { button.textContent = original; }, 1200);
    composerFeedback(t("最终提示词已复制"));
  } catch (error) {
    composerFeedback(error.message || t("复制失败，请允许剪贴板权限后重试"), true);
  }
}

async function prepareCreativeResult(sessionId, version, button) {
  try {
    const response = await chrome.runtime.sendMessage({
      type: "ACTIVATE_CREATIVE_RESULT",
      sessionId,
      promptVersionId: version.id
    });
    if (!response?.ok) throw new Error(response?.message || t("无法准备结果采集"));
    const original = button.textContent;
    button.textContent = t("已准备");
    setTimeout(() => { button.textContent = original; }, 1200);
    composerFeedback(response.message);
  } catch (error) {
    composerFeedback(error.message || t("无法准备结果采集"), true);
  }
}

function createCreativeOutputCards(sessionId, promptVersionId) {
  return creativeRuns
    .filter((run) => run.sessionId === sessionId && run.promptVersionId === promptVersionId)
    .flatMap((run) => run.outputs.map((output) => creativeOutputCard(run, output)));
}

function creativeOutputCard(run, output) {
  const card = el("article", "composer-result-card");
  const videoOutput = output.visual.kind === "video";
  let mediaView;
  if (videoOutput) {
    mediaView = document.createElement("video");
    mediaView.className = "composer-result-video";
    mediaView.controls = true;
    mediaView.playsInline = true;
    mediaView.preload = "metadata";
    mediaView.setAttribute("aria-label", t("本次生成视频"));
    loadCreativeOutputVideo(mediaView, output.visual);
  } else {
    mediaView = el("button", "composer-result-image");
    mediaView.type = "button";
    mediaView.setAttribute("aria-label", t("全屏查看生成图片"));
    const image = document.createElement("img");
    image.alt = t("本次生成结果");
    loadCreativeOutputImage(image, output.visual.id);
    mediaView.append(image, rawTextEl("span", "composer-result-expand", t("查看原图")));
    mediaView.addEventListener("click", () => openCreativeImageWorkspace(run.id, output.visual.id));
  }
  const body = el("div", "composer-result-body");
  const heading = el("div", "composer-result-heading");
  heading.append(
    rawTextEl("strong", "", t(videoOutput ? "本次生成视频" : "本次生成结果")),
    rawTextEl("small", "", relativeTime(output.capturedAt))
  );
  body.append(heading);
  if (!videoOutput && output.evaluation) body.append(creativeEvaluationView(output.evaluation));
  if (creativeExperimentSettings.enabled) body.append(creativeJudgmentEditor(run, output));
  const actions = el("div", "composer-result-actions");
  const primaryActions = el("div", "composer-result-primary-actions");
  const secondaryActions = el("div", "composer-result-secondary-actions");
  const saved = entries.some((entry) => entryMediaAssets(entry).some((asset) => asset.id === output.visual.id));
  const save = textEl("button", saved ? "button-secondary" : "", saved ? "已保存到灵感库" : "保存到灵感库");
  save.disabled = saved;
  save.addEventListener("click", () => safely(() => saveCreativeOutput(run.id, output.visual.id, save))());
  const reroll = textEl("button", "button-secondary", "再生成");
  reroll.addEventListener("click", () => safely(() => rerollCreativeOutput(run, output))());
  primaryActions.append(save, reroll);
  if (!videoOutput) {
    const reuse = textEl("button", "button-secondary", "作为参考继续");
    reuse.addEventListener("click", () => safely(() => useCreativeOutputAsReference(run, output))());
    primaryActions.insertBefore(reuse, reroll);
    const editCapabilities = composerImageEditCapabilities(composerSession?.generationAiProfile, composerVisionSettings);
    const edit = textEl("button", "button-secondary", "编辑");
    edit.disabled = !editCapabilities.whole;
    edit.title = edit.disabled ? "请切换到已验证支持图片编辑的 OpenAI 或米醋服务" : "";
    edit.addEventListener("click", () => openCreativeImageWorkspace(run.id, output.visual.id, true));
    secondaryActions.append(edit);
  }
  if (!videoOutput && creativeExperimentSettings.enabled && !output.evaluation) {
    const analyze = textEl("button", "button-secondary", "分析对照");
    analyze.addEventListener("click", () => safely(() => analyzeCreativeOutput(run.id, output.visual.id, analyze))());
    secondaryActions.append(analyze);
  }
  if (!videoOutput && output.evaluation?.primaryDeviation) {
    const revise = textEl("button", "", "继续优化");
    revise.addEventListener("click", () => safely(() => continueFromCreativeOutput(run, output))());
    primaryActions.append(revise);
  }
  const remove = textEl("button", "button-danger composer-result-delete", "删除");
  remove.title = t(videoOutput ? "删除这个生成视频" : "删除这张生成结果");
  remove.addEventListener("click", () => safely(() => deleteCreativeOutput(run.id, output.visual.id, remove))());
  secondaryActions.append(remove);
  actions.append(primaryActions, secondaryActions);
  body.append(actions);
  card.append(mediaView, body);
  return card;
}

function creativeJudgmentEditor(run, output) {
  const details = el("details", "composer-result-judgment");
  const judgmentId = `${run.id}:${output.visual.id}`;
  details.open = openJudgmentIds.has(judgmentId);
  details.addEventListener("toggle", () => {
    details.open ? openJudgmentIds.add(judgmentId) : openJudgmentIds.delete(judgmentId);
  });
  const summary = rawTextEl("summary", "", t("记录人工判断"));
  const form = el("div", "composer-result-judgment-fields");
  const keep = document.createElement("textarea");
  keep.rows = 2;
  keep.placeholder = t("值得保留：哪些选择有效，下一版应保持什么？");
  keep.setAttribute("aria-label", t("值得保留"));
  keep.value = output.judgment?.keep ?? "";
  const improve = document.createElement("textarea");
  improve.rows = 2;
  improve.placeholder = t("需要改进：哪一项最影响结果？");
  improve.setAttribute("aria-label", t("需要改进"));
  improve.value = output.judgment?.improve ?? "";
  const feedback = rawTextEl("span", "composer-result-judgment-feedback", judgmentFeedbackById.get(judgmentId) || "");
  const actions = el("div", "composer-result-judgment-actions");
  const save = textEl("button", "", output.judgment ? "保存修改" : "保存判断");
  const clear = textEl("button", "button-secondary", "清空");
  clear.disabled = !output.judgment;
  const persist = async (judgment) => {
    save.disabled = true;
    clear.disabled = true;
    try {
      const response = await chrome.runtime.sendMessage({
        type: "UPDATE_CREATIVE_JUDGMENT",
        runId: run.id,
        visualId: output.visual.id,
        judgment
      });
      if (!response?.ok) throw new Error(response?.message || t("判断保存失败"));
      creativeRuns = response.creativeRuns ?? creativeRuns;
      const feedbackMessage = t(response.message || (response.judgment ? "本次人工判断已保存" : "本次人工判断已清空"));
      judgmentFeedbackById.set(judgmentId, feedbackMessage);
      feedback.textContent = feedbackMessage;
      save.textContent = t(response.judgment ? "保存修改" : "保存判断");
      clear.disabled = !response.judgment;
    } finally {
      save.disabled = false;
    }
  };
  save.addEventListener("click", () => safely(() => persist({ keep: keep.value, improve: improve.value }))());
  clear.addEventListener("click", () => safely(async () => {
    keep.value = "";
    improve.value = "";
    await persist({ keep: "", improve: "" });
  })());
  actions.append(save, clear, feedback);
  form.append(keep, improve, actions);
  details.append(summary, form);
  return details;
}

function openCreativeImageWorkspace(runId, visualId, startEditing = false) {
  const items = creativeRuns
    .filter((run) => run.sessionId === composerSession?.id)
    .flatMap((run) => run.outputs.filter((output) => output.visual.kind === "image").map((output) => ({
      run,
      output,
      capabilities: composerImageEditCapabilities(composerSession?.generationAiProfile, composerVisionSettings)
    })))
    .sort((left, right) => left.output.capturedAt.localeCompare(right.output.capturedAt));
  const index = items.findIndex((item) => item.run.id === runId && item.output.visual.id === visualId);
  if (index < 0) return;
  safely(() => imageWorkspace.open({ items, index, startEditing }))();
}

async function rerollCreativeOutput(run, output) {
  if (output.visual.kind === "video") return rerollCreativeVideoOutput(run);
  const availability = composerImageAvailability(composerSession?.generationAiProfile, composerVisionSettings, {
    ...composerSession,
    targetType: "image",
    referenceSnapshots: restoredReferenceSnapshots(run)
  });
  if (!availability.available) throw new Error(availability.message);
  imageWorkspace.close();
  return startGeneratedImageTurn({
    run,
    displayMessage: "再来一张：沿用这一版提示词和来源快照。",
    instruction: run.promptText,
    imageEdit: null
  });
}

async function rerollCreativeVideoOutput(run) {
  const referenceSnapshots = restoredReferenceSnapshots(run);
  const availability = composerVideoAvailability(composerSession?.generationAiProfile, composerVisionSettings, {
    ...composerSession,
    targetType: "video",
    referenceSnapshots
  });
  if (!availability.available) throw new Error(availability.message);
  if (!composerSession) throw new Error("当前对话已经不存在");
  if (activeOperation) throw new Error("另一项创作任务正在运行，请先等待或停止");
  let working = createComposerSession({
    ...clearComposerFailure(composerSession),
    targetType: "video",
    routeMode: "compose",
    outputMode: "create_video",
    referenceSnapshots,
    retrievedSources: restoredRetrievedSources(run),
    currentInstruction: run.promptText,
    currentRoute: "compose",
    currentRouteSource: "manual"
  });
  working = appendComposerMessage(working, {
    role: "user",
    type: "request",
    content: "再生成一版：沿用这一版提示词和来源快照。",
    route: "compose",
    routeSource: "manual"
  });
  const userMessageId = working.messages.at(-1).id;
  composerSession = working;
  renderComposer();
  return startPersistentCreativeJob({ session: working, userMessageId, startPhase: "generation", imageEdit: null });
}

async function editCreativeOutput(run, output, request) {
  const capabilities = composerImageEditCapabilities(composerSession?.generationAiProfile, composerVisionSettings);
  if (!capabilities.whole || (request.mode === "local" && !capabilities.local)) {
    throw new Error("当前创作服务没有经过验证的图片编辑协议");
  }
  const baseBlob = await getScreenshotBlob(output.visual.id);
  if (!(baseBlob instanceof Blob)) throw new Error("当前结果底图已经不存在");
  const jobId = `creative:${crypto.randomUUID()}`;
  const maskAssetId = request.mode === "local" ? `creative-job-mask:${jobId}` : "";
  if (maskAssetId) {
    if (!(request.maskBlob instanceof Blob)) throw new Error("局部修改缺少有效遮罩");
    await saveScreenshotBlob(maskAssetId, request.maskBlob);
  }
  const imageEdit = {
    mode: request.mode,
    parentVisualId: output.visual.id,
    originalPrompt: run.promptText,
    modification: request.instruction,
    maskAssetId
  };
  try {
    return await startGeneratedImageTurn({
      run,
      displayMessage: request.instruction,
      instruction: request.instruction,
      imageEdit,
      jobId
    });
  } catch (error) {
    if (maskAssetId) await deleteScreenshotBlob(maskAssetId).catch(() => undefined);
    throw error;
  }
}

async function startGeneratedImageTurn({ run, displayMessage, instruction, imageEdit, jobId = "" }) {
  if (!composerSession) throw new Error("当前对话已经不存在");
  if (activeOperation) throw new Error("另一项创作任务正在运行，请先等待或停止");
  let working = createComposerSession({
    ...clearComposerFailure(composerSession),
    targetType: "image",
    routeMode: "compose",
    outputMode: "create_image",
    referenceSnapshots: restoredReferenceSnapshots(run),
    retrievedSources: restoredRetrievedSources(run),
    currentInstruction: instruction,
    currentRoute: "compose",
    currentRouteSource: "manual"
  });
  working = appendComposerMessage(working, {
    role: "user",
    type: "request",
    content: displayMessage,
    route: "compose",
    routeSource: "manual"
  });
  const userMessageId = working.messages.at(-1).id;
  composerSession = working;
  renderComposer();
  return startPersistentCreativeJob({
    session: working,
    userMessageId,
    startPhase: "generation",
    imageEdit,
    jobId
  });
}

function restoredReferenceSnapshots(run) {
  return (run.referenceSnapshots ?? []).map((reference, index) => ({
    ...reference,
    entryId: `creative-run:${run.id}:reference:${index + 1}`
  }));
}

function restoredRetrievedSources(run) {
  return (run.retrievedSources ?? []).map((source, index) => ({
    ...source,
    entryId: `creative-run:${run.id}:retrieved:${index + 1}`
  }));
}

async function useCreativeOutputAsReference(run, output) {
  if (!composerSession) return;
  if (activeOperation) throw new Error("生成期间不能修改当前参考");
  const entryId = `creative-output:${output.visual.id}`;
  if (composerSession.referenceSnapshots.some((item) => item.entryId === entryId)) {
    imageWorkspace.close();
    return composerFeedback("这张结果已经在本次参考中");
  }
  const alias = currentLocale() === "en"
    ? `@Reference${composerSession.referenceSnapshots.length + 1}`
    : `@参考${composerSession.referenceSnapshots.length + 1}`;
  composerSession = createComposerSession({
    ...composerSession,
    referenceSnapshots: [...composerSession.referenceSnapshots, {
      entryId,
      alias,
      title: run.title || "生成结果",
      referenceKind: "prompt",
      referenceText: run.promptText,
      originalText: run.promptText,
      imageRefs: [{ visualId: output.visual.id, mimeType: output.visual.mimeType }]
    }],
    currentInstruction: "",
    retrievedSources: [],
    currentRoute: "",
    currentRouteSource: ""
  });
  composerSession = await saveSession(composerSession);
  const response = await chrome.runtime.sendMessage({
    type: "RECORD_CREATIVE_SIGNAL",
    runId: run.id,
    visualId: output.visual.id,
    signalType: "reused_as_reference"
  });
  if (response?.ok) creativeRuns = response.creativeRuns ?? creativeRuns;
  imageWorkspace.close();
  renderComposer();
  composerFeedback(`已作为 ${alias} 加入本次参考`);
}

function normalizeEntryVisualIds(entry) {
  return Array.isArray(entry?.mediaAssets)
    ? entryMediaAssets(entry).filter((asset) => asset.kind === "image" && asset.usage !== "poster")
      .map((visual) => String(visual?.id ?? "")).filter(Boolean)
    : Array.isArray(entry?.visuals)
      ? entry.visuals.map((visual) => String(visual?.id ?? "")).filter(Boolean)
    : entry?.hasScreenshot ? [String(entry.id ?? "")] : [];
}

function creativeEvaluationView(evaluation) {
  const wrap = el("div", "composer-result-evaluation");
  wrap.append(rawTextEl("p", "", evaluation.summary));
  const details = document.createElement("details");
  details.append(rawTextEl("summary", "", t("查看对照")));
  const list = el("ul", "");
  for (const check of evaluation.checks ?? []) {
    list.append(rawTextEl("li", `status-${check.status}`, `${creativeCheckLabel(check.status)} · ${check.criterion}：${check.evidence}`));
  }
  if (evaluation.primaryDeviation) {
    list.append(rawTextEl("li", "primary-deviation", `${t("主要偏差")}：${evaluation.primaryDeviation.finding}`));
  }
  details.append(list);
  wrap.append(details);
  return wrap;
}

async function saveCreativeOutput(runId, visualId, button = null) {
  if (button) button.disabled = true;
  try {
    const response = await chrome.runtime.sendMessage({ type: "SAVE_CREATIVE_OUTPUT_TO_LIBRARY", runId, visualId });
    if (!response?.ok) throw new Error(response?.message || t("保存失败"));
    creativeRuns = response.creativeRuns ?? creativeRuns;
    if (response.entry) {
      physicalEntries = [...physicalEntries.filter((item) => item.id !== response.entry.id), response.entry];
      entries = materializeLogicalCases(physicalEntries, compoundCases);
    }
    composerFeedback(response.message);
    renderTimeline();
  } finally {
    if (button) button.disabled = false;
  }
}

async function analyzeCreativeOutput(runId, visualId, button) {
  button.disabled = true;
  try {
    const response = await chrome.runtime.sendMessage({ type: "ANALYZE_CREATIVE_OUTPUT", runId, visualId });
    if (!response?.ok) throw new Error(response?.message || t("视觉对照失败"));
    creativeRuns = response.creativeRuns ?? creativeRuns;
    composerFeedback(response.message);
    renderTimeline();
  } finally {
    button.disabled = false;
  }
}

async function continueFromCreativeOutput(run, output) {
  const deviation = output.evaluation?.primaryDeviation;
  if (!deviation || activeOperation) return;
  await chrome.runtime.sendMessage({
    type: "RECORD_CREATIVE_SIGNAL",
    runId: run.id,
    visualId: output.visual.id,
    signalType: "continued_revision"
  });
  elements.composerInstruction.value = currentLocale() === "en"
    ? `Revise the current prompt using this real-result comparison. Change only this one causal issue and keep every other confirmed part stable:\n${deviation.criterion}: ${deviation.finding}\nSuggested change: ${deviation.suggestedChange}`
    : `根据这次真实生成结果，只修改这一项最可能的原因，其余已确认内容保持不变：\n${deviation.criterion}：${deviation.finding}\n建议修改：${deviation.suggestedChange}`;
  resizeComposerInput();
  await handleComposerAction();
}

async function deleteCreativeOutput(runId, visualId, button = null) {
  const output = creativeRuns.flatMap((run) => run.outputs).find((item) => item.visual.id === visualId);
  const confirmation = output?.visual.kind === "video"
    ? t("删除这个生成视频？如果已保存到灵感库，灵感库中的案例不会删除。")
    : t("删除这张生成结果？如果已保存到灵感库，灵感库中的案例不会删除。");
  if (!await confirmAppAction({ title: t("删除生成结果？"), description: confirmation, confirmLabel: t("删除"), danger: true })) return false;
  if (button) button.disabled = true;
  try {
    const response = await chrome.runtime.sendMessage({ type: "DELETE_CREATIVE_OUTPUT", runId, visualId });
    if (!response?.ok) throw new Error(response?.message || t("移除失败"));
    creativeRuns = response.creativeRuns ?? creativeRuns;
    composerFeedback(response.message);
    renderTimeline();
    return true;
  } finally {
    if (button) button.disabled = false;
  }
}

async function loadCreativeOutputImage(image, visualId) {
  try {
    let url = thumbnailUrls.get(`creative:${visualId}`);
    if (!url) {
      const blob = await getScreenshotBlob(visualId);
      if (!blob) return;
      url = URL.createObjectURL(blob);
      thumbnailUrls.set(`creative:${visualId}`, url);
    }
    image.src = url;
  } catch {}
}

async function loadCreativeOutputVideo(video, visual) {
  try {
    const key = `creative:${visual.id}`;
    let url = thumbnailUrls.get(key);
    if (!url) {
      const blob = await getMediaBlob(visual.id);
      if (!(blob instanceof Blob)) return;
      url = URL.createObjectURL(blob);
      thumbnailUrls.set(key, url);
    }
    video.src = url;
    const posterBlob = (visual.posterAssetId ? await getMediaBlob(visual.posterAssetId) : null)
      ?? (await getDerivedMedia(visual.id).catch(() => null))?.thumbnail;
    if (posterBlob instanceof Blob) {
      const posterKey = `creative-poster:${visual.id}`;
      let posterUrl = thumbnailUrls.get(posterKey);
      if (!posterUrl) {
        posterUrl = URL.createObjectURL(posterBlob);
        thumbnailUrls.set(posterKey, posterUrl);
      }
      video.poster = posterUrl;
    }
  } catch {}
}

function creativeCheckLabel(status) {
  return t({
    met: "符合",
    partial: "部分符合",
    missed: "未实现",
    conflict: "存在冲突",
    unknown: "无法判断"
  }[status] || "无法判断");
}

async function savePromptVersion(sessionId, version, button) {
  button.disabled = true;
  try {
    const response = await chrome.runtime.sendMessage({
      type: "SAVE_COMPOSER_RESULT",
      sessionId,
      promptVersionId: version.id,
      title: version.title || composerSession.title
    });
    if (!response?.ok) throw new Error(response?.message || t("保存失败"));
    composerFeedback(response.message || t("已保存为新案例"));
  } catch (error) {
    composerFeedback(error.message || t("保存失败"), true);
  } finally {
    button.disabled = false;
  }
}

function renderSendState() {
  if (!composerSession) return;
  renderComposerAiProfile();
  const prompts = composerSession.referenceSnapshots.filter((item) => item.referenceKind === "prompt").length;
  const descriptions = composerSession.referenceSnapshots.filter((item) => item.referenceKind === "vision").length;
  const images = composerSession.referenceSnapshots.reduce((sum, item) => sum + item.imageRefs.length, 0);
  const usage = composerInputUsage(composerSession, elements.composerInstruction.value, composerSettings);
  const service = selectedComposerService(activeComposerProfile(), composerAiSettings, composerVisionSettings);
  const callCount = composerSession.outputMode === "create_image" && service.serviceId === "compatible" && composerVisionSettings.compatible.imageGeneration.protocol === "images_generations" ? 3 : 2;
  const requestLabel = composerSession.outputMode === "create_video" ? "异步视频任务" : `${callCount} 次请求`;
  elements.composerSendNote.textContent = currentLocale() === "en"
    ? `${prompts} prompt originals · ${images} selected images · ${descriptions} visual descriptions · ${usage.characters.toLocaleString("en-US")} / ${usage.maxCharacters.toLocaleString("en-US")} characters · ${composerSession.outputMode === "create_video" ? "asynchronous video task" : `${callCount} requests`}`
    : `${prompts} 条提示词原文 · ${images} 张手选原图 · ${descriptions} 条画面描述 · ${usage.characters.toLocaleString("en-US")} / ${usage.maxCharacters.toLocaleString("en-US")} 字符 · ${requestLabel}`;
  elements.composerSendNote.classList.toggle("error", usage.overLimit);
  const currentRun = activeOperation?.kind === "compose" && activeOperation.sessionId === composerSession.id;
  if (currentRun) {
    elements.composerAction.dataset.state = activeOperation.phase === "stopping" ? "stopping" : "stop";
    elements.composerAction.disabled = false;
    elements.composerAction.setAttribute("aria-label", t(activeOperation.phase === "stopping" ? "正在停止" : "停止"));
    setUiIcon(elements.composerAction, activeOperation.phase === "stopping" ? "ellipsis" : "square");
  } else {
    elements.composerAction.dataset.state = "send";
    elements.composerAction.disabled = usage.overLimit || Boolean(activeOperation);
    elements.composerAction.setAttribute("aria-label", t("发送"));
    setUiIcon(elements.composerAction, "send");
  }
}

function operationLabel(phase) {
  const session = activeOperation?.session;
  const generationPhase = ["streaming", "stopping"].includes(phase) && ["create_image", "create_video"].includes(session?.outputMode);
  const profile = generationPhase ? session?.generationAiProfile : session?.aiProfile;
  const service = selectedComposerService(profile, composerAiSettings, composerVisionSettings).shortLabel;
  return ({
    planning: t("{service} 正在规划", { service }),
    streaming: routeOperationLabel(activeOperation?.executionRoute || activeOperation?.session?.currentRoute),
    stopping: t("正在停止 {service}", { service })
  })[phase] || t("{service} 正在处理", { service });
}

function routeOperationLabel(route) {
  const session = activeOperation?.session;
  const profile = ["create_image", "create_video"].includes(session?.outputMode)
    ? session?.generationAiProfile
    : session?.aiProfile;
  const service = selectedComposerService(profile, composerAiSettings, composerVisionSettings).shortLabel;
  if (route === "analyze_materials") return t("{service} 正在分析资料", { service });
  if (route === "chat") return t("{service} 正在回答", { service });
  if (activeOperation?.session?.outputMode === "create_video") return t("{service} 正在创建视频", { service });
  return activeOperation?.session?.outputMode === "create_image"
    ? t("{service} 正在创建图片", { service })
    : t("{service} 正在生成", { service });
}

function referenceAliasButton(reference) {
  const button = el("button", "button-secondary composer-input-reference-card");
  button.type = "button";
  const entry = entries.find((item) => item.id === reference.entryId);
  const mediaEntry = entry ? normalizeEntryMedia(entry) : null;
  const mainMedia = mediaEntry ? primaryMediaAsset(mediaEntry) : null;
  const referenceMedia = mediaEntry?.mediaAssets?.find((asset) => asset.id === reference.assetId)
    ?? mediaEntry?.mediaAssets?.find((asset) => reference.imageRefs?.some((imageRef) => imageRef.visualId === asset.id))
    ?? mainMedia;
  const displayAsset = referenceMedia?.kind === "video"
    ? posterAssetForVideo(mediaEntry, referenceMedia)
    : referenceMedia?.kind === "image" ? referenceMedia : entry ? primaryVisual(entry) : null;
  const visual = el("span", "composer-input-reference-visual");
  if (displayAsset) {
    const image = document.createElement("img");
    image.alt = "";
    image.dataset.visualId = displayAsset.id;
    const cached = thumbnailUrls.get(displayAsset.id);
    if (cached) image.src = cached;
    else imageObserver.observe(image);
    visual.append(image);
  } else visual.append(rawTextEl("span", "", referenceTypeLabel(reference, referenceMedia)));
  const copy = el("span", "composer-input-reference-copy");
  copy.append(rawTextEl("small", "", reference.alias), rawTextEl("strong", "", reference.title || t("未命名案例")));
  button.append(visual, copy);
  button.title = `${reference.alias} · ${reference.title || t("未命名案例")}`;
  button.addEventListener("click", () => insertComposerAlias(reference.alias));
  return button;
}

function renderRetrievedSources() {
  const sources = composerSession?.retrievedSources ?? [];
  elements.composerRetrievalSources.hidden = sources.length === 0;
  const sourceItems = sources.map((source) => {
    const item = el("span", "composer-retrieved-source");
    item.append(rawTextEl("small", "", retrievedSourceRole(source.role)), rawTextEl("strong", "", source.title || source.alias));
    const remove = rawTextEl("button", "icon-button", "×");
    remove.type = "button";
    remove.disabled = Boolean(activeOperation);
    remove.setAttribute("aria-label", translateUiMessage(`移除检索来源：${source.title || source.alias}`));
    remove.addEventListener("click", () => safely(() => removeRetrievedSource(source.entryId))());
    item.append(remove);
    return item;
  });
  elements.composerRetrievalSources.replaceChildren(...sourceItems);
}

async function removeRetrievedSource(entryId) {
  if (!composerSession || activeOperation) return;
  composerSession = createComposerSession({
    ...composerSession,
    retrievedSources: composerSession.retrievedSources.filter((item) => item.entryId !== entryId)
  });
  composerSession = await saveSession(composerSession);
  reuseRetrievedSourcesNextTurn = true;
  renderComposer();
  composerFeedback(t("已移除本轮检索来源"));
}

function createRetrievedSourceSnapshot(sourcesValue) {
  const sources = Array.isArray(sourcesValue) ? sourcesValue : [];
  if (!sources.length) return null;
  const snapshot = el("section", "composer-version-sources");
  snapshot.append(rawTextEl("small", "composer-version-sources-label", t("本轮采用的本地来源")));
  const list = el("div", "composer-version-source-list");
  list.append(...sources.map((source) => {
    const item = el("span", "composer-version-source");
    item.append(rawTextEl("small", "", retrievedSourceRole(source.role)), rawTextEl("strong", "", source.title || source.alias));
    return item;
  }));
  snapshot.append(list);
  return snapshot;
}

function retrievedSourceRole(role) {
  return ({ case: t("案例"), guide: t("攻略教程") })[role] || t("资料");
}

function referenceTypeLabel(reference, media) {
  if (media?.kind === "video") return "VIDEO";
  if (media?.kind === "document") return media.mimeType === "application/pdf" ? "PDF" : "DOC";
  return reference.referenceKind === "vision" ? "IMAGE" : "TEXT";
}

function insertComposerAlias(alias) {
  const input = elements.composerInstruction;
  const before = input.value.slice(0, input.selectionStart);
  const after = input.value.slice(input.selectionEnd);
  const separator = before && !/\s$/.test(before) ? " " : "";
  input.value = `${before}${separator}${alias} ${after}`;
  const cursor = before.length + separator.length + alias.length + 1;
  input.setSelectionRange(cursor, cursor);
  resizeComposerInput();
  input.focus();
}

function composerFeedback(message, error = false) {
  clearTimeout(feedbackTimer);
  const target = activeComposerFeedbackElement();
  for (const element of composerFeedbackElements()) {
    if (element !== target) {
      element.textContent = "";
      element.classList.remove("error");
    }
  }
  target.textContent = translateUiMessage(String(message ?? ""));
  target.classList.toggle("error", error);
  if (message && !error && !activeOperation) feedbackTimer = setTimeout(() => {
    target.textContent = "";
    target.classList.remove("error");
  }, 5000);
}

function activeComposerFeedbackElement() {
  if (!elements.composerReferenceWorkspace.hidden) return elements.composerReferenceFeedback;
  return elements.composerFeedback;
}

function composerFeedbackElements() {
  return [elements.composerFeedback, elements.composerReferenceFeedback];
}

function clearComposerFeedback() {
  clearTimeout(feedbackTimer);
  feedbackTimer = 0;
  for (const element of composerFeedbackElements()) {
    element.textContent = "";
    element.classList.remove("error");
  }
}

function safely(action) {
  return (...args) => {
    Promise.resolve(action(...args)).catch((error) => composerFeedback(error.message || t("操作失败"), true));
  };
}

function resizeComposerInput() {
  const input = elements.composerInstruction;
  input.style.height = "auto";
  input.style.height = `${Math.min(input.scrollHeight, 220)}px`;
}

function selectedTargetType() {
  return document.querySelector('input[name="composer-type"]:checked')?.value === "video" ? "video" : "image";
}

function sessionSummaryFromCurrent() {
  if (!composerSession || !isMeaningfulComposerSession(composerSession)) return null;
  return {
    id: composerSession.id,
    title: composerSession.title,
    targetType: composerSession.targetType,
    updatedAt: composerSession.updatedAt,
    referenceCount: composerSession.referenceSnapshots.length,
    hasPrompt: composerSession.promptVersions.length > 0
  };
}

function conversationTitle(instruction) {
  const firstLine = String(instruction ?? "").split(/\r?\n/, 1)[0];
  return excerpt(firstLine, COMPOSER_TITLE_MAX_CHARACTERS) || (composerSession?.targetType === "video" ? t("未命名视频提示词") : t("未命名图片提示词"));
}

function uniqueIds(values) {
  return [...new Set(values.map((value) => String(value ?? "").trim()).filter(Boolean))];
}

function excerpt(value, length) {
  const text = String(value ?? "").replace(/\s+/g, " ").trim();
  return text.length > length ? `${text.slice(0, length).trim()}…` : text;
}

function relativeTime(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString(currentLocale() === "en" ? "en" : "zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

async function prepareSelectedReferenceImages(session) {
  const profile = ["create_image", "create_video"].includes(session?.outputMode) ? session?.generationAiProfile : session?.aiProfile;
  const service = selectedComposerService(profile, composerAiSettings, composerVisionSettings);
  if (!service.vision) return [];
  const temporaryAssetIds = new Set((session?.referenceSnapshots ?? [])
    .filter((reference) => reference.sourceType === TEMP_REFERENCE_SOURCE_TYPES.temporary)
    .flatMap((reference) => reference.assetRefs ?? [])
    .filter((asset) => asset.kind === "image")
    .map((asset) => asset.assetId));
  const refs = [...new Map((session?.referenceSnapshots ?? [])
    .flatMap((reference) => reference.imageRefs ?? [])
    .map((item) => [item.visualId, item])).values()];
  return Promise.all(refs.map(async (imageRef) => {
    const blob = temporaryAssetIds.has(imageRef.visualId)
      ? await getMediaBlob(imageRef.visualId)
      : await getScreenshotBlob(imageRef.visualId);
    if (!blob) throw new ComposerServiceError("有一张手选内容图已不存在，本次没有发送不完整参考", 422, { retryable: true });
    const derived = temporaryAssetIds.has(imageRef.visualId) && blob.type === "image/gif"
      ? await getDerivedMedia(imageRef.visualId)
      : null;
    const preparedBlob = derived?.thumbnail instanceof Blob ? derived.thumbnail : blob;
    return {
      visualId: imageRef.visualId,
      mimeType: preparedBlob.type,
      dataUrl: await blobToDataUrl(preparedBlob)
    };
  }));
}

async function persistGeneratedImages(session, promptVersionId, imageResults, generation = {}) {
  if (!promptVersionId) throw new Error("生成图片缺少对应的提示词版本");
  const savedIds = [];
  try {
    const visuals = [];
    for (const item of Array.isArray(imageResults) ? imageResults : []) {
      const blob = item?.blob;
      if (!(blob instanceof Blob) || !blob.type.startsWith("image/") || !blob.size) throw new Error("生图服务没有返回有效图片");
      const { width, height } = await readImageDimensions(blob);
      assertImageDimensions(width, height);
      const id = crypto.randomUUID();
      await saveScreenshotBlob(id, blob);
      savedIds.push(id);
      visuals.push({
        id,
        kind: "image",
        usage: "content",
        storageMode: "managed",
        mimeType: blob.type,
        width,
        height,
        byteSize: blob.size,
        capturedAt: new Date().toISOString(),
        reviewStatus: "unverified"
      });
    }
    if (!visuals.length) throw new Error("生图服务没有返回图片");
    const response = await chrome.runtime.sendMessage({
      type: "REGISTER_GENERATED_OUTPUTS",
      sessionId: session.id,
      promptVersionId,
      visuals,
      generation
    });
    if (!response?.ok) throw new Error(response?.message || "生成结果登记失败");
    return response.creativeRuns ?? creativeRuns;
  } catch (error) {
    await Promise.allSettled(savedIds.map((id) => deleteScreenshotBlob(id)));
    throw error;
  }
}

async function privateComposerServiceSettings() {
  const response = await chrome.runtime.sendMessage({ type: "GET_COMPOSER_AI_RUNTIME" });
  if (!response?.ok) throw new Error(response?.message || "无法读取创作服务配置");
  composerAiRuntimeProtocolVersion = Number(response.aiRuntimeProtocolVersion) || null;
  composerAiTaskAssignments = response.aiTaskAssignments ?? {};
  return {
    ai: normalizeAiSettings(response.aiSettings),
    vision: {
      ...normalizeVisionSettings(response.visionSettings),
      xai: response.visionSettings?.xai,
      providerProfiles: response.visionSettings?.providerProfiles
    }
  };
}

async function refreshComposerServiceSettings() {
  ({ ai: composerAiSettings, vision: composerVisionSettings } = await privateComposerServiceSettings());
  if (composerSession) renderComposer();
}

function camel(value) {
  return value.replace(/-([a-z])/g, (_match, letter) => letter.toUpperCase());
}

function el(tag, className = "") {
  const node = document.createElement(tag);
  if (className) node.className = className;
  return node;
}

function rawTextEl(tag, className, text) {
  const node = el(tag, className);
  node.textContent = String(text ?? "");
  return node;
}

function textEl(tag, className, text) {
  return rawTextEl(tag, className, t(text));
}
