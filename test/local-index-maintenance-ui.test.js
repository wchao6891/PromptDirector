import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const [html, source, background] = await Promise.all([
  readFile(new URL("../library.html", import.meta.url), "utf8"),
  readFile(new URL("../library.js", import.meta.url), "utf8"),
  readFile(new URL("../background.js", import.meta.url), "utf8")
]);

test("local index maintenance explains automatic local completion and has no decorative progress bar", () => {
  const card = html.slice(html.indexOf('<div class="batch-card local-index-card">'), html.indexOf('id="legacy-candidates"'));
  assert.match(card, /资料索引自动补全/);
  assert.match(card, /每次导入后会在本机自动补齐内容类型和图片色卡，不调用 AI/);
  assert.match(card, /id="preview-reanalyze"[^>]*>检查缺失项/);
  assert.match(card, /id="apply-reanalyze"[^>]*hidden[^>]*>开始补全/);
  assert.doesNotMatch(card, /<progress|maintenance-progress/);
});

test("local index maintenance exposes checked, running, complete, and failed text states", () => {
  const manager = source.slice(source.indexOf("function renderBatchManager"), source.indexOf("function renderAnalysisSettings"));
  const status = source.slice(source.indexOf("function renderReanalysisPreview"), source.indexOf("function updateLibrarySettingsSaveState"));
  assert.match(manager, /t\(reanalysisPreview \|\| maintenanceJob \? "重新检查" : "检查缺失项"\)/);
  assert.match(manager, /elements\.applyReanalyze\.hidden = maintenanceActive \|\| !maintenanceMissing/);
  assert.match(status, /资料索引已完整/);
  assert.match(status, /t\("需要更新索引：\{types\} 条内容类型，\{palettes\} 张图片色卡。"/);
  assert.doesNotMatch(status, /待补全/);
  assert.match(status, /t\("\{status\} · 已处理 \{processed\}\/\{total\} · 成功 \{succeeded\} · 失败 \{failed\}"/);
  assert.match(status, /processed: maintenanceJob\.processed/);
  assert.match(status, /succeeded: maintenanceJob\.succeeded/);
});

test("every material import queues local index completion without coupling it to AI", () => {
  const localImport = background.slice(background.indexOf("async function importStagedItem"), background.indexOf("function importedEntryFromStagedAsset"));
  const packageImport = background.slice(background.indexOf("async function applyLibraryImport"), background.indexOf("function previewCuratedImport"));
  const curatedImport = background.slice(background.indexOf("async function applyCuratedImport"), background.indexOf("function curatedImportResponse"));
  const automaticCompletion = background.slice(background.indexOf("async function enqueueAutomaticLibraryMaintenance"), background.indexOf("async function libraryMaintenanceStatus"));

  assert.match(localImport, /enqueueAutomaticLibraryMaintenance\(\[entry\]\)/);
  assert.match(packageImport, /enqueueAutomaticLibraryMaintenance/);
  assert.match(curatedImport, /enqueueAutomaticLibraryMaintenance/);
  assert.match(automaticCompletion, /libraryMaintenanceTargets/);
  assert.doesNotMatch(automaticCompletion, /Vision|AI|queueAutomaticVisionAnalysis/);
});
