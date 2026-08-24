import { VISION_ANALYSIS_VERSION } from "./vision.js";
import { normalizeEntryVisuals } from "./visuals.js";

export function findPersistedVisionAnalysis(entries, options = {}) {
  const fingerprint = String(options.fingerprint ?? "").trim();
  const profileFingerprint = String(options.profileFingerprint ?? "").trim();
  const locale = options.locale === "en" ? "en" : "zh-CN";
  const catalogRevision = Number(options.catalogRevision);
  if (!fingerprint || !profileFingerprint || !Number.isFinite(catalogRevision)) return null;
  let partial = null;
  for (const entry of Array.isArray(entries) ? entries : []) {
    for (const visual of normalizeEntryVisuals(entry).visuals) {
      const analysis = visual.visionAnalysis;
      if (!analysis || Number(analysis.version) !== VISION_ANALYSIS_VERSION) continue;
      if (analysis.imageFingerprint !== fingerprint || analysis.profileFingerprint !== profileFingerprint) continue;
      if (analysis.locale !== locale || Number(analysis.catalogRevision) !== catalogRevision) continue;
      if (analysis.quality === "complete") return structuredClone(analysis);
      if (analysis.quality === "partial") partial = structuredClone(analysis);
    }
  }
  return partial;
}
