import { normalizeAiSettings } from "./deepseek.js";
import { normalizeComposerSettings } from "./composer.js";
import { composerServiceCatalog } from "./composer-service.js";
import {
  currentCreativeSkillVersion,
  normalizeCreativeSkillsState
} from "./creative-skills.js";
import {
  buildProvenanceMarkdown,
  exportGeneratedSkillPackage,
  parseSkillArchive,
  parseSkillFiles
} from "./creative-skill-package.js";
import {
  analyzeCreativeSkillVisualBatch,
  anonymousSkillSources,
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
  deleteMediaBlobs,
  getMediaBlob,
  saveSkillPackageBlob
} from "./media-store.js";
import { primaryImageAsset } from "./media.js";
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

await initializeUi();
bindTransientMenus(document, ".skill-detail-more");

const elements = Object.fromEntries([
  "skill-search", "skill-import", "skill-create", "skill-context-back", "skill-zip-file", "skill-folder-files", "skill-library", "skill-summary", "skill-feedback", "skill-list", "skill-empty", "skill-empty-create",
  "skill-detail", "skill-detail-title", "skill-detail-call-name", "skill-detail-feedback", "skill-detail-description", "skill-detail-version", "skill-detail-source", "skill-detail-updated", "skill-detail-markdown", "skill-detail-edit", "skill-detail-more", "skill-detail-refine", "skill-export",
  "skill-workspace", "skill-workspace-kicker", "skill-workspace-title", "skill-delete", "skill-builder", "skill-source-sidebar", "skill-source-step", "skill-target-step", "skill-selected-count", "skill-project-filter", "skill-case-search", "skill-visible-select", "skill-case-grid",
  "skill-run-evidence-step", "skill-run-evidence-count", "skill-run-evidence-list",
  "skill-goal", "skill-vision-preview", "skill-generate", "skill-retry-vision", "skill-generation-status", "skill-draft-step", "skill-version-label", "skill-call-name", "skill-description", "skill-markdown", "skill-save", "skill-test", "skill-save-status", "skill-versions-step", "skill-version-list",
  "skill-import-dialog", "skill-import-close", "skill-import-zip", "skill-import-folder"
].map((id) => [camel(id), document.querySelector(`#${id}`)]));

let entries = [];
let organizerState = { collections: [] };
let creativeSkills = normalizeCreativeSkillsState();
let creativeRuns = [];
let activeView = "list";
let sourcePage = "library";
let activeSkillId = "";
let selectedEntryIds = new Set();
let selectedEvidenceIds = new Set();
let visibleEntryIds = [];
let thumbnailUrls = new Map();
let visualSuccesses = [];
let visualFailures = [];
let pendingAfterVision = false;

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
  elements.skillImport.addEventListener("click", () => elements.skillImportDialog.showModal());
  elements.skillImportClose.addEventListener("click", () => elements.skillImportDialog.close());
  elements.skillImportZip.addEventListener("click", () => elements.skillZipFile.click());
  elements.skillImportFolder.addEventListener("click", () => elements.skillFolderFiles.click());
  elements.skillZipFile.addEventListener("change", () => safely(importZip)());
  elements.skillFolderFiles.addEventListener("change", () => safely(importFolder)());
  elements.skillProjectFilter.addEventListener("change", renderCases);
  elements.skillCaseSearch.addEventListener("input", renderCases);
  elements.skillVisibleSelect.addEventListener("click", toggleVisibleCases);
  document.querySelectorAll('input[name="skill-analysis-mode"]').forEach((input) => input.addEventListener("change", renderVisionPreview));
  elements.skillGenerate.addEventListener("click", () => safely(generateDraft)());
  elements.skillRetryVision.addEventListener("click", () => safely(retryVisualFailures)());
  elements.skillSave.addEventListener("click", () => safely(saveSkill)());
  elements.skillTest.addEventListener("click", () => safely(testSkill)());
  elements.skillDelete.addEventListener("click", () => safely(deleteSkill)());
  addEventListener("popstate", renderLocation);
  addEventListener("beforeunload", releaseThumbnails);
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
  selectedEvidenceIds = new Set();
  visibleEntryIds = [];
  visualSuccesses = [];
  visualFailures = [];
  pendingAfterVision = false;
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
  document.querySelector('input[name="skill-analysis-mode"][value="text"]').checked = true;
  if (selectingSources) {
    renderProjectControls();
    renderCases();
  }
  renderRunEvidence(view);
  if (skill) {
    const version = currentCreativeSkillVersion(skill);
    elements.skillCallName.value = skill.callName;
    elements.skillDescription.value = skill.description;
    elements.skillMarkdown.value = version.skillMarkdown;
    elements.skillDraftStep.hidden = false;
    elements.skillVersionsStep.hidden = false;
    elements.skillVersionLabel.textContent = t("当前 v{version}", { version: versionNumber(skill, version.id) });
    renderVersions(skill);
  } else {
    elements.skillCallName.value = "";
    elements.skillDescription.value = "";
    elements.skillMarkdown.value = "";
    elements.skillDraftStep.hidden = true;
    elements.skillVersionsStep.hidden = true;
  }
  setFeedback(elements.skillGenerationStatus, "");
  setFeedback(elements.skillSaveStatus, "");
  if (selectingSources) renderVisionPreview();
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
  const selected = elements.skillProjectFilter.value;
  const options = [["", t("全部项目")], ...organizerState.collections.map((project) => [project.id, project.name])];
  elements.skillProjectFilter.replaceChildren(...options.map(([value, name]) => {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = name;
    return option;
  }));
  elements.skillProjectFilter.value = options.some(([value]) => value === selected) ? selected : "";
}

