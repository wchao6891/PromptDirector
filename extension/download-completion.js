// Preserve the existing idle limit while allowing large files to keep progressing.
const DOWNLOAD_IDLE_TIMEOUT_MS = 30_000;
// API calls keep the MV3 worker active; poll within its 30-second idle window.
const DOWNLOAD_POLL_INTERVAL_MS = DOWNLOAD_IDLE_TIMEOUT_MS / 3;

export function waitForDownload(downloadId, downloads = chrome.downloads) {
  return new Promise((resolve, reject) => {
    let settled = false;
    let timer;
    let received = -1;
    let lastProgressAt = Date.now();
    const finish = (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      downloads.onChanged.removeListener(onChanged);
      if (error) reject(error);
      else resolve();
    };
    const onChanged = (delta) => {
      if (delta.id !== downloadId) return;
      if (delta.state?.current === "complete") finish();
      if (delta.state?.current === "interrupted") {
        finish(new Error(delta.error?.current || "本地文件写入被中断"));
      }
    };
    const check = async () => {
      try {
        const [item] = await downloads.search({ id: downloadId });
        if (settled) return;
        if (!item) return finish(new Error("下载记录不存在"));
        if (item.state === "complete") return finish();
        if (item.state === "interrupted") return finish(new Error(item.error || "本地文件写入被中断"));
        if (item.bytesReceived > received) {
          received = item.bytesReceived;
          lastProgressAt = Date.now();
        } else if (Date.now() - lastProgressAt >= DOWNLOAD_IDLE_TIMEOUT_MS) {
          return finish(new Error("本地文件写入超时"));
        }
        timer = setTimeout(check, DOWNLOAD_POLL_INTERVAL_MS);
      } catch (error) {
        finish(error);
      }
    };
    downloads.onChanged.addListener(onChanged);
    void check();
  });
}
