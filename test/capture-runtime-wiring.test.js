import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("the collector live-refreshes on draft storage changes", async () => {
  const source = await readFile(new URL("../collector.js", import.meta.url), "utf8");
  assert.match(source, /chrome\.storage\.onChanged\.addListener/);
  assert.match(source, /changes\.captureDraft/);
});

test("opening the capture workspace never starts synchronization", async () => {
  const source = await readFile(new URL("../background.js", import.meta.url), "utf8");
  const start = source.indexOf('case "GET_CAPTURE_WORKSPACE"');
  const end = source.indexOf('case "GET_DATA_SAFETY_STATUS"', start);
  const branch = source.slice(start, end);
  assert.match(branch, /return enqueueCapture\(async \(\) => captureWorkspace\(\)\)/);
  assert.doesNotMatch(branch, /scheduleAutomaticSync|scheduleIdleSync|synchronizeNow|manualSyncController|SYNC_NOW/);
});

test("reading library state never starts synchronization", async () => {
  const source = await readFile(new URL("../background.js", import.meta.url), "utf8");
  const start = source.indexOf('case "GET_STATE"');
  const end = source.indexOf('case "GET_CAPTURE_WORKSPACE"', start);
  const branch = source.slice(start, end);
  assert.match(branch, /return enqueue\(async \(\) => \(\{ ok: true,/);
  assert.doesNotMatch(branch, /scheduleAutomaticSync|scheduleIdleSync|synchronizeNow|manualSyncController|SYNC_NOW/);
  assert.doesNotMatch(source, /function scheduleAutomaticSync|function scheduleIdleSync/);
});

test("draft edits and save share one lightweight queue so the last capture cannot miss the commit", async () => {
  const source = await readFile(new URL("../background.js", import.meta.url), "utf8");
  for (const messageType of [
    "UPDATE_CAPTURE_DRAFT", "UPDATE_CAPTURE_FRAGMENT", "REMOVE_CAPTURE_FRAGMENT",
    "REMOVE_CAPTURE_VISUAL", "CANCEL_CAPTURE_DRAFT", "COMMIT_CAPTURE_DRAFT"
  ]) {
    const start = source.indexOf(`case "${messageType}"`);
    assert.notEqual(start, -1, `${messageType} handler is missing`);
    const branch = source.slice(start, source.indexOf("case ", start + 6));
    assert.match(branch, /enqueueCapture/, `${messageType} must stay ordered with capture writes`);
  }
});

test("creative result capture and metadata commit cross both queues as one transaction", async () => {
  const source = await readFile(new URL("../background.js", import.meta.url), "utf8");
  const start = source.indexOf("async function captureAndCommitCreativeOutputs");
  const end = source.indexOf("function dispatchCaptureMessage", start);
  const transaction = source.slice(start, end);
  assert.match(transaction, /enqueueCapture/);
  assert.match(transaction, /await enqueue\(\(\) => commitCreativeOutputsTransaction\(\)\)/);
  assert.ok(transaction.indexOf("dispatchCaptureMessage") < transaction.indexOf("commitCreativeOutputsTransaction"));
});

test("a text-bearing captured post is classified from its text instead of its video attachment", async () => {
  const source = await readFile(new URL("../background.js", import.meta.url), "utf8");
  const start = source.indexOf("async function commitPageCapture");
  const end = source.indexOf("async function", start + 20);
  const save = source.slice(start, end);
  assert.match(save, /candidate\.sourceFacts\.pageType === "post" && base\.text/);
  assert.match(save, /classificationMediaAssets/);
});

test("restoring an overwritten screenshot marks that existing media id dirty", async () => {
  const source = await readFile(new URL("../background.js", import.meta.url), "utf8");
  const start = source.indexOf("async function undoLastSave()");
  const end = source.indexOf("async function deleteEntry", start);
  const undo = source.slice(start, end);
  assert.match(undo, /dirtyAssetIds:\s*\[current\.id\]/);
});
