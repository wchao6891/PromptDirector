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
  let pending = Buffer.alloc(0);
  return chunk => {
    pending = Buffer.concat([pending, chunk]);
    while (pending.length >= 4) {
      const size = littleEndian ? pending.readUInt32LE(0) : pending.readUInt32BE(0);
      if (!size || size > maxBytes) throw new Error("Invalid protocol frame size.");
      if (pending.length < size + 4) return;
      const value = JSON.parse(pending.subarray(4, size + 4).toString("utf8"));
      pending = pending.subarray(size + 4);
      onMessage(value);
    }
  };
}
