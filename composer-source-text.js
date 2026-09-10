import { entryMediaAssets } from "./media.js";
import { detailPromptSources } from "./prompt-sources.js";

// Only reusable content belongs in a model reference; source metadata stays local.
export function composerSourceText(entry = {}, documentTextByEntryId) {
  const assets = entryMediaAssets(entry);
  const assetsById = new Map(assets.map(asset => [asset.id, asset]));
  const values = [
    entry.text,
    documentTextByEntryId?.get?.(entry.id),
    ...(entry.mediaPrompts ?? []).filter(item => item.source !== "ai-suggestion").map(item => item.text),
    ...assets.map(asset => composerAssetAnalysisText(entry, asset)),
    ...(entry.timeNotes ?? []).map(note => {
      const text = String(note.text ?? "").trim();
      const frame = assetsById.get(note.frameAssetId);
      const frameText = frame ? composerAssetAnalysisText(entry, frame) : "";
      if (!text && !frameText) return "";
      const time = note.endMs > note.startMs
        ? `${formatReferenceTime(note.startMs)}-${formatReferenceTime(note.endMs)}`
        : formatReferenceTime(note.startMs);
      return `[${time}] ${text}${frameText ? `\n关键帧描述：${frameText}` : ""}`;
    }),
    ...(entry.memberEntries ?? []).map(member => composerSourceText(member, documentTextByEntryId))
  ];
  return [...new Set(values.map(value => String(value ?? "").trim()).filter(Boolean))].join("\n\n");
}

export function composerAssetAnalysisText(entry, asset) {
  const analysis = asset.visionAnalysis;
  const current = detailPromptSources(entry, asset).ai;
  if (current) return current;
  if (!analysis || analysis.invalidated || analysis.quality === "partial" || analysis.reconstructionPrompt != null) return "";
  return String(analysis.description ?? "").trim();
}

export function formatReferenceTime(milliseconds) {
  const total = Math.max(0, Math.floor(Number(milliseconds) || 0));
  const minutes = Math.floor(total / 60_000);
  const seconds = Math.floor(total % 60_000 / 1000);
  const remainder = total % 1000;
  return `${minutes}:${String(seconds).padStart(2, "0")}.${String(remainder).padStart(3, "0")}`;
}
