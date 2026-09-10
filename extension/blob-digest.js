import { sha256 } from "./vendor/noble-hashes/sha2.js";

export async function sha256Blob(blob) {
  if (!(blob instanceof Blob)) throw new Error("无法计算无效媒体的内容摘要");
  const hash = sha256.create();
  const reader = blob.stream().getReader();
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      hash.update(value);
    }
    return [...hash.digest()].map((value) => value.toString(16).padStart(2, "0")).join("");
  } finally {
    hash.destroy();
    reader.releaseLock();
  }
}
