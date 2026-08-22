import test from "node:test";
import assert from "node:assert/strict";

import { normalizeSidebarWidth, normalizeUiPreferences, resolveLocale } from "../preferences.js";

test("UI preferences accept only supported locale theme and motion values", () => {
  assert.deepEqual(normalizeUiPreferences({ locale: "fr", theme: "neon", motion: "spin" }), {
    locale: "system",
    theme: "dark",
    motion: "system",
    analysisDiagnostics: false,
    sidebarWidth: 244
  });
  assert.deepEqual(normalizeUiPreferences({ locale: "en", theme: "dark", motion: "none", analysisDiagnostics: true }), {
    locale: "en",
    theme: "dark",
    motion: "reduced",
    analysisDiagnostics: true,
    sidebarWidth: 244
  });
  assert.equal(normalizeUiPreferences({ theme: "light", motion: "reduced" }).theme, "light");
  assert.equal(normalizeUiPreferences({ theme: "system", motion: "reduced" }).theme, "system");
});

test("sidebar width keeps old preferences compatible and clamps unsafe values", () => {
  assert.equal(normalizeSidebarWidth(undefined), 244);
  assert.equal(normalizeSidebarWidth(180), 216);
  assert.equal(normalizeSidebarWidth(336.4), 336);
  assert.equal(normalizeSidebarWidth(600), 420);
  assert.equal(normalizeUiPreferences({ sidebarWidth: 320 }).sidebarWidth, 320);
});

test("system locale resolves Chinese browsers to Chinese and everything else to English", () => {
  assert.equal(resolveLocale({ locale: "system" }, "zh-TW"), "zh-CN");
  assert.equal(resolveLocale({ locale: "system" }, "en-US"), "en");
  assert.equal(resolveLocale({ locale: "zh-CN" }, "en-US"), "zh-CN");
});
