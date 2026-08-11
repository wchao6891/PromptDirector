import test from "node:test";
import assert from "node:assert/strict";

import {
  applyCuratedOrigin,
  curatedSourceKey,
  normalizeCuratedCatalog,
  prepareCuratedEntriesPackage,
  prepareCuratedEntryPackage,
  prepareCuratedPackageVersion,
  validateCuratedPackageContents
} from "../curated-catalog.js";

function catalogItem(overrides = {}) {
  return {
    id: "feature:cinematic",
    title: "电影感构图精选",
    type: "image_prompt",
    packageId: "cinematic-foundations",
    packageVersion: "1.0.0",
    author: "PromptDirector Editorial",
    license: "CC BY 4.0",
    updatedAt: "2026-07-29T00:00:00.000Z",
    coverUrl: "https://wchao6891.github.io/PromptDirector-Curated/covers/cinematic.webp",
    downloadUrl: "https://github.com/wchao6891/PromptDirector-Curated/releases/download/cinematic-1.0.0/cinematic.zip",
    sha256: "a".repeat(64),
    caseCount: 2,
    imageCount: 2,
    videoCount: 0,
    order: 1,
    ...overrides
  };
}

test("curated catalogs expose ordered themes with trusted package assets", () => {
  const catalog = normalizeCuratedCatalog({
    format: "prompt-director-curated",
    version: 2,
    updatedAt: "2026-07-29T00:00:00.000Z",
    themes: [catalogItem({ id: "feature:second", order: 2, packageId: "second-package" }), catalogItem()]
  });
  assert.deepEqual(catalog.themes.map((theme) => theme.order), [1, 2]);
  assert.equal(catalog.themes[0].packageId, "cinematic-foundations");
  assert.throws(() => normalizeCuratedCatalog({
    format: "prompt-director-curated",
    version: 2,
    themes: [catalogItem({ coverUrl: "https://attacker.example/cover.webp" })]
  }), /不受信任/);
  assert.throws(() => normalizeCuratedCatalog({
    format: "prompt-director-curated",
    version: 2,
    themes: [catalogItem({ sha256: "not-a-checksum" })]
  }), /校验值/);
  assert.throws(() => normalizeCuratedCatalog({
    format: "prompt-director-curated",
    version: 1,
    items: [catalogItem()]
  }), /目录版本过旧/);
});

test("installing a curated package records provenance without retaining service or private metadata", () => {
  const item = catalogItem();
  const entry = applyCuratedOrigin({
    id: "case:one",
    title: "Case",
    url: "https://source.example",
    creationMeta: { sourceEntryIds: ["private"] }
  }, item, "2026-07-29T01:00:00.000Z");
  assert.deepEqual(entry.curatedOrigin, {
    catalogId: item.id,
    packageId: item.packageId,
    packageVersion: item.packageVersion,
    author: item.author,
    license: item.license,
    sourceEntryId: "case:one",
    installedAt: "2026-07-29T01:00:00.000Z"
  });
  assert.equal(JSON.stringify(entry.curatedOrigin).includes("private"), false);
});

test("each curated package version uses deterministic local ids so updates never overwrite edited copies", () => {
  const item = catalogItem();
  const library = {
    entries: [{
      id: "original",
      visuals: [{ id: "visual-one", screenshotPath: "images/one.webp" }],
      primaryVisualId: "visual-one"
    }],
    organizerState: {
      collections: [{ id: "collection:one", name: "精选", order: 0, entryIds: ["original"] }]
    }
  };
  const first = prepareCuratedPackageVersion(library, item);
  const repeated = prepareCuratedPackageVersion(library, item);
  const updated = prepareCuratedPackageVersion(library, catalogItem({ packageVersion: "1.1.0" }));

  assert.equal(first.entries[0].id, repeated.entries[0].id);
  assert.notEqual(first.entries[0].id, updated.entries[0].id);
  assert.equal(curatedSourceKey(first.entries[0]), curatedSourceKey(updated.entries[0]));
  assert.equal(first.organizerState.collections[0].entryIds[0], first.entries[0].id);
  assert.equal(first.entries[0].primaryVisualId, first.entries[0].visuals[0].id);
});

test("legacy version-scoped curated ids resolve to the same stable source identity", () => {
  const legacy = {
    id: "curated:cinematic-foundations:1.0.0:entry:original",
    curatedOrigin: { packageId: "cinematic-foundations", packageVersion: "1.0.0" }
  };
  const current = prepareCuratedPackageVersion({ entries: [{ id: "original", mediaAssets: [] }] }, catalogItem({ packageVersion: "1.1.0" })).entries[0];

  assert.equal(curatedSourceKey(legacy), curatedSourceKey(current));
});

