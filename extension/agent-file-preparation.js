import { getMediaBlob, saveMediaBlob, savePortableAssetBlob, saveDerivedMedia } from "./media-store.js";
import { prepareLocalMedia } from "./local-media.js";
import { readVideoMedia } from "./browser-video-media.js";

// Runs in the existing offscreen document: PDF/HTML/video preparation requires
// browser document APIs. Original bytes are retained by the same media store.
export async function prepareAgentFile(record) {
  const blob = await getMediaBlob(record.assetId);
  if (!blob) throw new Error("传输文件不存在");
  const file = new File([blob], record.name, { type: record.mimeType });
  const result = await prepareLocalMedia(file, record.assetId, {
    readVideoMedia,
    forceImport: record.forceImport === true,
    extractPdfText: async blob => (await import("./document-viewer.js")).extractPdfSearchText(blob),
    estimateStorage: () => navigator.storage?.estimate?.() || {},
    parseHtml: text => new DOMParser().parseFromString(text, "text/html")
  });
  await (result.asset.kind === "attachment" ? savePortableAssetBlob : saveMediaBlob)(record.assetId, result.blob);
  if (result.poster) await saveMediaBlob(result.poster.asset.id, result.poster.blob);
  if (result.contentText) await saveDerivedMedia(record.assetId, { searchText: result.contentText });
  return { asset: result.asset, poster: result.poster?.asset || null,
    contentText: result.contentText || "", contentFormat: result.contentFormat || "plain", warnings: result.warnings || [] };
}
