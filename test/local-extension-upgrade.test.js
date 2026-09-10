import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createZipBlob } from "../extension/zip.js";
import { extensionIdForKey, cleanupLocalUpgrade, installLocalUpgrade, isExtensionProgramPath, localReleasePackageUrl, prepareLocalUpgrade, RECOVERY_DIRECTORY, verifyInstallationDirectory, verifyRecoveredUpgrade, verifyRunningUpgrade } from "../extension/local-extension-upgrade.js";
const manifest = JSON.parse(await readFile(new URL("../extension/manifest.json", import.meta.url)));
const id = await extensionIdForKey(manifest.key);
const nextVersion = [...manifest.version.split(".").slice(0, -1), Number(manifest.version.split(".").at(-1)) + 1].join(".");
const runtime = { id, getManifest: () => manifest, getURL: path => `chrome-extension://${id}/${path}` };

import { directory, served } from "./helpers/local-upgrade-directory.mjs";

async function fixture(t, fault) {
  const path = await mkdtemp(join(tmpdir(), "pd-upgrade-test-"));
  t.after(() => rm(path, { recursive: true, force: true }));
  await writeFile(join(path, "manifest.json"), JSON.stringify(manifest));
  await writeFile(join(path, "background.js"), "old background");
  await writeFile(join(path, "cases.json"), "user library must not move");
  await mkdir(join(path, "media"));
  await writeFile(join(path, "media", "user.mp4"), "media bytes");
  return { path, root: directory(path, fault), fetchFn: served(path) };
}
async function packageFor(next = { ...manifest, version: nextVersion }) {
  const names = new Set(["manifest.json", next.background.service_worker, next.side_panel.default_path, "library.html", ...Object.values(next.icons)]);
  return createZipBlob([...names].map(name => ({ name, data: name === "manifest.json" ? JSON.stringify(next) : `new program ${name}` })));
}

test("local package identity and version are validated before directory writes", async () => {
  const prepared = await prepareLocalUpgrade(await packageFor(), runtime);
  assert.equal(prepared.manifest.version, nextVersion);
  await assert.rejects(prepareLocalUpgrade(await packageFor({ ...manifest, key: undefined, version: nextVersion }), runtime), /FIXED-ID/);
  await assert.rejects(prepareLocalUpgrade(await packageFor(manifest), runtime), /没有高于/);
  await assert.rejects(prepareLocalUpgrade(await packageFor({ ...manifest, version: nextVersion, permissions: [...manifest.permissions, "management"] }), runtime), /权限/);
  await assert.rejects(prepareLocalUpgrade(await packageFor(), { ...runtime, id: "different" }), /身份不同/);
  const files = new Map([["manifest.json", new Blob([JSON.stringify({ ...manifest, version: nextVersion })])]]);
  await assert.rejects(prepareLocalUpgrade(await createZipBlob([...files].map(([name, data]) => ({ name, data }))), runtime), /缺少运行文件/);
});
test("program paths exclude user data and dangerous archive paths", () => {
  for (const path of ["cases.json", "media/user.mp4", "../extension/background.js", "assets/../../x.js", "C:/x.js", "a\\b.js", ".git/config"]) assert.equal(isExtensionProgramPath(path), false, path);
  assert.equal(isExtensionProgramPath("vendor/pdfjs/build/pdf.mjs"), true);
  assert.equal(localReleasePackageUrl(manifest, `${manifest.homepage_url}/releases/tag/v${nextVersion}`, nextVersion), `${manifest.homepage_url}/releases/download/v${nextVersion}/PromptDirector-${nextVersion}-FIXED-ID-DEV.zip`);
  assert.throws(() => localReleasePackageUrl(manifest, `https://evil.example/releases/tag/v${nextVersion}`, nextVersion), /不一致/);
});
test("an identical but inactive directory is rejected and the proof file is removed", async t => {
  const a = await fixture(t);
  const b = await fixture(t);
  await assert.rejects(verifyInstallationDirectory(b.root, runtime, a.fetchFn), /实际加载/);
  assert.deepEqual((await readdir(b.path)).sort(), ["background.js", "cases.json", "manifest.json", "media"]);
});
test("successful update replaces program files while user cases and media stay byte-identical", async t => {
  const f = await fixture(t);
  const prepared = await prepareLocalUpgrade(await packageFor(), runtime);
  let record;
  await installLocalUpgrade(f.root, prepared, { runtime, fetchFn: f.fetchFn, saveRecord: async value => { record = value; } });
  assert.equal(JSON.parse(await readFile(join(f.path, "manifest.json"))).version, nextVersion);
  assert.equal(await readFile(join(f.path, "cases.json"), "utf8"), "user library must not move");
  assert.equal(await readFile(join(f.path, "media/user.mp4"), "utf8"), "media bytes");
  const backup = await readdir(join(f.path, RECOVERY_DIRECTORY));
  assert.equal(backup.includes("cases.json"), false);
  assert.equal(backup.includes("media"), false);
  assert.equal(record.phase, "written");
  assert.equal(await verifyRecoveredUpgrade(record, runtime, served(join(f.path, RECOVERY_DIRECTORY))), true);
  assert.equal(await verifyRunningUpgrade(record, runtime, f.fetchFn), false, "writing files does not prove Chrome is running the new version");
  assert.equal(await verifyRunningUpgrade(record, { ...runtime, getManifest: () => prepared.manifest }, f.fetchFn), true);
  await writeFile(join(f.path, "background.js"), "corrupt");
  assert.equal(await verifyRunningUpgrade(record, { ...runtime, getManifest: () => prepared.manifest }, f.fetchFn), false);
});
test("a mid-write failure rolls back changed code and removes newly created files", async t => {
  let fired = false;
  const f = await fixture(t, path => {
    if (path.endsWith("/library.html") && !path.includes(RECOVERY_DIRECTORY) && !fired) { fired = true; return true; }
    return false;
  });
  let record;
  await assert.rejects(installLocalUpgrade(f.root, await prepareLocalUpgrade(await packageFor(), runtime), { runtime, fetchFn: f.fetchFn, saveRecord: async value => { record = value; } }), /simulated/);
  assert.equal(await readFile(join(f.path, "background.js"), "utf8"), "old background");
  assert.equal(JSON.parse(await readFile(join(f.path, "manifest.json"))).version, manifest.version);
  assert.equal(record, null);
  assert.equal((await readdir(f.path)).includes(RECOVERY_DIRECTORY), false);
  assert.equal((await readdir(f.path)).includes("collector.html"), false);
});
test("unchanged program files are backed up and verified without rewriting the live file", async t => {
  const f = await fixture(t, path => path.endsWith("/background.js") && !path.includes(RECOVERY_DIRECTORY));
  await writeFile(join(f.path, "background.js"), "new program background.js");
  const progress = [];
  const prepared = await prepareLocalUpgrade(await packageFor(), runtime);
  await installLocalUpgrade(f.root, prepared, {
    runtime, fetchFn: f.fetchFn, saveRecord: async () => {}, onProgress: value => progress.push(value)
  });
  assert.equal(await readFile(join(f.path, RECOVERY_DIRECTORY, "background.js"), "utf8"), "new program background.js");
  assert.equal(await verifyRunningUpgrade({ targetVersion: prepared.manifest.version, hashes: prepared.hashes }, { ...runtime, getManifest: () => prepared.manifest }, f.fetchFn), true);
  assert.ok(progress.some(value => value.phase === "preparing" && value.completed > 0));
  assert.deepEqual(progress.at(-1), { phase: "writing", completed: prepared.files.size, total: prepared.files.size });
});
test("a source checkout or existing recovery point is never overwritten", async t => {
  const f = await fixture(t);
  await mkdir(join(f.path, ".git"));
  await assert.rejects(verifyInstallationDirectory(f.root, runtime, f.fetchFn), /源码工作目录/);
  await rm(join(f.path, ".git"), { recursive: true });
  await mkdir(join(f.path, RECOVERY_DIRECTORY));
  await assert.rejects(installLocalUpgrade(f.root, await prepareLocalUpgrade(await packageFor(), runtime), { runtime, fetchFn: f.fetchFn, saveRecord: async () => {} }), /恢复副本/);
});

