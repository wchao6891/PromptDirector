import {
  createVaultHeader,
  decryptVaultBlob,
  decryptVaultValue,
  encryptVaultBlob,
  encryptVaultValue,
  sha256Hex,
  unlockVaultHeader,
  verifyVaultKey
} from "./sync-crypto.js";
import {
  DEFAULT_SYNC_RETENTION,
  SYNC_SNAPSHOT_FORMAT,
  SYNC_SNAPSHOT_VERSION
} from "./sync-model.js";

export const SYNC_DIRECTORY_NAME = "PromptDirector-Sync";
const HEADER_FILENAME = "vault.json";
const DEFAULT_OBJECT_CHUNK_BYTES = 8 * 1024 * 1024;

export async function createOrUnlockSyncVault(rootDirectory, password) {
  validateDirectoryHandle(rootDirectory);
  let directory;
  let existed = true;
  try {
    directory = await rootDirectory.getDirectoryHandle(SYNC_DIRECTORY_NAME);
  } catch (error) {
    if (!isNotFound(error)) throw error;
    existed = false;
    directory = await rootDirectory.getDirectoryHandle(SYNC_DIRECTORY_NAME, { create: true });
  }
  let header;
  try {
    header = await readJsonFile(directory, HEADER_FILENAME);
  } catch (error) {
    if (!isNotFound(error)) throw error;
    if (existed && await directoryHasEntries(directory)) {
      throw new Error("同步目录缺少加密文件头，可能仍在同步或已经损坏；本地资料未被修改");
    }
    const created = await createVaultHeader(password);
    header = created.header;
    await writeJsonFile(directory, HEADER_FILENAME, header);
    await directory.getDirectoryHandle("devices", { create: true });
    await directory.getDirectoryHandle("objects", { create: true });
    return { rootDirectory, directory, header, key: created.key };
  }
  const unlocked = await unlockVaultHeader(header, password);
  await directory.getDirectoryHandle("devices", { create: true });
  await directory.getDirectoryHandle("objects", { create: true });
  return { rootDirectory, directory, ...unlocked };
}

export async function openSyncVaultWithKey(rootDirectory, key, expectedVaultId = "") {
  validateDirectoryHandle(rootDirectory);
  const directory = await rootDirectory.getDirectoryHandle(SYNC_DIRECTORY_NAME);
  const header = await verifyVaultKey(await readJsonFile(directory, HEADER_FILENAME), key);
  if (expectedVaultId && header.vaultId !== expectedVaultId) {
    throw new Error("所选文件夹不是此前连接的同步库，请重新连接");
  }
  return { rootDirectory, directory, header, key };
}

export async function listSyncSnapshots(vault) {
  validateVault(vault);
  const devices = await vault.directory.getDirectoryHandle("devices", { create: true });
  const snapshots = [];
  let encryptedFileCount = 0;
  for await (const device of devices.values()) {
    if (device.kind !== "directory") continue;
    for await (const fileHandle of device.values()) {
      if (fileHandle.kind !== "file" || !fileHandle.name.endsWith(".pds")) continue;
      encryptedFileCount += 1;
      try {
        const encrypted = await readJsonHandle(fileHandle);
        const snapshot = await decryptVaultValue(encrypted, vault.key);
        if (snapshot?.format !== SYNC_SNAPSHOT_FORMAT || snapshot.version !== SYNC_SNAPSHOT_VERSION) {
          throw new Error("状态版本无效");
        }
        snapshots.push(snapshot);
      } catch {
      }
    }
  }
  if (encryptedFileCount && !snapshots.length) {
    throw new Error("同步目录中没有可读取的健康版本，本地资料未被修改");
  }
  return snapshots.sort((left, right) =>
    left.logicalClock - right.logicalClock ||
    String(left.snapshotId).localeCompare(String(right.snapshotId))
  );
}

export async function writeSyncSnapshot(vault, snapshot, options = {}) {
  validateVault(vault);
  if (snapshot?.format !== SYNC_SNAPSHOT_FORMAT || snapshot.version !== SYNC_SNAPSHOT_VERSION) {
    throw new Error("待写入的同步状态无效");
  }
  const devices = await vault.directory.getDirectoryHandle("devices", { create: true });
  const deviceName = safeFilename(snapshot.deviceId);
  const device = await devices.getDirectoryHandle(deviceName, { create: true });
  const encrypted = await encryptVaultValue(snapshot, vault.key);
  const filename = `${String(snapshot.logicalClock).padStart(12, "0")}-${safeFilename(snapshot.snapshotId)}.pds`;
  await writeJsonAtomic(device, filename, encrypted);
  await pruneDeviceVersions(device, Math.max(1, Number(options.retentionCount) || DEFAULT_SYNC_RETENTION));
  return filename;
}

