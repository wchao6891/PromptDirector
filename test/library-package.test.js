import test from "node:test";
import assert from "node:assert/strict";

import {
  mergeLibraryPackage,
  parseCompleteFolderBackup,
  parseLibraryPackage,
  projectPackageEntryIds,
  selectLibraryPackage,
  selectProjectPackage
} from "../library-package.js";
import { createDefaultFacetCatalog, createFacet, createFacetNode } from "../facets.js";
import { CONTENT_IDS, CONTENT_ROLES, SCHEMA_VERSION, createContentType, createDefaultTaxonomy } from "../taxonomy.js";
import { COMPOSER_METHOD_VERSION, createComposerSession, normalizeComposerSettings } from "../composer.js";
import { createZipBlob, readZipBlob } from "../zip.js";

function packageData(entries, facetCatalog) {
  return {
    format: "prompt-case-library",
    version: 3,
    settings: { libraryTitle: "我的灵感库", outputPath: "提示词案例库/案例库.zip" },
    taxonomy: createDefaultTaxonomy(),
    facetCatalog,
    classificationRules: [{ hostname: "example.com", pathIds: [CONTENT_IDS.promptImage], enabled: true }],
    organizerState: {
      collections: [{ id: "collection:project", name: "项目", order: 0, entryIds: entries.map((item) => item.id) }]
    },
    entries
  };
}

function entry(id, nodeId = "tag:epic") {
  return {
    id,
    schemaVersion: 5,
    title: `案例 ${id}`,
    text: `prompt ${id}`,
    url: `https://example.com/${id}`,
    savedAt: "2026-07-18T10:00:00.000Z",
    hasScreenshot: true,
    screenshotPath: `images/${id}.webp`,
    classification: { pathIds: [CONTENT_IDS.promptImage], status: "confirmed", source: "manual" },
    facetAssignments: [{ facetId: "facet:mood", nodeId, status: "confirmed", source: "manual" }]
  };
}

function catalog() {
  let value = createFacet(createDefaultFacetCatalog(), { id: "facet:mood", name: "画面情绪", color: "#7755aa" });
  value = createFacetNode(value, { id: "tag:dramatic", facetId: "facet:mood", name: "戏剧性" });
  return createFacetNode(value, { id: "tag:epic", facetId: "facet:mood", parentId: "tag:dramatic", name: "史诗" });
}

test("parseLibraryPackage validates the portable library format and referenced screenshots", () => {
  const data = packageData([entry("one")], catalog());
  data.entries[0].customLabels = ["喜欢", " 喜欢 ", "待复刻"];
  data.entries[0].metadataLabels = ["AIArtWorks", " AIArtWorks ", "Vol.319"];
  const parsed = parseLibraryPackage(data, new Map([["images/one.webp", new Blob(["image"], { type: "image/webp" })]]));
  assert.equal(parsed.entries.length, 1);
  assert.equal(parsed.schemaVersion, SCHEMA_VERSION);
  assert.equal(parsed.entries[0].schemaVersion, SCHEMA_VERSION);
  assert.deepEqual(parsed.entries[0].customLabels, ["喜欢", "待复刻"]);
  assert.deepEqual(parsed.entries[0].metadataLabels, ["AIArtWorks", "Vol.319"]);
  assert.equal(parsed.images.get("one").type, "image/webp");
  assert.throws(() => parseLibraryPackage(data, new Map()), /截图缺失/);
  assert.throws(() => parseLibraryPackage({ ...data, version: "3" }, new Map()), /不是受支持/);
});

test("parseLibraryPackage rejects project trees beyond the portable package safety limit", () => {
  const data = packageData([entry("one")], catalog());
  data.organizerState.collections.push({ id: "collection:extra", name: "额外项目", entryIds: [] });
  assert.throws(() => parseLibraryPackage(data, new Map(), { maxCollections: 1 }), /项目数量超过 1 个上限/);
});

test("legacy v1 and v2 share packages preserve multiple visuals and their primary relationship", () => {
  const data = packageData([], catalog());
  data.version = 2;
  data.entries = [{
    ...entry("multi"),
    hasScreenshot: undefined,
    screenshotPath: undefined,
    visuals: [
      { id: "visual-a", screenshotPath: "images/multi/visual-a.webp" },
      { id: "visual-b", screenshotPath: "images/multi/visual-b.png" }
    ],
    primaryVisualId: "visual-b"
  }];
  const files = new Map([
    ["images/multi/visual-a.webp", new Blob(["a"], { type: "image/webp" })],
    ["images/multi/visual-b.png", new Blob(["b"], { type: "image/png" })]
  ]);
  const parsedV2 = parseLibraryPackage(data, files);
  assert.equal(parsedV2.entries[0].schemaVersion, SCHEMA_VERSION);
  assert.deepEqual(parsedV2.entries[0].mediaAssets.map((visual) => visual.id), ["visual-a", "visual-b"]);
  assert.equal(parsedV2.entries[0].primaryMediaId, "visual-b");
  assert.equal(parsedV2.images.size, 2);
  data.version = 1;
  const parsedV1 = parseLibraryPackage(data, files);
  assert.equal(parsedV1.entries[0].schemaVersion, SCHEMA_VERSION);
  assert.equal(parsedV1.entries[0].primaryMediaId, "visual-b");
});

test("every released share-package version enters the current canonical architecture", () => {
  for (const version of [1, 2, 3]) {
    const data = packageData([], catalog());
    data.version = version;
    delete data.schemaVersion;
    data.entries = [{
      ...entry(`legacy-${version}`),
      schemaVersion: 5,
      hasScreenshot: true,
      screenshotPath: `images/legacy-${version}.webp`,
      visuals: undefined,
      mediaAssets: undefined
    }];
    const parsed = parseLibraryPackage(data, new Map([[
      `images/legacy-${version}.webp`,
      new Blob([`version-${version}`], { type: "image/webp" })
    ]]));
    const imported = parsed.entries[0];
    assert.equal(parsed.schemaVersion, SCHEMA_VERSION);
    assert.equal(imported.schemaVersion, SCHEMA_VERSION);
    assert.equal(imported.mediaAssets.length, 1);
    assert.equal(imported.primaryMediaId, `legacy-${version}`);
    assert.equal(Object.prototype.propertyIsEnumerable.call(imported, "visuals"), false);
    assert.equal(Object.hasOwn(imported, "screenshotPath"), false);
    assert.doesNotMatch(JSON.stringify(imported), /"visuals"|"screenshotPath"/);
  }
});

