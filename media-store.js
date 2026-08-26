import { assetFormatsForMimeType } from "./asset-formats.js";
import {
  ASSET_IMPORT_FAILURE_CODES,
  assetImportError,
  isAssetImportError
} from "./resource-limits.js";

const DATABASE_NAME = "prompt-case-collector";
const DATABASE_VERSION = 4;
const MEDIA_STORE = "media";
const LEGACY_SCREENSHOT_STORE = "screenshots";
const DERIVED_STORE = "derived-media";
const DERIVED_METADATA_STORE = "derived-metadata";

let databasePromise;

export async function saveMediaBlob(assetId, blob, options = {}) {
  validateAssetId(assetId);
  validateMediaBlob(blob);
  return writeMediaBlob(assetId, blob, options);
}

export async function savePortableAssetBlob(assetId, blob, options = {}) {
  validateAssetId(assetId);
  validatePortableAssetBlob(blob);
  return writeMediaBlob(assetId, blob, options);
}

async function writeMediaBlob(assetId, blob, options = {}) {
  if (options.checkCapacity !== false) {
    const estimate = await storageEstimate(options.estimateStorage);
    assertStorageCapacity(estimate, blob.size);
  }
  try {
    const transaction = (await openDatabase()).transaction(MEDIA_STORE, "readwrite");
    const completed = transactionAsPromise(transaction);
    await Promise.all([
      requestAsPromise(transaction.objectStore(MEDIA_STORE).put(blob, assetId)),
      completed
    ]);
  } catch (error) {
    throw mediaStorageWriteError(error);
  }
}

export async function saveSkillPackageBlob(assetId, blob, options = {}) {
  validateAssetId(assetId);
  if (!String(assetId).startsWith("skill-file:")) throw new Error("Skill 包文件缺少有效编号");
  if (!(blob instanceof Blob)) throw new Error("Skill 包文件无效");
  if (options.checkCapacity !== false) {
    const estimate = await storageEstimate(options.estimateStorage);
    assertStorageCapacity(estimate, blob.size);
  }
  try {
    const transaction = (await openDatabase()).transaction(MEDIA_STORE, "readwrite");
    const completed = transactionAsPromise(transaction);
    await Promise.all([
      requestAsPromise(transaction.objectStore(MEDIA_STORE).put(blob, assetId)),
      completed
    ]);
  } catch (error) {
    throw mediaStorageWriteError(error);
  }
}

export async function getMediaBlob(assetId) {
  validateAssetId(assetId);
  const database = await openDatabase();
  const result = await requestAsPromise(
    database.transaction(MEDIA_STORE, "readonly").objectStore(MEDIA_STORE).get(assetId)
  );
  if (result instanceof Blob) return result;
  if (!database.objectStoreNames.contains(LEGACY_SCREENSHOT_STORE)) return null;
  const legacy = await requestAsPromise(
    database.transaction(LEGACY_SCREENSHOT_STORE, "readonly")
      .objectStore(LEGACY_SCREENSHOT_STORE).get(assetId)
  );
  return legacy instanceof Blob ? legacy : null;
}

export async function deleteMediaBlob(assetId) {
  validateAssetId(assetId);
  const database = await openDatabase();
  const stores = [MEDIA_STORE, DERIVED_STORE, DERIVED_METADATA_STORE];
  if (database.objectStoreNames.contains(LEGACY_SCREENSHOT_STORE)) stores.push(LEGACY_SCREENSHOT_STORE);
  const transaction = database.transaction(stores, "readwrite");
  const completed = transactionAsPromise(transaction);
  for (const name of stores) transaction.objectStore(name).delete(assetId);
  await completed;
}

export async function deleteMediaBlobs(assetIds) {
  const ids = [...new Set((Array.isArray(assetIds) ? assetIds : []).map((assetId) => {
    validateAssetId(assetId);
    return assetId;
  }))];
  if (!ids.length) return;
  const database = await openDatabase();
  const stores = [MEDIA_STORE, DERIVED_STORE, DERIVED_METADATA_STORE];
  if (database.objectStoreNames.contains(LEGACY_SCREENSHOT_STORE)) stores.push(LEGACY_SCREENSHOT_STORE);
  const transaction = database.transaction(stores, "readwrite");
  const completed = transactionAsPromise(transaction);
  for (const name of stores) {
    const store = transaction.objectStore(name);
    for (const assetId of ids) store.delete(assetId);
  }
  await completed;
}

export async function getDerivedMetadata(assetId) {
  validateAssetId(assetId);
  const database = await openDatabase();
  const value = await requestAsPromise(
    database.transaction(DERIVED_METADATA_STORE, "readonly").objectStore(DERIVED_METADATA_STORE).get(assetId)
  );
  return value ? normalizeDerivedMetadata(value) : null;
}

