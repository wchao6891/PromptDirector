import { t } from './i18n.js';

export function groupCuratedPreview(entries = []) {
  const byId = new Map(entries.map(entry => [entry.id, entry]));
  const claimed = new Set();
  return entries.flatMap(entry => {
    if (claimed.has(entry.id)) return [];
    const ids = (entry.compound?.memberEntryIds ?? []).filter(id => byId.has(id));
    if (!ids.length) return [entry];
    const members = ids.map(id => byId.get(id));
    ids.forEach(id => claimed.add(id));
    return [{ ...members[0], title: entry.compound.title, memberEntryIds: ids,
      text: members.map(member => `${member.title}\n${member.text}`).join('\n\n'),
      media: members.flatMap(member => (member.media ?? [member]).map(asset => ({ ...asset, title: member.title, text: asset.text || member.text, sourceUrl: member.sourceUrl }))) }];
  });
}

export function mountCuratedMediaGallery(container, entry, { image, video, onSelect = () => {} }) {
  if (!document.querySelector('link[data-curated-media-gallery]')) {
    const stylesheet = document.createElement('link'); stylesheet.rel = 'stylesheet'; stylesheet.href = new URL('./curated-media-gallery.css', import.meta.url).href; stylesheet.dataset.curatedMediaGallery = ''; document.head.append(stylesheet);
  }
  container.classList.add('curated-media-gallery-host');
  const media = entry.media?.length ? entry.media : [entry];
  const viewport = document.createElement('div'); viewport.className = 'curated-media-viewport';
  const controls = document.createElement('div'); controls.className = 'curated-media-navigation';
  const previous = document.createElement('button'), next = document.createElement('button'), count = document.createElement('span');
  previous.textContent = '‹'; previous.setAttribute('aria-label', t('上一份媒体'));
  next.textContent = '›'; next.setAttribute('aria-label', t('下一份媒体'));
  let index = 0, cleanup;
  const show = () => {
    cleanup?.(); viewport.replaceChildren();
    const selected = media[index];
    if (selected.mediaKind === 'video' && selected.videoUrl) { const player = video(selected); viewport.append(player.node); cleanup = player.destroy; }
    else { viewport.append(image(selected)); cleanup = undefined; }
    previous.disabled = index === 0; next.disabled = index === media.length - 1;
    count.textContent = `${index + 1} / ${media.length}`; onSelect(selected);
  };
  previous.onclick = () => { if (index > 0) { index--; show(); } };
  next.onclick = () => { if (index < media.length - 1) { index++; show(); } };
  controls.append(previous, count, next); controls.hidden = media.length < 2;
  container.append(viewport, controls); show();
  return () => cleanup?.();
}
