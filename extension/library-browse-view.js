import { createUiIcon } from './ui-icons.js';
import { caseViewProjection } from './library-view.js';

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

export function appendCaseRowDetails(card, entry, { typeLabel, locale }) {
  if (!card.querySelector('img')) {
    card.classList.add('has-row-placeholder');
    const placeholder = document.createElement('span');
    placeholder.className = 'case-row-placeholder';
    placeholder.append(createUiIcon('file-text'));
    card.append(placeholder);
  }
  const details = document.createElement('div');
  details.className = 'case-row-details';
  const title = document.createElement('strong');
  title.className = 'case-row-title';
  title.textContent = entry.title;
  const type = document.createElement('span');
  type.className = 'case-row-type';
  type.textContent = typeLabel;
  const date = document.createElement('time');
  date.className = 'case-row-date';
  const saved = caseViewProjection(entry).addedAt;
  if (saved) {
    date.dateTime = saved;
    date.textContent = new Date(saved).toLocaleDateString(locale);
  }
  details.append(title, type, date);
  card.append(details);
}
