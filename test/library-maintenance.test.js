import test from "node:test";
import assert from "node:assert/strict";

import {
  cancelLibraryMaintenance,
  completeLibraryMaintenanceItem,
  createLibraryMaintenanceJob,
  libraryMaintenanceSummary,
  mergeLibraryMaintenanceProgress,
  nextLibraryMaintenanceItem,
  pauseLibraryMaintenance,
  resumeLibraryMaintenance,
  retryLibraryMaintenanceFailures
} from "../library-maintenance.js";

test("full-library maintenance stores compact cursors and reports monotonic progress", () => {
  let job = createLibraryMaintenanceJob({
    id: "job",
    now: "2026-08-02T00:00:00.000Z",
    classificationEntryIds: ["case-a"],
    paletteAssetIds: Array.from({ length: 6338 }, (_, index) => `image-${index}`)
  });
  assert.deepEqual(nextLibraryMaintenanceItem(job), { kind: "classification", id: "case-a" });
  job = completeLibraryMaintenanceItem(job, { ok: true });
  assert.deepEqual(nextLibraryMaintenanceItem(job), { kind: "palette", id: "image-0" });
  job = completeLibraryMaintenanceItem(job, { ok: true });
  const summary = libraryMaintenanceSummary(job, Date.parse("2026-08-02T00:00:02.000Z"));
  assert.equal(summary.total, 6339);
  assert.equal(summary.processed, 2);
  assert.equal(summary.succeeded, 2);
  assert.ok(summary.itemsPerSecond > 0);
});

test("maintenance can pause resume cancel and retry only failed ids", () => {
  let job = createLibraryMaintenanceJob({ id: "job", paletteAssetIds: ["ok", "broken"] });
  job = pauseLibraryMaintenance(job);
  assert.equal(job.status, "paused");
  job = resumeLibraryMaintenance(job);
  job = completeLibraryMaintenanceItem(job, { ok: true });
  job = completeLibraryMaintenanceItem(job, { ok: false, message: "decode failed" });
  assert.equal(job.status, "completed");
  const retry = retryLibraryMaintenanceFailures(job, { id: "retry" });
  assert.deepEqual(retry.paletteAssetIds, ["broken"]);
  assert.equal(cancelLibraryMaintenance(retry).status, "canceled");
});

test("background progress cannot overwrite a user pause or a replacement job", () => {
  const running = createLibraryMaintenanceJob({
    id: "maintenance:active",
    now: "2026-08-02T00:00:00.000Z",
    paletteAssetIds: ["asset-1", "asset-2"]
  });
  const progress = completeLibraryMaintenanceItem(running, { ok: true });
  const paused = pauseLibraryMaintenance(running);
  assert.equal(mergeLibraryMaintenanceProgress(paused, progress).status, "paused");
  assert.equal(mergeLibraryMaintenanceProgress(paused, progress).paletteCursor, 1);

  const replacement = createLibraryMaintenanceJob({
    id: "maintenance:replacement",
    now: "2026-08-02T00:01:00.000Z",
    paletteAssetIds: ["asset-3"]
  });
  assert.equal(mergeLibraryMaintenanceProgress(replacement, progress).id, replacement.id);
  assert.equal(mergeLibraryMaintenanceProgress(replacement, progress).paletteCursor, 0);
});
