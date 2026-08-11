import { formatBytes, portableLibraryLimits } from "./resource-limits.js";

const encoder = new TextEncoder();
const UTF8_FLAG = 0x0800;
const DATA_DESCRIPTOR_FLAG = 0x0008;
const STORE_METHOD = 0;
const DEFLATE_METHOD = 8;
const DOS_DATE = 0x0021;

export async function createZipBlob(files) {
  if (!Array.isArray(files) || files.length > 0xffff) {
    throw new Error("ZIP 文件数量超出浏览器支持范围");
  }

  const records = [];
  let offset = 0;
  for (const file of files) {
    const name = normalizeArchivePath(file?.name);
    const nameBytes = encoder.encode(name);
    const dataPart = archivePart(file?.data);
    const dataBytes = new Uint8Array(await dataPart.arrayBuffer());
    ensureUint32(dataPart.size, "单个文件过大");
    const checksum = crc32(dataBytes);
    const localHeader = makeLocalHeader(nameBytes, dataPart.size, checksum);
    records.push({ nameBytes, dataPart, checksum, offset });
    offset += localHeader.byteLength + nameBytes.byteLength + dataPart.size;
    ensureUint32(offset, "ZIP 文件过大");
  }

  const localParts = [];
  const centralParts = [];
  for (const record of records) {
    localParts.push(
      makeLocalHeader(record.nameBytes, record.dataPart.size, record.checksum),
      record.nameBytes,
      record.dataPart
    );
    centralParts.push(
      makeCentralHeader(
        record.nameBytes,
        record.dataPart.size,
        record.checksum,
        record.offset
      ),
      record.nameBytes
    );
  }

  const centralSize = centralParts.reduce((sum, part) => sum + part.byteLength, 0);
  ensureUint32(centralSize, "ZIP 目录过大");
  return new Blob(
    [...localParts, ...centralParts, makeEndRecord(records.length, centralSize, offset)],
    { type: "application/zip" }
  );
}

export async function readZipBlob(archive, limitsValue = {}) {
  const limits = portableLibraryLimits(limitsValue);
  if (!(archive instanceof Blob) || archive.size < 22) throw invalidZip();
  if (archive.size > limits.maxArchiveBytes) {
    throw new Error(`ZIP 超过 ${formatBytes(limits.maxArchiveBytes)} 上限`);
  }
  const bytes = new Uint8Array(await archive.arrayBuffer());
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const endOffset = findEndRecord(view);
  if (endOffset < 0) throw invalidZip();
  const disk = view.getUint16(endOffset + 4, true);
  const directoryDisk = view.getUint16(endOffset + 6, true);
  const diskCount = view.getUint16(endOffset + 8, true);
  const fileCount = view.getUint16(endOffset + 10, true);
  const directorySize = view.getUint32(endOffset + 12, true);
  const directoryOffset = view.getUint32(endOffset + 16, true);
  const commentLength = view.getUint16(endOffset + 20, true);
  if (disk || directoryDisk || diskCount !== fileCount || endOffset + 22 + commentLength !== bytes.byteLength) {
    throw new Error("暂不支持分卷或 ZIP64 压缩包");
  }
  if (fileCount > limits.maxFileCount) {
    throw new Error(`ZIP 文件数量超过 ${limits.maxFileCount} 个上限`);
  }
  if (directoryOffset + directorySize !== endOffset) throw invalidZip();

  const files = new Map();
  let extractedBytes = 0;
  let cursor = directoryOffset;
  for (let index = 0; index < fileCount; index += 1) {
    if (cursor + 46 > endOffset || view.getUint32(cursor, true) !== 0x02014b50) throw invalidZip();
    const flags = view.getUint16(cursor + 8, true);
    const method = view.getUint16(cursor + 10, true);
    const checksum = view.getUint32(cursor + 16, true);
    const compressedSize = view.getUint32(cursor + 20, true);
    const size = view.getUint32(cursor + 24, true);
    if (size > limits.maxFileBytes) {
      throw new Error(`ZIP 单个文件超过 ${formatBytes(limits.maxFileBytes)} 上限`);
    }
    const nameLength = view.getUint16(cursor + 28, true);
    const extraLength = view.getUint16(cursor + 30, true);
    const entryCommentLength = view.getUint16(cursor + 32, true);
    const localOffset = view.getUint32(cursor + 42, true);
    if (flags & 0x0001) throw new Error("不支持加密 ZIP");
    if (![STORE_METHOD, DEFLATE_METHOD].includes(method)) throw new Error("ZIP 使用了浏览器不支持的压缩方式");
    if (method === STORE_METHOD && compressedSize !== size) throw invalidZip();
    const nameEnd = cursor + 46 + nameLength;
    if (nameEnd + extraLength + entryCommentLength > endOffset) throw invalidZip();
    if (!(flags & UTF8_FLAG) && bytes.subarray(cursor + 46, nameEnd).some((byte) => byte > 0x7f)) {
      throw new Error("ZIP 文件名不是可安全识别的 UTF-8 或 ASCII 编码");
    }
    const decodedName = new TextDecoder("utf-8", { fatal: true })
      .decode(bytes.subarray(cursor + 46, nameEnd));
    const directoryEntry = decodedName.endsWith("/");
    if (directoryEntry && !safeDirectoryPath(decodedName)) throw new Error("ZIP 内包含不安全的目录路径");
    if (directoryEntry && (size !== 0 || compressedSize !== 0)) throw invalidZip();
    if (directoryEntry) {
      cursor = nameEnd + extraLength + entryCommentLength;
      continue;
    }
    const name = normalizeArchivePath(decodedName);
    if (name !== decodedName || files.has(name)) throw new Error("ZIP 内包含不安全或重复的文件路径");

    if (localOffset + 30 > directoryOffset || view.getUint32(localOffset, true) !== 0x04034b50) throw invalidZip();
    const localFlags = view.getUint16(localOffset + 6, true);
    const localMethod = view.getUint16(localOffset + 8, true);
    const localChecksum = view.getUint32(localOffset + 14, true);
    const localCompressedSize = view.getUint32(localOffset + 18, true);
    const localSize = view.getUint32(localOffset + 22, true);
    const localNameLength = view.getUint16(localOffset + 26, true);
    const localExtraLength = view.getUint16(localOffset + 28, true);
    const localNameEnd = localOffset + 30 + localNameLength;
    if (localNameEnd > directoryOffset) throw invalidZip();
    const localName = new TextDecoder("utf-8", { fatal: true })
      .decode(bytes.subarray(localOffset + 30, localNameEnd));
    const descriptor = Boolean(flags & DATA_DESCRIPTOR_FLAG);
    if (localFlags !== flags || localMethod !== method || localName !== name) throw invalidZip();
    if (!descriptor && (localChecksum !== checksum || localCompressedSize !== compressedSize || localSize !== size)) throw invalidZip();
    if (descriptor && ((localChecksum && localChecksum !== checksum) ||
      (localCompressedSize && localCompressedSize !== compressedSize) || (localSize && localSize !== size))) throw invalidZip();
    const dataOffset = localOffset + 30 + localNameLength + localExtraLength;
    const dataEnd = dataOffset + compressedSize;
    if (dataEnd > directoryOffset) throw invalidZip();
    const compressed = bytes.subarray(dataOffset, dataEnd);
    const data = method === STORE_METHOD ? compressed : await inflateRaw(compressed, size, name);
    if (data.byteLength !== size) throw new Error(`ZIP 内的文件解压大小不符：${name}`);
    extractedBytes += data.byteLength;
    if (extractedBytes > limits.maxArchiveBytes) throw new Error("ZIP 解压内容超过安全上限");
    if (crc32(data) !== checksum) throw new Error(`ZIP 内的文件已损坏：${name}`);
    files.set(name, new Blob([data], { type: mimeTypeForPath(name) }));
    cursor = nameEnd + extraLength + entryCommentLength;
  }
  if (cursor !== endOffset) throw invalidZip();
  return files;
}

