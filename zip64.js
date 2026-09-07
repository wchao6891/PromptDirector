// PKWARE APPNOTE: ZIP64 extended information and end-of-directory records.
export const ZIP32_MAX = 0xffffffff;
export const ZIP16_MAX = 0xffff;

export function zipSafeInteger(value) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 0) throw new Error("ZIP 数值超出可精确处理范围");
  return number;
}

export function zip64Extra(values) {
  if (!values.length) return new Uint8Array();
  const bytes = new Uint8Array(4 + values.length * 8);
  const view = new DataView(bytes.buffer);
  view.setUint16(0, 1, true);
  view.setUint16(2, values.length * 8, true);
  values.forEach((value, index) => view.setBigUint64(4 + index * 8, BigInt(zipSafeInteger(value)), true));
  return bytes;
}

export function resolveZip64Extra(bytes, fields) {
  const needed = Object.entries(fields).filter(([key, value]) => value === (key === "disk" ? ZIP16_MAX : ZIP32_MAX));
  if (!needed.length) return fields;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  for (let offset = 0; offset + 4 <= bytes.length;) {
    const id = view.getUint16(offset, true);
    const length = view.getUint16(offset + 2, true);
    const end = offset + 4 + length;
    if (end > bytes.length) throw new Error("ZIP 扩展字段已损坏");
    if (id === 1) {
      let cursor = offset + 4;
      const resolved = { ...fields };
      for (const [key] of needed) {
        const width = key === "disk" ? 4 : 8;
        if (cursor + width > end) throw new Error("ZIP64 扩展字段不完整");
        resolved[key] = zipSafeInteger(width === 4 ? view.getUint32(cursor, true) : view.getBigUint64(cursor, true));
        cursor += width;
      }
      return resolved;
    }
    offset = end;
  }
  throw new Error("ZIP64 扩展字段缺失");
}

export async function readZip64Directory(archive, endOffset) {
  if (endOffset < 20) throw new Error("ZIP64 目录定位记录缺失");
  const locator = new DataView(await archive.slice(endOffset - 20, endOffset).arrayBuffer());
  if (locator.getUint32(0, true) !== 0x07064b50) throw new Error("ZIP64 目录定位记录缺失");
  if (locator.getUint32(4, true) || locator.getUint32(16, true) !== 1) throw new Error("暂不支持分卷 ZIP");
  const recordOffset = zipSafeInteger(locator.getBigUint64(8, true));
  if (recordOffset + 56 > endOffset - 20) throw new Error("ZIP64 目录记录已损坏");
  const view = new DataView(await archive.slice(recordOffset, recordOffset + 56).arrayBuffer());
  if (view.getUint32(0, true) !== 0x06064b50 ||
    recordOffset + 12 + zipSafeInteger(view.getBigUint64(4, true)) !== endOffset - 20) {
    throw new Error("ZIP64 目录记录已损坏");
  }
  const fileCount = zipSafeInteger(view.getBigUint64(32, true));
  if (view.getUint32(16, true) || view.getUint32(20, true) ||
    zipSafeInteger(view.getBigUint64(24, true)) !== fileCount) throw new Error("暂不支持分卷 ZIP");
  return {
    fileCount,
    directorySize: zipSafeInteger(view.getBigUint64(40, true)),
    directoryOffset: zipSafeInteger(view.getBigUint64(48, true)),
    directoryEnd: recordOffset
  };
}

export function makeZipEndRecords(count, size, offset) {
  [count, size, offset].forEach(zipSafeInteger);
  const zip64 = count >= ZIP16_MAX || size >= ZIP32_MAX || offset >= ZIP32_MAX;
  const end = new Uint8Array(22);
  const view = new DataView(end.buffer);
  view.setUint32(0, 0x06054b50, true);
  view.setUint16(8, Math.min(count, ZIP16_MAX), true);
  view.setUint16(10, Math.min(count, ZIP16_MAX), true);
  view.setUint32(12, Math.min(size, ZIP32_MAX), true);
  view.setUint32(16, Math.min(offset, ZIP32_MAX), true);
  if (!zip64) return [end];
  const record = new Uint8Array(56);
  const r = new DataView(record.buffer);
  r.setUint32(0, 0x06064b50, true);
  r.setBigUint64(4, 44n, true);
  r.setUint16(12, 45, true);
  r.setUint16(14, 45, true);
  r.setBigUint64(24, BigInt(count), true);
  r.setBigUint64(32, BigInt(count), true);
  r.setBigUint64(40, BigInt(size), true);
  r.setBigUint64(48, BigInt(offset), true);
  const locator = new Uint8Array(20);
  const l = new DataView(locator.buffer);
  l.setUint32(0, 0x07064b50, true);
  l.setBigUint64(8, BigInt(zipSafeInteger(offset + size)), true);
  l.setUint32(16, 1, true);
  return [record, locator, end];
}
