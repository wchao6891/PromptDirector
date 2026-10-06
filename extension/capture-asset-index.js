import { entryMediaAssets } from './media.js';

// Saved originals by content hash and id, built once per case list instead of scanning every case
// for each captured file. A replaced or appended list (the capture loop does both after a saved case)
// rebuilds the index; lists keep their first match, the same result as searching the list in order.
export function createCaptureAssetIndex(assetsOf = entryMediaAssets) {
  let source = null;
  let sourceLength = -1;
  let byHash = new Map();
  let byId = new Map();
  const build = entries => {
    if (entries === source && entries.length === sourceLength) return;
    source = entries;
    sourceLength = entries.length;
    byHash = new Map();
    byId = new Map();
    for (const entry of entries) for (const asset of assetsOf(entry)) {
      if (asset.contentHash) {
        const list = byHash.get(asset.contentHash);
        if (list) list.push(asset); else byHash.set(asset.contentHash, [asset]);
      }
      if (!byId.has(asset.id)) byId.set(asset.id, asset);
    }
  };
  return {
    withHash(entries, contentHash) { build(entries); return byHash.get(contentHash) ?? []; },
    withId(entries, id) { build(entries); return byId.get(id); }
  };
}