test("v3 packages restore video documents and time notes with their media relationships", () => {
  const data = packageData([], catalog());
  data.version = 3;
  data.entries = [{
    ...entry("mixed"), hasScreenshot: undefined, screenshotPath: undefined,
    mediaAssets: [
      { id: "video-a", kind: "video", storageMode: "managed", mimeType: "video/mp4", byteSize: 5, assetPath: "videos/mixed/video-a.mp4" },
      { id: "doc-a", kind: "document", storageMode: "managed", mimeType: "application/pdf", byteSize: 3, assetPath: "documents/mixed/doc-a.pdf" }
    ],
    primaryMediaId: "video-a",
    timeNotes: [{ id: "note-a", assetId: "video-a", startMs: 1250, endMs: 2400, text: "动作加速", createdAt: "2026-08-01T10:01:00Z" }]
  }];
  const parsed = parseLibraryPackage(data, new Map([
    ["videos/mixed/video-a.mp4", new Blob(["video"], { type: "video/mp4" })],
    ["documents/mixed/doc-a.pdf", new Blob(["pdf"], { type: "application/pdf" })]
  ]));
  assert.deepEqual(parsed.entries[0].mediaAssets.map((asset) => asset.kind), ["video", "document"]);
  assert.equal(parsed.entries[0].timeNotes[0].assetId, "video-a");
  assert.equal(parsed.assets.size, 2);
  assert.equal(parsed.images.size, 0);
  assert.throws(() => parseLibraryPackage(data, new Map([
    ["videos/mixed/video-a.mp4", new Blob(["truncated"], { type: "video/mp4" })],
    ["documents/mixed/doc-a.pdf", new Blob(["pdf"], { type: "application/pdf" })]
  ])), /大小校验失败/);
});

test("v4 mixed creative-asset ZIP restores image video audio subtitle PSD and font bytes", async () => {
  const assets = [
    { id: "image", kind: "image", mimeType: "image/png", sourceFormat: "png", path: "images/mixed/image.png", bytes: "image" },
    { id: "video", kind: "video", mimeType: "video/mp4", sourceFormat: "mp4", path: "videos/mixed/video.mp4", bytes: "video" },
    { id: "audio", kind: "audio", mimeType: "audio/mpeg", sourceFormat: "mp3", path: "audio/mixed/theme.mp3", bytes: "audio" },
    { id: "subtitle", kind: "document", mimeType: "application/x-subrip", sourceFormat: "srt", path: "documents/mixed/subtitle.srt", bytes: "subtitle" },
    { id: "psd", kind: "attachment", mimeType: "image/vnd.adobe.photoshop", sourceFormat: "psd", path: "attachments/mixed/artwork.psd", bytes: "psd-source" },
    { id: "font", kind: "attachment", mimeType: "font/otf", sourceFormat: "otf", path: "attachments/mixed/typeface.otf", bytes: "font-source" }
  ];
  const data = packageData([], catalog());
  data.version = 4;
  data.entries = [{
    ...entry("mixed"),
    hasScreenshot: undefined,
    screenshotPath: undefined,
    mediaAssets: assets.map((asset) => ({
      id: asset.id,
      kind: asset.kind,
      storageMode: "managed",
      mimeType: asset.mimeType,
      sourceFormat: asset.sourceFormat,
      sourceTitle: asset.path.split("/").at(-1),
      byteSize: new Blob([asset.bytes]).size,
      assetPath: asset.path
    })),
    primaryMediaId: "image"
  }];
  const archive = await createZipBlob([
    { name: "library.json", data: JSON.stringify(data) },
    ...assets.map((asset) => ({ name: asset.path, data: new Blob([asset.bytes], { type: asset.mimeType }) }))
  ]);
  const files = await readZipBlob(archive, {
    maxArchiveBytes: archive.size,
    maxFileBytes: archive.size,
    maxImageBytes: archive.size
  });
  const parsed = parseLibraryPackage(JSON.parse(await files.get("library.json").text()), files, {
    maxArchiveBytes: archive.size,
    maxFileBytes: archive.size,
    maxImageBytes: archive.size
  });

  assert.deepEqual(parsed.entries[0].mediaAssets.map((asset) => asset.kind), [
    "image", "video", "audio", "document", "attachment", "attachment"
  ]);
  for (const asset of assets) {
    assert.equal(parsed.assets.get(asset.id)?.size, new Blob([asset.bytes]).size);
    const restored = parsed.entries[0].mediaAssets.find((item) => item.id === asset.id);
    assert.equal(restored.sourceFormat, asset.sourceFormat);
    assert.equal(restored.mimeType, asset.mimeType);
  }
  const preview = mergeLibraryPackage({
    entries: [], taxonomy: createDefaultTaxonomy(), facetCatalog: createDefaultFacetCatalog(),
    classificationRules: [], settings: {}
  }, data, { now: "2026-08-22T10:00:00.000Z", importBatchId: "mixed-zip" });
  assert.deepEqual(preview.state.entries[0].mediaAssets.map((asset) => asset.sourceFormat), [
    "png", "mp4", "mp3", "srt", "psd", "otf"
  ]);
});

test("v4 package rejects asset paths whose registered extension kind or MIME disagrees", () => {
  const data = packageData([], catalog());
  data.version = 4;
  data.entries = [{
    ...entry("mismatch"), hasScreenshot: undefined, screenshotPath: undefined,
    mediaAssets: [{
      id: "fake-psd", kind: "attachment", storageMode: "managed", sourceTitle: "fake.psd",
      sourceFormat: "psd", mimeType: "font/otf", byteSize: 4, assetPath: "attachments/mismatch/fake.psd"
    }]
  }];
  assert.throws(() => parseLibraryPackage(data, new Map([[
    "attachments/mismatch/fake.psd", new Blob(["fake"], { type: "application/octet-stream" })
  ]])), /扩展名、媒体类型和 MIME 不一致/);
});

