import { createDetailProjectSelector } from './detail-project-selector.js';
import { collectionPathLabel } from './organizer.js';
import { createUiIcon } from './ui-icons.js';
import { placePanelInViewport } from './panel-drag.js';
import { t } from './i18n.js';

// The collector places a draft in one project; the library keeps its own
// multi-project membership rules while sharing the same tree and appearance.
export function createCaptureProjectMenu({ menu, getCollections, getDraft, onChange, onError }) {
  const summary = document.createElement('summary');
  const text = document.createElement('span'); text.className = 'detail-project-summary-text';
  summary.title = t('项目'); summary.append(createUiIcon('folder'), text, createUiIcon('chevron-down'));
  const popover = document.createElement('div'); popover.className = 'detail-project-popover';
  popover.dataset.menuInteractive = 'true';
  let unavailable = false;
  let nameDirty = false;
  const state = () => ({ collections: getCollections() });
  const selector = createDetailProjectSelector({
    getState: state, getSelectedIds: () => getDraft()?.collectionId ? [getDraft().collectionId] : [],
    getChildren: () => {
      const children = new Map();
      for (const collection of getCollections()) {
        const parent = collection.parentId || null;
        if (!children.has(parent)) children.set(parent, []);
        children.get(parent).push(collection);
      }
      for (const siblings of children.values()) siblings.sort((a, b) => a.order - b.order || a.name.localeCompare(b.name, 'zh-CN'));
      return children;
    },
    disabled: () => unavailable,
    onChange: async (id, checked) => {
      if (await onChange({ collectionId: checked ? id : '', newCollectionName: '' })) {
        nameDirty = false; name.value = ''; render();
      }
    }
  });
  const newProject = document.createElement('div'); newProject.className = 'detail-new-project';
  const name = document.createElement('input'); name.id = 'capture-new-collection-name';
  name.autocomplete = 'off'; name.placeholder = t('输入新项目名称'); name.setAttribute('aria-label', t('新项目名称'));
  name.addEventListener('input', () => { nameDirty = true; });
  const add = document.createElement('button'); add.type = 'button'; add.className = 'button-secondary'; add.textContent = t('新建项目');
  const commitName = async () => {
    const value = name.value.trim();
    if (!value) { name.focus(); return false; }
    const accepted = await onChange({ collectionId: '', newCollectionName: value });
    if (accepted) { nameDirty = false; menu.open = false; render(); summary.focus({ preventScroll: true }); }
    return accepted;
  };
  add.addEventListener('click', () => { if (!unavailable) void commitName().catch(onError); });
  name.addEventListener('keydown', event => {
    if (event.key !== 'Enter' || event.isComposing) return;
    event.preventDefault(); if (!unavailable) void commitName().catch(onError);
  });
  newProject.append(name, add); popover.append(selector.element, newProject); menu.append(summary, popover);
  const place = () => {
    if (!menu.open) return;
    const anchor = summary.getBoundingClientRect(), height = popover.getBoundingClientRect().height;
    const gap = parseFloat(getComputedStyle(popover).rowGap) || 0;
    placePanelInViewport(popover, { left: anchor.left,
      top: anchor.bottom + height + gap > innerHeight ? anchor.top - height - gap : anchor.bottom + gap });
  };
  menu.addEventListener('toggle', () => { if (menu.open) { selector.render(); place(); } });
  summary.addEventListener('click', event => { if (unavailable) event.preventDefault(); });
  window.addEventListener('resize', place);
  new ResizeObserver(place).observe(popover);
  function render(disabled = unavailable) {
    unavailable = disabled;
    const draft = getDraft();
    const id = getCollections().some(collection => collection.id === draft?.collectionId) ? draft.collectionId : '';
    text.textContent = draft?.newCollectionName || (id ? collectionPathLabel(state(), id) : t('选择项目'));
    text.title = text.textContent;
    summary.setAttribute('aria-disabled', String(disabled));
    name.disabled = add.disabled = disabled;
    if (document.activeElement !== name && !nameDirty) name.value = draft?.newCollectionName || '';
    if (disabled) menu.open = false;
    if (menu.open) selector.render();
  }
  render();
  return { render, focus: () => summary.focus({ preventScroll: true }),
    async flush() { return name.value.trim() && name.value.trim() !== getDraft()?.newCollectionName ? commitName() : true; }
  };
}
