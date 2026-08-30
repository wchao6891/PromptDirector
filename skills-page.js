import { DEFAULT_COMPOSER_REQUEST_TIMEOUT_MS, normalizeAiSettings } from "./deepseek.js";
import { normalizeComposerSettings, referenceSourcePartsForAsset } from "./composer.js";
import { requireAiRuntimeProtocolVersion } from "./ai-runtime.js";
import {
  currentCreativeSkillVersion,
  normalizeCreativeSkillsState
} from "./creative-skills.js";
import {
  buildProvenanceMarkdown,
  exportStoredSkillPackage,
  parseSkillArchive,
  parseSkillFiles
} from "./creative-skill-package.js";
import {
  buildCuratedSkillSnapshot,
  buildCuratedSkillSubmissionArchive
} from "./curated-skill-package.js";
import { CURATED_SKILL_SUBMISSION_URL } from "./curated-config.js";
import {
  analyzeCreativeSkillVisualBatch,
  anonymousSkillSources,
  defaultSkillExtractionInstruction,
  defaultSkillVisualInstruction,
  creativeRunEvidenceCandidates,
  selectedCreativeRunEvidenceSources,
  extractCreativeSkillDraftBatched,
  skillExtractionWorkload
} from "./creative-skill-service.js";
import {
  contactSheetPlan,
  renderContactSheetBatch,
  selectedSkillContentImages
} from "./skill-contact-sheet.js";
import {
  SKILL_SOURCE_BATCH_SIZE,
  availableSkillSourceAssets,
  cloneSkillSourceSelection,
  filterSkillSourceEntries,
  pageSkillSourceEntries,
  skillSourceSelectionSummary
} from "./skill-source-picker.js";
import {
  deleteMediaBlobs,
  getDerivedMedia,
  getMediaBlob,
  saveSkillPackageBlob
} from "./media-store.js";
import { entryMediaAssets, primaryImageAsset } from "./media.js";
import { renderMarkdownDocument } from "./markdown-renderer.js";
import { blobToDataUrl, normalizeVisionSettings } from "./vision.js";
import { currentLocale, initializeUi, t, translateUiMessage } from "./i18n.js";
import { confirmAppAction, showAppDialog } from "./ui-dialogs.js";
import {
  buildNavigationState,
  buildNavigationUrl,
  deriveNavigationSnapshot
} from "./navigation-state.js";
import { bindTransientMenus } from "./transient-menu.js";
import { collectionEntryIds, collectionSelectorLabelsById } from "./organizer.js";

await initializeUi();
bindTransientMenus(document, ".skill-detail-more, .skill-project-picker");

const CURATED_SKILL_PUBLISHER_STORAGE_KEY = "curatedSkillPublisher";

const elements = Object.fromEntries([
  "skill-search", "skill-import", "skill-create", "skill-context-back", "skill-zip-file", "skill-folder-files", "skill-library", "skill-summary", "skill-feedback", "skill-list", "skill-empty", "skill-empty-create",
  "skill-detail", "skill-detail-title", "skill-detail-call-name", "skill-detail-feedback", "skill-detail-description", "skill-detail-version", "skill-detail-source", "skill-detail-updated", "skill-detail-markdown", "skill-detail-edit", "skill-detail-more", "skill-detail-refine", "skill-export", "skill-submit-curated",
  "skill-workspace", "skill-workspace-kicker", "skill-workspace-title", "skill-delete", "skill-builder", "skill-source-sidebar", "skill-source-step", "skill-target-step", "skill-selected-count", "skill-project-picker", "skill-project-label", "skill-project-filter", "skill-case-search", "skill-clear-selection", "skill-visible-select", "skill-selection-summary", "skill-case-scroll", "skill-case-grid", "skill-case-load-more",
  "skill-run-evidence-step", "skill-run-evidence-count", "skill-run-evidence-list",
  "skill-goal", "skill-use-vision", "skill-vision-toggle-note", "skill-vision-preview", "skill-advanced", "skill-text-provider-menu", "skill-vision-provider-menu", "skill-text-instruction", "skill-vision-instruction", "skill-restore-instructions", "skill-request-preview", "skill-generate", "skill-retry-vision", "skill-run-panel", "skill-generation-status", "skill-run-elapsed", "skill-stop-run", "skill-run-progress", "skill-run-stages", "skill-run-log", "skill-generation-feedback", "skill-draft-step", "skill-draft-editor", "skill-version-label", "skill-call-name", "skill-description", "skill-markdown", "skill-save", "skill-test", "skill-save-status", "skill-versions-step", "skill-version-list",
  "skill-source-inspector-backdrop", "skill-source-inspector", "skill-source-inspector-title", "skill-source-inspector-close", "skill-source-select-all", "skill-source-clear", "skill-source-text-option", "skill-source-include-text", "skill-source-asset-list", "skill-source-cancel", "skill-source-apply",
  "skill-import-dialog", "skill-import-close", "skill-import-zip", "skill-import-folder",
  "skill-submission-dialog", "skill-submission-close", "skill-submission-author", "skill-submission-author-error", "skill-submission-summary", "skill-submission-summary-error", "skill-submission-rights", "skill-submission-rights-error", "skill-submission-refresh", "skill-submission-open", "skill-submission-feedback", "skill-submission-findings", "skill-submission-preview"
].map((id) => [camel(id), document.querySelector(`#${id}`)]));

let entries = [];
let organizerState = { collections: [] };
let creativeSkills = normalizeCreativeSkillsState();
let creativeRuns = [];
let activeView = "list";
let sourcePage = "library";
let activeSkillId = "";
let selectedEntryIds = new Set();
let sourceSelections = new Map();
let selectedEvidenceIds = new Set();
let visibleEntryIds = [];
let selectedProjectId = "";
let inspectedEntryId = "";
let inspectorDraftSelection = null;
let inspectorReturnFocus = null;
let renderedSourceCount = SKILL_SOURCE_BATCH_SIZE;
let thumbnailUrls = new Map();
let visualSuccesses = [];
let visualFailures = [];
let pendingAfterVision = false;
let runtimeOverrides = { text: null, vision: null };
let skillRuntimeSettings = null;
let activeSkillRun = null;
let visionPreferenceTouched = false;
let curatedSubmissionSnapshot = null;

bindEvents();
await refreshState();
initializeNavigation();

function bindEvents() {
  elements.skillSearch.addEventListener("input", renderSkillList);
  elements.skillCreate.addEventListener("click", () => navigateTo("create"));
  elements.skillEmptyCreate.addEventListener("click", () => navigateTo("create"));
  elements.skillContextBack.addEventListener("click", () => safely(navigateBack)());
  elements.skillDetailEdit.addEventListener("click", () => navigateTo("editor", activeSkillId));
  elements.skillDetailRefine.addEventListener("click", () => navigateTo("refine", activeSkillId));
  elements.skillExport.addEventListener("click", () => safely(exportSkill)());
  elements.skillSubmitCurated.addEventListener("click", () => runCuratedSubmissionAction(openCuratedSubmission));
  elements.skillImport.addEventListener("click", () => elements.skillImportDialog.showModal());
  elements.skillImportClose.addEventListener("click", () => elements.skillImportDialog.close());
  elements.skillImportZip.addEventListener("click", () => elements.skillZipFile.click());
  elements.skillImportFolder.addEventListener("click", () => elements.skillFolderFiles.click());
  elements.skillZipFile.addEventListener("change", () => safely(importZip)());
  elements.skillFolderFiles.addEventListener("change", () => safely(importFolder)());
  elements.skillSubmissionClose.addEventListener("click", () => elements.skillSubmissionDialog.close());
  elements.skillSubmissionRefresh.addEventListener("click", () => runCuratedSubmissionAction(refreshCuratedSubmission));
  elements.skillSubmissionOpen.addEventListener("click", () => runCuratedSubmissionAction(downloadCuratedSubmission));
  for (const field of [
    elements.skillSubmissionAuthor,
    elements.skillSubmissionSummary,
    elements.skillSubmissionRights
  ]) field.addEventListener("input", invalidateCuratedSubmission);
  elements.skillCaseSearch.addEventListener("input", () => renderCases({ reset: true }));
  elements.skillClearSelection.addEventListener("click", clearAllSourceSelections);
  elements.skillVisibleSelect.addEventListener("click", toggleVisibleCases);
  elements.skillCaseLoadMore.addEventListener("click", loadMoreSourceCases);
  elements.skillGoal.addEventListener("input", renderRequestPreview);
  elements.skillUseVision.addEventListener("change", () => { visionPreferenceTouched = true; renderVisionPreview(); renderRequestPreview(); });
  elements.skillTextInstruction.addEventListener("input", renderRequestPreview);
  elements.skillVisionInstruction.addEventListener("input", renderRequestPreview);
  elements.skillRestoreInstructions.addEventListener("click", restoreDefaultInstructions);
  elements.skillGenerate.addEventListener("click", () => safely(generateDraft)());
  elements.skillRetryVision.addEventListener("click", () => safely(retryVisualFailures)());
  elements.skillStopRun.addEventListener("click", stopSkillRun);
  elements.skillSourceInspectorClose.addEventListener("click", cancelSourceInspector);
  elements.skillSourceInspectorBackdrop.addEventListener("click", cancelSourceInspector);
  elements.skillSourceSelectAll.addEventListener("click", selectAllInspectedSource);
  elements.skillSourceClear.addEventListener("click", clearInspectedSource);
  elements.skillSourceIncludeText.addEventListener("change", updateInspectedTextSelection);
  elements.skillSourceCancel.addEventListener("click", cancelSourceInspector);
  elements.skillSourceApply.addEventListener("click", applySourceInspector);
  elements.skillSave.addEventListener("click", () => safely(saveSkill)());
  elements.skillTest.addEventListener("click", () => safely(testSkill)());
  elements.skillDelete.addEventListener("click", () => safely(deleteSkill)());
  addEventListener("popstate", renderLocation);
  addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !elements.skillSourceInspector.hidden) cancelSourceInspector();
  });
  addEventListener("beforeunload", () => { activeSkillRun?.controller.abort(); releaseThumbnails(); });
}

