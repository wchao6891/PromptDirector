import { createUiIcon } from './ui-icons.js';
import { installPanelDrag, createPanelDragHandle } from './panel-drag.js';
import { savedPanelPosition, savePanelPosition } from './panel-position.js';

export function reviewTime(ms) {
  const seconds = Math.max(0, Number(ms) || 0) / 1000;
  return `${Math.floor(seconds / 60)}:${(seconds % 60).toFixed(2).padStart(5, '0')}`;
}
export function feedbackIcon(label, icon, t = value => value) {
  const button = document.createElement('button'); button.type = 'button'; button.className = 'icon-button';
  button.title = t(label); button.setAttribute('aria-label', t(label)); button.append(createUiIcon(icon)); return button;
}

// Retain earlier authored content without recreating the removed five-field
// editor. Videos show these values inside their single feedback surface.
export function mountAuthoredNotes(container, entry, t = value => value) {
  container.querySelector('.review-authored-notes')?.remove();
  if (entry.mediaAssets?.some(asset => asset.kind === 'video') || !Object.values(entry.creative || {}).some(value => value?.trim?.())) return;
  const section = document.createElement('details'); section.className = 'detail-section review-authored-notes';
  const heading = document.createElement('summary'); heading.textContent = t('创作备注'); section.append(heading);
  for (const value of Object.values(entry.creative)) {
    if (!value?.trim?.()) continue;
    const text = document.createElement('p'); text.textContent = value; section.append(text);
  }
  container.append(section);
}

