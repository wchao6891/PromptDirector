import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../extension/panel-position.js', import.meta.url), 'utf8').replace(/export /g, '');
test('reopening a tool while its drag is saving uses the latest position, and save failure remains visible', async () => {
  let accept, listener;
  const writes = [];
  const context = vm.createContext({ window: { innerWidth: 1000, innerHeight: 500 },
    chrome: { storage: { local: { get: async () => ({ uiPreferences: {} }) }, onChanged: { addListener: fn => { listener = fn; } } },
      runtime: { sendMessage: message => { writes.push(message); return new Promise(resolve => { accept = resolve; }); } } } });
  vm.runInContext(source, context);
  const panel = { getBoundingClientRect: () => ({ left: 200, top: 100 }) };
  const saving = context.savePanelPosition('reviewFeedback', panel);
  assert.equal((await context.savedPanelPosition('reviewFeedback')).left, .2);
  assert.equal(writes[0].position.top, .2);
  accept({ ok: true, uiPreferences: { floatingPanelPositions: { reviewFeedback: writes[0].position } } });
  await saving;
  listener({ uiPreferences: { newValue: { floatingPanelPositions: { reviewFeedback: { left: .4, top: .3 } } } } }, 'local');
  assert.equal((await context.savedPanelPosition('reviewFeedback')).left, .4);
  const failed = context.savePanelPosition('reviewFeedback', panel);
  await context.savedPanelPosition('reviewFeedback');
  accept({ ok: false, message: '存储不可用' });
  await assert.rejects(failed, /存储不可用/);
  assert.equal((await context.savedPanelPosition('reviewFeedback')).left, .4);
});

test('an initial position read cannot replace a newer layout-switch notification', async () => {
  let resolveRead, listener;
  const context = vm.createContext({
    chrome: { storage: { local: { get: () => new Promise(resolve => { resolveRead = resolve; }) },
      onChanged: { addListener: fn => { listener = fn; } } } }
  });
  vm.runInContext(source, context);
  const loading = context.savedPanelPosition('tagEditor');
  listener({ uiPreferences: { newValue: { floatingPanelPositions: { tagEditor: { left: .6, top: .3 } } } } }, 'local');
  resolveRead({ uiPreferences: { floatingPanelPositions: { tagEditor: { left: .2, top: .1 } } } });
  assert.equal((await loading).left, .6);
});
