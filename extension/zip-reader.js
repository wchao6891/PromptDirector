// A dedicated worker keeps byte validation off the interactive library page.
import { operationBudget, resourceBudgetError } from './resource-policy.js';

export function readZipResources(archive, names, limits, { signal, onProgress, budget } = {}) {
  signal?.throwIfAborted();
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL("./zip-reader-worker.js", import.meta.url), { type: "module" });
    let finished = false;
    const finish = (error, files) => {
      if (finished) return;
      finished = true; clearTimeout(timer);
      signal?.removeEventListener("abort", abort);
      worker.terminate();
      if (error) reject(error);
      else resolve(files);
    };
    const abort = () => finish(signal.reason || new DOMException("已取消读取", "AbortError"));
    const timer = setTimeout(() => finish(resourceBudgetError('ZIP 解包校验达到本次时间预算；原始压缩包保留')),
      operationBudget(budget).maxDurationMs);
    signal?.addEventListener("abort", abort, { once: true });
    worker.onmessage = ({ data }) => {
      if (data.type === "progress") onProgress?.(data.progress);
      else if (data.type === "complete") finish(null, data.files);
      else if (data.type === "error") finish(Object.assign(new Error(data.message), { code: data.code }));
    };
    worker.onerror = event => { event.preventDefault(); finish(new Error(event.message || "案例包读取失败")); };
    worker.onmessageerror = () => finish(new Error("案例包读取结果无法传递"));
    try { worker.postMessage({ archive, names, limits, budget }); }
    catch (error) { finish(error); }
  });
}
