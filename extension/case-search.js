import { searchIndexedEntries, serializeSearchValue, searchResultVersion } from './search-index.js';
import { collectionEntryIds } from './organizer.js';
import { entryMediaAssets } from './media.js';
import { caseOriginalPromptText, detailPromptSources } from './prompt-sources.js';
import { CASE_SEARCH_PROPERTIES, validate } from './case-operation-specs.js';
import { sha256Blob } from './blob-digest.js';
import { prepareCaseQuery, isStructuredCaseQuery } from './case-query.js';
import { agentDownloadChunkBytes } from './agent-protocol.js';

function invalid(message, code = 'invalid_input') {
  return Object.assign(new Error(message), { code });
}

const sourceValue = value => String(value ?? '').trim().toLocaleLowerCase('en-US');
export function caseSearchSources(entry, input = {}) {
  return (entry.memberEntries?.length ? entry.memberEntries : [entry]).filter(source =>
    (!input.provider || sourceValue(source.sourceFacts?.provider) === sourceValue(input.provider)) &&
    (!input.authorHandle || sourceValue(source.sourceFacts?.handle).replace(/^@/, '') === sourceValue(input.authorHandle).replace(/^@/, '')));
}
export function caseSearchSourceSummary(entry, input = {}) {
  return caseSearchSources(entry, input).map(source => ({ caseId: source.id,
    provider: source.sourceFacts?.provider ?? null, author: source.sourceFacts?.author ?? null,
    handle: source.sourceFacts?.handle ?? null, engagement: source.sourceFacts?.engagement ?? null,
    engagementObservedAt: source.sourceFacts?.engagementObservedAt ?? null }));
}
function engagementValue(entry, input) {
  const sources = caseSearchSources(entry, input);
  if (sources.length !== 1) return null;
  const value = sources[0].sourceFacts?.engagement?.[input.engagementMetric];
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
}

// Shared by internal and external creative tools. Structural filtering happens
// before external document/index work, so excluded projects do not need reads.
export function filterCaseSearchEntries(entries, organizerState, input = {}) {
  for (const [name, definition] of Object.entries(CASE_SEARCH_PROPERTIES)) if (input[name] !== undefined) {
    try { validate(definition, input[name], name); } catch (error) { throw invalid(error.message); }
  }
  const hasDuration = input.minDurationMs !== undefined || input.maxDurationMs !== undefined;
  if (hasDuration && input.mediaKind && input.mediaKind !== 'video') throw invalid('时长筛选仅用于视频；不指定类型时包含视频和音频。');
  if (input.minDurationMs !== undefined && input.maxDurationMs !== undefined && input.minDurationMs > input.maxDurationMs) throw invalid('最短时长不能大于最长时长。');
  if (input.mediaKind !== undefined && !CASE_SEARCH_PROPERTIES.mediaKind.enum.includes(input.mediaKind)) throw invalid('素材类型无效。');
  if (input.hasOriginalPrompt !== undefined && typeof input.hasOriginalPrompt !== 'boolean') throw invalid('原始提示词筛选必须为布尔值。');
  if (input.authorHandle !== undefined && !sourceValue(input.authorHandle).replace(/^@/, '')) throw invalid('作者账号不能为空。');
  if (input.sort === 'engagement' && (!input.engagementMetric?.trim() || !input.provider?.trim())) throw invalid('互动排序需要指定来源平台provider和明确指标engagementMetric；不合成跨平台热度。');
  if (input.engagementMetric !== undefined && input.sort !== 'engagement') throw invalid('engagementMetric仅用于sort=engagement。');
  const collections = organizerState?.collections || [];
  const exact = input.project && collections.find(item => item.id === input.project);
  const projects = input.project ? exact ? [exact] : collections.filter(item => item.name === input.project) : [];
  if (input.project && projects.length !== 1) throw invalid('项目不存在或名称不唯一，请使用已查询到的项目编号。', 'ambiguous_project');
  const members = input.project ? new Set(collectionEntryIds(organizerState, projects[0].id, { subtree: true })) : null;
  return entries.filter(entry => {
    if (members && !members.has(entry.id) && !entry.memberEntryIds?.some(id => members.has(id))) return false;
    const sources = caseSearchSources(entry, input);
    if (!sources.length) return false;
    if (!input.mediaKind && input.hasOriginalPrompt === undefined && !hasDuration) return true;
    const matching = sources.flatMap(source => entryMediaAssets(source)
      .filter(asset => asset.usage !== 'poster' && (!input.mediaKind || asset.kind === input.mediaKind))
      .filter(asset => !hasDuration || ['video', 'audio'].includes(asset.kind) && Number.isFinite(asset.durationMs) && asset.durationMs > 0
        && (input.minDurationMs === undefined || asset.durationMs >= input.minDurationMs)
        && (input.maxDurationMs === undefined || asset.durationMs <= input.maxDurationMs))
      .map(asset => ({ source, asset })));
    if ((input.mediaKind || hasDuration) && !matching.length) return false;
    if (input.hasOriginalPrompt !== undefined) {
      const hasOriginal = input.mediaKind || hasDuration
        ? matching.some(({ source, asset }) => Boolean(detailPromptSources(source, asset).original))
        : sources.some(source => Boolean(caseOriginalPromptText(source)));
      if (hasOriginal !== input.hasOriginalPrompt) return false;
    }
    return true;
  });
}

