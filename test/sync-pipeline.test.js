import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("a sync cycle uploads local images once and reuses their object references", async () => {
  const background = await readFile(new URL("../background.js", import.meta.url), "utf8");
  const cycle = background.slice(
    background.indexOf("async function synchronizeWithVault"),
    background.indexOf("async function prepareStateForSync")
  );

  assert.equal((cycle.match(/prepareStateForSync\(/g) ?? []).length, 1);
  assert.match(cycle, /const localImageRefs = collectSyncImageReferences\(localPrepared\)/);
  assert.match(cycle, /replaceImagesWithRollback/);
  assert.match(cycle, /syncedImageReplacements/);
  assert.match(cycle, /attachSyncImageReferences\(merged\.state, merged\.imageRefs\)/);
  assert.match(cycle, /synchronizedStatePayload/);
  assert.equal((cycle.match(/commitLocalChanges\(/g) ?? []).length, 1);
});

test("native missing-file failures are normalized before sync status is stored", async () => {
  const background = await readFile(new URL("../background.js", import.meta.url), "utf8");
  const syncAction = background.slice(
    background.indexOf("async function performSynchronization"),
    background.indexOf("async function synchronizeWithVault")
  );
  const recorder = background.slice(
    background.indexOf("async function recordSyncError"),
    background.indexOf("function normalizeSyncMeta")
  );

  assert.match(syncAction, /recordSyncError\(settings, error\)/);
  assert.match(recorder, /syncErrorDetails\(failure\)/);
  assert.match(recorder, /lastErrorCode:\s*details\.code/);
});
