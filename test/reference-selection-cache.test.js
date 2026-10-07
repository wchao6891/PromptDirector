import test from 'node:test';
import assert from 'node:assert/strict';
import { createReferenceSelection, REFERENCE_SELECTION_KEY } from '../extension/reference-selection.js';
import { CASE_LIBRARY_REVISION_KEY } from '../extension/library-storage.js';

function fixture({ revision = 'library:1', load } = {}) {
  const prompts = ['甲', '乙', '丙'].map(name => `完整原词${name}。`.repeat(40));
  const data = {
    [CASE_LIBRARY_REVISION_KEY]: revision,
    [REFERENCE_SELECTION_KEY]: { version: 1, revision: 1, caseIds: ['a', 'b', 'c'] },
    entries: ['a', 'b', 'c'].map((id, i) => ({ id, title: id, text: prompts[i],
      mediaAssets: [{ id: `${id}-image`, kind: 'image', storageMode: 'managed' }],
      mediaPrompts: [{ assetId: `${id}-image`, text: prompts[i], source: 'manual' }] })), compoundCases: []
  };
  const documents = new Map();
  let loads = 0;
  const api = createReferenceSelection({
    storage: { get: async keys => Object.fromEntries([keys].flat().map(key => [key, structuredClone(data[key])])) },
    loadState: async () => { loads++; return load ? load(data) : structuredClone(data); },
    readDerived: async id => { const value = documents.get(id); if (value instanceof Error) throw value; return value; },
    getLibraryId: async () => 'fixture', enqueue: fn => fn()
  });
  return { api, data, documents, prompts, loads: () => loads };
}

test('three selected originals start in one read and every pinned continuation reuses the projection and hashes', async t => {
  const f = fixture();
  let hashes = 0;
  const digest = crypto.subtle.digest.bind(crypto.subtle);
  t.mock.method(crypto.subtle, 'digest', (...args) => { hashes++; return digest(...args); });
  const first = await f.api.read({ part: 'selection', length: 71 });
  const initialHashes = hashes;
  assert(initialHashes > 0);
  assert.equal(f.loads(), 1);
  let content = first.content, offset = first.nextOffset;
  while (offset !== null) {
    const page = await f.api.read({ part: 'selection', expectedRevision: first.revision, offset, length: 71 });
    content += page.content; offset = page.nextOffset;
  }
  assert.equal(f.loads(), 1, 'continuations must not rebuild the whole selected library');
  assert.equal(hashes, initialHashes, 'unchanged pages must not hash all the original prompts again');
  const bundle = JSON.parse(content);
  assert.deepEqual(bundle.references.map(ref => ref.originalText), f.prompts);
  assert.deepEqual(bundle.references.map(ref => ref.media[0].caseId), ['a', 'b', 'c']);
  assert.deepEqual(bundle.references.map(ref => ref.media[0].assetId), ['a-image', 'b-image', 'c-image']);
  await assert.rejects(f.api.read({ part: 'selection', offset: 1 }), { code: 'invalid_input' });
  await assert.rejects(f.api.read({ part: 'reference' }), { code: 'invalid_input' });
});

test('human selection and case edits invalidate old continuations without mixing the new materials', async () => {
  const f = fixture();
  let first = await f.api.read({ part: 'selection', length: 71 });
  f.data[REFERENCE_SELECTION_KEY] = { version: 1, revision: 2, caseIds: ['b', 'a'] };
  await assert.rejects(f.api.read({ part: 'selection', expectedRevision: first.revision, offset: 71 }), { code: 'selection_changed' });
  first = await f.api.read({ part: 'selection' });
  assert.deepEqual(JSON.parse(first.content).selectedCaseIds, ['b', 'a']);
  f.data.entries[0].mediaPrompts[0].text = '人工修改原词必须立即生效';
  f.data[CASE_LIBRARY_REVISION_KEY] = 'library:2';
  await assert.rejects(f.api.read({ part: 'selection', expectedRevision: first.revision, offset: 71 }), { code: 'selection_changed' });
  const latest = await f.api.read({ part: 'selection' });
  assert.equal(JSON.parse(latest.content).references[1].originalText, '人工修改原词必须立即生效');
});

test('completed or failed document extraction invalidates pinned material even without a case edit', async () => {
  const f = fixture();
  f.data.entries[0].mediaAssets.push({ id: 'document', kind: 'document', storageMode: 'managed' });
  f.documents.set('document', { searchText: '最初提取正文' });
  let first = await f.api.read({ part: 'selection', length: 71 });
  f.documents.set('document', { searchText: '新的完整文档正文' });
  await assert.rejects(f.api.read({ part: 'selection', expectedRevision: first.revision, offset: 71 }), { code: 'selection_changed' });
  first = await f.api.read({ part: 'selection' });
  assert(first.content.includes('新的完整文档正文'));
  f.documents.set('document', Error('unavailable'));
  await assert.rejects(f.api.read({ part: 'selection', expectedRevision: first.revision, offset: 71 }), { code: 'selection_changed' });
  assert.equal((await f.api.read({ part: 'selection' })).completeness, 'partial');
});

test('an unversioned backend never reuses material after an edit', async () => {
  const f = fixture({ revision: null });
  const first = await f.api.read({ part: 'selection', length: 71 });
  f.data.entries[0].title = '没有可靠版本的后端也不能返回旧资料';
  await assert.rejects(f.api.read({ part: 'selection', expectedRevision: first.revision, offset: 71 }), { code: 'selection_changed' });
  assert.equal(f.loads(), 2);
});

test('a selection or library write during asynchronous construction cannot be cached under the old version', async () => {
  for (const changed of ['selection', 'library']) {
    let release, entered;
    const pending = new Promise(resolve => { release = resolve; });
    const started = new Promise(resolve => { entered = resolve; });
    const f = fixture({ load: async data => { const captured = structuredClone(data); entered(); await pending; return captured; } });
    const read = f.api.read({ part: 'selection' });
    await started;
    if (changed === 'selection') f.data[REFERENCE_SELECTION_KEY] = { version: 1, revision: 2, caseIds: ['c'] };
    else { f.data[CASE_LIBRARY_REVISION_KEY] = 'library:2'; f.data.entries[0].text = '刚刚编辑'; }
    release();
    await assert.rejects(read, { code: 'selection_changed' });
    await f.api.read({ part: 'selection' });
    assert.equal(f.loads(), 2, 'a mixed-time construction cannot be reused');
  }
});
