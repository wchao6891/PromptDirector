const MEBIBYTE = 1024 * 1024;

export const PORTABLE_LIBRARY_LIMITS = Object.freeze({
  maxArchiveBytes: 128 * MEBIBYTE,
  maxFileCount: 4096,
  maxFileBytes: 16 * MEBIBYTE,
  maxLibraryJsonBytes: 16 * MEBIBYTE,
  maxEntries: 5000,
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
    throw new Error("图片尺寸无效");
  }
  if (w * h > limits.maxImagePixels) {
    throw new Error(`图片像素超过 ${formatCount(limits.maxImagePixels)} 上限`);
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
