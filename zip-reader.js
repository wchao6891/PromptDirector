// A dedicated worker keeps byte validation off the interactive library page.
export function readZipResources(archive, names, limits, { signal, onProgress } = {}) {
  signal?.throwIfAborted();
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL("./zip-reader-worker.js", import.meta.url), { type: "module" });
    const finish = (error, files) => {
      signal?.removeEventListener("abort", abort);
      worker.terminate();
      if (error) reject(error);
      else resolve(files);
    };
    const abort = () => finish(signal.reason || new DOMException("已取消读取", "AbortError"));
    signal?.addEventListener("abort", abort, { once: true });
    worker.onmessage = ({ data }) => {
      if (data.type === "progress") onProgress?.(data.progress);
      else if (data.type === "complete") finish(null, data.files);
      else if (data.type === "error") finish(new Error(data.message));
    };
    worker.onerror = event => { event.preventDefault(); finish(new Error(event.message || "案例包读取失败")); };
    worker.onmessageerror = () => finish(new Error("案例包读取结果无法传递"));
    try { worker.postMessage({ archive, names, limits }); }
    catch (error) { finish(error); }
  });
}
