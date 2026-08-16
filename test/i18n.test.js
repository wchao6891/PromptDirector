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
  for (const path of ["../collector.html", "../library.html", "../composer.html", "../skills.html", "../curated.html"]) {
    const html = await readFile(new URL(path, import.meta.url), "utf8");
    const keys = [...html.matchAll(/data-i18n(?:-placeholder|-aria-label|-title)?="([^"]+)"/g)].map((match) => match[1]);
    const missing = [...new Set(keys.filter((key) => !hasEnglishTranslation(key)))];
    assert.deepEqual(missing, [], `${path} has untranslated keys`);
  }
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

async function readJson(path) {
  return JSON.parse(await readFile(new URL(path, import.meta.url), "utf8"));
}
