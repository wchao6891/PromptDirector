import test from "node:test";
import assert from "node:assert/strict";

import { createVerifiedLibraryZip } from "../library-export-zip.js";
import { renderLibraryJson } from "../lib.js";
import { parseLibraryPackage } from "../library-package.js";
import { createArchiveUrl } from "../offscreen.js";
import { readZipBlob } from "../zip.js";

test("current exports are returned only after the production ZIP reader and package parser accept them", async () => {
  const libraryJson = renderLibraryJson([]);

  const archive = await createVerifiedLibraryZip([
    { name: "library.json", data: libraryJson },
    { name: "案例库.md", data: "# 案例库\n" }
  ], libraryJson);

  assert.equal(archive.type, "application/zip");
  const files = await readZipBlob(archive, {
    maxArchiveBytes: archive.size,
    maxFileBytes: archive.size
  });
  assert.equal(await files.get("library.json").text(), libraryJson);
});

test("a structurally valid ZIP is rejected when its parsed library meaning differs from the generated package", async () => {
  const expectedLibraryJson = renderLibraryJson([]);
  const changed = JSON.parse(expectedLibraryJson);
  changed.settings.libraryTitle = "打包后被改写";

  await assert.rejects(
    () => createVerifiedLibraryZip([
      { name: "library.json", data: `${JSON.stringify(changed)}\n` }
    ], expectedLibraryJson),
    /导出自检失败.*内容与生成前不一致/
  );
});

test("offscreen never creates a downloadable URL when the generated package fails its production self-read", async () => {
  const originalCreateObjectUrl = URL.createObjectURL;
  let createObjectUrlCalls = 0;
  URL.createObjectURL = () => {
    createObjectUrlCalls += 1;
    return "blob:must-not-be-created";
  };
  try {
    await assert.rejects(() => createArchiveUrl({
      entries: [{
        id: "case-with-broken-relation",
        title: "关系损坏案例",
        text: "prompt",
        facetAssignments: [{
          facetId: "missing-facet",
          nodeId: "missing-node",
          status: "confirmed",
          source: "manual"
        }]
      }]
    }), /导出自检失败.*引用了缺失的 AI 标签词表/);
    assert.equal(createObjectUrlCalls, 0);
  } finally {
    URL.createObjectURL = originalCreateObjectUrl;
  }
});

test("self-read keeps a JPEG case while the production parser drops only its broken AI label", async () => {
  const image = new Blob([new Uint8Array([0xff, 0xd8, 0xff, 0xd9])], { type: "image/jpeg" });
  const libraryJson = renderLibraryJson([{
    id: "jpeg-case",
    title: "JPEG 案例",
    text: "prompt",
    mediaAssets: [{
      id: "jpeg-asset",
      kind: "image",
      storageMode: "managed",
      mimeType: "image/jpeg",
      sourceFormat: "jpg",
      byteSize: image.size,
      capturedAt: "2026-08-26T00:00:00.000Z",
      assetPath: "images/jpeg-case/jpeg-asset.jpg"
    }],
    primaryMediaId: "jpeg-asset",
    facetAssignments: [{
      facetId: "missing-facet",
      nodeId: "missing-node",
      visualId: "jpeg-asset",
      status: "confirmed",
      source: "vision_model"
    }]
  }]);
  const archive = await createVerifiedLibraryZip([
    { name: "library.json", data: libraryJson },
    { name: "images/jpeg-case/jpeg-asset.jpg", data: image }
  ], libraryJson);
  const limits = {
    maxArchiveBytes: archive.size,
    maxFileBytes: archive.size,
    maxImageBytes: archive.size
  };
  const files = await readZipBlob(archive, limits);
  const parsed = parseLibraryPackage(JSON.parse(await files.get("library.json").text()), files, limits);

  assert.equal(parsed.entries.length, 1);
  assert.equal(parsed.entries[0].mediaAssets[0].sourceFormat, "jpg");
  assert.equal(parsed.assets.get("jpeg-asset").size, image.size);
  assert.deepEqual(parsed.entries[0].facetAssignments, []);
  assert.equal(parsed.importStats.droppedAiAssignments, 1);
});