async function refreshState() {
  const response = await chrome.runtime.sendMessage({ type: "GET_STATE" });
  if (!response?.ok) throw new Error(response?.message || t("无法读取 Skill 资料"));
  entries = Array.isArray(response.entries) ? response.entries : [];
  organizerState = response.organizerState ?? organizerState;
  creativeSkills = normalizeCreativeSkillsState(response.creativeSkills);
  creativeRuns = Array.isArray(response.creativeRuns) ? response.creativeRuns : [];
  if (activeView === "list") renderSkillList();
  else renderRoute({ view: activeView, skillId: activeSkillId });
}

function renderSkillList() {
  const query = elements.skillSearch.value.trim().toLocaleLowerCase();
  const skills = creativeSkills.items.filter((skill) => !query || `${skill.callName}\n${skill.description}`.toLocaleLowerCase().includes(query));
  elements.skillSummary.textContent = t("{count} 个 Skill", { count: creativeSkills.items.length });
  elements.skillList.replaceChildren(...skills.map(skillCard));
  elements.skillEmpty.hidden = creativeSkills.items.length !== 0;
}

function skillCard(skill) {
  const version = currentCreativeSkillVersion(skill);
  const button = el("button", "skill-card");
  button.type = "button";
  const header = el("header");
  const title = el("div");
  title.append(textEl("h2", skill.callName), textEl("code", `/${skill.callName}`));
  header.append(title, textEl("span", `v${versionNumber(skill, version.id)}`));
  const footer = el("footer");
  footer.append(textEl("span", skill.sourceLabel || (version.source === "imported" ? t("外部包") : "PromptDirector")), textEl("time", formatDate(skill.updatedAt)));
  button.append(header, textEl("p", skill.description || t("暂无说明")), footer);
  button.addEventListener("click", () => navigateTo("detail", skill.id));
  return button;
}

function initializeNavigation() {
  const snapshot = deriveNavigationSnapshot({
    stateKey: "skillPage",
    historyState: history.state,
    locationSearch: location.search,
    parseRoute: parseRouteFromLocation,
    normalizeRoute
  });
  sourcePage = snapshot.sourcePage;
  const route = snapshot.route;
  if (snapshot.replace) {
    history.replaceState(buildNavigationState({
      stateKey: "skillPage",
      route,
      sourcePage,
      depth: snapshot.depth
    }), "", routeUrl(route));
  }
  renderRoute(route);
}

function navigateTo(view, skillId = "", options = {}) {
  const route = normalizeRoute({ view, skillId });
  const depth = options.replace ? (history.state?.depth ?? 0) : (history.state?.depth ?? 0) + 1;
  history[options.replace ? "replaceState" : "pushState"](buildNavigationState({
    stateKey: "skillPage",
    route,
    sourcePage,
    depth
  }), "", routeUrl(route));
  renderRoute(route);
}

async function navigateBack() {
  const depth = Number(history.state?.depth) || 0;
  if (activeView === "list") return returnToSource();
  if (depth > 0) return history.back();
  const fallback = activeView === "editor" || activeView === "refine"
    ? { view: "detail", skillId: activeSkillId }
    : { view: "list", skillId: "" };
  navigateTo(fallback.view, fallback.skillId, { replace: true });
}

function returnToSource() {
  const url = new URL(chrome.runtime.getURL(sourcePage === "composer" ? "composer.html" : "library.html"));
  const sessionId = new URLSearchParams(location.search).get("session");
  if (sourcePage === "composer" && sessionId) url.searchParams.set("session", sessionId);
  location.assign(url.href);
}

function renderLocation() {
  const snapshot = deriveNavigationSnapshot({
    stateKey: "skillPage",
    historyState: history.state,
    locationSearch: location.search,
    parseRoute: parseRouteFromLocation,
    normalizeRoute
  });
  sourcePage = snapshot.sourcePage;
  if (snapshot.replace) {
    history.replaceState(buildNavigationState({
      stateKey: "skillPage",
      route: snapshot.route,
      sourcePage,
      depth: snapshot.depth
    }), "", routeUrl(snapshot.route));
  }
  renderRoute(snapshot.route);
}

function parseRouteFromLocation(search) {
  const params = new URLSearchParams(search);
  return { view: params.get("view"), skillId: params.get("skill") };
}

function normalizeRoute(value = {}) {
  const skillId = String(value.skillId ?? "");
  const hasSkill = creativeSkills.items.some((item) => item.id === skillId);
  if (value.view === "create") return { view: "create", skillId: "" };
  if (hasSkill && ["detail", "editor", "refine"].includes(value.view)) return { view: value.view, skillId };
  if (hasSkill) return { view: "detail", skillId };
  return { view: "list", skillId: "" };
}

function routeUrl(route) {
  return buildNavigationUrl(location.href, { route, sourcePage });
}

function renderRoute(route) {
  activeView = route.view;
  activeSkillId = route.skillId;
  document.body.dataset.skillView = route.view;
  const listView = route.view === "list";
  elements.skillSearch.hidden = !listView;
  elements.skillImport.hidden = !listView;
  elements.skillCreate.hidden = !listView;
  elements.skillDetailMore.open = false;
  elements.skillLibrary.hidden = route.view !== "list";
  elements.skillDetail.hidden = route.view !== "detail";
  elements.skillWorkspace.hidden = !["create", "editor", "refine"].includes(route.view);
  if (route.view === "list") {
    releaseThumbnails();
    renderSkillList();
  } else if (route.view === "detail") renderSkillDetail();
  else renderWorkspace(route.view, route.skillId);
  renderContextBack();
  scrollTo({ top: 0, behavior: "instant" });
}

function renderContextBack() {
  const labels = {
    list: sourcePage === "composer" ? t("返回创作台") : t("返回案例库"),
    detail: t("返回 Skill 列表"),
    create: t("返回 Skill 列表"),
    editor: t("返回 Skill 详情"),
    refine: t("返回 Skill 详情")
  };
  const label = labels[activeView] || t("返回 Skill 列表");
  elements.skillContextBack.setAttribute("aria-label", label);
  elements.skillContextBack.title = label;
  elements.skillContextBack.querySelector("span").textContent = label;
}

function renderSkillDetail() {
  releaseThumbnails();
  const skill = activeSkill();
  if (!skill) return navigateTo("list", "", { replace: true });
  const version = currentCreativeSkillVersion(skill);
  elements.skillDetailTitle.textContent = skill.callName;
  elements.skillDetailCallName.textContent = `/${skill.callName}`;
  elements.skillDetailDescription.textContent = skill.description || t("暂无说明");
  elements.skillDetailVersion.textContent = `v${versionNumber(skill, version.id)}`;
  elements.skillDetailSource.textContent = version.source === "imported" ? t("外部包") : "PromptDirector";
  elements.skillDetailUpdated.textContent = formatDate(skill.updatedAt);
  elements.skillDetailMarkdown.replaceChildren(renderMarkdownDocument(version.skillMarkdown));
  setFeedback(elements.skillDetailFeedback, "");
}

function renderWorkspace(view, skillId = "") {
  activeSkillId = skillId;
  selectedEntryIds = new Set();
  sourceSelections = new Map();
  selectedEvidenceIds = new Set();
  visibleEntryIds = [];
  selectedProjectId = "";
  inspectedEntryId = "";
  inspectorDraftSelection = null;
  inspectorReturnFocus = null;
  renderedSourceCount = SKILL_SOURCE_BATCH_SIZE;
  visualSuccesses = [];
  visualFailures = [];
  pendingAfterVision = false;
  runtimeOverrides = { text: null, vision: null };
  skillRuntimeSettings = null;
  visionPreferenceTouched = false;
  finishSkillRun();
  const skill = activeSkill();
  const selectingSources = view === "create" || view === "refine";
  elements.skillBuilder.dataset.mode = view;
  elements.skillSourceSidebar.hidden = !selectingSources;
  elements.skillSourceStep.hidden = !selectingSources;
  elements.skillTargetStep.hidden = !selectingSources;
  elements.skillWorkspaceKicker.textContent = view === "create" ? t("新建 Skill") : view === "refine" ? t("从案例重新提炼") : t("编辑");
  elements.skillWorkspaceTitle.textContent = skill ? skill.callName : t("创建创作 Skill");
  elements.skillDelete.hidden = !skill;
  elements.skillGoal.value = "";
  elements.skillCaseSearch.value = "";
  elements.skillUseVision.checked = false;
  restoreDefaultInstructions();
  if (selectingSources) {
    renderProjectControls();
    renderCases({ reset: true });
  }
  renderRunEvidence(view);
  if (skill) {
    const version = currentCreativeSkillVersion(skill);
    elements.skillCallName.value = skill.callName;
    elements.skillDescription.value = skill.description;
    elements.skillMarkdown.value = version.skillMarkdown;
    elements.skillDraftStep.hidden = false;
    elements.skillDraftEditor.open = view === "editor";
    elements.skillVersionsStep.hidden = false;
    elements.skillVersionLabel.textContent = t("当前 v{version}", { version: versionNumber(skill, version.id) });
    renderVersions(skill);
  } else {
    elements.skillCallName.value = "";
    elements.skillDescription.value = "";
    elements.skillMarkdown.value = "";
    elements.skillDraftStep.hidden = true;
    elements.skillDraftEditor.open = false;
    elements.skillVersionsStep.hidden = true;
  }
  setFeedback(elements.skillGenerationStatus, "");
  setFeedback(elements.skillGenerationFeedback, "");
  setFeedback(elements.skillSaveStatus, "");
  if (selectingSources) prepareSkillRuntimeControls();
}

