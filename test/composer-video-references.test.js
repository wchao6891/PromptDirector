import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { prepareComposerVideos, sessionHasVideoReferences } from "../composer-video-references.js";
import { createReferenceSnapshots } from "../composer.js";
import { ASSET_FORMAT_REGISTRY } from "../asset-formats.js";
import { TEMP_REFERENCE_FILE_ACCEPT, validateTempReferenceFile } from "../temp-references.js";

test("a video without prompts or analyses is still a usable library reference", () => {
  const references = createReferenceSnapshots([{
    id: "case", text: "", primaryMediaId: "video",
    mediaAssets: [{ id: "video", kind: "video", usage: "content", storageMode: "managed", mimeType: "video/mp4" }]
  }], [{ entryId: "case", assetIds: ["video"] }], "zh-CN", "video");
  assert.equal(references.length, 1);
  assert.equal(references[0].originalText, "");
  assert.equal(sessionHasVideoReferences({ referenceSnapshots: references }), true);
});

test("every registered video extension can enter temporary references without a separate size limit", () => {
  for (const format of ASSET_FORMAT_REGISTRY.filter((item) => item.kind === "video")) {
    for (const extension of format.extensions) {
      assert.ok(TEMP_REFERENCE_FILE_ACCEPT.split(",").includes(`.${extension}`));
      const file = new File(["video"], `reference.${extension}`, { type: format.mimeTypes[0] });
      assert.equal(validateTempReferenceFile(file).kind, "video");
    }
  }
});

test("video preparation reads each selected resource once and cannot send missing or canceled content", async () => {
  const session = { referenceSnapshots: [1, 2].map(() => ({ assetRefs: [{ assetId: "video", kind: "video" }] })) };
  let reads = 0;
  const prepared = await prepareComposerVideos(session, {
    loadVideo: async () => { reads += 1; return new Blob(["video"], { type: "video/mp4" }); }
  });
  assert.equal(reads, 1);
  assert.equal(prepared.length, 1);
  assert.equal(prepared[0].dataUrl, "data:video/mp4;base64,dmlkZW8=");
  await assert.rejects(prepareComposerVideos(session, { loadVideo: async () => null }), /没有发送不完整参考/);
  const controller = new AbortController();
  await assert.rejects(prepareComposerVideos(session, {
    signal: controller.signal,
    loadVideo: async () => { controller.abort(); return new Blob(["video"]); },
    encode: async () => "encoded"
  }), { name: "AbortError" });
});

test("video dialogue uses the durable runner and persists streamed partial text", async () => {
  const [page, runner] = await Promise.all([
    readFile(new URL("../composer-page.js", import.meta.url), "utf8"),
    readFile(new URL("../creative-job-runner.js", import.meta.url), "utf8")
  ]);
  assert.match(page, /sessionHasVideoReferences\(working\)[\s\S]*startPersistentCreativeJob/);
  assert.doesNotMatch(page, /prepareSelectedReferenceVideos/);
  assert.match(page, /prepareLocalMedia\(file, assetId, \{\s*allowVideo: true,\s*readVideoMedia,/);
  assert.match(runner, /prepareComposerVideos/);
  assert.match(runner, /stream: videoDialogue/);
  assert.match(runner, /partialText: content/);
  assert.match(runner, /await checkpoints\.drain\(\)/);
});
