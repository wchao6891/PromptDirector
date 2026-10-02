import { entryMediaAssets } from './media.js';
import { sha256Blob } from './blob-digest.js';

// Reuse only a current managed original whose actual bytes match the uploaded
// file. Metadata hashes narrow the search; they never prove byte integrity.
export async function reusableAgentFile(record, state, readBlob) {
  if (record.purpose) return null;
  const assets = (state.entries || []).flatMap(entryMediaAssets);
  const seen = new Set();
  for (const asset of assets) {
    if (seen.has(asset.id)) continue;
    seen.add(asset.id);
    if (!['image', 'video', 'audio'].includes(asset.kind) || asset.storageMode !== 'managed'
      || asset.byteSize !== record.byteSize || asset.mimeType !== record.mimeType
      || asset.contentHash && asset.contentHash !== record.sha256) continue;
    const blob = await readBlob(asset.id);
    if (!blob || blob.size !== record.byteSize || await sha256Blob(blob) !== record.sha256) continue;
    const poster = asset.posterAssetId ? assets.find(item => item.id === asset.posterAssetId) : null;
    if (asset.posterAssetId && (!poster || !await readBlob(poster.id))) continue;
    const { derivedFromAssetId, ...original } = asset;
    return { asset: { ...original, sourceTitle: record.name, usage: 'content' },
      poster: poster ? { ...poster, usage: 'poster', derivedFromAssetId: asset.id } : null, contentText: '', warnings: [] };
  }
  return null;
}
