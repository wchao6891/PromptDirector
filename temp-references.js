import { detectLocalMediaFile, extractLocalDocumentText } from "./local-media.js";

export const TEMP_REFERENCE_SOURCE_TYPES = Object.freeze({
  library: "library",
  temporary: "temporary"
});

export const TEMP_REFERENCE_FILE_ACCEPT = Object.freeze([
  ".png", ".jpg", ".jpeg", ".webp", ".gif", ".pdf", ".txt", ".md", ".html"
].join(","));

export function composerPasteFiles(transfer) {
  const files = Array.from(transfer?.files ?? []).filter((item) => item instanceof File);
  if (files.length) return files;
  return Array.from(transfer?.items ?? []).flatMap((item) => {
    if (item?.kind !== "file") return [];
    const file = item.getAsFile?.();
    return file instanceof File ? [file] : [];
  });
}

export function namePastedTempReferenceFile(file, fallbackName = "pasted-file") {
  if (!(file instanceof File) || fileExtension(file.name)) return file;
  const extension = ({
    "image/png": "png",
    "image/jpeg": "jpg",
    "image/webp": "webp",
    "image/gif": "gif",
    "application/pdf": "pdf",
    "text/plain": "txt",
    "text/markdown": "md",
    "text/html": "html"
  })[String(file.type ?? "").toLocaleLowerCase("en-US")];
  if (!extension) return file;
  const base = String(fallbackName ?? "").trim().replace(/[^a-z0-9_-]+/giu, "-") || "pasted-file";
  return new File([file], `${base}.${extension}`, { type: file.type, lastModified: file.lastModified });
}

export function validateTempReferenceFile(file) {
  try {
    return detectLocalMediaFile(file, { allowVideo: false });
  } catch (error) {
    if (error?.message === "暂不支持这种文件格式") {
      throw new Error("仅支持 PNG、JPEG、WebP、GIF、PDF、TXT、MD 和 HTML");
    }
    throw error;
  }
}

export function createTempReference({ file, assetId, referenceId, alias, extractedText = "" } = {}) {
  const format = validateTempReferenceFile(file);
  const normalizedAssetId = String(assetId ?? "").trim();
  const normalizedReferenceId = String(referenceId ?? "").trim();
  const normalizedAlias = String(alias ?? "").trim();
  if (!normalizedAssetId || !normalizedReferenceId || !normalizedAlias) throw new Error("临时引用缺少有效编号");
  const assetRef = {
    assetId: normalizedAssetId,
    kind: format.kind,
    mimeType: format.mimeType,
    name: file.name,
    byteSize: file.size
  };
  return {
    entryId: normalizedReferenceId,
    alias: normalizedAlias,
    title: file.name,
    sourceType: TEMP_REFERENCE_SOURCE_TYPES.temporary,
    referenceKind: format.kind === "image" ? "reference" : "prompt",
    referenceText: String(extractedText ?? "").trim(),
    originalText: String(extractedText ?? "").trim(),
    assetRefs: [assetRef],
    imageRefs: format.kind === "image"
      ? [{ visualId: normalizedAssetId, mimeType: format.mimeType }]
      : []
  };
}

export async function extractTempReferenceText(file, options = {}) {
  const format = validateTempReferenceFile(file);
  if (format.kind !== "document") return "";
  return extractLocalDocumentText(file, {
    extension: format.extension,
    parseHtml: options.parseHtml,
    extractPdfText: options.extractPdfText
  });
}

export function imageTempReferenceBlock(referenceSnapshots, service) {
  const imageCount = (Array.isArray(referenceSnapshots) ? referenceSnapshots : []).reduce((count, reference) => {
    return count + unreadReferenceImageAssets(reference).length;
  }, 0);
  const blocked = Boolean(imageCount && service?.vision !== true);
  return {
    blocked,
    imageCount,
    choices: blocked ? ["chooseVisionService", "analyzeImages", "cancel"] : []
  };
}

export function unreadReferenceImageAssets(reference) {
  const analyzedAssets = new Map((Array.isArray(reference?.assets) ? reference.assets : [])
    .map((item) => [String(item?.assetId ?? "").trim(), item]));
  const promptBacked = Boolean(
    String(reference?.originalText ?? "").trim()
    || (["prompt", "prompt_vision"].includes(reference?.referenceKind)
      && String(reference?.referenceText ?? "").trim())
  );
  if (promptBacked || (String(reference?.referenceText ?? "").trim() && !analyzedAssets.size)) return [];
  const assets = [];
  const seen = new Set();
  for (const asset of Array.isArray(reference?.assetRefs) ? reference.assetRefs : []) {
    const assetId = String(asset?.assetId ?? "").trim();
    if (asset?.kind !== "image" || !assetId || seen.has(assetId)) continue;
    if (hasCompleteReferenceAnalysis(analyzedAssets.get(assetId))) continue;
    seen.add(assetId);
    assets.push({ ...asset, assetId });
  }
  for (const image of Array.isArray(reference?.imageRefs) ? reference.imageRefs : []) {
    const assetId = String(image?.visualId ?? "").trim();
    if (!assetId || seen.has(assetId)) continue;
    if (hasCompleteReferenceAnalysis(analyzedAssets.get(assetId))) continue;
    seen.add(assetId);
    assets.push({
      assetId,
      kind: "image",
      mimeType: String(image?.mimeType ?? "").trim(),
      name: String(reference?.title ?? "").trim()
    });
  }
  return assets;
}

function hasCompleteReferenceAnalysis(value) {
  return Boolean(value
    && Number(value.analysisVersion) === 2
    && String(value.analysisFingerprint ?? "").trim()
    && String(value.reconstructionPrompt ?? "").trim()
    && String(value.imageFingerprint ?? "").trim()
    && value.imageFingerprint === value.analysisImageFingerprint);
}

export function tempReferenceAssetIds(reference) {
  if (reference?.sourceType !== TEMP_REFERENCE_SOURCE_TYPES.temporary) return [];
  return [...new Set((Array.isArray(reference.assetRefs) ? reference.assetRefs : [])
    .map((asset) => String(asset?.assetId ?? "").trim())
    .filter(Boolean))];
}

function fileExtension(name) {
  const match = String(name ?? "").trim().toLocaleLowerCase("en-US").match(/\.([a-z0-9]+)$/u);
  return match?.[1] ?? "";
}
