import { normalizeFacetCatalog } from "./facets.js";
import { entrySearchText } from "./library-model.js";
import { entryMediaAssets } from "./media.js";
import { matchesSearchDocument, parseSearchQuery, searchFieldsForEntry } from "./search-query.js";

// Chrome messages/storage and file readers can return different object-key
// orders for the same content. Versions depend on meaning, not transport order.
export function serializeSearchValue(value) {
  return JSON.stringify(value, (_key, item) => item instanceof Set ? [...item].sort()
    : item && typeof item === 'object' && !Array.isArray(item)
      ? Object.fromEntries(Object.keys(item).sort().map(key => [key, item[key]])) : item);
}

export function buildSearchIndex(entries = [], catalogValue, documentTextByAsset = new Map(), derivedMetadataByAsset = new Map()) {
  const catalog = normalizeFacetCatalog(catalogValue);
  const nodeById = new Map(catalog.nodes.map((node) => [node.id, node]));
  return entries.map(entry => indexEntry(entry, catalog, nodeById, documentTextByAsset, derivedMetadataByAsset));
}

function indexEntry(entry, catalog, nodeById, documentTextByAsset, derivedMetadataByAsset) {
    const mediaAssets = entryMediaAssets(entry);
    return {
      id: entry.id,
      fullText: clean([entrySearchText(entry, catalog, nodeById), ...mediaAssets.map((asset) => documentTextByAsset.get(asset.id))].filter(Boolean).join("\n")),
      ...searchFieldsForEntry(entry, nodeById, derivedMetadataByAsset)
    };
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
      const index = entries.map(entry => {
        const assets = entryMediaAssets(entry);
        const signature = serializeSearchValue([entry, assets.map(asset => [asset.id, documents.get(asset.id), derived.get(asset.id)])]);
        let row = rows.get(entry.id);
        if (!row || row.signature !== signature) {
          row = { signature, document: indexEntry(entry, catalog, nodeById, documents, derived) };
          rows.set(entry.id, row); rebuilt++;
        }
        return row.document;
      });
      return { index, rebuilt, reused: entries.length - rebuilt };
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
