// Keep reference drafts in the composer model; mount only the visible grid and
// one viewport on either side. Geometry comes from the existing responsive CSS.
export function createReferenceWindow(container, { createCard, releaseCard }) {
  let items = [], mounted = new Map(), columns = 0, gap = 0, estimate = 0;
  let heights = new Map(), offsets = [], frame = 0, suspended = true;
  let previousRoot = null, previousViewportHeight = 0, previouslyAtEnd = false;
  const before = document.createElement('div'), after = document.createElement('div');
  for (const spacer of [before, after]) {
    spacer.setAttribute('aria-hidden', 'true');
    Object.assign(spacer.style, { gridColumn: '1 / -1', pointerEvents: 'none' });
  }
  const picker = container.closest('.composer-case-picker');
  const body = container.closest('.composer-reference-body');
  const resize = new ResizeObserver(() => schedule());
  resize.observe(container);
  document.addEventListener('scroll', schedule, { capture: true, passive: true });
  window.addEventListener('resize', schedule, { passive: true });
  container.addEventListener('focusout', schedule);

  function scrollRoot() {
    return getComputedStyle(picker).overflowY === 'visible' ? body : picker;
  }
  function schedule() {
    if (frame || suspended) return;
    frame = requestAnimationFrame(() => { frame = 0; render(); });
  }
  function release(record) {
    releaseCard(record.card);
    record.card.remove();
    mounted.delete(record.item.id);
  }
  function resetGeometry() {
    const styles = getComputedStyle(container);
    const count = styles.gridTemplateColumns.split(/\s+/).length;
    gap = parseFloat(styles.rowGap) || 0;
    const changed = count !== columns;
    if (changed) {
      columns = count; heights.clear(); estimate = 0;
      // On resize the mounted cards already have the new CSS width. Measuring
      // those keeps the full scroll extent while rebuilding row geometry.
      if (mounted.size) measure();
    }
    return changed;
  }
  function layout() {
    const rows = Math.ceil(items.length / columns);
    offsets = new Array(rows + 1); offsets[0] = 0;
    for (let row = 0; row < rows; row++) offsets[row + 1] = offsets[row] + (heights.get(row) || estimate) + gap;
  }
  function measure() {
    const visible = new Map();
    for (const record of mounted.values()) {
      const row = Math.floor(record.index / columns);
      visible.set(row, Math.max(visible.get(row) || 0, record.card.getBoundingClientRect().height));
    }
    for (const [row, height] of visible) if (height > 0) heights.set(row, height);
    if (!estimate && visible.size) estimate = Math.max(...visible.values());
  }
  function findRow(y) {
    let low = 0, high = offsets.length - 1;
    while (low < high) {
      const mid = (low + high) >>> 1;
      if (offsets[mid + 1] < y) low = mid + 1; else high = mid;
    }
    return Math.min(low, offsets.length - 2);
  }
  function fill(first, last) {
    const start = first * columns, end = Math.min(items.length, last * columns);
    for (const record of [...mounted.values()]) {
      if (record.index >= start && record.index < end || record.card.contains(document.activeElement)) continue;
      release(record);
    }
    for (let index = start; index < end; index++) {
      const item = items[index];
      if (!mounted.has(item.id)) mounted.set(item.id, { item, index, card: createCard(item) });
    }
    before.style.display = first ? '' : 'none';
    before.style.height = `${Math.max(0, offsets[first] - gap)}px`;
    after.style.display = end < items.length ? '' : 'none';
    after.style.height = `${Math.max(0, offsets.at(-1) - gap - offsets[last])}px`;
    const cards = [...mounted.values()].sort((a, b) => a.index - b.index);
    // A focused offscreen checkbox stays mounted so keyboard focus is not lost.
    // Absolute placement prevents that one card from changing grid order.
    const width = (container.clientWidth - gap * (columns - 1)) / columns;
    for (const record of cards) {
      const pinned = record.index < start || record.index >= end;
      Object.assign(record.card.style, pinned ? {
        position: 'absolute', width: `${width}px`, top: `${offsets[Math.floor(record.index / columns)]}px`,
        left: `${record.index % columns * (width + gap)}px`
      } : { position: '', width: '', top: '', left: '' });
    }
    const nodes = [before, ...cards.map(record => record.card), after];
    nodes.forEach((node, index) => {
      if (container.children[index] !== node) container.insertBefore(node, container.children[index] || null);
    });
  }
  function render() {
    if (suspended || !items.length || !container.clientWidth) return;
    const root = scrollRoot();
    const actualEnd = root.scrollTop > 0 && root.scrollTop + root.clientHeight >= root.scrollHeight - 1;
    const columnsChanged = resetGeometry();
    const resized = columnsChanged || previousViewportHeight !== root.clientHeight;
    const atEnd = actualEnd || resized && previouslyAtEnd && previousRoot === root;
    if (!estimate) {
      // Measure a real row instead of guessing card height or imposing a case cap.
      offsets = [0, 0];
      fill(0, 1); measure();
    }
    layout();
    const viewport = root.getBoundingClientRect();
    const top = atEnd ? offsets.at(-1) - gap - root.clientHeight : viewport.top - container.getBoundingClientRect().top;
    const runway = root.clientHeight;
    const first = findRow(Math.max(0, top - runway));
    const last = atEnd ? offsets.length - 1 : Math.min(offsets.length - 1, findRow(top + runway * 2) + 1);
    const anchorRow = findRow(Math.max(0, top)), anchorTop = offsets[anchorRow];
    fill(first, Math.max(first + 1, last));
    measure(); layout();
    before.style.height = `${Math.max(0, offsets[first] - gap)}px`;
    after.style.height = `${Math.max(0, offsets.at(-1) - gap - offsets[last])}px`;
    if (atEnd) root.scrollTop = root.scrollHeight;
    else root.scrollTop += offsets[anchorRow] - anchorTop;
    previousRoot = root; previousViewportHeight = root.clientHeight;
    previouslyAtEnd = root.scrollTop > 0 && root.scrollTop + root.clientHeight >= root.scrollHeight - 1;
  }
  return {
    set(nextItems) {
      for (const record of [...mounted.values()]) release(record);
      items = nextItems; columns = 0; heights.clear(); estimate = 0;
      suspended = false; previouslyAtEnd = false;
      scrollRoot().scrollTop = 0;
      container.replaceChildren();
      render();
    },
    refresh(id) {
      const record = mounted.get(id);
      if (!record) return;
      const controls = [...record.card.querySelectorAll('input, button')];
      const focused = controls.indexOf(document.activeElement);
      releaseCard(record.card);
      const card = createCard(record.item);
      record.card.replaceWith(card); record.card = card;
      if (focused >= 0) card.querySelectorAll('input, button')[focused]?.focus({ preventScroll: true });
      schedule();
    },
    suspend() {
      suspended = true;
      if (frame) cancelAnimationFrame(frame);
      frame = 0;
      for (const record of [...mounted.values()]) release(record);
      container.replaceChildren();
    },
    destroy() {
      this.suspend(); resize.disconnect();
      document.removeEventListener('scroll', schedule, true);
      window.removeEventListener('resize', schedule);
      container.removeEventListener('focusout', schedule);
    }
  };
}
