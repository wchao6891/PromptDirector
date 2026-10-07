import test from 'node:test';
import assert from 'node:assert/strict';
import { createWorkspaceScreenshot } from '../extension/workspace-screenshot.js';

const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==';
function event() {
  const listeners = new Set();
  return { addListener: fn => listeners.add(fn), removeListener: fn => listeners.delete(fn),
    emit: (...args) => { for (const fn of listeners) fn(...args); }, get size() { return listeners.size; } };
}
function fixture() {
  const url = 'chrome-extension://self/';
  const context = { tabId: 7, contextId: 'context', documentId: 'document', documentUrl: `${url}library.html?case=a` };
  const tab = { id: 7, windowId: 2, active: true, status: 'complete', url: context.documentUrl };
  const windows = new Map([[2, { state: 'normal' }]]);
  let captures = 0, action = () => `data:image/png;base64,${png}`, now = 1000;
  const chromeApi = {
    runtime: { getURL: path => url + path, getContexts: async () => contexts },
    tabs: { get: async id => tabs.get(id), onActivated: event(), onUpdated: event(), onRemoved: event(),
      captureVisibleTab: async (windowId, options) => { captures++; assert.equal(windowId, 2); assert.deepEqual(options, { format: 'png' }); return action(); } },
    windows: { get: async id => windows.get(id) }
  };
  const contexts = [context], tabs = new Map([[7, tab]]);
  return { chromeApi, contexts, tabs, context, tab, windows, get captures() { return captures; },
    service: createWorkspaceScreenshot({ chromeApi, now: () => now, budget: { workingBytes: 128, maxDurationMs: 100 } }),
    setAction: fn => { action = fn; }, advance: value => { now += value; } };
}

test('only the unique visible own-plugin page is captured and all chunks remain the same frame', async () => {
  const f = fixture();
  f.contexts.push({ tabId: 9, contextId: 'external', documentUrl: 'https://private.example/' });
  const first = await f.service.capture({});
  assert.equal(first.surface, 'library'); assert.equal(first.tabId, 7); assert.equal(first.state, 'captured');
  let next = first.nextOffset;
  const parts = [Buffer.from(first.data, 'base64')];
  while (next !== null) {
    const part = await f.service.capture({ screenshotId: first.screenshotId, offset: next });
    assert.equal(part.capturedAt, first.capturedAt); parts.push(Buffer.from(part.data, 'base64')); next = part.nextOffset;
  }
  assert.deepEqual(Buffer.concat(parts), Buffer.from(png, 'base64'));
  assert.equal(f.captures, 1);
  for (const name of ['onActivated', 'onUpdated', 'onRemoved']) assert.equal(f.chromeApi.tabs[name].size, 0);
});

test('arbitrary webpages and other extension pages never reach captureVisibleTab', async () => {
  for (const documentUrl of ['https://example.com/library.html', 'chrome-extension://other/library.html', 'chrome-extension://self/settings.html']) {
    const f = fixture(); f.context.documentUrl = documentUrl; f.tab.url = documentUrl;
    await assert.rejects(f.service.capture({ tabId: 7 }), { code: 'invalid_workspace' });
    assert.equal(f.captures, 0);
  }
});

test('own-plugin context remains visible when Chrome omits tab.url without tabs permission', async () => {
  const f = fixture(); delete f.tab.url;
  assert.equal((await f.service.capture({})).state, 'captured');
  assert.equal(f.captures, 1);
});

test('an available tab URL must still match the verified plugin context', async () => {
  const f = fixture(); f.tab.url = 'https://private.example/';
  assert.equal((await f.service.capture({})).state, 'not_visible');
  assert.equal(f.captures, 0);
});

test('inactive, loading and minimized pages are reported without activating or capturing them', async () => {
  for (const change of [f => { f.tab.active = false; }, f => { f.tab.status = 'loading'; }, f => { f.windows.get(2).state = 'minimized'; }]) {
    const f = fixture(); change(f);
    assert.equal((await f.service.capture({ tabId: 7 })).state, 'not_visible'); assert.equal(f.captures, 0);
  }
});

test('multiple visible plugin windows require a target; surface can disambiguate', async () => {
  const f = fixture();
  f.contexts.push({ tabId: 8, contextId: 'composer', documentUrl: 'chrome-extension://self/composer.html' });
  f.tabs.set(8, { ...f.tab, id: 8, windowId: 3, url: 'chrome-extension://self/composer.html' });
  f.windows.set(3, { state: 'normal' });
  assert.equal((await f.service.capture({})).state, 'choose_workspace'); assert.equal(f.captures, 0);
  assert.equal((await f.service.capture({ surface: 'library' })).tabId, 7);
});

test('switching away and back during capture discards pixels even when final tab matches', async () => {
  const f = fixture();
  f.setAction(() => {
    f.chromeApi.tabs.onActivated.emit({ windowId: 2, tabId: 99 });
    f.chromeApi.tabs.onActivated.emit({ windowId: 2, tabId: 7 });
    return `data:image/png;base64,${png}`;
  });
  await assert.rejects(f.service.capture({}), { code: 'workspace_changed' });
  assert.equal(f.chromeApi.tabs.onActivated.size, 0);
});

test('navigation or same-URL document replacement discards the capture', async () => {
  for (const change of [f => f.chromeApi.tabs.onUpdated.emit(7, { status: 'loading' }),
    f => { f.context.documentId = 'new-document'; }]) {
    const f = fixture();
    // Browser snapshots are separate objects, not references to the mutable fake document.
    f.chromeApi.runtime.getContexts = async () => f.contexts.map(item => ({ ...item }));
    f.setAction(() => { change(f); return `data:image/png;base64,${png}`; });
    await assert.rejects(f.service.capture({}), { code: 'workspace_changed' });
  }
});

test('Chrome permission failures give the actual required next step and do not return pixels', async () => {
  const f = fixture(); delete f.tab.url;
  f.setAction(() => { throw new Error("Either the '<all_urls>' or 'activeTab' permission is required."); });
  await assert.rejects(f.service.capture({}), error => error.code === 'permission_required' && error.message.includes('工具栏'));
  assert.equal(f.chromeApi.tabs.onUpdated.size, 0);
});

test('expired screenshot identities cannot be used to take a new screenshot silently', async () => {
  const f = fixture(); const first = await f.service.capture({}); f.advance(101);
  await assert.rejects(f.service.capture({ screenshotId: first.screenshotId, offset: first.nextOffset }), { code: 'screenshot_expired' });
  assert.equal(f.captures, 1);
});
