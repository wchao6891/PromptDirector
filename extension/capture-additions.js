import { normalizePageCaptureCandidate, pageCaptureMediaIdentity } from "./page-capture.js";

// Add only new material. Existing block IDs and selection decisions remain authoritative.
export function appendCaptureCandidate(candidate, addition, selection) {
  const textBlocks = [...candidate.textBlocks];
  const media = [...candidate.media];
  const blocks = [...(candidate.articleDocument?.blocks || [])];
  const textIds = new Set(selection.selectedTextBlockIds || (selection.includeText ? textBlocks.map(b => b.id) : []));
  const mediaIds = new Set(selection.selectedMediaIds);
  const knownTexts = new Set(textBlocks.map(b => b.text.trim()));
  const remapped = new Map();
  for (const item of addition.textBlocks || []) {
    if (knownTexts.has(item.text.trim())) continue;
    knownTexts.add(item.text.trim());
    const block = { ...item, id: `added:${addition.id}:${item.id}`, sourceOrder: textBlocks.length };
    textBlocks.push(block);
    textIds.add(block.id);
    remapped.set(item.id, block.id);
  }
  for (const item of addition.media || []) {
    const existing = media.find(m => m.id === item.id || item.localAssetId && m.localAssetId === item.localAssetId
      || item.contentHash && m.contentHash === item.contentHash
      || item.url && m.url && pageCaptureMediaIdentity(item.url) === pageCaptureMediaIdentity(m.url));
    if (existing) { remapped.set(item.id, existing.id); continue; }
    const added = { ...item, id: `added:${addition.id}:${item.id}`, placement: "inline" };
    media.push(added);
    mediaIds.add(added.id);
    remapped.set(item.id, added.id);
  }
  const newTextBlocks = textBlocks.slice(candidate.textBlocks.length);
  for (const item of addition.articleDocument?.blocks || []) {
    if (item.assetId) {
      const assetId = remapped.get(item.assetId);
      if (assetId && !blocks.some(b => b.assetId === assetId)) blocks.push({ ...item, id: `added:${addition.id}:${item.id}`, assetId });
    } else if (item.text && newTextBlocks.some(b => comparableText(b.text).includes(comparableText(item.text)))) {
      blocks.push({ ...item, id: remapped.get(item.id) || `added:${addition.id}:${item.id}` });
    }
  }
  for (const item of textBlocks) {
    const articleText = comparableText(blocks.map(b => b.text || "").join("\n"));
    if (!articleText.includes(comparableText(item.text))) blocks.push({ ...item, kind: "paragraph" });
  }
  const merged = normalizePageCaptureCandidate({ ...candidate, textBlocks: textBlocks.map(b => ({ ...b, kind: "section" })), contentText: textBlocks.map(b => b.text).join("\n\n"),
    media, articleDocument: { version: 1, blocks: blocks.map((b, sourceOrder) => ({ ...b, sourceOrder })) } });
  return { candidate: merged, selection: { ...selection, mediaDecision: mediaIds.size ? "confirmed" : selection.mediaDecision, selectedTextBlockIds: [...textIds], selectedMediaIds: [...mediaIds] } };
}

export function draftCaptureAddition(draft, consumed = new Set()) {
  const fragments = draft.fragments.filter(f => !consumed.has(`text:${f.id}`));
  const visuals = draft.visuals.filter(v => !consumed.has(`image:${v.id}`));
  const textBlocks = fragments.map(f => ({ id: f.id, text: f.text, kind: "paragraph", relevance: "explicit-creative", html: "" }));
  return { id: draft.id, canonicalUrl: "", title: draft.title, textBlocks,
    media: visuals.map(v => ({ id: v.id, localAssetId: v.id, kind: "image", placement: "inline", url: "",
      contentHash: v.contentHash, mimeType: v.mimeType, width: v.width, height: v.height, sourceTitle: v.sourceTitle, originalWorkUrl: v.originalWorkUrl || v.sourceUrl })),
    articleDocument: { version: 1, blocks: [...textBlocks, ...visuals.map(v => ({ id: `image:${v.id}`, kind: "image", assetId: v.id }))] },
    consumed: [...fragments.map(f => `text:${f.id}`), ...visuals.map(v => `image:${v.id}`)] };
}

// Remove only draft material represented in the successful save. Excluded or undone items stay pending.
export function savedDraftCaptureItems(draft, candidates, consumed) {
  const blocks = candidates.flatMap(c => c.textBlocks);
  const media = candidates.flatMap(c => c.media);
  return [
    ...draft.fragments.filter(f => consumed.has(`text:${f.id}`) && blocks.some(b =>
      b.id === `added:${draft.id}:${f.id}` || b.text.trim() === f.text.trim())).map(f => ({ kind: "text", id: f.id })),
    ...draft.visuals.filter(v => consumed.has(`image:${v.id}`) && media.some(m =>
      m.localAssetId === v.id || v.contentHash && m.contentHash === v.contentHash)).map(v => ({ kind: "image", id: v.id }))
  ];
}

function comparableText(value) {
  return String(value || "").replace(/\s+/gu, " ").trim();
}

export function savedPageCaptureCandidateIds(batch, candidates, results) {
  const persisted = results.filter(item => item.entryId && ["saved", "partial", "duplicate"].includes(item.status));
  if (batch.captureMode === "list" && batch.saveMode === "combined" && persisted.length === 1) {
    return new Set(candidates.map(candidate => candidate.id));
  }
  return new Set(persisted.map(item => item.candidateId));
}
