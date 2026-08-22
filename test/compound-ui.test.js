import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const source = await readFile(new URL("../library.js", import.meta.url), "utf8");
const styles = await readFile(new URL("../library.css", import.meta.url), "utf8");

test("finishing a compound selection exits selection mode before the gallery refreshes", () => {
  const block = functionBlock("async function saveCompoundSelection()", "async function saveProjectSelection()");
  assert.match(block, /perform\(elements\.projectSelectionSave, message, false\)/);
  assert.ok(block.indexOf('selectionMode = ""') < block.indexOf("await refreshLibrary()"));
  assert.ok(block.indexOf("selectedCaseIds.clear()") < block.indexOf("await refreshLibrary()"));
});

test("compound details expose direct primary-case and cover-image actions", () => {
  const detail = functionBlock("async function renderCompoundDetail", "function createCompoundOrganizer");
  const gallery = functionBlock("async function createDetailMediaGallery", "async function createMediaViewer");
  const organizer = functionBlock("function createCompoundOrganizer", "async function createDetailMediaGallery");

  assert.match(detail, /主要案例/);
  assert.match(detail, /设为主要案例/);
  assert.match(detail, /memberEntryIds:\s*\[member\.id,/);
  assert.match(detail, /coverVisualId:\s*primaryVisual\(member\)\?\.id/);
  assert.match(gallery, /设为组合主图/);
  assert.match(gallery, /compoundCaseId:\s*entry\.id/);
  assert.match(gallery, /coverVisualId:\s*asset\.id/);
  assert.doesNotMatch(organizer, /labeledSelect\("封面"/);
});

test("long compound-part titles wrap fully beside fixed actions", () => {
  assert.match(styles, /\.compound-part-heading\s*>\s*div:first-child\s*\{[^}]*min-width:\s*0/);
  assert.match(styles, /\.compound-part-heading h3\s*\{[^}]*overflow-wrap:\s*anywhere/);
  assert.doesNotMatch(styles, /\.compound-part-heading h3\s*\{[^}]*text-overflow:\s*ellipsis/);
  assert.match(styles, /\.compound-part-heading-actions\s*\{[^}]*flex:\s*0 0 auto/);
});

test("splitting a compound is a visible top-level action instead of a hidden organizer control", () => {
  const detail = functionBlock("async function renderCompoundDetail", "function createCompoundOrganizer");
  const organizer = functionBlock("function createCompoundOrganizer", "async function createDetailMediaGallery");
  assert.match(detail, /createCompoundActions\(entry\)/);
  assert.doesNotMatch(organizer, /SPLIT_COMPOUND_CASE|拆分为独立案例/);
  assert.match(source, /function createCompoundActions[\s\S]*SPLIT_COMPOUND_CASE/);
});

function functionBlock(start, end) {
  const startIndex = source.indexOf(start);
  const endIndex = source.indexOf(end, startIndex + start.length);
  assert.ok(startIndex >= 0 && endIndex > startIndex, `missing source block: ${start}`);
  return source.slice(startIndex, endIndex);
}
