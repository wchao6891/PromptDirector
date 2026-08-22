import test from "node:test";
import assert from "node:assert/strict";

import {
  addStagedAsset,
  collectRetainedLocalAssetIds,
  importStagingAssetIds,
  normalizeImportStagingState,
  removeStagedAsset,
  stagedAssetMediaRecord
} from "../import-staging.js";
import { normalizeMediaAsset } from "../media.js";

test("import staging persists only resumable metadata and safe relative paths", () => {
  const result = addStagedAsset({}, {
    id: "staged:one",
    assetId: "local-asset:one",
    name: "frame.png",
    relativePath: "folder/frame.png",
    kind: "image",
    storageMode: "managed",
    mimeType: "image/png",
    byteSize: 12,
    contentHash: "a".repeat(64),
    sourceFormat: "png",
    formatCategory: "image",
    posterAssetId: "poster:one",
    duplicateAssetId: "existing:one",
    absolutePath: "/Users/private/frame.png",
    file: { private: true }
  });

  assert.deepEqual(result.asset, {
    id: "staged:one",
    assetId: "local-asset:one",
    name: "frame.png",
    relativePath: "folder/frame.png",
    kind: "image",
    storageMode: "managed",
    mimeType: "image/png",
    byteSize: 12,
    contentHash: "a".repeat(64),
    sourceFormat: "png",
    formatCategory: "image",
    posterAssetId: "poster:one",
    duplicateAssetId: "existing:one"
  });
  assert.equal(JSON.stringify(result.state).includes("/Users/private"), false);
});

test("staging preserves audio and inert linked attachment boundaries", () => {
  const state = normalizeImportStagingState({ assets: [
    {
      id: "staged:audio", assetId: "audio:one", name: "score.mp3", relativePath: "audio/score.mp3",
      kind: "audio", mimeType: "audio/mpeg", byteSize: 8, contentHash: "e".repeat(64)
    },
    {
      id: "staged:source", assetId: "attachment:one", name: "scene.aep", relativePath: "project/scene.aep",
      kind: "attachment", storageMode: "reference", mimeType: "application/x-after-effects",
      byteSize: 9, contentHash: "f".repeat(64)
    }
  ] });

  assert.equal(state.assets[0].kind, "audio");
  assert.equal(state.assets[0].formatCategory, "audio");
  assert.equal(state.assets[1].kind, "attachment");
  assert.equal(state.assets[1].storageMode, "reference");
  assert.equal(state.assets[1].formatCategory, "motion-project");
});

test("staging preserves unsupported local links without pretending their source blob was copied", () => {
  const state = normalizeImportStagingState({ assets: [{
    id: "staged:unknown",
    recordType: "local-asset-reference",
    assetId: "attachment:unknown",
    name: "custom.zzz",
    relativePath: "unrecognized/custom.zzz",
    kind: "attachment",
    storageMode: "reference",
    linkStatus: "relink-required",
    mimeType: "application/x-custom",
    byteSize: 20,
    sourceLastModified: 1_776_500_123_000,
    sourceFormat: "zzz",
    importFailure: {
      code: "unsupported_format",
      message: "暂不支持这种文件格式：custom.zzz",
      forceAllowed: false
    },
    handle: { kind: "file", getFile() {} },
    absolutePath: "/Users/private/custom.zzz"
  }] });

  assert.equal(state.assets.length, 1);
  assert.equal(state.assets[0].formatCategory, "local-link");
  assert.equal(state.assets[0].recordType, "local-asset-reference");
  assert.equal(state.assets[0].linkStatus, "relink-required");
  assert.equal(state.assets[0].importFailure.code, "unsupported_format");
  assert.equal(state.assets[0].sourceLastModified, 1_776_500_123_000);
  assert.equal(Object.hasOwn(state.assets[0], "contentHash"), false);
  assert.equal(Object.hasOwn(state.assets[0], "handle"), false);
  assert.equal(JSON.stringify(state).includes("/Users/private"), false);
});

