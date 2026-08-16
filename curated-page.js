import {
  curatedSourceKey,
  isTrustedCuratedResponseUrl,
  normalizeCuratedCatalog,
  normalizeCuratedMetrics,
  normalizeCuratedPreview,
  prepareCuratedEntryPackage,
  prepareCuratedEntriesPackage,
  prepareCuratedPackageVersion,
  validateCuratedPackageIndex,
  verifyCuratedPackageBlob
} from "./curated-catalog.js";
import {
  CURATED_CATALOG_URL,
  CURATED_METRICS_URL,
  CURATED_PUBLIC_SITE_URL
} from "./curated-config.js";
import { fetchCuratedPackage, readResponseBlobWithProgress } from "./curated-download.js";
import { initializeUi, t } from "./i18n.js";
import { parseLibraryPackage } from "./library-package.js";
import { deleteMediaBlob, saveMediaBlob } from "./media-store.js";
import { createStableMasonry } from "./stable-masonry.js";
import { openZipBlob } from "./zip.js";

const CATALOG_CACHE_KEY = "curatedCatalogCache";
const METRICS_CACHE_KEY = "curatedMetricsCache";
const FOLLOWING_KEY = "curatedFollowingAuthors";
const CURATED_CASE_PAGE_SIZE = 24;
const elements = Object.fromEntries([
  "case-detail-backdrop", "case-detail-close", "case-detail-content", "case-detail-drawer", "case-detail-next", "case-detail-prev",
  "clear-filters", "curated-app", "curated-search", "curated-status", "curated-status-bar", "curated-toast",
  "detail-close", "detail-content", "detail-dialog", "filter-button", "filter-count", "filter-popover",
  "retry-catalog", "return-library", "sort-downloads", "sort-label", "sort-menu"
].map((id) => [camel(id), document.querySelector(`#${id}`)]));

await initializeUi();

const state = {
  catalog: null,
  metrics: null,
  previews: new Map(),
  previewFailures: new Set(),
  localEntries: [],
  localStateAvailable: false,
  following: new Set(),
  filters: new Set(),
  query: "",
  sort: "recommended",
  selectedId: "",
  selectedEntryId: ""
};
const archivePromises = new Map();
const packageIndexPromises = new Map();
const progressListeners = new Map();
const caseVideoControllers = new Set();
let toastTimer = 0;
let searchVersion = 0;
let detailReturnFocus = null;
let caseDetailReturnFocus = null;
let caseMasonry = null;
let caseLoadObserver = null;
let renderedCaseCount = 0;
let caseDetailVideoCleanup = null;

elements.returnLibrary.addEventListener("click", returnToLibrary);
elements.retryCatalog.addEventListener("click", refreshCatalog);
elements.detailClose.addEventListener("click", closeDetail);
elements.detailDialog.addEventListener("click", (event) => {
  if (event.target === elements.detailDialog) closeDetail();
});
elements.caseDetailBackdrop.addEventListener("click", closeCaseDetail);
elements.caseDetailClose.addEventListener("click", closeCaseDetail);
elements.caseDetailPrev.addEventListener("click", () => moveCaseDetail(-1));
elements.caseDetailNext.addEventListener("click", () => moveCaseDetail(1));
elements.curatedSearch.addEventListener("input", async () => {
  const version = ++searchVersion;
  state.query = elements.curatedSearch.value.trim().toLocaleLowerCase();
  renderGallery();
  if (!state.query) return;
  await loadAllPreviews();
  if (version === searchVersion) renderGallery();
});
elements.filterButton.addEventListener("click", () => {
  elements.filterPopover.hidden = !elements.filterPopover.hidden;
  elements.filterButton.setAttribute("aria-expanded", String(!elements.filterPopover.hidden));
});
elements.filterPopover.addEventListener("change", updateFilters);
elements.clearFilters.addEventListener("click", () => {
  elements.filterPopover.querySelectorAll('input[type="checkbox"]').forEach((input) => { input.checked = false; });
  state.filters.clear();
  updateFilterCount();
  renderGallery();
});
elements.sortMenu.addEventListener("click", (event) => {
  const button = event.target.closest("[data-sort]");
  if (!button || button.disabled) return;
  state.sort = button.dataset.sort;
  elements.sortLabel.textContent = button.querySelector("span").textContent;
  elements.sortMenu.querySelectorAll("[data-sort]").forEach((candidate) => {
    candidate.setAttribute("aria-current", String(candidate === button));
  });
  elements.sortMenu.open = false;
  renderGallery();
});
document.addEventListener("click", (event) => {
  if (!event.target.closest(".filter-wrap")) {
    elements.filterPopover.hidden = true;
    elements.filterButton.setAttribute("aria-expanded", "false");
  }
  if (!event.target.closest(".sort-menu")) elements.sortMenu.open = false;
});
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && state.selectedEntryId) {
    event.preventDefault();
    closeCaseDetail();
    return;
  }
  if (event.key === "Escape" && elements.detailDialog.open) {
    event.preventDefault();
    closeDetail();
    return;
  }
  if (state.selectedEntryId && !event.target.matches("input, textarea, select")) {
    if (event.key === "ArrowLeft") moveCaseDetail(-1);
    if (event.key === "ArrowRight") moveCaseDetail(1);
  }
  if ((event.metaKey || event.ctrlKey) && event.key.toLocaleLowerCase() === "k") {
    event.preventDefault();
    elements.curatedSearch.focus();
  }
});

