import { articleDocumentText } from './article-document.js';

// Runs in the source tab. Only explicit, same-origin GET detail references are
// read; no clicks, scripts, form submission, navigation or recursive crawling.
export async function collectGenericCaptureDetails(requests, options) {
  const results = [], pending = [...requests], controller = new AbortController();
  let stopped = false, done = 0;
  const cancel = (message, _sender, reply) => {
    if (message?.type !== 'PROMPTDIRECTOR_PAGE_CAPTURE' || message.sessionId !== options.sessionId || message.action !== 'cancel') return;
    stopped = true; controller.abort(); reply({ ok: true }); return false;
  };
  const runtime = globalThis.chrome?.runtime;
  runtime?.onMessage?.addListener(cancel);
  const clean = value => String(value || '').replace(/\s+/g, ' ').trim();
  const url = (value, base) => {
    if (!value) return '';
    try { const parsed = new URL(value, base); return /^https?:$/.test(parsed.protocol) ? parsed.href : ''; } catch { return ''; }
  };
  try {
    await Promise.all(Array.from({ length: Math.min(options.concurrency, pending.length) }, async () => {
      while (pending.length && !stopped) {
        const request = pending.shift();
        const abort = new AbortController();
        const onAbort = () => abort.abort();
        controller.signal.addEventListener('abort', onAbort, { once: true });
        // A slow page fails alone; only access refusals stop the whole batch.
        let timedOut = false;
        const timer = setTimeout(() => { timedOut = true; abort.abort(); }, options.timeoutMs);
        try {
          if (new URL(request.url).origin !== location.origin) throw new Error('详情不在当前网站');
          const response = await fetch(request.url, { credentials: 'same-origin', redirect: 'error', signal: abort.signal,
            headers: request.fragment ? { 'HX-Request': 'true' } : {} });
          if ([401, 403, 429].includes(response.status)) { stopped = true; controller.abort(); }
          if (!response.ok || !/text\/html|application\/xhtml\+xml/i.test(response.headers.get('content-type') || '')) throw new Error('详情暂时不可读取');
          const reader = response.body.getReader(), chunks = []; let bytes = 0;
          while (true) {
            const { value, done } = await reader.read(); if (done) break;
            bytes += value.byteLength;
            if (bytes > options.maxBytes) { await reader.cancel(); throw new Error('详情超过本次读取预算'); }
            chunks.push(value);
          }
          const decoder = new TextDecoder();
          const html = chunks.map(chunk => decoder.decode(chunk, { stream: true })).join('') + decoder.decode();
          const doc = new DOMParser().parseFromString(html, 'text/html');
          // Some sites make the complete original itself a click-to-copy control.
          // Keep that material before removing UI controls and their labels.
          for (const button of doc.querySelectorAll('button')) {
            const originals = [...button.querySelectorAll('pre,code,video')].filter(node => !node.parentElement.closest('pre,code,video'));
            if (originals.length) button.replaceWith(...originals);
          }
          for (const node of doc.querySelectorAll('script,style,template,noscript,nav,footer,form,button,input,[hidden],[aria-hidden="true"]')) node.remove();
          const root = request.fragment ? doc.body : doc.querySelector('article,main,[role="main"]');
          if (!root) throw new Error('未找到详情正文');
          const sources = new Set(request.sources);
          const detailMedia = [...root.querySelectorAll('img,video')].filter(node =>
            !node.closest('[role="navigation"]') && !/^(?:avatar|logo|icon)$/i.test(clean(node.getAttribute('alt'))));
          const sourceValues = node => [...new Set([node, ...node.querySelectorAll('source')].flatMap(item =>
            ['src', 'data-src', 'poster'].map(attr => item.hasAttribute(attr) ? url(item.getAttribute(attr), request.url) : '')).filter(Boolean))];
          const principal = detailMedia[0];
          let matchedSources = principal ? sourceValues(principal).filter(source => sources.has(source)) : [];
          // A canonical work page may omit poster= while its thumbnail embeds the
          // complete video asset name. Use that exact name relation only for its
          // principal video; a recommendation elsewhere never establishes identity.
          if (!matchedSources.length && principal?.matches('video')
            && url(doc.querySelector('link[rel="canonical"]')?.getAttribute('href'), request.url) === request.url) {
            const videos = sourceValues(principal);
            matchedSources = [...sources].filter(source => videos.some(video => {
              const imageUrl = new URL(source), videoUrl = new URL(video);
              if (imageUrl.origin !== videoUrl.origin) return false;
              const stem = value => decodeURIComponent(value.pathname.split('/').pop()).replace(/\.[^.]+$/, '');
              const imageName = stem(imageUrl), videoName = stem(videoUrl);
              return videoName && (imageName === videoName || imageName.endsWith(`-${videoName}`));
            }));
          }
          if (!matchedSources.length) throw new Error('无法确认详情对应当前媒体');
          let media;
          if (principal.matches('video')) {
            const variants = [...new Set([principal, ...principal.querySelectorAll('source')].flatMap(node =>
              ['src', 'data-src'].map(attr => url(node.getAttribute(attr), request.url))).filter(Boolean))]
              .map(source => ({ url: source, sourceKind: 'video-element' }));
            if (!variants.length) throw new Error('详情视频尚未提供可读取的原件地址');
            media = { kind: 'video', url: variants[0].url, variants,
              posterUrl: url(principal.getAttribute('poster'), request.url), captureMethod: 'source', sourceKind: 'video-element',
              ...(/\.m3u8(?:[?#]|$)/i.test(variants[0].url) ? { streamUrl: variants[0].url } : {}) };
          }
          const promptHeading = [...root.querySelectorAll('h1,h2,h3,h4,h5,h6,[role="heading"]')]
            .find(node => /^(?:original prompt|prompt(?: it)?|原始提示词|提示词)[:：]?$/i.test(clean(node.textContent)));
          const promptParts = [];
          const originalParts = [];
          for (let node = promptHeading?.nextElementSibling; node; node = node.nextElementSibling) {
            if (node.matches('h1,h2,h3,h4,h5,h6,[role="heading"],dl,table') || node.querySelector('h1,h2,h3,h4,h5,h6,[role="heading"]')) break;
            for (const original of node.matches('pre,code') ? [node] : node.querySelectorAll('pre,code')) {
              if (!original.parentElement.closest('pre,code')) originalParts.push((original.textContent || '').replace(/\r\n?/g, '\n').trim());
            }
            const text = (node.textContent || '').replace(/\r\n?/g, '\n').trim();
            if (text) promptParts.push(text);
          }
          const originalPrompt = (originalParts.length ? originalParts : promptParts).join('\n\n');
          // Preserve prose in unsemantic layouts as well as paragraphs and credits.
          for (const node of root.querySelectorAll('div,section')) {
            if (clean(node.textContent) && !node.querySelector('div,section,p,h1,h2,h3,h4,h5,h6,ul,ol,dl,blockquote,pre,code,table')) {
              const p = doc.createElement('p'); p.innerHTML = node.innerHTML; node.replaceWith(p);
            }
          }
          const title = clean(root.querySelector('h1,h2,[role="heading"]')?.textContent);
          const blocks = [];
          for (const node of root.querySelectorAll('h1,h2,h3,h4,h5,h6,p,li,dt,dd,blockquote,pre,figcaption,td,th')) {
            if (node.parentElement?.closest('p,li,blockquote,pre,td,th')) continue;
            const text = node.matches('pre') ? (node.textContent || '').replace(/\r\n?/g, '\n').trim() : clean(node.textContent);
            // Card detail titles are captions, not new article section boundaries.
            if (text) blocks.push({ kind: 'paragraph', text });
          }
          let originalWorkUrl = '';
          for (const link of root.querySelectorAll('a[href]')) {
            const sourceUrl = url(link.getAttribute('href'), request.url);
            if (!sourceUrl || link.getAttribute('href').startsWith('#')) continue;
            const label = clean(link.textContent || link.title || link.getAttribute('aria-label') || link.querySelector('[title]')?.getAttribute('title') || link.getAttribute('download')) || sourceUrl;
            const context = clean(link.closest('li,dd,p')?.textContent);
            if (/original source|original work|原始来源|原作|原始作品/i.test(context || label)) originalWorkUrl ||= sourceUrl;
            blocks.push({ kind: 'link', sourceUrl, label });
          }
          if (!blocks.length) throw new Error('详情没有可读取的文字');
          results.push({ url: request.url, title, blocks, originalWorkUrl, matchedSources, ...(media ? { media } : {}), ...(originalPrompt ? { originalPrompt } : {}) });
        } catch (error) {
          results.push({ url: request.url, error: timedOut ? '详情读取超时' : stopped ? '详情读取已停止' : error.message });
        } finally {
          clearTimeout(timer); controller.signal.removeEventListener('abort', onAbort); done++;
          runtime?.sendMessage({ type: 'PAGE_CAPTURE_CHANGED', sessionId: options.sessionId, requestId: options.requestId,
            phase: 'details', detailDone: done, detailTotal: requests.length })?.catch(() => {});
        }
      }
    }));
    for (const request of pending) results.push({ url: request.url, error: '详情尚未读取' });
    return results;
  } finally { runtime?.onMessage?.removeListener(cancel); }
}

export function genericDetailRequests(snapshot) {
  const byUrl = new Map();
  if (snapshot?.adapter !== 'generic') return [];
  for (const candidate of snapshot.candidates || []) for (const media of candidate.media || []) {
    for (const request of media.detailRequests || []) {
      const previous = byUrl.get(request.url);
      const sources = [media.url, media.posterUrl, ...(media.variants || []).map(v => v.url)].filter(Boolean);
      byUrl.set(request.url, { ...request, sources: [...new Set([...(previous?.sources || []), ...sources])] });
    }
  }
  return [...byUrl.values()];
}

export function applyGenericCaptureDetails(snapshot, results) {
  if (snapshot?.adapter !== 'generic') return snapshot;
  const byUrl = new Map(results.map(result => [result.url, result]));
  const mediaSources = item => [item.url, item.posterUrl, ...(item.variants || []).map(v => v.url)].filter(Boolean);
  // A detail page belongs to the medium it shows, not to every thumbnail that
  // links there; each verified detail is attached once.
  const owners = new Map();
  for (const candidate of snapshot.candidates) for (const item of candidate.media) for (const request of item.detailRequests || []) {
    const detail = byUrl.get(request.url);
    if (!detail || detail.error) continue;
    const matched = new Set(detail.matchedSources || []);
    const own = !matched.size || mediaSources(item).some(source => matched.has(source));
    if (own && !owners.has(request.url)) owners.set(request.url, item.id);
  }
  return { ...snapshot, candidates: snapshot.candidates.map(candidate => {
    const extraByAsset = new Map(), warnings = [];
    const media = candidate.media.map(item => {
      const details = (item.detailRequests || []).map(request => byUrl.get(request.url)).filter(Boolean);
      const success = details.filter(detail => !detail.error && owners.get(detail.url) === item.id);
      for (const detail of details.filter(detail => detail.error)) warnings.push({ id: `detail-warning:${item.id}:${warnings.length}`, kind: 'section',
        text: `${item.alt || candidate.title}：${detail.error}（${detail.url}）` });
      const blocks = success.flatMap(detail => [
        ...detail.blocks, { kind: 'link', label: '案例详情', sourceUrl: detail.url }
      ]);
      extraByAsset.set(item.id, blocks);
      const upgraded = success.find(detail => detail.media)?.media;
      return { ...item, ...(upgraded ? { ...upgraded, width: 0, height: 0, dataUrl: '', previewDataUrl: '' } : {}),
        ...(success.find(detail => detail.originalPrompt) ? { originalPrompt: success.find(detail => detail.originalPrompt).originalPrompt } : {}),
        sourceTitle: success[0]?.title || item.sourceTitle,
        originalWorkUrl: success.find(detail => detail.originalWorkUrl)?.originalWorkUrl || item.originalWorkUrl, detailBlockIds: [] };
    });
    const mediaById = new Map(media.map(item => [item.id, item]));
    const sourceBlocks = [...(candidate.articleDocument?.blocks || [])];
    for (const item of media) if (extraByAsset.get(item.id)?.length && !sourceBlocks.some(block => block.assetId === item.id)) {
      sourceBlocks.push({ id: `detail-media:${item.id}`, kind: item.kind, assetId: item.id, sourceUrl: item.url });
    }
    const blocks = sourceBlocks.flatMap(block => {
      const extra = (extraByAsset.get(block.assetId) || []).map((detail, index) => ({ ...detail, id: `${block.id}:detail:${index}` }));
      mediaById.get(block.assetId)?.detailBlockIds.push(...extra.map(detail => detail.id));
      const asset = mediaById.get(block.assetId);
      return [asset ? { ...block, kind: asset.kind, sourceUrl: asset.url,
        ...(asset.posterUrl ? { posterUrl: asset.posterUrl } : {}) } : block, ...extra];
    }).map((block, sourceOrder) => ({ ...block, sourceOrder }));
    const articleDocument = { version: 1, blocks };
    return { ...candidate, media, articleDocument,
      ...(media.some(item => item.originalPrompt) ? { sourceFacts: { ...candidate.sourceFacts, originalPromptAvailable: true } } : {}),
      ...(media.some(item => item.kind === 'video') ? { pageType: 'video' } : {}),
      contentText: articleDocumentText(articleDocument),
      textBlocks: blocks.filter(block => block.text).map(block => ({ id: block.id, kind: 'section', text: block.text, sourceOrder: block.sourceOrder })),
      possibleOmissions: [...(candidate.possibleOmissions || []), ...warnings],
      completeness: warnings.length ? 'partial' : candidate.completeness };
  }) };
}

// Detail reading rebuilds text blocks from the article document, whose IDs can
// differ from the scanned blocks (one list block instead of one per item).
// Carry the user's text choice over so selected content is never dropped.
export function remapDetailTextSelection(before, after, selection) {
  const selected = new Set(selection.selectedTextBlockIds || []);
  const oldIds = new Set(before.textBlocks.map(block => block.id));
  const allSelected = !Array.isArray(selection.selectedTextBlockIds) || before.textBlocks.every(block => selected.has(block.id));
  const selectedTexts = before.textBlocks.filter(block => selected.has(block.id)).map(block => block.text).filter(Boolean);
  const detailIds = new Set(after.media.flatMap(item => item.detailBlockIds || []));
  const selectedDetails = new Set(after.media.filter(item => selection.selectedMediaIds.includes(item.id)).flatMap(item => item.detailBlockIds || []));
  // No initial prose is different from explicitly excluding existing prose:
  // checking "read details" adds the first text for a media-only selection.
  const includeText = selection.includeText || !before.textBlocks.length;
  const selectedTextBlockIds = after.textBlocks.filter(block => {
    if (!includeText) return false;
    if (detailIds.has(block.id)) return selectedDetails.has(block.id);
    if (allSelected || selected.has(block.id)) return true;
    return !oldIds.has(block.id) && selectedTexts.some(text => block.text.includes(text));
  }).map(block => block.id);
  return { ...selection, includeText, selectedTextBlockIds };
}
