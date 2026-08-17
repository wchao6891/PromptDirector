import { normalizeSettings } from "./lib.js";
import { entryAttributeSummary } from "./library-model.js";
import { normalizeTaxonomy } from "./taxonomy.js";
import { normalizeFacetCatalog } from "./facets.js";
import { entryPalette, normalizeEntryVisuals, primaryVisionDescription } from "./visuals.js";
import { posterAssetForVideo, primaryMediaAsset } from "./media.js";
import { createSimilarityIndex, rankSimilarEntries } from "./local-similarity.js";
import { promptForEntryImage } from "./image-prompt.js";

const CONTENT_LABELS = Object.freeze({
  "content:tutorial": ["攻略教程", "Tutorial"],
  "content:prompt:image": ["图片提示词", "Image prompt"],
  "content:prompt:video": ["视频提示词", "Video prompt"],
  "content:image-case": ["图片案例", "Visual case"],
  "content:video-case": ["视频案例", "Video case"],
  "content:reference": ["资料文档", "Reference"]
});

export const SHARE_PREVIEW_HTML_FILENAME = "打开分享包.html";
export const SHARE_PREVIEW_RUNTIME_FILENAME = "share-preview-runtime.js";
export const SHARE_PREVIEW_MASONRY_FILENAME = "share-preview-masonry.js";
export const SHARE_PREVIEW_FOUNDATION_FILENAME = "share-preview-foundation.css";

export function renderSharePreviewHtml(
  entries = [],
  settings,
  taxonomyValue,
  facetCatalogValue,
  options = {}
) {
  const normalizedEntries = (Array.isArray(entries) ? entries : []).map(normalizeEntryVisuals);
  const settingsValue = normalizeSettings(settings);
  const taxonomy = normalizeTaxonomy(taxonomyValue);
  const facetCatalog = normalizeFacetCatalog(facetCatalogValue);
  const installUrl = safeWebUrl(options.installUrl);
  const locale = options.locale === "en" ? "en" : "zh-CN";
  const theme = ["system", "light", "dark"].includes(options.theme) ? options.theme : "dark";
  const iconSprite = inlineIconSprite(options.iconSprite);
  const relatedById = relatedEntriesById(normalizedEntries, facetCatalog);
  const cards = normalizedEntries.map((entry, index) => renderCaseTile(entry, index, taxonomy, facetCatalog)).join("\n");
  const details = normalizedEntries.map((entry, index) => renderDetail(
    entry,
    index,
    taxonomy,
    facetCatalog,
    relatedById.get(entry.id) ?? []
  )).join("\n");
  const contentOptions = renderContentOptions(normalizedEntries, taxonomy, locale);
  const sourceUrl = safeWebUrl(options.sourceUrl);
  const installAction = installUrl
    ? `<a class="button-primary install-action" href="${escapeAttribute(installUrl)}" target="_blank" rel="noreferrer"><span data-zh="安装到 Chrome" data-en="Install for Chrome">${locale === "en" ? "Install for Chrome" : "安装到 Chrome"}</span></a>`
    : "";
  const sourceAction = sourceUrl
    ? `<a class="button-secondary source-action" href="${escapeAttribute(sourceUrl)}" target="_blank" rel="noreferrer"><span data-zh="查看源码" data-en="View source">${locale === "en" ? "View source" : "查看源码"}</span></a>`
    : "";

  return `<!doctype html>
<html lang="${locale}" data-locale="${locale}" data-theme="${theme}">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src 'self' data:; media-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'" />
  <title>${escapeHtml(settingsValue.libraryTitle)} | ${locale === "en" ? "Shared cases" : "分享案例"}</title>
  <link rel="stylesheet" href="${SHARE_PREVIEW_FOUNDATION_FILENAME}" />
  <style>${sharePreviewStyles()}</style>
</head>
<body>
  ${iconSprite}
  <header class="app-header">
    <div class="brand-block">
      <p class="eyebrow">PROMPTDIRECTOR</p>
      <h1>${escapeHtml(settingsValue.libraryTitle)}</h1>
      <p class="package-count"><span id="visible-count">${normalizedEntries.length}</span><span data-zh=" 个案例" data-en=" cases">${locale === "en" ? " cases" : " 个案例"}</span></p>
    </div>
    <div class="header-tools">
      <label class="search-field"><span class="sr-only" data-zh="搜索案例" data-en="Search cases">${locale === "en" ? "Search cases" : "搜索案例"}</span><input id="search" type="search" autocomplete="off" placeholder="${locale === "en" ? "Search cases" : "搜索案例"}" /></label>
      <label class="type-field"><span class="sr-only" data-zh="内容类型" data-en="Content type">${locale === "en" ? "Content type" : "内容类型"}</span><select id="content-type">${contentOptions}</select></label>
      <label class="compact-setting"><span data-zh="语言" data-en="Language">${locale === "en" ? "Language" : "语言"}</span><select id="locale"><option value="zh-CN">中文</option><option value="en">English</option></select></label>
      <label class="compact-setting"><span data-zh="主题" data-en="Theme">${locale === "en" ? "Theme" : "主题"}</span><select id="theme"><option value="system" data-zh="跟随系统" data-en="System">${locale === "en" ? "System" : "跟随系统"}</option><option value="light" data-zh="浅色" data-en="Light">${locale === "en" ? "Light" : "浅色"}</option><option value="dark" data-zh="深色" data-en="Dark">${locale === "en" ? "Dark" : "深色"}</option></select></label>
    </div>
  </header>

  <aside class="import-guide">
    <p><strong data-zh="这是可离线浏览的只读分享包。" data-en="This is a read-only package that works offline.">${locale === "en" ? "This is a read-only package that works offline." : "这是可离线浏览的只读分享包。"}</strong> <span data-zh="要整理、编辑或继续创作，请原样保留 ZIP，并在 PromptDirector 中打开“设置 → 界面与资料库 → 导入分享包”。" data-en="To organize, edit, or continue creating, keep the ZIP intact and open Settings → Interface & Library → Import shared package in PromptDirector.">${locale === "en" ? "To organize, edit, or continue creating, keep the ZIP intact and open Settings → Interface & Library → Import shared package in PromptDirector." : "要整理、编辑或继续创作，请原样保留 ZIP，并在 PromptDirector 中打开“设置 → 界面与资料库 → 导入分享包”。"}</span></p>
    <div class="product-actions">${installAction}${sourceAction}</div>
  </aside>

  <main class="gallery-shell">
    <section id="case-grid" class="case-grid" aria-label="Shared cases">${cards}</section>
    <section id="empty-state" class="empty-state" hidden><strong data-zh="没有匹配的案例" data-en="No matching cases">${locale === "en" ? "No matching cases" : "没有匹配的案例"}</strong><p data-zh="调整搜索或内容类型。" data-en="Adjust the search or content type.">${locale === "en" ? "Adjust the search or content type." : "调整搜索或内容类型。"}</p></section>
  </main>

  <section id="detail-view" class="detail-view" aria-hidden="true" hidden>
    <nav class="detail-toolbar" aria-label="Case navigation">
      <div class="detail-navigation">
        <button id="detail-prev" class="icon-button" type="button" aria-label="上一条" title="上一条">${icon("chevron-left")}</button>
        <button id="detail-next" class="icon-button" type="button" aria-label="下一条" title="下一条">${icon("chevron-right")}</button>
      </div>
      <button id="detail-close" class="icon-button" type="button" aria-label="关闭详情" title="关闭详情">${icon("x")}</button>
    </nav>
    <div id="detail-stack" class="detail-stack">${details}</div>
  </section>
  <p id="feedback" role="status" aria-live="polite"></p>
  <script src="${SHARE_PREVIEW_MASONRY_FILENAME}" defer></script>
  <script src="${SHARE_PREVIEW_RUNTIME_FILENAME}" defer></script>
</body>
</html>`;
}

