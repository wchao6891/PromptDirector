export const TAG_TAXONOMY_VERSION = 1;
export const ANALYSIS_TAG_MIN = 1;
export const ANALYSIS_TAG_MAX = 10;
export const ANALYSIS_DETAIL_MAX_LENGTH = 80;
export const NAV_DETAIL_MIN_CASES = 2;
export const NAV_DETAIL_LIMIT = 6;

const FACETS = [
  facet("subject", "主体与角色", "Subjects & characters", [
    group("subject.character", "人物与角色类型", "People & character types", ["人物", "角色类型", "角色设计", "角色与生物设计"]),
    group("subject.appearance", "外观特征", "Appearance", ["外观", "角色描述", "面部", "发型", "年龄"]),
    group("subject.costume", "服装造型", "Costume & styling", ["服装", "服饰", "穿搭", "造型"]),
    group("subject.object", "生物与物体", "Creatures & objects", ["生物", "物体", "动物", "道具", "载具"]),
    group("subject.consistency", "一致性", "Consistency", ["一致性", "角色设计一致性"]),
    other("subject.other")
  ]),
  facet("scene", "场景与环境", "Scenes & environments", [
    group("scene.place", "场所类型", "Place types", ["场所", "场景类型", "自然环境", "室内场景"]),
    group("scene.space", "空间属性", "Spatial properties", ["空间", "空间属性"]),
    group("scene.era", "时代与地域", "Era & region", ["时代", "地域", "年代"]),
    group("scene.weather", "时间与天气", "Time & weather", ["时间", "天气", "大气"]),
    group("scene.world", "世界设定", "Worldbuilding", ["世界设定", "世界观", "科幻世界", "奇幻世界"]),
    other("scene.other")
  ]),
  facet("action", "动作与物理", "Action & physics", [
    group("action.person", "人物动作", "Character actions", ["人物动作", "角色动作"]),
    group("action.interaction", "交互关系", "Interactions", ["交互", "关系"]),
    group("action.combat", "战斗与运动", "Combat & movement", ["战斗", "运动", "动作序列"]),
    group("action.change", "状态变化", "State changes", ["状态变化", "动作状态", "变化"]),
    group("action.physics", "物理效果", "Physical effects", ["物理效果", "物理", "运动模糊"]),
    other("action.other")
  ]),
  facet("style", "视觉风格", "Visual style", [
    group("style.medium", "媒介形式", "Medium", ["媒介", "动画风格", "摄影媒介"]),
    group("style.render", "渲染方式", "Rendering", ["渲染", "数字绘画", "动画技法"]),
    group("style.art", "艺术流派", "Art movements", ["艺术风格", "艺术流派", "流派", "画派", "genre"]),
    group("style.era", "年代美学", "Period aesthetics", ["年代美学"]),
    group("style.reference", "作者与作品参考", "Artist & work references", ["画风参考", "作者", "作品参考", "摄影风格"]),
    group("style.texture", "材质与画面质感", "Material & image texture", ["材质", "质感", "渲染质量", "画面质量"]),
    other("style.other")
  ]),
  facet("camera", "镜头与构图", "Camera & composition", [
    group("camera.shot", "景别", "Shot size", ["景别", "全身镜头", "近景", "特写"]),
    group("camera.angle", "机位与视角", "Camera angle & viewpoint", ["机位", "视角", "角度"]),
    group("camera.lens", "镜头与焦段", "Lens & focal length", ["镜头类型", "镜头规格", "焦段"]),
    group("camera.motion", "运镜方式", "Camera movement", ["运镜", "移动镜头", "手持与稳定运镜"]),
    group("camera.composition", "构图", "Composition", ["构图", "摄影风格与构图", "特殊角度与构图"]),
    group("camera.focus", "景深与焦点", "Depth of field & focus", ["景深", "焦点"]),
    other("camera.other")
  ]),
  facet("light", "光线与色彩", "Light & color", [
    group("light.source", "光源", "Light sources", ["光源", "光源类型"]),
    group("light.direction", "光线方向", "Light direction", ["光线方向", "逆光", "侧光", "顶光"]),
    group("light.quality", "光质与明暗", "Light quality & contrast", ["光质", "明暗", "光线类型", "灯光风格"]),
    group("light.palette", "色彩方案", "Color schemes", ["色彩方案", "配色"]),
    group("light.tone", "色调与饱和度", "Tone & saturation", ["色调", "饱和度"]),
    group("light.grade", "调色效果", "Color grading", ["调色", "调色效果"]),
    other("light.other")
  ]),
  facet("mood", "情绪与氛围", "Emotion & atmosphere", [
    group("mood.emotion", "情绪", "Emotion", ["情绪", "情感基调"]),
    group("mood.atmosphere", "氛围", "Atmosphere", ["氛围"]),
    group("mood.pacing", "叙事节奏", "Narrative pacing", ["叙事节奏", "节奏"]),
    other("mood.other")
  ]),
  facet("sound", "声音", "Sound", [
    group("sound.music", "音乐", "Music", ["音乐"]),
    group("sound.ambient", "环境音", "Ambient sound", ["环境音", "纯环境音"]),
    group("sound.effect", "音效", "Sound effects", ["音效", "纯音效"]),
    group("sound.voice", "对白与人声", "Dialogue & voice", ["对白", "人声", "配音"]),
    other("sound.other")
  ]),
  facet("output", "输出规格", "Output specifications", [
    group("output.aspect", "画幅比例", "Aspect ratio", ["画幅比例", "画幅"]),
    group("output.duration", "时长", "Duration", ["时长"]),
    group("output.fps", "帧率", "Frame rate", ["帧率"]),
    group("output.resolution", "分辨率", "Resolution", ["分辨率", "码率"]),
    group("output.structure", "镜头与段落结构", "Shot & segment structure", ["镜头结构", "段落结构", "拍摄方式"]),
    other("output.other")
  ]),
  facet("workflow", "方法与工作流", "Methods & workflow", [
    group("workflow.model", "模型与工具", "Models & tools", ["模型", "工具"]),
    group("workflow.prompt", "提示词结构", "Prompt structure", ["提示词结构", "风格前缀"]),
    group("workflow.storyboard", "故事板", "Storyboard", ["故事板"]),
    group("workflow.consistency", "一致性方法", "Consistency methods", ["一致性保持", "一致性方法"]),
    group("workflow.post", "后期处理", "Post-production", ["后期", "后期处理", "工作流"]),
    other("workflow.other")
  ])
];

