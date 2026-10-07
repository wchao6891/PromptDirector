import test from 'node:test';
import assert from 'node:assert/strict';
import {createGalleryPreviewQueue, cardPreviewPriority, indexGalleryMedia} from '../extension/gallery-preview-queue.js';

function image(id, top = 0) {
  return {dataset: {visualId: id}, isConnected: true, getBoundingClientRect: () => ({top, bottom: top + 100})};
}
async function settle() {for (let i = 0; i < 12; i++) await Promise.resolve();}
function fixture() {
  const calls = [], releases = [], cache = new Map(); let active = 0, peak = 0;
  const loader = createGalleryPreviewQueue({concurrency: 2, cached: id => cache.get(id),
    priority: img => cardPreviewPriority(img, 900, 500),
    load: async id => {calls.push(id); active++; peak = Math.max(peak, active);
      await new Promise(resolve => releases.push(resolve)); active--; cache.set(id, `url:${id}`); return cache.get(id);}});
  return {loader, calls, releases, cache, peak: () => peak};
}

test('visible cards precede preload cards and ready previews bypass blocked cold decodes', async () => {
  const f = fixture();
  const runway = f.loader.request('runway', image('runway', 1200));
  const visible = f.loader.request('visible', image('visible', 0));
  const second = f.loader.request('second', image('second', 200));
  await settle(); assert.deepEqual(f.calls, ['visible', 'second']);
  f.cache.set('ready', 'url:ready');
  assert.equal(await f.loader.request('ready', image('ready')), 'url:ready');
  f.releases.splice(0).forEach(r => r()); await settle();
  assert.deepEqual(f.calls, ['visible', 'second', 'runway']);
  f.releases.splice(0).forEach(r => r()); await Promise.all([runway, visible, second]);
  assert.equal(f.peak(), 2);
});

test('recycling one consumer does not cancel another card requesting the same original', async () => {
  const f = fixture(), first = image('shared'), second = image('shared');
  const a = f.loader.request('shared', first), b = f.loader.request('shared', second);
  first.isConnected = false; f.loader.release(first);
  await settle(); assert.deepEqual(f.calls, ['shared']);
  f.releases.splice(0).forEach(r => r());
  assert.deepEqual(await Promise.all([a, b]), ['url:shared', 'url:shared']);
});

test('leaving the preload window cancels pending work; returning retries rather than showing an error', async () => {
  const f = fixture(), old = image('old', 950);
  const a = f.loader.request('a', image('a')), b = f.loader.request('b', image('b'));
  const pending = f.loader.request('old', old); await settle();
  old.getBoundingClientRect = () => ({top: 8000, bottom: 8100}); f.loader.refresh();
  assert.equal(await pending, undefined);
  old.getBoundingClientRect = () => ({top: 100, bottom: 200});
  const returned = f.loader.request('old', old);
  f.releases.splice(0).forEach(r => r()); await settle();
  assert.deepEqual(f.calls, ['a', 'b', 'old']);
  f.releases.splice(0).forEach(r => r()); await Promise.all([a, b, returned]);
});

test('rejected preview releases its slot and can be requested again', async () => {
  let attempts = 0;
  const loader = createGalleryPreviewQueue({concurrency: 1, cached: () => null, priority: () => 0,
    load: async () => {if (++attempts === 1) throw Error('missing original'); return 'ready';}});
  await assert.rejects(loader.request('one', image('one')), /missing original/);
  assert.equal(await loader.request('one', image('one')), 'ready');
});

test('video lookup keeps the stored member identity for a compound display case', () => {
  const asset = {id: 'video', kind: 'video'};
  const map = indexGalleryMedia([{id: 'member', mediaAssets: [asset]}, {id: 'other', mediaAssets: [asset]}], entry => entry.mediaAssets);
  assert.equal(map.get('video').entryId, 'member');
  assert.equal(map.get('video').asset, asset);
});
