import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import { ResourceUrlCache } from '../extension/resource-url-cache.js';
import * as queueModule from '../extension/gallery-preview-queue.js';
const source = await readFile(new URL('../extension/library.js', import.meta.url), 'utf8');
const functions = source.slice(source.indexOf('async function hydrateCardImage('), source.indexOf('function renderContentFilters('));
const dimensions = source.slice(source.indexOf('function imageDimensions('), source.indexOf('function discoveryVisualId('));
function image(id, top = 0) {
  const wrap = {style: {}, classList: {add() {}}};
  return {dataset: {visualId: id}, src: '', isConnected: true, closest: () => wrap,
    getBoundingClientRect: () => ({top, bottom: top + 100}), wrap};
}
function fixture({cached = false, animated = false, width = 4000, height = 3000, pauseDecode = false, indexedDimensions = true, orientedHeight = null, video = false} = {}) {
  let scans = 0, reads = 0, decodes = 0, derivedReads = 0;
  const decodeOptions = [], releases = [], canvases = [];
  const entries = Array.from({length: 10000}, (_, i) => ({id: `case-${i}`, get mediaAssets() {
    scans++; return [{id: `image-${i}`, kind: video ? 'video' : 'image', ...(indexedDimensions ? {width, height} : {})}];
  }}));
  const original = new Blob(['original'], {type: 'image/png'});
  const thumb = new Blob(['preview'], {type: 'image/webp'});
  const derived = new Map();
  const thumbnailUrls = new ResourceUrlCache({maxBytes: 1024 * 1024, protectedValue: () => false});
  const context = {Blob, console, Promise, Map, WeakMap, Set, Math, Number,
    window: {innerHeight: 900}, logicalCases: entries, galleryMediaById: new Map(), thumbnailUrls,
    thumbnailRequests: new WeakMap(),
    imageDerivedMetadata: new Map(), imageDerivedMetadataLoaded: true,
    getDerivedMedia: async id => {derivedReads++; return derived.get(id) || (cached ? {thumbnail: thumb, animated} : null);},
    screenshotBlob: async () => {reads++; return original;}, imageNeedsOriginalPlayback: async () => animated,
    saveDerivedMedia: async (id, value) => {derived.set(id, value); return value;}, getDerivedMetadata: async () => null,
    saveDerivedMetadata: async (id, value) => value, readImageDimensions: async () => ({width, height}), assertImageDimensions() {},
    LIBRARY_TRANSFER_LIMITS: {maxImageBytes: Infinity}, PAGE_CAPTURE_LIMITS: {navigationTimeoutMs: 30000}, formatBytes: String,
    getMediaBlob: async () => {reads++; return new Blob(['video'], {type: 'video/mp4'});},
    readVideoMedia: async () => {decodes++; return {metadata: {width, height}, poster: {blob: thumb}};},
    createImageBitmap: async (blob, options) => {decodes++; decodeOptions.push(options); if (pauseDecode) await new Promise(r => releases.push(r));
      return {width: options?.resizeWidth ?? width, height: orientedHeight ?? (options?.resizeWidth ? Math.ceil(height * options.resizeWidth / width) : height), close() {}};},
    document: {createElement: () => {const canvas = {getContext: () => ({drawImage() {}})}; canvases.push(canvas); return canvas;}}, canvasBlob: async () => thumb,
    showPreviewError: img => {img.error = true;}, chrome: {runtime: {sendMessage: async () => {throw Error('unexpected video');}}}
  };
  vm.createContext(context); vm.runInContext(functions + '\n' + dimensions, context);
  if (queueModule) {
    context.galleryMediaById = queueModule.indexGalleryMedia(entries, entry => entry.mediaAssets);
    context.thumbnailLoader = queueModule.createGalleryPreviewQueue({concurrency: 2,
      load: id => context.createThumbnailUrl(id), cached: id => thumbnailUrls.get(id),
      priority: img => queueModule.cardPreviewPriority(img, 900, 500)});
  }
  scans = 0;
  return {context, thumbnailUrls, original, releases, decodeOptions, canvases,
    counts: () => ({scans, reads, decodes, derivedReads})};
}
async function settle() {for (let i = 0; i < 40; i++) await Promise.resolve();}

