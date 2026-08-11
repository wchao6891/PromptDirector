import test from "node:test";
import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";

import { createDefaultFacetCatalog, createEmptyFacetCatalog, createFacet, createFacetNode } from "../facets.js";
import { entryAttributeSummary, entrySourceMetadataRows, filterEntries } from "../library-model.js";
import { CONTENT_IDS } from "../taxonomy.js";

test("library filters use OR inside a facet, AND across facets, and include child tags through parents", () => {
  let catalog = createFacet(createEmptyFacetCatalog(), { id: "facet:mood", name: "画面情绪" });
  catalog = createFacetNode(catalog, { id: "tag:dramatic", facetId: "facet:mood", name: "戏剧性" });
  catalog = createFacetNode(catalog, { id: "tag:epic", facetId: "facet:mood", parentId: "tag:dramatic", name: "史诗" });
  catalog = createFacetNode(catalog, { id: "tag:emotion", facetId: "facet:mood", name: "情感" });
  catalog = createFacetNode(catalog, { id: "tag:quiet", facetId: "facet:mood", parentId: "tag:emotion", name: "静谧" });
  catalog = createFacet(catalog, { id: "facet:camera", name: "镜头调度" });
  catalog = createFacetNode(catalog, { id: "tag:movement", facetId: "facet:camera", name: "摄影机运动" });
  catalog = createFacetNode(catalog, { id: "tag:tracking", facetId: "facet:camera", parentId: "tag:movement", name: "跟拍" });
  const entries = [
    {
      id: "one", title: "Epic tracking", text: "hero", url: "https://example.com/1",
      classification: { pathIds: [CONTENT_IDS.promptVideo], status: "confirmed" },
      facetAssignments: [
        { facetId: "facet:mood", nodeId: "tag:epic", status: "confirmed" },
        { facetId: "facet:camera", nodeId: "tag:tracking", status: "confirmed" }
      ]
    },
    {
      id: "two", title: "Quiet still", text: "forest", url: "https://example.com/2",
      classification: { pathIds: [CONTENT_IDS.promptImage], status: "confirmed" },
      facetAssignments: [
        { facetId: "facet:mood", nodeId: "tag:quiet", status: "confirmed" }
      ]
    }
  ];
  const facetSelections = new Map([
    ["facet:mood", new Set(["tag:epic", "tag:quiet"])],
    ["facet:camera", new Set(["tag:movement"])]
  ]);

  assert.deepEqual(filterEntries(entries, { facetSelections }, catalog).map((item) => item.id), ["one"]);
  assert.deepEqual(filterEntries(entries, { query: "forest", contentId: CONTENT_IDS.promptImage }, catalog).map((item) => item.id), ["two"]);
  assert.deepEqual(filterEntries(entries, { query: "史诗" }, catalog).map((item) => item.id), ["one"]);
});

test("large libraries prepare selected tag descendants once per filter interaction", () => {
  const nodes = Array.from({ length: 400 }, (_, index) => ({
    id: `tag:${index}`, name: `标签 ${index}`, facetId: "facet:style",
    parentId: index ? "tag:0" : null, order: index, aliases: [], patterns: [], status: "active"
  }));
  const catalog = {
    version: 3,
    revision: 1,
    facets: [{ id: "facet:style", name: "风格", color: "#65736d", order: 0, aliases: [], status: "active" }],
    nodes
  };
  const entries = Array.from({ length: 6000 }, (_, index) => ({
    id: `entry:${index}`,
    facetAssignments: [{
      facetId: "facet:style", nodeId: `tag:${index % nodes.length}`, status: "confirmed"
    }]
  }));
  const startedAt = performance.now();
  const filtered = filterEntries(entries, {
    facetSelections: new Map([["facet:style", new Set(["tag:0"])]]),
  }, catalog);
  const elapsedMs = performance.now() - startedAt;

  assert.equal(filtered.length, entries.length);
  assert.ok(elapsedMs < 250, `large tag filter should stay responsive, took ${elapsedMs.toFixed(1)}ms`);
});

