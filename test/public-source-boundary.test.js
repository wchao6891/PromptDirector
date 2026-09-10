import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, copyFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

async function checkMarkdown(content) {
  const root = await mkdtemp(join(tmpdir(), "public-source-boundary-"));
  try {
    await mkdir(join(root, "tools"));
    await copyFile(new URL("../tools/validate-public-source.mjs", import.meta.url), join(root, "tools", "validate-public-source.mjs"));
    await writeFile(join(root, "README.md"), content);
    return spawnSync(process.execPath, [join(root, "tools", "validate-public-source.mjs")], { encoding: "utf8" });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

test("public documentation rejects machine-specific macOS screenshot paths", async () => {
  for (const prefix of ["/private/var/folders/", "/var/folders/"]) {
    const result = await checkMarkdown(`Screenshot: ${prefix}example/T/capture.png`);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /公开文档包含维护者本机路径/);
  }
});

test("public documentation rejects local home and temporary workspace paths", async () => {
  for (const path of ["/Users/example/project/notes.md", "/private/tmp/example/report.md"]) {
    const result = await checkMarkdown(path);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /公开文档包含维护者本机路径/);
  }
});

test("public documentation accepts portable instructions and repository links", async () => {
  const result = await checkMarkdown("See [guide](docs/guide.md). Write local output to <local-temp>/capture.png.");
  assert.equal(result.status, 0, result.stderr);
});