export async function getAllDerivedMetadata() {
  const database = await openDatabase();
  const transaction = database.transaction(DERIVED_METADATA_STORE, "readonly");
  const store = transaction.objectStore(DERIVED_METADATA_STORE);
  const [keys, values] = await Promise.all([
    requestAsPromise(store.getAllKeys()),
    requestAsPromise(store.getAll())
  ]);
  return new Map(keys.map((key, index) => [String(key), normalizeDerivedMetadata(values[index])]));
}

export async function saveDerivedMetadata(assetId, value) {
  validateAssetId(assetId);
  const normalized = normalizeDerivedMetadata(value);
  const transaction = (await openDatabase()).transaction(DERIVED_METADATA_STORE, "readwrite");
  const completed = transactionAsPromise(transaction);
  await Promise.all([
    requestAsPromise(transaction.objectStore(DERIVED_METADATA_STORE).put(normalized, assetId)),
    completed
  ]);
  return normalized;
}

export function normalizeDerivedMetadata(value = {}) {
  const colors = (Array.isArray(value.palette?.colors) ? value.palette.colors : [])
    .map((color) => String(color ?? "").trim()).filter((color) => /^#[0-9a-f]{6}$/iu.test(color)).slice(0, 7);
  const paletteVersion = Math.max(0, Math.floor(Number(value.palette?.version) || 0));
  const width = Math.max(0, Math.floor(Number(value.width) || 0));
  const height = Math.max(0, Math.floor(Number(value.height) || 0));
  return {
    ...(width && height ? { width, height } : {}),
    ...(colors.length && paletteVersion ? {
      palette: {
        colors,
        version: paletteVersion,
        source: String(value.palette?.source ?? "local")
      }
    } : {}),
    ...(String(value.mimeType ?? "").trim() ? { mimeType: String(value.mimeType).trim() } : {}),
    ...(Math.max(0, Math.floor(Number(value.byteSize) || 0)) ? { byteSize: Math.floor(Number(value.byteSize)) } : {})
  };
}

export async function getDerivedMedia(assetId) {
  validateAssetId(assetId);
  const database = await openDatabase();
  const value = await requestAsPromise(database.transaction(DERIVED_STORE, "readonly").objectStore(DERIVED_STORE).get(assetId));
  return value ? normalizeDerivedMedia(value) : null;
}

export async function saveDerivedMedia(assetId, value) {
  validateAssetId(assetId);
  const normalized = normalizeDerivedMedia(value);
  const transaction = (await openDatabase()).transaction(DERIVED_STORE, "readwrite");
  const completed = transactionAsPromise(transaction);
  await Promise.all([requestAsPromise(transaction.objectStore(DERIVED_STORE).put(normalized, assetId)), completed]);
  return normalized;
}

export async function deleteDerivedMedia(assetId) {
  validateAssetId(assetId);
  const transaction = (await openDatabase()).transaction([DERIVED_STORE, DERIVED_METADATA_STORE], "readwrite");
  const completed = transactionAsPromise(transaction);
  transaction.objectStore(DERIVED_STORE).delete(assetId);
  transaction.objectStore(DERIVED_METADATA_STORE).delete(assetId);
  await completed;
}

export function normalizeDerivedMedia(value = {}) {
  const thumbnail = value.thumbnail instanceof Blob && value.thumbnail.type.startsWith("image/") ? value.thumbnail : undefined;
  const remoteImages = (Array.isArray(value.remoteImages) ? value.remoteImages : []).flatMap((item) => {
    const url = safeHttpUrl(item?.url);
    const blob = item?.blob instanceof Blob && item.blob.type.startsWith("image/") ? item.blob : null;
    return url && blob ? [{ url, blob }] : [];
  });
  return {
    pageCount: Math.max(0, Math.floor(Number(value.pageCount) || 0)),
    searchText: String(value.searchText ?? "").trim(),
    ...(thumbnail ? { thumbnail } : {}),
    ...(remoteImages.length ? { remoteImages } : {})
  };
}

export async function replaceMediaBlob(assetId, blob, options = {}) {
  const backupAssetId = replacementBackupAssetId(assetId, options.backupAssetId);
  const current = await getMediaBlob(assetId);
  if (current) await saveMediaBlob(backupAssetId, current, { checkCapacity: false });
  else await deleteMediaBlob(backupAssetId);
  await deleteDerivedMedia(assetId);
  await saveMediaBlob(assetId, blob, options);
  return Boolean(current);
}

export async function undoMediaReplacement(assetId, options = {}) {
  const backupAssetId = replacementBackupAssetId(assetId, options.backupAssetId);
  const backup = await getMediaBlob(backupAssetId);
  if (!backup) throw new Error("没有可撤回的媒体替换");
  await deleteDerivedMedia(assetId);
  await saveMediaBlob(assetId, backup, { checkCapacity: false });
  await deleteMediaBlob(backupAssetId);
  return backup;
}

export async function discardMediaReplacementBackup(assetId, options = {}) {
  await deleteMediaBlob(replacementBackupAssetId(assetId, options.backupAssetId));
}

export function assertStorageCapacity(estimate = {}, incomingBytes = 0) {
  const quota = Number(estimate?.quota);
  const usage = Number(estimate?.usage);
  const required = Number(incomingBytes);
  if (!Number.isFinite(required) || required < 0) {
    throw assetImportError(ASSET_IMPORT_FAILURE_CODES.INVALID_FILE, "媒体文件大小无效");
  }
  if (!Number.isFinite(quota) || !Number.isFinite(usage) || quota < usage) return;
  if (quota - usage < required) {
    throw assetImportError(
      ASSET_IMPORT_FAILURE_CODES.STORAGE_INSUFFICIENT,
      `本机可用空间不足：导入需要 ${formatBytes(required)}，当前仅剩 ${formatBytes(quota - usage)}`,
      { requiredBytes: required, availableBytes: quota - usage }
    );
  }
}

export function validateMediaBlob(blob) {
  validatePortableAssetBlob(blob);
  const type = String(blob.type || "").toLocaleLowerCase("en-US");
  if (!(type.startsWith("image/") || type.startsWith("video/") || assetFormatsForMimeType(type).length)) {
    throw assetImportError(ASSET_IMPORT_FAILURE_CODES.UNSUPPORTED_FORMAT, "暂不支持这种媒体格式");
  }
}

export function validatePortableAssetBlob(blob) {
  if (!(blob instanceof Blob) || !blob.size) {
    throw assetImportError(ASSET_IMPORT_FAILURE_CODES.INVALID_FILE, "媒体文件无效");
  }
}

async function storageEstimate(override) {
  if (typeof override === "function") return override();
  if (globalThis.navigator?.storage?.estimate) return globalThis.navigator.storage.estimate();
  return {};
}

function openDatabase() {
  if (!databasePromise) {
    databasePromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
      request.onupgradeneeded = (event) => {
        const database = request.result;
        const transaction = request.transaction;
        if (!database.objectStoreNames.contains(DERIVED_STORE)) database.createObjectStore(DERIVED_STORE);
        if (!database.objectStoreNames.contains(DERIVED_METADATA_STORE)) database.createObjectStore(DERIVED_METADATA_STORE);
        const media = database.objectStoreNames.contains(MEDIA_STORE)
          ? transaction.objectStore(MEDIA_STORE)
          : database.createObjectStore(MEDIA_STORE);
        if (event.oldVersion >= 2) return;
        if (!database.objectStoreNames.contains(LEGACY_SCREENSHOT_STORE)) return;
        const cursorRequest = transaction.objectStore(LEGACY_SCREENSHOT_STORE).openCursor();
        cursorRequest.onsuccess = () => {
          const cursor = cursorRequest.result;
          if (!cursor) return;
          media.put(cursor.value, cursor.key);
          cursor.continue();
        };
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error("无法打开媒体数据库"));
      request.onblocked = () => reject(new Error("媒体数据库正在被占用，请重新打开插件"));
    });
  }
  return databasePromise;
}

