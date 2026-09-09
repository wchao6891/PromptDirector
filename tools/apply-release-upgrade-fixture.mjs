import assert from "node:assert/strict";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { directory, served } from "../test/helpers/local-upgrade-directory.mjs";

// Called between launches of one disposable Chromium profile. This invokes the
// historical installer on its actual disk directory; native permission UI is separate.
const [installation, archive] = process.argv.slice(2);
if (!installation || !archive) throw new Error("Expected disposable installation directory and final ZIP");
const previous = JSON.parse(await readFile(join(installation, "manifest.json"), "utf8"));
const updater = await import(pathToFileURL(join(installation, "local-extension-upgrade.js")));
const id = await updater.extensionIdForKey(previous.key);
const runtime = { id, getManifest: () => previous, getURL: path => `chrome-extension://${id}/${path}` };
const prepared = await updater.prepareLocalUpgrade(new Blob([await readFile(archive)]), runtime);
const sentinel = "user media must stay byte-identical";
await mkdir(join(installation, "media"), { recursive: true });
await writeFile(join(installation, "media", "upgrade-fixture.bin"), sentinel);
let record;
await updater.installLocalUpgrade(directory(installation), prepared, {
  runtime, fetchFn: served(installation), saveRecord: async value => { record = value; }
});
assert.equal(record.phase, "written");
assert.equal(await readFile(join(installation, "media", "upgrade-fixture.bin"), "utf8"), sentinel);
assert.equal(await updater.verifyRunningUpgrade(record, { ...runtime, getManifest: () => prepared.manifest }, served(installation)), true);
assert.equal(await updater.verifyRecoveredUpgrade(record, runtime, served(join(installation, updater.RECOVERY_DIRECTORY))), true);
console.log(`历史更新器原位安装通过：${previous.version} → ${prepared.manifest.version}（${prepared.files.size} 个文件；已校验恢复记录列出的文件）`);
