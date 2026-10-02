import { endianness } from "node:os";

export const NATIVE_TO_CHROME_MAX = 1024 * 1024;
export const NATIVE_FROM_CHROME_MAX = 64 * 1024 * 1024;
const littleEndian = endianness() === "LE";

export function encodeFrame(value, maxBytes = NATIVE_TO_CHROME_MAX) {
  const data = Buffer.from(JSON.stringify(value));
  if (data.length > maxBytes) throw new Error("Protocol message exceeds frame capacity; use chunked data transfer.");
  const header = Buffer.alloc(4);
  if (littleEndian) header.writeUInt32LE(data.length); else header.writeUInt32BE(data.length);
  return Buffer.concat([header, data]);
}

export function frameDecoder(onMessage, maxBytes = NATIVE_FROM_CHROME_MAX) {
  const chunks = [];
  let buffered = 0;
  let size = null;
  const take = length => {
    if (chunks[0].length >= length) {
      const result = chunks[0].subarray(0, length);
      if (chunks[0].length === length) chunks.shift();
      else chunks[0] = chunks[0].subarray(length);
      buffered -= length;
      return result;
    }
    const result = Buffer.allocUnsafe(length);
    let offset = 0;
    while (offset < length) {
      const count = Math.min(length - offset, chunks[0].length);
      chunks[0].copy(result, offset, 0, count);
      offset += count;
      if (count === chunks[0].length) chunks.shift();
      else chunks[0] = chunks[0].subarray(count);
    }
    buffered -= length;
    return result;
  };
  return chunk => {
    if (chunk.length) { chunks.push(chunk); buffered += chunk.length; }
    while (true) {
      if (size === null) {
        if (buffered < 4) return;
        const header = take(4);
        size = littleEndian ? header.readUInt32LE(0) : header.readUInt32BE(0);
        if (!size || size > maxBytes) throw new Error("Invalid protocol frame size.");
      }
      if (buffered < size) return;
      const value = JSON.parse(take(size).toString("utf8"));
      size = null;
      onMessage(value);
    }
  };
}