test("v4 package restores an unknown local source only as an inert managed attachment", () => {
  const data = packageData([], catalog());
  data.version = 4;
  data.entries = [{
    ...entry("generic-source"), hasScreenshot: undefined, screenshotPath: undefined,
    mediaAssets: [{
      id: "generic", kind: "attachment", storageMode: "managed", sourceTitle: "scene.customsource",
      sourceFormat: "customsource", formatCategory: "other-source", mimeType: "application/octet-stream",
      byteSize: 6, assetPath: "attachments/generic-source/scene.customsource"
    }],
    primaryMediaId: "generic"
  }];
  const parsed = parseLibraryPackage(data, new Map([[
    "attachments/generic-source/scene.customsource", new Blob(["source"], { type: "application/octet-stream" })
  ]]));
  const restored = parsed.entries[0].mediaAssets[0];
  assert.equal(restored.kind, "attachment");
  assert.equal(restored.storageMode, "managed");
  assert.equal(restored.formatCategory, "other-source");
  assert.equal(restored.sourceFormat, "customsource");
  for (const field of ["recordType", "linkStatus", "importFailure"]) {
    assert.equal(Object.hasOwn(restored, field), false);
  }
});

test("complete folder backups restore genuine legacy RTF documents without trusting a .bin MIME type", async () => {
  const rtf = String.raw`{\rtf1\ansi PromptDirector backup}`;
  const path = "documents/rtf-case/rtf-asset.bin";
  const data = packageData([], catalog());
  data.entries = [{
    ...entry("rtf-case"), hasScreenshot: undefined, screenshotPath: undefined,
    mediaAssets: [{
      id: "rtf-asset", kind: "document", storageMode: "managed", mimeType: "application/rtf",
      byteSize: new Blob([rtf]).size, assetPath: path
    }],
    primaryMediaId: "rtf-asset"
  }];

  const parsed = await parseCompleteFolderBackup(data, new Map([[
    path,
    new Blob([rtf], { type: "application/octet-stream" })
  ]]));
  assert.equal(parsed.assets.get("rtf-asset").type, "application/rtf");

  await assert.rejects(
    () => parseCompleteFolderBackup(data, new Map([[
      path,
      new Blob(["not an RTF document"], { type: "application/octet-stream" })
    ]])),
    /来源没有返回有效文档文件/
  );
});

test("portable packages accept the explicit .rtf path used by new complete backups", () => {
  const rtf = String.raw`{\rtf1\ansi PromptDirector backup}`;
  const path = "documents/rtf-case/rtf-asset.rtf";
  const data = packageData([], catalog());
  data.entries = [{
    ...entry("rtf-case"), hasScreenshot: undefined, screenshotPath: undefined,
    mediaAssets: [{
      id: "rtf-asset", kind: "document", storageMode: "managed", mimeType: "application/rtf",
      byteSize: new Blob([rtf]).size, assetPath: path
    }],
    primaryMediaId: "rtf-asset"
  }];

  const parsed = parseLibraryPackage(data, new Map([[
    path,
    new Blob([rtf], { type: "application/rtf" })
  ]]));
  assert.equal(parsed.assets.get("rtf-asset").type, "application/rtf");
});

test("metadata-only import preview never compares declared bytes to its 11-byte placeholder", () => {
  const data = packageData([], catalog());
  data.entries = [{
    ...entry("placeholder-size"), hasScreenshot: undefined, screenshotPath: undefined,
    mediaAssets: [{
      id: "placeholder-image", kind: "image", storageMode: "managed", mimeType: "image/webp",
      byteSize: 445596, assetPath: "images/placeholder-size.webp"
    }],
    primaryMediaId: "placeholder-image"
  }];

  const preview = mergeLibraryPackage({ entries: [] }, data);
  assert.equal(preview.importedCount, 1);
  assert.equal(preview.state.entries[0].mediaAssets[0].byteSize, 445596);
});

test("imports remap visual ids that would overwrite a different local case", () => {
  const current = {
    entries: [{ ...entry("local"), visuals: [{ id: "shared-visual" }], primaryVisualId: "shared-visual" }],
    taxonomy: createDefaultTaxonomy(), facetCatalog: catalog(), classificationRules: [], settings: {}
  };
  const imported = packageData([], catalog());
  imported.version = 3;
  imported.entries = [{
    ...entry("remote"),
    hasScreenshot: undefined,
    screenshotPath: undefined,
    visuals: [{ id: "shared-visual", screenshotPath: "images/remote/shared.webp" }],
    primaryVisualId: "shared-visual",
    articleDocument: {
      version: 1,
      blocks: [
        { id: "article-copy", kind: "paragraph", text: "正文" },
        { id: "article-image", kind: "image", assetId: "shared-visual", sourceUrl: "https://example.com/original.webp" }
      ]
    },
    facetAssignments: [
      { facetId: "facet:mood", nodeId: "tag:epic", status: "confirmed", source: "manual" },
      { facetId: "facet:mood", nodeId: "tag:dramatic", status: "confirmed", source: "vision_model", visualId: "shared-visual" }
    ]
  }];
  const result = mergeLibraryPackage(current, imported);
  const remote = result.state.entries.find((item) => item.id === "remote");
  assert.notEqual(remote.primaryMediaId, "shared-visual");
  assert.equal(result.visualIdMap["shared-visual"], remote.primaryMediaId);
  assert.equal(remote.articleDocument.blocks[1].assetId, remote.primaryMediaId);
  assert.equal(
    remote.facetAssignments.find((item) => item.source === "vision_model").visualId,
    remote.primaryMediaId
  );
});

test("imports remap both sides of a video poster relationship", () => {
  const videoEntry = (id) => ({
    ...entry(id), hasScreenshot: undefined, screenshotPath: undefined,
    mediaAssets: [
      { id: "video-shared", kind: "video", storageMode: "managed", mimeType: "video/mp4", assetPath: `videos/${id}.mp4`, posterAssetId: "poster-shared" },
      { id: "poster-shared", kind: "image", usage: "poster", storageMode: "managed", mimeType: "image/webp", assetPath: `images/${id}.webp`, derivedFromAssetId: "video-shared" }
    ],
    primaryMediaId: "video-shared"
  });
  const current = {
    entries: [videoEntry("local")], taxonomy: createDefaultTaxonomy(), facetCatalog: catalog(),
    classificationRules: [], settings: {}
  };
  const imported = packageData([videoEntry("remote")], catalog());
  imported.version = 3;
  const result = mergeLibraryPackage(current, imported);
  const remote = result.state.entries.find((item) => item.id === "remote");
  const video = remote.mediaAssets.find((asset) => asset.kind === "video");
  const poster = remote.mediaAssets.find((asset) => asset.usage === "poster");
  assert.notEqual(video.id, "video-shared");
  assert.equal(video.posterAssetId, poster.id);
  assert.equal(poster.derivedFromAssetId, video.id);
});

