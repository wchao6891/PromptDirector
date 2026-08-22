import test from "node:test";
import assert from "node:assert/strict";

import {
  addEntryMedia,
  addTimeNote,
  mediaKindFromFile,
  normalizeEntryMedia,
  normalizeMediaAsset,
  posterAssetForVideo,
  removeEntryMedia,
  setPrimaryMedia,
  updateLocalAssetReferenceMetadata
} from "../media.js";
import { normalizeEntryVisuals, reorderEntryVisuals } from "../visuals.js";

test("media normalization discards empty slots instead of crashing library startup", () => {
  assert.equal(normalizeMediaAsset(null), null);
  const entry = normalizeEntryMedia({
    id: "case:empty-media-slot",
    mediaAssets: [null, { id: "image:kept", kind: "image", usage: "content", storageMode: "managed" }]
  });
  assert.deepEqual(entry.mediaAssets.map((asset) => asset.id), ["image:kept"]);
});

test("legacy visuals migrate to canonical media assets without serializing legacy fields", () => {
  const entry = normalizeEntryVisuals({
    id: "case:one",
    visuals: [{ id: "image:one", mimeType: "image/webp", screenshotPath: "images/one.webp" }],
    primaryVisualId: "image:one"
  });
  assert.equal(entry.mediaAssets[0].kind, "image");
  assert.equal(entry.mediaAssets[0].assetPath, "images/one.webp");
  assert.equal(entry.primaryMediaId, "image:one");
  assert.equal(entry.visuals[0].id, "image:one");
  assert.equal(Object.hasOwn(JSON.parse(JSON.stringify(entry)), "visuals"), false);
});

test("legacy local screenshots with source URLs never become external references", () => {
  const repaired = normalizeEntryMedia({
    id: "case:web-image",
    mediaAssets: [{
      id: "image:web", kind: "image", storageMode: "reference", mimeType: "image/webp",
      sourceUrl: "https://example.com/original-image"
    }],
    primaryMediaId: "image:web"
  });
  assert.equal(repaired.mediaAssets[0].storageMode, "managed");
  assert.equal(repaired.mediaAssets[0].sourceUrl, "https://example.com/original-image");
});

test("one case can contain local video, image, document and ordered time notes", () => {
  let entry = normalizeEntryMedia({ id: "case:mixed" });
  entry = addEntryMedia(entry, { id: "video:one", kind: "video", storageMode: "managed", mimeType: "video/mp4", durationMs: 12_000 });
  entry = addEntryMedia(entry, { id: "image:one", kind: "image", storageMode: "managed", mimeType: "image/webp" });
  entry = addEntryMedia(entry, { id: "pdf:one", kind: "document", storageMode: "managed", mimeType: "application/pdf" });
  entry = addEntryMedia(entry, { id: "frame:one", kind: "image", storageMode: "managed", mimeType: "image/webp" });
  entry = addTimeNote(entry, { id: "note:later", assetId: "video:one", startMs: 8000, text: "结束状态" });
  entry = addTimeNote(entry, { id: "note:first", assetId: "video:one", frameAssetId: "frame:one", startMs: 1000, endMs: 4000, text: "可见变化" });
  assert.deepEqual(entry.mediaAssets.map((item) => item.kind), ["video", "image", "document", "image"]);
  assert.deepEqual(entry.timeNotes.map((item) => item.id), ["note:first", "note:later"]);
  assert.equal(entry.timeNotes[0].frameAssetId, "frame:one");
  entry = removeEntryMedia(entry, "video:one");
  assert.deepEqual(entry.timeNotes, []);
});

test("removing media also removes its position from the saved article", () => {
  const entry = removeEntryMedia(normalizeEntryMedia({
    id: "case:article",
    mediaAssets: [{ id: "image:article", kind: "image", storageMode: "managed", mimeType: "image/webp" }],
    articleDocument: {
      version: 1,
      blocks: [
        { id: "text", kind: "paragraph", text: "正文", sourceOrder: 0 },
        { id: "image", kind: "image", assetId: "image:article", sourceUrl: "https://example.com/image.webp", sourceOrder: 1 }
      ]
    }
  }), "image:article");

  assert.deepEqual(entry.articleDocument.blocks.map((block) => block.kind), ["paragraph"]);
});

test("video analysis keeps actual provider cost and routing metadata", () => {
  const entry = normalizeEntryMedia({
    id: "case:video-analysis",
    videoAnalyses: [{
      id: "video-analysis:one",
      assetId: "video:one",
      text: "00:01 opening",
      provider: "OpenRouter",
      model: "declared/video-model",
      usage: { totalTokens: 15 },
      cost: 0.012,
      routing: { provider: "declared-provider" }
    }]
  });
  assert.equal(entry.videoAnalyses[0].cost, 0.012);
  assert.deepEqual(entry.videoAnalyses[0].routing, { provider: "declared-provider" });
});

