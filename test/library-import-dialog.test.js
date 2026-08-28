import test from "node:test";
import assert from "node:assert/strict";

import { buildLibraryImportReport } from "../library-import-dialog.js";

test("import report separates created, identical, repaired, and skipped results", () => {
  const report = buildLibraryImportReport({
    importedCount: 8,
    skippedCount: 3,
    remappedCount: 2,
    importedSkillCount: 1,
    importStats: {
      inputCases: 13,
      keptCases: 12,
      skippedCases: 1,
      droppedAiAssignments: 4,
      droppedMediaDescriptors: 1,
      droppedMediaFiles: 2
    }
  }, { mediaCount: 7, byteLabel: "18 MB" });

  assert.equal(report.status, "partial");
  assert.match(report.summary, /可导入 8 个新案例/);
  assert.deepEqual(report.lines, [
    "完全相同，跳过 3 个",
    "同一来源有新内容，保留副本 2 个",
    "丢弃损坏的 AI 标签 4 条",
    "丢弃损坏的媒体描述 1 条",
    "丢弃损坏或缺失的媒体 2 项",
    "跳过无法恢复的案例 1 个",
    "恢复 1 个 Skill、7 项本地文件（18 MB）"
  ]);
  assert.equal(report.autoAnalysisNotice, "导入不会自动启动 AI 分析");
});

test("rescue report makes degraded integrity and ignored extra files visible before confirmation", () => {
  const report = buildLibraryImportReport({
    importedCount: 2,
    importDiagnostics: [
      { code: "backup_integrity_degraded", reason: "missing_complete_marker" },
      { code: "extra_file_ignored", path: "unlisted.txt" }
    ],
    importStats: {}
  });

  assert.equal(report.status, "partial");
  assert.deepEqual(report.lines, [
    "完整性标记异常，本次只能按救援方案恢复",
    "忽略清单外文件 1 项"
  ]);
});
