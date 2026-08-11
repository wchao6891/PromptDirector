const HEADER_SCAN_BYTES = 1024 * 1024;
const JPEG_START_OF_FRAME = new Set([
  0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7,
  0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf
]);

export async function readImageDimensions(blob) {
  if (!(blob instanceof Blob) || !blob.size) throw invalidDimensions();
  const bytes = new Uint8Array(await blob.slice(0, HEADER_SCAN_BYTES).arrayBuffer());
  try {
    if (blob.type === "image/png") return pngDimensions(bytes);
    if (blob.type === "image/jpeg") return jpegDimensions(bytes);
    if (blob.type === "image/webp") return webpDimensions(bytes);
  } catch {
    throw invalidDimensions();
  }
  throw new Error("只支持 PNG、JPEG 或 WebP 图片");
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
