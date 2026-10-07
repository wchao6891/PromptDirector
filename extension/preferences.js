import { normalizeCaseSortMode } from "./library-view.js";
import { normalizeShortcutOverrides } from './keyboard-shortcuts.js';

export const DEFAULT_UI_PREFERENCES = Object.freeze({
  locale: "system",
  theme: "dark",
  motion: "system",
  analysisDiagnostics: false,
  shortcuts: {},
  floatingPanelPositions: {},
  layoutPresets: [],
  activeLayoutId: "default",
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

export const LAYOUT_PREFERENCE_KEYS = Object.freeze(['sidebarWidth', 'sidebarLayout', 'detailMode',
  'detailSidebarWidth', 'galleryView', 'galleryZoom', 'galleryHiddenColumns', 'detailPanelRatio', 'floatingPanelPositions']);

export function updateLayoutPreferences(previous, patch, reset = false) {
  const values = reset ? DEFAULT_UI_PREFERENCES : patch || {};
  const changes = Object.fromEntries(LAYOUT_PREFERENCE_KEYS.filter(key => Object.hasOwn(values, key)).map(key => [key, values[key]]));
  if (!reset && changes.sidebarLayout) changes.sidebarLayout = { ...normalizeSidebarLayout(previous?.sidebarLayout), ...changes.sidebarLayout };
  return normalizeUiPreferences({ ...previous, ...changes });
}

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
export function galleryZoomForSize(view, size) {
  const limit = GALLERY_SIZE_LIMITS[view] || GALLERY_SIZE_LIMITS.waterfall;
  if (typeof size !== 'number' || !Number.isFinite(size)) return 50;
  return Math.max(0, Math.min(100, Math.round(size <= limit.default
    ? (size - limit.min) / (limit.default - limit.min) * 50
    : 50 + (size - limit.default) / (limit.max - limit.default) * 50)));
}
function normalizeGalleryZoom(value) {
  if (typeof value.galleryZoom === "number" && Number.isFinite(value.galleryZoom)) return Math.max(0, Math.min(100, Math.round(value.galleryZoom)));
  // Migrate the previously saved active-view size once; normalized writes drop gallerySize.
  const view = value.galleryView === "list" ? "list" : "waterfall";
  return galleryZoomForSize(view, value.gallerySize?.[view]);
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

function normalizePreferenceValues(value = {}) {
  return {
    locale: ["system", "zh-CN", "en"].includes(value.locale) ? value.locale : "system",
    theme: ["system", "light", "dark"].includes(value.theme) ? value.theme : "dark",
    motion: value.motion === "none" ? "reduced" : (["system", "reduced"].includes(value.motion) ? value.motion : "system"),
    analysisDiagnostics: value.analysisDiagnostics === true,
    shortcuts: normalizeShortcutOverrides(value.shortcuts),
    floatingPanelPositions: normalizePanelPositions(value.floatingPanelPositions),
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

// Presets contain presentation only; original material, theme and key bindings stay separate.
export function layoutSnapshot(value) {
  const normalized = normalizePreferenceValues(value);
  return Object.fromEntries(LAYOUT_PREFERENCE_KEYS.map(key => [key, normalized[key]]));
}

export function normalizeUiPreferences(value = {}) {
  const seen = new Set(['default']);
  const presets = Array.isArray(value.layoutPresets) ? value.layoutPresets : [];
  const defaultPreset = presets.find(item => item?.id === 'default');
  const layoutPresets = [{ id: 'default', name: '默认', values: layoutSnapshot(defaultPreset?.values || DEFAULT_UI_PREFERENCES) }];
  for (const item of presets) {
    if (!item || typeof item.id !== 'string' || !/^[a-zA-Z0-9_-]+$/.test(item.id) || seen.has(item.id) || typeof item.name !== 'string' || !item.name.trim()) continue;
    seen.add(item.id);
    layoutPresets.push({ id: item.id, name: item.name.trim(), values: layoutSnapshot(item.values || {}) });
  }
  return { ...normalizePreferenceValues(value), layoutPresets,
    activeLayoutId: seen.has(value.activeLayoutId) ? value.activeLayoutId : 'default' };
}

export function normalizePanelPositions(value = {}) {
  return Object.fromEntries(Object.entries(value && typeof value === 'object' ? value : {}).filter(([key, position]) =>
    /^[a-z][a-zA-Z0-9]*$/.test(key) && position && ['left', 'top'].every(axis =>
      Number.isFinite(position[axis]) && position[axis] >= 0 && position[axis] <= 1))
    .map(([key, position]) => [key, { left: position.left, top: position.top }]));
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