export function renderSharePreviewRuntimeJs() {
  return `(() => {
  "use strict";
  const root = document.documentElement;
  const search = document.querySelector("#search");
  const typeSelect = document.querySelector("#content-type");
  const localeSelect = document.querySelector("#locale");
  const themeSelect = document.querySelector("#theme");
  const grid = document.querySelector("#case-grid");
  const tiles = [...grid.querySelectorAll(":scope > [data-entry-id]")];
  const visibleCount = document.querySelector("#visible-count");
  const emptyState = document.querySelector("#empty-state");
  const detailView = document.querySelector("#detail-view");
  const details = [...document.querySelectorAll(".case-detail")];
  const previousButton = document.querySelector("#detail-prev");
  const nextButton = document.querySelector("#detail-next");
  const closeButton = document.querySelector("#detail-close");
  const feedback = document.querySelector("#feedback");
  const createStableMasonry = globalThis.createStableMasonry;
  if (typeof createStableMasonry !== "function") throw new Error("Shared package masonry runtime is unavailable");
  const galleryMasonry = createStableMasonry(grid);
  const relatedMasonry = new Map();
  let activeEntryId = "";
  let returnFocus = null;

  const translated = (zh, en) => root.dataset.locale === "en" ? en : zh;
  const visibleTiles = () => tiles.filter((tile) => !tile.hidden);
  const layoutGallery = () => {
    galleryMasonry.reset();
    galleryMasonry.append(visibleTiles());
  };
  const layoutRelated = (detail) => {
    const container = detail.querySelector(".related-grid");
    if (!container) return;
    relatedMasonry.get(container)?.destroy();
    const masonry = createStableMasonry(container, { scrollContainer: detailView });
    relatedMasonry.set(container, masonry);
    masonry.append([...container.querySelectorAll(":scope > .case-card")]);
  };
  const applyFilters = () => {
    const query = search.value.normalize("NFKC").toLocaleLowerCase(root.lang).trim();
    const contentType = typeSelect.value;
    let count = 0;
    for (const tile of tiles) {
      const matchesQuery = !query || tile.dataset.search.includes(query);
      const matchesType = !contentType || tile.dataset.contentType === contentType;
      tile.hidden = !(matchesQuery && matchesType);
      if (!tile.hidden) count += 1;
    }
    visibleCount.textContent = String(count);
    emptyState.hidden = count > 0;
    requestAnimationFrame(layoutGallery);
    if (activeEntryId && !visibleTiles().some((tile) => tile.dataset.entryId === activeEntryId)) closeDetail();
  };
  const applyLocale = (value) => {
    const locale = value === "en" ? "en" : "zh-CN";
    root.lang = locale;
    root.dataset.locale = locale;
    localeSelect.value = locale;
    search.placeholder = locale === "en" ? "Search cases" : "搜索案例";
    for (const item of document.querySelectorAll("[data-zh][data-en]")) {
      item.textContent = locale === "en" ? item.dataset.en : item.dataset.zh;
    }
  };
  const applyTheme = (value) => {
    const theme = ["system", "light", "dark"].includes(value) ? value : "dark";
    root.dataset.theme = theme;
    themeSelect.value = theme;
  };
  const updateDetailNavigation = () => {
    const current = visibleTiles().findIndex((tile) => tile.dataset.entryId === activeEntryId);
    previousButton.disabled = current <= 0;
    nextButton.disabled = current < 0 || current >= visibleTiles().length - 1;
  };
  const openDetail = (entryId, trigger = null) => {
    const target = details.find((detail) => detail.dataset.entryId === entryId);
    if (!target) return;
    activeEntryId = entryId;
    returnFocus = trigger || returnFocus;
    for (const detail of details) detail.hidden = detail !== target;
    detailView.hidden = false;
    detailView.setAttribute("aria-hidden", "false");
    document.body.classList.add("detail-open");
    detailView.scrollTop = 0;
    requestAnimationFrame(() => layoutRelated(target));
    updateDetailNavigation();
    closeButton.focus();
  };
  const closeDetail = () => {
    if (!activeEntryId) return;
    activeEntryId = "";
    detailView.hidden = true;
    detailView.setAttribute("aria-hidden", "true");
    document.body.classList.remove("detail-open");
    returnFocus?.focus?.();
    returnFocus = null;
  };
  const moveDetail = (offset) => {
    const currentTiles = visibleTiles();
    const index = currentTiles.findIndex((tile) => tile.dataset.entryId === activeEntryId);
    const target = currentTiles[index + offset];
    if (target) openDetail(target.dataset.entryId, target);
  };
  const showFeedback = (message) => {
    feedback.textContent = message;
    clearTimeout(showFeedback.timer);
    showFeedback.timer = setTimeout(() => { feedback.textContent = ""; }, 2200);
  };
  const copyText = async (text) => {
    if (navigator.clipboard?.writeText) {
      try { await navigator.clipboard.writeText(text); return; } catch {}
    }
    const field = document.createElement("textarea");
    field.value = text;
    field.setAttribute("readonly", "");
    field.style.position = "fixed";
    field.style.opacity = "0";
    document.body.append(field);
    field.select();
    const copied = document.execCommand("copy");
    field.remove();
    if (!copied) throw new Error("copy failed");
  };

  document.addEventListener("click", async (event) => {
    const open = event.target.closest("[data-open-entry]");
    if (open) return openDetail(open.dataset.openEntry, open);
    const mediaButton = event.target.closest("[data-media-index]");
    if (mediaButton) {
      const detail = mediaButton.closest(".case-detail");
      for (const panel of detail.querySelectorAll(".detail-media-panel")) panel.hidden = panel.dataset.mediaIndex !== mediaButton.dataset.mediaIndex;
      for (const button of detail.querySelectorAll("[data-media-index]")) button.setAttribute("aria-pressed", String(button === mediaButton));
      return;
    }
    const copy = event.target.closest("[data-copy-prompt]");
    if (copy) {
      try {
        await copyText(copy.dataset.copyPrompt);
        showFeedback(translated("提示词已复制", "Prompt copied"));
      } catch {
        showFeedback(translated("无法复制，请手动选择提示词", "Copy failed; select the prompt manually"));
      }
    }
  });
  search.addEventListener("input", applyFilters);
  typeSelect.addEventListener("change", applyFilters);
  localeSelect.addEventListener("change", () => applyLocale(localeSelect.value));
  themeSelect.addEventListener("change", () => applyTheme(themeSelect.value));
  closeButton.addEventListener("click", closeDetail);
  previousButton.addEventListener("click", () => moveDetail(-1));
  nextButton.addEventListener("click", () => moveDetail(1));
  document.addEventListener("keydown", (event) => {
    if (!activeEntryId) return;
    if (event.key === "Escape") closeDetail();
    if (event.target instanceof HTMLInputElement || event.target instanceof HTMLSelectElement) return;
    if (event.key === "ArrowLeft") moveDetail(-1);
    if (event.key === "ArrowRight") moveDetail(1);
  });
  applyLocale(root.dataset.locale);
  applyTheme(root.dataset.theme);
  applyFilters();
})();\n`;
}

