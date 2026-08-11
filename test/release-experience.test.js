import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const pageScripts = ["library.js", "composer-page.js", "skills-page.js", "collector.js", "curated-page.js"];

test("ordinary product pages use the shared branded dialog instead of browser prompts", async () => {
  for (const filename of pageScripts) {
    const source = await readFile(new URL(`../${filename}`, import.meta.url), "utf8");
    assert.doesNotMatch(source, /\b(?:window\.)?(?:prompt|confirm|alert)\s*\(/, `${filename} 不能调用系统弹窗`);
  }

  const dialogs = await readFile(new URL("../ui-dialogs.js", import.meta.url), "utf8");
  const foundation = await readFile(new URL("../ui-foundation.css", import.meta.url), "utf8");
  assert.match(dialogs, /export async function showAppDialog/);
  assert.match(dialogs, /export async function confirmAppAction/);
  assert.match(dialogs, /export async function promptAppText/);
  assert.match(foundation, /\.app-dialog::backdrop/);
  assert.match(foundation, /\.app-dialog-status\.error/);
});

test("video links and quick notes each use a purpose-built one-step form", async () => {
  const library = await readFile(new URL("../library.js", import.meta.url), "utf8");
  const video = library.slice(library.indexOf("async function addVideoReference"), library.indexOf("async function saveVideoReference"));
  const note = library.slice(library.indexOf("async function createQuickNote"), library.indexOf("async function prepareLocalMedia"));

  assert.match(video, /showAppDialog\(\{/);
  assert.match(video, /title:\s*"添加视频链接"/);
  assert.match(video, /type:\s*"url"/);
  assert.match(video, /pendingLabel:\s*"正在解析链接并保存…"/);
  assert.match(note, /showAppDialog\(\{/);
  assert.match(note, /type:\s*"textarea"/);
  assert.match(note, /onSubmit:/);
});

test("general settings expose one change-aware save action without a save rollback", async () => {
  const html = await readFile(new URL("../library.html", import.meta.url), "utf8");
  const panel = html.slice(html.indexOf('id="settings-general-panel"'), html.indexOf('id="settings-tasks-panel"'));

  assert.equal((panel.match(/id="save-library-settings"/g) ?? []).length, 1);
  assert.match(panel, /id="save-library-settings"[^>]*disabled/);
  assert.doesNotMatch(panel, /撤回刚才保存|undo-last-save/);
});

test("the selected toolbar mark has one lime SVG master and matching manifest PNG sizes", async () => {
  const svg = await readFile(new URL("../assets/icons/icon-source.svg", import.meta.url), "utf8");
  const manifest = JSON.parse(await readFile(new URL("../manifest.json", import.meta.url), "utf8"));

  assert.match(svg, /fill="#D1FE17"/);
  assert.match(svg, /fill="#0F1113"/);
  assert.doesNotMatch(svg, /#20D477|#55CD8B/i);
  assert.deepEqual(manifest.icons, {
    16: "assets/icons/icon-16.png",
    32: "assets/icons/icon-32.png",
    48: "assets/icons/icon-48.png",
    128: "assets/icons/icon-128.png"
  });
  const pages = await Promise.all(["library.html", "collector.html", "composer.html", "skills.html"]
    .map((name) => readFile(new URL(`../${name}`, import.meta.url), "utf8")));
  for (const page of pages) assert.match(page, /assets\/icons\/icon-source\.svg/);
  const { stdout } = await execFileAsync(process.execPath, ["tools/build-brand-icons.mjs", "--check"], {
    cwd: new URL("..", import.meta.url)
  });
  assert.match(stdout, /已核对 4 个品牌图标/);
});
