import test from "node:test";
import assert from "node:assert/strict";

import { migrateLibraryState } from "../migration.js";
import {
  CONTENT_IDS,
  CONTENT_ROLES,
  CONTENT_TYPE_VISIBILITY,
  SCHEMA_VERSION,
  contentRoleForPath,
  createContentType,
  createDefaultTaxonomy,
  isValidContentPath,
  normalizeTaxonomy,
  removeContentType,
  removeContentTypeWithTransfer,
  renameContentType,
  updateContentType
} from "../taxonomy.js";
import {
  applyFacetChange, createDefaultFacetCatalog, createEmptyFacetCatalog, createFacet, createFacetNode,
  normalizeFacetCatalog, previewFacetChange, undoFacetChange
} from "../facets.js";

test("new libraries include first-class image, video, and document material types", () => {
  const taxonomy = createDefaultTaxonomy();
  assert.deepEqual(taxonomy.nodes.map((item) => item.name), ["攻略教程", "图片提示词", "视频提示词", "图片案例", "视频案例", "资料文档"]);
  assert.equal(isValidContentPath(taxonomy, [CONTENT_IDS.promptImage]), true);
  assert.equal(contentRoleForPath(taxonomy, [CONTENT_IDS.videoCase]), CONTENT_ROLES.videoCase);
  assert.equal(contentRoleForPath(taxonomy, [CONTENT_IDS.reference]), CONTENT_ROLES.reference);
  assert.equal(isValidContentPath(taxonomy, [CONTENT_IDS.promptImage, "detail"]), false);
  assert.ok(taxonomy.nodes.every((item) => item.visibility === CONTENT_TYPE_VISIBILITY.library));
});

test("legacy and new content types default to library visibility until the user opts into category-only", () => {
  const normalized = normalizeTaxonomy({ nodes: [{ id: CONTENT_IDS.reference, name: "资料文档", role: CONTENT_ROLES.reference }] });
  assert.equal(normalized.nodes.find((item) => item.id === CONTENT_IDS.reference).visibility, CONTENT_TYPE_VISIBILITY.library);
  const hidden = updateContentType(normalized, CONTENT_IDS.reference, { visibility: CONTENT_TYPE_VISIBILITY.categoryOnly });
  assert.equal(hidden.nodes.find((item) => item.id === CONTENT_IDS.reference).visibility, CONTENT_TYPE_VISIBILITY.categoryOnly);
  const restored = updateContentType(hidden, CONTENT_IDS.reference, { visibility: CONTENT_TYPE_VISIBILITY.library });
  assert.equal(restored.nodes.find((item) => item.id === CONTENT_IDS.reference).visibility, CONTENT_TYPE_VISIBILITY.library);
});

test("normalizing a reserved document id repairs its role without duplicating the category", () => {
  const taxonomy = normalizeTaxonomy({ nodes: [
    { id: CONTENT_IDS.reference, name: "我的资料", role: CONTENT_ROLES.general }
  ] });
  assert.equal(taxonomy.nodes.filter((item) => item.id === CONTENT_IDS.reference).length, 1);
  assert.equal(taxonomy.nodes.find((item) => item.id === CONTENT_IDS.reference).name, "我的资料");
  assert.equal(taxonomy.nodes.find((item) => item.id === CONTENT_IDS.reference).role, CONTENT_ROLES.reference);
  assert.equal(taxonomy.nodes.find((item) => item.id === CONTENT_IDS.videoCase).role, CONTENT_ROLES.videoCase);
});

test("content types can be created, repurposed, and removed without relying on their names", () => {
  let taxonomy = createContentType(createDefaultTaxonomy(), {
    id: "content:work-doc",
    name: "工作文档",
    role: CONTENT_ROLES.general
  });
  assert.equal(isValidContentPath(taxonomy, ["content:work-doc"]), true);
  assert.equal(contentRoleForPath(taxonomy, ["content:work-doc"]), CONTENT_ROLES.general);
  taxonomy = updateContentType(taxonomy, "content:work-doc", { name: "项目文件", role: CONTENT_ROLES.tutorial });
  assert.equal(contentRoleForPath(taxonomy, ["content:work-doc"]), CONTENT_ROLES.tutorial);
  assert.deepEqual(taxonomy.nodes.find((item) => item.id === "content:work-doc").aliases, ["工作文档"]);
  taxonomy = removeContentType(taxonomy, "content:work-doc");
  assert.equal(isValidContentPath(taxonomy, ["content:work-doc"]), false);
});