test("recovery retains hash modules from historical installations, not only files in the incoming ZIP", async t => {
  const f = await fixture(t);
  await mkdir(join(f.path, "vendor/noble-hashes"), { recursive: true });
  await writeFile(join(f.path, "vendor/noble-hashes/sha2.js"), "export const legacyHash = true;");
  await writeFile(join(f.path, "vendor/noble-hashes/LICENSE"), "upstream license fixture");
  let record;
  await installLocalUpgrade(f.root, await prepareLocalUpgrade(await packageFor(), runtime), {
    runtime, fetchFn: f.fetchFn, saveRecord: async value => { record = value; }
  });
  assert.ok(record.oldHashes["vendor/noble-hashes/sha2.js"]);
  assert.equal(await readFile(join(f.path, RECOVERY_DIRECTORY, "vendor/noble-hashes/sha2.js"), "utf8"), "export const legacyHash = true;");
});

test("restored original installations can clear the recovery folder and update again", async t => {
  const f = await fixture(t);
  const prepared = await prepareLocalUpgrade(await packageFor(), runtime);
  let record;
  await installLocalUpgrade(f.root, prepared, {runtime, fetchFn:f.fetchFn, saveRecord:async value=>{record=value;}});
  for (const path of Object.keys(record.oldHashes)) await writeFile(join(f.path,path), await readFile(join(f.path,RECOVERY_DIRECTORY,path)));
  await cleanupLocalUpgrade(record, {runtime, fetchFn:f.fetchFn});
  assert.equal((await readdir(f.path)).includes(RECOVERY_DIRECTORY), false);
  await installLocalUpgrade(f.root, prepared, {runtime, fetchFn:f.fetchFn, saveRecord:async()=>{}});
});

test("cleanup after loading a recovery copy cannot delete the running installation", async t => {
  const f = await fixture(t);
  const prepared = await prepareLocalUpgrade(await packageFor(), runtime);
  let record;
  await installLocalUpgrade(f.root, prepared, {runtime, fetchFn:f.fetchFn, saveRecord:async value=>{record=value;}});
  await cleanupLocalUpgrade(record, {runtime, fetchFn:served(join(f.path, RECOVERY_DIRECTORY))});
  assert.equal(await readFile(join(f.path,RECOVERY_DIRECTORY,'background.js'),'utf8'), 'old background');
});