function renderRunEvidence(view = activeView) {
  const candidates = view === "refine" ? creativeRunEvidenceCandidates(creativeRuns, activeSkillId) : [];
  elements.skillRunEvidenceStep.hidden = view !== "refine" || candidates.length === 0;
  elements.skillRunEvidenceCount.textContent = String(selectedEvidenceIds.size);
  elements.skillRunEvidenceList.replaceChildren(...candidates.map((item) => {
    const label = el("label", "skill-run-evidence");
    const input = document.createElement("input");
    input.type = "checkbox";
    input.checked = selectedEvidenceIds.has(item.id);
    const copy = el("span");
    copy.append(
      textEl("strong", item.title || t("未命名创作运行")),
      textEl("small", [item.keep ? `${t("值得保留")}：${item.keep}` : "", item.improve ? `${t("需要改进")}：${item.improve}` : ""].filter(Boolean).join(" · "))
    );
    input.addEventListener("change", () => {
      input.checked ? selectedEvidenceIds.add(item.id) : selectedEvidenceIds.delete(item.id);
      elements.skillRunEvidenceCount.textContent = String(selectedEvidenceIds.size);
    });
    label.append(input, copy);
    return label;
  }));
}

function renderProjectControls() {
  const selectorLabelsByProject = collectionSelectorLabelsById(organizerState);
  const options = [["", t("全部项目")], ...organizerState.collections.map((project) => [
    project.id,
    selectorLabelsByProject.get(project.id)
  ])];
  if (!options.some(([value]) => value === selectedProjectId)) selectedProjectId = "";
  elements.skillProjectLabel.textContent = options.find(([value]) => value === selectedProjectId)?.[1] || t("全部项目");
  elements.skillProjectFilter.replaceChildren(...options.map(([value, name]) => {
    const button = textEl("button", name);
    button.type = "button";
    button.setAttribute("role", "option");
    button.setAttribute("aria-selected", String(value === selectedProjectId));
    button.addEventListener("click", () => {
      selectedProjectId = value;
      elements.skillProjectPicker.open = false;
      renderProjectControls();
      renderCases({ reset: true });
    });
    return button;
  }));
}

function renderCases(options = {}) {
  releaseThumbnails();
  const projectId = selectedProjectId;
  const members = projectId ? new Set(collectionEntryIds(organizerState, projectId, { subtree: true })) : null;
  const visible = filterSkillSourceEntries(entries, {
    projectEntryIds: members,
    query: elements.skillCaseSearch.value
  });
  if (options.reset) {
    renderedSourceCount = SKILL_SOURCE_BATCH_SIZE;
    elements.skillCaseScroll.scrollTop = 0;
  }
  visibleEntryIds = visible.map((entry) => entry.id);
  const rendered = pageSkillSourceEntries(visible, renderedSourceCount);
  elements.skillCaseGrid.replaceChildren(...rendered.map(caseCard));
  elements.skillCaseLoadMore.hidden = rendered.length >= visible.length;
  elements.skillCaseLoadMore.textContent = t("加载更多案例（已显示 {shown}/{total}）", {
    shown: rendered.length,
    total: visible.length
  });
  renderSourceSelectionSummary();
  renderVisibleSelectionAction();
}

function loadMoreSourceCases() {
  renderedSourceCount += SKILL_SOURCE_BATCH_SIZE;
  renderCases();
}

function toggleVisibleCases() {
  const allSelected = visibleEntryIds.length > 0 && visibleEntryIds.every((id) => selectedEntryIds.has(id));
  for (const id of visibleEntryIds) {
    if (allSelected) removeSourceSelection(id);
    else if (!selectedEntryIds.has(id)) selectSourceDefaults(entries.find((entry) => entry.id === id));
  }
  renderCases();
  renderVisionPreview();
}

function clearAllSourceSelections() {
  sourceSelections.clear();
  selectedEntryIds.clear();
  closeSourceInspector();
  renderCases();
  renderVisionPreview();
  renderRequestPreview();
}

function renderVisibleSelectionAction() {
  const allSelected = visibleEntryIds.length > 0 && visibleEntryIds.every((id) => selectedEntryIds.has(id));
  elements.skillVisibleSelect.disabled = visibleEntryIds.length === 0;
  elements.skillVisibleSelect.textContent = allSelected ? t("取消当前结果") : t("全选当前结果");
}

function caseCard(entry) {
  const card = el("article", "skill-case");
  card.dataset.selected = String(selectedEntryIds.has(entry.id));
  const button = el("button", "skill-case-toggle");
  button.type = "button";
  button.setAttribute("aria-pressed", String(selectedEntryIds.has(entry.id)));
  button.setAttribute("aria-label", entry.title || t("未命名案例"));
  const visual = el("span", "skill-case-visual");
  const asset = primaryImageAsset(entry);
  if (asset) {
    const image = document.createElement("img");
    image.alt = "";
    image.loading = "lazy";
    hydrateThumbnail(image, asset.id);
    visual.append(image);
  } else {
    const kind = availableSkillAssets(entry)[0]?.kind;
    visual.append(textEl("span", kind === "video" ? t("视频") : kind === "document" ? t("文档") : t("文字")));
  }
  const selectedState = textEl("span", "✓");
  selectedState.className = "skill-case-state";
  visual.append(selectedState);
  const copy = el("span", "skill-case-copy");
  copy.append(
    textEl("strong", entry.title || excerpt(entry.text, 48) || t("未命名案例")),
    textEl("small", sourceCompositionLabel(entry))
  );
  button.append(visual, copy);
  button.addEventListener("click", () => {
    selectedEntryIds.has(entry.id) ? removeSourceSelection(entry.id) : selectSourceDefaults(entry);
    card.dataset.selected = String(selectedEntryIds.has(entry.id));
    button.setAttribute("aria-pressed", String(selectedEntryIds.has(entry.id)));
    renderCaseState(card, entry);
    renderSourceSelectionSummary();
    renderVisibleSelectionAction();
    renderVisionPreview();
    renderRequestPreview();
  });
  card.append(button);
  const assets = availableSkillAssets(entry);
  if (assets.length > 1 || String(entry.text ?? "").trim() || hasSelectableVideoSources(entry, assets)) {
    const details = textEl("button", sourceSelectionCountLabel(entry));
    details.type = "button";
    details.className = "skill-case-detail";
    details.setAttribute("aria-label", t("精确选择 {title} 的内容", { title: entry.title || t("未命名案例") }));
    details.addEventListener("click", () => openSourceInspector(entry.id, details));
    card.append(details);
  }
  renderCaseState(card, entry);
  return card;
}

function hasSelectableVideoSources(entry, assets = availableSkillAssets(entry)) {
  return assets.some((asset) => asset.kind === "video" && (
    referenceSourcePartsForAsset(entry, asset.id).length > 1 ||
    (entry.videoAnalyses ?? []).some((analysis) => String(analysis?.assetId ?? "") === asset.id)
  ));
}

function renderCaseState(card, entry) {
  card.dataset.selected = String(selectedEntryIds.has(entry.id));
  const state = card.querySelector(".skill-case-state");
  if (state) state.hidden = !selectedEntryIds.has(entry.id);
  const detail = card.querySelector(".skill-case-detail");
  if (detail) detail.textContent = sourceSelectionCountLabel(entry);
}

function availableSkillAssets(entry) {
  return availableSkillSourceAssets(entry);
}

function selectSourceDefaults(entry) {
  if (!entry) return;
  sourceSelections.set(entry.id, defaultSourceSelection(entry));
  selectedEntryIds.add(entry.id);
}

function defaultSourceSelection(entry) {
  const assets = availableSkillAssets(entry);
  const primary = assets.find((asset) => asset.id === entry.primaryMediaId) ?? assets[0];
  const selectedAssetIds = primary ? new Set([primary.id]) : new Set();
  return {
    entryId: entry.id,
    includeEntryText: primary?.kind !== "video" && Boolean(String(entry.text ?? "").trim()),
    assetIds: selectedAssetIds,
    sourceIds: defaultVideoSourceIds(entry, selectedAssetIds),
    analysisIds: new Set()
  };
}

function removeSourceSelection(entryId) {
  sourceSelections.delete(entryId);
  selectedEntryIds.delete(entryId);
  if (inspectedEntryId === entryId) closeSourceInspector();
}

