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

test("background exposes tree moves without rebuilding member lists", () => {
  assert.match(background, /case "REORDER_COLLECTIONS":\s*case "MOVE_COLLECTION":\s*case "REPLACE_COLLECTION_ENTRIES"/);
  const update = functionBlock("updateOrganizer", "decideAnalysisCandidate");
  assert.match(update, /reorderCollections\(organizerState, message\.collectionIds\)/);
  assert.match(update, /moveCollection\(organizerState, message\.collectionId, message\.parentId, message\.index\)/);
  assert.match(update, /replaceCollectionEntries\(organizerState, message\.collectionId, entryIds\)/);
  assert.match(update, /changedProjectEntryIds\(beforeOrganizer, organizerState\)/);
});

test("manual content edits use one library update timestamp boundary", () => {
  for (const name of [
    "setEntryPrimaryVisual",
    "addUploadedVisual",
    "setEntryPrimaryMedia",
    "moveEntryMediaToTrash",
    "addUploadedMedia",
    "addEntryTimeNote",
    "addVideoKeyframe",
    "deleteEntryTimeNote",
    "updateEntryMediaPromptAction",
    "updateEntryFacet",
    "updateCaseText",
    "updateCaseTitle",
    "updateEntryCustomLabels"
  ]) {
    const start = background.indexOf(`async function ${name}(`);
    const end = background.indexOf("\nasync function ", start + 1);
    assert.ok(start >= 0 && end > start, `${name} should exist`);
    assert.match(background.slice(start, end), /touchEntr(?:y|ies)\(/, `${name} should touch user-visible update time`);
  }
  assert.match(background, /function touchEntry\(entry, updatedAt = new Date\(\)\.toISOString\(\)\)/);
});

test("project membership changes touch cases but pure project ordering does not", () => {
  const batch = functionBlock("batchSetProject", "updateOrganizer");
  assert.match(batch, /changedProjectEntryIds\(beforeOrganizer, organizerState\)/);
  assert.match(batch, /touchEntries\(state\.entries, changedEntryIds\)/);

  const helperStart = background.indexOf("function changedProjectEntryIds(");
  const helperEnd = background.indexOf("\nfunction requireAnalysisBatch", helperStart);
  const helper = background.slice(helperStart, helperEnd);
  assert.match(helper, /collection\.entryIds/);
  assert.doesNotMatch(helper, /collection\.order/);
});
