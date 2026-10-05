import test from 'node:test';
import assert from 'node:assert/strict';
import { manageLayoutPreset } from '../extension/layout-presets.js';
import { normalizeUiPreferences, layoutSnapshot } from '../extension/preferences.js';

const coords = { reviewFeedback: { left: .43, top: .27 }, tagEditor: { left: .31, top: .15 } };
const start = () => normalizeUiPreferences({ theme: 'light', locale: 'en', shortcuts: { addFeedback: 'N' }, floatingPanelPositions: coords, detailPanelRatio: .41313 });

test('saving a named layout snapshots latest manual positions and precise split without storing content or keys', () => {
  const value = manageLayoutPreset(start(), { action: 'create', id: 'one', name: 'My layout', preferences: { sidebarWidth: 350 } });
  const saved = value.layoutPresets.find(item => item.id === 'one');
  assert.deepEqual(saved.values.floatingPanelPositions, coords);
  assert.equal(saved.values.detailPanelRatio, .41313);
  assert.equal(saved.values.sidebarWidth, 350);
  for (const key of ['shortcuts','theme','locale','entries','apiKey']) assert.equal(Object.hasOwn(saved.values, key), false);
  assert.equal(value.activeLayoutId, 'one');
});

test('switching layouts restores only the arrangement and reset retains other named configurations', () => {
  let value = manageLayoutPreset(start(), { action: 'create', id: 'one', name: '配置1', preferences: { sidebarWidth: 350 } });
  value = manageLayoutPreset(value, { action: 'create', id: 'two', name: '配置2', preferences: { sidebarWidth: 410, floatingPanelPositions: {} } });
  value = manageLayoutPreset(value, { action: 'apply', id: 'one' });
  assert.equal(value.sidebarWidth, 350);
  assert.deepEqual(value.floatingPanelPositions, coords);
  assert.equal(value.theme, 'light'); assert.equal(value.shortcuts.addFeedback, 'N');
  value = manageLayoutPreset(value, { action: 'rename', id: 'one', name: 'Review' });
  assert.equal(value.layoutPresets.find(item=>item.id==='one').name, 'Review');
  const snapshots = value.layoutPresets.filter(item=>item.id!=='default');
  value = manageLayoutPreset(value, { action: 'reset' });
  assert.deepEqual(value.layoutPresets.filter(item=>item.id!=='default'), snapshots);
  assert.equal(value.activeLayoutId, 'default');
  assert.deepEqual(value.floatingPanelPositions, {});
  assert.equal(value.shortcuts.addFeedback, 'N');
});

test('default can be saved deliberately; deleting a named preset preserves the current arrangement', () => {
  let value = manageLayoutPreset(start(), { action: 'save', id: 'default', preferences: { sidebarWidth: 300 } });
  assert.equal(value.layoutPresets[0].values.sidebarWidth, 300);
  value = manageLayoutPreset(value, { action: 'create', id: 'one', name: 'My layout', preferences: { sidebarWidth: 400 } });
  value = manageLayoutPreset(value, { action: 'delete', id: 'one' });
  assert.equal(value.sidebarWidth, 400); assert.equal(value.activeLayoutId, 'default');
  value = manageLayoutPreset(value, { action: 'apply', id: 'default' });
  assert.equal(value.sidebarWidth, 300);
});

test('invalid names, stale IDs and duplicate configurations fail without mutating earlier presets', () => {
  const before = start(), snapshot = structuredClone(before);
  for (const args of [{action:'save',id:'missing'},{action:'create',id:'one',name:' '},
    {action:'create',id:'default',name:'Another'}, {action:'create',id:'one',name:'默认'},
    {action:'rename',id:'default',name:'Changed'}, {action:'delete',id:'default'}, {action:'unknown',id:'default'}]) {
    assert.throws(()=>manageLayoutPreset(before,args));
    assert.deepEqual(before, snapshot);
  }
});

test('all normalized preference writes retain saved layouts, with unsafe data sanitized at the boundary', () => {
  const original = manageLayoutPreset(start(), {action:'create',id:'one',name:'One'});
  assert.deepEqual(normalizeUiPreferences({...original,shortcuts:{addFeedback:'Tab'}}).layoutPresets, original.layoutPresets);
  const clean = normalizeUiPreferences({layoutPresets:[{id:'one',name:'  One ',values:{sidebarWidth:9999,theme:'light'}},{id:'one',name:'Duplicate'},{id:'bad id',name:'Unsafe'}], activeLayoutId:'missing'});
  assert.equal(clean.layoutPresets.length,2); assert.equal(clean.activeLayoutId,'default');
  assert.equal(clean.layoutPresets[1].values.sidebarWidth,420);
  assert.equal(Object.hasOwn(layoutSnapshot({theme:'light'}),'theme'),false);
});
