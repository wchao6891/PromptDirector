import { createUiIcon } from './ui-icons.js';

export function createPanelDragHandle(t = value => value) {
  const handle = document.createElement('div'); handle.className = 'panel-drag-handle'; handle.title = t('拖动窗口');
  handle.append(createUiIcon('grip-vertical')); return handle;
}

// Share the gesture; each surface owns its placement and visible bounds.
export function installPanelDrag(handle, { getPosition, setPosition, onEnd = () => {} }) {
  let drag = null;
  const start = event => {
    if (event.button !== 0 || event.target.closest('button, a, input, textarea, select, [contenteditable=true]')) return;
    drag = { pointerId: event.pointerId, x: event.clientX, y: event.clientY, ...getPosition() };
    handle.setPointerCapture(event.pointerId);
    event.preventDefault(); event.stopPropagation();
  };
  const move = event => {
    if (!drag || event.pointerId !== drag.pointerId) return;
    drag.moved = true;
    const position = { left: drag.left + event.clientX - drag.x, top: drag.top + event.clientY - drag.y };
    drag.position = setPosition(position) || position;
    event.preventDefault(); event.stopPropagation();
  };
  const stop = event => {
    if (!drag || event.pointerId !== drag.pointerId) return;
    const moved = drag.moved;
    if (moved && event.type === 'pointerup') {
      const position = { left: drag.left + event.clientX - drag.x, top: drag.top + event.clientY - drag.y };
      drag.position = setPosition(position) || position;
    }
    const position = drag.position;
    drag = null;
    if (handle.hasPointerCapture(event.pointerId)) handle.releasePointerCapture(event.pointerId);
    if (moved) onEnd(position);
  };
  const listeners = { pointerdown: start, pointermove: move, pointerup: stop, pointercancel: stop, lostpointercapture: stop };
  for (const [type, listener] of Object.entries(listeners)) handle.addEventListener(type, listener);
  return () => {
    if (drag && handle.hasPointerCapture(drag.pointerId)) handle.releasePointerCapture(drag.pointerId);
    for (const [type, listener] of Object.entries(listeners)) handle.removeEventListener(type, listener);
  };
}

export function placePanelInViewport(panel, { left, top }) {
  const { width, height } = panel.getBoundingClientRect();
  panel.style.position = 'fixed'; panel.style.inset = 'auto'; panel.style.margin = '0';
  panel.dataset.movedPanel = '';
  panel.style.left = `clamp(0px, ${left}px, max(0px, calc(100vw - ${width}px)))`;
  panel.style.top = `clamp(0px, ${top}px, max(0px, calc(100dvh - ${height}px)))`;
  return { left: Math.max(0, Math.min(left, window.innerWidth - width)),
    top: Math.max(0, Math.min(top, window.innerHeight - height)) };
}

// Delegation covers static and newly created business dialogs alike.
export function bindDialogDragging(root = document) {
  const installed = new WeakSet();
  root.defaultView.addEventListener('resize', () => {
    for (const panel of root.querySelectorAll('[data-moved-panel]')) {
      if (!panel.getClientRects().length) continue;
      const rect = panel.getBoundingClientRect();
      placePanelInViewport(panel, { left: rect.left, top: rect.top });
    }
  });
  root.addEventListener('pointerdown', event => {
    const header = event.target.closest?.('.ui-dialog-header');
    const dialog = header?.closest('.ui-dialog');
    if (!dialog || installed.has(header)) return;
    installed.add(header);
    let originalStyle;
    installPanelDrag(header, {
      getPosition() {
        if (originalStyle === undefined) originalStyle = dialog.getAttribute('style');
        const rect = dialog.getBoundingClientRect(); return { left: rect.left, top: rect.top };
      },
      setPosition(position) { placePanelInViewport(dialog, position); }
    });
    dialog.addEventListener('close', () => {
      if (originalStyle === undefined) return;
      if (originalStyle === null) dialog.removeAttribute('style'); else dialog.setAttribute('style', originalStyle);
      delete dialog.dataset.movedPanel;
      originalStyle = undefined;
    });
  }, true);
}
