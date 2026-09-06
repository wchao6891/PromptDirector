// Runs in the page world. Read public rendered data only; never open private projects.
export function collectLibTvPublicPayload(options = {}) {
  if (!/(^|\.)liblib\.tv$/u.test(location.hostname)) return null;
  const maxCandidates = Number(options.maxCandidates);
  const maxText = Number(options.maxTextCharacters);
  if (!Number.isSafeInteger(maxCandidates) || maxCandidates < 1 || !Number.isSafeInteger(maxText) || maxText < 1) return null;
  const records = new Map();
  let consumed = 0;
  const visit = value => {
    if (!value || typeof value !== "object" || records.size >= maxCandidates) return;
    if (value.templateUuid && value.finalOutput && (value.name || value.title)) {
      records.set(value.templateUuid, { id: value.templateUuid, projectUuid: value.projectUuid,
        title: value.name || value.title, description: value.description || "", author: value.nickname || "",
        url: value.finalOutput, posterUrl: value.coverUrl || "", likes: value.likeCount });
      return;
    }
    for (const child of Object.values(value)) visit(child);
  };
  // Next.js publishes the initial public feed as JSON frames. Parse data, never execute scripts.
  for (const script of document.querySelectorAll('script:not([src])')) {
    const text = script.textContent || "";
    if (!text.startsWith('self.__next_f.push(')) continue;
    consumed += text.length;
    if (consumed > maxText) break;
    try {
      const frame = JSON.parse(text.slice(text.indexOf('(') + 1, text.lastIndexOf(')')));
      if (typeof frame[1] !== "string") continue;
      for (const line of frame[1].split('\n')) {
        const value = line.slice(line.indexOf(':') + 1);
        if (value.startsWith('{') || value.startsWith('[')) {
          try { visit(JSON.parse(value)); } catch { /* Non-JSON transport records. */ }
        }
      }
    } catch { /* Incomplete hydration frames are not case data. */ }
  }
  const dialog = [...document.querySelectorAll('[role="dialog"]')].find(node => /只读模式|read.only mode/iu.test(node.innerText || ""));
  if (dialog?.querySelector('.react-flow__node')) {
    const project = [...records.values()].find(item => dialog.innerText.startsWith(item.title));
    const allNodes = [...dialog.querySelectorAll('.react-flow__node[data-id]')];
    const selected = allNodes.filter(node => node.classList.contains('selected'));
    const nodes = selected.length ? selected : allNodes;
    const items = nodes.slice(0, maxCandidates).flatMap(node => {
      const image = node.querySelector('img[src]');
      const video = node.querySelector('video');
      const url = video?.currentSrc || video?.src || image?.src || "";
      if (!url || url.startsWith('blob:')) return [];
      const prompt = node.querySelector('textarea,[data-prompt],[aria-label="提示词"],[aria-label="Prompt"]');
      return [{ id: `${project?.id || dialog.innerText.split('\n')[0]}:${node.dataset.id}`,
        title: node.querySelector('[data-nodeid] > div')?.textContent?.trim() || node.dataset.id,
        url, posterUrl: video?.poster || image?.src || "", author: project?.author || "",
        kind: node.classList.contains('react-flow__node-video') ? 'video' : 'image',
        prompt: String(prompt?.value || prompt?.getAttribute('data-prompt') || prompt?.textContent || "").slice(0, maxText),
        description: project?.title || "" }];
    });
    return { adapter: 'libtv', pageKind: 'feed', canonicalUrl: location.href, items, limited: nodes.length > maxCandidates };
  }
  const names = new Set([...document.querySelectorAll('main img[alt]')].map(image => image.alt));
  return { adapter: 'libtv', pageKind: 'feed', canonicalUrl: location.href,
    items: [...records.values()].filter(item => names.has(item.title)).map(item => ({ ...item, kind: 'video', prompt: '' })) };
}

export function normalizeLibTvPublicPayload(value) {
  let canonicalUrl;
  try {
    canonicalUrl = new URL(value.canonicalUrl);
    if (canonicalUrl.protocol !== 'https:' || !/(^|\.)liblib\.tv$/u.test(canonicalUrl.hostname)) return null;
  } catch { return null; }
  const originalUrl = (value, kind) => {
    try {
      const url = new URL(value);
      if (url.protocol !== 'https:' || url.hostname !== 'libtv-res.liblib.art') return '';
      const process = url.searchParams.get('x-oss-process') || '';
      if (kind === 'video' && !/\.(?:mp4|webm|mov)$/iu.test(url.pathname)) return '';
      if (/^(?:image\/|video\/snapshot)/u.test(process)) url.searchParams.delete('x-oss-process');
      return url.href;
    } catch { return ''; }
  };
  const candidates = (value.items || []).flatMap(item => {
    const kind = item.kind === 'image' ? 'image' : 'video';
    const url = originalUrl(item.url, kind);
    if (!item.id || !url) return [];
    const text = String(item.prompt || '').trim();
    return [{ id: `libtv:${item.id}`, adapter: 'libtv', pageType: kind === 'video' ? 'video' : 'artwork',
      canonicalUrl: canonicalUrl.href, title: String(item.title || item.id), contentText: text,
      excerpt: String(item.description || ''), completeness: value.limited ? 'partial' : 'complete',
      media: [{ id: `libtv:${item.id}:media`, kind, url, posterUrl: String(item.posterUrl || ''), placement: 'inline',
        sourceKind: 'site-original', sourceTitle: String(item.title || ''), sourceAuthor: String(item.author || ''),
        originalWorkUrl: canonicalUrl.href, captureMethod: 'source' }],
      extraction: { scope: 'document', method: 'structured' },
      sourceFacts: { provider: 'libtv', itemId: String(item.id), pageType: kind === 'video' ? 'video' : 'artwork',
        author: String(item.author || ''), description: String(item.description || ''), originalPromptAvailable: Boolean(text),
        engagement: Number.isFinite(item.likes) ? { likes: item.likes } : {}, extractionMethod: 'structured', status: 'complete' } }];
  });
  return { adapter: 'libtv', pageKind: 'feed', canonicalUrl: canonicalUrl.href, candidates,
    completeness: candidates.length && !value.limited ? 'complete' : 'partial' };
}
