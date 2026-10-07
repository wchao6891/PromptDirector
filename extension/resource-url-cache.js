import { ResourceCache } from './resource-cache.js';

// Encoded preview files and decoded DOM images have different memory costs.
// Keep visited previews by their real file bytes, until this page closes or
// its existing working-memory budget is needed by a newer working set.
export class ResourceUrlCache extends ResourceCache {
  constructor({ maxBytes, protectedValue, maxEntries = Infinity }) {
    const sizes = new Map();
    super({ maxEntries, maxBytes, protectedValue, cost: url => sizes.get(url) || 0,
      dispose: url => { sizes.delete(url); URL.revokeObjectURL(url); } });
    this.sizes = sizes;
  }
  create(key, blob) {
    const url = URL.createObjectURL(blob);
    this.sizes.set(url, blob.size);
    this.set(key, url);
    return url;
  }
  delete(key) {
    const url = super.get(key);
    const deleted = super.delete(key);
    if (deleted) this.release(url);
    return deleted;
  }
}
