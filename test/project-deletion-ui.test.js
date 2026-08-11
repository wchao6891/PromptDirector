import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("project menu separates deleting only the project from permanently deleting its cases", async () => {
  const library = await readFile(new URL("../library.js", import.meta.url), "utf8");
  assert.match(library, /"删除项目"/);
  assert.match(library, /"删除项目及全部案例…"/);
  const handlerStart = library.indexOf("async function deleteProjectCollectionWithEntries");
  const handlerEnd = library.indexOf("function enterProjectSelection", handlerStart);
  const handler = library.slice(handlerStart, handlerEnd);
  assert.match(handler, /请输入完整项目名称以确认/);
  assert.match(handler, /DELETE_COLLECTION_WITH_ENTRIES/);
  assert.match(handler, /confirmationName\.trim\(\) !== collection\.name/);
});

test("permanent project deletion is serialized through the background write queue", async () => {
  const background = await readFile(new URL("../background.js", import.meta.url), "utf8");
  assert.match(background, /case "DELETE_COLLECTION_WITH_ENTRIES":\s*return enqueue\(async \(\) => deleteCollectionWithEntries\(message\)\)/);
  const handlerStart = background.indexOf("async function deleteCollectionWithEntries");
  const handlerEnd = background.indexOf("function enqueue", handlerStart);
  const handler = background.slice(handlerStart, handlerEnd);
  assert.match(handler, /commitMetadataThenDeleteImages/);
  assert.match(handler, /deleteImages: deleteMediaBlobs/);
});
