import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const background = await readFile(new URL("../background.js", import.meta.url), "utf8");

function functionBlock(name, nextName) {
  const start = background.indexOf(`async function ${name}(`);
  const end = background.indexOf(`async function ${nextName}(`, start + 1);
  assert.ok(start >= 0, `${name} should exist`);
  assert.ok(end > start, `${nextName} should follow ${name}`);
  return background.slice(start, end);
}

test("all user-facing case, media, and project deletion routes move metadata to trash", () => {
  assert.match(background, /case "DELETE_ENTRY":\s*return enqueue\(async \(\) => deleteEntry\(message\.entryId\)\)/);
  assert.match(background, /case "BATCH_MOVE_TO_TRASH":\s*return enqueue\(async \(\) => moveEntryBatchToTrash\(message\.entryIds\)\)/);
  assert.match(background, /case "DELETE_ENTRY_MEDIA":\s*return enqueue\(async \(\) => deleteEntryMedia/);
  assert.match(background, /case "DELETE_ENTRY_VISUAL":\s*return enqueue\(async \(\) => deleteEntryVisual/);
  assert.match(background, /case "DELETE_COLLECTION_WITH_ENTRIES":\s*return enqueue\(async \(\) => deleteCollectionWithEntries/);

  const caseDeletion = functionBlock("deleteEntry", "deleteCollectionWithEntries");
  assert.match(caseDeletion, /moveEntryBatchToTrash/);
  assert.doesNotMatch(caseDeletion, /deleteMediaBlob|deleteScreenshotBlob/);
  const mediaDeletion = functionBlock("moveEntryMediaToTrash", "addUploadedMedia");
  assert.match(mediaDeletion, /moveMediaToTrash/);
  assert.doesNotMatch(mediaDeletion, /deleteMediaBlob|deleteScreenshotBlob/);
  const projectDeletion = functionBlock("deleteCollectionWithEntries", "moveEntryBatchToTrash");
  assert.match(projectDeletion, /moveCollectionWithEntriesToTrash/);
  assert.doesNotMatch(projectDeletion, /deleteMediaBlob|deleteScreenshotBlob/);
});

test("trash restore and irreversible cleanup have separate explicit message contracts", () => {
  for (const type of ["GET_TRASH_ITEMS", "RESTORE_TRASH_ITEMS", "PERMANENT_DELETE_TRASH_ITEMS", "EMPTY_TRASH"]) {
    assert.match(background, new RegExp(`case "${type}"`));
  }
  const cleanup = functionBlock("commitTrashCleanup", "restrictLocalStorageAccess");
  assert.match(cleanup, /commitMetadataThenDeleteImages/);
  assert.match(cleanup, /deleteMediaBlobs/);
  assert.match(cleanup, /screenshotStorageKey/);
  assert.match(cleanup, /永久删除/);
});

test("free-label and project batch actions are wired with additive and move modes", () => {
  for (const type of ["UPDATE_ENTRY_CUSTOM_LABELS", "BATCH_ADD_CUSTOM_LABELS", "BATCH_SET_PROJECT"]) {
    assert.match(background, new RegExp(`case "${type}"`));
  }
  const labels = functionBlock("updateEntryCustomLabels", "batchAddCustomLabels");
  assert.match(labels, /customLabels/);
  const projects = functionBlock("batchSetProject", "updateOrganizer");
  assert.match(projects, /message\.mode === "move"/);
  assert.match(projects, /removeEntriesFromOrganizer/);
  assert.match(projects, /setEntriesCollection/);
});
