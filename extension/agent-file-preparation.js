import { getMediaBlob, saveMediaBlob, savePortableAssetBlob, saveDerivedMedia } from "./media-store.js";
import { prepareLocalMedia } from "./local-media.js";
import { readVideoMedia } from "./browser-video-media.js";
import { agentPosterAssetId } from './agent-protocol.js';

// Runs in the existing offscreen document: PDF/HTML/video preparation requires
// browser document APIs. Original bytes are retained by the same media store.
export async function prepareAgentFile(record) {
  const blob = await getMediaBlob(record.assetId);
  if (!blob || blob.size !== record.byteSize) throw new Error("传输文件不存在或大小已变化");
  const file = new File([blob], record.name, { type: record.mimeType });
  const result = await prepareLocalMedia(file, record.assetId, {
    readVideoMedia,
    verifiedContentHash: record.sha256,
    forceImport: record.forceImport === true,
    extractPdfText: async blob => (await import("./document-viewer.js")).extractPdfSearchText(blob),
    estimateStorage: () => navigator.storage?.estimate?.() || {},
    parseHtml: text => new DOMParser().parseFromString(text, "text/html")
  });
  if (result.poster) {
    // Retrying preparation overwrites this task's poster rather than leaving a
    // new random file behind. The persisted upload already owns this identity.
    const id = agentPosterAssetId(record.assetId);
    result.poster.asset.id = id;
    result.asset.posterAssetId = id;
  }
  await (result.asset.kind === "attachment" ? savePortableAssetBlob : saveMediaBlob)(record.assetId, result.blob);
  if (result.poster) await saveMediaBlob(result.poster.asset.id, result.poster.blob);
  if (result.contentText) await saveDerivedMedia(record.assetId, { searchText: result.contentText });
  return { asset: result.asset, poster: result.poster?.asset || null,
    contentText: result.contentText || "", contentFormat: result.contentFormat || "plain", warnings: result.warnings || [] };
}
