import test from "node:test";
import assert from "node:assert/strict";

import {
  SYNC_ERROR_CODES,
  attachSyncImageReferences,
  collectSyncImageReferences,
  createRevisionSnapshot,
  mergeRevisionSnapshots,
  markSyncMetaDirty,
  normalizeSyncMeta,
  normalizeSyncSettings,
  syncErrorDetails,
  syncStateHasContent
} from "../sync-model.js";

test("sync metadata keeps a durable local pending flag separate from changed media ids", () => {
  const value = normalizeSyncMeta({
    logicalClock: 2,
    localDirty: true,
    dirtyAssetIds: ["asset:one", "asset:one", ""],
    assetRefs: { "asset:one": { objectId: "a".repeat(64), contentType: "image/webp" } }
  });

  assert.equal(value.localDirty, true);
  assert.deepEqual(value.dirtyAssetIds, ["asset:one"]);
  assert.equal(value.assetRefs["asset:one"].objectId, "a".repeat(64));
});

test("business writes mark local pending state and only named media as needing rehash", () => {
  const first = markSyncMetaDirty({}, []);
  const second = markSyncMetaDirty(first, ["asset:one", "asset:one"]);

  assert.equal(second.localDirty, true);
  assert.deepEqual(second.dirtyAssetIds, ["asset:one"]);
});

test("merged image references are reused without reading and rewriting every local image", () => {
  const objectId = "a".repeat(64);
  const source = state([{
    ...entry("one", "visual"),
    visuals: [{ id: "visual:one", mimeType: "image/webp" }]
  }]);
  const attached = attachSyncImageReferences(source, {
    "visual:one": { objectId, contentType: "image/webp" }
  });

  assert.equal(source.entries[0].visuals[0].syncObjectId, undefined);
  assert.equal(attached.entries[0].visuals[0].syncObjectId, objectId);
  assert.deepEqual(collectSyncImageReferences(attached), {
    "visual:one": { objectId, contentType: "image/webp" }
  });
});

test("canonical video media references survive sync snapshots without reverting to visuals", () => {
  const objectId = "b".repeat(64);
  const source = state([{
    ...entry("video", "video"),
    mediaAssets: [{ id: "video:one", kind: "video", storageMode: "managed", mimeType: "video/mp4" }],
    primaryMediaId: "video:one"
  }]);
  const attached = attachSyncImageReferences(source, {
    "video:one": { objectId, contentType: "video/mp4" }
  });
  assert.equal(attached.entries[0].mediaAssets[0].syncObjectId, objectId);
  assert.deepEqual(collectSyncImageReferences(attached), {
    "video:one": { objectId, contentType: "video/mp4" }
  });
});

test("external Skill package files keep encrypted object references through sync", async () => {
  const objectId = "c".repeat(64);
  const source = state();
  source.creativeSkills.items.push({
    id: "skill:one",
    callName: "外部 Skill",
    portableId: "external-skill",
    description: "外部文字方法",
    currentVersionId: "skill-version:one",
    versions: [{ id: "skill-version:one", createdAt: "2026-08-06T00:00:00.000Z", skillMarkdown: "# Method" }],
    packageFiles: [{ path: "SKILL.md", assetId: "skill-file:one", mimeType: "text/markdown", byteSize: 12 }]
  });
  const attached = attachSyncImageReferences(source, {
    "skill-file:one": { objectId, contentType: "text/markdown" }
  });
  assert.equal(attached.creativeSkills.items[0].packageFiles[0].syncObjectId, objectId);
  assert.deepEqual(collectSyncImageReferences(attached)["skill-file:one"], {
    objectId,
    contentType: "text/markdown"
  });

  const snapshot = await createRevisionSnapshot(attached, { deviceId: "device-a", logicalClock: 1 });
  const merged = mergeRevisionSnapshots([snapshot]);
  assert.equal(merged.state.creativeSkills.items[0].callName, "外部 Skill");
  assert.deepEqual(merged.imageRefs["skill-file:one"], { objectId, contentType: "text/markdown" });
});