export const FIXED_TAG_TREE = Object.freeze(FACETS.map((item) => Object.freeze({
  ...item,
  groups: Object.freeze(item.groups.map((value) => Object.freeze({ ...value, terms: Object.freeze(value.terms) })))
})));

export const CREATIVE_DIMENSION_PATHS = Object.freeze([
  ...FIXED_TAG_TREE.map((item) => item.id),
  ...FIXED_TAG_TREE.flatMap((item) => item.groups.map((value) => value.id))
]);

const CREATIVE_DIMENSION_PATH_SET = new Set(CREATIVE_DIMENSION_PATHS);

const FACET_BY_ID = new Map(FIXED_TAG_TREE.map((item) => [item.id, item]));
const GROUP_BY_ID = new Map(FIXED_TAG_TREE.flatMap((item) => item.groups.map((value) => [value.id, { ...value, facetId: item.id }])));

export function isCreativeDimensionPath(value) {
  return CREATIVE_DIMENSION_PATH_SET.has(String(value ?? "").trim());
}

export function creativeDimensionFramework(locale = "zh-CN") {
  const language = locale === "en" ? "en" : "zh";
  return FIXED_TAG_TREE.map((item) => ({
    id: item.id,
    name: item[language],
    groups: item.groups.map((groupValue) => ({ id: groupValue.id, name: groupValue[language] }))
  }));
}

