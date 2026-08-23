import { createFixedFacetCatalog } from "./tag-taxonomy.js";

export const FACET_CATALOG_VERSION = 3;

export function createDefaultFacetCatalog() {
  return createFixedFacetCatalog();
}

export function createEmptyFacetCatalog() {
  return { version: FACET_CATALOG_VERSION, taxonomyVersion: 1, revision: 1, facets: [], nodes: [] };
}

export function normalizeFacetCatalog(value) {
  if (!value || !Array.isArray(value.facets) || !Array.isArray(value.nodes)) {
    return createDefaultFacetCatalog();
  }
  const facets = value.facets.map(normalizeFacet).filter((item) => item.id && item.name);
  const facetIds = new Set(facets.map((item) => item.id));
  const nodes = value.nodes.map(normalizeNode).filter((item) => item && facetIds.has(item.facetId));
  const nodeIds = new Set(nodes.map((item) => item.id));
  for (const item of nodes) {
    if (item.parentId && !nodeIds.has(item.parentId)) item.parentId = null;
  }
  return {
    version: FACET_CATALOG_VERSION,
    taxonomyVersion: Math.max(1, Number(value.taxonomyVersion) || 1),
    revision: Number.isInteger(value.revision) ? value.revision : 1,
    facets,
    nodes
  };
}

export function createFacet(catalog, input = {}) {
  const next = structuredClone(normalizeFacetCatalog(catalog));
  const name = cleanName(input.name);
  if (!name) throw new Error("创作维度名称不能为空");
  if (next.facets.some((item) => canonical(item.name) === canonical(name))) {
    throw new Error("这个创作维度已经存在");
  }
  const id = cleanName(input.id) || `facet:${globalThis.crypto.randomUUID()}`;
  if (next.facets.some((item) => item.id === id)) throw new Error("创作维度 ID 已存在");
  next.facets.push(normalizeFacet({
    id,
    name,
    color: /^#[0-9a-f]{6}$/i.test(input.color) ? input.color : colorForName(name),
    order: Number.isFinite(input.order) ? input.order : next.facets.length,
    aliases: input.aliases,
    status: "active"
  }));
  next.revision += 1;
  return next;
}

export function facetNodes(catalog, facetId) {
  return normalizeFacetCatalog(catalog).nodes.filter(
    (item) => item.facetId === facetId && item.status === "active"
  );
}

export function facetNodePath(catalog, nodeId) {
  const byId = new Map(normalizeFacetCatalog(catalog).nodes.map((item) => [item.id, item]));
  const result = [];
  const seen = new Set();
  let current = byId.get(nodeId);
  while (current && !seen.has(current.id)) {
    result.unshift(current);
    seen.add(current.id);
    current = current.parentId ? byId.get(current.parentId) : null;
  }
  return result;
}

export function formatFacetNodePath(catalog, nodeId) {
  return facetNodePath(catalog, nodeId).map((item) => item.name).join(" / ");
}

export function facetDescendants(catalog, nodeId) {
  const nodes = normalizeFacetCatalog(catalog).nodes;
  const result = new Set([nodeId]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const item of nodes) {
      if (item.parentId && result.has(item.parentId) && !result.has(item.id)) {
        result.add(item.id);
        changed = true;
      }
    }
  }
  return result;
}

export function createFacetNode(catalog, input = {}) {
  const next = structuredClone(normalizeFacetCatalog(catalog));
  const facet = next.facets.find((item) => item.id === input.facetId && item.status === "active");
  if (!facet) throw new Error("创作维度无效");
  const name = cleanName(input.name);
  if (!name) throw new Error("标签名称不能为空");
  const parent = input.parentId ? findNode(next, input.parentId) : null;
  if (parent && parent.facetId !== facet.id) throw new Error("父标签不属于当前创作维度");
  if (parent?.parentId) throw new Error("创作标签最多支持两级");
  ensureUnique(next, facet.id, name);
  const id = cleanName(input.id) || `tag:${globalThis.crypto.randomUUID()}`;
  if (next.nodes.some((item) => item.id === id)) throw new Error("标签 ID 已存在");
  next.nodes.push(node(
    id, name, facet.id, parent?.id ?? null, next.nodes.length,
    input.aliases, input.patterns, "active",
    parent ? "detail" : "group", input.origin ?? "manual", input.fixed === true, input.protected === true
  ));
  next.revision += 1;
  return next;
}

export function previewFacetChange(state = {}, change = {}) {
  const catalog = normalizeFacetCatalog(state.facetCatalog);
  const normalized = validateChange(catalog, change);
  const ids = affectedNodeIds(catalog, normalized);
  const affectedEntryCount = (state.entries ?? []).filter((entry) =>
    (entry.facetAssignments ?? []).some((item) => ids.has(item.nodeId))
  ).length;
  return {
    change: normalized,
    affectedEntryCount,
    affectedNodeCount: ids.size,
    summary: changeSummary(catalog, normalized)
  };
}

