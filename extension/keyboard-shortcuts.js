// Application commands, scoped independently from native text editing.
export const SHORTCUT_COMMANDS = [
  { id: 'markIn', scope: 'review', label: '入点', key: 'I' },
  { id: 'markOut', scope: 'review', label: '出点', key: 'O' },
  { id: 'playPause', scope: 'review', label: '播放 / 暂停', key: 'Space' },
  { id: 'addFeedback', scope: 'review', label: '创作备注', key: 'M' },
  { id: 'toggleLoop', scope: 'review', label: '循环', key: '' },
  { id: 'mute', scope: 'review', label: '静音', key: '' },
  { id: 'toggleReview', scope: 'review', label: '审片', key: '' },
  { id: 'previousCase', scope: 'detail', label: '上一案例', key: 'ArrowLeft' },
  { id: 'nextCase', scope: 'detail', label: '下一案例', key: 'ArrowRight' },
  { id: 'closeDetail', scope: 'detail', label: '关闭详情', key: 'Escape', input: true },
  { id: 'closeReview', scope: 'review', label: '退出审片', key: 'Escape' },
  { id: 'saveFeedback', scope: 'feedback', label: '保存备注', key: 'Enter', input: true },
  { id: 'newlineFeedback', scope: 'feedback', label: '备注换行', key: 'Shift+Enter', input: true },
  { id: 'captureFrame', scope: 'review', label: '保存截图', key: '' },
  { id: 'clearRange', scope: 'review', label: '清除入出点', key: '' },
  { id: 'refreshFeedbackTime', scope: 'feedback', label: '刷新时间', key: '' },
  { id: 'previousMedia', scope: 'review', label: '上一项媒体', key: '' },
  { id: 'nextMedia', scope: 'review', label: '下一项媒体', key: '' },
  { id: 'closeFeedback', scope: 'feedback', label: '收起备注', key: 'Escape', input: true },
  { id: 'focusSearch', scope: 'library', label: '搜索', key: '' },
  { id: 'importReview', scope: 'library', label: '审阅本机样片', key: 'Mod+I' },
  { id: 'startCompose', scope: 'library', label: '开始创作', key: '' },
  { id: 'openSettings', scope: 'library', label: '设置', key: '' }
];
const modifiers = ['Mod', 'Control', 'Meta', 'Alt', 'Shift'];
export function normalizeShortcut(value) {
  if (!value || typeof value !== 'string') return '';
  const parts = value.split('+'), raw = parts.pop();
  const key = raw === ' ' ? 'Space' : raw.length === 1 ? raw.toUpperCase() : raw;
  if (!key || parts.some(part => !modifiers.includes(part)) || new Set(parts).size !== parts.length) return '';
  return [...modifiers.filter(part => parts.includes(part)), key].join('+');
}
export function normalizeShortcutOverrides(value = {}) {
  if (Object.hasOwn(value || {}, 'attachFrame') && !Object.hasOwn(value || {}, 'captureFrame')) value = { ...value, captureFrame: value.attachFrame };
  return Object.fromEntries(SHORTCUT_COMMANDS.filter(item => Object.hasOwn(value || {}, item.id)).map(item => [item.id, normalizeShortcut(value[item.id])]));
}
export function shortcutBindings(overrides) {
  const normalized = normalizeShortcutOverrides(overrides);
  return Object.fromEntries(SHORTCUT_COMMANDS.map(item => [item.id, normalized[item.id] ?? item.key]));
}
export function formatShortcut(value, platform = globalThis.navigator?.platform || '') {
  const mac = /Mac/i.test(platform);
  const labels = { Mod: mac ? '⌘' : 'Ctrl', Control: 'Ctrl', Meta: '⌘', Alt: mac ? 'Option' : 'Alt', ArrowLeft: '←', ArrowRight: '→', Escape: 'Esc', Plus: '+' };
  return value.split('+').map(key => labels[key] || key).join(' + ');
}
export function shortcutForEvent(event, useMod = false) {
  if (['Control', 'Meta', 'Alt', 'Shift', 'Dead', 'Process', 'Unidentified'].includes(event.key)) return '';
  const mods = [];
  if (useMod && (event.ctrlKey || event.metaKey)) mods.push('Mod');
  else { if (event.ctrlKey) mods.push('Control'); if (event.metaKey) mods.push('Meta'); }
  if (event.altKey) mods.push('Alt'); if (event.shiftKey) mods.push('Shift');
  return normalizeShortcut([...mods, event.key === ' ' ? 'Space' : event.key === '+' ? 'Plus' : event.key].join('+'));
}
export function shortcutConflict(bindings) {
  for (const command of SHORTCUT_COMMANDS) {
    const key = normalizeShortcut(bindings[command.id]);
    if (!key) continue;
    const expand = value => value.includes('Mod+') ? [value.replace('Mod+', 'Control+'), value.replace('Mod+', 'Meta+')] : [value];
    const other = SHORTCUT_COMMANDS.find(item => item.id !== command.id && item.scope === command.scope
      && expand(normalizeShortcut(bindings[item.id])).some(value => expand(key).includes(value)));
    if (other) return [command, other];
  }
  return null;
}
export function installShortcutRouter({ target = document, bindings, scope, actions }) {
  const handler = event => {
    if (event.defaultPrevented || event.isComposing || event.keyCode === 229 || event.repeat) return;
    const current = scope(event);
    const text = event.target?.closest?.('textarea,input:not([type=range]):not([type=button]):not([type=checkbox]),select,[contenteditable=true]');
    const values = bindings();
    if (current === 'feedback' && event.target?.closest?.('button') && ['Enter', ' '].includes(event.key)) return;
    const command = SHORTCUT_COMMANDS.find(item => item.scope === current && (!text || item.input)
      && values[item.id] && [shortcutForEvent(event), shortcutForEvent(event, true)].includes(values[item.id]) && actions[item.id]);
    if (!command) return;
    event.preventDefault(); event.stopPropagation();
    actions[command.id](event);
  };
  target.addEventListener('keydown', handler, true);
  return () => target.removeEventListener('keydown', handler, true);
}
