import test from "node:test";
import assert from "node:assert/strict";

import {
  applyFacetChange,
  createFacet,
  createDefaultFacetCatalog,
  createEmptyFacetCatalog,
  createFacetNode,
  formatFacetNodePath,
  previewFacetChange,
  recoverFullyArchivedFacets,
  restoreArchivedFacets,
  restoreArchivedNodes
} from "../facets.js";

test("generic facet operations remain testable without changing the fixed product default", () => {
  let catalog = createEmptyFacetCatalog();
  assert.deepEqual(catalog.facets, []);
  assert.deepEqual(catalog.nodes, []);

  catalog = createFacet(catalog, { id: "facet:visual", name: "视觉语言", color: "#7654A8" });
  catalog = createFacetNode(catalog, { id: "tag:cinema", facetId: "facet:visual", name: "电影感" });
  catalog = createFacetNode(catalog, { id: "tag:noir", facetId: "facet:visual", parentId: "tag:cinema", name: "黑色电影" });
  assert.equal(formatFacetNodePath(catalog, "tag:noir"), "电影感 / 黑色电影");

  const state = { facetCatalog: catalog, entries: [] };
  const result = applyFacetChange(state, previewFacetChange(state, {
    type: "rename_facet", facetId: "facet:visual", name: "视觉风格"
  }));
  assert.equal(result.state.facetCatalog.facets[0].name, "视觉风格");
  assert.deepEqual(result.state.facetCatalog.facets[0].aliases, ["视觉语言"]);
});

test("archiving a dimension does not erase historical assignments", () => {
  let catalog = createFacet(createEmptyFacetCatalog(), { id: "facet:mood", name: "情绪" });
  catalog = createFacet(catalog, { id: "facet:light", name: "灯光" });
  catalog = createFacetNode(catalog, { id: "tag:quiet", facetId: "facet:mood", name: "静谧" });
  const state = { facetCatalog: catalog, entries: [{ id: "one", facetAssignments: [{ facetId: "facet:mood", nodeId: "tag:quiet", source: "manual", status: "confirmed" }] }] };
  const result = applyFacetChange(state, previewFacetChange(state, { type: "archive_facet", facetId: "facet:mood" }));
  assert.equal(result.state.facetCatalog.facets[0].status, "archived");
  assert.equal(result.state.entries[0].facetAssignments[0].nodeId, "tag:quiet");
});

test("dimension archive preview reports hidden tags and affected cases", () => {
  let catalog = createFacet(createEmptyFacetCatalog(), { id: "facet:mood", name: "情绪" });
  catalog = createFacet(catalog, { id: "facet:light", name: "灯光" });
  catalog = createFacetNode(catalog, { id: "tag:quiet", facetId: "facet:mood", name: "静谧" });
  catalog = createFacetNode(catalog, { id: "tag:warm", facetId: "facet:mood", name: "温暖" });
  const state = {
    facetCatalog: catalog,
    entries: [{
      id: "one",
      facetAssignments: [{ facetId: "facet:mood", nodeId: "tag:quiet", source: "manual", status: "confirmed" }]
    }]
  };

  const preview = previewFacetChange(state, { type: "archive_facet", facetId: "facet:mood" });
  assert.equal(preview.affectedNodeCount, 2);
  assert.equal(preview.affectedEntryCount, 1);
});

test("a fully archived vocabulary is recoverable without changing assignments", () => {
  let catalog = createFacet(createEmptyFacetCatalog(), { id: "facet:mood", name: "情绪" });
  catalog = createFacet(catalog, { id: "facet:light", name: "灯光" });
  catalog = createFacetNode(catalog, { id: "tag:quiet", facetId: "facet:mood", name: "静谧" });
  const originalAssignments = [{ facetId: "facet:mood", nodeId: "tag:quiet", source: "manual", status: "confirmed" }];
  const archivedCatalog = structuredClone(catalog);
  archivedCatalog.facets.forEach((facet) => { facet.status = "archived"; });
  const archivedState = {
    facetCatalog: archivedCatalog,
    entries: [{ id: "one", facetAssignments: originalAssignments }]
  };

  const recovered = recoverFullyArchivedFacets(archivedState.facetCatalog);
  assert.deepEqual(recovered.restoredFacetIds, ["facet:mood", "facet:light"]);
  assert.ok(recovered.catalog.facets.every((facet) => facet.status === "active"));
  assert.deepEqual(archivedState.entries[0].facetAssignments, originalAssignments);

  const partiallyArchived = applyFacetChange(
    { facetCatalog: catalog, entries: [] },
    previewFacetChange({ facetCatalog: catalog, entries: [] }, { type: "archive_facet", facetId: "facet:mood" })
  ).state.facetCatalog;
  assert.deepEqual(recoverFullyArchivedFacets(partiallyArchived).restoredFacetIds, []);
  assert.equal(restoreArchivedFacets(partiallyArchived, ["facet:mood"]).facets[0].status, "active");
});

test("the last visible dimension cannot be archived", () => {
  const catalog = createFacet(createEmptyFacetCatalog(), { id: "facet:mood", name: "情绪" });
  assert.throws(
    () => previewFacetChange({ facetCatalog: catalog, entries: [] }, {
      type: "archive_facet", facetId: "facet:mood"
    }),
    /至少保留一个可见的创作维度/
  );
});

test("restoring an archived group also restores its child tags", () => {
  let catalog = createFacet(createEmptyFacetCatalog(), { id: "facet:mood", name: "情绪" });
  catalog = createFacetNode(catalog, { id: "tag:emotion", facetId: "facet:mood", name: "情绪类型" });
  catalog = createFacetNode(catalog, {
    id: "tag:quiet", facetId: "facet:mood", parentId: "tag:emotion", name: "静谧"
  });
  catalog.nodes.forEach((node) => { node.status = "archived"; });

  const restored = restoreArchivedNodes(catalog, ["tag:emotion"]);
  assert.ok(restored.nodes.every((node) => node.status === "active"));
});

test("automatically created dimensions receive distinct editable colors", () => {
  let catalog = createFacet(createEmptyFacetCatalog(), { name: "视觉风格" });
  catalog = createFacet(catalog, { name: "镜头语言" });

  assert.match(catalog.facets[0].color, /^#[0-9A-F]{6}$/i);
  assert.match(catalog.facets[1].color, /^#[0-9A-F]{6}$/i);
  assert.notEqual(catalog.facets[0].color, catalog.facets[1].color);
});
