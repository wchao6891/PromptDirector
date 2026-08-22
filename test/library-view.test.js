import test from "node:test";
import assert from "node:assert/strict";

import {
  CASE_SORT_MODES,
  PROJECT_SORT_MODES,
  caseViewProjection,
  moveProjectLogicalCase,
  sortLibraryCases,
  sortProjects
} from "../library-view.js";

test("recently added sorting uses the local join time and only views old savedAt as a fallback", () => {
  const cases = [
    entry("historical", { savedAt: "2025-01-01T00:00:00.000Z" }),
    entry("new-import", {
      savedAt: "2020-01-01T00:00:00.000Z",
      libraryAddedAt: "2026-08-20T00:00:00.000Z"
    }),
    entry("older-import", {
      savedAt: "2026-08-19T00:00:00.000Z",
      libraryAddedAt: "2026-08-19T00:00:00.000Z"
    })
  ];
  const before = structuredClone(cases);

  assert.deepEqual(
    sortLibraryCases(cases).map((item) => item.id),
    ["new-import", "older-import", "historical"]
  );
  assert.deepEqual(
    sortLibraryCases(cases, { mode: CASE_SORT_MODES.updatedDesc }).map((item) => item.id),
    ["older-import", "historical", "new-import"]
  );
  assert.deepEqual(cases, before);
  assert.equal("libraryAddedAt" in cases[0], false);
});

test("compound view time projects from the compound and its saved members", () => {
  const compound = compoundEntry("compound:board", [
    entry("member-old", {
      savedAt: "2024-01-01T00:00:00.000Z",
      importBatchId: "batch:old"
    }),
    entry("member-new", {
      savedAt: "2020-01-01T00:00:00.000Z",
      libraryAddedAt: "2026-08-18T00:00:00.000Z",
      libraryUpdatedAt: "2026-08-22T00:00:00.000Z",
      updatedAt: "2026-09-19T00:00:00.000Z",
      importBatchId: "batch:new"
    })
  ], {
    createdAt: "2026-08-20T00:00:00.000Z",
    libraryUpdatedAt: "2026-08-21T00:00:00.000Z",
    updatedAt: "2026-09-21T00:00:00.000Z"
  });

  assert.deepEqual(caseViewProjection(compound), {
    memberEntryIds: ["member-old", "member-new"],
    importBatchIds: ["batch:old", "batch:new"],
    addedAt: "2026-08-20T00:00:00.000Z",
    updatedAt: "2026-08-22T00:00:00.000Z"
  });
});

test("case sorting supports recent updates, natural titles, stable ties, and project member order", () => {
  const first = entry("first", {
    title: "镜头 10",
    libraryAddedAt: "2026-08-01T00:00:00.000Z",
    libraryUpdatedAt: "2026-08-03T00:00:00.000Z",
    updatedAt: "2026-09-03T00:00:00.000Z"
  });
  const second = entry("second", {
    title: "镜头 2",
    libraryAddedAt: "2026-08-01T00:00:00.000Z",
    libraryUpdatedAt: "2026-08-04T00:00:00.000Z",
    updatedAt: "2026-08-02T00:00:00.000Z"
  });
  const compound = compoundEntry("compound", [entry("member-a"), entry("member-b")]);

  assert.deepEqual(
    sortLibraryCases([second, first], { mode: CASE_SORT_MODES.updatedDesc }).map((item) => item.id),
    ["second", "first"]
  );
  assert.deepEqual(
    sortLibraryCases([first, second], { mode: CASE_SORT_MODES.title }).map((item) => item.id),
    ["second", "first"]
  );
  assert.deepEqual(
    sortLibraryCases([first, second]).map((item) => item.id),
    ["first", "second"]
  );
  assert.deepEqual(
    sortLibraryCases([first, compound, second], {
      mode: CASE_SORT_MODES.projectManual,
      projectEntryIds: ["second", "member-b", "member-a", "first"]
    }).map((item) => item.id),
    ["second", "compound", "first"]
  );
});

test("project sorting supports manual, recent-created, and name modes without inventing dates", () => {
  const projects = [
    { id: "missing-date", name: "项目 10", order: 2 },
    { id: "newer", name: "项目 2", order: 0, createdAt: "2026-08-20T00:00:00.000Z" },
    { id: "older", name: "Alpha", order: 1, createdAt: "2026-08-10T00:00:00.000Z" }
  ];

  assert.deepEqual(sortProjects(projects).map((item) => item.id), ["newer", "older", "missing-date"]);
  assert.deepEqual(
    sortProjects(projects, PROJECT_SORT_MODES.recent).map((item) => item.id),
    ["newer", "older", "missing-date"]
  );
  assert.deepEqual(
    sortProjects(projects, PROJECT_SORT_MODES.name).map((item) => item.id),
    ["older", "newer", "missing-date"]
  );
});

test("moving one logical project case keeps compound members together and untouched raw ids stable", () => {
  const current = compoundEntry("compound", [entry("member-a"), entry("member-b")]);
  const adjacent = entry("adjacent");
  const raw = ["adjacent", "hidden:one", "member-a", "hidden:two", "member-b", "tail"];

  assert.deepEqual(
    moveProjectLogicalCase(raw, current, adjacent, "up"),
    ["member-a", "member-b", "adjacent", "hidden:one", "hidden:two", "tail"]
  );
  assert.deepEqual(
    moveProjectLogicalCase(
      ["member-a", "hidden:one", "member-b", "adjacent", "hidden:two"],
      current,
      adjacent,
      "down"
    ),
    ["hidden:one", "adjacent", "member-a", "member-b", "hidden:two"]
  );
});

function entry(id, overrides = {}) {
  return {
    id,
    title: id,
    savedAt: "2026-08-01T00:00:00.000Z",
    ...overrides
  };
}

function compoundEntry(id, members, compoundOverrides = {}) {
  return {
    id,
    title: id,
    memberEntries: members,
    memberEntryIds: members.map((member) => member.id),
    compoundCase: {
      id,
      memberEntryIds: members.map((member) => member.id),
      createdAt: "2026-08-01T00:00:00.000Z",
      updatedAt: "2026-08-01T00:00:00.000Z",
      ...compoundOverrides
    }
  };
}
