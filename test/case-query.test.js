import test from 'node:test';
import assert from 'node:assert/strict';
import { createAgentLibrary } from '../extension/agent-library.js';
import { createComposerLibraryTools, applyLibraryToolEvent, normalizeLibraryToolState } from '../extension/composer-library-tools.js';
import { createComposerSession } from '../extension/composer.js';
import { buildSearchIndex } from '../extension/search-index.js';
import { createDefaultFacetCatalog, createFacetNode } from '../extension/facets.js';
import { prepareCaseQuery } from '../extension/case-query.js';
import { createSimilarityIndex, rankSimilarEntries } from '../extension/local-similarity.js';

const eq = (field, value) => ({ field, op: 'eq', value });
const exists = (field, value = true) => ({ field, op: 'exists', value });
const scoped = (scope, ...all) => ({ scope, where: { all } });
const ids = result => result.cases.map(row => row.caseId);

test('a task-specific technique filter excludes a same-film different-technique text match in one query without rewriting originals', async () => {
  const credits = '\nDirector - North Studio\nDOP - Robin Grey\nEditor - Morgan Lane\nOriginal Source - Link';
  const image = (id, text) => entry(id, { text, mediaAssets: [{ id: `${id}-image`, kind: 'image' }] });
  const reference = image('reference', 'Film One (2023)\nShot breakdown: Overhead seamless transition tilt up shot\nTechnique - Seamless Transition, Tilt, Transitions' + credits);
  const sibling = image('sibling', 'Film One (2023)\nShot breakdown: whip transition yo-yo\nTechnique - Transitions, Whip Transition' + credits);
  const match = image('match', 'Film Two\nShot breakdown: Aerial tilt up scale shift seamless transition\nTechnique - Seamless Transition');
  const before = structuredClone([reference, sibling, match]);
  const f = fixture([reference, sibling, match]);
  const input = { similarTo: { caseId: 'reference' }, mediaKind: 'image' };
  const broad = await f.external.search(input);
  assert.equal(broad.cases[0].caseId, 'sibling'); // Lexical overlap is not task suitability.
  assert.match(broad.cases[0].similarity.reason, /非画面相似度/);
  const focused = await f.external.search({ ...input, query: 'seamless transition' });
  assert.deepEqual(ids(focused), ['match']);
  assert.equal(focused.cases[0].similarity.score, broad.cases.find(row => row.caseId === 'match').similarity.score);
  assert.deepEqual(f.state.entries, before);
});

test('Agent video prompt search reaches pure videos from a mixed reference without changing exploratory library similarity', async () => {
  const mixed = entry('mixed', { text: 'webpage introduction', mediaAssets: [
    { id: 'v', kind: 'video' }, { id: 'i', kind: 'image' }
  ], mediaPrompts: [
    { assetId: 'v', source: 'webpage', text: 'highway car chase dashcam' },
    { assetId: 'i', source: 'webpage', text: 'flower ocean coral' }
  ] });
  const video = entry('video', { text: 'highway car chase dashcam' });
  const other = entry('other', { text: 'flower ocean coral' });
  const missing = entry('missing', { text: '', sourceFacts: { originalPromptAvailable: false } });
  const f = fixture([mixed, video, other, missing]);
  const input = { similarTo: { caseId: 'mixed' }, mediaKind: 'video', limit: 1 };
  const found = await f.external.search(input);
  assert.deepEqual(ids(found), ['video']);
  assert.equal(found.similarityCoverage.method, 'prompt');
  assert.equal(found.similarityCoverage.sameDomainCases, 3);
  assert.equal(found.similarityCoverage.unknownExcluded, 1);
  assert.equal(found.similarityCoverage.referencePrompt.excerpt, 'highway car chase dashcam');
  assert.deepEqual(found.cases[0].similarity.promptEvidence.sources, ['original']);
  assert.ok(found.cases[0].similarity.score > 0.99);
  const next = await f.external.search({ ...input, offset: found.nextOffset, expectedRevision: found.revision });
  assert.equal(next.cases[0].similarity.score, 0);
  assert.deepEqual((await f.internal.execute('search_cases', input, { callId: 'prompt' })).data.candidates.map(row => row.similarity), found.cases.map(row => row.similarity));
  assert.deepEqual(rankSimilarEntries(createSimilarityIndex([mixed, video, other, missing]), 'mixed'), []);
  assert.equal((await f.external.search({ ...input, similarTo: { caseId: 'mixed', method: 'local' } })).total, 0);
});

