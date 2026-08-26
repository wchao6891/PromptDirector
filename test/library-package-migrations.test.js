import test from "node:test";
import assert from "node:assert/strict";

import { createDefaultFacetCatalog } from "../facets.js";
import { prepareLibraryPackageDraft } from "../library-package-migrations.js";
import { SCHEMA_VERSION, createDefaultTaxonomy } from "../taxonomy.js";

test("dangling AI assignments are discarded while the case and durable visual analysis survive", () => {
  const result = prepareLibraryPackageDraft(packageValue(5, [entry("case:analysis", {
    facetAssignments: [
      assignment("subject", "subject.character", "manual"),
      assignment("missing-facet", "missing-node", "vision_model", "image:analysis"),
      assignment("subject", "subject.character", "vision_model", "image:missing")
    ],
    mediaAssets: [image("image:analysis", {
      visionAnalysis: {
        version: 2,
        description: "完整画面描述",
        reconstructionPrompt: "完整反推提示词",
        quality: "complete"
      }
    })],
    primaryMediaId: "image:analysis"
  })]));

  assert.equal(result.draft.entries.length, 1);
  assert.deepEqual(result.draft.entries[0].facetAssignments.map(({ facetId, nodeId, source }) => ({ facetId, nodeId, source })), [
    { facetId: "subject", nodeId: "subject.character", source: "manual" }
  ]);
  assert.equal(result.draft.entries[0].mediaAssets[0].visionAnalysis.description, "完整画面描述");
  assert.equal(result.draft.entries[0].mediaAssets[0].visionAnalysis.reconstructionPrompt, "完整反推提示词");
  assert.equal(result.stats.droppedAiAssignments, 2);
  assert.deepEqual(result.diagnostics.map(({ code, entryId }) => ({ code, entryId })), [
    { code: "ai_assignment_dropped", entryId: "case:analysis" },
    { code: "ai_assignment_dropped", entryId: "case:analysis" }
  ]);
});

test("an unrecoverable empty case is skipped without blocking a valid case in the same package", () => {
  const result = prepareLibraryPackageDraft(packageValue(5, [
    entry("case:good"),
    entry("case:empty", { title: "", text: "", mediaAssets: [], primaryMediaId: "" })
  ]));

  assert.deepEqual(result.draft.entries.map((item) => item.id), ["case:good"]);
  assert.equal(result.stats.inputCases, 2);
  assert.equal(result.stats.keptCases, 1);
  assert.equal(result.stats.skippedCases, 1);
  assert.deepEqual(result.diagnostics.map(({ code, entryId }) => ({ code, entryId })), [
    { code: "case_skipped_no_usable_content", entryId: "case:empty" }
  ]);
});

test("a malformed media descriptor is dropped and reported without hiding the case text", () => {
  const result = prepareLibraryPackageDraft(packageValue(4, [entry("case:media", {
    mediaAssets: [{
      id: "asset:bad",
      kind: "attachment",
      storageMode: "managed",
      sourceTitle: "font.psd",
      sourceFormat: "psd",
      mimeType: "font/otf",
      byteSize: 4,
      assetPath: "attachments/case-media/font.psd"
    }],
    primaryMediaId: "asset:bad"
  })]));

  assert.equal(result.draft.entries.length, 1);
  assert.deepEqual(result.draft.entries[0].mediaAssets, []);
  assert.equal(result.draft.entries[0].text, "prompt case:media");
  assert.equal(result.stats.droppedMediaDescriptors, 1);
  assert.deepEqual(result.diagnostics.map(({ code, entryId, assetId }) => ({ code, entryId, assetId })), [{
    code: "media_descriptor_dropped",
    entryId: "case:media",
    assetId: "asset:bad"
  }]);
});

function packageValue(version, entries) {
  return {
    format: "prompt-case-library",
    version,
    schemaVersion: SCHEMA_VERSION,
    taxonomy: createDefaultTaxonomy(),
    facetCatalog: createDefaultFacetCatalog(),
    classificationRules: [],
    organizerState: { collections: [] },
    entries
  };
}

function entry(id, overrides = {}) {
  return {
    id,
    schemaVersion: SCHEMA_VERSION,
    title: id,
    text: `prompt ${id}`,
    savedAt: "2026-08-25T00:00:00.000Z",
    classification: { pathIds: [], status: "needs_review", source: "auto" },
    facetAssignments: [],
    mediaAssets: [],
    primaryMediaId: "",
    ...overrides
  };
}

function image(id, overrides = {}) {
  return {
    id,
    kind: "image",
    storageMode: "managed",
    assetPath: `images/${id.replaceAll(":", "-")}.webp`,
    sourceFormat: "webp",
    mimeType: "image/webp",
    byteSize: 5,
    ...overrides
  };
}

function assignment(facetId, nodeId, source, visualId) {
  return {
    facetId,
    nodeId,
    status: "confirmed",
    source,
    ...(visualId ? { visualId } : {})
  };
}