await loadCachedPublicState();
if (state.catalog) renderGallery();
const localStatePromise = loadLocalState().then(() => true).catch(() => false);
await refreshCatalog();
if (!await localStatePromise) {
  showStatus(t("私人案例库暂不可用，精选仍可浏览"), { error: true });
}
const requestedId = new URLSearchParams(location.search).get("pack");
if (requestedId && state.catalog) openDetail(requestedId);

function returnToLibrary() {
  location.assign(chrome.runtime.getURL("library.html"));
}

async function loadLocalState() {
  const response = await chrome.runtime.sendMessage({ type: "GET_STATE" });
  if (!response?.ok) throw new Error(response?.message || "无法读取本地案例库");
  state.localEntries = response.entries ?? [];
  state.localStateAvailable = true;
}

async function loadCachedPublicState() {
  const stored = await chrome.storage.local.get([CATALOG_CACHE_KEY, METRICS_CACHE_KEY, FOLLOWING_KEY]);
  state.following = new Set(Array.isArray(stored[FOLLOWING_KEY]) ? stored[FOLLOWING_KEY].filter((id) => typeof id === "string") : []);
  try {
    if (stored[CATALOG_CACHE_KEY]) state.catalog = normalizeCuratedCatalog(stored[CATALOG_CACHE_KEY]);
  } catch {
    await chrome.storage.local.remove(CATALOG_CACHE_KEY);
  }
  try {
    if (state.catalog && stored[METRICS_CACHE_KEY]) state.metrics = normalizeCuratedMetrics(stored[METRICS_CACHE_KEY], state.catalog);
  } catch {
    await chrome.storage.local.remove(METRICS_CACHE_KEY);
  }
  updateMetricsUi();
}

async function refreshCatalog() {
  elements.retryCatalog.disabled = true;
  try {
    const response = await fetch(CURATED_CATALOG_URL, { cache: "no-store", credentials: "omit", redirect: "error" });
    if (!response.ok) throw new Error(`精选目录返回 HTTP ${response.status}`);
    state.catalog = normalizeCuratedCatalog(await response.json());
    await chrome.storage.local.set({ [CATALOG_CACHE_KEY]: state.catalog });
    state.previews.clear();
    state.previewFailures.clear();
    renderGallery();
    hideStatus();
    await refreshMetrics();
  } catch (error) {
    showStatus(`${friendlyError(error, t("精选目录加载失败"))}${state.catalog ? ` · ${t("目录信息已缓存，可稍后重试")}` : ""}`, { error: true, retry: true });
    renderGallery();
  } finally {
    elements.retryCatalog.disabled = false;
  }
}

async function refreshMetrics() {
  if (!state.catalog) return;
  try {
    const response = await fetch(CURATED_METRICS_URL, { cache: "no-store", credentials: "omit", redirect: "error" });
    if (!response.ok) throw new Error(`精选指标返回 HTTP ${response.status}`);
    state.metrics = normalizeCuratedMetrics(await response.json(), state.catalog);
    await chrome.storage.local.set({ [METRICS_CACHE_KEY]: state.metrics });
  } catch {
    if (!state.metrics) await chrome.storage.local.remove(METRICS_CACHE_KEY);
  }
  updateMetricsUi();
  renderGallery();
}

function updateMetricsUi() {
  elements.sortDownloads.disabled = !state.metrics;
  if (!state.metrics && state.sort === "downloads") {
    state.sort = "recommended";
    elements.sortLabel.textContent = t("推荐");
  }
}

function renderGallery() {
  if (!state.catalog?.themes?.length) {
    elements.curatedApp.replaceChildren(element("div", "curated-empty", t("还没有可显示的精选案例")));
    return;
  }
  const items = visibleItems();
  if (!items.length) {
    elements.curatedApp.replaceChildren(element("div", "curated-empty", t("没有结果")));
    return;
  }
  const grid = element("section", "pack-grid");
  grid.append(...items.map(createPackCard));
  elements.curatedApp.replaceChildren(grid);
}

function visibleItems() {
  let items = state.catalog.themes.filter((item) => {
    if (state.filters.has("followed") && !state.following.has(item.authorId)) return false;
    const typeFilters = [...state.filters].filter((value) => value !== "followed");
    if (typeFilters.length && !typeFilters.includes(item.type)) return false;
    return !state.query || searchableText(item).includes(state.query);
  });
  if (state.sort === "latest") {
    items = [...items].sort((left, right) => new Date(right.updatedAt) - new Date(left.updatedAt) || left.order - right.order);
  } else if (state.sort === "downloads" && state.metrics) {
    items = [...items].sort((left, right) => state.metrics.downloads[right.id] - state.metrics.downloads[left.id] || left.order - right.order);
  } else {
    items = [...items].sort((left, right) => left.order - right.order);
  }
  return items;
}

function searchableText(item) {
  const preview = state.previews.get(item.id);
  return [item.title, item.author, ...(preview?.entries ?? []).flatMap((entry) => [entry.title, entry.author, entry.text])]
    .join(" ")
    .toLocaleLowerCase();
}

