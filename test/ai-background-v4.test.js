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