test("temporary composer references keep encrypted media through private sync", async () => {
  const objectId = "d".repeat(64);
  const source = state();
  source.composerSessions.push({
    id: "session:one",
    referenceSnapshots: [{
      entryId: "temp-reference:one",
      sourceType: "temporary",
      alias: "@参考1",
      referenceKind: "reference",
      referenceText: "",
      assetRefs: [{
        assetId: "temp-reference-asset:one",
        kind: "image",
        mimeType: "image/webp",
        name: "lighting.webp",
        byteSize: 12
      }],
      imageRefs: [{ visualId: "temp-reference-asset:one", mimeType: "image/webp" }]
    }]
  });
  const attached = attachSyncImageReferences(source, {
    "temp-reference-asset:one": { objectId, contentType: "image/webp" }
  });
  const asset = attached.composerSessions[0].referenceSnapshots[0].assetRefs[0];
  assert.equal(asset.syncObjectId, objectId);
  assert.deepEqual(collectSyncImageReferences(attached)["temp-reference-asset:one"], {
    objectId,
    contentType: "image/webp"
  });

  const snapshot = await createRevisionSnapshot(attached, { deviceId: "device-a", logicalClock: 1 });
  const merged = mergeRevisionSnapshots([snapshot]);
  assert.equal(merged.state.composerSessions[0].referenceSnapshots[0].sourceType, "temporary");
  assert.deepEqual(merged.imageRefs["temp-reference-asset:one"], { objectId, contentType: "image/webp" });
});

test("trashed entries sync as trash records without becoming active entries", async () => {
  const source = state();
  source.trashState.items.push(trashItem({
    id: "trash:entry:case:one",
    kind: "entry",
    targetId: "case:one",
    snapshot: entry("case:one", "已删除案例")
  }));

  const snapshot = await createRevisionSnapshot(source, { deviceId: "device-a", logicalClock: 1 });
  const merged = mergeRevisionSnapshots([snapshot]);

  assert.equal(snapshot.version, 1);
  assert.equal(merged.state.entries.length, 0);
  assert.equal(merged.state.trashState.items.length, 1);
  assert.equal(merged.state.trashState.items[0].snapshot.id, "case:one");
  assert.equal(syncStateHasContent(merged.state), true);
});

test("managed assets inside entry and media trash snapshots keep their encrypted sync references", async () => {
  const entryObjectId = "e".repeat(64);
  const mediaObjectId = "f".repeat(64);
  const source = state();
  source.trashState.items.push(
    trashItem({
      id: "trash:entry:case:one",
      kind: "entry",
      targetId: "case:one",
      snapshot: {
        ...entry("case:one", "已删除案例"),
        mediaAssets: [{ id: "asset:entry", kind: "image", storageMode: "managed", mimeType: "image/webp" }]
      }
    }),
    trashItem({
      id: "trash:media:case:two:asset:media",
      kind: "media",
      targetId: "asset:media",
      snapshot: {
        mediaAssets: [{ id: "asset:media", kind: "video", storageMode: "managed", mimeType: "video/mp4" }]
      }
    })
  );
  const attached = attachSyncImageReferences(source, {
    "asset:entry": { objectId: entryObjectId, contentType: "image/webp" },
    "asset:media": { objectId: mediaObjectId, contentType: "video/mp4" }
  });

  assert.equal(attached.trashState.items[0].snapshot.mediaAssets[0].syncObjectId, entryObjectId);
  assert.equal(attached.trashState.items[1].snapshot.mediaAssets[0].syncObjectId, mediaObjectId);
  assert.deepEqual(collectSyncImageReferences(attached), {
    "asset:entry": { objectId: entryObjectId, contentType: "image/webp" },
    "asset:media": { objectId: mediaObjectId, contentType: "video/mp4" }
  });

  const snapshot = await createRevisionSnapshot(attached, { deviceId: "device-a", logicalClock: 1 });
  const merged = mergeRevisionSnapshots([snapshot]);
  assert.equal(merged.state.entries.length, 0);
  assert.equal(merged.state.trashState.items.length, 2);
  assert.deepEqual(merged.imageRefs, {
    "asset:entry": { objectId: entryObjectId, contentType: "image/webp" },
    "asset:media": { objectId: mediaObjectId, contentType: "video/mp4" }
  });
});

