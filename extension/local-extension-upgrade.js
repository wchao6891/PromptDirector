import { readZipBlob } from "./zip.js";
import { compareExtensionVersions, githubLatestReleaseUrl } from "./extension-update.js";

export const RECOVERY_DIRECTORY = "PromptDirector-Update-Recovery";
const RECORD_KEY = "pending";

export function isExtensionProgramPath(path) {
  if (path.split("/").some(part => !part || part === "." || part === "..") || /[\\\u0000:]/u.test(path)) return false;
  return /^(?:[^/]+\.(?:js|css|html)|manifest\.json|LICENSE|NOTICE|THIRD_PARTY_NOTICES\.md)$/u.test(path)
    || /^assets\/(?:ui-icons\.svg|icons\/(?:icon-source\.svg|icon-(?:16|32|48|128)\.png))$/u.test(path)
    || /^_locales\/[^/]+\/messages\.json$/u.test(path)
    || /^vendor\/(?:pdfjs|document-ingestion|noble-hashes)\/.+/u.test(path);
}

export async function extensionIdForKey(key) {
  if (typeof key !== "string" || !key.trim()) throw new Error("请选择 FIXED-ID-DEV 本地安装包");
  const bytes = Uint8Array.from(atob(key.replace(/\s/gu, "")), char => char.charCodeAt(0));
  const hash = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
  return [...hash.slice(0, 16)].map(byte => String.fromCharCode(97 + (byte >> 4), 97 + (byte & 15))).join("");
}

export async function blobDigest(blob) {
  const hash = new Uint8Array(await crypto.subtle.digest("SHA-256", await blob.arrayBuffer()));
  return [...hash].map(byte => byte.toString(16).padStart(2, "0")).join("");
}

export function localReleasePackageUrl(manifest, releaseUrl, version) {
  const base = githubLatestReleaseUrl(manifest.homepage_url);
  if (!base) throw new Error("扩展主页未配置有效的版本发布地址");
  const repository = base.replace(/\/releases\/latest$/u, "");
  const release = new URL(releaseUrl);
  if (release.origin + release.pathname !== `${repository}/releases/tag/v${version}`
    && release.origin + release.pathname !== `${repository}/releases/tag/${version}`) throw new Error("更新地址与版本不一致");
  const tag = release.pathname.split("/").at(-1);
  return `${repository}/releases/download/${tag}/PromptDirector-${version}-FIXED-ID-DEV.zip`;
}

export async function prepareLocalUpgrade(archive, runtime) {
  const current = runtime.getManifest();
  const files = await readZipBlob(archive);
  for (const path of files.keys()) if (!isExtensionProgramPath(path)) throw new Error(`更新包包含非程序文件：${path}`);
  if (!files.has("manifest.json")) throw new Error("更新包缺少 manifest.json");
  const manifest = JSON.parse(await files.get("manifest.json").text());
  if (await extensionIdForKey(manifest.key) !== runtime.id) throw new Error("更新包与当前插件身份不同，已停止升级；请保留原插件");
  if (manifest.homepage_url !== current.homepage_url || manifest.manifest_version !== 3) throw new Error("更新包不属于当前产品");
  if (compareExtensionVersions(manifest.version, current.version) <= 0) throw new Error("更新包版本没有高于当前版本");
  // A reload can disable an extension when its required permissions change.
  for (const key of ["permissions", "host_permissions"]) {
    const granted = new Set(current[key] || []);
    if ((manifest[key] || []).some(value => !granted.has(value))) throw new Error("新版增加了必要权限，本次原位升级已停止，请先确认新版安装要求");
  }
  const required = [manifest.background?.service_worker, manifest.side_panel?.default_path, "library.html", ...Object.values(manifest.icons || {})];
  for (const path of required) if (!path || !files.has(path)) throw new Error(`更新包缺少运行文件：${path || "入口"}`);
  const hashes = {};
  for (const [path, blob] of files) hashes[path] = await blobDigest(blob);
  return { manifest, files, hashes, previousVersion: current.version };
}

