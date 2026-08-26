import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import { CURRENT_LIBRARY_PACKAGE_VERSION } from "../library-package-format.js";
import { prepareLibraryPackageDraft } from "../library-package-migrations.js";
import { mergeLibraryPackage, parseLibraryPackage } from "../library-package.js";
import { SCHEMA_VERSION } from "../taxonomy.js";

const fixtureRoot = new URL("./fixtures/compat/", import.meta.url);

test("the fixed v1-v5 compatibility fixtures all enter the current draft model with explicit provenance", async () => {
  const provenance = await readJson(new URL("provenance.json", fixtureRoot));
  assert.deepEqual(Object.keys(provenance.packages), ["v1", "v2", "v3", "v4", "v5"]);

  for (const version of [1, 2, 3, 4, 5]) {
    const key = `v${version}`;
    const source = await readJson(new URL(`${key}/library.json`, fixtureRoot));
    const origin = provenance.packages[key];
    assert.equal(origin.originalFailureArchive, false, `${key} must not claim to be a user failure archive`);
    assert.match(origin.provenanceType, /reconstructed/u);
    assert.ok(origin.sourceCommit);

    const result = prepareLibraryPackageDraft(source);
    assert.equal(result.sourceVersion, version);
    assert.equal(result.draft.version, CURRENT_LIBRARY_PACKAGE_VERSION);
    assert.equal(result.draft.schemaVersion, SCHEMA_VERSION);
    assert.deepEqual(result.draft.entries.map((entry) => entry.id), [`fixture:v${version}`]);
    assert.equal(result.draft.entries[0].schemaVersion, SCHEMA_VERSION);
    assert.equal(result.draft.entries[0].mediaAssets.length, 1);
    assert.equal(Object.hasOwn(result.draft.entries[0], "visuals"), false);
    assert.equal(Object.hasOwn(result.draft.entries[0], "screenshotPath"), false);
    if (version === 4) assert.equal(result.draft.entries[0].mediaAssets[0].sourceFormat, "jpg");
  }
});

test("the production parser drops a dangling AI label without rejecting the recoverable case", async () => {
  const source = await readJson(new URL("v5/library.json", fixtureRoot));
  const asset = source.entries[0].mediaAssets[0];
  source.entries[0].facetAssignments = [{
    facetId: "missing-facet",
    nodeId: "missing-node",
    visualId: asset.id,
    status: "confirmed",
    source: "vision_model"
  }];
  const parsed = parseLibraryPackage(source, new Map([[
    asset.assetPath,
    new Blob(["fixture-v5"], { type: asset.mimeType })
  ]]), { skipMediaByteValidation: true });

  assert.equal(parsed.entries.length, 1);
  assert.deepEqual(parsed.entries[0].facetAssignments, []);
  assert.equal(parsed.importStats.droppedAiAssignments, 1);
  assert.deepEqual(parsed.importDiagnostics.map(({ code }) => code), ["ai_assignment_dropped"]);
});

test("the production import preview exposes salvage diagnostics for the user report", async () => {
  const source = await readJson(new URL("v5/library.json", fixtureRoot));
  source.entries[0].facetAssignments = [{
    facetId: "missing-facet",
    nodeId: "missing-node",
    status: "confirmed",
    source: "vision_model"
  }];
  const result = mergeLibraryPackage({ entries: [] }, source);

  assert.equal(result.importedCount, 1);
  assert.equal(result.importStats.droppedAiAssignments, 1);
  assert.deepEqual(result.importDiagnostics.map(({ code }) => code), ["ai_assignment_dropped"]);
});

async function readJson(url) {
  return JSON.parse(await readFile(url, "utf8"));
}
