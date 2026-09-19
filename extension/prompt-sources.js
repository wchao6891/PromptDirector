import { usesArticleReader } from "./case-presentation.js";
import { currentVideoReconstruction } from "./media.js";
import { validReconstructionPrompt } from "./image-prompt.js";
import { CONTENT_ROLES, contentRoleForEntry } from "./taxonomy.js";

export function detailPromptSources(entry = {}, asset = {}) {
  const mediaPrompt = originalMediaPrompt(entry, asset.id);
  const adoptedAi = String(entry.mediaPrompts?.find(item => item.assetId === asset.id && item.source === "ai-suggestion")?.text ?? "").trim();
  const original = String(mediaPrompt?.text ?? "").trim() || sharedOriginalPrompt(entry);
  const record = asset.kind === "video" ? currentVideoReconstruction(entry, asset.id) : null;
  return {
    original,
    originalAssetId: mediaPrompt?.source !== "ai-suggestion" && String(mediaPrompt?.text ?? "").trim() ? asset.id : "",
    ai: asset.kind === "video" ? record?.reconstructionPrompt || "" : adoptedAi || validReconstructionPrompt(asset),
    aiSource: adoptedAi ? "media-prompt" : "analysis",
    record
  };
}

export function originalMediaPrompts(entry = {}) {
  return (entry.mediaPrompts ?? []).filter(item => item.source !== "ai-suggestion" && String(item.text ?? "").trim());
}

export function originalMediaPrompt(entry, assetId) {
  const prompts = originalMediaPrompts(entry).filter(item => item.assetId === assetId);
  return prompts.find(item => item.source === "manual") || prompts[0];
}

export function sharedOriginalPrompt(entry = {}) {
  if (usesArticleReader(entry) || entry.sourceFacts?.originalPromptAvailable === false
    || originalMediaPrompts(entry).some(item => item.source === "webpage")) return "";
  // Explicit source evidence remains readable regardless of browsing category.
  if (entry.sourceFacts?.originalPromptAvailable !== true && (
    [CONTENT_ROLES.imageCase, CONTENT_ROLES.videoCase].includes(contentRoleForEntry(entry))
  )) return "";
  return String(entry.text ?? "").trim();
}

export function caseOriginalPromptText(entry = {}) {
  if (entry.memberEntries?.length) {
    return entry.memberEntries.map(member => {
      const text = caseOriginalPromptText(member);
      return text ? `${member.title || member.id}\n${text}` : "";
    }).filter(Boolean).join("\n\n");
  }
  const prompts = originalMediaPrompts(entry);
  // When only per-media evidence exists, shared prose is not necessarily a prompt.
  const shared = !prompts.length || entry.sourceFacts?.originalPromptAvailable === true
    ? sharedOriginalPrompt(entry) : "";
  return [...new Set([shared, ...prompts.map(item => String(item.text).trim())].filter(Boolean))].join("\n\n");
}