// One feedback surface for stored videos and temporary outputs. Persistence is
// supplied by their respective services; neither edits reference material.
export function mountReviewFeedback({ container, notes = [], authored = {}, timed = true, getPosition, getRange, seek, saveNote, removeNote, t = value => value, changed = () => {} }) {
  const panel = document.createElement('section'); panel.className = 'review-feedback-panel ui-floating-panel ui-scrollbar'; panel.hidden = true;
  panel.setAttribute('aria-label', t('创作备注')); container.replaceChildren(panel);
  const header = document.createElement('header');
  const title = document.createElement('strong'); title.textContent = t('创作备注');
  const close = feedbackIcon('收起备注', 'x', t); header.append(createPanelDragHandle(t), title, close);
  const list = document.createElement('div'); list.className = 'review-feedback-list';
  const form = document.createElement('form'); form.className = 'review-feedback-form';
  const text = document.createElement('textarea'); text.rows = 3; text.name = 'reviewFeedback'; text.placeholder = t('哪里好，哪里需要调整？'); text.setAttribute('aria-label', t('备注内容'));
  const footer = document.createElement('footer');
  const times = document.createElement('div'); times.className = 'review-feedback-time';
  const start = document.createElement('input'); start.type = 'number'; start.min = '0'; start.step = 'any'; start.setAttribute('aria-label', t('开始时间（秒）')); start.title = t('开始时间（秒）');
  const end = start.cloneNode(); end.setAttribute('aria-label', t('结束时间（秒）')); end.title = t('结束时间（秒）'); end.hidden = true;
  const separator = document.createElement('span'); separator.textContent = '–'; separator.hidden = true; times.append(start, separator, end);
  const useRange = feedbackIcon('使用入出点区间', 'brackets', t); useRange.hidden = true;
  useRange.addEventListener('click', () => {
    const range = getRange?.();
    if (!validRange(range)) return;
    rangeMode = true; stamped = true;
    start.value = String(Math.round(range.startMs) / 1000);
    end.hidden = separator.hidden = false; end.value = String(Math.round(range.endMs) / 1000);
    changed();
  });
  const save = document.createElement('button'); save.type = 'submit'; save.textContent = t('保存'); save.title = t('保存备注'); save.className = 'review-feedback-save';
  const refreshTime = feedbackIcon('刷新时间', 'refresh-cw', t);
  refreshTime.dataset.reviewRefreshTime = '';
  times.hidden = refreshTime.hidden = !timed;
  refreshTime.addEventListener('click', async () => {
    if (busy) return;
    refreshTime.disabled = true;
    stamped = true; stampPromise = useCurrentTime();
    try { await stampPromise; } finally { refreshTime.disabled = false; }
  });
  footer.append(times, useRange, refreshTime, save); form.append(text, footer);
  const status = document.createElement('p'); status.className = 'review-feedback-status'; status.setAttribute('role', 'status');
  panel.append(header, list, form, status);
  let currentNotes = notes, busy = false, editingId = null, rangeMode = false, stamped = true, stampPromise = Promise.resolve(), openIntent = 0;
  const dirty = () => Boolean(text.value.trim());
  const updateDirty = () => { form.dataset.dirty = String(dirty()); changed(); };
  form.addEventListener('input', event => {
    if (event.target === text && !stamped && !rangeMode) { stamped = true; stampPromise = useCurrentTime(); }
    if (event.target === start || event.target === end) stamped = true;
    updateDirty();
  });
  function validRange(range) { return Number.isFinite(range?.startMs) && Number.isFinite(range?.endMs) && range.endMs > range.startMs; }
  async function useCurrentTime() {
    rangeMode = false; end.hidden = separator.hidden = true; end.value = '';
    try { start.value = String(Math.round(await getPosition()) / 1000); }
    catch (error) { report(error); }
    useRange.hidden = !validRange(getRange?.()); changed();
  }
  const position = installFeedbackPosition(panel, header, report);
  function renderList() {
    list.replaceChildren();
    for (const note of currentNotes) {
      const row = document.createElement('div'); row.className = 'review-feedback-row';
      const jump = document.createElement('button'); jump.type = 'button'; jump.className = 'button-secondary review-feedback-jump';
      jump.textContent = `${reviewTime(note.startMs)}${note.endMs !== undefined ? `–${reviewTime(note.endMs)}` : ''}`;
      jump.addEventListener('click', () => { void Promise.resolve(seek(note.startMs)).catch(error => report(error)); });
      const content = document.createElement('p'); content.textContent = note.text;
      const remove = feedbackIcon('删除备注', 'trash-2', t); remove.classList.add('quiet-danger');
      remove.addEventListener('click', async () => {
        if (busy) return; remove.disabled = true;
        try { const next = await removeNote(note.id); currentNotes = next; renderList(); changed(); }
        catch (error) { report(error); remove.disabled = false; }
      });
      if (timed) row.append(jump);
      row.append(content, remove); list.append(row);
    }
    const labels = { prompt: '创作提示词', summary: '提炼', notes: '备注', purpose: '用途', plan: '方案' };
    for (const [key, value] of Object.entries(authored)) {
      if (!value?.trim?.()) continue;
      const row = document.createElement('div'); row.className = 'review-feedback-authored';
      const label = document.createElement('small'); label.textContent = t(labels[key] || key);
      const content = document.createElement('p'); content.textContent = value; row.append(label, content); list.append(row);
    }
  }
  function report(error) { status.textContent = t(error.message || '保存失败'); status.classList.add('is-error'); }
  async function open() {
    const intent = ++openIntent;
    if (!dirty()) {
      rangeMode = false; stamped = true;
      const range = getRange?.();
      try { start.value = String(Math.round(await getPosition()) / 1000); }
      catch (error) { start.value = ''; report(error); }
      end.hidden = separator.hidden = true; end.value = '';
      useRange.hidden = !validRange(range);
    }
    try { await position.restore(); } catch (error) { report(error); }
    if (intent !== openIntent) return;
    panel.hidden = false;
    position.place(); text.focus({ preventScroll: true }); changed();
  }
  function hide() { openIntent++; panel.hidden = true; changed(); } // Draft remains intact when folded.
  close.addEventListener('click', hide);
  async function submit() {
    if (busy || !dirty()) return;
    await stampPromise;
    if (busy) return;
    if (!text.value.trim()) return report(new Error('请填写备注'));
    if (start.value === '' || !start.checkValidity() || !end.checkValidity() || !end.hidden && Number(end.value) <= Number(start.value)) return report(new Error('请填写有效时间'));
    busy = true; save.disabled = true; refreshTime.disabled = true; useRange.disabled = true; text.disabled = true; close.disabled = true;
    editingId ||= `note:${crypto.randomUUID()}`;
    try {
      const note = { id: editingId, startMs: Math.round(Number(start.value) * 1000), text: text.value,
        ...(!end.hidden ? { endMs: Math.round(Number(end.value) * 1000) } : {}) };
      currentNotes = await saveNote(note);
      editingId = null; text.value = ''; stamped = false; rangeMode = false; end.hidden = separator.hidden = true; end.value = ''; updateDirty(); status.textContent = ''; status.classList.remove('is-error'); renderList();
    } catch (error) { report(error); }
    finally { busy = false; save.disabled = false; refreshTime.disabled = false; useRange.disabled = false; text.disabled = false; close.disabled = false; text.focus({ preventScroll: true }); changed(); }
  }
  form.addEventListener('submit', event => { event.preventDefault(); void submit(); });
  renderList();
  return { open, hide, save: submit, panel, useCurrentTime, refreshTime: () => refreshTime.click(),
    newline() { text.setRangeText('\n', text.selectionStart, text.selectionEnd, 'end'); updateDirty(); },
    dispose() { openIntent++; position.dispose(); },
    update(value, annotations = authored) { currentNotes = value; authored = annotations; renderList(); },
    getState: () => ({ open: !panel.hidden, notes: currentNotes, draft: text.value, dirty: dirty(), saving: busy,
      startMs: start.value === '' ? null : Number(start.value) * 1000, endMs: end.hidden ? null : Number(end.value) * 1000 }),
    setSaveShortcut(key) { save.title = `${t('保存备注')}${key ? ` · ${key}` : ''}`; key ? save.setAttribute('aria-keyshortcuts', key) : save.removeAttribute('aria-keyshortcuts'); }
  };
}

