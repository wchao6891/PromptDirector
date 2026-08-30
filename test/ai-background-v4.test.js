import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const source = await readFile(new URL("../background.js", import.meta.url), "utf8");

test("background accepts only the Registry v4 AI configuration message", () => {
  assert.match(source, /case "UPDATE_AI_PROVIDER_CONFIGURATION"/);
  for (const legacyType of [
    "UPDATE_AI_SETTINGS",
    "UPDATE_AI_TEXT_PROVIDER",
    "UPDATE_VISION_SETTINGS",
    "UPDATE_AI_VISION_PROVIDER",
    "PROBE_VISION_MODELS"
  ]) {
    assert.doesNotMatch(source, new RegExp(`case "${legacyType}"`));
  }
});

test("background AI persistence reads and writes only the three Registry v4 keys", () => {
  const storageKeys = source.slice(source.indexOf("const STORAGE_KEYS"), source.indexOf("const SYNCED_STORAGE_KEYS"));
  for (const legacyKey of ["aiSettings", "visionSettings", "aiServiceProfiles", "aiTaskRoutes"]) {
    assert.doesNotMatch(storageKeys, new RegExp(`${legacyKey}:`));
  }

  const persistence = source.slice(
    source.indexOf("async function loadAiConfiguration"),
    source.indexOf("function aiConfigurationResponse")
  );
  assert.match(persistence, /STORAGE_KEYS\.aiProviderRegistry/);
  assert.match(persistence, /STORAGE_KEYS\.aiTaskAssignments/);
  assert.match(persistence, /STORAGE_KEYS\.aiPreferences/);
  assert.doesNotMatch(persistence, /chrome\.storage\.local\.remove/);
});

test("background keeps service profiles for job execution but stops publishing obsolete task routes", () => {
  assert.match(source, /aiServiceProfiles: publicAiServiceProfiles/);
  assert.doesNotMatch(source, /aiTaskRoutes:/);
});

test("connection model preview reads the account catalog without persisting credentials or routes", () => {
  const preview = source.slice(
    source.indexOf("async function previewAiProviderModels"),
    source.indexOf("async function discoverAiProviderModels")
  );
  assert.match(source, /case "PREVIEW_AI_PROVIDER_MODELS"/);
  assert.match(preview, /aiProviderModule\.discoverModels/);
  assert.match(preview, /publicAiProviderRegistry\(previewRegistry\)/);
  assert.doesNotMatch(preview, /persistAiConfiguration/);
  assert.doesNotMatch(preview, /chrome\.storage/);
});

test("persisted batch recovery wakes the runner while runner exceptions become visible failures", () => {
  const recovery = source.slice(
    source.indexOf("async function recoverDeepSeekBatch"),
    source.indexOf("async function undoDeepSeekBatch")
  );
  assert.match(recovery, /ensureAnalysisBatchAlarm\(true\)/);
  assert.match(recovery, /scheduleAnalysisBatchRunner\(\)/);

  const runner = source.slice(
    source.indexOf("async function runPersistedAnalysisBatch"),
    source.indexOf("async function runPersistedTextBatchSlice")
  );
  assert.match(runner, /catch \(error\)[\s\S]*failUnfinishedAnalysisItems\(current,[\s\S]*commitLocalChanges\(\{ \[STORAGE_KEYS\.batchJob\]: failed \}\)/);
  assert.match(runner, /ensureAnalysisBatchAlarm\(false\)[\s\S]*continueRunning = false/);
});

test("vision batch runner cancels stale model snapshots instead of blocking new settings", () => {
  const claim = source.slice(
    source.indexOf("async function claimVisionBatchItem"),
    source.indexOf("async function completeVisionBatchItem")
  );
  const runner = source.slice(
    source.indexOf("async function runPersistedVisionBatchSlice"),
    source.indexOf("async function finalizeVisionBatchResults")
  );
  assert.match(claim, /const currentSettings = resolveVisionTaskSettings\("imageAnalysis", loadedConfiguration, \{ requireConfigured: false \}\);/);
  assert.match(claim, /job\.providerType !== currentSettings\.activeProvider \|\| job\.model !== currentModel/);
  assert.match(claim, /const canceled = cancelAnalysisBatch\(job\)/);
  assert.match(runner, /const currentSettings = resolveVisionTaskSettings\("imageAnalysis", configuration, \{ requireConfigured: false \}\);/);
  assert.match(runner, /job\.providerType !== currentSettings\.activeProvider \|\| job\.model !== currentModel/);
  assert.match(runner, /job = cancelAnalysisBatch\(job\)/);
});

test("vision retries and structured-output correction share one per-image provider-call budget", () => {
  const scheduled = source.slice(
    source.indexOf("async function analyzeVisionBlobWithScheduler"),
    source.indexOf("async function analyzeEntryVideo")
  );
  assert.match(scheduled, /const requestBudget = createVisionRequestBudget\(\)/);
  assert.match(scheduled, /runScheduledAnalysisWithRetries\([\s\S]*analyzeImageWithVision\([\s\S]*requestBudget/);
});
