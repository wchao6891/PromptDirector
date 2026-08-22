export const DEFAULT_UI_PREFERENCES = Object.freeze({
  locale: "system",
  theme: "dark",
  motion: "system",
  analysisDiagnostics: false,
  sidebarWidth: 244
});

export const SIDEBAR_WIDTH_LIMITS = Object.freeze({ min: 216, max: 420, default: 244 });

export function normalizeSidebarWidth(value) {
  const width = Number(value);
  if (!Number.isFinite(width)) return SIDEBAR_WIDTH_LIMITS.default;
  return Math.min(SIDEBAR_WIDTH_LIMITS.max, Math.max(SIDEBAR_WIDTH_LIMITS.min, Math.round(width)));
}

export function normalizeUiPreferences(value = {}) {
  return {
    locale: ["system", "zh-CN", "en"].includes(value.locale) ? value.locale : "system",
    theme: ["system", "light", "dark"].includes(value.theme) ? value.theme : "dark",
    motion: value.motion === "none" ? "reduced" : (["system", "reduced"].includes(value.motion) ? value.motion : "system"),
    analysisDiagnostics: value.analysisDiagnostics === true,
    sidebarWidth: normalizeSidebarWidth(value.sidebarWidth)
  };
}

export function resolveLocale(preferences = DEFAULT_UI_PREFERENCES, browserLocale = "") {
  const normalized = normalizeUiPreferences(preferences);
  if (normalized.locale !== "system") return normalized.locale;
  return String(browserLocale).toLocaleLowerCase().startsWith("zh") ? "zh-CN" : "en";
}
