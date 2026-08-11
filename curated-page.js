import {
  curatedSourceKey,
  isTrustedCuratedResponseUrl,
  normalizeCuratedCatalog,
  prepareCuratedEntriesPackage,
  prepareCuratedEntryPackage,
  prepareCuratedPackageVersion,
  validateCuratedPackageContents,
  verifyCuratedPackageBlob
} from "./curated-catalog.js";
import {
  CURATED_CATALOG_URL,
  CURATED_PERMISSION_ORIGINS
} from "./curated-config.js";
import { fetchCuratedPackage } from "./curated-download.js";
import { isComposerEligibleEntry } from "./composer.js";
import { initializeUi, t } from "./i18n.js";
import { parseLibraryPackage } from "./library-package.js";
import { deleteMediaBlob, saveMediaBlob } from "./media-store.js";
import { createStableMasonry } from "./stable-masonry.js";
import { readZipBlob } from "./zip.js";

const CATALOG_CACHE_KEY = "curatedCatalogCache";
const PAGE_SIZE = 24;
const elements = Object.fromEntries([
  "active-theme-count", "active-theme-summary", "active-theme-title", "cases-view", "curated-empty", "curated-grid",
  "curated-loading", "curated-status", "detail-backdrop", "detail-close",
  "detail-content", "detail-drawer", "detail-next", "detail-prev", "load-more", "load-sentinel", "retry-catalog",
  "return-label", "return-library", "save-theme", "theme-grid", "theme-save-status", "themes-view"
].map((id) => [camel(id), document.querySelector(`#${id}`)]));

await initializeUi();
const galleryMasonry = createStableMasonry(elements.curatedGrid);
const caseImageObserver = new IntersectionObserver((items) => {
  for (const item of items) {
    if (!item.isIntersecting) continue;
    caseImageObserver.unobserve(item.target);
    hydrateCaseImage(item.target);
  }
}, { rootMargin: "320px" });
const loadObserver = new IntersectionObserver((items) => {
  if (items.some((item) => item.isIntersecting)) appendNextCases();
}, { rootMargin: "500px" });

let catalog = null;
let localEntries = [];
let activeThemeId = "";
let activeThemeRecord = null;
let curatedCases = [];
let visibleCases = [];
let renderedCount = 0;
let currentDetailKey = "";
let detailReturnFocus = null;
let loadingCases = false;
let savingThemeId = "";
const themeSaveFailures = new Map();
const themePackages = new Map();
const themeCoverUrls = new Map();
const imageUrls = new Map();
const mediaUrls = new Map();

elements.retryCatalog.addEventListener("click", () => refreshCatalog(true));
elements.returnLibrary.addEventListener("click", () => activeThemeId ? backToThemes() : returnToLibrary());
elements.saveTheme.addEventListener("click", () => saveTheme(activeThemeId, elements.saveTheme));
elements.loadMore.addEventListener("click", appendNextCases);
elements.detailBackdrop.addEventListener("click", closeDetail);
elements.detailClose.addEventListener("click", closeDetail);
elements.detailPrev.addEventListener("click", () => moveDetail(-1));
elements.detailNext.addEventListener("click", () => moveDetail(1));
document.addEventListener("keydown", (event) => {
  if (!currentDetailKey) return;
  if (event.key === "Escape") closeDetail();
  else if (event.key === "ArrowLeft") moveDetail(-1);
  else if (event.key === "ArrowRight") moveDetail(1);
});
window.addEventListener("unload", () => {
  galleryMasonry.destroy();
  caseImageObserver.disconnect();
  loadObserver.disconnect();
  releaseImageUrls();
  releaseThemeCoverUrls();
});
loadObserver.observe(elements.loadSentinel);

await loadLocalState();
await loadCachedCatalog();
renderThemes();
if (await hasCatalogPermission()) await refreshCatalog(false);
else showStatus(t("启用只读目录权限后会自动检查更新；不会上传你的本地案例。"), true, true);

function returnToLibrary() {
  location.assign(chrome.runtime.getURL("library.html"));
}

