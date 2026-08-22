import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const source = await readFile(new URL("../background.js", import.meta.url), "utf8");

test("background imports inert local references without reading a managed media blob", () => {
  const start = source.indexOf("async function startImportJobAction");
  const end = source.indexOf("async function getImportJobAction", start);
  const action = source.slice(start, end);
  assert.match(action, /isLocalReference[\s\S]*addStagedAsset\(staging, value\)[\s\S]*continue;[\s\S]*getMediaBlob\(assetId\)/u);

  const itemStart = source.indexOf("async function importStagedItem");
  const itemEnd = source.indexOf("function importedEntryFromStagedAsset", itemStart);
  const item = source.slice(itemStart, itemEnd);
  assert.match(item, /staged\.storageMode !== "reference" && !await getMediaBlob/u);
});

test("relink metadata action touches the case and never accepts a file handle", () => {
  assert.match(source, /case "UPDATE_LOCAL_ASSET_REFERENCE"/u);
  const start = source.indexOf("async function updateLocalAssetReferenceAction");
  const end = source.indexOf("async function addUploadedMedia", start);
  const action = source.slice(start, end);
  assert.match(action, /updateLocalAssetReferenceMetadata/u);
  assert.match(action, /const entry = touchEntry\(updated\.entry\)/u);
  assert.doesNotMatch(action, /handle|saveLocalAssetHandle|saveMediaBlob/u);
});
