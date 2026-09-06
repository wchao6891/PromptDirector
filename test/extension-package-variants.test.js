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
