import { libraryStoredAssetIds } from "./library-asset-inventory.js";

// Package-only projection. Local shared originals keep their storage ids; each
// case in the package gets independent ids while retaining the existing paths.
export function projectPortableMedia(stateValue) {
  const state = structuredClone(stateValue);
  const entries = [...(state.entries ?? []), ...(state.trashState?.items ?? [])
    .filter(item => item.kind === "entry").map(item => item.snapshot)];
  const mediaTrash = new Map();
  for (const item of state.trashState?.items ?? []) {
    if (item.kind !== "media") continue;
    const container = { id: item.id, mediaAssets: item.snapshot?.mediaAssets ?? [] };
    entries.push(container);
    mediaTrash.set(container, item);
  }
  const reserved = libraryStoredAssetIds(state);
  const claimed = new Set();
  const maps = new Map();
  for (const entry of entries) {
    const mapping = new Map();
    for (const asset of entry.mediaAssets ?? []) {
      if (claimed.has(asset.id)) {
        const base = `portable:${encodeURIComponent(entry.id)}:${encodeURIComponent(asset.id)}`;
        let id = base;
        let suffix = 1;
        while (reserved.has(id)) id = `${base}:${suffix++}`;
        reserved.add(id);
        mapping.set(asset.id, id);
      } else claimed.add(asset.id);
    }
    if (!mediaTrash.has(entry)) maps.set(entry.id, mapping);
    if (!mapping.size) continue;
    remapMediaReferences(entry, mapping);
    for (const asset of entry.mediaAssets) asset.id = mapping.get(asset.id) ?? asset.id;
    const trashItem = mediaTrash.get(entry);
    if (trashItem) {
      remapMediaReferences(trashItem.relationships, mapping);
      trashItem.targetId = mapping.get(trashItem.targetId) ?? trashItem.targetId;
      trashItem.id = ["trash", "media", trashItem.relationships?.entryId, trashItem.targetId].filter(Boolean).join(":");
    }
  }
  for (const compound of state.compoundCases ?? []) remapCompound(compound, maps);
  for (const item of state.trashState?.items ?? []) {
    for (const compound of item.relationships?.compoundCases ?? []) remapCompound(compound, maps);
  }
  for (const session of state.composerSessions ?? []) {
    for (const reference of session.referenceSnapshots ?? []) {
      const mapping = maps.get(reference.entryId);
      if (!mapping?.size) continue;
      remapMediaReferences(reference, mapping);
      if (typeof reference.referenceId === "string") {
        for (const [before, after] of mapping) {
          if (reference.referenceId === `${reference.entryId}:${before}`) reference.referenceId = `${reference.entryId}:${after}`;
        }
      }
    }
  }
  return state;
}

const MEDIA_FIELDS = new Set(["assetId", "visualId", "primaryMediaId", "primaryVisualId", "coverVisualId", "posterAssetId", "derivedFromAssetId", "frameAssetId"]);
const MEDIA_LISTS = new Set(["assetIds", "mediaIds", "visualIds"]);
export function remapEntryMediaIds(entryValue, mapping) {
  const entry = structuredClone(entryValue);
  remapMediaReferences(entry, mapping);
  for (const asset of entry.mediaAssets ?? []) asset.id = mapping.get(asset.id) ?? asset.id;
  return entry;
}
function remapMediaReferences(value, mapping) {
  if (!value || typeof value !== "object") return;
  for (const [key, child] of Object.entries(value)) {
    if (MEDIA_FIELDS.has(key) && typeof child === "string") value[key] = mapping.get(child) ?? child;
    else if (MEDIA_LISTS.has(key) && Array.isArray(child)) value[key] = child.map(id => mapping.get(id) ?? id);
    else if (child && typeof child === "object") remapMediaReferences(child, mapping);
  }
}
function remapCompound(compound, maps) {
  for (const id of compound.memberEntryIds ?? []) {
    const mapped = maps.get(id)?.get(compound.coverVisualId);
    if (mapped) { compound.coverVisualId = mapped; return; }
  }
}
