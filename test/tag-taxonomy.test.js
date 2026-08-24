import test from "node:test";
import assert from "node:assert/strict";

import { analysisTaxonomyPrompt } from "../deepseek.js";
import { previewFacetChange } from "../facets.js";
import {
  ANALYSIS_TAG_MAX,
  FIXED_TAG_TREE,
  applyDetailOrganizationMappings,
  applyFixedAnalysisTags,
  createDetailOrganizationChunks,
  createFixedFacetCatalog,
  detailNavigation,
  validateAnalysisTagResponse
} from "../tag-taxonomy.js";

test("fixed tag tree always contains ten facets and a protected other group in each facet", () => {
  const catalog = createFixedFacetCatalog();
  assert.equal(catalog.facets.length, 10);
  assert.deepEqual(catalog.facets.map((item) => item.name), FIXED_TAG_TREE.map((item) => item.zh));
  for (const facet of catalog.facets) {
    const others = catalog.nodes.filter((item) => item.facetId === facet.id && item.name === "其他");
    assert.equal(others.length, 1);
    assert.equal(others[0].kind, "group");
    assert.equal(others[0].protected, true);
  }
});

test("each protected other group cannot be renamed, archived, or merged away", () => {
  const state = { facetCatalog: createFixedFacetCatalog(), entries: [] };
  assert.throws(() => previewFacetChange(state, {
    type: "rename", nodeId: "subject.other", name: "未分类"
  }), /名称必须保留/);
  assert.throws(() => previewFacetChange(state, {
    type: "archive", nodeId: "subject.other"
  }), /必须保留/);
  assert.throws(() => previewFacetChange(state, {
    type: "merge", sourceNodeId: "subject.other", targetNodeId: "subject.character"
  }), /必须保留/);
});

test("analysis response keeps valid tags while dropping unknown, duplicate, extra, and over-limit output", () => {
  const catalog = createFixedFacetCatalog();
  const diagnostics = [];
  assert.throws(() => validateAnalysisTagResponse({ tags: [] }, catalog), /1–10/);
  assert.throws(() => validateAnalysisTagResponse({ tags: [{ g: "unknown", t: "值" }] }, catalog), /未知分类路径/);
  assert.deepEqual(validateAnalysisTagResponse({ extra: "ignored", tags: [
    { g: "style.render", t: "Cel-Shading" },
    { g: "style.render", t: "cel shading" },
    { g: "unknown", t: "discarded" }
  ] }, catalog, { diagnostics }), [{ g: "style.render", t: "Cel-Shading" }]);
  assert.ok(diagnostics.some((item) => item.code === "extra_fields_ignored"));
  assert.ok(diagnostics.some((item) => item.code === "duplicate_dropped"));
  assert.ok(diagnostics.some((item) => item.code === "unknown_path_dropped"));
  const bounded = validateAnalysisTagResponse({
    tags: Array.from({ length: ANALYSIS_TAG_MAX + 3 }, (_, index) => ({ g: "style.render", t: `标签${index}` }))
  }, catalog);
  assert.equal(bounded.length, ANALYSIS_TAG_MAX);
});

test("analysis response accepts common root and tag field casing or snake-camel aliases", () => {
  const catalog = createFixedFacetCatalog();
  assert.deepEqual(validateAnalysisTagResponse({ Tag_List: [
    { Group_ID: "style.render", groupId: "style.render", Label: "赛璐珞", detail: "赛璐珞" },
    { groupId: "light.direction", Detail: "侧逆光" }
  ] }, catalog), [
    { g: "style.render", t: "赛璐珞" },
    { g: "light.direction", t: "侧逆光" }
  ]);
  const duplicateRoot = [{ g: "style.render", t: "赛璐珞" }];
  assert.deepEqual(validateAnalysisTagResponse({ tags: duplicateRoot, Tags: structuredClone(duplicateRoot) }, catalog), duplicateRoot);
  assert.throws(() => validateAnalysisTagResponse({ tags: duplicateRoot, Tags: [{ g: "light.direction" }] }, catalog), /格式无效/);
});

test("analysis can assign a group directly and reuses normalized detail labels", () => {
  let state = { facetCatalog: createFixedFacetCatalog(), entries: [{ id: "one", facetAssignments: [] }] };
  state = applyFixedAnalysisTags(state, "one", [
    { g: "style.render" },
    { g: "style.render", t: "Ｃｅｌ—Shading" }
  ]).state;
  state.entries.push({ id: "two", facetAssignments: [] });
  state = applyFixedAnalysisTags(state, "two", [{ g: "style.render", t: "cel shading" }]).state;

  const details = state.facetCatalog.nodes.filter((item) => item.parentId === "style.render");
  assert.equal(details.length, 1);
  assert.equal(state.entries[0].facetAssignments.some((item) => item.nodeId === "style.render"), true);
  assert.equal(state.entries[0].facetAssignments.at(-1).nodeId, state.entries[1].facetAssignments[0].nodeId);
});

