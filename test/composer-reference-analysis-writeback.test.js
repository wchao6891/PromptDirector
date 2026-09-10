import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFile } from "node:fs/promises";
import { createComposerSession, normalizeComposerSessions } from "../extension/composer.js";
import { unreadReferenceImageAssets } from "../extension/temp-references.js";

const background = await readFile(new URL("../extension/background.js", import.meta.url), "utf8");
const actionSource = background.slice(background.indexOf("async function analyzeTempReferencesAction"), background.indexOf("async function getTempReferenceVisionBlob"));

function harness(beforeCommit = () => {}) {
  const session = createComposerSession({ id: "session", referenceSnapshots: [1, 2].map((number) => ({
    entryId: "case", referenceId: `case:image-${number}`, assetId: `image-${number}`,
    alias: `@参考${number}`, title: "Fixture image case", imageRefs: [{ visualId: `image-${number}`, mimeType: "image/png" }]
  })) });
  let stored = { composerSessions: [session], entries: [{ id: "case", mediaAssets: [{ id: "image-1" }, { id: "image-2" }] }], facetCatalog: { revision: 1 } };
  let commits = 0;
  const applied = [];
  const blobs = new Map([1, 2].map((number) => [`image-${number}`, { fingerprint: `original-${number}` }]));
  const scope = {
    chrome: { storage: { local: { get: async (keys) => Object.fromEntries((Array.isArray(keys) ? keys : [keys]).map((key) => [key, structuredClone(stored[key])])) } } },
    STORAGE_KEYS: {composerSessions: "composerSessions", entries: "entries", facetCatalog: "facetCatalog", visionAnalysisUndo: "visionAnalysisUndo"},
    normalizeComposerSessions, createComposerSession, unreadReferenceImageAssets,
    loadAiConfiguration: async () => ({}), VISION_ANALYSIS_VERSION: 2,
    getTempReferenceVisionBlob: async (asset) => blobs.get(asset.assetId),
    analyzeVisionBlobWithScheduler: async ({blob}) => ({fingerprint: blob.fingerprint, result: {description: "Visible facts", reconstructionPrompt: "Reconstruction", profileFingerprint: "fixture"}}),
    imageFingerprint: async (blob) => blob.fingerprint,
    enqueue: async (callback) => { beforeCommit({stored, blobs}); return callback(); },
    readState: async () => structuredClone(stored), domainState: (value) => value,
    normalizeEntryVisuals: (entry) => ({visuals: entry.mediaAssets}),
    getVisionImageBlob: async (id) => blobs.get(id),
    applyCompletedVisionResult: (state, entry, visual) => { applied.push(visual.id); return {state, undo: {visualId: visual.id}}; },
    storagePayload: (state) => ({entries: state.entries}),
    commitLocalChanges: async (changes) => { commits += 1; stored = {...stored, ...structuredClone(changes)}; },
    sessionSummary: (value) => ({id: value.id}), userMessage: (error) => error.message,
    analysisTaskAttemptIsActive: async () => true
  };
  const action = vm.runInNewContext(`${actionSource}\nanalyzeTempReferencesAction`, scope);
  return {run: () => action({sessionId: "session", tempReferenceIds: session.referenceSnapshots.map(reference => reference.referenceId)}), committed: () => commits, applied, state: () => stored};
}

test("explicit analysis identifies both selected images from one case and commits once", async () => {
  const run = harness();
  const result = await run.run();
  assert.equal(result.ok, true, result.message);
  assert.deepEqual(run.applied, ["image-1", "image-2"]);
  assert.equal(run.committed(), 1);
  assert.equal(run.state().composerSessions[0].referenceSnapshots.filter(reference => reference.assets.some(asset => asset.reconstructionPrompt === "Reconstruction")).length, 2);
});

test("deleting the source case while explicit analysis runs never recreates it", async () => {
  const run = harness(({stored}) => {stored.entries = [];});
  const result = await run.run();
  assert.equal(result.ok, false);
  assert.match(result.message, /源案例或图片已经变化/);
  assert.equal(run.committed(), 0);
  assert.deepEqual(run.state().entries, []);
});

test("replacing a source image while analysis runs rejects stale results without changing the session", async () => {
  const run = harness(({blobs}) => {blobs.set("image-2", {fingerprint: "replacement"});});
  const result = await run.run();
  assert.equal(result.ok, false);
  assert.match(result.message, /参考图片已经变化/);
  assert.equal(run.committed(), 0);
  assert.equal(run.applied.length, 0);
});
