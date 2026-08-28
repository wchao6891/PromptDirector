import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const background = await readFile(new URL("../background.js", import.meta.url), "utf8");

test("library import commits business data and its completed receipt atomically", () => {
  const apply = background.slice(
    background.indexOf("async function applyLibraryImport"),
    background.indexOf("function previewCuratedImport")
  );

  assert.match(apply, /claimLibraryImportTransaction/);
  assert.match(apply, /planValue:\s*message\.plan/);
  assert.match(apply, /planLibraryTransfer\(/);
  assert.match(apply, /sourceType:\s*message\.plan\?\.sourceType/);
  assert.match(apply, /result\.planToken\s*!==\s*message\.planToken/);
  assert.match(apply, /IMPORT_TRANSACTION_PENDING/);
  assert.match(apply, /succeedLibraryImportTransaction/);
  assert.match(apply, /\[STORAGE_KEYS\.libraryImportTransactions\]:\s*completed\.state/);
  assert.match(apply, /await commitLocalChanges\(\{[\s\S]*storagePayload\(result\.targetState\)[\s\S]*completed\.state/);
  assert.match(apply, /failLibraryImportTransaction/);
});
