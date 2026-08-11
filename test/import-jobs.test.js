import test from "node:test";
import assert from "node:assert/strict";

import {
  cancelImportJob,
  createImportJob,
  finishImportItem,
  retryImportJob,
  normalizeImportJobsState,
  undoImportJob
} from "../import-jobs.js";

test("browser restart requeues only unfinished local import items", () => {
  const state = normalizeImportJobsState({
    version: 1,
    items: [{
      id: "job:one",
      status: "running",
      createdAt: "2026-08-08T00:00:00.000Z",
      updatedAt: "2026-08-08T00:00:01.000Z",
      items: [
        { id: "item:done", stagedAssetId: "staged:done", status: "imported", entryId: "entry:done" },
        { id: "item:active", stagedAssetId: "staged:active", status: "queued" }
      ],
      createdEntryIds: ["entry:done"]
    }]
  }, { recoverRunning: true });

  assert.equal(state.items[0].status, "queued");
  assert.equal(state.items[0].items[0].status, "imported");
  assert.equal(state.items[0].items[0].entryId, "entry:done");
  assert.equal(state.items[0].items[1].status, "queued");
  assert.deepEqual(state.items[0].createdEntryIds, ["entry:done"]);
});

test("retry creates a new job containing only failed items", () => {
  const source = normalizeImportJobsState({ items: [{
    id: "job:source",
    status: "failed",
    items: [
      { id: "item:done", stagedAssetId: "staged:done", status: "imported", entryId: "entry:done" },
      { id: "item:failed", stagedAssetId: "staged:failed", status: "failed", error: "文件损坏" }
    ],
    collectionId: "collection:one",
    createdEntryIds: ["entry:done"],
    options: { duplicateAction: "skip", autoAnalyze: true }
  }] });

  const result = retryImportJob(source, "job:source", {
    id: "job:retry",
    itemId: (stagedAssetId) => `item:retry:${stagedAssetId}`,
    now: "2026-08-08T01:00:00.000Z"
  });

  assert.equal(result.job.retryOf, "job:source");
  assert.equal(result.job.collectionId, "collection:one");
  assert.deepEqual(result.job.options, { duplicateAction: "skip", autoAnalyze: true });
  assert.deepEqual(result.job.items, [{
    id: "item:retry:staged:failed",
    stagedAssetId: "staged:failed",
    status: "queued"
  }]);
  assert.equal(result.state.items.length, 2);
});

test("skipped duplicates complete without becoming import failures", () => {
  const created = createImportJob({}, {
    collectionId: "collection:one",
    stagedAssetIds: ["staged:one", "staged:two"],
    options: { duplicateAction: "skip", autoAnalyze: false }
  }, {
    id: "job:one",
    itemId: (assetId) => `item:${assetId}`,
    now: "2026-08-08T02:00:00.000Z"
  });
  const imported = finishImportItem(created.state, "job:one", "item:staged:one", {
    status: "imported",
    entryId: "entry:one"
  }, { now: "2026-08-08T02:00:01.000Z" });
  const skipped = finishImportItem(imported.state, "job:one", "item:staged:two", {
    status: "skipped",
    skipReason: "duplicate"
  }, { now: "2026-08-08T02:00:02.000Z" });

  assert.equal(skipped.job.status, "completed");
  assert.deepEqual(skipped.job.createdEntryIds, ["entry:one"]);
  assert.equal(skipped.job.items[1].status, "skipped");
  assert.equal(skipped.job.items[1].skipReason, "duplicate");
});

test("cancel skips only remaining items and preserves imported results", () => {
  const state = normalizeImportJobsState({ items: [{
    id: "job:one",
    status: "running",
    items: [
      { id: "item:done", stagedAssetId: "staged:done", status: "imported", entryId: "entry:done" },
      { id: "item:queued", stagedAssetId: "staged:queued", status: "queued" }
    ],
    createdEntryIds: ["entry:done"]
  }] });
  const result = cancelImportJob(state, "job:one", { now: "2026-08-08T03:00:00.000Z" });

  assert.equal(result.job.status, "canceled");
  assert.equal(result.job.items[0].status, "imported");
  assert.equal(result.job.items[1].status, "skipped");
  assert.equal(result.job.items[1].skipReason, "canceled");
  assert.deepEqual(result.job.createdEntryIds, ["entry:done"]);
});

test("undo exposes only entries created by that import job", () => {
  const state = normalizeImportJobsState({ items: [{
    id: "job:one",
    status: "completed",
    items: [
      { id: "item:done", stagedAssetId: "staged:done", status: "imported", entryId: "entry:done" },
      { id: "item:skip", stagedAssetId: "staged:skip", status: "skipped", skipReason: "duplicate" }
    ],
    createdEntryIds: ["entry:done"]
  }] });
  const result = undoImportJob(state, "job:one", { now: "2026-08-08T04:00:00.000Z" });

  assert.deepEqual(result.createdEntryIds, ["entry:done"]);
  assert.equal(result.job.undoneAt, "2026-08-08T04:00:00.000Z");
});

test("duplicate items default to skipped unless explicitly kept", () => {
  const result = createImportJob({}, {
    items: [
      { stagedAssetId: "staged:skip", duplicateAssetId: "existing:one" },
      { stagedAssetId: "staged:keep", duplicateAssetId: "existing:two", keepDuplicate: true }
    ],
    options: { autoAnalyze: false }
  }, {
    id: "job:duplicates",
    itemId: (assetId) => `item:${assetId}`,
    now: "2026-08-08T06:00:00.000Z"
  });

  assert.deepEqual(result.job.items, [
    { id: "item:staged:skip", stagedAssetId: "staged:skip", status: "skipped", skipReason: "duplicate" },
    { id: "item:staged:keep", stagedAssetId: "staged:keep", status: "queued" }
  ]);
  assert.equal(result.job.status, "queued");
});