export function searchCaseEntries(entries, index, organizerState, input = {}) {
  const query = input.query ?? '';
  if (typeof query !== 'string') throw invalid('查询词必须是文字。');
  if (input.alternatives !== undefined && (!Array.isArray(input.alternatives) || input.alternatives.some(value => typeof value !== 'string' || !value.trim()))) throw invalid('并列查询词必须是非空文字。');
  if (input.sort && !['relevance', 'newest', 'oldest', 'engagement'].includes(input.sort)) throw invalid('排序方式无效。');
  const expressions = [query, ...(input.alternatives || [])];
  const queries = [...new Set(input.alternatives?.length ? expressions.filter(text => text.trim()) : expressions)];
  const ids = new Set(queries.flatMap(text => [...searchIndexedEntries(index, text)]));
  const matches = filterCaseSearchEntries(entries, organizerState, input).filter(entry => ids.has(entry.id));
  if (input.sort === 'newest' || input.sort === 'oldest') matches.sort((a, b) =>
    (String(a.savedAt).localeCompare(String(b.savedAt)) || a.id.localeCompare(b.id)) * (input.sort === 'newest' ? -1 : 1));
  if (input.sort === 'engagement') matches.sort((a, b) => {
    const left = engagementValue(a, input), right = engagementValue(b, input);
    return (left === null ? right === null ? 0 : 1 : right === null ? -1 : right - left) || a.id.localeCompare(b.id);
  });
  return matches;
}