test("deleting a used content type requires and applies a lossless transfer", () => {
  const taxonomy = createContentType(createDefaultTaxonomy(), {
    id: "content:work-doc", name: "工作文档", role: CONTENT_ROLES.general
  });
  const state = {
    taxonomy,
    entries: [{
      id: "document",
      text: "项目周报",
      visuals: [{ id: "visual" }],
      customLabels: ["重要"],
      classification: { pathIds: ["content:work-doc"], status: "confirmed", source: "manual" }
    }],
    classificationRules: [{ hostname: "docs.example.com", pathIds: ["content:work-doc"], enabled: true }]
  };
  assert.throws(() => removeContentTypeWithTransfer(state, "content:work-doc"), /选择接收分类/);
  const transferred = removeContentTypeWithTransfer(state, "content:work-doc", CONTENT_IDS.tutorial);
  assert.deepEqual(transferred.entries[0].classification.pathIds, [CONTENT_IDS.tutorial]);
  assert.deepEqual(transferred.entries[0].visuals, [{ id: "visual" }]);
  assert.deepEqual(transferred.entries[0].customLabels, ["重要"]);
  assert.deepEqual(transferred.classificationRules[0].pathIds, [CONTENT_IDS.tutorial]);
  assert.equal(isValidContentPath(transferred.taxonomy, ["content:work-doc"]), false);
});

test("content type roles stay stable while their display names remain editable", () => {
  const renamed = renameContentType(createDefaultTaxonomy(), CONTENT_IDS.promptImage, "静态画面提示词");
  assert.equal(normalizeTaxonomy(renamed).nodes.find((item) => item.id === CONTENT_IDS.promptImage).name, "静态画面提示词");
  assert.deepEqual(renamed.nodes.find((item) => item.id === CONTENT_IDS.promptImage).aliases, ["图片提示词"]);
});

test("schema migration preserves source material but turns old flat tags into review candidates", () => {
  const stored = {
    schemaVersion: 3,
    taxonomy: { nodes: [
      { id: CONTENT_IDS.promptImage, name: "图片提示词", axis: "content" },
      { id: "style:3d", name: "3D", axis: "style" }
    ] },
    entries: [{
      schemaVersion: 3, id: "legacy", text: "cinematic product image --ar 1:1",
      title: "Old case", url: "https://example.com/old", savedAt: "2026-07-17T10:00:00.000Z",
      hasScreenshot: true, classification: { pathIds: [CONTENT_IDS.promptImage], status: "confirmed", source: "manual" },
      tagIds: ["style:3d"], legacyTags: ["产品广告"]
    }]
  };
  const migrated = migrateLibraryState(stored);
  const entry = migrated.state.entries[0];

  assert.equal(entry.visuals.length, 1);
  assert.equal(entry.primaryVisualId, "legacy");
  assert.equal(entry.text, "cinematic product image --ar 1:1");
  assert.deepEqual(entry.classification.pathIds, [CONTENT_IDS.promptImage]);
  assert.deepEqual(entry.legacyFacetCandidates, ["产品广告", "3D"]);
  assert.deepEqual(entry.facetAssignments, []);
  assert.equal(entry.analysisPending, true);
  assert.equal(migrated.state.facetCatalog.facets.length, 10);
  assert.equal(entry.visuals[0].reviewStatus, "unverified");
  assert.ok(migrated.backup.entries[0].tagIds.includes("style:3d"));
});

