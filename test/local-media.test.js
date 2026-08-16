import test from "node:test";
import assert from "node:assert/strict";

import {
  detectLocalMediaFile,
  findExactMediaDuplicate,
  normalizeLocalRelativePath,
  prepareLocalMedia
} from "../local-media.js";
import { PORTABLE_LIBRARY_LIMITS } from "../resource-limits.js";

test("local media detection keeps only supported formats and safe relative paths", () => {
  assert.deepEqual(detectLocalMediaFile(new File(["image"], "frame.gif", { type: "image/gif" })), {
    extension: "gif", kind: "image", mimeType: "image/gif"
  });
  assert.deepEqual(detectLocalMediaFile(new File(["video"], "clip.mp4", { type: "video/mp4" })), {
    extension: "mp4", kind: "video", mimeType: "video/mp4"
  });
  assert.deepEqual(detectLocalMediaFile(new File(["notes"], "notes.md")), {
    extension: "md", kind: "document", mimeType: "text/markdown"
  });
  assert.deepEqual(detectLocalMediaFile(new File(["movie"], "clip.mov")), {
    extension: "mov", kind: "video", mimeType: "video/quicktime"
  });
  assert.throws(
    () => detectLocalMediaFile(new File(["html"], "frame.png", { type: "text/html" })),
    /扩展名和文件格式不一致/
  );
  assert.equal(normalizeLocalRelativePath("folder/reference/frame.gif", "frame.gif"), "folder/reference/frame.gif");
  assert.throws(() => normalizeLocalRelativePath("/Users/private/frame.gif", "frame.gif"), /相对路径/);
  assert.throws(() => normalizeLocalRelativePath("../private/frame.gif", "frame.gif"), /相对路径/);
});

test("GIF preparation retains the original and creates one first-frame poster", async () => {
  const gif = new File(["gif-bytes"], "motion.gif", { type: "image/gif" });
  const posterBlob = new Blob(["poster"], { type: "image/webp" });
  const prepared = await prepareLocalMedia(gif, "asset:gif", {
    now: "2026-08-08T05:00:00.000Z",
    relativePath: "references/motion.gif",
    estimateStorage: async () => ({ quota: 1000, usage: 0 }),
    readImageDimensions: async (blob) => blob === gif
      ? { width: 320, height: 180 }
      : { width: 320, height: 180 },
    createGifFirstFrame: async () => posterBlob,
    posterId: () => "poster:gif"
  });

  assert.equal(prepared.blob, gif);
  assert.equal(prepared.asset.posterAssetId, "poster:gif");
  assert.equal(prepared.asset.relativePath, "references/motion.gif");
  assert.equal(prepared.poster.asset.usage, "poster");
  assert.equal(prepared.poster.blob, posterBlob);
});

test("local image preparation rejects files above the portable image limit before decoding", async () => {
  const oversized = new File(
    [new Uint8Array(PORTABLE_LIBRARY_LIMITS.maxImageBytes + 1)],
    "oversized.png",
    { type: "image/png" }
  );
  let dimensionReads = 0;

  await assert.rejects(
    () => prepareLocalMedia(oversized, "asset:oversized", {
      estimateStorage: async () => ({ quota: oversized.size * 2, usage: 0 }),
      readImageDimensions: async () => {
        dimensionReads += 1;
        return { width: 1, height: 1 };
      }
    }),
    /16 MiB/
  );
  assert.equal(dimensionReads, 0);
});

test("exact duplicate detection hashes only size type and name candidates", async () => {
  const incoming = new File(["same bytes"], "frame.png", { type: "image/png" });
  const blobs = new Map([
    ["candidate:different", new Blob(["other data"], { type: "image/png" })],
    ["candidate:exact", new Blob(["same bytes"], { type: "image/png" })],
    ["not-a-candidate", new Blob(["same bytes"], { type: "image/png" })]
  ]);
  const reads = [];
  const result = await findExactMediaDuplicate(incoming, [{ mediaAssets: [
    { id: "candidate:different", byteSize: incoming.size, mimeType: "image/png", sourceTitle: "frame.png" },
    { id: "candidate:exact", byteSize: incoming.size, mimeType: "image/png", sourceTitle: "frame.png" },
    { id: "not-a-candidate", byteSize: incoming.size, mimeType: "image/png", sourceTitle: "other.png" }
  ] }], {
    readBlob: async (assetId) => {
      reads.push(assetId);
      return blobs.get(assetId);
    }
  });

  assert.equal(result.duplicateAssetId, "candidate:exact");
  assert.match(result.contentHash, /^[a-f0-9]{64}$/u);
  assert.deepEqual(reads, ["candidate:different", "candidate:exact"]);
});

test("exact duplicate detection includes earlier files from the same import batch", async () => {
  const incoming = new File(["same bytes"], "frame.png", { type: "image/png" });
  const contentHash = await findExactMediaDuplicate(incoming, [], { candidateAssets: [] });
  const result = await findExactMediaDuplicate(incoming, [], {
    candidateAssets: [{
      id: "batch:first",
      byteSize: incoming.size,
      mimeType: "image/png",
      sourceTitle: "frame.png",
      contentHash: contentHash.contentHash
    }]
  });

  assert.equal(result.duplicateAssetId, "batch:first");
  assert.equal(result.contentHash, contentHash.contentHash);
});
