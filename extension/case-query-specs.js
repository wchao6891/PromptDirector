// Input shapes shared with every host. Nested predicates are validated by the
// query service against the discoverable field registry, not arbitrary JSON paths.
const id = { type: 'string', minLength: 1 };
const object = properties => ({ type: 'object', properties, additionalProperties: false });
export const QUERY_OPERATORS = ['eq', 'ne', 'contains', 'startsWith', 'in', 'gt', 'gte', 'lt', 'lte', 'between', 'exists'];
const nested = { type: 'object', additionalProperties: true };
export const CASE_QUERY_PROPERTIES = {
  similarText: { type: 'string', minLength: 1, description: '使用尚未入库的完整文字或提示词找本地文字相似案例，不创建临时案例、不调用模型。与similarTo互斥，可结合mediaKind/query/where。相似分数是提示词词语重合，不是画面相似概率；缺词案例不参加比较，coverage如实列出。' },
  where: { ...object({ field: id, op: { enum: QUERY_OPERATORS }, value: {},
    all: { type: 'array', items: nested, minItems: 1 }, any: { type: 'array', items: nested, minItems: 1 }, not: nested,
    scope: { enum: ['member', 'source', 'media', 'label', 'project', 'classification'] }, where: nested }),
    description: '递归条件：{field,op,value}、{all:[条件]}、{any:[条件]}、{not:条件}，或{scope,where:条件}。scope在同一成员/来源/素材/标签/项目/分类上匹配；成员内可嵌套素材。字段和操作先用describe_case_query发现；未知字段报错，不退回全文。exists的value为布尔值；缺失不等于0。' },
  select: { type: 'array', items: id, minItems: 1, uniqueItems: true, description: '仅返回指定字段及caseId。找参考通常省略，默认候选含摘要、媒体、来源与相似依据，避免只取标题后逐条补读。显式选择的正文和提示词返回完整文字；过大单条用read_case分页，不静默截断。' },
  orderBy: { type: 'array', minItems: 1, items: { ...object({ field: id, direction: { enum: ['asc', 'desc'] },
    reduce: { enum: ['min', 'max'] } }), required: ['field', 'direction'] },
    description: '全体匹配后依次排序，缺失永远排末、caseId最终打破平局。多值字段必须明确min/max，来源互动必须provider单平台条件；不自动合计组合帖子的热度。分组排序字段用groupBy键、group.count或aggregate.统计名称，不用reduce。与旧sort互斥。' },
  groupBy: { type: 'array', items: id, minItems: 1, uniqueItems: true, description: '全体匹配按字段分组；多归属每组只计同一案例一次，空值单独一组。组列表使用同一revision/offset/limit分页。' },
  aggregates: { type: 'array', minItems: 1, items: { ...object({ name: id, field: id,
    op: { enum: ['count', 'known', 'missing', 'sum', 'avg', 'min', 'max'] }, reduce: { enum: ['min', 'max'] } }), required: ['name', 'op'] },
    description: '全匹配集或每组统计。count为案例数，无field；known/missing为字段已知/缺失案例数。数值统计忽略缺失并返回known/missing，不将缺失补0；多值数值须指定min/max，不隐式相加。' },
  similarTo: { ...object({ caseId: id, method: { enum: ['prompt', 'local', 'palette', 'tags'], default: 'prompt' } }), required: ['caseId'],
    description: '按参考找相似，默认prompt按完整提示词的词语重合排序，不是画面相似概率；片名/班底/模板也会贡献分数，须按用户目标判断摘要中的关键差异，必要时合并query/where筛选。逐素材原词优先、缺失用已存AI词并标来源；指定mediaKind时仅比较该类素材，混合案例也可匹配纯视频/图片。候选含摘要及coverage。缺词才补其他依据，不默认看图/视频。local/palette/tags保留本地同媒体域规则；无证据为null，0为没有已知词语重合。' }
};
export const CASE_QUERY_DESCRIPTION = '找相似用similarTo或未入库文字similarText，并指定所需mediaKind，省略select保留候选依据；limit由任务所需候选量决定，足够回答即交付，不必读完分页。where组合字段、orderBy排序、groupBy/aggregates统计；字段不明时才describe_case_query，同一会话复用已知定义。条件在全匹配集执行后分页；续页携带revision并保持参数，缺失不当0，原词与AI词分别查询。';
