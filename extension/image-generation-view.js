import { normalizeGenerationInfo, readImageGenerationInfo } from './image-generation-info.js';

// A view projection, never a migration or a prompt writer. Keep only the open
// case cached so reading old originals does not become a library-wide scan.
export function createGenerationInfoViewReader(readBlob) {
  let caseId;
  let cache = new Map();
  return async function read(entry) {
    if (caseId !== entry.id) { caseId = entry.id; cache = new Map(); }
    const currentCache = cache;
    const mediaAssets = [];
    for (const asset of entry.mediaAssets ?? []) {
      if (asset.kind !== 'image' || asset.usage === 'poster' || normalizeGenerationInfo(asset.generationInfo)) {
        mediaAssets.push(asset);
        continue;
      }
      const key = JSON.stringify([asset.id, asset.contentHash, asset.byteSize, asset.capturedAt]);
      if (!currentCache.has(key)) currentCache.set(key, (async () => {
        const blob = await readBlob(asset.id);
        return blob ? readImageGenerationInfo(blob) : null;
      })());
      try {
        const generationInfo = await currentCache.get(key);
        mediaAssets.push(generationInfo ? { ...asset, generationInfo } : asset);
      } catch (error) {
        currentCache.delete(key);
        console.warn('[generation-info] Original metadata read failed', error?.name || 'Error');
        mediaAssets.push(asset);
      }
    }
    return { ...entry, mediaAssets };
  };
}