async function fileAt(root, path, create = false) {
  const parts = path.split("/");
  const name = parts.pop();
  let directory = root;
  for (const part of parts) directory = await directory.getDirectoryHandle(part, { create });
  return { directory, name, handle: await directory.getFileHandle(name, { create }) };
}

async function readFile(root, path) {
  try { return await (await fileAt(root, path)).handle.getFile(); }
  catch (error) { if (error.name === "NotFoundError") return null; throw error; }
}

async function writeFile(root, path, blob) {
  const { handle } = await fileAt(root, path, true);
  const writer = await handle.createWritable();
  try { await writer.write(blob); await writer.close(); }
  catch (error) { await writer.abort().catch(() => undefined); throw error; }
  const written = await handle.getFile();
  if (await blobDigest(written) !== await blobDigest(blob)) throw new Error(`程序文件写入校验失败：${path}`);
}

async function* programFiles(root, prefix = "") {
  for await (const [name, handle] of root.entries()) {
    const path = prefix + name;
    if (handle.kind === "file" && isExtensionProgramPath(path)) yield [path, await handle.getFile()];
    if (handle.kind === "directory" && ["assets", "assets/icons", "_locales", "vendor", "vendor/pdfjs", "vendor/document-ingestion", "vendor/noble-hashes"].some(base => path === base || path.startsWith(base + "/"))) {
      yield* programFiles(handle, path + "/");
    }
  }
}

export async function verifyInstallationDirectory(root, runtime, fetchFn = fetch) {
  for await (const [name] of root.entries()) {
    if (name === ".git") throw new Error("这是源码工作目录，请通过项目更新代码，避免覆盖尚未发布的修改");
  }
  const disk = await readFile(root, "manifest.json");
  if (!disk) throw new Error("所选文件夹不是插件安装目录");
  const manifest = JSON.parse(await disk.text());
  if (manifest.version !== runtime.getManifest().version || await extensionIdForKey(manifest.key) !== runtime.id) {
    throw new Error("所选目录与正在运行的插件不一致");
  }
  if (!await isRunningDirectory(root, runtime, fetchFn)) {
    throw new Error("请选择 Chrome 当前实际加载的安装目录，不能选择另一份解压副本");
  }
}

async function isRunningDirectory(root, runtime, fetchFn) {
  const name = `promptdirector-directory-check-${crypto.randomUUID()}.txt`;
  const token = crypto.randomUUID();
  try {
    await writeFile(root, name, new Blob([token]));
    const response = await fetchFn(runtime.getURL(name), { cache: "no-store" });
    return response.ok && await response.text() === token;
  } finally {
    await root.removeEntry(name).catch(error => { if (error.name !== "NotFoundError") throw error; });
  }
}

export async function cleanupLocalUpgrade(record, { runtime, fetchFn = fetch }) {
  if (record.phase !== "preparing" && !await verifyRunningUpgrade(record, runtime, fetchFn)
    && !await verifyRecoveredUpgrade(record, runtime, fetchFn)) {
    throw new Error("上次升级尚未完成，请先处理升级恢复提示");
  }
  // The recovery copy can itself be the active install. Only remove it when the
  // original directory is proven active; otherwise leave all its files intact.
  if (!await isRunningDirectory(record.root, runtime, fetchFn)) return false;
  try { await record.root.removeEntry(RECOVERY_DIRECTORY, { recursive: true }); }
  catch (error) { if (error.name !== "NotFoundError") throw error; }
  return true;
}