test("emptying trash wins over a concurrent trash edit without resurrecting the item", async () => {
  const baseState = state();
  baseState.trashState.items.push(trashItem({
    id: "trash:entry:case:one",
    kind: "entry",
    targetId: "case:one",
    snapshot: entry("case:one", "base")
  }));
  const base = await createRevisionSnapshot(baseState, { deviceId: "device-a", logicalClock: 1 });
  const emptied = await createRevisionSnapshot(state(), {
    deviceId: "device-a",
    logicalClock: 2,
    baseSnapshot: base
  });
  const editedState = structuredClone(baseState);
  editedState.trashState.items[0].snapshot.title = "concurrent edit";
  const edited = await createRevisionSnapshot(editedState, {
    deviceId: "device-b",
    logicalClock: 2,
    baseSnapshot: base
  });

  const merged = mergeRevisionSnapshots([base, emptied, edited]);
  assert.equal(merged.state.entries.length, 0);
  assert.equal(merged.state.trashState.items.length, 0);
  assert.deepEqual(merged.conflicts.map(({ entityType, reason }) => ({ entityType, reason })), [
    { entityType: "trash_item", reason: "delete_edit" }
  ]);
});

function state(entries = [], collections = [], compoundCases = []) {
  return {
    entries,
    compoundCases,
    organizerState: { version: 2, collections },
    taxonomy: { version: 14, revision: 1, nodes: [] },
    facetCatalog: { version: 1, revision: 1, facets: [], nodes: [] },
    classificationRules: [],
    composerSessions: [],
    creativeRuns: [],
    creativeSkills: { version: 1, items: [] },
    trashState: { version: 1, items: [] }
  };
}

function trashItem({ id, kind, targetId, snapshot }) {
  return {
    id,
    kind,
    targetId,
    deletedAt: "2026-08-22T00:00:00.000Z",
    snapshot,
    relationships: {}
  };
}

test("compound structures are versioned independently and concurrent edits are retained", async () => {
  const members = [entry("one", "one"), entry("two", "two")];
  const compound = (title, order) => ({
    id: "compound:one", title, memberEntryIds: order, coverVisualId: "", customLabels: [],
    createdAt: "2026-08-01T00:00:00.000Z", updatedAt: "2026-08-01T00:00:00.000Z"
  });
  const base = await createRevisionSnapshot(state(members, [], [compound("base", ["one", "two"])]), {
    deviceId: "device-a", logicalClock: 1
  });
  const left = await createRevisionSnapshot(state(members, [], [compound("left", ["one", "two"])]), {
    deviceId: "device-a", logicalClock: 2, baseSnapshot: base
  });
  const right = await createRevisionSnapshot(state(members, [], [compound("right", ["two", "one"])]), {
    deviceId: "device-b", logicalClock: 2, baseSnapshot: base
  });
  const merged = mergeRevisionSnapshots([base, left, right]);
  assert.equal(merged.state.compoundCases.length, 2);
  assert.equal(merged.conflicts[0].entityType, "compound_case");
});

test("content types are synced per node so concurrent additions are both retained", async () => {
  const baseState = state();
  const base = await createRevisionSnapshot(baseState, { deviceId: "device-a", logicalClock: 1 });
  const leftState = state();
  leftState.taxonomy.nodes = [contentType("content:docs", "工作文档")];
  const rightState = state();
  rightState.taxonomy.nodes = [contentType("content:images", "图片资料", "image_case")];
  const left = await createRevisionSnapshot(leftState, { deviceId: "device-a", logicalClock: 2, baseSnapshot: base });
  const right = await createRevisionSnapshot(rightState, { deviceId: "device-b", logicalClock: 2, baseSnapshot: base });
  const merged = mergeRevisionSnapshots([base, left, right]);
  assert.deepEqual(merged.state.taxonomy.nodes.map((item) => item.id).sort(), ["content:docs", "content:images"]);
});

