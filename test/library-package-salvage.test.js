import test from "node:test";
import assert from "node:assert/strict";

import { createDefaultFacetCatalog } from "../facets.js";
import { mergeLibraryPackage, parseCompleteFolderBackup, parseLibraryPackage } from "../library-package.js";
import { SCHEMA_VERSION, createDefaultTaxonomy } from "../taxonomy.js";
import { restoreTrashItems } from "../trash.js";

test("salvage mode drops one missing media file without blocking recoverable cases", () => {
  const source = packageValue([
    entry("case:missing", {
      text: "这个案例仍有可恢复的正文",
      mediaAssets: [image("image:missing")],
      primaryMediaId: "image:missing"
    }),
    entry("case:good", {
      mediaAssets: [image("image:good")],
      primaryMediaId: "image:good"
    })
  ]);
  const files = new Map([[
    "images/image-good.webp",
    new Blob(["good!"], { type: "image/webp" })
  ]]);

  const parsed = parseLibraryPackage(source, files, { salvageInvalidMedia: true });

  assert.deepEqual(parsed.entries.map((item) => item.id), ["case:missing", "case:good"]);
  assert.deepEqual(parsed.entries[0].mediaAssets, []);
  assert.equal(parsed.entries[0].primaryMediaId, "");
  assert.deepEqual(parsed.entries[1].mediaAssets.map((asset) => asset.id), ["image:good"]);
  assert.deepEqual([...parsed.assets.keys()], ["image:good"]);
  assert.equal(parsed.importStats.droppedMediaFiles, 1);
  assert.deepEqual(parsed.importDiagnostics.filter(({ code }) => code === "media_file_dropped"), [{
    code: "media_file_dropped",
    severity: "media",
    action: "dropped",
    entryId: "case:missing",
    assetId: "image:missing",
    path: "images/image-missing.webp",
    reason: "missing_file"
  }]);
});

test("salvage mode reports a media MIME mismatch without hiding the case text", () => {
  const source = packageValue([entry("case:type-mismatch", {
    mediaAssets: [image("image:type-mismatch")],
    primaryMediaId: "image:type-mismatch"
  })]);
  const files = new Map([[
    "images/image-type-mismatch.webp",
    new Blob(["wrong"], { type: "text/plain" })
  ]]);

  const parsed = parseLibraryPackage(source, files, { salvageInvalidMedia: true });

  assert.equal(parsed.entries.length, 1);
  assert.deepEqual(parsed.entries[0].mediaAssets, []);
  assert.equal(parsed.importDiagnostics.at(-1).reason, "type_mismatch");
  assert.equal(parsed.importStats.droppedMediaFiles, 1);
});

test("salvage mode treats one unsafe media descriptor as a case-local failure", () => {
  const broken = image("image:unsafe-path");
  broken.assetPath = "../images/unsafe.webp";
  const source = packageValue([entry("case:unsafe-path", {
    mediaAssets: [broken],
    primaryMediaId: broken.id
  })]);

  const parsed = parseLibraryPackage(source, new Map(), { salvageInvalidMedia: true });

  assert.equal(parsed.entries.length, 1);
  assert.deepEqual(parsed.entries[0].mediaAssets, []);
  assert.equal(parsed.importStats.droppedMediaDescriptors, 1);
  assert.equal(parsed.importDiagnostics.at(-1).code, "media_descriptor_dropped");
});

test("the import preview keeps salvage diagnostics produced before media blobs are removed from the message", () => {
  const source = packageValue([entry("case:preview", {
    mediaAssets: [image("image:preview-missing")],
    primaryMediaId: "image:preview-missing"
  })]);
  const parsed = parseLibraryPackage(source, new Map(), { salvageInvalidMedia: true });
  const importLibrary = { ...parsed };
  delete importLibrary.assets;
  delete importLibrary.images;
  delete importLibrary.skillAssets;

  const preview = mergeLibraryPackage({ entries: [] }, importLibrary, {
    preserveLibraryConfiguration: true
  });

  assert.equal(preview.importStats.droppedMediaFiles, 1);
  assert.equal(preview.importDiagnostics.filter(({ code }) => code === "media_file_dropped").length, 1);
});

