import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import {
  analysisBatchSummary,
  analysisRebuildRecovery,
  cancelAnalysisBatch,
  claimAnalysisItems,
  createAnalysisBatchUndo,
  createAnalysisBatchJob,
  finalizeAnalysisRebuild,
  failAnalysisItem,
  previewAnalysisBatch,
  finalizePartialAnalysisRebuild,
  resumeAnalysisBatch,
  restoreAnalysisBatchUndo,
  retryFailedAnalysisItems,
  stageAnalysisRebuildResults,
  backfillLegacyAnalysisMeta,
  succeedAnalysisItem,
  textFingerprint,
  previewVisionBatch,
  createVisionBatchJob,
  reconcileVisionBatchResults
} from "../analysis-batch.js";
import { ANALYSIS_PROMPT_VERSION } from "../deepseek.js";
import { createFixedFacetCatalog } from "../tag-taxonomy.js";

const backgroundSource = await readFile(new URL("../background.js", import.meta.url), "utf8");

test("analysis-file import wires the legacy baseline helper into the background runtime", () => {
  const importEnd = backgroundSource.indexOf('} from "./analysis-batch.js";');
  const importStart = backgroundSource.lastIndexOf("import {", importEnd);
  assert.ok(importStart >= 0 && importEnd > importStart);
  assert.match(backgroundSource.slice(importStart, importEnd), /backfillLegacyAnalysisMeta/);
  assert.match(backgroundSource, /await backfillLegacyAnalysisMeta\(importedEntries\)/);
});

test("batch preview selects only text cases that are new or changed", async () => {
  const unchanged = await textFingerprint("same prompt");
  const preview = await previewAnalysisBatch([
    { id: "same", text: "same prompt", analysisMeta: { textFingerprint: unchanged, promptVersion: ANALYSIS_PROMPT_VERSION } },
    { id: "changed", text: "new prompt", textRevision: 2, analysisMeta: { textRevision: 1, textFingerprint: "old", promptVersion: ANALYSIS_PROMPT_VERSION } },
    { id: "new", text: "first analysis" },
    { id: "image", text: "" }
  ]);
  assert.deepEqual(preview.entries.map((item) => item.entryId), ["changed", "new"]);
  assert.equal(preview.totalCharacters, "new prompt".length + "first analysis".length);
  assert.deepEqual(preview.reasonCounts, { missing_analysis: 1, text_changed: 1, explicit_reanalysis: 0 });
});

test("analysis profile changes never queue unchanged text in the default incremental preview", async () => {
  const unchanged = await textFingerprint("same prompt");
  const preview = await previewAnalysisBatch([{
    id: "same",
    text: "same prompt",
    analysisMeta: { textFingerprint: unchanged, promptVersion: ANALYSIS_PROMPT_VERSION, profileFingerprint: "old-profile" }
  }], { profileFingerprint: "new-profile" });
  assert.equal(preview.mode, "incremental");
  assert.equal(preview.caseCount, 0);
});

test("6500 never-analysed entries preview without precomputing fingerprints", async () => {
  const entries = Array.from({ length: 6500 }, (_, index) => ({ id: `new-${index}`, text: `prompt ${index}` }));
  const preview = await previewAnalysisBatch(entries);
  assert.equal(preview.caseCount, 6500);
  assert.ok(preview.entries.every((item) => !item.fingerprint));
  assert.ok(preview.entries.every((item) => item.textRevision === 1));
});

test("explicit rebuild queues completed text and remains separate from incremental work", async () => {
  const unchanged = await textFingerprint("same prompt");
  const preview = await previewAnalysisBatch([{
    id: "same",
    text: "same prompt",
    analysisMeta: { textFingerprint: unchanged, promptVersion: ANALYSIS_PROMPT_VERSION, profileFingerprint: "old-profile" }
  }], { mode: "reanalyze", profileFingerprint: "new-profile" });
  assert.equal(preview.mode, "rebuild");
  assert.equal(preview.caseCount, 1);
  assert.equal(preview.entries[0].reason, "explicit_reanalysis");
  assert.deepEqual(preview.reasonCounts, { missing_analysis: 0, text_changed: 0, explicit_reanalysis: 1 });
});

