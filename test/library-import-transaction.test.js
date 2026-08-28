import test from "node:test";
import assert from "node:assert/strict";

import {
  assertLibraryImportPlanCurrent,
  claimLibraryImportTransaction,
  createLibraryImportPlanToken,
  normalizeLibraryImportTransactionsState,
  succeedLibraryImportTransaction
} from "../library-import-transaction.js";

test("plan tokens ignore sync status, undo, and job noise but still react to live library changes", () => {
  const source = makeImportSource();
  const before = makeCurrentLibrary();
  const token = createLibraryImportPlanToken(before, source);

  assert.equal(token, createLibraryImportPlanToken({
    ...before,
    syncStatus: { connected: true, lastCheckedAt: "2026-08-26T00:00:00.000Z" },
    importJobs: { version: 1, items: [{ id: "job:one", status: "running" }] },
    lastSaveUndo: { id: "undo:one", createdAt: "2026-08-26T00:00:00.000Z" },
    libraryImportStats: { applied: 9, skipped: 1 }
  }, source));

  assert.doesNotThrow(() => assertLibraryImportPlanCurrent(token, before, source));
  assert.throws(() => assertLibraryImportPlanCurrent(token, {
    ...before,
    entries: [...before.entries, { id: "parallel-import", title: "并行新增", mediaAssets: [] }]
  }, source), (error) => {
    assert.equal(error.code, "IMPORT_PLAN_STALE");
    return true;
  });
});

test("plan tokens bind the confirmed recovery choices and resource mappings", () => {
  const source = makeImportSource();
  const before = makeCurrentLibrary();
  const plan = {
    mode: "merge",
    preserveLibraryConfiguration: true,
    libraryAddedAt: "2026-08-27T08:00:00.000Z",
    importBatchId: "library-import:bound-plan",
    mappings: { entryIds: { source: "entry:copy" } },
    resourceWrites: [{ sourceId: "image:source", targetId: "image:copy", resourceType: "media" }]
  };
  const token = createLibraryImportPlanToken(before, source, plan);

  assert.doesNotThrow(() => assertLibraryImportPlanCurrent(token, before, source, plan));
  assert.throws(() => assertLibraryImportPlanCurrent(token, before, source, {
    ...plan,
    preserveLibraryConfiguration: false
  }), (error) => {
    assert.equal(error.code, "IMPORT_PLAN_STALE");
    return true;
  });
  assert.throws(() => assertLibraryImportPlanCurrent(token, before, source, {
    ...plan,
    resourceWrites: [{ sourceId: "image:source", targetId: "image:other", resourceType: "media" }]
  }), (error) => {
    assert.equal(error.code, "IMPORT_PLAN_STALE");
    return true;
  });
});

test("a completed apply is replayed for the same operationId and planToken without calling the writer again", () => {
  const source = makeImportSource();
  const before = makeCurrentLibrary();
  const token = createLibraryImportPlanToken(before, source);
  const operationId = "operation:one";
  const receiptState = normalizeLibraryImportTransactionsState();
  const claim = claimLibraryImportTransaction(receiptState, {
    operationId,
    planToken: token,
    stateValue: before,
    sourceValue: source
  });

  assert.equal(claim.acquired, true);
  assert.equal(claim.replayed, false);
  assert.equal(claim.receipt.status, "pending");

  const applied = succeedLibraryImportTransaction(claim.state, claim.receipt, {
    ok: true,
    message: "已导入 1 项",
    importedCount: 1
  });
  const changed = {
    ...before,
    syncStatus: { connected: false, lastCheckedAt: "2026-08-26T00:10:00.000Z" },
    entries: [...before.entries, { id: "parallel-import", title: "并行新增", mediaAssets: [] }]
  };
  const replay = claimLibraryImportTransaction(applied.state, {
    operationId,
    planToken: token,
    stateValue: changed,
    sourceValue: source
  });

  assert.equal(replay.acquired, false);
  assert.equal(replay.replayed, true);
  assert.deepEqual(replay.result, {
    ok: true,
    message: "已导入 1 项",
    importedCount: 1
  });
  assert.equal(replay.receipt.status, "completed");
  assert.equal(replay.receipt.operationId, operationId);
  assert.equal(replay.receipt.planToken, token);
});

