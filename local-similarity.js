import { normalizeFacetCatalog } from "./facets.js";

const PALETTE_WEIGHT = 0.2;
const CONTENT_WEIGHT = 0.8;
const PALETTE_ONLY_WEIGHT = 0.15;
const SHARED_PARENT_SCORE = 0.7;
const NEAR_TERM_SCORE = 0.5;
const NEAR_TERM_THRESHOLD = 0.5;

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
    profiles.set(entry.id, {
      entry,
      visualId: String(visualForEntry(entry) ?? "").trim(),
      assignments,
      colors,
      labs: colors.map((color) => cachedLab(color, labByColor)).filter(Boolean)
    });
  }
  return { profiles };
}

export function rankSimilarEntries(index, entryId, limit = 4) {
  const current = index?.profiles?.get(entryId);
  if (!current) return [];
  return [...index.profiles.values()].flatMap((candidate) => {
    if (candidate.entry.id === entryId || !candidate.visualId) return [];
    const content = contentSimilarity(current.assignments, candidate.assignments);
    const palette = paletteSimilarityFromLabs(current.labs, candidate.labs);
    const hasBothPalettes = current.labs.length > 0 && candidate.labs.length > 0;
    const score = content.score > 0
      ? hasBothPalettes
        ? palette * PALETTE_WEIGHT + content.score * CONTENT_WEIGHT
        : content.score
      : hasBothPalettes
        ? palette * PALETTE_ONLY_WEIGHT
        : 0;
    if (score <= 0) return [];
    return [{
      entry: candidate.entry,
      visualId: candidate.visualId,
      score,
      paletteSimilarity: palette,
      contentSimilarity: content.score,
      matchedFacetNames: content.matchedFacetNames
    }];
  }).toSorted((left, right) => right.score - left.score
    || String(right.entry.savedAt || "").localeCompare(String(left.entry.savedAt || ""))
    || left.entry.id.localeCompare(right.entry.id))
    .slice(0, Math.max(0, Math.floor(Number(limit) || 0)));
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
