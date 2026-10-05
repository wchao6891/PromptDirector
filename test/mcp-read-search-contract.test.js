import test from 'node:test';
import assert from 'node:assert/strict';
import { createAgentLibrary } from '../extension/agent-library.js';
import { createComposerLibraryTools, applyLibraryToolEvent } from '../extension/composer-library-tools.js';
import { createComposerSession } from '../extension/composer.js';
import { buildSearchIndex } from '../extension/search-index.js';
import { searchCaseResult } from '../extension/case-search.js';

function fixture(entries) {
  const state = { entries, organizerState: { collections: [{ id: 'p', name: '项目', entryIds: entries.map(e => e.id) }] } };
  let documentText = '旧文档全文';
  const external = createAgentLibrary({ loadState: async () => state, readDerived: async () => ({ searchText: documentText }), readDerivedMetadata: async () => new Map(), libraryUrl: 'chrome-extension://fixture/library.html' });
  let session = createComposerSession({ messages: [{ id: 'u', role: 'user', content: '查找案例' }] });
  const internal = createComposerLibraryTools({ session, vision: false,
    loadLibrary: async () => ({ ...state, searchIndex: buildSearchIndex(state.entries), documentTextByEntryId: new Map(entries.map(e => [e.id, documentText])) }),
    onEvent: async event => { session = createComposerSession(applyLibraryToolEvent(session, event)); } });
  return { state, external, internal, session: () => session, setDocument: text => { documentText = text; } };
}
const entry = (id, handle, engagement) => ({ id, title: id, text: '谢谢 @Arvin 原词', mediaAssets: [], sourceFacts: { provider: 'x', handle, engagement, engagementObservedAt: '2026-10-03T00:00:00Z', originalPromptAvailable: true } });

test('author and metric queries return actual saved sources, keep unknown separate from zero, and agree inside and outside the composer', async () => {
  const f = fixture([entry('missing', 'Arvin', undefined), entry('zero', '@ARVIN', { likes: 0 }), entry('popular', 'Arvin', { likes: 162 }), entry('mention', 'Other', { likes: 999 })]);
  const filters = { query: '', provider: 'X', authorHandle: '@arvin', sort: 'engagement', engagementMetric: 'likes' };
  const result = await f.external.search(filters);
  const local = (await f.internal.execute('search_cases', filters, { callId: 'source' })).data;
  assert.deepEqual(result.cases.map(e => e.caseId), ['popular', 'zero', 'missing']);
  assert.deepEqual(local.candidates.map(e => e.caseId), result.cases.map(e => e.caseId));
  assert.equal(local.revision, result.revision);
  assert.equal(result.engagementCoverage.knownCases, 2);
  assert.equal(result.engagementCoverage.unknownCases, 1);
  assert.deepEqual(local.engagementCoverage, result.engagementCoverage);
  const restored = createComposerSession(f.session());
  assert.equal(restored.libraryTools.events[0].search.authorHandle, filters.authorHandle);
  assert.equal(result.cases[0].sources[0].engagement.likes, 162);
  assert.equal(result.cases[0].sources[0].engagementObservedAt, '2026-10-03T00:00:00Z');
  assert(!Object.hasOwn(result, 'projects'));
  const next = await f.external.search({ ...filters, limit: 1 });
  f.state.entries[1].sourceFacts.engagement.likes = 200;
  await assert.rejects(f.external.search({ ...filters, offset: next.nextOffset, expectedRevision: next.revision, limit: 1 }), { code: 'search_changed' });
  await assert.rejects(f.external.search({ sort: 'engagement', engagementMetric: 'likes' }), { code: 'invalid_input' });
});

