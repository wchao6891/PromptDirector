export const DEFAULT_UI_PREFERENCES = Object.freeze({
  locale: "system",
  theme: "dark",
  motion: "system",
  analysisDiagnostics: false
});

export function normalizeUiPreferences(value = {}) {
  return {
    locale: ["system", "zh-CN", "en"].includes(value.locale) ? value.locale : "system",
    theme: ["system", "light", "dark"].includes(value.theme) ? value.theme : "dark",
    motion: value.motion === "none" ? "reduced" : (["system", "reduced"].includes(value.motion) ? value.motion : "system"),
    analysisDiagnostics: value.analysisDiagnostics === true
  };
}

export function resolveLocale(preferences = DEFAULT_UI_PREFERENCES, browserLocale = "") {
  const normalized = normalizeUiPreferences(preferences);
  if (normalized.locale !== "system") return normalized.locale;
  return String(browserLocale).toLocaleLowerCase().startsWith("zh") ? "zh-CN" : "en";
}
