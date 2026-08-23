import {
  isTrustedCuratedSkillResponseUrl,
  normalizeCuratedSkillCatalog,
  validateCuratedSkillPackage,
  verifyCuratedSkillPackageBlob
} from "./curated-skill-catalog.js";
import { CURATED_SKILL_CATALOG_URL } from "./curated-config.js";
import { fetchCuratedPackage, readResponseBlobWithProgress } from "./curated-download.js";
import { installCuratedSkillTransaction, planCuratedSkillInstall } from "./curated-skill-install.js";
import { initializeUi, t } from "./i18n.js";
import { deleteMediaBlobs, saveSkillPackageBlob } from "./media-store.js";
import { renderMarkdownDocument } from "./markdown-renderer.js";

await initializeUi();

const elements = Object.fromEntries([
  "retry-catalog", "return-library", "skill-app", "skill-detail-close", "skill-detail-content", "skill-detail-dialog", "skill-search", "skill-status", "skill-status-bar", "skill-toast"
].map((id) => [camel(id), document.querySelector(`#${id}`)]));
const state = { catalog: null, creativeSkills: { version: 1, items: [] }, parsed: new Map(), archives: new Map(), query: "" };
let toastTimer = 0;

elements.returnLibrary.addEventListener("click", () => location.assign(chrome.runtime.getURL("library.html")));
elements.retryCatalog.addEventListener("click", start);
elements.skillSearch.addEventListener("input", () => { state.query = elements.skillSearch.value.trim().toLocaleLowerCase(); render(); });
elements.skillDetailClose.addEventListener("click", () => elements.skillDetailDialog.close());
elements.skillDetailDialog.addEventListener("click", (event) => { if (event.target === elements.skillDetailDialog) elements.skillDetailDialog.close(); });

await start();

async function start() {
  hideStatus();
  state.catalog = null;
  elements.skillApp.replaceChildren(loading());
  try {
    const [response, local] = await Promise.all([
      fetch(CURATED_SKILL_CATALOG_URL, { credentials: "omit", cache: "no-store" }),
      chrome.runtime.sendMessage({ type: "GET_STATE" })
    ]);
    if (!response.ok) {
      const error = new Error("catalog-request-failed");
      error.status = response.status;
      throw error;
    }
    state.catalog = normalizeCuratedSkillCatalog(await response.json());
    if (local?.ok) state.creativeSkills = local.creativeSkills ?? state.creativeSkills;
    render();
  } catch (error) {
    showStatus(catalogFailureReason(error), true);
    elements.skillApp.replaceChildren(emptyState({
      state: "error",
      title: t("暂时无法读取精选 Skill"),
      description: t("你的本地 Skill 不受影响，可以稍后重试。")
    }));
  }
}

function render() {
  const query = state.query;
  const items = (state.catalog?.skills ?? []).filter((item) => !query || [item.title, item.callName, item.author, item.summary].join(" ").toLocaleLowerCase().includes(query));
  if (!items.length) {
    return elements.skillApp.replaceChildren(emptyState(query ? {
      state: "search-empty",
      title: t("没有匹配的精选 Skill"),
      description: t("换个关键词，或清空搜索查看全部内容。"),
      actionLabel: t("清空搜索"),
      action: clearSearch
    } : {
      state: "empty",
      title: t("精选 Skill 目录暂时为空"),
      description: t("首个 Skill 会在真实投稿并通过人工审核后出现。")
    }));
  }
  const grid = element("section", "curated-skill-grid");
  grid.append(...items.map(card));
  elements.skillApp.replaceChildren(grid);
}

function card(item) {
  const root = element("article", "ui-skill-card curated-skill-card");
  root.append(
    element("h2", "ui-skill-card-title", item.title),
    element("p", "ui-skill-card-summary", item.summary)
  );
  const actions = element("div", "ui-skill-card-actions curated-skill-card-actions");
  const view = element("button", "button-secondary", t("查看说明"));
  view.type = "button";
  view.addEventListener("click", () => openDetail(item));
  actions.append(view, installButton(item));
  root.append(actions);
  return root;
}

async function openDetail(item) {
  elements.skillDetailContent.replaceChildren(element("div", "curated-skill-detail", t("正在校验并读取 Skill…")));
  elements.skillDetailDialog.showModal();
  try {
    const parsed = await loadParsed(item);
    renderDetail(item, parsed);
  } catch (error) {
    elements.skillDetailContent.replaceChildren(element("div", "curated-skill-detail", error.message || t("Skill 读取失败")));
  }
}

function renderDetail(item, parsed) {
  const root = element("article", "curated-skill-detail");
  const header = element("header");
  const copy = element("div", "curated-skill-detail-copy");
  copy.append(element("h1", "", item.title), element("p", "", item.summary));
  const action = installButton(item, parsed);
  action.classList.add("curated-skill-primary");
  header.append(copy, action);
  const maintenance = element("details", "curated-skill-maintenance");
  maintenance.append(element("summary", "", t("版本与许可")));
  const maintenanceCopy = element("div", "curated-skill-maintenance-copy");
  maintenanceCopy.append(
    element("span", "", t("作者：{author}", { author: item.author })),
    element("span", "", t("版本：{version}", { version: item.version })),
    element("span", "", t("许可：{license}", { license: item.license })),
    element("span", "", t("人工审核通过"))
  );
  maintenance.append(maintenanceCopy);
  const markdown = element("section", "curated-skill-markdown");
  const document = renderMarkdownDocument(parsed.body);
  removeDuplicateTitleHeading(document, item.title);
  markdown.append(document);
  root.append(header, maintenance, markdown);
  elements.skillDetailContent.replaceChildren(root);
}

