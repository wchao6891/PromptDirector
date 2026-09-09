import { formatBytes, libraryTransferLimits, portableAssetByteLimit } from "./resource-limits.js";
import { assetFormatForExtension } from "./asset-formats.js";

import { ZIP32_MAX, ZIP16_MAX, zipSafeInteger, zip64Extra, resolveZip64Extra, readZip64Directory, makeZipEndRecords } from "./zip64.js";

const encoder = new TextEncoder();
const UTF8_FLAG = 0x0800;
const DATA_DESCRIPTOR_FLAG = 0x0008;
const STORE_METHOD = 0;
const DEFLATE_METHOD = 8;
const DOS_DATE = 0x0021;

export async function createZipBlob(files, options = {}) {
  if (!Array.isArray(files)) throw new Error("ZIP 文件列表无效");
  const localParts = [];
  const centralParts = [];
  const names = new Set();
  let offset = 0;
  for (const file of files) {
    options.signal?.throwIfAborted();
    const name = normalizeArchivePath(file?.name);
    const nameBytes = encoder.encode(name);
    if (nameBytes.length > ZIP16_MAX || names.has(name)) throw new Error("ZIP 文件路径过长或重复");
    names.add(name);
    const dataPart = archivePart(file?.data);
    const size = zipSafeInteger(dataPart.size);
    const checksum = await crc32Blob(dataPart, options.signal);
    const localExtra = zip64Extra(size >= ZIP32_MAX ? [size, size] : []);
    const centralExtra = zip64Extra([
      ...(size >= ZIP32_MAX ? [size, size] : []),
      ...(offset >= ZIP32_MAX ? [offset] : [])
    ]);
    const local = makeLocalHeader(nameBytes, size, checksum, localExtra.length);
    const central = makeCentralHeader(nameBytes, size, checksum, offset, centralExtra.length);
    localParts.push(local, nameBytes, localExtra, dataPart);
    centralParts.push(central, nameBytes, centralExtra);
    offset = zipSafeInteger(offset + local.length + nameBytes.length + localExtra.length + size);
  }
  const centralSize = zipSafeInteger(centralParts.reduce((sum, part) => sum + part.byteLength, 0));
  return new Blob([...localParts, ...centralParts, ...makeZipEndRecords(files.length, centralSize, offset)], { type: "application/zip" });
}

export async function readZipBlob(archive, limitsValue = {}, options = {}) {
  const reader = await openZipBlob(archive, limitsValue);
  return reader.read(null, options);
}

