import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import { createImportJob, startImportJob, finishImportItem } from "../extension/import-jobs.js";
import { addStagedAsset, stagedAssetById, removeStagedAsset } from "../extension/import-staging.js";
import { normalizeOrganizerState } from "../extension/organizer.js";

const background = await readFile(new URL("../extension/background.js", import.meta.url), "utf8");
const implementation = background.slice(background.indexOf("const IMPORT_SLICE_PREPARE_MS"),
  background.indexOf("function importedEntryFromStagedAsset"));

function harness({ missing = [], failCommit = false, tick = 0 } = {}) {
  let staging;
  for (const id of ["first", "middle", "last"]) {
    staging = addStagedAsset(staging, { id, assetId: id, name: `${id}.txt`, relativePath: `${id}.txt`,
      kind: "document", mimeType: "text/plain", byteSize: 1, contentHash: "a".repeat(64) }).state;
  }
  const created = createImportJob({}, { collectionId: "project", items: staging.assets.map(asset => ({ stagedAssetId: asset.id })) });
  let durable = { entries: [{ id: "existing" }], importJobs: created.state, importStaging: staging,
    organizerState: normalizeOrganizerState({ collections: [{ id: "project", name: "Project", entryIds: ["existing"] }] }) };
  const original = structuredClone(durable);
  const writes = [], maintained = [];
  let clock = 0;
  const context = vm.createContext({ startImportJob, finishImportItem, stagedAssetById, removeStagedAsset, normalizeOrganizerState,
    performance: { now: () => clock += tick },
    STORAGE_KEYS: Object.fromEntries(Object.keys(durable).map(key => [key, key])),
    getMediaBlob: async id => missing.includes(id) ? null : new Blob(["a"]),
    importedEntryFromStagedAsset: (_state, staged) => ({ id: `entry:${staged.id}` }),
    userMessage: error => error.message,
    commitLocalChanges: async update => {
      if (failCommit) throw new Error("disk full");
      writes.push(structuredClone(update));
      durable = { ...durable, ...structuredClone(update) };
    },
    enqueueAutomaticLibraryMaintenance: async entries => maintained.push(...entries),
    notifySaved: async () => {}, queueImportJobAnalysis: async () => {}
  });
  vm.runInContext(implementation, context);
  return { run: () => context.importStagedItems(structuredClone(durable), durable.importJobs.items[0]),
    state: () => durable, original, writes, maintained };
}

test("one unreadable original does not block healthy files or remove the failed staging record", async () => {
  const h = harness({ missing: ["middle"] });
  await h.run();
  assert.equal(h.writes.length, 1);
  assert.deepEqual(h.state().entries.map(e => e.id), ["existing", "entry:first", "entry:last"]);
  assert.deepEqual(h.state().importJobs.items[0].items.map(i => i.status), ["imported", "failed", "imported"]);
  assert.deepEqual(h.state().importStaging.assets.map(a => a.id), ["middle"]);
  assert.deepEqual(h.state().organizerState.collections[0].entryIds, ["existing", "entry:first", "entry:last"]);
  assert.equal(h.maintained.length, 2);
});

test("a failed batch commit leaves cases, queued receipts and staged originals unchanged", async () => {
  const h = harness({ failCommit: true });
  await assert.rejects(h.run(), /disk full/);
  assert.deepEqual(h.state(), h.original);
  assert.equal(h.maintained.length, 0);
});

test("preparation time budget yields with remaining items queued and resumes without duplicates", async () => {
  const h = harness({ tick: 101 });
  await h.run();
  assert.deepEqual(h.state().importJobs.items[0].items.map(i => i.status), ["imported", "queued", "queued"]);
  await h.run();
  await h.run();
  assert.equal(h.state().entries.length, 4);
  assert.equal(h.state().importJobs.items[0].status, "completed");
  assert.equal(h.state().importStaging.assets.length, 0);
});