function createPackCard(item) {
  const card = element("article", "pack-card");
  card.dataset.packId = item.id;
  card.tabIndex = 0;
  card.setAttribute("aria-label", t("打开 {title}", { title: item.title }));
  const cover = element("span", "pack-cover");
  const image = element("img");
  image.src = item.coverUrl;
  image.alt = "";
  image.loading = "lazy";
  cover.append(image);
  const copy = element("div", "pack-copy");
  copy.append(element("h2", "", item.title));
  const meta = element("div", "pack-meta");
  meta.append(element("span", "", item.author), element("span", "", `${item.caseCount} ${t("个案例")}`));
  copy.append(meta);
  card.append(cover, copy);
  const open = () => openDetail(item.id, card);
  card.addEventListener("click", open);
  card.addEventListener("keydown", (event) => {
    if (!["Enter", " "].includes(event.key)) return;
    event.preventDefault();
    open();
  });
  return card;
}

async function openDetail(id, returnFocus = null) {
  const item = state.catalog?.themes.find((candidate) => candidate.id === id);
  if (!item) return showToast(t("案例包不存在"));
  state.selectedId = item.id;
  if (returnFocus) detailReturnFocus = returnFocus;
  setDetailUrl(item.id);
  renderDetail(item, null);
  document.documentElement.classList.add("detail-open");
  if (!elements.detailDialog.open) elements.detailDialog.showModal();
  elements.detailClose.focus({ preventScroll: true });
  try {
    const preview = await loadPreview(item);
    if (state.selectedId === item.id) renderDetail(item, preview);
  } catch (error) {
    showToast(friendlyError(error, t("预览加载失败")));
    if (state.selectedId === item.id) renderDetail(item, null, true);
  }
}

function closeDetail() {
  if (state.selectedEntryId) closeCaseDetail({ restoreFocus: false });
  const returnFocus = detailReturnFocus;
  const selectedId = state.selectedId;
  cleanupCaseGallery();
  state.selectedId = "";
  detailReturnFocus = null;
  document.documentElement.classList.remove("detail-open");
  if (elements.detailDialog.open) elements.detailDialog.close();
  elements.detailContent.replaceChildren();
  setDetailUrl("");
  if (returnFocus?.isConnected) returnFocus.focus();
  else [...elements.curatedApp.querySelectorAll(".pack-card")].find((card) => card.dataset.packId === selectedId)?.focus();
}

function setDetailUrl(id) {
  const url = new URL(location.href);
  if (id) url.searchParams.set("pack", id);
  else url.searchParams.delete("pack");
  history.replaceState(null, "", url);
}

function renderDetail(item, preview, failed = false) {
  cleanupCaseGallery();
  const surface = element("article", "detail-surface");
  const hero = element("section", "detail-hero");
  const cover = element("div", "detail-cover");
  const coverImage = element("img");
  coverImage.src = item.coverUrl;
  coverImage.alt = "";
  cover.append(coverImage);
  const info = element("div", "detail-info");
  info.append(element("h1", "", item.title));
  const meta = element("div", "detail-meta");
  meta.append(element("span", "", item.author), element("span", "", `${item.caseCount} ${t("个案例")}`), element("span", "", rightsLabel(item.license)));
  info.append(meta);
  const actions = element("div", "detail-actions");
  const download = actionButton("download-action", "save", t("保存整包"));
  download.addEventListener("click", () => saveEntirePackage(item, download));
  const following = state.following.has(item.authorId);
  const follow = actionButton(`button-secondary follow-action${following ? " is-active" : ""}`, following ? "check" : "plus", t(following ? "已关注" : "关注"));
  follow.addEventListener("click", () => toggleFollow(item, follow));
  const copyLink = actionButton("button-secondary", "copy", t("复制链接"));
  copyLink.addEventListener("click", () => copyText(publicPackUrl(item.id), copyLink, t("已复制")));
  actions.append(download, follow, copyLink);
  info.append(actions);
  hero.append(cover, info);
  surface.append(hero);

  const section = element("section", "case-section");
  const heading = element("h2", "", t("包内案例"));
  heading.append(element("span", "", String(item.caseCount)));
  section.append(heading);
  if (preview) {
    const list = element("div", "case-list");
    const sentinel = element("div", "case-load-sentinel");
    section.append(list, sentinel);
    surface.append(section);
    elements.detailContent.replaceChildren(surface);
    startCaseGallery(item, preview, list, sentinel);
    return;
  }
  if (failed) {
    const failure = element("div", "preview-failure");
    failure.append(element("span", "", t("预览加载失败")));
    const retry = element("button", "button-secondary", t("重试"));
    retry.type = "button";
    retry.addEventListener("click", () => retryPreview(item, retry));
    failure.append(retry);
    section.append(failure);
  } else {
    const loading = element("div", "case-loading");
    loading.setAttribute("aria-label", t("正在加载包内案例"));
    section.append(loading);
  }
  surface.append(section);
  elements.detailContent.replaceChildren(surface);
}

