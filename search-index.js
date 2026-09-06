import { normalizeFacetCatalog } from "./facets.js";
import { entrySearchText } from "./library-model.js";
import { entryMediaAssets } from "./media.js";
import { matchesSearchDocument, parseSearchQuery, searchFieldsForEntry } from "./search-query.js";

export function buildSearchIndex(entries = [], catalogValue, documentTextByAsset = new Map(), derivedMetadataByAsset = new Map()) {
  const catalog = normalizeFacetCatalog(catalogValue);
  const nodeById = new Map(catalog.nodes.map((node) => [node.id, node]));
  return entries.map((entry) => {
    const mediaAssets = entryMediaAssets(entry);
    return {
      id: entry.id,
      fullText: clean([entrySearchText(entry, catalog, nodeById), ...mediaAssets.map((asset) => documentTextByAsset.get(asset.id))].filter(Boolean).join("\n")),
      ...searchFieldsForEntry(entry, nodeById, derivedMetadataByAsset)
    };
  });
}

export function searchIndexedEntries(index = [], queryValue = "") {
  const query = parseSearchQuery(queryValue);
  if (!query.terms.length && !query.filters.length) return new Set(index.map((item) => item.id));
  return new Set(index.filter(document => matchesSearchDocument(document, query)).map(item => item.id));
}

function clean(value) {
  return String(value ?? "").toLocaleLowerCase("zh-CN");
}
