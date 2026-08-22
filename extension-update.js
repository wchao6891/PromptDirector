export const EXTENSION_UPDATE_STORAGE_KEY = "extensionUpdateState";
export const EXTENSION_UPDATE_STATUS_CHANGED = "EXTENSION_UPDATE_STATUS_CHANGED";

const STATE_VERSION = 1;
const CHECK_STATUSES = new Set(["no_update", "update_available", "throttled"]);

export function parseExtensionVersion(value) {
  const source = String(value ?? "");
  if (!/^\d+(?:\.\d+){0,3}$/u.test(source)) return null;
  const parts = source.split(".");
  if (parts.some((part) => (part.length > 1 && part.startsWith("0")) || Number(part) > 65_535)) {
    return null;
  }
  const numbers = parts.map(Number);
  if (numbers.every((part) => part === 0)) return null;
  return [...numbers, ...Array(4 - numbers.length).fill(0)];
}

export function compareExtensionVersions(left, right) {
  const leftParts = parseExtensionVersion(left);
  const rightParts = parseExtensionVersion(right);
  if (!leftParts || !rightParts) {
    throw new TypeError("扩展版本号格式无效");
  }
  for (let index = 0; index < 4; index += 1) {
    if (leftParts[index] > rightParts[index]) return 1;
    if (leftParts[index] < rightParts[index]) return -1;
  }
  return 0;
}

export function extensionUpdateChannel(manifest = {}) {
  return typeof manifest.key === "string" && manifest.key.trim() ? "development" : "store";
}

export function githubLatestReleaseUrl(homepageUrl) {
  try {
    const url = new URL(String(homepageUrl ?? ""));
    if (url.protocol !== "https:" || url.hostname !== "github.com") return "";
    const pathParts = url.pathname.split("/").filter(Boolean);
    if (pathParts.length !== 2) return "";
    url.search = "";
    url.hash = "";
    url.pathname = `/${pathParts.join("/")}/releases/latest`;
    return url.toString();
  } catch {
    return "";
  }
}

function safeGithubReleaseUrl(value, homepageUrl) {
  const latestUrl = githubLatestReleaseUrl(homepageUrl);
  if (!latestUrl) return "";
  try {
    const candidate = new URL(String(value ?? ""));
    const latest = new URL(latestUrl);
    const repositoryPath = latest.pathname.replace(/\/releases\/latest$/u, "");
    const isRepositoryRelease = candidate.protocol === "https:"
      && candidate.hostname === "github.com"
      && (candidate.pathname === `${repositoryPath}/releases/latest`
        || candidate.pathname.startsWith(`${repositoryPath}/releases/tag/`));
    return isRepositoryRelease ? candidate.toString() : latestUrl;
  } catch {
    return latestUrl;
  }
}

export function releaseVersionFromUrl(releaseUrl) {
  try {
    const url = new URL(String(releaseUrl ?? ""));
    const match = url.pathname.match(/\/releases\/tag\/([^/]+)\/?$/u);
    if (!match) return "";
    const tag = decodeURIComponent(match[1]);
    const version = tag.match(/^v?(\d+(?:\.\d+){0,3})$/u)?.[1] ?? "";
    return parseExtensionVersion(version) ? version : "";
  } catch {
    return "";
  }
}

function normalizeTimestamp(value) {
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
}

function validVersionOrEmpty(value) {
  const version = String(value ?? "");
  return parseExtensionVersion(version) ? version : "";
}

