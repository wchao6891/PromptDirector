import { createCaseQueryContext, normalizeQueryDate } from './case-query-fields.js';
import { createSimilarityIndex, rankSimilarEntries } from './local-similarity.js';
import { entryMediaAssets, caseCoverAsset } from './media.js';
import { CASE_QUERY_PROPERTIES } from './case-query-specs.js';
import { serializeSearchValue } from './search-index.js';
import { operationBudget, resourceBudgetError } from './resource-policy.js';

const fail = message => { throw Object.assign(new Error(message), { code: 'invalid_case_query' }); };
const missing = value => value === null || value === undefined || value === '';
const array = value => Array.isArray(value) ? value : [value];
const unique = values => [...new Set(values.filter(value => !missing(value)))];
const compare = (a, b) => typeof a === 'number' ? a - b : typeof a === 'boolean' ? Number(a) - Number(b) : String(a).localeCompare(String(b), 'en');
const validScopes = {
  case: ['member', 'source', 'media', 'label', 'project', 'classification'],
  member: ['source', 'media', 'label', 'project', 'classification'],
  source: ['media', 'label', 'project', 'classification'], media: ['label', 'source'], label: ['source'], project: [], classification: ['source']
};
function keys(value, allowed) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(key => !allowed.includes(key))) fail('查询结构或属性无效。请按describe_case_query提供的条件格式传入。');
}

