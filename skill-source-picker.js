import { entryMediaAssets } from "./media.js";

// Keep source browsing consistent with the case library's established page size.
export const SKILL_SOURCE_BATCH_SIZE = 24;

export function availableSkillSourceAssets(entry = {}) {
  return entryMediaAssets(entry).filter((asset) => asset.usage !== "poster");
}

export function filterSkillSourceEntries(entries = [], options = {}) {
  const projectEntryIds = options.projectEntryIds instanceof Set ? options.projectEntryIds : null;
  const query = String(options.query ?? "").trim().toLocaleLowerCase();
  return entries.filter((entry) => {
    if (projectEntryIds && !projectEntryIds.has(entry.id)) return false;
    if (!query) return true;
    return `${entry.title ?? ""}\n${entry.text ?? ""}`.toLocaleLowerCase().includes(query);
  });
}

export function pageSkillSourceEntries(entries = [], visibleCount = SKILL_SOURCE_BATCH_SIZE) {
  const limit = Math.max(0, Number(visibleCount) || 0);
  return entries.slice(0, limit);
}

export function cloneSkillSourceSelection(selection = {}) {
  return {
    entryId: String(selection.entryId ?? ""),
    includeEntryText: Boolean(selection.includeEntryText),
    assetIds: new Set(selection.assetIds ?? [])
  };
}

export function skillSourceSelectionSummary(entries = [], selections = new Map()) {
  const entryById = new Map(entries.map((entry) => [entry.id, entry]));
  const summary = { cases: 0, images: 0, videos: 0, documents: 0, texts: 0 };
  for (const selection of selections.values()) {
    const entry = entryById.get(selection.entryId);
    if (!entry) continue;
    summary.cases += 1;
    if (selection.includeEntryText) summary.texts += 1;
    const selectedIds = selection.assetIds instanceof Set ? selection.assetIds : new Set(selection.assetIds ?? []);
    for (const asset of availableSkillSourceAssets(entry)) {
      if (!selectedIds.has(asset.id)) continue;
      if (asset.kind === "image") summary.images += 1;
      else if (asset.kind === "video") summary.videos += 1;
      else if (asset.kind === "document") summary.documents += 1;
    }
  }
  return summary;
}
