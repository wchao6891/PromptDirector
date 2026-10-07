(() => {
  const root = document.documentElement;
  const storedTheme = (() => {
    try {
      return localStorage.getItem("promptDirectorTheme");
    } catch {
      return null;
    }
  })();
  const storedMotion = (() => {
    try {
      return localStorage.getItem("promptDirectorMotion");
    } catch {
      return null;
    }
  })();

  const theme = ["system", "light", "dark"].includes(storedTheme) ? storedTheme : "dark";
  const motion = storedMotion === "none"
    ? "reduced"
    : (["system", "reduced"].includes(storedMotion) ? storedMotion : "system");
  const prefersDarkQuery = typeof globalThis.matchMedia === "function"
    ? globalThis.matchMedia("(prefers-color-scheme: dark)")
    : null;
  const prefersDark = prefersDarkQuery?.matches === true;
  const resolvedTheme = theme === "system" ? (prefersDark ? "dark" : "light") : theme;
  const backgroundColor = resolvedTheme === "dark" ? "#0f1113" : "#e2e6e3";
  const colorScheme = resolvedTheme === "dark" ? "dark" : "light";

  root.dataset.theme = theme;
  root.dataset.resolvedTheme = resolvedTheme;
  root.dataset.motion = motion;
  root.style.backgroundColor = backgroundColor;
  root.style.colorScheme = colorScheme;

  // Pages ship Chinese markup; when the last page used another language, keep the body hidden
  // until initializeUi has translated it so the Chinese text never flashes.
  const storedLocale = (() => {
    try {
      return localStorage.getItem("promptDirectorLocale");
    } catch {
      return null;
    }
  })();
  if (storedLocale && storedLocale !== "zh-CN" && document.head) {
    const pending = document.createElement("style");
    pending.id = "promptdirector-locale-pending";
    pending.textContent = "body { visibility: hidden; }";
    document.head.append(pending);
    // Never leave a page blank when its script fails to start.
    setTimeout(() => pending.remove(), 3000);
  }

  if (storedMotion === "none") {
    try {
      localStorage.setItem("promptDirectorMotion", "reduced");
    } catch {
      // The resolved data attribute still preserves the user's preference for this page.
    }
  }

  document.addEventListener("DOMContentLoaded", () => {
    if (!document.body) return;
    if (root.dataset.theme !== theme) return;
    document.body.style.backgroundColor = backgroundColor;
    document.body.style.colorScheme = colorScheme;
  }, { once: true });
})();