export function prepareCaseQuery(entries, input, options = {}) {
  const similarities = new Map();
  const context = createCaseQueryContext(entries, { ...options, similarities, sourceFilters: input });
  let similarityCoverage;
  let similarityOrder;
  if (input.similarTo) {
    const { caseId, method } = input.similarTo;
    const reference = entries.find(entry => entry.id === caseId);
    if (!reference) fail('参考案例不存在，请重新选择已知caseId。');
    const index = createSimilarityIndex(entries, options.facetCatalog, {
      mediaForEntry: entryMediaAssets,
      visualForEntry: entry => caseCoverAsset(entry)?.id,
      colorsForEntry: entry => {
        const visual = caseCoverAsset(entry);
        return (visual?.palette ?? context.derived.get(visual?.id)?.palette)?.colors ?? [];
      }
    });
    const ranked = rankSimilarEntries(index, caseId, Infinity, { method });
    for (const item of ranked) similarities.set(item.entry.id, { score: item.score,
      prompt: item.promptAvailable === false ? null : item.promptSimilarity,
      palette: item.paletteAvailable === false ? null : item.paletteSimilarity,
      tags: item.tagsAvailable === false ? null : item.tagSimilarity,
      method, fallback: item.fallback, reason: item.reason, sameContentType: item.sameContentType });
    const domain = index.profiles.get(caseId)?.domain;
    const comparable = (index.domains.get(domain) ?? []).filter(profile => profile.entry.id !== caseId);
    similarityCoverage = { referenceCaseId: caseId, method, scope: '当前库同媒体域；不包含参考自身，未做视觉识别',
      sameDomainCases: comparable.length, comparedCases: ranked.length, unknownExcluded: comparable.length - ranked.length,
      differentDomainCases: entries.length - comparable.length - 1,
      knownPromptPairs: comparable.filter(profile => index.profiles.get(caseId).prompt.size && profile.prompt.size).length,
      knownPalettePairs: comparable.filter(profile => index.profiles.get(caseId).labs.length && profile.labs.length).length,
      knownTagPairs: comparable.filter(profile => index.profiles.get(caseId).tags.size && profile.tags.size).length };
    similarityOrder = new Map(ranked.map((item, i) => [item.entry.id, i]));
  }
  function definition(name, scope = 'case') {
    const field = context.fields.get(name);
    if (!field) fail(`不支持字段${name}；先调用describe_case_query发现实际字段与互动指标。`);
    if (!field.scopes.includes(scope)) fail(`${name}不能用于${scope}作用域。`);
    if (name.startsWith('similarity.') && !input.similarTo) fail('相似度字段需要similarTo指定参考caseId和method。');
    return field;
  }
  function values(field, record) { return unique(array(field.read(record))); }
  function typed(field, value) {
    if (field.type === 'date') {
      const date = normalizeQueryDate(value);
      if (!date) fail(`${field.name}需要有效ISO日期，或带Z/时区偏移的ISO时间；不猜测无时区时间或错误日期。`);
      return date;
    }
    if (typeof value !== field.type || typeof value === 'number' && !Number.isFinite(value)) fail(`${field.name}需要${field.type}值。`);
    const normalized = field.normalize ? field.normalize(value) : value;
    if (normalized === null || normalized === '') fail(`${field.name}值无效。`);
    return normalized;
  }
  function predicate(condition, scope = 'case') {
    keys(condition, ['all', 'any', 'not', 'scope', 'where', 'field', 'op', 'value']);
    const branches = ['all', 'any', 'not', 'scope', 'field'].filter(key => Object.hasOwn(condition, key));
    if (branches.length !== 1) fail('每个条件只能是all、any、not、scope或field之一。');
    const branch = branches[0];
    const allowed = branch === 'scope' ? ['scope', 'where'] : branch === 'field' ? ['field', 'op', 'value'] : [branch];
    keys(condition, allowed);
    if (branch === 'all' || branch === 'any') {
      if (!Array.isArray(condition[branch]) || !condition[branch].length) fail(`${branch}需要非空条件列表。`);
      const children = condition[branch].map(child => predicate(child, scope));
      return record => branch === 'all' ? children.every(test => test(record)) : children.some(test => test(record));
    }
    if (branch === 'not') { const child = predicate(condition.not, scope); return record => !child(record); }
    if (branch === 'scope') {
      if (!validScopes[scope]?.includes(condition.scope)) fail(`${scope}中不能嵌套${condition.scope}关系。`);
      const child = predicate(condition.where, condition.scope);
      return record => context.related(record, condition.scope).some(child);
    }
    const field = definition(condition.field, scope), op = condition.op;
    if (!field.operators.includes(op)) fail(`${field.name}不支持操作${op}。`);
    if (!Object.hasOwn(condition, 'value')) fail('字段条件缺少value。');
    if (op === 'exists') {
      if (typeof condition.value !== 'boolean') fail('exists的value必须为布尔值。');
      return record => Boolean(values(field, record).length) === condition.value;
    }
    const multiple = op === 'in' || op === 'between';
    if (multiple && (!Array.isArray(condition.value) || !condition.value.length || op === 'between' && condition.value.length !== 2)) fail(`${op}值列表无效。`);
    const value = multiple ? condition.value.map(item => typed(field, item)) : typed(field, condition.value);
    if (op === 'between' && compare(value[0], value[1]) > 0) fail('区间下界不能大于上界。');
    const match = item => {
      const actual = field.normalize ? field.normalize(item) : item;
      if (op === 'eq' || op === 'ne') return actual === value;
      if (op === 'in') return value.includes(actual);
      if (op === 'contains' || op === 'startsWith') return String(actual).toLocaleLowerCase()[op === 'contains' ? 'includes' : 'startsWith'](String(value).toLocaleLowerCase());
      if (op === 'between') return compare(actual, value[0]) >= 0 && compare(actual, value[1]) <= 0;
      const difference = compare(actual, value);
      return op === 'gt' ? difference > 0 : op === 'gte' ? difference >= 0 : op === 'lt' ? difference < 0 : difference <= 0;
    };
    return record => { const items = values(field, record); return op === 'ne' ? items.length > 0 && !items.some(match) : items.some(match); };
  }
  const test = input.where ? predicate(input.where) : () => true;
  const selection = input.select?.map(name => definition(name));
  function checkScalar(field, reduce) {
    if (field.multi && !reduce) fail(`${field.name}是多值字段，排序/数值统计必须明确reduce=min或max。`);
    if (field.fullText) fail(`${field.name}完整文字不能用于排序或分组；使用精确身份/短元信息。`);
    if (field.name.startsWith('source.engagement.') && !input.provider?.trim()) fail('互动排序/数值统计须顶层provider限定单一平台；不合成跨平台热度。');
  }
  const groups = input.groupBy?.map(name => { const field = definition(name); if (field.fullText) fail('完整正文/提示词不能作为分组键。'); return field; });
  if (groups && input.select) fail('groupBy返回分组键与统计；不能同时使用案例选列select。');
  if ((groups || input.orderBy) && input.sort && input.sort !== 'relevance') fail('orderBy/groupBy与案例sort不可同时指定。');
  const names = new Set();
  const aggregates = (input.aggregates ?? []).map(item => {
    if (names.has(item.name)) fail('统计name必须唯一。'); names.add(item.name);
    if (item.op === 'count') { if (item.field || item.reduce) fail('count按案例计数，不接受field/reduce。'); return item; }
    if (!item.field) fail(`${item.op}需要field。`);
    const field = definition(item.field);
    if (!field.aggregates.includes(item.op)) fail(`${item.field}不支持统计${item.op}。`);
    if (!['known', 'missing'].includes(item.op)) checkScalar(field, item.reduce);
    return { ...item, definition: field };
  });
  const ordering = (input.orderBy ?? []).map(item => {
    if (!groups) {
      const field = definition(item.field); checkScalar(field, item.reduce);
      return { ...item, definition: field };
    }
    if (item.reduce) fail('分组排序的键或统计值已是单值，不使用reduce。');
    if (item.field === 'group.count') return { ...item, groupValue: row => row.count };
    const aggregate = aggregates.find(aggregate => `aggregate.${aggregate.name}` === item.field);
    if (aggregate) return { ...item, groupValue: row => row.aggregates[aggregate.name].value };
    if (groups.some(field => field.name === item.field)) return { ...item, groupValue: row => row.key[item.field] };
    fail('分组排序只能使用groupBy中的字段、group.count或aggregate.统计名称。');
  });
  function scalar(field, record, reduce) {
    const items = unique(array(record).flatMap(item => values(field, item)));
    if (!items.length) return null;
    return items.reduce((current, next) => compare(current, next) * (reduce === 'max' ? 1 : -1) >= 0 ? current : next);
  }
  const fieldScope = field => ({ source: 'source', media: 'media', palette: 'media', label: 'label', project: 'project', classification: 'classification' })[field.name.split('.')[0]];
  function statistics(list, scopedRecords) {
    return Object.fromEntries(aggregates.map(item => {
      if (item.op === 'count') return [item.name, { value: list.length }];
      const data = list.map(entry => scalar(item.definition, scopedRecords?.get(entry.id)?.[fieldScope(item.definition)] ?? context.root(entry), item.reduce)).filter(value => value !== null);
      const known = data.length, missingCount = list.length - known;
      let value = item.op === 'known' ? known : item.op === 'missing' ? missingCount : null;
      if (known && !['known', 'missing'].includes(item.op)) {
        if (item.op === 'sum' || item.op === 'avg') value = data.reduce((total, value) => total + value, 0) / (item.op === 'avg' ? known : 1);
        else value = data.reduce((a, b) => item.op === 'max' ? Math.max(a, b) : Math.min(a, b));
        if (!Number.isFinite(value)) fail('数值统计溢出，无法返回可靠数值。');
      }
      return [item.name, { value, known, missing: missingCount }];
    }));
  }
  function grouped(list) {
    if (!groups) return undefined;
    const result = new Map();
    const maxGroupKeyBytes = operationBudget(options.budget).maxTextBytes;
    const encoder = new TextEncoder();
    let groupKeyBytes = 0;
    const families = new Map();
    for (const field of groups) {
      const scope = fieldScope(field) ?? 'case';
      if (!families.has(scope)) families.set(scope, []);
      families.get(scope).push(field);
    }
    for (const entry of list) {
      let combinations = [{ key: {}, records: {} }];
      for (const [scope, fields] of families) {
        const root = context.root(entry);
        const records = scope === 'case' ? [root] : context.related(root, scope);
        const variants = [];
        let variantBytes = 0;
        for (const record of records.length ? records : [null]) {
          let keys = [{}];
          for (const field of fields) {
            const items = record ? values(field, record) : [];
            const nextKeys = [];
            let keyBytes = 0;
            for (const row of keys) for (const value of items.length ? items : [null]) {
              const key = { ...row, [field.name]: value };
              keyBytes += encoder.encode(serializeSearchValue(key)).length;
              if (keyBytes > maxGroupKeyBytes) throw resourceBudgetError('单条关系记录分组组合超过本次文本处理预算；减少分组维度，资料保留，不返回不完整统计。');
              nextKeys.push(key);
            }
            keys = nextKeys;
          }
          for (const key of keys) {
            variantBytes += encoder.encode(serializeSearchValue(key)).length;
            if (variantBytes > maxGroupKeyBytes) throw resourceBudgetError('关系分组总量超过本次文本处理预算；减少分组维度或缩小范围，资料保留。');
            variants.push({ key, record });
          }
        }
        const next = [];
        let combinationBytes = 0;
        for (const row of combinations) for (const variant of variants) {
          const key = { ...row.key, ...variant.key };
          combinationBytes += encoder.encode(serializeSearchValue(key)).length;
          if (combinationBytes > maxGroupKeyBytes) throw resourceBudgetError('单个案例的多归属分组组合超过本次文本处理预算；减少分组维度或先缩小匹配范围，资料保留，不返回不完整统计。');
          next.push({ key, records: { ...row.records, [scope]: variant.record } });
        }
        combinations = next;
      }
      for (const { key, records } of combinations) {
        const identity = serializeSearchValue(key);
        if (!result.has(identity)) {
          groupKeyBytes += encoder.encode(identity).length;
          if (groupKeyBytes > maxGroupKeyBytes) throw resourceBudgetError('分组键总量超过本次文本处理预算；减少分组维度或缩小查询范围，资料保留，不截断统计。');
          result.set(identity, { key, entries: new Map(), records: new Map() });
        }
        const group = result.get(identity);
        group.entries.set(entry.id, entry);
        if (!group.records.has(entry.id)) group.records.set(entry.id, {});
        for (const [scope, record] of Object.entries(records)) {
          if (!group.records.get(entry.id)[scope]) group.records.get(entry.id)[scope] = [];
          if (record && !group.records.get(entry.id)[scope].includes(record)) group.records.get(entry.id)[scope].push(record);
        }
      }
    }
    const rows = [...result.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([, group]) => ({ key: group.key, count: group.entries.size, aggregates: statistics([...group.entries.values()], group.records) }));
    if (ordering.length) rows.sort((a, b) => {
      for (const order of ordering) {
        const left = order.groupValue(a), right = order.groupValue(b);
        const difference = left === null ? right === null ? 0 : 1 : right === null ? -1 : compare(left, right) * (order.direction === 'desc' ? -1 : 1);
        if (difference) return difference;
      }
      return serializeSearchValue(a.key).localeCompare(serializeSearchValue(b.key));
    });
    return rows;
  }
  return { context, similarities, similarityCoverage,
    execute(candidates) {
      const matches = candidates.filter(entry => (!input.similarTo || similarities.has(entry.id)) && test(context.root(entry)));
      if (ordering.length && !groups) matches.sort((a, b) => {
        for (const order of ordering) {
          const left = scalar(order.definition, context.root(a), order.reduce), right = scalar(order.definition, context.root(b), order.reduce);
          const difference = left === null ? right === null ? 0 : 1 : right === null ? -1 : compare(left, right) * (order.direction === 'desc' ? -1 : 1);
          if (difference) return difference;
        }
        return a.id.localeCompare(b.id);
      });
      else if (similarityOrder && (!input.sort || input.sort === 'relevance')) matches.sort((a, b) => similarityOrder.get(a.id) - similarityOrder.get(b.id));
      return { matches, groups: grouped(matches), aggregates: aggregates.length ? statistics(matches) : undefined, similarityCoverage };
    },
    row(entry) {
      if (!selection) return undefined;
      return Object.fromEntries([['caseId', entry.id], ...selection.filter(field => field.name !== 'caseId').map(field => {
        const items = values(field, context.root(entry));
        return [field.name, field.multi ? items : items[0] ?? null];
      })]);
    },
    signature: () => ({ fields: [...context.fields.keys()], taxonomy: options.taxonomy, facets: options.facetCatalog,
      rows: entries.map(entry => ({ entry: queryEntrySnapshot(entry), contentRoles: context.fields.get('contentRole').read(context.root(entry)), documentText: context.related(context.root(entry), 'media').map(m => documentsFor(context, m.asset.id)),
        derived: context.related(context.root(entry), 'media').map(m => context.derived.get(m.asset.id)) })), similarities: [...similarities] })
  };
}
function queryEntrySnapshot(entry) {
  // The page reader decorates content meanings; the background reads source
  // records. Hash resolved roles separately so both hosts share a revision.
  const { contentRole, contentTypeName, memberEntries, ...record } = entry;
  return { ...record, ...(memberEntries ? { memberEntries: memberEntries.map(queryEntrySnapshot) } : {}) };
}
function documentsFor(context, assetId) { return context.documents.get(assetId); }
export function isStructuredCaseQuery(input) { return Object.keys(CASE_QUERY_PROPERTIES).some(key => input[key] !== undefined); }
