const DATABASE_NAME = "prompt-director-local-assets";
const DATABASE_VERSION = 1;
const STORE_NAME = "file-handles";

export const LOCAL_ASSET_LINK_STATUS = Object.freeze({
  MISSING: "missing",
  NEEDS_PERMISSION: "needs-permission",
  READY: "ready",
  CHANGED: "changed"
});

let databasePromise;

export async function saveLocalAssetHandle(assetId, handle, metadata, options = {}) {
  const id = validateAssetId(assetId);
  validateFileHandle(handle);
  const record = {
    assetId: id,
    handle,
    metadata: normalizeLocalAssetMetadata(metadata),
    linkedAt: clean(options.now) || new Date().toISOString()
  };
  const database = await resolveDatabase(options);
  const transaction = database.transaction(STORE_NAME, "readwrite");
  const completed = transactionAsPromise(transaction);
  await Promise.all([
    requestAsPromise(transaction.objectStore(STORE_NAME).put(record, id)),
    completed
  ]);
  return record;
}

export async function getLocalAssetHandleRecord(assetId, options = {}) {
  const id = validateAssetId(assetId);
  const database = await resolveDatabase(options);
  const value = await requestAsPromise(
    database.transaction(STORE_NAME, "readonly").objectStore(STORE_NAME).get(id)
  );
  return normalizeStoredRecord(value, id);
}

export async function getLocalAssetHandle(assetId, options = {}) {
  return (await getLocalAssetHandleRecord(assetId, options))?.handle ?? null;
}

export async function deleteLocalAssetHandle(assetId, options = {}) {
  const id = validateAssetId(assetId);
  const database = await resolveDatabase(options);
  const transaction = database.transaction(STORE_NAME, "readwrite");
  const completed = transactionAsPromise(transaction);
  await Promise.all([
    requestAsPromise(transaction.objectStore(STORE_NAME).delete(id)),
    completed
  ]);
}

export async function inspectStoredLocalAsset(assetId, expectedMetadata, options = {}) {
  const record = await getLocalAssetHandleRecord(assetId, options);
  return inspectLocalAssetHandle(record, expectedMetadata, options);
}

export async function inspectLocalAssetHandle(record, expectedMetadata, options = {}) {
  const stored = normalizeStoredRecord(record);
  if (!stored) return { status: LOCAL_ASSET_LINK_STATUS.MISSING, permission: "unknown" };
  const permission = await queryLocalAssetHandlePermission(stored.handle, options);
  if (permission !== "granted") {
    return { status: LOCAL_ASSET_LINK_STATUS.NEEDS_PERMISSION, permission };
  }
  let file;
  try {
    file = await stored.handle.getFile();
  } catch (error) {
    if (isMissingFileError(error)) {
      return { status: LOCAL_ASSET_LINK_STATUS.MISSING, permission, error };
    }
    if (isPermissionError(error)) {
      return { status: LOCAL_ASSET_LINK_STATUS.NEEDS_PERMISSION, permission: "denied", error };
    }
    throw error;
  }
  const currentMetadata = normalizeLocalAssetMetadata(file);
  const expected = normalizeLocalAssetMetadata(expectedMetadata ?? stored.metadata);
  const changedFields = localAssetMetadataChanges(expected, currentMetadata);
  return {
    status: changedFields.length ? LOCAL_ASSET_LINK_STATUS.CHANGED : LOCAL_ASSET_LINK_STATUS.READY,
    permission,
    file,
    expectedMetadata: expected,
    currentMetadata,
    changedFields
  };
}

export async function queryLocalAssetHandlePermission(handle, options = {}) {
  validateFileHandle(handle);
  if (typeof handle.queryPermission !== "function") return "unsupported";
  const permission = await handle.queryPermission({ mode: clean(options.mode) || "read" });
  return ["granted", "prompt", "denied"].includes(permission) ? permission : "unsupported";
}