export function applyFacetChange(state = {}, preview = {}) {
  const undo = structuredClone(state);
  const next = structuredClone(state);
  next.facetCatalog = normalizeFacetCatalog(next.facetCatalog);
  const change = validateChange(next.facetCatalog, preview.change);
  if (change.type === "rename_facet") {
    const target = next.facetCatalog.facets.find((item) => item.id === change.facetId);
    target.aliases = uniqueNames([...target.aliases, target.name]);
    target.name = change.name;
    delete target.names;
  } else if (change.type === "archive_facet") {
    next.facetCatalog.facets.find((item) => item.id === change.facetId).status = "archived";
  } else if (change.type === "rename") {
    const target = findNode(next.facetCatalog, change.nodeId);
    ensureUnique(next.facetCatalog, target.facetId, change.name, target.id);
    target.aliases = uniqueNames([...target.aliases, target.name]);
    target.name = change.name;
    delete target.names;
  } else if (change.type === "archive") {
    const ids = facetDescendants(next.facetCatalog, change.nodeId);
    for (const item of next.facetCatalog.nodes) if (ids.has(item.id)) item.status = "archived";
  } else if (change.type === "move") {
    findNode(next.facetCatalog, change.nodeId).parentId = change.parentId;
  } else if (change.type === "merge") {
    mergeNodes(next, change.sourceNodeId, change.targetNodeId);
  } else if (change.type === "terms") {
    const target = findNode(next.facetCatalog, change.nodeId);
    target.aliases = uniqueNames(change.aliases);
    target.patterns = uniqueNames(change.patterns);
  }
  next.facetCatalog.revision += 1;
  return { state: next, undo };
}

export function undoFacetChange(_state, undo) {
  if (!undo?.facetCatalog || !Array.isArray(undo.entries)) throw new Error("没有可撤回的词库更新");
  return structuredClone(undo);
}

export function restoreArchivedFacets(catalog, facetIds = []) {
  const next = structuredClone(normalizeFacetCatalog(catalog));
  const requested = new Set(Array.isArray(facetIds) ? facetIds : []);
  let restored = 0;
  for (const facet of next.facets) {
    if (facet.status !== "archived" || !requested.has(facet.id)) continue;
    facet.status = "active";
    restored += 1;
  }
  if (restored) next.revision += 1;
  return next;
}

export function restoreArchivedNodes(catalog, nodeIds = []) {
  const next = structuredClone(normalizeFacetCatalog(catalog));
  const requested = new Set(Array.isArray(nodeIds) ? nodeIds : []);
  const related = new Set();
  for (const nodeId of requested) {
    const target = next.nodes.find((node) => node.id === nodeId && node.status === "archived");
    if (!target) continue;
    facetDescendants(next, target.id).forEach((id) => related.add(id));
    let parent = target.parentId ? next.nodes.find((node) => node.id === target.parentId) : null;
    while (parent) {
      related.add(parent.id);
      parent = parent.parentId ? next.nodes.find((node) => node.id === parent.parentId) : null;
    }
  }
  let restored = 0;
  for (const node of next.nodes) {
    if (node.status !== "archived" || !related.has(node.id)) continue;
    node.status = "active";
    restored += 1;
  }
  if (restored) next.revision += 1;
  return next;
}

export function recoverFullyArchivedFacets(catalog) {
  const normalized = normalizeFacetCatalog(catalog);
  const archivedFacetIds = normalized.facets
    .filter((facet) => facet.status === "archived")
    .map((facet) => facet.id);
  const hasActiveFacet = normalized.facets.some((facet) => facet.status === "active");
  if (hasActiveFacet || !archivedFacetIds.length) {
    return { catalog: normalized, restoredFacetIds: [] };
  }
  return {
    catalog: restoreArchivedFacets(normalized, archivedFacetIds),
    restoredFacetIds: archivedFacetIds
  };
}

function normalizeFacet(value) {
  return {
    id: cleanName(value?.id),
    name: cleanName(value?.name),
    color: /^#[0-9a-f]{6}$/i.test(value?.color) ? value.color : "#65736d",
    order: Number.isFinite(value?.order) ? value.order : 0,
    aliases: uniqueNames(value?.aliases),
    status: value?.status === "archived" ? "archived" : "active",
    kind: "facet",
    origin: ["system", "manual", "migration"].includes(value?.origin) ? value.origin : "migration",
    fixed: value?.fixed === true,
    ...(value?.names && typeof value.names === "object" ? { names: structuredClone(value.names) } : {})
  };
}

