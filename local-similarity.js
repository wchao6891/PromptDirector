import { normalizeFacetCatalog } from "./facets.js";

const SHARED_PARENT_SCORE = 0.7;
const NEAR_TERM_SCORE = 0.5;
const NEAR_TERM_THRESHOLD = 0.5;
const GENERIC_FILENAME_TERMS = new Set([
  "copy", "export", "final", "image", "img", "screenshot", "untitled",
  "副本", "导出", "最终", "截图", "未命名"
]);

export function createSimilarityIndex(entries = [], catalogValue, options = {}) {
  const catalog = normalizeFacetCatalog(catalogValue);
  const nodeById = new Map(catalog.nodes.filter((node) => node.status === "active").map((node) => [node.id, node]));
  const facetById = new Map(catalog.facets.filter((facet) => facet.status === "active").map((facet) => [facet.id, facet]));
  const nodeProfileById = new Map([...nodeById.values()].map((node) => [node.id, {
    node,
    facet: facetById.get(node.facetId),
    depth: node.parentId ? 1 : 0,
    terms: nodeTerms(node)
  }]));
  const labByColor = new Map();
  const profiles = new Map();
  const visualForEntry = options.visualForEntry ?? ((entry) => entry.discoveryVisualId);
  const colorsForEntry = options.colorsForEntry ?? ((entry) => entry.discoveryColors);
  const mediaForEntry = options.mediaForEntry ?? ((entry) => entry.mediaAssets ?? []);
  const contentTypesForEntry = options.contentTypesForEntry ?? ((entry) => entry.contentTypeIds ?? [entry.classification?.pathIds?.[0]].filter(Boolean));
  const projectIdsForEntry = options.projectIdsForEntry ?? (() => []);

  for (const entry of entries) {
    const assignments = (entry.facetAssignments ?? []).flatMap((assignment) => {
      if (assignment.status !== "confirmed") return [];
      const profile = nodeProfileById.get(assignment.nodeId);
      if (!profile) return [];
      return [{
        ...profile,
        importance: boundedNumber(assignment.importance, 1)
      }];
    });
    const colors = (colorsForEntry(entry) ?? []).map(normalizeHex).filter(Boolean);
    const media = (mediaForEntry(entry) ?? []).filter((asset) => asset && asset.usage !== "poster");
    profiles.set(entry.id, {
      entry,
      visualId: String(visualForEntry(entry) ?? "").trim(),
      assignments,
      colors,
      labs: colors.map((color) => cachedLab(color, labByColor)).filter(Boolean),
      customLabels: labeledTerms(entry.customLabels),
      contentTypeIds: cleanSet(contentTypesForEntry(entry)),
      projectIds: cleanSet(projectIdsForEntry(entry)),
      mediaKinds: cleanSet(media.map((asset) => asset.kind)),
      fileFormats: cleanSet(media.flatMap((asset) => [asset.sourceFormat, asset.mimeType])),
      fileNameTokens: new Set(media.flatMap((asset) => fileNameTerms(asset.sourceTitle)))
    });
  }
  return { profiles };
}

export function rankSimilarEntries(index, entryId, limit = Number.POSITIVE_INFINITY) {
  const current = index?.profiles?.get(entryId);
  if (!current) return [];
  return [...index.profiles.values()].flatMap((candidate) => {
    if (candidate.entry.id === entryId) return [];
    const content = contentSimilarity(current.assignments, candidate.assignments);
    const palette = paletteSimilarityFromLabs(current.labs, candidate.labs);
    const sharedFacetNames = exactFacetNames(current.assignments, candidate.assignments);
    const sharedLabels = intersectLabeledTerms(current.customLabels, candidate.customLabels);
    const signals = {
      exactFacet: sharedFacetNames.length > 0,
      customLabel: sharedLabels.length > 0,
      semanticFacet: content.score > 0,
      contentType: intersects(current.contentTypeIds, candidate.contentTypeIds),
      project: intersects(current.projectIds, candidate.projectIds),
      mediaKind: intersects(current.mediaKinds, candidate.mediaKinds),
      fileFormat: intersects(current.fileFormats, candidate.fileFormats),
      fileName: jaccard(current.fileNameTokens, candidate.fileNameTokens) > 0,
      palette: current.labs.length > 0 && candidate.labs.length > 0 && palette > 0
    };
    const evidenceBreadth = Object.values(signals).filter(Boolean).length;
    if (!evidenceBreadth) return [];
    const strong = signals.exactFacet || signals.customLabel;
    const organizationalCount = Number(signals.contentType) + Number(signals.project);
    const weakCount = Number(signals.mediaKind) + Number(signals.fileFormat) + Number(signals.fileName) + Number(signals.palette);
    const tier = strong ? 4
      : signals.semanticFacet ? 3
        : organizationalCount >= 2 || (organizationalCount >= 1 && weakCount >= 1) ? 2 : 1;
    const reason = strongestReason({
      signals,
      sharedFacetNames,
      sharedLabels,
      matchedFacetNames: content.matchedFacetNames,
      sharedFormats: intersection(current.fileFormats, candidate.fileFormats)
    });
    return [{
      entry: candidate.entry,
      visualId: candidate.visualId,
      score: tier,
      tier,
      evidenceBreadth,
      reason,
      paletteSimilarity: palette,
      contentSimilarity: content.score,
      matchedFacetNames: content.matchedFacetNames,
      signals
    }];
  }).toSorted((left, right) => right.tier - left.tier
    || right.evidenceBreadth - left.evidenceBreadth
    || right.contentSimilarity - left.contentSimilarity
    || right.paletteSimilarity - left.paletteSimilarity
    || String(right.entry.savedAt || "").localeCompare(String(left.entry.savedAt || ""))
    || left.entry.id.localeCompare(right.entry.id))
    .slice(0, Math.max(0, Math.floor(Number(limit) || 0)));
}

