import { usesArticleReader } from "./case-presentation.js";
import { currentVideoReconstruction } from "./media.js";
import { validReconstructionPrompt } from "./image-prompt.js";
import { CONTENT_ROLES, contentRoleForEntry } from "./taxonomy.js";

export function detailPromptSources(entry = {}, asset = {}) {
  const mediaPrompt = entry.mediaPrompts?.find(item => item.assetId === asset.id && item.source === "manual")
    || entry.mediaPrompts?.find(item => item.assetId === asset.id && item.source !== "ai-suggestion");
  const adoptedAi = String(entry.mediaPrompts?.find(item => item.assetId === asset.id && item.source === "ai-suggestion")?.text ?? "").trim();
  const sharedPromptAllowed = !usesArticleReader(entry)
    && entry.sourceFacts?.originalPromptAvailable !== false
    && !entry.mediaPrompts?.some(item => item.source === "webpage")
    && ![CONTENT_ROLES.imageCase, CONTENT_ROLES.videoCase].includes(contentRoleForEntry(entry));
  const original = String(mediaPrompt?.text ?? "").trim() || (sharedPromptAllowed ? String(entry.text ?? "").trim() : "");
  const record = asset.kind === "video" ? currentVideoReconstruction(entry, asset.id) : null;
  return {
    original,
    originalAssetId: mediaPrompt?.source !== "ai-suggestion" && String(mediaPrompt?.text ?? "").trim() ? asset.id : "",
    ai: asset.kind === "video" ? record?.reconstructionPrompt || "" : adoptedAi || validReconstructionPrompt(asset),
    aiSource: adoptedAi ? "media-prompt" : "analysis",
    record
  };
}