test('missing-prompt expansion distinguishes saved AI from originals and does not borrow image or poster prompts for video', async () => {
  const a = entry('a'), ai = entry('ai', { text: '', mediaPrompts: [{ assetId: 'ai-video', source: 'ai-suggestion', text: a.text }] });
  const missing = entry('missing', { text: '', mediaAssets: [{ id: 'v', kind: 'video' }, { id: 'i', kind: 'image' }, { id: 'p', kind: 'image', usage: 'poster' }],
    mediaPrompts: [{ assetId: 'i', source: 'manual', text: a.text }, { assetId: 'p', source: 'manual', text: a.text }] });
  const f = fixture([a, ai, missing]);
  const found = await f.external.search({ similarTo: { caseId: 'a' }, mediaKind: 'video' });
  assert.deepEqual(ids(found), ['ai']);
  assert.deepEqual(found.cases[0].similarity.promptEvidence.sources, ['ai']);
  assert.deepEqual(ids(await f.external.search({ mediaKind: 'video', hasPrompt: false })), ['missing']);
  assert.deepEqual(ids(await f.external.search({ mediaKind: 'video', hasPrompt: true, hasOriginalPrompt: false })), ['ai']);
  const empty = await f.external.search({ similarTo: { caseId: 'missing' }, mediaKind: 'video' });
  assert.equal(empty.total, 0); assert.equal(empty.similarityCoverage.referencePrompt.characters, 0);
  assert.deepEqual(empty.similarityCoverage.referencePrompt.sources, []);
  await f.internal.execute('search_cases', { mediaKind: 'video', hasPrompt: false }, { callId: 'missing' });
  assert.equal(normalizeLibraryToolState(f.session().libraryTools).events.at(-1).search.hasPrompt, false);
  ai.vaultReadStatus = { readOnly: true };
  assert.equal((await f.external.search({ similarTo: { caseId: 'a' }, mediaKind: 'video' })).total, 0);
});

test('prompt candidates preview existing text but ranking and original reads retain the full prompt', async () => {
  const text = 'city skyline '.repeat(100) + 'highway chase';
  const a = entry('a', { text }), b = entry('b', { text });
  const f = fixture([a, b]);
  const found = await f.external.search({ similarTo: { caseId: 'a' }, mediaKind: 'video' });
  const evidence = found.cases[0].similarity.promptEvidence;
  assert.equal(evidence.characters, text.length); assert.equal(evidence.excerptOnly, true);
  assert.ok(found.cases[0].excerpt.length < text.length); assert.ok(found.cases[0].similarity.score > 0.99);
  assert.deepEqual((await f.external.search({ select: ['prompt.original'], query: 'highway' })).cases[0]['prompt.original'], [text]);
});
function entry(id, value = {}) {
  return { id, title: id, text: 'robot city', savedAt: '2026-10-01T00:00:00Z', libraryAddedAt: '2026-10-02T00:00:00Z',
    sourceFacts: { provider: 'x', author: '导演', handle: 'Arvin', originalPromptAvailable: true, capturedAt: '2026-10-01T00:00:00Z', engagement: { bookmarks: 2 }, ...value.sourceFacts },
    mediaAssets: [{ id: `${id}-video`, kind: 'video', usage: 'content', durationMs: 3000, contentHash: 'a'.repeat(64) }], ...value };
}
function fixture(values, extra = {}) {
  const state = { entries: values, organizerState: { collections: [{ id: 'p', name: '作品', entryIds: values.map(e => e.id) }] }, ...extra };
  const documents = extra.documentTextByAsset ?? new Map(), derived = extra.derivedMetadataByAsset ?? new Map();
  const external = createAgentLibrary({ loadState: async () => state, readDerived: async id => ({ searchText: documents.get(id) }), readDerivedMetadata: async () => derived, libraryUrl: 'fixture' });
  let session = createComposerSession({ messages: [{ id: 'u', role: 'user', content: '查找案例' }] });
  const internal = createComposerLibraryTools({ session, vision: false, maxCharacters: 1000000,
    loadLibrary: async () => ({ ...state, documentTextByAsset: documents, derivedMetadataByAsset: derived, searchIndex: buildSearchIndex(state.entries, state.facetCatalog, documents, derived) }),
    onEvent: async event => { session = createComposerSession(applyLibraryToolEvent(session, event)); } });
  return { state, external, internal, session: () => session };
}

