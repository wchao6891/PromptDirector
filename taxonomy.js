export const SCHEMA_VERSION = 27;

export const CONTENT_TYPE_VISIBILITY = Object.freeze({
  library: "library",
  categoryOnly: "category-only"
});

export const CONTENT_ROLES = Object.freeze({
  general: "general",
  tutorial: "tutorial",
  promptImage: "prompt_image",
  promptVideo: "prompt_video",
  imageCase: "image_case",
  videoCase: "video_case",
  reference: "reference"
});

export const CONTENT_IDS = Object.freeze({
  tutorial: "content:tutorial",
  promptImage: "content:prompt:image",
  promptVideo: "content:prompt:video",
  imageCase: "content:image-case",
  videoCase: "content:video-case",
  reference: "content:reference"
});

const ROLE_BY_LEGACY_ID = Object.freeze({
  [CONTENT_IDS.tutorial]: CONTENT_ROLES.tutorial,
  [CONTENT_IDS.promptImage]: CONTENT_ROLES.promptImage,
  [CONTENT_IDS.promptVideo]: CONTENT_ROLES.promptVideo,
  [CONTENT_IDS.imageCase]: CONTENT_ROLES.imageCase,
  [CONTENT_IDS.videoCase]: CONTENT_ROLES.videoCase,
  [CONTENT_IDS.reference]: CONTENT_ROLES.reference
});

const DEFAULT_NODES = Object.freeze([
  { id: CONTENT_IDS.tutorial, name: "攻略教程", role: CONTENT_ROLES.tutorial },
  { id: CONTENT_IDS.promptImage, name: "图片提示词", role: CONTENT_ROLES.promptImage },
  { id: CONTENT_IDS.promptVideo, name: "视频提示词", role: CONTENT_ROLES.promptVideo },
  { id: CONTENT_IDS.imageCase, name: "图片案例", role: CONTENT_ROLES.imageCase },
  { id: CONTENT_IDS.videoCase, name: "视频案例", role: CONTENT_ROLES.videoCase },
  { id: CONTENT_IDS.reference, name: "资料文档", role: CONTENT_ROLES.reference }
].map((item, order) => ({
  ...item,
  axis: "content",
  parentId: null,
  system: true,
  status: "active",
  visibility: CONTENT_TYPE_VISIBILITY.library,
  order,
  aliases: []
})));

export function createDefaultTaxonomy() {
  return { version: SCHEMA_VERSION, revision: 1, nodes: structuredClone(DEFAULT_NODES) };
}

export function normalizeTaxonomy(value) {
  const source = Array.isArray(value?.nodes) && value.nodes.length ? value.nodes : DEFAULT_NODES;
  const seen = new Set();
  const nodes = source.flatMap((item, index) => {
    const id = cleanId(item?.id);
    const name = cleanName(item?.name);
    if (!id || !name || seen.has(id)) return [];
    seen.add(id);
    const defaultNode = DEFAULT_NODES.find((node) => node.id === id);
    return [{
      id,
      name,
      role: normalizeContentRole(item?.role ?? ROLE_BY_LEGACY_ID[id]),
      axis: "content",
      parentId: null,
      system: defaultNode?.system === true,
      status: "active",
      visibility: normalizeContentTypeVisibility(item?.visibility),
      customized: item?.customized === true || Boolean(defaultNode && name !== defaultNode.name),
      order: Number.isFinite(item?.order) ? Number(item.order) : index,
      aliases: uniqueNames(item?.aliases)
    }];
  });
  for (const requiredRole of [CONTENT_ROLES.videoCase, CONTENT_ROLES.reference]) {
    if (nodes.some((item) => item.role === requiredRole)) continue;
    const defaultNode = DEFAULT_NODES.find((item) => item.role === requiredRole);
    const reserved = nodes.find((item) => item.id === defaultNode.id);
    if (reserved) {
      reserved.role = requiredRole;
      reserved.system = true;
    } else {
      nodes.push({ ...structuredClone(defaultNode), order: nodes.length });
    }
  }
  nodes.sort((left, right) => left.order - right.order || left.name.localeCompare(right.name));
  return {
    version: SCHEMA_VERSION,
    revision: Number.isInteger(value?.revision) ? value.revision : 1,
    nodes: nodes.map((item, order) => ({ ...item, order }))
  };
}