function startCaseGallery(item, preview, list, sentinel) {
  renderedCaseCount = 0;
  caseMasonry = createStableMasonry(list, { scrollContainer: elements.detailDialog });
  const appendNext = () => {
    const entries = preview.entries.slice(renderedCaseCount, renderedCaseCount + CURATED_CASE_PAGE_SIZE);
    if (!entries.length) {
      sentinel.hidden = true;
      caseLoadObserver?.disconnect();
      return;
    }
    const cards = entries.map((entry) => createCaseCard(item, entry));
    list.append(...cards);
    caseMasonry.append(cards);
    renderedCaseCount += entries.length;
    sentinel.hidden = renderedCaseCount >= preview.entries.length;
    if (sentinel.hidden) caseLoadObserver?.disconnect();
  };
  appendNext();
  if (renderedCaseCount < preview.entries.length) {
    caseLoadObserver = new IntersectionObserver((records) => {
      if (records.some((record) => record.isIntersecting)) appendNext();
    }, { root: elements.detailDialog, rootMargin: "600px 0px" });
    caseLoadObserver.observe(sentinel);
  }
}

function cleanupCaseGallery() {
  caseLoadObserver?.disconnect();
  caseLoadObserver = null;
  caseMasonry?.destroy();
  caseMasonry = null;
  for (const controller of caseVideoControllers) controller.destroy();
  caseVideoControllers.clear();
  renderedCaseCount = 0;
}

function createCaseCard(item, entry) {
  const card = element("article", "case-card");
  card.dataset.entryId = entry.id;
  card.tabIndex = 0;
  card.setAttribute("aria-label", t("查看案例：{title}", { title: entry.title }));
  const visual = element("div", "case-image-wrap");
  visual.style.aspectRatio = `${entry.width} / ${entry.height}`;
  const image = element("img", "case-visual");
  image.src = entry.previewImageUrl;
  image.alt = "";
  image.loading = "lazy";
  image.decoding = "async";
  image.width = entry.width;
  image.height = entry.height;
  visual.append(image);
  if (entry.mediaKind === "video") {
    visual.append(element("span", "case-video-badge", "▶"));
    if (entry.videoUrl) caseVideoControllers.add(bindRemoteVideoHover(visual, entry));
  }
  if (isSaved(item, entry)) card.classList.add("is-saved");
  card.append(visual);
  const open = () => openCaseDetail(item, entry, card);
  card.addEventListener("click", open);
  card.addEventListener("keydown", (event) => {
    if (!["Enter", " "].includes(event.key)) return;
    event.preventDefault();
    open();
  });
  return card;
}

function openCaseDetail(item, entry, card) {
  state.selectedEntryId = entry.id;
  caseDetailReturnFocus = card ?? caseDetailReturnFocus;
  elements.caseDetailBackdrop.hidden = false;
  elements.caseDetailDrawer.classList.add("open");
  elements.caseDetailDrawer.setAttribute("aria-hidden", "false");
  setPackageDetailInert(true);
  renderCaseDetail(item, entry);
  elements.caseDetailClose.focus({ preventScroll: true });
}

function closeCaseDetail({ restoreFocus = true } = {}) {
  const returnFocus = caseDetailReturnFocus;
  state.selectedEntryId = "";
  caseDetailReturnFocus = null;
  elements.caseDetailDrawer.classList.remove("open");
  elements.caseDetailDrawer.setAttribute("aria-hidden", "true");
  setPackageDetailInert(false);
  elements.caseDetailBackdrop.hidden = true;
  caseDetailVideoCleanup?.();
  caseDetailVideoCleanup = null;
  elements.caseDetailContent.replaceChildren();
  if (restoreFocus && returnFocus?.isConnected) returnFocus.focus({ preventScroll: true });
}

function moveCaseDetail(offset) {
  const item = selectedItem();
  const preview = item ? state.previews.get(item.id) : null;
  if (!item || !preview) return;
  const index = preview.entries.findIndex((entry) => entry.id === state.selectedEntryId);
  const entry = preview.entries[index + offset];
  if (!entry) return;
  state.selectedEntryId = entry.id;
  renderCaseDetail(item, entry);
}

