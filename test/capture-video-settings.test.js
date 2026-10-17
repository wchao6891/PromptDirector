import test from 'node:test';
import assert from 'node:assert/strict';
import { bindCaptureVideoSettings } from '../extension/capture-video-settings.js';
import { normalizeUiPreferences, updateLayoutPreferences } from '../extension/preferences.js';

test('video originals are the default and layout resets cannot silently change the user storage choice', () => {
  assert.equal(normalizeUiPreferences().videoOnlineOnly, false);
  assert.equal(normalizeUiPreferences({ videoOnlineOnly: 'true' }).videoOnlineOnly, false);
  const preferences = normalizeUiPreferences({ videoOnlineOnly: true });
  assert.equal(updateLayoutPreferences(preferences, {}, true).videoOnlineOnly, true);
});

test('the actual settings callback restores the last saved choice on write failure', async () => {
  const toggle = new EventTarget(), connect = new EventTarget();
  const errors = [];
  const binding = bindCaptureVideoSettings({ toggle, connect, status: {}, feedback: {},
    load: async () => ({ videoOnlineOnly: false }), save: async () => { throw new Error('storage write failed'); },
    show: (node, value) => errors.push(value) });
  await binding.refresh();
  toggle.checked = true; toggle.dispatchEvent(new Event('change'));
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(toggle.checked, false); assert.equal(toggle.disabled, false);
  assert.deepEqual(errors, ['storage write failed']);
});