export async function openZipBlob(archive, limitsValue = {}) {
  const limits = libraryTransferLimits(limitsValue);
  if (!(archive instanceof Blob) || archive.size < 22) throw invalidZip();
  if (archive.size > limits.maxArchiveBytes) {
    throw new Error(`ZIP 超过 ${formatBytes(limits.maxArchiveBytes)} 上限`);
  }
  const tailOffset = Math.max(0, archive.size - 0xffff - 22);
  const tailBytes = await readBlobBytes(archive, tailOffset, archive.size);
  const tailView = dataView(tailBytes);
  const relativeEndOffset = findEndRecord(tailView);
  if (relativeEndOffset < 0) throw invalidZip();
  const endOffset = tailOffset + relativeEndOffset;
  const disk = tailView.getUint16(relativeEndOffset + 4, true);
  const directoryDisk = tailView.getUint16(relativeEndOffset + 6, true);
  const diskCount = tailView.getUint16(relativeEndOffset + 8, true);
  let fileCount = tailView.getUint16(relativeEndOffset + 10, true);
  let directorySize = tailView.getUint32(relativeEndOffset + 12, true);
  let directoryOffset = tailView.getUint32(relativeEndOffset + 16, true);
  const commentLength = tailView.getUint16(relativeEndOffset + 20, true);
  if (disk || directoryDisk || diskCount !== fileCount) throw new Error("暂不支持分卷 ZIP");
  if (endOffset + 22 + commentLength !== archive.size) throw invalidZip();
  let directoryEnd = endOffset;
  const locatorBytes = endOffset >= 20 && directoryOffset + directorySize !== endOffset
    ? await readBlobBytes(archive, endOffset - 20, endOffset) : null;
  const hasZip64Locator = locatorBytes && dataView(locatorBytes).getUint32(0, true) === 0x07064b50;
  if (fileCount === ZIP16_MAX || directorySize === ZIP32_MAX || directoryOffset === ZIP32_MAX || hasZip64Locator) {
    const extended = await readZip64Directory(archive, endOffset);
    if ((fileCount !== ZIP16_MAX && fileCount !== extended.fileCount)
      || (directorySize !== ZIP32_MAX && directorySize !== extended.directorySize)
      || (directoryOffset !== ZIP32_MAX && directoryOffset !== extended.directoryOffset)) throw invalidZip();
    ({ fileCount, directorySize, directoryOffset, directoryEnd } = extended);
  }
  if (fileCount > limits.maxFileCount) throw new Error(`ZIP 文件数量超过 ${limits.maxFileCount} 个上限`);
  if (zipSafeInteger(directoryOffset + directorySize) !== directoryEnd || fileCount > directorySize / 46) throw invalidZip();
  const directoryBytes = await readBlobBytes(archive, directoryOffset, directoryEnd);
  const view = dataView(directoryBytes);

  const records = [];
  const names = new Set();
  let declaredBytes = 0;
  let cursor = 0;
  for (let index = 0; index < fileCount; index += 1) {
    if (cursor + 46 > directoryBytes.byteLength || view.getUint32(cursor, true) !== 0x02014b50) throw invalidZip();
    const flags = view.getUint16(cursor + 8, true);
    const method = view.getUint16(cursor + 10, true);
    const checksum = view.getUint32(cursor + 16, true);
    let compressedSize = view.getUint32(cursor + 20, true);
    let size = view.getUint32(cursor + 24, true);
    const nameLength = view.getUint16(cursor + 28, true);
    const extraLength = view.getUint16(cursor + 30, true);
    const entryCommentLength = view.getUint16(cursor + 32, true);
    let localOffset = view.getUint32(cursor + 42, true);
    if (flags & 0x0001) throw new Error("不支持加密 ZIP");
    if (![STORE_METHOD, DEFLATE_METHOD].includes(method)) throw new Error("ZIP 使用了浏览器不支持的压缩方式");
    const nameEnd = cursor + 46 + nameLength;
    if (nameEnd + extraLength + entryCommentLength > directoryBytes.byteLength) throw invalidZip();
    let disk = view.getUint16(cursor + 34, true);
    ({ size, compressedSize, localOffset, disk } = resolveZip64Extra(
      directoryBytes.subarray(nameEnd, nameEnd + extraLength), { size, compressedSize, localOffset, disk }
    ));
    if (disk) throw new Error("暂不支持分卷 ZIP");
    if (method === STORE_METHOD && compressedSize !== size) throw invalidZip();
    if (!(flags & UTF8_FLAG) && directoryBytes.subarray(cursor + 46, nameEnd).some((byte) => byte > 0x7f)) {
      throw new Error("ZIP 文件名不是可安全识别的 UTF-8 或 ASCII 编码");
    }
    const decodedName = new TextDecoder("utf-8", { fatal: true })
      .decode(directoryBytes.subarray(cursor + 46, nameEnd));
    const directoryEntry = decodedName.endsWith("/");
    if (directoryEntry && !safeDirectoryPath(decodedName)) throw new Error("ZIP 内包含不安全的目录路径");
    if (directoryEntry && (size !== 0 || compressedSize !== 0)) throw invalidZip();
    if (directoryEntry) {
      cursor = nameEnd + extraLength + entryCommentLength;
      continue;
    }
    const name = normalizeArchivePath(decodedName);
    if (name !== decodedName || names.has(name)) throw new Error("ZIP 内包含不安全或重复的文件路径");
    const format = assetFormatForExtension(name.split(".").at(-1));
    const fileLimit = portableAssetByteLimit(format?.kind, { ...limits, ...limitsValue });
    if (size > fileLimit) {
      throw new Error(`ZIP 单个文件超过 ${formatBytes(fileLimit)} 上限`);
    }

    if (localOffset + 30 > directoryOffset) throw invalidZip();
    declaredBytes = zipSafeInteger(declaredBytes + size);
    if (declaredBytes > limits.maxArchiveBytes) throw new Error("ZIP 解压内容超过安全上限");
    names.add(name);
    records.push({ name, flags, method, checksum, compressedSize, size, localOffset });
    cursor = nameEnd + extraLength + entryCommentLength;
  }
  if (cursor !== directoryBytes.byteLength) throw invalidZip();
  return {
    names: Object.freeze([...names]),
    expandedBytes: declaredBytes,
    async read(selectedNames = null, options = {}) {
      const requested = selectedNames == null
        ? null
        : new Set((Array.isArray(selectedNames) ? selectedNames : [...selectedNames]).map(normalizeArchivePath));
      if (requested) {
        for (const name of requested) {
          if (!names.has(name)) throw new Error(`ZIP 内缺少文件：${name}`);
        }
      }
      const targets = requested ? records.filter((record) => requested.has(record.name)) : records;
      const onProgress = typeof options.onProgress === "function" ? options.onProgress : () => undefined;
      const files = new Map();
      let extractedBytes = 0;
      const totalBytes = targets.reduce((sum, record) => sum + record.size, 0);
      for (let index = 0; index < targets.length; index += 1) {
        options.signal?.throwIfAborted();
        const record = targets[index];
        const { dataOffset, dataEnd } = await resolveLocalRecord(archive, record, directoryOffset);
        const compressed = archive.slice(dataOffset, dataEnd);
        let data;
        let actualChecksum;
        const onBytes = bytes => options.onReadProgress?.({
          completed: index, total: targets.length, name: record.name,
          extractedBytes: extractedBytes + bytes, totalBytes
        });
        if (record.method === STORE_METHOD) {
          data = compressed.slice(0, compressed.size, mimeTypeForPath(record.name));
          actualChecksum = await crc32Blob(data, options.signal, onBytes);
        } else {
          const inflated = await inflateRaw(compressed, record.size, record.name, options.signal, onBytes);
          data = inflated.blob.slice(0, inflated.blob.size, mimeTypeForPath(record.name));
          actualChecksum = inflated.checksum;
        }
        if (data.size !== record.size) throw new Error(`ZIP 内的文件解压大小不符：${record.name}`);
        extractedBytes += data.size;
        if (extractedBytes > limits.maxArchiveBytes) throw new Error("ZIP 解压内容超过安全上限");
        if (actualChecksum !== record.checksum) throw new Error(`ZIP 内的文件已损坏：${record.name}`);
        files.set(record.name, data);
        onProgress({ completed: index + 1, total: targets.length, name: record.name, extractedBytes });
        if ((index + 1) % 8 === 0 && index + 1 < targets.length) await yieldToMain();
      }
      return files;
    }
  };
}