function renderCaseDetail(item, entry) {
  caseDetailVideoCleanup?.();
  caseDetailVideoCleanup = null;
  const preview = state.previews.get(item.id);
  const index = preview?.entries.findIndex((candidate) => candidate.id === entry.id) ?? -1;
  elements.caseDetailPrev.disabled = index <= 0;
  elements.caseDetailNext.disabled = index < 0 || index >= preview.entries.length - 1;
  const layout = element("article", "case-detail-layout");
  const figure = element("figure", "case-detail-figure");
  if (entry.mediaKind === "video" && entry.videoUrl) {
    const player = createRemoteVideoPlayer(entry);
    figure.append(player.node);
    caseDetailVideoCleanup = player.destroy;
  } else {
    figure.append(createRemoteImageViewer(entry, entry.previewImageUrl));
    if (entry.mediaKind === "video") figure.append(element("span", "case-detail-video-label", t("视频暂不可播放")));
  }
  const body = element("div", "case-detail-body");
  const heading = element("header", "case-detail-heading");
  heading.append(element("h2", "", entry.title), element("p", "", entry.author));
  body.append(heading);
  const promptSection = element("section", "case-detail-section");
  promptSection.append(element("h3", "", t("完整提示词")), element("pre", "case-detail-prompt", entry.text));
  body.append(promptSection);
  const source = element("div", "case-detail-source");
  source.append(element("span", "", entry.rights || rightsLabel(item.license)));
  if (entry.sourceUrl) {
    const link = element("a", "", t("查看来源"));
    link.href = entry.sourceUrl;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    source.append(link);
  }
  body.append(source);
  const actions = element("div", "case-detail-actions");
  const copy = actionButton("button-secondary", "copy", t("复制提示词"));
  copy.disabled = !entry.text;
  copy.addEventListener("click", () => copyCasePrompt(entry, copy));
  const savedEntry = findSavedEntry(item, entry);
  const save = actionButton(savedEntry ? "case-save-action is-saved" : "case-save-action", savedEntry ? "check" : "save", t(savedEntry ? "查看已保存" : "保存到案例库"));
  save.disabled = !state.localStateAvailable;
  if (!state.localStateAvailable) setButtonLabel(save, t("案例库暂不可用"));
  save.addEventListener("click", () => savedEntry ? openSavedCase(savedEntry.id) : savePreviewCase(item, entry, save));
  actions.append(copy, save);
  body.append(actions);
  layout.append(figure, body);
  elements.caseDetailContent.replaceChildren(layout);
}

async function copyCasePrompt(entry, copy) {
  await copyText(entry.text, copy, t("已复制"));
}

async function loadPreview(item) {
  if (state.previews.has(item.id)) return state.previews.get(item.id);
  if (state.previewFailures.has(item.id)) throw new Error(t("预览加载失败"));
  try {
    const response = await fetch(item.previewUrl, { cache: "no-cache", credentials: "omit", redirect: "error" });
    if (!response.ok) throw new Error(`精选预览返回 HTTP ${response.status}`);
    const preview = normalizeCuratedPreview(await response.json(), item);
    state.previews.set(item.id, preview);
    return preview;
  } catch (error) {
    state.previewFailures.add(item.id);
    throw error;
  }
}

async function loadAllPreviews() {
  if (!state.catalog) return;
  await Promise.allSettled(state.catalog.themes.map(loadPreview));
}

async function retryPreview(item, button) {
  button.disabled = true;
  state.previewFailures.delete(item.id);
  renderDetail(item, null);
  try {
    const preview = await loadPreview(item);
    if (state.selectedId === item.id) renderDetail(item, preview);
  } catch (error) {
    showToast(friendlyError(error, t("预览加载失败")));
    if (state.selectedId === item.id) renderDetail(item, null, true);
  }
}

async function loadVerifiedArchive(item, onProgress = () => undefined) {
  const unsubscribe = listenForProgress(item.id, onProgress);
  try {
    if (!archivePromises.has(item.id)) {
      archivePromises.set(item.id, (async () => {
        emitProgress(item.id, { stage: "downloading", loaded: 0, total: 0, ratio: null });
        const response = await fetchCuratedPackage(item.downloadUrl);
        if (!response.ok || !isTrustedCuratedResponseUrl(response.url)) throw new Error(`精选案例包下载失败（HTTP ${response.status}）`);
        const archive = await readResponseBlobWithProgress(response, {
          onProgress: (progress) => emitProgress(item.id, { stage: "downloading", ...progress })
        });
        if (archive.size !== item.archiveBytes) throw new Error("精选案例包下载大小与目录不一致");
        emitProgress(item.id, { stage: "verifying" });
        await verifyCuratedPackageBlob(archive, item.sha256);
        return archive;
      })().catch((error) => {
        archivePromises.delete(item.id);
        throw error;
      }));
    }
    return await archivePromises.get(item.id);
  } finally {
    unsubscribe();
  }
}

async function loadPackageIndex(item) {
  if (!packageIndexPromises.has(item.id)) {
    packageIndexPromises.set(item.id, (async () => {
      const archive = await loadVerifiedArchive(item);
      emitProgress(item.id, { stage: "extracting" });
      const reader = await openZipBlob(archive);
      const files = await reader.read(["library.json"], {
        onProgress: ({ completed, total }) => emitProgress(item.id, { stage: "extracting", completed, total })
      });
      const libraryFile = files.get("library.json");
      if (!libraryFile) throw new Error("精选案例包缺少 library.json");
      const sourceLibrary = JSON.parse(await libraryFile.text());
      const library = prepareCuratedPackageVersion(sourceLibrary, item);
      validateCuratedPackageIndex(item, library, reader.names);
      return { library, reader };
    })().catch((error) => {
      packageIndexPromises.delete(item.id);
      throw error;
    }));
  }
  return packageIndexPromises.get(item.id);
}