export function createFixedFacetCatalog() {
  return {
    version: 3,
    taxonomyVersion: TAG_TAXONOMY_VERSION,
    revision: 1,
    facets: FIXED_TAG_TREE.map((item, order) => ({
      id: item.id, name: item.zh, names: { "zh-CN": item.zh, en: item.en }, color: item.color,
      order, aliases: [], status: "active", kind: "facet", origin: "system", fixed: true
    })),
    nodes: FIXED_TAG_TREE.flatMap((item) => item.groups.map((value, order) => ({
      id: value.id, name: value.zh, names: { "zh-CN": value.zh, en: value.en }, facetId: item.id,
      parentId: null, order, aliases: [], patterns: [], status: "active", kind: "group",
      origin: "system", fixed: true, protected: value.other === true
    })))
  };
}

export function isFixedTagTree(catalog) {
  if (!catalog || !Array.isArray(catalog.facets) || !Array.isArray(catalog.nodes)) return false;
  const facets = new Set(catalog.facets.map((item) => item.id));
  const groups = new Set(catalog.nodes.filter((item) => !item.parentId).map((item) => item.id));
  return facets.size === FIXED_TAG_TREE.length &&
    FIXED_TAG_TREE.every((item) => facets.has(item.id) && item.groups.every((value) => groups.has(value.id)));
}

export function analysisTaxonomyPayload(catalogValue, locale = "zh-CN") {
  const catalog = catalogValue && Array.isArray(catalogValue.facets) && Array.isArray(catalogValue.nodes)
    ? catalogValue : createFixedFacetCatalog();
  const facets = catalog.facets
    .filter((item) => item.status !== "archived")
    .toSorted((left, right) => left.order - right.order)
    .map((facetValue) => [
      facetValue.id,
      localizedName(facetValue, locale),
      catalog.nodes
        .filter((item) => item.facetId === facetValue.id && item.status !== "archived" && !item.parentId && item.kind !== "detail")
        .toSorted((left, right) => left.order - right.order)
        .map((item) => [item.id, localizedName(item, locale)])
    ]);
  return JSON.stringify({ f: facets });
}

export function validateAnalysisTagResponse(value, catalogValue, options = {}) {
  if (!value || typeof value !== "object" || Array.isArray(value) || !Array.isArray(value.tags)) {
    throw new Error("AI 返回格式无效，本次没有写入任何标签");
  }
  const minimum = options.allowEmpty === true ? 0 : ANALYSIS_TAG_MIN;
  const maximum = Math.min(ANALYSIS_TAG_MAX, Math.max(minimum, Number(options.maxTags) || ANALYSIS_TAG_MAX));
  const diagnostics = Array.isArray(options.diagnostics) ? options.diagnostics : null;
  const extraRootFields = Object.keys(value).filter((key) => key !== "tags").length;
  if (extraRootFields) diagnostics?.push({ field: "root", code: "extra_fields_ignored", count: extraRootFields });
  if (value.tags.length < minimum) {
    throw new Error(`AI 必须返回 ${minimum}–${maximum} 个标签，本次没有写入`);
  }
  const catalog = catalogValue && Array.isArray(catalogValue.nodes) ? catalogValue : createFixedFacetCatalog();
  const groups = new Map(catalog.nodes
    .filter((item) => item.status !== "archived" && !item.parentId && item.kind !== "detail")
    .map((item) => [item.id, item]));
  const seen = new Set();
  const tags = [];
  let unknownCount = 0;
  for (let index = 0; index < value.tags.length; index += 1) {
    const item = value.tags[index];
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      diagnostics?.push({ field: "tags", code: "invalid_tag_dropped", count: 1 });
      continue;
    }
    const extraFields = Object.keys(item).filter((key) => !["g", "groupId", "group_id", "group", "t", "detail", "tag", "label"].includes(key)).length;
    if (extraFields) diagnostics?.push({ field: "tags", code: "extra_fields_ignored", count: extraFields });
    const groupId = String(item.g ?? item.groupId ?? item.group_id ?? item.group ?? "").trim();
    if (!groups.has(groupId)) {
      unknownCount += 1;
      diagnostics?.push({ field: "tags", code: "unknown_path_dropped", count: 1 });
      continue;
    }
    const detailValue = item.t ?? item.detail ?? item.tag ?? item.label;
    const detail = String(detailValue ?? "").trim()
      ? [...normalizeDetailLabel(detailValue)].slice(0, ANALYSIS_DETAIL_MAX_LENGTH).join("")
      : "";
    const key = `${groupId}:${detailNormalizationKey(detail)}`;
    if (seen.has(key)) {
      diagnostics?.push({ field: "tags", code: "duplicate_dropped", count: 1 });
      continue;
    }
    seen.add(key);
    tags.push(detail ? { g: groupId, t: detail } : { g: groupId });
    if (tags.length >= maximum) {
      const capped = value.tags.length - index - 1;
      if (capped) diagnostics?.push({ field: "tags", code: "over_limit_dropped", count: capped });
      break;
    }
  }
  if (tags.length < minimum || (!tags.length && value.tags.length)) {
    if (unknownCount) throw new Error("AI 返回了未知分类路径，本次没有写入");
    throw new Error(`AI 必须返回 ${minimum}–${maximum} 个标签，本次没有写入`);
  }
  return tags;
}

