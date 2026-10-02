import { entryMediaAssets } from './media.js';
import { caseViewProjection } from './library-view.js';

export const LIST_COLUMNS = [
  ['title', '名称', 'minmax(100px, 2.5fr)'], ['type', '类型', 'minmax(48px, .8fr)'],
  ['count', '素材数', '48px'], ['tags', '标签', 'minmax(80px, 1.4fr)'],
  ['source', '来源', 'minmax(60px, 1fr)'], ['size', '大小', '76px'], ['added', '加入时间', '96px']
];

// Metadata only. Never read original blobs to fill a table cell or compare cases.
export function caseListMetadata(entry, { typeLabel = '', tagNames = [] } = {}) {
  const assets = [...new Map(entryMediaAssets(entry).filter(asset => asset.usage !== 'poster')
    .map(asset => [asset.id || asset, asset])).values()];
  const sizes = assets.map(asset => Number(asset.byteSize));
  const complete = assets.length > 0 && sizes.every(size => Number.isFinite(size) && size > 0);
  const knownBytes = sizes.reduce((sum, size) => sum + (Number.isFinite(size) && size > 0 ? size : 0), 0);
  const sources = [...new Set((entry.memberEntries?.length ? entry.memberEntries : [entry]).map(item => {
    try { return new URL(item.url).hostname.replace(/^www\./, ''); } catch { return ''; }
  }).filter(Boolean))].join(' · ');
  return { title: entry.title || '', type: typeLabel, count: assets.length,
    tags: [...new Set(tagNames)].join(' · '), source: sources,
    // Partial totals display explicitly, but cannot be ranked as complete sizes.
    size: complete ? knownBytes : null, knownBytes, added: caseViewProjection(entry).addedAt };
}

export function formatListBytes(bytes, locale) {
  if (!Number.isFinite(bytes) || bytes <= 0) return '—';
  const unit = Math.min(3, Math.floor(Math.log(bytes) / Math.log(1024)));
  return `${(bytes / 1024 ** unit).toLocaleString(locale, { maximumFractionDigits: unit ? 1 : 0 })} ${['B', 'KB', 'MB', 'GB'][unit]}`;
}

export function listColumnTemplate(hidden = []) {
  return LIST_COLUMNS.filter(([key]) => !hidden.includes(key)).map(([, , width]) => width).join(' ');
}