async function savePreviewCase(item, previewEntry, button) {
  const existing = findSavedEntry(item, previewEntry);
  if (existing) return openSavedCase(existing.id);
  button.disabled = true;
  setProgressButton(button, { stage: "downloading", loaded: 0, total: 0, ratio: null });
  try {
    const result = await saveCuratedSelection(item, [previewEntry.id], {
      mode: "case",
      onProgress: (progress) => setProgressButton(button, progress)
    });
    await loadLocalState();
    const entryId = result.entriesBySourceEntryId?.[previewEntry.id];
    if (!entryId || result.importedCount + result.existingCount !== 1) throw new Error("精选案例没有写入私人案例库");
    setProgressButton(button, { stage: result.importedCount === 1 ? "saved" : "existing" });
    markSavedCard(previewEntry.id);
    setTimeout(() => openSavedCase(entryId), 280);
  } catch (error) {
    setProgressButton(button, { stage: "failed" });
    showToast(friendlyError(error, t("精选案例保存失败")));
    if (button.isConnected) button.disabled = false;
  }
}

async function saveEntirePackage(item, button) {
  if (!await confirmPackSave(item)) return;
  button.disabled = true;
  setProgressButton(button, { stage: "downloading", loaded: 0, total: item.archiveBytes, ratio: 0 });
  try {
    const result = await saveCuratedSelection(item, null, {
      mode: "package",
      onProgress: (progress) => setProgressButton(button, progress)
    });
    await loadLocalState();
    if (!result.projectId || result.importedCount + result.existingCount !== item.caseCount) {
      throw new Error("精选案例包没有完整写入私人案例库");
    }
    setProgressButton(button, { stage: "saved" });
    setTimeout(() => openSavedProject(result.projectId), 280);
  } catch (error) {
    setProgressButton(button, { stage: "failed" });
    showToast(friendlyError(error, t("精选案例保存失败")));
    if (button.isConnected) button.disabled = false;
  }
}

async function saveCuratedSelection(item, sourceEntryIds, { mode, onProgress }) {
  const unsubscribe = listenForProgress(item.id, onProgress);
  const storedAssetIds = [];
  try {
    const { library, reader } = await loadPackageIndex(item);
    const requested = sourceEntryIds
      ? library.entries.filter((entry) => sourceEntryIds.includes(entry.curatedOrigin?.sourceEntryId))
      : library.entries;
    if (requested.length !== (sourceEntryIds?.length ?? item.caseCount)) throw new Error("精选案例包缺少请求的案例");
    const selectedLibrary = prepareCuratedEntriesPackage(library, requested.map((entry) => entry.id));
    const preview = await chrome.runtime.sendMessage({
      type: "PREVIEW_CURATED_IMPORT",
      library: selectedLibrary,
      packageId: item.packageId,
      projectName: item.title,
      mode
    });
  if (!preview?.ok) throw new Error(preview?.message || "无法检查精选案例");
    const newSources = new Set(preview.importedSourceEntryIds ?? []);
    const newEntries = selectedLibrary.entries.filter((entry) => newSources.has(entry.curatedOrigin?.sourceEntryId));
    const totalAssets = newEntries.reduce((sum, entry) => sum + entry.mediaAssets.filter((asset) => asset.storageMode !== "reference").length, 0);
    let completedAssets = 0;
    for (const entry of newEntries) {
      const singleLibrary = prepareCuratedEntryPackage(selectedLibrary, entry.id);
      const mediaPaths = entry.mediaAssets.filter((asset) => asset.storageMode !== "reference").map((asset) => asset.assetPath);
      const files = await reader.read(mediaPaths, {
        onProgress: ({ completed }) => emitProgress(item.id, { stage: "extracting", completed: completedAssets + completed, total: totalAssets })
      });
      const parsed = parseLibraryPackage(singleLibrary, files);
      for (const asset of parsed.entries.flatMap((parsedEntry) => parsedEntry.mediaAssets)) {
        if (asset.storageMode === "reference") continue;
        const targetId = preview.visualIdMap?.[asset.id] ?? asset.id;
        const blob = parsed.assets.get(asset.id);
        if (!blob) throw new Error("精选案例媒体缺失");
        await saveMediaBlob(targetId, blob);
        storedAssetIds.push(targetId);
        completedAssets += 1;
        emitProgress(item.id, { stage: "saving", completed: completedAssets, total: totalAssets });
      }
    }
    if (mode === "package") emitProgress(item.id, { stage: "creating-project" });
    const result = await chrome.runtime.sendMessage({
      type: "APPLY_CURATED_IMPORT",
      library: selectedLibrary,
      packageId: item.packageId,
      projectName: item.title,
      mode,
      entryIdMap: preview.entryIdMap,
      visualIdMap: preview.visualIdMap,
      compoundIdMap: preview.compoundIdMap,
      sessionIdMap: preview.sessionIdMap,
      runIdMap: preview.runIdMap
    });
    if (!result?.ok) throw new Error(result?.message || "精选案例保存失败");
    const retained = new Set(result.importedVisualIds ?? []);
    await Promise.allSettled(storedAssetIds.filter((id) => !retained.has(id)).map((id) => deleteMediaBlob(id)));
    return result;
  } catch (error) {
    await Promise.allSettled(storedAssetIds.map((id) => deleteMediaBlob(id)));
    throw error;
  } finally {
    unsubscribe();
  }
}

function openSavedCase(entryId) {
  const url = new URL(chrome.runtime.getURL("library.html"));
  url.searchParams.set("case", entryId);
  url.searchParams.set("source", "curated");
  location.assign(url.href);
}

