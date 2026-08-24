import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const source = await readFile(new URL("../skills-page.js", import.meta.url), "utf8");

test("Skill source projects display full paths and include descendant cases", () => {
  assert.match(source, /collectionSelectorLabelsById\(organizerState\)/);
  assert.match(source, /collectionEntryIds\(organizerState, projectId, \{ subtree: true \}\)/);
  assert.doesNotMatch(source, /projectId \? new Set\(organizerState\.collections\.find/);
});
