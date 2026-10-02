const HEADER_SCAN_BYTES = 1024 * 1024;
const JPEG_START_OF_FRAME = new Set([
  0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7,
  0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf
]);

export async function readImageDimensions(blob) {
  if (!(blob instanceof Blob) || !blob.size) throw invalidDimensions();
  if (blob.type === "image/avif") {
    return avifDimensions(blob);
  }
  const bytes = new Uint8Array(await blob.slice(0, HEADER_SCAN_BYTES).arrayBuffer());
  try {
    if (blob.type === "image/gif") return gifDimensions(bytes);
    if (blob.type === "image/png") return pngDimensions(bytes);
    if (blob.type === "image/jpeg") return jpegDimensions(bytes);
    if (blob.type === "image/webp") return webpDimensions(bytes);
  } catch {
    throw invalidDimensions();
  }
  throw new Error("无法识别支持的图片格式");
}

// AVIF stores dimensions in ISOBMFF image properties. Inspect box headers and
// ispe values without decoding untrusted pixels (or reading the mdat payload).
async function avifDimensions(blob) {
  let scanned = 0, primaryId = null;
  const properties = [], associations = new Map();
  async function payload(start, end) {
    scanned += end - start;
    if (scanned > HEADER_SCAN_BYTES) throw new Error('AVIF 元信息超过本次检查预算；原件保留');
    return new Uint8Array(await blob.slice(start, end).arrayBuffer());
  }
  async function boxes(start, end, inProperties = false) {
    let at = start;
    while (at < end) {
      const bytes = await payload(at, Math.min(at + 16, end));
      if (bytes.length < 8) throw invalidDimensions();
      const view = new DataView(bytes.buffer);
      const kind = text(bytes, 4, 4);
      let size = view.getUint32(0), header = 8;
      if (size === 1) {
        if (bytes.length < 16) throw invalidDimensions();
        size = Number(view.getBigUint64(8)); header = 16;
      } else if (size === 0) size = end - at;
      if (!Number.isSafeInteger(size) || size < header || at + size > end) throw invalidDimensions();
      const body = at + header, stop = at + size;
      if (inProperties) {
        let dimension = null;
        if (kind === 'ispe') {
          if (stop - body < 12) throw invalidDimensions();
          const property = new DataView((await payload(body, body + 12)).buffer);
          dimension = dimensions(property.getUint32(4), property.getUint32(8));
        }
        properties.push(dimension);
      } else if (kind === 'pitm') {
        const item = await payload(body, stop), data = new DataView(item.buffer);
        if (item.length < (item[0] === 0 ? 6 : 8)) throw invalidDimensions();
        primaryId = item[0] === 0 ? data.getUint16(4) : data.getUint32(4);
      } else if (kind === 'ipma') {
        const item = await payload(body, stop), data = new DataView(item.buffer);
        if (item.length < 8) throw invalidDimensions();
        const wide = Boolean(item[3] & 1), version = item[0], count = data.getUint32(4);
        let cursor = 8;
        for (let i = 0; i < count; i++) {
          const id = version === 0 ? data.getUint16(cursor) : data.getUint32(cursor);
          cursor += version === 0 ? 2 : 4;
          const length = data.getUint8(cursor++), indexes = [];
          for (let j = 0; j < length; j++) {
            indexes.push(wide ? data.getUint16(cursor) & 0x7fff : data.getUint8(cursor) & 0x7f);
            cursor += wide ? 2 : 1;
          }
          associations.set(id, indexes);
        }
        if (cursor !== item.length) throw invalidDimensions();
      } else if (['meta', 'iprp', 'ipco'].includes(kind)) {
        const child = body + (kind === 'meta' ? 4 : 0);
        if (child > stop) throw invalidDimensions();
        await boxes(child, stop, kind === 'ipco');
      }
      at = stop;
    }
  }
  try {
    await boxes(0, blob.size);
    const candidates = (associations.get(primaryId) || []).map(index => properties[index - 1]).filter(Boolean);
    if (!candidates.length) throw invalidDimensions();
    return candidates.reduce((largest, value) => value.width * value.height > largest.width * largest.height ? value : largest);
  } catch (error) {
    if (error.message.includes('预算')) throw error;
    throw invalidDimensions();
  }
}

function gifDimensions(bytes) {
  if (bytes.length < 10 || !["GIF87a", "GIF89a"].includes(text(bytes, 0, 6))) throw invalidDimensions();
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return dimensions(view.getUint16(6, true), view.getUint16(8, true));
}

function pngDimensions(bytes) {
  if (bytes.length < 24 ||
    !matches(bytes, 0, [137, 80, 78, 71, 13, 10, 26, 10]) ||
    text(bytes, 12, 4) !== "IHDR") throw invalidDimensions();
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return dimensions(view.getUint32(16, false), view.getUint32(20, false));
}

function jpegDimensions(bytes) {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) throw invalidDimensions();
  let offset = 2;
  while (offset + 4 <= bytes.length) {
    while (bytes[offset] === 0xff) offset += 1;
    const marker = bytes[offset++];
    if (marker === 0xd8 || marker === 0xd9) continue;
    if (marker === 0xda) break;
    const length = (bytes[offset] << 8) | bytes[offset + 1];
    if (length < 2 || offset + length > bytes.length) throw invalidDimensions();
    if (JPEG_START_OF_FRAME.has(marker)) {
      return dimensions(
        (bytes[offset + 5] << 8) | bytes[offset + 6],
        (bytes[offset + 3] << 8) | bytes[offset + 4]
      );
    }
    offset += length;
  }
  throw invalidDimensions();
}

function webpDimensions(bytes) {
  if (bytes.length < 30 || text(bytes, 0, 4) !== "RIFF" || text(bytes, 8, 4) !== "WEBP") throw invalidDimensions();
  const kind = text(bytes, 12, 4);
  if (kind === "VP8X") {
    return dimensions(1 + uint24(bytes, 24), 1 + uint24(bytes, 27));
  }
  if (kind === "VP8 ") {
    if (!matches(bytes, 23, [0x9d, 0x01, 0x2a])) throw invalidDimensions();
    return dimensions(uint16(bytes, 26) & 0x3fff, uint16(bytes, 28) & 0x3fff);
  }
  if (kind === "VP8L" && bytes[20] === 0x2f) {
    const bits = bytes[21] | (bytes[22] << 8) | (bytes[23] << 16) | (bytes[24] << 24);
    return dimensions((bits & 0x3fff) + 1, ((bits >>> 14) & 0x3fff) + 1);
  }
  throw invalidDimensions();
}

function dimensions(width, height) {
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width < 1 || height < 1) throw invalidDimensions();
  return { width, height };
}

function uint16(bytes, offset) {
  return bytes[offset] | (bytes[offset + 1] << 8);
}

function uint24(bytes, offset) {
  return bytes[offset] | (bytes[offset + 1] << 8) | (bytes[offset + 2] << 16);
}

function text(bytes, offset, length) {
  return String.fromCharCode(...bytes.subarray(offset, offset + length));
}

function matches(bytes, offset, values) {
  return values.every((value, index) => bytes[offset + index] === value);
}

function invalidDimensions() {
  return new Error("无法读取图片尺寸");
}