function openSavedProject(projectId) {
  const url = new URL(chrome.runtime.getURL("library.html"));
  url.searchParams.set("project", projectId);
  url.searchParams.set("source", "curated");
  location.assign(url.href);
}

function confirmPackSave(item) {
  const dialog = document.querySelector("#pack-save-dialog");
  dialog.querySelector("h2").textContent = item.title;
  dialog.querySelector(".pack-save-meta").textContent = `${item.caseCount} ${t("个案例")} · ${formatBytes(item.archiveBytes)}`;
  dialog.querySelector(".pack-save-confirm").textContent = t("保存整包");
  dialog.querySelector(".pack-save-cancel").textContent = t("取消");
  return new Promise((resolve) => {
    const finish = (value) => {
      dialog.close();
      resolve(value);
    };
    dialog.querySelector(".pack-save-confirm").onclick = () => finish(true);
    dialog.querySelector(".pack-save-cancel").onclick = () => finish(false);
    dialog.oncancel = (event) => { event.preventDefault(); finish(false); };
    dialog.showModal();
  });
}

function listenForProgress(id, listener) {
  if (!progressListeners.has(id)) progressListeners.set(id, new Set());
  progressListeners.get(id).add(listener);
  return () => {
    const listeners = progressListeners.get(id);
    listeners?.delete(listener);
    if (!listeners?.size) progressListeners.delete(id);
  };
}

function emitProgress(id, progress) {
  progressListeners.get(id)?.forEach((listener) => listener(progress));
}

function setProgressButton(button, progress) {
  if (!button?.isConnected) return;
  button.classList.toggle("is-progressing", ["downloading", "verifying", "extracting", "saving", "creating-project"].includes(progress.stage));
  button.style.setProperty("--progress", progress.ratio == null ? "0" : String(progress.ratio));
  const labels = {
    verifying: t("校验中"),
    extracting: progress.total ? `${t("解包中")} ${progress.completed}/${progress.total}` : t("解包中"),
    saving: progress.total ? `${t("写入案例库")} ${progress.completed}/${progress.total}` : t("写入案例库"),
    "creating-project": t("正在创建项目"),
    saved: t("已保存"),
    existing: t("案例已存在"),
    failed: t("重试")
  };
  if (progress.stage === "downloading") {
    setButtonLabel(button, progress.total
      ? `${t("下载中")} ${Math.round((progress.ratio ?? 0) * 100)}%`
      : `${t("下载中")} ${formatBytes(progress.loaded)}`);
  } else {
    setButtonLabel(button, labels[progress.stage] || t("处理中"));
  }
}

function setButtonLabel(button, label) {
  const labelElement = button.querySelector("span");
  if (labelElement) labelElement.textContent = label;
}

function formatBytes(bytes = 0) {
  if (!bytes) return "0 MB";
  return `${(bytes / 1024 / 1024).toFixed(bytes >= 10 * 1024 * 1024 ? 1 : 2)} MB`;
}

function markSavedCard(entryId) {
  elements.detailContent.querySelector(`.case-card[data-entry-id="${CSS.escape(entryId)}"]`)?.classList.add("is-saved");
}

function isSaved(item, previewEntry) {
  return Boolean(findSavedEntry(item, previewEntry));
}

function findSavedEntry(item, previewEntry) {
  const key = curatedSourceKey({
    curatedOrigin: { packageId: item.packageId, sourceEntryId: previewEntry.id }
  });
  return state.localEntries.find((entry) => curatedSourceKey(entry) === key) ?? null;
}

function bindRemoteVideoHover(container, entry) {
  let video = null;
  const canPlay = () => document.documentElement.dataset.motion !== "reduced"
    && globalThis.matchMedia?.("(hover: hover) and (pointer: fine)")?.matches;
  const destroy = () => {
    if (!video) return;
    video.pause();
    video.removeAttribute("src");
    video.load();
    video.remove();
    video = null;
    container.classList.remove("is-video-playing", "is-video-loading");
  };
  const start = async () => {
    if (!canPlay() || video) return;
    container.classList.add("is-video-loading");
    video = document.createElement("video");
    video.className = "case-video-preview";
    video.muted = true;
    video.loop = true;
    video.playsInline = true;
    video.preload = "metadata";
    video.poster = entry.previewImageUrl;
    video.src = entry.videoUrl;
    video.setAttribute("aria-hidden", "true");
    video.addEventListener("playing", () => {
      container.classList.remove("is-video-loading");
      container.classList.add("is-video-playing");
    }, { once: true });
    video.addEventListener("error", () => {
      destroy();
      container.classList.add("is-video-preview-unavailable");
    }, { once: true });
    container.append(video);
    await video.play().catch(() => destroy());
  };
  container.addEventListener("pointerenter", start);
  container.addEventListener("pointerleave", destroy);
  return {
    destroy() {
      container.removeEventListener("pointerenter", start);
      container.removeEventListener("pointerleave", destroy);
      destroy();
    }
  };
}

