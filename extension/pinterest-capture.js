import { collectPageCaptureSitePayload, normalizePageCaptureSitePayload } from './page-capture-site-adapters.js';
import { PAGE_CAPTURE_LIMITS, PORTABLE_LIBRARY_LIMITS } from './resource-limits.js';

// Read each work, not the board's metadata. Keep the candidate/media identities
// so selections and manually chosen media remain attached to the same work.
export async function enrichPinterestCandidates(snapshot, { cache = new Map(), cancelled = () => false, readHtml } = {}) {
  if (snapshot.adapter !== 'pinterest') return snapshot;
  const fetchHtml = readHtml || readPinterestHtml;
  const candidates = [];
  for (const candidate of snapshot.candidates || []) {
    if (cancelled()) {
      candidates.push({ ...candidate, completeness: 'partial', sourceFacts: { ...candidate.sourceFacts, status: 'partial', metadataError: '作品元信息补读已停止' } });
      continue;
    }
    const url = candidate.canonicalUrl;
    if (!/^https:\/\/(?:www\.)?pinterest\.com\/pin\/(?:[^/]*--)?\d+\/?(?:\?.*)?$/u.test(url || '')) {
      candidates.push(candidate); continue;
    }
    try {
      let detail = cache.get(url);
      if (!detail) {
        const html = await fetchHtml(url);
        const payload = collectPageCaptureSitePayload({ pinterestUrl: url, pinterestHtml: html,
          maxCandidates: 1, maxMedia: PAGE_CAPTURE_LIMITS.maxMediaPerCandidate,
          maxTextCharacters: PORTABLE_LIBRARY_LIMITS.maxLibraryJsonBytes });
        detail = normalizePageCaptureSitePayload(payload, url);
        if (!detail?.sourceFacts?.itemId || !payload?.pin?.entityId) throw new Error('作品详情元信息尚未取得');
        if (!payload.pin.title && !detail.contentText) detail = { ...detail, title: candidate.title };
        cache.set(url, detail);
      }
      candidates.push({ ...candidate, title: detail.title,
        contentText: candidate.contentText || detail.contentText,
        sourceFacts: { ...candidate.sourceFacts, ...detail.sourceFacts,
          engagement: { ...detail.sourceFacts.engagement, ...candidate.sourceFacts?.engagement } },
        media: (candidate.media || []).map(media => ({ ...media, sourceTitle: detail.title })) });
    } catch (error) {
      candidates.push({ ...candidate, completeness: 'partial',
        sourceFacts: { ...candidate.sourceFacts, status: 'partial', metadataError: String(error.message || error) } });
    }
  }
  return { ...snapshot, candidates };
}

export async function readPinterestHtml(url) {
  const response = await fetch(url, { credentials: 'omit', redirect: 'error',
    referrerPolicy: 'no-referrer', signal: AbortSignal.timeout(PAGE_CAPTURE_LIMITS.navigationTimeoutMs) });
  if (!response.ok) throw new Error(`作品详情读取失败（HTTP ${response.status}）`);
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let size = 0;
  let html = '';
  try {
    for (;;) {
      const {done, value} = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > PORTABLE_LIBRARY_LIMITS.maxLibraryJsonBytes) throw new Error('作品详情超出读取上限');
      html += decoder.decode(value, {stream:true});
    }
    return html + decoder.decode();
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
}
