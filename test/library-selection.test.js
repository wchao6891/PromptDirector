import test from "node:test";
import assert from "node:assert/strict";

import {
  LIBRARY_BATCH_ACTIONS,
  buildLibraryBatchPayload,
  clearLibrarySelection,
  expandLibrarySelection,
  normalizeSelectedLogicalCaseIds,
  selectAllFilteredLogicalCases,
  toggleLibraryCaseSelection
} from "../library-selection.js";

test("select all uses every filtered logical result rather than the rendered page", () => {
  const filteredLogicalCaseIds = Array.from({ length: 73 }, (_, index) => `case:${index + 1}`);
  const renderedPageIds = filteredLogicalCaseIds.slice(0, 24);

  const selected = selectAllFilteredLogicalCases(filteredLogicalCaseIds);

  assert.equal(renderedPageIds.length, 24);
  assert.equal(selected.length, 73);
  assert.deepEqual(selected, filteredLogicalCaseIds);
});

test("selection can be normalized, toggled, and explicitly cleared without mutating input", () => {
  const original = [" case:one ", "case:two", "case:one", ""];
  const normalized = normalizeSelectedLogicalCaseIds(original);
  const removed = toggleLibraryCaseSelection(normalized, "case:one");
  const added = toggleLibraryCaseSelection(removed, "case:three");

  assert.deepEqual(original, [" case:one ", "case:two", "case:one", ""]);
  assert.deepEqual(normalized, ["case:one", "case:two"]);
  assert.deepEqual(removed, ["case:two"]);
  assert.deepEqual(added, ["case:two", "case:three"]);
  assert.deepEqual(clearLibrarySelection(), []);
});

test("logical compound selections expand to stable unique member entry ids", () => {
  const compounds = [{
    id: "compound:campaign",
    memberEntryIds: ["entry:visual", "entry:copy", "entry:visual"]
  }];

  assert.deepEqual(
    expandLibrarySelection(["entry:standalone", "compound:campaign", "entry:copy"], compounds),
    ["entry:standalone", "entry:visual", "entry:copy"]
  );
});

test("free-tag batch payload expands compounds and normalizes optional labels", () => {
  const compounds = [{ id: "compound:one", memberEntryIds: ["entry:a", "entry:b"] }];
  const tagged = buildLibraryBatchPayload(["compound:one"], compounds, {
    type: LIBRARY_BATCH_ACTIONS.addCustomLabels,
    customLabels: ["  暖色氛围  ", "暖色 氛围", "客户A", "客户a", ""]
  });
  const withoutLabels = buildLibraryBatchPayload(["entry:c"], compounds, {
    type: LIBRARY_BATCH_ACTIONS.addCustomLabels
  });

  assert.deepEqual(tagged, {
    type: "BATCH_ADD_CUSTOM_LABELS",
    entryIds: ["entry:a", "entry:b"],
    customLabels: ["暖色氛围", "客户A"]
  });
  assert.deepEqual(withoutLabels.customLabels, []);
});

test("project batch payload requires explicit add, remove, or move semantics", () => {
  const added = buildLibraryBatchPayload(["entry:a"], [], {
    type: LIBRARY_BATCH_ACTIONS.setProject,
    collectionId: " collection:campaign ",
    mode: "add"
  });
  const moved = buildLibraryBatchPayload(["entry:a"], [], {
    type: LIBRARY_BATCH_ACTIONS.setProject,
    collectionId: "collection:archive",
    mode: "move"
  });
  const removed = buildLibraryBatchPayload(["entry:a"], [], {
    type: LIBRARY_BATCH_ACTIONS.setProject,
    collectionId: "collection:campaign",
    mode: "remove"
  });

  assert.deepEqual(added, {
    type: "BATCH_SET_PROJECT",
    entryIds: ["entry:a"],
    collectionId: "collection:campaign",
    mode: "add"
  });
  assert.equal(moved.mode, "move");
  assert.equal(removed.mode, "remove");
  assert.throws(
    () => buildLibraryBatchPayload(["entry:a"], [], {
      type: LIBRARY_BATCH_ACTIONS.setProject,
      collectionId: "collection:campaign"
    }),
    /明确选择加入、移出或移动/
  );
});

test("trash payload expands compound members and empty selection is rejected", () => {
  const compounds = [{ id: "compound:one", memberEntryIds: ["entry:a", "entry:b"] }];

  assert.deepEqual(buildLibraryBatchPayload(["compound:one"], compounds, {
    type: LIBRARY_BATCH_ACTIONS.moveToTrash
  }), {
    type: "BATCH_MOVE_TO_TRASH",
    entryIds: ["entry:a", "entry:b"]
  });
  assert.throws(
    () => buildLibraryBatchPayload([], compounds, { type: LIBRARY_BATCH_ACTIONS.moveToTrash }),
    /至少选择一个案例/
  );
});
