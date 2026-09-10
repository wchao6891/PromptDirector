export function buildLibraryImportReport(previewValue = {}, details = {}) {
  const preview = previewValue && typeof previewValue === "object" ? previewValue : {};
  const stats = preview.importStats && typeof preview.importStats === "object" ? preview.importStats : {};
  const diagnostics = Array.isArray(preview.importDiagnostics) ? preview.importDiagnostics : [];
  const importedCount = count(preview.importedCount);
  const lines = [];
  if (diagnostics.some((item) => item?.code === "backup_integrity_degraded")) {
    lines.push("完整性标记异常，本次只能按救援方案恢复");
  }
  const extraFileCount = diagnostics.filter((item) => item?.code === "extra_file_ignored").length;
  if (extraFileCount) lines.push(`忽略清单外文件 ${extraFileCount} 项`);
  if (count(preview.skippedCount)) lines.push(`完全相同，跳过 ${count(preview.skippedCount)} 个`);
  if (count(preview.remappedCount)) lines.push(`同一来源有新内容，保留副本 ${count(preview.remappedCount)} 个`);
  if (count(stats.droppedAiAssignments)) lines.push(`丢弃损坏的 AI 标签 ${count(stats.droppedAiAssignments)} 条`);
  if (count(stats.droppedMediaDescriptors)) lines.push(`丢弃损坏的媒体描述 ${count(stats.droppedMediaDescriptors)} 条`);
  if (count(stats.droppedMediaFiles)) lines.push(`丢弃损坏或缺失的媒体 ${count(stats.droppedMediaFiles)} 项`);
  if (count(stats.skippedCases)) lines.push(`跳过无法恢复的案例 ${count(stats.skippedCases)} 个`);
  const recoveredExtras = [];
  if (count(preview.importedSkillCount)) recoveredExtras.push(`${count(preview.importedSkillCount)} 个 Skill`);
  if (count(details.mediaCount)) recoveredExtras.push(`${count(details.mediaCount)} 项本地文件${details.byteLabel ? `（${details.byteLabel}）` : ""}`);
  if (recoveredExtras.length) lines.push(`恢复 ${recoveredExtras.join("、")}`);
  const partial = diagnostics.length > 0 || [
    preview.skippedCount,
    preview.remappedCount,
    stats.droppedAiAssignments,
    stats.droppedMediaDescriptors,
    stats.droppedMediaFiles,
    stats.skippedCases
  ].some((value) => count(value) > 0);
  return {
    status: partial ? "partial" : "ready",
    summary: importedCount ? `可导入 ${importedCount} 个新案例` : "没有需要新建的案例",
    lines,
    autoAnalysisNotice: "导入不会自动启动 AI 分析"
  };
}

export function importReportDescription(reportValue = {}) {
  const report = reportValue && typeof reportValue === "object" ? reportValue : {};
  return [report.summary, ...(report.lines ?? []), report.autoAnalysisNotice].filter(Boolean).join("。") + "。";
}

function count(value) {
  const number = Number(value);
  return Number.isSafeInteger(number) && number > 0 ? number : 0;
}
