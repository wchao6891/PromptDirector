import test from 'node:test';
import assert from 'node:assert/strict';
import { shortcutBindings, shortcutConflict, shortcutForEvent, installShortcutRouter } from '../extension/keyboard-shortcuts.js';

test('custom shortcuts replace defaults while scopes and cleared bindings remain independent', () => {
  const keys = shortcutBindings({ markIn: 'q', markOut: '', unknown: 'X' });
  assert.equal(keys.markIn, 'Q'); assert.equal(keys.markOut, ''); assert.equal(keys.playPause, 'Space'); assert.equal(keys.unknown, undefined);
  assert.equal(shortcutConflict(keys), null);
  assert.equal(shortcutConflict({ ...keys, markOut: 'Q' })[0].scope, 'review');
  assert(shortcutConflict({ ...keys, markIn: 'Mod+I', markOut: 'Control+I' }));
  assert.equal(shortcutForEvent({ key: ' ', shiftKey: true }), 'Shift+Space');
});

test('typing, IME composition and native button activation cannot trigger review commands or save feedback', () => {
  let handler, current = 'review', calls = [];
  const target = { addEventListener: (_, fn) => { handler = fn; }, removeEventListener: () => {} };
  installShortcutRouter({ target, bindings: () => shortcutBindings(), scope: () => current,
    actions: { markIn: () => calls.push('in'), saveFeedback: () => calls.push('save'), newlineFeedback: () => calls.push('newline') } });
  const event = (key, type = '', overrides = {}) => ({ key, target: { closest: selector => type === 'text' && selector.startsWith('textarea') || type === 'button' && selector === 'button' },
    preventDefault() { this.prevented = true; }, stopPropagation() {}, ...overrides });
  handler(event('i', 'text')); handler(event('i', '', { isComposing: true })); handler(event('i', '', { keyCode: 229 }));
  assert.deepEqual(calls, []);
  handler(event('i')); assert.deepEqual(calls, ['in']);
  current = 'feedback'; handler(event('Enter', 'button')); handler(event('Enter', 'text', { isComposing: true }));
  assert.deepEqual(calls, ['in']);
  handler(event('Enter', 'text')); handler(event('Enter', 'text', { shiftKey: true }));
  assert.deepEqual(calls, ['in', 'save', 'newline']);
});

test('an existing attached-frame key moves to independent screenshot capture without losing customization', () => {
  assert.equal(shortcutBindings({ attachFrame: 'Alt+F' }).captureFrame, 'Alt+F');
  assert.equal(shortcutBindings({ attachFrame: 'Alt+F', captureFrame: 'Q' }).captureFrame, 'Q');
  assert.equal(shortcutBindings({ clearRange: 'Tab' }).clearRange, 'Tab');
});