async function inflateRaw(bytes, expectedSize, name) {
  if (typeof DecompressionStream !== "function") throw new Error("当前浏览器不支持读取压缩 ZIP");
  let reader;
  try {
    const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
    reader = stream.getReader();
  } catch {
    throw new Error(`ZIP 内的文件无法解压：${name}`);
  }

  const chunks = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > expectedSize) {
        await reader.cancel().catch(() => undefined);
        throw new Error(`ZIP 解压内容超过声明大小：${name}`);
      }
      chunks.push(value);
    }
  } catch (error) {
    if (total > expectedSize) throw error;
    throw new Error(`ZIP 内的文件无法解压：${name}`);
  } finally {
    reader.releaseLock();
  }

  const data = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    data.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return data;
}

function makeLocalHeader(name, size, checksum) {
  const bytes = new Uint8Array(30);
  const view = new DataView(bytes.buffer);
  view.setUint32(0, 0x04034b50, true);
  view.setUint16(4, 20, true);
  view.setUint16(6, UTF8_FLAG, true);
  view.setUint16(8, STORE_METHOD, true);
  view.setUint16(10, 0, true);
  view.setUint16(12, DOS_DATE, true);
  view.setUint32(14, checksum, true);
  view.setUint32(18, size, true);
  view.setUint32(22, size, true);
  view.setUint16(26, name.byteLength, true);
  return bytes;
}

function makeCentralHeader(name, size, checksum, offset) {
  const bytes = new Uint8Array(46);
  const view = new DataView(bytes.buffer);
  view.setUint32(0, 0x02014b50, true);
  view.setUint16(4, 20, true);
  view.setUint16(6, 20, true);
  view.setUint16(8, UTF8_FLAG, true);
  view.setUint16(10, STORE_METHOD, true);
  view.setUint16(12, 0, true);
  view.setUint16(14, DOS_DATE, true);
  view.setUint32(16, checksum, true);
  view.setUint32(20, size, true);
  view.setUint32(24, size, true);
  view.setUint16(28, name.byteLength, true);
  view.setUint32(42, offset, true);
  return bytes;
}

function makeEndRecord(count, centralSize, centralOffset) {
  const bytes = new Uint8Array(22);
  const view = new DataView(bytes.buffer);
  view.setUint32(0, 0x06054b50, true);
  view.setUint16(8, count, true);
  view.setUint16(10, count, true);
  view.setUint32(12, centralSize, true);
  view.setUint32(16, centralOffset, true);
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
  if (extension === "png") return "image/png";
  if (extension === "jpg" || extension === "jpeg") return "image/jpeg";
  if (extension === "webp") return "image/webp";
  if (extension === "mp4") return "video/mp4";
  return "application/octet-stream";
}

function ensureUint32(value, message) {
  if (!Number.isSafeInteger(value) || value < 0 || value > 0xffffffff) {
    throw new Error(message);
  }
}

function crc32(bytes) {
  let checksum = 0xffffffff;
  for (const byte of bytes) {
    checksum = CRC_TABLE[(checksum ^ byte) & 0xff] ^ (checksum >>> 8);
  }
  return (checksum ^ 0xffffffff) >>> 0;
}

const CRC_TABLE = new Uint32Array(256);
for (let index = 0; index < CRC_TABLE.length; index += 1) {
  let value = index;
  for (let bit = 0; bit < 8; bit += 1) {
    value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  }
  CRC_TABLE[index] = value >>> 0;
}
