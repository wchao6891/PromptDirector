import test from "node:test";
import assert from "node:assert/strict";
import { packageRuntimeFiles } from "../tools/extension-package-variants.mjs";

const files = [
  { name: "library.js", data: "shared library" },
  { name: "local-extension-upgrade.js", data: "local installer" },
  { name: "local-extension-upgrade-ui.js", data: "local update controls" }
];

test("local packages retain the complete in-place updater", () => {
  assert.equal(packageRuntimeFiles(files), files);
});

test("store packages contain no program downloader or writer and preserve shared application files", () => {
  const store = packageRuntimeFiles(files, { release: true });
  assert.equal(store.find(file => file.name === "library.js"), files[0]);
  assert.equal(store.some(file => file.name === "local-extension-upgrade.js"), false);
  const ui = store.find(file => file.name === "local-extension-upgrade-ui.js").data;
  assert.doesNotMatch(ui, /fetch\(|showDirectoryPicker|createWritable|local-extension-upgrade\.js/);
  for (const name of ["openLocalUpgrade", "runningUpgradeFeedback", "finishLocalUpgrade"]) assert.match(ui, new RegExp(`export async function ${name}\\(`));
  assert.match(ui, /商店版由 Chrome 自动更新/);
  assert.equal(files[2].data, "local update controls");
});

// Exercise the shipped dependency graph, not a stub with no vendor files.
test("hash runtime packages remain acceptable to installed updaters and hash streamed files correctly", async t => {
  const { readFile, readdir, mkdtemp, writeFile, rm } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const { pathToFileURL } = await import("node:url");
  const { createHash } = await import("node:crypto");
  const { isExtensionProgramPath } = await import("../local-extension-upgrade.js");
  const names = ["blob-digest.js", "THIRD_PARTY_NOTICES.md", ...(await readdir(new URL("../vendor/noble-hashes/", import.meta.url))).map(name => `vendor/noble-hashes/${name}`)];
  const input = await Promise.all(names.map(async name => ({ name, data: await readFile(new URL(`../${name}`, import.meta.url)) })));
  for (const release of [false, true]) {
    const packaged = packageRuntimeFiles(input, { release });
    for (const file of packaged) assert.ok(isExtensionProgramPath(file.name), `Old updater rejects ${file.name}`);
    const license = input.find(file => file.name.endsWith("/LICENSE")).data.toString();
    assert.ok(packaged.find(file => file.name === "THIRD_PARTY_NOTICES.md").data.toString().includes(license));
    const dir = await mkdtemp(join(tmpdir(), "pd-packaged-hash-"));
    t.after(() => rm(dir, { recursive: true, force: true }));
    await writeFile(join(dir, "package.json"), '{"type":"module"}');
    for (const file of packaged) await writeFile(join(dir, file.name), file.data);
    const { sha256Blob } = await import(pathToFileURL(join(dir, "blob-digest.js")));
    const data = Buffer.from("案例原件 integrity ".repeat(10000));
    const blob = new Blob([data]);
    blob.arrayBuffer = () => { throw new Error("must hash through the stream"); };
    assert.equal(await sha256Blob(blob), createHash("sha256").update(data).digest("hex"));
    assert.equal(await sha256Blob(new Blob()), createHash("sha256").digest("hex"));
  }
});
