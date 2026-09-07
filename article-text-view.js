// Keep the stored block text intact while giving lists their reading structure.
export function renderArticleBlockText(node, block, { editing = false } = {}) {
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