export function formatTaxonomyPath(taxonomy, pathIds) {
  const byId = new Map(normalizeTaxonomy(taxonomy).nodes.map((item) => [item.id, item.name]));
  return (Array.isArray(pathIds) ? pathIds : []).map((id) => byId.get(id)).filter(Boolean).join(" / ");
}

export function isValidContentPath(taxonomy, pathIds) {
  if (!Array.isArray(pathIds) || pathIds.length !== 1) return false;
  return normalizeTaxonomy(taxonomy).nodes.some((item) => item.id === pathIds[0]);
}

export function normalizeContentRole(value) {
  const role = String(value ?? "").trim();
  return Object.values(CONTENT_ROLES).includes(role) ? role : CONTENT_ROLES.general;
}

export function normalizeContentTypeVisibility(value) {
  return value === CONTENT_TYPE_VISIBILITY.categoryOnly
    ? CONTENT_TYPE_VISIBILITY.categoryOnly
    : CONTENT_TYPE_VISIBILITY.library;
}

export function contentRoleForPath(taxonomy, pathIds, roleById) {
  if (!Array.isArray(pathIds) || pathIds.length !== 1) return CONTENT_ROLES.general;
  const indexedRole = roleById instanceof Map ? roleById.get(pathIds[0]) : undefined;
  return indexedRole ?? normalizeTaxonomy(taxonomy).nodes.find((item) => item.id === pathIds[0])?.role ??
    ROLE_BY_LEGACY_ID[pathIds[0]] ?? CONTENT_ROLES.general;
}

export function contentRoleForEntry(entry, taxonomy, roleById) {
  const explicit = String(entry?.contentRole ?? "").trim();
  if (Object.values(CONTENT_ROLES).includes(explicit)) return explicit;
  return contentRoleForPath(taxonomy, entry?.classification?.pathIds, roleById);
}

export function contentTypeForRole(taxonomy, role) {
  const expected = normalizeContentRole(role);
  return normalizeTaxonomy(taxonomy).nodes.find((item) => item.role === expected) ?? null;
}

export function createContentType(taxonomy, value = {}) {
  const next = structuredClone(normalizeTaxonomy(taxonomy));
  const id = cleanId(value.id);
  const name = cleanName(value.name);
  if (!id || !name) throw new Error("内容类型名称无效");
  if (next.nodes.some((item) => item.id === id)) throw new Error("内容类型编号已经存在");
  assertUniqueName(next.nodes, name);
  next.nodes.push({
    id,
    name,
    role: normalizeContentRole(value.role),
    axis: "content",
    parentId: null,
    system: false,
    status: "active",
    visibility: normalizeContentTypeVisibility(value.visibility),
    customized: true,
    order: next.nodes.length,
    aliases: []
  });
  next.revision += 1;
  return next;
}

export function updateContentType(taxonomy, contentId, changes = {}) {
  const next = structuredClone(normalizeTaxonomy(taxonomy));
  const target = next.nodes.find((item) => item.id === cleanId(contentId));
  const name = cleanName(changes.name ?? target?.name);
  if (!target || !name) throw new Error("内容类型名称无效");
  assertUniqueName(next.nodes, name, target.id);
  if (canonical(name) !== canonical(target.name)) target.aliases = uniqueNames([...target.aliases, target.name]);
  target.name = name;
  target.role = normalizeContentRole(changes.role ?? target.role);
  target.visibility = normalizeContentTypeVisibility(changes.visibility ?? target.visibility);
  target.customized = true;
  next.revision += 1;
  return next;
}

export function renameContentType(taxonomy, contentId, name) {
  return updateContentType(taxonomy, contentId, { name });
}

export function removeContentType(taxonomy, contentId) {
  const next = structuredClone(normalizeTaxonomy(taxonomy));
  const targetId = cleanId(contentId);
  if (!next.nodes.some((item) => item.id === targetId)) throw new Error("内容类型不存在");
  if (next.nodes.length <= 1) throw new Error("资料库至少需要保留一个内容类型");
  next.nodes = next.nodes.filter((item) => item.id !== targetId).map((item, order) => ({ ...item, order }));
  next.revision += 1;
  return next;
}