test("parseLibraryPackage enforces case and image byte limits before storage", () => {
  const twoEntries = packageData([entry("one"), entry("two")], catalog());
  const files = new Map([
    ["images/one.webp", new Blob(["12345"], { type: "image/webp" })],
    ["images/two.webp", new Blob(["image"], { type: "image/webp" })]
  ]);
  assert.throws(
    () => parseLibraryPackage(twoEntries, files, { maxEntries: 1, maxImageBytes: 100 }),
    /案例数量超过.*上限/
  );
  assert.throws(
    () => parseLibraryPackage(packageData([entry("one")], catalog()), files, { maxEntries: 2, maxImageBytes: 4 }),
    /图片超过.*上限/
  );
});

test("empty-library import restores cases, settings, vocabulary and source rules", () => {
  const data = packageData([entry("one")], catalog());
  const result = mergeLibraryPackage({
    entries: [], taxonomy: createDefaultTaxonomy(), facetCatalog: createDefaultFacetCatalog(),
    classificationRules: [], settings: { libraryTitle: "空资料库" }
  }, data);

  assert.equal(result.importedCount, 1);
  assert.equal(result.state.entries[0].id, "one");
  assert.equal(result.state.settings.libraryTitle, "我的灵感库");
  assert.equal(result.state.facetCatalog.facets.length, 10);
  assert.equal(result.state.facetCatalog.nodes.length, 61);
  assert.equal(result.state.classificationRules.length, 1);
  assert.deepEqual(result.state.organizerState.collections[0].entryIds, ["one"]);
});

test("single curated saves preserve an empty user's library configuration", () => {
  const data = packageData([entry("curated-one")], catalog());
  data.settings = { libraryTitle: "精选案例 Vol.1", outputPath: "精选案例.zip" };
  data.classificationRules = [];
  data.organizerState = { version: 4, collections: [] };
  const current = {
    entries: [],
    taxonomy: createDefaultTaxonomy(),
    facetCatalog: createDefaultFacetCatalog(),
    classificationRules: [{ hostname: "local.example", pathIds: [CONTENT_IDS.promptImage], enabled: true }],
    organizerState: { version: 4, collections: [{ id: "collection:empty", name: "我的项目", order: 0, entryIds: [] }] },
    settings: { libraryTitle: "我的视觉灵感库", outputPath: "我的案例.zip" }
  };
  const result = mergeLibraryPackage(current, data, { preserveLibraryConfiguration: true });

  assert.equal(result.importedCount, 1);
  assert.equal(result.state.settings.libraryTitle, "我的视觉灵感库");
  assert.equal(result.state.classificationRules[0].hostname, "local.example");
  assert.deepEqual(result.state.organizerState.collections.map((item) => item.name), ["我的项目"]);
});

test("existing-library import reuses same-name vocabulary and remaps repeated case ids without merging", () => {
  const localCatalog = createFacetNode(createDefaultFacetCatalog(), {
    id: "tag:local-epic", facetId: "mood", parentId: "mood.emotion", name: "史诗"
  });
  const current = {
    entries: [entry("one")], taxonomy: createDefaultTaxonomy(), facetCatalog: localCatalog,
    classificationRules: [], settings: { libraryTitle: "接收者资料库" }
  };

  const first = mergeLibraryPackage(current, packageData([entry("one"), entry("two")], catalog()));
  assert.equal(first.importedCount, 2);
  assert.equal(first.skippedCount, 0);
  assert.equal(first.state.entries.length, 3);
  assert.equal(first.state.entries.find((item) => item.id === "two").facetAssignments[0].nodeId, "tag:local-epic");
  assert.equal(first.state.facetCatalog.facets.length, 10);
  assert.equal(first.state.settings.libraryTitle, "接收者资料库");
  assert.equal(first.state.classificationRules.length, 0);

  const repeated = mergeLibraryPackage(first.state, packageData([entry("two")], catalog()));
  assert.equal(repeated.importedCount, 1);
  assert.equal(repeated.skippedCount, 0);
  assert.equal(repeated.state.entries.length, 4);
});

test("a colliding case id imports as a new case instead of silently keeping a stale tagless copy", () => {
  const stale = entry("shared-case");
  stale.facetAssignments = [];
  const incoming = entry("shared-case");
  incoming.facetAssignments = [{
    facetId: "facet:mood",
    nodeId: "tag:epic",
    status: "confirmed",
    source: "vision_model"
  }];
  incoming.visuals = [{
    id: "shared-case",
    screenshotPath: "images/shared-case.webp",
    visionAnalysis: {
      version: 2,
      reconstructionPrompt: "保留这份完整反推提示词",
      quality: "complete",
      tags: [{ g: "mood.emotion", t: "史诗" }]
    }
  }];
  incoming.primaryVisualId = "shared-case";

  const result = mergeLibraryPackage({
    entries: [stale],
    taxonomy: createDefaultTaxonomy(),
    facetCatalog: catalog(),
    classificationRules: [],
    settings: {}
  }, packageData([incoming], catalog()));

  assert.equal(result.importedCount, 1);
  assert.equal(result.remappedCount, 1);
  assert.equal(result.skippedCount, 0);
  assert.equal(result.state.entries.length, 2);
  const restored = result.state.entries.find((item) => item.id !== "shared-case");
  assert.ok(restored);
  assert.equal(restored.mediaAssets[0].visionAnalysis.reconstructionPrompt, "保留这份完整反推提示词");
  assert.equal(restored.facetAssignments.some((item) => item.source === "vision_model"), true);
});

test("import aborts instead of silently dropping an assignment whose vocabulary node is missing", () => {
  const incoming = entry("broken-label");
  incoming.facetAssignments = [{
    facetId: "facet:mood",
    nodeId: "tag:not-in-package",
    status: "confirmed",
    source: "vision_model"
  }];
  assert.throws(() => mergeLibraryPackage({
    entries: [entry("local")],
    taxonomy: createDefaultTaxonomy(),
    facetCatalog: catalog(),
    classificationRules: [],
    settings: {}
  }, packageData([incoming], catalog())), /标签|词表|不完整/);
});

test("package import keeps source time but assigns one receiver-local added time and batch", () => {
  const source = entry("received");
  source.libraryAddedAt = "2026-07-01T00:00:00.000Z";
  source.importBatchId = "sender-batch";
  const result = mergeLibraryPackage({
    entries: [], taxonomy: createDefaultTaxonomy(), facetCatalog: catalog(),
    classificationRules: [], settings: {}
  }, packageData([source], catalog()), {
    now: "2026-08-22T08:30:00+08:00",
    importBatchId: "receiver-batch"
  });

  const received = result.state.entries[0];
  assert.equal(received.savedAt, "2026-07-18T10:00:00.000Z");
  assert.equal(received.libraryAddedAt, "2026-08-22T00:30:00.000Z");
  assert.equal(received.importBatchId, "receiver-batch");
});