async function refreshCatalog(requestPermission) {
  elements.retryCatalog.disabled = true;
  elements.retryCatalog.hidden = true;
  try {
    if (requestPermission && !await requestCatalogPermission()) {
      throw new Error(t("未授权访问精选目录，现有本地案例没有改变"));
    }
    if (!await hasCatalogPermission()) throw new Error(t("需要授权只读精选目录后才能联网加载"));
    showStatus(t("正在检查精选目录…"));
    const response = await fetch(CURATED_CATALOG_URL, {
      cache: "no-store",
      credentials: "omit",
      redirect: "error"
    });
    if (!response.ok) throw new Error(`精选目录返回 HTTP ${response.status}`);
    catalog = normalizeCuratedCatalog(await response.json());
    await chrome.storage.local.set({ [CATALOG_CACHE_KEY]: catalog });
    renderThemes();
    showStatus(`${catalog.themes.length} ${t("期精选主题")}`);
    await loadThemeCovers(catalog.themes);
  } catch (error) {
    showStatus(`${error.message}${catalog ? " · 已保留缓存目录" : ""}`, true, true);
    renderThemes();
  } finally {
    elements.retryCatalog.disabled = false;
  }
}

async function loadCachedCatalog() {
  const stored = await chrome.storage.local.get(CATALOG_CACHE_KEY);
  try {
    if (stored[CATALOG_CACHE_KEY]) catalog = normalizeCuratedCatalog(stored[CATALOG_CACHE_KEY]);
  } catch {
    await chrome.storage.local.remove(CATALOG_CACHE_KEY);
  }
}

async function loadLocalState() {
  const response = await chrome.runtime.sendMessage({ type: "GET_STATE" });
  if (!response?.ok) throw new Error(response?.message || "无法读取本地案例库");
  localEntries = response.entries ?? [];
}

function renderThemes() {
  showActiveView();
  if (!catalog?.themes?.length) {
    elements.themeGrid.replaceChildren();
    return;
  }
  elements.themeGrid.replaceChildren(...catalog.themes.map(createThemeCard));
}

function createThemeCard(theme) {
  const card = document.createElement("article");
  card.className = "theme-card";
  const open = textElement("button", "theme-open", "");
  open.type = "button";
  open.setAttribute("aria-label", t("打开 {title}", { title: theme.title }));
  open.addEventListener("click", () => openTheme(theme.id));
  const cover = document.createElement("span");
  cover.className = "theme-cover";
  const coverUrl = themeCoverUrls.get(theme.id);
  if (coverUrl) {
    const image = document.createElement("img");
    image.src = coverUrl;
    image.alt = `${theme.title} 封面`;
    image.decoding = "async";
    image.loading = "eager";
    cover.append(image);
  } else {
    cover.append(textElement("span", "", t("封面加载中")));
  }
  const copy = document.createElement("span");
  copy.className = "theme-copy";
  copy.append(
    textElement("strong", "", theme.title),
    textElement("span", "", `${theme.caseCount} ${t("个案例")}`),
    textElement("p", "", theme.summary)
  );
  open.append(cover, copy);
  const actions = document.createElement("div");
  actions.className = "theme-card-actions";
  const savedCount = themeSavedCount(theme);
  actions.append(textElement("small", "", `${savedCount}/${theme.caseCount} ${t("已保存")}`));
  const save = textElement("button", "button-secondary", t(savedCount >= theme.caseCount ? "已全部保存" : "全部保存"));
  save.type = "button";
  save.disabled = savingThemeId === theme.id || savedCount >= theme.caseCount;
  save.addEventListener("click", () => saveTheme(theme.id, save));
  actions.append(save);
  card.append(open, actions);
  return card;
}

async function loadThemeCovers(themes) {
  const pending = themes.filter((theme) => !themeCoverUrls.has(theme.id));
  await Promise.allSettled(pending.map(async (theme) => {
    const response = await fetch(theme.coverUrl, { cache: "force-cache", credentials: "omit", redirect: "error" });
    if (!response.ok || !isTrustedCuratedResponseUrl(response.url)) throw new Error("精选主题封面地址无效");
    const blob = await response.blob();
    if (!blob.type.startsWith("image/")) throw new Error("精选主题封面格式无效");
    themeCoverUrls.set(theme.id, URL.createObjectURL(blob));
  }));
  renderThemes();
}

