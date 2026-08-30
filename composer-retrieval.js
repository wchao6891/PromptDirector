import { normalizeFacetCatalog } from "./facets.js";
import { entrySearchText } from "./library-model.js";
import { matchesSearchQuery, parseSearchQuery } from "./search-query.js";
import { searchIndexedEntries } from "./search-index.js";
import { CONTENT_ROLES, contentRoleForEntry } from "./taxonomy.js";
import { primaryVisionDescription } from "./visuals.js";

const CASE_ROLES = new Set([
  CONTENT_ROLES.promptImage,
  CONTENT_ROLES.promptVideo,
  CONTENT_ROLES.imageCase,
  CONTENT_ROLES.videoCase
]);
const GUIDE_ROLES = new Set([CONTENT_ROLES.tutorial, CONTENT_ROLES.reference]);

export function retrieveComposerSources(input = {}) {
  const queryText = String(input.query ?? "").trim();
  const characterBudget = Math.max(0, Math.floor(Number(input.characterBudget) || 0));
  if (!queryText || !characterBudget) return [];
  const wantedRoles = new Set(normalizeWantedRoles(input.contentRoles));
  const query = parseSearchQuery(queryText);
  const excludedEntryIds = new Set(Array.isArray(input.excludedEntryIds) ? input.excludedEntryIds : []);
  const catalog = normalizeFacetCatalog(input.facetCatalog);
  const nodeById = new Map(catalog.nodes.map((node) => [node.id, node]));
  const searchIndex = Array.isArray(input.searchIndex) ? input.searchIndex : [];
  const indexedById = new Map(searchIndex.map((item) => [item.id, item]));
  const indexedMatches = searchIndex.length ? searchIndexedEntries(searchIndex, queryText) : null;
  const matchingIds = indexedMatches?.size ? indexedMatches : null;
  const naturalLanguageFallback = Boolean(indexedMatches && !indexedMatches.size);
  const candidates = [];

  if (!wantedRoles.size || wantedRoles.has("case") || wantedRoles.has("guide")) {
    for (const entry of Array.isArray(input.entries) ? input.entries : []) {
      if (!entry?.id || excludedEntryIds.has(entry.id)) continue;
      if (matchingIds && !matchingIds.has(entry.id)) continue;
      const contentRole = contentRoleForEntry(entry);
      const role = CASE_ROLES.has(contentRole) ? "case" : GUIDE_ROLES.has(contentRole) ? "guide" : "";
      if (!role || (wantedRoles.size && !wantedRoles.has(role))) continue;
      if (!matchesTarget(contentRole, input.targetType)) continue;
      const indexed = indexedById.get(entry.id);
      const documentText = String(input.documentTextByEntryId?.get?.(entry.id) ?? "").trim();
      const fullText = indexed?.fullText || `${entrySearchText(entry, catalog, nodeById)}\n${documentText}`.toLocaleLowerCase("zh-CN");
      if (!matchingIds && !matchesSearchQuery(entry, { terms: [], filters: query.filters }, catalog, fullText)) continue;
      const text = sourceText(entry, role, input.documentTextByEntryId);
      if (!text) continue;
      const rank = !query.terms.length && query.filters.length
        ? [1, 0, 0, 0, 0, 0]
        : relevanceRank(queryText, query.terms, fullText, indexed?.tags || entryTags(entry, nodeById), indexed?.notes || String(entry.text ?? ""));
      if (!rank) continue;
      candidates.push({
        entryId: entry.id,
        title: String(entry.title ?? "").trim() || (role === "guide" ? "未命名教程" : "未命名案例"),
        role,
        referenceKind: role === "guide" ? "document" : contentRole === CONTENT_ROLES.imageCase ? "vision" : "prompt",
        text,
        rank
      });
    }
  }

  candidates.sort(compareCandidates);
  return fitSourcesToBudget(naturalLanguageFallback ? bestFallbackCandidatesByRole(candidates) : candidates, characterBudget);
}

function normalizeWantedRoles(values) {
  const allowed = new Set(["case", "guide"]);
  return [...new Set((Array.isArray(values) ? values : []).filter((value) => allowed.has(value)))];
}