function sourceSelectionSnapshots() {
  return [...sourceSelections.values()].map((selection) => ({
    entryId: selection.entryId,
    includeEntryText: selection.includeEntryText,
    assetIds: [...selection.assetIds],
    sourceIds: selection.sourceIds === null ? null : [...selection.sourceIds],
    analysisIds: [...(selection.analysisIds ?? [])]
  }));
}

function sourceSelectionCountLabel(entry) {
  const selection = sourceSelections.get(entry.id);
  const total = availableSkillAssets(entry).length + (String(entry.text ?? "").trim() ? 1 : 0);
  if (!selection) return total > 1 ? t("{count} 项内容", { count: total }) : t("查看内容");
  const selected = selection.assetIds.size + (selection.includeEntryText ? 1 : 0);
  return t("已选 {selected}/{total}", { selected, total });
}

function sourceCompositionLabel(entry) {
  const assets = availableSkillAssets(entry);
  const images = assets.filter((asset) => asset.kind === "image").length;
  const videos = assets.filter((asset) => asset.kind === "video").length;
  const documents = assets.filter((asset) => asset.kind === "document").length;
  const parts = [
    images ? t("{count} 图", { count: images }) : "",
    videos ? t("{count} 视频", { count: videos }) : "",
    documents ? t("{count} 文档", { count: documents }) : "",
    String(entry.text ?? "").trim() ? t("案例文字") : ""
  ].filter(Boolean);
  return parts.join(" · ") || t("无可用内容");
}

function renderSourceSelectionSummary() {
  const summary = skillSourceSelectionSummary(entries, sourceSelections);
  elements.skillSelectedCount.textContent = String(summary.cases);
  elements.skillClearSelection.disabled = summary.cases === 0;
  if (!summary.cases) {
    elements.skillSelectionSummary.replaceChildren(
      textEl("strong", t("尚未选择案例")),
      textEl("span", t("选择案例后，可点击“内容”精确调整图片、视频、文档和文字。"))
    );
    return;
  }
  elements.skillSelectionSummary.replaceChildren(
    textEl("strong", t("已选 {count} 个案例", { count: summary.cases })),
    textEl("span", t("图片 {images} · 视频 {videos} · 文档 {documents} · 案例文字 {texts}", summary)),
    textEl("small", t("点击内容可精确调整"))
  );
}

function openSourceInspector(entryId, returnFocus = null) {
  const entry = entries.find((item) => item.id === entryId);
  if (!entry) return;
  inspectedEntryId = entryId;
  inspectorDraftSelection = cloneSkillSourceSelection(sourceSelections.get(entryId) ?? defaultSourceSelection(entry));
  inspectorReturnFocus = returnFocus;
  renderSourceInspector();
  elements.skillSourceInspector.hidden = false;
  elements.skillSourceInspectorBackdrop.hidden = false;
  elements.skillSourceInspectorClose.focus();
}

function closeSourceInspector() {
  inspectedEntryId = "";
  inspectorDraftSelection = null;
  elements.skillSourceInspector.hidden = true;
  elements.skillSourceInspectorBackdrop.hidden = true;
  inspectorReturnFocus?.focus();
  inspectorReturnFocus = null;
}

function cancelSourceInspector() {
  closeSourceInspector();
}

function applySourceInspector() {
  const entry = entries.find((item) => item.id === inspectedEntryId);
  if (!entry || !inspectorDraftSelection) return closeSourceInspector();
  if (inspectorDraftSelection.includeEntryText || inspectorDraftSelection.assetIds.size) {
    sourceSelections.set(entry.id, cloneSkillSourceSelection(inspectorDraftSelection));
    selectedEntryIds.add(entry.id);
  } else removeSourceSelection(entry.id);
  closeSourceInspector();
  renderCases();
  renderVisionPreview();
  renderRequestPreview();
}

function renderSourceInspector() {
  const entry = entries.find((item) => item.id === inspectedEntryId);
  const selection = inspectorDraftSelection;
  if (!entry || !selection) return closeSourceInspector();
  elements.skillSourceInspectorTitle.textContent = entry.title || t("未命名案例");
  const hasText = Boolean(String(entry.text ?? "").trim());
  elements.skillSourceTextOption.hidden = !hasText;
  elements.skillSourceIncludeText.checked = hasText && selection.includeEntryText;
  elements.skillSourceAssetList.replaceChildren(...availableSkillAssets(entry).flatMap((asset, index) => [
    sourceAssetOption(entry, asset, index),
    ...(asset.kind === "video" && selection.assetIds.has(asset.id) ? videoSourceOptions(entry, asset) : [])
  ]));
}

function sourceAssetOption(entry, asset, index) {
  const selection = inspectorDraftSelection;
  const row = el("label", "skill-source-asset");
  row.dataset.selected = String(selection.assetIds.has(asset.id));
  const preview = el("span", "skill-source-asset-preview");
  if (asset.kind === "image") {
    const image = document.createElement("img");
    image.alt = "";
    hydrateThumbnail(image, asset.id);
    preview.append(image);
  } else preview.textContent = asset.kind === "video" ? t("视频") : t("文档");
  const copy = el("span", "skill-source-asset-copy");
  copy.append(textEl("strong", `${asset.kind === "image" ? t("图片") : asset.kind === "video" ? t("视频") : t("文档")} ${index + 1}`), textEl("small", asset.sourceTitle || asset.mimeType || t("本地素材")));
  const input = document.createElement("input");
  input.type = "checkbox";
  input.checked = selection.assetIds.has(asset.id);
  input.addEventListener("change", () => {
    if (input.checked) {
      selection.assetIds.add(asset.id);
      if (asset.kind === "video") {
        if (selection.sourceIds === null) selection.sourceIds = new Set();
        referenceSourcePartsForAsset(entry, asset.id).forEach((source) => selection.sourceIds.add(source.id));
      }
    } else {
      selection.assetIds.delete(asset.id);
      if (asset.kind === "video") {
        const availableIds = new Set(referenceSourcePartsForAsset(entry, asset.id, {
          analysisIds: (entry.videoAnalyses ?? []).map((analysis) => analysis.id)
        }).map((source) => source.id));
        if (selection.sourceIds !== null) {
          for (const sourceId of availableIds) selection.sourceIds.delete(sourceId);
        }
        for (const analysis of entry.videoAnalyses ?? []) {
          if (String(analysis?.assetId ?? "") === asset.id) selection.analysisIds?.delete(String(analysis.id));
        }
      }
    }
    renderSourceInspector();
  });
  row.append(preview, copy, input);
  return row;
}

function videoSourceOptions(entry, asset) {
  const selection = inspectorDraftSelection;
  const allAnalysisIds = (Array.isArray(entry?.videoAnalyses) ? entry.videoAnalyses : [])
    .filter((analysis) => String(analysis?.assetId ?? "") === asset.id)
    .map((analysis) => String(analysis?.id ?? "")).filter(Boolean);
  const currentParts = referenceSourcePartsForAsset(entry, asset.id);
  const allParts = referenceSourcePartsForAsset(entry, asset.id, { analysisIds: allAnalysisIds });
  const defaultIds = new Set(currentParts.map((part) => part.id));
  return allParts.map((part) => {
    const row = el("label", "skill-source-asset");
    const preview = el("span", "skill-source-asset-preview");
    preview.textContent = t("来源");
    const short = part.kind === "original_prompt" && [...part.text.replace(/\s+/g, "")].length <= 3;
    const copy = el("span", "skill-source-asset-copy");
    copy.append(
      textEl("strong", part.label),
      textEl("small", short ? t("短内容 · 请确认是否保留") : excerpt(part.text, 80))
    );
    const input = document.createElement("input");
    input.type = "checkbox";
    input.checked = part.kind === "other_analysis"
      ? selection.analysisIds?.has(part.analysisId) === true
      : selection.sourceIds === null || selection.sourceIds.has(part.id);
    input.addEventListener("change", () => {
      if (part.kind === "other_analysis") {
        input.checked ? selection.analysisIds.add(part.analysisId) : selection.analysisIds.delete(part.analysisId);
      } else {
        if (selection.sourceIds === null) selection.sourceIds = new Set(defaultIds);
        input.checked ? selection.sourceIds.add(part.id) : selection.sourceIds.delete(part.id);
      }
      renderSourceInspector();
    });
    row.dataset.selected = String(input.checked);
    row.append(preview, copy, input);
    return row;
  });
}

function defaultVideoSourceIds(entry, assetIds) {
  const selected = assetIds instanceof Set ? assetIds : new Set(assetIds ?? []);
  return new Set(availableSkillAssets(entry).filter((asset) => asset.kind === "video" && selected.has(asset.id))
    .flatMap((asset) => referenceSourcePartsForAsset(entry, asset.id).map((source) => source.id)));
}

function updateInspectedTextSelection() {
  if (!inspectorDraftSelection) return;
  inspectorDraftSelection.includeEntryText = elements.skillSourceIncludeText.checked;
}

function selectAllInspectedSource() {
  const entry = entries.find((item) => item.id === inspectedEntryId);
  const selection = inspectorDraftSelection;
  if (!entry || !selection) return;
  selection.assetIds = new Set(availableSkillAssets(entry).map((asset) => asset.id));
  selection.sourceIds = defaultVideoSourceIds(entry, selection.assetIds);
  selection.analysisIds = new Set();
  if (String(entry.text ?? "").trim()) selection.includeEntryText = true;
  renderSourceInspector();
}

