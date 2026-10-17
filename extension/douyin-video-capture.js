// Runs in MAIN. Read the selected player's own data; never infer ownership from
// another video resource loaded by a recommendation or a neighboring slide.
export function collectDouyinVideoPayload() {
  const page = new URL(location.href);
  if (!/(^|\.)douyin\.com$/u.test(page.hostname)) return null;
  const itemId = page.searchParams.get('modal_id') || page.pathname.match(/^\/video\/(\d+)/u)?.[1];
  if (!/^\d+$/u.test(itemId || '')) return null;
  const canonicalUrl = `https://www.douyin.com/video/${itemId}`;
  const roots = [];
  const target = document.querySelector(`.video_${itemId}`);
  const players = target ? [target] : [...document.querySelectorAll('video')];
  for (let node of players) {
    while (node) {
      for (const key of Object.keys(node)) {
        if (key.startsWith('__reactProps')) roots.push(node[key]);
        if (key.startsWith('__reactFiber')) {
          for (let fiber = node[key]; fiber; fiber = fiber.return) roots.push(fiber.memoizedProps);
        }
      }
      node = node.parentElement;
    }
  }
  // Render payloads cover server-rendered pages, including pages without React.
  for (const name of ['SSR_RENDER_DATA', '_ROUTER_DATA', '__NEXT_DATA__']) {
    if (window[name] && typeof window[name] === 'object') roots.push(window[name]);
  }
  for (const script of document.querySelectorAll('script#RENDER_DATA,script#__NEXT_DATA__')) {
    try { roots.push(JSON.parse(script.textContent)); }
    catch { try { roots.push(JSON.parse(decodeURIComponent(script.textContent))); } catch { /* Not JSON. */ } }
  }
  const seen = new Set();
  let item;
  for (const root of roots) {
    const queue = [root];
    while (queue.length) {
      const value = queue.pop();
      if (!value || typeof value !== 'object' || seen.has(value) || value === window || (typeof Node !== 'undefined' && value instanceof Node)) continue;
      seen.add(value);
      if (String(value.aweme_id || value.awemeId || value.id || '') === itemId && value.video) { item = value; break; }
      for (const [key, child] of Object.entries(value)) {
        if (!['_owner', '_store', 'return', 'sibling', 'stateNode', 'child', 'ref'].includes(key) && child && typeof child === 'object') queue.push(child);
      }
    }
    if (item) break;
  }
  const urls = value => {
    if (typeof value === 'string') return /^https?:\/\//u.test(value) ? [value] : [];
    if (Array.isArray(value)) return value.flatMap(urls);
    return value && typeof value === 'object' ? urls(value.url_list || value.urlList || value.src || value.url || []) : [];
  };
  const video = item?.video || {};
  const formats = [
    // The top-level dimensions can describe the uploaded master while its
    // default playback URL is only 1080p. Rank the dimensions of each format.
    { ...video, width: video.play_addr?.width || video.playAddr?.width || 0,
      height: video.play_addr?.height || video.playAddr?.height || 0,
      playAddr: video.play_addr || video.playAddr, isH265: false },
    ...(video.bit_rate || video.bitRateList || []).map(format => ({ ...format, playAddr: format.play_addr || format.playAddr }))
  ].flatMap(format => {
    const sources = urls(format.playAddr);
    if (!sources.length) return [];
    return [{ urls: [...new Set(sources)], width: Number(format.width || format.play_addr?.width) || 0,
      height: Number(format.height || format.play_addr?.height) || 0,
      bitrate: Number(format.bit_rate || format.bitRate) || 0,
      hevc: Boolean(format.is_h265 || format.isH265),
      // DASH entries are separate video tracks, not complete original files.
      separate: Boolean(format.format === 'dash' || format.videoFormat === 'dash' || sources.some(url => /\/media-video-/u.test(url))) }];
  }).filter(format => !format.separate).sort((a, b) => b.width * b.height - a.width * a.height || Number(a.hevc) - Number(b.hevc) || b.bitrate - a.bitrate);
  const author = item?.author || item?.authorInfo || {};
  const stats = item?.statistics || item?.stats || {};
  const description = String(item?.desc || document.querySelector('h1')?.textContent || '').trim();
  return { adapter: 'douyin', itemId, canonicalUrl, resolved: Boolean(item), title: description || document.title.replace(/\s*-\s*抖音$/u, ''),
    description, author: author.nickname || author.nickName || '', posterUrl: urls(video.origin_cover || video.originCover || video.cover)[0] || '',
    duration: Number(video.duration) / 1000 || 0, formats,
    engagement: { views: stats.play_count ?? stats.playCount, likes: stats.digg_count ?? stats.diggCount,
      comments: stats.comment_count ?? stats.commentCount, shares: stats.share_count ?? stats.shareCount,
      favorites: stats.collect_count ?? stats.collectCount } };
}
