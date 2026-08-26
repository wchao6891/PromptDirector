import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const background = await readFile(new URL("../background.js", import.meta.url), "utf8");

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

test("analysis runner ownership is always released when settlement persistence fails", () => {
  const runner = background.slice(
    background.indexOf("async function runAnalysisTask"),
    background.indexOf("async function recoverAnalysisTasks")
  );
  assert.match(runner, /finally\s*\{\s*analysisTaskRunners\.delete\(taskId\)/);
});
