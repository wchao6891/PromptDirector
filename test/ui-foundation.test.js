import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const foundation = await readFile(new URL("../ui-foundation.css", import.meta.url), "utf8");
const sprite = await readFile(new URL("../assets/ui-icons.svg", import.meta.url), "utf8");

function relativeLuminance(hex) {
  const channels = hex.match(/[a-f\d]{2}/gi).map((value) => parseInt(value, 16) / 255);
  const linear = channels.map((value) => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4);
  return (0.2126 * linear[0]) + (0.7152 * linear[1]) + (0.0722 * linear[2]);
}

function contrast(foreground, background) {
  const values = [relativeLuminance(foreground), relativeLuminance(background)].sort((a, b) => b - a);
  return (values[0] + 0.05) / (values[1] + 0.05);
}

function mix(foreground, background, foregroundWeight) {
  const parse = (hex) => hex.match(/[a-f\d]{2}/gi).map((value) => parseInt(value, 16));
  const foregroundChannels = parse(foreground);
  const backgroundChannels = parse(background);
  return `#${foregroundChannels.map((value, index) => Math.round(
    (value * foregroundWeight) + (backgroundChannels[index] * (1 - foregroundWeight))
  ).toString(16).padStart(2, "0")).join("")}`;
}

test("shared visual foundation owns the locked dark theme and control scale", () => {
  assert.match(foundation, /--ui-browser:\s*#0f1113/);
  assert.match(foundation, /--ui-page:\s*#131416/);
  assert.match(foundation, /--ui-surface:\s*#1c1e21/);
  assert.match(foundation, /--ui-raised:\s*#23262a/);
  assert.match(foundation, /--ui-hover:\s*#2a2d32/);
  assert.match(foundation, /--ui-muted:\s*#828282/);
  assert.match(foundation, /--ui-accent:\s*#d1fe17/);
  assert.match(foundation, /--ui-control-height:\s*36px/);
  assert.match(foundation, /--ui-compact-height:\s*30px/);
  assert.match(foundation, /--ui-control-radius:\s*4px/);
  assert.match(foundation, /--ui-container-radius:\s*6px/);
  assert.match(foundation, /button:active:not\(:disabled\)\s*\{\s*transform:\s*none/);
  assert.match(foundation, /button,\s*\.button-primary,\s*\.button-secondary\s*\{/);
  assert.match(foundation, /display:\s*inline-flex/);
  assert.match(foundation, /text-decoration:\s*none/);
});

test("light theme uses the calibrated neutral surfaces and semantic green hierarchy", () => {
  for (const [token, value] of Object.entries({
    "ui-browser": "#e2e6e3",
    "ui-page": "#edf0ed",
    "ui-surface": "#f8f9f8",
    "ui-raised": "#e5e9e6",
    "ui-hover": "#dce2de",
    "ui-text": "#121714",
    "ui-muted": "#5b645e",
    "ui-accent": "#d1fe17"
  })) {
    assert.match(foundation, new RegExp(`--${token}:\\s*${value}`));
  }
  assert.ok(contrast("#121714", "#edf0ed") >= 4.5);
  assert.ok(contrast("#5b645e", "#dce2de") >= 4.5);
  assert.ok(contrast("#0f1113", "#d1fe17") >= 4.5);
  assert.ok(contrast("#121714", mix("#d1fe17", "#f8f9f8", 0.16)) >= 4.5);
  assert.match(foundation, /--ui-accent-emphasis:\s*var\(--ui-accent\)/);
  assert.match(foundation, /--ui-accent-emphasis-contrast:\s*var\(--ui-accent-contrast\)/);
  assert.match(foundation, /--ui-selected-surface:\s*color-mix\(in srgb, var\(--ui-accent\) 16%, var\(--ui-surface\)\)/);
  assert.match(foundation, /--ui-project-active-surface:\s*var\(--ui-selected-surface\)/);
  assert.match(foundation, /--ui-content-active-surface:\s*var\(--ui-selected-surface\)/);
  assert.match(foundation, /--ui-card-border:\s*var\(--ui-border-weak\)/);
  assert.match(foundation, /--accent-ink:\s*var\(--ui-text\)/);
  assert.match(foundation, /--ui-focus:\s*var\(--ui-accent-emphasis\)/);
  assert.match(foundation, /--ui-primary-border:\s*transparent/);
  assert.match(foundation, /button,\s*\.button-primary,\s*\.button-secondary\s*\{[\s\S]*?border:\s*1px solid transparent/);
  assert.doesNotMatch(foundation, /#526900/i);
  assert.match(foundation, /:root\[data-theme="dark"\][\s\S]*--ui-accent-emphasis:\s*var\(--ui-accent\)/);
  assert.match(foundation, /\.quiet-danger\s*\{[\s\S]*color:\s*var\(--ui-danger\)[\s\S]*background:\s*transparent/);
});

test("light fields use one neutral edge with a soft branded halo while dark focus stays unchanged", () => {
  assert.match(foundation, /--ui-field-focus-border:\s*var\(--ui-border-strong\)/);
  assert.match(foundation, /--ui-field-focus-outline:\s*none/);
  assert.match(foundation, /--ui-field-focus-shadow:\s*0 0 0 2px var\(--ui-accent-subtle\)/);
  assert.match(foundation, /input:focus-visible,\s*select:focus-visible,\s*textarea:focus-visible\s*\{[\s\S]*?border-color:\s*var\(--ui-field-focus-border\)[\s\S]*?outline:\s*var\(--ui-field-focus-outline\)[\s\S]*?box-shadow:\s*var\(--ui-field-focus-shadow\)/);
  assert.match(foundation, /:root\[data-theme="dark"\][\s\S]*?--ui-field-focus-border:\s*var\(--ui-border\)[\s\S]*?--ui-field-focus-outline:\s*2px solid var\(--ui-focus\)[\s\S]*?--ui-field-focus-shadow:\s*none/);
});

test("page styles keep domain layout without redefining shared theme roles", async () => {
  for (const pageStyle of ["library.css", "curated.css", "collector.css", "skills-page.css", "composer-page.css"]) {
    const source = await readFile(new URL(`../${pageStyle}`, import.meta.url), "utf8");
    assert.doesNotMatch(source, /--paper:\s*#/i, `${pageStyle} 不应重新定义页面主题色`);
    assert.doesNotMatch(source, /--accent:\s*#/i, `${pageStyle} 不应重新定义品牌色`);
    assert.doesNotMatch(source, /(?:^|\n)button\s*\{/i, `${pageStyle} 不应重新定义通用按钮`);
  }
});

test("brand green is reserved for fills and indicators instead of light-theme copy", async () => {
  for (const sourceFile of ["ui-foundation.css", "library.css", "curated.css", "collector.css", "skills-page.css", "composer-page.css", "share-preview.js"]) {
    const source = await readFile(new URL(`../${sourceFile}`, import.meta.url), "utf8");
    assert.doesNotMatch(source, /(?:^|[;{])\s*color:\s*var\(--(?:ui-)?accent-emphasis\)/m, `${sourceFile} 不应把品牌荧光绿直接用于文字`);
  }
});

test("local Lucide sprite contains the shared navigation and action icons", () => {
  assert.match(sprite, /lucide-static/);
  for (const name of ["arrow-left", "chevron-left", "chevron-right", "check", "menu", "settings", "x"]) {
    assert.match(sprite, new RegExp(`id="icon-${name}"`));
  }
});