test("existing-library import carries user content types and keeps imported cases connected", () => {
  const source = entry("document");
  source.classification.pathIds = ["content:work-doc"];
  const data = packageData([source], catalog());
  data.taxonomy = createContentType(createDefaultTaxonomy(), {
    id: "content:work-doc",
    name: "工作文档",
    role: CONTENT_ROLES.general
  });
  const result = mergeLibraryPackage({
    entries: [entry("local")], taxonomy: createDefaultTaxonomy(), facetCatalog: catalog(),
    classificationRules: [], settings: {}
  }, data);
  assert.equal(result.state.taxonomy.nodes.find((item) => item.id === "content:work-doc").name, "工作文档");
  assert.deepEqual(result.state.entries.find((item) => item.id === "document").classification.pathIds, ["content:work-doc"]);
});

test("selected share packages contain only chosen cases and the vocabulary they use", () => {
  let value = catalog();
  value = createFacetNode(value, { id: "tag:quiet", facetId: "facet:mood", name: "静谧" });
  const selected = selectLibraryPackage(
    { entries: [entry("one"), entry("two", "tag:quiet")], taxonomy: createDefaultTaxonomy(), facetCatalog: value, classificationRules: [] },
    ["one"]
  );

  assert.deepEqual(selected.entries.map((item) => item.id), ["one"]);
  assert.deepEqual(selected.facetCatalog.nodes.map((item) => item.id), ["tag:dramatic", "tag:epic"]);
  assert.deepEqual(selected.organizerState.collections, []);
});

test("selected share does not leak sender-local library time or import batch", () => {
  const source = entry("one");
  source.libraryAddedAt = "2026-08-21T00:00:00.000Z";
  source.importBatchId = "local-import:one";
  const selected = selectLibraryPackage({
    entries: [source], taxonomy: createDefaultTaxonomy(), facetCatalog: catalog(), classificationRules: []
  }, ["one"]);

  assert.equal(selected.entries[0].savedAt, source.savedAt);
  assert.equal("libraryAddedAt" in selected.entries[0], false);
  assert.equal("importBatchId" in selected.entries[0], false);
});

test("sharing and importing a compound case preserves all members and remaps its relationship", () => {
  const source = packageData([entry("one"), entry("two")], catalog());
  source.version = 3;
  source.compoundCases = [{
    id: "compound:story", title: "完整流程", memberEntryIds: ["one", "two"], coverVisualId: "two",
    customLabels: [], createdAt: "2026-08-01T00:00:00.000Z", updatedAt: "2026-08-01T00:00:00.000Z"
  }];
  const selected = selectLibraryPackage(source, ["compound:story"]);
  assert.deepEqual(selected.entries.map((item) => item.id), ["one", "two"]);
  assert.deepEqual(selected.compoundCases[0].memberEntryIds, ["one", "two"]);

  const imported = mergeLibraryPackage({
    entries: [entry("local")], compoundCases: [], taxonomy: createDefaultTaxonomy(),
    facetCatalog: catalog(), classificationRules: [], settings: {}
  }, source, { entryIdMap: { one: "imported-one", two: "imported-two" } });
  assert.deepEqual(imported.state.compoundCases[0].memberEntryIds, ["imported-one", "imported-two"]);
});

test("project packages include every project member and only that project relationship", () => {
  const entries = [entry("one"), entry("two"), entry("outside")];
  const source = packageData(entries, catalog());
  source.organizerState = {
    version: 2,
    collections: [
      { id: "collection:project", name: "Campaign", order: 0, entryIds: ["one", "two"] },
      { id: "collection:private", name: "Private", order: 1, entryIds: ["outside"] }
    ]
  };
  source.composerSessions = [{ id: "private-draft" }];

  const selected = selectProjectPackage(source, "collection:project");
  assert.deepEqual(selected.entries.map((item) => item.id), ["one", "two"]);
  assert.deepEqual(selected.organizerState.collections.map((item) => item.name), ["Campaign"]);
  assert.deepEqual(selected.organizerState.collections[0].entryIds, ["one", "two"]);
  assert.deepEqual(selected.composerSessions, []);

  const received = mergeLibraryPackage({
    entries: [entry("local")], taxonomy: createDefaultTaxonomy(), facetCatalog: catalog(),
    classificationRules: [], settings: {}, organizerState: { collections: [] }
  }, selected, {
    preserveLibraryConfiguration: true,
    now: "2026-08-22T09:00:00.000Z"
  });
  assert.equal(received.state.organizerState.collections[0].createdAt, "2026-08-22T09:00:00.000Z");
});

test("project packages preserve a selected project subtree and deduplicate its cases", () => {
  const source = packageData([entry("root-case"), entry("child-case"), entry("shared"), entry("outside")], catalog());
  source.organizerState = {
    version: 7,
    collections: [
      { id: "collection:root", name: "Campaign", parentId: null, order: 0, entryIds: ["root-case", "shared"] },
      { id: "collection:child", name: "References", parentId: "collection:root", order: 0, entryIds: ["child-case", "shared"] },
      { id: "collection:outside", name: "Outside", parentId: null, order: 1, entryIds: ["outside"] }
    ]
  };

  const selected = selectProjectPackage(source, "collection:root");

  assert.deepEqual(selected.entries.map((item) => item.id), ["root-case", "child-case", "shared"]);
  assert.deepEqual(selected.organizerState.collections.map((item) => ({ id: item.id, parentId: item.parentId })), [
    { id: "collection:root", parentId: null },
    { id: "collection:child", parentId: "collection:root" }
  ]);
  assert.deepEqual(selected.organizerState.collections[0].entryIds, ["root-case", "shared"]);
  assert.deepEqual(selected.organizerState.collections[1].entryIds, ["child-case", "shared"]);
});

