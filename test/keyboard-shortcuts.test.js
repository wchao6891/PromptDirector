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

test('Premiere arrow keys step video frames, repeat while held and never steal text cursor movement', () => {
  let handler, current = 'review', calls = [];
  const target = { addEventListener: (_, fn) => { handler = fn; }, removeEventListener() {} };
  const keys = shortcutBindings();
  assert.equal(keys.previousFrame, 'ArrowLeft'); assert.equal(keys.nextFrame, 'ArrowRight');
  assert.equal(shortcutConflict(keys), null);
  installShortcutRouter({ target, bindings: () => keys, scope: () => current,
    actions: { previousFrame: () => calls.push('previous'), nextFrame: () => calls.push('next'),
      previousCase: () => calls.push('case'), playPause: () => calls.push('play') } });
  const event = (key, text = false, repeat = false) => ({ key, repeat, target: { closest: selector => text && selector.startsWith('textarea') }, preventDefault() {}, stopPropagation() {} });
  handler(event('ArrowLeft')); handler(event('ArrowRight', false, true));
  handler(event('ArrowLeft', true)); handler(event(' ', false, true));
  current = 'detail'; handler(event('ArrowLeft'));
  assert.deepEqual(calls, ['previous', 'next', 'case']);
});

test('review frame-step arrows leave focused sliders, separators, lists and media rails their own arrow keys', () => {
  let handler, calls = [];
  const target = { addEventListener: (_, fn) => { handler = fn; }, removeEventListener() {} };
  installShortcutRouter({ target, bindings: () => shortcutBindings(), scope: () => 'review',
    actions: { previousFrame: () => calls.push('previous'), nextFrame: () => calls.push('next'), markIn: () => calls.push('in') } });
  const event = (key, owner) => ({ key, target: { closest: selector => Boolean(owner) && selector.split(',').includes(owner) },
    preventDefault() { this.prevented = true; }, stopPropagation() { this.stopped = true; } });
  for (const owner of ['[role=separator]', '[role=slider]', 'input[type=range]', '[role=option]', '[data-arrow-keys]']) {
    const arrow = event('ArrowLeft', owner);
    handler(arrow);
    assert.equal(arrow.prevented, undefined, owner);
    assert.equal(arrow.stopped, undefined, owner);
  }
  handler(event('i', '[data-arrow-keys]'));
  handler(event('ArrowRight'));
  assert.deepEqual(calls, ['in', 'next']);
});

test('library media rail opts into native arrows and held frame steps never stack', async () => {
  const { readFile } = await import('node:fs/promises');
  const library = await readFile(new URL('../extension/library.js', import.meta.url), 'utf8');
  const workspace = await readFile(new URL('../extension/library-agent-workspace.js', import.meta.url), 'utf8');
  assert.match(library, /rail\.dataset\.arrowKeys = "true"/);
  assert.match(library, /mediaNavigation\.dataset\.arrowKeys = "true"/);
  assert.match(workspace, /previousFrame: event => stepFrame\(event, 'previousFrame'\)/);
  assert.match(workspace, /if \(!button \|\| event\.repeat && steppingPlayer === player\) return;/);
  assert.match(workspace, /addEventListener\('seeked', \(\) => \{ if \(steppingPlayer === player\) steppingPlayer = null; \}, \{ once: true \}\)/);
});