test("an empty library with user content types still counts as meaningful sync state", () => {
  const value = state();
  assert.equal(syncStateHasContent(value), false);
  value.taxonomy.nodes = [contentType("content:docs", "工作文档")];
  assert.equal(syncStateHasContent(value), true);
});

function contentType(id, name, role = "general") {
  return { id, name, role, axis: "content", parentId: null, status: "active", order: 0, aliases: [] };
}

function entry(id, title) {
  return { id, title, text: title, visuals: [], schemaVersion: 14 };
}

test("a normal child revision replaces its ancestor without creating a conflict", async () => {
  const first = await createRevisionSnapshot(state([entry("one", "first")]), {
    deviceId: "device-a",
    logicalClock: 1
  });
  const second = await createRevisionSnapshot(state([entry("one", "second")]), {
    deviceId: "device-a",
    logicalClock: 2,
    baseSnapshot: first
  });
  const merged = mergeRevisionSnapshots([first, second]);

  assert.equal(merged.state.entries.length, 1);
  assert.equal(merged.state.entries[0].title, "second");
  assert.equal(merged.conflicts.length, 0);
});

test("a retained snapshot carries enough ancestry after intermediate files are pruned", async () => {
  const first = await createRevisionSnapshot(state([entry("one", "v1")]), {
    deviceId: "device-a",
    logicalClock: 1
  });
  const second = await createRevisionSnapshot(state([entry("one", "v2")]), {
    deviceId: "device-a",
    logicalClock: 2,
    baseSnapshot: first
  });
  const third = await createRevisionSnapshot(state([entry("one", "v3")]), {
    deviceId: "device-a",
    logicalClock: 3,
    baseSnapshot: second
  });

  const merged = mergeRevisionSnapshots([first, third]);
  assert.equal(merged.conflicts.length, 0);
  assert.equal(merged.state.entries[0].title, "v3");
});

test("concurrent edits retain both cases instead of silently overwriting one", async () => {
  const base = await createRevisionSnapshot(state([entry("one", "base")]), {
    deviceId: "device-a",
    logicalClock: 1
  });
  const left = await createRevisionSnapshot(state([entry("one", "left")]), {
    deviceId: "device-a",
    logicalClock: 2,
    baseSnapshot: base
  });
  const right = await createRevisionSnapshot(state([entry("one", "right")]), {
    deviceId: "device-b",
    logicalClock: 2,
    baseSnapshot: base
  });
  const merged = mergeRevisionSnapshots([base, left, right]);

  assert.equal(merged.state.entries.length, 2);
  assert.deepEqual(new Set(merged.state.entries.map((item) => item.text)), new Set(["left", "right"]));
  assert.equal(merged.state.entries.filter((item) => item.syncConflict).length, 1);
  assert.equal(merged.conflicts.length, 1);
});

test("a synced conflict copy keeps its video and poster connected", async () => {
  const withPoster = (title) => ({
    ...entry("one", title), visuals: undefined,
    mediaAssets: [
      { id: "video:one", kind: "video", storageMode: "managed", mimeType: "video/mp4", posterAssetId: "poster:one" },
      { id: "poster:one", kind: "image", usage: "poster", storageMode: "managed", mimeType: "image/webp", derivedFromAssetId: "video:one" }
    ],
    primaryMediaId: "video:one"
  });
  const base = await createRevisionSnapshot(state([withPoster("base")]), { deviceId: "device-a", logicalClock: 1 });
  const left = await createRevisionSnapshot(state([withPoster("left")]), { deviceId: "device-a", logicalClock: 2, baseSnapshot: base });
  const right = await createRevisionSnapshot(state([withPoster("right")]), { deviceId: "device-b", logicalClock: 2, baseSnapshot: base });
  const merged = mergeRevisionSnapshots([base, left, right]);
  const conflict = merged.state.entries.find((item) => item.syncConflict);
  const video = conflict.mediaAssets.find((asset) => asset.kind === "video");
  const poster = conflict.mediaAssets.find((asset) => asset.usage === "poster");
  assert.equal(video.posterAssetId, poster.id);
  assert.equal(poster.derivedFromAssetId, video.id);
});

