import { createUiIcon } from './ui-icons.js';
import { LIST_COLUMNS, formatListBytes } from './library-list.js';

// Navigation changes the scope; the existing case renderer owns filtering,
// selection and details in every view.
export function renderBrowseNavigation({ breadcrumb, path, selectedId, rootLabel, navigate, disabled }) {
  const button = (label, id, current = false) => {
    const item = document.createElement('button');
    item.type = 'button';
    item.disabled = disabled;
    item.className = 'browse-project-button';
    item.textContent = label;
    item.title = label;
    item.dataset.projectId = id;
    if (current) item.setAttribute('aria-current', 'page');
    item.addEventListener('click', () => navigate(id));
    return item;
  };
  breadcrumb.replaceChildren(button(rootLabel, '', !selectedId));
  for (const project of path.slice(0, -1)) {
    breadcrumb.append(createUiIcon('chevron-right'), button(project.name, project.id, project.id === selectedId));
  }
}

export function appendCaseRowDetails(card, entry, { metadata, locale }) {
  if (!card.querySelector('img')) {
    card.classList.add('has-row-placeholder');
    const placeholder = document.createElement('span');
    placeholder.className = 'case-row-placeholder';
    placeholder.append(createUiIcon('file-text'));
    card.append(placeholder);
  }
  const details = document.createElement('div');
  details.className = 'case-row-details';
  for (const [key] of LIST_COLUMNS) {
    const cell = document.createElement(key === 'title' ? 'strong' : key === 'added' ? 'time' : 'span');
    cell.className = `case-row-${key}`;
    cell.dataset.column = key;
    const value = metadata[key];
    if (key === 'added' && value) {
      cell.dateTime = value;
      cell.textContent = new Date(value).toLocaleDateString(locale);
    } else if (key === 'size') {
      cell.textContent = metadata.size == null && metadata.knownBytes ? `≥ ${formatListBytes(metadata.knownBytes, locale)}` : formatListBytes(value, locale);
    } else cell.textContent = value === '' || value == null ? '—' : String(value);
    cell.title = cell.textContent;
    details.append(cell);
  }
  card.append(details);
}