export async function writeSyncObject(vault, blob, options = {}) {
  validateVault(vault);
  validateSyncMedia(blob);
  const objects = await vault.directory.getDirectoryHandle("objects", { create: true });
  const chunkBytes = Math.max(1, Number(options.chunkBytes) || DEFAULT_OBJECT_CHUNK_BYTES);
  const chunks = [];
  for (let offset = 0, index = 0; offset < blob.size; offset += chunkBytes, index += 1) {
    const chunk = blob.slice(offset, Math.min(blob.size, offset + chunkBytes), "application/octet-stream");
    const chunkId = await sha256Hex(chunk);
    const filename = `${chunkId}.pdc`;
    if (!await hasFile(objects, filename)) {
      await writeJsonAtomic(objects, filename, await encryptVaultBlob(chunk, vault.key));
    }
    chunks.push({ id: chunkId, byteSize: chunk.size });
    options.onProgress?.({ current: Math.min(blob.size, offset + chunk.size), total: blob.size, index });
  }
  const manifest = { format: "prompt-director-sync-object", version: 2, contentType: blob.type, byteSize: blob.size, chunks };
  const objectId = await sha256Hex(JSON.stringify(manifest));
  const filename = `${objectId}.pdm`;
  if (!await hasFile(objects, filename)) {
    await writeJsonAtomic(objects, filename, await encryptVaultValue(manifest, vault.key));
  }
  return objectId;
}

export async function readSyncObject(vault, objectId) {
  validateVault(vault);
  if (!/^[a-f0-9]{64}$/.test(String(objectId ?? ""))) throw new Error("同步媒体编号无效");
  const objects = await vault.directory.getDirectoryHandle("objects", { create: true });
  try {
    const manifest = await decryptVaultValue(await readJsonFile(objects, `${objectId}.pdm`), vault.key);
    if (manifest?.format !== "prompt-director-sync-object" || manifest.version !== 2 || !Array.isArray(manifest.chunks)) {
      throw new Error("同步媒体清单无效");
    }
    const expectedId = await sha256Hex(JSON.stringify(manifest));
    if (expectedId !== objectId) throw new Error("同步媒体清单校验失败");
    const chunks = [];
    let byteSize = 0;
    for (const chunk of manifest.chunks) {
      if (!/^[a-f0-9]{64}$/.test(String(chunk?.id ?? ""))) throw new Error("同步媒体分块编号无效");
      const blob = await decryptVaultBlob(await readJsonFile(objects, `${chunk.id}.pdc`), vault.key);
      if (blob.size !== chunk.byteSize || await sha256Hex(blob) !== chunk.id) throw new Error("同步媒体分块已损坏");
      chunks.push(blob);
      byteSize += blob.size;
    }
    if (byteSize !== manifest.byteSize) throw new Error("同步媒体分块不完整");
    const restored = new Blob(chunks, { type: manifest.contentType });
    validateSyncMedia(restored);
    return restored;
  } catch (error) {
    if (!isNotFound(error)) throw error;
    const blob = await decryptVaultBlob(await readJsonFile(objects, `${objectId}.pdo`), vault.key);
    validateSyncMedia(blob);
    return blob;
  }
}

function validateSyncMedia(blob) {
  if (!(blob instanceof Blob) || !blob.size) throw new Error("同步媒体无效");
  if (!(blob.type.startsWith("image/") || blob.type.startsWith("video/") ||
    ["application/pdf", "text/plain", "text/markdown", "text/html"].includes(blob.type))) {
    throw new Error("同步对象不是受支持的媒体");
  }
}

async function pruneDeviceVersions(directory, retentionCount) {
  const files = [];
  for await (const handle of directory.values()) {
    if (handle.kind === "file" && handle.name.endsWith(".pds")) files.push(handle.name);
  }
  files.sort();
  for (const name of files.slice(0, Math.max(0, files.length - retentionCount))) {
    await directory.removeEntry(name);
  }
}

async function writeJsonAtomic(directory, filename, value) {
  const temporary = `${filename}.partial`;
  await writeJsonFile(directory, temporary, value);
  await writeJsonFile(directory, filename, value);
  await directory.removeEntry(temporary).catch(() => undefined);
}

async function writeJsonFile(directory, filename, value) {
  const handle = await directory.getFileHandle(filename, { create: true });
  const writable = await handle.createWritable();
  try {
    await writable.write(`${JSON.stringify(value)}\n`);
  } finally {
    await writable.close();
  }
}

async function readJsonFile(directory, filename) {
  return readJsonHandle(await directory.getFileHandle(filename));
}

async function readJsonHandle(handle) {
  const file = await handle.getFile();
  if (file.size > 32 * 1024 * 1024) throw new Error("同步状态文件异常过大");
  return JSON.parse(await file.text());
}

async function hasFile(directory, filename) {
  try {
    await directory.getFileHandle(filename);
    return true;
  } catch (error) {
    if (isNotFound(error)) return false;
    throw error;
  }
}

async function directoryHasEntries(directory) {
  for await (const _handle of directory.values()) return true;
  return false;
}

function safeFilename(value) {
  const cleaned = String(value ?? "").replace(/[^A-Za-z0-9._-]/g, "-").replace(/-+/g, "-");
  if (!cleaned || cleaned === "." || cleaned === "..") throw new Error("同步文件编号无效");
  return cleaned;
}

function validateDirectoryHandle(value) {
  if (!value || value.kind !== "directory" || typeof value.getDirectoryHandle !== "function") {
    throw new Error("没有选择有效的同步文件夹");
  }
}

function validateVault(value) {
  validateDirectoryHandle(value?.directory);
  if (!value.key) throw new Error("同步库尚未解锁");
}

function isNotFound(error) {
  return error?.name === "NotFoundError";
}
