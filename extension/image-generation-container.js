import { PORTABLE_LIBRARY_LIMITS } from './resource-limits.js';

// Match the existing JSON preparation budget. This bounds parsing, never the
// original file: records beyond it remain in the unchanged original image.
export const GENERATION_TEXT_BUDGET = PORTABLE_LIBRARY_LIMITS.maxLibraryJsonBytes;
const utf8 = bytes => new TextDecoder('utf-8', { fatal: true }).decode(bytes);
const latin = bytes => Array.from(bytes, byte => String.fromCharCode(byte)).join('');
const ascii = (bytes, start, length) => latin(bytes.subarray(start, start + length));
const corrupt = () => new Error('图片生成信息结构损坏；原图保留');

export async function readGenerationTextRecords(blob, { signal } = {}) {
  const records = [], warnings = [];
  let used = 0;
  const check = () => signal?.throwIfAborted();
  async function bytesAt(offset, length) {
    check();
    if (offset < 0 || length < 0 || offset + length > blob.size) throw corrupt();
    const bytes = new Uint8Array(await blob.slice(offset, offset + length).arrayBuffer());
    check();
    return bytes;
  }
  function add(keyword, text, location) {
    used += new TextEncoder().encode(text).length;
    if (used > GENERATION_TEXT_BUDGET) throw new Error('图片生成信息超过文本解析预算；完整信息仍保留在原图');
    records.push({ keyword, text, location });
  }
  async function textBytes(offset, length) {
    if (length > GENERATION_TEXT_BUDGET) throw new Error('图片生成信息超过文本解析预算；完整信息仍保留在原图');
    return bytesAt(offset, length);
  }
  async function inflate(bytes) {
    const reader = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate')).getReader();
    const chunks = []; let size = 0;
    try {
      while (true) {
        check();
        const { done, value } = await reader.read();
        if (done) break;
        size += value.length;
        if (size + used > GENERATION_TEXT_BUDGET) throw new Error('图片生成信息解压后超过文本解析预算；原图保留');
        chunks.push(value);
      }
    } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
    const result = new Uint8Array(size); let at = 0;
    for (const chunk of chunks) { result.set(chunk, at); at += chunk.length; }
    return result;
  }
  function exif(bytes, location) {
    const start = ascii(bytes, 0, 6) === 'Exif\0\0' ? 6 : 0;
    const data = bytes.subarray(start);
    if (data.length < 8) throw corrupt();
    const order = ascii(data, 0, 2);
    if (!['II', 'MM'].includes(order)) throw corrupt();
    const little = order === 'II';
    const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
    const u16 = at => { if (at < 0 || at + 2 > data.length) throw corrupt(); return view.getUint16(at, little); };
    const u32 = at => { if (at < 0 || at + 4 > data.length) throw corrupt(); return view.getUint32(at, little); };
    if (u16(2) !== 42) throw corrupt();
    const queue = [{ at: u32(4), chain: true }], seen = new Set();
    while (queue.length) {
      check();
      const { at, chain } = queue.shift();
      if (!at) continue;
      if (seen.has(at)) throw corrupt();
      seen.add(at);
      const count = u16(at);
      if (at + 2 + count * 12 + (chain ? 4 : 0) > data.length) throw corrupt();
      for (let i = 0; i < count; i++) {
        const entry = at + 2 + i * 12, tag = u16(entry), type = u16(entry + 2), n = u32(entry + 4);
        if (tag === 0x8769 && type === 4 && n === 1) queue.push({ at: u32(entry + 8), chain: false });
        if (![0x9286, 0x010e, 0x010f, 0x0110].includes(tag) || ![1, 2, 7].includes(type)) continue;
        const offset = n <= 4 ? entry + 8 : u32(entry + 8);
        if (offset + n > data.length) throw corrupt();
        const value = data.subarray(offset, offset + n);
        let text;
        if (tag === 0x9286 && ascii(value, 0, 8) === 'UNICODE\0') {
          const body = value.subarray(8);
          const encoding = body[0] === 0xff && body[1] === 0xfe ? 'utf-16le'
            : body[0] === 0xfe && body[1] === 0xff ? 'utf-16be' : 'utf-16be';
          text = new TextDecoder(encoding, { fatal: true }).decode(body);
        } else if (tag === 0x9286 && ascii(value, 0, 8) === 'JIS\0\0\0\0\0') text = new TextDecoder('shift-jis', { fatal: true }).decode(value.subarray(8));
        else if (tag === 0x9286 && ascii(value, 0, 8) === 'ASCII\0\0\0') text = latin(value.subarray(8));
        else text = utf8(value);
        add(({ 37510: 'UserComment', 270: 'ImageDescription', 271: 'Make', 272: 'Model' })[tag], text.replace(/\0+$/u, ''), `${location}:EXIF:${tag}`);
      }
      if (chain) queue.push({ at: u32(at + 2 + count * 12), chain: true });
    }
  }
  try {
    const head = await bytesAt(0, Math.min(12, blob.size));
    if (ascii(head, 1, 3) === 'PNG' && head[0] === 137) {
      let at = 8;
      while (at + 12 <= blob.size) {
        const header = await bytesAt(at, 8);
        const size = new DataView(header.buffer).getUint32(0), kind = ascii(header, 4, 4);
        if (at + size + 12 > blob.size) throw corrupt();
        try {
        if (['tEXt', 'zTXt', 'iTXt', 'eXIf'].includes(kind)) {
          const payload = await textBytes(at + 4, size + 4);
          const expected = new DataView((await bytesAt(at + size + 8, 4)).buffer).getUint32(0);
          if (crc32(payload) !== expected) throw corrupt();
        }
        if (['tEXt', 'zTXt', 'iTXt'].includes(kind)) {
          const b = await textBytes(at + 8, size), zero = b.indexOf(0);
          if (zero < 1 || zero > 79) throw corrupt();
          const key = latin(b.subarray(0, zero));
          let body = b.subarray(zero + 1), text;
          if (kind === 'tEXt') text = latin(body);
          if (kind === 'zTXt') {
            if (body[0] !== 0) throw corrupt();
            text = latin(await inflate(body.subarray(1)));
          }
          if (kind === 'iTXt') {
            if (![0, 1].includes(body[0]) || body[1] !== 0) throw corrupt();
            const compressed = body[0], languageEnd = body.indexOf(0, 2), translatedEnd = body.indexOf(0, languageEnd + 1);
            if (languageEnd < 2 || translatedEnd < 0) throw corrupt();
            body = body.subarray(translatedEnd + 1);
            text = utf8(compressed ? await inflate(body) : body);
          }
          add(key, text, `PNG:${kind}:${at}`);
        }
        if (kind === 'eXIf') exif(await textBytes(at + 8, size), `PNG:${at}`);
        } catch (error) { check(); warnings.push(`${kind}：${error.message}`); }
        at += size + 12;
        if (kind === 'IEND') break;
      }
    } else if (head[0] === 0xff && head[1] === 0xd8) {
      let at = 2;
      while (at < blob.size) {
        let h = await bytesAt(at, 2);
        if (h[0] !== 0xff) throw corrupt();
        while (h[1] === 0xff) h = await bytesAt(++at, 2);
        const marker = h[1]; at += 2;
        if ([0xda, 0xd9].includes(marker)) break;
        if (marker === 1 || (marker >= 0xd0 && marker <= 0xd8)) continue;
        const lengthBytes = await bytesAt(at, 2), size = (lengthBytes[0] << 8) | lengthBytes[1];
        if (size < 2 || at + size > blob.size) throw corrupt();
        if (marker === 0xe1 && size >= 8 && ascii(await bytesAt(at + 2, 6), 0, 6) === 'Exif\0\0') exif(await textBytes(at + 2, size - 2), `JPEG:${at}`);
        at += size;
      }
    } else if (ascii(head, 0, 4) === 'RIFF' && ascii(head, 8, 4) === 'WEBP') {
      const end = new DataView(head.buffer).getUint32(4, true) + 8;
      if (end > blob.size) throw corrupt();
      let at = 12;
      while (at + 8 <= end) {
        const h = await bytesAt(at, 8), size = new DataView(h.buffer).getUint32(4, true);
        if (at + 8 + size > end) throw corrupt();
        if (ascii(h, 0, 4) === 'EXIF') exif(await textBytes(at + 8, size), `WebP:${at}`);
        at += 8 + size + (size % 2);
      }
    }
    return { records, warnings };
  } catch (error) {
    check();
    return { records, warnings: [...warnings, error.message || '图片生成信息无法读取；原图保留'] };
  }
}

// PNG metadata is independently checksummed; damaged ancillary data never
// changes pixel bytes or prevents later valid text chunks from being examined.
function crc32(bytes) {
  let value = 0xffffffff;
  for (const byte of bytes) {
    value ^= byte;
    for (let bit = 0; bit < 8; bit++) value = (value >>> 1) ^ ((value & 1) ? 0xedb88320 : 0);
  }
  return (value ^ 0xffffffff) >>> 0;
}