function normalizedState(stored, manifest) {
  const currentVersion = validVersionOrEmpty(manifest?.version);
  if (!currentVersion) throw new Error("当前扩展版本号无效");
  const channel = extensionUpdateChannel(manifest);
  const source = stored && typeof stored === "object" ? stored : {};
  let pendingVersion = validVersionOrEmpty(source.pendingVersion);
  let latestVersion = validVersionOrEmpty(source.latestVersion);

  if (channel !== "store" || (pendingVersion && compareExtensionVersions(pendingVersion, currentVersion) <= 0)) {
    pendingVersion = "";
  }
  if (channel !== "development") latestVersion = "";

  const releaseUrl = channel === "development"
    ? safeGithubReleaseUrl(source.releaseUrl, manifest.homepage_url)
    : "";
  const storeUpdateAvailable = channel === "store" && Boolean(pendingVersion);
  const developmentUpdateAvailable = channel === "development"
    && Boolean(latestVersion)
    && compareExtensionVersions(latestVersion, currentVersion) > 0;
  const updateAvailable = storeUpdateAvailable || developmentUpdateAvailable;

  return {
    stateVersion: STATE_VERSION,
    channel,
    currentVersion,
    pendingVersion,
    latestVersion,
    updateAvailable,
    updateKind: storeUpdateAvailable
      ? "store_downloaded"
      : developmentUpdateAvailable ? "development_release" : null,
    releaseUrl,
    checkedAt: normalizeTimestamp(source.checkedAt),
    checkStatus: ["idle", ...CHECK_STATUSES, "error"].includes(source.checkStatus)
      ? source.checkStatus
      : "idle",
    lastError: String(source.lastError ?? ""),
    installedVersion: validVersionOrEmpty(source.installedVersion) || currentVersion,
    installedAt: normalizeTimestamp(source.installedAt),
    canApply: storeUpdateAvailable || developmentUpdateAvailable,
    applyBehavior: developmentUpdateAvailable
      ? "reload_development_directory"
      : storeUpdateAvailable ? "install_downloaded_update" : null
  };
}

function persistedState(status) {
  const { canApply: _canApply, applyBehavior: _applyBehavior, ...stored } = status;
  return stored;
}

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error || "检查更新失败");
}

