import {
  deleteMediaBlob,
  discardMediaReplacementBackup,
  getMediaBlob,
  replaceMediaBlob,
  saveMediaBlob,
  undoMediaReplacement
} from "./media-store.js";

export async function saveScreenshotBlob(entryId, blob) {
  requireImage(blob);
  return saveMediaBlob(entryId, blob);
}

export function getScreenshotBlob(entryId) {
  return getMediaBlob(entryId);
}

export function deleteScreenshotBlob(entryId) {
  return deleteMediaBlob(entryId);
}

export async function replaceScreenshotBlob(entryId, blob, options = {}) {
  requireImage(blob);
  return replaceMediaBlob(entryId, blob, { backupAssetId: options.backupEntryId });
}

export function undoScreenshotReplacement(entryId, options = {}) {
  return undoMediaReplacement(entryId, { backupAssetId: options.backupEntryId });
}

export function discardScreenshotReplacementBackup(entryId, options = {}) {
  return discardMediaReplacementBackup(entryId, { backupAssetId: options.backupEntryId });
}

function requireImage(blob) {
  if (!(blob instanceof Blob) || !blob.type.startsWith("image/")) throw new Error("截图文件无效");
}