test('the director can combine capture month, author, project, originals and content count then sort all matches and request three columns', async () => {
  const many = id => Array.from({ length: 3 }, (_, i) => ({ id: `${id}-${i}`, kind: 'image', usage: 'content' }));
  const a = entry('a', { mediaAssets: many('a') }), b = entry('b', { mediaAssets: many('b') }); b.sourceFacts.engagement.bookmarks = 42;
  const c = entry('c'); c.mediaAssets.push({ id: 'poster', kind: 'image', usage: 'poster' });
  const f = fixture([a, b, c]);
  const input = { provider: 'x', where: { all: [{ field: 'source.capturedAt', op: 'between', value: ['2026-10-01', '2026-10-31'] }, eq('source.handle', '@ARVIN'), eq('project.ancestorIds', 'p'), exists('prompt.original'), { field: 'mediaCount', op: 'gte', value: 3 }] },
    orderBy: [{ field: 'source.engagement.bookmarks', direction: 'desc', reduce: 'max' }], select: ['title', 'source.url', 'mediaCount'], limit: 1 };
  const first = await f.external.search(input);
  assert.equal(first.total, 2); assert.deepEqual(ids(first), ['b']);
  assert.deepEqual(Object.keys(first.cases[0]), ['caseId', 'title', 'source.url', 'mediaCount']);
  const second = await f.external.search({ ...input, offset: first.nextOffset, expectedRevision: first.revision }); assert.deepEqual(ids(second), ['a']);
  const inside = (await f.internal.execute('search_cases', input, { callId: 'test' })).data;
  assert.equal(inside.revision, first.revision); assert.deepEqual(inside.candidates, first.cases);
  const restored = normalizeLibraryToolState(f.session().libraryTools);
  assert.deepEqual(restored.events[0].search.where, input.where); assert.deepEqual(restored.events[0].search.orderBy, input.orderBy);
});

test('field help discovers actual metrics; unknown paths, wrong operators, values and ignored properties fail even on an empty result', async () => {
  const f = fixture([entry('a')]); const help = await f.external.describeQuery();
  assert.ok(help.fields.some(field => field.name === 'source.engagement.bookmarks'));
  assert.deepEqual(help.engagementMetrics, ['bookmarks']);
  assert.deepEqual((await f.internal.execute('describe_case_query', {}, { callId: 'help' })).data, help);
  for (const where of [eq('credentials.key', 'secret'), { field: 'mediaCount', op: 'contains', value: '3' }, { field: 'mediaCount', op: 'gte', value: '3' }, { all: [eq('title', 'a')], extra: true }, { all: [eq('title', 'a')], field: 'title' }, { field: 'source.capturedAt', op: 'between', value: ['bad', '2026-10-02'] }]) {
    await assert.rejects(f.external.search({ query: 'no matches ever', where }), error => ['invalid_case_query', 'invalid_input'].includes(error.code));
  }
});