async function loadParsed(item) {
  if (state.parsed.has(item.id)) return state.parsed.get(item.id);
  const response = await fetchCuratedPackage(item.downloadUrl);
  if (!isTrustedCuratedSkillResponseUrl(response.url || item.downloadUrl)) throw new Error(t("精选 Skill 下载跳转到不受信任的地址"));
  const archive = await readResponseBlobWithProgress(response);
  await verifyCuratedSkillPackageBlob(archive, item.sha256, item.archiveBytes);
  const parsed = await validateCuratedSkillPackage(item, archive);
  state.archives.set(item.id, archive);
  state.parsed.set(item.id, parsed);
  return parsed;
}

async function install(item, parsed, button) {
  button.disabled = true;
  button.setAttribute("aria-busy", "true");
  button.textContent = t("正在校验…");
  try {
    const verified = parsed ?? await loadParsed(item);
    const installed = await installCuratedSkillTransaction({
      state: state.creativeSkills,
      item,
      parsed: verified,
      saveBlob: saveSkillPackageBlob,
      deleteBlobs: deleteMediaBlobs,
      createSkill: async (skill) => {
        const response = await chrome.runtime.sendMessage({ type: "CREATE_CREATIVE_SKILL", skill });
        if (!response?.ok) throw new Error(response?.message || t("精选 Skill 保存失败"));
        state.creativeSkills = response.creativeSkills;
        return response;
      }
    });
    showToast(t(installed.status === "already-installed" ? "这个版本已经在本地" : installed.status === "install-update-copy" ? "新版本已另存，不会覆盖本地修改" : "精选 Skill 已保存到本地"));
    render();
    if (elements.skillDetailDialog.open) renderDetail(item, verified);
  } catch (error) {
    button.disabled = planCuratedSkillInstall(state.creativeSkills, item).action === "already-installed";
    button.removeAttribute("aria-busy");
    button.textContent = installLabel(item);
    showToast(error.message || t("精选 Skill 保存失败"));
  }
}

function installLabel(item) {
  const action = planCuratedSkillInstall(state.creativeSkills, item).action;
  if (action === "already-installed") return t("已保存");
  if (action === "install-update-copy") return t("另存新版本");
  return t("保存到本地");
}

function installButton(item, parsed = null) {
  const button = element("button", "button-primary", installLabel(item));
  button.type = "button";
  button.disabled = planCuratedSkillInstall(state.creativeSkills, item).action === "already-installed";
  button.addEventListener("click", () => install(item, parsed, button));
  return button;
}

function removeDuplicateTitleHeading(document, title) {
  const heading = document.querySelector?.("h1");
  if (heading && normalizedHeading(heading.textContent) === normalizedHeading(title)) heading.remove();
}

function normalizedHeading(value) {
  return String(value ?? "").trim().replace(/\s+/g, " ").toLocaleLowerCase();
}

function loading() {
  const node = element("section", "curated-loading");
  node.setAttribute("aria-label", t("正在加载精选 Skill"));
  node.append(...Array.from({ length: 4 }, () => element("span")));
  return node;
}
function emptyState({ state, title, description = "", actionLabel = "", action = null }) {
  const node = element("section", "curated-skill-empty curated-skill-state");
  node.dataset.state = state;
  const copy = element("div", "curated-skill-state-copy");
  copy.append(element("strong", "", title));
  if (description) copy.append(element("p", "", description));
  node.append(copy);
  if (actionLabel && typeof action === "function") {
    const button = element("button", "button-secondary curated-skill-state-action", actionLabel);
    button.type = "button";
    button.addEventListener("click", action);
    node.append(button);
  }
  return node;
}
function clearSearch() {
  state.query = "";
  elements.skillSearch.value = "";
  elements.skillSearch.focus();
  render();
}
function catalogFailureReason(error) {
  const status = Number(error?.status);
  if (status === 404) return t("精选 Skill 服务尚未上线或正在更新");
  if (status >= 500) return t("精选 Skill 服务暂时不可用");
  if (status >= 400) return t("精选 Skill 目录请求被拒绝");
  return t("网络连接失败，未能读取精选 Skill 目录");
}
function showStatus(message, error = false) { elements.skillStatus.textContent = message; elements.skillStatusBar.hidden = false; elements.skillStatusBar.classList.toggle("error", error); }
function hideStatus() { elements.skillStatusBar.hidden = true; elements.skillStatus.textContent = ""; }
function showToast(message) { clearTimeout(toastTimer); elements.skillToast.textContent = message; elements.skillToast.hidden = false; toastTimer = setTimeout(() => { elements.skillToast.hidden = true; }, 2600); }
function element(tag, className = "", text = "") { const node = document.createElement(tag); if (className) node.className = className; if (text) node.textContent = text; return node; }
function camel(value) { return value.replace(/-([a-z])/g, (_match, letter) => letter.toUpperCase()); }
