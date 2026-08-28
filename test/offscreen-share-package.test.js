import test from "node:test";
import assert from "node:assert/strict";

import {
  portableManagedAsset,
  readLinkedAssetForShare
} from "../offscreen.js";
import { resolvePortableAssetFormat } from "../asset-formats.js";

const linkedAsset = Object.freeze({
  id: "source:psd",
  recordType: "local-asset-reference",
  kind: "attachment",
  storageMode: "reference",
  linkStatus: "ready",
  importFailure: { code: "unsupported_format", message: "旧机器状态" },
  sourceTitle: "artwork.psd",
  sourceFormat: "psd",
  mimeType: "image/vnd.adobe.photoshop",
  byteSize: 3,
  sourceLastModified: 42
});

test("share export reads a ready local source without requesting permission itself", async () => {
  const file = new Blob(["psd"], { type: "image/vnd.adobe.photoshop" });
  const calls = [];
  const result = await readLinkedAssetForShare(linkedAsset, "Key art", {
    getLocalAssetHandleRecord: async (assetId) => {
      calls.push(["record", assetId]);
      return { assetId, handle: {} };
    },
    inspectStoredLocalAsset: async (assetId) => {
      calls.push(["inspect", assetId]);
      return { status: "ready", permission: "granted", file };
    }
  });

  assert.equal(result, file);
  assert.deepEqual(calls, [["record", "source:psd"], ["inspect", "source:psd"]]);
});

test("share export reports missing permission changed and missing local sources instead of skipping", async () => {
  const record = async () => ({ assetId: linkedAsset.id, handle: {} });
  for (const [status, message] of [
    ["needs-permission", /尚未获得读取权限/],
    ["changed", /发生了变化/],
    ["missing", /移动、改名或删除/]
  ]) {
    await assert.rejects(() => readLinkedAssetForShare(linkedAsset, "Key art", {
      getLocalAssetHandleRecord: record,
      inspectStoredLocalAsset: async () => ({ status })
    }), message);
  }
  await assert.rejects(() => readLinkedAssetForShare(linkedAsset, "Key art", {
    getLocalAssetHandleRecord: async () => null
  }), /没有保存可读取的本机链接/);
});

test("linked source becomes a portable managed copy with accurate format and no machine state", () => {
  const blob = new Blob(["psd-source"], { type: "image/vnd.adobe.photoshop" });
  const portableFormat = resolvePortableAssetFormat(linkedAsset, blob);
  const packaged = portableManagedAsset(linkedAsset, blob, "attachments/case/source.psd", portableFormat);

  assert.equal(portableFormat.extension, "psd");
  assert.equal(packaged.storageMode, "managed");
  assert.equal(packaged.assetPath, "attachments/case/source.psd");
  assert.equal(packaged.byteSize, blob.size);
  assert.equal(packaged.mimeType, "image/vnd.adobe.photoshop");
  assert.equal(packaged.sourceFormat, "psd");
  assert.equal(packaged.formatCategory, "design-source");
  for (const field of ["recordType", "linkStatus", "importFailure", "sourceLastModified", "reference"]) {
    assert.equal(Object.hasOwn(packaged, field), false);
  }
});

test("unknown linked source stays an inert downloadable attachment in the package", () => {
  const blob = new Blob(["source"], { type: "application/octet-stream" });
  const asset = {
    ...linkedAsset,
    sourceTitle: "scene.customsource",
    sourceFormat: "customsource",
    mimeType: "application/octet-stream"
  };
  const portableFormat = resolvePortableAssetFormat(asset, blob);
  const packaged = portableManagedAsset(asset, blob, `attachments/case/source.${portableFormat.extension}`, portableFormat);

  assert.equal(portableFormat.extension, "customsource");
  assert.equal(packaged.kind, "attachment");
  assert.equal(packaged.storageMode, "managed");
  assert.equal(packaged.formatCategory, "other-source");
  assert.equal(packaged.mimeType, "application/octet-stream");
});
