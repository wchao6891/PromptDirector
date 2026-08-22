import test from "node:test";
import assert from "node:assert/strict";

import {
  TRASH_VERSION,
  createDefaultTrashState,
  emptyTrash,
  listTrashItems,
  moveCollectionsToTrash,
  moveCollectionWithEntriesToTrash,
  moveEntriesToTrash,
  moveMediaToTrash,
  normalizeTrashState,
  restoreTrashItems,
  takeTrashItems
} from "../trash.js";

test("trash state normalizes serializable items and valid deletion times", () => {
  assert.deepEqual(createDefaultTrashState(), { version: TRASH_VERSION, items: [] });
  const normalized = normalizeTrashState({
    version: 0,
    items: [
      {
        id: "trash:entry:one",
        kind: "entry",
        targetId: "one",
        deletedAt: "2026-08-22T08:00:00+08:00",
        snapshot: { id: "one", customLabels: ["喜欢"] },
        relationships: { collections: [{ id: "collection:a", index: 2 }] },
        ignored: () => true
      },
      { id: "trash:broken", kind: "entry", targetId: "", deletedAt: "not-a-date" }
    ]
  });

  assert.deepEqual(normalized, {
    version: TRASH_VERSION,
    items: [{
      id: "trash:entry:one",
      kind: "entry",
      targetId: "one",
      deletedAt: "2026-08-22T00:00:00.000Z",
      snapshot: { id: "one", customLabels: ["喜欢"] },
      relationships: { collections: [{ id: "collection:a", index: 2 }] }
    }]
  });
  assert.doesNotThrow(() => JSON.stringify(normalized));
});

test("listing and permanently taking trash items is pure and returns an explicit physical cleanup plan", () => {
  const state = normalizeTrashState({
    items: [
      {
        id: "trash:entry:one", kind: "entry", targetId: "one", deletedAt: "2026-08-21T00:00:00Z",
        snapshot: {
          id: "one",
          mediaAssets: [
            { id: "managed:image", storageMode: "managed" },
            { id: "linked:video", storageMode: "reference" }
          ]
        },
        relationships: {}
      },
      {
        id: "trash:media:one:image:second", kind: "media", targetId: "image:second", deletedAt: "2026-08-22T00:00:00Z",
        snapshot: { mediaAssets: [{ id: "image:second", storageMode: "managed" }] },
        relationships: { entryId: "one" }
      },
      {
        id: "trash:collection:a", kind: "collection", targetId: "a", deletedAt: "2026-08-20T00:00:00Z",
        snapshot: { id: "a", name: "A" }, relationships: {}
      }
    ]
  });
  const before = structuredClone(state);

  assert.deepEqual(listTrashItems(state).map((item) => item.kind), ["media", "entry", "collection"]);
  assert.deepEqual(listTrashItems(state, { kind: "entry" }).map((item) => item.targetId), ["one"]);
  const taken = takeTrashItems(state, ["trash:entry:one", "trash:media:one:image:second"]);
  assert.deepEqual(state, before);
  assert.deepEqual(taken.trashState.items.map((item) => item.kind), ["collection"]);
  assert.deepEqual(taken.cleanup, {
    entryIds: ["one"],
    collectionIds: [],
    mediaIds: ["managed:image", "image:second"],
    screenshotEntryIds: ["one"]
  });

  const emptied = emptyTrash(state);
  assert.deepEqual(emptied.trashState, createDefaultTrashState());
  assert.deepEqual(emptied.cleanup.collectionIds, ["a"]);
  assert.equal(emptied.takenItems.length, 3);
});

test("restoring a case recreates its project positions and does not duplicate labels", () => {
  const moved = moveEntriesToTrash({
    trashState: {},
    entries: [{ id: "one", title: "案例一", customLabels: ["喜欢"] }, { id: "two" }],
    organizerState: {
      collections: [{ id: "collection:a", name: "A", entryIds: ["one", "two"] }]
    }
  }, ["one"], { deletedAt: "2026-08-22T04:00:00Z" });
  const restored = restoreTrashItems(moved, ["trash:entry:one"]);

  assert.deepEqual(restored.entries.find((entry) => entry.id === "one"), {
    id: "one", title: "案例一", customLabels: ["喜欢"]
  });
  assert.deepEqual(restored.organizerState.collections[0].entryIds, ["one", "two"]);
  assert.deepEqual(restored.trashState.items, []);
  assert.deepEqual(restored.restoredItemIds, ["trash:entry:one"]);
  assert.deepEqual(restored.unresolved, []);
});