test("rebuild stages failures without changing the live library and switches only after every retry succeeds", async () => {
  const originalState = {
    facetCatalog: createFixedFacetCatalog(),
    entries: [
      { id: "a", text: "cel shaded hero", facetAssignments: [{ facetId: "style", nodeId: "style.medium", status: "confirmed", source: "manual" }] },
      { id: "b", text: "misty courtyard", facetAssignments: [] }
    ]
  };
  const originalSnapshot = structuredClone(originalState);
  let job = await createAnalysisBatchJob(originalState.entries, { id: "rebuild", mode: "rebuild", profileFingerprint: "profile" });
  let claimed = claimAnalysisItems(job, 2, (() => { let index = 0; return () => `claim-${++index}`; })());
  let staged = stageAnalysisRebuildResults(claimed.job, null, originalState, [
    { entryId: "a", claimId: "claim-1", textRevision: 1, tags: [{ g: "style.render", t: "赛璐珞" }], model: "model", usage: { totalTokens: 12 } },
    { entryId: "b", claimId: "claim-2", textRevision: 1, error: { message: "busy", status: 503 } }
  ]);
  assert.deepEqual(originalState, originalSnapshot);
  assert.equal(analysisBatchSummary(staged.job).counts.failed, 1);
  assert.throws(() => finalizeAnalysisRebuild(staged.job, staged.staging, originalState), /尚未全部成功/);

  job = retryFailedAnalysisItems(staged.job);
  claimed = claimAnalysisItems(job, 1, () => "retry-b");
  staged = stageAnalysisRebuildResults(claimed.job, structuredClone(staged.staging), originalState, [{
    entryId: "b", claimId: "retry-b", textRevision: 1,
    tags: [{ g: "scene.place", t: "庭院" }], model: "model", usage: { totalTokens: 9 }
  }]);
  const finalized = finalizeAnalysisRebuild(staged.job, staged.staging, originalState, "2026-08-03T00:00:00.000Z");
  assert.deepEqual(originalState, originalSnapshot);
  assert.equal(finalized.state.entries[0].facetAssignments.some((item) => item.source === "manual"), true);
  assert.equal(finalized.state.entries.every((entry) => entry.analysisPending === false), true);
  assert.equal(finalized.state.facetCatalog.facets.length, 10);
  assert.equal(finalized.job.status, "completed");
});

test("rebuild undo snapshots every case including image-only labels and custom labels", async () => {
  const original = {
    facetCatalog: createFixedFacetCatalog(),
    entries: [
      {
        id: "text", text: "hero", customLabels: ["文本自定义"],
        facetAssignments: [{ facetId: "subject", nodeId: "subject.character", status: "confirmed", source: "manual" }]
      },
      {
        id: "image", text: "", customLabels: ["纯图片自定义"],
        facetAssignments: [{ facetId: "style", nodeId: "style.medium", status: "confirmed", source: "vision_model" }]
      }
    ]
  };
  const job = await createAnalysisBatchJob(original.entries, { id: "rebuild-undo", mode: "rebuild" });
  const undo = createAnalysisBatchUndo(job, original);
  assert.deepEqual(undo.entries.map((item) => item.entryId), ["text", "image"]);

  const changed = structuredClone(original);
  changed.facetCatalog = createFixedFacetCatalog();
  changed.facetCatalog.revision = 99;
  changed.entries[0].facetAssignments = [];
  changed.entries[0].customLabels = ["changed"];
  changed.entries[1].facetAssignments = [];
  changed.entries[1].customLabels = ["changed"];
  const restored = restoreAnalysisBatchUndo(changed, undo);

  assert.deepEqual(restored.facetCatalog, original.facetCatalog);
  assert.deepEqual(restored.entries.map((item) => item.facetAssignments), original.entries.map((item) => item.facetAssignments));
  assert.deepEqual(restored.entries.map((item) => item.customLabels), original.entries.map((item) => item.customLabels));
});