function renderCaseTile(entry, index, taxonomy, facetCatalog, className = "case-card") {
  const title = clean(entry.title) || `案例 ${index + 1}`;
  const primary = primaryMediaAsset(entry);
  const contentId = entry?.classification?.pathIds?.[0] || "";
  const searchValue = searchText(entry, taxonomy, facetCatalog);
  return `<button class="${className}" type="button" data-entry-id="${escapeAttribute(entry.id)}" data-open-entry="${escapeAttribute(entry.id)}" data-content-type="${escapeAttribute(contentId)}" data-search="${escapeAttribute(searchValue)}" aria-label="${escapeAttribute(`查看案例：${title}`)}">${renderTileMedia(entry, primary, title)}${entry.mediaAssets.filter((asset) => asset.usage !== "poster").length > 1 ? `<span class="media-count">${entry.mediaAssets.filter((asset) => asset.usage !== "poster").length}</span>` : ""}</button>`;
}

function renderTileMedia(entry, primary, title) {
  if (primary?.kind === "image") {
    const path = safeArchiveMediaPath(primary.assetPath, "image");
    if (path) return `<span class="tile-media"${aspectRatioStyle(primary)}><img src="${escapeAttribute(path)}" alt="${escapeAttribute(title)}" loading="lazy" decoding="async" /></span>`;
  }
  if (primary?.kind === "video") {
    const poster = posterAssetForVideo(entry, primary);
    const path = safeArchiveMediaPath(poster?.assetPath, "image");
    if (path) return `<span class="tile-media"${aspectRatioStyle(poster)}><img src="${escapeAttribute(path)}" alt="${escapeAttribute(`${title} 视频封面`)}" loading="lazy" decoding="async" /><span class="video-cue">▶</span>${primary.durationMs ? `<span class="video-duration">${formatDuration(primary.durationMs)}</span>` : ""}</span>`;
    return renderFallbackCover("VIDEO", title, "video");
  }
  if (primary?.kind === "document") return renderFallbackCover(documentKind(primary), title, "document");
  return renderFallbackCover("NOTE", title, "text");
}

