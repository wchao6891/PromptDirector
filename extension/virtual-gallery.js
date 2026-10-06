// Keep layout coordinates for loaded cases, and mount only the viewport plus
// its scroll runway. Case selection and order remain in the library model.
export function createVirtualGallery(container, options) {
  let records = [], columns = [], geometry = null, frame = 0, destroyed = false;
  const mounted = new Map();
  const observer = new ResizeObserver(entries => {
    let changed = false;
    for (const { target } of entries) {
      const record = mounted.get(target.dataset.entryId);
      if (!record) continue;
      const height = target.getBoundingClientRect().height;
      if (height > 0 && Math.abs(height - record.height) > 1) { record.height = height; changed = true; }
    }
    if (changed) schedule(true);
  });
  const containerObserver = new ResizeObserver(() => schedule(true));
  containerObserver.observe(container);
  const scroll = () => schedule(false);
  window.addEventListener('scroll', scroll, { passive: true });
  window.addEventListener('resize', scroll, { passive: true });

  function readGeometry() {
    const styles = getComputedStyle(container), width = container.clientWidth;
    const list = options.mode() === 'list';
    const rowHeight = Number.parseFloat(styles.getPropertyValue('--list-thumb')) + 16;
    const gap = list ? 3 : Number.parseFloat(styles.getPropertyValue('--masonry-gap')) || 12;
    const minimum = Number.parseFloat(styles.getPropertyValue('--masonry-card-min-width')) || 270;
    const count = list ? 1 : Math.max(1, Math.floor((width + gap) / (minimum + gap)));
    return { width, count, gap, list, rowHeight, cardWidth: (width - gap * (count - 1)) / count };
  }
  function position(record, card) {
    Object.assign(card.style, { position: 'absolute', width: `${geometry.cardWidth}px`, left: `${record.column * (geometry.cardWidth + geometry.gap)}px`, top: `${record.top}px` });
  }
  function anchor() {
    const top = document.querySelector('.topbar')?.getBoundingClientRect().bottom || 0;
    for (const record of [...mounted.values()].sort((a, b) => a.top - b.top)) {
      const rect = record.card.getBoundingClientRect();
      if (rect.bottom > top && rect.top < window.innerHeight) return { id: record.id, top: rect.top };
    }
    return null;
  }
  function layout() {
    const previous = geometry;
    geometry = readGeometry();
    columns = Array.from({ length: geometry.count }, () => []);
    const heights = Array(geometry.count).fill(0);
    for (const record of records) {
      if (previous && previous.cardWidth !== geometry.cardWidth && options.mode() !== 'list') record.height *= geometry.cardWidth / previous.cardWidth;
      if (record.card) {
        record.card.style.width = `${geometry.cardWidth}px`;
        record.height = record.card.getBoundingClientRect().height;
      }
      if (geometry.list && Number.isFinite(geometry.rowHeight)) record.height = geometry.rowHeight;
      // Image readiness changes heights, not the user's existing columns.
      // Reassign only when a viewport/zoom change actually changes the grid.
      if (!previous || previous.count !== geometry.count || previous.list !== geometry.list || record.column == null) {
        record.column = heights.indexOf(Math.min(...heights));
      }
      record.top = heights[record.column];
      heights[record.column] += record.height + geometry.gap;
      columns[record.column].push(record);
      if (record.card) position(record, record.card);
    }
    container.style.height = `${Math.max(0, ...heights) - (records.length ? geometry.gap : 0)}px`;
    container.dataset.loadedCount = String(records.length);
    options.onLayout?.();
  }
  function release(record) {
    observer.unobserve(record.card);
    options.releaseCard?.(record.card);
    record.card.remove(); record.card = null; mounted.delete(record.id);
  }
  function sync() {
    if (!geometry || destroyed) return;
    const offset = container.getBoundingClientRect().top, runway = window.innerHeight * 2;
    const first = -offset - runway, last = -offset + window.innerHeight + runway;
    const desired = new Set();
    for (const column of columns) {
      let low = 0, high = column.length;
      while (low < high) { const mid = (low + high) >>> 1; if (column[mid].top + column[mid].height < first) low = mid + 1; else high = mid; }
      for (let i = low; i < column.length && column[i].top <= last; i++) desired.add(column[i]);
    }
    for (const record of mounted.values()) {
      if (desired.has(record) || options.protectedCard?.(record.card) || record.card.contains(document.activeElement)) continue;
      release(record);
    }
    for (const record of desired) {
      if (record.card) continue;
      const card = options.createCard(record.id);
      if (!card) continue;
      record.card = card; mounted.set(record.id, record);
      position(record, card); container.append(card); observer.observe(card); options.mountCard?.(card);
    }
    const ordered = [...mounted.values()].sort((a, b) => a.index - b.index);
    ordered.forEach((record, index) => { if (container.children[index] !== record.card) container.insertBefore(record.card, container.children[index] || null); });
    options.onWindow?.();
  }
  let needsLayout = false, resizeAnchor = null;
  function schedule(reflow) {
    needsLayout ||= reflow;
    if (frame || destroyed) return;
    frame = requestAnimationFrame(() => {
      frame = 0;
      const saved = resizeAnchor || (needsLayout ? anchor() : null);
      resizeAnchor = null;
      if (needsLayout) { needsLayout = false; layout(); }
      // Restore before recycling: after a large zoom change the anchor may be
      // outside the old viewport, but it is still the user's current case.
      const card = saved && mounted.get(saved.id)?.card;
      if (card) { const delta = card.getBoundingClientRect().top - saved.top; if (Math.abs(delta) > 1) window.scrollBy(0, delta); }
      sync();
    });
  }
  return {
    get count() { return records.length; },
    resize(update) { resizeAnchor ||= anchor(); update?.(); schedule(true); },
    reset() { records = []; columns = []; mounted.clear(); observer.disconnect(); geometry = readGeometry(); },
    append(cards) {
      for (const card of cards) {
        if (mounted.has(card.dataset.entryId)) continue;
        const record = { id: card.dataset.entryId, index: records.length, height: card.getBoundingClientRect().height, card };
        records.push(record); mounted.set(record.id, record); observer.observe(card);
      }
      layout(); sync();
    },
    remove(card) {
      const record = mounted.get(card.dataset.entryId);
      if (!record) return false;
      const saved = anchor(); release(record);
      records = records.filter(item => item !== record); records.forEach((item, index) => { item.index = index; });
      layout(); sync();
      const restored = saved && mounted.get(saved.id)?.card;
      if (restored) window.scrollBy(0, restored.getBoundingClientRect().top - saved.top);
      return true;
    },
    destroy() {
      destroyed = true; if (frame) cancelAnimationFrame(frame);
      observer.disconnect(); containerObserver.disconnect();
      window.removeEventListener('scroll', scroll); window.removeEventListener('resize', scroll);
      records = []; mounted.clear();
    }
  };
}
