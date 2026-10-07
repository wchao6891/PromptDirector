// Pure schemas shared by the local creative workspace and the installed MCP adapter.
import { CASE_QUERY_PROPERTIES } from './case-query-specs.js';
const text = { type: 'string' };
const id = { type: 'string', minLength: 1 };
const object = (properties, required = []) => ({ type: 'object', properties, required, additionalProperties: false });
const list = items => ({ type: 'array', items });
const nullableText = { type: ['string', 'null'] };
const facts = object(Object.fromEntries([
  'provider', 'pageType', 'itemId', 'author', 'handle', 'authorUrl', 'originalSourceUrl',
  'description', 'publishedAt', 'capturedAt', 'model', 'dimensions', 'duration', 'license',
  'engagementObservedAt', 'metadataError', 'status'
].map(key => [key, nullableText])));
facts.properties.engagement = { type: ['object', 'null'], additionalProperties: { type: 'number', minimum: 0 } };
facts.properties.originalPromptAvailable = { type: ['boolean', 'null'] };
export const CASE_SOURCE_PROPERTIES = { sourceUrl: text, sourceFacts: facts };
export const CREATIVE_NOTE_PROPERTIES = { prompt: text, summary: text, notes: text, purpose: text, plan: text };
const source = CASE_SOURCE_PROPERTIES;
const identity = { caseId: id, expectedRevision: id };
const requestId = { type: 'string', pattern: '^[a-zA-Z0-9_-]{1,128}$' };
export const CASE_SEARCH_PROPERTIES = {
  ...CASE_QUERY_PROPERTIES,
  query: { type: 'string', default: '', description: '可与similarTo或similarText合并：按用户明确在意的内容用区分性词过滤，再按文字相似排序。同片名/班底不等于同技法；多个词是交集，同义表达用alternatives。探索任务不强制所有标签一致。' },
  alternatives: { type: 'array', items: { type: 'string', minLength: 1 }, description: '同义或并列查询做并集；每个查询中的多个词是交集' },
  project: { type: 'string', description: '项目名称或已知ID，包含子项目；同名时指定ID' },
  provider: { type: 'string', minLength: 1, description: '按已保存sourceFacts.provider精确匹配来源平台，不搜索正文提及的平台' },
  authorHandle: { type: 'string', minLength: 1, description: '按已保存sourceFacts.handle精确匹配作者账号，忽略前导@和大小写；正文致谢或提及不算作者' },
  mediaKind: { enum: ['image', 'video', 'document'], description: '只按实际素材类型筛选，忽略视频封面' },
  hasOriginalPrompt: { type: 'boolean', description: '有无原词；指定mediaKind时只判断该类素材，AI逆推不算原词；组合任一匹配素材有原词即为true' },
  hasPrompt: { type: 'boolean', description: '有无可用原词或已存AI词，指定mediaKind时只判断该类素材。false可只补查缺提示词的候选，不重复检查已能按词判断的案例。' },
  minDurationMs: { type: 'number', minimum: 0, description: '视频或音频素材最短时长（毫秒，包含边界）；未知时长不当作0；与原词筛选匹配同一素材' },
  maxDurationMs: { type: 'number', minimum: 0, description: '视频或音频素材最长时长（毫秒，包含边界）；返回durationCoverage说明未知时长范围' },
  expectedRevision: { type: 'string', minLength: 1, description: '翻页必须携带首屏revision并保持筛选不变；search_changed时从第一页重新检索，不混用新旧结果' },
  sort: { enum: ['relevance', 'newest', 'oldest', 'engagement'] },
  engagementMetric: { type: 'string', minLength: 1, description: 'sort=engagement时必填，如likes或reposts；按已保存指标降序，未知排末，不合成跨平台评分。先指定provider确保可比；组合多来源不合计热度。' },
  countOnly: { type: 'boolean' }
};
const caseDetailPart = { enum: ['overview', 'source', 'media', 'document', 'annotations', 'organization', 'analysis_coverage', 'creative'] };
export const CASE_OPERATION_SPECS = [
  { name: 'read_case_details', description: '读取案例的完整结构与修改版本。首次读取可省略expectedRevision，后续只使用本工具返回的案例revision；不能传入页面现场/控制/全文版本。只需一部分用part；同时需要多部分用parts数组（与part互斥），例如parts=[overview,source,media]一次取得同一版本，content为按部分命名的JSON对象，避免分三次调用。正文全文用document；无需的部分不读取。analysis_coverage列逐媒体已存分析、原件摘要和实际coverage，未记录范围为null，不能当作全图/全片。verification=verified_at_save只证明保存时核验，当前读取不重验文件字节。content 是分页 JSON，须按 nextOffset 读完再解析。后续分页携带 expectedRevision，避免混合不同版本。组合案例返回成员编号，编辑时指定成员。仅读取元数据，不下载原件。',
    parameters: object({ caseId: id, part: caseDetailPart, parts: { ...list(caseDetailPart), minItems: 1, uniqueItems: true, description: '同时需要多个部分时一次读取；与part互斥，续页保持parts和revision' },
      expectedRevision: id, offset: { type: 'integer', minimum: 0 }, length: { type: 'integer', minimum: 1, maximum: 49152 } }, ['caseId']) },
  { name: 'edit_case', description: '在用户委托范围内编辑已有案例，先读取当前版本。原文、来源和原始提示词默认保护；仅用户明确要求修正时用sourceCorrection列明字段与原因。creative精准编辑自己的prompt/summary/notes/purpose/plan，不改原资料。classificationPathIds使用已读分类编号，mediaOrder提供全部媒体编号排列，不改原件或段落结构。仅修改 patch 提供的字段；sourceFacts 中 null 明确清除错误字段。coverVisualId设置已存在的图片为封面，null恢复自动封面，不替换视频原件。组合案例可改title/customLabels/coverVisualId，正文和媒体须指定成员。文章用 articlePatches 修改已读段落，不能用 text 覆盖结构化文章。媒体来源修改不改变原件；推断提示词使用 ai-suggestion，不冒称原始提示词。相同 requestId 重试返回原回执；版本冲突需重读，不能盲目覆盖。成功后返回真实修改版本。',
    parameters: object({ requestId, ...identity, sourceCorrection: object({ reason: id, fields: list({ enum: ['sourceUrl', 'sourceFacts', 'mediaSources', 'text', 'articlePatches', 'mediaPrompts'] }) }, ['reason', 'fields']), patch: object({ title: id, text,
      creative: object(CREATIVE_NOTE_PROPERTIES),
      classificationPathIds: { ...list(id), minItems: 1, maxItems: 1 },
      mediaOrder: { ...list(id), uniqueItems: true },
      ...source, customLabels: list(text), primaryMediaId: id, coverVisualId: nullableText,
      articlePatches: list(object({ blockId: id, text }, ['blockId', 'text'])),
      mediaSources: list(object({ assetId: id, originalWorkUrl: text, sourceTitle: text, sourceAuthor: text }, ['assetId'])),
      mediaPrompts: list(object({ assetId: id, text, source: { enum: ['manual', 'webpage', 'ai-suggestion'] } }, ['assetId', 'text', 'source'])),
      timeNotes: list(object({ id, assetId: id, startMs: { type: 'number', minimum: 0 }, endMs: { type: 'number', minimum: 0 }, text, frameAssetId: id }, ['assetId', 'startMs', 'text'])),
      removeTimeNoteIds: list(id)
    }) }, ['requestId', 'caseId', 'expectedRevision', 'patch']) },
  { name: 'organize_case', description: '按用户指定范围整理案例。remove_tags仅移除指定案例（组合含成员）的标签关联，customLabels为已读人工标签名称，nodeIds为已读分类标签编号；不删除词库、原件或其他案例，可在插件标签恢复入口撤回。combine_cases用caseId作为首成员，additionalCases按顺序提供其他成员及expectedRevision，title必填，可指定成员图片coverVisualId；原案例/原件/项目关系保留，成员不能已属于其他组合。split_compound用已读组合编号/版本恢复独立成员，不删除案例。split_media 将明确选择的媒体分到新案例，保留原件、封面、逐媒体提示词和笔记；新案例需明确标题、正文、来源，不能把旧案例正文冒充新来源。textBlockIds 可移动对应的已读正文段落。未选择内容留在原案例，项目归属沿用。move_media 转移到已读的目标案例（须目标版本）。move_project 是移动，copy_project 创建独立副本但复用原件。不会删除原件或自动合并相似案例。',
    parameters: object({ requestId, ...identity, action: { enum: ['split_media', 'move_media', 'move_project', 'copy_project', 'combine_cases', 'split_compound', 'remove_tags'] },
      title: id, coverVisualId: id, customLabels: list(id), nodeIds: list(id),
      additionalCases: { ...list(object(identity, ['caseId', 'expectedRevision'])), minItems: 1 },
      projectId: id, targetCaseId: id, targetRevision: id, assetIds: { ...list(id), minItems: 1, uniqueItems: true },
      groups: { ...list(object({ assetIds: { ...list(id), minItems: 1, uniqueItems: true }, title: id, text,
        ...source, textBlockIds: { ...list(id), uniqueItems: true } }, ['assetIds', 'title', 'text', 'sourceUrl'])), minItems: 1 }
    }, ['requestId', 'caseId', 'expectedRevision', 'action']) }
];