function matchesTarget(contentRole, targetType) {
  if (targetType === "video") return contentRole !== CONTENT_ROLES.promptImage && contentRole !== CONTENT_ROLES.imageCase;
  if (targetType === "image") return contentRole !== CONTENT_ROLES.promptVideo && contentRole !== CONTENT_ROLES.videoCase;
  return true;
}

function sourceText(entry, role, documentTextByEntryId) {
  if (role === "guide") return String(entry.text ?? "").trim() || String(documentTextByEntryId?.get?.(entry.id) ?? "").trim();
  return String(entry.text ?? "").trim() || primaryVisionDescription(entry);
}

function entryTags(entry, nodeById) {
  return [
    ...(entry.customLabels ?? []),
    ...(entry.facetAssignments ?? []).filter((item) => item.status === "confirmed").flatMap((item) => {
      const node = nodeById.get(item.nodeId);
      return node ? [node.name, ...(node.aliases ?? [])] : [];
    })
  ].join("\n").toLocaleLowerCase("zh-CN");
}

function relevanceRank(queryText, terms, fullTextValue, tagsValue, notesValue) {
  const query = queryText.toLocaleLowerCase("zh-CN");
  const fullText = String(fullTextValue ?? "").toLocaleLowerCase("zh-CN");
  const tags = String(tagsValue ?? "").toLocaleLowerCase("zh-CN");
  const notes = String(notesValue ?? "").toLocaleLowerCase("zh-CN");
  const effectiveTerms = terms.length ? terms : [query];
  const fullHits = effectiveTerms.filter((term) => fullText.includes(term)).length;
  const tagHits = effectiveTerms.filter((term) => tags.includes(term)).length;
  const noteHits = effectiveTerms.filter((term) => notes.includes(term)).length;
  const overlap = chineseCharacterOverlap(query, fullText);
  const phrase = fullText.includes(query) ? 1 : 0;
  if (!phrase && !fullHits && !overlap) return null;
  return [fullHits === effectiveTerms.length ? 1 : 0, tagHits, phrase, noteHits, fullHits, overlap];
}

function bestFallbackCandidatesByRole(candidates) {
  const bestRankByRole = new Map();
  return candidates.filter((candidate) => {
    const best = bestRankByRole.get(candidate.role);
    if (!best) {
      bestRankByRole.set(candidate.role, candidate.rank);
      return true;
    }
    return candidate.rank.every((value, index) => value === best[index]);
  });
}

function chineseCharacterOverlap(query, text) {
  const wanted = new Set([...query].filter((character) => /[\u3400-\u9fff]/u.test(character)));
  if (!wanted.size) return 0;
  let matched = 0;
  for (const character of wanted) if (text.includes(character)) matched += 1;
  return matched / wanted.size;
}

function compareCandidates(left, right) {
  for (let index = 0; index < left.rank.length; index += 1) {
    if (left.rank[index] !== right.rank[index]) return right.rank[index] - left.rank[index];
  }
  return left.title.localeCompare(right.title, "zh-CN");
}

function fitSourcesToBudget(candidates, characterBudget) {
  const result = [];
  let remaining = Math.max(0, characterBudget - 2);
  for (const candidate of candidates) {
    if (result.length) remaining -= 1;
    const alias = `@检索${result.length + 1}`;
    const sourceBase = {
      entryId: candidate.entryId,
      alias,
      title: candidate.title,
      role: candidate.role,
      referenceKind: candidate.referenceKind,
      truncated: false
    };
    const overhead = JSON.stringify({ ...sourceBase, text: "" }).length;
    if (remaining <= overhead) break;
    const availableText = remaining - overhead;
    const text = candidate.text.length <= availableText
      ? candidate.text
      : `${candidate.text.slice(0, Math.max(0, availableText - 12)).trimEnd()}\n[本轮按请求容量截断]`;
    if (!text.trim()) break;
    const source = {
      ...sourceBase,
      text,
      truncated: text !== candidate.text
    };
    const size = JSON.stringify(source).length;
    if (size > remaining) break;
    result.push(source);
    remaining -= size;
  }
  return result;
}
