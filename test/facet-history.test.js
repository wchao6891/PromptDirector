import test from "node:test";
import assert from "node:assert/strict";

import { FACET_UNDO_HISTORY_VERSION, FACET_UNDO_LIMIT, appendFacetUndo, facetUndoCount, normalizeFacetUndoHistory, undoFacetHistory } from "../extension/facet-history.js";
import { applyFacetChange, createDefaultFacetCatalog, createEmptyFacetCatalog, createFacet, previewFacetChange } from "../extension/facets.js";
import { createFacetNode } from '../extension/facets.js';
import { applyVisionAnalysis } from '../extension/analysis-candidates.js';
import { moveMediaToTrash, restoreTrashItems } from '../extension/trash.js';

test("consecutive dimension archives can be undone one step at a time", () => {
  let catalog = createFacet(createEmptyFacetCatalog(), { id: "facet:mood", name: "情绪" });
  catalog = createFacet(catalog, { id: "facet:light", name: "灯光" });
  catalog = createFacet(catalog, { id: "facet:shot", name: "镜头" });
  const initial = { facetCatalog: catalog, entries: [] };

  const first = applyFacetChange(initial, previewFacetChange(initial, {
    type: "archive_facet", facetId: "facet:mood"
  })).state;
  const firstHistory = appendFacetUndo(null, initial, first);
  const second = applyFacetChange(first, previewFacetChange(first, {
    type: "archive_facet", facetId: "facet:light"
  })).state;
  const secondHistory = appendFacetUndo(firstHistory, first, second);

  const undoneSecond = undoFacetHistory(second, secondHistory);
  assert.deepEqual(undoneSecond.state.facetCatalog.facets.map((facet) => facet.status), ["archived", "active", "active"]);
  assert.equal(undoneSecond.remainingSteps, 1);

  const undoneFirst = undoFacetHistory(undoneSecond.state, undoneSecond.history);
  assert.deepEqual(undoneFirst.state.facetCatalog.facets.map((facet) => facet.status), ["active", "active", "active"]);
  assert.equal(undoneFirst.remainingSteps, 0);
});

test("old undo snapshots are hidden because their case versions cannot be checked", () => {
  const catalog = createFacet(createEmptyFacetCatalog(), { id: "facet:mood", name: "情绪" });
  const legacySnapshot = { facetCatalog: catalog, entries: [{ id: "one", facetAssignments: [] }] };
  const current = structuredClone(legacySnapshot);
  current.facetCatalog.facets[0].name = "新名称";

  assert.equal(facetUndoCount(legacySnapshot), 0);
  assert.throws(() => undoFacetHistory(current, legacySnapshot), /没有可撤回/);
});

test("facet undo preserves case membership and order while reverting an affected case", () => {
  const catalog = createFacet(createEmptyFacetCatalog(), { id: "facet:mood", name: "情绪" });
  const first = { id: "one", title: "第一条", facetAssignments: [] };
  const second = { id: "two", title: "第二条", facetAssignments: [] };
  const before = { facetCatalog: catalog, entries: [first, second] };
  const after = {
    facetCatalog: catalog,
    entries: [first, { ...second, title: "已修改" }]
  };
  const history = appendFacetUndo(null, before, after);
  const newCase = { id: "three", title: "新增条目", facetAssignments: [] };

  const undone = undoFacetHistory({ ...after, entries: [after.entries[1], newCase] }, history);
  assert.deepEqual(undone.state.entries, [second, newCase]);
  assert.equal(undone.entriesChanged, true);
});

test("a tag undo step cannot empty a library populated afterward", () => {
  const catalog = createFacet(createEmptyFacetCatalog(), { id: "facet:mood", name: "情绪" });
  const before = { facetCatalog: catalog, entries: [] };
  const after = { facetCatalog: { ...catalog, revision: catalog.revision + 1 }, entries: [] };
  const history = appendFacetUndo(null, before, after);
  const added = { id: "new-case", title: "后来保存的案例", facetAssignments: [] };

  const undone = undoFacetHistory({ ...after, entries: [added] }, history);
  assert.deepEqual(undone.state.entries, [added]);
  assert.equal(undone.entriesChanged, false);
  assert.equal(undone.state.facetCatalog.revision, catalog.revision);
});

test("facet undo refuses to overwrite a case edited after the tag operation", () => {
  const catalog = createFacet(createEmptyFacetCatalog(), { id: "facet:mood", name: "情绪" });
  const before = { facetCatalog: catalog, entries: [{ id: "one", title: "原文", facetAssignments: [] }] };
  const after = { facetCatalog: catalog, entries: [{ ...before.entries[0], facetAssignments: [{ nodeId: "tag:a" }] }] };
  const history = appendFacetUndo(null, before, after);

  assert.throws(() => undoFacetHistory({ ...after, entries: [{ ...after.entries[0], title: "新编辑" }] }, history), /保护新内容/);
  assert.deepEqual(undoFacetHistory(after, history).state.entries, before.entries);
});

test("facet undo refuses to overwrite a vocabulary edited after the recorded step", () => {
  const catalog = createDefaultFacetCatalog();
  const before = { facetCatalog: catalog, entries: [] };
  const after = { facetCatalog: { ...catalog, revision: catalog.revision + 1 }, entries: [] };
  const history = appendFacetUndo(null, before, after, { entriesChanged: false });

  assert.throws(() => undoFacetHistory({ ...after, facetCatalog: { ...after.facetCatalog, revision: after.facetCatalog.revision + 1 } }, history), /保护新内容/);
  assert.deepEqual(undoFacetHistory(after, history).state.facetCatalog, catalog);
});