async function resolveLocalRecord(archive, record, directoryOffset) {
  const headerBytes = await readBlobBytes(archive, record.localOffset, record.localOffset + 30);
  if (headerBytes.byteLength !== 30) throw invalidZip();
  const view = dataView(headerBytes);
  if (view.getUint32(0, true) !== 0x04034b50) throw invalidZip();
  const localFlags = view.getUint16(6, true);
  const localMethod = view.getUint16(8, true);
  const localChecksum = view.getUint32(14, true);
  let localCompressedSize = view.getUint32(18, true);
  let localSize = view.getUint32(22, true);
  const localNameLength = view.getUint16(26, true);
  const localExtraLength = view.getUint16(28, true);
  const localNameEnd = record.localOffset + 30 + localNameLength;
  const dataOffset = localNameEnd + localExtraLength;
  const dataEnd = zipSafeInteger(dataOffset + record.compressedSize);
  if (localNameEnd > directoryOffset || dataEnd > directoryOffset) throw invalidZip();
  const localNameBytes = await readBlobBytes(archive, record.localOffset + 30, localNameEnd);
  const localName = new TextDecoder("utf-8", { fatal: true }).decode(localNameBytes);
  ({ size: localSize, compressedSize: localCompressedSize } = resolveZip64Extra(
    await readBlobBytes(archive, localNameEnd, dataOffset), { size: localSize, compressedSize: localCompressedSize }
  ));
  const descriptor = Boolean(record.flags & DATA_DESCRIPTOR_FLAG);
  if (localFlags !== record.flags || localMethod !== record.method || localName !== record.name) throw invalidZip();
  if (!descriptor && (localChecksum !== record.checksum || localCompressedSize !== record.compressedSize || localSize !== record.size)) {
    throw invalidZip();
  }
  if (descriptor && ((localChecksum && localChecksum !== record.checksum) ||
    (localCompressedSize && localCompressedSize !== record.compressedSize) || (localSize && localSize !== record.size))) {
    throw invalidZip();
  }
  return { dataOffset, dataEnd };
}

