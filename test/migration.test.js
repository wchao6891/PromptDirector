import test from "node:test";
import assert from "node:assert/strict";

import { migrateLibraryState, needsMigration } from "../migration.js";
import { CONTENT_IDS, SCHEMA_VERSION, createDefaultTaxonomy } from "../taxonomy.js";

test("older schemas upgrade without changing entry content", () => {
  const entry = {
    id: "case-a", schemaVersion: 16, title: "原案例", text: "原文", url: "https://example.com",
    savedAt: "2026-08-01T00:00:00.000Z",
    classification: { pathIds: ["content:prompt:image"], status: "confirmed", source: "manual" },
    visuals: [], facetAssignments: [], analysisCandidates: [], analysisBreakdown: [], customLabels: []
  };
  const result = migrateLibraryState({ schemaVersion: 16, entries: [entry], organizerState: { collections: [] } });
  assert.equal(result.state.schemaVersion, SCHEMA_VERSION);
  assert.deepEqual(result.state.compoundCases, []);
  assert.equal(result.state.entries[0].id, entry.id);
  assert.equal(result.state.entries[0].text, entry.text);
  assert.equal(needsMigration(result.state), false);
});

test("fixed-tree upgrade keeps mapped DeepSeek labels usable until an explicit rebuild", () => {
  const stored = {
    schemaVersion: 24,
    taxonomy: createDefaultTaxonomy(),
    facetCatalog: {
      version: 2,
      revision: 4,
      facets: [{ id: "old-style", name: "渲染风格", color: "#65736d", order: 0, aliases: [], status: "active" }],
      nodes: [{
        id: "old-cel", name: "赛璐珞", facetId: "old-style", parentId: null,
        order: 0, aliases: [], patterns: [], status: "active"
      }]
    },
    organizerState: { collections: [] },
    compoundCases: [],
    entries: [{
      id: "analyzed", schemaVersion: 24, title: "已分析案例", text: "cel shaded hero",
      savedAt: "2026-08-02T00:00:00.000Z",
      classification: { pathIds: [CONTENT_IDS.promptImage], status: "confirmed", source: "manual" },
      facetAssignments: [{
        facetId: "old-style", nodeId: "old-cel", status: "confirmed", source: "deepseek_text"
      }],
      analysisCandidates: [], analysisBreakdown: [], customLabels: [],
      analysisPending: false,
      analysisMeta: { textRevision: 1, promptVersion: 7, model: "previous", analyzedAt: "2026-08-02T00:00:00.000Z" },
      analyzedAt: "2026-08-02T00:00:00.000Z"
    }]
  };

  const migrated = migrateLibraryState(stored);
  const entry = migrated.state.entries[0];
  const mappedNode = migrated.state.facetCatalog.nodes.find((item) => item.id === entry.facetAssignments[0].nodeId);

  assert.equal(migrated.facetTreeMigrated, true);
  assert.equal(migrated.state.facetCatalog.facets.length, 10);
  assert.equal(entry.facetAssignments[0].source, "deepseek_text");
  assert.equal(mappedNode.parentId, "style.render");
  assert.equal(mappedNode.name, "赛璐珞");
  assert.equal(entry.analysisPending, false);
  assert.equal(entry.analysisMeta.model, "previous");
  assert.equal(entry.analyzedAt, "2026-08-02T00:00:00.000Z");
});

test("schema upgrade separates verified importer metadata without moving user labels", () => {
  const common = {
    schemaVersion: 23,
    savedAt: "2026-08-01T00:00:00.000Z",
    classification: { pathIds: [CONTENT_IDS.promptImage], status: "confirmed", source: "manual" },
    facetAssignments: [], analysisCandidates: [], analysisBreakdown: []
  };
  const stored = {
    schemaVersion: 23,
    taxonomy: createDefaultTaxonomy(),
    facetCatalog: { version: 2, revision: 1, facets: [], nodes: [] },
    organizerState: { collections: [] },
    compoundCases: [],
    entries: [
      {
        ...common,
        id: "entry:wechat:one",
        title: "Midjourney 精选",
        text: "prompt",
        url: "https://mp.weixin.qq.com/s?mid=1",
        customLabels: ["AIArtWorks", "Midjourney", "Vol.319", "待复刻"]
      },
      {
        ...common,
        id: "higgsfield-one",
        title: "Higgsfield Community | @creator",
        text: "prompt",
        url: "https://higgsfield.ai/community/generations",
        customLabels: ["Higgsfield Community", "作者：creator", "模型：soul-v2", "客户喜欢"]
      },
      {
        ...common,
        id: "manual",
        title: "手动案例",
        text: "prompt",
        url: "https://example.com",
        customLabels: ["Midjourney", "Vol.319", "客户喜欢"]
      }
    ]
  };

  const result = migrateLibraryState(stored);
  assert.deepEqual(result.state.entries[0].metadataLabels, ["AIArtWorks", "Midjourney", "Vol.319"]);
  assert.deepEqual(result.state.entries[0].customLabels, ["待复刻"]);
  assert.deepEqual(result.state.entries[1].metadataLabels, ["Higgsfield Community", "作者：creator", "模型：soul-v2"]);
  assert.deepEqual(result.state.entries[1].customLabels, ["客户喜欢"]);
  assert.deepEqual(result.state.entries[2].metadataLabels, []);
  assert.deepEqual(result.state.entries[2].customLabels, ["Midjourney", "Vol.319", "客户喜欢"]);
});

