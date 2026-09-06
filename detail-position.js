// Local content changes preserve a visible reading anchor in its actual scroller.
export function scrollingAncestor(element) {
  for (let node = element.parentElement; node; node = node.parentElement) {
    if (/(auto|scroll)/.test(getComputedStyle(node).overflowY) && node.scrollHeight > node.clientHeight) return node;
  }
  return document.scrollingElement;
}

function readingViewport(element, scroller) {
  const top = scroller === document.scrollingElement ? 0 : Math.max(0, scroller.getBoundingClientRect().top);
  const controls = element.closest(".detail-drawer")?.querySelectorAll(".drawer-toolbar .icon-button") || [];
  const bottom = Math.max(top, ...[...controls].filter(control => control.getClientRects().length)
    .map(control => control.getBoundingClientRect().bottom));
  return { top, unobscuredTop: bottom };
}

export function readingInset(element) {
  const viewport = readingViewport(element, scrollingAncestor(element));
  return viewport.unobscuredTop - viewport.top;
}

export function preserveElementPosition(element, { reveal = false } = {}) {
  const scroller = scrollingAncestor(element);
  const viewportTop = readingViewport(element, scroller).unobscuredTop;
  const top = element.getBoundingClientRect().top;
  const targetTop = reveal ? Math.max(viewportTop, top) : top;
  return (replacement = element) => {
    if (!replacement.isConnected) return;
    scroller.scrollTop = Math.floor(scroller.scrollTop + replacement.getBoundingClientRect().top - targetTop);
  };
}

export function replaceDetailSection(current, next) {
  if (current.tagName === "DETAILS" && next.tagName === "DETAILS") next.open = current.open;
  const focused = current.contains(document.activeElement) ? document.activeElement : null;
  const focusKey = focused?.closest('[data-prompt-key]')?.dataset.promptKey;
  const focusLabel = focused?.getAttribute("aria-label");
  const selection = focused?.tagName === "TEXTAREA" ? [focused.selectionStart, focused.selectionEnd] : null;
  const scroller = scrollingAncestor(current);
  const top = readingViewport(current, scroller).unobscuredTop;
  const candidates = [...current.querySelectorAll("h3, .prompt-read-body > *, .prompt-read-body, button")];
  const anchor = candidates.find(node => { const rect = node.getBoundingClientRect(); return node.getClientRects().length && rect.top >= top && rect.top < innerHeight; }) || current;
  const anchorKey = anchor.closest('[data-prompt-key]')?.dataset.promptKey;
  const region = anchor.closest(".prompt-read-body") ? ".prompt-read-body" : anchor.closest(".prompt-section-heading") ? ".prompt-section-heading" : "";
  const anchorRoot = anchorKey && region ? anchor.closest(region) : current;
  const path = [];
  for (let node = anchor; node !== anchorRoot; node = node.parentElement) path.unshift([...node.parentElement.children].indexOf(node));
  const restore = preserveElementPosition(anchor);
  for (const editor of current.querySelectorAll(".entry-editor[open]")) next.querySelector(".entry-editor")?.replaceWith(editor);
  for (const editor of current.querySelectorAll('[data-editing="true"]')) {
    const replacement = [...next.querySelectorAll('[data-prompt-key]')].find(node => node.dataset.promptKey === editor.dataset.promptKey);
    if (replacement) {
      const status = replacement.querySelector(".video-analysis-task-status");
      editor.querySelector(".video-analysis-task-status")?.remove();
      if (status) editor.querySelector(".prompt-section-heading").after(status);
      replacement.replaceWith(editor);
    }
  }
  current.replaceWith(next);
  const nextPanel = anchorKey && [...next.querySelectorAll('[data-prompt-key]')].find(node => node.dataset.promptKey === anchorKey);
  let nextAnchor = nextPanel && region ? nextPanel.querySelector(region) || nextPanel : next;
  for (const index of path) nextAnchor = nextAnchor.children[index] || nextAnchor;
  restore(nextAnchor);
  if (focused?.isConnected) {
    focused.focus({ preventScroll: true });
    if (selection) focused.setSelectionRange(...selection);
  } else if (focusKey && focusLabel) {
    const panel = [...next.querySelectorAll('[data-prompt-key]')].find(node => node.dataset.promptKey === focusKey);
    [...panel?.querySelectorAll('[aria-label]') || []].find(node => node.getAttribute("aria-label") === focusLabel)?.focus({ preventScroll: true });
  }
}