test("project restoration waits for missing members but can restore a project and its trashed case together", () => {
  const trashState = {
    items: [
      {
        id: "trash:collection:project", kind: "collection", targetId: "project", deletedAt: "2026-08-22T00:00:00Z",
        snapshot: { id: "project", name: "项目", order: 0, entryIds: ["one"] }, relationships: {}
      },
      {
        id: "trash:entry:one", kind: "entry", targetId: "one", deletedAt: "2026-08-22T00:01:00Z",
        snapshot: { id: "one", title: "案例" }, relationships: { collections: [] }
      }
    ]
  };
  const partial = restoreTrashItems({ trashState, entries: [], organizerState: {} }, ["trash:collection:project"]);
  assert.deepEqual(partial.organizerState.collections, []);
  assert.deepEqual(partial.unresolved[0].missingEntryIds, ["one"]);
  assert.equal(partial.trashState.items.length, 2);

  const together = restoreTrashItems(
    { trashState, entries: [], organizerState: {} },
    ["trash:collection:project", "trash:entry:one"]
  );
  assert.deepEqual(together.entries, [{ id: "one", title: "案例" }]);
  assert.deepEqual(together.organizerState.collections[0].entryIds, ["one"]);
  assert.deepEqual(together.trashState.items, []);
});

test("restore keeps unresolved items when a relationship is missing or a live id has different content", () => {
  const missingProject = restoreTrashItems({
    entries: [],
    organizerState: { collections: [] },
    trashState: {
      items: [{
        id: "trash:entry:one", kind: "entry", targetId: "one", deletedAt: "2026-08-22T00:00:00Z",
        snapshot: { id: "one", title: "已删除" },
        relationships: { collections: [{ id: "collection:gone", index: 0 }] }
      }]
    }
  }, ["trash:entry:one"]);
  assert.equal(missingProject.entries.length, 0);
  assert.equal(missingProject.trashState.items.length, 1);
  assert.deepEqual(missingProject.unresolved[0].missingCollectionIds, ["collection:gone"]);

  const collision = restoreTrashItems({
    ...missingProject,
    entries: [{ id: "one", title: "当前不同内容" }]
  }, ["trash:entry:one"], { collectionReplacements: { "collection:gone": [] } });
  assert.equal(collision.entries[0].title, "当前不同内容");
  assert.equal(collision.trashState.items.length, 1);
  assert.match(collision.unresolved[0].reason, /同编号/);
});

test("restoring media returns its original relationships when the case has not changed incompatibly", () => {
  const source = {
    id: "case:one",
    mediaAssets: [
      { id: "video:one", kind: "video", storageMode: "managed", mimeType: "video/mp4", capturedAt: "2026-08-20T00:00:00Z" },
      { id: "image:keep", kind: "image", storageMode: "managed", mimeType: "image/webp", capturedAt: "2026-08-20T00:00:00Z" }
    ],
    primaryMediaId: "video:one",
    timeNotes: [{ id: "note:one", assetId: "video:one", startMs: 100, text: "动作", createdAt: "2026-08-20T00:01:00Z" }],
    articleDocument: { version: 1, blocks: [{ id: "video", kind: "video", assetId: "video:one", sourceOrder: 0 }] }
  };
  const moved = moveMediaToTrash({ entries: [source], trashState: {} }, "case:one", ["video:one"], {
    deletedAt: "2026-08-22T05:00:00Z"
  });
  const restored = restoreTrashItems(moved, moved.movedItemIds);

  assert.deepEqual(restored.entries[0].mediaAssets.map((asset) => asset.id), ["video:one", "image:keep"]);
  assert.equal(restored.entries[0].primaryMediaId, "video:one");
  assert.equal(restored.entries[0].timeNotes[0].id, "note:one");
  assert.equal(restored.entries[0].articleDocument.blocks[0].assetId, "video:one");
  assert.deepEqual(restored.trashState.items, []);
});

