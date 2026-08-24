const MEBIBYTE = 1024 * 1024;

export const ASSET_IMPORT_FAILURE_CODES = Object.freeze({
  INVALID_FILE: "invalid_file",
  UNSUPPORTED_FORMAT: "unsupported_format",
  TOO_LARGE: "too_large",
  STORAGE_INSUFFICIENT: "storage_insufficient",
  SAFETY_LIMIT_EXCEEDED: "safety_limit_exceeded",
  READ_OR_DECODE_FAILED: "read_or_decode_failed",
  STORAGE_WRITE_FAILED: "storage_write_failed"
});

const FAILURE_CODE_VALUES = new Set(Object.values(ASSET_IMPORT_FAILURE_CODES));

export class AssetImportError extends Error {
  constructor(code, message, details = {}, options = {}) {
    super(String(message ?? "").trim() || "无法导入这个文件", options);
    this.name = "AssetImportError";
    this.code = FAILURE_CODE_VALUES.has(code) ? code : ASSET_IMPORT_FAILURE_CODES.READ_OR_DECODE_FAILED;
    this.reasonCode = this.code;
    this.details = normalizeFailureDetails(details);
    this.forceAllowed = this.code === ASSET_IMPORT_FAILURE_CODES.TOO_LARGE && this.details.forceAllowed === true;
  }
}

export function assetImportError(code, message, details = {}, options = {}) {
  return new AssetImportError(code, message, details, options);
}

export function isAssetImportError(value) {
  return value instanceof AssetImportError || (
    value instanceof Error && FAILURE_CODE_VALUES.has(value.code)
  );
}

export function importFailureDetails(value) {
  const error = isAssetImportError(value)
    ? value
    : assetImportError(
      ASSET_IMPORT_FAILURE_CODES.READ_OR_DECODE_FAILED,
      String(value?.message ?? value ?? "").trim() || "文件读取或解析失败"
    );
  return {
    code: error.code,
    message: error.message,
    ...normalizeFailureDetails(error.details),
    forceAllowed: error.forceAllowed === true
  };
}

export const PORTABLE_LIBRARY_LIMITS = Object.freeze({
  maxArchiveBytes: 128 * MEBIBYTE,
  maxFileCount: 4096,
  maxFileBytes: 16 * MEBIBYTE,
  maxLibraryJsonBytes: 16 * MEBIBYTE,
  maxEntries: 5000,
  maxCollections: 5000,
  maxImageBytes: 16 * MEBIBYTE,
  maxImagePixels: 40_000_000,
  maxVideoBytes: 128 * MEBIBYTE
});

export const SMART_VISUAL_SELECTION_LIMIT = 12;
export const SMART_VISUAL_MINIMUM_EDGE = 64;
export const PAGE_CAPTURE_LIMITS = Object.freeze({
  maxCandidates: 100,
  maxMediaPerCandidate: 24,
  maxScrollSteps: 30,
  navigationTimeoutMs: 30_000,
  maxInlinePixelDataCharacters: Math.ceil(PORTABLE_LIBRARY_LIMITS.maxImageBytes * 4 / 3) + 512
});

// Product limits confirmed for the local, non-AI page-capture review flow.
export const PAGE_CAPTURE_QUALITY_LIMITS = Object.freeze({
  maxRegionCandidates: 5,
  maxCandidateChoices: 10,
  maxCreativeSections: 5,
  maxPossibleOmissions: 5,
  maxContentTargetsPerCandidate: 200,
  minOrdinarySectionCharacters: 200
});

export function portableLibraryLimits(value = {}) {
  const result = {};
  for (const [key, fallback] of Object.entries(PORTABLE_LIBRARY_LIMITS)) {
    const candidate = Number(value?.[key]);
    result[key] = Number.isSafeInteger(candidate) && candidate > 0 ? candidate : fallback;
  }
  return result;
}

export function assertImageDimensions(width, height, limitsValue = {}) {
  const limits = portableLibraryLimits(limitsValue);
  const w = Number(width);
  const h = Number(height);
  if (!Number.isSafeInteger(w) || !Number.isSafeInteger(h) || w < 1 || h < 1) {
    throw assetImportError(
      ASSET_IMPORT_FAILURE_CODES.READ_OR_DECODE_FAILED,
      "无法读取有效的图片尺寸"
    );
  }
  if (w * h > limits.maxImagePixels) {
    throw assetImportError(
      ASSET_IMPORT_FAILURE_CODES.SAFETY_LIMIT_EXCEEDED,
      `图片像素超过 ${formatCount(limits.maxImagePixels)} 安全上限，不能强制导入`,
      { maxPixels: limits.maxImagePixels, actualPixels: w * h }
    );
  }
}

export function formatBytes(bytes) {
  const value = Number(bytes) || 0;
  return value >= MEBIBYTE
    ? `${Math.round(value / MEBIBYTE)} MiB`
    : `${Math.round(value / 1024)} KiB`;
}

function formatCount(value) {
  return Number(value).toLocaleString("en-US");
}

function normalizeFailureDetails(value) {
  if (!value || typeof value !== "object") return {};
  const result = {};
  for (const key of ["actualBytes", "maxBytes", "requiredBytes", "availableBytes", "actualPixels", "maxPixels"]) {
    const number = Number(value[key]);
    if (Number.isSafeInteger(number) && number >= 0) result[key] = number;
  }
  if (value.forceAllowed === true) result.forceAllowed = true;
  return result;
}
