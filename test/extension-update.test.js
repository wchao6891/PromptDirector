import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import {
  compareExtensionVersions,
  createExtensionUpdateLifecycle,
  EXTENSION_UPDATE_STATUS_CHANGED,
  EXTENSION_UPDATE_STORAGE_KEY,
  extensionUpdateChannel,
  githubLatestReleaseUrl,
  parseExtensionVersion,
  releaseVersionFromUrl
} from "../extension-update.js";

function memoryStorage(initial = {}) {
  const values = structuredClone(initial);
  return {
    values,
    async get(key) {
      return { [key]: structuredClone(values[key]) };
    },
    async set(changes) {
      Object.assign(values, structuredClone(changes));
    }
  };
}

function fakeRuntime(manifest, updateResult = { status: "no_update" }) {
  return {
    reloadCount: 0,
    getManifest: () => structuredClone(manifest),
    requestUpdateCheck: async () => structuredClone(updateResult),
    reload() {
      this.reloadCount += 1;
    }
  };
}

test("Chrome extension versions are parsed and compared with Chrome's strict rules", () => {
  assert.deepEqual(parseExtensionVersion("1.18.9"), [1, 18, 9, 0]);
  assert.deepEqual(parseExtensionVersion("0.1.0.0"), [0, 1, 0, 0]);
  for (const invalid of ["", "0", "0.0.0.0", "01.2", "1.2.3.4.5", "1.65536", "v1.2", "1.2-beta"]) {
    assert.equal(parseExtensionVersion(invalid), null, invalid);
  }
  assert.equal(compareExtensionVersions("1.2", "1.1.9.9999"), 1);
  assert.equal(compareExtensionVersions("1.2", "1.2.0.0"), 0);
  assert.equal(compareExtensionVersions("1.2.0.1", "1.2"), 1);
  assert.throws(() => compareExtensionVersions("v1.2", "1.1"), /版本号格式无效/u);
});

test("package identity selects the update channel and GitHub release tags remain strict", () => {
  assert.equal(extensionUpdateChannel({ version: "1.0" }), "store");
  assert.equal(extensionUpdateChannel({ version: "1.0", key: "public-key" }), "development");
  assert.equal(
    githubLatestReleaseUrl("https://github.com/example/prompt-director/"),
    "https://github.com/example/prompt-director/releases/latest"
  );
  assert.equal(githubLatestReleaseUrl("http://github.com/example/prompt-director"), "");
  assert.equal(githubLatestReleaseUrl("https://example.com/example/prompt-director"), "");
  assert.equal(
    releaseVersionFromUrl("https://github.com/example/prompt-director/releases/tag/v1.18.10"),
    "1.18.10"
  );
  assert.equal(releaseVersionFromUrl("https://github.com/example/prompt-director/releases/tag/v1.18.10-beta"), "");
});

test("development startup discovers a newer GitHub release without downloading code", async () => {
  const runtime = fakeRuntime({
    version: "1.18.9",
    key: "fixed-development-id",
    homepage_url: "https://github.com/example/prompt-director"
  });
  const storage = memoryStorage();
  const notifications = [];
  const fetchCalls = [];
  const lifecycle = createExtensionUpdateLifecycle({
    runtime,
    storage,
    now: () => 1_725_000_000_000,
    fetchFn: async (url, options) => {
      fetchCalls.push({ url, options });
      return {
        ok: true,
        status: 200,
        url: "https://github.com/example/prompt-director/releases/tag/v1.19.0"
      };
    },
    notify: (status) => notifications.push(status)
  });

  const status = await lifecycle.handleStartup();
  assert.equal(fetchCalls.length, 1);
  assert.equal(fetchCalls[0].options.method, "HEAD");
  assert.equal(status.channel, "development");
  assert.equal(status.latestVersion, "1.19.0");
  assert.equal(status.updateAvailable, true);
  assert.equal(status.updateKind, "development_release");
  assert.equal(status.canApply, true);
  assert.equal(status.applyBehavior, "reload_development_directory");
  assert.equal(status.checkStatus, "update_available");
  assert.equal(notifications.length, 1);
  assert.equal(storage.values[EXTENSION_UPDATE_STORAGE_KEY].latestVersion, "1.19.0");
  assert.equal("canApply" in storage.values[EXTENSION_UPDATE_STORAGE_KEY], false);
});

test("development apply only reloads the current directory and never claims to install", async () => {
  const runtime = fakeRuntime({
    version: "1.18.9",
    key: "fixed-development-id",
    homepage_url: "https://github.com/example/prompt-director"
  });
  let scheduledReload;
  const lifecycle = createExtensionUpdateLifecycle({
    runtime,
    storage: memoryStorage({
      [EXTENSION_UPDATE_STORAGE_KEY]: {
        stateVersion: 1,
        channel: "development",
        currentVersion: "1.18.9",
        latestVersion: "1.19.0",
        releaseUrl: "https://github.com/example/prompt-director/releases/tag/v1.19.0",
        checkStatus: "update_available"
      }
    }),
    scheduleReload: (reload) => { scheduledReload = reload; }
  });

  const result = await lifecycle.apply();
  assert.equal(result.ok, true);
  assert.equal(result.installsUpdate, false);
  assert.equal(result.willReload, true);
  assert.match(result.message, /不会下载或安装新版本/u);
  assert.equal(runtime.reloadCount, 0);
  scheduledReload();
  assert.equal(runtime.reloadCount, 1);
});

