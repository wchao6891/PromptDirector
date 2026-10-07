import { CREATIVE_NOTE_PROPERTIES } from './case-operation-specs.js';
import { caseFieldAccess } from './case-field-access.js';
import { entryMediaAssets, caseCoverAsset } from './media.js';
import { caseOriginalPromptText, detailPromptSources } from './prompt-sources.js';
import { contentRoleForEntry } from './taxonomy.js';
import { normalizeFacetCatalog } from './facets.js';
import { collectionEntryIds } from './organizer.js';
import { caseFilesUnavailable } from './case-file-status.js';
import { QUERY_OPERATORS } from './case-query-specs.js';

const members = entry => entry.memberEntries?.length ? entry.memberEntries : [entry];
const unique = values => [...new Set(values)];
const text = value => typeof value === 'string' && value.trim() ? value : null;
const date = normalizeQueryDate;
export function normalizeQueryDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:\d{2}))?$/.test(value)) return null;
  const day = new Date(`${value.slice(0, 10)}T00:00:00Z`);
  if (!Number.isFinite(day.getTime()) || day.toISOString().slice(0, 10) !== value.slice(0, 10) || !Number.isFinite(Date.parse(value))) return null;
  return new Date(value).toISOString();
}
const number = value => typeof value === 'number' && Number.isFinite(value) ? value : null;
const colors = value => unique((value?.colors ?? []).map(normalizeColor).filter(Boolean));
export function normalizeColor(value) {
  const match = String(value ?? '').trim().match(/^#?([a-f\d]{6})$/i);
  return match ? `#${match[1].toUpperCase()}` : null;
}

// Each record keeps its owner. A scoped media/source/label query can never
// borrow a prompt, author or assignment from a different compound member.
export function createCaseQueryContext(entries, options = {}) {
  const nodes = new Map(normalizeFacetCatalog(options.facetCatalog).nodes.map(node => [node.id, node]));
  const projects = options.organizerState?.collections ?? [];
  const projectById = new Map(projects.map(project => [project.id, project]));
  const membership = new Map(projects.map(project => [project.id, new Set(collectionEntryIds(options.organizerState, project.id))]));
  const documents = options.documentTextByAsset ?? new Map();
  const derived = options.derivedMetadataByAsset ?? new Map();
  const filters = options.sourceFilters ?? {};
  const sourceKey = value => String(value ?? '').trim().toLocaleLowerCase('en-US');
  const eligibleMembers = entry => members(entry).filter(owner =>
    (!filters.provider || sourceKey(owner.sourceFacts?.provider) === sourceKey(filters.provider)) &&
    (!filters.authorHandle || sourceKey(owner.sourceFacts?.handle).replace(/^@/, '') === sourceKey(filters.authorHandle).replace(/^@/, '')));
  const projectRows = entry => projects.filter(project => membership.get(project.id).has(entry.id) ||
    members(entry).some(member => membership.get(project.id).has(member.id))).map(project => {
    const path = [], ids = [], seen = new Set();
    let current = project;
    while (current && !seen.has(current.id)) { seen.add(current.id); path.unshift(current.name); ids.unshift(current.id); current = projectById.get(current.parentId); }
    return { ...project, path: path.join(' / '), ancestorIds: ids };
  });
  const labelRows = (entry, asset) => {
    const custom = asset ? [] : (entry.customLabels ?? []).map(name => ({ name, nodeId: null, facetId: 'custom', source: 'manual', origin: 'manual', status: 'confirmed', visualId: null }));
    return [...custom, ...(entry.facetAssignments ?? []).filter(item => !asset || item.visualId === asset.id).map(item => {
      const node = nodes.get(item.nodeId);
      return { ...item, name: node?.name ?? null, facetId: node?.facetId ?? null,
        origin: item.source === 'manual' ? 'manual' : ['deepseek_text', 'vision_model', 'local_image_review'].includes(item.source) ? 'ai' : null };
    })];
  };
  function root(entry) { return { entry, owner: entry, scope: 'case' }; }
  function related(context, scope) {
    const owners = context.scope === 'case' ? eligibleMembers(context.entry) : [context.owner];
    if (scope === 'member' && context.scope === 'case') return owners.map(owner => ({ entry: context.entry, owner, scope }));
    if (scope === 'source') return owners.map(owner => ({ entry: context.entry, owner, scope, source: owner.sourceFacts ?? {} }));
    if (scope === 'media') return owners.flatMap(owner => entryMediaAssets(owner).map(asset => ({ entry: context.entry, owner, scope, asset })));
    if (scope === 'label') {
      const rows = owners.flatMap(owner => labelRows(owner, context.asset).map(label => ({ entry: context.entry, owner, scope, label })));
      if (context.scope === 'case' && context.entry.memberEntries?.length) rows.push(...labelRows({ customLabels: context.entry.compoundCase?.customLabels ?? [] }).map(label => ({ entry: context.entry, owner: context.entry, scope, label })));
      return rows;
    }
    if (scope === 'project') return projectRows(context.scope === 'case' ? context.entry : context.owner).map(project => ({ ...context, scope, project }));
    if (scope === 'classification') return owners.map(owner => {
      const pathIds = owner.classification?.pathIds ?? [];
      const names = pathIds.map(id => options.taxonomy?.nodes?.find(node => node.id === id)?.name ?? null);
      return { entry: context.entry, owner, scope, classification: { ...owner.classification, pathIds, names, path: names.length && names.every(Boolean) ? names.join(' / ') : null } };
    });
    return [];
  }
  const byOwner = context => context.scope === 'case' ? eligibleMembers(context.entry) : [context.owner];
  const countMedia = context => (context.scope === 'case' ? members(context.entry) : [context.owner]).flatMap(entryMediaAssets);
  const media = context => context.asset ? [context] : related(context, 'media');
  const source = context => context.source ? [context] : related(context, 'source');
  const labels = context => context.label ? [context.label] : related(context, 'label').map(item => item.label);
  const fields = new Map();
  function field(name, type, description, read, { scopes = ['case', 'member'], multi = false, normalize, fullText = false } = {}) {
    const operators = QUERY_OPERATORS.filter(op => ['exists', 'eq', 'ne', 'in'].includes(op) ||
      type === 'string' && ['contains', 'startsWith'].includes(op) || ['number', 'date'].includes(type) && ['gt', 'gte', 'lt', 'lte', 'between'].includes(op));
    fields.set(name, { name, access: caseFieldAccess(name), type, description, scopes, multi, operators, sort: !fullText, fullText,
      aggregates: type === 'number' ? ['known', 'missing', 'sum', 'avg', 'min', 'max'] : ['known', 'missing'], read, normalize });
  }
  const ownerScopes = ['case', 'member', 'source', 'media', 'label', 'classification'];
  field('caseId', 'string', '逻辑案例身份；组合仍返回组合编号', c => c.entry.id, { scopes: ownerScopes });
  field('title', 'string', '案例标题；member作用域读取该成员标题', c => text(c.scope === 'case' ? c.entry.title : c.owner.title));
  field('body', 'string', '完整正文；组合分成员读值，禁止跨成员文本拼接满足短语', c => byOwner(c).map(owner => caseFilesUnavailable(owner) ? null : text(owner.text)), { multi: true, fullText: true });
  field('documentText', 'string', '已解析文档全文；未解析为缺失，绝不现场猜测文件内容', c => media(c).filter(m => m.asset.kind === 'document').map(m => caseFilesUnavailable(m.owner) ? null : text(documents.get(m.asset.id))), { multi: true, fullText: true, scopes: ['case', 'member', 'media'] });
  field('isCompound', 'boolean', '是否组合案例', c => Boolean(c.entry.memberEntries?.length), { scopes: ['case'] });
  field('memberCount', 'number', '成员数；独立案例为1', c => members(c.entry).length, { scopes: ['case'] });
  field('memberIds', 'string', '成员身份，独立案例返回自身编号', c => members(c.entry).map(m => m.id), { scopes: ['case'], multi: true });
  field('savedAt', 'date', '原保存时间；组合展示时间为成员保存时间最大值，不冒充组合创建时间', c => date((c.scope === 'case' ? c.entry : c.owner).savedAt));
  field('addedAt', 'date', '本库入库时间libraryAddedAt；缺失不借用savedAt', c => byOwner(c).map(m => date(m.libraryAddedAt)), { multi: true });
  field('modifiedAt', 'date', '成员修改时间libraryUpdatedAt；组合自身修改时间另查compound.updatedAt', c => byOwner(c).map(m => date(m.libraryUpdatedAt)), { multi: true });
  for (const name of ['createdAt', 'updatedAt']) field(`compound.${name}`, 'date', `组合记录${name}，独立案例缺失`, c => date(c.entry.compoundCase?.[name]), { scopes: ['case'] });
  for (const name of ['provider', 'pageType', 'itemId', 'author', 'handle', 'authorUrl', 'originalSourceUrl', 'description', 'model', 'dimensions', 'duration', 'license', 'status', 'metadataError', 'publishedAt', 'capturedAt', 'engagementObservedAt', 'originalPromptAvailable']) {
    const type = name.endsWith('At') ? 'date' : name === 'originalPromptAvailable' ? 'boolean' : 'string';
    field(`source.${name}`, type, `已保存sourceFacts.${name}；多来源分值，不从正文推断`, c => source(c).map(s => {
      const value = s.source[name];
      return type === 'date' ? date(value) : type === 'boolean' ? typeof value === 'boolean' ? value : null : text(value);
    }), { scopes: ownerScopes, multi: true, normalize: ['provider', 'handle'].includes(name) ? value => String(value).trim().toLocaleLowerCase('en-US').replace(name === 'handle' ? /^@/ : /$^/, '') : undefined });
  }
  field('source.url', 'string', '成员保存的来源网址，不包含正文提及的链接', c => byOwner(c).map(m => text(m.url)), { scopes: ownerScopes, multi: true });
  const metrics = unique(entries.flatMap(entry => members(entry).flatMap(m => Object.keys(m.sourceFacts?.engagement ?? {})))).sort();
  for (const metric of metrics) field(`source.engagement.${metric}`, 'number', `已保存互动指标${metric}，非实时数据；多帖不隐式相加`, c => source(c).map(s => {
    const value = number(s.source.engagement?.[metric]); return value !== null && value >= 0 ? value : null;
  }), { scopes: ownerScopes, multi: true });
  field('mediaCount', 'number', '逻辑案例全部内容素材数，排除usage=poster；以成员+素材编号计数；member作用域只计该成员', c => countMedia(c).filter(asset => asset.usage !== 'poster').length);
  field('posterCount', 'number', '逻辑案例全部usage=poster封面素材数；member只计该成员', c => countMedia(c).filter(asset => asset.usage === 'poster').length);
  field('uniqueMediaCount', 'number', '逻辑案例去重素材编号数，排除封面；不声称是不同文件', c => unique(countMedia(c).filter(asset => asset.usage !== 'poster').map(asset => asset.id)).length);
  field('uniqueOriginalCount', 'number', '内容原件按已存SHA256去重；任一摘要缺失则未知，不用编号冒充文件身份', c => {
    const assets = countMedia(c).filter(asset => asset.usage !== 'poster');
    const hashes = assets.map(asset => text(asset.contentHash));
    return hashes.every(Boolean) ? unique(hashes).length : null;
  });
  field('coverVisualId', 'string', '逻辑案例当前封面，沿caseCoverAsset显式选择/自动封面解析', c => caseCoverAsset(c.scope === 'case' ? c.entry : c.owner)?.id ?? null);
  field('contentRole', 'string', '业务类型角色，沿现有分类解析；不是媒体类型', c => byOwner(c).map(m => contentRoleForEntry(m, options.taxonomy)), { multi: true });
  const mediaScopes = ['case', 'member', 'media'];
  for (const [name, type, description] of [['id', 'string', '素材身份'], ['kind', 'string', '实际类型，含image/video/audio/document/attachment；封面需另约束usage'], ['usage', 'string', '已存角色，poster是封面，未记录为null'], ['mimeType', 'string', '原件MIME'], ['sourceUrl', 'string', '素材来源网址'], ['sourceTitle', 'string', '素材来源标题'], ['sourceAuthor', 'string', '素材来源作者'], ['byteSize', 'number', '原件字节数'], ['durationMs', 'number', '已知素材毫秒时长，缺失或非正数未知'], ['contentHash', 'string', '已存原件摘要，不在查询时读取或重新校验字节'], ['storageMode', 'string', '已存存储方式，不证明磁盘当前可读']]) {
    field(`media.${name}`, type, description, c => media(c).map(m => name === 'durationMs' ? number(m.asset[name]) > 0 ? m.asset[name] : null : type === 'number' ? number(m.asset[name]) : text(m.asset[name])), { scopes: mediaScopes, multi: true });
  }
  field('media.isPoster', 'boolean', '封面角色是否poster', c => media(c).map(m => m.asset.usage === 'poster'), { scopes: mediaScopes, multi: true });
  field('media.isCover', 'boolean', '是该成员或逻辑组合当前封面，沿已有自动/显式封面解析', c => media(c).map(m => [caseCoverAsset(c.entry)?.id, caseCoverAsset(m.owner)?.id].includes(m.asset.id)), { scopes: mediaScopes, multi: true });
  field('media.availability', 'string', '仅已存状态：recovery-only/metadata-only；metadata-only不证明文件可读，实际原件用read_media核验', c => media(c).map(m => caseFilesUnavailable(m.owner) ? 'recovery-only' : 'metadata-only'), { scopes: mediaScopes, multi: true });
  for (const kind of ['original', 'ai']) field(`prompt.${kind}`, 'string', kind === 'original' ? '来源证据原词，沿prompt-sources；不借AI词' : '当前有效AI提示词，不复活已删/失效分析', c => {
    if (kind === 'original' && !c.asset) return byOwner(c).map(m => caseFilesUnavailable(m) ? null : text(caseOriginalPromptText(m)));
    return media(c).filter(m => m.asset.usage !== 'poster').map(m => caseFilesUnavailable(m.owner) ? null : text(detailPromptSources(m.owner, m.asset)[kind]));
  }, { scopes: mediaScopes, multi: true, fullText: true });
  field('palette.colors', 'string', '已存素材色卡或派生色卡的完整HEX精确值；不是色彩距离。包含封面时明确media作用域', c => media(c).flatMap(m => colors(m.asset.palette ?? derived.get(m.asset.id)?.palette)), { scopes: mediaScopes, multi: true, normalize: normalizeColor });
  for (const name of Object.keys(CREATIVE_NOTE_PROPERTIES)) field(`creative.${name}`, 'string', '自己的创作标注，与原文/原词分开，允许精准修改', c => byOwner(c).map(m => text(m.creative?.[name])), { multi: true, fullText: true });
  field('manualLabels', 'string', 'customLabels人工标签名称，含组合自身；分类人工指派另查label.origin', c => c.scope === 'case' ? c.entry.customLabels ?? [] : c.owner.customLabels ?? [], { multi: true });
  for (const name of ['nodeId', 'name', 'facetId', 'source', 'origin', 'status', 'visualId']) field(`label.${name}`, 'string', name === 'origin' ? 'manual/ai/未知null；由已知赋予来源区分，不借用词库创建来源' : `标签关联${name}；多条件用label作用域限定同一关联`, c => labels(c).map(label => text(label[name])), { scopes: ['case', 'member', 'media', 'label'], multi: true });
  for (const name of ['id', 'name', 'path', 'ancestorIds']) field(`project.${name}`, 'string', name === 'ancestorIds' ? '直接项目及其全部祖先ID；用于子树范围，案例不重复' : `直接归属项目${name}，含成员归属`, c => (c.project ? [c.project] : related(c, 'project').map(r => r.project)).flatMap(p => p[name] ?? null), { scopes: ['case', 'member', 'project'], multi: true });
  for (const name of ['pathIds', 'names', 'path', 'status', 'source']) field(`classification.${name}`, 'string', `已存业务分类${name}；分类路径不与AI视觉标签混淆`, c => (c.classification ? [c] : related(c, 'classification')).flatMap(r => r.classification[name] ?? null), { scopes: ['case', 'member', 'classification'], multi: true });
  for (const name of ['score', 'prompt', 'palette', 'tags']) field(`similarity.${name}`, 'number', 'similarTo或similarText指定参考后计算；证据缺失为null，0为已知不相似；非全库静态字段', c => options.similarities?.get(c.entry.id)?.[name] ?? null, { scopes: ['case'] });
  return { fields, metrics, entries, options, root, related, members, media, documents, derived };
}

export function describeCaseQuery(entries, options = {}) {
  const context = createCaseQueryContext(entries, options);
  return { version: 1, fields: [...context.fields.values()].map(({ read, normalize, ...definition }) => definition), engagementMetrics: context.metrics,
    semantics: { predicates: 'all/any/not递归；scope+where表示存在同一关系记录满足子条件；独立字段多值为任一值匹配，跨关系联合须显式scope',
      missing: 'null/空集合/空文字为缺失；exists=false判断全部缺失。ne要求至少一个已知值且没有值等于目标。排除含值用not(eq)。',
      equality: '文字精确且区分大小写，provider/handle忽略大小写，handle忽略前导@，HEX统一大小写；contains/startsWith忽略大小写。日期统一ISO瞬间。',
      ordering: '缺失排末；多值必须min/max，取值后caseId破平局；互动排序/统计需要顶层provider单平台筛选，不隐式合计',
      sourceScope: '顶层provider/authorHandle限定参与字段条件/来源选列/互动排序的成员；逻辑案例数量字段仍计全部成员素材。where存在性条件不另外缩减返回字段值，需同记录关联时用scope。',
      grouping: '同source/media/label/project/classification字段按同一关系记录成组，不拼造作者平台/标签来源/项目名称配对；不同关系域做值组合。每组案例去重，缺失为null组。同域统计限定该组关系记录；统计基于全匹配集，与case分页无关。',
      text: 'select完整字段；默认候选只有摘要；超过消息预算明确报错并指导read_case分页，原文保留',
      similarity: '同媒体域比较，本地文字/标签/色卡证据，非图像视觉理解；coverage保留未知，无可比证据不入相似结果' } };
}
