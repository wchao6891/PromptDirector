import test from "node:test";
import assert from "node:assert/strict";

import { createManualSyncController } from "../manual-sync.js";
import { createRevisionSnapshot } from "../sync-model.js";

test("a second unchanged manual sync performs zero media snapshot and metadata writes", async () => {
  const fixture = await createFixture();
  await fixture.controller.start({ vault: fixture.vault, settings: fixture.settings });
  fixture.resetCounts();

  const result = await fixture.controller.start({ vault: fixture.vault, settings: fixture.settings });

  assert.equal(result.upToDate, true);
  assert.deepEqual(fixture.counts(), {
    stateReads: 0,
    mediaReads: 0,
    mediaWrites: 0,
    mediaDeletes: 0,
    objectWrites: 0,
    objectReads: 0,
    snapshotWrites: 0,
    metadataWrites: 0
  });
  assert.equal(fixture.controller.status().state, "up-to-date");
});

test("legacy sync metadata recovers object references from revision records", async () => {
  const fixture = await createFixture();
  await fixture.controller.start({ vault: fixture.vault, settings: fixture.settings });
  fixture.meta.assetRefs = {};
  fixture.resetCounts();

  const result = await fixture.controller.start({ vault: fixture.vault, settings: fixture.settings });

  assert.equal(result.upToDate, true);
  assert.equal(result.mediaCount, 1);
  assert.equal(fixture.counts().mediaReads, 0);
  assert.equal(fixture.counts().objectWrites, 0);
  assert.equal(fixture.counts().snapshotWrites, 0);
  assert.equal(fixture.counts().metadataWrites, 0);
});

test("only a newly added managed asset is read and uploaded", async () => {
  const fixture = await createFixture();
  await fixture.controller.start({ vault: fixture.vault, settings: fixture.settings });
  fixture.state.entries.push(entry("two", "asset:two"));
  fixture.media.set("asset:two", new Blob(["two"], { type: "image/webp" }));
  fixture.meta.localDirty = true;
  fixture.meta.dirtyAssetIds = ["asset:two"];
  fixture.resetCounts();

  const result = await fixture.controller.start({ vault: fixture.vault, settings: fixture.settings });

  assert.equal(result.ok, true);
  assert.equal(result.upToDate, false);
  assert.equal(fixture.counts().mediaReads, 1);
  assert.equal(fixture.counts().objectWrites, 1);
  assert.equal(fixture.counts().snapshotWrites, 1);
  assert.equal(fixture.counts().metadataWrites, 1);
  assert.equal(result.changeSummary.byEntity.entry.added, 1);
  assert.equal(result.effects.localBusinessChanged, false);
});

test("metadata-only edits reuse the previous media object without reading its blob", async () => {
  const fixture = await createFixture();
  await fixture.controller.start({ vault: fixture.vault, settings: fixture.settings });
  fixture.state.entries[0].title = "renamed";
  fixture.meta.localDirty = true;
  fixture.resetCounts();

  const result = await fixture.controller.start({ vault: fixture.vault, settings: fixture.settings });

  assert.equal(result.ok, true);
  assert.equal(fixture.counts().mediaReads, 0);
  assert.equal(fixture.counts().objectWrites, 0);
  assert.equal(fixture.counts().snapshotWrites, 1);
  assert.equal(fixture.counts().metadataWrites, 1);
  assert.equal(result.changeSummary.byEntity.entry.updated, 1);
  assert.equal(result.effects.localBusinessChanged, false);
});

test("a reverted local edit clears its pending marker without publishing a snapshot", async () => {
  const fixture = await createFixture();
  await fixture.controller.start({ vault: fixture.vault, settings: fixture.settings });
  fixture.meta.localDirty = true;
  fixture.resetCounts();

  const result = await fixture.controller.start({ vault: fixture.vault, settings: fixture.settings });

  assert.equal(result.upToDate, true);
  assert.equal(fixture.counts().mediaReads, 0);
  assert.equal(fixture.counts().objectWrites, 0);
  assert.equal(fixture.counts().snapshotWrites, 0);
  assert.equal(fixture.counts().metadataWrites, 1);
  assert.equal(fixture.meta.localDirty, false);
});

