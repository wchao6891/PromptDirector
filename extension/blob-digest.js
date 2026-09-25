import { sha256 } from "./vendor/noble-hashes/sha2.js";

export async function sha256Blob(blob, { onProgress } = {}) {
  if (!(blob instanceof Blob)) throw new Error("无法计算无效媒体的内容摘要");
  const hash = sha256.create();
  const reader = blob.stream().getReader();
  let completedBytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      hash.update(value);
      completedBytes += value.byteLength;
      if (onProgress) await onProgress({ completedBytes, totalBytes: blob.size });
    }
    return [...hash.digest()].map((value) => value.toString(16).padStart(2, "0")).join("");
  } finally {
    hash.destroy();
    reader.releaseLock();
  }
}

// Scope this to one operation. Fresh disk readback must use fresh Blob objects,
// never a persisted asset id or a caller-supplied contentHash as proof of bytes.
export function createBlobDigestCache() {
  const digests = new WeakMap();
  return async (blob, options) => {
    if (!(blob instanceof Blob)) throw new Error("无法计算无效媒体的内容摘要");
    if (!digests.has(blob)) {
      const pending = sha256Blob(blob, options).catch(error => {
        digests.delete(blob);
        throw error;
      });
      digests.set(blob, pending);
    }
    return digests.get(blob);
  };
}