async function openTheme(themeId) {
  const theme = catalog?.themes.find((item) => item.id === themeId);
  if (!theme) return showStatus("没有找到这期精选主题", true);
  activeThemeId = theme.id;
  elements.activeThemeTitle.textContent = theme.title;
  elements.activeThemeSummary.textContent = theme.summary;
  showActiveView();
  showLoading(true);
  try {
    activeThemeRecord = await loadThemePackage(theme);
    curatedCases = activeThemeRecord.records;
    showLoading(false);
    renderCases();
    updateThemeSaveUi();
    showStatus("");
  } catch (error) {
    showLoading(false);
    showStatus(error.message, true);
    backToThemes();
  }
}

async function loadThemePackage(theme) {
  if (themePackages.has(theme.id)) return themePackages.get(theme.id);
  showStatus(`正在加载 ${theme.title}…`);
  const response = await fetchCuratedPackage(theme.downloadUrl);
  if (!response.ok || !isTrustedCuratedResponseUrl(response.url)) {
    throw new Error(`精选案例包下载失败（HTTP ${response.status}）`);
  }
  const archive = await response.blob();
  await verifyCuratedPackageBlob(archive, theme.sha256);
  const files = await readZipBlob(archive);
  const libraryFile = files.get("library.json");
  if (!libraryFile) throw new Error("精选案例包缺少 library.json");
  const sourceLibrary = JSON.parse(await libraryFile.text());
  const preparedLibrary = prepareCuratedPackageVersion(sourceLibrary, theme);
  const parsed = parseLibraryPackage(preparedLibrary, files);
  validateCuratedPackageContents(theme, parsed);
  const record = {
    theme,
    library: preparedLibrary,
    files,
    records: parsed.entries.map((entry) => {
      const media = primaryMedia(entry);
      const image = media?.kind === "video" ? posterImage(entry, media) : media;
      return {
        key: `${theme.id}:${entry.id}`,
        theme,
        entry,
        media,
        mediaBlob: media ? parsed.assets.get(media.id) ?? null : null,
        image,
        imageBlob: image ? parsed.images.get(image.id) ?? null : null,
        library: preparedLibrary,
        files
      };
    })
  };
  themePackages.set(theme.id, record);
  return record;
}

function backToThemes() {
  closeDetail();
  activeThemeId = "";
  activeThemeRecord = null;
  curatedCases = [];
  visibleCases = [];
  renderedCount = 0;
  galleryMasonry.reset();
  elements.curatedGrid.replaceChildren();
  releaseImageUrls();
  showLoading(false);
  renderThemes();
}

function renderCases() {
  if (loadingCases) return;
  visibleCases = [...curatedCases];
  elements.activeThemeCount.textContent = `${visibleCases.length} ${t("个精选案例")}`;
  caseImageObserver.disconnect();
  releaseImageUrls();
  galleryMasonry.reset();
  elements.curatedGrid.replaceChildren();
  renderedCount = 0;
  appendNextCases();
  elements.curatedEmpty.hidden = visibleCases.length > 0;
  if (currentDetailKey && !visibleCases.some((record) => record.key === currentDetailKey)) closeDetail();
}

function appendNextCases() {
  if (!activeThemeId || renderedCount >= visibleCases.length) return updateLoadMore();
  const records = visibleCases.slice(renderedCount, renderedCount + PAGE_SIZE);
  const cards = records.map(createCaseCard);
  elements.curatedGrid.append(...cards);
  galleryMasonry.append(cards);
  renderedCount += records.length;
  updateLoadMore();
}

function updateLoadMore() {
  const remaining = Math.max(0, visibleCases.length - renderedCount);
  elements.loadMore.hidden = remaining === 0;
  elements.loadMore.textContent = remaining
    ? t("继续加载（剩余 {count}）", { count: remaining })
    : t("继续加载");
}

