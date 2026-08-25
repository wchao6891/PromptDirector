import {
  SCHEMA_VERSION,
  createDefaultTaxonomy,
  formatTaxonomyPath,
  normalizeTaxonomy
} from "./taxonomy.js";
import {
  createDefaultFacetCatalog,
  formatFacetNodePath,
  normalizeFacetCatalog
} from "./facets.js";
import { normalizeOrganizerState } from "./organizer.js";
import { normalizeComposerSessions, normalizeComposerSettings } from "./composer.js";
import { normalizeCreativeExperimentSettings, normalizeCreativeRuns } from "./creative-runs.js";
import { normalizeCreativeSkillsState } from "./creative-skills.js";
import { entryPalette, normalizeEntryVisuals, primaryVisionDescription } from "./visuals.js";
import { normalizeCompoundCases } from "./compound-cases.js";
import { CURRENT_LIBRARY_PACKAGE_VERSION, LIBRARY_PACKAGE_FORMAT } from "./library-package-format.js";

export const DEFAULT_SETTINGS = Object.freeze({
  libraryTitle: "视觉创作灵感库",
  outputPath: "提示词导演/提示词导演-灵感库.zip"
});

export const DEFAULT_SETTINGS_EN = Object.freeze({
  libraryTitle: "Visual Inspiration Library",
  outputPath: "PromptDirector/PromptDirector-Visual-Archive.zip"
});

const LEGACY_DEFAULT_LIBRARY_TITLES = new Set([
  "优秀提示词案例库",
  "视觉创作资料库",
  "视觉提示词灵感库",
  "提示词导演灵感库",
  "Visual Creative Archive",
  "Visual Creation Library",
  "My Visual Archive"
]);

const SYSTEM_DEFAULT_LIBRARY_TITLES = new Set([
  DEFAULT_SETTINGS.libraryTitle,
  DEFAULT_SETTINGS_EN.libraryTitle,
  ...LEGACY_DEFAULT_LIBRARY_TITLES
]);

export function defaultSettingsForLocale(locale) {
  return locale === "en" ? DEFAULT_SETTINGS_EN : DEFAULT_SETTINGS;
}

export function libraryTitleForLocale(value, locale) {
  const title = String(value ?? "").trim();
  return !title || SYSTEM_DEFAULT_LIBRARY_TITLES.has(title)
    ? defaultSettingsForLocale(locale).libraryTitle
    : title;
}

export function libraryTitleForStorage(displayValue, storedValue, locale) {
  const displayedTitle = String(displayValue ?? "").trim();
  const storedTitle = String(storedValue ?? "").trim();
  return displayedTitle === libraryTitleForLocale(storedTitle, locale) ? storedTitle : displayedTitle;
}

export const SCREENSHOT_SETTINGS = Object.freeze({
  maxOutputWidth: 1600,
  mimeType: "image/webp",
  quality: 0.88
});

const SCREENSHOT_STORAGE_PREFIX = "screenshot:";

export function normalizeSelection(value) {
  return String(value ?? "")
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => line.replace(/[\t ]+$/g, ""))
    .join("\n")
    .trim();
}