export async function readLocalAssetFile(recordOrHandle, options = {}) {
  const handle = recordOrHandle?.handle ?? recordOrHandle;
  validateFileHandle(handle);
  const permission = await queryLocalAssetHandlePermission(handle, options);
  if (permission !== "granted") {
    throw localAssetStoreError(
      "local_asset_permission_required",
      "需要由用户重新授权后才能读取本机源文件"
    );
  }
  try {
    return await handle.getFile();
  } catch (error) {
    if (isMissingFileError(error)) {
      throw localAssetStoreError("local_asset_missing", "本机源文件已移动、改名或删除", error);
    }
    if (isPermissionError(error)) {
      throw localAssetStoreError("local_asset_permission_required", "需要由用户重新授权后才能读取本机源文件", error);
    }
    throw error;
  }
}

export function normalizeLocalAssetMetadata(value = {}) {
  const name = clean(value?.name ?? value?.sourceTitle);
  const size = Number(value?.size ?? value?.byteSize);
  const lastModified = Number(value?.lastModified ?? value?.sourceLastModified);
  if (!name) throw new Error("本机源文件缺少文件名");
  if (!Number.isFinite(size) || size < 0) throw new Error("本机源文件大小无效");
  if (!Number.isFinite(lastModified) || lastModified < 0) throw new Error("本机源文件修改时间无效");
  return { name, size, lastModified };
}

export function localAssetMetadataChanges(expected, current) {
  const before = normalizeLocalAssetMetadata(expected);
  const after = normalizeLocalAssetMetadata(current);
  return ["name", "size", "lastModified"].filter((field) => before[field] !== after[field]);
}

export function validateFileHandle(handle) {
  if (!handle || handle.kind !== "file" || typeof handle.getFile !== "function") {
    throw new Error("没有选择有效的本机源文件");
  }
  return handle;
}

function validateAssetId(value) {
  const assetId = clean(value);
  if (!assetId) throw new Error("本机源文件缺少有效编号");
  return assetId;
}

function normalizeStoredRecord(value, expectedAssetId = "") {
  if (!value || typeof value !== "object") return null;
  const assetId = clean(value.assetId);
  if (!assetId || (expectedAssetId && assetId !== expectedAssetId)) return null;
  try {
    validateFileHandle(value.handle);
    return {
      assetId,
      handle: value.handle,
      metadata: normalizeLocalAssetMetadata(value.metadata),
      linkedAt: clean(value.linkedAt)
    };
  } catch {
    return null;
  }
}

function resolveDatabase(options) {
  if (options.database) return Promise.resolve(options.database);
  if (typeof options.openDatabase === "function") return Promise.resolve(options.openDatabase());
  return openDatabase();
}

function openDatabase() {
  if (!databasePromise) {
    databasePromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
      request.onupgradeneeded = () => {
        if (!request.result.objectStoreNames.contains(STORE_NAME)) {
          request.result.createObjectStore(STORE_NAME);
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error("无法打开本机源文件链接数据库"));
      request.onblocked = () => reject(new Error("本机源文件链接数据库正在被其他页面占用"));
    });
  }
  return databasePromise;
}

function requestAsPromise(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error("无法读取本机源文件链接"));
  });
}

function transactionAsPromise(transaction) {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onabort = () => reject(transaction.error || new Error("本机源文件链接保存已取消"));
    transaction.onerror = () => reject(transaction.error || new Error("无法保存本机源文件链接"));
  });
}

function localAssetStoreError(code, message, cause) {
  const error = new Error(message, cause ? { cause } : undefined);
  error.code = code;
  return error;
}

function isMissingFileError(error) {
  return ["NotFoundError", "TypeMismatchError"].includes(clean(error?.name));
}

function isPermissionError(error) {
  return ["NotAllowedError", "SecurityError"].includes(clean(error?.name));
}

function clean(value) {
  return String(value ?? "").trim();
}
