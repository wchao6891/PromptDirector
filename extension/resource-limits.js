import { operationBudget } from './resource-policy.js';
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

// Numeric representation boundary only. Files, libraries and user input have no
// fixed product quota. Explicit limits belong to the actual destination or a
// measured operation; callers must not turn a transport/page size into a quota.
export const LIBRARY_TRANSFER_LIMITS = Object.freeze(Object.fromEntries([
  'maxArchiveBytes', 'maxFileCount', 'maxFileBytes', 'maxLibraryJsonBytes',
  'maxEntries', 'maxCollections', 'maxImageBytes', 'maxImagePixels', 'maxVideoBytes'
].map(key => [key, Number.MAX_SAFE_INTEGER])));

export function libraryTransferLimits(value = {}) {
  const limits = { ...LIBRARY_TRANSFER_LIMITS, ...value };
  if (Object.hasOwn(value, "maxFileBytes")) {
    for (const key of ["maxImageBytes", "maxVideoBytes"]) {
      if (!Object.hasOwn(value, key)) limits[key] = value.maxFileBytes;
    }
  }
  return portableLibraryLimits(limits);
}

export const SMART_VISUAL_MINIMUM_EDGE = 64;
export const MEDIA_FINGERPRINT_CHUNK_BYTES = 8 * MEBIBYTE;
export const PAGE_CAPTURE_LIMITS = Object.freeze({
  maxCandidates: 100,
  maxMediaPerCandidate: Number.MAX_SAFE_INTEGER,
  maxScrollSteps: 30,
  navigationTimeoutMs: 30_000,
  // Chrome JSON messages are limited to 64 MiB. Reserve half for complete
  // text, metadata and encoding overhead; this is one transport budget.
  maxInlinePixelDataCharacters: Math.min(Math.floor(operationBudget().maxTextBytes / 2), 32 * MEBIBYTE)
});

// Existing automatic review work budgets, independent of stored file or library
// capacity. They are application choices, not browser restrictions.
export const PAGE_CAPTURE_QUALITY_LIMITS = Object.freeze({
  maxRegionCandidates: 5,
  maxCandidateChoices: 10,
  maxCreativeSections: 5,
  maxPossibleOmissions: 5,
  minOrdinarySectionCharacters: 200
});

export function portableLibraryLimits(value = {}) {
  const result = {};
  for (const [key, fallback] of Object.entries(LIBRARY_TRANSFER_LIMITS)) {
    const candidate = Number(value?.[key]);
    result[key] = Number.isSafeInteger(candidate) && candidate > 0 ? candidate : fallback;
  }
  return result;
}

export function portableAssetByteLimit(kind, limitsValue = {}) {
  const limits = portableLibraryLimits(limitsValue);
  const key = kind === "image" ? "maxImageBytes" : kind === "video" ? "maxVideoBytes" : "maxFileBytes";
  return Object.hasOwn(limitsValue, "maxFileBytes") && !Object.hasOwn(limitsValue, key)
    ? limits.maxFileBytes : limits[key];
}

export function assertImageDimensions(width, height, limitsValue = {}) {
  const limits = portableLibraryLimits(limitsValue);
  const maxPixels = Math.min(limits.maxImagePixels, operationBudget(limitsValue.budget).maxImagePixels);
  const w = Number(width);
  const h = Number(height);
  if (!Number.isSafeInteger(w) || !Number.isSafeInteger(h) || w < 1 || h < 1) {
    throw assetImportError(
      ASSET_IMPORT_FAILURE_CODES.READ_OR_DECODE_FAILED,
      "无法读取有效的图片尺寸"
    );
  }
  if (!Number.isSafeInteger(w * h) || w * h > maxPixels) {
    throw assetImportError(
      ASSET_IMPORT_FAILURE_CODES.SAFETY_LIMIT_EXCEEDED,
      `图片像素超过本次解码预算（${formatCount(maxPixels)}），不能强制导入解码；原件可保留`,
      { maxPixels, actualPixels: w * h }
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