test("unsupported local link moves from staging to a case media record without a blob fingerprint", () => {
  const staged = normalizeImportStagingState({ assets: [{
    id: "staged:unknown",
    recordType: "local-asset-reference",
    assetId: "attachment:unknown",
    name: "custom.zzz",
    relativePath: "unrecognized/custom.zzz",
    kind: "attachment",
    storageMode: "reference",
    linkStatus: "linked",
    mimeType: "application/x-custom",
    byteSize: 20,
    sourceLastModified: 1_776_500_123_000,
    sourceFormat: "zzz",
    importFailure: {
      code: "unsupported_format",
      message: "暂不支持这种文件格式：custom.zzz",
      forceAllowed: false
    }
  }] }).assets[0];
  const asset = stagedAssetMediaRecord(staged, { capturedAt: "2026-08-22T11:00:00.000Z" });
  const caseAsset = normalizeMediaAsset(asset);

  assert.equal(asset.recordType, "local-asset-reference");
  assert.equal(asset.storageMode, "reference");
  assert.equal(asset.linkStatus, "linked");
  assert.equal(asset.sourceLastModified, 1_776_500_123_000);
  assert.equal(asset.importFailure.code, "unsupported_format");
  assert.equal(Object.hasOwn(asset, "contentHash"), false);
  assert.equal(caseAsset.recordType, "local-asset-reference");
  assert.equal(caseAsset.linkStatus, "linked");
  assert.equal(caseAsset.sourceLastModified, 1_776_500_123_000);
  assert.equal(Object.hasOwn(caseAsset, "contentHash"), false);
  assert.deepEqual(removeStagedAsset({ assets: [staged] }, staged.id).removedAssetIds, []);
});

test("orphan cleanup retains assets referenced by sessions jobs cases and staging", () => {
  const retained = collectRetainedLocalAssetIds({
    entries: [{ mediaAssets: [{ id: "case:asset" }] }],
    creativeRuns: [{ outputs: [{ visual: { id: "result:asset" } }] }],
    creativeSkills: { items: [{ packageFiles: [{ assetId: "skill:asset" }] }] },
    composerSessions: [{ referenceSnapshots: [{
      sourceType: "temporary",
      assetRefs: [{ assetId: "session:asset" }]
    }] }],
    creativeJobs: { items: [{ request: { session: { referenceSnapshots: [{
      sourceType: "temporary",
      assetRefs: [{ assetId: "job:asset" }]
    }] } } }] },
    importStaging: { assets: [{
      id: "staged:one", assetId: "staged:asset", name: "one.png", relativePath: "one.png",
      kind: "image", mimeType: "image/png", byteSize: 1, contentHash: "c".repeat(64)
    }] }
  });

  assert.deepEqual([...retained].sort(), [
    "case:asset", "job:asset", "result:asset", "session:asset", "skill:asset", "staged:asset"
  ]);
});

test("removing staged metadata returns every unreferenced blob candidate", () => {
  const state = normalizeImportStagingState({ assets: [{
    id: "staged:one",
    assetId: "local-asset:one",
    name: "clip.mp4",
    relativePath: "clip.mp4",
    kind: "video",
    mimeType: "video/mp4",
    byteSize: 20,
    contentHash: "b".repeat(64),
    posterAssetId: "poster:one"
  }] });
  const result = removeStagedAsset(state, "staged:one");

  assert.deepEqual(result.removedAssetIds, ["local-asset:one", "poster:one"]);
  assert.deepEqual(importStagingAssetIds(result.state), []);
});

test("document staging preserves normalized format and parser warnings across background jobs", () => {
  const state = normalizeImportStagingState({ assets: [{
    id: "staged:rtf",
    assetId: "document:rtf",
    name: "notes.rtf",
    relativePath: "notes.rtf",
    kind: "document",
    mimeType: "application/rtf",
    byteSize: 24,
    contentHash: "d".repeat(64),
    contentText: "# 标题\n\n正文",
    contentFormat: "markdown",
    sourceFormat: "rtf",
    warnings: ["部分样式未保留", "部分样式未保留"]
  }] });
  assert.equal(state.assets[0].contentFormat, "markdown");
  assert.equal(state.assets[0].sourceFormat, "rtf");
  assert.deepEqual(state.assets[0].warnings, ["部分样式未保留"]);
});
