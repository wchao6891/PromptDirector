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
  includeSubprojects: false,
  detailPanelRatio: null
});

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
