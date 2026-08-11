import test from "node:test";
import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";

const root = new URL("../", import.meta.url);

test("extension runtime keeps strict CSP and contains no dynamic JavaScript execution", async () => {
  const manifest = JSON.parse(await readFile(new URL("manifest.json", root), "utf8"));
  const policy = manifest.content_security_policy?.extension_pages ?? "";
  assert.match(policy, /script-src 'self'/);
  assert.doesNotMatch(policy, /unsafe-eval|unsafe-inline/);

  const names = (await readdir(root, { withFileTypes: true }))
    .filter((entry) => entry.isFile() && entry.name.endsWith(".js"))
    .map((entry) => entry.name);
  for (const name of names) {
    const source = await readFile(new URL(name, root), "utf8");
    assert.doesNotMatch(source, /\beval\s*\(|\bnew\s+Function\s*\(/, `${name} must not execute generated JavaScript`);
  }
});