test("matching text and analysis profile do not queue a paid request", async () => {
  const unchanged = await textFingerprint("same prompt");
  const preview = await previewAnalysisBatch([{
    id: "same",
    text: "same prompt",
    analysisMeta: { textFingerprint: unchanged, profileFingerprint: "same-profile" }
  }], { profileFingerprint: "same-profile" });
  assert.equal(preview.caseCount, 0);
});

test("legacy DeepSeek results receive a text baseline instead of being sent again", async () => {
  const legacy = Array.from({ length: 74 }, (_, index) => ({
    id: `legacy-${index}`,
    text: `prompt ${index}`,
    analyzedAt: "2026-07-18T00:00:00.000Z",
    facetAssignments: [{ source: "deepseek_text", status: "confirmed", nodeId: `node-${index}` }]
  }));
  const baseline = await backfillLegacyAnalysisMeta(legacy);
  const preview = await previewAnalysisBatch(baseline.entries);
  assert.equal(baseline.updatedCount, 74);
  assert.equal(preview.caseCount, 0);
  assert.equal(baseline.entries[0].analysisMeta.textRevision, 1);
  assert.equal(baseline.entries[0].analysisMeta.textFingerprint, undefined);
});

test("batch jobs claim stable references and resume interrupted work", async () => {
  let job = await createAnalysisBatchJob([{ id: "a", text: "one" }, { id: "b", text: "two" }], { id: "job", now: "2026-07-18T00:00:00Z", outputLocale: "en" });
  assert.equal(job.outputLocale, "en");
  const claimed = claimAnalysisItems(job, 1, () => "claim-a");
  job = claimed.job;
  assert.equal(claimed.claims[0].entryId, "a");
  assert.equal(job.items[0].status, "running");

  job = resumeAnalysisBatch(job);
  assert.equal(job.items[0].status, "pending");
  assert.equal(job.status, "running");
});

test("recovering an old stalled rebuild preserves completed work and queues only unfinished cases", async () => {
  const entries = Array.from({ length: 591 }, (_, index) => ({ id: `case-${index}`, text: `prompt ${index}` }));
  const job = await createAnalysisBatchJob(entries, { id: "stalled-rebuild", mode: "rebuild" });
  for (let index = 0; index < 586; index += 1) job.items[index].status = "succeeded";
  for (let index = 586; index < 589; index += 1) {
    job.items[index].status = "running";
    job.items[index].claimId = `old-claim-${index}`;
  }

  const recovered = resumeAnalysisBatch(job);
  const summary = analysisBatchSummary(recovered);
  assert.deepEqual(summary.counts, { pending: 5, running: 0, succeeded: 586, failed: 0 });
  assert.equal(summary.status, "running");
});

test("rebuild recovery requires every successful case to exist in the matching staging area", async () => {
  const entries = [{ id: "saved", text: "one" }, { id: "failed", text: "two" }];
  const job = await createAnalysisBatchJob(entries, { id: "recoverable", mode: "rebuild" });
  job.status = "completed";
  job.items[0].status = "succeeded";
  job.items[1].status = "failed";
  job.items[1].error = "AI returned an unknown path";

  assert.deepEqual(analysisRebuildRecovery(job, {
    version: 1,
    jobId: "recoverable",
    results: { saved: { tags: [] } }
  }), {
    stagedResultCount: 1,
    stagingValid: true,
    recoverable: true
  });
  assert.deepEqual(analysisRebuildRecovery(job, {
    version: 1,
    jobId: "recoverable",
    results: {}
  }), {
    stagedResultCount: 0,
    stagingValid: false,
    recoverable: false
  });
});

