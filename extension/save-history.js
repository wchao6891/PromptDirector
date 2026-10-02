import { restoreVisionAfterScreenshot } from "./analysis-candidates.js";
import { sha256 } from "./vendor/noble-hashes/sha2.js";
import { sameUndoState, serializeUndoState } from "./undo-state.js";

const VERSION = 2;
const ENTRY_UNDO_VERSION = 3;
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

export function createEntrySaveUndo(entry) {
  const id = cleanId(entry?.id);
  if (!id) throw new Error("撤回记录缺少案例编号");
  return { version: ENTRY_UNDO_VERSION, type: "delete_created_entry", entryId: id,
    entryFingerprint: fingerprintEntry(entry) };
}

export function assertCreatedEntryUndoSafe(entry, undoValue) {
  const undo = normalizeLastSaveUndo(undoValue);
  if (!undo || undo.type !== "delete_created_entry" || cleanId(entry?.id) !== undo.entryId) {
    throw new Error("这次保存已经无法安全撤回");
  }
  if (fingerprintEntry(entry, undo.version === ENTRY_UNDO_VERSION) !== undo.entryFingerprint) {
    throw new Error("案例在保存后又被修改，为避免丢失新编辑，本次没有撤回");
  }
  return true;
}

export function createScreenshotSaveUndo(entryId, previousMetadata, appliedScreenshotUpdatedAt, hadScreenshot, backupEntryId, appliedMetadata) {
  const id = cleanId(entryId);
  const appliedAt = String(appliedScreenshotUpdatedAt ?? "").trim();
  const backupId = String(backupEntryId ?? `backup:${id}`).trim();
  if (!id || !appliedAt || !previousMetadata || typeof previousMetadata !== "object") {
    throw new Error("截图撤回记录不完整");
  }
  if (!isValidBackupId(id, backupId)) throw new Error("截图撤回备份编号无效");
  if (!appliedMetadata || typeof appliedMetadata !== "object") throw new Error("截图撤回缺少更新后的状态");
  return {
    version: VERSION,
    type: "restore_replaced_screenshot",
    entryId: id,
    appliedScreenshotUpdatedAt: appliedAt,
    hadScreenshot: hadScreenshot === true,
    backupEntryId: backupId,
    previousMetadata: structuredClone(previousMetadata),
    appliedMetadata: structuredClone(appliedMetadata)
  };
}

export function normalizeLastSaveUndo(value) {
  if (!value || !cleanId(value.entryId)) return null;
  if (value.type === "delete_created_entry") {
    const fingerprint = String(value.entryFingerprint ?? "").trim();
    return [2, ENTRY_UNDO_VERSION].includes(value.version) && /^[a-f0-9]{64}$/.test(fingerprint)
      ? { version: value.version, type: value.type, entryId: cleanId(value.entryId), entryFingerprint: fingerprint }
      : null;
  }
  if (value.version !== VERSION) return null;
  if (value.type !== "restore_replaced_screenshot") return null;
  try {
    return createScreenshotSaveUndo(
      value.entryId,
      value.previousMetadata,
      value.appliedScreenshotUpdatedAt,
      value.hadScreenshot,
      value.backupEntryId,
      value.appliedMetadata
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
  if (!sameUndoState(captureScreenshotMetadata(current), undo.appliedMetadata)) {
    throw new Error("截图或图片分析后来又被修改，为保护新编辑，本次没有撤回");
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

function fingerprintEntry(entry, stable = true) {
  const serialized = stable ? serializeUndoState(entry) : JSON.stringify(entry);
  if (!serialized) throw new Error("无法确认案例内容，未生成撤回记录");
  return [...sha256(new TextEncoder().encode(serialized))]
    .map((value) => value.toString(16).padStart(2, "0")).join("");
}

function isValidBackupId(entryId, backupEntryId) {
  return backupEntryId === `backup:${entryId}` ||
    /^save-undo-backup:[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(backupEntryId);
}
