import { restoreVisionAfterScreenshot } from "./analysis-candidates.js";

const VERSION = 1;
const SCREENSHOT_FIELDS = Object.freeze([
  "hasScreenshot",
  "screenshotWidth",
  "screenshotHeight",
  "screenshotMimeType",
  "screenshotByteSize",
  "palette",
  "screenshotReviewStatus",
  "screenshotUpdatedAt"
]);

export function createEntrySaveUndo(entryId) {
  const id = cleanId(entryId);
  if (!id) throw new Error("撤回记录缺少案例编号");
  return { version: VERSION, type: "delete_created_entry", entryId: id };
}

export function createScreenshotSaveUndo(entryId, previousMetadata, appliedScreenshotUpdatedAt, hadScreenshot, backupEntryId) {
  const id = cleanId(entryId);
  const appliedAt = String(appliedScreenshotUpdatedAt ?? "").trim();
  const backupId = String(backupEntryId ?? `backup:${id}`).trim();
  if (!id || !appliedAt || !previousMetadata || typeof previousMetadata !== "object") {
    throw new Error("截图撤回记录不完整");
  }
  if (!isValidBackupId(id, backupId)) throw new Error("截图撤回备份编号无效");
  return {
    version: VERSION,
    type: "restore_replaced_screenshot",
    entryId: id,
    appliedScreenshotUpdatedAt: appliedAt,
    hadScreenshot: hadScreenshot === true,
    backupEntryId: backupId,
    previousMetadata: structuredClone(previousMetadata)
  };
}

export function normalizeLastSaveUndo(value) {
  if (!value || value.version !== VERSION || !cleanId(value.entryId)) return null;
  if (value.type === "delete_created_entry") return createEntrySaveUndo(value.entryId);
  if (value.type !== "restore_replaced_screenshot") return null;
  try {
    return createScreenshotSaveUndo(
      value.entryId,
      value.previousMetadata,
      value.appliedScreenshotUpdatedAt,
      value.hadScreenshot,
      value.backupEntryId
    );
  } catch {
    return null;
  }
}

export function captureScreenshotMetadata(entry = {}) {
  const metadata = {};
  for (const field of SCREENSHOT_FIELDS) {
    if (Object.hasOwn(entry, field)) metadata[field] = structuredClone(entry[field]);
  }
  metadata.hasScreenshot = entry.hasScreenshot === true;
  metadata.visionAnalysis = entry.visionAnalysis ? structuredClone(entry.visionAnalysis) : null;
  metadata.visionModelAssignments = (entry.facetAssignments ?? [])
    .filter((item) => item.source === "vision_model")
    .map((item) => structuredClone(item));
  return metadata;
}

export function restoreScreenshotSaveEntry(current, undoValue) {
  const undo = normalizeLastSaveUndo(undoValue);
  if (!undo || undo.type !== "restore_replaced_screenshot" || current?.id !== undo.entryId) {
    throw new Error("这次保存已经无法安全撤回");
  }
  if (current.screenshotUpdatedAt !== undo.appliedScreenshotUpdatedAt) {
    throw new Error("截图已经再次变化，为避免覆盖新修改，本次没有撤回");
  }
  const next = { ...current };
  for (const field of SCREENSHOT_FIELDS) delete next[field];
  const { visionAnalysis, visionModelAssignments, ...screenshot } = undo.previousMetadata;
  Object.assign(next, structuredClone(screenshot));
  return restoreVisionAfterScreenshot(next, {
    previousVisionAnalysis: visionAnalysis,
    previousAssignments: visionModelAssignments
  });
}

function cleanId(value) {
  return String(value ?? "").trim();
}

function isValidBackupId(entryId, backupEntryId) {
  return backupEntryId === `backup:${entryId}` ||
    /^save-undo-backup:[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(backupEntryId);
}