test("project packages keep a visible compound complete in the exported project", () => {
  const source = packageData([entry("one"), entry("two"), entry("outside")], catalog());
  source.compoundCases = [{
    id: "compound:story", title: "完整流程", memberEntryIds: ["one", "two"], coverVisualId: "",
    customLabels: [], createdAt: "2026-08-01T00:00:00.000Z", updatedAt: "2026-08-01T00:00:00.000Z"
  }];
  source.organizerState = {
    version: 2,
    collections: [{ id: "collection:project", name: "Campaign", order: 0, entryIds: ["one"] }]
  };

  assert.deepEqual(projectPackageEntryIds(source, "collection:project"), ["one", "two"]);
  const selected = selectProjectPackage(source, "collection:project");
  assert.deepEqual(selected.entries.map((item) => item.id), ["one", "two"]);
  assert.deepEqual(selected.organizerState.collections[0].entryIds, ["one"]);
  assert.deepEqual(selected.compoundCases[0].memberEntryIds, ["one", "two"]);
});

test("share package keeps vision description but strips provider metadata", () => {
  const source = entry("one");
  source.visuals = [{ id: "one", screenshotPath: "images/one.webp", visionAnalysis: {
    version: 1,
    description: "A reusable scene description.",
    locale: "en",
    imageFingerprint: "private-fingerprint",
    analyzedAt: "2026-07-19T10:00:00.000Z",
    providerType: "compatible",
    model: "private-model",
    usage: { totalTokens: 99 },
    userEdited: true
  } }];
  source.primaryVisualId = "one";
  const selected = selectLibraryPackage(
    { entries: [source], taxonomy: createDefaultTaxonomy(), facetCatalog: catalog(), classificationRules: [] },
    ["one"]
  );
  assert.deepEqual(selected.entries[0].visuals[0].visionAnalysis, {
    version: 1,
    description: "A reusable scene description.",
    locale: "en",
    analyzedAt: "2026-07-19T10:00:00.000Z",
    userEdited: true
  });
});

test("v2 share packages roundtrip reconstruction prompts, inline vision tags, and persisted vision labels", () => {
  const source = entry("vision-v2");
  source.visuals = [{
    id: "vision-v2",
    screenshotPath: "images/vision-v2.webp",
    visionAnalysis: {
      version: 2,
      description: "完整画面描述",
      reconstructionPrompt: "完整反推提示词",
      quality: "complete",
      tags: [{ g: "style.render", t: "赛璐珞" }],
      locale: "zh-CN",
      analyzedAt: "2026-08-21T10:00:00.000Z"
    }
  }];
  source.primaryVisualId = "vision-v2";
  source.facetAssignments = [
    { facetId: "facet:mood", nodeId: "tag:epic", status: "confirmed", source: "manual" },
    { facetId: "facet:mood", nodeId: "tag:dramatic", status: "confirmed", source: "vision_model" }
  ];
  const selected = selectLibraryPackage(
    { entries: [source], taxonomy: createDefaultTaxonomy(), facetCatalog: catalog(), classificationRules: [] },
    ["vision-v2"]
  );
  const exported = {
    format: "prompt-case-library",
    version: 3,
    settings: { libraryTitle: "我的灵感库", outputPath: "提示词案例库/案例库.zip" },
    taxonomy: selected.taxonomy,
    facetCatalog: selected.facetCatalog,
    classificationRules: selected.classificationRules,
    organizerState: selected.organizerState,
    entries: selected.entries
  };
  const merged = mergeLibraryPackage({ entries: [] }, exported);
  const restored = merged.state.entries[0];
  const restoredVisual = restored.mediaAssets?.[0] ?? restored.visuals?.[0];

  assert.equal(restoredVisual.visionAnalysis.reconstructionPrompt, "完整反推提示词");
  assert.deepEqual(restoredVisual.visionAnalysis.tags, [{ g: "style.render", t: "赛璐珞" }]);
  assert.equal(restoredVisual.visionAnalysis.quality, "complete");
  assert.equal(restored.facetAssignments.some((item) => item.source === "vision_model"), true);
});

test("full imports merge project collections and permanently ignore legacy project methods", () => {
  const current = {
    entries: [entry("local")], taxonomy: createDefaultTaxonomy(), facetCatalog: catalog(),
    classificationRules: [], settings: { libraryTitle: "本地" },
    organizerState: { collections: [{
      id: "collection:local", name: "项目", entryIds: ["local"],
      projectMethods: { image: { targetType: "image", systemInstruction: "Local image method 【subject】", variableSlots: [{ name: "subject", description: "subject", placeholder: "【subject】" }] } }
    }] }
  };
  const imported = packageData([entry("remote")], catalog());
  imported.organizerState.collections[0].projectMethods = {
    image: { targetType: "image", systemInstruction: "Imported image method 【subject】", variableSlots: [{ name: "subject", description: "subject", placeholder: "【subject】" }] },
    video: { targetType: "video", systemInstruction: "Imported video method 【action】", variableSlots: [{ name: "action", description: "action", placeholder: "【action】" }] }
  };
  const result = mergeLibraryPackage(current, imported);
  assert.deepEqual(result.state.organizerState.collections[0].entryIds, ["local", "remote"]);
  assert.equal(Object.hasOwn(result.state.organizerState.collections[0], "projectMethods"), false);
});

test("full imports restore methods and drafts while remapping private source relations", () => {
  const source = entry("remote");
  source.creationMeta = { sourceEntryIds: ["source"], methodVersion: "1.0.0", createdAt: "2026-07-20T00:00:00.000Z" };
  const sourceCase = entry("source");
  const data = packageData([sourceCase, source], catalog());
  data.composerSettings = normalizeComposerSettings({ lastTargetPlatform: "Seedance" });
  data.composerSessions = [createComposerSession({
    id: "draft",
    referenceSnapshots: [{ entryId: "source", alias: "@参考1", referenceKind: "prompt", referenceText: sourceCase.text }]
  })];
  const result = mergeLibraryPackage({
    entries: [entry("local")], taxonomy: createDefaultTaxonomy(), facetCatalog: catalog(),
    classificationRules: [], settings: { libraryTitle: "本地" }, composerSessions: []
  }, data, { entryIdMap: { source: "remapped-source", remote: "remapped-result" } });
  assert.equal(result.state.composerSettings.methodVersion, COMPOSER_METHOD_VERSION);
  assert.equal(result.state.composerSessions[0].referenceSnapshots[0].entryId, "remapped-source");
  assert.deepEqual(result.state.entries.find((item) => item.id === "remapped-result").creationMeta.sourceEntryIds, ["remapped-source"]);
});

