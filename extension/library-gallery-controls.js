import { createUiIcon } from './ui-icons.js';
import { t } from './i18n.js';
import { gallerySizesForZoom } from './preferences.js';
import { caseSortColumn } from './library-view.js';
import { LIST_COLUMNS, listColumnTemplate } from './library-list.js';

export function createGalleryControls({ getPreferences, onSort, onSize, onSizeCommit, onColumns }) {
  const shell = document.querySelector('.gallery-shell');
  const header = document.querySelector('#case-list-header');
  const scroll = document.querySelector('.case-table-scroll');
  const columns = document.createElement('div');
  columns.className = 'case-list-columns';
  columns.setAttribute('role', 'row');
  const buttons = new Map();
  for (const [key, label] of LIST_COLUMNS) {
    const cell = document.createElement('div');
    cell.dataset.column = key;
    cell.setAttribute('role', 'columnheader');
    const button = document.createElement('button');
    button.type = 'button'; button.textContent = t(label); button.dataset.sortColumn = key;
    button.addEventListener('click', () => onSort(key));
    cell.append(button); columns.append(cell); buttons.set(key, { cell, button, label });
  }
  header.append(columns);
  const menu = document.querySelector('#list-column-menu');
  const panel = document.createElement('div'); panel.className = 'list-column-panel';
  for (const [key, label] of LIST_COLUMNS.filter(([key]) => key !== 'title')) {
    const row = document.createElement('label');
    const input = document.createElement('input'); input.type = 'checkbox'; input.dataset.listColumn = key;
    input.addEventListener('change', () => {
      const hidden = [...panel.querySelectorAll('input:not(:checked)')].map(item => item.dataset.listColumn);
      onColumns(hidden);
    });
    row.append(input, document.createTextNode(t(label))); panel.append(row);
  }
  menu.append(panel);
  scroll.addEventListener('scroll', () => { header.scrollLeft = scroll.scrollLeft; }, { passive: true });
  document.addEventListener('click', event => { if (!menu.contains(event.target)) menu.open = false; });
  menu.addEventListener('keydown', event => { if (event.key === 'Escape') { menu.open = false; menu.querySelector('summary').focus(); } });
  const range = document.querySelector('#gallery-size');
  range.addEventListener('input', () => onSize(Number(range.value)));
  range.addEventListener('change', () => onSizeCommit(Number(range.value)));
  range.addEventListener('dblclick', event => {
    event.preventDefault(); onSize(50); onSizeCommit(50);
  });
  function applySize() {
    const preferences = getPreferences(), sizes = gallerySizesForZoom(preferences.galleryZoom);
    range.min = 0; range.max = 100; range.value = preferences.galleryZoom;
    range.setAttribute('aria-valuetext', `${preferences.galleryZoom}%`);
    shell.style.setProperty('--masonry-card-min-width', `${sizes.waterfall}px`);
    shell.style.setProperty('--list-thumb', `${sizes.list}px`);
  }
  return {
    applySize,
    sync(sortMode, hasCases = true) {
      const preferences = getPreferences(); applySize();
      header.hidden = menu.hidden = preferences.galleryView !== 'list' || !hasCases;
      const hidden = preferences.galleryHiddenColumns;
      shell.dataset.hiddenColumns = hidden.join(' ');
      shell.style.setProperty('--list-columns', listColumnTemplate(hidden));
      // Minimum readable columns plus thumbnail/padding; narrower windows scroll horizontally.
      const minimums = { title: 150, type: 70, count: 52, tags: 120, source: 90, size: 78, added: 100 };
      shell.style.setProperty('--list-min-width', `${LIST_COLUMNS.filter(([key]) => !hidden.includes(key)).reduce((sum, [key]) => sum + minimums[key] + 12, 0)}px`);
      for (const input of panel.querySelectorAll('input')) input.checked = !hidden.includes(input.dataset.listColumn);
      for (const [key, { cell, button, label }] of buttons) {
        const active = caseSortColumn(sortMode) === key;
        cell.setAttribute('aria-sort', active ? sortMode.endsWith('-desc') ? 'descending' : 'ascending' : 'none');
        button.replaceChildren(document.createTextNode(t(label)));
        if (active) button.append(createUiIcon(sortMode.endsWith('-desc') ? 'arrow-down' : 'arrow-up'));
      }
    }
  };
}
