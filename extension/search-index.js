import { normalizeFacetCatalog } from "./facets.js";
import { entrySearchText } from "./library-model.js";
import { entryMediaAssets } from "./media.js";
import { matchesSearchDocument, parseSearchQuery, searchFieldsForEntry } from "./search-query.js";
import { sha256 } from "./vendor/noble-hashes/sha2.js";
import { bytesToHex } from "./vendor/noble-hashes/utils.js";

// Chrome messages/storage and file readers can return different object-key
// orders for the same content. Versions depend on meaning, not transport order.
export function serializeSearchValue(value) {
  return JSON.stringify(value, (_key, item) => item instanceof Set ? [...item].sort()
    : item && typeof item === 'object' && !Array.isArray(item)
      ? Object.fromEntries(Object.keys(item).sort().map(key => [key, item[key]])) : item);
}

const encoder = new TextEncoder();
// Version searchable facts and returned candidates, excluding host-only display
// decorations. A compact content digest keeps pagination independent of text size.
export function searchResultVersion(entry, index) {
  return bytesToHex(sha256(encoder.encode(serializeSearchValue({
    id: entry.id, title: entry.title, text: entry.text || '', url: entry.url || '',
    savedAt: entry.savedAt, tags: entry.customLabels || [], media: entryMediaAssets(entry), sourceFacts: entry.sourceFacts,
    memberSources: entry.memberEntries?.map(member => ({ id: member.id, sourceFacts: member.sourceFacts })), index
  }))));
}

export function buildSearchIndex(entries = [], catalogValue, documentTextByAsset = new Map(), derivedMetadataByAsset = new Map(), { lazy = false } = {}) {
  const catalog = normalizeFacetCatalog(catalogValue);
  const nodeById = new Map(catalog.nodes.map((node) => [node.id, node]));
  return entries.map(entry => lazy
    ? new DeferredSearchDocument(entry.id, () => indexEntry(entry, catalog, nodeById, documentTextByAsset, derivedMetadataByAsset))
    : indexEntry(entry, catalog, nodeById, documentTextByAsset, derivedMetadataByAsset));
}

// A gallery without a query needs only IDs. Build each complete document on its first search,
// synchronously, so the first query has the same full results as every subsequent query.
class DeferredSearchDocument {
  #build;
  #value;
  constructor(id, build) { this.id = id; this.#build = build; }
  #document() {
    if (!this.#value) { this.#value = this.#build(); this.#build = null; }
    return this.#value;
  }
  get fullText() { return this.#document().fullText; }
  get sources() { return this.#document().sources; }
  get notes() { return this.#document().notes; }
  get tags() { return this.#document().tags; }
  get colors() { return this.#document().colors; }
  get kinds() { return this.#document().kinds; }
  get hasMedia() { return this.#document().hasMedia; }
  get isNote() { return this.#document().isNote; }
  get savedDate() { return this.#document().savedDate; }
  toJSON() { return this.#document(); }
}

function indexEntry(entry, catalog, nodeById, documentTextByAsset, derivedMetadataByAsset) {
    const mediaAssets = entryMediaAssets(entry);
    return {
      id: entry.id,
      fullText: clean([entrySearchText(entry, catalog, nodeById), ...mediaAssets.map((asset) => documentTextByAsset.get(asset.id))].filter(Boolean).join("\n")),
      ...searchFieldsForEntry(entry, nodeById, derivedMetadataByAsset)
    };
}

// Most storage snapshots keep the same key order. Compare their exact JSON
// first; canonical sorting is only needed when those snapshots differ.
function snapshot(value) {
  return JSON.stringify(value, (_key, item) => item instanceof Set ? [...item].sort() : item);
}

// A frozen case object cannot change, so its snapshot is computed once per object. The shared
// case library snapshot is frozen and reused while unchanged, which keeps repeated queries cheap.
const frozenSnapshots = new WeakMap();
function entrySnapshot(entry) {
  if (!Object.isFrozen(entry)) return snapshot(entry);
  let value = frozenSnapshots.get(entry);
  if (value === undefined) frozenSnapshots.set(entry, value = snapshot(entry));
  return value;
}

// Cache only derived search rows, never library truth. Fresh document text and
// metadata participate in the signature even when the case timestamp is unchanged.
export function createSearchIndexCache() {
  const rows = new Map();
  let catalogSignature, catalog, nodeById;
  return {
    build(entries, catalogValue, documents = new Map(), derived = new Map(), activeIds = new Set(entries.map(e => e.id))) {
      const nextCatalog = serializeSearchValue(catalogValue ?? null);
      if (catalogSignature !== nextCatalog) {
        catalogSignature = nextCatalog;
        catalog = normalizeFacetCatalog(catalogValue);
        nodeById = new Map(catalog.nodes.map(node => [node.id, node]));
        rows.clear();
      }
      for (const id of rows.keys()) if (!activeIds.has(id)) rows.delete(id);
      let rebuilt = 0;
      const selected = new WeakMap();
      const index = entries.map(entry => {
        const assets = entryMediaAssets(entry);
        const signature = `[${entrySnapshot(entry)},${snapshot(assets.map(asset => [asset.id, documents.get(asset.id), derived.get(asset.id)]))}]`;
        let row = rows.get(entry.id);
        const same = row && (row.signature === signature ||
          (row.canonical ??= serializeSearchValue(JSON.parse(row.signature))) === serializeSearchValue(JSON.parse(signature)));
        if (!same) {
          row = { signature, document: indexEntry(entry, catalog, nodeById, documents, derived) };
          rows.set(entry.id, row); rebuilt++;
        } else row.signature = signature;
        selected.set(entry, row);
        return row.document;
      });
      return { index, rebuilt, reused: entries.length - rebuilt,
        resultVersion(entry, document) {
          // Capture this build's rows: another query may update the cache while
          // a caller still holds an earlier snapshot. Never consult the live map.
          const row = selected.get(entry);
          if (!row || row.document !== document) return searchResultVersion(entry, document);
          return row.resultVersion ??= searchResultVersion(entry, document);
        }
      };
    }
  };
}

export function searchIndexedEntries(index = [], queryValue = "") {
  const query = parseSearchQuery(queryValue);
  if (!query.terms.length && !query.filters.length) return new Set(index.map((item) => item.id));
  return new Set(index.filter(document => matchesSearchDocument(document, query)).map(item => item.id));
}

function clean(value) {
  return String(value ?? "").toLocaleLowerCase("zh-CN");
}
