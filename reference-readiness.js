export function referenceHasPromptText(reference = {}) {
  return Boolean(
    clean(reference.originalText)
    || (["prompt", "prompt_vision"].includes(reference.referenceKind) && clean(reference.referenceText))
  );
}

export function referenceHasUsableLegacyDescription(reference = {}, asset = {}) {
  if (reference.referenceKind !== "vision" || !clean(reference.referenceText)) return false;
  const imageFingerprint = clean(asset.imageFingerprint);
  const analysisImageFingerprint = clean(asset.analysisImageFingerprint);
  return Number(asset.analysisVersion) >= 1 && imageFingerprint && analysisImageFingerprint &&
    imageFingerprint === analysisImageFingerprint;
}

export function hasCompleteReferenceAnalysis(asset = {}) {
  return Boolean(
    Number(asset.analysisVersion) === 2
    && clean(asset.analysisFingerprint)
    && clean(asset.reconstructionPrompt)
    && clean(asset.imageFingerprint)
    && clean(asset.imageFingerprint) === clean(asset.analysisImageFingerprint)
  );
}

function clean(value) {
  return String(value ?? "").trim();
}
