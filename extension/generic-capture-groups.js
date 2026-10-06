import { normalizeArticleDocument, articleDocumentText } from './article-document.js';

// Explicit grouping of unadapted pages only. Automatic capture and specialized
// prompt/article adapters do not use these boundaries.
export function groupGenericCapture(candidate, mode) {
  if (candidate?.adapter !== 'generic' || !['sections', 'media'].includes(mode)) return [candidate];
  const document = normalizeArticleDocument(candidate.articleDocument);
  const blocks = document?.blocks || [];
  const media = candidate.media || [];
  const owned = new Set(blocks.flatMap(b => (b.rows || []).flatMap(row => row.flatMap(cell => cell.blockIds))));
  const top = blocks.filter(b => !owned.has(b.id));
  const byId = new Map(blocks.map(b => [b.id, b]));
  const expand = parts => parts.flatMap(b => [b, ...(b.rows || []).flatMap(row => row.flatMap(cell => cell.blockIds.map(id => byId.get(id)).filter(Boolean)))]);
  const mediaIds = new Set(media.map(m => m.id));
  const hasMedia = parts => expand(parts).some(b => mediaIds.has(b.assetId));
  const groups = [];
  const usedBlocks = new Set(), usedMedia = new Set();

  if (mode === 'sections') {
    for (let level = 1; level <= 6; level++) {
      const starts = top.flatMap((b, i) => b.kind === 'heading' && b.level === level ? [i] : []);
      if (starts.length < 2) continue;
      // A parent heading also closes a section: never attach the next chapter's
      // introduction to the preceding nested heading.
      const ranges = starts.map(start => {
        let end = start + 1;
        while (end < top.length && !(top[end].kind === 'heading' && top[end].level <= level)) end++;
        return top.slice(start, end);
      });
      if (ranges.filter(hasMedia).length < 2) continue;
      for (const parts of ranges) {
        const expanded = expand(parts);
        if (!hasMedia(parts)) continue;
        const ids = new Set(expanded.map(b => b.assetId).filter(Boolean));
        add(parts[0].text, expanded, media.filter(m => ids.has(m.id)), `section:${parts[0].id}`);
      }
      break;
    }
    // No reliable boundary is a usable whole case, not a capture failure.
    if (!groups.length) return [candidate];
  } else {
    const sectionFor = new Map();
    const stack = [];
    for (const block of top) {
      if (block.kind === 'heading') {
        while (stack.length && stack.at(-1).level >= block.level) stack.pop();
        stack.push(block);
      }
      for (const part of expand([block])) if (part.assetId) sectionFor.set(part.assetId, [...new Set([...(sectionFor.get(part.assetId) || []), ...stack.map(b => b.text)])]);
    }
    for (const item of media.filter(m => ['image', 'video'].includes(m.kind) && !m.isCover)) {
      const occurrences = blocks.filter(b => b.assetId === item.id);
      // A shared original is one standalone case. Its section references remain
      // available in section mode, with one copy of each detail in media mode.
      const detailIds = new Set(item.detailBlockIds || []);
      const detailBlocks = blocks.filter(b => detailIds.has(b.id));
      const seenDetails = new Set();
      const parts = [...occurrences.slice(0, 1), ...detailBlocks.filter(b => {
        const key = JSON.stringify([b.kind, b.text, b.sourceUrl]);
        if (seenDetails.has(key)) return false;
        seenDetails.add(key); return true;
      })];
      for (const block of [...occurrences, ...detailBlocks]) usedBlocks.add(block.id);
      const names = sectionFor.get(item.id) || [];
      const title = [...names.filter(name => name !== candidate.title), item.sourceTitle || item.alt || item.filename || candidate.title].filter(Boolean).join(' · ');
      // Keep only explicitly paired text. Nearby prose is not necessarily the
      // caption or prompt for this image; it remains in the unassigned group.
      if (item.originalPrompt) parts.push({ id: `prompt:${item.id}`, kind: 'paragraph', text: item.originalPrompt });
      if (!parts.some(b => b.assetId)) parts.push({ id: `media:${item.id}`, kind: item.kind, assetId: item.id, sourceUrl: item.url });
      add(title, parts, [item], `media:${item.id}`);
    }
    if (!groups.length) return [candidate];
  }

  const remainingBlocks = blocks.filter(b => !usedBlocks.has(b.id));
  const remainingMedia = media.filter(m => !usedMedia.has(m.id));
  // Unplaced assets, attachments, tables and shared prose are never silently
  // removed by a grouping operation. They remain separately selectable.
  if (remainingBlocks.length || remainingMedia.length || candidate.possibleOmissions?.length || candidate.supplements?.length || !document && candidate.contentText) {
    const remainder = !document && candidate.contentText
      ? [{ id: `body:${candidate.id}`, kind: 'paragraph', text: candidate.contentText }]
      : remainingBlocks;
    add(`未分组内容 · ${candidate.title}`, remainder, remainingMedia, 'remainder', true);
  }
  return groups;

  function add(title, parts, assets, identity, review = false) {
    const articleDocument = normalizeArticleDocument({ blocks: parts.map((b, sourceOrder) => ({ ...b, sourceOrder })) });
    const contentText = articleDocumentText(articleDocument);
    for (const block of parts) usedBlocks.add(block.id);
    for (const asset of assets) usedMedia.add(asset.id);
    const blockIds = new Set(parts.map(b => b.id)), assetIds = new Set(assets.map(m => m.id));
    groups.push({
      ...candidate, id: `${candidate.id}:${identity}`, title, pageType: 'article',
      contentText, contentHtml: '', excerpt: '', articleDocument,
      // Section-kind blocks bypass prompt-ranking and retain even short titles.
      textBlocks: (articleDocument?.blocks || []).filter(b => b.text && !owned.has(b.id))
        .map(b => ({ id: b.id, kind: 'section', text: b.text, sourceOrder: b.sourceOrder })),
      media: assets, batchStructureStatus: review ? 'review' : 'matched',
      sourceFacts: { ...candidate.sourceFacts, itemId: `${candidate.sourceFacts?.itemId || candidate.id}:${identity}` },
      region: candidate.region ? { ...candidate.region, contentTargets: (candidate.region.contentTargets || []).filter(target =>
        target.articleBlockIds?.some(id => blockIds.has(id)) || target.mediaIds?.some(id => assetIds.has(id))) } : null,
      // The original warnings/supplements remain visible on the remainder.
      possibleOmissions: review ? candidate.possibleOmissions || [] : [], supplements: review ? candidate.supplements || [] : []
    });
  }
}

