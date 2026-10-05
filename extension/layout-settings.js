import { normalizeUiPreferences, gallerySizesForZoom, galleryZoomForSize, GALLERY_SIZE_LIMITS, SIDEBAR_WIDTH_LIMITS, DETAIL_SIDEBAR_WIDTH_LIMITS } from './preferences.js';
import { promptAppText, confirmAppAction } from './ui-dialogs.js';
import { t, translateUiMessage } from './i18n.js';

export function mountLayoutSettings(root, { apply, back }) {
  const form = root.querySelector('form');
  const status = root.querySelector('#layout-feedback');
  const configs = root.querySelector('#layout-config');
  const rename = root.querySelector('#layout-rename');
  const remove = root.querySelector('#layout-delete');
  let preferences;
  let loadGeneration = 0;
  let busy = false;
  const dirty = new Set();
  const field = key => form.elements.namedItem(key);
  for (const [key, limits] of [['sidebarWidth', SIDEBAR_WIDTH_LIMITS], ['detailSidebarWidth', DETAIL_SIDEBAR_WIDTH_LIMITS]]) {
    field(key).min = limits.min; field(key).max = limits.max;
  }
  function renderSize(zoom) {
    const view = field('galleryView').value;
    const limits = GALLERY_SIZE_LIMITS[view];
    field('gallerySize').min = limits.min; field('gallerySize').max = limits.max;
    field('gallerySize').value = gallerySizesForZoom(zoom)[view];
  }
  function readZoom() {
    return galleryZoomForSize(field('galleryView').value, Number(field('gallerySize').value));
  }
  function render(value) {
    preferences = normalizeUiPreferences(value);
    configs.replaceChildren(...preferences.layoutPresets.map(item => new Option(item.id === 'default' ? t('默认') : item.name, item.id)));
    configs.value = preferences.activeLayoutId;
    for (const key of ['galleryView', 'detailMode', 'sidebarWidth', 'detailSidebarWidth']) field(key).value = preferences[key];
    renderSize(preferences.galleryZoom);
    field('detailPanelRatio').value = preferences.detailPanelRatio === null ? '' : Math.round(preferences.detailPanelRatio * 100);
    field('sidebarCollapsed').checked = preferences.sidebarLayout.collapsed;
    dirty.clear();
    updateControls();
  }
  function updateControls() {
    [...form.elements].forEach(control => control.disabled = busy);
    rename.disabled = remove.disabled = busy || configs.value === 'default';
  }
  function changedValues() {
    const values = { galleryView: field('galleryView').value, detailMode: field('detailMode').value,
      galleryZoom: Math.round(readZoom()), sidebarWidth: Number(field('sidebarWidth').value),
      detailSidebarWidth: Number(field('detailSidebarWidth').value),
      detailPanelRatio: field('detailPanelRatio').value === '' ? null : Number(field('detailPanelRatio').value) / 100 };
    // Opening settings must not freeze later drag/position updates into an old snapshot.
    const changes = Object.fromEntries(Object.entries(values).filter(([key]) => dirty.has(key === 'galleryZoom' ? 'gallerySize' : key)));
    if (dirty.has('sidebarCollapsed')) changes.sidebarLayout = { collapsed: field('sidebarCollapsed').checked };
    return changes;
  }
  async function run(action, args = {}) {
    if (busy) return;
    busy = true; updateControls();
    try {
      const response = await chrome.runtime.sendMessage({ type: 'UPDATE_LAYOUT_PREFERENCES', action, ...args });
      if (!response?.ok) throw new Error(response?.message || t('保存失败'));
      render(response.uiPreferences); apply(response.uiPreferences); status.textContent = t('已保存');
    } catch (error) {
      configs.value = preferences.activeLayoutId;
      status.textContent = translateUiMessage(error.message);
    } finally { busy = false; updateControls(); }
  }
  form.addEventListener('input', event => { if (event.target.name) dirty.add(event.target.name); });
  form.addEventListener('change', event => { if (event.target.name) dirty.add(event.target.name); });
  form.addEventListener('submit', event => {
    event.preventDefault(); void run('save', { id: configs.value, preferences: changedValues() });
  });
  configs.addEventListener('change', () => void run('apply', { id: configs.value }));
  field('galleryView').addEventListener('change', () => renderSize(preferences.galleryZoom));
  root.querySelector('#layout-create').addEventListener('click', async () => {
    if (!form.reportValidity()) return;
    let number = 1;
    while (preferences.layoutPresets.some(item => item.name === t('配置{number}', { number }))) number++;
    const name = await promptAppText({ title: '新建布局配置', label: '配置名称', value: t('配置{number}', { number }), selectFirst: true, confirmLabel: '保存' });
    if (name !== null) await run('create', { name, preferences: changedValues() });
  });
  rename.addEventListener('click', async () => {
    const id = configs.value;
    const name = await promptAppText({ title: '重命名布局配置', label: '配置名称', value: preferences.layoutPresets.find(item => item.id === id).name, selectFirst: true, confirmLabel: '保存' });
    if (name !== null) await run('rename', { id, name });
  });
  remove.addEventListener('click', async () => {
    const id = configs.value;
    if (await confirmAppAction({ title: '删除布局配置', description: preferences.layoutPresets.find(item => item.id === id).name, confirmLabel: '删除', danger: true })) await run('delete', { id });
  });
  root.querySelector('#layout-reset').addEventListener('click', () => void run('reset'));
  root.querySelector('#layout-return').addEventListener('click', back);
  return { async open() {
    const generation = ++loadGeneration;
    const stored = await chrome.storage.local.get('uiPreferences');
    if (generation !== loadGeneration) return;
    render(stored.uiPreferences); status.textContent = '';
  } };
}
