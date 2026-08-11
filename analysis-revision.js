export function entryTextRevision(entry = {}) {
  return Math.max(1, Math.floor(Number(entry.textRevision) || 1));
}

export function analyzedTextRevision(entry = {}) {
  if (!hasPriorTextAnalysis(entry)) return 0;
  return Math.max(1, Math.floor(Number(entry.analysisMeta?.textRevision) || 1));
}

export function textAnalysisReason(entry = {}) {
  const text = String(entry.text ?? "").trim();
  if (!entry.id || !text) return "";
  const analyzedRevision = analyzedTextRevision(entry);
  if (!analyzedRevision) return "missing_analysis";
  return analyzedRevision === entryTextRevision(entry) ? "" : "text_changed";
}

export function markEntryTextChanged(entryValue = {}, nextTextValue) {
  const previousText = String(entryValue.text ?? "");
  const nextText = String(nextTextValue ?? "");
  if (previousText === nextText) return { ...entryValue, text: nextText };
  return {
    ...entryValue,
    text: nextText,
    textRevision: entryTextRevision(entryValue) + 1
  };
}

export function updateEntryText(entryValue = {}, nextTextValue, expectedRevisionValue) {
  const expectedRevision = Number(expectedRevisionValue);
  if (!Number.isInteger(expectedRevision) || expectedRevision < 1) throw new Error("提示词版本无效，请刷新后重试");
  if (expectedRevision !== entryTextRevision(entryValue)) {
    throw new Error("提示词已在其他页面修改，请刷新后重试");
  }
  const nextText = String(nextTextValue ?? "").trim();
  const hasMedia = Array.isArray(entryValue.mediaAssets) && entryValue.mediaAssets.some((asset) => asset?.usage !== "poster") ||
    Array.isArray(entryValue.visuals) && entryValue.visuals.length > 0 || entryValue.hasScreenshot === true;
  if (!nextText && !hasMedia) throw new Error("纯文字案例的提示词不能为空");
  return markEntryTextChanged(entryValue, nextText);
}

export function analysisRevisionMeta(entry = {}) {
  return { textRevision: entryTextRevision(entry) };
}

export function hasPriorTextAnalysis(entry = {}) {
  if (entry.analysisMeta && typeof entry.analysisMeta === "object") return true;
  if (String(entry.analyzedAt ?? "").trim()) return true;
  return [...(entry.facetAssignments ?? []), ...(entry.analysisCandidates ?? [])]
    .some((item) => item?.source === "deepseek_text");
}
