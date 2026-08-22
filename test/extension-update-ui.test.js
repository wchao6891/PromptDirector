import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const root = new URL("../", import.meta.url);
const [html, css, source] = await Promise.all([
  readFile(new URL("library.html", root), "utf8"),
  readFile(new URL("library.css", root), "utf8"),
  readFile(new URL("library.js", root), "utf8")
]);

test("about settings expose status and state-specific update actions", () => {
  const about = html.slice(html.indexOf('<footer class="settings-about">'), html.indexOf("</footer>", html.indexOf('<footer class="settings-about">')));
  assert.match(about, /id="about-version"/);
  assert.match(about, /id="update-channel"/);
  assert.match(about, /id="update-checked-at"/);
  assert.match(about, /id="update-available-version"/);
  assert.match(about, /id="check-extension-update"/);
  assert.match(about, /id="apply-extension-update"/);
  assert.match(about, /id="update-release-link"/);
  assert.match(source, /"应用更新并重启"/);
  assert.match(source, /"重新载入目录"/);
  assert.match(about, /class="button-primary update-download-action"[^>]*hidden>下载新版本/);
  assert.match(css, /\.settings-update-actions/);
});

test("green actions are visible only for a real store or development update", () => {
  const render = source.slice(source.indexOf("function renderExtensionUpdateStatus"), source.indexOf("function updateStatusDisplay"));
  assert.match(render, /updateReleaseLink\.hidden = !releaseUrl/);
  assert.match(render, /applyExtensionUpdate\.hidden = !status\.canApply/);
  assert.match(render, /classList\.toggle\("button-secondary", development\)/);
  assert.match(render, /development && status\.updateAvailable/);
  assert.match(source, /settingsUpdateBadge\.hidden = !hasUpdate/);
});

test("update UI uses the background lifecycle protocol and refresh event", () => {
  assert.match(source, /type: "GET_EXTENSION_UPDATE_STATUS"/);
  assert.match(source, /type: "CHECK_EXTENSION_UPDATE"/);
  assert.match(source, /type: "APPLY_EXTENSION_UPDATE"/);
  assert.match(source, /message\?\.type !== "EXTENSION_UPDATE_STATUS_CHANGED"/);
  assert.match(source, /renderExtensionUpdateStatus\(message\.status\)/);
});

test("development update wording never claims the extension installs or overwrites local code", () => {
  const explanation = source.slice(source.indexOf("function updateExplanation"), source.indexOf("function updateCheckFeedback"));
  assert.match(explanation, /扩展无法自行覆盖本机目录/);
  assert.match(explanation, /安全重载只会重新载入当前目录，不会下载或安装新版本/);
  assert.match(explanation, /固定 ID 升级无需导出、导入案例/);
  assert.doesNotMatch(explanation, /一键安装|自动覆盖本地代码/);
});

test("applying a downloaded store update discloses that the page closes but library data remains", () => {
  const applyFlow = source.slice(source.indexOf("async function applyExtensionUpdate"), source.indexOf("function renderExtensionUpdateStatus"));
  assert.match(applyFlow, /当前资料库页面会关闭/);
  assert.match(applyFlow, /本地案例和素材不会丢失|案例和素材不会丢失/);
  assert.match(applyFlow, /confirmAppAction/);
  assert.match(applyFlow, /applyBehavior === "reload_development_directory"/);
});

test("the settings entry uses a low-interruption update badge", () => {
  assert.match(html, /id="settings-update-badge"[^>]*hidden/);
  assert.match(css, /\.settings-update-badge/);
  assert.match(source, /settingsUpdateBadge\.hidden = !hasUpdate/);
  assert.match(source, /设置，有可用更新/);
});
