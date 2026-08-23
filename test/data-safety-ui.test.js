import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("data safety lives inside general settings without a top-level entry", async () => {
  const html = await readFile(new URL("../library.html", import.meta.url), "utf8");
  const topbar = html.slice(html.indexOf('<header class="topbar">'), html.indexOf("</header>"));

  assert.doesNotMatch(topbar, /id="open-data-safety"|备份与同步/);
  assert.match(html, /id="data-safety-dialog"/);
  assert.equal((html.match(/data-i18n="备份与同步"/g) ?? []).length, 1);
  assert.doesNotMatch(topbar, /id="data-safety-status"/);
});

test("whole-library portable ZIP backup is removed while selected-case sharing remains", async () => {
  const background = await readFile(new URL("../background.js", import.meta.url), "utf8");
  assert.doesNotMatch(background, /case "CREATE_PORTABLE_BACKUP"/);
  assert.match(background, /case "EXPORT_ARCHIVE"/);
  const exporter = background.slice(background.indexOf("async function exportArchive"), background.indexOf("async function exportProjectArchive"));
  assert.match(exporter, /!Array\.isArray\(requestedEntryIds\) \|\| !requestedEntryIds\.length/);
  assert.doesNotMatch(exporter, /exportState\s*=\s*sharing\s*\?/);
});

test("connecting a sync folder immediately states that it only verifies access", async () => {
  const library = await readFile(new URL("../library.js", import.meta.url), "utf8");
  const actionBody = library.slice(
    library.indexOf("async function runDataSafetyAction"),
    library.indexOf("function showDataSafetyFeedback")
  );
  const sendIndex = actionBody.indexOf("await chrome.runtime.sendMessage(message)");
  const pendingIndex = actionBody.indexOf('showDataSafetyFeedback("正在验证文件夹与密码，不会读取或合并资料…")');

  assert.ok(pendingIndex >= 0, "连接同步时必须立即替换旧的备份或授权提示");
  assert.ok(pendingIndex < sendIndex, "验证文件夹前必须先显示准确状态");
  assert.match(actionBody, /button\.textContent\s*=\s*t\("正在连接…"\)/);
  assert.doesNotMatch(actionBody, /正在加密并写入同步文件夹|正在解锁并合并同步资料/);
});

test("a missing sync location shows a localized recovery action instead of the browser error", async () => {
  const library = await readFile(new URL("../library.js", import.meta.url), "utf8");
  const renderBody = library.slice(
    library.indexOf("async function renderDataSafetyStatus"),
    library.indexOf("async function chooseSyncFolder")
  );
  const statusBody = library.slice(
    library.indexOf("function syncStatusMessage"),
    library.indexOf("async function maybeShowRestoreOnboarding")
  );

  assert.match(renderBody, /SYNC_ERROR_CODES\.LOCATION_NOT_FOUND/);
  assert.match(renderBody, /elements\.syncSettings\.open\s*=\s*true/);
  assert.match(renderBody, /"重新选择同步文件夹"/);
  assert.match(statusBody, /t\("同步文件夹中的文件或目录不存在，请重新选择同步文件夹后再同步"\)/);
  assert.doesNotMatch(statusBody, /return status\.lastErrorCode/);
});

test("share-package import is separate from the two backup actions while sync stays collapsed", async () => {
  const html = await readFile(new URL("../library.html", import.meta.url), "utf8");
  const panel = html.slice(
    html.indexOf('<section id="data-safety-dialog"'),
    html.indexOf('<footer class="settings-about"')
  );

  assert.match(panel, /id="create-folder-backup"[^>]*>备份资料库/);
  assert.match(panel, /id="restore-folder-backup"[^>]*>恢复资料库/);
  assert.match(panel, /class="share-package-import"/);
  assert.match(panel, /id="import-library-package"[^>]*>选择 ZIP/);
  assert.match(panel, /id="library-package-file"[^>]*accept="\.zip,application\/zip"/);
  assert.doesNotMatch(panel, /create-portable-backup|restore-portable-backup|小型 ZIP|从 ZIP/);
  assert.match(panel, /<details id="sync-settings"/);
  assert.match(panel, /<summary[^>]*data-i18n="跨设备同步"/);
  assert.equal((panel.match(/class="data-safety-primary-actions"/g) ?? []).length, 1);
  const primaryActions = panel.slice(panel.indexOf('class="data-safety-primary-actions"'), panel.indexOf('<details id="sync-settings"'));
  assert.equal((primaryActions.match(/<button\b/g) ?? []).length, 2, "资料库备份与恢复只能保留两个常驻动作");
});

test("share-package import preserves local configuration and accepts historical package versions", async () => {
  const library = await readFile(new URL("../library.js", import.meta.url), "utf8");
  const parser = await readFile(new URL("../library-package.js", import.meta.url), "utf8");
  const format = await readFile(new URL("../library-package-format.js", import.meta.url), "utf8");
  const action = library.slice(
    library.indexOf("async function importSharedLibraryPackage"),
    library.indexOf("function backupMediaPaths")
  );
  assert.match(action, /PREVIEW_LIBRARY_IMPORT/);
  assert.match(action, /APPLY_LIBRARY_IMPORT/);
  assert.equal((action.match(/preserveLibraryConfiguration:\s*true/g) ?? []).length, 2);
  assert.match(parser, /isSupportedLibraryPackageVersion\(value\.version\)/);
  assert.match(format, /SUPPORTED_LIBRARY_PACKAGE_VERSIONS\s*=\s*Object\.freeze\(\[1, 2, 3, 4\]\)/);
});

test("data safety cannot be dismissed accidentally while a storage operation is running", async () => {
  const library = await readFile(new URL("../library.js", import.meta.url), "utf8");
  const bindings = library.slice(
    library.indexOf("elements.settingsClose.addEventListener"),
    library.indexOf("elements.connectSyncFolder.addEventListener")
  );

  assert.match(bindings, /elements\.settingsDialog\.addEventListener\("cancel"/);
  assert.match(bindings, /dataSafetyOperationActive[^\n]*event\.preventDefault\(\)/);
  assert.match(library, /elements\.settingsClose\.disabled\s*=\s*active/);
});
