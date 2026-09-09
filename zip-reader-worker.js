import { openZipBlob } from "./zip.js";

self.onmessage = async ({ data: { archive, names, limits } }) => {
  try {
    const reader = await openZipBlob(archive, limits);
    let lastReport = -Infinity;
    const report = progress => {
      // Ten updates per second keep progress legible without flooding the UI.
      const now = performance.now();
      if (now - lastReport < 100 && progress.completed !== progress.total) return;
      lastReport = now;
      self.postMessage({ type: "progress", progress });
    };
    const files = await reader.read(names, { onReadProgress: report, onProgress: report });
    self.postMessage({ type: "complete", files });
  } catch (error) {
    self.postMessage({ type: "error", message: error?.message || "案例包读取失败" });
  }
};
