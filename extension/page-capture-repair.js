import { remapArticleDocumentAssets } from "./article-document.js";
import { markEntryTextChanged } from "./analysis-revision.js";

export function capturedMediaPrompts(candidate, assetIds, existing = []) {
  const prompts = existing.map(item => ({ ...item }));
  for (const media of candidate.media || []) {
    const assetId = assetIds.get(media.id);
    const text = String(media.originalPrompt || "").trim();
    if (!assetId || !text || prompts.some(item => item.assetId === assetId && item.source !== "ai-suggestion")) continue;
    prompts.push({ assetId, text, source: "webpage", textRevision: 1 });
  }
  return prompts;
}

function sourceUrls(media) {
  return new Set([media.url, media.sourceUrl, media.reference?.url, ...(media.variants || []).map(item => item.url)].filter(Boolean));
}

export function matchingCapturedAsset(entry, candidate, media) {
  const urls = sourceUrls(media);
  const assets = (entry.mediaAssets || []).filter(asset => asset.kind === media.kind && asset.usage !== "poster");
  const identical = media.contentHash && assets.find(asset => asset.contentHash === media.contentHash && asset.storageMode === "managed");
  if (identical) return identical;
  const direct = assets.filter(asset => [...sourceUrls(asset)].some(url => urls.has(url))
    && (!media.downloadDataUrl || asset.sourceTitle === media.filename));
  if (direct.length) return direct.find(asset => asset.storageMode === "managed") || direct[0];
  // A single published video can have been saved as its page link by an older capture.
  if (media.kind === "video" && candidate.media.filter(item => item.kind === "video").length === 1) {
    return assets.find(asset => asset.storageMode === "reference"
      && [asset.sourceUrl, asset.reference?.url].includes(candidate.canonicalUrl)) || null;
  }
  return null;
}

export async function planPageCaptureRepair(entry, candidate, hasBlob) {
  const pending = [];
  const matched = new Map();
  const assetIds = new Map();
  const obsoleteReferences = new Map();
  for (const media of candidate.media) {
    const asset = matchingCapturedAsset(entry, candidate, media);
    if (asset) matched.set(media.id, asset);
    if (asset?.storageMode === "managed" && await hasBlob(asset.id)) {
      assetIds.set(media.id, asset.id);
      if (candidate.pageType === "video" && media.kind === "video") {
        const urls = new Set([...sourceUrls(media), candidate.canonicalUrl]);
        for (const old of entry.mediaAssets || []) if (old.kind === "video" && old.storageMode === "reference"
          && [...sourceUrls(old)].some(url => urls.has(url))) obsoleteReferences.set(old.id, asset.id);
      }
    } else pending.push(media);
  }
  const promptsChanged = capturedMediaPrompts(candidate, assetIds, entry.mediaPrompts).length > (entry.mediaPrompts || []).length;
  // Only explicitly appended capture blocks may extend an existing case. A rescan
  // of the source body must not replace text the user already edited in the library.
  const textAdditions = [];
  let knownText = String(entry.text || "");
  for (const block of candidate.textBlocks || []) {
    const text = String(block.text || "").trim();
    if (!block.id?.startsWith("added:") || !text || knownText.includes(text)) continue;
    textAdditions.push({ ...block, text });
    knownText += `\n\n${text}`;
  }
  return { pending, matched, assetIds, obsoleteReferences, promptsChanged, textAdditions };
}

export function mergePageCaptureRepair(entry, candidate, plan, capturedAssets, assetIds) {
  const captured = new Map(capturedAssets.map(asset => [asset.id, asset]));
  const oldToNew = new Map(plan.obsoleteReferences);
  for (const [mediaId, old] of plan.matched) {
    const replacementId = assetIds.get(mediaId);
    const replacement = captured.get(replacementId);
    if (replacement?.storageMode !== "managed") continue;
    if (replacementId !== old.id) oldToNew.set(old.id, replacementId);
  }
  const assets = (entry.mediaAssets || []).filter(asset => {
    if (!oldToNew.has(asset.id)) return true;
    // Keep an explicitly annotated reference rather than collapsing distinct user work.
    return [entry.mediaPrompts, entry.videoAnalyses, entry.timeNotes].some(items => items?.some(item => item.assetId === asset.id));
  }).map(asset => captured.get(asset.id) || asset);
  for (const asset of captured.values()) if (!assets.some(item => item.id === asset.id)) assets.push(asset);
  const primary = assets.find(asset => asset.id === (oldToNew.get(entry.primaryMediaId) || entry.primaryMediaId));
  const preferred = candidate.pageType === "video"
    ? assets.find(asset => asset.kind === "video" && asset.storageMode === "managed") : null;
  const articleDocument = remapArticleDocumentAssets(entry.articleDocument, oldToNew);
  if (articleDocument) articleDocument.blocks = articleDocument.blocks.map(block => {
    if (block.assetId || !block.sourceUrl) return block;
    const media = candidate.media.find(item => item.url === block.sourceUrl
      && (!item.downloadDataUrl || item.filename === block.label));
    const assetId = media && assetIds.get(media.id);
    if (!assetId || !assets.some(asset => asset.id === assetId && asset.storageMode === "managed")) return block;
    return { ...block, kind: media.kind, assetId };
  });
  if (articleDocument) {
    const sourceBlocks = candidate.articleDocument?.blocks || [];
    for (const [index, block] of sourceBlocks.entries()) {
      const assetId = block.assetId && assetIds.get(block.assetId);
      if (!assetId || articleDocument.blocks.some(item => item.id === block.id || item.assetId === assetId)) continue;
      const next = sourceBlocks.slice(index + 1).find(item => articleDocument.blocks.some(saved => saved.id === item.id));
      const position = next ? articleDocument.blocks.findIndex(item => item.id === next.id) : articleDocument.blocks.length;
      articleDocument.blocks.splice(position, 0, { ...block, assetId });
    }
    articleDocument.blocks = articleDocument.blocks.map((block, sourceOrder) => ({ ...block, sourceOrder }));
  }
  const textAdditions = plan.textAdditions || [];
  if (articleDocument) {
    for (const block of textAdditions) {
      const source = candidate.articleDocument?.blocks?.find(item => item.id === `${block.id}:source` && item.kind === "link");
      const content = candidate.articleDocument?.blocks?.find(item => item.id === block.id && item.text === block.text)
        || { id: block.id, kind: "paragraph", text: block.text };
      for (const item of [source, content].filter(Boolean)) articleDocument.blocks.push({ ...item,
        sourceOrder: articleDocument.blocks.reduce((max, current) => Math.max(max, current.sourceOrder ?? 0), -1) + 1
      });
    }
  }
  const nextText = [entry.text, ...textAdditions.map(block => block.text)].filter(Boolean).join("\n\n");
  return {
    ...(textAdditions.length ? markEntryTextChanged(entry, nextText) : entry),
    mediaAssets: assets,
    mediaPrompts: capturedMediaPrompts(candidate, assetIds, entry.mediaPrompts),
    primaryMediaId: primary?.storageMode === "managed" ? primary.id : preferred?.id || primary?.id || entry.primaryMediaId,
    articleDocument,
    sourceFacts: { ...entry.sourceFacts, ...candidate.sourceFacts }
  };
}

export function pageCaptureMediaReceipt(candidate, assetIds, failedMediaIds = new Set()) {
  return {
    savedMediaIds: candidate.media.filter(media => assetIds.has(media.id) && !failedMediaIds.has(media.id)).map(media => media.id),
    pendingMediaIds: candidate.media.filter(media => failedMediaIds.has(media.id)).map(media => media.id)
  };
}