function normalizeNode(value) {
  const id = cleanName(value?.id);
  const name = cleanName(value?.name);
  const facetId = cleanName(value?.facetId);
  if (!id || !name || !facetId) return null;
  return node(id, name, facetId, cleanName(value?.parentId) || null,
    Number.isFinite(value?.order) ? value.order : 0,
    value?.aliases, value?.patterns, value?.status,
    value?.kind, value?.origin, value?.fixed, value?.protected, value?.names);
}

function node(id, name, facetId, parentId, order, aliases = [], patterns = [], status = "active",
  kind = "", origin = "migration", fixed = false, protectedNode = false, names = null) {
  return {
    id, name, facetId, parentId, order,
    aliases: uniqueNames(aliases), patterns: uniqueNames(patterns),
    status: status === "archived" ? "archived" : "active",
    kind: kind === "facet" ? "facet" : parentId || kind === "detail" ? "detail" : "group",
    origin: ["system", "manual", "ai", "vision", "migration"].includes(origin) ? origin : "migration",
    fixed: fixed === true,
    protected: protectedNode === true,
    ...(names && typeof names === "object" ? { names: structuredClone(names) } : {})
  };
}

function findNode(catalog, id) {
  const found = catalog.nodes.find((item) => item.id === id && item.status === "active");
  if (!found) throw new Error("没有找到创作标签");
  return found;
}

function validateChange(catalog, change) {
  if (change?.type === "rename_facet") {
    const facet = catalog.facets.find((item) => item.id === change.facetId && item.status === "active");
    const name = cleanName(change.name);
    if (!facet || !name) throw new Error("创作维度名称无效");
    if (facet.fixed) throw new Error("固定一级维度不能改名");
    if (catalog.facets.some((item) => item.id !== facet.id && canonical(item.name) === canonical(name))) {
      throw new Error("这个创作维度名称已经存在");
    }
    return { type: "rename_facet", facetId: facet.id, name };
  }
  if (change?.type === "archive_facet") {
    const facet = catalog.facets.find((item) => item.id === change.facetId && item.status === "active");
    if (!facet) throw new Error("创作维度无效");
    if (facet.fixed) throw new Error("固定一级维度不能归档");
    if (catalog.facets.filter((item) => item.status === "active").length <= 1) {
      throw new Error("至少保留一个可见的创作维度");
    }
    return { type: "archive_facet", facetId: facet.id };
  }
  if (change?.type === "rename") {
    const target = findNode(catalog, change.nodeId);
    const name = cleanName(change.name);
    if (!name) throw new Error("标签名称不能为空");
    if (target.protected) throw new Error("每个维度的“其他”分组名称必须保留");
    return { type: "rename", nodeId: target.id, name };
  }
  if (change?.type === "archive") {
    const target = findNode(catalog, change.nodeId);
    if (target.protected) throw new Error("每个维度的“其他”分组必须保留");
    return { type: "archive", nodeId: target.id };
  }
  if (change?.type === "move") {
    const target = findNode(catalog, change.nodeId);
    if (target.protected || target.kind === "group") throw new Error("固定分组不能移动");
    const parent = change.parentId ? findNode(catalog, change.parentId) : null;
    if (parent && (parent.facetId !== target.facetId || parent.parentId)) throw new Error("只能移动到同维度的二级分组下");
    if (parent && facetDescendants(catalog, target.id).has(parent.id)) throw new Error("不能移动到自己的子标签下");
    if (parent && catalog.nodes.some((item) => item.parentId === target.id && item.status === "active")) {
      throw new Error("包含三级标签的分组不能变成三级标签");
    }
    return { type: "move", nodeId: target.id, parentId: parent?.id ?? null };
  }
  if (change?.type === "merge") {
    const source = findNode(catalog, change.sourceNodeId);
    const target = findNode(catalog, change.targetNodeId);
    if (source.protected) throw new Error("每个维度的“其他”分组必须保留");
    if (source.id === target.id || source.facetId !== target.facetId) throw new Error("只能合并同一创作维度中的不同标签");
    if (Boolean(source.parentId) !== Boolean(target.parentId)) throw new Error("只能合并同一层级的标签");
    return { type: "merge", sourceNodeId: source.id, targetNodeId: target.id };
  }
  if (change?.type === "terms") {
    const target = findNode(catalog, change.nodeId);
    return { type: "terms", nodeId: target.id, aliases: uniqueNames(change.aliases), patterns: uniqueNames(change.patterns) };
  }
  throw new Error("未知词库更新类型");
}

