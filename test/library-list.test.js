import test from 'node:test';
import assert from 'node:assert/strict';
import { caseListMetadata } from '../extension/library-list.js';
import { sortLibraryCases, nextCaseSortMode } from '../extension/library-view.js';
import { normalizeUiPreferences, gallerySizesForZoom } from '../extension/preferences.js';

test('unknown and partial media sizes do not masquerade as zero or complete totals', () => {
  const entry = { title: '素材', mediaAssets: [
    { id: 'a', usage: 'content', byteSize: 100 }, { id: 'a', usage: 'content', byteSize: 100 },
    { id: 'b', usage: 'content' }, { id: 'poster', usage: 'poster', byteSize: 999 }
  ] };
  assert.equal(caseListMetadata(entry).size, null);
  assert.equal(caseListMetadata(entry).knownBytes, 100);
  assert.equal(caseListMetadata(entry).count, 2);
  entry.mediaAssets[2].byteSize = 200;
  assert.equal(caseListMetadata(entry).size, 300);
  assert.equal(caseListMetadata({ mediaAssets: [] }).size, null);
});

test('each header toggles both directions and sorting considers the entire input without mutating it', () => {
  const entries = Array.from({ length: 150 }, (_, n) => ({ id: String(n), title: `case ${n}`, savedAt: new Date(2026, 0, n + 1).toISOString() }));
  const before = structuredClone(entries);
  assert.equal(nextCaseSortMode('added-desc', 'title'), 'title');
  assert.equal(nextCaseSortMode('title', 'title'), 'title-desc');
  assert.equal(nextCaseSortMode('title-desc', 'title'), 'title');
  for (const column of ['title', 'added', 'updated', 'count', 'size', 'type', 'tags', 'source']) {
    const ascending = column === 'title' ? 'title' : `${column}-asc`;
    const descending = `${column}-desc`;
    const columnValues = e => Object.fromEntries(['count', 'size', 'type', 'tags', 'source'].map(k => [k, Number(e.id)]));
    assert.equal(sortLibraryCases(entries, { mode: ascending, columnValues })[0].id, '0');
    assert.equal(sortLibraryCases(entries, { mode: descending, columnValues })[0].id, '149');
  }
  assert.deepEqual(entries, before);
});

test('unknown metadata sorts last in either direction; ties preserve input order', () => {
  const entries = [{id:'missing'}, {id:'a',value:5}, {id:'b',value:5}, {id:'c',value:10}];
  const columnValues = e => ({size:e.value});
  assert.deepEqual(sortLibraryCases(entries,{mode:'size-asc',columnValues}).map(e=>e.id),['a','b','c','missing']);
  assert.deepEqual(sortLibraryCases(entries,{mode:'size-desc',columnValues}).map(e=>e.id),['c','a','b','missing']);
});

test('shared zoom maps both views around their established midpoint defaults', () => {
  assert.deepEqual(gallerySizesForZoom(0), {waterfall:140,list:32});
  assert.deepEqual(gallerySizesForZoom(50), {waterfall:270,list:48});
  assert.deepEqual(gallerySizesForZoom(100), {waterfall:480,list:80});
  const normalized = normalizeUiPreferences({galleryZoom:75,galleryHiddenColumns:['tags','title','bad','tags'],gallerySort:'size-desc'});
  assert.equal(normalized.galleryZoom,75);
  assert.deepEqual(normalized.galleryHiddenColumns,['tags']);
  assert.equal(normalized.gallerySort,'size-desc');
  assert.equal(normalizeUiPreferences({galleryZoom:NaN}).galleryZoom,50);
  assert.equal(normalizeUiPreferences({galleryView:'list',gallerySize:{list:48}}).galleryZoom,50);
  const migrated = normalizeUiPreferences({galleryView:'list',gallerySize:{list:72}});
  assert.equal(migrated.galleryZoom,88);
  assert.equal('gallerySize' in migrated,false);
});