export function removeContentTypeWithTransfer(state = {}, contentId, replacementId = "") {
  const taxonomy = normalizeTaxonomy(state.taxonomy);
  const sourceId = cleanId(contentId);
  const targetId = cleanId(replacementId);
  if (!isValidContentPath(taxonomy, [sourceId])) throw new Error("内容类型不存在");
  const entries = Array.isArray(state.entries) ? state.entries : [];
  const rules = Array.isArray(state.classificationRules) ? state.classificationRules : [];
  const movedCount = entries.filter((entry) => entry.classification?.pathIds?.[0] === sourceId).length;
  const movedRuleCount = rules.filter((rule) => rule.pathIds?.[0] === sourceId).length;
  if ((movedCount || movedRuleCount) && (!targetId || targetId === sourceId)) {
    throw new Error("这个分类仍有内容，请先选择接收分类");
  }
  if (targetId && !isValidContentPath(taxonomy, [targetId])) throw new Error("接收分类不存在");
  return {
    taxonomy: removeContentType(taxonomy, sourceId),
    entries: entries.map((entry) => entry.classification?.pathIds?.[0] === sourceId
      ? {
          ...entry,
          classification: {
            ...entry.classification,
            pathIds: [targetId],
            status: "confirmed",
            source: "manual",
            reason: "原内容类型删除后转移"
          }
        }
      : entry),
    classificationRules: rules.map((rule) => rule.pathIds?.[0] === sourceId
      ? { ...rule, pathIds: [targetId] }
      : rule),
    movedCount,
    movedRuleCount
  };
}

export function mergeTaxonomies(currentValue, importedValue) {
  const current = structuredClone(normalizeTaxonomy(currentValue));
  const imported = normalizeTaxonomy(importedValue);
  const usedIds = new Set(current.nodes.map((item) => item.id));
  const idMap = {};
  let changed = false;
  for (const node of imported.nodes) {
    const byId = current.nodes.find((item) => item.id === node.id);
    const byMeaning = current.nodes.find((item) => item.role === node.role && canonical(item.name) === canonical(node.name));
    const existing = byId ?? byMeaning;
    if (existing) {
      idMap[node.id] = existing.id;
      const aliases = uniqueNames([...existing.aliases, ...node.aliases, ...(existing.name !== node.name ? [node.name] : [])]);
      if (aliases.length !== existing.aliases.length) {
        existing.aliases = aliases;
        changed = true;
      }
      continue;
    }
    const id = uniqueContentTypeId(node.id, node.name, usedIds);
    usedIds.add(id);
    idMap[node.id] = id;
    current.nodes.push({ ...node, id, system: false, order: current.nodes.length });
    changed = true;
  }
  if (changed) current.revision += 1;
  return { taxonomy: current, idMap };
}

function assertUniqueName(nodes, name, exceptId = "") {
  if (nodes.some((item) => item.id !== exceptId && canonical(item.name) === canonical(name))) {
    throw new Error("这个内容类型名称已经存在");
  }
}

function uniqueContentTypeId(preferred, name, usedIds) {
  if (cleanId(preferred) && !usedIds.has(cleanId(preferred))) return cleanId(preferred);
  const base = `content:${canonical(name) || "type"}`;
  if (!usedIds.has(base)) return base;
  let index = 2;
  while (usedIds.has(`${base}:${index}`)) index += 1;
  return `${base}:${index}`;
}

function cleanId(value) {
  return String(value ?? "").replace(/[\u0000-\u001f\u007f\s]/g, "").trim();
}

function cleanName(value) {
  return String(value ?? "").replace(/[\u0000-\u001f\u007f]/g, "").replace(/\s+/g, " ").trim();
}

function uniqueNames(values = []) {
  return [...new Map((Array.isArray(values) ? values : []).map(cleanName).filter(Boolean).map((item) => [canonical(item), item])).values()];
}

function canonical(value) {
  return cleanName(value).toLocaleLowerCase("zh-CN").replace(/[\s._·—–-]+/g, "");
}