test("remote additions report that local business data changed exactly once", async () => {
  const fixture = await createFixture();
  await fixture.controller.start({ vault: fixture.vault, settings: fixture.settings });
  const remotePrepared = state([entry("one", "asset:one"), entry("remote", "asset:remote")]);
  remotePrepared.entries[0].mediaAssets[0].syncObjectId = fixture.meta.assetRefs["asset:one"].objectId;
  remotePrepared.entries[0].mediaAssets[0].syncContentType = "image/webp";
  remotePrepared.entries[1].mediaAssets[0].syncObjectId = "b".repeat(64);
  remotePrepared.entries[1].mediaAssets[0].syncContentType = "image/webp";
  fixture.remoteSnapshots.push(await createRevisionSnapshot(remotePrepared, {
    deviceId: "device-b",
    logicalClock: fixture.meta.logicalClock + 1,
    baseSnapshot: {
      format: "prompt-director-sync-state",
      version: 1,
      records: fixture.meta.records
    }
  }));
  fixture.objects.set("b".repeat(64), new Blob(["remote"], { type: "image/webp" }));
  fixture.resetCounts();

  const result = await fixture.controller.start({ vault: fixture.vault, settings: fixture.settings });

  assert.equal(result.ok, true);
  assert.equal(result.effects.localBusinessChanged, true);
  assert.equal(result.effects.localMediaCommitted, 1);
  assert.equal(result.appliedChangeSummary.byEntity.entry.added, 1);
  assert.equal(fixture.counts().mediaWrites, 1);
  assert.equal(fixture.state.entries.some((item) => item.id === "remote"), true);
});

test("cancel rolls media restoration back and exposes a stable canceled terminal state", async () => {
  const fixture = await createFixture();
  await fixture.controller.start({ vault: fixture.vault, settings: fixture.settings });
  const remoteState = state([entry("one", "asset:one"), entry("remote", "asset:remote")]);
  const remotePrepared = structuredClone(remoteState);
  remotePrepared.entries[0].mediaAssets[0].syncObjectId = fixture.meta.assetRefs["asset:one"].objectId;
  remotePrepared.entries[0].mediaAssets[0].syncContentType = "image/webp";
  remotePrepared.entries[1].mediaAssets[0].syncObjectId = "b".repeat(64);
  remotePrepared.entries[1].mediaAssets[0].syncContentType = "image/webp";
  fixture.remoteSnapshots.push(await createRevisionSnapshot(remotePrepared, {
    deviceId: "device-b",
    logicalClock: fixture.meta.logicalClock + 1,
    baseSnapshot: {
      format: "prompt-director-sync-state",
      version: 1,
      records: fixture.meta.records
    }
  }));
  fixture.objects.set("b".repeat(64), new Blob(["remote"], { type: "image/webp" }));
  fixture.resetCounts();
  fixture.pauseObjectRead = true;

  const pending = fixture.controller.start({ vault: fixture.vault, settings: fixture.settings });
  await fixture.objectReadStarted;
  assert.equal(fixture.controller.cancel(), true);
  fixture.resumeObjectRead();
  const result = await pending;

  assert.equal(result.canceled, true);
  assert.equal(fixture.controller.status().state, "canceled");
  assert.equal(fixture.controller.status().active, false);
  assert.equal(fixture.controller.status().terminal, true);
  assert.equal(fixture.controller.status().pendingCount, 0);
  assert.equal(fixture.controller.status().runningCount, 0);
  assert.equal(fixture.media.has("asset:remote"), false);
  assert.equal(fixture.counts().snapshotWrites, 0);
  assert.equal(fixture.counts().metadataWrites, 0);
});

test("repeated start calls share one active manual run and never queue a second run", async () => {
  const fixture = await createFixture();
  fixture.pauseSnapshotList = true;
  const first = fixture.controller.start({ vault: fixture.vault, settings: fixture.settings });
  await fixture.snapshotListStarted;
  const second = fixture.controller.start({ vault: fixture.vault, settings: fixture.settings });
  assert.equal(first, second);
  assert.equal(fixture.controller.status().pendingCount, 0);
  assert.equal(fixture.controller.status().runningCount, 1);
  fixture.resumeSnapshotList();
  await first;
  assert.equal(fixture.listCalls, 1);
  assert.equal(fixture.controller.status().active, false);
});

test("cancel is rejected after the atomic commit point has started", async () => {
  const fixture = await createFixture();
  fixture.pauseCommit = true;
  const pending = fixture.controller.start({ vault: fixture.vault, settings: fixture.settings });
  await fixture.commitStarted;

  assert.equal(fixture.controller.status().phase, "committing");
  assert.equal(fixture.controller.cancel(), false);
  fixture.resumeCommit();
  const result = await pending;
  assert.equal(result.ok, true);
  assert.equal(result.canceled, false);
  assert.equal(fixture.controller.status().state, "success");
});

