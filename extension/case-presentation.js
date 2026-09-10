import { assetFormatForExtension, assetFormatForFile } from "./asset-formats.js";
import { CONTENT_ROLES, contentRoleForEntry } from "./taxonomy.js";

function usesCreativeCase(entry) {
  return [CONTENT_ROLES.promptImage, CONTENT_ROLES.promptVideo, CONTENT_ROLES.imageCase, CONTENT_ROLES.videoCase]
    .includes(contentRoleForEntry(entry));
}

export function usesArticleReader(entry = {}) {
  if (usesCreativeCase(entry) || !entry.articleDocument?.blocks?.length) return false;
  const role = contentRoleForEntry(entry);
  return [CONTENT_ROLES.tutorial, CONTENT_ROLES.reference].includes(role)
    || !["video", "artwork"].includes(entry.sourceFacts?.pageType);
}

export function usesPostReader(entry = {}) {
  return entry.sourceFacts?.pageType === "post" && !usesCreativeCase(entry) && !usesArticleReader(entry);
}

export function mediaFormatLabel(asset = {}) {
  const format = assetFormatForExtension(asset.sourceFormat)
    || assetFormatForFile({ name: asset.sourceTitle, type: asset.mimeType });
  return (format?.extensions?.[0] || "FILE").toUpperCase();
}