test('member/media relations prevent borrowing another author, duration or prompt inside a compound', async () => {
  const a = entry('a', { text: '', sourceFacts: { provider: 'x', handle: 'Arvin', originalPromptAvailable: false } });
  const b = entry('b', { sourceFacts: { provider: 'x', handle: 'Other', originalPromptAvailable: true } });
  const f = fixture([a, b], { compoundCases: [{ id: 'group', title: '组合', memberEntryIds: ['a', 'b'], createdAt: '2026-10-01', updatedAt: '2026-10-01' }] });
  assert.equal((await f.external.search({ where: scoped('member', eq('source.handle', 'Arvin'), exists('prompt.original')) })).total, 0);
  assert.equal((await f.external.search({ where: scoped('member', eq('source.handle', 'Other'), scoped('media', eq('media.kind', 'video'), exists('prompt.original'))) })).total, 1);
  a.mediaAssets.push({ id: 'a-image', kind: 'image', usage: 'content' });
  a.mediaPrompts = [{ assetId: 'a-image', source: 'manual', text: 'flower prompt' }];
  assert.equal((await f.external.search({ where: scoped('media', eq('media.kind', 'video'), { field: 'prompt.original', op: 'contains', value: 'flower' }) })).total, 0);
  assert.equal((await f.external.search({ where: scoped('media', eq('media.kind', 'image'), { field: 'prompt.original', op: 'contains', value: 'flower' }) })).total, 1);
});

test('title-only search does not count body mentions, Boolean combinations and missing conditions remain distinct', async () => {
  const a = entry('a', { title: '城市' }), b = entry('b', { title: '海洋', text: '城市 Arvin' });
  b.sourceFacts = { provider: 'x', handle: 'Other' };
  const f = fixture([a, b]);
  const result = await f.external.search({ where: { all: [{ any: [eq('title', '城市'), eq('title', '海洋')] }, { not: { field: 'title', op: 'contains', value: '海洋' } }] } });
  assert.deepEqual(ids(result), ['a']);
  assert.deepEqual(ids(await f.external.search({ where: exists('source.engagement.bookmarks', false) })), ['b']);
  assert.deepEqual(ids(await f.external.search({ where: { field: 'source.engagement.bookmarks', op: 'ne', value: 0 } })), ['a']);
  assert.deepEqual(ids(await f.external.search({ where: { field: 'source.handle', op: 'in', value: ['@ARVIN'] } })), ['a']);
});

test('unknown, zero, multiple posts and multi-field ordering have explicit numerical semantics', async () => {
  const a = entry('a'), b = entry('b'), c = entry('c'); a.sourceFacts.engagement.bookmarks = 0; b.sourceFacts.engagement = {};
  const f = fixture([a, b, c]);
  const input = { provider: 'x', orderBy: [{ field: 'source.engagement.bookmarks', direction: 'asc', reduce: 'max' }, { field: 'title', direction: 'desc' }], aggregates: [{ name: 'count', op: 'count' }, { name: 'bookmarks', op: 'sum', field: 'source.engagement.bookmarks', reduce: 'max' }] };
  const result = await f.external.search(input); assert.deepEqual(ids(result), ['a', 'c', 'b']);
  assert.deepEqual(result.aggregates.bookmarks, { value: 2, known: 2, missing: 1 });
  await assert.rejects(f.external.search({ orderBy: input.orderBy }), /provider/);
  await assert.rejects(f.external.search({ provider: 'x', orderBy: [{ field: 'source.engagement.bookmarks', direction: 'desc' }] }), /reduce/);
});

test('group statistics use all matches before paging, multi-project ownership counts once per group and revisions protect changes', async () => {
  const a = entry('a'), b = entry('b'), c = entry('c'); b.sourceFacts.engagement.bookmarks = 10; c.sourceFacts.engagement = {};
  const f = fixture([a, b, c], { organizerState: { collections: [{ id: 'p', name: '作品', entryIds: ['a', 'b'] }, { id: 'q', parentId: 'p', name: '子项目', entryIds: ['a', 'c'] }] } });
  const input = { provider: 'x', groupBy: ['project.name'], aggregates: [{ name: 'total', op: 'count' }, { name: 'average', op: 'avg', field: 'source.engagement.bookmarks', reduce: 'max' }], limit: 1 };
  const first = await f.external.search(input); assert.equal(first.total, 3); assert.equal(first.groupTotal, 2); assert.equal(first.aggregates.average.value, 6); assert.deepEqual(first.cases, []);
  assert.equal(first.groups[0].count, 2);
  const second = await f.external.search({ ...input, offset: 1, expectedRevision: first.revision }); assert.equal(second.groups[0].count, 2);
  const inside = (await f.internal.execute('search_cases', input, { callId: 'group' })).data; assert.deepEqual(inside.groups, first.groups); assert.equal(inside.revision, first.revision);
  b.sourceFacts.engagement.bookmarks = 20;
  await assert.rejects(f.external.search({ ...input, offset: 1, expectedRevision: first.revision }), { code: 'search_changed' });
  const subtree = await f.external.search({ where: eq('project.ancestorIds', 'p'), countOnly: true }); assert.equal(subtree.total, 3);
});

