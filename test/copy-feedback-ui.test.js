import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const library = await readFile(new URL("../library.js", import.meta.url), "utf8");
const libraryHtml = await readFile(new URL("../library.html", import.meta.url), "utf8");
const composerHtml = await readFile(new URL("../composer.html", import.meta.url), "utf8");
const collectorHtml = await readFile(new URL("../collector.html", import.meta.url), "utf8");
const i18n = await readFile(new URL("../i18n.js", import.meta.url), "utf8");
const styles = await readFile(new URL("../library.css", import.meta.url), "utf8");
const background = await readFile(new URL("../background.js", import.meta.url), "utf8");
const markdown = await readFile(new URL("../lib.js", import.meta.url), "utf8");
const preview = await readFile(new URL("../share-preview.js", import.meta.url), "utf8");

test("library clipboard actions show feedback on the clicked button", () => {
  const clipboardCalls = [...library.matchAll(/navigator\.clipboard\.writeText/g)];
  assert.equal(clipboardCalls.length, 1);
  assert.match(library, /async function copyTextWithFeedback\(/);
  assert.match(library, /button\.textContent = t\("已复制"\)/);
  assert.ok([...library.matchAll(/copyTextWithFeedback\(/g)].length >= 3);
});

test("library feedback remains visible above the detail drawer", () => {
  assert.match(styles, /#feedback\s*\{[^}]*position:\s*fixed/s);
  assert.match(styles, /#feedback:empty\s*\{[^}]*display:\s*none/s);
});

test("library error feedback clears after a readable delay instead of staying forever", () => {
  assert.match(library, /const ERROR_FEEDBACK_DURATION_MS = 8000/);
  assert.match(library, /isError \? ERROR_FEEDBACK_DURATION_MS : FEEDBACK_DURATION_MS/);
});

test("routine save feedback does not explain that AI was unnecessary", () => {
  const interfaceCopy = [library, libraryHtml, composerHtml, collectorHtml, i18n].join("\n");
  assert.doesNotMatch(interfaceCopy, /不需要等待 AI|不请求 AI，不播放轮播动画|这里不会导入创作标签|不会产生人工确认任务|普通结果关联无需开启|应用前不会改变当前对话|只用于你自己的查找和整理/);
  assert.doesNotMatch(background, /不需要等待 AI|可立即离线打开/);
  assert.doesNotMatch(markdown, /可供本地 AI 或 Skill 检索|Confirmed creative attributes and suggestions awaiting review/);
  assert.doesNotMatch(preview, /语言和主题切换只在此页面运行|Language and theme controls run only on this page/);
});
