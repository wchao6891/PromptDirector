import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import {
  commitMetadataThenDeleteImages,
  replaceImagesWithRollback
} from "../image-transaction.js";

test("metadata failure never deletes referenced images", async () => {
  const deleted = [];
  await assert.rejects(() => commitMetadataThenDeleteImages({
    imageIds: ["visual-one"],
    commitMetadata: async () => { throw new Error("storage unavailable"); },
    deleteImage: async (id) => deleted.push(id)
  }), /storage unavailable/);
  assert.deepEqual(deleted, []);
});

test("successful metadata commit is visible before image cleanup", async () => {
  const calls = [];
  const result = await commitMetadataThenDeleteImages({
    imageIds: ["visual-one", "visual-one", "visual-two"],
    commitMetadata: async () => calls.push("metadata"),
    deleteImage: async (id) => calls.push(`delete:${id}`)
  });
  assert.equal(calls[0], "metadata");
  assert.deepEqual(new Set(result.deletedIds), new Set(["visual-one", "visual-two"]));
  assert.deepEqual(result.failedIds, []);
});

test("large cleanup can delete all unreferenced images in one storage transaction", async () => {
  const calls = [];
  const result = await commitMetadataThenDeleteImages({
    imageIds: ["one", "two", "one"],
    commitMetadata: async () => calls.push("metadata"),
    deleteImages: async (ids) => calls.push(`bulk:${ids.join(",")}`)
  });
  assert.deepEqual(calls, ["metadata", "bulk:one,two"]);
  assert.deepEqual(result, { deletedIds: ["one", "two"], failedIds: [] });
});

test("image replacements roll back when metadata commit fails", async () => {
  const images = new Map([
    ["existing", new Blob(["old"], { type: "image/webp" })]
  ]);
  await assert.rejects(() => replaceImagesWithRollback({
    replacements: replacements([
      ["existing", new Blob(["new"], { type: "image/webp" })],
      ["new-id", new Blob(["new-id"], { type: "image/webp" })]
    ]),
    readImage: async (id) => images.get(id) ?? null,
    writeImage: async (id, blob) => images.set(id, blob),
    deleteImage: async (id) => images.delete(id),
    commitMetadata: async () => { throw new Error("metadata failed"); }
  }), /metadata failed/);
  assert.equal(await images.get("existing").text(), "old");
  assert.equal(images.has("new-id"), false);
});

test("a replacement stream failure rolls back images already staged", async () => {
  const original = new Blob(["old"], { type: "image/webp" });
  const images = new Map([["existing", original]]);
  async function* failingReplacements() {
    yield { id: "existing", blob: new Blob(["new"], { type: "image/webp" }) };
    throw new Error("remote object damaged");
  }
  await assert.rejects(() => replaceImagesWithRollback({
    replacements: failingReplacements(),
    readImage: async (id) => images.get(id) ?? null,
    writeImage: async (id, blob) => images.set(id, blob),
    deleteImage: async (id) => images.delete(id),
    commitMetadata: async () => undefined
  }), /remote object damaged/);
  assert.equal(await images.get("existing").text(), "old");
});

test("a failed image write also restores the image it may have partially replaced", async () => {
  const oldBlob = new Blob(["old"], { type: "image/webp" });
  const images = new Map([["existing", oldBlob]]);
  let firstWrite = true;
  await assert.rejects(() => replaceImagesWithRollback({
    replacements: replacements([["existing", new Blob(["new"], { type: "image/webp" })]]),
    readImage: async (id) => images.get(id) ?? null,
    writeImage: async (id, blob) => {
      images.set(id, blob);
      if (firstWrite) {
        firstWrite = false;
        throw new Error("disk write interrupted");
      }
    },
    deleteImage: async (id) => images.delete(id),
    commitMetadata: async () => undefined
  }), /disk write interrupted/);
  assert.equal(await images.get("existing").text(), "old");
});

async function* replacements(values) {
  for (const [id, blob] of values) yield { id, blob };
}

test("case and creative-output deletion both use metadata-first image cleanup", async () => {
  const source = await readFile(new URL("../background.js", import.meta.url), "utf8");
  for (const [startName, endName] of [
    ["async function deleteEntry(entryId)", "function enqueue(task)"],
    ["async function deleteCreativeOutput(message)", "async function analyzeCreativeOutput"]
  ]) {
    const block = source.slice(source.indexOf(startName), source.indexOf(endName, source.indexOf(startName)));
    assert.match(block, /commitMetadataThenDeleteImages/);
    assert.doesNotMatch(block, /await deleteScreenshotBlob/);
  }
});

test("external Skill deletion commits metadata before cleaning package files", async () => {
  const source = await readFile(new URL("../background.js", import.meta.url), "utf8");
  const start = source.indexOf("async function deleteCreativeSkillAction(skillId)");
  const block = source.slice(start, source.indexOf("async function getComposerSession", start));
  assert.ok(block.indexOf("await commitLocalChanges") < block.indexOf("await deleteMediaBlobs"));
  assert.match(block, /await deleteMediaBlobs\(skillPackageAssetIds\(result\.skill\)\)\.catch\(\(\) => undefined\)/);
});

test("page capture never deletes committed media when a post-commit action fails", async () => {
  const source = await readFile(new URL("../background.js", import.meta.url), "utf8");
  const start = source.indexOf("async function commitPageCapture(batchValue)");
  const block = source.slice(start, source.indexOf("async function startCaptureForCase", start));
  assert.match(block, /metadataCommitted = true/);
  assert.match(block, /if \(!metadataCommitted\) await Promise\.allSettled/);
  assert.ok(block.indexOf("metadataCommitted = true") < block.indexOf("await notifySaved"));
});

test("temporary composer assets are tracked before derived data can fail", async () => {
  const source = await readFile(new URL("../composer-page.js", import.meta.url), "utf8");
  const start = source.indexOf("async function addTempReferences");
  const block = source.slice(start, source.indexOf("async function removeTempReference", start));
  assert.ok(block.indexOf("savedAssetIds.push(assetId)") < block.indexOf("await saveDerivedMedia"));
});

test("creative video posters roll back only before their metadata commit", async () => {
  const source = await readFile(new URL("../background.js", import.meta.url), "utf8");
  const start = source.indexOf("async function saveCreativeOutputToLibrary");
  const block = source.slice(start, source.indexOf("async function updateCreativeSignal", start));
  assert.match(block, /posterAssetId = posterId/);
  assert.match(block, /if \(posterAssetId && !metadataCommitted\)/);
});
