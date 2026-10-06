import { normalizeFacetCatalog } from "./facets.js";
import { caseOriginalPromptText, detailPromptSources } from "./prompt-sources.js";

const VISUAL_FACETS = new Set(["subject", "scene", "action", "style", "camera", "light", "mood"]);
const segmenter = new Intl.Segmenter(undefined, { granularity: "word" });

export function createSimilarityIndex(entries = [], catalogValue, options = {}) {
  const steps = similarityIndexSteps(entries, catalogValue, options);
  let step;
  do step = steps.next(); while (!step.done);
  return step.value;
}

// The same build, pausing after every case, so a page can spread it over idle time.
export function* similarityIndexSteps(entries = [], catalogValue, options = {}) {
  const catalog = normalizeFacetCatalog(catalogValue);
  const facets = new Set(catalog.facets.filter(item => item.status === "active").map(item => item.id));
  const nodes = new Map(catalog.nodes.filter(node => node.status === "active" && node.parentId
    && facets.has(node.facetId) && VISUAL_FACETS.has(node.facetId)).map(node => [node.id, node]));
  const profiles = new Map();
  const domains = new Map();
  const labByColor = new Map();
  const tokenCache = new Map();
  function cachedWords(value) {
    const text = String(value ?? "");
    const terms = tokenCache.get(text) ?? options.previousIndex?.tokenCache?.get(text) ?? words(text);
    tokenCache.set(text, terms);
    return terms;
  }
  const visualForEntry = options.visualForEntry ?? (entry => entry.discoveryVisualId);
  const colorsForEntry = options.colorsForEntry ?? (entry => entry.discoveryColors);
  const mediaForEntry = options.mediaForEntry ?? (entry => entry.mediaAssets ?? []);
  const contentTypesForEntry = options.contentTypesForEntry ?? (entry => entry.contentTypeIds ?? entry.classification?.pathIds ?? []);
  const promptForEntry = options.promptForEntry ?? (entry => {
    const original = caseOriginalPromptText(entry);
    if (original) return original;
    return [...new Set((mediaForEntry(entry) ?? [])
      .filter(asset => asset && asset.usage !== "poster" && ["image", "video"].includes(asset.kind))
      .map(asset => detailPromptSources(entry, asset).ai.trim()).filter(Boolean))].join("\n\n");
  });

  for (const entry of entries) {
    yield;
    const members = entry.memberEntries?.length ? entry.memberEntries : [entry];
    const media = (mediaForEntry(entry) ?? []).filter(asset => asset && asset.usage !== "poster");
    const kinds = new Set(media.map(asset => asset.kind));
    const domain = kinds.has("image") || kinds.has("video")
      ? [...kinds].filter(kind => kind !== "attachment").sort().join("+") : "";
    const tagTerms = new Set();
    for (const member of members) for (const assignment of member.facetAssignments ?? []) {
      const node = nodes.get(assignment.nodeId);
      if (!node || assignment.status !== "confirmed" || (assignment.importance != null && !(Number(assignment.importance) > 0))) continue;
      // Existing dimension identities preserve context; no special word lists or guessed synonyms.
      for (const term of cachedWords([node.name, ...(node.aliases ?? [])].join(" "))) tagTerms.add(`${node.facetId}:${term}`);
    }
    const colors = [...new Set((colorsForEntry(entry) ?? []).map(normalizeHex).filter(Boolean))];
    const profile = {
      entry, domain, video: kinds.has("video"),
      visualId: String(visualForEntry(entry) ?? "").trim(),
      labs: colors.map(color => cachedLab(color, labByColor)),
      contentTypeIds: new Set(contentTypesForEntry(entry)),
      // Read members directly: the compound display string prepends titles, which are not prompts.
      prompt: { terms: cachedWords(members.map(promptForEntry).join("\n")) },
      tags: { terms: tagTerms }
    };
    profiles.set(entry.id, profile);
    if (!domain) continue;
    if (!domains.has(domain)) domains.set(domain, []);
    domains.get(domain).push(profile);
  }
  for (const values of domains.values()) for (const field of ["prompt", "tags"]) {
    const frequency = new Map();
    const documents = values.filter(value => value[field].terms.size);
    for (const profile of documents) for (const term of profile[field].terms) frequency.set(term, (frequency.get(term) ?? 0) + 1);
    for (const profile of values) {
      // Binary term presence prevents repeated boilerplate and duplicated members gaining weight.
      // Smoothed IDF remains defined in small/homogeneous libraries; all statistics are local.
      const weighted = [...profile[field].terms].map(term => [term, Math.log1p(documents.length / frequency.get(term))]);
      const norm = Math.sqrt(weighted.reduce((sum, [, weight]) => sum + weight * weight, 0));
      profile[field] = new Map(weighted.map(([term, weight]) => [term, weight / norm]));
    }
  }
  return { profiles, domains, tokenCache };
}

