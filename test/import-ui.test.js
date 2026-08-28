import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const html = await readFile(new URL("../library.html", import.meta.url), "utf8");
const css = await readFile(new URL("../library.css", import.meta.url), "utf8");
const js = await readFile(new URL("../library.js", import.meta.url), "utf8");
const tagEditor = await readFile(new URL("../tag-editor.js", import.meta.url), "utf8");

function rule(source, selector) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return source.match(new RegExp(`(?:^|\\n)\\s*${escaped}\\s*\\{([^}]+)\\}`))?.[1] ?? "";
}

test("add menu has one local import entry and the import dialog chooses files or folders", () => {
  const actions = html.slice(html.indexOf('<div class="top-actions">'), html.indexOf("</header>"));
  assert.match(actions, /id="add-media"/);
  assert.match(actions, /导入本机资料/);
  assert.doesNotMatch(actions, /id="add-folder"|id="open-import-job"|最近导入/);
  assert.match(actions, /id="media-file"[^>]*type="file"[^>]*multiple/);
  assert.match(actions, /id="media-folder"[^>]*type="file"[^>]*multiple[^>]*webkitdirectory/);
  assert.doesNotMatch(actions, /id="media-file"[^>]*accept=/);
  assert.match(js, /LOCAL_ASSET_FILE_ACCEPT/);
  assert.match(js, /mediaFile\.accept\s*=\s*LOCAL_ASSET_FILE_ACCEPT/);
  assert.match(js, /mediaFolder\.accept\s*=\s*LOCAL_ASSET_FILE_ACCEPT/);
  const source = html.slice(html.indexOf('id="import-source"'), html.indexOf('id="import-preparing"'));
  assert.match(source, /class="import-drop-zone"/);
  assert.match(source, /拖入文件或文件夹/);
  assert.match(source, /id="import-choose-files"/);
  assert.match(source, /自动识别图片、视频、音频、字幕、文档和常用创作源文件/);
  assert.match(source, /id="add-folder"/);
  assert.match(source, /选择整个文件夹/);
  assert.match(source, /class="import-folder-link"/);
  assert.match(source, /id="import-last-job"[^>]*hidden[^>]*>上次导入 · 查看/);
});

