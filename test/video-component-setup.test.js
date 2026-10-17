import test from 'node:test';
import assert from 'node:assert/strict';
import { createVideoComponentSetup, VIDEO_SETUP_KEY } from '../extension/video-component-setup.js';
import { videoComponentDownload } from '../extension/video-component-config.js';

function fixture(initial = {}) {
  const data = { [VIDEO_SETUP_KEY]: initial }, scheduled = [], notices = [], urls = [];
  let ready = false, resumed = 0, downloads = 0, exists = true;
  let download = { state: 'in_progress', bytesReceived: 100, totalBytes: 1000 };
  const storage = { async get(key) { return structuredClone({ [key]: data[key] }); }, async set(values) { Object.assign(data, structuredClone(values)); } };
  const options = { storage, inspect: async () => { if (!ready) throw new Error('host missing'); return { available: true }; },
    platform: async () => ({ os: 'mac' }), homepage: 'https://github.com/example/product',
    downloads: { async download({ url }) { downloads++; urls.push(url); return 7; }, async search() { return [download]; } },
    fetchImpl: async () => ({ ok: exists, status: exists ? 200 : 404 }),
    resume: async () => { resumed++; }, notify: state => notices.push(state), now: () => 1000,
    schedule: callback => { scheduled.push(callback); return scheduled.length; }, cancel: () => {} };
  return { options, setup: createVideoComponentSetup(options), data, scheduled, notices, urls,
    get resumed() { return resumed; }, get downloads() { return downloads; },
    ready() { ready = true; }, absent() { exists = false; }, complete() { download = { state: 'complete' }; }, interrupt() { download = { state: 'interrupted' }; }, review() { download = { state: 'in_progress', danger: 'uncommon' }; } };
}

test('extension-only users get their OS installer; unsupported systems never receive the wrong executable', () => {
  assert.match(videoComponentDownload('mac', 'https://github.com/a/b'), /macOS\.pkg$/u);
  assert.match(videoComponentDownload('win', 'https://github.com/a/b'), /Windows\.exe$/u);
  assert.throws(() => videoComponentDownload('linux', 'https://github.com/a/b'), /Windows/u);
  assert.throws(() => videoComponentDownload('mac', 'http://malicious.test'), /下载地址/u);
});

test('one explicit setup downloads once, reports real bytes, then resumes the pending save only after native readiness', async () => {
  const f = fixture();
  assert.equal(f.scheduled.length, 0, 'no perpetual startup checks');
  assert.equal((await f.setup.start()).phase, 'downloading');
  assert.equal(f.downloads, 1);
  await f.setup.start(); assert.equal(f.downloads, 1, 'reopening setup cannot duplicate downloads');
  assert.equal((await f.setup.check()).bytesReceived, 100);
  f.complete(); assert.equal((await f.setup.check()).phase, 'installing');
  assert.equal(f.resumed, 0, 'a downloaded file is not a successful installation');
  f.ready(); assert.equal((await f.setup.check()).phase, 'ready'); assert.equal(f.resumed, 1);
  await f.setup.check(); assert.equal(f.resumed, 1, 'completion cannot replay a successful save');
});

test('closing and reopening the sidebar recovers the durable installation and resumes the same task', async () => {
  const f = fixture(); await f.setup.start(); f.setup.stop(); f.complete();
  const reopened = createVideoComponentSetup(f.options);
  assert.equal((await reopened.check()).phase, 'installing');
  f.ready(); await reopened.check(); assert.equal(f.resumed, 1); assert.equal(f.downloads, 1);
});

test('an unpublished or interrupted installer is an actionable failure without a broken download or false success', async () => {
  const absent = fixture(); absent.absent();
  assert.equal((await absent.setup.start()).phase, 'failed'); assert.equal(absent.downloads, 0); assert.equal(absent.resumed, 0);
  assert.match(absent.data[VIDEO_SETUP_KEY].message, /尚未发布/u);
  const interrupted = fixture(); await interrupted.setup.start(); interrupted.interrupt();
  assert.equal((await interrupted.setup.check()).phase, 'failed'); assert.equal(interrupted.resumed, 0);
});

test('an already installed component needs no new download and continues the pending capture', async () => {
  const f = fixture(); f.ready(); assert.equal((await f.setup.start()).phase, 'ready');
  assert.equal(f.downloads, 0); assert.equal(f.resumed, 1);
});

test('browser download review needs a user decision and a removed installer can be downloaded again explicitly', async () => {
  const f = fixture(); await f.setup.start(); f.review();
  assert.equal((await f.setup.check()).phase, 'review'); assert.equal(f.resumed, 0);
  f.complete(); assert.equal((await f.setup.check()).phase, 'installing');
  assert.equal((await f.setup.start({ restart: true })).phase, 'downloading');
  assert.equal(f.downloads, 2, 'only the explicit retry starts a second download');
});

test('clicking setup from settings and the sidebar at the same time starts one installer download', async () => {
  const f = fixture();
  await Promise.all([f.setup.start(), f.setup.start()]);
  assert.equal(f.downloads, 1);
});