function renderFallbackCover(kind, title, modifier) {
  return `<span class="fallback-cover ${modifier}"><small>${escapeHtml(kind)}</small><strong>${escapeHtml(title)}</strong></span>`;
}

function renderDetail(entry, index, taxonomy, facetCatalog, relatedEntries) {
  const title = clean(entry.title) || `案例 ${index + 1}`;
  const media = entry.mediaAssets.filter((asset) => asset.usage !== "poster");
  const [contentZh, contentEn] = contentLabelPair(entry, taxonomy);
  const [dateZh, dateEn] = formatDatePair(entry.savedAt);
  const attributes = entryAttributeSummary(entry, facetCatalog, 20);
  const palette = (entryPalette(entry)?.colors ?? []).filter(validColor);
  const sourceUrl = safeWebUrl(entry.url);
  const primary = primaryMediaAsset(entry);
  const prompt = primary?.kind === "image" ? promptForEntryImage(entry, primary.id) : clean(entry.text);
  const visionDescription = primaryVisionDescription(entry);
  const metadataRows = renderMetadataRows(entry.metadataLabels);
  const timeNotes = renderTimeNotes(entry, media);
  const related = relatedEntries.length
    ? `<section class="related-section"><header><h3 data-zh="相关案例" data-en="Related cases">相关案例</h3><span data-zh="仅在本分享包内推荐" data-en="Recommendations from this package only">仅在本分享包内推荐</span></header><div class="related-grid">${relatedEntries.map((item, relatedIndex) => renderCaseTile(item, relatedIndex, taxonomy, facetCatalog, "case-card related-card")).join("")}</div></section>`
    : "";
  return `<article class="case-detail" data-entry-id="${escapeAttribute(entry.id)}" hidden>
    <div class="detail-primary${media.length ? " has-media" : ""}">
      <section class="detail-gallery">${renderDetailMedia(entry, media, title)}</section>
      <aside class="detail-body">
        <section class="detail-section detail-heading"><p class="eyebrow">PROMPTDIRECTOR</p><h2>${escapeHtml(title)}</h2><div class="detail-meta"><span data-zh="${escapeAttribute(contentZh)}" data-en="${escapeAttribute(contentEn)}">${escapeHtml(contentZh)}</span>${dateZh ? `<span data-zh="${escapeAttribute(dateZh)}" data-en="${escapeAttribute(dateEn)}">${escapeHtml(dateZh)}</span>` : ""}<span>${media.length} <span data-zh="项媒体" data-en="media items">项媒体</span></span></div>${palette.length ? `<div class="palette">${palette.map((color) => `<i style="background:${color}" title="${color}"></i>`).join("")}</div>` : ""}</section>
        ${attributes.length ? `<section class="detail-section"><h3 data-zh="创作属性" data-en="Creative attributes">创作属性</h3><div class="detail-tags">${attributes.map((item) => `<span>${escapeHtml(item.label)}</span>`).join("")}</div></section>` : ""}
        ${prompt ? `<section class="detail-section prompt-section"><div class="section-heading"><h3 data-zh="提示词" data-en="Prompt">提示词</h3><button class="button-secondary compact" type="button" data-copy-prompt="${escapeAttribute(prompt)}"><span data-zh="复制提示词" data-en="Copy prompt">复制提示词</span></button></div><pre class="prompt-text">${escapeHtml(prompt)}</pre><p class="compose-guide" data-zh="导入 PromptDirector 后可将当前图片作为具体参考继续创作。" data-en="Import this package into PromptDirector to continue creating with the current image as a specific reference.">导入 PromptDirector 后可将当前图片作为具体参考继续创作。</p></section>` : ""}
        ${visionDescription ? `<section class="detail-section"><h3 data-zh="画面描述" data-en="Visual description">画面描述</h3><p class="visual-description">${escapeHtml(visionDescription)}</p></section>` : ""}
        ${metadataRows || sourceUrl ? `<section class="detail-section"><div class="section-heading"><h3 data-zh="来源" data-en="Source">来源</h3>${sourceUrl ? `<a class="source-open-action" href="${escapeAttribute(sourceUrl)}" target="_blank" rel="noreferrer"><span data-zh="打开来源" data-en="Open source">打开来源</span></a>` : ""}</div>${metadataRows}</section>` : ""}
        ${timeNotes}
      </aside>
    </div>
    ${related}
  </article>`;
}