export async function installLocalUpgrade(root, prepared, { runtime, fetchFn = fetch, saveRecord, onProgress = () => undefined }) {
  await verifyInstallationDirectory(root, runtime, fetchFn);
  // Do not overwrite a recovery point left by an interrupted upgrade.
  try {
    await root.getDirectoryHandle(RECOVERY_DIRECTORY);
    throw new Error("安装目录中有未清理的升级恢复副本，请先恢复或完成上次升级");
  } catch (error) { if (error.name !== "NotFoundError") throw error; }
  const recovery = await root.getDirectoryHandle(RECOVERY_DIRECTORY, { create: true });
  const oldFiles = new Map();
  const written = [];
  let recorded = false;
  const record = { root, previousVersion: prepared.previousVersion, targetVersion: prepared.manifest.version, hashes: prepared.hashes };
  const oldHashes = {};
  try {
    await saveRecord({ ...record, phase: "preparing" });
    recorded = true;
    for await (const [path, blob] of programFiles(root)) {
      oldFiles.set(path, blob);
      await writeFile(recovery, path, blob);
      oldHashes[path] = await blobDigest(blob);
      onProgress({ phase: "preparing", completed: oldFiles.size });
    }
    if (!oldFiles.has("manifest.json")) throw new Error("无法建立程序恢复副本");
    await saveRecord({ ...record, oldHashes, phase: "writing" });
    const paths = [...prepared.files.keys()].filter(path => path !== "manifest.json");
    paths.push("manifest.json");
    for (const [index, path] of paths.entries()) {
      if (oldHashes[path] !== prepared.hashes[path]) {
        written.push(path);
        await writeFile(root, path, prepared.files.get(path));
      }
      onProgress({ phase: "writing", completed: index + 1, total: paths.length });
    }
    await saveRecord({ ...record, oldHashes, phase: "written" });
  } catch (error) {
    try {
      for (const path of written.reverse()) {
        const old = oldFiles.get(path);
        if (old) await writeFile(root, path, await readFile(recovery, path));
        else {
          try {
            const { directory, name } = await fileAt(root, path);
            await directory.removeEntry(name);
          } catch (missing) { if (missing.name !== "NotFoundError") throw missing; }
        }
      }
      await root.removeEntry(RECOVERY_DIRECTORY, { recursive: true });
      if (recorded) await saveRecord(null);
    } catch (recoveryError) {
      console.error("Local extension upgrade rollback failed", recoveryError);
      throw new Error(`升级中断，程序恢复副本保留在 ${RECOVERY_DIRECTORY}。请在 Chrome 扩展管理中加载该文件夹恢复原版本，无需卸载或导入案例。`);
    }
    throw error;
  }
}

export async function localUpgradeRecord(value = undefined) {
  return updaterState(RECORD_KEY, value);
}

export async function localInstallationDirectory(value = undefined) {
  return updaterState("installation-directory", value);
}

async function updaterState(key, value) {
  const db = await new Promise((resolve, reject) => {
    const request = indexedDB.open("promptdirector-extension-updater", 1);
    request.onupgradeneeded = () => request.result.createObjectStore("state");
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  try {
    return await new Promise((resolve, reject) => {
      const transaction = db.transaction("state", value === undefined ? "readonly" : "readwrite");
      const store = transaction.objectStore("state");
      const request = value === undefined ? store.get(key) : value === null ? store.delete(key) : store.put(value, key);
      transaction.oncomplete = () => resolve(request.result);
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error || new Error("无法记录升级进度"));
    });
  } finally { db.close(); }
}

export async function verifyRunningUpgrade(record, runtime, fetchFn = fetch) {
  if (runtime.getManifest().version !== record.targetVersion) return false;
  for (const [path, hash] of Object.entries(record.hashes)) {
    const response = await fetchFn(runtime.getURL(path), { cache: "no-store" });
    if (!response.ok || await blobDigest(await response.blob()) !== hash) return false;
  }
  return true;
}

export async function verifyRecoveredUpgrade(record, runtime, fetchFn = fetch) {
  if (!record.oldHashes || !Object.keys(record.oldHashes).length) return false;
  return verifyRunningUpgrade({ targetVersion: record.previousVersion, hashes: record.oldHashes }, runtime, fetchFn);
}

export async function withLocalUpgradeLock(task) {
  return navigator.locks.request("promptdirector-extension-upgrade", { ifAvailable: true }, async lock => {
    if (!lock) throw Object.assign(new Error("另一个页面正在升级，请等待完成"), { code: "UPGRADE_BUSY" });
    return task();
  });
}