function renderCases() {
  releaseThumbnails();
  const projectId = elements.skillProjectFilter.value;
  const members = projectId ? new Set(organizerState.collections.find((item) => item.id === projectId)?.entryIds ?? []) : null;
  const query = elements.skillCaseSearch.value.trim().toLocaleLowerCase();
  const visible = entries.filter((entry) => {
    if (members && !members.has(entry.id)) return false;
    if (!query) return true;
    return `${entry.title ?? ""}\n${entry.text ?? ""}`.toLocaleLowerCase().includes(query);
  });
  visibleEntryIds = visible.map((entry) => entry.id);
  elements.skillCaseGrid.replaceChildren(...visible.map(caseCard));
  elements.skillSelectedCount.textContent = String(selectedEntryIds.size);
  renderVisibleSelectionAction();
}

function toggleVisibleCases() {
  const allSelected = visibleEntryIds.length > 0 && visibleEntryIds.every((id) => selectedEntryIds.has(id));
  for (const id of visibleEntryIds) allSelected ? selectedEntryIds.delete(id) : selectedEntryIds.add(id);
  renderCases();
  renderVisionPreview();
}

function renderVisibleSelectionAction() {
  const allSelected = visibleEntryIds.length > 0 && visibleEntryIds.every((id) => selectedEntryIds.has(id));
  elements.skillVisibleSelect.disabled = visibleEntryIds.length === 0;
  elements.skillVisibleSelect.textContent = allSelected ? t("取消当前结果") : t("全选当前结果");
}