test("salvage mode skips a media-only case when its last recoverable file is broken", () => {
  const source = packageValue([
    entry("case:good"),
    entry("case:media-only", {
      title: "",
      text: "",
      note: "",
      url: "",
      mediaAssets: [image("image:broken-only")],
      primaryMediaId: "image:broken-only"
    })
  ]);
  source.organizerState = {
    collections: [{
      id: "collection:test",
      name: "项目",
      order: 0,
      entryIds: ["case:good", "case:media-only"]
    }]
  };

  const parsed = parseLibraryPackage(source, new Map(), { salvageInvalidMedia: true });

  assert.deepEqual(parsed.entries.map((item) => item.id), ["case:good"]);
  assert.deepEqual(parsed.organizerState.collections[0].entryIds, ["case:good"]);
  assert.equal(parsed.importStats.inputCases, 2);
  assert.equal(parsed.importStats.keptCases, 1);
  assert.equal(parsed.importStats.skippedCases, 1);
  assert.equal(parsed.importStats.droppedMediaFiles, 1);
  assert.deepEqual(parsed.importDiagnostics.at(-1), {
    code: "case_skipped_after_media_loss",
    severity: "case",
    action: "skipped",
    entryId: "case:media-only",
    reason: "no_usable_content"
  });
});

test("complete folder backup parsing stays strict even if a caller requests ZIP media salvage", async () => {
  const source = packageValue([entry("case:strict", {
    mediaAssets: [image("image:strict-missing")],
    primaryMediaId: "image:strict-missing"
  })]);

  await assert.rejects(
    () => parseCompleteFolderBackup(source, new Map(), { salvageInvalidMedia: true }),
    /截图缺失/
  );
});

test("salvage mode removes relationships and AI labels that pointed at a dropped media file", () => {
  const source = packageValue([entry("case:relations", {
    mediaAssets: [image("image:missing-related"), image("image:kept")],
    primaryMediaId: "image:missing-related",
    mediaPrompts: [{
      assetId: "image:missing-related",
      text: "只属于坏文件的提示词",
      source: "manual",
      updatedAt: "2026-08-26T00:00:00.000Z"
    }],
    facetAssignments: [{
      facetId: "subject",
      nodeId: "subject.character",
      visualId: "image:missing-related",
      status: "confirmed",
      source: "vision_model"
    }]
  })]);
  const files = new Map([[
    "images/image-kept.webp",
    new Blob(["good!"], { type: "image/webp" })
  ]]);

  const parsed = parseLibraryPackage(source, files, { salvageInvalidMedia: true });
  const recovered = parsed.entries[0];

  assert.equal(recovered.primaryMediaId, "image:kept");
  assert.deepEqual(recovered.mediaPrompts, []);
  assert.deepEqual(recovered.facetAssignments, []);
  assert.equal(parsed.importStats.droppedAiAssignments, 1);
  assert.equal(parsed.importDiagnostics.filter(({ code }) => code === "ai_assignment_dropped").length, 1);
});

test("complete backup import drops broken AI labels before a trashed case is restored", async () => {
  const source = packageValue([]);
  const trashed = entry("case:trashed", {
    mediaAssets: [image("image:trashed")],
    primaryMediaId: "image:trashed",
    facetAssignments: [{
      facetId: "missing-facet",
      nodeId: "missing-node",
      visualId: "image:trashed",
      status: "confirmed",
      source: "vision_model"
    }]
  });
  source.trashState = {
    version: 1,
    items: [{
      id: "trash:entry:case:trashed",
      kind: "entry",
      targetId: "case:trashed",
      deletedAt: "2026-08-26T01:00:00.000Z",
      snapshot: trashed,
      relationships: { collections: [] }
    }]
  };
  const path = "images/image-trashed.webp";
  const files = new Map([[path, new Blob(["good!"], { type: "image/webp" })]]);

  const parsed = await parseCompleteFolderBackup(source, files);
  const imported = mergeLibraryPackage({ entries: [] }, parsed);
  const restored = restoreTrashItems(imported.state, ["trash:entry:case:trashed"]);

  assert.deepEqual(parsed.trashState.items[0].snapshot.facetAssignments, []);
  assert.equal(parsed.importStats.droppedAiAssignments, 1);
  assert.equal(restored.entries.length, 1);
  assert.deepEqual(restored.entries[0].facetAssignments, []);
});

