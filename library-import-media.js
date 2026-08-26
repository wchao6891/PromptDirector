export async function findInvalidImportedImageIds(images, validateImage) {
  if (!(images instanceof Map) || typeof validateImage !== "function") {
    throw new Error("图片校验输入无效");
  }
  const invalidIds = new Set();
  for (const [assetId, blob] of images) {
    if (!(blob instanceof Blob) || !clean(assetId)) throw new Error("图片校验输入无效");
    try {
      await validateImage(blob);
    } catch {
      invalidIds.add(assetId);
    }
  }
  return invalidIds;
}

export function filesWithoutInvalidEntryMedia(libraryValue, files, invalidAssetIds) {
  if (!(files instanceof Map) || !(invalidAssetIds instanceof Set)) {
    throw new Error("媒体修复输入无效");
  }
  const result = new Map(files);
  for (const entry of Array.isArray(libraryValue?.entries) ? libraryValue.entries : []) {
    const mediaAssets = Array.isArray(entry?.mediaAssets)
      ? entry.mediaAssets
      : Array.isArray(entry?.visuals) ? entry.visuals : [];
    for (const asset of mediaAssets) {
      if (!invalidAssetIds.has(clean(asset?.id))) continue;
      const path = clean(asset?.assetPath || asset?.screenshotPath);
      if (path) result.delete(path);
    }
  }
  return result;
}

function clean(value) {
  return String(value ?? "").trim();
}
