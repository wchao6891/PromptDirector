import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const background = await readFile(new URL("../background.js", import.meta.url), "utf8");

test("cross-page draft parts save as one case unless the user targeted an existing compound", () => {
  const commit = sourceBlock("async function commitCaptureDraft", "async function commitCaptureIntoCompound");
  assert.doesNotMatch(commit, /parts\.length\s*>\s*1/);
  assert.match(commit, /targetCompound/);
  assert.match(commit, /if \(targetCompound\) return commitCaptureIntoCompound/);
  assert.match(commit, /explicitTarget/);
});

function sourceBlock(start, end) {
  const startIndex = background.indexOf(start);
  const endIndex = background.indexOf(end, startIndex + start.length);
  assert.ok(startIndex >= 0 && endIndex > startIndex, `missing source block: ${start}`);
  return background.slice(startIndex, endIndex);
}