test("development current version has no reload or primary update action", async () => {
  const runtime = fakeRuntime({
    version: "1.18.9",
    key: "fixed-development-id",
    homepage_url: "https://github.com/example/prompt-director"
  });
  const lifecycle = createExtensionUpdateLifecycle({
    runtime,
    storage: memoryStorage({
      [EXTENSION_UPDATE_STORAGE_KEY]: {
        stateVersion: 1,
        channel: "development",
        currentVersion: "1.18.9",
        latestVersion: "1.18.9",
        checkStatus: "no_update"
      }
    })
  });
  const status = await lifecycle.getStatus();
  assert.equal(status.updateAvailable, false);
  assert.equal(status.canApply, false);
  assert.equal(status.applyBehavior, null);
  const result = await lifecycle.apply();
  assert.equal(result.ok, false);
  assert.equal(runtime.reloadCount, 0);
});

test("store onUpdateAvailable persists the downloaded version until user applies it", async () => {
  const runtime = fakeRuntime({ version: "1.18.9", homepage_url: "https://github.com/example/prompt-director" });
  const storage = memoryStorage();
  let scheduledReload;
  const lifecycle = createExtensionUpdateLifecycle({
    runtime,
    storage,
    now: () => 500,
    scheduleReload: (reload) => { scheduledReload = reload; }
  });

  const available = await lifecycle.handleUpdateAvailable({ version: "1.19.0" });
  assert.equal(available.channel, "store");
  assert.equal(available.pendingVersion, "1.19.0");
  assert.equal(available.updateKind, "store_downloaded");
  assert.equal(available.canApply, true);
  assert.equal(available.applyBehavior, "install_downloaded_update");
  assert.equal(runtime.reloadCount, 0);

  const result = await lifecycle.apply();
  assert.equal(result.ok, true);
  assert.equal(result.installsUpdate, true);
  assert.equal(runtime.reloadCount, 0);
  scheduledReload();
  assert.equal(runtime.reloadCount, 1);
});

test("manual store checks preserve Chrome's no-update, available and throttled outcomes", async () => {
  for (const expected of [
    { result: { status: "no_update" }, checkStatus: "no_update", pendingVersion: "" },
    { result: { status: "update_available", version: "1.19.0" }, checkStatus: "update_available", pendingVersion: "1.19.0" },
    { result: { status: "throttled" }, checkStatus: "throttled", pendingVersion: "" }
  ]) {
    const runtime = fakeRuntime({ version: "1.18.9" }, expected.result);
    const lifecycle = createExtensionUpdateLifecycle({
      runtime,
      storage: memoryStorage(),
      now: () => 900
    });
    const status = await lifecycle.check();
    assert.equal(status.checkStatus, expected.checkStatus);
    assert.equal(status.pendingVersion, expected.pendingVersion);
  }
});

test("store apply is blocked before Chrome downloads an update", async () => {
  const runtime = fakeRuntime({ version: "1.18.9" });
  const lifecycle = createExtensionUpdateLifecycle({ runtime, storage: memoryStorage() });
  const result = await lifecycle.apply();
  assert.equal(result.ok, false);
  assert.equal(result.willReload, false);
  assert.equal(runtime.reloadCount, 0);
});

test("successful store installation clears the applied reminder and records the current version", async () => {
  const runtime = fakeRuntime({ version: "1.19.0" });
  const storage = memoryStorage({
    [EXTENSION_UPDATE_STORAGE_KEY]: {
      stateVersion: 1,
      channel: "store",
      currentVersion: "1.18.9",
      pendingVersion: "1.19.0",
      checkStatus: "update_available"
    }
  });
  const lifecycle = createExtensionUpdateLifecycle({
    runtime,
    storage,
    now: () => 1_000
  });
  const status = await lifecycle.handleInstalled({ reason: "update", previousVersion: "1.18.9" });
  assert.equal(status.currentVersion, "1.19.0");
  assert.equal(status.pendingVersion, "");
  assert.equal(status.updateAvailable, false);
  assert.equal(status.canApply, false);
  assert.equal(status.applyBehavior, null);
  assert.equal(status.installedVersion, "1.19.0");
  assert.equal(status.installedAt, 1_000);
});

test("background wires update events and the public message protocol", async () => {
  const source = await readFile(new URL("../background.js", import.meta.url), "utf8");
  assert.match(source, /chrome\.runtime\.onUpdateAvailable\.addListener/u);
  assert.match(source, /chrome\.runtime\.onStartup\.addListener/u);
  for (const type of [
    "GET_EXTENSION_UPDATE_STATUS",
    "CHECK_EXTENSION_UPDATE",
    "APPLY_EXTENSION_UPDATE"
  ]) {
    assert.match(source, new RegExp(`case "${type}"`, "u"));
  }
  assert.match(source, new RegExp(EXTENSION_UPDATE_STATUS_CHANGED, "u"));
});