test('multi-source compounds never invent a summed popularity and author filtering does not borrow another member original prompt', async () => {
  const a = { ...entry('a', 'Arvin', { likes: 100 }), text: '', sourceFacts: { provider: 'x', handle: 'Arvin', engagement: { likes: 100 }, originalPromptAvailable: false } };
  const b = entry('b', 'Other', { likes: 200 });
  const compound = { id: 'c', title: '组合', memberEntries: [a, b], memberEntryIds: ['a', 'b'], mediaAssets: [] };
  const state = { collections: [] }, entries = [compound];
  const result = await searchCaseResult(entries, buildSearchIndex(entries), state, { provider: 'x', sort: 'engagement', engagementMetric: 'likes' });
  assert.equal(result.engagementCoverage.unknownCases, 1);
  const filtered = await searchCaseResult(entries, buildSearchIndex(entries), state, { provider: 'x', authorHandle: 'Arvin', hasOriginalPrompt: true });
  assert.equal(filtered.matches.length, 0, 'a different author member must not satisfy this author prompt requirement');
});

test('duration coverage for an author counts that author sources without borrowing another member duration', async () => {
  const a = { ...entry('a', 'Arvin'), mediaAssets: [{ id: 'a-video', kind: 'video' }] };
  const b = { ...entry('b', 'Other'), mediaAssets: [{ id: 'b-video', kind: 'video', durationMs: 5000 }] };
  const compound = { id: 'c', title: '组合', memberEntries: [a, b], memberEntryIds: ['a', 'b'], mediaAssets: [] };
  const entries = [compound];
  const result = await searchCaseResult(entries, buildSearchIndex(entries), {}, { query: '', authorHandle: 'Arvin', minDurationMs: 1000 });
  assert.equal(result.matches.length, 0);
  assert.equal(result.durationCoverage.totalMedia, 1);
  assert.equal(result.durationCoverage.unknownDurationMedia, 1);
});

test('complete text stays readable with compact replies; source edits cannot splice old and new body or original prompt pages', async () => {
  const original = '完整提示词：镜头、动作、负面约束。\n'.repeat(1200);
  const f = fixture([{ ...entry('long', 'Arvin'), text: original }]);
  let offset = 0, revision, read = '';
  do {
    const page = await f.external.read({ caseId: 'long', offset, length: 12000, expectedRevision: revision });
    revision = page.revision; read += page.content; offset = page.nextOffset;
    assert(!Object.hasOwn(page, 'media'));
    assert(!Object.hasOwn(page, 'sourcePages'));
    assert(page.untrustedContent);
  } while (offset !== null);
  assert.equal(read, original);
  await assert.rejects(f.external.read({ caseId: 'long', offset: 4, length: 4 }), { code: 'case_revision_required' });
  const first = await f.external.read({ caseId: 'long', length: 4 });
  f.state.entries[0].text = '人工更新的完整正文';
  await assert.rejects(f.external.read({ caseId: 'long', offset: first.nextOffset, length: 4, expectedRevision: first.revision }), { code: 'case_text_changed' });
  const current = await f.external.read({ caseId: 'long', part: 'original_prompt', length: 4 });
  await assert.rejects(f.external.read({ caseId: 'long', part: 'body', expectedRevision: current.revision }), { code: 'case_text_changed' });
});

test('text version protection covers derived documents and the internal composer without discarding valid first pages', async () => {
  const f = fixture([{ ...entry('doc', 'Arvin'), mediaAssets: [{ id: 'd', kind: 'document' }] }]);
  const document = await f.external.read({ caseId: 'doc', part: 'document', length: 2 });
  f.setDocument('人工更新的文档派生全文');
  await assert.rejects(f.external.read({ caseId: 'doc', part: 'document', offset: document.nextOffset, expectedRevision: document.revision }), { code: 'case_text_changed' });
  await f.internal.execute('search_cases', { query: '' }, { callId: 'find' });
  const args = { caseId: 'doc', part: 'body', offset: 0, length: 2 };
  const first = (await f.internal.execute('read_case_text', args, { callId: 'first' })).data;
  const external = await f.external.read({ ...args });
  assert.equal(first.revision, external.revision);
  f.state.entries[0].text = '用户刚修改的正文';
  const stale = (await f.internal.execute('read_case_text', { ...args, offset: first.nextOffset, expectedRevision: first.revision }, { callId: 'stale' })).data;
  assert.match(stale.error, /变化/);
});
