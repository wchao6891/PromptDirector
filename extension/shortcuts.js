import { SHORTCUT_COMMANDS, shortcutBindings, shortcutConflict, shortcutForEvent, formatShortcut } from './keyboard-shortcuts.js';
import { feedbackIcon } from './review-feedback.js';
import { t } from './i18n.js';

export function mountShortcutSettings(root, preferences, chromeApi = chrome) {
let values = shortcutBindings(preferences.shortcuts);
const container = root.querySelector('#shortcut-groups'), status = root.querySelector('#shortcut-feedback');
const labels = { review: '审片', feedback: '创作备注', detail: '案例详情', library: '案例库' };
function render() {
  container.replaceChildren();
  for (const [scope, label] of Object.entries(labels)) {
    const section = document.createElement('section'); section.className = 'shortcut-group';
    section.setAttribute('aria-label', t(label));
    for (const command of SHORTCUT_COMMANDS.filter(item => item.scope === scope)) {
      const row = document.createElement('div'); row.className = 'shortcut-row';
      const name = document.createElement('label'); name.textContent = t(command.label); name.htmlFor = `shortcut-${command.id}`;
      const input = document.createElement('input'); input.readOnly = true; input.id = name.htmlFor; input.value = formatShortcut(values[command.id]); input.placeholder = t('未设置'); input.title = `${t('默认')} · ${formatShortcut(command.key) || t('未设置')}`;
      input.addEventListener('keydown', event => {
        if (event.isComposing || event.keyCode === 229) return;
        if (input.dataset.recording !== 'true') {
          if (['Enter', ' '].includes(event.key)) { event.preventDefault(); input.dataset.recording = 'true'; input.value = ''; input.placeholder = t('按下新的按键'); }
          return;
        }
        event.preventDefault();
        const key = shortcutForEvent(event); if (!key) return;
        values[command.id] = key; input.dataset.recording = 'false'; input.value = formatShortcut(key); input.placeholder = t('未设置'); status.textContent = '';
      });
      input.addEventListener('click', () => { input.dataset.recording = 'true'; input.value = ''; input.placeholder = t('按下新的按键'); });
      input.addEventListener('blur', () => { input.dataset.recording = 'false'; input.value = formatShortcut(values[command.id]); input.placeholder = t('未设置'); });
      const clear = feedbackIcon('清除按键', 'x', t); clear.addEventListener('click', () => { values[command.id] = ''; input.value = ''; });
      row.append(name, input, clear); section.append(row);
    }
    container.append(section);
  }
}
root.querySelector('#shortcut-reset').addEventListener('click', () => { values = shortcutBindings(); render(); status.textContent = ''; });
root.querySelector('#shortcut-form').addEventListener('submit', async event => {
  event.preventDefault();
  const conflict = shortcutConflict(values);
  if (conflict) { status.textContent = `${t(conflict[0].label)} / ${t(conflict[1].label)}：${t('按键重复')}`; status.classList.add('is-error'); return; }
  const button = root.querySelector('button[type=submit]'); button.disabled = true;
  try {
    const result = await chromeApi.runtime.sendMessage({ type: 'UPDATE_KEYBOARD_SHORTCUTS', shortcuts: values });
    if (result?.ok === false) throw new Error(result.message || t('保存失败'));
    status.textContent = t('已保存'); status.classList.remove('is-error');
  } catch (error) { status.textContent = error.message; status.classList.add('is-error'); }
  finally { button.disabled = false; }
});
render();

}
