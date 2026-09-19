import { entryMediaAssets, primaryMediaAsset } from "./media.js";
import { originalMediaPrompt } from "./prompt-sources.js";

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
  const primary = primaryMediaAsset(entry);
  const requestedAssetId = clean(assetIdValue);
  const selected = requestedAssetId
    ? entryMediaAssets(entry).find((item) => item?.id === requestedAssetId && item?.usage !== "poster")
    : primary;
  const selectedAssetId = clean(selected?.id);
  const mediaPrompt = selectedAssetId ? originalMediaPrompt(entry, selectedAssetId)
    || entry.mediaPrompts?.find(item => item.assetId === selectedAssetId && item.source === "ai-suggestion") : null;
  const mediaText = clean(mediaPrompt?.text);
  if (mediaText) {
    return {
      text: mediaText,
      textRevision: revisionFromUpdatedAt(mediaPrompt?.updatedAt, revisionFromValue(mediaPrompt?.textRevision, 1)),
      source: mediaPrompt.source === "ai-suggestion" ? "ai_prompt" : "media_prompt",
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