function createCaseCard(record) {
  const card = document.createElement("article");
  card.className = "case-card";
  card.tabIndex = 0;
  card.dataset.entryId = record.entry.id;
  card.setAttribute("aria-label", t("查看案例：{title}", { title: record.entry.title }));
  const open = () => openDetail(record.key, card);
  card.addEventListener("click", open);
  card.addEventListener("keydown", (event) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    open();
  });
  const imageWrap = document.createElement("div");
  imageWrap.className = "case-image-wrap case-image-wrap-fixed";
  imageWrap.style.aspectRatio = imageRatio(record.image);
  if (record.imageBlob) {
    const image = document.createElement("img");
    image.className = "case-shot";
    image.alt = `${record.entry.title} 对应画面`;
    image.dataset.recordKey = record.key;
    image.decoding = "async";
    image.loading = "lazy";
    imageWrap.append(image);
    caseImageObserver.observe(image);
  } else {
    imageWrap.append(textElement("span", "case-shot-missing", t("暂无预览图")));
  }
  const saved = textElement("span", "share-check", "✓");
  saved.setAttribute("aria-label", t("已保存"));
  if (isSaved(record)) card.classList.add("curated-saved-card");
  card.append(imageWrap, saved);
  return card;
}

function hydrateCaseImage(image) {
  const record = curatedCases.find((item) => item.key === image.dataset.recordKey);
  if (!record || !image.isConnected) return;
  image.src = recordImageUrl(record);
}

function openDetail(key, returnFocus = null) {
  currentDetailKey = key;
  if (returnFocus) detailReturnFocus = returnFocus;
  document.documentElement.classList.add("detail-open");
  elements.detailDrawer.classList.add("open");
  elements.detailDrawer.setAttribute("aria-hidden", "false");
  elements.detailBackdrop.hidden = false;
  renderDetail();
  elements.detailClose.focus();
}

function closeDetail() {
  const returnFocus = detailReturnFocus;
  currentDetailKey = "";
  detailReturnFocus = null;
  document.documentElement.classList.remove("detail-open");
  elements.detailDrawer.classList.remove("open");
  elements.detailDrawer.setAttribute("aria-hidden", "true");
  elements.detailBackdrop.hidden = true;
  elements.detailContent.replaceChildren();
  returnFocus?.focus();
}

function moveDetail(offset) {
  const index = visibleCases.findIndex((record) => record.key === currentDetailKey);
  const target = visibleCases[index + offset];
  if (target) openDetail(target.key);
}