async function createFixture() {
  let count = emptyCounts();
  let stateValue = state([entry("one", "asset:one")]);
  let metaValue = { logicalClock: 0, records: {}, assetRefs: {}, localDirty: false, dirtyAssetIds: [] };
  const remoteSnapshots = [];
  const media = new Map([["asset:one", new Blob(["one"], { type: "image/webp" })]]);
  const objects = new Map();
  let pauseObjectRead = false;
  let resumeObjectRead;
  let objectReadStartedResolve;
  let objectReadStarted = new Promise((resolve) => { objectReadStartedResolve = resolve; });
  let pauseSnapshotList = false;
  let resumeSnapshotList;
  let snapshotListStartedResolve;
  let snapshotListStarted = new Promise((resolve) => { snapshotListStartedResolve = resolve; });
  let listCalls = 0;
  let pauseCommit = false;
  let resumeCommit;
  let commitStartedResolve;
  let commitStarted = new Promise((resolve) => { commitStartedResolve = resolve; });

  const controller = createManualSyncController({
    readState: async () => {
      count.stateReads += 1;
      return structuredClone(stateValue);
    },
    readMeta: async () => structuredClone(metaValue),
    listSnapshots: async (_vault, { signal } = {}) => {
      listCalls += 1;
      if (pauseSnapshotList) {
        snapshotListStartedResolve();
        await new Promise((resolve) => { resumeSnapshotList = resolve; });
      }
      signal?.throwIfAborted();
      return structuredClone(remoteSnapshots);
    },
    readMedia: async (id) => {
      count.mediaReads += 1;
      return media.get(id) ?? null;
    },
    writeMedia: async (id, blob) => {
      count.mediaWrites += 1;
      media.set(id, blob);
    },
    deleteMedia: async (id) => {
      count.mediaDeletes += 1;
      media.delete(id);
    },
    writeObject: async (_vault, blob, { signal } = {}) => {
      signal?.throwIfAborted();
      count.objectWrites += 1;
      const objectId = blob.size === 3 && await blob.text() === "one" ? "a".repeat(64) : "c".repeat(64);
      objects.set(objectId, blob);
      return objectId;
    },
    readObject: async (_vault, objectId, { signal } = {}) => {
      count.objectReads += 1;
      if (pauseObjectRead) {
        objectReadStartedResolve();
        await new Promise((resolve) => { resumeObjectRead = resolve; });
      }
      signal?.throwIfAborted();
      return objects.get(objectId);
    },
    writeSnapshot: async (_vault, snapshot) => {
      count.snapshotWrites += 1;
      remoteSnapshots.push(structuredClone(snapshot));
    },
    commit: async ({ state: nextState, meta }) => {
      if (pauseCommit) {
        commitStartedResolve();
        await new Promise((resolve) => { resumeCommit = resolve; });
      }
      count.metadataWrites += 1;
      stateValue = structuredClone(nextState);
      metaValue = structuredClone(meta);
    },
    now: () => "2026-08-23T00:00:00.000Z"
  });

  const fixture = {
    controller,
    vault: { header: { vaultId: "vault:one" } },
    settings: { enabled: true, vaultId: "vault:one", deviceId: "device-a", retentionCount: 10 },
    remoteSnapshots,
    media,
    objects,
    counts: () => ({ ...count }),
    resetCounts: () => { count = emptyCounts(); },
    get state() { return stateValue; },
    get meta() { return metaValue; },
    get objectReadStarted() { return objectReadStarted; },
    resumeObjectRead: () => resumeObjectRead?.(),
    get snapshotListStarted() { return snapshotListStarted; },
    resumeSnapshotList: () => resumeSnapshotList?.(),
    get listCalls() { return listCalls; }
  };
  Object.defineProperty(fixture, "pauseObjectRead", { set(value) { pauseObjectRead = value; } });
  Object.defineProperty(fixture, "pauseSnapshotList", { set(value) { pauseSnapshotList = value; } });
  Object.defineProperty(fixture, "pauseCommit", { set(value) { pauseCommit = value; } });
  Object.defineProperty(fixture, "commitStarted", { get() { return commitStarted; } });
  fixture.resumeCommit = () => resumeCommit?.();
  return fixture;
}

function emptyCounts() {
  return {
    stateReads: 0,
    mediaReads: 0,
    mediaWrites: 0,
    mediaDeletes: 0,
    objectWrites: 0,
    objectReads: 0,
    snapshotWrites: 0,
    metadataWrites: 0
  };
}

function state(entries = []) {
  return {
    entries,
    compoundCases: [],
    organizerState: { version: 4, collections: [] },
    taxonomy: { version: 14, revision: 1, nodes: [] },
    facetCatalog: { version: 1, revision: 1, facets: [], nodes: [] },
    classificationRules: [],
    composerSettings: {},
    composerSessions: [],
    creativeExperimentSettings: {},
    creativeRuns: [],
    creativeSkills: { version: 1, items: [] },
    trashState: { version: 1, items: [] },
    settings: { libraryTitle: "PromptDirector" }
  };
}

function entry(id, assetId) {
  return {
    id,
    title: id,
    text: id,
    schemaVersion: 14,
    mediaAssets: [{
      id: assetId,
      kind: "image",
      usage: "content",
      storageMode: "managed",
      mimeType: "image/webp",
      byteSize: id.length
    }],
    primaryMediaId: assetId
  };
}