test('AI assignments, manual labels and legacy unknown origins do not become body-word tags or cross-assignment matches', async () => {
  let catalog = createDefaultFacetCatalog();
  catalog = createFacetNode(catalog, { facetId: 'style', name: '霓虹', id: 'query-neon' });
  const node = catalog.nodes.find(node => node.id === 'query-neon');
  const a = entry('a', { text: '霓虹只是正文', facetAssignments: [{ nodeId: node.id, source: 'vision_model', status: 'confirmed', visualId: 'a-video' }] });
  const b = entry('b', { text: '霓虹 AI 手工', customLabels: ['精选'] });
  const c = entry('c', { facetAssignments: [{ nodeId: node.id, status: 'confirmed' }] });
  const f = fixture([a, b, c], { facetCatalog: catalog });
  const where = { all: [scoped('label', eq('label.nodeId', node.id), eq('label.origin', 'ai'), eq('label.status', 'confirmed')), { not: exists('manualLabels') }] };
  assert.deepEqual(ids(await f.external.search({ where })), ['a']);
  assert.deepEqual(ids(await f.external.search({ where: scoped('label', eq('label.nodeId', node.id), exists('label.origin', false)) })), ['c']);
  a.facetAssignments.push({ nodeId: catalog.nodes.find(n => n.id !== node.id).id, source: 'manual', status: 'confirmed' });
  assert.equal((await f.external.search({ where: scoped('label', eq('label.nodeId', node.id), eq('label.origin', 'manual')) })).total, 0);
});

test('full documents, original and AI prompt selections are not previews and field revisions include derived text edits', async () => {
  const a = entry('a', { text: '全文'.repeat(15000), mediaAssets: [{ id: 'doc', kind: 'document' }, { id: 'image', kind: 'image', usage: 'content' }],
    mediaPrompts: [{ assetId: 'image', text: 'AI完整词'.repeat(1000), source: 'ai-suggestion' }] });
  const documents = new Map([['doc', '文档正文'.repeat(12000)]]);
  const f = fixture([a], { documentTextByAsset: documents });
  const input = { select: ['body', 'documentText', 'prompt.original', 'prompt.ai'] };
  const result = await f.external.search(input); assert.equal(result.cases[0].body[0], a.text); assert.equal(result.cases[0].documentText[0], documents.get('doc')); assert.equal(result.cases[0]['prompt.ai'][0], a.mediaPrompts[0].text);
  assert.equal((await f.external.search({ where: scoped('media', eq('media.id', 'image'), { field: 'prompt.original', op: 'contains', value: 'AI完整词' }) })).total, 0);
  documents.set('doc', '新正文'); await assert.rejects(f.external.search({ ...input, expectedRevision: result.revision }), { code: 'search_changed' });
});

test('case type, classification, counts, covers, palettes and original hash identity stay separate', async () => {
  const a = entry('a', { classification: { pathIds: ['video-case'], status: 'confirmed', source: 'manual' }, coverVisualId: 'poster' });
  a.mediaAssets.push({ id: 'poster', kind: 'image', usage: 'poster', palette: { colors: ['#ff0000'] } });
  const f = fixture([a]); const result = await f.external.search({ select: ['mediaCount', 'posterCount', 'uniqueMediaCount', 'uniqueOriginalCount', 'contentRole', 'classification.pathIds', 'coverVisualId'] });
  assert.equal(result.cases[0].mediaCount, 1); assert.equal(result.cases[0].posterCount, 1); assert.equal(result.cases[0].uniqueOriginalCount, 1);
  assert.equal((await f.external.search({ where: scoped('media', eq('media.kind', 'image'), eq('media.isPoster', false)) })).total, 0);
  assert.equal((await f.external.search({ where: scoped('media', eq('media.isCover', true), eq('palette.colors', 'ff0000')) })).total, 1);
  a.mediaAssets[0].contentHash = undefined;
  assert.equal((await f.external.search({ select: ['uniqueOriginalCount'] })).cases[0].uniqueOriginalCount, null);
  await assert.rejects(f.external.search({ where: eq('palette.colors', 'red') }), /无效/);
});

