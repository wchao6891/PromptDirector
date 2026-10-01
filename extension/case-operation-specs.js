// Pure schemas shared by the local creative workspace and the installed MCP adapter.
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
const source = { sourceUrl: text, sourceFacts: facts };
const identity = { caseId: id, expectedRevision: id };
const requestId = { type: 'string', pattern: '^[a-zA-Z0-9_-]{1,128}$' };
export const CASE_SEARCH_PROPERTIES = {
  query: { type: 'string', default: '' },
  alternatives: { type: 'array', items: { type: 'string', minLength: 1 }, description: '同义或并列查询做并集；每个查询中的多个词是交集' },
  project: { type: 'string', description: '项目名称或已知ID，包含子项目；同名时指定ID' },
  mediaKind: { enum: ['image', 'video', 'document'], description: '只按实际素材类型筛选，忽略视频封面' },
  hasOriginalPrompt: { type: 'boolean', description: '有无原词；指定mediaKind时只判断该类素材，AI逆推不算原词；组合任一匹配素材有原词即为true' },
  minDurationMs: { type: 'number', minimum: 0, description: '视频或音频素材最短时长（毫秒，包含边界）；未知时长不当作0；与原词筛选匹配同一素材' },
  maxDurationMs: { type: 'number', minimum: 0, description: '视频或音频素材最长时长（毫秒，包含边界）；返回durationCoverage说明未知时长范围' },
  expectedRevision: { type: 'string', minLength: 1, description: '翻页必须携带首屏revision并保持筛选不变；search_changed时从第一页重新检索，不混用新旧结果' },
  sort: { enum: ['relevance', 'newest', 'oldest'] },
  countOnly: { type: 'boolean' }
};
export const CASE_OPERATION_SPECS = [
  { name: 'read_case_details', description: '读取案例的完整结构与修改版本。part 分别读取概览、来源、媒体、正文结构、标注、项目关系；content 是分页 JSON，须按 nextOffset 读完再解析。后续分页携带 expectedRevision，避免混合不同版本。组合案例返回成员编号，编辑时指定成员。仅读取元数据，不下载原件。',
    parameters: object({ caseId: id, part: { enum: ['overview', 'source', 'media', 'document', 'annotations', 'organization'] },
      expectedRevision: id, offset: { type: 'integer', minimum: 0 }, length: { type: 'integer', minimum: 1, maximum: 49152 } }, ['caseId']) },
  { name: 'edit_case', description: '在用户委托范围内编辑已有案例，先读取当前版本。仅修改 patch 提供的字段；sourceFacts 中 null 明确清除错误字段。文章用 articlePatches 修改已读段落，不能用 text 覆盖结构化文章。媒体来源修改不改变原件；推断提示词使用 ai-suggestion，不冒称原始提示词。相同 requestId 重试返回原回执；版本冲突需重读，不能盲目覆盖。成功后返回真实修改版本。',
    parameters: object({ requestId, ...identity, patch: object({ title: id, text,
      ...source, customLabels: list(text), primaryMediaId: id,
      articlePatches: list(object({ blockId: id, text }, ['blockId', 'text'])),
      mediaSources: list(object({ assetId: id, originalWorkUrl: text, sourceTitle: text, sourceAuthor: text }, ['assetId'])),
      mediaPrompts: list(object({ assetId: id, text, source: { enum: ['manual', 'webpage', 'ai-suggestion'] } }, ['assetId', 'text', 'source'])),
      timeNotes: list(object({ id, assetId: id, startMs: { type: 'number', minimum: 0 }, endMs: { type: 'number', minimum: 0 }, text, frameAssetId: id }, ['assetId', 'startMs', 'text'])),
      removeTimeNoteIds: list(id)
    }) }, ['requestId', 'caseId', 'expectedRevision', 'patch']) },
  { name: 'organize_case', description: '按用户指定范围整理案例。split_media 将明确选择的媒体分到新案例，保留原件、封面、逐媒体提示词和笔记；新案例需明确标题、正文、来源，不能把旧案例正文冒充新来源。textBlockIds 可移动对应的已读正文段落。未选择内容留在原案例，项目归属沿用。move_media 转移到已读的目标案例（须目标版本）。move_project 是移动，copy_project 创建独立副本但复用原件。不会删除原件或自动合并相似案例。',
    parameters: object({ requestId, ...identity, action: { enum: ['split_media', 'move_media', 'move_project', 'copy_project'] },
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
}
export function validate(schema, value, path) {
  if (schema.enum && !schema.enum.includes(value)) throw new Error(`${path}：选项无效`);
  const types = Array.isArray(schema.type) ? schema.type : schema.type ? [schema.type] : [];
  const type = value === null ? 'null' : Array.isArray(value) ? 'array' : typeof value;
  if (types.length && !types.includes(type) && !(types.includes('integer') && Number.isSafeInteger(value))) throw new Error(`${path}：类型无效`);
  if (typeof value === 'string' && (schema.minLength && value.trim().length < schema.minLength || schema.pattern && !new RegExp(schema.pattern).test(value))) throw new Error(`${path}：文字无效`);
  if (typeof value === 'number' && (!Number.isFinite(value) || schema.minimum !== undefined && value < schema.minimum || schema.maximum !== undefined && value > schema.maximum)) throw new Error(`${path}：数值无效`);
  if (type === 'array') {
    if (schema.minItems && value.length < schema.minItems || schema.uniqueItems && new Set(value).size !== value.length) throw new Error(`${path}：列表无效`);
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
