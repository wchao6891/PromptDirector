import { sha256Blob } from "./blob-digest.js";
import { libraryStoredAssets } from "./library-asset-inventory.js";

// A media id may be referenced by several cases, trash items or creative runs.
// Compare actual bytes only for repeated ids; package-provided hashes and sizes
// alone cannot prove that two originals are the same.
export async function sharedLibraryMediaFiles(library, files, { signal, digest = sha256Blob } = {}) {
  const pathsById = new Map();
  for (const asset of libraryStoredAssets(library)) {
    const id = String(asset.id || asset.assetId || "").trim();
    const path = asset.assetPath || asset.screenshotPath || asset.archivePath;
    if (!id || !path || !(files.get(path) instanceof Blob)) continue;
    const paths = pathsById.get(id) ?? new Set();
    paths.add(path);
    pathsById.set(id, paths);
  }
  const result = new Map(files);
  const digests = new Map();
  for (const paths of pathsById.values()) {
    if (paths.size < 2 || new Set([...paths].map((path) => files.get(path))).size < 2) continue;
    const originals = new Map();
    for (const path of paths) {
      signal?.throwIfAborted();
      const blob = files.get(path);
      if (!digests.has(blob)) digests.set(blob, await digest(blob));
      signal?.throwIfAborted();
      const key = `${blob.type}:${blob.size}:${digests.get(blob)}`;
      const original = originals.get(key);
      if (original) result.set(path, original);
      else originals.set(key, blob);
    }
  }
  return result;
}

export function mediaIdentity(asset, blob) {
  return { blob, kind: asset.kind, reference: asset.storageMode === "reference" ? asset.reference?.url || asset.sourceUrl || "" : null };
}

export function sameMediaIdentity(left, right) {
  return left.kind === right.kind && left.reference === right.reference && left.blob === right.blob;
}