test("full backups parse temporary reference attachments from safe archive paths", () => {
  const data = packageData([entry("one")], catalog());
  data.composerSessions = [createComposerSession({
    id: "session:temp",
    referenceSnapshots: [{
      entryId: "temp-reference:one",
      alias: "@参考1",
      title: "本机图片",
      sourceType: "temporary",
      referenceKind: "reference",
      referenceText: "",
      imageRefs: [{ visualId: "temp-reference-asset:one", mimeType: "image/webp" }],
      assetRefs: [{
        assetId: "temp-reference-asset:one",
        kind: "image",
        mimeType: "image/webp",
        name: "lighting.webp",
        byteSize: 8,
        archivePath: "temp-references/session-one/lighting.webp"
      }]
    }]
  })];

  const parsed = parseLibraryPackage(data, new Map([
    ["images/one.webp", new Blob(["image"], { type: "image/webp" })],
    ["temp-references/session-one/lighting.webp", new Blob(["lighting"], { type: "image/webp" })]
  ]));

  const snapshot = parsed.composerSessions[0].referenceSnapshots[0];
  assert.equal(snapshot.assetRefs[0].archivePath, "temp-references/session-one/lighting.webp");
  assert.equal(parsed.assets.get("temp-reference-asset:one")?.size, 8);
  assert.equal(parsed.images.get("temp-reference-asset:one")?.size, 8);
});

test("temporary reference attachments reject missing blobs and dangerous archive paths", () => {
  const data = packageData([entry("one")], catalog());
  const withReference = (archivePath) => {
    data.composerSessions = [createComposerSession({
      id: "session:temp",
      referenceSnapshots: [{
        entryId: "temp-reference:one",
        alias: "@参考1",
        title: "本机文档",
        sourceType: "temporary",
        referenceKind: "reference",
        referenceText: "",
        assetRefs: [{
          assetId: "temp-reference-asset:one",
          kind: "document",
          mimeType: "text/plain",
          name: "notes.txt",
          byteSize: 5,
          archivePath
        }]
      }]
    })];
    return structuredClone(data);
  };

  assert.throws(() => parseLibraryPackage(
    withReference("temp-references/session-one/notes.txt"),
    new Map([["images/one.webp", new Blob(["image"], { type: "image/webp" })]])
  ), /临时附件缺失或类型不符/);

  assert.throws(() => parseLibraryPackage(
    withReference("../private/notes.txt"),
    new Map([
      ["images/one.webp", new Blob(["image"], { type: "image/webp" })],
      ["../private/notes.txt", new Blob(["notes"], { type: "text/plain" })]
    ])
  ), /临时附件路径无效/);
});

test("temporary reference asset collisions remap both assetRefs and imageRefs during import", () => {
  const current = {
    entries: [entry("local")],
    taxonomy: createDefaultTaxonomy(),
    facetCatalog: catalog(),
    classificationRules: [],
    settings: {},
    composerSessions: [createComposerSession({
      id: "session:local",
      referenceSnapshots: [{
        entryId: "temp-reference:local",
        alias: "@参考1",
        title: "本机图片",
        sourceType: "temporary",
        referenceKind: "reference",
        referenceText: "",
        imageRefs: [{ visualId: "temp-reference-asset:shared", mimeType: "image/webp" }],
        assetRefs: [{
          assetId: "temp-reference-asset:shared",
          kind: "image",
          mimeType: "image/webp",
          name: "local.webp",
          byteSize: 5,
          archivePath: "temp-references/session-local/local.webp"
        }]
      }]
    })]
  };
  const imported = packageData([entry("remote")], catalog());
  imported.composerSessions = [createComposerSession({
    id: "session:remote",
    referenceSnapshots: [{
      entryId: "temp-reference:remote",
      alias: "@参考1",
      title: "导入图片",
      sourceType: "temporary",
      referenceKind: "reference",
      referenceText: "",
      imageRefs: [{ visualId: "temp-reference-asset:shared", mimeType: "image/webp" }],
        assetRefs: [{
          assetId: "temp-reference-asset:shared",
          kind: "image",
          mimeType: "image/webp",
          name: "remote.webp",
          byteSize: 6,
          archivePath: "temp-references/session-remote/remote.webp"
        }]
      }]
    })];

  const result = mergeLibraryPackage(current, imported);
  const importedSession = result.state.composerSessions.find((session) => session.id === "session:remote");
  const importedReference = importedSession.referenceSnapshots[0];
  const remappedAssetId = result.visualIdMap["temp-reference-asset:shared"];

  assert.notEqual(remappedAssetId, "temp-reference-asset:shared");
  assert.equal(importedReference.assetRefs[0].assetId, remappedAssetId);
  assert.equal(importedReference.imageRefs[0].visualId, remappedAssetId);
  assert.equal(current.composerSessions[0].referenceSnapshots[0].assetRefs[0].assetId, "temp-reference-asset:shared");
});

test("selected shares remove drafts, methods, and private source IDs", () => {
  const source = entry("one");
  source.creationMeta = { sourceEntryIds: ["private-source"], methodVersion: "1.0.0", targetPlatform: "General", outputLanguage: "en", createdAt: "2026-07-20T00:00:00.000Z" };
  const selected = selectLibraryPackage({
    entries: [source], taxonomy: createDefaultTaxonomy(), facetCatalog: catalog(), classificationRules: [],
    composerSettings: normalizeComposerSettings(), composerSessions: [{ id: "private-draft" }]
  }, ["one"]);
  assert.equal(selected.composerSettings, undefined);
  assert.deepEqual(selected.composerSessions, []);
  assert.equal(Object.hasOwn(selected.entries[0].creationMeta, "sourceEntryIds"), false);
});

test("selected shares still exclude composer sessions even when temporary attachments exist", () => {
  const source = entry("one");
  const selected = selectLibraryPackage({
    entries: [source],
    taxonomy: createDefaultTaxonomy(),
    facetCatalog: catalog(),
    classificationRules: [],
    composerSessions: [createComposerSession({
      id: "session:temp",
      referenceSnapshots: [{
        entryId: "temp-reference:one",
        alias: "@参考1",
        title: "临时附件",
        sourceType: "temporary",
        referenceKind: "reference",
        referenceText: "",
        imageRefs: [{ visualId: "temp-reference-asset:one", mimeType: "image/webp" }],
        assetRefs: [{
          assetId: "temp-reference-asset:one",
          kind: "image",
          mimeType: "image/webp",
          name: "lighting.webp",
          byteSize: 8,
          archivePath: "temp-references/session-one/lighting.webp"
        }]
      }]
    })]
  }, ["one"]);

  assert.deepEqual(selected.composerSessions, []);
});