function renderDetailMedia(entry, media, title) {
  if (!media.length) return `<div class="detail-placeholder"><span data-zh="这个案例没有附带媒体" data-en="This case has no media">这个案例没有附带媒体</span></div>`;
  const panels = media.map((asset, index) => `<div class="detail-media-panel" data-media-index="${index}"${index ? " hidden" : ""}>${renderMediaAsset(entry, asset, title)}</div>`).join("");
  const rail = media.length > 1 ? `<div class="detail-media-rail">${media.map((asset, index) => `<button class="detail-media-thumb" type="button" data-media-index="${index}" aria-pressed="${index === 0}">${renderMediaThumb(entry, asset, index)}</button>`).join("")}</div>` : "";
  return `<div class="detail-media-stage">${panels}</div>${rail}`;
}

function renderMediaAsset(entry, asset, title) {
  const prompt = clean(entry.mediaPrompts?.find((item) => item.assetId === asset.id)?.text);
  const description = clean(asset.visionAnalysis?.description);
  let content;
  if (asset.kind === "image") {
    const path = safeArchiveMediaPath(asset.assetPath, "image");
    content = path ? `<div class="detail-image-frame"><img src="${escapeAttribute(path)}" alt="${escapeAttribute(title)}" /></div>` : renderExternalMedia(asset, "图片");
  } else if (asset.kind === "video") {
    const path = safeArchiveMediaPath(asset.assetPath, "video");
    const poster = posterAssetForVideo(entry, asset);
    const posterPath = safeArchiveMediaPath(poster?.assetPath, "image");
    content = path
      ? `<video controls preload="metadata"${posterPath ? ` poster="${escapeAttribute(posterPath)}"` : ""}><source src="${escapeAttribute(path)}" type="${escapeAttribute(asset.mimeType || "video/mp4")}" /></video>`
      : renderExternalMedia(asset, "视频");
  } else {
    const path = safeArchiveMediaPath(asset.assetPath, "document");
    content = path
      ? `<div class="document-panel"><strong>${escapeHtml(documentKind(asset))}</strong><span>${escapeHtml(asset.sourceTitle || title)}</span><a class="button-primary" href="${escapeAttribute(path)}" target="_blank"><span data-zh="打开文档" data-en="Open document">打开文档</span></a></div>`
      : renderExternalMedia(asset, "文档");
  }
  const caption = prompt || description ? `<div class="media-caption">${prompt ? `<p><strong data-zh="本图提示词" data-en="Media prompt">本图提示词</strong>${escapeHtml(prompt)}</p>` : ""}${description ? `<p><strong data-zh="画面描述" data-en="Visual description">画面描述</strong>${escapeHtml(description)}</p>` : ""}</div>` : "";
  return `${content}${caption}`;
}

function renderExternalMedia(asset, label) {
  const url = safeWebUrl(asset.reference?.url || asset.sourceUrl);
  return `<div class="detail-placeholder"><strong>${escapeHtml(label)}</strong>${url ? `<a class="button-secondary" href="${escapeAttribute(url)}" target="_blank" rel="noreferrer"><span data-zh="打开外部媒体" data-en="Open external media">打开外部媒体</span></a>` : `<span data-zh="媒体文件不可用" data-en="Media unavailable">媒体文件不可用</span>`}</div>`;
}

function renderMediaThumb(entry, asset, index) {
  const image = asset.kind === "image" ? asset : asset.kind === "video" ? posterAssetForVideo(entry, asset) : null;
  const path = safeArchiveMediaPath(image?.assetPath, "image");
  if (path) return `<img src="${escapeAttribute(path)}" alt="${index + 1}" loading="lazy" />`;
  return `<span>${escapeHtml(asset.kind === "video" ? "VIDEO" : documentKind(asset))}</span>`;
}

function renderMetadataRows(labels = []) {
  const rows = (Array.isArray(labels) ? labels : []).map((label) => {
    const value = clean(label);
    if (!value) return "";
    const separator = value.search(/[：:]/u);
    const key = separator > 0 ? value.slice(0, separator).trim() : "来源事实";
    const detail = separator > 0 ? value.slice(separator + 1).trim() : value;
    return `<div class="metadata-row"><dt>${escapeHtml(key)}</dt><dd>${escapeHtml(detail)}</dd></div>`;
  }).join("");
  return rows ? `<dl class="metadata-list">${rows}</dl>` : "";
}

function renderTimeNotes(entry, media) {
  const byId = new Map(media.map((asset) => [asset.id, asset]));
  const notes = (entry.timeNotes ?? []).filter((note) => byId.has(note.assetId) && clean(note.text));
  if (!notes.length) return "";
  return `<section class="detail-section"><h3 data-zh="时间笔记" data-en="Time notes">时间笔记</h3><ol class="time-notes">${notes.map((note) => `<li><time>${formatDuration(note.startMs)}${note.endMs > note.startMs ? `–${formatDuration(note.endMs)}` : ""}</time><span>${escapeHtml(note.text)}</span></li>`).join("")}</ol></section>`;
}

