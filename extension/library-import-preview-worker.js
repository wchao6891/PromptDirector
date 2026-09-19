import { previewLibraryTransferBatch } from "./library-transfer.js";

self.onmessage = ({ data }) => {
  try { self.postMessage({ result: previewLibraryTransferBatch(data) }); }
  catch (error) { self.postMessage({ error: error?.message || "案例包核对失败" }); }
};
