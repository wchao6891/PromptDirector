import { normalizeEntryMedia } from "./media.js";
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
  const query = typeof queryValue === "string" ? parseSearchQuery(queryValue) : queryValue;
  const entry = normalizeEntryMedia(entryValue);
  const searchable = String(fullText).toLocaleLowerCase("zh-CN");
  if (query.terms.some((term) => !searchable.includes(term))) return false;
  return query.filters.every((filter) => matchesFilter(entry, filter, catalogValue));
}

function matchesFilter(entry, filter, catalogValue) {
  const value = filter.value;
  if (filter.name === "type" || filter.name === "has") {
    if (value === "media") return entry.mediaAssets.length > 0;
    if (value === "note") return !entry.mediaAssets.length && Boolean(clean(entry.text));
    return entry.mediaAssets.some((asset) => asset.kind === normalizeKind(value));
  }
  if (filter.name === "source") {
    return [entry.url, ...(entry.sourcePages ?? []).flatMap((source) => [source.url, source.title]),
      ...entry.mediaAssets.flatMap((asset) => [asset.sourceUrl, asset.sourceTitle, asset.reference?.url])]
      .some((item) => clean(item).toLocaleLowerCase("zh-CN").includes(value));
  }
  if (filter.name === "note") {
    return [entry.text, ...(entry.timeNotes ?? []).map((note) => note.text)]
      .some((item) => clean(item).toLocaleLowerCase("zh-CN").includes(value));
  }
  if (filter.name === "color") {
    const wanted = value.replace(/^#/, "");
    return entry.mediaAssets.flatMap((asset) => asset.palette?.colors ?? [])
      .some((color) => clean(color).toLocaleLowerCase("en-US").replace(/^#/, "").includes(wanted));
  }
  if (filter.name === "date") return matchesDate(entry.savedAt, value);
  if (filter.name === "tag") {
    const catalog = normalizeFacetCatalog(catalogValue);
    const nodeById = new Map(catalog.nodes.map((node) => [node.id, node]));
    const labels = [
      ...(entry.customLabels ?? []),
      ...(entry.facetAssignments ?? []).filter((item) => item.status === "confirmed")
        .flatMap((item) => {
          const node = nodeById.get(item.nodeId);
          return node ? [node.name, ...(node.aliases ?? [])] : [];
        })
    ];
    return labels.some((label) => clean(label).toLocaleLowerCase("zh-CN").includes(value));
  }
  return false;
}

function matchesDate(savedAt, query) {
  const timestamp = Date.parse(savedAt);
  if (!Number.isFinite(timestamp)) return false;
  if (!query.includes("..")) return new Date(timestamp).toISOString().slice(0, 10).startsWith(query);
  const [startValue, endValue] = query.split("..", 2);
  const start = startValue ? Date.parse(startValue) : Number.NEGATIVE_INFINITY;
  const end = endValue ? Date.parse(`${endValue}T23:59:59.999Z`) : Number.POSITIVE_INFINITY;
  return (Number.isFinite(start) || start === Number.NEGATIVE_INFINITY) &&
    (Number.isFinite(end) || end === Number.POSITIVE_INFINITY) && timestamp >= start && timestamp <= end;
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