test("complete backup import drops broken AI labels attached to a trashed media relationship", async () => {
  const source = packageValue([entry("case:owner")]);
  source.trashState = {
    version: 1,
    items: [{
      id: "trash:media:case:owner:image:trashed-media",
      kind: "media",
      targetId: "image:trashed-media",
      deletedAt: "2026-08-26T01:00:00.000Z",
      snapshot: { mediaAssets: [image("image:trashed-media")] },
      relationships: {
        entryId: "case:owner",
        positions: [{ id: "image:trashed-media", index: 0 }],
        primaryMediaId: "image:trashed-media",
        facetAssignments: [{
          facetId: "missing-facet",
          nodeId: "missing-node",
          visualId: "image:trashed-media",
          status: "confirmed",
          source: "vision_model"
        }]
      }
    }]
  };
  const files = new Map([[
    "images/image-trashed-media.webp",
    new Blob(["good!"], { type: "image/webp" })
  ]]);

  const parsed = await parseCompleteFolderBackup(source, files);
  const imported = mergeLibraryPackage({ entries: [] }, parsed);
  const restored = restoreTrashItems(imported.state, ["trash:media:case:owner:image:trashed-media"]);

  assert.deepEqual(parsed.trashState.items[0].relationships.facetAssignments, []);
  assert.equal(parsed.importStats.droppedAiAssignments, 1);
  assert.deepEqual(restored.entries[0].facetAssignments, []);
  assert.deepEqual(restored.entries[0].mediaAssets.map((asset) => asset.id), ["image:trashed-media"]);
});

test("legacy facet assignments migrate inside trashed cases and media before restore", async () => {
  const source = packageValue([entry("case:owner")]);
  source.facetCatalog = {
    version: 1,
    revision: 1,
    facets: [{ id: "legacy:subject", name: "主体", order: 0 }],
    nodes: [{
      id: "legacy:character",
      facetId: "legacy:subject",
      parentId: null,
      name: "人物",
      aliases: [],
      order: 0,
      status: "active"
    }]
  };
  const legacyAssignment = {
    facetId: "legacy:subject",
    nodeId: "legacy:character",
    visualId: "image:legacy",
    status: "confirmed",
    source: "vision_model"
  };
  source.trashState = {
    version: 1,
    items: [
      {
        id: "trash:entry:case:legacy",
        kind: "entry",
        targetId: "case:legacy",
        deletedAt: "2026-08-26T01:00:00.000Z",
        snapshot: entry("case:legacy", {
          mediaAssets: [image("image:legacy")],
          primaryMediaId: "image:legacy",
          facetAssignments: [legacyAssignment]
        }),
        relationships: { collections: [] }
      },
      {
        id: "trash:media:case:owner:image:legacy-media",
        kind: "media",
        targetId: "image:legacy-media",
        deletedAt: "2026-08-26T01:00:00.000Z",
        snapshot: { mediaAssets: [image("image:legacy-media")] },
        relationships: {
          entryId: "case:owner",
          positions: [{ id: "image:legacy-media", index: 0 }],
          primaryMediaId: "image:legacy-media",
          facetAssignments: [{ ...legacyAssignment, visualId: "image:legacy-media" }]
        }
      }
    ]
  };
  const files = new Map([
    ["images/image-legacy.webp", new Blob(["good!"], { type: "image/webp" })],
    ["images/image-legacy-media.webp", new Blob(["good!"], { type: "image/webp" })]
  ]);

  const parsed = await parseCompleteFolderBackup(source, files);
  const imported = mergeLibraryPackage({ entries: [] }, parsed);
  const restored = restoreTrashItems(imported.state, [
    "trash:entry:case:legacy",
    "trash:media:case:owner:image:legacy-media"
  ]);
  const restoredAssignments = restored.entries.flatMap((item) => item.facetAssignments ?? []);
  const validFacetIds = new Set(parsed.facetCatalog.facets.map((item) => item.id));
  const validNodeIds = new Set(parsed.facetCatalog.nodes.map((item) => item.id));

  assert.equal(restoredAssignments.length, 2);
  assert.equal(restoredAssignments.every((item) => validFacetIds.has(item.facetId)), true);
  assert.equal(restoredAssignments.every((item) => validNodeIds.has(item.nodeId)), true);
  assert.equal(restoredAssignments.some((item) => item.nodeId === "legacy:character"), false);
});

function packageValue(entries) {
  return {
    format: "prompt-case-library",
    version: 5,
    schemaVersion: SCHEMA_VERSION,
    settings: {},
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
    savedAt: "2026-08-26T00:00:00.000Z",
    classification: { pathIds: [], status: "needs_review", source: "auto" },
    facetAssignments: [],
    mediaAssets: [],
    primaryMediaId: "",
    ...overrides
  };
}

function image(id) {
  return {
    id,
    kind: "image",
    storageMode: "managed",
    assetPath: `images/${id.replaceAll(":", "-")}.webp`,
    sourceFormat: "webp",
    mimeType: "image/webp",
    byteSize: 5,
    capturedAt: "2026-08-26T00:00:00.000Z"
  };
}
