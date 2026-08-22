import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const [html, source] = await Promise.all([
  readFile(new URL("../library.html", import.meta.url), "utf8"),
  readFile(new URL("../library.js", import.meta.url), "utf8")
]);

test("local index maintenance explains its result and has no decorative progress bar", () => {
  const card = html.slice(html.indexOf('<div class="batch-card local-index-card">'), html.indexOf('id="legacy-candidates"'));
  assert.match(card, /补全资料索引/);
  assert.match(card, /补齐导入案例的内容类型和图片色卡，用于分类筛选、颜色展示和相似资料匹配；全程在本机运行，不调用 AI。/);
  assert.match(card, /id="preview-reanalyze"[^>]*>检查缺失项/);
  assert.match(card, /id="apply-reanalyze"[^>]*hidden>开始补全/);
  assert.doesNotMatch(card, /<progress|maintenance-progress/);
});

test("local index maintenance exposes checked, running, complete, and failed text states", () => {
  const manager = source.slice(source.indexOf("function renderBatchManager"), source.indexOf("function renderAnalysisSettings"));
  const status = source.slice(source.indexOf("function renderReanalysisPreview"), source.indexOf("function updateLibrarySettingsSaveState"));
  assert.match(manager, /reanalysisPreview \|\| maintenanceJob \? "重新检查" : "检查缺失项"/);
  assert.match(manager, /elements\.applyReanalyze\.hidden = maintenanceActive \|\| !maintenanceMissing/);
  assert.match(status, /资料索引已完整/);
  assert.match(status, /待补全：\$\{reanalysisPreview\.confirmed\} 条内容类型，\$\{reanalysisPreview\.paletteCount\} 张图片色卡/);
  assert.match(status, /已处理 \$\{maintenanceJob\.processed\}\/\$\{maintenanceJob\.total\}/);
  assert.match(status, /成功 \$\{maintenanceJob\.succeeded\} · 失败 \$\{maintenanceJob\.failed\}/);
});
