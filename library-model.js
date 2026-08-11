import { formatFacetNodePath, normalizeFacetCatalog } from "./facets.js";
import { entryPalette, visualDescriptions } from "./visuals.js";
import { matchesSearchQuery, parseSearchQuery } from "./search-query.js";

export function filterEntries(entries = [], filters = {}, catalogValue) {
  const catalog = normalizeFacetCatalog(catalogValue);
  const query = parseSearchQuery(filters.query);
  const preparedFacetSelections = prepareFacetSelections(catalog, filters.facetSelections);
  return entries.filter((entry) => {
    if (filters.contentId && !entryContentTypeIds(entry).includes(filters.contentId)) return false;
    if (filters.pendingOnly && !isEntryPending(entry)) return false;
    if ((query.terms.length || query.filters.length) && !matchesSearchQuery(entry, query, catalog, entrySearchText(entry, catalog))) return false;
    for (const { facetId, accepted } of preparedFacetSelections) {
      const matches = (entry.facetAssignments ?? []).some((item) =>
        item.status === "confirmed" && item.facetId === facetId && accepted.has(item.nodeId)
      );
      if (!matches) return false;
    }
    return true;
  });
}

function prepareFacetSelections(catalog, facetSelections) {
  const activeSelections = [...(facetSelections ?? [])].filter(([, selected]) => selected?.size);
  if (!activeSelections.length) return [];
  const childrenByParent = new Map();
  const nodesByFacet = new Map();
  for (const node of catalog.nodes) {
    const facetNodes = nodesByFacet.get(node.facetId) ?? [];
    facetNodes.push(node.id);
    nodesByFacet.set(node.facetId, facetNodes);
    if (!node.parentId) continue;
    const children = childrenByParent.get(node.parentId) ?? [];
    children.push(node.id);
    childrenByParent.set(node.parentId, children);
  }
  return activeSelections.map(([facetId, selected]) => {
    const accepted = new Set();
    for (const nodeId of selected) {
      if (nodeId === facetId) {
        for (const id of nodesByFacet.get(facetId) ?? []) accepted.add(id);
        continue;
      }
      const pending = [nodeId];
      while (pending.length) {
        const id = pending.pop();
        if (accepted.has(id)) continue;
        accepted.add(id);
        pending.push(...(childrenByParent.get(id) ?? []));
      }
    }
    return { facetId, accepted };
  });
}

export function groupEntryAssignments(entry = {}, catalogValue, status = "confirmed") {
  const catalog = normalizeFacetCatalog(catalogValue);
  const nodeById = new Map(catalog.nodes.map((item) => [item.id, item]));
  const grouped = new Map();
  for (const assignment of entry.facetAssignments ?? []) {
    if (assignment.status !== status) continue;
    const node = nodeById.get(assignment.nodeId);
    if (!node || node.status !== "active") continue;
    const values = grouped.get(node.facetId) ?? [];
    values.push({ ...assignment, name: node.name, path: formatFacetNodePath(catalog, node.id) });
    grouped.set(node.facetId, values);
  }
  return grouped;
}

export function entryAttributeSummary(entry, catalogValue, limit = 4) {
  const catalog = normalizeFacetCatalog(catalogValue);
  const grouped = groupEntryAssignments(entry, catalog, "confirmed");
  const values = [];
  let stableOrder = 0;
  for (const facet of catalog.facets.filter((item) => item.status === "active").sort((a, b) => a.order - b.order)) {
    for (const item of (grouped.get(facet.id) ?? []).toSorted((left, right) => Number(right.importance ?? 0) - Number(left.importance ?? 0))) {
      values.push({ facetId: facet.id, label: item.name, path: item.path, source: item.source, priority: 0, importance: Number(item.importance ?? 0), stableOrder: stableOrder++ });
    }
  }
  for (const label of entry.customLabels ?? []) {
    values.push({ facetId: "custom", label, path: label, source: "manual", priority: 1, importance: 0, stableOrder: stableOrder++ });
  }
  return values
    .toSorted((left, right) => left.priority - right.priority || right.importance - left.importance || left.stableOrder - right.stableOrder)
    .slice(0, limit)
    .map(({ source: _source, priority: _priority, importance: _importance, stableOrder: _stableOrder, ...item }) => item);
}

export function entrySourceMetadataRows(entry = {}, sourceLabel = "来源") {
  const descriptors = [];
  const fields = [];
  const seen = new Set();
  for (const value of entry.metadataLabels ?? []) {
    const text = String(value ?? "").trim();
    if (!text || seen.has(text)) continue;
    seen.add(text);
    const match = text.match(/^([^：:]{1,24})[：:]\s*(.+)$/);
    if (match) fields.push({ label: match[1].trim(), value: match[2].trim() });
    else descriptors.push(text);
  }
  return [
    ...(descriptors.length ? [{ label: sourceLabel, value: descriptors.join(" · ") }] : []),
    ...fields
  ];
}

export function isEntryPending(entry) {
  if (Array.isArray(entry?.memberEntries)) return entry.memberEntries.some(isEntryPending);
  return entry.classification?.status === "needs_review" ||
    Boolean((entry.analysisCandidates ?? []).some(isReusableAnalysis));
}

export function entrySearchText(entry, catalogValue, nodeByIdValue) {
  const nodeById = nodeByIdValue instanceof Map
    ? nodeByIdValue
    : new Map(normalizeFacetCatalog(catalogValue).nodes.map((item) => [item.id, item]));
  if (Array.isArray(entry?.memberEntries)) {
    return [entry.title, ...(entry.customLabels ?? []), ...(entry.metadataLabels ?? []), ...entry.memberEntries.map((item) => entrySearchText(item, catalogValue, nodeById))]
      .filter(Boolean).join("\n").toLocaleLowerCase("zh-CN");
  }
  const tags = (entry.facetAssignments ?? []).flatMap((item) => {
    const node = nodeById.get(item.nodeId);
    return node ? [node.name, ...node.aliases] : [];
  });
  return [
    entry.title, entry.text, entry.url, ...tags, ...(entry.customLabels ?? []), ...(entry.metadataLabels ?? []),
    ...visualDescriptions(entry),
    ...(entry.negativeTerms ?? []), ...(entry.legacyFacetCandidates ?? []),
    ...(entry.timeNotes ?? []).map((note) => note.text),
    ...(entryPalette(entry)?.colors ?? []),
    ...(entry.analysisCandidates ?? []).filter(isReusableAnalysis).flatMap((item) => [item.dimensionName, item.groupName, item.tagName, item.evidence]),
    ...(entry.analysisBreakdown ?? []).filter(isReusableAnalysis).flatMap((item) => [item.dimensionName, item.groupName, item.tagName, item.evidence, item.reviewReason])
  ].filter(Boolean).join("\n").toLocaleLowerCase("zh-CN");
}

export function entryContentTypeIds(entry) {
  if (Array.isArray(entry?.contentTypeIds)) return entry.contentTypeIds.filter(Boolean);
  if (Array.isArray(entry?.memberEntries)) {
    return [...new Set(entry.memberEntries.map((item) => item.classification?.pathIds?.[0]).filter(Boolean))];
  }
  return [entry?.classification?.pathIds?.[0]].filter(Boolean);
}

function isReusableAnalysis(item) {
  return Boolean(item?.source && item.source !== "deepseek_text");
}