function requestAsPromise(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error("媒体数据库读写失败"));
  });
}

function transactionAsPromise(transaction) {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onabort = () => reject(transaction.error || new Error("媒体数据库事务已取消"));
    transaction.onerror = () => reject(transaction.error || new Error("媒体数据库事务失败"));
  });
}

function replacementBackupAssetId(assetId, value) {
  validateAssetId(assetId);
  if (value === undefined) return `backup:${assetId}`;
  validateAssetId(value);
  return value;
}

function validateAssetId(assetId) {
  if (typeof assetId !== "string" || !assetId.trim()) throw new Error("媒体缺少有效编号");
}

function safeHttpUrl(value) {
  try {
    const url = new URL(String(value ?? ""));
    return ["http:", "https:"].includes(url.protocol) ? url.href : "";
  } catch {
    return "";
  }
}

function formatBytes(value) {
  const bytes = Math.max(0, Number(value) || 0);
  const mebibyte = 1024 * 1024;
  return bytes >= mebibyte ? `${Math.ceil(bytes / mebibyte)} MiB` : `${Math.ceil(bytes / 1024)} KiB`;
}

export function mediaStorageWriteError(error) {
  if (isAssetImportError(error)) return error;
  const explanation = String(error?.message ?? "").trim();
  return assetImportError(
    ASSET_IMPORT_FAILURE_CODES.STORAGE_WRITE_FAILED,
    explanation ? `文件写入本机资料库失败：${explanation}` : "文件写入本机资料库失败，请检查可用空间后重试",
    {},
    { cause: error }
  );
}