export function mapLegacyAnalysisCandidate(value = {}) {
  const groupId = inferGroupId([
    value.dimensionName,
    value.groupName,
    value.tagName
  ].filter(Boolean).join(" / ")) || inferFacetOtherGroup(value.dimensionName);
  if (!groupId) return null;
  const detail = normalizeDetailLabel(value.tagName);
  if (!detail) return { g: groupId };
  const groupValue = GROUP_BY_ID.get(groupId);
  const genericKeys = [groupValue?.zh, groupValue?.en, ...(groupValue?.terms ?? [])].map(detailNormalizationKey);
  return genericKeys.includes(detailNormalizationKey(detail)) ? { g: groupId } : { g: groupId, t: detail };
}

export function applyFixedAnalysisTags(stateValue, entryId, values, options = {}) {
  const state = structuredClone(stateValue);
  const entry = state.entries?.find((item) => item.id === entryId);
  if (!entry) throw new Error("没有找到需要分析的案例");
  const source = String(options.source ?? "deepseek_text");
  const tags = validateAnalysisTagResponse({ tags: values }, state.facetCatalog, {
    allowEmpty: options.allowEmpty === true,
    maxTags: options.maxTags
  });
  if (options.replaceExisting !== false) {
    entry.facetAssignments = (entry.facetAssignments ?? []).filter((item) => item.source !== source);
  }
  for (const tag of tags) {
    const group = state.facetCatalog.nodes.find((item) => item.id === tag.g && !item.parentId && item.status !== "archived");
    if (!group) throw new Error("标签分类路径已失效，本次没有写入");
    let node = group;
    if (tag.t) node = ensureDetailNode(state.facetCatalog, group, tag.t, sourceOrigin(source));
    assignNode(entry, node, source);
  }
  return { state, appliedCount: tags.length };
}