function renderContentOptions(entries, taxonomy, locale) {
  const byId = new Map();
  for (const entry of entries) {
    const id = entry?.classification?.pathIds?.[0] || "";
    if (!id || byId.has(id)) continue;
    byId.set(id, contentLabelPair(entry, taxonomy));
  }
  const all = `<option value="" data-zh="全部类型" data-en="All types">${locale === "en" ? "All types" : "全部类型"}</option>`;
  return all + [...byId].map(([id, [zh, en]]) => `<option value="${escapeAttribute(id)}" data-zh="${escapeAttribute(zh)}" data-en="${escapeAttribute(en)}">${escapeHtml(locale === "en" ? en : zh)}</option>`).join("");
}

function relatedEntriesById(entries, facetCatalog) {
  const prepared = entries.map((entry) => {
    const primary = primaryMediaAsset(entry);
    const visual = primary?.kind === "image" ? primary : primary?.kind === "video" ? posterAssetForVideo(entry, primary) : null;
    return {
      ...entry,
      discoveryVisualId: visual?.id || "",
      discoveryColors: entryPalette(entry)?.colors ?? []
    };
  });
  const index = createSimilarityIndex(prepared, facetCatalog);
  return new Map(prepared.map((entry) => [entry.id, rankSimilarEntries(index, entry.id, 8).map((item) => item.entry)]));
}

function searchText(entry, taxonomy, facetCatalog) {
  const [zh, en] = contentLabelPair(entry, taxonomy);
  return [
    entry.title,
    entry.text,
    zh,
    en,
    ...(entry.customLabels ?? []),
    ...(entry.metadataLabels ?? []),
    ...entryAttributeSummary(entry, facetCatalog, 100).map((item) => item.label)
  ].map(clean).filter(Boolean).join(" ").normalize("NFKC").toLocaleLowerCase("zh-CN");
}

function contentLabelPair(entry, taxonomy) {
  if (entry?.classification?.status === "needs_review") return ["待确认", "Needs review"];
  const node = taxonomy.nodes.find((item) => item.id === entry?.classification?.pathIds?.[0]);
  if (!node) return ["待确认", "Needs review"];
  if (node.customized || !CONTENT_LABELS[node.id]) return [node.name, node.name];
  return CONTENT_LABELS[node.id];
}

function icon(name) {
  return `<svg class="ui-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><use href="#icon-${escapeAttribute(name)}"></use></svg>`;
}

function inlineIconSprite(value) {
  const source = String(value ?? "");
  const match = source.match(/<svg\b[^>]*>([\s\S]*?)<\/svg>/i);
  if (!match || !match[1].includes('<symbol id="icon-')) throw new Error("分享页图标资源无效");
  return `<svg class="share-icon-sprite" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" focusable="false">${match[1]}</svg>`;
}

export function renderSharePreviewMasonryJs(value) {
  const source = String(value ?? "");
  const declaration = "export function createStableMasonry";
  if (!source.includes(declaration)) throw new Error("分享页瀑布流资源无效");
  return source
    .replace(declaration, "globalThis.createStableMasonry = function createStableMasonry")
    .replace(':scope > .case-card")', ':scope > .case-card:not([hidden])")');
}

function safeWebUrl(value) {
  try {
    const url = new URL(String(value ?? ""));
    return ["http:", "https:"].includes(url.protocol) ? url.href : "";
  } catch {
    return "";
  }
}

function safeArchiveMediaPath(value, kind) {
  const path = String(value ?? "");
  if (!path || path.includes("..")) return "";
  if (kind === "image") return /^images\/[A-Za-z0-9._/-]+\.(?:png|jpe?g|webp)$/i.test(path) ? path : "";
  if (kind === "video") return /^videos\/[A-Za-z0-9._/-]+\.(?:mp4|webm|mov|mkv|avi|video)$/i.test(path) ? path : "";
  return /^documents\/[A-Za-z0-9._/-]+\.(?:pdf|md|txt|html?|bin)$/i.test(path) ? path : "";
}

function formatDatePair(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return ["", ""];
  return [
    new Intl.DateTimeFormat("zh-CN", { dateStyle: "medium" }).format(date),
    new Intl.DateTimeFormat("en", { dateStyle: "medium" }).format(date)
  ];
}