test("manual and visual sources cannot be downgraded by an overlapping text tag", () => {
  let state = { facetCatalog: createFixedFacetCatalog(), entries: [{ id: "one", facetAssignments: [] }] };
  state = applyFixedAnalysisTags(state, "one", [{ g: "style.render", t: "赛璐珞" }], {
    source: "vision_model", replaceExisting: false
  }).state;
  state = applyFixedAnalysisTags(state, "one", [{ g: "style.render", t: "赛璐珞" }], {
    source: "deepseek_text", replaceExisting: false
  }).state;
  assert.equal(state.entries[0].facetAssignments.length, 1);
  assert.equal(state.entries[0].facetAssignments[0].source, "vision_model");

  state = applyFixedAnalysisTags(state, "one", [{ g: "style.render", t: "赛璐珞" }], {
    source: "manual", replaceExisting: false
  }).state;
  assert.equal(state.entries[0].facetAssignments[0].source, "manual");
});

test("detail navigation hides one-offs, shows top six, and retains selected details", () => {
  let state = { facetCatalog: createFixedFacetCatalog(), entries: [] };
  for (let index = 0; index < 8; index += 1) {
    const repeats = index === 7 ? 1 : index + 2;
    for (let use = 0; use < repeats; use += 1) {
      const entry = { id: `${index}:${use}`, facetAssignments: [] };
      state.entries.push(entry);
      state = applyFixedAnalysisTags(state, entry.id, [{ g: "style.render", t: `渲染${index}` }]).state;
    }
  }
  const oneOff = state.facetCatalog.nodes.find((item) => item.name === "渲染7");
  const normal = detailNavigation(state.facetCatalog, state.entries);
  assert.equal(normal.byGroup.get("style.render").length, 6);
  assert.equal(normal.byGroup.get("style.render").some((item) => item.id === oneOff.id), false);

  const selected = detailNavigation(state.facetCatalog, state.entries, new Set([oneOff.id]));
  assert.equal(selected.byGroup.get("style.render").length, 7);
  assert.equal(selected.byGroup.get("style.render").some((item) => item.id === oneOff.id), true);
});

test("daily taxonomy prompt is byte-identical after adding ten thousand detail tags", () => {
  const catalog = createFixedFacetCatalog();
  const before = analysisTaxonomyPrompt(catalog, "zh-CN");
  const expanded = structuredClone(catalog);
  for (let index = 0; index < 10_000; index += 1) {
    expanded.nodes.push({
      id: `detail:${index}`, name: `动态标签${index}`, facetId: "style", parentId: "style.render",
      order: index, aliases: [], patterns: [], status: "active", kind: "detail", origin: "ai", fixed: false
    });
  }
  assert.equal(analysisTaxonomyPrompt(expanded, "zh-CN"), before);
});

test("detail organization stays below 16 KiB and merges only within the same group with aliases", () => {
  let state = { facetCatalog: createFixedFacetCatalog(), entries: [] };
  for (const [id, label, group] of [["a", "赛璐珞", "style.render"], ["b", "赛璐珞动画", "style.render"], ["c", "赛璐珞", "style.medium"]]) {
    state.entries.push({ id, text: `private case ${id}`, facetAssignments: [] });
    state = applyFixedAnalysisTags(state, id, [{ g: group, t: label }]).state;
  }
  const chunks = createDetailOrganizationChunks(state.facetCatalog, state.entries);
  assert.ok(chunks.every((chunk) => new TextEncoder().encode(JSON.stringify(chunk)).length <= 16 * 1024));
  assert.doesNotMatch(JSON.stringify(chunks), /private case/);

  const renderNodes = state.facetCatalog.nodes.filter((item) => item.parentId === "style.render");
  const applied = applyDetailOrganizationMappings(state, renderNodes.map((item) => ({ id: item.id, n: "赛璐珞" })));
  const activeRender = applied.state.facetCatalog.nodes.filter((item) => item.parentId === "style.render" && item.status === "active");
  const activeMedium = applied.state.facetCatalog.nodes.filter((item) => item.parentId === "style.medium" && item.status === "active");
  assert.equal(activeRender.length, 1);
  assert.ok(activeRender[0].aliases.includes("赛璐珞动画"));
  assert.equal(activeMedium.length, 1);
  assert.equal(new Set(applied.state.entries.slice(0, 2).map((entry) => entry.facetAssignments[0].nodeId)).size, 1);
  assert.notEqual(applied.state.entries[0].facetAssignments[0].nodeId, applied.state.entries[2].facetAssignments[0].nodeId);
});
