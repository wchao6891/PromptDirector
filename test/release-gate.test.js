import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const packageJson = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
const e2eSupport = await readFile(new URL("./e2e_support.py", import.meta.url), "utf8");

test("the only release verification gate runs source tests and the packaged fixed-id lab before the store package", () => {
  const scripts = packageJson.scripts;
  assert.equal(scripts.verify, "npm run verify:release");
  assert.match(scripts["verify:source"], /npm test/);
  assert.match(scripts["verify:release"], /npm run verify:source/);
  assert.match(scripts["verify:release"], /npm run test:local-extension/);
  assert.match(scripts["verify:release"], /npm run package:release/);
  assert.ok(scripts["verify:release"].indexOf("npm run test:local-extension") < scripts["verify:release"].indexOf("npm run package:release"));
  assert.equal((scripts["verify:release"].match(/package:release/g) ?? []).length, 1);
});

test("installed-package acceptance can point the shared browser harness at an unpacked artifact", () => {
  assert.match(e2eSupport, /PROMPTDIRECTOR_E2E_EXTENSION_DIR/);
});

test("the shared browser harness has a deterministic default UI language across operating systems", () => {
  assert.match(e2eSupport, /locale="zh-CN"/);
});

test("release verification cannot bypass the historical data compatibility gate", () => {
  const scripts = packageJson.scripts;
  assert.equal(scripts["check:compat"], "node tools/check-data-compatibility.mjs");
  assert.match(scripts["verify:source"], /npm run check:compat/);
});

test("release verification rehearses an installed-profile upgrade with the final fixed-id package", () => {
  const scripts = packageJson.scripts;
  assert.equal(scripts["test:upgrade"], "node tools/run-release-upgrade-e2e.mjs");
  assert.match(scripts["test:local-extension"], /npm run package/);
  assert.match(scripts["verify:release"], /npm run test:upgrade/);
  assert.ok(scripts["verify:release"].indexOf("npm run test:local-extension") < scripts["verify:release"].indexOf("npm run test:upgrade"));
});

test("GitHub runs source contracts and packaged Chromium journeys before main can advance", async () => {
  const workflow = await readFile(new URL("../.github/workflows/release-safety.yml", import.meta.url), "utf8");
  assert.match(workflow, /pull_request:/);
  assert.doesNotMatch(workflow, /^  push:/m, 'protected PR evidence is not rerun unchanged after merge');
  assert.match(workflow, /workflow_dispatch:/, 'a full release can be explicitly verified');
  assert.match(workflow, /fetch-depth:\s*0/);
  assert.match(workflow, /npm run verify:source/);
  assert.match(workflow, /ci-release\.py browser/, 'shards load the single packaged runtime');
  assert.match(workflow, /npm run package:release/);
  assert.match(workflow, /npm run package/);
  assert.match(workflow, /npm run test:upgrade/);
  assert.match(workflow, /ci-release\.py seal/, 'all ZIP channels have checksums and CRC verified before sharing');
  assert.match(workflow, /ci-release\.py gate/);
  assert.match(workflow, /if: always\(\)/);
});

test('CI planning and package evidence reject unsafe reductions and missing results', async () => {
  const { execFileSync } = await import('node:child_process');
  execFileSync(process.platform === 'win32' ? 'python' : 'python3',
    ['-m', 'unittest', 'discover', '-s', 'test', '-p', 'ci_release_test.py'],
    { cwd: new URL('..', import.meta.url), stdio: 'pipe' });
});
