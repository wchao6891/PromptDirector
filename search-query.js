import { entryMediaAssets } from "./media.js";
import { normalizeFacetCatalog } from "./facets.js";

const OPERATORS = new Set(["type", "source", "tag", "color", "date", "note", "has"]);

export function parseSearchQuery(value = "") {
  const filters = [];
  const terms = [];
  for (const token of tokenize(String(value))) {
    const separator = token.indexOf(":");
    const name = separator > 0 ? token.slice(0, separator).toLocaleLowerCase("en-US") : "";
    const operand = separator > 0 ? clean(token.slice(separator + 1)) : "";
    if (OPERATORS.has(name) && operand) filters.push({ name, value: operand.toLocaleLowerCase("zh-CN") });
    else if (clean(token)) terms.push(clean(token).toLocaleLowerCase("zh-CN"));
  }
  return { terms, filters };
}

export function matchesSearchQuery(entryValue, queryValue, catalogValue, fullText = "") {
  const catalog = normalizeFacetCatalog(catalogValue);
  const nodeById = new Map(catalog.nodes.map(node => [node.id, node]));
  return matchesSearchDocument({
    ...searchFieldsForEntry(entryValue, nodeById),
    fullText: searchText(fullText)
  }, queryValue);
}

export function searchFieldsForEntry(entry, nodeById, derivedMetadataByAsset = new Map()) {
  const mediaAssets = entryMediaAssets(entry);
  const sources = [entry.url, ...(entry.sourcePages ?? []).flatMap(source => [source.url, source.title]),
    ...mediaAssets.flatMap(asset => [asset.sourceUrl, asset.sourceTitle, asset.reference?.url])];
  const notes = [entry.text, ...(entry.timeNotes ?? []).map(note => note.text)];
  const tags = [
    ...(entry.customLabels ?? []),
    ...(entry.facetAssignments ?? []).filter(item => item.status === "confirmed").flatMap(item => {
      const node = nodeById.get(item.nodeId);
      return node ? [node.name, ...(node.aliases ?? [])] : [];
    })
  ];
  const timestamp = Date.parse(entry.savedAt);
  return {
    sources: searchText(sources.join("\n")),
    notes: searchText(notes.join("\n")),
    tags: searchText(tags.join("\n")),
    colors: mediaAssets.flatMap(asset =>
      asset.palette?.colors ?? derivedMetadataByAsset.get(asset.id)?.palette?.colors ?? []
    ).map(normalizeSearchColor),
    kinds: new Set(mediaAssets.map(asset => asset.kind)),
    hasMedia: mediaAssets.length > 0,
    isNote: !mediaAssets.length && Boolean(String(entry.text ?? "").trim()),
    savedDate: Number.isFinite(timestamp) ? new Date(timestamp).toISOString().slice(0, 10) : ""
  };
}

export function matchesSearchDocument(document, queryValue = "") {
  const query = typeof queryValue === "string" ? parseSearchQuery(queryValue) : queryValue;
  return query.terms.every(term => document.fullText.includes(term)) &&
    query.filters.every(filter => matchesFilter(document, filter));
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
    const wanted = normalizeSearchColor(value);
    return document.colors.some(color => color.includes(wanted));
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

function normalizeSearchColor(value) {
  return searchText(value).replace(/^#/, "");
}

function searchText(value) {
  return String(value ?? "").toLocaleLowerCase("zh-CN");
}

function normalizeKind(value) {
  return ({ 图片: "image", 图像: "image", 视频: "video", 文档: "document", pdf: "document" })[value] || value;
}

function tokenize(value) {
  const tokens = [];
  let current = "";
  let quote = "";
  for (const character of value) {
    if (quote) {
      if (character === quote) quote = "";
      else current += character;
    } else if (character === "\"" || character === "'") quote = character;
    else if (/\s/u.test(character)) {
      if (current) tokens.push(current);
      current = "";
    } else current += character;
  }
  if (current) tokens.push(current);
  return tokens;
}

function clean(value) {
  return String(value ?? "").replace(/[\u0000-\u001f\u007f]/g, "").trim();
}