function clearInspectedSource() {
  const selection = inspectorDraftSelection;
  if (!selection) return;
  selection.assetIds.clear();
  selection.sourceIds = new Set();
  selection.analysisIds = new Set();
  selection.includeEntryText = false;
  renderSourceInspector();
}

async function hydrateThumbnail(image, assetId) {
  try {
    const blob = await getMediaBlob(assetId);
    if (!blob || !image.isConnected) return;
    const url = URL.createObjectURL(blob);
    thumbnailUrls.set(assetId, url);
    image.src = url;
  } catch {}
}

async function prepareSkillRuntimeControls() {
  try {
    skillRuntimeSettings = await getPrivateSettings({ allowUnconfiguredVision: true });
    renderRuntimeMenus(skillRuntimeSettings);
    const images = selectedSkillContentImages(entries, sourceSelectionSnapshots());
    if (images.length && skillRuntimeSettings.visionRuntime.available) elements.skillUseVision.checked = true;
    renderVisionPreview();
    renderRequestPreview();
  } catch (error) {
    setFeedback(elements.skillGenerationFeedback, error.message || t("无法读取 Skill 服务配置"), true);
  }
}

function renderRuntimeMenus(settings) {
  renderRuntimeOptionMenu(elements.skillTextProviderMenu, settings.textRuntime, "text");
  renderRuntimeOptionMenu(elements.skillVisionProviderMenu, settings.visionRuntime, "vision");
}

function renderRuntimeOptionMenu(container, runtime, kind) {
  const currentKey = `${runtime.assignment?.providerId || ""}:${runtime.assignment?.model || ""}`;
  const options = runtime.availableProviders.flatMap((provider) => provider.models.map((model) => ({
    key: `${provider.id}:${model}`,
    providerId: provider.id,
    model,
    label: `${provider.label} · ${model}`
  })));
  const selected = options.find((option) => option.key === currentKey);
  const details = document.createElement("details");
  const summary = document.createElement("summary");
  summary.textContent = selected?.label || runtime.label || t("未配置");
  const panel = el("div", "skill-option-panel");
  panel.append(...options.map((option) => {
    const button = textEl("button", option.label);
    button.type = "button";
    button.setAttribute("aria-current", String(option.key === currentKey));
    button.addEventListener("click", () => {
      runtimeOverrides[kind] = { providerId: option.providerId, model: option.model };
      details.open = false;
      safely(prepareSkillRuntimeControls)();
    });
    return button;
  }));
  details.append(summary, panel);
  container.replaceChildren(details);
}

function restoreDefaultInstructions() {
  elements.skillTextInstruction.value = defaultSkillExtractionInstruction(currentLocale());
  elements.skillVisionInstruction.value = defaultSkillVisualInstruction(currentLocale());
  renderRequestPreview();
}

function renderVisionPreview() {
  const images = selectedSkillContentImages(entries, sourceSelectionSnapshots());
  const plan = contactSheetPlan(images);
  const runtime = skillRuntimeSettings?.visionRuntime;
  if (!visionPreferenceTouched && images.length && runtime?.available) elements.skillUseVision.checked = true;
  elements.skillUseVision.disabled = images.length === 0 || !runtime?.available;
  if (elements.skillUseVision.disabled) elements.skillUseVision.checked = false;
  elements.skillVisionToggleNote.textContent = !images.length
    ? t("当前没有选择可分析的图片")
    : runtime?.available ? `${runtime.label} · ${images.length} ${t("张图片")}` : t("尚未配置可用的图片分析模型");
  elements.skillVisionPreview.hidden = !elements.skillUseVision.checked;
  if (!elements.skillUseVision.checked) return;
  elements.skillVisionPreview.textContent = t("{service} · {images} 张内容图 · {batches} 个视觉批次 · 预计 {requests} 次付费请求。", {
    service: runtime.label,
    images: images.length,
    batches: plan.length,
    requests: plan.length
  });
}

function renderRequestPreview() {
  if (!elements.skillRequestPreview) return;
  const snapshots = sourceSelectionSnapshots();
  const images = selectedSkillContentImages(entries, snapshots);
  const assetCount = snapshots.reduce((sum, item) => sum + item.assetIds.length, 0);
  const visionCapability = skillRuntimeSettings?.visionRuntime.descriptor?.capabilities;
  const capabilityText = !elements.skillUseVision.checked ? "" : visionCapability?.image === true
    ? t("图片输入：已声明支持")
    : visionCapability?.image === false ? t("图片输入：明确不支持") : t("图片输入：能力来源未知，运行前仍按任务配置校验");
  elements.skillRequestPreview.textContent = t("发送范围：{cases} 个匿名案例 · {assets} 项素材 · {images} 张图片\n模型：{textModel}{visionModel}\n地址：{textEndpoint}{visionEndpoint}\n{capability}\n只发送明确选择的文字、已有分析和图片；标题、网址、本地编号与未选内容不会发送。", {
    cases: snapshots.length,
    assets: assetCount,
    images: elements.skillUseVision.checked ? images.length : 0,
    textModel: skillRuntimeSettings?.textRuntime.label || t("未读取"),
    visionModel: elements.skillUseVision.checked ? ` · ${skillRuntimeSettings?.visionRuntime.label || t("未读取")}` : "",
    textEndpoint: skillRuntimeSettings?.textRuntime.endpointOrigin || t("未读取"),
    visionEndpoint: elements.skillUseVision.checked ? ` · ${skillRuntimeSettings?.visionRuntime.endpointOrigin || t("未读取")}` : "",
    capability: capabilityText
  });
}

async function generateDraft() {
  const goal = elements.skillGoal.value.trim();
  if (!sourceSelections.size && !selectedEvidenceIds.size) throw new Error(t("请先选择至少一项案例或人工判断证据"));
  if (!goal) throw new Error(t("请先说明希望提炼什么"));
  elements.skillGenerate.disabled = true;
  setFeedback(elements.skillGenerationFeedback, "");
  startSkillRun();
  try {
    updateSkillRun("prepare", t("正在准备发送内容"), 0, 1);
    const sources = await selectedSkillSources();
    const workload = skillExtractionWorkload({
      goal,
      sources,
      locale: currentLocale(),
      instructionOverride: elements.skillTextInstruction.value
    });
    const images = selectedSkillContentImages(entries, sourceSelectionSnapshots());
    const visualPlan = selectedAnalysisMode() === "vision" ? contactSheetPlan(images) : [];
    const privateSettings = await getPrivateSettings({ allowUnconfiguredVision: selectedAnalysisMode() !== "vision" });
    const approved = await confirmSkillExtractionWorkload({ workload, visualPlan, settings: privateSettings });
    if (!approved) {
      finishSkillRun(t("已取消，没有发送内容"));
      return;
    }
    activeSkillRun.totalUnits = Math.max(1, visualPlan.length + workload.requestCount);
    updateSkillRun("prepare", t("发送范围已确认"), 1, 1, true);
    if (selectedAnalysisMode() === "vision") {
      if (!visualPlan.length) throw new Error(t("视觉分析需要至少一张已选择的内容图"));
      visualSuccesses = [];
      visualFailures = [];
      pendingAfterVision = true;
      const completed = await runVisualBatches(visualPlan, { skipConfirmation: true, settings: privateSettings });
      if (!completed) return;
    }
    await generateTextDraft(privateSettings, sources);
  } catch (error) {
    if (error?.name === "AbortError") {
      failSkillRun(t("已停止，本次不完整输出没有保存"), false);
      return;
    }
    failSkillRun(error.message || t("提炼失败"), true);
    throw error;
  } finally {
    elements.skillGenerate.disabled = false;
  }
}

async function runVisualBatches(plan, options = {}) {
  if (!plan.length) throw new Error(t("所选案例没有可用于视觉分析的内容图"));
  const settings = options.settings ?? await getPrivateSettings({ allowUnconfiguredVision: false });
  const service = settings.visionRuntime;
  if (!service.available) throw new Error(t("当前没有已配置且已同意使用的视觉模型，请先在设置中完成配置"));
  const failures = [];
  for (const [index, batch] of plan.entries()) {
    updateSkillRun("vision", t("正在分析图片 {current}/{total}", { current: index + 1, total: plan.length }), index, plan.length);
    try {
      const rendered = await renderContactSheetBatch(batch, getMediaBlob);
      const dataUrl = await blobToDataUrl(rendered.blob);
      const result = await analyzeCreativeSkillVisualBatch({
        goal: elements.skillGoal.value,
        locale: currentLocale(),
        items: batch.items,
        dataUrl,
        mimeType: rendered.blob.type,
        aiProfile: service.profile,
        instructionOverride: elements.skillVisionInstruction.value
      }, settings, {
        signal: activeSkillRun?.controller.signal,
        timeoutMs: null,
        onDelta: () => touchSkillRun(t("正在接收图片分析结果"))
      });
      visualSuccesses.push(result.description);
      completeSkillRunUnit();
      appendSkillRunLog(t("图片批次 {current}/{total} 完成 · {model}", { current: index + 1, total: plan.length, model: result.model }));
    } catch (error) {
      if (error?.name === "AbortError") throw error;
      failures.push({ batch, error: error.message || t("视觉批次失败") });
      appendSkillRunLog(t("图片批次 {current}/{total} 失败：{message}", { current: index + 1, total: plan.length, message: error.message || t("服务错误") }));
    }
  }
  visualFailures = failures;
  elements.skillRetryVision.hidden = failures.length === 0;
  if (failures.length) {
    failSkillRun(t("{success} 个视觉批次成功，{failures} 个失败。可只重试失败批次。", {
      success: visualSuccesses.length, failures: failures.length
    }), true);
    return false;
  }
  return true;
}

