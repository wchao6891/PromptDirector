import {
  assetFormatForExtension,
  canonicalMimeType,
  fileExtension,
  isReportedMimeCompatible
} from "./asset-formats.js";

export function normalizePortableMediaDescriptor(value = {}) {
  const asset = structuredClone(value);
  const pathExtension = fileExtension(asset.assetPath || asset.screenshotPath);
  const declaredExtension = cleanExtension(asset.sourceFormat);
  const pathFormat = assetFormatForExtension(pathExtension);
  const declaredFormat = assetFormatForExtension(declaredExtension);

  if (pathFormat && declaredFormat && pathFormat.id === declaredFormat.id && pathFormat.kind === asset.kind &&
      isReportedMimeCompatible(pathFormat, asset.mimeType)) {
    asset.sourceFormat = pathExtension;
    asset.mimeType = canonicalMimeType(pathFormat, asset.mimeType);
  }
  return asset;
}

export function normalizePortablePackageLexemes(value = {}) {
  const packageValue = structuredClone(value);
  packageValue.entries = (Array.isArray(packageValue.entries) ? packageValue.entries : []).map((entry) => ({
    ...entry,
    ...(Array.isArray(entry?.mediaAssets)
      ? { mediaAssets: entry.mediaAssets.map(normalizePortableMediaDescriptor) }
      : {}),
    ...(Array.isArray(entry?.visuals)
      ? { visuals: entry.visuals.map(normalizePortableMediaDescriptor) }
      : {})
  }));
  return packageValue;
}

function cleanExtension(value) {
  return String(value ?? "").trim().toLocaleLowerCase("en-US").replace(/^\./u, "");
}