test("moving media to trash keeps its poster and case-local relationships without deleting blobs", () => {
  const entry = {
    id: "case:video",
    title: "视频案例",
    mediaAssets: [
      {
        id: "video:one", kind: "video", storageMode: "managed", mimeType: "video/mp4",
        posterAssetId: "poster:one", capturedAt: "2026-08-20T00:00:00Z"
      },
      {
        id: "poster:one", kind: "image", usage: "poster", storageMode: "managed", mimeType: "image/webp",
        derivedFromAssetId: "video:one", capturedAt: "2026-08-20T00:00:00Z"
      },
      { id: "image:keep", kind: "image", storageMode: "managed", mimeType: "image/webp", capturedAt: "2026-08-20T00:00:00Z" }
    ],
    primaryMediaId: "video:one",
    timeNotes: [{ id: "note:one", assetId: "video:one", startMs: 1000, text: "转场", createdAt: "2026-08-20T00:01:00Z" }],
    videoAnalyses: [{ id: "analysis:one", assetId: "video:one", text: "分析", createdAt: "2026-08-20T00:02:00Z" }],
    articleDocument: {
      version: 1,
      blocks: [
        { id: "text", kind: "paragraph", text: "正文", sourceOrder: 0 },
        { id: "video", kind: "video", assetId: "video:one", sourceOrder: 1 }
      ]
    }
  };
  const moved = moveMediaToTrash({ trashState: {}, entries: [entry] }, "case:video", ["video:one"], {
    deletedAt: "2026-08-22T03:00:00Z"
  });

  assert.deepEqual(moved.entries[0].mediaAssets.map((asset) => asset.id), ["image:keep"]);
  assert.deepEqual(moved.entries[0].timeNotes, []);
  assert.deepEqual(moved.entries[0].videoAnalyses, []);
  assert.deepEqual(moved.entries[0].articleDocument.blocks.map((block) => block.id), ["text"]);
  assert.deepEqual(moved.trashState.items[0].snapshot.mediaAssets.map((asset) => asset.id), ["video:one", "poster:one"]);
  assert.deepEqual(moved.trashState.items[0].relationships.positions, [
    { id: "video:one", index: 0 },
    { id: "poster:one", index: 1 }
  ]);
  assert.equal(moved.trashState.items[0].relationships.entryId, "case:video");
  assert.equal(moved.trashState.items[0].relationships.primaryMediaId, "video:one");
  assert.deepEqual(moved.pendingBlobDeletes, []);
});

test("moving a project to trash leaves its member cases active", () => {
  const moved = moveCollectionsToTrash({
    trashState: {},
    entries: [{ id: "one" }, { id: "two" }],
    organizerState: {
      collections: [
        { id: "collection:a", name: "项目 A", order: 0, entryIds: ["one", "two"] },
        { id: "collection:b", name: "项目 B", order: 1, entryIds: ["two"] }
      ]
    }
  }, ["collection:a"], { deletedAt: "2026-08-22T02:00:00Z" });

  assert.deepEqual(moved.entries, [{ id: "one" }, { id: "two" }]);
  assert.deepEqual(moved.organizerState.collections.map((item) => item.id), ["collection:b"]);
  assert.deepEqual(moved.trashState.items[0], {
    id: "trash:collection:collection:a",
    kind: "collection",
    targetId: "collection:a",
    deletedAt: "2026-08-22T02:00:00.000Z",
    snapshot: {
      id: "collection:a",
      name: "项目 A",
      order: 0,
      entryIds: ["one", "two"],
      visibility: "library"
    },
    relationships: {}
  });
});

