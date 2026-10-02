import test from 'node:test';
import assert from 'node:assert/strict';
import { removeCaseTags, selectedCaseTags } from '../extension/case-tags.js';
import { normalizeCompoundCases } from '../extension/compound-cases.js';
import { appendFacetUndo, undoFacetHistory, normalizeFacetUndoHistory } from '../extension/facet-history.js';

function fixture() {
  const state = { entries: ['a', 'b', 'copy'].map(id => ({ id, text: '完整原词', customLabels: ['动作','保留'],
    mediaAssets: [{id: 'img', kind: 'image', sourceUrl: 'https://example.com/original.png'}],
    facetAssignments: [{nodeId: 'action', visualId: 'img'}, {nodeId: 'action'}, {nodeId: 'keep'}],
    imageAnalyses: [{assetId:'img', text:'原始分析不随移除改变'}] })),
    facetCatalog: { facets: [{id:'style',name:'风格'}], nodes: [{id:'action',name:'动作',facetId:'style'}, {id:'keep',name:'保留',facetId:'style'}] } };
  state.compoundCases = normalizeCompoundCases([{id:'group',memberEntryIds:['a','b'],customLabels:['组合','动作'],createdAt:'2026-10-01T00:00:00.000Z'}],state.entries);
  return state;
}
const options = {customLabels:['动作','组合'],nodeIds:['action']};
test('selected tags distinguish equally named manual and taxonomy tags, including compound members', () => {
  const tags = selectedCaseTags(fixture(),['group']);
  assert(tags.some(t=>t.kind==='custom' && t.id==='动作'));
  assert(tags.some(t=>t.kind==='facet' && t.id==='action' && t.label==='动作 · 风格'));
  assert(tags.some(t=>t.id==='组合'));
  assert.equal(new Set(tags.map(t=>JSON.stringify([t.kind,t.id]))).size,tags.length);
});
test('removal changes only chosen relations, preserving copies, originals, analysis and vocabulary', () => {
  const before = fixture(), snapshot = structuredClone(before);
  const result = removeCaseTags(before,['group'],options,'2026-10-02T00:00:00.000Z');
  assert.equal(result.updatedCount,1);
  assert.deepEqual(before,snapshot);
  for (const e of result.state.entries.slice(0,2)) {
    assert.deepEqual(e.customLabels,['保留']); assert.deepEqual(e.facetAssignments,[{nodeId:'keep'}]);
    for (const key of ['text','mediaAssets','imageAnalyses']) assert.deepEqual(e[key],snapshot.entries[0][key]);
  }
  assert.equal(result.state.entries[2],before.entries[2]);
  assert.equal(result.state.facetCatalog,before.facetCatalog);
  assert.deepEqual(result.state.compoundCases[0].customLabels,[]);
  assert.deepEqual(normalizeCompoundCases(result.state.compoundCases,result.state.entries),result.state.compoundCases);
});
test('undo after persisted normalization restores compound and member tags without dropping later cases', () => {
  const before = fixture(), after = removeCaseTags(before,['group'],options).state;
  const history = appendFacetUndo(null,before,after);
  after.compoundCases = normalizeCompoundCases(after.compoundCases,after.entries);
  const later = {id:'later',text:'后来保存'};
  after.entries.unshift(later);
  const restored = undoFacetHistory(after,history);
  assert.deepEqual(restored.state.entries,[later,...before.entries]);
  assert.deepEqual(restored.state.compoundCases,before.compoundCases);
  assert(restored.compoundsChanged); assert.equal(restored.remainingSteps,0);
});
test('undo refuses subsequent member or compound edits and missing compounds without overwriting them', () => {
  for (const edit of [s=>s.entries[0].text='新编辑',s=>s.compoundCases[0].title='新组合名',s=>s.compoundCases=[]]) {
    const before=fixture(), after=removeCaseTags(before,['group'],options).state;
    const history=appendFacetUndo(null,before,after);edit(after);const snapshot=structuredClone(after);
    assert.throws(()=>undoFacetHistory(after,history),/无法撤回/);assert.deepEqual(after,snapshot);
  }
});
test('stale selection cannot partially write; no matching tags preserve object identity', () => {
  const before=fixture();assert.throws(()=>removeCaseTags(before,['group','missing'],options),/不存在/);
  assert.throws(()=>removeCaseTags(before,['group'],{}),/请选择/);
  const result=removeCaseTags(before,['group'],{customLabels:['未使用']});
  assert.equal(result.updatedCount,0);assert.equal(result.state.entries[0],before.entries[0]);
});
test('v3 undo remains readable while v4 explicitly protects compound deltas', () => {
  const before=fixture(), after=removeCaseTags(before,['a'],options).state;
  const history=appendFacetUndo(null,before,after);delete history.steps[0].compounds;history.version=3;
  assert.equal(normalizeFacetUndoHistory(history).version,4);
  assert.deepEqual(undoFacetHistory(after,history).state.entries,before.entries);
});
