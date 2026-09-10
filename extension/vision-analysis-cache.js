import { VISION_ANALYSIS_VERSION } from "./vision.js";
import { normalizeEntryVisuals } from "./visuals.js";

export function findPersistedVisionAnalysis(entries, options = {}) {
  const fingerprint = String(options.fingerprint ?? "").trim();
  const profileFingerprint = String(options.profileFingerprint ?? "").trim();
  const locale = options.locale === "en" ? "en" : "zh-CN";
  const catalogRevision = Number(options.catalogRevision);
  if (!fingerprint || !profileFingerprint || !Number.isFinite(catalogRevision)) return null;
  for (const entry of Array.isArray(entries) ? entries : []) {
    for (const visual of normalizeEntryVisuals(entry).visuals) {
      const analysis = visual.visionAnalysis;
      if (!analysis || Number(analysis.version) !== VISION_ANALYSIS_VERSION) continue;
      if (analysis.imageFingerprint !== fingerprint || analysis.profileFingerprint !== profileFingerprint) continue;
      if (analysis.locale !== locale || Number(analysis.catalogRevision) !== catalogRevision) continue;
      const complete = analysis.quality === "complete"
        && String(analysis.reconstructionPrompt ?? "").trim()
        && Array.isArray(analysis.tags)
        && analysis.tags.some((tag) =>
          String(tag?.g ?? "").trim() && String(tag?.t ?? "").trim()
        );
      if (complete) return structuredClone(analysis);
    }
  }
  return null;
}