test("a pending receipt never claims success and blocks the same operation from being applied twice", () => {
  const source = makeImportSource();
  const before = makeCurrentLibrary();
  const token = createLibraryImportPlanToken(before, source);
  const operationId = "operation:pending";
  const claimed = claimLibraryImportTransaction(normalizeLibraryImportTransactionsState(), {
    operationId,
    planToken: token,
    stateValue: before,
    sourceValue: source
  });

  const duplicate = claimLibraryImportTransaction(claimed.state, {
    operationId,
    planToken: token,
    stateValue: before,
    sourceValue: source
  });

  assert.equal(duplicate.acquired, false);
  assert.equal(duplicate.replayed, false);
  assert.equal(duplicate.pending, true);
  assert.equal(duplicate.result, undefined);
  assert.equal(duplicate.receipt.status, "pending");
});

test("the same operationId with a different planToken is rejected as a conflict", () => {
  const source = makeImportSource();
  const before = makeCurrentLibrary();
  const token = createLibraryImportPlanToken(before, source);
  const first = claimLibraryImportTransaction(normalizeLibraryImportTransactionsState(), {
    operationId: "operation:conflict",
    planToken: token,
    stateValue: before,
    sourceValue: source
  });
  const applied = succeedLibraryImportTransaction(first.state, first.receipt, {
    ok: true,
    message: "已导入 1 项"
  });
  const changedSource = {
    ...source,
    entries: [...source.entries, { id: "source:extra", title: "源侧变化", mediaAssets: [] }]
  };
  const conflictToken = createLibraryImportPlanToken(before, changedSource);

  assert.throws(() => claimLibraryImportTransaction(applied.state, {
    operationId: "operation:conflict",
    planToken: conflictToken,
    stateValue: before,
    sourceValue: changedSource
  }), (error) => {
    assert.equal(error.code, "IMPORT_RECEIPT_CONFLICT");
    return true;
  });
});

test("expired receipts are pruned so the same operation can be reacquired after the retention window", () => {
  const source = makeImportSource();
  const before = makeCurrentLibrary();
  const token = createLibraryImportPlanToken(before, source);
  const operationId = "operation:expire";

  const initial = claimLibraryImportTransaction(normalizeLibraryImportTransactionsState(), {
    operationId,
    planToken: token,
    stateValue: before,
    sourceValue: source
  }, {
    now: "2026-08-26T00:00:00.000Z",
    retentionMs: 1
  });

  const reacquired = claimLibraryImportTransaction(initial.state, {
    operationId,
    planToken: token,
    stateValue: before,
    sourceValue: source
  }, {
    now: "2026-08-26T00:00:00.010Z",
    retentionMs: 1
  });

  assert.equal(reacquired.acquired, true);
  assert.equal(reacquired.pending, true);
  assert.equal(reacquired.receipt.status, "pending");
});

function makeCurrentLibrary() {
  return {
    entries: [
      {
        id: "existing",
        title: "现有案例",
        mediaAssets: []
      }
    ],
    organizerState: { collections: [] },
    compoundCases: [],
    trashState: { items: [] },
    settings: { theme: "dark" },
    taxonomy: { nodes: [] },
    facetCatalog: { facets: [], nodes: [] },
    classificationRules: [],
    composerSettings: {},
    composerSessions: [],
    creativeExperimentSettings: {},
    creativeRuns: [],
    creativeSkills: { items: [] },
    syncStatus: {
      connected: true,
      lastCheckedAt: "2026-08-26T00:00:00.000Z"
    },
    importJobs: { version: 1, items: [] },
    importStaging: { version: 1, items: [] },
    lastSaveUndo: { id: "undo:one" },
    libraryImportStats: { applied: 1, skipped: 0 }
  };
}

function makeImportSource() {
  return {
    format: "prompt-case-library",
    version: 5,
    entries: [
      {
        id: "source",
        title: "源案例",
        mediaAssets: []
      }
    ],
    organizerState: { collections: [] },
    compoundCases: [],
    trashState: { items: [] },
    settings: { theme: "dark" },
    taxonomy: { nodes: [] },
    facetCatalog: { facets: [], nodes: [] },
    classificationRules: [],
    composerSettings: {},
    composerSessions: [],
    creativeExperimentSettings: {},
    creativeRuns: [],
    creativeSkills: { items: [] }
  };
}
