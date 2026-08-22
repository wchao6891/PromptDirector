import test from "node:test";
import assert from "node:assert/strict";

import {
  ASSET_FORMAT_REGISTRY,
  SUPPORTED_ASSET_KINDS,
  assetFileAccept,
  assetFormatForExtension,
  assetKindFromFileMetadata,
  extensionsForAssetKind,
  isReportedMimeCompatible
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
