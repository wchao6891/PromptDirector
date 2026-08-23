import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("background delegates the one explicit sync action to the manual controller", async () => {
  const background = await source();
  assert.match(background, /import\s*\{[^}]*createManualSyncController[^}]*\}\s*from\s*"\.\/manual-sync\.js"/s);
  assert.match(background, /const manualSyncController\s*=\s*createManualSyncController\(/);

  const syncNow = messageBranch(background, "SYNC_NOW", "DISCONNECT_SYNC_FOLDER");
  assert.match(syncNow, /manualSyncController\.start\(/);
  assert.doesNotMatch(syncNow, /schedule|setTimeout|synchronizeNow/);
});

test("sync cancellation and run status remain reachable while the write queue is busy", async () => {
  const background = await source();
  const status = messageBranch(background, "GET_SYNC_RUN_STATUS", "CANCEL_SYNC");
  const cancel = messageBranch(background, "CANCEL_SYNC", "CONNECT_SYNC_FOLDER");

  assert.match(status, /manualSyncController\.status\(\)/);
  assert.doesNotMatch(status, /enqueue/);
  assert.match(cancel, /manualSyncController\.cancel\(\)/);
  assert.doesNotMatch(cancel, /enqueue/);
});

test("business writes persist pending state instead of scheduling background transfer", async () => {
  const background = await source();
  const commit = functionBody(background, "async function commitLocalChanges", "async function persistDomainState");

  assert.match(commit, /markSyncMetaDirty/);
  assert.match(commit, /SYNCED_STORAGE_KEYS/);
  assert.match(commit, /syncApplyInProgress/);
  assert.doesNotMatch(commit, /schedule|setTimeout|synchronize/);
  assert.doesNotMatch(background, /function scheduleAutomaticSync|function scheduleIdleSync/);
});

test("the former full-scan synchronization path is removed after controller wiring", async () => {
  const background = await source();

  assert.doesNotMatch(background, /async function synchronizeWithVault/);
  assert.doesNotMatch(background, /async function prepareStateForSync/);
  assert.doesNotMatch(background, /async function\* syncedImageReplacements/);
});

test("native missing-file and damaged-snapshot failures keep actionable status codes", async () => {
  const background = await source();
  const recorder = functionBody(background, "async function recordSyncError", "async function migrateLegacyScreenshots");

  assert.match(recorder, /syncErrorDetails\(failure\)/);
  assert.match(recorder, /lastErrorCode:\s*details\.code/);
});

function source() {
  return readFile(new URL("../background.js", import.meta.url), "utf8");
}

function messageBranch(sourceValue, type, nextType) {
  const start = sourceValue.indexOf(`case "${type}"`);
  assert.notEqual(start, -1, `${type} handler is missing`);
  const end = sourceValue.indexOf(`case "${nextType}"`, start + 6);
  assert.notEqual(end, -1, `${nextType} boundary is missing`);
  return sourceValue.slice(start, end);
}

function functionBody(sourceValue, startMarker, endMarker) {
  const start = sourceValue.indexOf(startMarker);
  assert.notEqual(start, -1, `${startMarker} is missing`);
  const end = sourceValue.indexOf(endMarker, start + startMarker.length);
  assert.notEqual(end, -1, `${endMarker} boundary is missing`);
  return sourceValue.slice(start, end);
}
