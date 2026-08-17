export function createStableMasonry(container, options = {}) {
  if (!(container instanceof HTMLElement)) throw new Error("瀑布流容器无效");
  if (options.scrollContainer != null && !(options.scrollContainer instanceof HTMLElement)) {
    throw new Error("瀑布流滚动容器无效");
  }

  const cardMetadata = new Map();
  const scrollContainer = options.scrollContainer || window;
  const usesWindowScroll = scrollContainer === window;
  let columns = [];
  let geometry = null;
  let anchorFrame = 0;
  let anchorTimer = 0;
  let cardResizeFrame = 0;
  let resizeFrame = 0;
  let dependencyFrame = 0;
  let scrollFrame = 0;
  let viewportAnchor = null;
  let scheduledResizeAnchor = null;
  let resizeGestureAnchor = null;
  let expectedInternalScrollPosition = null;
  const pendingCardResizeColumns = new Set();
  let pendingCardResizeAnchor = null;
  const onLayout = typeof options.onLayout === "function" ? options.onLayout : () => undefined;
  const currentScrollPosition = () => usesWindowScroll ? window.scrollY : scrollContainer.scrollTop;
  const viewportBounds = () => usesWindowScroll
    ? { top: 0, bottom: window.innerHeight }
    : scrollContainer.getBoundingClientRect();
  const releaseResizeAnchor = () => {
    resizeGestureAnchor = null;
    scheduledResizeAnchor = null;
    pendingCardResizeAnchor = null;
    delete container.dataset.masonryAnchorEntryId;
  };
  const handleUserScrollIntent = (event) => {
    if (event.type === "keydown" && ![
      "ArrowDown", "ArrowUp", "End", "Home", "PageDown", "PageUp", " "
    ].includes(event.key)) return;
    releaseResizeAnchor();
    if (anchorFrame) cancelAnimationFrame(anchorFrame);
    if (anchorTimer) clearTimeout(anchorTimer);
    anchorFrame = 0;
    anchorTimer = 0;
  };
  for (const type of ["wheel", "touchstart", "pointerdown", "keydown"]) {
    scrollContainer.addEventListener(type, handleUserScrollIntent, { passive: true });
  }

  const rememberViewportAnchor = () => {
    const resizeManagedScroll = Boolean(resizeGestureAnchor);
    if (expectedInternalScrollPosition !== null && Math.abs(currentScrollPosition() - expectedInternalScrollPosition) <= 1) {
      expectedInternalScrollPosition = null;
    } else if (!resizeManagedScroll) {
      expectedInternalScrollPosition = null;
      if (anchorFrame) cancelAnimationFrame(anchorFrame);
      if (anchorTimer) clearTimeout(anchorTimer);
      anchorFrame = 0;
      anchorTimer = 0;
      releaseResizeAnchor();
    }
    if (resizeManagedScroll) {
      if (scrollFrame) cancelAnimationFrame(scrollFrame);
      scrollFrame = requestAnimationFrame(() => {
        scrollFrame = 0;
        restoreTrackedScrollAnchor(resizeGestureAnchor);
      });
      return;
    }
    if (geometry) viewportAnchor = captureStoredAnchor([...cardMetadata.keys()]);
    if (scrollFrame) return;
    scrollFrame = requestAnimationFrame(() => {
      scrollFrame = 0;
      if (geometry) viewportAnchor = captureLiveAnchor();
    });
  };
  scrollContainer.addEventListener("scroll", rememberViewportAnchor, { passive: true });

  const cardObserver = new ResizeObserver((records) => {
    for (const record of records) {
      const metadata = cardMetadata.get(record.target);
      if (!metadata) continue;
      const height = observedHeight(record);
      if (Math.abs(height - metadata.height) <= 1) continue;
      metadata.height = height;
      pendingCardResizeColumns.add(metadata.column);
    }
    if (!pendingCardResizeColumns.size) return;
    if (resizeGestureAnchor) pendingCardResizeAnchor ||= resizeGestureAnchor;
    if (cardResizeFrame) return;
    cardResizeFrame = requestAnimationFrame(() => {
      cardResizeFrame = 0;
      flushCardResizes();
    });
  });

  const scheduleReflow = () => {
    const width = container.clientWidth;
    if (!geometry || Math.abs(width - geometry.containerWidth) <= 1) return;
    if (isScrollbarWidthChange(container, geometry, scrollContainer)) return;
    if (!resizeGestureAnchor?.card?.isConnected) resizeGestureAnchor = null;
    // CSS responds before the resize event is delivered. Prefer the anchor captured
    // by the preceding scroll event so header wrapping cannot redefine the user's
    // visible position while the viewport width is changing.
    resizeGestureAnchor ||= viewportAnchor || captureStoredAnchor([...cardMetadata.keys()]) || captureLiveAnchor();
    if (resizeGestureAnchor?.card?.dataset.entryId) {
      container.dataset.masonryAnchorEntryId = resizeGestureAnchor.card.dataset.entryId;
    }
    scheduledResizeAnchor ||= resizeGestureAnchor;
    if (resizeFrame) cancelAnimationFrame(resizeFrame);
    resizeFrame = requestAnimationFrame(() => {
      resizeFrame = 0;
      const anchor = scheduledResizeAnchor;
      scheduledResizeAnchor = null;
      reflowAll({ preserveAnchor: true, anchorOverride: anchor });
    });
  };
  const scheduleContainerReflow = () => {
    scheduleReflow();
  };
  const containerObserver = new ResizeObserver(scheduleContainerReflow);
  containerObserver.observe(container);
  const dependencyObserver = new ResizeObserver(() => {
    if (dependencyFrame) return;
    dependencyFrame = requestAnimationFrame(() => {
      dependencyFrame = 0;
      restoreTrackedScrollAnchor(resizeGestureAnchor || viewportAnchor);
    });
  });
  for (const dependency of options.layoutDependencies || []) {
    if (dependency instanceof HTMLElement) dependencyObserver.observe(dependency);
  }
  window.addEventListener("resize", scheduleReflow, { passive: true });

  function reset() {
    if (anchorFrame) cancelAnimationFrame(anchorFrame);
    if (anchorTimer) clearTimeout(anchorTimer);
    cancelCardResize();
    if (resizeFrame) cancelAnimationFrame(resizeFrame);
    if (dependencyFrame) cancelAnimationFrame(dependencyFrame);
    if (scrollFrame) cancelAnimationFrame(scrollFrame);
    anchorFrame = 0;
    anchorTimer = 0;
    resizeFrame = 0;
    dependencyFrame = 0;
    scrollFrame = 0;
    cardObserver.disconnect();
    cardMetadata.clear();
    columns = [];
    geometry = readGeometry(container, scrollContainer);
    viewportAnchor = null;
    scheduledResizeAnchor = null;
    resizeGestureAnchor = null;
    delete container.dataset.masonryAnchorEntryId;
    container.style.height = "0px";
  }

  function append(cards) {
    if (!geometry) geometry = readGeometry(container, scrollContainer);
    if (cardResizeFrame) {
      cancelAnimationFrame(cardResizeFrame);
      cardResizeFrame = 0;
    }
    flushCardResizes();
    const widthChanged = Math.abs(container.clientWidth - geometry.containerWidth) > 1;
    if (widthChanged && cardMetadata.size && !isScrollbarWidthChange(container, geometry, scrollContainer)) reflowAll({ preserveAnchor: true });
    else if (widthChanged) geometry = readGeometry(container, scrollContainer);

    for (const card of cards) placeCard(card);
    updateContainerHeight();
  }

  function destroy() {
    if (anchorFrame) cancelAnimationFrame(anchorFrame);
    if (anchorTimer) clearTimeout(anchorTimer);
    cancelCardResize();
    if (resizeFrame) cancelAnimationFrame(resizeFrame);
    if (dependencyFrame) cancelAnimationFrame(dependencyFrame);
    if (scrollFrame) cancelAnimationFrame(scrollFrame);
    cardObserver.disconnect();
    containerObserver.disconnect();
    dependencyObserver.disconnect();
    cardMetadata.clear();
    scrollContainer.removeEventListener("scroll", rememberViewportAnchor);
    for (const type of ["wheel", "touchstart", "pointerdown", "keydown"]) {
      scrollContainer.removeEventListener(type, handleUserScrollIntent);
    }
    window.removeEventListener("resize", scheduleReflow);
  }

  function remove(card) {
    const metadata = cardMetadata.get(card);
    if (!metadata) {
      card?.remove?.();
      return false;
    }
    const anchor = viewportAnchor?.card === card
      ? captureLiveAnchor(card)
      : viewportAnchor || captureLiveAnchor(card);
    if (resizeGestureAnchor?.card === card) resizeGestureAnchor = null;
    if (scheduledResizeAnchor?.card === card) scheduledResizeAnchor = null;
    cardObserver.unobserve?.(card);
    cardMetadata.delete(card);
    columns[metadata.column] = (columns[metadata.column] ?? []).filter((item) => item !== card);
    card.remove?.();
    layoutColumn(metadata.column);
    updateContainerHeight();
    restoreTrackedScrollAnchor(anchor);
    viewportAnchor = anchor;
    return true;
  }

  function placeCard(card) {
    if (!(card instanceof HTMLElement) || cardMetadata.has(card)) return;
    ensureColumns();
    const column = shortestColumn();
    card.style.width = `${columnWidth(column)}px`;
    const height = card.getBoundingClientRect().height;
    const top = columnHeight(column);
    const metadata = { column, height, top };
    cardMetadata.set(card, metadata);
    columns[column].push(card);
    positionCard(card, metadata);
    cardObserver.observe(card);
  }

  function reflowAll({ preserveAnchor = false, anchorOverride = null } = {}) {
    if (anchorFrame) cancelAnimationFrame(anchorFrame);
    if (anchorTimer) clearTimeout(anchorTimer);
    cancelCardResize();
    anchorFrame = 0;
    anchorTimer = 0;
    const cards = [...container.querySelectorAll(":scope > .case-card")];
    const anchor = preserveAnchor ? anchorOverride || viewportAnchor || captureLiveAnchor() || captureStoredAnchor(cards) : null;
    cardObserver.disconnect();
    cardMetadata.clear();
    geometry = readGeometry(container, scrollContainer);
    columns = Array.from({ length: geometry.columnCount }, () => []);
    for (const card of cards) placeCard(card);
    updateContainerHeight();
    restoreTrackedScrollAnchor(anchor);
    anchorFrame = requestAnimationFrame(() => {
      restoreTrackedScrollAnchor(anchor);
      anchorFrame = requestAnimationFrame(() => {
        restoreTrackedScrollAnchor(anchor);
        anchorFrame = 0;
        viewportAnchor = captureLiveAnchor();
      });
    });
    anchorTimer = setTimeout(() => {
      anchorTimer = 0;
      restoreTrackedScrollAnchor(anchor);
      viewportAnchor = captureLiveAnchor();
    }, 60);
  }

  function cancelCardResize() {
    if (cardResizeFrame) cancelAnimationFrame(cardResizeFrame);
    cardResizeFrame = 0;
    pendingCardResizeColumns.clear();
    pendingCardResizeAnchor = null;
  }

  function flushCardResizes() {
    if (!pendingCardResizeColumns.size) return;
    const changedColumns = [...pendingCardResizeColumns];
    const resizeAnchor = pendingCardResizeAnchor;
    pendingCardResizeColumns.clear();
    pendingCardResizeAnchor = null;
    for (const column of changedColumns) layoutColumn(column);
    updateContainerHeight();
    if (resizeAnchor) restoreTrackedScrollAnchor(resizeAnchor);
  }

  function captureLiveAnchor(excluded = null) {
    const bounds = viewportBounds();
    const visible = [...cardMetadata.keys()]
      .filter((card) => card !== excluded)
      .map((card) => ({ card, rect: card.getBoundingClientRect() }))
      .filter(({ rect }) => rect.bottom > bounds.top && rect.top < bounds.bottom)
      .sort((left, right) => Math.abs(left.rect.top - bounds.top) - Math.abs(right.rect.top - bounds.top))[0];
    return visible ? { card: visible.card, top: visible.rect.top } : null;
  }

  function restoreTrackedScrollAnchor(anchor) {
    if (!anchor?.card?.isConnected) return;
    const delta = anchor.card.getBoundingClientRect().top - anchor.top;
    if (Math.abs(delta) <= 1) return;
    expectedInternalScrollPosition = currentScrollPosition() + delta;
    scrollContainer.scrollBy(0, delta);
  }

  function captureStoredAnchor(cards) {
    const containerTop = container.getBoundingClientRect().top;
    const bounds = viewportBounds();
    const visible = cards
      .map((card) => {
        const metadata = cardMetadata.get(card);
        return { card, metadata, top: containerTop + (metadata?.top ?? 0) };
      })
      .filter(({ metadata, top }) => metadata && top + metadata.height > bounds.top && top < bounds.bottom)
      .sort((left, right) => Math.abs(left.top - bounds.top) - Math.abs(right.top - bounds.top))[0];
    return visible ? { card: visible.card, top: visible.top } : null;
  }

  function ensureColumns() {
    if (columns.length === geometry.columnCount) return;
    columns = Array.from({ length: geometry.columnCount }, () => []);
  }

  function layoutColumn(column) {
    let top = 0;
    for (const card of columns[column] ?? []) {
      const metadata = cardMetadata.get(card);
      if (!metadata) continue;
      metadata.top = top;
      positionCard(card, metadata);
      top += metadata.height + geometry.gap;
    }
  }

  function positionCard(card, metadata) {
    card.style.left = `${columnLeft(metadata.column)}px`;
    card.style.width = `${columnWidth(metadata.column)}px`;
    card.style.top = `${metadata.top}px`;
    card.dataset.masonryColumn = String(metadata.column);
  }

  function shortestColumn() {
    let shortest = 0;
    for (let index = 1; index < columns.length; index += 1) {
      if (columnHeight(index) < columnHeight(shortest)) shortest = index;
    }
    return shortest;
  }

  function columnLeft(column) {
    return column * (geometry.cardWidth + geometry.gap);
  }

  function columnWidth(column) {
    if (column !== geometry.columnCount - 1) return geometry.cardWidth;
    return Math.max(1, geometry.containerWidth - columnLeft(column));
  }

  function columnHeight(column) {
    const cards = columns[column] ?? [];
    const last = cards.at(-1);
    if (!last) return 0;
    const metadata = cardMetadata.get(last);
    return metadata.top + metadata.height + geometry.gap;
  }

  function updateContainerHeight() {
    const height = Math.max(0, ...columns.map((_, index) => columnHeight(index) - geometry.gap));
    container.style.height = `${height}px`;
    onLayout({ height, columnCount: geometry.columnCount, cardWidth: geometry.cardWidth });
  }

  return { append, destroy, remove, reset };
}

