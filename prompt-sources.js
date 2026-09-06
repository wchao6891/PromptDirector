import { usesArticleReader } from "./case-presentation.js";
import { currentVideoReconstruction } from "./media.js";
import { validReconstructionPrompt } from "./image-prompt.js";

export function detailPromptSources(entry = {}, asset = {}) {
  const mediaPrompt = entry.mediaPrompts?.find(item => item.assetId === asset.id && item.source !== "ai-suggestion");
  const adoptedAi = String(entry.mediaPrompts?.find(item => item.assetId === asset.id && item.source === "ai-suggestion")?.text ?? "").trim();
  const original = (mediaPrompt?.source !== "ai-suggestion" ? String(mediaPrompt?.text ?? "").trim() : "") || (usesArticleReader(entry) ? "" : String(entry.text ?? "").trim());
  const record = asset.kind === "video" ? currentVideoReconstruction(entry, asset.id) : null;
  return {
    original,
    originalAssetId: mediaPrompt?.source !== "ai-suggestion" && String(mediaPrompt?.text ?? "").trim() ? asset.id : "",
    ai: asset.kind === "video" ? record?.reconstructionPrompt || "" : adoptedAi || validReconstructionPrompt(asset),
    aiSource: adoptedAi ? "media-prompt" : "analysis",
    record
  };
}