test("full backups restore creative runs while selected shares exclude private result evidence", () => {
  const data = packageData([entry("one")], catalog());
  data.composerSessions = [createComposerSession({
    id: "session:one",
    messages: [{ role: "user", content: "生成电影海报" }],
    promptVersions: [{
      id: "prompt:one",
      text: "cinematic poster",
      createdAt: "2026-07-24T10:00:00.000Z"
    }]
  })];
  data.creativeExperimentSettings = { enabled: true, autoAnalyze: true };
  data.creativeRuns = [{
    id: "run:one",
    version: 1,
    sessionId: "session:one",
    promptVersionId: "prompt:one",
    targetType: "image",
    promptText: "cinematic poster",
    createdAt: "2026-07-24T10:05:00.000Z",
    updatedAt: "2026-07-24T10:05:00.000Z",
    outputs: [{
      visual: {
        id: "result:one",
        capturedAt: "2026-07-24T10:05:00.000Z",
        screenshotPath: "creative-results/run-one/result-one.webp"
      },
      capturedAt: "2026-07-24T10:05:00.000Z",
      signals: [{ type: "captured", at: "2026-07-24T10:05:00.000Z" }]
    }]
  }];

  const parsed = parseLibraryPackage(data, new Map([
    ["images/one.webp", new Blob(["case"], { type: "image/webp" })],
    ["creative-results/run-one/result-one.webp", new Blob(["result"], { type: "image/webp" })]
  ]));
  assert.equal(parsed.assets.get("result:one")?.size, 6);

  const restored = mergeLibraryPackage({
    entries: [],
    taxonomy: createDefaultTaxonomy(),
    facetCatalog: createDefaultFacetCatalog(),
    classificationRules: [],
    settings: {}
  }, data);
  assert.equal(restored.state.creativeRuns.length, 1);
  assert.equal(restored.state.creativeRuns[0].outputs[0].visual.id, "result:one");
  assert.equal(restored.state.creativeRuns[0].outputs[0].visual.screenshotPath, undefined);
  assert.deepEqual(restored.state.creativeExperimentSettings, { enabled: true, autoAnalyze: true });

  const shared = selectLibraryPackage(data, ["one"]);
  assert.deepEqual(shared.creativeRuns, []);
  assert.equal(shared.creativeExperimentSettings, undefined);
});

test("full backups restore video creative evidence with frozen Skills and judgments", () => {
  const data = packageData([entry("one")], catalog());
  data.composerSessions = [createComposerSession({
    id: "session:video",
    targetType: "video",
    messages: [{ role: "user", content: "生成短片" }],
    promptVersions: [{ id: "prompt:video", text: "cinematic clip", createdAt: "2026-08-08T10:00:00.000Z" }]
  })];
  data.creativeRuns = [{
    id: "run:video",
    sessionId: "session:video",
    promptVersionId: "prompt:video",
    targetType: "video",
    promptText: "cinematic clip",
    appliedSkills: [{
      skillId: "skill:one", versionId: "skill-version:one", callName: "clip-method", portableId: "clip-method",
      description: "Clip method", skillMarkdown: "# Clip method", references: [], source: "generated", textMode: true
    }],
    createdAt: "2026-08-08T10:01:00.000Z",
    updatedAt: "2026-08-08T10:01:00.000Z",
    outputs: [{
      visual: {
        id: "result:video", kind: "video", storageMode: "managed", mimeType: "video/mp4", byteSize: 5,
        capturedAt: "2026-08-08T10:01:00.000Z", assetPath: "creative-results/run-video/result-video.mp4"
      },
      capturedAt: "2026-08-08T10:01:00.000Z",
      signals: [{ type: "captured", at: "2026-08-08T10:01:00.000Z" }],
      judgment: { keep: "保留运动节奏", improve: "减少镜头抖动", updatedAt: "2026-08-08T10:02:00.000Z" }
    }]
  }];
  const parsed = parseLibraryPackage(data, new Map([
    ["images/one.webp", new Blob(["case"], { type: "image/webp" })],
    ["creative-results/run-video/result-video.mp4", new Blob(["video"], { type: "video/mp4" })]
  ]));
  assert.equal(parsed.assets.get("result:video").type, "video/mp4");
  assert.equal(parsed.images.has("result:video"), false);
  assert.equal(parsed.creativeRuns[0].appliedSkills[0].versionId, "skill-version:one");
  assert.equal(parsed.creativeRuns[0].outputs[0].judgment.improve, "减少镜头抖动");
});

test("full backups restore external Skill files while case shares exclude every Skill", () => {
  const data = packageData([entry("one")], catalog());
  data.creativeSkills = {
    version: 1,
    items: [{
      id: "skill:one",
      callName: "广告大片",
      portableId: "advertising-blockbuster",
      description: "广告视觉方法",
      currentVersionId: "skill-version:one",
      versions: [{
        id: "skill-version:one",
        createdAt: "2026-08-06T00:00:00.000Z",
        reason: "imported",
        source: "imported",
        skillMarkdown: "# 广告大片\n\n保持品牌主体清晰。",
        references: [],
        provenanceMarkdown: ""
      }],
      packageFiles: [{
        path: "external/SKILL.md",
        assetId: "skill-file:one",
        byteSize: 11,
        mimeType: "text/markdown",
        archivePath: "skills/advertising-blockbuster/skill-file-one/external/SKILL.md"
      }],
      textModeConfirmed: false,
      runtimeDependencies: [],
      createdAt: "2026-08-06T00:00:00.000Z",
      updatedAt: "2026-08-06T00:00:00.000Z"
    }]
  };
  const files = new Map([
    ["images/one.webp", new Blob(["image"], { type: "image/webp" })],
    ["skills/advertising-blockbuster/skill-file-one/external/SKILL.md", new Blob(["skill bytes"], { type: "text/markdown" })]
  ]);
  const parsed = parseLibraryPackage(data, files);
  assert.equal(parsed.skillAssets.get("skill-file:one")?.size, 11);
  const restored = mergeLibraryPackage({
    entries: [], taxonomy: createDefaultTaxonomy(), facetCatalog: createDefaultFacetCatalog(),
    classificationRules: [], settings: {}, creativeSkills: { version: 1, items: [] }
  }, data);
  assert.equal(restored.state.creativeSkills.items[0].callName, "广告大片");
  assert.equal(restored.packageAssetIdMap["skill-file:one"], "skill-file:one");
  assert.equal(restored.state.creativeSkills.items[0].packageFiles[0].archivePath, undefined);

  const shared = selectLibraryPackage(data, ["one"]);
  assert.deepEqual(shared.creativeSkills, { version: 1, items: [] });
});
