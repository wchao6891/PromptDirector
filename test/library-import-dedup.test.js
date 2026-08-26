import test from "node:test";
import assert from "node:assert/strict";

import { mergeLibraryPackage } from "../library-package.js";
import { createDefaultFacetCatalog } from "../facets.js";
import { CONTENT_IDS, createDefaultTaxonomy } from "../taxonomy.js";

function portablePackage(entries) {
  return {
    format: "prompt-case-library",
    version: 5,
    schemaVersion: 28,
    settings: {},
    taxonomy: createDefaultTaxonomy(),
    facetCatalog: createDefaultFacetCatalog(),
    classificationRules: [],
    organizerState: { version: 1, collections: [] },
    compoundCases: [],
    entries
  };
}

function portableEntry(id, overrides = {}) {
  return {
    id,
    schemaVersion: 28,
    title: "同一个案例",
    text: "保留这段创作提示词",
    url: "https://example.com/source-case",
    savedAt: "2026-08-20T10:00:00.000Z",
    classification: {
      pathIds: [CONTENT_IDS.promptText],
      status: "confirmed",
      source: "manual"
    },
    customLabels: ["保留"],
    metadataLabels: ["来源标签"],
    facetAssignments: [],
    mediaAssets: [],
    primaryMediaId: "",
    ...overrides
  };
}

function portableImageEntry(id, contentHash = "a".repeat(64)) {
  return portableEntry(id, {
    mediaAssets: [{
      id: `${id}-image`,
      kind: "image",
      usage: "content",
      storageMode: "managed",
      mimeType: "image/webp",
      sourceFormat: "webp",
      contentHash,
      byteSize: 12,
      assetPath: `images/${id}/${id}-image.webp`,
      capturedAt: "2026-08-20T10:00:00.000Z",
      reviewStatus: "verified"
    }],
    primaryMediaId: `${id}-image`
  });
}

function emptyLibrary() {
  return {
    entries: [],
    taxonomy: createDefaultTaxonomy(),
    facetCatalog: createDefaultFacetCatalog(),
    classificationRules: [],
    organizerState: { version: 1, collections: [] },
    compoundCases: [],
    settings: {}
  };
}

test("reimporting the same source with identical persistent meaning skips the duplicate", () => {
  const source = portablePackage([portableEntry("source-entry")]);
  const first = mergeLibraryPackage(emptyLibrary(), source, {
    now: "2026-08-25T10:00:00.000Z",
    importBatchId: "first-import"
  });

  const second = mergeLibraryPackage(first.state, source, {
    now: "2026-08-26T10:00:00.000Z",
    importBatchId: "second-import"
  });

  assert.equal(second.state.entries.length, 1);
  assert.equal(second.importedCount, 0);
  assert.equal(second.skippedCount, 1);
  assert.equal(second.remappedCount, 0);
  assert.equal(second.entryIdMap["source-entry"], "source-entry");
  assert.deepEqual(second.createdEntryIds, []);
  assert.deepEqual(second.createdVisualIdMap, {});
});

test("reimporting the same source with changed persistent meaning keeps a new copy", () => {
  const original = portablePackage([portableEntry("source-entry")]);
  const first = mergeLibraryPackage(emptyLibrary(), original, {
    now: "2026-08-25T10:00:00.000Z",
    importBatchId: "first-import"
  });
  const changed = portablePackage([portableEntry("source-entry", {
    text: "这是同一来源后来修改过的创作提示词"
  })]);

  const second = mergeLibraryPackage(first.state, changed, {
    now: "2026-08-26T10:00:00.000Z",
    importBatchId: "changed-import"
  });

  assert.equal(second.state.entries.length, 2);
  assert.equal(second.importedCount, 1);
  assert.equal(second.skippedCount, 0);
  assert.equal(second.remappedCount, 1);
  assert.notEqual(second.entryIdMap["source-entry"], "source-entry");
});

test("reimporting an already remapped source version reuses that copy instead of creating a third", () => {
  const original = portablePackage([portableEntry("source-entry")]);
  const first = mergeLibraryPackage(emptyLibrary(), original, {
    now: "2026-08-24T10:00:00.000Z",
    importBatchId: "original-import"
  });
  const changed = portablePackage([portableEntry("source-entry", {
    text: "同一来源的第二个持久版本"
  })]);
  const second = mergeLibraryPackage(first.state, changed, {
    now: "2026-08-25T10:00:00.000Z",
    importBatchId: "changed-import"
  });

  const third = mergeLibraryPackage(second.state, changed, {
    now: "2026-08-26T10:00:00.000Z",
    importBatchId: "repeat-changed-import"
  });

  assert.equal(third.state.entries.length, 2);
  assert.equal(third.importedCount, 0);
  assert.equal(third.skippedCount, 1);
  assert.equal(third.entryIdMap["source-entry"], second.entryIdMap["source-entry"]);
});

test("different source identities remain separate even when their content is identical", () => {
  const first = mergeLibraryPackage(emptyLibrary(), portablePackage([
    portableEntry("source-a")
  ]));
  const second = mergeLibraryPackage(first.state, portablePackage([
    portableEntry("source-b")
  ]));

  assert.equal(second.state.entries.length, 2);
  assert.equal(second.importedCount, 1);
  assert.equal(second.skippedCount, 0);
  assert.equal(second.entryIdMap["source-b"], "source-b");
});

test("identical managed media is reused by content hash even though archive paths are receiver-local", () => {
  const source = portablePackage([portableImageEntry("source-image")]);
  const first = mergeLibraryPackage(emptyLibrary(), source);
  const second = mergeLibraryPackage(first.state, source);

  assert.equal(second.state.entries.length, 1);
  assert.equal(second.importedCount, 0);
  assert.equal(second.skippedCount, 1);
  assert.equal(second.visualIdMap["source-image-image"], "source-image-image");
  assert.deepEqual(second.createdVisualIdMap, {});
});

test("a changed managed-media content hash keeps a new version of the same source", () => {
  const first = mergeLibraryPackage(emptyLibrary(), portablePackage([
    portableImageEntry("source-image", "a".repeat(64))
  ]));
  const second = mergeLibraryPackage(first.state, portablePackage([
    portableImageEntry("source-image", "b".repeat(64))
  ]));

  assert.equal(second.state.entries.length, 2);
  assert.equal(second.importedCount, 1);
  assert.equal(second.skippedCount, 0);
  assert.equal(second.remappedCount, 1);
});

test("an already remapped media version is skipped when the same source is imported again", () => {
  const original = portablePackage([portableImageEntry("source-image", "a".repeat(64))]);
  const changed = portablePackage([portableImageEntry("source-image", "b".repeat(64))]);
  const first = mergeLibraryPackage(emptyLibrary(), original);
  const second = mergeLibraryPackage(first.state, changed);
  const third = mergeLibraryPackage(second.state, changed);

  assert.equal(third.state.entries.length, 2);
  assert.equal(third.importedCount, 0);
  assert.equal(third.skippedCount, 1);
  assert.equal(
    third.visualIdMap["source-image-image"],
    second.visualIdMap["source-image-image"]
  );
});

test("managed media without a reliable content hash is preserved as a copy", () => {
  const entryWithoutHash = portableImageEntry("source-image");
  delete entryWithoutHash.mediaAssets[0].contentHash;
  const source = portablePackage([entryWithoutHash]);
  const first = mergeLibraryPackage(emptyLibrary(), source);
  const second = mergeLibraryPackage(first.state, source);

  assert.equal(second.state.entries.length, 2);
  assert.equal(second.importedCount, 1);
  assert.equal(second.skippedCount, 0);
});