function renderDetail() {
  const record = curatedCases.find((item) => item.key === currentDetailKey);
  if (!record) return closeDetail();
  const visibleIndex = visibleCases.findIndex((item) => item.key === record.key);
  elements.detailPrev.disabled = visibleIndex <= 0;
  elements.detailNext.disabled = visibleIndex < 0 || visibleIndex >= visibleCases.length - 1;
  const content = document.createDocumentFragment();
  const figure = document.createElement("figure");
  figure.className = "detail-figure";
  if (record.media?.kind === "video" && record.mediaBlob) {
    const video = document.createElement("video");
    video.src = recordMediaUrl(record);
    video.controls = true;
    video.playsInline = true;
    video.preload = "metadata";
    if (record.imageBlob) video.poster = recordImageUrl(record);
    figure.append(video);
  } else if (record.imageBlob) {
    const image = document.createElement("img");
    image.src = recordImageUrl(record);
    image.alt = `${record.entry.title} 对应画面`;
    figure.append(image);
  } else {
    figure.append(textElement("span", "case-shot-missing", t("暂无预览图")));
  }
  content.append(figure);
  const body = document.createElement("div");
  body.className = "detail-body";
  const heading = document.createElement("header");
  heading.className = "detail-heading";
  heading.append(textElement("h2", "", record.entry.title || t("未命名案例")));
  body.append(heading);
  const metadata = document.createElement("section");
  metadata.className = "detail-metadata";
  metadata.append(textElement("span", "", sourceRightsLabel(record.entry)));
  body.append(metadata);
  const promptSection = document.createElement("section");
  promptSection.className = "detail-section";
  promptSection.append(
    textElement("h3", "", t("完整提示词")),
    textElement("pre", "detail-prompt", record.entry.text || t("暂无提示词"))
  );
  body.append(promptSection);
  const actions = document.createElement("div");
  actions.className = "detail-actions";
  const copy = textElement("button", "button-secondary", t("复制提示词"));
  copy.type = "button";
  copy.disabled = !record.entry.text;
  copy.addEventListener("click", () => copyPrompt(record.entry.text, copy));
  const save = textElement("button", isSaved(record) ? "saved" : "", isSaved(record) ? t("已保存到我的案例库") : t("保存到我的案例库"));
  save.type = "button";
  save.disabled = isSaved(record);
  save.addEventListener("click", () => saveCuratedCase(record, save));
  const create = textElement("button", "create-action", t("以此创作"));
  create.type = "button";
  const creativeType = record.media?.kind === "video" ? "video" : "image";
  create.disabled = !isComposerEligibleEntry(record.entry, creativeType);
  create.title = create.disabled ? "当前案例缺少可用提示词" : "作为单一参考进入创作台";
  create.addEventListener("click", () => openComposerForRecord(record, create));
  actions.append(copy, save, create);
  body.append(actions);
  content.append(body);
  elements.detailContent.replaceChildren(content);
}

async function saveCuratedCase(record, button, { refreshUi = true } = {}) {
  if (savedEntryForRecord(record)) return true;
  if (button) button.disabled = true;
  try {
    showStatus(`${t("正在保存")}：${record.entry.title}…`);
    const selectedLibrary = prepareCuratedEntryPackage(record.library, record.entry.id);
    await importCuratedLibrary(selectedLibrary, record.files);
    await loadLocalState();
    showStatus(`${record.entry.title} · ${t("已保存到我的案例库")}`);
    if (refreshUi) {
      renderCases();
      renderDetail();
      renderThemes();
    }
    return true;
  } catch (error) {
    showStatus(error.message, true);
    if (button?.isConnected) button.disabled = false;
    return false;
  }
}

async function saveTheme(themeId, button) {
  const theme = catalog?.themes.find((item) => item.id === themeId);
  if (!theme || savingThemeId) return;
  savingThemeId = theme.id;
  if (button) button.disabled = true;
  renderThemes();
  let completed = 0;
  let imported = 0;
  let skipped = 0;
  try {
    const themeRecord = await loadThemePackage(theme);
    const pendingRecords = themeRecord.records.filter((record) => !savedEntryForRecord(record));
    skipped = themeRecord.records.length - pendingRecords.length;
    completed = skipped;
    const batches = chunk(pendingRecords.map((record) => record.entry.id), PAGE_SIZE);
    updateThemeProgress(completed, theme.caseCount, skipped ? `已跳过 ${skipped} 个已有案例` : "准备保存");
    for (const ids of batches) {
      const selectedLibrary = prepareCuratedEntriesPackage(themeRecord.library, ids);
      const result = await importCuratedLibrary(selectedLibrary, themeRecord.files);
      imported += result.importedCount ?? 0;
      skipped += result.skippedCount ?? 0;
      completed += ids.length;
      await loadLocalState();
      updateThemeProgress(completed, theme.caseCount, `${completed}/${theme.caseCount}`);
      showStatus(`${theme.title} · 已处理 ${completed}/${theme.caseCount}`);
    }
    themeSaveFailures.delete(theme.id);
    showStatus(`${theme.title} · 新增 ${imported} 个，跳过 ${skipped} 个已有案例`);
  } catch (error) {
    themeSaveFailures.set(theme.id, Math.max(1, theme.caseCount - completed));
    showStatus(`${error.message} · 已完成 ${completed}/${theme.caseCount}，可重试剩余案例`, true);
  } finally {
    savingThemeId = "";
    if (button?.isConnected) button.disabled = false;
    renderThemes();
    if (activeThemeId === theme.id && themePackages.has(theme.id)) {
      activeThemeRecord = themePackages.get(theme.id);
      curatedCases = activeThemeRecord.records;
      renderCases();
      updateThemeSaveUi();
    }
  }
}

