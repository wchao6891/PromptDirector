import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import {
  LOCAL_ASSET_LINK_STATUS,
  deleteLocalAssetHandle,
  getLocalAssetHandle,
  inspectLocalAssetHandle,
  localAssetMetadataChanges,
  queryLocalAssetHandlePermission,
  readLocalAssetFile,
  saveLocalAssetHandle
} from "../local-asset-store.js";

const source = await readFile(new URL("../local-asset-store.js", import.meta.url), "utf8");

function fileMetadata(overrides = {}) {
  return { name: "scene.psd", size: 128, lastModified: 42, ...overrides };
}

function fileHandle({ permission = "granted", file = fileMetadata(), getFileError } = {}) {
  const calls = { query: 0, getFile: 0, request: 0 };
  return {
    kind: "file",
    calls,
    async queryPermission() {
      calls.query += 1;
      return permission;
    },
    async requestPermission() {
      calls.request += 1;
      return "granted";
    },
    async getFile() {
      calls.getFile += 1;
      if (getFileError) throw getFileError;
      return file;
    }
  };
}

function fakeDatabase() {
  const values = new Map();
  return {
    values,
    transaction() {
      const transaction = {
        objectStore() {
          return {
            put(value, key) {
              values.set(key, value);
              return settledRequest(value, transaction);
            },
            get(key) {
              return settledRequest(values.get(key), transaction);
            },
            delete(key) {
              values.delete(key);
              return settledRequest(undefined, transaction);
            }
          };
        }
      };
      return transaction;
    }
  };
}

function settledRequest(result, transaction) {
  const request = {};
  queueMicrotask(() => {
    request.result = result;
    request.onsuccess?.();
    transaction.oncomplete?.();
  });
  return request;
}

test("local source handles use an independent version-one database", () => {
  assert.match(source, /prompt-director-local-assets/);
  assert.match(source, /DATABASE_VERSION = 1/);
  assert.doesNotMatch(source, /requestPermission\s*\(/);
});

test("handle records persist by asset id through an injected database", async () => {
  const database = fakeDatabase();
  const handle = fileHandle();
  const saved = await saveLocalAssetHandle("asset:1", handle, fileMetadata(), {
    database,
    now: "2026-08-22T00:00:00.000Z"
  });
  assert.equal(saved.assetId, "asset:1");
  assert.equal(await getLocalAssetHandle("asset:1", { database }), handle);
  await deleteLocalAssetHandle("asset:1", { database });
  assert.equal(await getLocalAssetHandle("asset:1", { database }), null);
});

test("permission checks never read the file or request permission", async () => {
  const handle = fileHandle({ permission: "prompt" });
  assert.equal(await queryLocalAssetHandlePermission(handle), "prompt");
  assert.deepEqual(handle.calls, { query: 1, getFile: 0, request: 0 });
});

test("inspection distinguishes missing permission ready and changed", async () => {
  assert.deepEqual(await inspectLocalAssetHandle(null), {
    status: LOCAL_ASSET_LINK_STATUS.MISSING,
    permission: "unknown"
  });

  const promptHandle = fileHandle({ permission: "prompt" });
  const needsPermission = await inspectLocalAssetHandle({
    assetId: "asset:1",
    handle: promptHandle,
    metadata: fileMetadata()
  });
  assert.equal(needsPermission.status, LOCAL_ASSET_LINK_STATUS.NEEDS_PERMISSION);
  assert.equal(promptHandle.calls.getFile, 0);

  const ready = await inspectLocalAssetHandle({
    assetId: "asset:2",
    handle: fileHandle(),
    metadata: fileMetadata()
  });
  assert.equal(ready.status, LOCAL_ASSET_LINK_STATUS.READY);
  assert.deepEqual(ready.changedFields, []);

  const changed = await inspectLocalAssetHandle({
    assetId: "asset:3",
    handle: fileHandle({ file: fileMetadata({ size: 256, lastModified: 84 }) }),
    metadata: fileMetadata()
  });
  assert.equal(changed.status, LOCAL_ASSET_LINK_STATUS.CHANGED);
  assert.deepEqual(changed.changedFields, ["size", "lastModified"]);
});

test("missing files are reported without disguising them as permission failures", async () => {
  const error = new Error("gone");
  error.name = "NotFoundError";
  const result = await inspectLocalAssetHandle({
    assetId: "asset:1",
    handle: fileHandle({ getFileError: error }),
    metadata: fileMetadata()
  });
  assert.equal(result.status, LOCAL_ASSET_LINK_STATUS.MISSING);
  assert.equal(result.permission, "granted");
});

test("file reads require an already granted permission and never request it", async () => {
  const promptHandle = fileHandle({ permission: "prompt" });
  await assert.rejects(readLocalAssetFile(promptHandle), (error) => {
    assert.equal(error.code, "local_asset_permission_required");
    return true;
  });
  assert.deepEqual(promptHandle.calls, { query: 1, getFile: 0, request: 0 });

  const grantedHandle = fileHandle();
  assert.deepEqual(await readLocalAssetFile(grantedHandle), fileMetadata());
  assert.deepEqual(grantedHandle.calls, { query: 1, getFile: 1, request: 0 });
});

test("metadata comparison includes name size and last modified time", () => {
  assert.deepEqual(localAssetMetadataChanges(
    fileMetadata(),
    fileMetadata({ name: "renamed.psd", size: 256, lastModified: 84 })
  ), ["name", "size", "lastModified"]);
});
