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

export function filesWithoutInvalidLibraryImages(libraryValue, files, invalidAssetIds) {
  if (!(files instanceof Map) || !(invalidAssetIds instanceof Set)) {
    throw new Error("媒体修复输入无效");
  }
  const result = new Map(files);
  const removeAssetPath = (assetIdValue, pathValue) => {
    if (!invalidAssetIds.has(clean(assetIdValue))) return;
    const path = clean(pathValue);
    if (path) result.delete(path);
  };
  const entries = [
    ...(Array.isArray(libraryValue?.entries) ? libraryValue.entries : []),
    ...(Array.isArray(libraryValue?.trashState?.items) ? libraryValue.trashState.items : []).flatMap((item) => {
      if (item?.kind === "entry") return [item.snapshot];
      if (item?.kind === "media") return [{ mediaAssets: item.snapshot?.mediaAssets ?? [] }];
      return [];
    })
  ];
  for (const entry of entries) {
    const mediaAssets = Array.isArray(entry?.mediaAssets)
      ? entry.mediaAssets
      : Array.isArray(entry?.visuals) ? entry.visuals : [];
    for (const asset of mediaAssets) {
      removeAssetPath(asset?.id, asset?.assetPath || asset?.screenshotPath);
    }
  }
  for (const run of Array.isArray(libraryValue?.creativeRuns) ? libraryValue.creativeRuns : []) {
    for (const output of Array.isArray(run?.outputs) ? run.outputs : []) {
      removeAssetPath(output?.visual?.id, output?.visual?.assetPath || output?.visual?.screenshotPath);
    }
  }
  for (const session of Array.isArray(libraryValue?.composerSessions) ? libraryValue.composerSessions : []) {
    for (const reference of Array.isArray(session?.referenceSnapshots) ? session.referenceSnapshots : []) {
      if (reference?.sourceType !== "temporary") continue;
      for (const asset of Array.isArray(reference?.assetRefs) ? reference.assetRefs : []) {
        removeAssetPath(asset?.assetId, asset?.archivePath);
      }
    }
  }
  return result;
}

function clean(value) {
  return String(value ?? "").trim();
}