// Validate at the shared business boundary too; callers cannot bypass a host's schema.
export function validateCaseOperation(name, input) {
  const spec = CASE_OPERATION_SPECS.find(item => item.name === name);
  if (!spec) throw new Error('未知案例操作');
  validate(spec.parameters, input, name);
  if (name === 'read_case_details' && input.part !== undefined && input.parts !== undefined) {
    throw Object.assign(new Error('part与parts只能选择一种；需要多部分时使用parts'), { code: 'invalid_input' });
  }
}
export function validate(schema, value, path) {
  if (!schema || Object.keys(schema).length === 0) return;
  if (schema.enum && !schema.enum.includes(value)) throw new Error(`${path}：选项无效`);
  const types = Array.isArray(schema.type) ? schema.type : schema.type ? [schema.type] : [];
  const type = value === null ? 'null' : Array.isArray(value) ? 'array' : typeof value;
  if (types.length && !types.includes(type) && !(types.includes('integer') && Number.isSafeInteger(value))) throw new Error(`${path}：类型无效`);
  if (typeof value === 'string' && (schema.minLength && value.trim().length < schema.minLength || schema.pattern && !new RegExp(schema.pattern).test(value))) throw new Error(`${path}：文字无效`);
  if (typeof value === 'number' && (!Number.isFinite(value) || schema.minimum !== undefined && value < schema.minimum || schema.maximum !== undefined && value > schema.maximum)) throw new Error(`${path}：数值无效`);
  if (type === 'array') {
    if (schema.minItems && value.length < schema.minItems || schema.maxItems !== undefined && value.length > schema.maxItems || schema.uniqueItems && new Set(value).size !== value.length) throw new Error(`${path}：列表无效`);
    value.forEach((item, i) => validate(schema.items, item, `${path}[${i}]`));
  }
  if (type === 'object') {
    for (const key of schema.required || []) if (!Object.hasOwn(value, key)) throw new Error(`${path}：缺少 ${key}`);
    for (const [key, item] of Object.entries(value)) {
      const child = schema.properties && Object.hasOwn(schema.properties, key) ? schema.properties[key] : schema.additionalProperties;
      if (!child) throw new Error(`${path}：不支持 ${key}`);
      if (typeof child === 'object') validate(child, item, `${path}.${key}`);
    }
  }
}