export function normalizeOutputPath(value, fallback = DEFAULT_SETTINGS.outputPath) {
  const normalized = String(value ?? "")
    .replace(/\\/g, "/")
    .split("/")
    .map((segment) => segment.trim())
    .filter(Boolean)
    .filter((segment) => segment !== "." && segment !== "..")
    .join("/")
    .replace(/[<>:"|?*]/g, "-");

  if (!normalized) {
    return fallback;
  }

  const withoutOldExtension = normalized.replace(/\.(?:md|zip)$/i, "");
  return `${withoutOldExtension}.zip`;
}

export function normalizeSettings(value = {}, defaults = DEFAULT_SETTINGS) {
  const storedTitle = String(value.libraryTitle ?? "").trim();
  const title = LEGACY_DEFAULT_LIBRARY_TITLES.has(storedTitle) ? defaults.libraryTitle : storedTitle;
  return {
    libraryTitle: title || defaults.libraryTitle,
    outputPath: normalizeOutputPath(value.outputPath, defaults.outputPath)
  };
}

export function buildEntry({ text, title, url, savedAt, libraryAddedAt, allowEmptyText = false }) {
  const normalizedText = normalizeSelection(text);
  if (!normalizedText && !allowEmptyText) {
    throw new Error("没有检测到高亮文字");
  }

  const parsedUrl = safeUrl(url);
  const now = new Date().toISOString();
  return {
    id: globalThis.crypto.randomUUID(),
    text: normalizedText,
    textRevision: 1,
    title: String(title ?? "").trim() || parsedUrl?.hostname || "未命名网页",
    url: parsedUrl?.href || "",
    savedAt: savedAt ?? now,
    libraryAddedAt: libraryAddedAt ?? now
  };
}

export function findDuplicate(entries, candidate) {
  return entries.find(
    (entry) => entry.text === candidate.text && entry.url === candidate.url
  );
}

export function screenshotStorageKey(entryId) {
  return `${SCREENSHOT_STORAGE_PREFIX}${entryId}`;
}

export function archiveMarkdownFilename(settings = DEFAULT_SETTINGS) {
  const title = normalizeSettings(settings).libraryTitle
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, "-")
    .replace(/[. ]+$/g, "")
    .trim();
  return `${title || DEFAULT_SETTINGS.libraryTitle}.md`;
}

export function calculateCropGeometry({
  imageWidth,
  imageHeight,
  viewportWidth,
  viewportHeight,
  rect,
  maxOutputWidth = SCREENSHOT_SETTINGS.maxOutputWidth
}) {
  const values = [
    imageWidth,
    imageHeight,
    viewportWidth,
    viewportHeight,
    rect?.x,
    rect?.y,
    rect?.width,
    rect?.height,
    maxOutputWidth
  ];
  if (values.some((value) => !Number.isFinite(value)) || values.some((value) => value < 0)) {
    throw new Error("截图区域数据无效");
  }
  if (!imageWidth || !imageHeight || !viewportWidth || !viewportHeight || !rect.width || !rect.height || !maxOutputWidth) {
    throw new Error("截图区域不能为空");
  }

  const left = Math.min(Math.max(rect.x, 0), viewportWidth);
  const top = Math.min(Math.max(rect.y, 0), viewportHeight);
  const right = Math.min(Math.max(rect.x + rect.width, left), viewportWidth);
  const bottom = Math.min(Math.max(rect.y + rect.height, top), viewportHeight);
  const scaleX = imageWidth / viewportWidth;
  const scaleY = imageHeight / viewportHeight;
  const sourceX = Math.round(left * scaleX);
  const sourceY = Math.round(top * scaleY);
  const sourceWidth = Math.min(
    imageWidth - sourceX,
    Math.max(1, Math.round((right - left) * scaleX))
  );
  const sourceHeight = Math.min(
    imageHeight - sourceY,
    Math.max(1, Math.round((bottom - top) * scaleY))
  );
  const outputWidth = Math.min(sourceWidth, Math.round(maxOutputWidth));
  const outputHeight = Math.max(
    1,
    Math.round(sourceHeight * (outputWidth / sourceWidth))
  );

  return {
    sourceX,
    sourceY,
    sourceWidth,
    sourceHeight,
    outputWidth,
    outputHeight
  };
}

export function renderMarkdown(
  entries,
  settings = DEFAULT_SETTINGS,
  taxonomy = createDefaultTaxonomy(),
  facetCatalog = createDefaultFacetCatalog(),
  options = {}
) {
  const locale = options.locale === "en" ? "en" : "zh-CN";
  const normalizedSettings = normalizeSettings(settings);
  const libraryTitle = libraryTitleForLocale(normalizedSettings.libraryTitle, locale);
  const normalizedTaxonomy = normalizeTaxonomy(taxonomy);
  const normalizedFacets = normalizeFacetCatalog(facetCatalog);
  const sections = entries.map((entry, index) => renderEntry(entry, index, normalizedTaxonomy, normalizedFacets, locale));
  const introduction = locale === "en"
    ? [`# ${escapeHeading(libraryTitle)}`, "", `${entries.length} cases.`]
    : [`# ${escapeHeading(libraryTitle)}`, "", `共 ${entries.length} 条案例。`];

  return `${[...introduction, ...sections].join("\n")}\n`;
}

export function renderLibraryJson(
  entries,
  settings = DEFAULT_SETTINGS,
  taxonomyValue = createDefaultTaxonomy(),
  facetCatalogValue = createDefaultFacetCatalog(),
  classificationRules = [],
  organizerState = {},
  composerState = null,
  compoundCases = []
) {
  const payload = {
    format: LIBRARY_PACKAGE_FORMAT,
    version: CURRENT_LIBRARY_PACKAGE_VERSION,
    schemaVersion: SCHEMA_VERSION,
    exportedAt: new Date().toISOString(),
    settings: normalizeSettings(settings),
    taxonomy: normalizeTaxonomy(taxonomyValue),
    facetCatalog: normalizeFacetCatalog(facetCatalogValue),
    classificationRules: Array.isArray(classificationRules) ? classificationRules : [],
    organizerState: normalizeOrganizerState(organizerState, (Array.isArray(entries) ? entries : []).map((entry) => entry.id)),
    compoundCases: normalizeCompoundCases(compoundCases, entries),
    entries: Array.isArray(entries) ? entries : []
  };
  if (composerState && typeof composerState === "object") {
    payload.composerSettings = normalizeComposerSettings(composerState.composerSettings);
    payload.composerSessions = normalizeComposerSessions(composerState.composerSessions);
    payload.creativeExperimentSettings = normalizeCreativeExperimentSettings(composerState.creativeExperimentSettings);
    payload.creativeRuns = normalizeCreativeRuns(composerState.creativeRuns);
    payload.creativeSkills = normalizeCreativeSkillsState(composerState.creativeSkills);
  }
  return `${JSON.stringify(payload, null, 2)}\n`;
}

function renderEntry(entry, index, taxonomy, facetCatalog, locale) {
  entry = normalizeEntryVisuals(entry);
  const english = locale === "en";
  const date = formatSavedAt(entry.savedAt, locale);
  const sourceUrl = safeUrl(entry.url);
  const source = sourceUrl
    ? `[${escapeLinkText(entry.title)}](${escapeLinkUrl(sourceUrl.href)})`
    : escapeLinkText(entry.title);
  const fence = codeFenceFor(entry.text);
  const reconstructionPrompt = primaryVisionDescription(entry);
  const visionFence = codeFenceFor(reconstructionPrompt);
  const screenshot = entry.visuals.flatMap((visual, visualIndex) => isSafeScreenshotPath(visual.screenshotPath)
    ? [`- ${english ? `Visual ${visualIndex + 1}${visual.id === entry.primaryVisualId ? " (primary)" : ""}: ` : `截图 ${visualIndex + 1}${visual.id === entry.primaryVisualId ? "（主图）" : ""}：`}![${english ? "Matching visual" : "对应画面"}](${visual.screenshotPath})`]
    : []);
  const classification = entry.classification?.status === "needs_review"
    ? (english ? "Needs review" : "待确认")
    : localizedContentType(taxonomy, entry.classification?.pathIds, locale);
  const confirmed = formatFacetAssignments(entry, facetCatalog, "confirmed");
  const attributeLines = [];
  const suggestionLines = [];
  for (const facet of facetCatalog.facets.filter((item) => item.status === "active").sort((a, b) => a.order - b.order)) {
    const values = confirmed.get(facet.id);
    if (values?.length) attributeLines.push(`- ${facet.name}${english ? ": " : "："}${values.join(english ? ", " : "、")}`);
  }
  const palette = entryPalette(entry);
  if (entry.customLabels?.length) attributeLines.push(`- ${english ? "Custom labels: " : "自定义标签："}${entry.customLabels.join(english ? ", " : "、")}`);
  if (palette?.colors?.length) attributeLines.push(`- ${english ? "Primary palette: " : "主图代表色卡："}${palette.colors.join(english ? ", " : "、")}`);
  if (entry.negativeTerms?.length) attributeLines.push(`- ${english ? "Original negative terms: " : "负面提示词原文："}${entry.negativeTerms.join(english ? ", " : "、")}`);
  for (const suggestion of entry.analysisCandidates ?? []) {
    const path = [suggestion.dimensionName, suggestion.groupName, suggestion.tagName].filter(Boolean).join(" / ");
    const source = suggestion.source === "deepseek_text"
      ? (english ? "DeepSeek text analysis" : "DeepSeek 文字分析")
      : suggestion.source === "local_image_review"
        ? (english ? "local visual review" : "本地人工看图")
        : (english ? "local structure extraction" : "本地结构提取");
    suggestionLines.push(english
      ? `- ${path} (Evidence: ${inlineText(suggestion.evidence)}; source: ${source})`
      : `- ${path}（证据：${inlineText(suggestion.evidence)}；来源：${source}）`);
  }

  return english ? [
    "",
    "---",
    "",
    `## Case ${String(index + 1).padStart(2, "0")} | ${escapeHeading(entry.title)}`,
    "",
    `- Case ID: ${inlineText(entry.id || `case-${index + 1}`)}`,
    `- Content type: ${classification || "Needs review"}`,
    `- Source: ${source}`,
    `- Saved: ${date}`,
    ...screenshot,
    "",
    ...(attributeLines.length ? ["### Creative attributes", "", ...attributeLines, ""] : []),
    ...(reconstructionPrompt ? ["### Reconstruction prompt", "", `${visionFence}text`, reconstructionPrompt, visionFence, ""] : []),
    ...(entry.text ? ["### Original prompt", "", `${fence}text`, entry.text, fence] : ["### Case note", "", "This visual reference contains a screenshot and creative attributes without prompt text."]),
    ...(suggestionLines.length ? ["", "### Suggestions awaiting review", "", ...suggestionLines] : [])
  ].join("\n") : [
    "",
    "---",
    "",
    `## 案例 ${String(index + 1).padStart(2, "0")}｜${escapeHeading(entry.title)}`,
    "",
    `- 案例 ID：${inlineText(entry.id || `case-${index + 1}`)}`,
    `- 内容类型：${classification || "待确认"}`,
    `- 来源：${source}`,
    `- 保存时间：${date}`,
    ...screenshot,
    "",
    ...(attributeLines.length ? ["### AI 标签", "", ...attributeLines, ""] : []),
    ...(reconstructionPrompt ? ["### 反推提示词", "", `${visionFence}text`, reconstructionPrompt, visionFence, ""] : []),
    ...(entry.text ? ["### 原始提示词", "", `${fence}text`, entry.text, fence] : ["### 案例说明", "", "这是一条仅包含截图和 AI 标签的图片案例。"]),
    ...(suggestionLines.length ? ["", "### 待确认建议", "", ...suggestionLines] : [])
  ].join("\n");
}

function formatFacetAssignments(entry, catalog, status) {
  const byNode = new Map(catalog.nodes.map((item) => [item.id, item]));
  const grouped = new Map();
  for (const assignment of entry.facetAssignments ?? []) {
    if (assignment.status !== status) continue;
    const node = byNode.get(assignment.nodeId);
    if (!node || node.status !== "active") continue;
    const values = grouped.get(node.facetId) ?? [];
    const path = formatFacetNodePath(catalog, node.id);
    values.push(status === "suggested" ? { path, evidence: assignment.evidence } : path);
    grouped.set(node.facetId, values);
  }
  return grouped;
}

function isSafeScreenshotPath(value) {
  const path = String(value ?? "");
  return /^images\/[A-Za-z0-9._/-]+\.(?:png|jpe?g|webp)$/i.test(path) && !path.includes("..");
}

function safeUrl(value) {
  try {
    const url = new URL(String(value ?? ""));
    if (url.protocol === "http:" || url.protocol === "https:") {
      return url;
    }
  } catch {
  }
  return null;
}

function formatSavedAt(value, locale = "zh-CN") {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return locale === "en" ? "Unknown time" : "未知时间";
  }

  const parts = new Intl.DateTimeFormat(locale, {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
    timeZoneName: "short"
  }).formatToParts(date);
  const valueOf = (type) => parts.find((part) => part.type === type)?.value || "";
  const day = `${valueOf("year")}-${valueOf("month")}-${valueOf("day")}`;
  const time = `${valueOf("hour")}:${valueOf("minute")}:${valueOf("second")}`;
  return `${day} ${time} ${valueOf("timeZoneName")}`.trim();
}

