import { sha256 } from "./vendor/noble-hashes/sha2.js";
import { operationBudget, RESOURCE_POLICY } from "./resource-policy.js";

const toHex = (bytes) => [...bytes].map((value) => value.toString(16).padStart(2, "0")).join("");

export function nativeDigestMaxBytes(budget) {
  return Math.floor(operationBudget(budget).workingBytes * RESOURCE_POLICY.nativeDigestFraction);
}

export async function sha256Blob(blob, { onProgress, budget } = {}) {
  if (!(blob instanceof Blob)) throw new Error("无法计算无效媒体的内容摘要");
  const subtle = globalThis.crypto?.subtle;
  if (subtle && blob.size <= nativeDigestMaxBytes(budget)) {
    const digest = toHex(new Uint8Array(await subtle.digest("SHA-256", await blob.arrayBuffer())));
    if (onProgress) await onProgress({ completedBytes: blob.size, totalBytes: blob.size });
    return digest;
  }
  // Large originals stream so memory stays bounded regardless of file size.
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
    return toHex(hash.digest());
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
