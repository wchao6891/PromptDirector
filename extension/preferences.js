import { normalizeCaseSortMode } from "./library-view.js";

export const DEFAULT_UI_PREFERENCES = Object.freeze({
  locale: "system",
  theme: "dark",
  motion: "system",
  analysisDiagnostics: false,
  sidebarWidth: 244,
  sidebarLayout: { collapsed: false, open: ["projects"], order: ["projects", "types", "tags"] },
  detailMode: "fullscreen",
  detailSidebarWidth: 760,
  galleryView: "waterfall",
  galleryZoom: 50,
  gallerySort: "added-desc",
  galleryHiddenColumns: [],
  includeSubprojects: false,
  detailPanelRatio: null
});

// Waterfall defaults to the existing 270px cards; list defaults to compact 48px thumbnails.
export const GALLERY_SIZE_LIMITS = Object.freeze({ waterfall: { min: 140, max: 480, default: 270 }, list: { min: 32, max: 80, default: 48 } });
export const LIST_OPTIONAL_COLUMNS = ["type", "count", "tags", "source", "size", "added"];
// Shared slider position: the midpoint preserves the established default sizes.
export function gallerySizesForZoom(zoom = 50) {
  const value = Math.max(0, Math.min(100, Number.isFinite(zoom) ? zoom : 50));
  return Object.fromEntries(Object.entries(GALLERY_SIZE_LIMITS).map(([view, limit]) => [view,
    Math.round(value <= 50 ? limit.min + (limit.default - limit.min) * value / 50
      : limit.default + (limit.max - limit.default) * (value - 50) / 50)]));
}
function normalizeGalleryZoom(value) {
  if (typeof value.galleryZoom === "number" && Number.isFinite(value.galleryZoom)) return Math.max(0, Math.min(100, Math.round(value.galleryZoom)));
  // Migrate the previously saved active-view size once; normalized writes drop gallerySize.
  const view = value.galleryView === "list" ? "list" : "waterfall";
  const size = value.gallerySize?.[view], limit = GALLERY_SIZE_LIMITS[view];
  if (typeof size !== "number" || !Number.isFinite(size)) return 50;
  return Math.max(0, Math.min(100, Math.round(size <= limit.default
    ? (size - limit.min) / (limit.default - limit.min) * 50
    : 50 + (size - limit.default) / (limit.max - limit.default) * 50)));
}

export const SIDEBAR_WIDTH_LIMITS = Object.freeze({ min: 216, max: 420, default: 244 });
export const DETAIL_SIDEBAR_WIDTH_LIMITS = Object.freeze({ min: 520, max: 1200, default: 760 });

export function normalizeSidebarWidth(value) {
  const width = Number(value);
  if (!Number.isFinite(width)) return SIDEBAR_WIDTH_LIMITS.default;
  return Math.min(SIDEBAR_WIDTH_LIMITS.max, Math.max(SIDEBAR_WIDTH_LIMITS.min, Math.round(width)));
}

export function normalizeDetailSidebarWidth(value) {
  const width = Number(value);
  if (!Number.isFinite(width)) return DETAIL_SIDEBAR_WIDTH_LIMITS.default;
  return Math.min(DETAIL_SIDEBAR_WIDTH_LIMITS.max, Math.max(DETAIL_SIDEBAR_WIDTH_LIMITS.min, Math.round(width)));
}

export function normalizeUiPreferences(value = {}) {
  return {
    locale: ["system", "zh-CN", "en"].includes(value.locale) ? value.locale : "system",
    theme: ["system", "light", "dark"].includes(value.theme) ? value.theme : "dark",
    motion: value.motion === "none" ? "reduced" : (["system", "reduced"].includes(value.motion) ? value.motion : "system"),
    analysisDiagnostics: value.analysisDiagnostics === true,
    sidebarWidth: normalizeSidebarWidth(value.sidebarWidth),
    sidebarLayout: normalizeSidebarLayout(value.sidebarLayout),
    galleryView: ["waterfall", "list"].includes(value.galleryView) ? value.galleryView : "waterfall",
    galleryZoom: normalizeGalleryZoom(value),
    gallerySort: normalizeCaseSortMode(value.gallerySort),
    galleryHiddenColumns: [...new Set(Array.isArray(value.galleryHiddenColumns) ? value.galleryHiddenColumns : [])].filter(key => LIST_OPTIONAL_COLUMNS.includes(key)),
    includeSubprojects: value.includeSubprojects === true,
    detailMode: value.detailMode === "sidebar" ? "sidebar" : "fullscreen",
    detailSidebarWidth: normalizeDetailSidebarWidth(value.detailSidebarWidth),
    detailPanelRatio: typeof value.detailPanelRatio === "number" && Number.isFinite(value.detailPanelRatio) && value.detailPanelRatio > 0 && value.detailPanelRatio < 1 ? value.detailPanelRatio : null
  };
}

export function resolveLocale(preferences = DEFAULT_UI_PREFERENCES, browserLocale = "") {
  const normalized = normalizeUiPreferences(preferences);
  if (normalized.locale !== "system") return normalized.locale;
  return String(browserLocale).toLocaleLowerCase().startsWith("zh") ? "zh-CN" : "en";
}

export function normalizeSidebarLayout(value = {}) {
  const keys = ["projects", "types", "tags"];
  const layout = value && typeof value === "object" ? value : {};
  const order = [...new Set([...(Array.isArray(layout.order) ? layout.order : []), ...keys])].filter(key => keys.includes(key));
  const open = [...new Set(Array.isArray(layout.open) ? layout.open : ["projects"])].filter(key => keys.includes(key));
  return { collapsed: layout.collapsed === true, open, order };
}