test("search includes reusable image analysis but ignores obsolete DeepSeek text breakdown", () => {
  const entries = [{
    id: "one",
    title: "案例",
    text: "ordinary prompt",
    analysisBreakdown: [
      { dimensionName: "材质", tagName: "旧文字拆解", evidence: "obsolete", source: "deepseek_text" },
      { dimensionName: "构图", tagName: "中央构图", evidence: "centered", source: "local_image_review" }
    ]
  }];
  assert.deepEqual(filterEntries(entries, { query: "中央构图" }, createDefaultFacetCatalog()).map((item) => item.id), ["one"]);
  assert.deepEqual(filterEntries(entries, { query: "旧文字拆解" }, createDefaultFacetCatalog()).map((item) => item.id), []);
});

test("search includes only the current valid vision description", () => {
  const entries = [{
    id: "vision",
    title: "图片案例",
    visuals: [{ id: "visual", visionAnalysis: { description: "青绿色雾气包围的古代庭院", imageFingerprint: "current" } }],
    primaryVisualId: "visual"
  }];
  assert.equal(filterEntries(entries, { query: "青绿色雾气" }, createDefaultFacetCatalog()).length, 1);
  entries[0].visuals[0].visionAnalysis.invalidated = true;
  assert.equal(filterEntries(entries, { query: "青绿色雾气" }, createDefaultFacetCatalog()).length, 0);
});

test("free-form custom labels are searchable without joining the facet taxonomy", () => {
  const entries = [{ id: "custom", title: "案例", customLabels: ["待复刻", "客户喜欢"] }];

  assert.deepEqual(
    filterEntries(entries, { query: "客户喜欢" }, createDefaultFacetCatalog()).map((item) => item.id),
    ["custom"]
  );
});

test("card attributes contain only content and custom labels, never source metadata", () => {
  let catalog = createFacet(createEmptyFacetCatalog(), { id: "facet:style", name: "视觉风格" });
  catalog = createFacetNode(catalog, { id: "tag:cinematic", facetId: "facet:style", name: "电影感" });
  catalog = createFacetNode(catalog, { id: "tag:editorial", facetId: "facet:style", name: "编辑摄影" });
  const entry = {
    customLabels: ["待复刻"],
    metadataLabels: ["AIArtWorks", "Midjourney", "Vol.319"],
    facetAssignments: [
      { facetId: "facet:style", nodeId: "tag:cinematic", status: "confirmed", source: "deepseek_text", importance: 0.7 },
      { facetId: "facet:style", nodeId: "tag:editorial", status: "confirmed", source: "deepseek_text", importance: 0.9 }
    ]
  };

  assert.deepEqual(entryAttributeSummary(entry, catalog, 2).map((item) => item.label), ["编辑摄影", "电影感"]);
  assert.deepEqual(entryAttributeSummary({ customLabels: ["待复刻"], metadataLabels: ["AIArtWorks"] }, catalog, 2).map((item) => item.label), ["待复刻"]);
});

test("source metadata becomes readable rows instead of tag values", () => {
  assert.deepEqual(entrySourceMetadataRows({
    metadataLabels: ["即梦灵感", "作者：creator", "点赞：3154", "使用：29"]
  }), [
    { label: "来源", value: "即梦灵感" },
    { label: "作者", value: "creator" },
    { label: "点赞", value: "3154" },
    { label: "使用", value: "29" }
  ]);
});

test("import metadata remains searchable without becoming a content tag", () => {
  const entries = [{ id: "imported", title: "案例", metadataLabels: ["Higgsfield Community", "作者：creator"] }];
  assert.deepEqual(filterEntries(entries, { query: "creator" }, createDefaultFacetCatalog()).map((item) => item.id), ["imported"]);
});

test("a compound logical case matches search, content filters, and pending state from any member", () => {
  const compound = {
    id: "compound:one", title: "完整广告", contentTypeIds: [CONTENT_IDS.promptImage, CONTENT_IDS.promptVideo],
    memberEntries: [
      { id: "image", title: "首帧", text: "golden skyline", classification: { pathIds: [CONTENT_IDS.promptImage], status: "confirmed" } },
      { id: "video", title: "动态", text: "camera orbit", classification: { pathIds: [], status: "needs_review" } }
    ],
    facetAssignments: [], customLabels: []
  };
  assert.equal(filterEntries([compound], { query: "camera orbit" }, createDefaultFacetCatalog()).length, 1);
  assert.equal(filterEntries([compound], { contentId: CONTENT_IDS.promptVideo }, createDefaultFacetCatalog()).length, 1);
  assert.equal(filterEntries([compound], { pendingOnly: true }, createDefaultFacetCatalog()).length, 1);
});