test("concurrent deletion and editing keeps deletion and restores the edit as a conflict copy", async () => {
  const base = await createRevisionSnapshot(state([entry("one", "base")]), {
    deviceId: "device-a",
    logicalClock: 1
  });
  const deleted = await createRevisionSnapshot(state([]), {
    deviceId: "device-a",
    logicalClock: 2,
    baseSnapshot: base
  });
  const edited = await createRevisionSnapshot(state([entry("one", "edited")]), {
    deviceId: "device-b",
    logicalClock: 2,
    baseSnapshot: base
  });
  const merged = mergeRevisionSnapshots([base, deleted, edited]);

  assert.equal(merged.state.entries.length, 1);
  assert.notEqual(merged.state.entries[0].id, "one");
  assert.equal(merged.state.entries[0].text, "edited");
  assert.equal(merged.state.entries[0].syncConflict?.reason, "delete_edit");
});

test("concurrent project membership changes are combined instead of replacing the array", async () => {
  const project = (entryIds) => ({ id: "collection:p", name: "Campaign", order: 0, entryIds });
  const base = await createRevisionSnapshot(state([entry("a", "a"), entry("b", "b")], [project([])]), {
    deviceId: "device-a",
    logicalClock: 1
  });
  const left = await createRevisionSnapshot(state([entry("a", "a"), entry("b", "b")], [project(["a"])]), {
    deviceId: "device-a",
    logicalClock: 2,
    baseSnapshot: base
  });
  const right = await createRevisionSnapshot(state([entry("a", "a"), entry("b", "b")], [project(["b"])]), {
    deviceId: "device-b",
    logicalClock: 2,
    baseSnapshot: base
  });
  const merged = mergeRevisionSnapshots([base, left, right]);

  assert.deepEqual(new Set(merged.state.organizerState.collections[0].entryIds), new Set(["a", "b"]));
});

test("project membership removals and additions merge as operations", async () => {
  const project = (entryIds) => ({ id: "collection:p", name: "Campaign", order: 0, entryIds });
  const entries = [entry("a", "a"), entry("b", "b"), entry("c", "c")];
  const base = await createRevisionSnapshot(state(entries, [project(["a", "b"])]), {
    deviceId: "device-a",
    logicalClock: 1
  });
  const removed = await createRevisionSnapshot(state(entries, [project(["b"])]), {
    deviceId: "device-a",
    logicalClock: 2,
    baseSnapshot: base
  });
  const added = await createRevisionSnapshot(state(entries, [project(["a", "b", "c"])]), {
    deviceId: "device-b",
    logicalClock: 2,
    baseSnapshot: base
  });

  const merged = mergeRevisionSnapshots([base, removed, added]);
  assert.deepEqual(new Set(merged.state.organizerState.collections[0].entryIds), new Set(["b", "c"]));
});

test("concurrent tag additions and removals merge without duplicating the case", async () => {
  const assignment = (nodeId) => ({
    facetId: "facet:style",
    nodeId,
    status: "confirmed",
    source: "manual"
  });
  const withTags = (nodeIds) => ({
    ...entry("one", "same"),
    facetAssignments: nodeIds.map(assignment)
  });
  const base = await createRevisionSnapshot(state([withTags(["tag:a"])]), {
    deviceId: "device-a",
    logicalClock: 1
  });
  const removed = await createRevisionSnapshot(state([withTags([])]), {
    deviceId: "device-a",
    logicalClock: 2,
    baseSnapshot: base
  });
  const added = await createRevisionSnapshot(state([withTags(["tag:a", "tag:b"])]), {
    deviceId: "device-b",
    logicalClock: 2,
    baseSnapshot: base
  });

  const merged = mergeRevisionSnapshots([base, removed, added]);
  assert.equal(merged.state.entries.length, 1);
  assert.deepEqual(merged.state.entries[0].facetAssignments.map((item) => item.nodeId), ["tag:b"]);
});

