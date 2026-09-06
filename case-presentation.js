import { assetFormatForExtension, assetFormatForFile } from "./asset-formats.js";

export function usesArticleReader(entry = {}) {
  return !["video", "artwork", "post"].includes(entry.sourceFacts?.pageType)
    && Boolean(entry.articleDocument?.blocks?.length);
}

export function mediaFormatLabel(asset = {}) {
  const format = assetFormatForExtension(asset.sourceFormat)
    || assetFormatForFile({ name: asset.sourceTitle, type: asset.mimeType });
  return (format?.extensions?.[0] || "FILE").toUpperCase();
}
