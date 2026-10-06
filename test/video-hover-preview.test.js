import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';

const source = (await readFile(new URL('../extension/video-hover-preview.js', import.meta.url), 'utf8')).replace('export function', 'function');
function fixture(loadBlob = async () => new Blob(['video'], {type: 'video/mp4'})) {
  const events = new Map(), classes = new Set(), players = [];
  const container = {isConnected: true, classList: {add: (...v) => v.forEach(x => classes.add(x)), remove: (...v) => v.forEach(x => classes.delete(x))},
    addEventListener: (name, fn) => events.set(name, fn), removeEventListener: name => events.delete(name), append() {}};
  const context = {Blob, URL, console, document: {documentElement: {dataset: {}}, createElement() {
    let played;
    const video = {setAttribute() {}, removeAttribute() {}, load() {}, pause() {}, remove() {this.removed = true;},
      play: () => new Promise(r => {played = r;}), finishPlay: () => played()};
    players.push(video); return video;
  }}, matchMedia: () => ({matches: true})};
  vm.createContext(context); vm.runInContext(source, context);
  const controller = context.bindVideoHoverPreview(container, {loadBlob});
  return {container, classes, players, controller, enter: () => events.get('pointerenter')(), leave: () => events.get('pointerleave')()};
}
const settle = async () => {for (let i = 0; i < 10; i++) await Promise.resolve();};

test("video hover preview loads one local blob only after pointer entry", () => {
  const beforeStart = source.slice(0, source.indexOf("const start"));
  const start = source.slice(source.indexOf("const start"), source.indexOf("const stop"));
  assert.doesNotMatch(beforeStart, /loadBlob\(\)/);
  assert.match(start, /await options\.loadBlob\(\)/);
  assert.match(start, /video\.muted = true/);
  assert.match(start, /video\.loop = true/);
  assert.match(start, /video\.playsInline = true/);
  assert.match(start, /await video\.play\(\)/);
});

test("video hover preview respects pointer and motion preferences", () => {
  assert.match(source, /dataset\.motion === "reduced"/);
  assert.match(source, /\(hover: hover\) and \(pointer: fine\)/);
  assert.match(source, /pointerenter/);
  assert.match(source, /pointerleave/);
});

test("video hover preview releases playback and object URLs on every exit", () => {
  const destroy = source.slice(source.indexOf("const destroyPlayer"), source.indexOf("const start"));
  assert.match(destroy, /video\.pause\(\)/);
  assert.match(destroy, /video\.removeAttribute\("src"\)/);
  assert.match(destroy, /video\.remove\(\)/);
  assert.match(destroy, /URL\.revokeObjectURL\(objectUrl\)/);
});

test('a late play completion cannot destroy the preview started after moving away and back', async () => {
  const f = fixture(); const first = f.enter(); await settle();
  f.leave(); const second = f.enter(); await settle();
  f.players[1].finishPlay(); await second;
  f.players[0].finishPlay(); await first;
  assert.equal(f.players[1].removed, undefined);
  assert.ok(f.classes.has('is-video-playing'));
  f.controller.destroy();
});

test('a recycled card cannot start playing after its original finishes loading', async () => {
  let resolveBlob;
  const f = fixture(() => new Promise(r => {resolveBlob = r;}));
  const pending = f.enter(); f.container.isConnected = false;
  resolveBlob(new Blob(['video'], {type: 'video/mp4'})); await settle();
  f.players[0]?.finishPlay(); await pending;
  assert.equal(f.players.length, 0);
  f.controller.destroy();
});

test('releasing a card stops playback while allowing a cached card to be mounted again', async () => {
  const f = fixture(); const pending = f.enter(); await settle(); f.players[0].finishPlay(); await pending;
  f.controller.stop(); assert.ok(f.players[0].removed); assert.ok(!f.classes.has('is-video-playing'));
  const returned = f.enter(); await settle(); f.players[1].finishPlay(); await returned;
  assert.ok(f.classes.has('is-video-playing')); f.controller.destroy();
});
