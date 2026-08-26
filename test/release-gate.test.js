import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const packageJson = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
const e2eSupport = await readFile(new URL("./e2e_support.py", import.meta.url), "utf8");

test("the only release verification gate runs source tests and browser E2E before packaging", () => {
  const scripts = packageJson.scripts;
  assert.equal(scripts.verify, "npm run verify:release");
  assert.match(scripts["verify:source"], /npm test/);
  assert.match(scripts["verify:release"], /npm run verify:source/);
  assert.match(scripts["verify:release"], /npm run test:e2e/);
  assert.match(scripts["verify:release"], /npm run package:release/);
  assert.ok(scripts["verify:release"].indexOf("npm run test:e2e") < scripts["verify:release"].indexOf("npm run package:release"));
  assert.equal((scripts["verify:release"].match(/package:release/g) ?? []).length, 1);
});

test("installed-package acceptance can point the shared browser harness at an unpacked artifact", () => {
  assert.match(e2eSupport, /PROMPTDIRECTOR_E2E_EXTENSION_DIR/);
});