test("current media assets receive package-scoped ids together with their relationships", () => {
  const prepared = prepareCuratedPackageVersion({
    entries: [{
      id: "current-entry",
      mediaAssets: [
        { id: "image-one", kind: "image", assetPath: "images/one.webp" },
        { id: "image-two", kind: "image", assetPath: "images/two.webp", derivedFromAssetId: "image-one" }
      ],
      primaryMediaId: "image-two",
      timeNotes: [{ id: "note-one", assetId: "image-two", frameAssetId: "image-one" }],
      facetAssignments: [{ facetId: "facet:one", nodeId: "node:one", visualId: "image-two" }]
    }]
  }, catalogItem());
  const entry = prepared.entries[0];

  assert.match(entry.mediaAssets[0].id, /^curated:cinematic-foundations:1\.0\.0:visual:/);
  assert.equal(entry.primaryMediaId, entry.mediaAssets[1].id);
  assert.equal(entry.mediaAssets[1].derivedFromAssetId, entry.mediaAssets[0].id);
  assert.equal(entry.timeNotes[0].assetId, entry.mediaAssets[1].id);
  assert.equal(entry.timeNotes[0].frameAssetId, entry.mediaAssets[0].id);
  assert.equal(entry.facetAssignments[0].visualId, entry.mediaAssets[1].id);
  assert.equal("visuals" in entry, false);
});

test("saving from the curated gallery produces exactly one reviewed local case", () => {
  const item = catalogItem();
  const prepared = prepareCuratedPackageVersion({
    entries: [
      { id: "one", title: "案例一", mediaAssets: [], primaryMediaId: "" },
      { id: "two", title: "案例二", mediaAssets: [], primaryMediaId: "" }
    ]
  }, item);
  const targetId = prepared.entries[1].id;
  const selected = prepareCuratedEntryPackage(prepared, targetId);

  assert.deepEqual(selected.entries.map((entry) => entry.title), ["案例二"]);
  assert.equal(selected.entries[0].curatedOrigin.packageId, item.packageId);
  assert.deepEqual(selected.organizerState.collections, []);
  assert.throws(() => prepareCuratedEntryPackage(prepared, "missing"), /请先选择|无法作为单个/);
});

test("theme saves select a deterministic batch while preserving its collection", () => {
  const prepared = prepareCuratedPackageVersion({
    entries: [
      { id: "one", title: "案例一", mediaAssets: [], primaryMediaId: "" },
      { id: "two", title: "案例二", mediaAssets: [], primaryMediaId: "" },
      { id: "three", title: "案例三", mediaAssets: [], primaryMediaId: "" }
    ],
    organizerState: {
      collections: [{ id: "theme", name: "主题", order: 0, entryIds: ["one", "two", "three"] }]
    }
  }, catalogItem());
  const selected = prepareCuratedEntriesPackage(prepared, prepared.entries.slice(0, 2).map((entry) => entry.id));

  assert.deepEqual(selected.entries.map((entry) => entry.title), ["案例一", "案例二"]);
  assert.deepEqual(selected.organizerState.collections[0].entryIds, selected.entries.map((entry) => entry.id));
});

test("a curated package must match the reviewed catalog counts", () => {
  const item = catalogItem({ imageCount: 1 });
  assert.doesNotThrow(() => validateCuratedPackageContents(item, {
    entries: [{ id: "one" }, { id: "two" }],
    images: new Map([["one", new Blob(["image"])]]),
  }));
  assert.throws(() => validateCuratedPackageContents(item, {
    entries: [{ id: "one" }],
    images: new Map([["one", new Blob(["image"])]]),
  }), /案例数量与目录不一致/);
});

test("a curated mixed-media package must match its reviewed video count", () => {
  const item = catalogItem({ imageCount: 2, videoCount: 1 });
  const parsed = {
    entries: [{ id: "image" }, { id: "video" }],
    images: new Map([
      ["image", new Blob(["image"], { type: "image/webp" })],
      ["poster", new Blob(["poster"], { type: "image/webp" })]
    ]),
    assets: new Map([
      ["image", new Blob(["image"], { type: "image/webp" })],
      ["poster", new Blob(["poster"], { type: "image/webp" })],
      ["video", new Blob(["video"], { type: "video/mp4" })]
    ])
  };

  assert.doesNotThrow(() => validateCuratedPackageContents(item, parsed));
  assert.throws(() => validateCuratedPackageContents(item, {
    ...parsed,
    assets: new Map([...parsed.assets].filter(([id]) => id !== "video"))
  }), /视频数量与目录不一致/);
});
