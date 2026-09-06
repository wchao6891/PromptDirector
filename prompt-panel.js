import { renderMarkdownDocument } from "./markdown-renderer.js";
import { createUiIcon } from "./ui-icons.js";
import { preserveElementPosition, readingInset } from "./detail-position.js";

const expandedPanels = new Set();

export function promptIconButton(label, icon) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "button-secondary prompt-icon-action";
  button.title = label;
  button.setAttribute("aria-label", label);
  button.append(createUiIcon(icon));
  return button;
}

export function createPromptPanel({ key, title, text, className = "", actions = [], onSave, onError, t, markdown = false, editLabel = "编辑", editorClass = "" }) {
  const panel = document.createElement("article");
  panel.className = `prompt-content-panel ${className}`;
  panel.dataset.promptKey = key;
  const heading = document.createElement("div");
  heading.className = "prompt-section-heading";
  const label = document.createElement("h3");
  label.textContent = title;
  label.tabIndex = -1;
  const toolbar = document.createElement("div");
  toolbar.className = "prompt-toolbar";
  const edit = promptIconButton(t(editLabel), "pencil");
  toolbar.append(...actions, edit);
  heading.append(label, toolbar);
  const body = markdown ? renderMarkdownDocument(text) : document.createElement("pre");
  if (!markdown) body.textContent = text;
  body.classList.add("prompt-text", "prompt-read-body");
  const fold = document.createElement("button");
  fold.type = "button";
  fold.className = "button-secondary prompt-expand";
  fold.hidden = true;
  const updateFold = () => {
    if (panel.isConnected) heading.style.scrollMarginTop = `${readingInset(panel)}px`;
    const expanded = expandedPanels.has(key);
    body.classList.toggle("is-expanded", expanded);
    fold.textContent = t(expanded ? "收起" : "展开全文");
    fold.setAttribute("aria-expanded", String(expanded));
    fold.hidden = body.hidden || (!expanded && body.scrollHeight <= body.clientHeight + 1);
  };
  fold.addEventListener("click", () => {
    const collapsing = expandedPanels.has(key);
    const restore = preserveElementPosition(label, { reveal: collapsing });
    if (collapsing) expandedPanels.delete(key);
    else expandedPanels.add(key);
    updateFold();
    restore();
    if (collapsing) label.focus({ preventScroll: true });
  });
  const editor = document.createElement("textarea");
  editor.className = `prompt-text prompt-editor ${editorClass}`;
  editor.hidden = true;
  editor.rows = 7;
  editor.value = text;
  editor.setAttribute("aria-label", t(editLabel));
  const editActions = document.createElement("div");
  editActions.className = "prompt-edit-actions";
  editActions.hidden = true;
  const save = document.createElement("button");
  save.type = "button";
  save.textContent = t("保存");
  save.disabled = true;
  const cancel = document.createElement("button");
  cancel.type = "button";
  cancel.className = "button-secondary";
  cancel.textContent = t("取消");
  const setEditing = editing => {
    const restore = preserveElementPosition(label, { reveal: true });
    panel.dataset.editing = String(editing);
    body.hidden = editing;
    editor.hidden = !editing;
    editActions.hidden = !editing;
    toolbar.hidden = editing;
    updateFold();
    restore();
    if (editing) editor.focus({ preventScroll: true });
  };
  edit.addEventListener("click", () => setEditing(true));
  editor.addEventListener("input", () => {
    save.disabled = editor.value.trim() === text.trim();
    panel.dataset.dirty = String(!save.disabled);
  });
  cancel.addEventListener("click", () => {
    editor.value = text;
    save.disabled = true;
    setEditing(false);
    panel.dataset.dirty = "false";
    edit.focus({ preventScroll: true });
    panel.dispatchEvent(new CustomEvent("prompt-edit-finished", { bubbles: true }));
  });
  save.addEventListener("click", async () => {
    save.disabled = true;
    cancel.disabled = true;
    try {
      await onSave(editor.value);
      panel.dataset.dirty = "false";
      setEditing(false);
      edit.focus({ preventScroll: true });
      panel.dispatchEvent(new CustomEvent("prompt-edit-finished", { bubbles: true }));
    }
    catch (error) { onError(error); }
    finally { save.disabled = editor.value.trim() === text.trim(); cancel.disabled = false; }
  });
  editActions.append(save, cancel);
  panel.append(heading, body, fold, editor, editActions);
  requestAnimationFrame(() => {
    if (!panel.isConnected) return;
    updateFold();
    const observer = new ResizeObserver(() => {
      if (!panel.isConnected) observer.disconnect();
      else updateFold();
    });
    observer.observe(body);
  });
  return panel;
}
