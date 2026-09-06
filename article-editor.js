import { ARTICLE_TEXT_KINDS } from "./article-edit.js";
import { preserveElementPosition } from "./detail-position.js";

export function attachArticleEditor(reader, entry, { onSave, onError, t }) {
  const toolbar = document.createElement("div");
  toolbar.className = "article-editor-toolbar";
  const edit = button("编辑正文", "button-secondary");
  const save = button("保存");
  const cancel = button("取消", "button-secondary");
  save.hidden = cancel.hidden = true;
  toolbar.append(edit, save, cancel);
  reader.prepend(toolbar);
  reader.dataset.articleIdentity = JSON.stringify(entry.articleDocument);
  let blocks = entry.articleDocument.blocks;
  const textNodes = () => [...reader.querySelectorAll('[data-article-block-id]')];
  const setEditing = editing => {
    reader.dataset.editing = String(editing);
    edit.hidden = editing;
    save.hidden = cancel.hidden = !editing;
    for (const node of textNodes()) {
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
  const resetText = () => {
    for (const node of textNodes()) {
      const block = blocks.find(item => item.id === node.dataset.articleBlockId);
      if (block) node.textContent = block.text;
      else node.remove();
    }
    reader.dataset.dirty = "false";
  };
  edit.addEventListener("click", () => { setEditing(true); save.disabled = true; });
  reader.addEventListener("input", event => {
    if (!event.target.closest('[data-article-block-id]')) return;
    reader.dataset.dirty = "true";
    save.disabled = false;
  });
  cancel.addEventListener("click", () => {
    resetText();
    setEditing(false);
    edit.focus({ preventScroll: true });
  });
  save.addEventListener("click", async () => {
    const restore = preserveElementPosition(toolbar);
    save.disabled = cancel.disabled = true;
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
    finally { save.disabled = reader.dataset.dirty !== "true"; cancel.disabled = false; }
  });
  function button(label, className = "") {
    const node = document.createElement("button");
    node.type = "button";
    node.textContent = t(label);
    node.className = className;
    return node;
  }
}