function affectedNodeIds(catalog, change) {
  if (change.type === "archive_facet") {
    return new Set(catalog.nodes
      .filter((item) => item.facetId === change.facetId && item.status === "active")
      .map((item) => item.id));
  }
  if (change.type === "archive") {
    const descendants = facetDescendants(catalog, change.nodeId);
    return new Set(catalog.nodes
      .filter((item) => descendants.has(item.id) && item.status === "active")
      .map((item) => item.id));
  }
  return new Set([change.nodeId, change.sourceNodeId, change.targetNodeId].filter(Boolean));
}

function mergeNodes(state, sourceId, targetId) {
  const source = findNode(state.facetCatalog, sourceId);
  const target = findNode(state.facetCatalog, targetId);
  target.aliases = uniqueNames([...target.aliases, source.name, ...source.aliases]);
  target.patterns = uniqueNames([...target.patterns, ...source.patterns]);
  for (const item of state.facetCatalog.nodes) if (item.parentId === source.id) item.parentId = target.id;
  source.status = "archived";
  state.entries = (state.entries ?? []).map((entry) => ({
    ...entry,
    facetAssignments: dedupeEntryAssignments((entry.facetAssignments ?? []).map((item) =>
      item.nodeId === source.id ? { ...item, nodeId: target.id, facetId: target.facetId } : item
    ))
  }));
}

function dedupeEntryAssignments(assignments) {
  const byId = new Map();
  for (const item of assignments) {
    const previous = byId.get(item.nodeId);
    if (!previous || item.source === "manual" || (item.status === "confirmed" && previous.status !== "confirmed")) {
      byId.set(item.nodeId, item);
    }
  }
  return [...byId.values()];
}

function changeSummary(catalog, change) {
  if (change.type === "rename_facet") return `将维度“${catalog.facets.find((item) => item.id === change.facetId).name}”改名为“${change.name}”`;
  if (change.type === "archive_facet") return `归档维度“${catalog.facets.find((item) => item.id === change.facetId).name}”`;
  if (change.type === "rename") return `将“${findNode(catalog, change.nodeId).name}”改名为“${change.name}”`;
  if (change.type === "archive") return `归档“${findNode(catalog, change.nodeId).name}”及其子标签`;
  if (change.type === "move") {
    const target = findNode(catalog, change.nodeId);
    const destination = change.parentId ? findNode(catalog, change.parentId).name : catalog.facets.find((item) => item.id === target.facetId).name;
    return `将“${target.name}”移动到“${destination}”`;
  }
  if (change.type === "terms") return `更新“${findNode(catalog, change.nodeId).name}”的别名和识别词`;
  return `将“${findNode(catalog, change.sourceNodeId).name}”合并到“${findNode(catalog, change.targetNodeId).name}”`;
}

function ensureUnique(catalog, facetId, name, ignoredId = "") {
  const key = canonical(name);
  if (catalog.nodes.some((item) => item.id !== ignoredId && item.facetId === facetId &&
    [item.name, ...item.aliases].some((candidate) => canonical(candidate) === key))) {
    throw new Error("这个名称已经存在或属于已有标签的别名");
  }
}

export function cleanName(value) {
  return String(value ?? "").replace(/[\u0000-\u001f\u007f]/g, "").replace(/\s+/g, " ").trim();
}

export function uniqueNames(values = []) {
  const result = [];
  const seen = new Set();
  for (const value of Array.isArray(values) ? values : []) {
    const name = cleanName(value);
    const key = canonical(name);
    if (!name || seen.has(key)) continue;
    seen.add(key);
    result.push(name);
  }
  return result;
}

function canonical(value) {
  return cleanName(value).toLocaleLowerCase("zh-CN").replace(/[\s._·—–-]+/g, "");
}

function colorForName(name) {
  let hash = 2166136261;
  for (const character of String(name)) {
    hash ^= character.codePointAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return hslToHex((hash >>> 0) % 360, 46, 40);
}

function hslToHex(hue, saturation, lightness) {
  const saturationRatio = saturation / 100;
  const lightnessRatio = lightness / 100;
  const chroma = (1 - Math.abs(2 * lightnessRatio - 1)) * saturationRatio;
  const component = chroma * (1 - Math.abs((hue / 60) % 2 - 1));
  const offset = lightnessRatio - chroma / 2;
  const [red, green, blue] = hue < 60 ? [chroma, component, 0]
    : hue < 120 ? [component, chroma, 0]
      : hue < 180 ? [0, chroma, component]
        : hue < 240 ? [0, component, chroma]
          : hue < 300 ? [component, 0, chroma]
            : [chroma, 0, component];
  return `#${[red, green, blue].map((value) => Math.round((value + offset) * 255).toString(16).padStart(2, "0")).join("")}`.toUpperCase();
}