export function migrateLegacyFacetState(entriesValue, oldCatalogValue, options = {}) {
  const oldCatalog = oldCatalogValue && Array.isArray(oldCatalogValue.facets) && Array.isArray(oldCatalogValue.nodes)
    ? oldCatalogValue : { facets: [], nodes: [] };
  const catalog = createFixedFacetCatalog();
  const oldFacetById = new Map(oldCatalog.facets.map((item) => [item.id, item]));
  const oldNodeById = new Map(oldCatalog.nodes.map((item) => [item.id, item]));
  let mappedCount = 0;
  let customCount = 0;
  const customBySource = {};
  const preserveDeepSeek = options.preserveDeepSeek === true;
  const entries = (Array.isArray(entriesValue) ? entriesValue : []).map((entryValue) => {
    const entry = structuredClone(entryValue);
    const assignments = [];
    const customLabels = [...(entry.customLabels ?? [])];
    let hadDeepSeekAssignment = false;
    let mappedDeepSeekAssignment = false;
    for (const assignment of entry.facetAssignments ?? []) {
      if (assignment.source === "deepseek_text") hadDeepSeekAssignment = true;
      if (assignment.source === "deepseek_text" && !preserveDeepSeek) continue;
      const oldNode = oldNodeById.get(assignment.nodeId);
      const oldFacet = oldFacetById.get(assignment.facetId ?? oldNode?.facetId);
      if (!oldNode) continue;
      const mapped = mapLegacyNode(oldNode, oldFacet, oldNodeById);
      if (!mapped) {
        if (assignment.source === "deepseek_text") continue;
        customLabels.push(oldNode.name);
        customCount += 1;
        customBySource[assignment.source] = (customBySource[assignment.source] ?? 0) + 1;
        continue;
      }
      const group = catalog.nodes.find((item) => item.id === mapped.groupId);
      const node = mapped.detail ? ensureDetailNode(catalog, group, mapped.detail, sourceOrigin(assignment.source)) : group;
      const nextAssignment = { ...assignment, facetId: node.facetId, nodeId: node.id };
      delete nextAssignment.evidence;
      assignments.push(nextAssignment);
      if (assignment.source === "deepseek_text") mappedDeepSeekAssignment = true;
      mappedCount += 1;
    }
    entry.facetAssignments = dedupeAssignments(assignments);
    entry.customLabels = uniqueLabels(customLabels);
    const lostPreservedDeepSeekResult = preserveDeepSeek && hadDeepSeekAssignment && !mappedDeepSeekAssignment;
    if (!preserveDeepSeek) {
      entry.analysisCandidates = (entry.analysisCandidates ?? []).filter((item) => item?.source && item.source !== "deepseek_text");
      entry.analysisBreakdown = (entry.analysisBreakdown ?? []).filter((item) => item?.source && item.source !== "deepseek_text");
    }
    if ((!preserveDeepSeek || lostPreservedDeepSeekResult) && String(entry.text ?? "").trim()) {
      entry.analysisPending = true;
      entry.analysisMeta = null;
      delete entry.analyzedAt;
    }
    return entry;
  });
  catalog.revision += catalog.nodes.filter((item) => item.kind === "detail").length;
  return { catalog, entries, mappedCount, customCount, customBySource };
}

export function prepareFacetRebuild(entriesValue, catalogValue) {
  if (!isFixedTagTree(catalogValue)) return migrateLegacyFacetState(entriesValue, catalogValue);
  const sourceCatalog = structuredClone(catalogValue);
  const catalog = structuredClone(catalogValue);
  catalog.nodes = catalog.nodes.filter((item) => !item.parentId && item.kind !== "detail");
  catalog.revision = Math.max(1, Number(catalog.revision) || 1) + 1;
  const sourceNodeById = new Map(sourceCatalog.nodes.map((item) => [item.id, item]));
  const entries = (Array.isArray(entriesValue) ? entriesValue : []).map((entryValue) => {
    const entry = structuredClone(entryValue);
    const assignments = [];
    for (const assignment of entry.facetAssignments ?? []) {
      if (assignment.source === "deepseek_text") continue;
      const sourceNode = sourceNodeById.get(assignment.nodeId);
      if (!sourceNode) continue;
      let node = catalog.nodes.find((item) => item.id === sourceNode.id);
      if (!node && sourceNode.parentId) {
        const group = catalog.nodes.find((item) => item.id === sourceNode.parentId && !item.parentId);
        if (group) {
          node = ensureDetailNode(catalog, group, sourceNode.name, sourceOrigin(assignment.source));
          node.aliases = uniqueLabels(sourceNode.aliases ?? []);
        }
      }
      if (node) assignments.push({ ...assignment, facetId: node.facetId, nodeId: node.id });
    }
    entry.facetAssignments = dedupeAssignments(assignments);
    entry.analysisCandidates = (entry.analysisCandidates ?? []).filter((item) => item?.source && item.source !== "deepseek_text");
    entry.analysisBreakdown = (entry.analysisBreakdown ?? []).filter((item) => item?.source && item.source !== "deepseek_text");
    if (String(entry.text ?? "").trim()) {
      entry.analysisPending = true;
      entry.analysisMeta = null;
      delete entry.analyzedAt;
    }
    return entry;
  });
  return { catalog, entries, mappedCount: 0, customCount: 0, customBySource: {} };
}