async function importCuratedLibrary(library, files) {
  const parsed = parseLibraryPackage(library, files);
  const preview = await chrome.runtime.sendMessage({
    type: "PREVIEW_LIBRARY_IMPORT",
    library,
    preserveLibraryConfiguration: true
  });
  if (!preview?.ok) throw new Error(preview?.message || "无法检查精选案例");
  const storedAssetIds = [];
  let applied = false;
  try {
    for (const entry of parsed.entries) {
      if (!preview.entryIdMap?.[entry.id]) continue;
      for (const asset of entry.mediaAssets) {
        const targetId = preview.visualIdMap?.[asset.id] ?? asset.id;
        const blob = parsed.assets.get(asset.id);
        if (!blob) throw new Error("精选案例媒体缺失");
        await saveMediaBlob(targetId, blob);
        storedAssetIds.push(targetId);
      }
    }
    const result = await chrome.runtime.sendMessage({
      type: "APPLY_LIBRARY_IMPORT",
      library,
      entryIdMap: preview.entryIdMap,
      visualIdMap: preview.visualIdMap,
      compoundIdMap: preview.compoundIdMap,
      sessionIdMap: preview.sessionIdMap,
      runIdMap: preview.runIdMap,
      preserveLibraryConfiguration: true
    });
    if (!result?.ok) throw new Error(result?.message || "精选案例保存失败");
    applied = true;
    return { ...preview, ...result };
  } catch (error) {
    if (!applied) await Promise.allSettled(storedAssetIds.map((id) => deleteMediaBlob(id)));
    throw error;
  }
}

async function openComposerForRecord(record, button) {
  const creativeType = record.media?.kind === "video" ? "video" : "image";
  if (!isComposerEligibleEntry(record.entry, creativeType)) {
    return showStatus("当前案例缺少可作为参考的提示词", true);
  }
  button.disabled = true;
  try {
    if (!savedEntryForRecord(record) && !await saveCuratedCase(record, button, { refreshUi: false })) return;
    const savedEntry = savedEntryForRecord(record);
    if (!savedEntry) throw new Error("案例保存后未能在本地案例库中找到，请重试");
    const url = new URL(chrome.runtime.getURL("composer.html"));
    url.searchParams.set("references", savedEntry.id);
    url.searchParams.set("type", creativeType);
    location.assign(url.href);
  } catch (error) {
    showStatus(error.message || "无法打开创作台", true);
  } finally {
    if (button.isConnected) button.disabled = false;
  }
}

function updateThemeSaveUi() {
  const theme = catalog?.themes.find((item) => item.id === activeThemeId);
  if (!theme) return;
  const saved = themeSavedCount(theme);
  const failed = themeSaveFailures.get(theme.id) ?? 0;
  elements.saveTheme.textContent = savingThemeId === theme.id
    ? `保存中 ${saved}/${theme.caseCount}`
    : failed
      ? `重试失败 ${failed}`
      : t(saved >= theme.caseCount ? "已全部保存" : "全部保存");
  elements.saveTheme.disabled = savingThemeId === theme.id || saved >= theme.caseCount;
  elements.themeSaveStatus.textContent = `${saved}/${theme.caseCount} 已保存`;
}

function updateThemeProgress(value, max, label) {
  if (!activeThemeId) return;
  if (savingThemeId === activeThemeId) elements.saveTheme.textContent = `保存中 ${Math.min(value, max)}/${max}`;
  elements.themeSaveStatus.textContent = label;
}

function themeSavedCount(theme) {
  const loaded = themePackages.get(theme.id);
  if (loaded) return loaded.records.filter((record) => savedEntryForRecord(record)).length;
  const identities = new Set(localEntries
    .filter((entry) => entry.curatedOrigin?.packageId === theme.packageId)
    .map(curatedSourceKey)
    .filter(Boolean));
  return Math.min(theme.caseCount, identities.size);
}

