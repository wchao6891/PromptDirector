import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const background = await readFile(new URL("../extension/background.js", import.meta.url), "utf8");

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

test("a capture that reuses another case's original keeps it protected until the save finishes", () => {
  const commit = sourceBlock("async function commitPageCapture", "async function fetchSelectedPageSessionMedia");
  assert.doesNotMatch(commit, /existing && await getMediaBlob\(existing\.id\)/, "reuse must go through the protecting helper");
  assert.equal(commit.match(/existing && await reusableCaptureAsset\(existing\)/g)?.length, 3, "documents, videos and images are all protected");
  const helper = sourceBlock("async function reusableCaptureAsset", "async function commitPageCapture");
  assert.ok(helper.indexOf("activeCaptureAssetIds.add(asset.id)") < helper.indexOf("getMediaBlob(asset.id)"), "protect before confirming the file exists");
  assert.match(helper, /activeCaptureAssetIds\.add\(asset\.posterAssetId\)/);
  const agentCapture = sourceBlock('if (operation === "capture")', 'if (operation === "save_material")');
  assert.match(agentCapture, /finally \{ activeCaptureAssetIds\.clear\(\); \}/, "agent captures release the guard too");
});
