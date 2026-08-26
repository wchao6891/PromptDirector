import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const js = await readFile(new URL("../library.js", import.meta.url), "utf8");
const html = await readFile(new URL("../library.html", import.meta.url), "utf8");
const css = await readFile(new URL("../library.css", import.meta.url), "utf8");

test("modern file and folder pickers preserve handles and relative paths before falling back", () => {
  assert.match(js, /showOpenFilePicker\(\{ multiple: true \}\)/);
  assert.match(js, /showDirectoryPicker\(\{ mode: "read" \}\)/);
  assert.match(js, /readImportDirectoryHandle\(root, root\.name\)/);
  assert.match(js, /\{\s*handle,\s*file:\s*await handle\.getFile\(\),\s*relativePath/);
  assert.match(js, /elements\.mediaFile\.click\(\)/);
  assert.match(js, /elements\.mediaFolder\.click\(\)/);
  assert.match(js, /getAsFileSystemHandle/);
});

test("unsupported failures can become inert persistent local references", () => {
  assert.match(js, /ASSET_IMPORT_FAILURE_CODES\.UNSUPPORTED_FORMAT/);
  assert.match(js, /"保留本机链接"/);
  assert.match(js, /createUnsupportedLocalAssetReference\(file, assetId/);
  assert.match(js, /saveLocalAssetHandle\(assetId, handle, file\)/);
  assert.match(js, /recordType:\s*reference\.recordType/);
  assert.match(js, /sourceLastModified:\s*file\.lastModified/);
  assert.match(js, /deleteLocalAssetHandle\(item\.assetId\)/);
});

test("audio and creative source files have useful card and detail surfaces", () => {
  const card = js.slice(js.indexOf("function createCaseCard"), js.indexOf("async function reorderProjectCase"));
  const viewer = js.slice(js.indexOf("async function createMediaViewer"), js.indexOf("async function loadRemoteMarkdownImage"));
  assert.match(card, /createAudioCaseCover/);
  assert.match(card, /createSourceFileCaseCover/);
  assert.match(js, /case-audio-player/);
  assert.match(viewer, /asset\.kind === "audio"/);
  assert.match(viewer, /audio\.controls = true/);
  assert.match(viewer, /asset\.kind === "attachment"/);
  assert.match(viewer, /不会执行或内嵌打开/);
  assert.match(viewer, /下载本机副本/);
  assert.match(js, /formatMediaTime\(asset\.durationMs\)/);
  assert.match(js, /formatBytes\(asset\.byteSize\)/);
  assert.match(css, /\.detail-audio-wrap/);
  assert.match(css, /\.detail-source-file/);
});

test("local reference details report state and require explicit user actions", () => {
  const viewer = js.slice(js.indexOf("async function createLocalAssetReferenceViewer"), js.indexOf("async function createReferencedMediaViewer"));
  assert.match(viewer, /inspectLocalAssetHandle/);
  assert.match(viewer, /重新授权读取/);
  assert.match(viewer, /重新链接源文件/);
  assert.match(viewer, /UPDATE_LOCAL_ASSET_REFERENCE/);
  assert.match(viewer, /只保存文件信息与本机授权/);
  assert.doesNotMatch(viewer, /createElement\("iframe"\)|createElement\("script"\)|innerHTML/);
});

test("share export checks every linked source and stops when permission is canceled", () => {
  const exportFlow = js.slice(js.indexOf("async function prepareShareLocalAssetRecords"), js.indexOf("async function submitFromShareDialog"));
  assert.match(exportFlow, /getLocalAssetHandleRecord/);
  assert.match(exportFlow, /requestPermission\(\{ mode: "read" \}\)/);
  assert.match(exportFlow, /if \(!await authorizeShareLocalAssets\(\)\)/);
  assert.match(exportFlow, /分享包未导出/);
  assert.match(exportFlow, /源文件自上次链接后发生变化/);
  assert.match(exportFlow, /UPDATE_LOCAL_ASSET_REFERENCE/);
});

test("project share preflight uses the same compound-complete member selection as packaging", () => {
  assert.match(js, /projectPackageEntryIds\(\{ entries, compoundCases, organizerState \}, context\.collectionId\)/u);
});

test("share package import sizes only this user-selected package by its real file size", () => {
  const imported = js.slice(js.indexOf("async function importSharedLibraryPackage"), js.indexOf("function backupMediaPaths"));
  assert.match(imported, /maxArchiveBytes:\s*file\.size/);
  assert.match(imported, /maxFileBytes:\s*file\.size/);
  assert.match(imported, /maxImageBytes:\s*file\.size/);
  assert.match(imported, /readZipBlob\(file, packageLimits\)/);
  assert.match(imported, /salvageOptions = \{ \.\.\.packageLimits, salvageInvalidMedia: true \}/);
  assert.match(imported, /parseLibraryPackage\(library, files, salvageOptions\)/);
});

test("complete folder restore derives its media budget from the selected verified backup", () => {
  const restore = js.slice(js.indexOf("async function restoreCompleteFolderBackup"), js.indexOf("async function importSharedLibraryPackage"));
  assert.match(restore, /largestMediaBytes = Math\.max\(1, \.\.\.backupMediaSizes\)/);
  assert.match(restore, /maxFileBytes: largestMediaBytes/);
  assert.match(restore, /maxImageBytes: largestMediaBytes/);
  assert.match(restore, /maxVideoBytes: largestMediaBytes/);
  assert.match(restore, /parseCompleteFolderBackup\(library, files, restoreLimits\)/);
  assert.doesNotMatch(restore, /maxFileBytes: Number\.MAX_SAFE_INTEGER/);
});

test("import copy tells creators that unsupported formats can remain linked", () => {
  assert.match(html, /不支持的格式仍可保留本机链接/);
});
