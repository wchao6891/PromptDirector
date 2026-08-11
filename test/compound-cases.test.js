import test from "node:test";
import assert from "node:assert/strict";

import {
  createCompoundCase,
  expandLogicalCaseIds,
  materializeLogicalCases,
  normalizeCompoundCases,
  splitCompoundCase,
  updateCompoundCase
} from "../compound-cases.js";

const entries = [
  entry("one", "分镜提示词", "content:prompt:image", "visual-one"),
  entry("two", "角色一致性", "content:tutorial"),
  entry("three", "视频生成", "content:prompt:video", "visual-three")
];

test("compound cases keep original members intact and materialize one searchable logical case", () => {
  const before = structuredClone(entries);
  const created = createCompoundCase([], entries, {
    id: "compound:ad",
    title: "完整广告案例",
    memberEntryIds: ["one", "two", "three"],
    coverVisualId: "visual-three",
    now: "2026-08-01T00:00:00.000Z"
  });
  const logical = materializeLogicalCases(entries, created.compoundCases);

  assert.deepEqual(entries, before);
  assert.equal(logical.length, 1);
  assert.equal(logical[0].id, "compound:ad");
  assert.deepEqual(logical[0].contentTypeIds, ["content:prompt:image", "content:tutorial", "content:prompt:video"]);
  assert.equal(logical[0].primaryVisualId, "visual-three");
  assert.equal(logical[0].memberEntries.length, 3);
  assert.deepEqual(expandLogicalCaseIds(["compound:ad"], created.compoundCases), ["one", "two", "three"]);
});

test("materializing canonical compound cases ignores empty media slots from stored imports", () => {
  const entriesWithEmptyMedia = entries.map((entry, index) => ({
    ...entry,
    mediaAssets: [
      ...(index === 0 ? [undefined] : []),
      { id: `asset-${entry.id}`, kind: "image", usage: "content", storageMode: "managed" }
    ],
    primaryMediaId: `asset-${entry.id}`
  }));
  const compounds = createCompoundCase([], entries, {
    id: "compound:empty-media-slot",
    memberEntryIds: ["one", "two"]
  }).compoundCases;

  const logical = materializeLogicalCases(entriesWithEmptyMedia, compounds);

  assert.equal(logical.find((entry) => entry.id === "compound:empty-media-slot")?.mediaAssets.length, 2);
});

test("removing the second-last member automatically splits without deleting members", () => {
  const compounds = createCompoundCase([], entries, {
    id: "compound:ad",
    memberEntryIds: ["one", "two"]
  }).compoundCases;
  const updated = updateCompoundCase(compounds, entries, "compound:ad", { memberEntryIds: ["one"] });
  assert.equal(updated.split, true);
  assert.deepEqual(updated.compoundCases, []);

  const recreated = createCompoundCase([], entries, { id: "compound:again", memberEntryIds: ["one", "two"] });
  const split = splitCompoundCase(recreated.compoundCases, entries, "compound:again");
  assert.deepEqual(split.memberEntryIds, ["one", "two"]);
  assert.deepEqual(split.compoundCases, []);
});

test("normalization never lets one member disappear into two compound cases", () => {
  const normalized = normalizeCompoundCases([
    { id: "compound:first", title: "First", memberEntryIds: ["one", "two"] },
    { id: "compound:second", title: "Second", memberEntryIds: ["two", "three"] }
  ], entries);
  assert.equal(normalized.length, 1);
  assert.equal(normalized[0].id, "compound:first");
});

test("reordering the primary member and choosing a cover changes the compound display only", () => {
  const created = createCompoundCase([], entries, {
    id: "compound:display",
    memberEntryIds: ["one", "three"]
  });
  const updated = updateCompoundCase(created.compoundCases, entries, "compound:display", {
    memberEntryIds: ["three", "one"],
    coverVisualId: "visual-three"
  });
  const logical = materializeLogicalCases(entries, updated.compoundCases)
    .find((entryValue) => entryValue.id === "compound:display");

  assert.deepEqual(updated.compoundCase.memberEntryIds, ["three", "one"]);
  assert.equal(logical.memberEntries[0].id, "three");
  assert.equal(logical.primaryVisualId, "visual-three");
  assert.equal(entries[0].primaryVisualId, "visual-one");
});

test("compound gallery dates follow saved member cases instead of later organizer edits", () => {
  const entries = [
    { ...entry("one"), savedAt: "2026-07-01T00:00:00.000Z" },
    { ...entry("two"), savedAt: "2026-07-03T00:00:00.000Z" }
  ];
  const compoundCases = normalizeCompoundCases([{
    id: "compound:old",
    title: "较早组合",
    memberEntryIds: ["one", "two"],
    createdAt: "2026-07-04T00:00:00.000Z",
    updatedAt: "2026-08-05T00:00:00.000Z"
  }], entries);
  const logical = materializeLogicalCases(entries, compoundCases)[0];
  assert.equal(logical.savedAt, "2026-07-03T00:00:00.000Z");
});

function entry(id, title, contentId, visualId = "") {
  return {
    id, title, text: `${title}正文`, url: `https://example.com/${id}`,
    savedAt: "2026-08-01T00:00:00.000Z", schemaVersion: 17,
    classification: { pathIds: [contentId], status: "confirmed", source: "manual" },
    visuals: visualId ? [{ id: visualId, sourceUrl: `https://example.com/${id}` }] : [],
    primaryVisualId: visualId,
    facetAssignments: [], analysisCandidates: [], analysisBreakdown: [], customLabels: []
  };
}