test("a tag operation cannot record an undo step that adds or removes cases", () => {
  const catalog = createDefaultFacetCatalog();
  const before = { facetCatalog: catalog, entries: [{ id: "one" }] };
  assert.throws(() => appendFacetUndo(null, before, { ...before, entries: [] }), /保护资料库/);
  assert.throws(() => appendFacetUndo(null, before, { ...before, entries: [...before.entries, { id: "two" }] }), /保护资料库/);
});

test("facet undo history keeps only the latest ten real edits", () => {
  const catalog = createDefaultFacetCatalog();
  let history = null;
  for (let index = 0; index < 12; index += 1) {
    const before = { facetCatalog: { ...catalog, revision: index }, entries: [] };
    const after = { facetCatalog: { ...catalog, revision: index + 1 }, entries: [] };
    history = appendFacetUndo(history, before, after, { entriesChanged: false });
  }
  assert.equal(FACET_UNDO_LIMIT, 10);
  assert.equal(facetUndoCount(history), 10);
  let restored = { facetCatalog: { ...catalog, revision: 12 }, entries: [] };
  while (facetUndoCount(history)) { const result = undoFacetHistory(restored, history); restored = result.state; history = result.history; }
  assert.equal(restored.facetCatalog.revision, 2);
});

test("legacy oversized history is trimmed during normalization", () => {
  const catalog = createDefaultFacetCatalog();
  const history = normalizeFacetUndoHistory({
    version: FACET_UNDO_HISTORY_VERSION,
    steps: Array.from({ length: 15 }, (_, revision) => ({
      facetCatalog: { ...catalog, revision },
      afterFacetCatalog: { ...catalog, revision: revision + 1 },
      entries: []
    }))
  });
  assert.equal(history.steps.length, 10);
  let remaining = history, current = { facetCatalog: { ...catalog, revision: 15 }, entries: [] };
  while (facetUndoCount(remaining)) { const result = undoFacetHistory(current, remaining); current = result.state; remaining = result.history; }
  assert.equal(current.facetCatalog.revision, 5);
});

test('tag undo stores small differences, not copies of an unchanged long original', () => {
  const original = '完整原词'.repeat(128 * 1024);
  const catalog = createDefaultFacetCatalog();
  const before = { facetCatalog: catalog, entries: [{ id: 'one', text: original, facetAssignments: [] }] };
  const after = { ...before, entries: [{ ...before.entries[0], facetAssignments: [{ nodeId: 'new' }] }] };
  const history = appendFacetUndo(null, before, after);
  assert.ok(JSON.stringify(history).length < 1024);
  assert.equal(undoFacetHistory(after, history).state.entries[0].text, original);
  assert.deepEqual(undoFacetHistory(after, history).state.entries[0].facetAssignments, []);
  assert.throws(() => undoFacetHistory({ ...after, entries: [{ ...after.entries[0], text: original + '后续编辑' }] }, history), /保护新内容/);
});

test("tag undo refuses to orphan a tag adopted by a later case or recoverable trash case", () => {
  const catalog = createDefaultFacetCatalog();
  const before = { facetCatalog: catalog, entries: [] };
  const created = { id: "later-tag", facetId: catalog.facets[0].id, name: "新标签", status: "active" };
  const after = { ...before, facetCatalog: { ...catalog, revision: catalog.revision + 1, nodes: [...catalog.nodes, created] } };
  const history = appendFacetUndo(null, before, after, { entriesChanged: false });
  const later = { id: "later", title: "后采集案例", facetAssignments: [{ nodeId: created.id, source: "manual" }] };
  const active = { ...after, entries: [later] };
  assert.throws(() => undoFacetHistory(active, history), /仍在使用/);
  assert.deepEqual(active.entries, [later]);
  const trashed = { ...after, trashState: { items: [{ kind: "entry", snapshot: later }] } };
  assert.throws(() => undoFacetHistory(trashed, history), /回收站/);
  assert.deepEqual(trashed.trashState.items[0].snapshot, later);
});

test('catalog undo cannot remove a tag used by an image in the recoverable media trash', () => {
  const catalog = createDefaultFacetCatalog(), group = catalog.nodes.find(n => n.kind === 'group');
  const before = { facetCatalog: catalog, entries: [{ id: 'case', text: '人工正文', mediaAssets: [{ id: 'image', kind: 'image', storageMode: 'managed' }], facetAssignments: [] }], trashState: { items: [] } };
  const after = { ...before, facetCatalog: createFacetNode(catalog, { id: 'new-tag', facetId: group.facetId, parentId: group.id, name: '新标签' }) };
  const history = appendFacetUndo(null, before, after, { entriesChanged: false });
  const analyzed = applyVisionAnalysis(after, 'case', { reconstructionPrompt: '有效独立逆推', tags: [{ g: group.id, t: '新标签' }] }, { visualId: 'image' }).state;
  assert.deepEqual(analyzed.facetCatalog, after.facetCatalog);
  const deleted = moveMediaToTrash(analyzed, 'case', ['image']);
  const snapshot = structuredClone(deleted);
  assert.throws(() => undoFacetHistory(deleted, history), /回收站/);
  assert.deepEqual(deleted, snapshot);
  const restored = restoreTrashItems(deleted, deleted.movedItemIds);
  assert(restored.entries[0].facetAssignments.some(a => a.nodeId === 'new-tag' && a.visualId === 'image'));
  assert(restored.facetCatalog.nodes.some(n => n.id === 'new-tag'));
});
