import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("project menu separates archiving only the project from archiving it with its cases", async () => {
  const library = await readFile(new URL("../library.js", import.meta.url), "utf8");
  assert.match(library, /"仅删除项目"/);
  assert.match(library, /"删除项目及案例"/);
  const handlerStart = library.indexOf("async function deleteProjectCollectionWithEntries");
  const handlerEnd = library.indexOf("function enterProjectSelection", handlerStart);
  const handler = library.slice(handlerStart, handlerEnd);
  assert.match(handler, /可从回收站恢复/);
  assert.match(handler, /confirmAppAction/);
  assert.match(handler, /DELETE_COLLECTION_WITH_ENTRIES/);
  assert.match(handler, /confirmationName: collection\.name/);
  assert.doesNotMatch(handler, /showAppDialog|永久删除/);
});

test("project and case deletion is serialized and archives all selected content without deleting blobs", async () => {
  const background = await readFile(new URL("../background.js", import.meta.url), "utf8");
  assert.match(background, /case "DELETE_COLLECTION_WITH_ENTRIES":\s*return enqueue\(async \(\) => deleteCollectionWithEntries\(message\)\)/);
  const handlerStart = background.indexOf("async function deleteCollectionWithEntries");
  const handlerEnd = background.indexOf("async function moveEntryBatchToTrash", handlerStart);
  const handler = background.slice(handlerStart, handlerEnd);
  assert.match(handler, /moveCollectionWithEntriesToTrash/);
  assert.match(handler, /STORAGE_KEYS\.trashState/);
  assert.doesNotMatch(handler, /deleteMediaBlob|deleteMediaBlobs|deleteScreenshotBlob/);
});
