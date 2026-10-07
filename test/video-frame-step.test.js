import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { adjacentVideoPacket, createVideoFrameStepper } from '../extension/video-frame-step.js';
import { Input, BlobSource, ALL_FORMATS, EncodedPacketSink } from '../extension/video-frame-runtime.js';

function metadataSink(packets) {
  return {
    async getFirstPacket(options) { assert.equal(options.metadataOnly, true); return packets[0] || null; },
    async getPacket(time, options) {
      assert.equal(options.metadataOnly, true);
      return packets.filter(packet => packet.timestamp <= time).sort((a, b) => b.timestamp - a.timestamp)[0] || null;
    }
  };
}

test('frame stepping follows actual presentation timestamps across variable durations, gaps and B-frame decode order', async () => {
  const packets = [{ timestamp: 0, duration: .04 }, { timestamp: .3, duration: .02 },
    { timestamp: .04, duration: .26 }, { timestamp: .32, duration: .8 }, { timestamp: .35, duration: .04 }];
  const sink = metadataSink(packets);
  assert.equal((await adjacentVideoPacket(sink, .02, 1)).timestamp, .04);
  assert.equal((await adjacentVideoPacket(sink, .045, 1)).timestamp, .3);
  assert.equal((await adjacentVideoPacket(sink, .31, -1)).timestamp, .04);
  assert.equal((await adjacentVideoPacket(sink, .33, 1)).timestamp, .35);
  assert.equal((await adjacentVideoPacket(sink, 0, -1)).timestamp, 0);
  assert.equal((await adjacentVideoPacket(sink, 10, 1)).timestamp, .35);
});

test('zero-duration packet metadata still finds the adjacent frame without using a default fps', async () => {
  const sink = metadataSink([0, .01, .013, .9].map(timestamp => ({ timestamp, duration: 0 })));
  assert.equal((await adjacentVideoPacket(sink, .01, 1)).timestamp, .013);
  assert.equal((await adjacentVideoPacket(sink, .9, -1)).timestamp, .013);
  await assert.rejects(adjacentVideoPacket(metadataSink([]), 0, 1), /无法读取视频帧/);
});

test('a non-displayed trailing packet cannot move the player beyond its real media endpoint', async () => {
  const sink = metadataSink([{ timestamp: .1, duration: .1 }, { timestamp: .2, duration: .1 }, { timestamp: .3, duration: 0 }]);
  assert.equal((await adjacentVideoPacket(sink, .3, 1, .3)).timestamp, .2);
  assert.equal((await adjacentVideoPacket(sink, .3, -1, .3)).timestamp, .1);
  assert.equal((await adjacentVideoPacket(sink, .15, 1, .3)).timestamp, .2);
});

test('the original 12 fps video uses its own frame index and exact neighbors', async () => {
  const blob = new Blob([await readFile(new URL('./fixtures/review-workspace-smoke.mp4', import.meta.url))]);
  const input = new Input({ source: new BlobSource(blob), formats: ALL_FORMATS });
  try {
    const sink = new EncodedPacketSink(await input.getPrimaryVideoTrack());
    assert.equal((await adjacentVideoPacket(sink, .31, 1)).timestamp, 1 / 3);
    assert.equal((await adjacentVideoPacket(sink, .31, -1)).timestamp, 1 / 6);
  } finally { input.dispose(); }
});

test('a newer playback or seek cancels queued frame requests instead of taking back the player', async () => {
  const blob = new Blob([await readFile(new URL('./fixtures/review-workspace-smoke.mp4', import.meta.url))]);
  let release, opened;
  const started = new Promise(resolve => { opened = resolve; });
  const player = Object.assign(new EventTarget(), { paused: true, readyState: 1, currentTime: .31, currentSrc: 'local-original', isConnected: true,
    pause() { this.paused = true; }, getPlaybackBlob() { opened(); return new Promise(resolve => { release = () => resolve(blob); }); } });
  const frames = createVideoFrameStepper(player, { prepare: async () => {} });
  const pending = Promise.allSettled([frames.step(1), frames.step(-1)]);
  await started;
  frames.cancel(); player.currentTime = .8; release();
  const results = await pending;
  assert(results.every(result => result.status === 'rejected' && result.reason.name === 'AbortError'));
  assert.equal(player.currentTime, .8);
  frames.destroy();
});

test('frame stepping waits for real metadata and keeps an unknown-duration recording on its last real frame', async () => {
  const blob = new Blob([await readFile(new URL('./fixtures/review-workspace-smoke.mp4', import.meta.url))]);
  const input = new Input({ source: new BlobSource(blob), formats: ALL_FORMATS });
  let last;
  try { last = await new EncodedPacketSink(await input.getPrimaryVideoTrack()).getPacket(1e6, { metadataOnly: true }); } finally { input.dispose(); }
  let time = 1e6, duration = NaN;
  const player = Object.defineProperties(Object.assign(new EventTarget(), { paused: true, readyState: 0, currentSrc: 'live-webm', isConnected: true,
    pause() { this.paused = true; }, getPlaybackBlob: async () => blob,
    load() { queueMicrotask(() => { this.readyState = 1; duration = Infinity; this.dispatchEvent(new Event('loadedmetadata')); }); } }), {
    duration: { get: () => duration },
    currentTime: { get: () => time, set(value) { time = value; queueMicrotask(() => this.dispatchEvent(new Event('seeked'))); } }
  });
  const frames = createVideoFrameStepper(player, { prepare: async () => {} });
  await frames.step(1);
  assert(Number.isFinite(player.currentTime));
  assert(player.currentTime > last.timestamp && player.currentTime < last.timestamp + Math.max(last.duration, 1e-6));
  frames.destroy();
});
