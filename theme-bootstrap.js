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
  const backgroundColor = resolvedTheme === "dark" ? "#0f1113" : "#eef0ef";
  const colorScheme = resolvedTheme === "dark" ? "dark" : "light";

  root.dataset.theme = theme;
  root.dataset.resolvedTheme = resolvedTheme;
  root.dataset.motion = motion;
  root.style.backgroundColor = backgroundColor;
  root.style.colorScheme = colorScheme;

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
