import test from "node:test";
import assert from "node:assert/strict";

import {
  normalizeDetailSidebarWidth,
  normalizeSidebarWidth,
  normalizeUiPreferences,
  resolveLocale
} from "../extension/preferences.js";

test("UI preferences accept only supported locale theme and motion values", () => {
  assert.deepEqual(normalizeUiPreferences({ locale: "fr", theme: "neon", motion: "spin" }), {
    locale: "system",
    theme: "dark",
    motion: "system",
    analysisDiagnostics: false,
    sidebarWidth: 244,
    detailMode: "fullscreen",
    detailSidebarWidth: 760
  });
  assert.deepEqual(normalizeUiPreferences({ locale: "en", theme: "dark", motion: "none", analysisDiagnostics: true }), {
    locale: "en",
    theme: "dark",
    motion: "reduced",
    analysisDiagnostics: true,
    sidebarWidth: 244,
    detailMode: "fullscreen",
    detailSidebarWidth: 760
  });
  assert.equal(normalizeUiPreferences({ theme: "light", motion: "reduced" }).theme, "light");
  assert.equal(normalizeUiPreferences({ theme: "system", motion: "reduced" }).theme, "system");
});

test("case detail mode remains local UI state and clamps its remembered sidebar width", () => {
  assert.equal(normalizeUiPreferences({ detailMode: "sidebar" }).detailMode, "sidebar");
  assert.equal(normalizeUiPreferences({ detailMode: "window" }).detailMode, "fullscreen");
  assert.equal(normalizeDetailSidebarWidth(undefined), 760);
  assert.equal(normalizeDetailSidebarWidth(480), 520);
  assert.equal(normalizeDetailSidebarWidth(824.6), 825);
  assert.equal(normalizeDetailSidebarWidth(1600), 1200);
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