test("a confirmed partial rebuild applies staged successes and leaves failures pending on the new tree", async () => {
  const state = {
    facetCatalog: createFixedFacetCatalog(),
    entries: [
      {
        id: "saved", text: "cel shaded hero",
        facetAssignments: [
          { facetId: "style", nodeId: "style.medium", status: "confirmed", source: "manual" },
          { facetId: "style", nodeId: "style.render", status: "confirmed", source: "deepseek_text" }
        ]
      },
      {
        id: "failed", text: "misty courtyard", analyzedAt: "old", analysisMeta: { promptVersion: 1 },
        facetAssignments: [
          { facetId: "scene", nodeId: "scene.place", status: "confirmed", source: "deepseek_text" },
          { facetId: "light", nodeId: "light.source", status: "confirmed", source: "vision_model" }
        ]
      },
      { id: "new-after-start", text: "new prompt", facetAssignments: [] }
    ]
  };
  const job = await createAnalysisBatchJob(state.entries.slice(0, 2), { id: "partial", mode: "rebuild" });
  job.status = "completed";
  job.items[0].status = "succeeded";
  job.items[1].status = "failed";
  job.items[1].error = "invalid response";
  const staging = {
    version: 1,
    jobId: "partial",
    results: {
      saved: {
        tags: [{ g: "style.render", t: "赛璐珞" }],
        fingerprint: "fingerprint",
        textRevision: 1,
        model: "model",
        usage: { totalTokens: 10 }
      }
    }
  };

  const finalized = finalizePartialAnalysisRebuild(job, staging, state, "2026-08-03T01:00:00.000Z");
  const saved = finalized.state.entries.find((entry) => entry.id === "saved");
  const failed = finalized.state.entries.find((entry) => entry.id === "failed");
  const added = finalized.state.entries.find((entry) => entry.id === "new-after-start");

  assert.equal(finalized.job.partialApplied, true);
  assert.equal(saved.analysisPending, false);
  assert.equal(saved.facetAssignments.some((item) => item.source === "manual"), true);
  assert.equal(saved.facetAssignments.some((item) => item.source === "deepseek_text"), true);
  assert.equal(failed.analysisPending, true);
  assert.equal(failed.facetAssignments.some((item) => item.source === "deepseek_text"), false);
  assert.equal(failed.facetAssignments.some((item) => item.source === "vision_model"), true);
  assert.equal(failed.analysisMeta, null);
  assert.equal(added.analysisPending, true);
  assert.equal(finalized.state.facetCatalog.facets.length, 10);
});

test("batch success totals usage and failures can be retried", async () => {
  let job = await createAnalysisBatchJob([{ id: "a", text: "one" }, { id: "b", text: "two" }], { id: "job" });
  let claimed = claimAnalysisItems(job, 2, (() => { let index = 0; return () => `claim-${++index}`; })());
  job = succeedAnalysisItem(claimed.job, "a", "claim-1", { totalTokens: 12, cacheHitTokens: 7 }, 4);
  job = failAnalysisItem(job, "b", "claim-2", { message: "busy", status: 503 });
  let summary = analysisBatchSummary(job);
  assert.equal(summary.status, "completed");
  assert.equal(summary.counts.succeeded, 1);
  assert.equal(summary.counts.failed, 1);
  assert.equal(summary.usage.totalTokens, 12);

  job = retryFailedAnalysisItems(job);
  assert.equal(job.status, "running");
  assert.equal(job.items[1].status, "pending");
  job = cancelAnalysisBatch(job);
  assert.equal(job.status, "canceled");
});

test("failed analysis records token usage from rejected model output", async () => {
  let job = await createAnalysisBatchJob([{ id: "a", text: "one" }], { id: "failed-usage" });
  job = claimAnalysisItems(job, 1, () => "claim").job;
  job = failAnalysisItem(job, "a", "claim", {
    message: "AI 必须返回 1–10 个标签，本次没有写入",
    status: 422,
    usage: { promptTokens: 18, completionTokens: 2, totalTokens: 20, cacheHitTokens: 7 }
  });

  assert.equal(job.usage.promptTokens, 18);
  assert.equal(job.usage.completionTokens, 2);
  assert.equal(job.usage.totalTokens, 20);
  assert.equal(job.usage.cacheHitTokens, 7);
});