test("external video references keep only supported playback modes", () => {
  const youtube = normalizeMediaAsset({
    id: "video:youtube", kind: "video", storageMode: "reference",
    sourceUrl: "https://www.youtube.com/watch?v=abc", reference: { url: "https://www.youtube.com/watch?v=abc", playbackMode: "embed" }
  });
  assert.deepEqual(youtube.reference, {
    url: "https://www.youtube.com/watch?v=abc", provider: "youtube", playbackMode: "embed", metadataStatus: "partial"
  });
  const ordinary = normalizeMediaAsset({
    id: "video:source", kind: "video", storageMode: "reference",
    reference: { url: "https://example.com/watch", playbackMode: "embed" }
  });
  assert.equal(ordinary.reference.playbackMode, "source");
  assert.equal(ordinary.reference.provider, "generic");
});

test("video posters are managed display assets without becoming case content", () => {
  const poster = normalizeMediaAsset({
    id: "poster:one", kind: "image", storageMode: "managed", mimeType: "image/webp",
    usage: "poster", derivedFromAssetId: "video:one"
  });
  const video = normalizeMediaAsset({
    id: "video:one", kind: "video", storageMode: "managed", mimeType: "video/mp4",
    posterAssetId: "poster:one"
  });
  assert.equal(poster.usage, "poster");
  assert.equal(poster.derivedFromAssetId, "video:one");
  assert.equal(video.usage, "content");
  assert.equal(video.posterAssetId, "poster:one");
});

test("poster assets remain display-only even when relationships are stale or directly removed", () => {
  let entry = normalizeEntryMedia({
    id: "case:video",
    mediaAssets: [
      { id: "video:one", kind: "video", storageMode: "managed", mimeType: "video/mp4", posterAssetId: "poster:missing" },
      { id: "poster:one", kind: "image", usage: "poster", storageMode: "managed", mimeType: "image/webp", derivedFromAssetId: "video:one" }
    ]
  });
  assert.equal(entry.primaryMediaId, "video:one");
  assert.equal(posterAssetForVideo(entry, entry.mediaAssets[0])?.id, "poster:one");
  assert.throws(() => setPrimaryMedia(entry, "poster:one"), /没有找到这个媒体/);
  entry = normalizeEntryMedia({
    ...entry,
    mediaAssets: entry.mediaAssets.map((asset) => asset.id === "video:one"
      ? { ...asset, posterAssetId: "poster:one" }
      : asset)
  });
  entry = removeEntryMedia(entry, "poster:one");
  assert.equal(entry.mediaAssets[0].posterAssetId, undefined);
});

test("the image compatibility view never exposes or removes video posters", () => {
  const entry = normalizeEntryVisuals({
    id: "case", mediaAssets: [
      { id: "image", kind: "image", storageMode: "managed", mimeType: "image/webp" },
      { id: "video", kind: "video", storageMode: "managed", mimeType: "video/mp4", posterAssetId: "poster" },
      { id: "poster", kind: "image", usage: "poster", storageMode: "managed", mimeType: "image/webp", derivedFromAssetId: "video" }
    ], primaryMediaId: "image"
  });
  assert.deepEqual(entry.visuals.map((item) => item.id), ["image"]);
  const reordered = reorderEntryVisuals(entry, ["image"]);
  assert.equal(reordered.mediaAssets.some((item) => item.id === "poster" && item.usage === "poster"), true);
});

test("file media kinds are derived from actual file metadata and supported extensions", () => {
  assert.equal(mediaKindFromFile({ name: "clip.mp4", type: "video/mp4" }), "video");
  assert.equal(mediaKindFromFile({ name: "notes.pdf", type: "" }), "document");
  assert.equal(mediaKindFromFile({ name: "frame.webp", type: "image/webp" }), "image");
  assert.equal(mediaKindFromFile({ name: "motion.gif", type: "image/gif" }), "image");
  assert.equal(mediaKindFromFile({ name: "score.wav", type: "audio/wav" }), "audio");
  assert.equal(mediaKindFromFile({ name: "captions.srt", type: "text/plain" }), "document");
  assert.equal(mediaKindFromFile({ name: "layout.psd", type: "application/octet-stream" }), "attachment");
  assert.equal(mediaKindFromFile({ name: "font.otf", type: "font/otf" }), "attachment");
  assert.equal(normalizeMediaAsset({ id: "gif", kind: "image", mimeType: "image/gif" }).mimeType, "image/gif");
  assert.equal(mediaKindFromFile({ name: "archive.bin", type: "application/octet-stream" }), "");
});