async function retryVisualFailures() {
  if (!visualFailures.length) return;
  elements.skillRetryVision.disabled = true;
  const plan = visualFailures.map((item) => item.batch);
  visualFailures = [];
  startSkillRun();
  activeSkillRun.totalUnits = Math.max(1, plan.length + (pendingAfterVision ? 1 : 0));
  try {
    const completed = await runVisualBatches(plan);
    if (completed && pendingAfterVision) await generateTextDraft();
  } finally {
    elements.skillRetryVision.disabled = false;
  }
}

async function generateTextDraft(settingsValue = null, sourcesValue = null) {
  const settings = settingsValue ?? await getPrivateSettings({ allowUnconfiguredVision: true });
  const sources = sourcesValue ?? await selectedSkillSources();
  const result = await extractCreativeSkillDraftBatched({
    goal: elements.skillGoal.value,
    sources,
    visualAnalyses: visualSuccesses,
    locale: currentLocale(),
    aiProfile: settings.skillTextProfile,
    instructionOverride: elements.skillTextInstruction.value
  }, settings, {
    signal: activeSkillRun?.controller.signal,
    timeoutMs: null,
    onDelta: () => touchSkillRun(t("正在接收 Skill 草稿")),
    onProgress: ({ phase, current, total }) => {
      updateSkillRun("text", phase === "synthesis" ? t("正在汇总全部批次") : t("正在提炼文字 {current}/{total}", { current, total }), current - 1, total);
      if (current > 1 || phase === "synthesis") completeSkillRunUnit();
    }
  });
  completeSkillRunUnit();
  elements.skillMarkdown.value = result.markdown;
  if (!elements.skillCallName.value.trim()) elements.skillCallName.value = result.callName;
  if (!elements.skillDescription.value.trim()) elements.skillDescription.value = result.description;
  elements.skillDraftStep.hidden = false;
  pendingAfterVision = false;
  finishSkillRun(t("草稿已生成 · {model}", { model: result.model }));
  appendSkillRunLog(t("文字提炼完成 · {model}", { model: result.model }));
}

async function saveSkill() {
  const callName = elements.skillCallName.value.trim();
  const description = elements.skillDescription.value.trim();
  const skillMarkdown = elements.skillMarkdown.value.trim();
  if (!callName || !description || !skillMarkdown) throw new Error(t("调用名、说明和 SKILL.md 正文都需要填写"));
  const creating = !activeSkillId;
  elements.skillSave.disabled = true;
  try {
    const evidenceSources = selectedCreativeRunEvidenceSources(creativeRuns, [...selectedEvidenceIds], activeSkillId);
    const hasSelectedEvidence = sourceSelections.size > 0 || evidenceSources.length > 0;
    const provenanceMarkdown = hasSelectedEvidence ? buildProvenanceMarkdown({
      locale: currentLocale(),
      target: elements.skillGoal.value,
      contributions: [
        ...sourceSelectionSnapshots().map((_source, index) =>
          t("匿名案例来源 {index} 参与了本次方法提炼。", { index: index + 1 })
        ),
        ...evidenceSources.map((_source, index) =>
          t("主动选择的创作实验判断 {index} 参与了本次改进。", { index: index + 1 })
        )
      ]
    }) : currentCreativeSkillVersion(activeSkill())?.provenanceMarkdown;
    const message = activeSkillId ? {
      type: "SAVE_CREATIVE_SKILL_VERSION",
      skillId: activeSkillId,
      version: { callName, description, skillMarkdown, provenanceMarkdown, reason: "improved", source: activeSkill()?.versions.at(-1)?.source }
    } : {
      type: "CREATE_CREATIVE_SKILL",
      skill: { callName, description, skillMarkdown, provenanceMarkdown, reason: "created", source: "generated" }
    };
    const response = await chrome.runtime.sendMessage(message);
    if (!response?.ok) throw new Error(response?.message || t("Skill 保存失败"));
    creativeSkills = normalizeCreativeSkillsState(response.creativeSkills);
    activeSkillId = response.skill.id;
    elements.skillDelete.hidden = false;
    elements.skillVersionsStep.hidden = false;
    elements.skillWorkspaceTitle.textContent = response.skill.callName;
    renderVersions(response.skill);
    if (creating) {
      navigateTo("detail", response.skill.id, { replace: true });
      setFeedback(elements.skillDetailFeedback, response.message);
    } else setFeedback(elements.skillSaveStatus, response.message);
  } finally {
    elements.skillSave.disabled = false;
  }
}

function renderVersions(skill) {
  const versions = [...skill.versions].reverse();
  elements.skillVersionLabel.textContent = t("当前 v{version}", { version: versionNumber(skill, skill.currentVersionId) });
  elements.skillVersionList.replaceChildren(...versions.map((version) => {
    const row = el("div", "skill-version-item");
    const copy = el("div");
    copy.append(textEl("strong", `v${versionNumber(skill, version.id)} · ${reasonLabel(version.reason)}`), textEl("p", `${formatDate(version.createdAt)} · ${version.source === "imported" ? t("外部包") : "PromptDirector"}`));
    const button = textEl("button", version.id === skill.currentVersionId ? t("当前") : t("恢复为新版本"));
    button.className = "button-secondary";
    button.disabled = version.id === skill.currentVersionId;
    button.addEventListener("click", () => safely(() => restoreVersion(version.id))());
    row.append(copy, button);
    return row;
  }));
}

async function restoreVersion(versionId) {
  if (!await confirmAppAction({ title: t("恢复这个版本？"), description: t("恢复不会删除现有历史，而是复制为新的当前版本。"), confirmLabel: t("恢复为新版本") })) return;
  const response = await chrome.runtime.sendMessage({ type: "RESTORE_CREATIVE_SKILL_VERSION", skillId: activeSkillId, versionId });
  if (!response?.ok) throw new Error(response?.message || t("版本恢复失败"));
  creativeSkills = normalizeCreativeSkillsState(response.creativeSkills);
  const version = currentCreativeSkillVersion(response.skill);
  elements.skillMarkdown.value = version.skillMarkdown;
  renderVersions(response.skill);
  setFeedback(elements.skillSaveStatus, response.message);
}

async function deleteSkill() {
  const skill = activeSkill();
  if (!skill || !await confirmAppAction({ title: t("删除 /{name}？", { name: skill.callName }), description: t("这个 Skill 及其版本会被永久删除。"), confirmLabel: t("删除"), danger: true })) return;
  const response = await chrome.runtime.sendMessage({ type: "DELETE_CREATIVE_SKILL", skillId: skill.id });
  if (!response?.ok) throw new Error(response?.message || t("Skill 删除失败"));
  creativeSkills = normalizeCreativeSkillsState(response.creativeSkills);
  navigateTo("list", "", { replace: true });
  setFeedback(elements.skillFeedback, response.message);
}

async function testSkill() {
  const skill = activeSkill();
  if (!skill) return;
  const url = new URL(chrome.runtime.getURL("composer.html"));
  url.searchParams.set("skill", skill.id);
  location.assign(url.href);
}

async function exportSkill() {
  const skill = activeSkill();
  if (!skill) return;
  const archive = await exportStoredSkillPackage(skill, { readFile: getMediaBlob });
  await downloadBlob(archive, {
    filename: `PromptDirector-Skill-${skill.portableId}.zip`,
    saveAs: false,
    failureMessage: t("Skill 导出失败")
  });
  setFeedback(elements.skillDetailFeedback, t("Skill 已导出"));
}

async function downloadBlob(blob, options = {}) {
  const url = URL.createObjectURL(blob);
  let downloadId = 0;
  let finishDownload;
  const completed = new Promise((resolve) => { finishDownload = resolve; });
  const onChanged = (delta) => {
    if (delta.id !== downloadId || !delta.state?.current) return;
    if (["complete", "interrupted"].includes(delta.state.current)) finishDownload(delta.state.current);
  };
  chrome.downloads.onChanged.addListener(onChanged);
  try {
    downloadId = await chrome.downloads.download({
      url,
      filename: options.filename,
      conflictAction: "uniquify",
      saveAs: options.saveAs === true
    });
    const [record] = await chrome.downloads.search({ id: downloadId });
    const state = ["complete", "interrupted"].includes(record?.state) ? record.state : await completed;
    if (state !== "complete") throw new Error(options.failureMessage || t("下载失败"));
    return downloadId;
  } finally {
    chrome.downloads.onChanged.removeListener(onChanged);
    URL.revokeObjectURL(url);
  }
}

function invalidateCuratedSubmission() {
  curatedSubmissionSnapshot = null;
  elements.skillSubmissionOpen.disabled = true;
  clearCuratedSubmissionErrors();
}

async function openCuratedSubmission() {
  const skill = activeSkill();
  if (!skill) return;
  const stored = await chrome.storage.local.get(CURATED_SKILL_PUBLISHER_STORAGE_KEY);
  curatedSubmissionSnapshot = null;
  elements.skillSubmissionAuthor.value = String(stored[CURATED_SKILL_PUBLISHER_STORAGE_KEY] ?? "");
  elements.skillSubmissionSummary.value = skill.description;
  elements.skillSubmissionRights.checked = false;
  clearCuratedSubmissionErrors();
  elements.skillSubmissionPreview.replaceChildren();
  elements.skillSubmissionFindings.hidden = true;
  elements.skillSubmissionOpen.disabled = true;
  setFeedback(elements.skillSubmissionFeedback, "填写署名并确认开放使用后，生成可逐字核对的公开快照。");
  elements.skillSubmissionDialog.showModal();
}