test("authentication failures pause the whole batch", async () => {
  let job = await createAnalysisBatchJob([{ id: "a", text: "one" }], { id: "job" });
  const claimed = claimAnalysisItems(job, 1, () => "claim");
  job = failAnalysisItem(claimed.job, "a", "claim", { message: "bad key", status: 401 });
  assert.equal(job.status, "paused");
  assert.equal(job.items[0].status, "failed");
});

test("vision batch defaults to one primary image per selected case and can include every unanalysed image", async () => {
  const entries = [{
    id: "one",
    primaryMediaId: "one-a",
    mediaAssets: [
      { id: "one-a", kind: "image", usage: "content" },
      { id: "one-b", kind: "image", usage: "content", visionAnalysis: { description: "already analysed" } },
      { id: "one-c", kind: "image", usage: "content" },
      { id: "one-poster", kind: "image", usage: "poster" }
    ]
  }, {
    id: "two",
    primaryMediaId: "two-a",
    mediaAssets: [{ id: "two-a", kind: "image", usage: "content" }]
  }];
  const primary = previewVisionBatch(entries, {
    entryIds: ["one", "two"],
    includeAllImages: false,
    reanalyze: false,
    providerType: "compatible",
    model: "vision-model"
  });
  assert.deepEqual(primary.items.map((item) => item.visualId), ["one-a", "two-a"]);

  const all = previewVisionBatch(entries, {
    entryIds: ["one", "two"],
    includeAllImages: true,
    reanalyze: false
  });
  assert.deepEqual(all.items.map((item) => item.visualId), ["one-a", "one-c", "two-a"]);
  assert.equal(all.skippedAnalyzedCount, 1);

  const job = createVisionBatchJob(entries, {
    entryIds: ["one"],
    includeAllImages: true,
    reanalyze: true,
    providerType: "openai",
    model: "gpt-vision"
  });
  assert.equal(job.kind, "vision");
  assert.equal(job.items.length, 3);
  assert.equal(job.requestCount, 3);

  const firstClaim = claimAnalysisItems(job, 1, () => "claim-one");
  const afterFirst = succeedAnalysisItem(firstClaim.job, "one", "claim-one", { totalTokens: 4 });
  const secondClaim = claimAnalysisItems(afterFirst, 1, () => "claim-two");
  assert.equal(secondClaim.claims[0].visualId, "one-b");
  const afterSecond = succeedAnalysisItem(secondClaim.job, "one", "claim-two", { totalTokens: 5 });
  assert.equal(analysisBatchSummary(afterSecond).counts.succeeded, 2);
});

test("vision batch resumes after a saved result without paying for the same image twice", () => {
  const job = createVisionBatchJob([{
    id: "one",
    primaryMediaId: "one-a",
    mediaAssets: [{ id: "one-a", kind: "image", usage: "content" }]
  }], {
    id: "vision-job",
    entryIds: ["one"]
  });
  const claimed = claimAnalysisItems(job, 1, () => "claim-one");
  const reconciled = reconcileVisionBatchResults(claimed.job, [{
    id: "one",
    mediaAssets: [{
      id: "one-a",
      kind: "image",
      usage: "content",
      visionAnalysis: {
        description: "云端白龙与少女",
        batchJobId: "vision-job",
        usage: { inputTokens: 40, outputTokens: 20, totalTokens: 60 }
      }
    }]
  }]);

  assert.equal(reconciled.recoveredCount, 1);
  assert.equal(reconciled.job.status, "completed");
  assert.equal(reconciled.job.items[0].status, "succeeded");
  assert.equal(reconciled.job.usage.totalTokens, 60);
  assert.deepEqual(claimAnalysisItems(reconciled.job, 1).claims, []);
});
