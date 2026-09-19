import assert from "node:assert/strict";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import { readZipBlob } from "../extension/zip.js";
import { compareExtensionVersions } from "../extension/extension-update.js";
import { directory, served } from "../test/helpers/local-upgrade-directory.mjs";

// Called between launches of one disposable Chromium profile. This invokes the
// historical installer, or the documented manual replacement for added required
// permissions. Native permission UI is separate from data-continuity verification.
const [installation, archive] = process.argv.slice(2);
if (!installation || !archive) throw new Error("Expected disposable installation directory and final ZIP");
const previous = JSON.parse(await readFile(join(installation, "manifest.json"), "utf8"));
const updater = await import(pathToFileURL(join(installation, "local-extension-upgrade.js")));
const id = await updater.extensionIdForKey(previous.key);
const runtime = { id, getManifest: () => previous, getURL: path => `chrome-extension://${id}/${path}` };
const archiveBlob = new Blob([await readFile(archive)]);
const files = await readZipBlob(archiveBlob);
const next = JSON.parse(await files.get("manifest.json").text());
const addsPermissions = ["permissions", "host_permissions"].some(key =>
  (next[key] || []).some(value => !(previous[key] || []).includes(value)));
const sentinel = "user media must stay byte-identical";
await mkdir(join(installation, "media"), { recursive: true });
await writeFile(join(installation, "media", "upgrade-fixture.bin"), sentinel);
if (addsPermissions) {
  await assert.rejects(() => updater.prepareLocalUpgrade(archiveBlob, runtime), /增加了必要权限/);
  assert.deepEqual(JSON.parse(await readFile(join(installation, "manifest.json"), "utf8")), previous);
  assert.equal(await updater.extensionIdForKey(next.key), id);
  assert.equal(next.homepage_url, previous.homepage_url);
  assert.equal(next.manifest_version, 3);
  assert.ok(compareExtensionVersions(next.version, previous.version) > 0);
  for (const path of files.keys()) assert.ok(updater.isExtensionProgramPath(path), path);
  for (const [path, blob] of files) {
    const destination = join(installation, path);
    await mkdir(dirname(destination), { recursive: true });
    await writeFile(destination, Buffer.from(await blob.arrayBuffer()));
  }
  for (const [path, blob] of files) assert.deepEqual(await readFile(join(installation, path)), Buffer.from(await blob.arrayBuffer()));
  assert.equal(await readFile(join(installation, "media", "upgrade-fixture.bin"), "utf8"), sentinel);
  console.log(`权限保护拒绝自动安装；手动覆盖通过：${previous.version} → ${next.version}（${files.size} 个文件）`);
} else {
  const prepared = await updater.prepareLocalUpgrade(archiveBlob, runtime);
  let record;
  await updater.installLocalUpgrade(directory(installation), prepared, {
    runtime, fetchFn: served(installation), saveRecord: async value => { record = value; }
  });
  assert.equal(record.phase, "written");
  assert.equal(await readFile(join(installation, "media", "upgrade-fixture.bin"), "utf8"), sentinel);
  assert.equal(await updater.verifyRunningUpgrade(record, { ...runtime, getManifest: () => prepared.manifest }, served(installation)), true);
  assert.equal(await updater.verifyRecoveredUpgrade(record, runtime, served(join(installation, updater.RECOVERY_DIRECTORY))), true);
  console.log(`历史更新器原位安装通过：${previous.version} → ${prepared.manifest.version}（${prepared.files.size} 个文件；已校验恢复记录列出的文件）`);
}
