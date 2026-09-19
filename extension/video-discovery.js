// Count observed media resources per tab, never byte-range requests or segments.
export function videoResource(details) {
  if (!Number.isInteger(details.tabId) || details.tabId < 0 || details.statusCode >= 400) return null;
  let url;
  try { url = new URL(details.url); } catch { return null; }
  if (!/^https?:$/.test(url.protocol) || /\.(?:ts|m4s|aac|mp3)(?:$)/i.test(url.pathname)) return null;
  const mime = details.responseHeaders?.find(header => header.name.toLowerCase() === 'content-type')?.value?.split(';')[0].trim().toLowerCase() || '';
  const manifest = /\.(m3u8|mpd)$/i.test(url.pathname) || /mpegurl|dash\+xml/.test(mime);
  if (!manifest && !mime.startsWith('video/') && !/\.(mp4|webm|mov|m4v)$/i.test(url.pathname)) return null;
  const key = new URL(url);
  for (const name of ['range', 'bytestart', 'byteend']) key.searchParams.delete(name);
  key.hash = '';
  return { key: key.href, url: url.href, mimeType: mime, manifest };
}

export function installVideoDiscovery(chromeApi) {
  // Session storage survives worker sleep but never becomes a user's library asset.
  let pending = Promise.resolve();
  const run = work => { pending = pending.then(work).catch(error => console.warn('Video discovery:', error.message)); };
  const storageKey = tabId => `videoDiscovery:${tabId}`;
  const badge = (tabId, count) => chromeApi.action.setBadgeText({ tabId, text: count ? String(count) : '' });
  chromeApi.webRequest.onHeadersReceived.addListener(details => {
    const resource = videoResource(details);
    if (!resource) return;
    run(async () => {
      const key = storageKey(details.tabId);
      const stored = (await chromeApi.storage.session.get(key))[key] || [];
      const index = stored.findIndex(item => item.key === resource.key);
      if (index < 0) stored.push(resource); else stored[index] = resource;
      await chromeApi.storage.session.set({ [key]: stored });
      await badge(details.tabId, stored.length);
    });
  }, { urls: ['http://*/*', 'https://*/*'] }, ['responseHeaders']);
  chromeApi.tabs.onUpdated.addListener((tabId, change) => {
    if (!change.url && change.status !== 'loading') return;
    run(async () => { await chromeApi.storage.session.remove(storageKey(tabId)); await badge(tabId, 0); });
  });
  chromeApi.tabs.onRemoved.addListener(tabId => run(() => chromeApi.storage.session.remove(storageKey(tabId))));
  return async tabId => {
    await pending;
    return (await chromeApi.storage.session.get(storageKey(tabId)))[storageKey(tabId)] || [];
  };
}

export function addDiscoveredVideos(batch, resources) {
  if (batch?.candidates?.length !== 1) return batch;
  const candidate = batch.candidates[0];
  const media = [...(candidate.media || [])];
  const known = new Set(media.flatMap(item => [item.id, item.url, ...(item.variants || []).map(value => value.url)]));
  for (const resource of resources) {
    const id = `discovered:${resource.key}`;
    if (known.has(id) || known.has(resource.url)) continue;
    known.add(id);
    const hls = /\.m3u8(?:[?#]|$)/i.test(resource.url) || /mpegurl/i.test(resource.mimeType);
    media.push({ id, kind: 'video', url: resource.url, mimeType: resource.mimeType, placement: 'unplaced',
      ...(hls ? { streamUrl: resource.url } : {}) });
  }
  return { ...batch, candidates: [{ ...candidate, media }] };
}
