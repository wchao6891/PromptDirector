import { localInstallationDirectory, verifyInstallationDirectory } from "./local-extension-upgrade.js";

// The handle stays in this browser's updater database, outside portable case data.
export async function resolveLocalInstallationDirectory(saved, {
  runtime = chrome.runtime,
  pickDirectory = () => window.showDirectoryPicker({ mode: "readwrite", id: "promptdirector-installation" }),
  remember = localInstallationDirectory,
  fetchFn = fetch
} = {}) {
  let root = saved;
  if (root) {
    if (await root.queryPermission({ mode: "readwrite" }) !== "granted"
      && await root.requestPermission({ mode: "readwrite" }) !== "granted") {
      throw new Error("需要安装目录的写入授权才能更新，案例未改变");
    }
  } else {
    root = await pickDirectory();
  }
  try {
    await verifyInstallationDirectory(root, runtime, fetchFn);
  } catch (error) {
    if (saved) await remember(null);
    throw error;
  }
  await remember(root);
  return root;
}
