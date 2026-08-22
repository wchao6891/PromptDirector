import test from "node:test";
import assert from "node:assert/strict";

import {
  createUnsupportedLocalAssetReference,
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
  assert.deepEqual(detectLocalMediaFile(new File(["audio"], "score.wav", { type: "audio/wav" })), {
    extension: "wav", kind: "audio", mimeType: "audio/wav"
  });
  assert.deepEqual(detectLocalMediaFile(new File(["source"], "layout.psd", { type: "application/octet-stream" })), {
    extension: "psd", kind: "attachment", mimeType: "image/vnd.adobe.photoshop"
  });
  assert.throws(() => detectLocalMediaFile(new File(["html"], "frame.png", { type: "text/html" })), (error) => {
    assert.equal(error.code, "unsupported_format");
    assert.match(error.message, /扩展名和文件格式不一致/);
    return true;
  });
  assert.equal(normalizeLocalRelativePath("folder/reference/frame.gif", "frame.gif"), "folder/reference/frame.gif");
  assert.throws(() => normalizeLocalRelativePath("/Users/private/frame.gif", "frame.gif"), /相对路径/);
  assert.throws(() => normalizeLocalRelativePath("../private/frame.gif", "frame.gif"), /相对路径/);
});

test("subtitle preparation extracts safe plain text as a document", async () => {
  const subtitle = new File(["1\r\n00:00:01,000 --> 00:00:02,000\r\nOpening\u0000\r\n"], "captions.srt", {
    type: "text/plain"
  });
  const prepared = await prepareLocalMedia(subtitle, "document:subtitle", {
    estimateStorage: async () => ({ quota: 1000, usage: 0 })
  });

  assert.equal(prepared.asset.kind, "document");
  assert.equal(prepared.asset.formatCategory, "subtitle");
  assert.equal(prepared.contentFormat, "plain");
  assert.equal(prepared.sourceFormat, "srt");
  assert.equal(prepared.contentText, "1\n00:00:01,000 --> 00:00:02,000\nOpening");
});

test("audio and creator source preparation preserve originals without parsing proprietary contents", async () => {
  const estimateStorage = async () => ({ quota: 10_000, usage: 0 });
  const audio = await prepareLocalMedia(
    new File(["audio"], "score.flac", { type: "audio/flac" }),
    "audio:score",
    { estimateStorage }
  );
  const source = await prepareLocalMedia(
    new File(["private format bytes"], "scene.aep", { type: "application/octet-stream" }),
    "attachment:scene",
    { estimateStorage, storageMode: "reference" }
  );

  assert.equal(audio.asset.kind, "audio");
  assert.equal(audio.asset.playbackCapability, "native");
  assert.equal(source.asset.kind, "attachment");
  assert.equal(source.asset.storageMode, "reference");
  assert.equal(source.asset.formatCategory, "motion-project");
  assert.equal(Object.hasOwn(source, "contentText"), false);
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
    (error) => {
      assert.equal(error.code, "too_large");
      assert.equal(error.forceAllowed, true);
      assert.equal(error.details.actualBytes, oversized.size);
      assert.equal(error.details.maxBytes, PORTABLE_LIBRARY_LIMITS.maxImageBytes);
      assert.match(error.message, /16 MiB/);
      return true;
    }
  );
  assert.equal(dimensionReads, 0);
});

test("explicit force import bypasses only the default image byte limit", async () => {
  const image = new File(["12345"], "large.png", { type: "image/png" });
  const prepared = await prepareLocalMedia(image, "asset:forced", {
    forceImport: true,
    limits: { maxImageBytes: 4, maxImagePixels: 100 },
    estimateStorage: async () => ({ quota: 100, usage: 0 }),
    readImageDimensions: async () => ({ width: 5, height: 5 })
  });

  assert.equal(prepared.asset.byteSize, 5);
  assert.equal(prepared.asset.width, 5);
  assert.equal(prepared.asset.height, 5);
});

test("force import cannot bypass physical storage capacity or the image pixel safety limit", async () => {
  const image = new File(["12345"], "large.png", { type: "image/png" });
  await assert.rejects(() => prepareLocalMedia(image, "asset:no-space", {
    forceImport: true,
    limits: { maxImageBytes: 4 },
    estimateStorage: async () => ({ quota: 4, usage: 0 }),
    readImageDimensions: async () => ({ width: 1, height: 1 })
  }), (error) => {
    assert.equal(error.code, "storage_insufficient");
    assert.equal(error.forceAllowed, false);
    return true;
  });

  await assert.rejects(() => prepareLocalMedia(image, "asset:unsafe-pixels", {
    forceImport: true,
    limits: { maxImageBytes: 4, maxImagePixels: 20 },
    estimateStorage: async () => ({ quota: 100, usage: 0 }),
    readImageDimensions: async () => ({ width: 5, height: 5 })
  }), (error) => {
    assert.equal(error.code, "safety_limit_exceeded");
    assert.equal(error.forceAllowed, false);
    assert.match(error.message, /不能强制导入/);
    return true;
  });
});

test("decode failures expose a stable per-file reason code", async () => {
  const image = new File(["not really png"], "broken.png", { type: "image/png" });
  await assert.rejects(() => prepareLocalMedia(image, "asset:broken", {
    estimateStorage: async () => ({ quota: 100, usage: 0 }),
    readImageDimensions: async () => { throw new Error("decoder stopped"); }
  }), (error) => {
    assert.equal(error.code, "read_or_decode_failed");
    assert.match(error.message, /broken\.png.*decoder stopped/);
    return true;
  });
});

test("unsupported files can become inert relink metadata without copying their blob", () => {
  const file = new File(["binary"], "references/custom.zzz", {
    type: "application/x-custom",
    lastModified: 1_776_500_123_000
  });
  const reference = createUnsupportedLocalAssetReference(file, "attachment:unknown", {
    relativePath: "references/custom.zzz",
    now: "2026-08-22T10:00:00.000Z"
  });

  assert.equal(reference.storageMode, "reference");
  assert.equal(reference.recordType, "local-asset-reference");
  assert.equal(reference.linkStatus, "relink-required");
  assert.equal(reference.importFailure.code, "unsupported_format");
  assert.equal(reference.relativePath, "references/custom.zzz");
  assert.equal(reference.sourceFormat, "zzz");
  assert.equal(reference.sourceLastModified, 1_776_500_123_000);
  assert.equal(Object.hasOwn(reference, "blob"), false);
  assert.equal(Object.hasOwn(reference, "contentHash"), false);
  assert.throws(
    () => createUnsupportedLocalAssetReference(
      new File(["source"], "scene.aep", { type: "application/x-after-effects" }),
      "attachment:supported"
    ),
    (error) => error.code === "invalid_file" && /正常导入流程/u.test(error.message)
  );
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
