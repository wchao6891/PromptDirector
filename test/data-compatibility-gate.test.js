import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";

const projectRoot = new URL("../", import.meta.url);

test("the compatibility gate validates every published package and released storage baseline", () => {
  const result = spawnSync(process.execPath, ["tools/check-data-compatibility.mjs", "--json"], {
    cwd: projectRoot,
    encoding: "utf8"
  });

  assert.equal(result.status, 0, result.stderr || result.stdout);
  const report = JSON.parse(result.stdout);
  assert.deepEqual(report.packageVersions.checked, report.packageVersions.supported);
  assert.ok(report.storageSchemas.checked.includes(report.releaseBaseline.schemaVersion));
  assert.ok(report.storageSchemas.checked.includes(report.current.schemaVersion));
  assert.equal(report.current.packageVersion, report.packageVersions.supported.at(-1));
  assert.ok(report.current.schemaVersion >= report.releaseBaseline.schemaVersion);
});