test("audio and inert attachment assets survive canonical normalization", () => {
  const audio = normalizeMediaAsset({
    id: "audio:score",
    kind: "audio",
    storageMode: "managed",
    sourceTitle: "score.wav",
    mimeType: "audio/wav",
    durationMs: 3200
  });
  const attachment = normalizeMediaAsset({
    id: "attachment:scene",
    kind: "attachment",
    storageMode: "reference",
    sourceTitle: "scene.aep",
    relativePath: "project/scene.aep",
    mimeType: "application/x-after-effects"
  });

  assert.equal(audio.kind, "audio");
  assert.equal(audio.formatCategory, "audio");
  assert.equal(attachment.kind, "attachment");
  assert.equal(attachment.storageMode, "reference");
  assert.equal(attachment.sourceFormat, "aep");
  assert.equal(attachment.formatCategory, "motion-project");
  assert.equal(attachment.relativePath, "project/scene.aep");
  assert.equal(normalizeMediaAsset({
    id: "attachment:unsafe",
    kind: "attachment",
    sourceTitle: "payload.exe",
    mimeType: "application/octet-stream"
  }), null);
});

test("unknown local source references require record identity while packaged copies require a generic managed descriptor", () => {
  const reference = {
    id: "attachment:unknown",
    kind: "attachment",
    storageMode: "reference",
    recordType: "local-asset-reference",
    linkStatus: "linked",
    sourceTitle: "custom.zzz",
    relativePath: "sources/custom.zzz",
    sourceFormat: "zzz",
    formatCategory: "local-link",
    mimeType: "application/x-custom",
    byteSize: 20,
    sourceLastModified: 1_776_500_123_000,
    importFailure: {
      code: "unsupported_format",
      message: "暂不支持这种文件格式：custom.zzz",
      forceAllowed: false
    }
  };
  const normalized = normalizeMediaAsset(reference);
  const packaged = normalizeMediaAsset({
    id: "attachment:packaged",
    kind: "attachment",
    storageMode: "managed",
    sourceTitle: "custom.zzz",
    sourceFormat: "zzz",
    formatCategory: "other-source",
    mimeType: "application/octet-stream",
    byteSize: 20,
    assetPath: "attachments/case/custom.zzz"
  });

  assert.equal(normalized.recordType, "local-asset-reference");
  assert.equal(normalized.linkStatus, "linked");
  assert.equal(normalized.sourceLastModified, 1_776_500_123_000);
  assert.equal(normalized.importFailure.code, "unsupported_format");
  assert.equal(packaged.storageMode, "managed");
  assert.equal(packaged.formatCategory, "other-source");
  assert.equal(packaged.sourceFormat, "zzz");
  assert.equal(packaged.recordType, undefined);
  assert.equal(normalizeMediaAsset({ ...packaged, id: "attachment:reference", storageMode: "reference" }), null);
  assert.equal(normalizeMediaAsset({ ...packaged, id: "attachment:wrong-category", formatCategory: "local-link" }), null);
  assert.equal(normalizeMediaAsset({ ...packaged, id: "attachment:unsafe-format", sourceFormat: "../zzz" }), null);
  assert.equal(normalizeMediaAsset({ ...packaged, id: "attachment:specific-mime", mimeType: "application/x-custom" }), null);
  assert.equal(normalizeMediaAsset({
    ...packaged,
    id: "attachment:registered-mismatch",
    sourceTitle: "layout.psd",
    sourceFormat: "psd",
    mimeType: "text/html"
  }), null);
});

test("relinking an inert local source updates only verifiable file metadata", () => {
  const original = normalizeEntryMedia({
    id: "entry:source",
    primaryMediaId: "attachment:unknown",
    mediaAssets: [{
      id: "attachment:unknown",
      kind: "attachment",
      storageMode: "reference",
      recordType: "local-asset-reference",
      linkStatus: "relink-required",
      sourceTitle: "custom.zzz",
      relativePath: "old/custom.zzz",
      sourceFormat: "zzz",
      mimeType: "application/x-custom",
      byteSize: 20,
      importFailure: {
        code: "unsupported_format",
        message: "暂不支持这种文件格式：custom.zzz",
        forceAllowed: false
      }
    }]
  });
  const updated = updateLocalAssetReferenceMetadata(original, "attachment:unknown", {
    sourceTitle: "custom-v2.zzz",
    relativePath: "new/custom-v2.zzz",
    sourceFormat: "zzz",
    mimeType: "application/x-custom",
    byteSize: 32,
    sourceLastModified: 1_776_500_999_000
  });

  assert.equal(updated.asset.linkStatus, "linked");
  assert.equal(updated.asset.sourceTitle, "custom-v2.zzz");
  assert.equal(updated.asset.relativePath, "new/custom-v2.zzz");
  assert.equal(updated.asset.byteSize, 32);
  assert.equal(updated.asset.sourceLastModified, 1_776_500_999_000);
  assert.equal(updated.entry.primaryMediaId, "attachment:unknown");
  assert.throws(() => updateLocalAssetReferenceMetadata(original, "attachment:unknown", {
    sourceTitle: "custom.zzz", relativePath: "../custom.zzz", byteSize: 20, sourceLastModified: 1
  }), /安全相对路径/u);
});