// Keep feedback above the media toolbar; moving the header never drags a case.
function installFeedbackPosition(panel, header, failed) {
  let offset = null, saved = null, disposed = false;
  const parent = panel.parentElement;
  parent?.classList.add('ui-floating-panel-positioner');
  function place() {
    if (panel.hidden || !parent?.getBoundingClientRect) return;
    const root = parent.closest('.detail-visual-gallery, #temporary-review-dialog');
    const bounds = root.getBoundingClientRect();
    const toolbar = root.querySelector('.detail-visual-caption, #temporary-review-actions');
    const limit = Math.min(bounds.height, toolbar ? toolbar.getBoundingClientRect().top - bounds.top : bounds.height);
    const gap = Number.parseFloat(getComputedStyle(panel).paddingTop);
    const close = root.closest('#detail-drawer, #temporary-review-dialog')?.querySelector('#detail-close, #temporary-review-close');
    const top = Math.max(gap, close ? close.getBoundingClientRect().bottom - bounds.top + gap : gap);
    panel.style.maxHeight = `${Math.max(0, limit - top - gap)}px`;
    const width = panel.getBoundingClientRect().width;
    const height = panel.getBoundingClientRect().height;
    const x = Math.max(gap, Math.min(offset?.x ?? (saved ? saved.left * window.innerWidth - bounds.left : bounds.width - width - gap), bounds.width - width - gap));
    const y = Math.max(top, Math.min(offset?.y ?? (saved ? saved.top * window.innerHeight - bounds.top : top), limit - height - gap));
    parent.style.inset = 'auto'; parent.style.left = `${x}px`; parent.style.top = `${y}px`;
    return { left: bounds.left + x, top: bounds.top + y };
  }
  const releaseDrag = installPanelDrag(header, {
    getPosition: () => ({ left: Number.parseFloat(parent.style.left), top: Number.parseFloat(parent.style.top) }),
    setPosition({ left, top }) { offset = { x: left, y: top }; return place(); },
    onEnd(position) {
      const rect = position;
      saved = { left: rect.left / window.innerWidth, top: rect.top / window.innerHeight }; offset = null;
      void savePanelPosition('reviewFeedback', panel, position).catch(failed);
    }
  });
  const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(place) : null;
  if (parent) observer?.observe(panel);
  const root = parent?.closest?.('.detail-visual-gallery, #temporary-review-dialog');
  if (root) observer?.observe(root);
  return { place, async restore() { const value = await savedPanelPosition('reviewFeedback'); if (!disposed && !offset) saved = value; },
    dispose() { disposed = true; observer?.disconnect(); releaseDrag(); } };
}