export function createExtensionUpdateLifecycle({
  runtime,
  storage,
  fetchFn = globalThis.fetch,
  now = () => Date.now(),
  notify = () => undefined,
  scheduleReload = (reload) => setTimeout(reload, 100)
} = {}) {
  if (!runtime?.getManifest || !storage?.get || !storage?.set) {
    throw new TypeError("扩展更新服务缺少 runtime 或 storage");
  }

  let operationQueue = Promise.resolve();
  const runExclusive = (operation) => {
    const run = operationQueue.then(operation, operation);
    operationQueue = run.catch(() => undefined);
    return run;
  };

  async function readStatus() {
    const manifest = runtime.getManifest();
    const stored = await storage.get(EXTENSION_UPDATE_STORAGE_KEY);
    return normalizedState(stored?.[EXTENSION_UPDATE_STORAGE_KEY], manifest);
  }

  async function writeStatus(status) {
    const normalized = normalizedState(status, runtime.getManifest());
    await storage.set({ [EXTENSION_UPDATE_STORAGE_KEY]: persistedState(normalized) });
    await Promise.resolve(notify(normalized)).catch(() => undefined);
    return normalized;
  }

  async function checkDevelopmentRelease() {
    const status = await readStatus();
    const releaseLookupUrl = githubLatestReleaseUrl(runtime.getManifest().homepage_url);
    if (!releaseLookupUrl) {
      return writeStatus({
        ...status,
        checkedAt: now(),
        checkStatus: "error",
        lastError: "扩展主页未配置有效的版本发布地址"
      });
    }
    try {
      if (typeof fetchFn !== "function") throw new Error("当前环境无法联网检查版本");
      const response = await fetchFn(releaseLookupUrl, {
        method: "HEAD",
        redirect: "follow",
        cache: "no-store"
      });
      if (!response?.ok) throw new Error(`版本发布页返回 ${response?.status || "未知状态"}`);
      const resolvedReleaseUrl = safeGithubReleaseUrl(response.url, runtime.getManifest().homepage_url);
      const latestVersion = releaseVersionFromUrl(resolvedReleaseUrl);
      if (!latestVersion) throw new Error("最新发布标签不是有效的 Chrome 扩展版本号");
      const updateAvailable = compareExtensionVersions(latestVersion, status.currentVersion) > 0;
      return writeStatus({
        ...status,
        latestVersion,
        releaseUrl: resolvedReleaseUrl,
        checkedAt: now(),
        checkStatus: updateAvailable ? "update_available" : "no_update",
        lastError: ""
      });
    } catch (error) {
      return writeStatus({
        ...status,
        releaseUrl: releaseLookupUrl,
        checkedAt: now(),
        checkStatus: "error",
        lastError: errorMessage(error)
      });
    }
  }

  async function checkStoreUpdate() {
    const status = await readStatus();
    try {
      if (typeof runtime.requestUpdateCheck !== "function") {
        throw new Error("当前 Chrome 不支持手动检查扩展更新");
      }
      const result = await runtime.requestUpdateCheck();
      const requestStatus = String(result?.status ?? "");
      if (!CHECK_STATUSES.has(requestStatus)) throw new Error("Chrome 返回了未知的更新检查状态");
      let pendingVersion = status.pendingVersion;
      if (requestStatus === "update_available") {
        pendingVersion = validVersionOrEmpty(result?.version);
        if (!pendingVersion || compareExtensionVersions(pendingVersion, status.currentVersion) <= 0) {
          throw new Error("Chrome 返回的待更新版本无效");
        }
      }
      return writeStatus({
        ...status,
        pendingVersion,
        checkedAt: now(),
        checkStatus: requestStatus,
        lastError: ""
      });
    } catch (error) {
      return writeStatus({
        ...status,
        checkedAt: now(),
        checkStatus: "error",
        lastError: errorMessage(error)
      });
    }
  }

  return Object.freeze({
    getStatus() {
      return runExclusive(readStatus);
    },

    check() {
      return runExclusive(async () => extensionUpdateChannel(runtime.getManifest()) === "development"
        ? checkDevelopmentRelease()
        : checkStoreUpdate());
    },

    handleStartup() {
      if (extensionUpdateChannel(runtime.getManifest()) !== "development") return runExclusive(readStatus);
      return runExclusive(checkDevelopmentRelease);
    },

    handleUpdateAvailable(details) {
      return runExclusive(async () => {
        const status = await readStatus();
        if (status.channel !== "store") return status;
        const pendingVersion = validVersionOrEmpty(details?.version);
        if (!pendingVersion || compareExtensionVersions(pendingVersion, status.currentVersion) <= 0) {
          return status;
        }
        return writeStatus({
          ...status,
          pendingVersion,
          checkedAt: now(),
          checkStatus: "update_available",
          lastError: ""
        });
      });
    },

    handleInstalled(details) {
      return runExclusive(async () => {
        const status = await readStatus();
        if (details?.reason !== "update") return status;
        return writeStatus({
          ...status,
          pendingVersion: "",
          latestVersion: "",
          checkedAt: now(),
          checkStatus: "no_update",
          lastError: "",
          installedVersion: status.currentVersion,
          installedAt: now()
        });
      });
    },

    apply() {
      return runExclusive(async () => {
        const status = await readStatus();
        if (!status.canApply || !status.applyBehavior) {
          return {
            ok: false,
            status,
            willReload: false,
            installsUpdate: false,
            message: status.channel === "store"
              ? "Chrome 尚未下载可安装的更新"
              : "当前目录已是最新版本"
          };
        }
        scheduleReload(() => runtime.reload());
        const installsUpdate = status.channel === "store";
        return {
          ok: true,
          status,
          willReload: true,
          installsUpdate,
          message: installsUpdate
            ? "即将重载并应用 Chrome 已下载的更新"
            : "即将重载当前开发目录；这不会下载或安装新版本"
        };
      });
    }
  });
}