function createRemoteVideoPlayer(entry) {
  const video = document.createElement("video");
  video.className = "case-detail-video";
  video.controls = true;
  video.preload = "metadata";
  video.autoplay = false;
  video.playsInline = true;
  video.poster = entry.previewImageUrl;
  video.src = entry.videoUrl;
  video.style.aspectRatio = `${entry.width} / ${entry.height}`;
  const failure = element("div", "case-video-error");
  failure.hidden = true;
  failure.append(element("span", "", t("视频加载失败")));
  const retry = element("button", "button-secondary", t("重试"));
  retry.type = "button";
  retry.addEventListener("click", () => {
    failure.hidden = true;
    video.src = entry.videoUrl;
    video.load();
  });
  failure.append(retry);
  video.addEventListener("error", () => { failure.hidden = false; });
  const wrap = element("div", "case-detail-video-wrap");
  wrap.append(video, failure);
  return {
    node: wrap,
    destroy() {
      video.pause();
      video.removeAttribute("src");
      video.load();
    }
  };
}

function createRemoteImageViewer(entry, url) {
  const image = element("img");
  image.alt = entry.title;
  image.width = entry.width;
  image.height = entry.height;
  const failure = element("div", "case-video-error");
  failure.hidden = true;
  failure.append(element("span", "", t("图片加载失败")));
  const retry = element("button", "button-secondary", t("重试"));
  retry.type = "button";
  retry.addEventListener("click", () => {
    failure.hidden = true;
    image.removeAttribute("src");
    requestAnimationFrame(() => { image.src = url; });
  });
  failure.append(retry);
  image.addEventListener("error", () => { failure.hidden = false; });
  image.src = url;
  const fragment = document.createDocumentFragment();
  fragment.append(image, failure);
  return fragment;
}

function setPackageDetailInert(inert) {
  elements.detailContent.inert = inert;
  elements.detailClose.inert = inert;
}

async function toggleFollow(item, button) {
  if (state.following.has(item.authorId)) state.following.delete(item.authorId);
  else state.following.add(item.authorId);
  await chrome.storage.local.set({ [FOLLOWING_KEY]: [...state.following] });
  updateFilters();
  const following = state.following.has(item.authorId);
  button?.classList.toggle("is-active", following);
  if (button) {
    setButtonLabel(button, t(following ? "已关注" : "关注"));
    button.querySelector("use")?.setAttribute("href", `assets/ui-icons.svg#icon-${following ? "check" : "plus"}`);
  }
}

function updateFilters() {
  state.filters = new Set([...elements.filterPopover.querySelectorAll('input[type="checkbox"]:checked')].map((input) => input.value));
  updateFilterCount();
  renderGallery();
}

function updateFilterCount() {
  elements.filterCount.textContent = state.filters.size ? ` ${state.filters.size}` : "";
}

function selectedItem() {
  return state.catalog?.themes.find((item) => item.id === state.selectedId) ?? null;
}

function publicPackUrl(id) {
  const url = new URL(CURATED_PUBLIC_SITE_URL);
  url.searchParams.set("pack", id);
  return url.href;
}

function rightsLabel(license = "") {
  if (license.includes("PromptDirector 原创")) return t("PromptDirector 原创");
  if (license.includes("权利归原作者")) return t("权利归原作者");
  return license || t("权利未标注");
}

async function copyText(value, button, successLabel) {
  const originalLabel = button?.querySelector("span")?.textContent ?? "";
  try {
    await navigator.clipboard.writeText(value);
    if (button) {
      setButtonLabel(button, successLabel);
      button.classList.add("is-success");
      setTimeout(() => {
        if (!button.isConnected) return;
        setButtonLabel(button, originalLabel);
        button.classList.remove("is-success");
      }, 1600);
    }
  } catch {
    showToast(t("浏览器未允许复制，请选中文本后复制"));
  }
}

function friendlyError(error, fallback) {
  const message = String(error?.message || "");
  if (/failed to fetch|networkerror|load failed/i.test(message)) return t("无法下载案例包，请检查网络后重试");
  return message || fallback;
}

function showStatus(message, { error = false, retry = false } = {}) {
  elements.curatedStatus.textContent = message;
  elements.curatedStatusBar.hidden = false;
  elements.curatedStatusBar.classList.toggle("error", error);
  elements.retryCatalog.hidden = !retry;
}

function hideStatus() {
  elements.curatedStatusBar.hidden = true;
  elements.curatedStatus.textContent = "";
  elements.retryCatalog.hidden = true;
}

function showToast(message) {
  clearTimeout(toastTimer);
  elements.curatedToast.textContent = message;
  elements.curatedToast.hidden = false;
  toastTimer = setTimeout(() => { elements.curatedToast.hidden = true; }, 2400);
}

function actionButton(className, iconName, label) {
  const button = element("button", className);
  button.type = "button";
  button.append(createIcon(iconName), element("span", "", label));
  return button;
}

function createIcon(name) {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("class", "ui-icon");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("aria-hidden", "true");
  const use = document.createElementNS("http://www.w3.org/2000/svg", "use");
  use.setAttribute("href", `assets/ui-icons.svg#icon-${name}`);
  svg.append(use);
  return svg;
}

function element(tagName, className = "", text = "") {
  const value = document.createElement(tagName);
  if (className) value.className = className;
  if (text) value.textContent = text;
  return value;
}

function camel(value) {
  return value.replace(/-([a-z])/g, (_, character) => character.toUpperCase());
}
