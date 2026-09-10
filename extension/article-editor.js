import { ARTICLE_TEXT_KINDS } from "./article-edit.js";
import { preserveElementPosition } from "./detail-position.js";
import { renderArticleBlockText } from "./article-text-view.js";
import { createUiIcon } from "./ui-icons.js";

export function attachArticleEditor(reader, entry, { onSave, onError, onCopy, contextParts = [], t }) {
  const toolbar = document.createElement("div");
  toolbar.className = "article-editor-toolbar";
  const context = document.createElement("span");
  context.className = "article-reader-context";
  for (const text of contextParts.length ? contextParts : [t("正文")]) {
    const part = document.createElement("span");
    part.textContent = text;
    context.append(part);
  }
  toolbar.append(context);
  const copy = iconButton("复制文字", "copy");
  copy.disabled = !entry.text;
  copy.addEventListener("click", () => onCopy(copy));
  const edit = iconButton("编辑正文", "pencil");
  const save = button("保存");
  const cancel = button("取消", "button-secondary");
  save.hidden = cancel.hidden = true;
  toolbar.append(copy, edit, save, cancel);
  reader.prepend(toolbar);
  reader.dataset.articleIdentity = JSON.stringify(entry.articleDocument);
  let blocks = entry.articleDocument.blocks;
  let saving = false;
  const textNodes = () => [...reader.querySelectorAll('[data-article-block-id]')];
  const setEditing = editing => {
    reader.dataset.editing = String(editing);
    edit.hidden = editing;
    copy.hidden = editing;
    save.hidden = cancel.hidden = !editing;
    for (const node of textNodes()) {
      const block = blocks.find(item => item.id === node.dataset.articleBlockId);
      if (block?.kind === "list") renderArticleBlockText(node, block, { editing });
      node.contentEditable = editing ? "plaintext-only" : "false";
      if (editing) {
        node.setAttribute("role", "textbox");
        node.setAttribute("aria-label", t("编辑正文段落"));
        node.setAttribute("aria-multiline", "true");
      } else {
        node.removeAttribute("role");
        node.removeAttribute("aria-label");
        node.removeAttribute("aria-multiline");
      }
    }
  };
  const setSaving = value => {
    saving = value;
    reader.setAttribute("aria-busy", String(value));
    save.disabled = value || reader.dataset.dirty !== "true";
    cancel.disabled = value;
    for (const node of textNodes()) {
      node.contentEditable = !value && reader.dataset.editing === "true" ? "plaintext-only" : "false";
      if (value) node.setAttribute("aria-readonly", "true");
      else node.removeAttribute("aria-readonly");
    }
  };
  const resetText = () => {
    for (const node of textNodes()) {
      const block = blocks.find(item => item.id === node.dataset.articleBlockId);
      if (block) renderArticleBlockText(node, block, { editing: reader.dataset.editing === "true" });
      else node.remove();
    }
    reader.dataset.dirty = "false";
  };
  edit.addEventListener("click", () => { setEditing(true); save.disabled = true; });
  reader.addEventListener("input", event => {
    if (saving || !event.target.closest('[data-article-block-id]')) return;
    reader.dataset.dirty = "true";
    save.disabled = false;
  });
  cancel.addEventListener("click", () => {
    resetText();
    setEditing(false);
    edit.focus({ preventScroll: true });
  });
  save.addEventListener("click", async () => {
    if (saving) return;
    const restore = preserveElementPosition(toolbar);
    setSaving(true);
    const patches = textNodes().flatMap(node => {
      const block = blocks.find(item => item.id === node.dataset.articleBlockId);
      const text = node.innerText.replace(/\r\n?/gu, "\n");
      return ARTICLE_TEXT_KINDS.has(block?.kind) && text !== block.text ? [{ blockId: block.id, text }] : [];
    });
    try {
      const updated = await onSave(patches);
      blocks = updated.articleDocument.blocks;
      reader.dataset.articleIdentity = JSON.stringify(updated.articleDocument);
      resetText();
      setEditing(false);
      restore();
      edit.focus({ preventScroll: true });
    } catch (error) { onError(error); }
    finally { setSaving(false); }
  });
  function button(label, className = "") {
    const node = document.createElement("button");
    node.type = "button";
    node.textContent = t(label);
    node.className = className;
    return node;
  }
  function iconButton(label, icon) {
    const node = button(label, "button-secondary prompt-icon-action");
    node.title = t(label);
    node.setAttribute("aria-label", t(label));
    node.replaceChildren(createUiIcon(icon));
    return node;
  }
}
