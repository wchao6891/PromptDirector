import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { load } from "cheerio";
const root = new URL("../extension/", import.meta.url);
const [html, source, local] = await Promise.all(["library.html", "library.js", "local-extension-upgrade-ui.js"].map(path => readFile(new URL(path, root), "utf8")));
const $ = load(html);

test("settings footer is compact with named icons and on-demand about details", () => {
  const about = $(".settings-about");
  assert.equal(about.find("#about-version").length, 1);
  assert.equal(about.find('#check-extension-update[aria-label="检查更新"] svg').length, 1);
  assert.equal(about.find("#apply-extension-update[hidden]").length, 1);
  assert.equal(about.find("#open-about").length, 1);
  assert.equal(about.find("#update-explanation, #update-channel, #update-checked-at").length, 0);
  assert.doesNotMatch(about.text(), /安全重载|私人灵感库|Apache|手动替换/);
});
test("store update remains browser managed; local update runs the package installer", () => {
  assert.match(source, /checkExtensionUpdate\.hidden = status\?\.channel === "store"/);
  assert.match(source, /applyExtensionUpdate\.hidden = !status\?\.canApply/);
  assert.match(source, /openLocalUpgrade\(status\)/);
  assert.doesNotMatch(source, /reload_development_directory|重新载入目录/);
  assert.match(local, /installType !== "development"/);
  assert.match(local, /installLocalUpgrade\(root, prepared/);
  assert.match(local, /verifyRunningUpgrade\(record, chrome.runtime\)/);
});
test("store restart informs the user at the action, not in persistent footer prose", () => {
  const apply = source.slice(source.indexOf("async function applyExtensionUpdate"), source.indexOf("function renderExtensionUpdateStatus"));
  assert.match(apply, /confirmAppAction/);
  assert.match(apply, /当前资料库页面会关闭，但本地案例和素材不会丢失/);
  assert.match(apply, /type: "APPLY_EXTENSION_UPDATE"/);
});
test("settings update badge and background status events are preserved", () => {
  assert.equal($("#settings-update-badge[hidden]").length, 1);
  assert.match(source, /settingsUpdateBadge\.hidden = !hasUpdate/);
  assert.match(source, /message\?\.type !== "EXTENSION_UPDATE_STATUS_CHANGED"/);
});
test("compact settings preserve direct data actions and same-group permission/sync controls", () => {
  assert.equal($(".capture-permission-list .capture-permission-row").length, 2);
  $(".capture-permission-list .capture-permission-row").each((_i, row) => {
    assert.equal($(row).children("strong").length, 1);
    assert.equal($(row).children("button").length, 1);
  });
  assert.equal($(".data-heading #create-folder-backup").length, 1);
  assert.equal($(".data-heading #restore-folder-backup").length, 1);
  assert.equal($(".sync-settings-body > #connect-sync-folder").length, 1);
  assert.equal($(".sync-settings-body > #data-safety-password").length, 1);
  assert.equal($("#save-library-settings[aria-label] svg").length, 1);
});
