import test from "node:test";
import assert from "node:assert/strict";

import { FACET_UNDO_LIMIT, appendFacetUndo, facetUndoCount, normalizeFacetUndoHistory, undoFacetHistory } from "../facet-history.js";
import { applyFacetChange, createDefaultFacetCatalog, createEmptyFacetCatalog, createFacet, previewFacetChange } from "../facets.js";

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

test("legacy single-snapshot undo remains available after upgrade", () => {
  const catalog = createFacet(createEmptyFacetCatalog(), { id: "facet:mood", name: "情绪" });
  const legacySnapshot = { facetCatalog: catalog, entries: [{ id: "one", facetAssignments: [] }] };
  const current = structuredClone(legacySnapshot);
  current.facetCatalog.facets[0].name = "新名称";

  assert.equal(facetUndoCount(legacySnapshot), 1);
  const undone = undoFacetHistory(current, legacySnapshot);
  assert.equal(undone.state.facetCatalog.facets[0].name, "情绪");
  assert.equal(undone.remainingSteps, 0);
});

test("undo restores removed entries, drops added entries, and restores entry order", () => {
  const catalog = createFacet(createEmptyFacetCatalog(), { id: "facet:mood", name: "情绪" });
  const first = { id: "one", title: "第一条", facetAssignments: [] };
  const second = { id: "two", title: "第二条", facetAssignments: [] };
  const before = { facetCatalog: catalog, entries: [first, second] };
  const after = {
    facetCatalog: catalog,
    entries: [{ ...second, title: "已修改" }, { id: "three", title: "新增条目", facetAssignments: [] }]
  };
  const history = appendFacetUndo(null, before, after);

  const undone = undoFacetHistory(after, history);
  assert.deepEqual(undone.state.entries, [first, second]);
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
  assert.equal(history.steps[0].facetCatalog.revision, 2);
});

test("legacy oversized history is trimmed during normalization", () => {
  const catalog = createDefaultFacetCatalog();
  const history = normalizeFacetUndoHistory({
    version: 1,
    steps: Array.from({ length: 15 }, (_, revision) => ({
      facetCatalog: { ...catalog, revision },
      entries: []
    }))
  });
  assert.equal(history.steps.length, 10);
  assert.equal(history.steps[0].facetCatalog.revision, 5);
});