test('similarity is reference-specific, known zero stays zero and unknown evidence has coverage; reference edits invalidate paging', async () => {
  const image = (id, text, color) => entry(id, { text, primaryMediaId: id, mediaAssets: [{ id, kind: 'image', usage: 'content', ...(color ? { palette: { colors: [color] } } : {}) }] });
  const a = image('a', 'robot city', '#223344'), b = image('b', 'ocean coral', '#233445'), c = image('c', 'robot city', undefined), d = entry('d');
  const f = fixture([a, b, c, d]);
  const input = { similarTo: { caseId: 'a', method: 'prompt' }, select: ['title', 'similarity.score', 'similarity.palette'], limit: 1 };
  const result = await f.external.search(input); assert.deepEqual(ids(result), ['c']); assert.equal(result.cases[0]['similarity.palette'], null); assert.equal(result.similarityCoverage.differentDomainCases, 1);
  const next = await f.external.search({ ...input, offset: 1, expectedRevision: result.revision }); assert.equal(next.cases[0]['similarity.score'], 0);
  const local = await f.external.search({ similarTo: { caseId: 'a', method: 'local' } }); assert.ok(local.cases.every(row => row.similarity.reason));
  a.text = 'ocean coral'; await assert.rejects(f.external.search({ ...input, offset: 1, expectedRevision: result.revision }), { code: 'search_changed' });
  await assert.rejects(f.external.search({ select: ['similarity.score'] }), /similarTo/);
});

test('grouping author/platform and label identity/origin never manufactures relation pairs, and group metrics stay on that source', async () => {
  const a = entry('a'), b = entry('b'); a.sourceFacts.handle = 'Arvin'; b.sourceFacts.handle = 'Other'; b.sourceFacts.provider = 'reddit'; b.sourceFacts.engagement.bookmarks = 100;
  const f = fixture([a, b], { compoundCases: [{ id: 'group', title: '组合', memberEntryIds: ['a', 'b'], createdAt: '2026-10-01' }] });
  const result = await f.external.search({ groupBy: ['source.handle', 'source.provider'] });
  assert.equal(result.groups.length, 2);
  assert.deepEqual(result.groups.map(g => g.key), [{ 'source.handle': 'Arvin', 'source.provider': 'x' }, { 'source.handle': 'Other', 'source.provider': 'reddit' }]);
  b.sourceFacts.provider = 'x';
  const counted = await f.external.search({ provider: 'x', groupBy: ['source.handle'], aggregates: [{ name: 'bookmarks', op: 'sum', field: 'source.engagement.bookmarks', reduce: 'max' }] });
  assert.deepEqual(counted.groups.map(g => g.aggregates.bookmarks.value), [2, 100]);
  assert.equal((await f.external.search({ provider: 'x', authorHandle: 'Arvin', where: exists('source.engagement.bookmarks'), select: ['source.engagement.bookmarks', 'mediaCount'] })).cases[0]['source.engagement.bookmarks'][0], 2);
});

test('automatic video posters supply cover identity and stored palette evidence without becoming content images', async () => {
  const video = id => entry(id, { primaryMediaId: `${id}-video`, mediaAssets: [{ id: `${id}-video`, kind: 'video', posterAssetId: `${id}-poster` }, { id: `${id}-poster`, kind: 'image', usage: 'poster', derivedFromAssetId: `${id}-video` }] });
  const f = fixture([video('a'), video('b')], { derivedMetadataByAsset: new Map([['a-poster', { palette: { colors: ['#223344'] } }], ['b-poster', { palette: { colors: ['#233445'] } }]]) });
  assert.equal((await f.external.search({ select: ['coverVisualId'] })).cases[0].coverVisualId, 'a-poster');
  const result = await f.external.search({ similarTo: { caseId: 'a', method: 'palette' } });
  assert.deepEqual(ids(result), ['b']); assert.ok(result.cases[0].similarity.palette > 0);
  assert.equal(result.similarityCoverage.knownPalettePairs, 1);
});

