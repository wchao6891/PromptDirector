import test from "node:test";
import assert from "node:assert/strict";

import {
  ASSET_FORMAT_REGISTRY,
  SUPPORTED_ASSET_KINDS,
  assetFileAccept,
  assetFormatForExtension,
  assetKindFromFileMetadata,
  extensionsForAssetKind,
  isReportedMimeCompatible,
  resolvePortableAssetFormat
} from "../asset-formats.js";

test("asset format registry is the unique source for supported kinds extensions and picker values", () => {
  assert.deepEqual(SUPPORTED_ASSET_KINDS, ["image", "video", "audio", "document", "attachment"]);
  const extensions = ASSET_FORMAT_REGISTRY.flatMap((definition) => definition.extensions);
  assert.equal(new Set(extensions).size, extensions.length);
  assert.equal(assetFileAccept().split(",").length, extensions.length);
  assert.equal(assetFileAccept({ kinds: ["audio"] }), extensionsForAssetKind("audio").map((value) => `.${value}`).join(","));
});

test("registry covers creator source files while keeping every proprietary format inert", () => {
  for (const extension of [
    "psd", "psb", "ai", "indd", "aep", "prproj", "sesx",
    "ttf", "otf", "blend", "c4d", "ma", "mb", "hip", "fbx", "glb", "nk", "sbsar"
  ]) {
    const definition = assetFormatForExtension(extension);
    assert.equal(definition?.kind, "attachment", extension);
    assert.equal(definition?.preview, "inert", extension);
  }
  for (const executable of ["exe", "app", "dmg", "pkg", "js", "sh"]) {
    assert.equal(assetFormatForExtension(executable), null);
  }
});

test("subtitles are searchable documents and MIME conflicts do not change file identity", () => {
  for (const extension of ["srt", "vtt", "ass", "ssa", "sbv", "lrc"]) {
    const definition = assetFormatForExtension(extension);
    assert.equal(definition?.kind, "document", extension);
    assert.equal(definition?.category, "subtitle", extension);
    assert.equal(definition?.plainText, true, extension);
  }
  assert.equal(assetKindFromFileMetadata({ name: "captions.srt", type: "text/plain" }), "document");
  assert.equal(assetKindFromFileMetadata({ name: "captions.srt", type: "video/mp4" }), "");
});

test("generic browser MIME values are allowed only when a registered extension establishes the format", () => {
  const photoshop = assetFormatForExtension("psd");
  assert.equal(isReportedMimeCompatible(photoshop, "application/octet-stream"), true);
  assert.equal(assetKindFromFileMetadata({ name: "source.psd", type: "application/octet-stream" }), "attachment");
  assert.equal(assetKindFromFileMetadata({ name: "unknown.bin", type: "application/octet-stream" }), "");
});

test("portable asset format resolves registered audio extensions for full backup and ZIP export", () => {
  for (const [mimeType, extension] of [
    ["audio/wav", "wav"],
    ["audio/mpeg", "mp3"],
    ["audio/mp4", "m4a"]
  ]) {
    const resolved = resolvePortableAssetFormat(
      { id: `audio:${extension}`, kind: "audio", mimeType },
      new Blob([extension], { type: mimeType })
    );
    assert.deepEqual(
      { directory: resolved.directory, extension: resolved.extension, mimeType: resolved.mimeType },
      { directory: "audio", extension, mimeType }
    );
  }
});

test("portable asset format round-trips every registered kind without a second format table", () => {
  const expectedDirectories = {
    image: "images",
    video: "videos",
    audio: "audio",
    document: "documents",
    attachment: "attachments"
  };
  for (const definition of ASSET_FORMAT_REGISTRY) {
    const extension = definition.extensions[0];
    const mimeType = definition.mimeTypes[0];
    const resolved = resolvePortableAssetFormat({
      id: `asset:${definition.id}`,
      kind: definition.kind,
      sourceFormat: extension,
      mimeType
    }, new Blob([definition.id], { type: mimeType }));
    assert.equal(resolved.directory, expectedDirectories[definition.kind], definition.id);
    assert.equal(resolved.extension, extension, definition.id);
    assert.equal(assetFormatForExtension(resolved.extension)?.id, definition.id, definition.id);
    assert.equal(isReportedMimeCompatible(definition, resolved.mimeType), true, definition.id);
  }
});