test("tutorial migration preserves screenshot palette so later type changes stay reversible", () => {
  const migrated = migrateLibraryState({
    schemaVersion: 4,
    taxonomy: createDefaultTaxonomy(),
    facetCatalog: createDefaultFacetCatalog(),
    entries: [{
      schemaVersion: 4, id: "tutorial", text: "lighting tutorial", hasScreenshot: true,
      palette: { colors: ["#112233"], source: "screenshot", version: 1 },
      classification: { pathIds: [CONTENT_IDS.tutorial], status: "confirmed", source: "manual" },
      facetAssignments: [{ facetId: "old", nodeId: "old:color", status: "confirmed", source: "palette" }]
    }]
  });
  const entry = migrated.state.entries[0];
  assert.equal(entry.visuals.length, 1);
  assert.deepEqual(entry.visuals[0].palette, { colors: ["#112233"], source: "screenshot", version: 1 });
  assert.deepEqual(entry.facetAssignments, []);
  assert.equal(entry.visuals[0].reviewStatus, "unverified");
});

test("older editable vocabulary migrates to schema 12 with an empty project organizer", () => {
  let catalog = createFacet(createEmptyFacetCatalog(), { id: "facet:custom", name: "我的视觉语言" });
  catalog = createFacetNode(catalog, { id: "tag:custom", facetId: "facet:custom", name: "私人风格" });
  const migrated = migrateLibraryState({
    schemaVersion: 5,
    taxonomy: createDefaultTaxonomy(),
    facetCatalog: catalog,
    entries: [{
      schemaVersion: 5,
      id: "kept",
      text: "custom visual prompt",
      classification: { pathIds: [CONTENT_IDS.promptImage], status: "confirmed", source: "manual" },
      facetAssignments: [{ facetId: "facet:custom", nodeId: "tag:custom", status: "confirmed", source: "manual", confidence: 1, evidence: "人工选择" }]
    }]
  });

  assert.equal(migrated.resetPerformed, false);
  assert.equal(migrated.state.facetCatalog.facets.length, 10);
  assert.deepEqual(migrated.state.entries[0].facetAssignments, []);
  assert.deepEqual(migrated.state.entries[0].customLabels, ["私人风格"]);
  assert.deepEqual(migrated.state.organizerState, { version: 6, collections: [] });
});

test("schema 9 migration removes old DeepSeek review noise while preserving confirmed and image analysis data", () => {
  let catalog = createFacet(createEmptyFacetCatalog(), { id: "facet:style", name: "视觉风格" });
  catalog = createFacetNode(catalog, { id: "tag:kept", facetId: "facet:style", name: "已确认风格" });
  const migrated = migrateLibraryState({
    schemaVersion: 8,
    taxonomy: createDefaultTaxonomy(),
    facetCatalog: catalog,
    entries: [{
      schemaVersion: 8,
      id: "analyzed",
      text: "matte ceramic subject",
      classification: { pathIds: [CONTENT_IDS.promptImage], status: "confirmed", source: "manual" },
      facetAssignments: [{ facetId: "facet:style", nodeId: "tag:kept", status: "confirmed", source: "deepseek_text" }],
      analysisCandidates: [
        { dimensionName: "材质", tagName: "旧文字待确认", evidence: "old", source: "deepseek_text" },
        { dimensionName: "构图", tagName: "图片待确认", evidence: "image", source: "local_image_review" }
      ],
      analysisBreakdown: [
        { dimensionName: "材质", tagName: "旧文字拆解", evidence: "matte ceramic", source: "deepseek_text" },
        { dimensionName: "构图", tagName: "图片完整分析", evidence: "centered", source: "local_image_review", confidence: 0.9, importance: 0.84 }
      ],
      analysisMeta: {
        textFingerprint: "fingerprint", promptVersion: 4, profileFingerprint: "profile", model: "deepseek-v4-flash"
      }
    }]
  });

  const entry = migrated.state.entries[0];
  assert.deepEqual(entry.facetAssignments, []);
  assert.deepEqual(entry.analysisCandidates.map((item) => item.tagName), ["图片待确认"]);
  assert.deepEqual(entry.analysisBreakdown.map((item) => item.tagName), ["图片完整分析"]);
  assert.equal(entry.analysisBreakdown[0].importance, 0.84);
  assert.equal(entry.analysisMeta, null);
  assert.equal(entry.analysisPending, true);
});

