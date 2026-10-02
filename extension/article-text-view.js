import { articleBlockIsMarkdown } from "./article-document.js";
import { renderMarkdownDocument } from "./markdown-renderer.js";

// Reading markup must never become the source saved by the editor.
export function renderArticleBlockText(node, block, { editing = false, entry } = {}) {
  const markdown = articleBlockIsMarkdown(block, entry);
  node.classList.toggle("markdown-reader", markdown && !editing);
  if (markdown && editing) {
    const editor = node.ownerDocument.createElement("textarea");
    editor.className = "prompt-editor article-markdown-editor";
    editor.value = block.text;
    node.replaceChildren(editor);
    return;
  }
  if (markdown && !editing) {
    node.replaceChildren(...renderMarkdownDocument(block.text).childNodes);
    return;
  }
  if (block.kind !== "list" || editing) {
    node.textContent = block.text;
    return;
  }
  const list = node.ownerDocument.createElement(block.ordered ? "ol" : "ul");
  for (const text of block.text.split("\n").filter(line => line.trim())) {
    const item = node.ownerDocument.createElement("li");
    item.textContent = text;
    list.append(item);
  }
  node.replaceChildren(list);
}
