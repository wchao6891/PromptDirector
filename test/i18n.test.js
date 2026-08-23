import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import { hasEnglishTranslation, translateForLocale } from "../i18n.js";

test("manifest locale catalogs expose the same message keys", async () => {
  const [zh, en] = await Promise.all([
    readJson("../_locales/zh_CN/messages.json"),
    readJson("../_locales/en/messages.json")
  ]);
  assert.deepEqual(Object.keys(en).sort(), Object.keys(zh).sort());
});

test("every static HTML i18n marker has an English translation", async () => {
  for (const path of ["../collector.html", "../library.html", "../composer.html", "../skills.html", "../curated.html", "../curated-skills.html"]) {
    const html = await readFile(new URL(path, import.meta.url), "utf8");
    const keys = [...html.matchAll(/data-i18n(?:-placeholder|-aria-label|-title)?="([^"]+)"/g)].map((match) => match[1]);
    const missing = [...new Set(keys.filter((key) => !hasEnglishTranslation(key)))];
    assert.deepEqual(missing, [], `${path} has untranslated keys`);
  }
});

test("product pages do not leave Chinese interface text outside the translation system", async () => {
  for (const path of ["../collector.html", "../library.html", "../composer.html", "../skills.html", "../curated.html", "../curated-skills.html"]) {
    const html = await readFile(new URL(path, import.meta.url), "utf8");
    const unmarkedText = [];
    for (const match of html.matchAll(/>([^<>]*[\p{Script=Han}][^<>]*)</gu)) {
      const openingStart = html.lastIndexOf("<", match.index);
      const opening = html.slice(openingStart, match.index + 1);
      if (!opening.startsWith("<title") && !opening.includes("data-i18n=")) unmarkedText.push(match[1].trim());
    }
    const unmarkedAttributes = [];
    for (const tag of html.match(/<[^>]+>/gu) || []) {
      for (const [attribute, marker] of [["placeholder", "data-i18n-placeholder"], ["aria-label", "data-i18n-aria-label"], ["title", "data-i18n-title"]]) {
        const value = tag.match(new RegExp(`\\b${attribute}="([^"]*[\\u3400-\\u9fff][^"]*)"`, "u"))?.[1];
        if (value && !tag.includes(`${marker}=`)) unmarkedAttributes.push(`${attribute}: ${value}`);
      }
    }
    assert.deepEqual([...new Set(unmarkedText.filter(Boolean))], [], `${path} has unmarked Chinese text`);
    assert.deepEqual([...new Set(unmarkedAttributes)], [], `${path} has unmarked Chinese attributes`);
  }
});

test("dynamic interface helpers only receive Chinese copy with an English translation", async () => {
  const paths = ["../library.js", "../composer-page.js", "../skills-page.js", "../collector.js", "../curated-page.js", "../ui-dialogs.js", "../tag-editor.js"];
  const missing = [];
  for (const path of paths) {
    const source = await readFile(new URL(path, import.meta.url), "utf8");
    for (const match of source.matchAll(/\bt\(\s*"((?:[^"\\]|\\.)*)"/gu)) {
      const key = JSON.parse(`"${match[1]}"`);
      if (/\p{Script=Han}/u.test(key) && !hasEnglishTranslation(key)) missing.push(`${path}: ${key}`);
    }
    if (!["../library.js", "../composer-page.js"].includes(path)) continue;
    for (const line of source.split("\n").filter((value) => value.includes("textEl("))) {
      for (const match of line.matchAll(/"((?:[^"\\]|\\.)*)"/gu)) {
        const key = JSON.parse(`"${match[1]}"`);
        if (/\p{Script=Han}/u.test(key) && !hasEnglishTranslation(key)) missing.push(`${path}: ${key}`);
      }
    }
  }
  assert.deepEqual([...new Set(missing)], []);
});

test("missing sync folders have localized recovery guidance", () => {
  assert.equal(
    translateForLocale("同步文件夹中的文件或目录不存在，请重新选择同步文件夹后再同步", "en"),
    "A file or folder in the sync location is missing. Select the sync folder again, then retry syncing."
  );
  assert.equal(translateForLocale("重新选择同步文件夹", "en"), "Select sync folder again");
});

test("composer reference-image modes explain the real image and token behavior in English", () => {
  assert.equal(translateForLocale("参考图参与方式", "en"), "How reference images are used");
  assert.equal(translateForLocale("带原图生成（默认）", "en"), "Generate with original images (default)");
  assert.equal(
    translateForLocale("全程只用案例/分析文字（不读图，最省 token）", "en"),
    "Use case prompts or analysis text only (no image reading, lowest token use)"
  );
});

test("collector runtime states and destructive draft actions have English copy", () => {
  const expected = new Map([
    ["清空待保存内容？", "Clear unsaved content?"],
    ["当前尚未保存的文字和图片会被移除，这项操作无法撤回。", "Unsaved text and images will be removed. This cannot be undone."],
    ["待保存内容已清空", "Unsaved content cleared"],
    ["框选已启动，请在网页中拖拽选择画面；按 Esc 取消。", "Region capture is active. Drag on the page to select an area; press Esc to cancel."],
    ["请切回网页拖动选择画面；按 Esc 或在这里取消。", "Return to the page and drag to select an area. Press Esc or cancel here."],
    ["不分组", "No project"],
    ["＋ 新建项目", "+ New project"],
    ["重新检查", "Check again"],
    ["米醋", "Micu"]
  ]);
  for (const [source, translation] of expected) assert.equal(translateForLocale(source, "en"), translation);
});

test("collector routes dynamic system text through the shared translation boundary", async () => {
  const [collector, background, library] = await Promise.all([
    readFile(new URL("../collector.js", import.meta.url), "utf8"),
    readFile(new URL("../background.js", import.meta.url), "utf8"),
    readFile(new URL("../library.js", import.meta.url), "utf8")
  ]);
  assert.match(collector, /const value = translateUiMessage\(message \|\| ""\)/);
  assert.match(collector, /item\.customized \? item\.name : t\(item\.name\)/);
  assert.match(collector, /translateUiMessage\(view\.summary\)/);
  assert.match(background, /name: item\.name, customized: item\.customized === true/);
  assert.match(library, /t\(reanalysisPreview \|\| maintenanceJob \? "重新检查" : "检查缺失项"\)/);
});

async function readJson(path) {
  return JSON.parse(await readFile(new URL(path, import.meta.url), "utf8"));
}