test("concurrent creative result edits are both retained", async () => {
  const run = (title, visualId) => ({
    id: "run:one",
    sessionId: "session:one",
    promptVersionId: "prompt:one",
    promptText: "prompt",
    title,
    outputs: [{ visual: { id: visualId }, capturedAt: "2026-07-29T00:00:00.000Z", signals: [] }]
  });
  const baseState = state();
  baseState.creativeRuns = [run("base", "visual:base")];
  const base = await createRevisionSnapshot(baseState, { deviceId: "device-a", logicalClock: 1 });
  const leftState = state();
  leftState.creativeRuns = [run("left", "visual:left")];
  const left = await createRevisionSnapshot(leftState, {
    deviceId: "device-a",
    logicalClock: 2,
    baseSnapshot: base
  });
  const rightState = state();
  rightState.creativeRuns = [run("right", "visual:right")];
  const right = await createRevisionSnapshot(rightState, {
    deviceId: "device-b",
    logicalClock: 2,
    baseSnapshot: base
  });

  const merged = mergeRevisionSnapshots([base, left, right]);
  assert.equal(merged.state.creativeRuns.length, 2);
  assert.equal(merged.state.creativeRuns.some((item) => item.title === "right"), true);
  assert.equal(merged.state.creativeRuns.some((item) => item.title.startsWith("left")), true);
  assert.equal(new Set(merged.state.creativeRuns.flatMap((item) => item.outputs.map((output) => output.visual.id))).size, 2);
});

test("an empty or invalid remote snapshot is never allowed to erase a healthy local library", async () => {
  const local = await createRevisionSnapshot(state([entry("safe", "keep me")]), {
    deviceId: "device-a",
    logicalClock: 1
  });
  const merged = mergeRevisionSnapshots([null, {}, local]);

  assert.equal(merged.state.entries[0].id, "safe");
});

test("sync settings never expose a password and keep a stable per-profile device id", () => {
  const settings = normalizeSyncSettings({
    enabled: true,
    vaultId: "vault:one",
    deviceId: "device:one",
    password: "must disappear",
    retentionCount: 100
  });

  assert.equal(settings.password, undefined);
  assert.equal(settings.deviceId, "device:one");
  assert.equal(settings.retentionCount, 10);
});

test("missing sync files become an actionable state instead of a persistent browser error", () => {
  const browserMessage = "A requested file or directory could not be found at the time an operation was processed.";
  const migrated = normalizeSyncSettings({
    enabled: true,
    vaultId: "vault:one",
    deviceId: "device:one",
    lastError: browserMessage
  });
  const current = syncErrorDetails({ name: "NotFoundError", message: browserMessage });

  assert.equal(migrated.lastErrorCode, SYNC_ERROR_CODES.LOCATION_NOT_FOUND);
  assert.doesNotMatch(migrated.lastError, /requested file or directory/i);
  assert.deepEqual(current, {
    code: SYNC_ERROR_CODES.LOCATION_NOT_FOUND,
    message: "同步文件夹中的文件或目录不存在，请重新选择同步文件夹后再同步"
  });
});

test("damaged formal snapshots retain an actionable error code", () => {
  const details = syncErrorDetails({
    code: "sync_snapshot_corrupt",
    message: "同步目录包含损坏的正式状态文件，本地资料未被修改"
  });
  assert.equal(details.code, "sync_snapshot_corrupt");
  assert.match(details.message, /损坏/);
  assert.equal(normalizeSyncSettings({ lastError: details.message, lastErrorCode: details.code }).lastErrorCode, "sync_snapshot_corrupt");
});