test('selected complete text obeys the message working budget with continued pages and an explicit oversized-single-row failure', async () => {
  const text = 'x'.repeat(9 * 1024 * 1024);
  const f = fixture([entry('a', { text }), entry('b', { text })]);
  const query = { select: ['body'], limit: 2 };
  const first = await f.external.search(query); assert.equal(first.cases.length, 1); assert.equal(first.cases[0].body[0], text); assert.equal(first.nextOffset, 1);
  const next = await f.external.search({ ...query, offset: 1, expectedRevision: first.revision }); assert.equal(next.cases[0].body[0], text); assert.equal(next.nextOffset, null);
  f.state.entries[0].text = text.repeat(2);
  await assert.rejects(f.external.search(query), { code: 'query_page_too_large' });
  assert.equal(f.state.entries[0].text.length, text.length * 2, 'Message budget never changes the saved original');
});

test('group sorting orders complete statistics before paging and never silently ignores incompatible case options', async () => {
  const a = entry('a'), b = entry('b'), c = entry('c'); b.sourceFacts.handle = 'Other'; b.sourceFacts.engagement.bookmarks = 99; c.sourceFacts.handle = 'Other';
  const f = fixture([a, b, c]);
  const query = { provider: 'x', groupBy: ['source.handle'], aggregates: [{ name: 'bookmarks', op: 'sum', field: 'source.engagement.bookmarks', reduce: 'max' }], orderBy: [{ field: 'aggregate.bookmarks', direction: 'desc' }], limit: 1 };
  const result = await f.external.search(query); assert.equal(result.groups[0].key['source.handle'], 'Other'); assert.equal(result.groups[0].aggregates.bookmarks.value, 101);
  assert.equal((await f.external.search({ ...query, offset: 1, expectedRevision: result.revision })).groups[0].key['source.handle'], 'Arvin');
  await assert.rejects(f.external.search({ ...query, select: ['title'] }), /select/);
  await assert.rejects(f.external.search({ ...query, orderBy: [{ field: 'title', direction: 'asc' }] }), /分组排序/);
  await assert.rejects(f.external.search({ ...query, sort: 'newest' }), /sort/);
});

test('processing budgets stop oversized multi-membership statistics explicitly without capping or changing library data', () => {
  const a = entry('a', { customLabels: ['first label', 'second label'] });
  const query = prepareCaseQuery([a], { groupBy: ['manualLabels'] }, { budget: { maxTextBytes: 20 } });
  assert.throws(() => query.execute([a]), { code: 'RESOURCE_BUDGET_REACHED' });
  assert.deepEqual(a.customLabels, ['first label', 'second label']);
});

test('date conditions reject impossible days and timezone guessing; explicit offsets compare the same instant', async () => {
  const a = entry('a'); a.sourceFacts.capturedAt = '2026-10-01T00:00:00Z'; const f = fixture([a]);
  assert.equal((await f.external.search({ where: eq('source.capturedAt', '2026-10-01T08:00:00+08:00') })).total, 1);
  for (const value of ['2026-02-30', '2026-10-01T00:00:00', '10/01/2026']) await assert.rejects(f.external.search({ where: eq('source.capturedAt', value) }), /ISO/);
});

test('authored annotations are searchable and discover their edit/save rules without turning computed evidence into writable fields', async () => {
  const entries=[{id:'own',title:'方案',text:'原资料',creative:{purpose:'广告表演参考',notes:'第二镜表演'}}];
  const library=createAgentLibrary({loadState:async()=>({entries}),readDerivedMetadata:async()=>new Map()});
  const help=await library.describeQuery();
  const access=help.fields.find(field=>field.name==='creative.purpose').access;
  assert.equal(access.edit.patch,'creative.purpose');assert.equal(access.save.operation,'save_material');
  assert.equal(help.fields.find(field=>field.name==='mediaCount').access.edit,null);
  assert.equal(help.fields.find(field=>field.name==='prompt.original').access.edit.protection,'source_or_creation');
  assert.equal((await library.search({query:'广告表演参考'})).total,1);
  const found=await library.search({where:{field:'creative.notes',op:'contains',value:'第二镜'},select:['creative.purpose'],query:''});
  assert.equal(found.total,1);
});

