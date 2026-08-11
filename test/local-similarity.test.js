import test from "node:test";
import assert from "node:assert/strict";

import { createSimilarityIndex, rankSimilarEntries } from "../local-similarity.js";
import { createEmptyFacetCatalog, createFacet, createFacetNode } from "../facets.js";

function catalog() {
  let value = createFacet(createEmptyFacetCatalog(), { id: "facet:style", name: "视觉风格" });
  value = createFacetNode(value, { id: "group:film", facetId: "facet:style", name: "电影风格" });
  value = createFacetNode(value, { id: "tag:noir", facetId: "facet:style", parentId: "group:film", name: "黑色电影", aliases: ["film noir"] });
  value = createFacetNode(value, { id: "tag:cinematic", facetId: "facet:style", parentId: "group:film", name: "电影感" });
  value = createFacetNode(value, { id: "group:print", facetId: "facet:style", name: "印刷风格" });
  value = createFacetNode(value, { id: "tag:ink", facetId: "facet:style", parentId: "group:print", name: "墨色印刷", aliases: ["film noir"] });
  value = createFacetNode(value, { id: "tag:editorial", facetId: "facet:style", name: "编辑摄影", aliases: ["editorial photo"] });
  return value;
}

function entry(id, nodeId, colors, visualId = `${id}:image`) {
  return {
    id,
    title: id,
    facetAssignments: nodeId ? [{ facetId: "facet:style", nodeId, status: "confirmed", importance: 1 }] : [],
    discoveryVisualId: visualId,
    discoveryColors: colors
  };
}

test("semantic similarity dominates palette while color-only matches remain available", () => {
  const entries = [
    entry("current", "tag:noir", ["#C02020", "#101010"]),
    entry("same-palette", "tag:editorial", ["#C51F20", "#121212"]),
    entry("same-tag", "tag:noir", ["#1E5ED0", "#F1F1F1"])
  ];
  const index = createSimilarityIndex(entries, catalog());
  const ranked = rankSimilarEntries(index, "current");
  assert.equal(ranked[0].entry.id, "same-tag");
  assert.equal(ranked[1].entry.id, "same-palette");
  assert.ok(ranked[0].contentSimilarity > ranked[1].contentSimilarity);
});

test("content similarity falls back through exact nodes, shared parents, and aliases", () => {
  const entries = [
    entry("current", "tag:noir", []),
    entry("exact", "tag:noir", []),
    entry("sibling", "tag:cinematic", []),
    entry("alias", "tag:ink", []),
    entry("unrelated", "tag:editorial", []),
    entry("no-visual", "tag:noir", [], "")
  ];
  const ranked = rankSimilarEntries(createSimilarityIndex(entries, catalog()), "current");
  assert.deepEqual(ranked.map((item) => item.entry.id), ["exact", "sibling", "alias"]);
  assert.equal(ranked[0].contentSimilarity, 1);
  assert.equal(ranked[1].contentSimilarity, 0.7);
  assert.equal(ranked[2].contentSimilarity, 0.5);
  assert.deepEqual(ranked[1].matchedFacetNames, ["视觉风格"]);
});

test("similarity ranking is stable for equal scores", () => {
  const entries = [
    entry("current", "tag:noir", []),
    entry("z-last", "tag:noir", []),
    entry("a-first", "tag:noir", [])
  ];
  const ranked = rankSimilarEntries(createSimilarityIndex(entries, catalog()), "current");
  assert.deepEqual(ranked.map((item) => item.entry.id), ["a-first", "z-last"]);
});
