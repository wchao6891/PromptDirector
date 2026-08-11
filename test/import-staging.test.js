import test from "node:test";
import assert from "node:assert/strict";

import {
  addStagedAsset,
  collectRetainedLocalAssetIds,
  importStagingAssetIds,
  normalizeImportStagingState,
  removeStagedAsset
} from "../import-staging.js";

test("import staging persists only resumable metadata and safe relative paths", () => {
  const result = addStagedAsset({}, {
    id: "staged:one",
    assetId: "local-asset:one",
    name: "frame.png",
    relativePath: "folder/frame.png",
    kind: "image",
    mimeType: "image/png",
    byteSize: 12,
    contentHash: "a".repeat(64),
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
    mimeType: "image/png",
    byteSize: 12,
    contentHash: "a".repeat(64),
    posterAssetId: "poster:one",
    duplicateAssetId: "existing:one"
  });
  assert.equal(JSON.stringify(result.state).includes("/Users/private"), false);
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
