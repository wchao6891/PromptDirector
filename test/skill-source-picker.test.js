import test from "node:test";
import assert from "node:assert/strict";

import {
  SKILL_SOURCE_BATCH_SIZE,
  availableSkillSourceAssets,
  cloneSkillSourceSelection,
  filterSkillSourceEntries,
  pageSkillSourceEntries,
  skillSourceSelectionSummary
} from "../skill-source-picker.js";

function entry(id, kinds = ["image"], text = "") {
  const mediaAssets = kinds.map((kind, index) => ({
    id: `${id}:${kind}:${index}`,
    kind,
    usage: "content",
    mimeType: kind === "image" ? "image/png" : kind === "video" ? "video/mp4" : "application/pdf"
  }));
  return { id, title: `案例 ${id}`, text, primaryMediaId: mediaAssets[0]?.id ?? "", mediaAssets };
}

test("Skill source picker renders large libraries in the shared 24-case batches", () => {
  const entries = Array.from({ length: 60 }, (_, index) => entry(String(index + 1)));
  const filtered = filterSkillSourceEntries(entries, { query: "案例" });

  assert.equal(SKILL_SOURCE_BATCH_SIZE, 24);
  assert.equal(pageSkillSourceEntries(filtered, SKILL_SOURCE_BATCH_SIZE).length, 24);
  assert.equal(pageSkillSourceEntries(filtered, SKILL_SOURCE_BATCH_SIZE * 2).length, 48);
  assert.equal(pageSkillSourceEntries(filtered, 100).length, 60);
});

test("Skill source picker filters by project and text without changing the source entries", () => {
  const entries = [entry("one"), entry("two"), entry("three")];
  entries[1].title = "目标案例";
  const result = filterSkillSourceEntries(entries, {
    projectEntryIds: new Set(["one", "two"]),
    query: "目标"
  });

  assert.deepEqual(result.map((item) => item.id), ["two"]);
  assert.equal(entries.length, 3);
});

test("Skill source summary separates images videos documents and case text", () => {
  const entries = [
    entry("compound", ["image", "image", "video", "document"], "案例正文"),
    entry("text", [], "只有文字")
  ];
  const selections = new Map([
    ["compound", { entryId: "compound", includeEntryText: true, assetIds: new Set([
      "compound:image:0", "compound:video:2", "compound:document:3"
    ]) }],
    ["text", { entryId: "text", includeEntryText: true, assetIds: new Set() }]
  ]);

  assert.deepEqual(skillSourceSelectionSummary(entries, selections), {
    cases: 2,
    images: 1,
    videos: 1,
    documents: 1,
    texts: 2
  });
});

test("Skill source inspector edits an isolated draft until the user applies it", () => {
  const source = { entryId: "compound", includeEntryText: true, assetIds: new Set(["compound:image:0"]) };
  const draft = cloneSkillSourceSelection(source);
  draft.assetIds.add("compound:video:2");
  draft.includeEntryText = false;

  assert.deepEqual([...source.assetIds], ["compound:image:0"]);
  assert.equal(source.includeEntryText, true);
  assert.deepEqual([...draft.assetIds], ["compound:image:0", "compound:video:2"]);
  assert.equal(draft.includeEntryText, false);
});

test("poster assets never enter precise Skill source selection", () => {
  const item = entry("video", ["video"]);
  item.mediaAssets.push({ id: "poster", kind: "image", usage: "poster", mimeType: "image/jpeg" });
  assert.deepEqual(availableSkillSourceAssets(item).map((asset) => asset.id), ["video:video:0"]);
});
