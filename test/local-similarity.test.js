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
  assert.deepEqual(ranked.map((item) => item.entry.id), ["exact", "no-visual", "sibling", "alias"]);
  assert.equal(ranked[0].contentSimilarity, 1);
  assert.equal(ranked[2].contentSimilarity, 0.7);
  assert.equal(ranked[3].contentSimilarity, 0.5);
  assert.deepEqual(ranked[2].matchedFacetNames, ["视觉风格"]);
  assert.equal(ranked[1].visualId, "");
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

test("manual labels, content types, projects, file names, and file types all contribute without fixed truncation", () => {
  const entries = [
    { ...entry("current", null, []), customLabels: ["客户参考"], contentTypeIds: ["type:ad"], mediaAssets: [{ kind: "document", sourceFormat: "pdf", mimeType: "application/pdf", sourceTitle: "campaign-board-01.pdf" }] },
    { ...entry("label", null, [], ""), customLabels: ["客户参考"], mediaAssets: [{ kind: "audio", sourceFormat: "wav", sourceTitle: "sound.wav" }] },
    { ...entry("organized", null, [], ""), contentTypeIds: ["type:ad"], mediaAssets: [{ kind: "document", sourceFormat: "md", sourceTitle: "notes.md" }] },
    { ...entry("filename", null, [], ""), mediaAssets: [{ kind: "video", sourceFormat: "mp4", sourceTitle: "campaign-board-02.mp4" }] },
    { ...entry("format", null, [], ""), mediaAssets: [{ kind: "document", sourceFormat: "pdf", mimeType: "application/pdf", sourceTitle: "unrelated.pdf" }] }
  ];
  const projectIds = new Map([
    ["current", ["project:one"]],
    ["organized", ["project:one"]]
  ]);
  const index = createSimilarityIndex(entries, catalog(), {
    mediaForEntry: (value) => value.mediaAssets,
    contentTypesForEntry: (value) => value.contentTypeIds,
    projectIdsForEntry: (value) => projectIds.get(value.id) ?? []
  });
  const ranked = rankSimilarEntries(index, "current");

  assert.equal(ranked.length, 4);
  assert.equal(ranked[0].entry.id, "label");
  assert.equal(ranked[0].reason, "相同标签：客户参考");
  assert.equal(ranked[1].entry.id, "organized");
  assert.equal(ranked[1].reason, "相同内容类型");
  assert.ok(ranked.some((item) => item.entry.id === "filename" && item.signals.fileName));
  assert.ok(ranked.some((item) => item.entry.id === "format" && item.signals.fileFormat));
});

test("a single weak signal stays below explicit semantic evidence", () => {
  const entries = [
    { ...entry("current", "tag:noir", ["#111111"]), mediaAssets: [{ kind: "image", sourceFormat: "png", sourceTitle: "export-01.png" }] },
    { ...entry("semantic", "tag:noir", []), mediaAssets: [{ kind: "document", sourceFormat: "pdf", sourceTitle: "brief.pdf" }] },
    { ...entry("weak", null, ["#121212"]), mediaAssets: [{ kind: "image", sourceFormat: "png", sourceTitle: "untitled-02.png" }] }
  ];
  const ranked = rankSimilarEntries(createSimilarityIndex(entries, catalog(), { mediaForEntry: (value) => value.mediaAssets }), "current");
  assert.equal(ranked[0].entry.id, "semantic");
  assert.equal(ranked.at(-1).entry.id, "weak");
});

test("similarity returns every matching case in a large library without an implicit cap", () => {
  const candidates = Array.from({ length: 1200 }, (_, index) => ({
    ...entry(`candidate-${String(index).padStart(4, "0")}`, null, [], ""),
    customLabels: ["同一客户"]
  }));
  const current = { ...entry("current", null, [], ""), customLabels: ["同一客户"] };

  const ranked = rankSimilarEntries(createSimilarityIndex([current, ...candidates], catalog()), current.id);

  assert.equal(ranked.length, candidates.length);
  assert.equal(ranked[0].entry.id, "candidate-0000");
  assert.equal(ranked.at(-1).entry.id, "candidate-1199");
});

test("similarity order is deterministic when the input order changes", () => {
  const current = { ...entry("current", null, [], ""), customLabels: ["参考"] };
  const candidates = ["zeta", "alpha", "middle"].map((id) => ({
    ...entry(id, null, [], ""), customLabels: ["参考"], savedAt: "2026-09-03T00:00:00.000Z"
  }));
  const forward = rankSimilarEntries(createSimilarityIndex([current, ...candidates], catalog()), current.id);
  const reversed = rankSimilarEntries(createSimilarityIndex([current, ...candidates.toReversed()], catalog()), current.id);

  assert.deepEqual(forward.map((item) => item.entry.id), ["alpha", "middle", "zeta"]);
  assert.deepEqual(reversed.map((item) => item.entry.id), forward.map((item) => item.entry.id));
});

test("missing optional metadata is safe and does not invent similarity evidence", () => {
  const entries = [
    { id: "current", title: "当前" },
    { id: "empty", title: "空白" },
    { id: "same-type", title: "同类型", contentTypeIds: ["type:reference"] }
  ];
  entries[0].contentTypeIds = ["type:reference"];

  const ranked = rankSimilarEntries(createSimilarityIndex(entries, catalog()), "current");

  assert.deepEqual(ranked.map((item) => item.entry.id), ["same-type"]);
  assert.equal(ranked[0].reason, "相同内容类型");
});

test("combined human metadata outranks one weak file or palette match", () => {
  const entries = [
    { ...entry("current", null, ["#111111"], ""), contentTypeIds: ["type:ad"], mediaAssets: [{ kind: "image", sourceFormat: "png", sourceTitle: "launch-board.png" }] },
    { ...entry("combined", null, [], ""), contentTypeIds: ["type:ad"], mediaAssets: [{ kind: "document", sourceFormat: "pdf", sourceTitle: "launch-board.pdf" }] },
    { ...entry("palette", null, ["#121212"], ""), mediaAssets: [{ kind: "video", sourceFormat: "mp4", sourceTitle: "other.mp4" }] },
    { ...entry("format", null, [], ""), mediaAssets: [{ kind: "image", sourceFormat: "png", sourceTitle: "unrelated.png" }] }
  ];
  const ranked = rankSimilarEntries(createSimilarityIndex(entries, catalog(), {
    mediaForEntry: (value) => value.mediaAssets,
    contentTypesForEntry: (value) => value.contentTypeIds
  }), "current");

  assert.equal(ranked[0].entry.id, "combined");
  assert.equal(ranked[0].tier, 2);
  assert.ok(ranked.slice(1).every((item) => item.tier === 1));
});