// An offset identifies a position only within this exact result revision. Do not
// combine old and new pages when another window edits, deletes or imports cases.
export async function searchCaseResult(entries, index, organizerState, input = {}, resultVersion = searchResultVersion, options = {}) {
  filterCaseSearchEntries([], organizerState, input);
  const structured = isStructuredCaseQuery(input) ? prepareCaseQuery(entries, input, { ...options, organizerState }) : null;
  const result = structured?.execute(searchCaseEntries(entries, index, organizerState, input));
  const matches = result?.matches ?? searchCaseEntries(entries, index, organizerState, input);
  if ((input.offset || 0) > 0 && !input.expectedRevision) throw invalid('继续翻页需要首屏返回的 revision。', 'search_revision_required');
  const query = Object.fromEntries(Object.keys(CASE_SEARCH_PROPERTIES).filter(key => !['expectedRevision', 'countOnly'].includes(key))
    .map(key => [key, input[key] ?? (key === 'query' ? '' : key === 'alternatives' ? [] : key === 'sort' ? 'relevance' : null)]));
  let durationCoverage;
  if (input.minDurationMs !== undefined || input.maxDurationMs !== undefined) {
    const { minDurationMs, maxDurationMs, hasOriginalPrompt, ...withoutDuration } = input;
    const candidates = searchCaseEntries(entries, index, organizerState, withoutDuration);
    const durations = candidates.flatMap(entry => caseSearchSources(entry, input)
      .flatMap(source => entryMediaAssets(source).filter(a => a.usage !== 'poster' && ['video', 'audio'].includes(a.kind) && (!input.mediaKind || a.kind === input.mediaKind))));
    const known = durations.filter(a => Number.isFinite(a.durationMs) && a.durationMs > 0).length;
    durationCoverage = { scope: '文字、项目和媒体类型筛选后，应用时长与原词条件之前的素材', totalMedia: durations.length,
      knownDurationMedia: known, unknownDurationMedia: durations.length - known, unknownExcluded: true };
  }
  const byId = new Map(index.map(row => [row.id, row]));
  const engagementCoverage = input.sort === 'engagement' ? {
    provider: input.provider, metric: input.engagementMetric, basis: '已保存的互动观测，非实时热度；未知或组合多来源排末，不合计',
    knownCases: matches.filter(entry => engagementValue(entry, input) !== null).length,
    unknownCases: matches.filter(entry => engagementValue(entry, input) === null).length
  } : undefined;
  const projectScope = (organizerState?.collections || []).map(({ id, name, parentId }) => ({ id, name, parentId: parentId || null }));
  const revision = await sha256Blob(new Blob([serializeSearchValue({ query, projects: projectScope, durationCoverage,
    results: matches.map(entry => resultVersion(entry, byId.get(entry.id))),
    ...(structured ? { structured: structured.signature(), groups: result.groups, aggregates: result.aggregates } : {}) })]));
  if (input.expectedRevision && input.expectedRevision !== revision) throw invalid('搜索结果或筛选已变化，请从第一页重新读取，不能拼接旧结果。', 'search_changed');
  return { matches, revision, ...(durationCoverage ? { durationCoverage } : {}), ...(engagementCoverage ? { engagementCoverage } : {}),
    ...(structured ? { queryResult: result, projectRow: structured.row, similarities: structured.similarities } : {}) };
}

// Both hosts use identical group/case paging and projections. The case identity
// always survives select, so an Agent can follow a row with a complete read.
export function caseSearchPage(result, input, limit, summarize) {
  const offset = input.offset ?? 0;
  const { matches, queryResult, projectRow, similarities } = result;
  const grouped = Boolean(queryResult?.groups);
  const items = grouped ? queryResult.groups : matches;
  const page = [];
  const maxPageBytes = agentDownloadChunkBytes();
  const encoder = new TextEncoder();
  let pageBytes = encoder.encode(JSON.stringify(queryResult?.aggregates ?? {})).length;
  if (!input.countOnly) for (const entry of items.slice(offset, offset + limit)) {
    const row = grouped ? entry : input.select ? projectRow(entry) : {
      ...summarize(entry), ...(similarities?.has(entry.id) ? { similarity: similarities.get(entry.id) } : {}) };
    const bytes = encoder.encode(JSON.stringify(row)).length;
    if (pageBytes + bytes > maxPageBytes) {
      if (!page.length) throw invalid('单条查询结果超过消息处理预算；减少select字段，正文/原词/AI词用read_case按同文版本分页读取，原文没有截断或删除。', 'query_page_too_large');
      break;
    }
    page.push(row); pageBytes += bytes;
  }
  return { cases: grouped ? [] : page,
    ...(grouped ? { groups: page, groupTotal: items.length } : {}),
    ...(queryResult?.aggregates ? { aggregates: queryResult.aggregates } : {}),
    ...(queryResult?.similarityCoverage ? { similarityCoverage: queryResult.similarityCoverage } : {}),
    nextOffset: !input.countOnly && offset + page.length < items.length ? offset + page.length : null };
}
