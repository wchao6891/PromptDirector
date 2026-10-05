import { t } from "./i18n.js";
import { createUiIcon } from "./ui-icons.js";
import { installPanelDrag, placePanelInViewport, createPanelDragHandle } from './panel-drag.js';
import { savedPanelPosition, savePanelPosition } from './panel-position.js';

export function normalizeTagValue(value) {
  return String(value ?? "").normalize("NFKC")
    .replace(/[\u0000-\u001f\u007f]/gu, "")
    .replace(/\s+/gu, " ")
    .trim()
    .replace(/^[,，;；]+|[,，;；]+$/gu, "")
    .trim();
}

export function normalizeTagValues(values = []) {
  const result = [];
  const keys = new Set();
  for (const source of Array.isArray(values) ? values : splitTagInput(values)) {
    const value = normalizeTagValue(source);
    const key = value.toLocaleLowerCase();
    if (!value || keys.has(key)) continue;
    keys.add(key);
    result.push(value);
  }
  return result;
}

export function addTagValues(current = [], additions = []) {
  return normalizeTagValues([...normalizeTagValues(current), ...normalizeTagValues(additions)]);
}

export function splitTagInput(value) {
  return String(value ?? "").split(/[,，;；\n\r]+/u);
}

export function createTagEditor(options = {}) {
  const root = document.createElement("div");
  root.className = ["tag-editor", options.className].filter(Boolean).join(" ");
  const chips = document.createElement("div");
  chips.className = "tag-editor-chips";
  const row = document.createElement("div");
  row.className = "tag-editor-row";
  const input = document.createElement("input");
  input.type = "text";
  input.autocomplete = "off";
  input.placeholder = options.placeholder || t("输入标签，按回车或逗号添加");
  input.setAttribute("aria-label", options.inputLabel || t("添加标签"));
  const add = document.createElement("button");
  add.type = "button";
  add.className = "button-secondary";
  add.textContent = options.addLabel || t("添加");
  row.append(input, add);
  root.append(chips, row);
  let toggle;
  if (options.compact) {
    root.classList.add('tag-editor-compact'); row.hidden = true;
    toggle = document.createElement('button'); toggle.type = 'button'; toggle.className = 'button-secondary prompt-icon-action';
    toggle.title = t('添加标签'); toggle.setAttribute('aria-label', t('添加标签')); toggle.setAttribute('aria-expanded', 'false');
    toggle.append(createUiIcon('plus')); root.insertBefore(toggle, row);
    row.classList.add('detail-project-popover', 'ui-floating-panel');
    add.textContent = ''; add.classList.add('prompt-icon-action'); add.title = t('添加标签'); add.setAttribute('aria-label', t('保存标签')); add.append(createUiIcon('check'));
    input.placeholder = t('添加标签');
    const handle = createPanelDragHandle(t); row.prepend(handle);
    const reportPositionError = error => {
      input.setCustomValidity(t(error.message)); input.reportValidity(); input.setCustomValidity('');
    };
    let intent = 0;
    installPanelDrag(handle, {
      getPosition() { const rect = row.getBoundingClientRect(); return { left: rect.left, top: rect.top }; },
      setPosition(position) { intent++; return placePanelInViewport(row, position); },
      onEnd(position) { void savePanelPosition('tagEditor', row, position).catch(reportPositionError); }
    });
    const open = async value => {
      const currentIntent = ++intent;
      row.hidden = !value; toggle.setAttribute('aria-expanded', String(value));
      if (value) {
        const rect = row.getBoundingClientRect(); placePanelInViewport(row, { left: rect.left, top: rect.top }); input.focus();
        try {
          const saved = await savedPanelPosition('tagEditor');
          if (saved && intent === currentIntent && !row.hidden && row.isConnected) placePanelInViewport(row, { left: saved.left * window.innerWidth, top: saved.top * window.innerHeight });
        } catch (error) { reportPositionError(error); }
      } else toggle.focus();
    };
    toggle.addEventListener('click', () => { input.setCustomValidity(''); void open(row.hidden); });
    input.addEventListener('keydown', event => { if (event.key === 'Escape' && !event.isComposing) { event.preventDefault(); event.stopPropagation(); open(false); } });
  }

  let values = normalizeTagValues(options.values);
  let pendingChanges = 0;
  let changeQueue = Promise.resolve(true);

  const render = () => {
    chips.hidden = values.length === 0;
    chips.replaceChildren(...values.map((value) => {
      const chip = document.createElement("span");
      chip.className = "tag-editor-chip";
      const text = document.createElement("span");
      text.textContent = value;
      const remove = document.createElement("button");
      remove.type = "button";
      remove.textContent = "×";
      remove.setAttribute("aria-label", t("删除标签：{value}", { value }));
      remove.addEventListener("click", () => void applyValues(values.filter((item) => item !== value), remove));
      chip.append(text, remove);
      return chip;
    }));
  };

  const applyValues = (nextValue, trigger) => {
    const previous = values;
    const next = normalizeTagValues(nextValue);
    if (sameValues(previous, next)) return Promise.resolve(true);
    values = next;
    render();
    pendingChanges += 1;
    root.setAttribute("aria-busy", "true");
    const requested = [...next];
    const run = async () => {
      try {
        const accepted = await options.onChange?.(requested, trigger);
        if (accepted === false) {
          if (sameValues(values, requested)) {
            values = previous;
            render();
          }
          return false;
        }
        return true;
      } catch {
        if (sameValues(values, requested)) {
          values = previous;
          render();
        }
        return false;
      } finally {
        pendingChanges -= 1;
        if (pendingChanges === 0) root.removeAttribute("aria-busy");
      }
    };
    changeQueue = changeQueue.then(run, run);
    return changeQueue;
  };

  const syncDraft = () => { if (options.compact) root.dataset.dirty = String(Boolean(input.value.trim())); };
  input.addEventListener("input", syncDraft);

  const commit = async () => {
    const additions = normalizeTagValues(splitTagInput(input.value));
    if (!additions.length) {
      input.focus();
      return false;
    }
    const changed = await applyValues(addTagValues(values, additions), add);
    if (changed) input.value = "";
    syncDraft();
    input.focus();
    return changed;
  };

  add.addEventListener("click", () => void commit());
  input.addEventListener("keydown", (event) => {
    if (event.isComposing || !["Enter", ",", "，"].includes(event.key)) return;
    event.preventDefault();
    void commit();
  });
  input.addEventListener("input", () => {
    if (!/[,，\n\r]/u.test(input.value)) return;
    const parts = input.value.split(/[,，\n\r]+/u);
    input.value = parts.pop() ?? "";
    syncDraft();
    const additions = normalizeTagValues(parts);
    if (additions.length) void applyValues(addTagValues(values, additions), add);
  });

  render();
  return {
    element: root,
    input,
    button: add,
    get values() { return [...values]; },
    setValues(next) {
      values = normalizeTagValues(next);
      render();
    },
    setDisabled(disabled) {
      input.disabled = Boolean(disabled);
      add.disabled = Boolean(disabled);
      if (toggle) toggle.disabled = Boolean(disabled);
      chips.querySelectorAll("button").forEach((button) => { button.disabled = Boolean(disabled); });
    },
    commit,
    async flush() {
      if (await changeQueue === false) return false;
      return input.value.trim() ? commit() : true;
    }
  };
}

function sameValues(left, right) {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}
