import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const [html, source, icons] = await Promise.all([
  readFile(new URL("../library.html", import.meta.url), "utf8"),
  readFile(new URL("../library.js", import.meta.url), "utf8"),
  readFile(new URL("../assets/ui-icons.svg", import.meta.url), "utf8")
]);

test("selection mode exposes all filtered results, user tags, projects, sharing, and recycle-bin actions", () => {
  const bar = html.slice(html.indexOf('id="share-bar"'), html.indexOf('id="project-selection-title"'));
  for (const id of [
    "selection-select-filtered",
    "selection-clear",
    "selection-label-input",
    "selection-add-labels",
    "selection-project-target",
    "selection-add-project",
    "share-export",
    "selection-trash"
  ]) assert.match(bar, new RegExp(`id="${id}"`));

  const selectAll = source.slice(source.indexOf("function selectAllFilteredCases"), source.indexOf("function clearSelectedCases"));
  assert.match(selectAll, /visibleEntries\.map\(\(entry\) => entry\.id\)/);
  assert.doesNotMatch(selectAll, /renderedCount|caseList\.children/);
  const selectionSync = source.slice(source.indexOf("function replaceSelectedCaseIds"), source.indexOf("function updateSelectionBar"));
  assert.match(selectionSync, /selectedCaseIds\.clear\(\)/);
  assert.match(selectionSync, /updateSelectionBar\(\)/);
  assert.match(source, /LIBRARY_BATCH_ACTIONS\.addCustomLabels/);
  assert.match(source, /LIBRARY_BATCH_ACTIONS\.setProject/);
  assert.match(source, /LIBRARY_BATCH_ACTIONS\.moveToTrash/);
});

test("recycle bin is a first-class workspace action with restore and explicit permanent cleanup", () => {
  assert.match(html, /id="open-trash"/);
  assert.match(html, /id="trash-dialog"/);
  assert.match(icons, /id="icon-trash-2"/);
  assert.match(source, /type: "GET_TRASH_ITEMS"/);
  assert.match(source, /type: "RESTORE_TRASH_ITEMS"/);
  assert.match(source, /type: "PERMANENT_DELETE_TRASH_ITEMS"/);
  assert.match(source, /type: "EMPTY_TRASH"/);
  assert.match(source, /itemIds: relatedTrashGroupIds\(item\)/);
  assert.match(html, /id="trash-restore-all"[^>]*>全部恢复/);
  assert.doesNotMatch(html, /id="trash-refresh"/);
  const restoreAll = source.slice(source.indexOf("async function restoreAllTrashItems"), source.indexOf("function relatedTrashGroupIds"));
  assert.match(restoreAll, /itemIds: trashItems\.map\(\(item\) => item\.id\)/);
  assert.match(restoreAll, /response\.unresolved/);
  const restoreGroup = source.slice(source.indexOf("function relatedTrashGroupIds"), source.indexOf("async function permanentlyDeleteTrashItem"));
  assert.match(restoreGroup, /item\.kind === "collection"/);
  assert.match(restoreGroup, /item\.kind === "entry"/);
  assert.match(restoreGroup, /item\.kind === "media"/);
  assert.match(source, /PERMANENT_DELETE_TRASH_ITEMS", itemIds/);
  assert.match(source, /trashItemPreview/);
  assert.match(source, /hydrateTrashCover/);
  assert.match(source, /createUiIcon\("refresh-cw"\)/);
  assert.doesNotMatch(html, /RECYCLE BIN|删除后会保留在这里/);
});

test("project and case removal use recoverable wording in normal management", () => {
  assert.match(source, /"仅删除项目"/);
  assert.match(source, /"删除项目及案例"/);
  assert.match(source, /createUiIcon\("trash-2"\)/);
  assert.match(source, /这项媒体可从回收站恢复/);
  const projectHandler = source.slice(
    source.indexOf("async function deleteProjectCollectionWithEntries"),
    source.indexOf("function enterProjectSelection")
  );
  assert.doesNotMatch(projectHandler, /永久删除|请输入完整项目名称/);
});