export function detailNavigation(catalogValue, entries = [], selectedIds = new Set()) {
  const catalog = catalogValue && Array.isArray(catalogValue.nodes) ? catalogValue : createFixedFacetCatalog();
  const counts = new Map();
  for (const entry of entries) {
    const used = new Set((entry.facetAssignments ?? [])
      .filter((item) => item.status === "confirmed")
      .map((item) => item.nodeId));
    used.forEach((id) => counts.set(id, (counts.get(id) ?? 0) + 1));
  }
  const result = new Map();
  for (const group of catalog.nodes.filter((item) => !item.parentId && item.status !== "archived")) {
    const children = catalog.nodes.filter((item) => item.parentId === group.id && item.status !== "archived");
    const visible = children
      .filter((item) => (counts.get(item.id) ?? 0) >= NAV_DETAIL_MIN_CASES || selectedIds.has(item.id))
      .sort((left, right) => (counts.get(right.id) ?? 0) - (counts.get(left.id) ?? 0) || left.order - right.order);
    const top = visible.slice(0, NAV_DETAIL_LIMIT);
    const selected = visible.filter((item) => selectedIds.has(item.id) && !top.some((value) => value.id === item.id));
    result.set(group.id, [...new Map([...top, ...selected].map((item) => [item.id, item])).values()]);
  }
  return { counts, byGroup: result };
}

export function createDetailOrganizationChunks(catalogValue, entries = [], maxBytes = 16 * 1024) {
  const catalog = catalogValue && Array.isArray(catalogValue.nodes) ? catalogValue : createFixedFacetCatalog();
  const facetById = new Map(catalog.facets.map((item) => [item.id, item]));
  const counts = new Map();
  for (const entry of entries) {
    const used = new Set((entry.facetAssignments ?? []).filter((item) => item.status === "confirmed").map((item) => item.nodeId));
    used.forEach((id) => counts.set(id, (counts.get(id) ?? 0) + 1));
  }
  const chunks = [];
  for (const group of catalog.nodes.filter((item) => !item.parentId && item.status !== "archived")) {
    const details = catalog.nodes.filter((item) => item.parentId === group.id && item.status !== "archived");
    if (details.length < 2) continue;
    const path = [group.id, facetById.get(group.facetId)?.name ?? group.facetId, group.name];
    let current = [];
    for (const detail of details) {
      const row = [detail.id, detail.name, counts.get(detail.id) ?? 0];
      const candidate = { g: path, d: [...current, row] };
      if (current.length && serializedBytes(candidate) > maxBytes) {
        chunks.push({ g: path, d: current });
        current = [row];
      } else {
        current.push(row);
      }
      if (serializedBytes({ g: path, d: current }) > maxBytes) throw new Error("单个三级标签超过整理输入上限");
    }
    if (current.length) chunks.push({ g: path, d: current });
  }
  return chunks;
}

export function validateDetailOrganizationResponse(value, chunk) {
  if (!value || typeof value !== "object" || Array.isArray(value) || !Array.isArray(value.m)) {
    throw new Error("AI 整理结果格式无效，本次没有修改标签");
  }
  const known = new Set((chunk?.d ?? []).map((item) => item[0]));
  const seen = new Set();
  return value.m.map((item) => {
    const id = String(item?.id ?? "").trim();
    const name = normalizeDetailLabel(item?.n);
    if (!known.has(id) || !name || name.length > ANALYSIS_DETAIL_MAX_LENGTH || seen.has(id)) {
      throw new Error("AI 整理结果包含无效标签，本次没有修改");
    }
    if (Object.keys(item ?? {}).some((key) => !["id", "n"].includes(key))) {
      throw new Error("AI 整理结果包含未允许字段，本次没有修改");
    }
    seen.add(id);
    return { id, n: name };
  });
}

