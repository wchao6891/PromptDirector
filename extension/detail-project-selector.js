import { projectTreeRows } from './project-tree.js';
import { collectionPath, collectionPathLabelsById } from './organizer.js';
import { createUiIcon } from './ui-icons.js';
import { t } from './i18n.js';

export function createDetailProjectSelector({ getState, entryIds = [], getSelectedIds, getChildren, onChange, disabled = () => false }) {
  const element = document.createElement('div');
  const search = document.createElement('input');
  search.type = 'search'; search.placeholder = t('搜索项目名称或路径'); search.setAttribute('aria-label', search.placeholder);
  const list = document.createElement('div'); list.className = 'detail-project-list';
  list.setAttribute('role', 'tree'); list.setAttribute('aria-label', t('项目')); list.setAttribute('aria-multiselectable', String(!getSelectedIds));
  element.append(search, list); element.className = 'detail-project-selector';
  const expanded = new Set(), pending = new Set();
  let focusedId = '';
  let selectedKey = '';
  for (const project of getState().collections) {
    if (entryIds.some(id => project.entryIds.includes(id))) {
      for (const ancestor of collectionPath(getState(), project.id).slice(0, -1)) expanded.add(ancestor.id);
      focusedId ||= project.id;
    }
  }
  const focus = id => {
    const row = [...list.querySelectorAll('[role=treeitem]')].find(item => item.dataset.collectionId === id);
    if (row) { focusedId = id; for (const item of list.querySelectorAll('[role=treeitem]')) item.tabIndex = item === row ? 0 : -1; row.focus(); }
  };
  function render() {
    const hadFocus = list.contains(document.activeElement);
    const children = getChildren(), paths = collectionPathLabelsById(getState());
    const selectedIds = getSelectedIds?.() ?? [];
    if (getSelectedIds && JSON.stringify(selectedIds) !== selectedKey) {
      selectedKey = JSON.stringify(selectedIds);
      for (const id of selectedIds) {
        for (const ancestor of collectionPath(getState(), id).slice(0, -1)) expanded.add(ancestor.id);
      }
    }
    const query = search.value.trim();
    const rows = projectTreeRows(children, expanded, query, paths);
    const groups = new Map([[null, list]]);
    list.replaceChildren();
    if (!rows.some(({ collection }) => collection.id === focusedId)) focusedId = rows[0]?.collection.id || '';
    for (const { collection } of rows) {
      const row = document.createElement('div'); row.className = 'detail-project-tree-item';
      row.dataset.collectionId = collection.id; row.setAttribute('role', 'treeitem'); row.setAttribute('aria-label', paths.get(collection.id));
      row.tabIndex = collection.id === focusedId ? 0 : -1;
      const selectedCount = entryIds.filter(id => collection.entryIds.includes(id)).length;
      const selected = getSelectedIds ? selectedIds.includes(collection.id) : selectedCount === entryIds.length;
      const partial = !getSelectedIds && selectedCount > 0 && !selected;
      row.setAttribute('aria-checked', partial ? 'mixed' : String(selected));
      const branch = children.get(collection.id)?.length > 0;
      const open = Boolean(query) || expanded.has(collection.id);
      if (branch && !query) row.setAttribute('aria-expanded', String(open));
      const line = document.createElement('div'); line.className = 'detail-project-tree-line';
      const disclosure = document.createElement('button'); disclosure.type = 'button'; disclosure.className = 'project-disclosure'; disclosure.tabIndex = -1;
      disclosure.disabled = !branch || Boolean(query); disclosure.setAttribute('aria-label', t(open ? '收起项目' : '展开项目'));
      disclosure.append(createUiIcon(open ? 'chevron-down' : 'chevron-right'));
      disclosure.addEventListener('click', () => { focusedId = collection.id; open ? expanded.delete(collection.id) : expanded.add(collection.id); render(); focus(collection.id); });
      const label = document.createElement('label'); label.className = 'detail-project-option'; label.title = paths.get(collection.id);
      const checkbox = document.createElement('input'); checkbox.type = 'checkbox'; checkbox.checked = selected; checkbox.indeterminate = partial; checkbox.tabIndex = -1;
      checkbox.disabled = pending.has(collection.id) || disabled();
      checkbox.addEventListener('change', async () => {
        const checked = checkbox.checked; focusedId = collection.id; pending.add(collection.id); checkbox.disabled = true;
        try { await onChange(collection.id, checked, checkbox); }
        finally { pending.delete(collection.id); render(); }
      });
      const name = document.createElement('span'); name.textContent = query ? paths.get(collection.id) : collection.name;
      label.append(checkbox, name); line.append(disclosure, label); row.append(line);
      row.addEventListener('focus', () => { focusedId = collection.id; });
      if (query) list.append(row);
      else (groups.get(collection.parentId) || list).append(row);
      if (branch && open && !query) {
        const group = document.createElement('div'); group.setAttribute('role', 'group'); group.className = 'detail-project-tree-children';
        row.append(group); groups.set(collection.id, group);
      }
      row.addEventListener('keydown', event => {
        if (event.target !== row) return;
        const visible = [...list.querySelectorAll('[role=treeitem]')], at = visible.indexOf(row);
        let next;
        if (event.key === 'ArrowDown') next = visible[at + 1];
        else if (event.key === 'ArrowUp') next = visible[at - 1];
        else if (event.key === 'Home') next = visible[0];
        else if (event.key === 'End') next = visible.at(-1);
        else if (event.key === 'ArrowRight' && branch && !query) { if (!open) { expanded.add(collection.id); render(); focus(collection.id); } else next = visible[at + 1]; }
        else if (event.key === 'ArrowLeft' && !query) { if (branch && open) { expanded.delete(collection.id); render(); focus(collection.id); } else next = visible.find(item => item.dataset.collectionId === collection.parentId); }
        else if (event.key === ' ' || event.key === 'Enter') checkbox.click();
        else return;
        event.preventDefault(); event.stopPropagation();
        if (next) focus(next.dataset.collectionId);
      });
    }
    if (hadFocus) focus(focusedId);
  }
  search.addEventListener('input', render);
  search.addEventListener('keydown', event => { if (event.key === 'ArrowDown') { event.preventDefault(); focus(focusedId); } });
  element.addEventListener('keydown', event => {
    if (event.key !== 'Escape') return;
    const menu = element.closest('details');
    if (menu) { event.preventDefault(); event.stopPropagation(); menu.open = false; menu.querySelector('summary')?.focus(); }
  });
  render();
  return { element, render };
}
