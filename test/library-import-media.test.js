import test from "node:test";
import assert from "node:assert/strict";

import {
  filesWithoutInvalidLibraryImages,
  findInvalidImportedImageIds
} from "../library-import-media.js";

test("shared ZIP validation reports every undecodable image instead of stopping at the first one", async () => {
  const good = new Blob(["good"], { type: "image/webp" });
  const badOne = new Blob(["bad-one"], { type: "image/webp" });
  const badTwo = new Blob(["bad-two"], { type: "image/webp" });
  const images = new Map([
    ["image:good", good],
    ["image:bad-one", badOne],
    ["image:bad-two", badTwo]
  ]);

  const invalidIds = await findInvalidImportedImageIds(images, async (blob) => {
    if (blob !== good) throw new Error("无法解码");
  });

  assert.deepEqual([...invalidIds], ["image:bad-one", "image:bad-two"]);
});

test("shared ZIP validation propagates a programming error in the image map", async () => {
  await assert.rejects(
    () => findInvalidImportedImageIds(new Map([["image:bad-map", null]]), async () => {}),
    /图片校验输入无效/
  );
});

test("shared ZIP salvage removes only archive files belonging to undecodable entry images", () => {
  const files = new Map([
    ["library.json", new Blob(["{}"], { type: "application/json" })],
    ["images/good.webp", new Blob(["good"], { type: "image/webp" })],
    ["images/bad.webp", new Blob(["bad"], { type: "image/webp" })]
  ]);
  const library = {
    entries: [{
      id: "case:one",
      mediaAssets: [
        { id: "image:good", assetPath: "images/good.webp" },
        { id: "image:bad", assetPath: "images/bad.webp" }
      ]
    }]
  };

  const salvageFiles = filesWithoutInvalidLibraryImages(library, files, new Set(["image:bad"]));

  assert.equal(salvageFiles.has("images/bad.webp"), false);
  assert.equal(salvageFiles.get("images/good.webp"), files.get("images/good.webp"));
  assert.equal(salvageFiles.get("library.json"), files.get("library.json"));
  assert.equal(files.has("images/bad.webp"), true);
});

test("rescue validation removes undecodable images from every private backup scope", () => {
  const paths = [
    "images/active.webp",
    "images/trash.webp",
    "creative-results/run/result.webp",
    "temp-references/session/temp.webp"
  ];
  const files = new Map(paths.map((path) => [path, new Blob([path], { type: "image/webp" })]));
  const library = {
    entries: [{ id: "case:active", mediaAssets: [{ id: "image:active", assetPath: paths[0] }] }],
    trashState: {
      items: [{
        kind: "entry",
        snapshot: { mediaAssets: [{ id: "image:trash", assetPath: paths[1] }] }
      }]
    },
    creativeRuns: [{
      outputs: [{ visual: { id: "image:creative", assetPath: paths[2] } }]
    }],
    composerSessions: [{
      referenceSnapshots: [{
        sourceType: "temporary",
        assetRefs: [{ assetId: "image:temporary", archivePath: paths[3] }]
      }]
    }]
  };

  const salvageFiles = filesWithoutInvalidLibraryImages(
    library,
    files,
    new Set(["image:active", "image:trash", "image:creative", "image:temporary"])
  );

  assert.deepEqual([...salvageFiles.keys()], []);
  assert.equal(files.size, 4);
});