function exactFacetNames(left, right) {
  const rightIds = new Set(right.map((assignment) => assignment.node.id));
  return [...new Set(left.filter((assignment) => rightIds.has(assignment.node.id))
    .map((assignment) => assignment.facet?.name || assignment.node.name).filter(Boolean))].sort();
}

function strongestReason({ signals, sharedFacetNames, sharedLabels, matchedFacetNames, sharedFormats }) {
  if (signals.customLabel) return `相同标签：${sharedLabels[0]}`;
  if (signals.exactFacet) return `相同${sharedFacetNames[0]}`;
  if (signals.semanticFacet) return `相近${matchedFacetNames[0] || "视觉属性"}`;
  if (signals.contentType) return "相同内容类型";
  if (signals.project) return "同一项目";
  if (signals.fileName) return "文件名相近";
  if (signals.fileFormat) return `相同文件类型${sharedFormats[0] ? `：${formatLabel(sharedFormats[0])}` : ""}`;
  if (signals.mediaKind) return "相同媒体类型";
  return "色彩相近";
}

export function paletteSimilarity(leftColors = [], rightColors = []) {
  const left = leftColors.map(normalizeHex).filter(Boolean).map(hexToLab);
  const right = rightColors.map(normalizeHex).filter(Boolean).map(hexToLab);
  return paletteSimilarityFromLabs(left, right);
}

function contentSimilarity(left, right) {
  if (!left.length || !right.length) return { score: 0, matchedFacetNames: [] };
  const leftResult = directionalContentSimilarity(left, right);
  const rightResult = directionalContentSimilarity(right, left);
  const denominator = leftResult.weight + rightResult.weight;
  const score = denominator ? (leftResult.total + rightResult.total) / denominator : 0;
  const matchedFacetNames = [...new Set([...leftResult.facets, ...rightResult.facets])].sort();
  return { score, matchedFacetNames };
}

function directionalContentSimilarity(source, candidates) {
  let total = 0;
  let weight = 0;
  const facets = [];
  for (const assignment of source) {
    const best = candidates.reduce((current, candidate) => {
      const score = assignmentSimilarity(assignment, candidate);
      return score > current.score ? { score, facetName: assignment.facet?.name || "" } : current;
    }, { score: 0, facetName: "" });
    weight += assignment.importance;
    total += best.score * assignment.importance;
    if (best.score > 0 && best.facetName) facets.push(best.facetName);
  }
  return { total, weight, facets };
}

function assignmentSimilarity(left, right) {
  if (left.node.facetId !== right.node.facetId) return 0;
  if (left.node.id === right.node.id) return 1;
  if (left.node.parentId && left.node.parentId === right.node.parentId) return SHARED_PARENT_SCORE;
  if (left.depth !== right.depth) return 0;
  return termsSimilarity(left.terms, right.terms) >= NEAR_TERM_THRESHOLD ? NEAR_TERM_SCORE : 0;
}

