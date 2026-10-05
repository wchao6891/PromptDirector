// Input shapes shared with every host. Nested predicates are validated by the
// query service against the discoverable field registry, not arbitrary JSON paths.
const id = { type: 'string', minLength: 1 };
const object = properties => ({ type: 'object', properties, additionalProperties: false });
export const QUERY_OPERATORS = ['eq', 'ne', 'contains', 'startsWith', 'in', 'gt', 'gte', 'lt', 'lte', 'between', 'exists'];
const nested = { type: 'object', additionalProperties: true };
export const CASE_QUERY_PROPERTIES = {
  where: { ...object({ field: id, op: { enum: QUERY_OPERATORS }, value: {},
    all: { type: 'array', items: nested, minItems: 1 }, any: { type: 'array', items: nested, minItems: 1 }, not: nested,
    scope: { enum: ['member', 'source', 'media', 'label', 'project', 'classification'] }, where: nested }),
    description: '递归条件：{field,op,value}、{all:[条件]}、{any:[条件]}、{not:条件}，或{scope,where:条件}。scope在同一成员/来源/素材/标签/项目/分类上匹配；成员内可嵌套素材。字段和操作先用describe_case_query发现；未知字段报错，不退回全文。exists的value为布尔值；缺失不等于0。' },
  select: { type: 'array', items: id, minItems: 1, uniqueItems: true, description: '仅返回指定字段及caseId；正文和提示词按完整文字返回，不截摘要。过大单条请用read_case分页，不静默截断。' },
  orderBy: { type: 'array', minItems: 1, items: { ...object({ field: id, direction: { enum: ['asc', 'desc'] },
    reduce: { enum: ['min', 'max'] } }), required: ['field', 'direction'] },
    description: '全体匹配后依次排序，缺失永远排末、caseId最终打破平局。多值字段必须明确min/max，来源互动必须provider单平台条件；不自动合计组合帖子的热度。分组排序字段用groupBy键、group.count或aggregate.统计名称，不用reduce。与旧sort互斥。' },
  groupBy: { type: 'array', items: id, minItems: 1, uniqueItems: true, description: '全体匹配按字段分组；多归属每组只计同一案例一次，空值单独一组。组列表使用同一revision/offset/limit分页。' },
  aggregates: { type: 'array', minItems: 1, items: { ...object({ name: id, field: id,
    op: { enum: ['count', 'known', 'missing', 'sum', 'avg', 'min', 'max'] }, reduce: { enum: ['min', 'max'] } }), required: ['name', 'op'] },
    description: '全匹配集或每组统计。count为案例数，无field；known/missing为字段已知/缺失案例数。数值统计忽略缺失并返回known/missing，不将缺失补0；多值数值须指定min/max，不隐式相加。' },
  similarTo: { ...object({ caseId: id, method: { enum: ['local', 'prompt', 'palette', 'tags'] } }), required: ['caseId', 'method'],
    description: '指定参考案例和比较方式，复用本地相似引擎。只比较同媒体域；原词/色卡/标签缺失用null和coverage说明；local保留引擎优先规则和fallback依据，其他方法无替代。参考不在结果里，不读取图像或猜测画面。' }
};
export const CASE_QUERY_DESCRIPTION = '结构化查资料用where组合字段、select选列、orderBy多字段排序、groupBy/aggregates统计、similarTo按参考找相似；先用describe_case_query查字段、关系和库内动态互动指标。条件在全匹配集上执行后分页；续页携带revision并保持全部参数，缺失不当0，原词与AI词分别查询。';