export function rankSimilarEntries(index, entryId, limit = Number.POSITIVE_INFINITY, { method = 'local' } = {}) {
  const current = index?.profiles?.get(entryId);
  if (!current?.domain) return [];
  const ranked = [];
  const primaryDistribution = [];
  for (const candidate of index.domains.get(current.domain)) {
    if (candidate.entry.id === entryId) continue;
    const colorAvailable = current.labs.length > 0 && candidate.labs.length > 0;
    const palette = colorAvailable ? paletteSimilarityFromLabs(current.labs, candidate.labs) : 0;
    const prompt = cosine(current.prompt, candidate.prompt);
    const tags = cosine(current.tags, candidate.tags);
    if (current.video ? current.prompt.size && candidate.prompt.size : colorAvailable) {
      primaryDistribution.push(current.video ? prompt : palette);
    }
    // Tags never gate admission. With missing primary evidence, use the other available source,
    // clearly below results with the requested primary source; never invent pixels or prompts.
    const promptAvailable = Boolean(current.prompt.size && candidate.prompt.size);
    const tagsAvailable = Boolean(current.tags.size && candidate.tags.size);
    if (method !== 'local') {
      const available = method === 'prompt' ? promptAvailable : method === 'palette' ? colorAvailable : tagsAvailable;
      if (!available) continue;
      const score = method === 'prompt' ? prompt : method === 'palette' ? palette : tags;
      ranked.push({ entry: candidate.entry, visualId: candidate.visualId, primary: score, secondary: 0, fallback: false,
        score, promptSimilarity: promptAvailable ? prompt : null, paletteSimilarity: colorAvailable ? palette : null,
        tagSimilarity: tagsAvailable ? tags : null, sameContentType: [...current.contentTypeIds].some(id => candidate.contentTypeIds.has(id)), reason: method === 'prompt' ? '提示词相似度' : method === 'palette' ? '色卡相似度' : '已确认视觉标签相似度' });
      continue;
    }
    const primaryAvailable = current.video ? prompt > 0 : colorAvailable;
    if (!primaryAvailable && !(current.video ? colorAvailable : prompt > 0)) continue;
    const primary = primaryAvailable ? (current.video ? prompt : palette) : (current.video ? palette : prompt);
    const secondary = primaryAvailable ? (current.video ? palette : prompt) : 0;
    ranked.push({
      entry: candidate.entry, visualId: candidate.visualId,
      primary, secondary, fallback: !primaryAvailable,
      score: primary, promptSimilarity: prompt, paletteSimilarity: palette, tagSimilarity: tags,
      promptAvailable, paletteAvailable: colorAvailable, tagsAvailable,
      sameContentType: [...current.contentTypeIds].some(id => candidate.contentTypeIds.has(id)),
      reason: primaryAvailable
        ? current.video ? (colorAvailable ? "提示词与封面色彩参考" : "提示词参考") : (prompt > 0 ? "色彩与提示词参考" : "色彩参考")
        : current.video ? "缺少可匹配的提示词，参考封面色彩" : "缺少色卡，参考提示词"
    });
  }
  // Otsu's one-dimensional variance split uses this query's score distribution.
  // It forms near/far groups without a fixed threshold, candidate count or blended score weights.
  for (const fallback of [false, true]) {
    const group = ranked.filter(item => item.fallback === fallback);
    const boundary = similarityBoundary(fallback ? group.map(item => item.primary) : primaryDistribution);
    for (const item of group) item.near = item.primary >= boundary;
  }
  if (method !== 'local') return ranked.sort((a, b) => b.score - a.score || a.entry.id.localeCompare(b.entry.id)).slice(0, Math.max(0, Math.floor(Number(limit) || 0)));
  return ranked.sort((a, b) => Number(a.fallback) - Number(b.fallback)
    || Number(b.near) - Number(a.near)
    || b.secondary - a.secondary
    || b.primary - a.primary
    || b.tagSimilarity - a.tagSimilarity
    || Number(b.sameContentType) - Number(a.sameContentType)
    || a.entry.id.localeCompare(b.entry.id))
    .slice(0, Math.max(0, Math.floor(Number(limit) || 0)));
}

function similarityBoundary(values) {
  const sorted = values.toSorted((a, b) => a - b);
  if (!sorted.length) return 0;
  const total = sorted.reduce((sum, value) => sum + value, 0);
  let prefix = 0;
  let bestVariance = 0;
  let boundary = sorted[0];
  for (let i = 1; i < sorted.length; i++) {
    prefix += sorted[i - 1];
    if (sorted[i - 1] === sorted[i]) continue;
    const difference = prefix / i - (total - prefix) / (sorted.length - i);
    const variance = i * (sorted.length - i) * difference * difference;
    if (variance > bestVariance) {
      bestVariance = variance;
      boundary = sorted[i];
    }
  }
  return boundary;
}

function words(value) {
  const text = String(value ?? "").normalize("NFKC").toLowerCase().replace(/https?:\/\/\S+/gu, " ");
  return new Set([...segmenter.segment(text)].filter(part => part.isWordLike).map(part => part.segment));
}

function cosine(left, right) {
  if (left.size > right.size) return cosine(right, left);
  let score = 0;
  for (const [term, weight] of left) score += weight * (right.get(term) ?? 0);
  return Math.min(1, score);
}

export function paletteSimilarity(leftColors = [], rightColors = []) {
  return paletteSimilarityFromLabs(leftColors.map(normalizeHex).filter(Boolean).map(hexToLab), rightColors.map(normalizeHex).filter(Boolean).map(hexToLab));
}

function paletteSimilarityFromLabs(left, right) {
  if (!left.length || !right.length) return 0;
  const distance = (source, target) => {
    let total = 0;
    let weights = 0;
    for (const [i, color] of source.entries()) {
      // Existing palette order is prevalence order. Reciprocal rank uses that information
      // without claiming the discarded pixel proportions are still available.
      const weight = 1 / (i + 1);
      total += weight * Math.min(...target.map(other => deltaE76(color, other)));
      weights += weight;
    }
    return total / weights;
  };
  return 1 / (1 + (distance(left, right) + distance(right, left)) / 2);
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