test('an unsaved text reference ranks existing prompt evidence without adding a virtual case to results or changing originals', async()=>{
  const values=[entry('match',{text:'aerial tilt up seamless transition'}),entry('other',{text:'garden flower painting'}),entry('missing',{text:'',sourceFacts:{originalPromptAvailable:false}})];
  const before=structuredClone(values),f=fixture(values);
  const result=await f.external.search({similarText:'aerial tilt up seamless transition',mediaKind:'video',limit:1});
  assert.deepEqual(ids(result),['match']);assert.ok(result.cases[0].similarity.score>0.99);
  assert.equal(result.similarityCoverage.referenceType,'provided_text');
  assert.equal(result.similarityCoverage.comparedCases,2);assert.equal(result.similarityCoverage.unknownExcluded,1);
  assert.equal(result.similarityCoverage.referenceCaseId,undefined);assert.match(result.cases[0].similarity.reason,/非画面相似度/);
  const next=await f.external.search({similarText:'aerial tilt up seamless transition',mediaKind:'video',limit:1,offset:result.nextOffset,expectedRevision:result.revision});
  assert.deepEqual(ids(next),['other']);assert.equal(next.cases[0].similarity.score,0);
  assert.deepEqual(f.state.entries,before);
});

test('unsaved prompt similarity reuses exact media filtering, structured conditions, and internal workspace search',async()=>{
  const mixed=entry('mixed',{text:'intro',mediaAssets:[{id:'v',kind:'video'},{id:'i',kind:'image'}],mediaPrompts:[
    {assetId:'v',source:'webpage',text:'car chase'},{assetId:'i',source:'webpage',text:'rose flower'}]});
  const video=entry('video',{text:'car chase'}),image=entry('image',{text:'rose flower',mediaAssets:[{id:'pic',kind:'image'}]});
  const f=fixture([mixed,video,image]);const query={similarText:'car chase',mediaKind:'video',where:{field:'similarity.score',op:'gt',value:0}};
  const external=await f.external.search(query);assert.deepEqual(new Set(ids(external)),new Set(['mixed','video']));
  const internal=await f.internal.execute('search_cases',query,{callId:'unsaved'});
  assert.deepEqual(new Set(internal.data.candidates.map(row=>row.caseId)),new Set(['mixed','video']));
  assert.equal(normalizeLibraryToolState(f.session().libraryTools).events.at(-1).search.similarText,'car chase');
  await assert.rejects(f.external.search({...query,similarTo:{caseId:'video'}}),/不能同时|互斥/);
  await assert.rejects(f.external.search({similarText:'   '}),/文字|为空/);
});

test('unsaved reference uses the full text, compares available original and AI evidence across media, and invalidates changed-input paging',async()=>{
  const text='common words '.repeat(100)+' orbital palace';
  const values=[entry('plain',{text,mediaAssets:[]}),entry('image',{text,mediaAssets:[{id:'image',kind:'image'}]}),
    entry('ai',{text:'',sourceFacts:{originalPromptAvailable:false},mediaPrompts:[{assetId:'ai-video',source:'ai-suggestion',text}]}),entry('other',{text:'common words'})];
  const f=fixture(values);const query={similarText:text,limit:1};const found=await f.external.search(query);
  assert.equal(found.similarityCoverage.referencePrompt.characters,text.length);
  assert.equal(found.total,4);assert.ok(found.cases[0].similarity.score>0.99);
  const all=await f.external.search({similarText:text});
  assert.equal(all.cases.some(item=>item.caseId==='plain'),true);
  assert.deepEqual(all.cases.find(item=>item.caseId==='ai').similarity.promptEvidence.sources,['ai']);
  await assert.rejects(f.external.search({...query,similarText:text+' new source',offset:1,expectedRevision:found.revision}),e=>e.code==='search_changed');
});
