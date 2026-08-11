import { normalizeFacetCatalog } from "./facets.js";
import { entrySearchText } from "./library-model.js";
import { entryMediaAssets } from "./media.js";
import { parseSearchQuery } from "./search-query.js";

export function buildSearchIndex(entries = [], catalogValue, documentTextByAsset = new Map(), derivedMetadataByAsset = new Map()) {
  const catalog = normalizeFacetCatalog(catalogValue);
  const nodeById = new Map(catalog.nodes.map((node) => [node.id, node]));
  return entries.map((entry) => {
    const mediaAssets = entryMediaAssets(entry);
    const sources = [entry.url, ...(entry.sourcePages ?? []).flatMap((source) => [source.url, source.title]),
      ...mediaAssets.flatMap((asset) => [asset.sourceUrl, asset.sourceTitle, asset.reference?.url])];
    const notes = [entry.text, ...(entry.timeNotes ?? []).map((note) => note.text)];
    const tags = [
      ...(entry.customLabels ?? []),
      ...(entry.facetAssignments ?? []).filter((item) => item.status === "confirmed").flatMap((item) => {
        const node = nodeById.get(item.nodeId);
        return node ? [node.name, ...(node.aliases ?? [])] : [];
      })
    ];
    return {
      id: entry.id,
      fullText: clean([entrySearchText(entry, catalog, nodeById), ...mediaAssets.map((asset) => documentTextByAsset.get(asset.id))].filter(Boolean).join("\n")),
      sources: clean(sources.join("\n")),
      notes: clean(notes.join("\n")),
      tags: clean(tags.join("\n")),
      colors: mediaAssets.flatMap((asset) =>
        asset.palette?.colors ?? derivedMetadataByAsset.get(asset.id)?.palette?.colors ?? []
      ).map(normalizeColor),
      kinds: new Set(mediaAssets.map((asset) => asset.kind)),
      hasMedia: mediaAssets.length > 0,
      isNote: !mediaAssets.length && Boolean(String(entry.text ?? "").trim()),
      savedDate: validDatePrefix(entry.savedAt)
    };
  });
}

export function searchIndexedEntries(index = [], queryValue = "") {
  const query = parseSearchQuery(queryValue);
  if (!query.terms.length && !query.filters.length) return new Set(index.map((item) => item.id));
  return new Set(index.filter((document) =>
    query.terms.every((term) => document.fullText.includes(term)) &&
    query.filters.every((filter) => matchesFilter(document, filter))
  ).map((item) => item.id));
}

function matchesFilter(document, filter) {
  const value = filter.value;
  if (filter.name === "type" || filter.name === "has") {
    if (value === "media") return document.hasMedia;
    if (value === "note") return document.isNote;
    return document.kinds.has(normalizeKind(value));
  }
  if (filter.name === "source") return document.sources.includes(value);
  if (filter.name === "note") return document.notes.includes(value);
  if (filter.name === "tag") return document.tags.includes(value);
  if (filter.name === "color") {
    const wanted = normalizeColor(value);
    return document.colors.some((color) => color.includes(wanted));
  }
  if (filter.name === "date") return matchesDate(document.savedDate, value);
  return false;
}

function matchesDate(savedDate, query) {
  if (!savedDate) return false;
  if (!query.includes("..")) return savedDate.startsWith(query);
  const [start, end] = query.split("..", 2);
  return (!start || savedDate >= start) && (!end || savedDate <= end);
}

function validDatePrefix(value) {
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString().slice(0, 10) : "";
}

function normalizeKind(value) {
  return ({ 图片: "image", 图像: "image", 视频: "video", 文档: "document", pdf: "document" })[value] || value;
}

function normalizeColor(value) {
  return String(value ?? "").toLocaleLowerCase("en-US").replace(/^#/, "");
}

function clean(value) {
  return String(value ?? "").toLocaleLowerCase("zh-CN");
}
