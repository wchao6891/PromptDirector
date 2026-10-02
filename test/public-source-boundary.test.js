import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, copyFile, writeFile, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

async function checkFiles(files, { privateDirectory, git = false, ignore = [], tracked = [], links = {} } = {}) {
  const root = await mkdtemp(join(tmpdir(), "public-source-boundary-"));
  try {
    await mkdir(join(root, "tools"));
    await copyFile(new URL("../tools/validate-public-source.mjs", import.meta.url), join(root, "tools", "validate-public-source.mjs"));
    for (const [path, content] of Object.entries(files)) {
      await mkdir(join(root, path, ".."), { recursive: true });
      await writeFile(join(root, path), content);
    }
    for (const [path, target] of Object.entries(links)) await symlink(target, join(root, path));
    if (git) {
      assert.equal(spawnSync("git", ["init", root]).status, 0);
      if (ignore.length) await writeFile(join(root, ".gitignore"), `${ignore.join("\n")}\n`);
      for (const path of tracked) assert.equal(spawnSync("git", ["-C", root, "add", "--force", path]).status, 0);
    }
    if (privateDirectory) {
      await mkdir(join(root, privateDirectory));
      await writeFile(join(root, privateDirectory, 'LEARNINGS.md'), 'Private feedback without any machine path');
    }
    return spawnSync(process.execPath, [join(root, "tools", "validate-public-source.mjs")], { encoding: "utf8" });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

test("public documentation rejects machine-specific macOS screenshot paths", async () => {
  for (const prefix of [["", "private", "var", "folders", ""].join("/"), ["", "var", "folders", ""].join("/")]) {
    const result = await checkFiles({ "README.md": `Screenshot: ${prefix}example/T/capture.png` });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /公开文档包含维护者本机路径/);
  }
});

test("public documentation rejects local home and temporary workspace paths", async () => {
  for (const path of [["", "Users", "example", "project", "notes.md"].join("/"), ["", "private", "tmp", "example", "report.md"].join("/")]) {
    const result = await checkFiles({ "README.md": path });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /公开文档包含维护者本机路径/);
  }
});

test("public documentation accepts portable instructions and repository links", async () => {
  const result = await checkFiles({ "README.md": "See [guide](docs/guide.md). Write local output to <local-temp>/capture.png." });
  assert.equal(result.status, 0, result.stderr);
});

test('public source rejects private learning records even without local paths or credentials', async () => {
  const result = await checkFiles({ 'README.md': 'Public README' }, { privateDirectory: '.learnings' });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /公开源码树包含内部工作目录：\.learnings/);
});

test("private sibling references fail in source, documentation and hidden workflows", async () => {
  const privateName = ["Example", "Private"].join("-");
  for (const path of ["AGENTS.md", "connector/config.mjs", ".github/workflows/check.yml"]) {
    const result = await checkFiles({ [path]: `Read ../${privateName}/AGENTS.md` });
    assert.notEqual(result.status, 0, path);
    assert.match(result.stderr, /公开源码包含私人工作区引用/);
  }
});

test("machine paths fail outside Markdown on every supported OS", async () => {
  const paths = [
    ["", "home", "example", "project", "file"].join("/"),
    ["", "Volumes", "example", "library", "file"].join("/"),
    ["C:", "Users", "example", "project", "file"].join("\\"),
    ["C:", "Users", "example", "project", "file"].join("\\\\")
  ];
  for (const path of paths) {
    const result = await checkFiles({ "tools/config.json": JSON.stringify({ path }) });
    assert.notEqual(result.status, 0, path);
    assert.match(result.stderr, /本机路径/);
  }
});

test("credential findings identify the file without printing the secret", async () => {
  const secret = ["ghp", "x".repeat(36)].join("_");
  const result = await checkFiles({ "config.json": JSON.stringify({ token: secret }) });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /疑似凭据：config.json:1/);
  assert.equal(result.stderr.includes(secret), false);
});

test("ignored local instructions stay private and a force-added override cannot pass", async () => {
  const files = { "README.md": "Public source", "AGENTS.override.md": `Read ../${["Example", "Private"].join("-")}/AGENTS.md` };
  const options = { git: true, ignore: ["AGENTS.override.md"] };
  const ignored = await checkFiles(files, options);
  assert.equal(ignored.status, 0, ignored.stderr);
  const tracked = await checkFiles(files, { ...options, tracked: ["AGENTS.override.md"] });
  assert.notEqual(tracked.status, 0);
  assert.match(tracked.stderr, /本地配置文件：AGENTS.override.md/);
});

test("ignored local assets are preserved while tracked private records are rejected", async () => {
  const files = { "README.md": "Public source", ".local-imports/cases.json": "Local assets" };
  const options = { git: true, ignore: [".local-imports/"] };
  const ignored = await checkFiles(files, options);
  assert.equal(ignored.status, 0, ignored.stderr);
  const tracked = await checkFiles(files, { ...options, tracked: [".local-imports/cases.json"] });
  assert.notEqual(tracked.status, 0);
  assert.match(tracked.stderr, /内部工作目录/);
});

test("untracked publishable files are checked and environment files are blocked", async () => {
  const result = await checkFiles({ ".env": "TOKEN=local", "README.md": "Public source" }, { git: true });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /本地配置文件：\.env/);
  const example = await checkFiles({ ".env.example": "TOKEN=<your-token>" }, { git: true });
  assert.equal(example.status, 0, example.stderr);
});

test("public service URLs, synthetic identifiers and binary assets remain publishable", async () => {
  const result = await checkFiles({
    "source.js": "const id = 'project-private'; const url = 'https://github.com/example/product';",
    "image.png": new Uint8Array([0, 255, 1, 2]),
    ".github/workflows/check.yml": "name: checks"
  });
  assert.equal(result.status, 0, result.stderr);
});

test("a published symlink exposes its private target even when that target cannot be read", async () => {
  const result = await checkFiles({ "README.md": "Public source" }, {
    git: true,
    tracked: ["notes.md"],
    links: { "notes.md": ["", "Users", "example", "private", "missing.md"].join("/") }
  });
  assert.notEqual(result.status, 0, "The Git link text is public even though the external file is absent");
  assert.match(result.stderr, /本机路径：notes.md:1/);
  const portable = await checkFiles({ "README.md": "Public source" }, {
    git: true, tracked: ["guide.md"], links: { "guide.md": "README.md" }
  });
  assert.equal(portable.status, 0, portable.stderr);
});