// Removes the clicked preview block. Scanned text blocks may be one per list
// item while the document holds one list block, and repeated text must remove
// the clicked occurrence, so text is matched by ID first, then by ordered run.
export function removeCaptureTextBlock(candidate, blockId) {
  const articleBlocks = candidate.articleDocument?.blocks || [];
  const textBlocks = candidate.textBlocks || [];
  const removed = new Set(textBlocks.some(b => b.id === blockId) ? [blockId] : []);
  const block = articleBlocks.find(b => b.id === blockId);
  if (!removed.size && block?.text) {
    const squash = value => String(value || '').replace(/\s+/g, '');
    const target = squash(block.text);
    const articleIds = new Set(articleBlocks.map(b => b.id));
    const unlinked = textBlocks.filter(b => !articleIds.has(b.id)).toSorted((a, b) => (a.sourceOrder ?? 0) - (b.sourceOrder ?? 0));
    const occurrence = articleBlocks.filter(b => !textBlocks.some(t => t.id === b.id) && squash(b.text) === target
      && b.sourceOrder < block.sourceOrder).length;
    const runs = [];
    for (let start = 0; start < unlinked.length; start++) {
      let joined = '';
      for (let end = start; end < unlinked.length; end++) {
        joined += squash(unlinked[end].text);
        if (!target.startsWith(joined)) break;
        if (joined === target) { runs.push(unlinked.slice(start, end + 1)); start = end; break; }
      }
    }
    for (const item of runs[Math.min(occurrence, runs.length - 1)] || []) removed.add(item.id);
  }
  const kept = textBlocks.filter(b => !removed.has(b.id));
  return { ...candidate, contentHtml: '', textBlocks: kept, contentText: kept.map(b => b.text).join('\n\n'),
    articleDocument: candidate.articleDocument ? { ...candidate.articleDocument, blocks: articleBlocks.filter(b => b.id !== blockId) } : candidate.articleDocument };
}
