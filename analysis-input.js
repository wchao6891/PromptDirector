import { primaryImageAsset } from "./media.js";

function clean(value) {
  return String(value ?? "").trim();
}

function revisionFromValue(value, fallback = 1) {
  const numeric = Math.floor(Number(value) || 0);
  return numeric > 0 ? numeric : fallback;
}

function revisionFromUpdatedAt(value, fallback = 1) {
  const timestamp = Date.parse(String(value ?? ""));
  return Number.isFinite(timestamp) && timestamp > 0
    ? Math.floor(timestamp)
    : fallback;
}

export function canonicalTextAnalysisInput(entryValue = {}, assetIdValue = "") {
  const entry = entryValue && typeof entryValue === "object" ? entryValue : {};
  const primaryImage = primaryImageAsset(entry);
  const requestedAssetId = clean(assetIdValue);
  const selectedImage = requestedAssetId
    ? (Array.isArray(entry.mediaAssets) ? entry.mediaAssets : [])
      .find((item) => item?.id === requestedAssetId && item?.kind === "image" && item?.usage !== "poster")
    : primaryImage;
  const selectedAssetId = clean(selectedImage?.id);
  const mediaPrompt = selectedAssetId
    ? (Array.isArray(entry.mediaPrompts) ? entry.mediaPrompts : [])
      .find((item) => String(item?.assetId ?? "").trim() === selectedAssetId)
    : null;
  const mediaText = clean(mediaPrompt?.text);
  if (mediaText) {
    return {
      text: mediaText,
      textRevision: revisionFromUpdatedAt(mediaPrompt?.updatedAt, revisionFromValue(mediaPrompt?.textRevision, 1)),
      source: "media_prompt",
      assetId: selectedAssetId
    };
  }
  const sharedText = clean(entry.text);
  return {
    text: sharedText,
    textRevision: revisionFromValue(entry.textRevision, 1),
    source: sharedText ? "entry_text" : "",
    assetId: selectedAssetId
  };
}

export function hasCommittedTextAnalysisTags(entryValue = {}) {
  return (Array.isArray(entryValue?.facetAssignments) ? entryValue.facetAssignments : [])
    .some((item) => item?.source === "deepseek_text");
}
