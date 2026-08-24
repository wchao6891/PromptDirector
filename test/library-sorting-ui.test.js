import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const [html, source, css] = await Promise.all([
  readFile(new URL("../library.html", import.meta.url), "utf8"),
  readFile(new URL("../library.js", import.meta.url), "utf8"),
  readFile(new URL("../library.css", import.meta.url), "utf8")
]);

test("library exposes four case sorts and keeps project structure management on demand", () => {
  const gallerySort = html.slice(html.indexOf('id="gallery-sort"'), html.indexOf("</select>", html.indexOf('id="gallery-sort"')));
  assert.match(gallerySort, /value="added-desc"[^>]*>最近加入/);
  assert.match(gallerySort, /value="updated-desc"[^>]*>最近更新/);
  assert.match(gallerySort, /value="title"[^>]*>标题/);
  assert.match(gallerySort, /value="project-manual"[^>]*hidden[^>]*>手动排序/);
  assert.doesNotMatch(gallerySort, /最早加入|项目手动顺序/);
  assert.match(html, /id="manage-case-order"[^>]*aria-label="管理案例顺序"/);

  assert.doesNotMatch(html, /id="project-sort"|最近创建|项目排序/);
  assert.match(html, /id="manage-project-order"[^>]*aria-label="管理项目结构"/);
});

test("sidebar keeps the recycle bin without smart or import-batch views", () => {
  assert.match(html, /id="open-trash"/);
  assert.doesNotMatch(html, /智能入口|未归项目|id="smart-unassigned"|id="import-batch-filters"/);
  assert.doesNotMatch(source, /renderSmartFilters|filterCasesByImportBatch|filterUnassignedCases/);
});

test("case manual ordering is gated to an unfiltered project and project tree uses direct drag", () => {
  const availability = source.slice(source.indexOf("function projectManualOrderAvailable"), source.indexOf("function syncGallerySortControl"));
  assert.match(availability, /selectedCollectionId/);
  assert.match(availability, /!selectedContentId/);
  assert.match(availability, /!selectedFacets\.size/);
  assert.match(availability, /!elements\.pendingFilter\.checked/);
  assert.match(availability, /!elements\.searchInput\.value\.trim\(\)/);
  assert.match(source, /moveProjectLogicalCase/);
  assert.match(source, /type: "REPLACE_COLLECTION_ENTRIES"/);
  assert.match(source, /caseOrderManagementActive && projectManualOrderAvailable/);
  assert.match(source, /projectOrderManagementActive/);
  assert.match(source, /createUiIcon\(caseOrderManagementActive \? "circle-check-big" : "sliders-horizontal"\)/);
  assert.match(source, /row\.addEventListener\("pointerdown"/);
  assert.match(source, /row\.addEventListener\("pointermove"/);
  assert.match(source, /"ArrowLeft", "ArrowRight", "Home", "End"/);
  assert.match(source, /type: "MOVE_COLLECTION", collectionId, parentId, index/);
  assert.match(source, /position === "inside"/);
  assert.match(source, /menu\.hidden = projectOrderManagementActive/);
  assert.match(css, /\.project-row\.project-ordering/);
  assert.match(css, /\.project-row\.project-ordering\s*\{[^}]*user-select:\s*none/);
  assert.match(source, /elements\.manageProjectOrder\.disabled = projectOrderingUnavailable/);
  assert.match(source, /"结束案例选择后可管理项目结构"/);
  assert.doesNotMatch(source, /elements\.manageProjectOrder\.hidden = Boolean\(selectionMode\)/);
  assert.doesNotMatch(source, /createUiIcon\("arrow-(?:up|down)"\)/);
});

test("project tree rendering indexes children once and traverses deep trees iteratively", () => {
  const render = source.slice(source.indexOf("function renderProjectFilters"), source.indexOf("function projectChildren"));
  assert.match(render, /const childrenByParent = indexProjectChildren\(\)/);
  assert.match(render, /while \(pendingCollections\.length\)/);
  assert.doesNotMatch(render, /appendVisible|renderProjectFilters\([^)]*depth/);

  const index = source.slice(source.indexOf("function indexProjectChildren"), source.indexOf("function toggleProjectOrderManagement"));
  assert.match(index, /const result = new Map\(\)/);
  assert.match(index, /for \(const collection of organizerState\.collections\)/);
});

test("gallery sorting and selection share a quiet secondary toolbar", () => {
  assert.match(css, /\.gallery-sort-field select\s*\{[^}]*border-color:\s*transparent[^}]*background-color:\s*transparent/);
  assert.match(css, /\.gallery-view-controls > \.icon-button\s*\{[^}]*border-color:\s*transparent[^}]*background:\s*transparent/);
});

test("saving project membership retains the existing manual order before appending new cases", () => {
  const save = source.slice(source.indexOf("async function saveProjectSelection"), source.indexOf("async function shareProjectCollection"));
  assert.match(save, /retainedOrder = \(collection\?\.entryIds \?\? \[\]\)\.filter/);
  assert.match(save, /entryIds = \[\.\.\.retainedOrder, \.\.\.selectedEntryIds\.filter/);
  assert.match(save, /type: "REPLACE_COLLECTION_ENTRIES"/);
});

test("library return snapshot saves persistent sorting but not transient management state", () => {
  const snapshot = source.slice(source.indexOf("function saveLibraryReturnSnapshot"), source.indexOf("function restoreLibraryScrollPosition"));
  assert.match(snapshot, /sortMode: caseSortMode/);
  assert.match(snapshot, /snapshot\.sortMode/);
  assert.doesNotMatch(snapshot, /projectSortMode|caseOrderManagementActive|projectOrderManagementActive|smartScope/);
});
