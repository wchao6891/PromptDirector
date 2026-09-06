import { showAppDialog } from "./ui-dialogs.js";
import { t } from "./i18n.js";
import { blobDigest, installLocalUpgrade, localReleasePackageUrl, localUpgradeRecord, prepareLocalUpgrade, RECOVERY_DIRECTORY, verifyRecoveredUpgrade, verifyRunningUpgrade } from "./local-extension-upgrade.js";

let active = false;

export async function openLocalUpgrade(status, archive = null) {
  if (active) return;
  if ((await chrome.management.getSelf()).installType !== "development") throw new Error(t("商店版由 Chrome 自动更新"));
  active = true;
  try {
    const pending = await localUpgradeRecord();
    if (pending) {
      if (pending.phase !== "preparing" && !await verifyRunningUpgrade(pending, chrome.runtime)) throw new Error(t("上次升级尚未完成，请先处理升级恢复提示"));
      const cleared = await showAppDialog({
        title: "清理上次程序恢复副本",
        description: pending.phase === "preparing" ? "上次准备更新中断，原插件未更改。清理临时程序副本后继续。" : "已确认上次升级成功。允许清理程序恢复副本后继续；不会删除案例。",
        confirmLabel: "允许并继续",
        onSubmit: finishLocalUpgrade
      });
      if (!cleared) return;
    }
    let prepared;
    const ready = await showAppDialog({
      title: "升级本地版",
      description: "只更新插件程序，案例和媒体留在原资料库。升级会重启插件，请先保存正在编辑的内容。",
      confirmLabel: archive ? "验证更新包" : "下载更新包",
      pendingLabel: "正在验证更新包…",
      dismissOnBackdrop: false,
      onSubmit: async () => {
        if (archive) prepared = await prepareLocalUpgrade(archive, chrome.runtime);
        const version = prepared?.manifest.version || status.latestVersion;
        const releaseUrl = prepared
          ? `${chrome.runtime.getManifest().homepage_url}/releases/tag/v${version}`
          : status.releaseUrl;
        const url = localReleasePackageUrl(chrome.runtime.getManifest(), releaseUrl, version);
        const response = await fetch(url, { cache: "no-store", credentials: "omit" });
        if (!response.ok) throw new Error(t("无法下载对应的本地更新包，请稍后重试"));
        const published = await response.blob();
        if (archive && await blobDigest(archive) !== await blobDigest(published)) throw new Error(t("所选更新包与官方发布内容不一致，已停止升级"));
        prepared = await prepareLocalUpgrade(published, chrome.runtime);
        if (prepared.manifest.version !== version) throw new Error(t("更新包版本与发布版本不一致"));
        return true;
      }
    });
    if (!ready) return;
    let writing = false;
    await showAppDialog({
      title: t("升级到 {version}", { version: prepared.manifest.version }),
      description: "请选择 Chrome 当前加载的插件文件夹。无需卸载、备份或导入案例。",
      confirmLabel: "选择安装文件夹并升级",
      pendingLabel: "正在核对安装目录…",
      dismissOnBackdrop: false,
      onReady: ({ dialog }) => {
        dialog.addEventListener("cancel", event => {
          if (writing) { event.preventDefault(); event.stopImmediatePropagation(); }
        }, { capture: true });
      },
      onSubmit: async (_values, controls) => {
        let root;
        try { root = await window.showDirectoryPicker({ mode: "readwrite" }); }
        catch (error) { if (error.name === "AbortError") return false; throw error; }
        writing = true;
        const beforeUnload = event => { event.preventDefault(); event.returnValue = ""; };
        window.addEventListener("beforeunload", beforeUnload);
        try {
          await navigator.locks.request("promptdirector-extension-upgrade", { ifAvailable: true }, async lock => {
            if (!lock) throw new Error(t("另一个页面正在升级，请等待完成"));
            await installLocalUpgrade(root, prepared, {
              runtime: chrome.runtime,
              saveRecord: localUpgradeRecord,
              onProgress: ({ phase, completed, total }) => {
                controls.status().textContent = phase === "preparing"
                  ? t("正在准备更新 · {completed} 个程序文件", { completed })
                  : t("正在更新程序 {completed}/{total}", { completed, total });
              }
            });
            controls.status().textContent = t("程序已写入，正在重启验证版本…");
            chrome.runtime.reload();
          });
        } finally {
          writing = false;
          window.removeEventListener("beforeunload", beforeUnload);
        }
        return true;
      }
    });
  } finally { active = false; }
}

export async function runningUpgradeFeedback() {
  const record = await localUpgradeRecord();
  if (!record) return { message: "", cleanupRequired: false };
  if (record.phase === "preparing") return { message: t("上次准备更新中断，原插件未更改。清理临时程序副本后继续。"), cleanupRequired: true };
  if (await verifyRecoveredUpgrade(record, chrome.runtime)) {
    // The recovery folder may now be the active installation. Never delete it here.
    await localUpgradeRecord(null);
    return { message: t("已恢复原版本，案例与媒体仍在原资料库"), cleanupRequired: false };
  }
  if (!await verifyRunningUpgrade(record, chrome.runtime)) {
    return { message: t("上次升级未完成。请在 Chrome 扩展管理中加载安装目录内的 {folder}，恢复原版本；无需卸载或导入案例。", { folder: RECOVERY_DIRECTORY }), cleanupRequired: false };
  }
  let cleanupRequired = true;
  if (await record.root.queryPermission({ mode: "readwrite" }) === "granted") {
    try {
      await record.root.removeEntry(RECOVERY_DIRECTORY, { recursive: true });
      await localUpgradeRecord(null);
      cleanupRequired = false;
    } catch (error) {
      console.warn("Upgrade verified; program recovery cleanup pending", error);
    }
  }
  return { message: t("已升级到 {version}", { version: record.targetVersion }), cleanupRequired };
}

export async function finishLocalUpgrade() {
  const record = await localUpgradeRecord();
  if (!record) return true;
  if (await record.root.requestPermission({ mode: "readwrite" }) !== "granted") return false;
  if (record.phase !== "preparing" && !await verifyRunningUpgrade(record, chrome.runtime)) {
    throw new Error(t("上次升级尚未完成，请先处理升级恢复提示"));
  }
  try { await record.root.removeEntry(RECOVERY_DIRECTORY, { recursive: true }); }
  catch (error) { if (error.name !== "NotFoundError") throw error; }
  await localUpgradeRecord(null);
  return true;
}