test("local import dialog includes drag target, confirmation summary, project assignment, auto-analyze, and job controls", () => {
  const confirmation = html.slice(html.indexOf('id="import-confirmation"'), html.indexOf('id="import-job-panel"'));
  assert.match(html, /id="library-drop-target"/);
  assert.match(html, /松开以检查本机资料/);
  assert.match(html, /id="import-dialog"/);
  assert.match(html, /id="import-source"/);
  assert.match(html, /id="import-preparing"/);
  assert.match(html, /id="import-confirmation"/);
  assert.match(html, /id="import-supported-count"/);
  assert.match(html, /id="import-skipped-count"/);
  assert.match(html, /id="import-duplicate-count"/);
  assert.match(html, /id="import-byte-size"/);
  assert.match(html, /id="import-project"/);
  assert.match(html, /选择已有项目或输入新项目名/);
  assert.doesNotMatch(html, /<datalist/);
  assert.match(js, /attachProjectCombobox\(elements\.importProject/);
  assert.match(html, /id="import-label-editor"/);
  assert.match(html, /添加标签/);
  assert.doesNotMatch(confirmation, /自由标签|可选|可以直接输入资料库里没有的新标签/);
  assert.match(html, /id="import-auto-analyze"/);
  assert.match(html, /导入后自动画面分析/);
  assert.match(html, /id="import-file-list"/);
  assert.match(html, /id="import-job-panel"/);
  assert.match(html, /id="import-job-progress"/);
  assert.match(html, /id="import-cancel"/);
  assert.match(html, /id="import-retry"/);
  assert.match(html, /id="import-undo"/);
  assert.match(html, /id="import-start"/);
});

test("local import layout keeps summary, options, progress, and mobile stacking rules explicit", () => {
  const dropTarget = rule(css, ".library-drop-target");
  const dropTargetCard = rule(css, ".library-drop-target > div");
  const summary = rule(css, ".import-summary");
  const options = rule(css, ".import-options");
  const progress = rule(css, ".import-job-panel progress");
  const labelEditor = rule(css, ".import-label-editor");
  const dropZone = rule(css, ".import-drop-zone");
  const folderLink = rule(css, ".import-drop-zone .import-folder-link");
  const mobile = css.slice(css.indexOf("@media (max-width: 640px)"));
  const tiny = css.slice(css.indexOf("@media (max-width: 390px)"));

  assert.match(dropTarget, /position:\s*fixed/);
  assert.match(dropTarget, /display:\s*grid/);
  assert.match(dropTargetCard, /border:\s*1px dashed/);
  assert.match(dropZone, /border:\s*1px dashed/);
  assert.match(folderLink, /background:\s*transparent/);
  assert.match(summary, /grid-template-columns:\s*repeat\(4,\s*minmax\(0,\s*1fr\)\)/);
  assert.match(options, /grid-template-columns:\s*minmax\(0,\s*1fr\)\s+auto/);
  assert.match(progress, /width:\s*100%/);
  assert.match(labelEditor, /min-width:\s*0/);
  assert.match(tagEditor, /tag-editor-chips/);

  assert.match(mobile, /\.import-summary\s*\{[^}]*grid-template-columns:\s*1fr 1fr/);
  assert.match(mobile, /\.import-options\s*\{[^}]*grid-template-columns:\s*1fr/);
  assert.match(mobile, /\.data-safety-actions\.import-actions\s*\{[^}]*position:\s*sticky/);

  assert.match(tiny, /\.import-summary\s*\{[^}]*grid-template-columns:\s*1fr/);
});

test("file picker folder picker and document drop share one import confirmation flow", () => {
  assert.match(js, /mediaFile\.addEventListener\("change",\s*importLocalMediaCases\)/);
  assert.match(js, /mediaFolder\.addEventListener\("change",\s*importLocalMediaFolder\)/);
  assert.match(js, /document\.addEventListener\("drop",\s*handleLibraryDrop\)/);
  assert.match(js, /prepareLocalImport\(files,\s*\{\s*source:\s*"files"\s*\}\)/);
  assert.match(js, /prepareLocalImport\(files,\s*\{\s*source:\s*"folder"\s*\}\)/);
  assert.match(js, /prepareLocalImport\(items,\s*\{\s*source:\s*items\.some/);
});

test("duplicate choice and import start preserve the complete background job contract", () => {
  assert.match(js, /keepDuplicate:\s*false/);
  assert.match(js, /item\.keepDuplicate\s*=\s*keep\.checked/);
  assert.match(js, /type:\s*"START_IMPORT_JOB"/);
  assert.match(js, /collectionId,/);
  assert.match(js, /customLabels:\s*\[\.\.\.\(pendingLocalImport\.customLabels\s*\?\?\s*\[\]\)\]/);
  assert.match(js, /stagedAssets:\s*pendingLocalImport\.stagedAssets/);
  assert.match(js, /storageMode:\s*prepared\.asset\.storageMode/);
  assert.match(js, /sourceFormat:\s*prepared\.asset\.sourceFormat\s*\|\|\s*prepared\.sourceFormat/);
  assert.match(js, /formatCategory:\s*prepared\.asset\.formatCategory/);
  assert.match(js, /stagedAssetId:\s*item\.id/);
  assert.match(js, /keepDuplicate:\s*item\.keepDuplicate\s*===\s*true/);
  assert.match(js, /options:\s*\{\s*autoAnalyze:\s*elements\.importAutoAnalyze\.checked\s*===\s*true\s*\}/);
  assert.match(js, /elements\.importAutoAnalyze\.checked\s*=\s*false/);
});

test("project suggestions stay editable and import uses the shared multi-tag editor", () => {
  assert.match(js, /importProjectCombobox\.setProjects\(projectComboboxCollections\(\)\)/);
  assert.match(js, /importProjectCombobox\.setSelected\(selectedProject\.id\)/);
  assert.match(js, /item\.id === elements\.importProject\.dataset\.projectId/);
  assert.doesNotMatch(js, /collectionPathLabel\(organizerState, item\.id\)\.toLocaleLowerCase\(\) === projectName/);
  assert.match(js, /已按根文件夹建议项目；可以修改或清空/);
  assert.match(js, /const importTagEditor = createTagEditor/);
  assert.match(js, /pendingLocalImport\.customLabels\s*=\s*values/);
  assert.match(tagEditor, /\["Enter", ",", "，"\]\.includes\(event\.key\)/);
  assert.match(tagEditor, /删除标签/);
  assert.match(js, /type:\s*"CREATE_COLLECTION",\s*name:\s*projectName/);
});

test("per-file failures always show their reason and only offer force import for a real capability", () => {
  assert.match(js, /importFailureDetails\(error\)/);
  assert.match(js, /const\s+\{\s*code,\s*message,\s*forceAllowed,\s*\.\.\.details\s*\}\s*=\s*failure/);
  assert.match(js, /code\s*===\s*ASSET_IMPORT_FAILURE_CODES\.TOO_LARGE\s*&&\s*\(forceAllowed\s*\|\|\s*error\?\.canForceImport\s*===\s*true\)/);
  assert.match(js, /item\.code\s*===\s*ASSET_IMPORT_FAILURE_CODES\.TOO_LARGE[\s\S]*?item\.forceAllowed\s*===\s*true[\s\S]*?item\.file\s*instanceof\s*Blob/);
  assert.match(js, /"import-file-reason",\s*item\.reason/);
  assert.match(js, /"强制导入"/);
  assert.match(js, /forceImport:\s*true/);
  const wrapper = js.slice(js.indexOf("async function prepareLocalMedia"), js.indexOf("async function readDocumentText"));
  assert.match(wrapper, /forceImport:\s*options\.forceImport\s*===\s*true/);
});

test("active import restoration and every terminal job action stay wired", () => {
  assert.match(js, /await resumeImportJob\(\)/);
  assert.match(js, /type:\s*"GET_IMPORT_JOB"/);
  assert.match(js, /type:\s*"CANCEL_IMPORT_JOB"/);
  assert.match(js, /type:\s*"RETRY_IMPORT_JOB"/);
  assert.match(js, /type:\s*"UNDO_IMPORT_JOB"/);
  assert.match(js, /importViewProject\.addEventListener\("click",\s*viewImportedProject\)/);
  assert.match(js, /importLastJob\.addEventListener\("click",\s*\(\) => void openLatestImportJob\(\)\)/);
  assert.match(js, /importLastJob\.hidden\s*=\s*!latestImportJob/);
  assert.match(js, /selectedCollectionId\s*=\s*collectionId;[\s\S]*?renderGallery\(\);[\s\S]*?importDialog\.close\(\)/);
});

test("folder restore and ZIP import retry one response loss with the same operation receipt", () => {
  assert.match(js, /function createLibraryImportOperationId/);
  assert.match(js, /async function applyLibraryImportWithReceipt/);
  assert.equal(js.match(/const operationId\s*=\s*createLibraryImportOperationId\(\)/g)?.length, 2);
  assert.equal(js.match(/applyLibraryImportWithReceipt\(\{[\s\S]{0,180}?operationId,/g)?.length, 2);
  assert.match(js, /await chrome\.runtime\.sendMessage\(message\)[\s\S]*await chrome\.runtime\.sendMessage\(message\)/);
});

test("shared ZIP and degraded folders salvage individual failures while verified folders stay strict", () => {
  const sharedImport = js.slice(js.indexOf("async function importSharedLibraryPackage"), js.indexOf("function createLibraryImportOperationId"));
  const folderRestore = js.slice(js.indexOf("async function restoreCompleteFolderBackup"), js.indexOf("async function importSharedLibraryPackage"));
  assert.match(sharedImport, /inspectLibraryTransfer\(\{[\s\S]*?sourceType:\s*LIBRARY_TRANSFER_SOURCES\.SHARE_PACKAGE/);
  assert.match(folderRestore, /sourceType:\s*envelope\.mode === "complete"[\s\S]*LIBRARY_TRANSFER_SOURCES\.COMPLETE_BACKUP[\s\S]*LIBRARY_TRANSFER_SOURCES\.RESCUE_BACKUP/);
  assert.match(folderRestore, /inspectFolderBackupEnvelope\(files\)/);
  assert.match(folderRestore, /sourceReport:\s*envelope\.report/);
  assert.match(sharedImport, /validateImage:\s*validateImportedImage/);
  assert.match(folderRestore, /validateImage:\s*validateImportedImage/);
  assert.doesNotMatch(sharedImport, /parseLibraryPackage|findInvalidImportedImageIds|filesWithoutInvalidEntryMedia/);
});

test("a committed import never deletes restored non-case media during later UI refresh failure", () => {
  assert.equal(js.match(/let applySucceeded\s*=\s*false/g)?.length, 2);
  assert.equal(js.match(/applySucceeded\s*=\s*true/g)?.length, 2);
  assert.match(js, /creativeRuns[\s\S]*composerSessions[\s\S]*trashState/);
  assert.match(js, /applySucceeded\s*\?\s*new Set\(savedIds\)/);
});