test("schema 19 repairs screenshots that were misclassified as external references", () => {
  const stored = {
    schemaVersion: 19,
    organizerState: { collections: [], savedViews: [] },
    compoundCases: [],
    entries: [{
      id: "case-image", schemaVersion: 19, title: "旧截图", text: "", url: "https://example.com/post",
      savedAt: "2026-08-01T00:00:00.000Z",
      classification: { pathIds: ["content:reference:image"], status: "confirmed", source: "manual" },
      mediaAssets: [{
        id: "case-image", kind: "image", storageMode: "reference", mimeType: "image/webp",
        sourceUrl: "https://example.com/post"
      }],
      primaryMediaId: "case-image", facetAssignments: [], analysisCandidates: [], analysisBreakdown: [], customLabels: []
    }]
  };
  const result = migrateLibraryState(stored);
  assert.equal(needsMigration(stored), true);
  assert.equal(result.state.entries[0].mediaAssets[0].storageMode, "managed");
  assert.equal(result.state.entries[0].mediaAssets[0].sourceUrl, "https://example.com/post");
});

test("the one-time upgrade repairs only automatic local imports by media shape", () => {
  const base = {
    schemaVersion: 21,
    savedAt: "2026-08-01T00:00:00.000Z",
    url: "",
    facetAssignments: [], analysisCandidates: [], analysisBreakdown: [], customLabels: []
  };
  const stored = {
    schemaVersion: 21,
    taxonomy: createDefaultTaxonomy(),
    facetCatalog: { version: 1, revision: 1, facets: [], nodes: [] },
    organizerState: { collections: [] },
    compoundCases: [],
    entries: [
      { ...base, id: "local-doc", title: "教程.md", text: "第一步，第二步，最后", classification: { pathIds: [CONTENT_IDS.tutorial], status: "confirmed", source: "auto" }, mediaAssets: [{ id: "doc", kind: "document", mimeType: "text/markdown", storageMode: "managed" }] },
      { ...base, id: "local-video", title: "镜头.mp4", text: "视频提示词", classification: { pathIds: [CONTENT_IDS.promptVideo], status: "confirmed", source: "auto" }, mediaAssets: [{ id: "video", kind: "video", mimeType: "video/mp4", storageMode: "managed" }] },
      { ...base, id: "manual-doc", title: "人工分类.pdf", classification: { pathIds: [CONTENT_IDS.tutorial], status: "confirmed", source: "manual" }, mediaAssets: [{ id: "manual", kind: "document", mimeType: "application/pdf", storageMode: "managed" }] },
      { ...base, id: "web-doc", url: "https://example.com/tutorial", title: "网页教程", classification: { pathIds: [CONTENT_IDS.tutorial], status: "confirmed", source: "auto" }, mediaAssets: [{ id: "web", kind: "document", mimeType: "text/html", storageMode: "managed" }] }
    ]
  };

  const entries = migrateLibraryState(stored).state.entries;
  assert.deepEqual(entries.find((entry) => entry.id === "local-doc").classification.pathIds, [CONTENT_IDS.reference]);
  assert.deepEqual(entries.find((entry) => entry.id === "local-video").classification.pathIds, [CONTENT_IDS.videoCase]);
  assert.deepEqual(entries.find((entry) => entry.id === "manual-doc").classification.pathIds, [CONTENT_IDS.tutorial]);
  assert.deepEqual(entries.find((entry) => entry.id === "web-doc").classification.pathIds, [CONTENT_IDS.tutorial]);
});

test("automatic pending image cases recover when current local evidence is decisive", () => {
  const base = {
    schemaVersion: 22,
    savedAt: "2026-08-02T00:00:00.000Z",
    url: "https://example.com/reference",
    facetAssignments: [], analysisCandidates: [], analysisBreakdown: [], customLabels: []
  };
  const stored = {
    schemaVersion: 22,
    taxonomy: createDefaultTaxonomy(),
    facetCatalog: { version: 1, revision: 1, facets: [], nodes: [] },
    organizerState: { collections: [] },
    compoundCases: [{
      id: "compound:image-set",
      title: "图片组合",
      memberEntryIds: ["damaged-image", "confirmed-image"],
      createdAt: "2026-08-02T00:00:00.000Z",
      updatedAt: "2026-08-02T00:00:00.000Z"
    }],
    entries: [
      {
        ...base,
        id: "damaged-image",
        title: "图片参考",
        text: "画面参考",
        classification: { pathIds: [], status: "needs_review", source: "auto", reason: "证据不足，等待人工确认" },
        mediaAssets: [{ id: "image-a", kind: "image", usage: "content", storageMode: "managed" }],
        primaryMediaId: "image-a"
      },
      {
        ...base,
        id: "confirmed-image",
        title: "已确认图片",
        text: "另一张画面参考",
        classification: { pathIds: [CONTENT_IDS.imageCase], status: "confirmed", source: "manual" },
        mediaAssets: [{ id: "image-b", kind: "image", usage: "content", storageMode: "managed" }],
        primaryMediaId: "image-b"
      },
      {
        ...base,
        id: "still-ambiguous",
        title: "普通记录",
        text: "零散记录".repeat(100),
        classification: { pathIds: [], status: "needs_review", source: "auto", reason: "证据不足，等待人工确认" },
        mediaAssets: []
      }
    ]
  };

  assert.equal(needsMigration(stored), true);
  const result = migrateLibraryState(stored).state;

  assert.deepEqual(result.entries.find((entry) => entry.id === "damaged-image").classification.pathIds, [CONTENT_IDS.imageCase]);
  assert.equal(result.entries.find((entry) => entry.id === "damaged-image").classification.status, "confirmed");
  assert.equal(result.entries.find((entry) => entry.id === "still-ambiguous").classification.status, "needs_review");
  assert.deepEqual(result.compoundCases[0].memberEntryIds, ["damaged-image", "confirmed-image"]);
});
