import {
  addEntryMedia,
  entryMediaAssets,
  entryHasMedia,
  mediaDescriptions,
  normalizeEntryMedia,
  normalizeMediaAsset,
  primaryImageAsset,
  removeEntryMedia,
  reorderEntryMedia,
  setPrimaryMedia,
  updateEntryMedia
} from "./media.js";

export function normalizeVisual(value = {}) {
  return withLegacyVisualAsset(normalizeMediaAsset({
    ...value,
    kind: "image",
    storageMode: value.storageMode || "managed",
    assetPath: value.assetPath || value.screenshotPath
  }));
}

export function normalizeEntryVisuals(entryValue = {}) {
  return withLegacyVisualAccessors(normalizeEntryMedia(entryValue));
}

export function primaryVisual(entryValue = {}) {
  return primaryImageAsset(entryValue);
}

export function entryHasVisual(entryValue = {}) {
  return entryValue?.hasScreenshot === true || entryHasMedia(entryValue, "image");
}

export function addEntryVisual(entryValue, visualValue, options = {}) {
  return withLegacyVisualAccessors(addEntryMedia(entryValue, { ...visualValue, kind: "image" }, options));
}

export function removeEntryVisual(entryValue, visualId) {
  return withLegacyVisualAccessors(removeEntryMedia(entryValue, visualId));
}

export function reorderEntryVisuals(entryValue, visualIds = []) {
  const entry = normalizeEntryMedia(entryValue);
  const images = entry.mediaAssets.filter((item) => item.kind === "image" && item.usage !== "poster");
  const other = entry.mediaAssets.filter((item) => item.kind !== "image" || item.usage === "poster");
  const orderedImages = reorderEntryMedia({ ...entry, mediaAssets: images }, visualIds).mediaAssets;
  return withLegacyVisualAccessors({ ...entry, mediaAssets: [...orderedImages, ...other] });
}

export function setPrimaryVisual(entryValue, visualId) {
  const entry = normalizeEntryMedia(entryValue);
  const id = String(visualId ?? "").trim();
  if (!entry.mediaAssets.some((item) => item.id === id && item.kind === "image" && item.usage !== "poster")) {
    throw new Error("没有找到这张截图");
  }
  return withLegacyVisualAccessors(setPrimaryMedia(entry, id));
}

export function updateEntryVisual(entryValue, visualId, updater) {
  const entry = normalizeEntryMedia(entryValue);
  const id = String(visualId ?? "").trim();
  const current = entry.mediaAssets.find((item) => item.id === id && item.kind === "image" && item.usage !== "poster");
  if (!current) throw new Error("没有找到这张截图");
  const next = typeof updater === "function" ? updater(current) : updater;
  return withLegacyVisualAccessors(updateEntryMedia(entry, id, { ...next, kind: "image" }));
}

export function entryPalette(entryValue = {}) {
  return primaryVisual(entryValue)?.palette;
}

export function primaryVisionAnalysis(entryValue = {}) {
  const analysis = primaryVisual(entryValue)?.visionAnalysis;
  return analysis && !analysis.invalidated && analysis.quality !== "partial" ? analysis : null;
}

export function primaryVisionDescription(entryValue = {}) {
  const analysis = primaryVisionAnalysis(entryValue);
  return clean(analysis?.reconstructionPrompt || analysis?.description);
}

export function visualDescriptions(entryValue = {}) {
  return mediaDescriptions({
    ...entryValue,
    mediaAssets: entryMediaAssets(entryValue)
      .filter((item) => item.kind === "image" && item.usage !== "poster")
  });
}

function withLegacyVisualAccessors(entry) {
  entry.mediaAssets = entry.mediaAssets.map((item) => item.kind === "image" ? withLegacyVisualAsset(item) : item);
  Object.defineProperties(entry, {
    visuals: {
      configurable: true,
      get() { return this.mediaAssets.filter((item) => item.kind === "image" && item.usage !== "poster"); },
      set(values) {
        const normalized = (Array.isArray(values) ? values : [])
          .map((item) => normalizeVisual(item)).filter(Boolean);
        this.mediaAssets = [
          ...normalized,
          ...this.mediaAssets.filter((item) => item.kind !== "image" || item.usage === "poster")
        ];
      }
    },
    primaryVisualId: {
      configurable: true,
      get() {
        const primary = this.mediaAssets.find((item) => item.id === this.primaryMediaId && item.kind === "image" && item.usage !== "poster");
        return primary?.id || this.mediaAssets.find((item) => item.kind === "image" && item.usage !== "poster")?.id || "";
      },
      set(value) {
        const id = String(value ?? "").trim();
        if (this.mediaAssets.some((item) => item.id === id && item.kind === "image" && item.usage !== "poster")) this.primaryMediaId = id;
      }
    }
  });
  return entry;
}

function withLegacyVisualAsset(asset) {
  if (!asset) return asset;
  Object.defineProperty(asset, "screenshotPath", {
    configurable: true,
    get() { return this.assetPath || ""; },
    set(value) { this.assetPath = String(value ?? "").trim(); }
  });
  return asset;
}

function clean(value) {
  return String(value ?? "").replace(/[\u0000-\u001f\u007f]/g, "").trim();
}