test('fast scrolling stops disconnected pending originals from delaying the current card', async () => {
  const f = fixture({pauseDecode: true});
  const old = Array.from({length: 48}, (_, i) => image(`image-${i}`, 950));
  const pending = old.map(img => f.context.hydrateCardImage(img));
  await settle();
  assert.equal(f.releases.length, 2);
  old.forEach(img => {img.isConnected = false;});
  const current = image('image-9999');
  pending.push(f.context.hydrateCardImage(current));
  for (let i = 0; i < 60; i++) {f.releases.splice(0).forEach(r => r()); await settle();}
  await Promise.all(pending);
  assert.ok(current.src);
  assert.ok(f.counts().reads <= 3, `obsolete originals still read: ${f.counts().reads}`);
  assert.ok(old.every(img => !img.error));
});

test('thumbnail requests use media identity lookup instead of scanning ten thousand cases per image', async () => {
  const f = fixture({cached: true});
  await f.context.createThumbnailUrl('image-9999');
  assert.equal(f.counts().scans, 0);
});

test('a small imported video project prepares previews without editing cases or rebuilding loaded cards', async () => {
  const f = fixture({video: true, width: 480, height: 270, indexedDimensions: false});
  const cards = Array.from({length: 13}, (_, i) => image(`image-${i}`));
  await Promise.all(cards.map(card => f.context.hydrateCardImage(card)));
  assert.ok(cards.every(card => card.src && !card.error), 'every visible imported video needs a preview');
  assert.ok(cards.every(card => card.wrap.style.aspectRatio === '480 / 270'));
  const urls = cards.map(card => card.src), before = f.counts();
  for (let i = 0; i < cards.length; i++) {
    const returned = image(`image-${i}`); await f.context.hydrateCardImage(returned);
    assert.equal(returned.src, urls[i]);
  }
  assert.deepEqual(f.counts(), before, 'return must reuse video previews without preparing posters again');
  f.thumbnailUrls.clear();
  await f.context.hydrateCardImage(image('image-0'));
  assert.equal(f.counts().reads, before.reads, 'persisted video preview survives URL cache eviction');
  assert.equal(f.counts().decodes, before.decodes);
});

test('minimum grid keeps hundreds of visited previews ready after cards are recycled', async () => {
  const f = fixture({cached: true});
  for (let i = 0; i < 300; i++) await f.context.hydrateCardImage(image(`image-${i}`));
  const first = f.thumbnailUrls.get('image-0'), before = f.counts();
  const returned = image('image-0');
  await f.context.hydrateCardImage(returned);
  assert.equal(returned.src, first);
  assert.deepEqual(f.counts(), before, 'returning to a loaded card must not reread storage or decode again');
});

test('large static originals decode to existing preview size and reserve ratio before decode completes', async () => {
  const f = fixture({pauseDecode: true, indexedDimensions: false});
  const card = image('image-1');
  const pending = f.context.hydrateCardImage(card);
  await settle();
  assert.equal(card.wrap.style.aspectRatio, '4000 / 3000');
  assert.equal(f.decodeOptions[0]?.resizeWidth, 640);
  assert.equal(f.decodeOptions[0]?.resizeHeight, undefined);
  f.releases.splice(0).forEach(r => r());
  await pending;
});

test('animated originals retain playback rather than being replaced by still cached thumbnails', async () => {
  const f = fixture({cached: true, animated: true});
  const card = image('image-1'); await f.context.hydrateCardImage(card);
  const blob = await (await fetch(card.src)).blob();
  assert.equal(await blob.text(), await f.original.text());
  assert.equal(f.counts().decodes, 0);
});


test('preview canvas retains the decoder aspect ratio for photos with rotation metadata', async () => {
  const f = fixture({orientedHeight: 854});
  await f.context.hydrateCardImage(image('image-1'));
  assert.equal(f.decodeOptions[0].resizeHeight, undefined);
  assert.equal(f.canvases[0].width, 640);
  assert.equal(f.canvases[0].height, 854);
});