async function refreshCuratedSubmission() {
  const skill = activeSkill();
  if (!skill) return;
  if (!validateCuratedSubmissionFields()) return;
  const snapshot = await buildCuratedSkillSnapshot(skill, {
    author: elements.skillSubmissionAuthor.value,
    summary: elements.skillSubmissionSummary.value,
    rightsConfirmed: elements.skillSubmissionRights.checked
  });
  await chrome.storage.local.set({ [CURATED_SKILL_PUBLISHER_STORAGE_KEY]: elements.skillSubmissionAuthor.value.trim() });
  curatedSubmissionSnapshot = snapshot;
  elements.skillSubmissionPreview.replaceChildren(...snapshot.preview.map((file) => {
    const detail = document.createElement("details");
    detail.open = true;
    detail.append(textEl("summary", `${file.path} · ${file.byteSize} bytes`), textEl("pre", file.text));
    return detail;
  }));
  const list = elements.skillSubmissionFindings.querySelector("ul");
  list.replaceChildren(...snapshot.findings.map((finding) => textEl("li", `${finding.path}：${finding.message}（${finding.excerpt}）`)));
  elements.skillSubmissionFindings.hidden = snapshot.findings.length === 0;
  elements.skillSubmissionOpen.disabled = snapshot.findings.length > 0;
  setFeedback(elements.skillSubmissionFeedback, snapshot.findings.length
    ? "发现可能的隐私风险。快照没有被改写，请修改本地 Skill 后重新检查。"
    : `已生成 ${snapshot.preview.length} 个纯文本文件；请逐一核对全文。`, snapshot.findings.length > 0);
}

async function downloadCuratedSubmission() {
  if (!curatedSubmissionSnapshot) throw new Error("请先生成并检查公开快照");
  const archive = await buildCuratedSkillSubmissionArchive(curatedSubmissionSnapshot);
  await downloadBlob(archive, {
    filename: `PromptDirector-Skill-Submission-${curatedSubmissionSnapshot.manifest.skillId}.zip`,
    saveAs: true,
    failureMessage: "精选 Skill 投稿包下载失败"
  });
  await chrome.tabs.create({ url: CURATED_SKILL_SUBMISSION_URL });
  setFeedback(elements.skillSubmissionFeedback, "投稿包已下载，并已打开 GitHub 投稿页。请手动上传、核对并提交；不会自动发布。 ");
}

function clearCuratedSubmissionErrors() {
  for (const [field, error] of [
    [elements.skillSubmissionAuthor, elements.skillSubmissionAuthorError],
    [elements.skillSubmissionSummary, elements.skillSubmissionSummaryError],
    [elements.skillSubmissionRights, elements.skillSubmissionRightsError]
  ]) {
    field.removeAttribute("aria-invalid");
    error.hidden = true;
    error.textContent = "";
  }
}

function validateCuratedSubmissionFields() {
  clearCuratedSubmissionErrors();
  const invalid = [];
  if (!elements.skillSubmissionAuthor.value.trim()) invalid.push([elements.skillSubmissionAuthor, elements.skillSubmissionAuthorError, "请填写公开署名"]);
  if (!elements.skillSubmissionSummary.value.trim()) invalid.push([elements.skillSubmissionSummary, elements.skillSubmissionSummaryError, "请填写公开摘要"]);
  if (!elements.skillSubmissionRights.checked) invalid.push([elements.skillSubmissionRights, elements.skillSubmissionRightsError, "请确认开放使用范围"]);
  for (const [field, error, message] of invalid) {
    field.setAttribute("aria-invalid", "true");
    error.textContent = message;
    error.hidden = false;
  }
  if (!invalid.length) return true;
  invalid[0][0].focus();
  setFeedback(elements.skillSubmissionFeedback, "请先完成标出的公开信息。", true);
  return false;
}

async function runCuratedSubmissionAction(action) {
  try {
    await action();
  } catch (error) {
    setFeedback(elements.skillSubmissionFeedback, error.message || "精选 Skill 投稿操作失败", true);
  }
}

async function importZip() {
  const file = elements.skillZipFile.files?.[0];
  elements.skillZipFile.value = "";
  if (!file) return;
  const parsed = await parseSkillArchive(file);
  await importParsedSkill(parsed, file.name);
}

async function importFolder() {
  const files = [...(elements.skillFolderFiles.files ?? [])];
  elements.skillFolderFiles.value = "";
  if (!files.length) return;
  const map = new Map(files.map((file) => [file.webkitRelativePath || file.name, file]));
  const parsed = await parseSkillFiles(map);
  await importParsedSkill(parsed, files[0].webkitRelativePath?.split("/")[0] || t("Skill 目录"));
}

async function importParsedSkill(parsed, sourceName) {
  if (parsed.requiresTextModeConfirmation) {
    const approved = await confirmAppAction({
      title: t("以文字模式导入？"),
      description: t("“{source}”依赖 {dependencies}。PromptDirector 不会执行这些程序或工具，只能使用可读取的文字方法。", {
      source: sourceName,
      dependencies: parsed.dependencies.join(currentLocale() === "en" ? ", " : "、")
      }),
      confirmLabel: t("仍要导入")
    });
    if (!approved) return;
  }
  const packageFiles = [];
  const savedIds = [];
  try {
    for (const [path, blob] of parsed.files) {
      const assetId = `skill-file:${crypto.randomUUID()}`;
      await saveSkillPackageBlob(assetId, blob);
      savedIds.push(assetId);
      packageFiles.push({ path, assetId, byteSize: blob.size, mimeType: blob.type || "application/octet-stream" });
    }
    const provenance = parsed.references.find((item) => item.path === "references/provenance.md")?.markdown ?? "";
    const response = await chrome.runtime.sendMessage({
      type: "CREATE_CREATIVE_SKILL",
      skill: {
        callName: parsed.name,
        portableId: parsed.name,
        description: parsed.description,
        skillMarkdown: parsed.body,
        references: parsed.references,
        provenanceMarkdown: provenance,
        source: "imported",
        reason: "imported",
        packageFiles,
        runtimeDependencies: parsed.dependencies,
        textModeConfirmed: parsed.requiresTextModeConfirmation
      }
    });
    if (!response?.ok) throw new Error(response?.message || t("Skill 导入失败"));
    creativeSkills = normalizeCreativeSkillsState(response.creativeSkills);
    elements.skillImportDialog.close();
    renderSkillList();
    setFeedback(elements.skillFeedback, t("已导入 /{name}", { name: response.skill.callName }));
  } catch (error) {
    await deleteMediaBlobs(savedIds);
    throw error;
  }
}

async function getPrivateSettings(options = {}) {
  const [text, image, stored] = await Promise.all([
    chrome.runtime.sendMessage({ type: "GET_AI_TASK_RUNTIME", taskId: "skillExtraction", assignment: runtimeOverrides.text }),
    chrome.runtime.sendMessage({
      type: "GET_AI_TASK_RUNTIME",
      taskId: "imageAnalysis",
      allowUnconfigured: options.allowUnconfiguredVision === true,
      assignment: runtimeOverrides.vision
    }),
    chrome.storage.local.get("composerSettings")
  ]);
  if (!text?.ok || !image?.ok) throw new Error(text?.message || image?.message || t("无法读取 Skill 服务配置"));
  requireAiRuntimeProtocolVersion(text.aiRuntimeProtocolVersion);
  requireAiRuntimeProtocolVersion(image.aiRuntimeProtocolVersion);
  const visionSettings = normalizeVisionSettings(image.visionSettings);
  const visionProfile = {
    serviceId: visionSettings.activeProvider === "compatible" ? "compatible" : "openai",
    model: image.assignment?.model,
    thinking: false
  };
  return {
    ai: normalizeAiSettings(text.aiSettings),
    vision: visionSettings,
    composer: normalizeComposerSettings(stored.composerSettings),
    skillTextProfile: { serviceId: "deepseek", model: text.assignment?.model },
    skillTextLabel: `${text.providerLabel || t("文字服务")} · ${text.assignment?.model || t("未选择模型")}`,
    textRuntime: runtimePresentation(text, { profile: { serviceId: "deepseek", model: text.assignment?.model } }),
    visionRuntime: runtimePresentation(image, { profile: visionProfile })
  };
}

function runtimePresentation(response, extras = {}) {
  const descriptor = response.runtimeDescriptor ?? {};
  const configured = (response.availableProviders ?? []).some((provider) => provider.id === response.assignment?.providerId && provider.models.includes(response.assignment?.model));
  return {
    ...extras,
    assignment: response.assignment,
    descriptor,
    availableProviders: Array.isArray(response.availableProviders) ? response.availableProviders : [],
    available: configured,
    label: `${response.providerLabel || t("AI 服务")} · ${response.assignment?.model || t("未选择模型")}`,
    endpointOrigin: descriptor.endpointOrigin || ""
  };
}