test("schema 15 keeps legacy vision descriptions on the migrated visual", () => {
  let catalog = createFacet(createEmptyFacetCatalog(), { id: "facet:light", name: "灯光" });
  catalog = createFacetNode(catalog, { id: "tag:backlight", facetId: "facet:light", name: "逆光" });
  const migrated = migrateLibraryState({
    schemaVersion: 9,
    taxonomy: createDefaultTaxonomy(),
    facetCatalog: catalog,
    entries: [{
      schemaVersion: 9,
      id: "vision",
      hasScreenshot: true,
      classification: { pathIds: [CONTENT_IDS.imageCase], status: "confirmed", source: "manual" },
      facetAssignments: [{ facetId: "facet:light", nodeId: "tag:backlight", status: "confirmed", source: "vision_model" }],
      visionAnalysis: {
        version: 1,
        description: "主体被强烈逆光勾勒。",
        locale: "zh-CN",
        imageFingerprint: "abc",
        analyzedAt: "2026-07-19T10:00:00.000Z",
        providerType: "openai",
        model: "gpt-5-mini",
        usage: { inputTokens: 10, outputTokens: 20, totalTokens: 30 },
        userEdited: true
      }
    }]
  });
  const entry = migrated.state.entries[0];
  assert.equal(migrated.state.schemaVersion, SCHEMA_VERSION);
  assert.equal(entry.schemaVersion, SCHEMA_VERSION);
  assert.equal(entry.facetAssignments[0].source, "vision_model");
  assert.equal(entry.facetAssignments[0].visualId, "vision");
  assert.equal(entry.mediaAssets[0].visionAnalysis.description, "主体被强烈逆光勾勒。");
  assert.equal(entry.mediaAssets[0].visionAnalysis.userEdited, true);
});

test("facet rename and merge update historical assignments and remain undoable", () => {
  let catalog = createFacet(createEmptyFacetCatalog(), { id: "facet:visual", name: "视觉风格" });
  catalog = createFacetNode(catalog, { id: "tag:aesthetic", facetId: "facet:visual", name: "画面质感" });
  catalog = createFacetNode(catalog, { id: "tag:hyperreal", facetId: "facet:visual", parentId: "tag:aesthetic", name: "超写实" });
  catalog = createFacetNode(catalog, {
    id: "tag:three_d", facetId: "facet:visual",
    parentId: "tag:aesthetic", name: "立体渲染"
  });
  const state = {
    facetCatalog: catalog,
    entries: [{ id: "one", facetAssignments: [{
      facetId: "facet:visual", nodeId: "tag:three_d",
      status: "confirmed", source: "manual", confidence: 1, evidence: "人工选择"
    }] }]
  };
  const renamed = applyFacetChange(state, previewFacetChange(state, {
    type: "rename", nodeId: "tag:three_d", name: "自定义3D"
  }));
  const merged = applyFacetChange(renamed.state, previewFacetChange(renamed.state, {
    type: "merge", sourceNodeId: "tag:three_d", targetNodeId: "tag:hyperreal"
  }));
  assert.equal(merged.state.entries[0].facetAssignments[0].nodeId, "tag:hyperreal");
  assert.ok(merged.state.facetCatalog.nodes.find((item) => item.id === "tag:hyperreal").aliases.includes("自定义3D"));
  assert.equal(undoFacetChange(merged.state, merged.undo).entries[0].facetAssignments[0].nodeId, "tag:three_d");
  assert.equal(normalizeFacetCatalog(merged.state.facetCatalog).nodes.find(
    (item) => item.id === "tag:three_d"
  ).status, "archived");
});

test("a parent group with children cannot be moved under another group", () => {
  let catalog = createFacet(createEmptyFacetCatalog(), { id: "facet:light", name: "灯光" });
  catalog = createFacetNode(catalog, { id: "tag:setup", facetId: "facet:light", name: "布光方式" });
  catalog = createFacetNode(catalog, { id: "tag:source", facetId: "facet:light", name: "光源" });
  catalog = createFacetNode(catalog, { id: "tag:rembrandt", facetId: "facet:light", parentId: "tag:setup", name: "伦勃朗光" });
  const state = { facetCatalog: catalog, entries: [] };
  assert.throws(() => previewFacetChange(state, {
    type: "move", nodeId: "tag:setup", parentId: "tag:source"
  }), /固定分组不能移动/);
});
