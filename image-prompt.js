import { entryMediaAssets } from "./media.js";

export function validReconstructionPrompt(assetValue = {}) {
  const analysis = assetValue?.visionAnalysis;
  if (!analysis || analysis.invalidated || Number(analysis.version) !== 2) return "";
  const prompt = String(analysis.reconstructionPrompt ?? "").trim();
  if (!prompt) return "";
  const currentFingerprint = String(assetValue.contentHash ?? "").trim() || String(analysis.imageFingerprint ?? "").trim();
  const analysisFingerprint = String(analysis.imageFingerprint ?? "").trim();
  return currentFingerprint && analysisFingerprint && currentFingerprint !== analysisFingerprint ? "" : prompt;
}

export function promptForEntryImage(entryValue = {}, assetIdValue = "") {
  const assetId = String(assetIdValue ?? "").trim();
  const asset = entryMediaAssets(entryValue).find((item) =>
    item.kind === "image" && item.usage !== "poster" && (!assetId || item.id === assetId)
  );
  const mediaPrompt = (Array.isArray(entryValue.mediaPrompts) ? entryValue.mediaPrompts : [])
    .find((item) => item.assetId === asset?.id);
  return String(mediaPrompt?.text ?? "").trim()
    || String(entryValue.text ?? "").trim()
    || validReconstructionPrompt(asset);
}

export function visualAnalysisPromptReplacement(entryValue = {}, assetIdValue = "") {
  const assetId = String(assetIdValue ?? "").trim();
  const asset = entryMediaAssets(entryValue).find((item) => item.id === assetId && item.kind === "image" && item.usage !== "poster");
  const current = (Array.isArray(entryValue.mediaPrompts) ? entryValue.mediaPrompts : [])
    .find((item) => item.assetId === assetId);
  const text = validReconstructionPrompt(asset);
  if (current?.source !== "ai-suggestion" || !text || String(current.text ?? "").trim() === text) return null;
  return { assetId, text, previousText: String(current.text ?? "").trim() };
}
