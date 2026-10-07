import { DEFAULT_UI_PREFERENCES, layoutSnapshot, normalizeUiPreferences, updateLayoutPreferences } from './preferences.js';

export function manageLayoutPreset(previous, { action, id, name, preferences }) {
  let next = normalizeUiPreferences(previous);
  const preset = next.layoutPresets.find(item => item.id === id);
  if (action !== 'create' && action !== 'reset' && !preset) throw new Error('布局配置不存在');
  if (['create', 'rename'].includes(action)) {
    name = typeof name === 'string' ? name.trim() : '';
    if (!name) throw new Error('请输入配置名称');
    if (next.layoutPresets.some(item => item.id !== id && item.name === name)) throw new Error('配置名称已存在');
  }
  switch (action) {
    case 'save':
      next = updateLayoutPreferences(next, preferences);
      next.layoutPresets = next.layoutPresets.map(item => item.id === id ? { ...item, values: layoutSnapshot(next) } : item);
      next.activeLayoutId = id;
      break;
    case 'create':
      if (typeof id !== 'string' || !/^[a-zA-Z0-9_-]+$/.test(id) || next.layoutPresets.some(item => item.id === id)) throw new Error('布局配置编号无效');
      next = updateLayoutPreferences(next, preferences);
      next.layoutPresets.push({ id, name, values: layoutSnapshot(next) });
      next.activeLayoutId = id;
      break;
    case 'apply':
      next = updateLayoutPreferences(next, preset.values);
      next.activeLayoutId = id;
      break;
    case 'rename':
      if (id === 'default') throw new Error('默认配置不能重命名');
      next.layoutPresets = next.layoutPresets.map(item => item.id === id ? { ...item, name } : item);
      break;
    case 'delete':
      if (id === 'default') throw new Error('默认配置不能删除');
      next.layoutPresets = next.layoutPresets.filter(item => item.id !== id);
      if (next.activeLayoutId === id) next.activeLayoutId = 'default';
      break;
    case 'reset':
      next = updateLayoutPreferences(next, {}, true);
      next.layoutPresets = next.layoutPresets.map(item => item.id === 'default' ? { ...item, values: layoutSnapshot(DEFAULT_UI_PREFERENCES) } : item);
      next.activeLayoutId = 'default';
      break;
    default: throw new Error('布局操作无效');
  }
  return normalizeUiPreferences(next);
}
