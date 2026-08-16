import test from "node:test";
import assert from "node:assert/strict";

import { prepareCuratedPackageVersion } from "../curated-catalog.js";
import { mergeCuratedLibraryPackage } from "../curated-import.js";
import { createDefaultFacetCatalog } from "../facets.js";
import { CONTENT_IDS, createDefaultTaxonomy } from "../taxonomy.js";

function item(version) {
  return {
    id: "featured:test",
    title: "精选测试包",
    type: "image_prompt",
    packageId: "test-pack",
    packageVersion: version,
    authorId: "editorial",
    author: "PromptDirector 编辑精选",
    license: "测试权利",
    rightsStatus: "verified_authorized",
    rightsReviewUrl: "https://wchao6891.github.io/PromptDirector-Curated/reviews/test-pack.json",
    updatedAt: "2026-08-14T00:00:00.000Z",
    coverUrl: "https://wchao6891.github.io/PromptDirector-Curated/covers/test.webp",
    previewUrl: "https://wchao6891.github.io/PromptDirector-Curated/previews/test/preview.json",
    downloadUrl: "https://github.com/wchao6891/PromptDirector-Curated/releases/download/test/test.zip",
    sha256: "a".repeat(64),
    archiveBytes: 1024,
    caseCount: 3,
    imageCount: 3,
    videoCount: 0,
    order: 1
  };
}

function sourceLibrary(ids) {
  return {
    format: "prompt-case-library",
    version: 3,
    settings: {},
    taxonomy: createDefaultTaxonomy(),
    facetCatalog: createDefaultFacetCatalog(),
    classificationRules: [],
    organizerState: { version: 6, collections: [] },
    entries: ids.map((id) => ({
      id,
      schemaVersion: 5,
      title: `案例 ${id}`,
      text: `prompt ${id}`,
      url: `https://example.com/${id}`,
      savedAt: "2026-08-14T00:00:00.000Z",
      hasScreenshot: true,
      screenshotPath: `images/${id}.webp`,
      classification: { pathIds: [CONTENT_IDS.promptImage], status: "confirmed", source: "manual" },
      facetAssignments: []
    }))
  };
}

function emptyState() {
  return {
    entries: [],
    compoundCases: [],
    settings: {},
    taxonomy: createDefaultTaxonomy(),
    facetCatalog: createDefaultFacetCatalog(),
    classificationRules: [],
    organizerState: { version: 6, collections: [] },
    composerSessions: [],
    creativeRuns: [],
    creativeSkills: { version: 1, items: [] }
  };
}

test("curated pack import creates one stable local project", () => {
  const catalogItem = { ...item("1.0.0"), caseCount: 2, imageCount: 2 };
  const library = prepareCuratedPackageVersion(sourceLibrary(["one", "two"]), catalogItem);
  const result = mergeCuratedLibraryPackage(emptyState(), library, {
    packageId: catalogItem.packageId,
    projectName: catalogItem.title,
    mode: "package"
  });
  assert.equal(result.importedCount, 2);
  assert.equal(result.existingCount, 0);
  assert.equal(result.projectId, "curated-project:test-pack");
  assert.deepEqual(result.state.organizerState.collections[0].entryIds.toSorted(), result.importedEntryIds.toSorted());
});

test("curated updates preserve personal edits and add only missing stable sources", () => {
  const firstItem = { ...item("1.0.0"), caseCount: 2, imageCount: 2 };
  const firstLibrary = prepareCuratedPackageVersion(sourceLibrary(["one", "two"]), firstItem);
  const first = mergeCuratedLibraryPackage(emptyState(), firstLibrary, {
    packageId: firstItem.packageId,
    projectName: firstItem.title,
    mode: "package"
  });
  first.state.entries.find((entry) => entry.curatedOrigin.sourceEntryId === "one").title = "我的个人修改";

  const secondItem = item("1.1.0");
  const secondLibrary = prepareCuratedPackageVersion(sourceLibrary(["one", "two", "three"]), secondItem);
  const second = mergeCuratedLibraryPackage(first.state, secondLibrary, {
    packageId: secondItem.packageId,
    projectName: secondItem.title,
    mode: "package"
  });
  assert.equal(second.importedCount, 1);
  assert.equal(second.existingCount, 2);
  assert.equal(second.state.entries.length, 3);
  assert.equal(second.state.entries.find((entry) => entry.curatedOrigin.sourceEntryId === "one").title, "我的个人修改");
  assert.equal(second.state.organizerState.collections.filter((collection) => collection.id === second.projectId).length, 1);
  assert.equal(second.state.organizerState.collections.find((collection) => collection.id === second.projectId).entryIds.length, 3);
});

test("curated imports preserve real source identities that contain namespace separators", () => {
  const catalogItem = { ...item("1.0.0"), caseCount: 1, imageCount: 1 };
  const sourceEntryId = "entry:evolink:361a86b9c18a46716be398cc";
  const source = sourceLibrary(["fixture"]);
  source.entries[0] = { ...source.entries[0], id: sourceEntryId, hasScreenshot: false, screenshotPath: "" };
  const library = prepareCuratedPackageVersion(source, catalogItem);
  const result = mergeCuratedLibraryPackage(emptyState(), library, {
    packageId: catalogItem.packageId,
    projectName: catalogItem.title,
    mode: "case"
  });
  assert.equal(result.importedCount, 1);
  assert.equal(result.entriesBySourceEntryId[sourceEntryId], result.state.entries[0].id);
});
