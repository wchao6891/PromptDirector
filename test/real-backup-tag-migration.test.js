import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { migrateLegacyFacetState } from "../tag-taxonomy.js";

const backupPath = process.env.PROMPTDIRECTOR_BACKUP_PATH;

test("a representative backup sample collapses generated dimensions into the fixed tree without losing source data", {
  skip: backupPath && existsSync(backupPath) ? false : "set PROMPTDIRECTOR_BACKUP_PATH to run the representative backup sample"
}, () => {
  const backup = JSON.parse(readFileSync(backupPath, "utf8"));
  const originalManual = backup.entries.reduce((sum, entry) => sum +
    (entry.facetAssignments ?? []).filter((item) => item.source === "manual").length, 0);
  const originalVisual = backup.entries.reduce((sum, entry) => sum +
    (entry.facetAssignments ?? []).filter((item) => ["vision_model", "local_image_review"].includes(item.source)).length, 0);
  const migrated = migrateLegacyFacetState(backup.entries, backup.facetCatalog);

  assert.ok(backup.facetCatalog.facets.length > 10);
  assert.equal(migrated.catalog.facets.length, 10);
  assert.equal(migrated.entries.length, backup.entries.length);
  assert.equal(migrated.catalog.facets.some((item) => item.name === "渲染风格" || item.name === "灯光风格"), false);
  assert.equal(migrated.entries.some((entry) => (entry.facetAssignments ?? []).some((item) => item.source === "deepseek_text")), false);

  for (let index = 0; index < backup.entries.length; index += 1) {
    assert.equal(migrated.entries[index].id, backup.entries[index].id);
    assert.equal(migrated.entries[index].text, backup.entries[index].text);
    assert.deepEqual(migrated.entries[index].mediaAssets, backup.entries[index].mediaAssets);
    assert.deepEqual(migrated.entries[index].visuals, backup.entries[index].visuals);
    assert.deepEqual(migrated.entries[index].visionAnalysis, backup.entries[index].visionAnalysis);
  }

  const retainedAssignments = migrated.entries.flatMap((entry) => entry.facetAssignments ?? []);
  const retainedCustom = migrated.entries.reduce((sum, entry) => sum + (entry.customLabels ?? []).length, 0);
  assert.equal(retainedAssignments.filter((item) => item.source === "manual").length + (migrated.customBySource.manual ?? 0), originalManual);
  assert.equal(retainedAssignments.filter((item) => ["vision_model", "local_image_review"].includes(item.source)).length +
    (migrated.customBySource.vision_model ?? 0) + (migrated.customBySource.local_image_review ?? 0), originalVisual);
  assert.ok(retainedCustom >= migrated.customCount);
});