async function inflateRaw(compressedBlob, expectedSize, name, signal, onBytes) {
  if (typeof DecompressionStream !== "function") throw new Error("当前浏览器不支持读取压缩 ZIP");
  let total = 0;
  let checksum = 0xffffffff;
  try {
    // A browser-managed Blob sink avoids retaining all decompressed Uint8Arrays in JS.
    const checked = compressedBlob.stream().pipeThrough(new DecompressionStream("deflate-raw"))
      .pipeThrough(new TransformStream({
        transform(value, controller) {
          signal?.throwIfAborted();
          total += value.byteLength;
          if (total > expectedSize) throw new Error(`ZIP 解压内容超过声明大小：${name}`);
          checksum = crc32Update(checksum, value);
          onBytes?.(total);
          controller.enqueue(value);
        }
      }), { signal });
    const blob = await new Response(checked).blob();
    return { blob, checksum: (checksum ^ 0xffffffff) >>> 0 };
  } catch (error) {
    if (signal?.aborted || total > expectedSize) throw error;
    throw new Error(`ZIP 内的文件无法解压：${name}`, { cause: error });
  }
}

async function readBlobBytes(blob, start, end) {
  return new Uint8Array(await blob.slice(start, end).arrayBuffer());
}

function dataView(bytes) {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
}

async function crc32Blob(blob, signal, onBytes) {
  const reader = blob.stream().getReader();
  let checksum = 0xffffffff;
  let total = 0;
  try {
    while (true) {
      signal?.throwIfAborted();
      const { done, value } = await reader.read();
      if (done) break;
      checksum = crc32Update(checksum, value);
      total += value.byteLength;
      onBytes?.(total);
    }
  } finally {
    reader.releaseLock();
  }
  return (checksum ^ 0xffffffff) >>> 0;
}

function makeLocalHeader(name, size, checksum, extraLength) {
  const bytes = new Uint8Array(30);
  const view = new DataView(bytes.buffer);
  view.setUint32(0, 0x04034b50, true);
  view.setUint16(4, extraLength ? 45 : 20, true);
  view.setUint16(6, UTF8_FLAG, true);
  view.setUint16(8, STORE_METHOD, true);
  view.setUint16(10, 0, true);
  view.setUint16(12, DOS_DATE, true);
  view.setUint32(14, checksum, true);
  view.setUint32(18, Math.min(size, ZIP32_MAX), true);
  view.setUint32(22, Math.min(size, ZIP32_MAX), true);
  view.setUint16(26, name.byteLength, true);
  view.setUint16(28, extraLength, true);
  return bytes;
}