function recordImageUrl(record) {
  if (!record.imageBlob) return "";
  if (!imageUrls.has(record.entry.id)) imageUrls.set(record.entry.id, URL.createObjectURL(record.imageBlob));
  return imageUrls.get(record.entry.id);
}

function recordMediaUrl(record) {
  if (!record.mediaBlob) return "";
  if (!mediaUrls.has(record.entry.id)) mediaUrls.set(record.entry.id, URL.createObjectURL(record.mediaBlob));
  return mediaUrls.get(record.entry.id);
}

async function copyPrompt(text, button) {
  try {
    await navigator.clipboard.writeText(text);
    button.textContent = t("已复制");
    setTimeout(() => {
      if (button.isConnected) button.textContent = t("复制提示词");
    }, 1200);
  } catch {
    showStatus(t("浏览器未允许复制，请选中文本后复制"), true);
  }
}

function isSaved(record) {
  return Boolean(savedEntryForRecord(record));
}

function savedEntryForRecord(record) {
  const sourceKey = curatedSourceKey(record?.entry);
  if (!sourceKey) return localEntries.find((entry) => entry.id === record?.entry?.id) ?? null;
  return localEntries.find((entry) => curatedSourceKey(entry) === sourceKey) ?? null;
}

function primaryMedia(entry) {
  const content = (entry.mediaAssets ?? []).filter((asset) => asset.usage !== "poster");
  return content.find((asset) => asset.id === entry.primaryMediaId) ?? content[0] ?? null;
}

function posterImage(entry, media) {
  const images = (entry.mediaAssets ?? []).filter((asset) => asset.kind === "image");
  return images.find((asset) => asset.id === media?.posterAssetId)
    ?? images.find((asset) => asset.usage === "poster")
    ?? null;
}

function imageRatio(image) {
  const width = Number(image?.width);
  const height = Number(image?.height);
  return width > 0 && height > 0 ? `${width} / ${height}` : "4 / 3";
}

function sourceRightsLabel(entry) {
  return String(entry.metadataLabels?.[0] ?? "").trim() || t("权利归原作者");
}

function showActiveView() {
  elements.themesView.hidden = Boolean(activeThemeId);
  elements.casesView.hidden = !activeThemeId;
  elements.returnLabel.textContent = t(activeThemeId ? "返回主题" : "返回我的案例库");
}

function showLoading(active) {
  loadingCases = active;
  elements.curatedLoading.hidden = !active;
  if (active) {
    elements.themesView.hidden = true;
    elements.casesView.hidden = true;
  } else {
    showActiveView();
  }
}

function releaseImageUrls() {
  for (const url of imageUrls.values()) URL.revokeObjectURL(url);
  imageUrls.clear();
  for (const url of mediaUrls.values()) URL.revokeObjectURL(url);
  mediaUrls.clear();
}

function releaseThemeCoverUrls() {
  for (const url of themeCoverUrls.values()) URL.revokeObjectURL(url);
  themeCoverUrls.clear();
}

async function hasCatalogPermission() {
  return chrome.permissions.contains({ origins: CURATED_PERMISSION_ORIGINS });
}

async function requestCatalogPermission() {
  if (await hasCatalogPermission()) return true;
  return chrome.permissions.request({ origins: CURATED_PERMISSION_ORIGINS });
}

function showStatus(message, error = false, retry = false) {
  elements.curatedStatus.textContent = message;
  elements.curatedStatus.classList.toggle("error", error);
  elements.retryCatalog.hidden = !retry;
}

function textElement(tagName, className, text) {
  const element = document.createElement(tagName);
  if (className) element.className = className;
  element.textContent = text;
  return element;
}

function chunk(values, size) {
  return Array.from({ length: Math.ceil(values.length / size) }, (_, index) => values.slice(index * size, (index + 1) * size));
}

function camel(value) {
  return value.replace(/-([a-z])/g, (_, character) => character.toUpperCase());
}
