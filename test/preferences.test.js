import test from "node:test";
import assert from "node:assert/strict";

import {
  normalizeDetailSidebarWidth,
  normalizeSidebarWidth,
  normalizeUiPreferences,
  normalizePanelPositions,
  updateLayoutPreferences,
  resolveLocale
} from "../extension/preferences.js";

test('restoring layout changes only presentation and retains custom keys, theme and browsing filters', () => {
  const before = normalizeUiPreferences({ locale: 'en', theme: 'light', shortcuts: { addFeedback: 'N' },
    gallerySort: 'title-asc', includeSubprojects: true, sidebarWidth: 410, detailMode: 'sidebar',
    floatingPanelPositions: { reviewFeedback: { left: .4, top: .3 } } });
  const reset = updateLayoutPreferences(before, {}, true);
  for (const key of ['locale', 'theme', 'shortcuts', 'gallerySort', 'includeSubprojects']) assert.deepEqual(reset[key], before[key]);
  assert.equal(reset.sidebarWidth, normalizeUiPreferences().sidebarWidth);
  assert.deepEqual(reset.floatingPanelPositions, {});
  assert.equal(reset.detailMode, 'fullscreen');
  assert.equal(updateLayoutPreferences(before, { theme: 'dark', sidebarWidth: 300 }).theme, 'light');
});

test("UI preferences accept only supported locale theme and motion values", () => {
  assert.deepEqual(normalizeUiPreferences({ locale: "fr", theme: "neon", motion: "spin" }), {
    locale: "system",
    theme: "dark",
    motion: "system",
    analysisDiagnostics: false,
    shortcuts: {},
    floatingPanelPositions: {},
    layoutPresets: normalizeUiPreferences().layoutPresets,
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
  assert.deepEqual(normalizeUiPreferences({ locale: "en", theme: "dark", motion: "none", analysisDiagnostics: true }), {
    locale: "en",
    theme: "dark",
    motion: "reduced",
    analysisDiagnostics: true,
    shortcuts: {},
    floatingPanelPositions: {},
    layoutPresets: normalizeUiPreferences().layoutPresets,
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
  assert.equal(normalizeUiPreferences({ theme: "light", motion: "reduced" }).theme, "light");
  assert.equal(normalizeUiPreferences({ theme: "system", motion: "reduced" }).theme, "system");
});

test('floating positions retain authored placement and discard coordinates that can hide tools', () => {
  const source = { reviewFeedback: { left: .6, top: .2, width: 999 }, tagEditor: { left: 0, top: 1 },
    invalid: { left: NaN, top: 0 }, outside: { left: 2, top: .2 }, negative: { left: -.1, top: .2 },
    'bad key': { left: .2, top: .2 } };
  assert.deepEqual(normalizePanelPositions(source), { reviewFeedback: { left: .6, top: .2 }, tagEditor: { left: 0, top: 1 } });
  assert.equal(source.reviewFeedback.width, 999);
  const normalized = normalizeUiPreferences({ floatingPanelPositions: source, shortcuts: { addFeedback: 'N' } });
  assert.equal(normalized.shortcuts.addFeedback, 'N');
  assert.deepEqual(normalized.floatingPanelPositions, normalizePanelPositions(source));
  assert.deepEqual(normalizePanelPositions(null), {});
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


test("browse preferences keep folder scope and reject removed or unknown views", () => {
  assert.equal(normalizeUiPreferences({galleryView: "list", includeSubprojects: true}).galleryView, "list");
  assert.equal(normalizeUiPreferences({includeSubprojects: true}).includeSubprojects, true);
  assert.equal(normalizeUiPreferences({galleryView: "columns"}).galleryView, "waterfall");
  assert.equal(normalizeUiPreferences({includeSubprojects: "false"}).includeSubprojects, false);
});

test("sidebar layout keeps old users on projects and sanitizes saved module state", () => {
  assert.deepEqual(normalizeUiPreferences({}).sidebarLayout, { collapsed: false, open: ["projects"], order: ["projects", "types", "tags"] });
  assert.deepEqual(normalizeUiPreferences({sidebarLayout: {collapsed:true, open:["tags","tags","unknown"],order:["types","types","unknown"]}}).sidebarLayout,
    {collapsed:true, open:["tags"], order:["types","projects","tags"]});
  assert.deepEqual(normalizeUiPreferences({sidebarLayout: {open:[]}}).sidebarLayout.open, []);
});
