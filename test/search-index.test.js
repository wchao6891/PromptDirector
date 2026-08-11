import test from "node:test";
import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";

import { createDefaultFacetCatalog } from "../facets.js";
import { buildSearchIndex, searchIndexedEntries } from "../search-index.js";

test("the reusable search index preserves free text and operator matching", () => {
  const entries = [{
    id: "video", title: "雨夜追车", text: "camera accelerates", savedAt: "2026-08-01T10:00:00Z",
    customLabels: ["电影感"], mediaAssets: [{ id: "clip", kind: "video", storageMode: "reference", sourceUrl: "https://x.com/item" }]
  }];
  const index = buildSearchIndex(entries, createDefaultFacetCatalog());
  assert.deepEqual([...searchIndexedEntries(index, "雨夜 type:video source:x.com tag:电影感 date:2026-08")], ["video"]);
  assert.equal(searchIndexedEntries(index, "type:document").size, 0);
});

test("1000 indexed cases can process ten successive queries within the interaction budget", () => {
  const entries = Array.from({ length: 1000 }, (_, index) => ({
    id: `entry-${index}`, title: `案例 ${index}`, text: `cinematic camera movement ${index}`,
    savedAt: "2026-08-01T10:00:00Z", mediaAssets: []
  }));
  const index = buildSearchIndex(entries, createDefaultFacetCatalog());
  const startedAt = performance.now();
  for (const query of ["c", "ci", "cin", "cine", "cinem", "cinema", "cinemat", "cinemati", "cinematic", "cinematic 99"]) {
    searchIndexedEntries(index, query);
  }
  assert.ok(performance.now() - startedAt < 100, "ten local queries should complete inside 100ms on the test runner");
});

test("6000 imported cases reuse one prepared vocabulary and tolerate empty media slots", () => {
  const nodes = Array.from({ length: 400 }, (_, index) => ({
    id: `node:${index}`, name: `标签 ${index}`, facetId: "facet:large",
    parentId: null, order: index, aliases: [], patterns: [], status: "active"
  }));
  const catalog = {
    version: 2,
    revision: 1,
    facets: [{ id: "facet:large", name: "大资料库", color: "#65736d", order: 0, aliases: [], status: "active" }],
    nodes
  };
  const entries = Array.from({ length: 6000 }, (_, index) => ({
    id: `entry:${index}`,
    title: `案例 ${index}`,
    text: "",
    savedAt: "2026-08-01T10:00:00Z",
    mediaAssets: [
      ...(index % 257 === 0 ? [null] : []),
      { id: `asset:${index}`, kind: "image", usage: "content", storageMode: "managed" }
    ],
    facetAssignments: [{
      facetId: "facet:large", nodeId: `node:${index % 400}`, source: "manual", status: "confirmed"
    }]
  }));

  const startedAt = performance.now();
  const index = buildSearchIndex(entries, catalog);
  const elapsedMs = performance.now() - startedAt;

  assert.equal(index.length, 6000);
  assert.ok(elapsedMs < 500, `large search index should build inside 500ms, took ${elapsedMs.toFixed(1)}ms`);
});
