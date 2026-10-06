import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const [html, source, css] = await Promise.all([
  readFile(new URL("../extension/library.html", import.meta.url), "utf8"),
  readFile(new URL("../extension/library.js", import.meta.url), "utf8"),
  readFile(new URL("../extension/library.css", import.meta.url), "utf8")
]);

test("library sorts directly through list headers; manual order belongs to the project menu", () => {
  assert.doesNotMatch(html, /id="gallery-sort"|project-manual-sort-option/);
  assert.match(html, /id="case-list-header"/);
  assert.match(html, /id="gallery-size"[^>]*type="range"/);
  assert.match(source, /nextCaseSortMode\(caseSortMode, column\)/);
  const projectMenu = source.slice(source.indexOf("function createProjectMenu"), source.indexOf("function projectChildren"));
  assert.match(projectMenu, /调整案例顺序/);
  assert.doesNotMatch(projectMenu, /include-subprojects/);
  assert.match(html, /id="browse-scope"[\s\S]*id="include-subprojects"/);
  assert.match(source, /manageCaseOrder.hidden = !caseOrderManagementActive/);
});

test("sidebar derives an unassigned workspace without persisting smart or import-batch views", () => {
  assert.match(html, /id="open-trash"/);
  assert.match(html, /id="workspace-unassigned"[\s\S]*未归项目/);
  assert.match(source, /organizerState\.collections\.flatMap\(\(collection\) => collection\.entryIds\)/);
  assert.match(source, /every\(\(id\) => !assignedEntryIds\.has\(id\)\)/);
  assert.doesNotMatch(html, /智能入口|id="smart-unassigned"|id="import-batch-filters"/);
  assert.doesNotMatch(source, /renderSmartFilters|filterCasesByImportBatch/);
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
  assert.match(source, /function bindCaseOrderDrag/);
  assert.match(source, /card\.addEventListener\("dragstart",[\s\S]*event\.preventDefault\(\)/);
  assert.match(source, /card\.addEventListener\("pointerdown",[\s\S]*event\.preventDefault\(\)/);
  assert.match(source, /drag\.y < bounds\.top \+ bounds\.height \/ 2 \? "up" : "down"/);
  assert.match(source, /function updateCaseOrderDragAutoscroll/);
  assert.match(source, /\["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End"\]/);
  assert.doesNotMatch(source, /case-reorder-controls|case-move-up|case-move-down/);
  assert.match(css, /\.case-card\.manual-project-order\s*\{[^}]*cursor:\s*grab/);
  assert.match(css, /\.case-card\.case-order-drop-before::before/);
  assert.doesNotMatch(css, /\.case-reorder-controls/);
  assert.match(source, /createProjectTreeInteractions/);
  assert.match(source, /move.disabled = projectOrderingUnavailable/);
  assert.match(css, /\.project-row\.project-draggable\s*\{[^}]*user-select:\s*none/);
  assert.doesNotMatch(source, /projectOrderManagementActive|toggleProjectOrderManagement/);
});

test("project tree rendering indexes children once and traverses deep trees iteratively", () => {
  const render = source.slice(source.indexOf("function renderProjectFilters"), source.indexOf("function projectChildren"));
  assert.match(render, /const childrenByParent = indexProjectChildren\(\)/);
  assert.match(render, /projectTreeRows/);
  assert.doesNotMatch(render, /appendVisible|renderProjectFilters\([^)]*depth/);

  const index = source.slice(source.indexOf("function indexProjectChildren"), source.indexOf("function projectTreeController"));
  assert.match(index, /const result = new Map\(\)/);
  assert.match(index, /for \(const collection of organizerState\.collections\)/);
});

test("list headings expose sorting without an extra toolbar dropdown", () => {
  assert.match(css, /\.case-list-columns button/);
  assert.match(css, /aria-sort="ascending"/);
  assert.doesNotMatch(html, /gallery-sort-field/);
});

test("saving project membership sends only the toggled cases so concurrent additions and manual order survive", () => {
  const save = source.slice(source.indexOf("async function saveProjectSelection"), source.indexOf("async function shareProjectCollection"));
  const enter = source.slice(source.indexOf("async function enterProjectSelection"), source.indexOf("async function enterVisionSelection"));
  // The baseline is what the user saw when entering; a stale whole-list replace
  // would silently drop a case an agent or another tab added meanwhile.
  assert.match(enter, /projectSelectionBaseline = \[\.\.\.selectedCaseIds\]/);
  assert.match(save, /\["remove", expandLogicalCaseIds\(\[\.\.\.baseline\]\.filter\(\(id\) => !selectedCaseIds\.has\(id\)\)/);
  assert.match(save, /\["move", expandLogicalCaseIds\(\[\.\.\.selectedCaseIds\]\.filter\(\(id\) => !baseline\.has\(id\)\)/);
  assert.match(save, /type: "BATCH_SET_PROJECT", collectionId, entryIds, mode/);
  assert.doesNotMatch(save, /REPLACE_COLLECTION_ENTRIES/);
});

test("library return snapshot saves persistent sorting but not transient management state", () => {
  const snapshot = source.slice(source.indexOf("function saveLibraryReturnSnapshot"), source.indexOf("function restoreLibraryScrollPosition"));
  assert.match(snapshot, /sortMode: caseSortMode/);
  assert.match(snapshot, /snapshot\.sortMode/);
  assert.doesNotMatch(snapshot, /projectSortMode|caseOrderManagementActive|projectOrderManagementActive|smartScope/);
});
