import test from 'node:test';
import assert from 'node:assert/strict';
import { projectWorkspace, compactWorkspaceReference } from '../extension/workspace-context.js';
import { createReferenceSelection } from '../extension/reference-selection.js';
import { caseRevision } from '../extension/case-operations.js';
import { createProjectOperations } from '../extension/project-operations.js';
import { normalizeOrganizerState } from '../extension/organizer.js';

function fixture() {
  const prompts = ['完整原词甲：镜头缓慢推进。'.repeat(160), '完整原词乙：雨滴落在刀锋。'.repeat(150)];
  const state = { entries: prompts.map((text, i) => ({ id: `c${i}`, title: `参考${i}`, text,
    mediaAssets: [{ id: `m${i}`, kind: 'video', mimeType: 'video/mp4', byteSize: 2048, durationMs: 5000, width: 1920, height: 1080, storageMode: 'managed' }],
    mediaPrompts: [{ assetId: `m${i}`, text, source: 'manual' }] })), compoundCases: [],
    organizerState: normalizeOrganizerState({ collections: Array.from({ length: 149 }, (_, i) => ({ id: `p${i}`, name: `项目${i}`, entryIds: [], requirements: '完整项目要求'.repeat(12) })) }) };
  const deps = { loadState: async () => state, enqueue: fn => fn(), storage: { get: async keys => Object.fromEntries([keys].flat().map(key => [key, state[key]])), set: async update => Object.assign(state, update) }, getLibraryId: async () => 'fixture', readDerived: async () => null };
  return { state, prompts, selection: createReferenceSelection(deps), projects: createProjectOperations(deps) };
}

test('two selected prompts appear once each, with exact writeback revisions and original dimensions in the same read', async () => {
  const f = fixture(); await f.selection.update({ expectedRevision: 0, caseIds: ['c0', 'c1'] });
  const start = performance.now(), context = await f.selection.read({});
  const page = await f.selection.read({ part: 'selection', expectedRevision: context.revision, length: 49152 });
  console.log(JSON.stringify({ sample: 'T1', ms: performance.now() - start, characters: page.content.length, calls: 2, repetitions: f.prompts.map(p => page.content.split(p).length - 1) }));
  const bundle = JSON.parse(page.content);
  for (const [i, ref] of bundle.references.entries()) {
    assert.equal(page.content.split(f.prompts[i]).length - 1, 1, 'Repeated full prompt forces redundant model reading');
    assert.equal(ref.originalText, f.prompts[i]);
    assert.deepEqual(ref.caseSources, [{ caseId: `c${i}`, revision: await caseRevision(f.state, f.state.entries[i]) }]);
    assert.equal(ref.media[0].durationMs, 5000); assert.equal(ref.media[0].width, 1920);
    assert.equal(ref.media[0].caseId, `c${i}`);
  }
});

test('looking up one project returns only exact matches and never the unrelated tree', async () => {
  const f = fixture();
  const page = await f.projects.read({ name: '项目148' });
  assert.equal(page.total, 1); assert.equal(JSON.parse(page.content)[0].id, 'p148');
  assert.equal((await f.projects.read({ name: '不存在' })).total, 0);
  f.state.organizerState.collections.push({ id: 'other', name: '项目148', parentId: 'p0', entryIds: [] });
  assert.equal((await f.projects.read({ name: '项目148' })).total, 2, 'Same names must remain ambiguous');
  assert.equal(JSON.parse((await f.projects.read({ path: ['项目0', '项目148'] })).content)[0].id, 'other');
  await assert.rejects(f.projects.read({ name: '项目148', path: ['项目0', '项目148'] }), /名称|路径/);
});

test('selection revision tracks source organization and dimensions; unknown dimensions stay unknown', async () => {
  const f = fixture(); await f.selection.update({ expectedRevision: 0, caseIds: ['c0', 'c1'] });
  let context = await f.selection.read({});
  f.state.organizerState.collections[0].entryIds.push('c0');
  await assert.rejects(f.selection.read({ part: 'selection', expectedRevision: context.revision }), { code: 'selection_changed' });
  context = await f.selection.read({}); f.state.entries[0].mediaAssets[0].width = 1280;
  await assert.rejects(f.selection.read({ part: 'selection', expectedRevision: context.revision }), { code: 'selection_changed' });
  delete f.state.entries[0].mediaAssets[0].durationMs;
  context = await f.selection.read({});
  assert(!('durationMs' in context.references[0].media[0]));
});

test('compound media keeps member ownership and member revisions instead of inventing a writable compound version', async () => {
  const f = fixture();
  f.state.compoundCases = [{ id: 'group', title: '组合', memberEntryIds: ['c0', 'c1'], createdAt: '2026-10-01T00:00:00Z' }];
  await f.selection.update({ expectedRevision: 0, caseIds: ['group'] });
  const context = await f.selection.read({});
  const ref = JSON.parse((await f.selection.read({ part: 'selection', expectedRevision: context.revision })).content).references[0];
  assert.deepEqual(ref.media.map(m => [m.caseId, m.assetId]), [['c0', 'm0'], ['c1', 'm1']]);
  for (const source of ref.caseSources) assert.equal(source.revision, await caseRevision(f.state, f.state.entries.find(e => e.id === source.caseId)));
});


test('compact references reconstruct all composed text and preserve temporary media identities', () => {
  const input = { references: [{ entryId: 'temp', referenceId: 'temp', alias: '@参考1', sourceType: 'temporary',
    originalText: '完整原词', referenceText: '[原词]\n完整原词\n[笔记]\n独立笔记',
    referenceSources: [{ id: 'original', kind: 'original_prompt', text: '完整原词' }, { id: 'notes', kind: 'time_notes', text: '独立笔记' }],
    imageRefs: [{ visualId: 'temp-image', mimeType: 'image/png' }],
    assetRefs: [{ assetId: 'temp-video', kind: 'video', archivePath: 'video/original.mp4' }] }] };
  const normalized = projectWorkspace(input).references[0];
  const compact = compactWorkspaceReference(normalized);
  const expanded = compact.referenceTextParts.map(part => typeof part === 'string' ? part : part.source === 'originalText' ? compact.originalText : compact.referenceSources[part.index].text).join('');
  assert.equal(expanded, normalized.referenceText);
  assert.deepEqual(compact.imageRefs, normalized.imageRefs);
  assert.deepEqual(compact.assetRefs, normalized.assetRefs);
  assert.equal(JSON.stringify(compact).split('完整原词').length - 1, 1);
});