function termsSimilarity(left, right) {
  let best = 0;
  for (const leftTerm of left) {
    for (const rightTerm of right) {
      if (leftTerm === rightTerm) return 1;
      if (leftTerm.length >= 3 && rightTerm.length >= 3 && (leftTerm.includes(rightTerm) || rightTerm.includes(leftTerm))) {
        best = Math.max(best, Math.min(leftTerm.length, rightTerm.length) / Math.max(leftTerm.length, rightTerm.length));
      }
      best = Math.max(best, jaccard(characterBigrams(leftTerm), characterBigrams(rightTerm)));
    }
  }
  return best;
}

function nodeTerms(node) {
  return [...new Set([node.name, ...(node.aliases ?? []), ...(node.patterns ?? [])].map(canonical).filter(Boolean))];
}

function characterBigrams(value) {
  if (value.length < 2) return new Set([value]);
  return new Set(Array.from({ length: value.length - 1 }, (_, index) => value.slice(index, index + 2)));
}

function jaccard(left, right) {
  if (!left.size || !right.size) return 0;
  const overlap = [...left].filter((value) => right.has(value)).length;
  return overlap / (left.size + right.size - overlap);
}

function intersects(left, right) {
  return [...left].some((value) => right.has(value));
}

function intersection(left, right) {
  return [...left].filter((value) => right.has(value));
}

function cleanSet(values = []) {
  return new Set((Array.isArray(values) ? values : []).map(canonical).filter(Boolean));
}

function labeledTerms(values = []) {
  const result = new Map();
  for (const value of Array.isArray(values) ? values : []) {
    const label = String(value ?? "").trim();
    const key = canonical(label);
    if (key && !result.has(key)) result.set(key, label);
  }
  return result;
}

function intersectLabeledTerms(left, right) {
  return [...left].flatMap(([key, label]) => right.has(key) ? [label] : []);
}

function fileNameTerms(value) {
  const name = String(value ?? "").normalize("NFKC").toLocaleLowerCase("zh-CN")
    .replace(/\.[\p{L}\p{N}]{1,12}$/u, "")
    .replace(/[([\{][^\])\}]*[\])\}]/gu, " ")
    .replace(/\b(?:\d+|[a-f0-9]{8,})\b/gu, " ");
  return name.split(/[^\p{L}\p{N}]+/gu)
    .map((term) => term.trim())
    .filter((term) => term.length >= 2 && !GENERIC_FILENAME_TERMS.has(term));
}

function formatLabel(value) {
  const normalized = String(value ?? "").trim();
  if (!normalized) return "";
  return normalized.includes("/") ? normalized.split("/").at(-1).toLocaleUpperCase("en-US") : normalized.toLocaleUpperCase("en-US");
}

function paletteSimilarityFromLabs(left, right) {
  if (!left.length || !right.length) return 0;
  const distance = (source, target) => source.reduce((sum, color) => sum + Math.min(...target.map((other) => deltaE76(color, other))), 0) / source.length;
  const symmetricDistance = (distance(left, right) + distance(right, left)) / 2;
  return Math.max(0, Math.min(1, 1 - symmetricDistance / 100));
}

function cachedLab(color, cache) {
  if (!cache.has(color)) cache.set(color, hexToLab(color));
  return cache.get(color);
}

function hexToLab(value) {
  const match = normalizeHex(value)?.match(/^#([0-9A-F]{6})$/);
  if (!match) return null;
  const channel = (offset) => srgbToLinear(parseInt(match[1].slice(offset, offset + 2), 16) / 255);
  const red = channel(0);
  const green = channel(2);
  const blue = channel(4);
  const x = (red * 0.4124564 + green * 0.3575761 + blue * 0.1804375) / 0.95047;
  const y = red * 0.2126729 + green * 0.7151522 + blue * 0.072175;
  const z = (red * 0.0193339 + green * 0.119192 + blue * 0.9503041) / 1.08883;
  const transform = (component) => component > 0.008856 ? Math.cbrt(component) : 7.787 * component + 16 / 116;
  const fx = transform(x);
  const fy = transform(y);
  const fz = transform(z);
  return { l: 116 * fy - 16, a: 500 * (fx - fy), b: 200 * (fy - fz) };
}

function deltaE76(left, right) {
  return Math.hypot(left.l - right.l, left.a - right.a, left.b - right.b);
}

function srgbToLinear(value) {
  return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
}

function normalizeHex(value) {
  const match = String(value ?? "").trim().match(/^#?([0-9a-f]{6})$/i);
  return match ? `#${match[1].toUpperCase()}` : "";
}

function canonical(value) {
  return String(value ?? "").normalize("NFKC").toLocaleLowerCase("zh-CN").replace(/[\s\p{P}\p{S}]+/gu, "");
}

function boundedNumber(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(0, Math.min(1, number)) : fallback;
}