test("moving a case to trash keeps its labels and exact project memberships without ghost references", () => {
  const source = {
    trashState: createDefaultTrashState(),
    entries: [
      { id: "one", title: "案例一", customLabels: ["老板喜欢", "第二版"] },
      { id: "two", title: "案例二", customLabels: [] }
    ],
    organizerState: {
      version: 6,
      collections: [
        { id: "collection:a", name: "A", order: 0, entryIds: ["two", "one"] },
        { id: "collection:b", name: "B", order: 1, entryIds: ["one"] }
      ]
    }
  };

  const moved = moveEntriesToTrash(source, ["one", "one", "missing"], {
    deletedAt: "2026-08-22T09:30:00+08:00"
  });
  assert.deepEqual(moved.entries.map((entry) => entry.id), ["two"]);
  assert.deepEqual(moved.organizerState.collections.map((collection) => collection.entryIds), [["two"], []]);
  assert.deepEqual(moved.movedItemIds, ["trash:entry:one"]);
  assert.deepEqual(moved.trashState.items[0], {
    id: "trash:entry:one",
    kind: "entry",
    targetId: "one",
    deletedAt: "2026-08-22T01:30:00.000Z",
    snapshot: { id: "one", title: "案例一", customLabels: ["老板喜欢", "第二版"] },
    relationships: {
      collections: [
        { id: "collection:a", index: 1 },
        { id: "collection:b", index: 0 }
      ]
    }
  });

  const repeated = moveEntriesToTrash(moved, ["one"], { deletedAt: "2026-08-23T00:00:00Z" });
  assert.deepEqual(repeated, { ...moved, movedItemIds: [] });
});

test("moving a project with its cases preserves project and compound relationships until permanent deletion", () => {
  const source = {
    trashState: createDefaultTrashState(),
    entries: [
      { id: "one", title: "A", mediaAssets: [{ id: "image:one", kind: "image", storageMode: "managed", capturedAt: "2026-08-20T00:00:00Z" }] },
      { id: "two", title: "B", mediaAssets: [{ id: "image:two", kind: "image", storageMode: "managed", capturedAt: "2026-08-20T00:00:00Z" }] }
    ],
    organizerState: {
      collections: [{ id: "collection:a", name: "项目 A", order: 0, entryIds: ["one", "two"] }]
    },
    compoundCases: [{
      id: "compound:a",
      title: "组合",
      memberEntryIds: ["one", "two"],
      coverVisualId: "image:one",
      customLabels: ["成套"],
      createdAt: "2026-08-20T00:00:00Z",
      updatedAt: "2026-08-20T00:00:00Z"
    }]
  };
  const moved = moveCollectionWithEntriesToTrash(source, "collection:a", {
    deletedAt: "2026-08-22T06:00:00Z"
  });

  assert.deepEqual(moved.entries, []);
  assert.deepEqual(moved.organizerState.collections, []);
  assert.deepEqual(moved.compoundCases, []);
  assert.equal(moved.trashState.items.length, 3);
  assert.deepEqual(
    moved.trashState.items.find((item) => item.id === "trash:entry:one").relationships.collections,
    [{ id: "collection:a", index: 0 }]
  );
  assert.equal(
    moved.trashState.items.find((item) => item.id === "trash:entry:one").relationships.compoundCases[0].id,
    "compound:a"
  );

  const restored = restoreTrashItems(moved, moved.movedItemIds);
  assert.deepEqual(restored.entries.map((entry) => entry.id), ["one", "two"]);
  assert.deepEqual(restored.organizerState.collections[0].entryIds, ["one", "two"]);
  assert.deepEqual(restored.compoundCases[0].memberEntryIds, ["one", "two"]);
  assert.deepEqual(restored.trashState.items, []);
});

test("media trash restores visual-derived labels and permanent cleanup protects active shared blobs", () => {
  const entry = {
    id: "case:one",
    mediaAssets: [
      { id: "image:shared", kind: "image", storageMode: "managed", capturedAt: "2026-08-20T00:00:00Z" },
      { id: "image:keep", kind: "image", storageMode: "managed", capturedAt: "2026-08-20T00:00:00Z" }
    ],
    facetAssignments: [
      { facetId: "look", nodeId: "look:cinematic", source: "vision_model", visualId: "image:shared" },
      { facetId: "tone", nodeId: "tone:warm", source: "manual" }
    ]
  };
  const moved = moveMediaToTrash({ entries: [entry], trashState: {} }, entry.id, ["image:shared"], {
    deletedAt: "2026-08-22T07:00:00Z"
  });
  assert.deepEqual(moved.entries[0].facetAssignments.map((item) => item.nodeId), ["tone:warm"]);
  const restored = restoreTrashItems(moved, moved.movedItemIds);
  assert.deepEqual(restored.entries[0].facetAssignments.map((item) => item.nodeId), ["tone:warm", "look:cinematic"]);

  const taken = takeTrashItems(moved.trashState, moved.movedItemIds, { retainedMediaIds: ["image:shared"] });
  assert.deepEqual(taken.cleanup.mediaIds, []);
});