function makeCentralHeader(name, size, checksum, offset, extraLength) {
  const bytes = new Uint8Array(46);
  const view = new DataView(bytes.buffer);
  view.setUint32(0, 0x02014b50, true);
  view.setUint16(4, extraLength ? 45 : 20, true);
  view.setUint16(6, extraLength ? 45 : 20, true);
  view.setUint16(8, UTF8_FLAG, true);
  view.setUint16(10, STORE_METHOD, true);
  view.setUint16(12, 0, true);
  view.setUint16(14, DOS_DATE, true);
  view.setUint32(16, checksum, true);
  view.setUint32(20, Math.min(size, ZIP32_MAX), true);
  view.setUint32(24, Math.min(size, ZIP32_MAX), true);
  view.setUint16(28, name.byteLength, true);
  view.setUint32(42, Math.min(offset, ZIP32_MAX), true);
  view.setUint16(30, extraLength, true);
  return bytes;
}

function archivePart(value) {
  if (value instanceof Blob) return value;
  if (value instanceof Uint8Array || typeof value === "string") return new Blob([value]);
  throw new Error("ZIP 文件内容无效");
}

function normalizeArchivePath(value) {
  const path = String(value ?? "").replace(/\\/g, "/").replace(/^\/+/, "");
  if (!path || path.split("/").some((part) => !part || part === "." || part === "..")) {
    throw new Error("ZIP 文件路径无效");
  }
  return path;
}

function safeDirectoryPath(value) {
  const path = String(value ?? "").replace(/\\/g, "/");
  if (!path.endsWith("/") || path.startsWith("/")) return false;
  const parts = path.slice(0, -1).split("/");
  return parts.length > 0 && parts.every((part) => part && part !== "." && part !== "..");
}

function findEndRecord(view) {
  const minimum = Math.max(0, view.byteLength - 0xffff - 22);
  for (let offset = view.byteLength - 22; offset >= minimum; offset -= 1) {
    if (view.getUint32(offset, true) === 0x06054b50) return offset;
  }
  return -1;
}

function invalidZip() {
  return new Error("这不是有效的 ZIP 案例包");
}

function mimeTypeForPath(path) {
  const extension = path.split(".").pop()?.toLocaleLowerCase("en-US");
  if (extension === "json") return "application/json";
  if (extension === "md") return "text/markdown";
  return assetFormatForExtension(extension)?.mimeTypes?.[0] || "application/octet-stream";
}

function crc32Update(initial, bytes) {
  let checksum = initial;
  let index = 0;
  // Eight-byte slicing computes the same ZIP CRC with fewer dependent lookups.
  for (; index + 8 <= bytes.length; index += 8) {
    const word = checksum ^ (bytes[index] | bytes[index + 1] << 8 | bytes[index + 2] << 16 | bytes[index + 3] << 24);
    checksum = CRC_SLICES[7][word & 255] ^ CRC_SLICES[6][word >>> 8 & 255]
      ^ CRC_SLICES[5][word >>> 16 & 255] ^ CRC_SLICES[4][word >>> 24]
      ^ CRC_SLICES[3][bytes[index + 4]] ^ CRC_SLICES[2][bytes[index + 5]]
      ^ CRC_SLICES[1][bytes[index + 6]] ^ CRC_SLICES[0][bytes[index + 7]];
  }
  for (; index < bytes.length; index += 1) {
    checksum = CRC_TABLE[(checksum ^ bytes[index]) & 0xff] ^ (checksum >>> 8);
  }
  return checksum >>> 0;
}

function yieldToMain() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

const CRC_TABLE = new Uint32Array(256);
for (let index = 0; index < CRC_TABLE.length; index += 1) {
  let value = index;
  for (let bit = 0; bit < 8; bit += 1) {
    value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  }
  CRC_TABLE[index] = value >>> 0;
}

const CRC_SLICES = [CRC_TABLE];
for (let slice = 1; slice < 8; slice += 1) {
  CRC_SLICES.push(CRC_SLICES[slice - 1].map(value => CRC_TABLE[value & 255] ^ (value >>> 8)));
}
