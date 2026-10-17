import test from 'node:test';
import assert from 'node:assert/strict';
import { openNativeVideoSession, nativeVideoStatus, downloadNativeVideo } from '../extension/native-video.js';
import { VIDEO_COMPONENT } from '../extension/video-component-config.js';

function browser({ permission = true, missing = false, response = { available: true }, componentVersion = VIDEO_COMPONENT.version } = {}) {
  const hosts = [], messages = [], disconnects = [];
  const runtime = { id: 'a'.repeat(32), lastError: null,
    connectNative(host) {
      hosts.push(host);
      return { onMessage: { addListener: callback => messages.push(callback) },
        onDisconnect: { addListener: callback => disconnects.push(callback) }, disconnect() {},
        postMessage(message) {
          queueMicrotask(() => {
            if (missing) { runtime.lastError = { message: 'Specified native messaging host not found.' }; disconnects.forEach(callback => callback()); return; }
            messages.forEach(callback => callback(message.type === 'video_hello' ? { type: 'video_ready', protocolVersion: 1, componentVersion }
              : { type: 'video_response', id: message.id, result: response }));
          });
        } };
    } };
  return { runtime, permissions: { contains: async () => permission }, hosts };
}

test('first-time capture goes straight to setup without probing an unrelated Agent connector', async () => {
  const chrome = browser({ missing: true });
  await assert.rejects(openNativeVideoSession(chrome), { code: 'video_component_required' });
  assert.deepEqual(chrome.hosts, [VIDEO_COMPONENT.host]);
});

test('ungranted native permission offers setup without launching a local process', async () => {
  const chrome = browser({ permission: false });
  await assert.rejects(openNativeVideoSession(chrome), { code: 'video_component_required' });
  assert.equal(chrome.hosts.length, 0);
});

test('the installed standalone component reports actual readiness through the same native protocol', async () => {
  const chrome = browser();
  assert.deepEqual(await nativeVideoStatus(chrome), { available: true, updateRequired: false });
  assert.deepEqual(chrome.hosts, [VIDEO_COMPONENT.host]);
});

test('an outdated component offers the same simple update flow instead of failing the selected video later', async () => {
  assert.deepEqual(await nativeVideoStatus(browser({ componentVersion: '0.0.1' })), { available: false, updateRequired: true });
  await assert.rejects(openNativeVideoSession(browser({ componentVersion: '0.0.1' })), { code: 'video_component_required' });
});

test('a refreshed native result below the page resolution is rejected before transferring or saving a lower-quality original', async () => {
  const chrome = browser({ response: { token: 'lower-quality', width: 1280, height: 720, byteSize: 100, chunkCount: 1 } });
  await assert.rejects(downloadNativeVideo('https://www.bilibili.com/video/BVtest/', {
    chromeApi: chrome, minWidth: 1920, minHeight: 1080,
    estimateStorage: async () => ({ quota: 1024 * 1024 * 1024, usage: 0 })
  }), /未达到页面画质/u);
});