function formatDuration(value) {
  const totalSeconds = Math.max(0, Math.floor((Number(value) || 0) / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = String(totalSeconds % 60).padStart(2, "0");
  return `${minutes}:${seconds}`;
}

function documentKind(asset) {
  if (asset?.mimeType === "application/pdf") return "PDF";
  if (asset?.mimeType === "text/markdown") return "MD";
  if (asset?.mimeType === "text/html") return "HTML";
  if (asset?.mimeType === "text/plain") return "TXT";
  return "DOC";
}

function aspectRatioStyle(asset) {
  const width = Number(asset?.width);
  const height = Number(asset?.height);
  return width > 0 && height > 0 ? ` style="aspect-ratio:${width}/${height}"` : "";
}

function validColor(value) {
  return /^#[0-9a-f]{6}$/i.test(String(value));
}

function clean(value) {
  return String(value ?? "").trim();
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function escapeAttribute(value) {
  return escapeHtml(value).replaceAll('"', "&quot;").replaceAll("'", "&#39;");
}

function sharePreviewStyles() {
  return `
    :root{--visual-wall-gap:2px;--visual-card-radius:2px}.share-icon-sprite{position:absolute;width:0;height:0;overflow:hidden}body{min-width:0;background:var(--ui-page)}body.detail-open{overflow:hidden}.app-header{position:sticky;z-index:20;top:0;display:flex;min-height:64px;align-items:center;gap:24px;border-bottom:1px solid var(--ui-border);padding:8px 12px;background:var(--bar);backdrop-filter:blur(16px)}.brand-block{display:grid;min-width:190px;gap:1px}.eyebrow{margin:0;color:var(--ui-accent);font-size:11px;font-weight:800;letter-spacing:.12em}.brand-block h1{max-width:340px;overflow:hidden;margin:0;color:var(--ui-text);font-size:18px;line-height:1.2;text-overflow:ellipsis;white-space:nowrap}.package-count{margin:0;color:var(--ui-muted);font-size:11px}.header-tools{display:flex;min-width:0;flex:1;align-items:center;justify-content:flex-end;gap:8px}.search-field{width:min(360px,32vw)}.type-field{width:min(180px,18vw)}.compact-setting{display:flex;align-items:center;gap:6px;color:var(--ui-muted);font-size:11px}.compact-setting select{width:auto;min-width:92px}.import-guide{display:flex;align-items:center;justify-content:space-between;gap:16px;border-bottom:1px solid var(--ui-border);padding:10px 14px;background:var(--ui-surface)}.import-guide p{margin:0;color:var(--ui-muted);font-size:11px;line-height:1.55}.import-guide strong{color:var(--ui-text)}.product-actions{display:flex;align-items:center;gap:7px}.install-action,.source-action{display:inline-flex;min-height:30px;align-items:center;padding:5px 9px;text-decoration:none;white-space:nowrap}.gallery-shell{padding:8px 6px 60px}.case-grid,.related-grid{position:relative;width:100%;overflow-anchor:none;--masonry-card-min-width:270px;--masonry-gap:var(--visual-wall-gap)}.case-card,.related-card{position:absolute;display:block;width:100%;min-height:0;overflow:hidden;border:0;border-radius:var(--visual-card-radius);padding:0;color:var(--ui-text);background:var(--ui-surface);cursor:pointer;vertical-align:top;white-space:normal}.case-card:hover,.related-card:hover{background:var(--ui-hover);box-shadow:0 8px 20px color-mix(in srgb,var(--ui-text) 10%,transparent)}.tile-media{position:relative;display:block;min-height:110px;overflow:hidden;background:var(--viewer-bg)}.tile-media img{display:block;width:100%;height:auto}.tile-media[style] img{height:100%;object-fit:cover}.video-cue{position:absolute;top:50%;left:50%;display:grid;width:38px;height:38px;place-items:center;border-radius:50%;color:white;background:rgba(7,9,11,.68);transform:translate(-50%,-50%)}.video-duration,.media-count{position:absolute;right:7px;bottom:7px;border-radius:3px;padding:2px 5px;color:white;background:rgba(7,9,11,.72);font-size:11px}.media-count{top:7px;bottom:auto}.fallback-cover{display:grid;min-height:190px;align-content:space-between;gap:18px;padding:16px;color:var(--ui-text);background:var(--ui-raised);text-align:left}.fallback-cover.document{background:linear-gradient(160deg,var(--ui-raised),var(--ui-surface))}.fallback-cover small{color:var(--ui-accent);font-size:11px;font-weight:800;letter-spacing:.12em}.fallback-cover strong{font-size:16px;line-height:1.35}.empty-state{padding:80px 20px;color:var(--ui-muted);text-align:center}.empty-state strong{color:var(--ui-text);font-size:18px}.detail-view{position:fixed;z-index:50;inset:0;overflow:auto;background:var(--viewer-bg)}.detail-toolbar{position:fixed;z-index:55;inset:0 0 auto;height:0;pointer-events:none}.detail-toolbar .icon-button{color:white;border-color:rgba(255,255,255,.22);background:rgba(15,17,19,.82);box-shadow:0 4px 18px rgba(0,0,0,.24);pointer-events:auto}.detail-toolbar>.icon-button{position:absolute;top:14px;right:14px}.detail-navigation{position:absolute;top:50dvh;right:clamp(380px,34vw,480px);left:0;display:flex;justify-content:space-between;padding:0 16px;transform:translateY(-50%)}.detail-stack{min-height:100%}.case-detail{min-height:100%;background:var(--ui-surface)}.detail-primary{display:grid;min-height:100dvh;grid-template-columns:minmax(0,1fr) clamp(380px,34vw,480px)}.detail-primary:not(.has-media){display:block}.detail-gallery{display:grid;min-width:0;min-height:100dvh;align-content:center;background:var(--viewer-bg)}.detail-media-stage{display:grid;min-height:0}.detail-media-panel{min-width:0}.detail-media-panel>video{display:block;width:100%;max-height:calc(100dvh - 88px);margin:auto;background:#06080c}.detail-image-frame{display:block;width:100%;min-height:0;margin:0;background:#06080c}.detail-image-frame img{display:block;width:100%;height:calc(100dvh - 88px);object-fit:contain}.detail-media-rail{display:flex;gap:7px;overflow-x:auto;padding:8px 10px 10px;background:var(--viewer-bg)}.detail-media-thumb{display:grid;width:76px;min-width:76px;min-height:58px;place-items:center;overflow:hidden;border:1px solid transparent;border-radius:6px;padding:0;color:white;background:#06080c;opacity:.72}.detail-media-thumb[aria-pressed="true"]{border-color:rgba(255,255,255,.62);opacity:1}.detail-media-thumb img{display:block;width:100%;height:56px;object-fit:cover}.media-caption{display:grid;gap:6px;padding:10px 12px;color:rgba(255,255,255,.82);background:color-mix(in srgb,var(--viewer-bg) 92%,white);font-size:11px}.media-caption p{margin:0}.media-caption strong{display:block;margin-bottom:2px;color:white}.document-panel,.detail-placeholder{display:grid;min-height:360px;place-items:center;align-content:center;gap:14px;padding:24px;color:var(--ui-muted);background:var(--ui-surface);text-align:center}.document-panel strong{color:var(--ui-accent);font-size:46px}.document-panel .button-primary{display:inline-flex;align-items:center;text-decoration:none}.detail-body{min-width:0;border-left:1px solid var(--ui-border);background:var(--ui-surface)}.detail-section{border-bottom:1px solid var(--ui-border);padding:16px 22px}.detail-section h2{margin:4px 0 8px;font-size:17px;line-height:1.35}.detail-section h3{margin:0 0 10px;font-size:11px}.detail-meta{display:flex;flex-wrap:wrap;gap:8px 14px;color:var(--ui-muted);font-size:11px}.palette{display:flex;height:16px;overflow:hidden;margin-top:12px;border-radius:4px}.palette i{flex:1}.detail-tags{display:flex;flex-wrap:wrap;gap:5px}.detail-tags span{padding:4px 7px;border-radius:999px;color:var(--ui-text);background:var(--ui-raised);font-size:11px;font-weight:700}.section-heading{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:10px}.section-heading h3{margin:0}.prompt-text{max-height:360px;overflow:auto;margin:0;border-radius:6px;padding:14px;color:var(--prompt-ink);background:var(--prompt-bg);font:12px/1.7 ui-monospace,SFMono-Regular,Menlo,monospace;white-space:pre-wrap;overflow-wrap:anywhere}.compose-guide,.visual-description{margin:10px 0 0;color:var(--ui-muted);font-size:11px;line-height:1.55}.source-open-action{display:inline-flex;min-height:30px;align-items:center;border:1px solid var(--ui-border);border-radius:4px;padding:5px 9px;color:var(--ui-text);font-size:11px;font-weight:700;text-decoration:none}.metadata-list{display:grid;margin:0}.metadata-row{display:grid;grid-template-columns:minmax(72px,104px) minmax(0,1fr);gap:12px;border-top:1px solid var(--ui-border);padding:7px 0}.metadata-row:first-child{border-top:0}.metadata-row dt{color:var(--ui-muted);font-size:11px;font-weight:700}.metadata-row dd{margin:0;overflow-wrap:anywhere;font-size:12px}.time-notes{display:grid;gap:8px;margin:0;padding:0;list-style:none}.time-notes li{display:grid;grid-template-columns:72px 1fr;gap:10px}.time-notes time{color:var(--ui-accent);font:11px ui-monospace,monospace}.time-notes span{font-size:12px}.related-section{border-top:1px solid var(--ui-border);padding:20px 6px 60px;background:var(--ui-page)}.related-section>header{display:flex;align-items:center;justify-content:space-between;margin:0 2px 10px}.related-section h3{margin:0;font-size:16px}.related-section header span{color:var(--ui-muted);font-size:11px}#feedback{position:fixed;z-index:90;right:18px;bottom:18px;max-width:min(360px,calc(100vw - 36px));margin:0;border:1px solid var(--ui-border-strong);border-radius:6px;padding:9px 12px;color:var(--ui-text);background:var(--ui-surface);box-shadow:var(--ui-shadow);font-size:12px;pointer-events:none}#feedback:empty{display:none}
    @media(max-width:860px){.app-header{align-items:flex-start;flex-direction:column;gap:8px}.header-tools{width:100%;flex-wrap:wrap;justify-content:flex-start}.search-field{flex:1 1 220px;width:auto}.type-field{flex:1 1 150px;width:auto}.compact-setting{flex:1 1 130px}.compact-setting select{flex:1}.import-guide{align-items:flex-start}.detail-primary{display:block}.detail-gallery{min-height:auto}.detail-image-frame img{height:min(62dvh,640px)}.detail-body{border-top:1px solid var(--ui-border);border-left:0}.detail-navigation{top:32dvh;right:0}.related-section{padding-bottom:28px}}
    @media(max-width:520px){.app-header{position:static;padding:10px}.brand-block{min-width:0}.header-tools{display:grid;grid-template-columns:1fr 1fr}.search-field{grid-column:1/-1}.type-field{width:auto}.compact-setting{display:grid}.import-guide{flex-direction:column;padding:10px}.case-grid,.related-grid{--masonry-card-min-width:155px;--masonry-gap:var(--visual-wall-gap)}.detail-toolbar>.icon-button{top:10px;right:10px}.detail-navigation{top:31dvh;padding:0 10px}.detail-section{padding:14px 16px}.related-section{padding-inline:2px}.related-section>header{padding-inline:8px}.related-section header span{display:none}}
    @media(prefers-reduced-motion:reduce){*{scroll-behavior:auto!important}}
  `;
}
