import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import {
  assertStorageCapacity,
  normalizeDerivedMedia,
  normalizeDerivedMetadata,
  validateMediaBlob
} from "../media-store.js";

const source = await readFile(new URL("../media-store.js", import.meta.url), "utf8");

test("media storage accepts images videos and creative documents", () => {
  assert.doesNotThrow(() => validateMediaBlob(new Blob(["frame"], { type: "image/webp" })));
  assert.doesNotThrow(() => validateMediaBlob(new Blob(["clip"], { type: "video/mp4" })));
  assert.doesNotThrow(() => validateMediaBlob(new Blob(["pdf"], { type: "application/pdf" })));
  assert.throws(() => validateMediaBlob(new Blob(["binary"], { type: "application/octet-stream" })), /暂不支持/);
});

test("derived document data remains a rebuildable cache with bounded metadata", () => {
  const thumbnail = new Blob(["preview"], { type: "image/webp" });
  const value = normalizeDerivedMedia({ pageCount: 12, searchText: "  中文 PDF 内容  ", thumbnail });
  assert.equal(value.pageCount, 12);
  assert.equal(value.searchText, "中文 PDF 内容");
  assert.equal(value.thumbnail, thumbnail);
  assert.deepEqual(normalizeDerivedMedia({ pageCount: -1, searchText: 7 }), { pageCount: 0, searchText: "7" });
});

test("derived image metadata keeps palette and dimensions separate from thumbnail blobs", () => {
  assert.deepEqual(normalizeDerivedMetadata({
    width: 1920,
    height: 1080,
    palette: { colors: ["#123456", "bad"], version: 2, source: "screenshot" },
    mimeType: "image/webp",
    byteSize: 500
  }), {
    width: 1920,
    height: 1080,
    palette: { colors: ["#123456"], version: 2, source: "screenshot" },
    mimeType: "image/webp",
    byteSize: 500
  });
});

test("adding the derived cache does not recopy every legacy screenshot on a v2 upgrade", () => {
  assert.match(source, /DERIVED_METADATA_STORE/);
  assert.match(source, /if \(event\.oldVersion >= 2\) return;/);
  assert.ok(source.indexOf("if (event.oldVersion >= 2) return;") < source.indexOf("openCursor()"));
});

test("replacing a media file invalidates its rebuildable thumbnail before saving the new original", () => {
  const replacement = source.slice(source.indexOf("export async function replaceMediaBlob"), source.indexOf("export async function undoMediaReplacement"));
  assert.ok(replacement.indexOf("deleteDerivedMedia(assetId)") < replacement.indexOf("saveMediaBlob(assetId, blob, options)"));
});

test("undoing a media replacement invalidates the replacement thumbnail before restoring the original", () => {
  const undo = source.slice(source.indexOf("export async function undoMediaReplacement"), source.indexOf("export async function discardMediaReplacementBackup"));
  assert.ok(undo.indexOf("deleteDerivedMedia(assetId)") < undo.indexOf("saveMediaBlob(assetId, backup"));
});

test("media import blocks only when the reported physical capacity is insufficient", () => {
  assert.doesNotThrow(() => assertStorageCapacity({}, 500));
  assert.doesNotThrow(() => assertStorageCapacity({ quota: 1000, usage: 200 }, 800));
  assert.throws(() => assertStorageCapacity({ quota: 1000, usage: 201 }, 800), /可用空间不足/);
});