function caseCard(entry) {
  const button = el("button", "skill-case");
  button.type = "button";
  button.dataset.selected = String(selectedEntryIds.has(entry.id));
  button.setAttribute("aria-pressed", String(selectedEntryIds.has(entry.id)));
  button.setAttribute("aria-label", entry.title || t("未命名案例"));
  const asset = primaryImageAsset(entry);
  if (asset) {
    const image = document.createElement("img");
    image.alt = "";
    image.loading = "lazy";
    hydrateThumbnail(image, asset.id);
    button.append(image);
  }
  button.append(textEl("span", entry.title || excerpt(entry.text, 48) || t("未命名案例")));
  button.addEventListener("click", () => {
    selectedEntryIds.has(entry.id) ? selectedEntryIds.delete(entry.id) : selectedEntryIds.add(entry.id);
    button.dataset.selected = String(selectedEntryIds.has(entry.id));
    button.setAttribute("aria-pressed", String(selectedEntryIds.has(entry.id)));
    elements.skillSelectedCount.textContent = String(selectedEntryIds.size);
    renderVisibleSelectionAction();
    renderVisionPreview();
  });
  return button;
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

function renderVisionPreview() {
  const vision = selectedAnalysisMode() === "vision";
  elements.skillVisionPreview.hidden = !vision;
  if (!vision) return;
  const images = selectedSkillContentImages(entries, [...selectedEntryIds]);
  const plan = contactSheetPlan(images);
  getPrivateSettings().then(({ vision: settings }) => {
    const service = visionServiceProfile(settings);
    elements.skillVisionPreview.textContent = service
      ? t("{service} · {images} 张内容图 · {batches} 个视觉批次 · 预计 {requests} 次付费请求。联系表仅在本轮内存中生成，不会保存。", {
        service: service.label, images: images.length, batches: plan.length, requests: plan.length
      })
      : t("尚未配置可用的视觉模型 · {images} 张内容图 · {batches} 个视觉批次。请先在资料库设置中完成视觉服务配置。", {
        images: images.length, batches: plan.length
      });
  }).catch(() => undefined);
}

async function generateDraft() {
  const goal = elements.skillGoal.value.trim();
  if (!selectedEntryIds.size && !selectedEvidenceIds.size) throw new Error(t("请先选择至少一项案例或人工判断证据"));
  if (!goal) throw new Error(t("请先说明希望提炼什么"));
  elements.skillGenerate.disabled = true;
  setFeedback(elements.skillGenerationStatus, t("正在准备匿名来源资料…"));
  try {
    const sources = selectedSkillSources();
    const workload = skillExtractionWorkload({ goal, sources });
    const images = selectedSkillContentImages(entries, [...selectedEntryIds]);
    const visualPlan = selectedAnalysisMode() === "vision" ? contactSheetPlan(images) : [];
    const privateSettings = routedSkillSettings(await getPrivateSettings());
    const approved = await confirmSkillExtractionWorkload({ workload, visualPlan, settings: privateSettings });
    if (!approved) return;
    if (selectedAnalysisMode() === "vision") {
      if (!selectedEntryIds.size) throw new Error(t("视觉分析需要至少一个带内容图的来源案例"));
      visualSuccesses = [];
      visualFailures = [];
      pendingAfterVision = true;
      const completed = await runVisualBatches(visualPlan, { skipConfirmation: true, settings: privateSettings });
      if (!completed) return;
    }
    await generateTextDraft(privateSettings, sources);
  } finally {
    elements.skillGenerate.disabled = false;
  }
}

async function runVisualBatches(plan, options = {}) {
  if (!plan.length) throw new Error(t("所选案例没有可用于视觉分析的内容图"));
  const settings = options.settings ?? routedSkillSettings(await getPrivateSettings());
  const service = visionServiceProfile(settings.vision);
  if (!service) throw new Error(t("当前没有已配置且已同意使用的视觉模型，请先在设置中完成配置"));
  const approved = options.skipConfirmation || await confirmAppAction({
    title: t("确认付费视觉分析"),
    description: t("{service}\n内容图：{images} 张\n视觉批次：{batches}\n预计请求：{requests} 次\n\n这些请求会产生额外费用。", {
    service: service.label,
    images: plan.reduce((sum, item) => sum + item.items.length, 0),
    batches: plan.length,
    requests: plan.length
    }),
    confirmLabel: t("确认并继续")
  });
  if (!approved) {
    setFeedback(elements.skillGenerationStatus, t("已取消视觉分析，没有发送图片"));
    return false;
  }
  const failures = [];
  for (const [index, batch] of plan.entries()) {
    setFeedback(elements.skillGenerationStatus, t("正在分析视觉批次 {current}/{total}…", { current: index + 1, total: plan.length }));
    try {
      const rendered = await renderContactSheetBatch(batch, getMediaBlob);
      const dataUrl = await blobToDataUrl(rendered.blob);
      const result = await analyzeCreativeSkillVisualBatch({
        goal: elements.skillGoal.value,
        locale: currentLocale(),
        items: batch.items,
        dataUrl,
        mimeType: rendered.blob.type,
        aiProfile: service.profile
      }, settings);
      visualSuccesses.push(result.description);
    } catch (error) {
      failures.push({ batch, error: error.message || t("视觉批次失败") });
    }
  }
  visualFailures = failures;
  elements.skillRetryVision.hidden = failures.length === 0;
  if (failures.length) {
    setFeedback(elements.skillGenerationStatus, t("{success} 个视觉批次成功，{failures} 个失败。可只重试失败批次，或切回文字提炼。", {
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
  try {
    const completed = await runVisualBatches(plan);
    if (completed && pendingAfterVision) await generateTextDraft();
  } finally {
    elements.skillRetryVision.disabled = false;
  }
}

async function generateTextDraft(settingsValue = null, sourcesValue = null) {
  const settings = settingsValue ?? routedSkillSettings(await getPrivateSettings());
  const sources = sourcesValue ?? selectedSkillSources();
  setFeedback(elements.skillGenerationStatus, t("正在围绕你的目标提炼可复用方法…"));
  const result = await extractCreativeSkillDraftBatched({
    goal: elements.skillGoal.value,
    sources,
    visualAnalyses: visualSuccesses,
    locale: currentLocale(),
    aiProfile: settings.skillTextProfile
  }, settings, {
    onProgress: ({ phase, current, total }) => setFeedback(elements.skillGenerationStatus,
      phase === "synthesis" ? t("正在汇总全部批次…") : t("正在提炼文字批次 {current}/{total}…", { current, total }))
  });
  elements.skillMarkdown.value = result.markdown;
  if (!elements.skillDescription.value.trim()) elements.skillDescription.value = elements.skillGoal.value.trim().slice(0, 240);
  elements.skillDraftStep.hidden = false;
  elements.skillDraftStep.scrollIntoView({ behavior: "smooth", block: "start" });
  pendingAfterVision = false;
  setFeedback(elements.skillGenerationStatus, t("草稿已生成 · {model}", { model: result.model }));
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
    const hasSelectedEvidence = selectedEntryIds.size > 0 || evidenceSources.length > 0;
    const provenanceMarkdown = hasSelectedEvidence ? buildProvenanceMarkdown({
      locale: currentLocale(),
      target: elements.skillGoal.value,
      contributions: [
        ...anonymousSkillSources(entries, [...selectedEntryIds]).map((_source, index) =>
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
  const version = currentCreativeSkillVersion(skill);
  if (!skill || !version) return;
  const archive = await exportGeneratedSkillPackage({
    portableId: skill.portableId,
    description: skill.description,
    skillMarkdown: version.skillMarkdown,
    references: version.references,
    provenanceMarkdown: version.provenanceMarkdown
  });
  const url = URL.createObjectURL(archive);
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
      filename: `PromptDirector-Skill-${skill.portableId}.zip`,
      conflictAction: "uniquify",
      saveAs: false
    });
    const [record] = await chrome.downloads.search({ id: downloadId });
    const state = ["complete", "interrupted"].includes(record?.state) ? record.state : await completed;
    if (state !== "complete") throw new Error(t("Skill 导出失败"));
    setFeedback(elements.skillDetailFeedback, t("Skill 已导出"));
  } finally {
    chrome.downloads.onChanged.removeListener(onChanged);
    URL.revokeObjectURL(url);
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

async function getPrivateSettings() {
  const [text, image, stored] = await Promise.all([
    chrome.runtime.sendMessage({ type: "GET_AI_TASK_RUNTIME", taskId: "skillExtraction" }),
    chrome.runtime.sendMessage({ type: "GET_AI_TASK_RUNTIME", taskId: "imageAnalysis", allowUnconfigured: true }),
    chrome.storage.local.get("composerSettings")
  ]);
  if (!text?.ok || !image?.ok) throw new Error(text?.message || image?.message || t("无法读取 Skill 服务配置"));
  return {
    ai: normalizeAiSettings(text.aiSettings),
    vision: normalizeVisionSettings(image.visionSettings),
    composer: normalizeComposerSettings(stored.composerSettings),
    skillTextProfile: { serviceId: "deepseek", model: text.assignment?.model },
    skillTextLabel: `${text.providerLabel || t("文字服务")} · ${text.assignment?.model || t("未选择模型")}`
  };
}

function selectedSkillSources() {
  return [
    ...anonymousSkillSources(entries, [...selectedEntryIds]),
    ...selectedCreativeRunEvidenceSources(creativeRuns, [...selectedEvidenceIds], activeSkillId)
  ];
}

function routedSkillSettings(value) {
  return value;
}

async function confirmSkillExtractionWorkload({ workload, visualPlan, settings }) {
  const fields = workload.overSingleRequest ? [{
    id: "overflowAction", label: t("超量处理"), type: "select", value: "batch",
    options: [{ value: "batch", label: t("分批提炼后汇总") }, { value: "reduce", label: t("返回减少选择") }]
  }] : [];
  const result = await showAppDialog({
    title: t("确认 Skill 提炼"),
    description: t("案例与证据：{cases} 项\n文字量：{characters} 字符 · 文字批次：{textBatches}\n图片：{images} 张 · 视觉批次：{visualBatches}\n预计请求：{requests} 次\n文字服务：{service}\n\n不会抽样或截断；视觉请求会产生额外费用。", {
      cases: workload.sourceCount,
      characters: workload.textCharacters.toLocaleString(),
      textBatches: workload.textBatchCount,
      images: visualPlan.reduce((sum, batch) => sum + batch.items.length, 0),
      visualBatches: visualPlan.length,
      requests: workload.requestCount + visualPlan.length,
      service: settings.skillTextLabel
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

function visionServiceProfile(visionSettings) {
  const catalog = composerServiceCatalog({}, visionSettings).filter((item) => item.vision && item.configured);
  const active = visionSettings.activeProvider === "compatible" ? "compatible" : "openai";
  const service = catalog.find((item) => item.serviceId === active) ?? catalog[0];
  return service ? { label: service.label, profile: { serviceId: service.serviceId, model: service.model, thinking: false } } : null;
}

function selectedAnalysisMode() {
  return document.querySelector('input[name="skill-analysis-mode"]:checked')?.value === "vision" ? "vision" : "text";
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
          : elements.skillGenerationStatus;
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
