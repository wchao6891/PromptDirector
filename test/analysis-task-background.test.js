import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const background = await readFile(new URL("../extension/background.js", import.meta.url), "utf8");

test("background exposes the persisted Composer analysis task protocol and retires the direct paid entry point", () => {
  for (const type of [
    "START_OR_JOIN_ANALYSIS_TASK",
    "GET_ANALYSIS_TASK",
    "DETACH_ANALYSIS_CONSUMER",
    "STOP_ANALYSIS_TASK",
    "RETRY_ANALYSIS_TASK"
  ]) assert.match(background, new RegExp(`case \\"${type}\\"`));
  assert.doesNotMatch(background, /case "ANALYZE_TEMP_REFERENCES"/);
  assert.match(background, /execution_state_unknown/);
  assert.match(background, /confirmDuplicateCharge/);
  assert.match(background, /ANALYSIS_TASK_UPDATED/);
});

test("temporary-reference analysis checks the active Attempt again before writing session results", () => {
  const action = background.slice(
    background.indexOf("async function analyzeTempReferencesAction"),
    background.indexOf("async function getTempReferenceVisionBlob")
  );
  assert.match(action, /analysisTaskAttemptIsActive/);
  assert.match(action, /priority/);
});

test("video analysis is dispatched to Offscreen and the service worker never owns the provider request", () => {
  const runner = background.slice(
    background.indexOf("async function runAnalysisTask"),
    background.indexOf("async function recoverAnalysisTasks")
  );
  assert.match(runner, /claimed\.request\.kind === "entry_video"/);
  assert.match(runner, /dispatchVideoAnalysisTask/);
  assert.match(background, /type: "RUN_VIDEO_ANALYSIS"/);
  assert.match(background, /case "UPDATE_VIDEO_ANALYSIS_PROGRESS"/);
  assert.match(background, /case "COMPLETE_VIDEO_ANALYSIS"/);
  assert.match(background, /case "FAIL_VIDEO_ANALYSIS"/);
  assert.doesNotMatch(background, /async function analyzeEntryVideoTaskAction/);
  assert.doesNotMatch(background, /VIDEO_ANALYSIS_ADAPTERS/);
  assert.doesNotMatch(background, /case "ANALYZE_ENTRY_VIDEO"/);
});

test("analysis runner ownership is always released when settlement persistence fails", () => {
  const runner = background.slice(
    background.indexOf("async function runAnalysisTask"),
    background.indexOf("async function recoverAnalysisTasks")
  );
  assert.match(runner, /finally\s*\{\s*analysisTaskRunners\.delete\(taskId\)/);
});

test("video batch settlement is serialized and service-worker recovery never resends unknown paid attempts", () => {
  const completion = background.slice(
    background.indexOf("async function completeVideoAnalysisAction"),
    background.indexOf("async function updateVideoReconstructionPrompt")
  );
  const startup = background.slice(
    background.indexOf("scheduleLibraryMaintenanceRunner()"),
    background.indexOf("chrome.contextMenus.onClicked")
  );
  const recovery = background.slice(
    background.indexOf("async function recoverVideoBatchExecutionState"),
    background.indexOf("async function analysisTaskAttemptIsActive")
  );
  assert.match(completion, /enqueue\(\(\) => settleVideoBatchTask/);
  assert.match(startup, /await recoverAnalysisTasks\(\);\s*await recoverVideoBatchExecutionState\(\);\s*scheduleAnalysisBatchRunner\(\)/);
  assert.match(recovery, /上次执行状态未知，未自动重试/);
  assert.match(recovery, /candidate\.id === item\.taskId/);
  assert.match(recovery, /analysis\.requestId === item\.requestId/);
  assert.match(recovery, /task\.request\.batchClaimId === item\.claimId/);
  assert.doesNotMatch(recovery, /retryFailedAnalysisItems/);
});

test("video batches exclude busy assets and never join an unrelated single-item task", () => {
  const preview = background.slice(
    background.indexOf("async function previewVideoBatchTask"),
    background.indexOf("async function createVideoBatchTask")
  );
  const start = background.slice(
    background.indexOf("async function startOrJoinAnalysisTaskAction"),
    background.indexOf("async function getAnalysisTaskAction")
  );
  const runner = background.slice(
    background.indexOf("async function runPersistedVideoBatchSlice"),
    background.indexOf("async function settleVideoBatchTask")
  );
  assert.match(preview, /\["queued", "running"\]\.includes\(task\.status\)/);
  assert.match(preview, /preview\.exclusions = exclusions/);
  assert.match(preview, /fingerprint: await videoAssetFingerprint\(blob\)/);
  assert.match(preview, /exclusionCounts/);
  assert.match(start, /task\.request\.batchJobId !== String\(message\.batchJobId\)\.trim\(\)/);
  assert.match(runner, /response\.task\?\.request\?\.batchJobId !== prepared\.job\.id/);
  assert.match(runner, /未重复发送/);
  assert.match(runner, /sourceFingerprint: claim\.fingerprint/);
  assert.match(runner, /batchClaimId: claim\.claimId/);
  assert.match(runner, /videoAnalysisRouteMatches\(job, route\)/);
  assert.match(runner, /routeEndpoint: prepared\.job\.endpoint/);
  assert.match(runner, /routeProviderId: prepared\.job\.providerId/);
  assert.match(runner, /routeModel: prepared\.job\.model/);
  assert.match(runner, /sourceKind: claim\.sourcePlan/);
  const dispatch = background.slice(
    background.indexOf("async function dispatchVideoAnalysisTask"),
    background.indexOf("async function updateVideoReconstructionPrompt")
  );
  assert.match(dispatch, /videoAnalysisRouteMatches\(requestRouteSnapshot, route\)/);
  assert.match(dispatch, /type: "RUN_VIDEO_ANALYSIS"/);
  assert.match(dispatch, /deadlineAt/);
});