export function applyDetailOrganizationMappings(stateValue, mappingsValue = []) {
  const state = structuredClone(stateValue);
  const catalog = state.facetCatalog;
  const details = new Map(catalog.nodes.filter((item) => item.parentId && item.status !== "archived").map((item) => [item.id, item]));
  const mappings = [];
  const seen = new Set();
  for (const value of mappingsValue) {
    const node = details.get(String(value?.id ?? ""));
    const name = normalizeDetailLabel(value?.n);
    if (!node || !name || name.length > ANALYSIS_DETAIL_MAX_LENGTH || seen.has(node.id)) {
      throw new Error("三级标签整理映射无效，正式标签库未改变");
    }
    seen.add(node.id);
    mappings.push({ node, name, key: detailNormalizationKey(name) });
  }
  const byTarget = new Map();
  for (const mapping of mappings) {
    const key = `${mapping.node.parentId}:${mapping.key}`;
    const values = byTarget.get(key) ?? [];
    values.push(mapping);
    byTarget.set(key, values);
  }
  const remap = new Map();
  for (const values of byTarget.values()) {
    const { node: first, name } = values[0];
    const existing = catalog.nodes.find((item) => item.parentId === first.parentId && item.status !== "archived" &&
      detailNormalizationKey(item.name) === detailNormalizationKey(name));
    const target = existing ?? first;
    const oldNames = values.flatMap(({ node }) => [node.name, ...(node.aliases ?? [])]);
    target.name = name;
    target.aliases = uniqueLabels([...(target.aliases ?? []), ...oldNames])
      .filter((alias) => detailNormalizationKey(alias) !== detailNormalizationKey(name));
    for (const { node } of values) {
      remap.set(node.id, target.id);
      if (node.id !== target.id) node.status = "archived";
    }
  }
  state.entries = (state.entries ?? []).map((entry) => ({
    ...entry,
    facetAssignments: dedupeAssignments((entry.facetAssignments ?? []).map((item) => {
      const nodeId = remap.get(item.nodeId);
      if (!nodeId) return item;
      const target = catalog.nodes.find((node) => node.id === nodeId);
      return { ...item, nodeId, facetId: target.facetId };
    }))
  }));
  if (mappings.length) catalog.revision = Math.max(1, Number(catalog.revision) || 1) + 1;
  return { state, changedCount: mappings.length, mergedCount: [...remap].filter(([from, to]) => from !== to).length };
}

export function detailNormalizationKey(value) {
  return normalizeDetailLabel(value).toLocaleLowerCase("zh-CN").replace(/[\s\p{P}\p{S}]+/gu, "");
}

export function normalizeDetailLabel(value) {
  return String(value ?? "").normalize("NFKC")
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .replace(/[‐‑‒–—―]/g, "-")
    .replace(/[“”„‟]/g, '"')
    .replace(/[‘’‚‛]/g, "'")
    .replace(/\s+/gu, " ")
    .trim()
    .replace(/^[,，。；;:：、|/]+|[,，。；;:：、|/]+$/gu, "");
}

function mapLegacyNode(node, facetValue, nodeById) {
  const parent = node.parentId ? nodeById.get(node.parentId) : null;
  const groupId = inferGroupId([facetValue?.name, parent?.name, node.name].filter(Boolean).join(" / "));
  if (!groupId) return null;
  const generic = GROUP_BY_ID.get(groupId);
  const nodeKey = detailNormalizationKey(node.name);
  const genericKeys = [generic.zh, generic.en, ...generic.terms].map(detailNormalizationKey);
  if (genericKeys.includes(nodeKey)) return { groupId, detail: "" };
  return { groupId, detail: normalizeDetailLabel(node.name) };
}

function inferGroupId(value) {
  const text = detailNormalizationKey(value);
  let best = null;
  for (const [id, item] of GROUP_BY_ID) {
    if (item.other) continue;
    for (const term of [item.zh, item.en, ...item.terms]) {
      const key = detailNormalizationKey(term);
      if (!key || !text.includes(key)) continue;
      if (!best || key.length > best.length) best = { id, length: key.length };
    }
  }
  return best?.id ?? null;
}