function readGeometry(container, scrollContainer = window) {
  const styles = getComputedStyle(container);
  const containerWidth = container.clientWidth;
  const minimumWidth = positiveNumber(styles.getPropertyValue("--masonry-card-min-width"), 270);
  const gap = positiveNumber(styles.getPropertyValue("--masonry-gap"), 12);
  const columnCount = Math.max(1, Math.floor((containerWidth + gap) / (minimumWidth + gap)));
  const cardWidth = Math.max(1, (containerWidth - gap * (columnCount - 1)) / columnCount);
  const viewportWidth = scrollContainer === window ? window.innerWidth : scrollContainer.clientWidth;
  return { cardWidth, columnCount, containerWidth, gap, viewportWidth };
}

function isScrollbarWidthChange(container, geometry, scrollContainer = window) {
  const widthDifference = Math.abs(container.clientWidth - geometry.containerWidth);
  const viewportWidth = scrollContainer === window ? window.innerWidth : scrollContainer.clientWidth;
  if (Math.abs(viewportWidth - geometry.viewportWidth) > 1 || widthDifference > 24) return false;
  return readGeometry(container, scrollContainer).columnCount === geometry.columnCount;
}

function positiveNumber(value, fallback) {
  const number = Number.parseFloat(value);
  return Number.isFinite(number) && number > 0 ? number : fallback;
}

function observedHeight(record) {
  const size = Array.isArray(record.borderBoxSize) ? record.borderBoxSize[0] : record.borderBoxSize;
  return size?.blockSize || record.target.getBoundingClientRect().height;
}