function localizedContentType(taxonomy, pathIds, locale) {
  const normalized = normalizeTaxonomy(taxonomy);
  const byId = new Map(normalized.nodes.map((item) => [item.id, item]));
  const englishNames = new Map([
    ["content:tutorial", "Tutorial"],
    ["content:prompt:image", "Image prompt"],
    ["content:prompt:video", "Video prompt"],
    ["content:image-case", "Visual case"]
  ]);
  return (Array.isArray(pathIds) ? pathIds : []).map((id) => {
    const node = byId.get(id);
    if (!node) return "";
    return locale === "en" && !node.customized ? englishNames.get(id) || node.name : node.name;
  }).filter(Boolean).join(" / ");
}

function codeFenceFor(text) {
  const longestRun = Math.max(
    0,
    ...Array.from(text.matchAll(/`+/g), (match) => match[0].length)
  );
  return "`".repeat(Math.max(3, longestRun + 1));
}

function escapeHeading(value) {
  return String(value).replace(/\s+/g, " ").replace(/([\\`*_{}\[\]<>#+.!|])/g, "\\$1");
}

function escapeLinkText(value) {
  return String(value).replace(/([\\\[\]])/g, "\\$1");
}

function escapeLinkUrl(value) {
  return encodeURI(String(value)).replace(/\(/g, "%28").replace(/\)/g, "%29");
}

function inlineText(value) {
  return String(value ?? "").replace(/[\r\n]+/g, " ").replace(/\s+/g, " ").trim();
}