function inferFacetOtherGroup(value) {
  const text = detailNormalizationKey(value);
  if (!text) return "";
  let best = null;
  for (const facetValue of FIXED_TAG_TREE) {
    const terms = [facetValue.zh, facetValue.en, ...facetValue.groups.flatMap((item) => item.terms)];
    for (const term of terms) {
      const key = detailNormalizationKey(term);
      if (!key || !text.includes(key)) continue;
      if (!best || key.length > best.length) best = { id: `${facetValue.id}.other`, length: key.length };
    }
  }
  return best?.id ?? "";
}

function ensureDetailNode(catalog, group, label, origin) {
  const key = detailNormalizationKey(label);
  const existing = catalog.nodes.find((item) => item.parentId === group.id &&
    [item.name, ...(item.aliases ?? [])].some((value) => detailNormalizationKey(value) === key));
  if (existing) return existing;
  const baseId = `detail:${group.id}:${stableHash(key)}`;
  let id = baseId;
  let suffix = 2;
  while (catalog.nodes.some((item) => item.id === id)) id = `${baseId}:${suffix++}`;
  const node = {
    id, name: normalizeDetailLabel(label), facetId: group.facetId, parentId: group.id,
    order: catalog.nodes.filter((item) => item.parentId === group.id).length,
    aliases: [], patterns: [], status: "active", kind: "detail", origin, fixed: false
  };
  catalog.nodes.push(node);
  catalog.revision = Math.max(1, Number(catalog.revision) || 1) + 1;
  return node;
}

function assignNode(entry, node, source) {
  const existingIndex = entry.facetAssignments.findIndex((item) => item.nodeId === node.id);
  const assignment = { facetId: node.facetId, nodeId: node.id, status: "confirmed", source };
  if (existingIndex < 0) entry.facetAssignments.push(assignment);
  else if (sourcePriority(source) > sourcePriority(entry.facetAssignments[existingIndex].source)) entry.facetAssignments[existingIndex] = assignment;
}

function dedupeAssignments(values) {
  const byNode = new Map();
  for (const item of values) {
    const prior = byNode.get(item.nodeId);
    if (!prior || sourcePriority(item.source) > sourcePriority(prior.source)) byNode.set(item.nodeId, item);
  }
  return [...byNode.values()];
}

function sourcePriority(source) {
  if (source === "manual") return 4;
  if (["vision_model", "local_image_review"].includes(source)) return 3;
  if (source === "deepseek_text") return 2;
  return 1;
}

function uniqueLabels(values) {
  const seen = new Set();
  return values.flatMap((value) => {
    const label = normalizeDetailLabel(value);
    const key = detailNormalizationKey(label);
    if (!label || seen.has(key)) return [];
    seen.add(key);
    return [label];
  });
}

function localizedName(value, locale) {
  return String(locale === "zh-CN" ? value?.name : value?.names?.[locale] ?? value?.name ?? "").trim();
}

function sourceOrigin(source) {
  if (source === "manual") return "manual";
  if (["vision_model", "local_image_review"].includes(source)) return "vision";
  if (source === "deepseek_text") return "ai";
  return "migration";
}

function facet(id, zh, en, groups) {
  return { id, zh, en, color: colorForId(id), groups };
}

function group(id, zh, en, terms = [], otherValue = false) {
  return { id, zh, en, terms, other: otherValue === true };
}

function other(id) {
  return group(id, "其他", "Other", [], true);
}

function stableHash(value) {
  let hash = 2166136261;
  for (const character of String(value)) {
    hash ^= character.codePointAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

function serializedBytes(value) {
  return new TextEncoder().encode(JSON.stringify(value)).length;
}

function colorForId(id) {
  const colors = {
    subject: "#8b5d47", scene: "#497266", action: "#a04d46", style: "#725b9a", camera: "#426b8a",
    light: "#a2772f", mood: "#8b536f", sound: "#4e7180", output: "#66705a", workflow: "#59616f"
  };
  return colors[id];
}