async function selectedSkillSources() {
  const selections = sourceSelectionSnapshots();
  const documentIds = selections.flatMap((selection) => {
    const entry = entries.find((item) => item.id === selection.entryId);
    const selected = new Set(selection.assetIds);
    return entryMediaAssets(entry).filter((asset) => asset.kind === "document" && selected.has(asset.id)).map((asset) => asset.id);
  });
  const derived = await Promise.all(documentIds.map(async (assetId) => [assetId, await getDerivedMedia(assetId).catch(() => null)]));
  const documentTextByAsset = new Map(derived.flatMap(([assetId, value]) => value?.searchText ? [[assetId, value.searchText]] : []));
  return [
    ...anonymousSkillSources(entries, selections, { documentTextByAsset }),
    ...selectedCreativeRunEvidenceSources(creativeRuns, [...selectedEvidenceIds], activeSkillId)
  ];
}

async function confirmSkillExtractionWorkload({ workload, visualPlan, settings }) {
  const fields = workload.overSingleRequest ? [{
    id: "overflowAction", label: t("超量处理"), type: "select", value: "batch",
    options: [{ value: "batch", label: t("分批提炼后汇总") }, { value: "reduce", label: t("返回减少选择") }]
  }] : [];
  const result = await showAppDialog({
    title: t("确认 Skill 提炼"),
    description: t("案例与证据：{cases} 项\n文字量：{characters} 字符 · 约 {tokenMin}–{tokenMax} tokens\n文字批次：{textBatches} · 图片：{images} 张 · 视觉批次：{visualBatches}\n预计请求：{requests} 次\n文字模型：{service}\n图片模型：{visionService}\n\n不会抽样、截断、自动换模型或自动重试。", {
      cases: workload.sourceCount,
      characters: workload.textCharacters.toLocaleString(),
      tokenMin: workload.tokenEstimate.min.toLocaleString(),
      tokenMax: workload.tokenEstimate.max.toLocaleString(),
      textBatches: workload.textBatchCount,
      images: visualPlan.reduce((sum, batch) => sum + batch.items.length, 0),
      visualBatches: visualPlan.length,
      requests: workload.requestCount + visualPlan.length,
      service: settings.skillTextLabel,
      visionService: visualPlan.length ? settings.visionRuntime.label : t("不发送图片")
    }),
    fields,
    confirmLabel: workload.overSingleRequest ? t("继续") : t("开始提炼")
  });
  if (!result) return false;
  if (result.overflowAction === "reduce") {
    setFeedback(elements.skillGenerationStatus, t("请减少所选来源后再开始，当前没有发送任何内容"));
    return false;
  }
  return true;
}

function selectedAnalysisMode() {
  return elements.skillUseVision.checked ? "vision" : "text";
}

function startSkillRun() {
  if (activeSkillRun?.controller && !activeSkillRun.controller.signal.aborted) activeSkillRun.controller.abort();
  activeSkillRun = {
    controller: new AbortController(),
    startedAt: Date.now(),
    completedUnits: 0,
    totalUnits: 1,
    elapsedTimer: null,
    slowTimer: null,
    stage: "prepare"
  };
  elements.skillRunPanel.hidden = false;
  elements.skillStopRun.hidden = false;
  elements.skillStopRun.disabled = false;
  elements.skillRunLog.replaceChildren();
  elements.skillRunProgress.style.width = "0%";
  renderSkillRunStages("prepare");
  activeSkillRun.elapsedTimer = setInterval(renderSkillRunElapsed, 1000);
  renderSkillRunElapsed();
  touchSkillRun(t("正在准备发送内容"));
}

function updateSkillRun(stage, message, current = 0, total = 1) {
  if (!activeSkillRun) return;
  activeSkillRun.stage = stage;
  setFeedback(elements.skillGenerationStatus, message);
  renderSkillRunStages(stage);
  const detail = total > 1 ? ` ${Math.max(0, current)}/${total}` : "";
  appendSkillRunLog(`${stageLabel(stage)}${detail} · ${message}`);
  touchSkillRun();
}

function completeSkillRunUnit() {
  if (!activeSkillRun) return;
  activeSkillRun.completedUnits = Math.min(activeSkillRun.totalUnits, activeSkillRun.completedUnits + 1);
  const percent = Math.round(activeSkillRun.completedUnits / activeSkillRun.totalUnits * 100);
  elements.skillRunProgress.style.width = `${percent}%`;
}

function touchSkillRun(message = "") {
  if (!activeSkillRun) return;
  if (message) setFeedback(elements.skillGenerationStatus, message);
  if (activeSkillRun.slowTimer !== null) clearTimeout(activeSkillRun.slowTimer);
  activeSkillRun.slowTimer = setTimeout(() => {
    if (!activeSkillRun) return;
    setFeedback(elements.skillGenerationStatus, t("服务响应较慢，仍在等待；你可以继续等待或停止"));
    appendSkillRunLog(t("服务响应较慢，未自动中止"));
  }, DEFAULT_COMPOSER_REQUEST_TIMEOUT_MS);
}

function finishSkillRun(message = "") {
  if (!activeSkillRun) {
    elements.skillRunPanel.hidden = !message;
    return;
  }
  clearSkillRunTimers();
  if (!message) {
    elements.skillRunPanel.hidden = true;
    activeSkillRun = null;
    return;
  }
  activeSkillRun.completedUnits = activeSkillRun.totalUnits;
  elements.skillRunProgress.style.width = "100%";
  setFeedback(elements.skillGenerationStatus, message);
  renderSkillRunStages("complete", true);
  elements.skillStopRun.hidden = true;
  activeSkillRun = null;
}

function failSkillRun(message, error = true) {
  if (activeSkillRun) clearSkillRunTimers();
  setFeedback(elements.skillGenerationStatus, message, error);
  elements.skillStopRun.hidden = true;
  appendSkillRunLog(message);
  activeSkillRun = null;
}

function stopSkillRun() {
  if (!activeSkillRun) return;
  elements.skillStopRun.disabled = true;
  activeSkillRun.controller.abort();
}

function clearSkillRunTimers() {
  if (!activeSkillRun) return;
  if (activeSkillRun.elapsedTimer !== null) clearInterval(activeSkillRun.elapsedTimer);
  if (activeSkillRun.slowTimer !== null) clearTimeout(activeSkillRun.slowTimer);
}

function renderSkillRunElapsed() {
  if (!activeSkillRun) return;
  const seconds = Math.max(0, Math.floor((Date.now() - activeSkillRun.startedAt) / 1000));
  const minutes = Math.floor(seconds / 60);
  elements.skillRunElapsed.textContent = minutes ? `${minutes}:${String(seconds % 60).padStart(2, "0")}` : `${seconds}s`;
}

function renderSkillRunStages(activeStage, complete = false) {
  const stages = [
    ["prepare", t("准备")],
    ["vision", t("图片分析")],
    ["text", t("文字提炼")],
    ["complete", t("完成")]
  ];
  const activeIndex = stages.findIndex(([id]) => id === activeStage);
  elements.skillRunStages.replaceChildren(...stages.map(([id, label], index) => {
    const item = textEl("li", label);
    item.dataset.state = complete || index < activeIndex ? "done" : index === activeIndex ? "active" : "pending";
    return item;
  }));
}

function appendSkillRunLog(message) {
  if (!elements.skillRunLog || !message) return;
  const row = textEl("p", `${new Date().toLocaleTimeString(currentLocale() === "en" ? "en" : "zh-CN", { hour12: false })}  ${translateUiMessage(message)}`);
  elements.skillRunLog.append(row);
  while (elements.skillRunLog.children.length > 80) elements.skillRunLog.firstElementChild.remove();
  elements.skillRunLog.scrollTop = elements.skillRunLog.scrollHeight;
}

function stageLabel(stage) {
  return ({ prepare: t("准备"), vision: t("图片分析"), text: t("文字提炼"), complete: t("完成") })[stage] || stage;
}

function activeSkill() {
  return creativeSkills.items.find((item) => item.id === activeSkillId) ?? null;
}

function versionNumber(skill, versionId) {
  return Math.max(1, skill.versions.findIndex((item) => item.id === versionId) + 1);
}

function reasonLabel(reason) {
  return t(({ created: "创建", improved: "改进", repaired: "修复", restored: "恢复", imported: "导入" })[reason] || "更新");
}

function formatDate(value) {
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? "" : new Intl.DateTimeFormat(currentLocale() === "en" ? "en" : "zh-CN", { dateStyle: "medium", timeStyle: "short" }).format(date);
}

function releaseThumbnails() {
  for (const url of thumbnailUrls.values()) URL.revokeObjectURL(url);
  thumbnailUrls = new Map();
}

function setFeedback(element, message, error = false) {
  element.textContent = translateUiMessage(message);
  element.classList.toggle("error", error);
}

function safely(action) {
  return async (...args) => {
    try { await action(...args); }
    catch (error) {
      const target = activeView === "detail"
        ? elements.skillDetailFeedback
        : activeView === "list"
          ? elements.skillFeedback
          : elements.skillGenerationFeedback;
      setFeedback(target, error.message || t("操作失败"), true);
    }
  };
}

function el(tag, className = "") {
  const node = document.createElement(tag);
  if (className) node.className = className;
  return node;
}

function textEl(tag, text) {
  const node = el(tag);
  node.textContent = text;
  return node;
}

function excerpt(value, length) {
  const text = String(value ?? "").replace(/\s+/g, " ").trim();
  return text.length > length ? `${text.slice(0, length)}…` : text;
}

function camel(value) {
  return value.replace(/-([a-z])/g, (_match, letter) => letter.toUpperCase());
}
