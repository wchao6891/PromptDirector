// Read-only planning belongs to the open import dialog. Closing or changing it
// terminates calculation; committing still rechecks the snapshot in background.
export function previewLibraryImportInWorker(input, { signal } = {}) {
  signal?.throwIfAborted();
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL("./library-import-preview-worker.js", import.meta.url), { type: "module" });
    const finish = (error, result) => {
      signal?.removeEventListener("abort", abort);
      worker.terminate();
      if (error) reject(error);
      else resolve(result);
    };
    const abort = () => finish(signal.reason || new DOMException("已取消核对", "AbortError"));
    signal?.addEventListener("abort", abort, { once: true });
    worker.onmessage = ({ data }) => data.error ? finish(new Error(data.error)) : finish(null, data.result);
    worker.onerror = event => { event.preventDefault(); finish(new Error(event.message || "案例包核对失败")); };
    worker.onmessageerror = () => finish(new Error("案例包核对结果无法传递"));
    try { worker.postMessage(input); }
    catch (error) { finish(error); }
  });
}
