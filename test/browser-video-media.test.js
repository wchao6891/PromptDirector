import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';

const source = (await readFile(new URL('../extension/browser-video-media.js', import.meta.url), 'utf8')).replace('export function', 'function');
async function poster(options) {
  let video, canvas;
  const context = {URL, Math, Number, Promise, setTimeout, clearTimeout, crypto: {randomUUID: () => 'poster'}, document: {createElement(kind) {
    if (kind === 'video') return video = {videoWidth: 3840, videoHeight: 2160, duration: 8, teardown: [], pause() { this.teardown.push('pause'); }, load() { this.teardown.push('load'); }, removeAttribute(name) { this.teardown.push(`remove:${name}`); }, canPlayType: () => 'probably'};
    return canvas = {getContext: () => ({drawImage() {}}), toBlob: fn => fn(new Blob(['poster'], {type: 'image/webp'}))};
  }}};
  vm.createContext(context); vm.runInContext(source, context);
  const result = context.readVideoMedia(new Blob(['video']), 'video/mp4', 'video', options);
  await video.onloadeddata();
  return {prepared: await result, canvas, video};
}

test('gallery video previews use the image preview width while preserving original video dimensions', async () => {
  const {prepared, canvas} = await poster({posterMaxWidth: 640});
  assert.equal(canvas.width, 640); assert.equal(canvas.height, 360);
  assert.equal(prepared.metadata.width, 3840); assert.equal(prepared.metadata.height, 2160);
  assert.equal(prepared.poster.asset.width, 640); assert.equal(prepared.poster.asset.height, 360);
});

test('captured and imported video posters keep their existing resolution when no preview width is requested', async () => {
  const {canvas} = await poster({});
  assert.equal(canvas.width, 3840); assert.equal(canvas.height, 2160);
});

test('finished metadata readers release the decoder instead of leaving it alive per scrolled card', async () => {
  const {video} = await poster({});
  assert.deepEqual(video.teardown, ['pause', 'remove:src', 'load']);
});
