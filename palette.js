export const PALETTE_VERSION = 2;

const EDGE_RATIO = 0.03;
const MINIMUM_EDGE_PIXELS = 2;
const NEUTRAL_CHANNEL_SPREAD = 12;
const DARK_LUMINANCE_LIMIT = 12;
const LIGHT_LUMINANCE_LIMIT = 243;
const MINIMUM_EDGE_SHARE = 0.8;
const MAXIMUM_INTERIOR_SHARE = 0.01;

export function extractPalette(imageData, maximumColors = 7) {
  const data = imageData?.data;
  if (!data || !Number.isFinite(imageData.width) || !Number.isFinite(imageData.height)) return [];
  const bins = new Map();
  const pixelCount = Math.max(1, imageData.width * imageData.height);
  const stride = Math.max(1, Math.floor(Math.sqrt(pixelCount / 32_000)));
  const edgeSize = Math.max(MINIMUM_EDGE_PIXELS, Math.ceil(Math.min(imageData.width, imageData.height) * EDGE_RATIO));
  let sampledCount = 0;
  for (let pixel = 0; pixel < pixelCount; pixel += stride) {
    const offset = pixel * 4;
    if (data[offset + 3] < 180) continue;
    sampledCount += 1;
    const x = pixel % imageData.width;
    const y = Math.floor(pixel / imageData.width);
    const atEdge = x < edgeSize || x >= imageData.width - edgeSize || y < edgeSize || y >= imageData.height - edgeSize;
    const r = quantize(data[offset]);
    const g = quantize(data[offset + 1]);
    const b = quantize(data[offset + 2]);
    const key = `${r},${g},${b}`;
    const bin = bins.get(key) ?? { rgb: [r, g, b], count: 0, edgeCount: 0 };
    bin.count += 1;
    if (atEdge) bin.edgeCount += 1;
    bins.set(key, bin);
  }
  const originalCandidates = [...bins.values()].sort((left, right) => right.count - left.count);
  const cleanedCandidates = originalCandidates.filter((candidate) => !isEdgeNeutralNoise(candidate, sampledCount));
  const candidates = cleanedCandidates.length ? cleanedCandidates : originalCandidates;
  const selected = [];
  for (const candidate of candidates) {
    if (selected.some((item) => colorDistance(item.rgb, candidate.rgb) < 54)) continue;
    selected.push(candidate);
    if (selected.length >= Math.max(1, Math.min(7, maximumColors))) break;
  }
  if (selected.length < Math.min(5, candidates.length)) {
    for (const candidate of candidates) {
      if (selected.includes(candidate)) continue;
      selected.push(candidate);
      if (selected.length >= Math.min(5, candidates.length)) break;
    }
  }
  return selected.map((item) => rgbToHex(item.rgb));
}

function isEdgeNeutralNoise(candidate, sampledCount) {
  const [r, g, b] = candidate.rgb;
  const spread = Math.max(r, g, b) - Math.min(r, g, b);
  const luminance = (r + g + b) / 3;
  const extremeNeutral = spread <= NEUTRAL_CHANNEL_SPREAD
    && (luminance <= DARK_LUMINANCE_LIMIT || luminance >= LIGHT_LUMINANCE_LIMIT);
  if (!extremeNeutral || !candidate.count || !sampledCount) return false;
  const edgeShare = candidate.edgeCount / candidate.count;
  const interiorShare = (candidate.count - candidate.edgeCount) / sampledCount;
  return edgeShare >= MINIMUM_EDGE_SHARE && interiorShare < MAXIMUM_INTERIOR_SHARE;
}

function quantize(value) {
  return Math.min(255, (value >> 4) * 16 + 8);
}

function colorDistance(left, right) {
  return Math.hypot(left[0] - right[0], left[1] - right[1], left[2] - right[2]);
}

function rgbToHex(rgb) {
  return `#${rgb.map((value) => Math.round(value).toString(16).padStart(2, "0")).join("")}`.toUpperCase();
}
