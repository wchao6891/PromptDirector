import { t } from "./i18n.js";
import { createUiIcon } from "./ui-icons.js";

export function captureIconButton(icon, label, onClick, className = "") {
  const button = document.createElement("button");
  button.type = "button";
  button.className = `button-secondary compact capture-icon-button ${className}`;
  button.title = t(label);
  button.setAttribute("aria-label", t(label));
  button.append(createUiIcon(icon));
  button.addEventListener("click", onClick);
  return button;
}

export function createPageCaptureCard(candidate, {
  selected, listMode, busy, hidden, meta, onSelect, onLocate, onPreviewMedia, createArticlePreview, previewOpen, onIncludeSupplement, selectedMediaIds = [], onIncludeMediaGroup, onRemoveMedia, loadLocalVisual
}) {
  const card = document.createElement("article");
  card.className = `page-capture-item${selected ? " confirmed" : ""}`;
  card.hidden = hidden;
  if (candidate.batchStructureStatus === "review") card.classList.add("structure-review");
  const choose = document.createElement("button");
  choose.type = "button";
  choose.className = "page-capture-confirm";
  choose.setAttribute("aria-pressed", String(selected));
  choose.disabled = busy;
  const indicator = document.createElement("span");
  indicator.className = `page-capture-selection${listMode ? " multiple" : ""}`;
  indicator.setAttribute("aria-hidden", "true");
  const copy = document.createElement("span");
  const title = document.createElement("strong");
  title.textContent = candidate.title;
  const info = document.createElement("small");
  info.textContent = meta;
  copy.append(title, info);
  choose.append(indicator, copy);
  choose.addEventListener("click", onSelect);
  card.append(choose);
  const excerpt = document.createElement("p");
  excerpt.className = "page-capture-excerpt";
  excerpt.textContent = candidate.contentText || candidate.textBlocks.map(block => block.text).join("\n");
  card.append(excerpt);
  if (candidate.extraction?.textTruncated) {
    const notice = document.createElement("small");
    notice.textContent = t("正文尚未展开，当前只会保存已显示内容");
    card.append(notice);
  }
  const strip = document.createElement("div");
  strip.className = "page-capture-thumbnails";
  strip.classList.toggle("photo-group", candidate.pageType === "post" && candidate.media.filter(m => m.kind === "image" && m.originalWorkUrl).length > 1);
  candidate.media.forEach((media, index) => {
    if (!["image", "video"].includes(media.kind) || media.placement !== "inline" || (selected || media.quotedPostUrl) && !selectedMediaIds.includes(media.id)) return;
    const button = document.createElement("button");
    button.type = "button";
    button.title = media.alt || t(media.kind === "video" ? "视频" : "图片");
    button.setAttribute("aria-label", button.title);
    const url = media.kind === "video" ? media.posterUrl : media.previewDataUrl || media.dataUrl || media.url;
    if (url || media.localAssetId) {
      const image = document.createElement("img");
      if (media.localAssetId) loadLocalVisual(image, media.localAssetId);
      else image.src = url;
      image.alt = "";
      image.referrerPolicy = "no-referrer";
      image.addEventListener("error", () => button.replaceChildren(createUiIcon(media.kind === "video" ? "video" : "image")), { once: true });
      button.append(image);
    } else button.append(createUiIcon(media.kind === "video" ? "video" : "image"));
    button.addEventListener("click", () => onPreviewMedia(index));
    const thumbnail = document.createElement("span");
    thumbnail.className = "page-capture-thumbnail";
    thumbnail.append(button);
    if (selected) {
      const remove = captureIconButton("x", "移除", () => onRemoveMedia(media), "page-capture-thumbnail-remove");
      remove.disabled = busy;
      thumbnail.append(remove);
    }
    strip.append(thumbnail);
  });
  if (strip.childElementCount) card.append(strip);
  if (selected) for (const groupUrl of new Set(candidate.media.map(m => m.quotedPostUrl).filter(Boolean))) {
    const group = candidate.media.filter(m => m.quotedPostUrl === groupUrl);
    const row = document.createElement("div");
    row.className = "page-capture-media-group";
    const label = document.createElement("span");
    label.textContent = t("引用帖 · {count} 张图", { count: group.length });
    const add = document.createElement("button");
    add.type = "button";
    const included = group.every(m => selectedMediaIds.includes(m.id));
    add.textContent = t(included ? "已加入" : "加入这组");
    add.disabled = busy || included;
    add.addEventListener("click", () => onIncludeMediaGroup(group));
    row.append(label, add);
    card.append(row);
  }
  const actions = document.createElement("div");
  actions.className = "page-capture-card-actions";
  if (!listMode) {
    const locate = captureIconButton("search", "在网页中定位", onLocate, "page-capture-inspect");
    locate.disabled = busy || !candidate.region?.marker;
    actions.append(locate);
  }
  const details = document.createElement("details");
  details.className = "page-capture-preview-details";
  details.open = previewOpen;
  const summary = document.createElement("summary");
  summary.textContent = t("预览完整内容");
  details.append(summary, createArticlePreview());
  if (candidate.possibleOmissions?.length) {
    const omissions = document.createElement("details");
    omissions.className = "page-capture-omissions";
    const heading = document.createElement("summary");
    heading.textContent = t("可能遗漏（{count}）", { count: candidate.possibleOmissions.length });
    omissions.append(heading);
    for (const item of candidate.possibleOmissions) {
      const p = document.createElement("p");
      p.textContent = item.text;
      omissions.append(p);
    }
    details.append(omissions);
  }
  if (selected && candidate.supplements?.length) {
    const supplements = document.createElement("details");
    supplements.className = "page-capture-supplements";
    const heading = document.createElement("summary");
    heading.textContent = t("作者补充（{count}）", { count: candidate.supplements.length });
    supplements.append(heading);
    for (const item of candidate.supplements) {
      const section = document.createElement("section");
      const text = document.createElement("p");
      text.textContent = item.text;
      const add = document.createElement("button");
      add.type = "button";
      add.textContent = t(item.partial ? "补入已显示内容" : "补入当前案例");
      add.disabled = busy;
      add.addEventListener("click", () => onIncludeSupplement(item));
      section.append(text, add);
      supplements.append(section);
    }
    card.append(supplements);
  }
  actions.append(details);
  card.append(actions);
  card.dataset.candidateId = candidate.id;
  return card;
}
