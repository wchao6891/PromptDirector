export const CAPTURE_PERMISSION_MESSAGE =
  "跨网页截图权限没有生效，请返回侧边栏重新授权；当前草稿没有改变。";

export function capturePermissionMessage(error, recoveryMessage = CAPTURE_PERMISSION_MESSAGE) {
  const message = String(error?.message ?? error ?? "");
  if (!/(?:<all_urls>|activeTab)/i.test(message) || !/permission/i.test(message)) return "";
  return String(recoveryMessage || CAPTURE_PERMISSION_MESSAGE);
}

export async function captureVisibleTabWithRecovery(
  captureVisibleTab,
  windowId,
  options = { format: "png" },
  recoveryMessage = CAPTURE_PERMISSION_MESSAGE
) {
  try {
    return await captureVisibleTab(windowId, options);
  } catch (error) {
    const message = capturePermissionMessage(error, recoveryMessage);
    if (message) throw new Error(message);
    throw error;
  }
}

export function selectCaptureRegion(options = {}) {
  const rootId = "__prompt_case_capture_overlay__";
  document.getElementById(rootId)?.remove();
  const sessionId = String(options.sessionId || globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random()}`);

  return new Promise((resolve) => {
    const minimumSize = 16;
    const root = document.createElement("div");
    const instruction = document.createElement("div");
    const instructionCopy = document.createElement("span");
    const selection = document.createElement("div");
    let interaction = null;
    let currentRect = null;
    let finished = false;
    let keepAlivePort = null;
    let keepAliveInterval = null;

    root.id = rootId;
    instruction.className = "prompt-case-capture-instruction";
    instructionCopy.textContent = options.instruction || "拖动框选需要保存的画面 · Esc 取消";
    instruction.append(instructionCopy);
    selection.className = "prompt-case-capture-selection";
    root.append(instruction, selection);
    overlayMount().appendChild(root);
    notifyRegionState("selecting");

    try {
      keepAlivePort = chrome.runtime.connect({ name: "capture-region" });
      keepAliveInterval = setInterval(
        () => keepAlivePort?.postMessage({ type: "CAPTURE_ACTIVE" }),
        20_000
      );
    } catch {
    }

    const timeoutId = setTimeout(() => finish(null), 120_000);

    for (const type of ["pointerdown", "pointermove", "pointerup", "pointercancel"]) {
      root.addEventListener(type, stopPagePointerEvent);
    }
    for (const type of ["click", "auxclick", "contextmenu"]) {
      root.addEventListener(type, stopPageClickEvent);
    }

    root.addEventListener("mousedown", (event) => {
      if (instruction.contains(event.target)) return;
      if (event.button !== 0) return;
      stopPageMouseEvent(event);
      interaction = {
        kind: "draw",
        pointer: { x: event.clientX, y: event.clientY }
      };
      currentRect = null;
      selection.style.display = "block";
      updateSelection({ x: event.clientX, y: event.clientY, width: 0, height: 0 });
    });

    root.addEventListener("mousemove", (event) => {
      if (instruction.contains(event.target)) return;
      if (!interaction) return;
      stopPageMouseEvent(event);
      updateSelection(normalizedRect(interaction.pointer.x, interaction.pointer.y, event.clientX, event.clientY));
    });

    root.addEventListener("mouseup", (event) => {
      if (instruction.contains(event.target)) return;
      if (!interaction || event.button !== 0) return;
      stopPageMouseEvent(event);
      interaction = null;
      if (!currentRect || currentRect.width < minimumSize || currentRect.height < minimumSize) {
        currentRect = null;
        selection.style.display = "none";
        instructionCopy.textContent = options.tooSmall || "框选区域太小，请重新拖动 · Esc 取消";
        return;
      }
      notifyRegionState("capturing");
      finish({
        rect: { ...currentRect },
        viewportWidth: window.innerWidth,
        viewportHeight: window.innerHeight
      });
    });

    window.addEventListener("keydown", onKeyDown, true);
    chrome.runtime?.onMessage?.addListener?.(handleRegionMessage);

    function onKeyDown(event) {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        finish(null);
      }
    }

    function handleRegionMessage(message, _sender, sendResponse) {
      if (message?.type !== "PROMPTDIRECTOR_REGION_CAPTURE" || message.sessionId !== sessionId) return undefined;
      if (message.action === "status") {
        sendResponse({ ok: true, sessionId, phase: "selecting" });
        return false;
      }
      if (message.action === "cancel") {
        finish(null);
        sendResponse({ ok: true, sessionId, cancelled: true });
        return false;
      }
      return undefined;
    }

    function finish(result) {
      if (finished) return;
      finished = true;
      clearTimeout(timeoutId);
      if (keepAliveInterval) clearInterval(keepAliveInterval);
      keepAlivePort?.disconnect();
      window.removeEventListener("keydown", onKeyDown, true);
      chrome.runtime?.onMessage?.removeListener?.(handleRegionMessage);
      cleanup();

      async function cleanup() {
        await new Promise((done) => setTimeout(done, 0));
        root.remove();
        if (!result) {
          notifyRegionState("cancelled");
          return resolve(null);
        }
        const captureToken = options.hideFloatingControls === false ? "" : hideFloatingControls(result.rect);
        await new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done)));
        resolve({ ...result, captureToken, sessionId });
      }
    }

    function stopPagePointerEvent(event) {
      event.stopPropagation();
    }

    function stopPageMouseEvent(event) {
      event.preventDefault();
      event.stopPropagation();
    }

    function stopPageClickEvent(event) {
      event.preventDefault();
      event.stopImmediatePropagation();
    }

    function updateSelection(rect) {
      currentRect = clampRect(rect);
      selection.style.transform = `translate(${currentRect.x}px, ${currentRect.y}px)`;
      selection.style.width = `${currentRect.width}px`;
      selection.style.height = `${currentRect.height}px`;
    }

    function normalizedRect(startX, startY, endX, endY) {
      return {
        x: Math.min(startX, endX),
        y: Math.min(startY, endY),
        width: Math.abs(endX - startX),
        height: Math.abs(endY - startY)
      };
    }

    function clampRect(rect) {
      const left = Math.max(0, Math.min(rect.x, window.innerWidth));
      const top = Math.max(0, Math.min(rect.y, window.innerHeight));
      const right = Math.max(left, Math.min(rect.x + rect.width, window.innerWidth));
      const bottom = Math.max(top, Math.min(rect.y + rect.height, window.innerHeight));
      return { x: left, y: top, width: right - left, height: bottom - top };
    }

    function hideFloatingControls(rect) {
      const token = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
      const viewportArea = Math.max(1, window.innerWidth * window.innerHeight);
      for (const element of document.querySelectorAll("*")) {
        if (!(element instanceof HTMLElement) || element.id === rootId) continue;
        const style = getComputedStyle(element);
        if (!["fixed", "sticky"].includes(style.position) || style.visibility === "hidden" || style.display === "none") continue;
        const zIndex = Number.parseInt(style.zIndex, 10);
        if (!Number.isFinite(zIndex) || zIndex < 100) continue;
        const bounds = element.getBoundingClientRect();
        const area = bounds.width * bounds.height;
        if (bounds.width < 16 || bounds.height < 16 || bounds.width > 180 || bounds.height > 180 || area > viewportArea * 0.05) continue;
        if (!intersects(bounds, rect)) continue;
        element.dataset.promptCaseCaptureToken = token;
        element.dataset.promptCaseCaptureHadStyle = element.hasAttribute("style") ? "1" : "0";
        element.dataset.promptCaseCaptureStyle = element.getAttribute("style") || "";
        element.style.setProperty("visibility", "hidden", "important");
      }
      return token;
    }

    function intersects(bounds, rect) {
      return bounds.right > rect.x
        && bounds.left < rect.x + rect.width
        && bounds.bottom > rect.y
        && bounds.top < rect.y + rect.height;
    }

    function notifyRegionState(phase, message = "") {
      try {
        chrome.runtime.sendMessage({
          type: "REGION_CAPTURE_CHANGED",
          sessionId,
          phase,
          message
        }).catch(() => undefined);
      } catch {
      }
    }

    function overlayMount() {
      const fullscreenRoot = document.fullscreenElement;
      return fullscreenRoot instanceof HTMLElement ? fullscreenRoot : document.documentElement;
    }
  });
}

export function selectPageVisuals(options = {}) {
  const rootId = "__prompt_case_visual_picker__";
  document.getElementById(rootId)?.remove();
  const externalControls = options.externalControls === true;
  const sessionId = String(options.sessionId || globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random()}`);
  const minimumSize = Number.isFinite(Number(options.minimumSize)) && Number(options.minimumSize) > 0
    ? Number(options.minimumSize)
    : 1;
  const maximumSelections = Number.isSafeInteger(Number(options.maximumSelections)) && Number(options.maximumSelections) > 0
    ? Number(options.maximumSelections)
    : Number.POSITIVE_INFINITY;

  function visualContentBounds(element) {
    const bounds = element.getBoundingClientRect();
    const style = getComputedStyle(element);
    const number = (value) => Number.parseFloat(value) || 0;
    const borderLeft = number(style.borderLeftWidth);
    const borderRight = number(style.borderRightWidth);
    const borderTop = number(style.borderTopWidth);
    const borderBottom = number(style.borderBottomWidth);
    const paddingLeft = number(style.paddingLeft);
    const paddingRight = number(style.paddingRight);
    const paddingTop = number(style.paddingTop);
    const paddingBottom = number(style.paddingBottom);
    let left = bounds.left + borderLeft + paddingLeft;
    let top = bounds.top + borderTop + paddingTop;
    let width = Math.max(0, bounds.width - borderLeft - borderRight - paddingLeft - paddingRight);
    let height = Math.max(0, bounds.height - borderTop - borderBottom - paddingTop - paddingBottom);

    const intrinsic = element instanceof HTMLImageElement
      ? { width: element.naturalWidth, height: element.naturalHeight }
      : element instanceof HTMLVideoElement
        ? { width: element.videoWidth, height: element.videoHeight }
        : element instanceof HTMLCanvasElement
          ? { width: element.width, height: element.height }
          : null;
    const fit = style.objectFit;
    if (intrinsic?.width > 0 && intrinsic?.height > 0 && ["contain", "scale-down", "none"].includes(fit)) {
      const containScale = Math.min(width / intrinsic.width, height / intrinsic.height);
      const scale = fit === "none" ? 1 : fit === "scale-down" ? Math.min(1, containScale) : containScale;
      const renderedWidth = Math.min(width, intrinsic.width * scale);
      const renderedHeight = Math.min(height, intrinsic.height * scale);
      const [positionX = "50%", positionY = "50%"] = String(style.objectPosition || "50% 50%").split(/\s+/);
      left += objectPositionOffset(positionX, width - renderedWidth, "x");
      top += objectPositionOffset(positionY, height - renderedHeight, "y");
      width = renderedWidth;
      height = renderedHeight;
    }

    const radius = Math.max(
      cornerRadius(style.borderTopLeftRadius, bounds.width, bounds.height),
      cornerRadius(style.borderTopRightRadius, bounds.width, bounds.height),
      cornerRadius(style.borderBottomRightRadius, bounds.width, bounds.height),
      cornerRadius(style.borderBottomLeftRadius, bounds.width, bounds.height)
    );
    const cornerInset = Math.min(width / 2, height / 2, radius * (1 - Math.SQRT1_2));
    left += cornerInset;
    top += cornerInset;
    width = Math.max(0, width - cornerInset * 2);
    height = Math.max(0, height - cornerInset * 2);
    return { left, top, right: left + width, bottom: top + height };
  }

  function objectPositionOffset(value, freeSpace, axis) {
    if (freeSpace <= 0) return 0;
    const text = String(value || "").toLocaleLowerCase();
    if (text === "left" || text === "top") return 0;
    if (text === "right" || text === "bottom") return freeSpace;
    if (text === "center") return freeSpace / 2;
    if (text.endsWith("%")) return freeSpace * Math.max(0, Math.min(1, (Number.parseFloat(text) || 0) / 100));
    const pixels = Number.parseFloat(text);
    if (Number.isFinite(pixels)) return Math.max(0, Math.min(freeSpace, pixels));
    return axis === "x" || axis === "y" ? freeSpace / 2 : 0;
  }

  function cornerRadius(value, width, height) {
    const token = String(value || "0").split(/[\s/]+/)[0];
    const amount = Number.parseFloat(token) || 0;
    return token.endsWith("%") ? Math.min(width, height) * amount / 100 : amount;
  }

  function collectCandidates() {
    const measured = [];
    for (const [domIndex, element] of visualElements().entries()) {
      if (!(element instanceof HTMLElement) || element.closest(`#${rootId}`)) continue;
      if (!isVisibleInTree(element)) continue;
      if (element instanceof HTMLImageElement && (!element.complete || !element.naturalWidth)) continue;
      const bounds = visualContentBounds(element);
      const left = Math.max(0, bounds.left);
      const top = Math.max(0, bounds.top);
      const right = Math.min(window.innerWidth, bounds.right);
      const bottom = Math.min(window.innerHeight, bounds.bottom);
      const rect = {
        x: Math.ceil(left),
        y: Math.ceil(top),
        width: Math.max(0, Math.floor(right) - Math.ceil(left)),
        height: Math.max(0, Math.floor(bottom) - Math.ceil(top))
      };
      if (rect.width < minimumSize || rect.height < minimumSize) continue;
      const visibleRatio = visiblePointRatio(element, rect);
      if (visibleRatio <= 0) continue;
      const modal = element.closest('dialog, [role="dialog"], [aria-modal="true"]');
      measured.push({
        element,
        rect,
        domIndex,
        visibleRatio,
        modalPriority: modal && isActiveVisualScope(modal) ? 1 : 0
      });
    }

    const activeScope = measured.some((candidate) => candidate.modalPriority)
      ? measured.filter((candidate) => candidate.modalPriority)
      : measured;
    const prioritized = activeScope.toSorted((left, right) =>
      right.modalPriority - left.modalPriority
      || right.visibleRatio - left.visibleRatio
      || right.rect.width * right.rect.height - left.rect.width * left.rect.height
      || right.domIndex - left.domIndex
    );
    const deduplicated = [];
    for (const candidate of prioritized) {
      if (deduplicated.some((saved) => overlapRatio(saved.rect, candidate.rect) > 0.92)) continue;
      deduplicated.push(candidate);
    }
    return deduplicated
      .toSorted((left, right) =>
        left.rect.y - right.rect.y
        || left.rect.x - right.rect.x
        || right.rect.width * right.rect.height - left.rect.width * left.rect.height
      )
      .map(({ element, rect }) => ({ element, rect }));
  }

  function visualElements() {
    const all = composedElements(document);
    const elements = all.filter((element) => element.matches("img, video, canvas, iframe"));
    for (const element of all) {
      if (elements.includes(element)) continue;
      if (isMediaControl(element)) continue;
      if (extractBackgroundUrls(getComputedStyle(element).backgroundImage).size) elements.push(element);
    }
    return elements;
  }

  function isMediaControl(element) {
    return element.matches('button, input, select, textarea, [role="button"], [role="slider"], [role="menuitem"], [aria-controls]');
  }

  function composedElements(root) {
    const result = [];
    for (const element of root.querySelectorAll("*")) {
      if (!(element instanceof HTMLElement)) continue;
      result.push(element);
      if (element.shadowRoot) result.push(...composedElements(element.shadowRoot));
    }
    return result;
  }

  function extractBackgroundUrls(value) {
    const urls = new Set();
    for (const match of String(value ?? "").matchAll(/url\((?:"([^"]*)"|'([^']*)'|([^)]*))\)/gi)) {
      const resolved = resolveVisualUrl(match[1] || match[2] || match[3]);
      if (resolved) urls.add(resolved);
    }
    return urls;
  }

  function resolveVisualUrl(value) {
    try {
      return new URL(String(value ?? "").trim(), document.baseURI).href;
    } catch {
      return "";
    }
  }

  function isVisibleInTree(element) {
    for (let current = element; current instanceof HTMLElement; current = composedParent(current)) {
      if (current.hidden || current.inert || current.getAttribute("aria-hidden") === "true") return false;
      const style = getComputedStyle(current);
      if (style.display === "none" || style.visibility === "hidden" || Number(style.opacity) <= 0) return false;
    }
    return true;
  }

  function composedParent(element) {
    return element.parentElement || element.getRootNode()?.host || null;
  }

  function isActiveVisualScope(element) {
    if (!isVisibleInTree(element)) return false;
    if (element.getAttribute("aria-modal") === "true") return true;
    if (element instanceof HTMLDialogElement && element.open) return true;
    const bounds = element.getBoundingClientRect();
    const visibleWidth = Math.max(0, Math.min(window.innerWidth, bounds.right) - Math.max(0, bounds.left));
    const visibleHeight = Math.max(0, Math.min(window.innerHeight, bounds.bottom) - Math.max(0, bounds.top));
    return visibleWidth * visibleHeight >= window.innerWidth * window.innerHeight * 0.45;
  }

  function visiblePointRatio(element, rect) {
    const insetX = Math.min(Math.max(rect.width * 0.14, 2), rect.width / 2);
    const insetY = Math.min(Math.max(rect.height * 0.14, 2), rect.height / 2);
    const points = [
      [rect.x + rect.width / 2, rect.y + rect.height / 2],
      [rect.x + insetX, rect.y + insetY],
      [rect.x + rect.width - insetX, rect.y + insetY],
      [rect.x + insetX, rect.y + rect.height - insetY],
      [rect.x + rect.width - insetX, rect.y + rect.height - insetY]
    ];
    const visiblePoints = points.filter(([x, y]) => pointShowsElement(element, x, y)).length;
    return visiblePoints / points.length;
  }

  function pointShowsElement(element, x, y) {
    const safeX = Math.max(0, Math.min(window.innerWidth - 1, x));
    const safeY = Math.max(0, Math.min(window.innerHeight - 1, y));
    const root = element.getRootNode();
    const localStack = root instanceof ShadowRoot && typeof root.elementsFromPoint === "function"
      ? root.elementsFromPoint(safeX, safeY)
      : [];
    const stack = [...new Set([...localStack, ...document.elementsFromPoint(safeX, safeY)])]
      .filter((item) => !(item instanceof HTMLElement) || !item.closest?.(`#${rootId}`));
    const elementIndex = stack.findIndex((item) => item === element || item.contains?.(element) || element.contains?.(item));
    if (elementIndex < 0) return false;
    return stack.slice(0, elementIndex).every((blocker) => !visuallyBlocks(element, blocker));
  }

  function visuallyBlocks(element, blocker) {
    if (!(blocker instanceof HTMLElement)) return true;
    if (blocker.id === rootId || blocker.closest?.(`#${rootId}`)) return false;
    if (element.contains(blocker) || blocker.contains(element)) return false;
    const style = getComputedStyle(blocker);
    if (style.display === "none" || style.visibility === "hidden" || Number(style.opacity) <= 0.05) return false;
    if (blocker instanceof HTMLImageElement || blocker instanceof HTMLVideoElement || blocker instanceof HTMLCanvasElement) {
      return true;
    }
    if (style.backgroundImage !== "none" || style.backdropFilter !== "none") return true;
    const color = style.backgroundColor.match(/rgba?\(([^)]+)\)/i);
    if (!color) return false;
    const channels = color[1].split(/[\s,/]+/).filter(Boolean);
    return channels.length < 4 || Number(channels[3]) > 0.05;
  }

  function overlapRatio(left, right) {
    const width = Math.max(0, Math.min(left.x + left.width, right.x + right.width) - Math.max(left.x, right.x));
    const height = Math.max(0, Math.min(left.y + left.height, right.y + right.height) - Math.max(left.y, right.y));
    const intersection = width * height;
    return intersection / Math.max(1, Math.min(left.width * left.height, right.width * right.height));
  }

  let candidates = collectCandidates();
  if (!candidates.length) return Promise.resolve({
    sessionId,
    selections: [],
    candidateCount: 0,
    selectedCount: 0,
    fullscreen: Boolean(document.fullscreenElement),
    empty: true
  });

  return new Promise((resolve) => {
    const root = document.createElement("div");
    const toolbar = document.createElement("div");
    const copy = document.createElement("span");
    const count = document.createElement("span");
    const actions = document.createElement("span");
    const addButton = document.createElement("button");
    const cancelButton = document.createElement("button");
    const selected = new Set();
    const candidateButtons = new Map();
    let finished = false;
    let geometryFrame = 0;
    let discoveryTimer = 0;
    let geometryRevision = 0;
    let candidateRevision = 0;
    let keepAlivePort = null;
    let keepAliveInterval = null;
    let activeCandidateInteraction = null;
    let pendingCandidateRefresh = false;
    let interactionReleaseTimer = 0;

    root.id = rootId;
    toolbar.className = "prompt-case-visual-picker-toolbar";
    copy.textContent = options.instruction || "点击选择图片，可多选 · Esc 取消";
    count.className = "prompt-case-visual-picker-count";
    addButton.type = "button";
    addButton.className = "prompt-case-visual-picker-add";
    addButton.textContent = options.add || "加入素材";
    addButton.disabled = true;
    cancelButton.type = "button";
    cancelButton.className = "prompt-case-visual-picker-cancel";
    cancelButton.textContent = options.cancel || "取消";
    actions.append(cancelButton, addButton);
    toolbar.append(copy, count, actions);
    if (!externalControls) root.append(toolbar);

    function syncCandidateButtons() {
      const connected = new Set(candidates.map((candidate) => candidate.element));
      for (const [element, button] of candidateButtons) {
        if (connected.has(element)) continue;
        button.remove();
        candidateButtons.delete(element);
      }
      for (const [index, candidate] of candidates.entries()) {
        let button = candidateButtons.get(candidate.element);
        if (!button) {
          button = document.createElement("button");
          button.type = "button";
          button.className = "prompt-case-visual-candidate";
          const badge = document.createElement("span");
          badge.textContent = "✓";
          button.append(badge);
          button.addEventListener("pointerdown", (event) => {
            event.preventDefault();
            activeCandidateInteraction = candidate.element;
            if (interactionReleaseTimer) clearTimeout(interactionReleaseTimer);
          });
          button.addEventListener("click", (event) => {
            event.preventDefault();
            event.stopImmediatePropagation();
            if (selected.has(candidate.element)) selected.delete(candidate.element);
            else if (selected.size < maximumSelections) selected.add(candidate.element);
            renderSelectionState();
            releaseCandidateInteraction();
          });
          root.append(button);
          candidateButtons.set(candidate.element, button);
        }
        button.dataset.candidateIndex = String(index);
        button.setAttribute("aria-label", `${options.candidateLabel || "选择图片"} ${index + 1}`);
        updateCandidateButtonGeometry(button, candidate.rect);
      }
    }
    syncCandidateButtons();
    overlayMount().appendChild(root);
    renderSelectionState();
    notifyState();

    try {
      keepAlivePort = chrome.runtime.connect({ name: "capture-region" });
      keepAliveInterval = setInterval(
        () => keepAlivePort?.postMessage({ type: "CAPTURE_ACTIVE" }),
        20_000
      );
    } catch {
    }

    const timeoutId = setTimeout(() => finish(null, "timeout"), 120_000);
    addButton.addEventListener("click", () => {
      if (!selected.size) return;
      const selections = candidates.filter((candidate) => selected.has(candidate.element)).map((candidate) => ({
        rect: { ...candidate.rect },
        viewportWidth: window.innerWidth,
        viewportHeight: window.innerHeight
      }));
      finish({ selections }).catch((error) => {
        console.error("[PromptDirector] 智能选图确认失败", error);
      });
    });
    cancelButton.addEventListener("click", () => finish(null, "cancelled"));
    window.addEventListener("keydown", onKeyDown, true);
    if (!externalControls) {
      window.addEventListener("wheel", stopScroll, { capture: true, passive: false });
      window.addEventListener("touchmove", stopScroll, { capture: true, passive: false });
    }
    window.addEventListener("scroll", scheduleGeometryRefresh, true);
    window.addEventListener("resize", scheduleGeometryRefresh, true);
    window.visualViewport?.addEventListener("resize", scheduleGeometryRefresh);
    window.visualViewport?.addEventListener("scroll", scheduleGeometryRefresh);
    document.addEventListener("fullscreenchange", handleFullscreenChange, true);
    window.addEventListener("pagehide", handlePageHide, { once: true });
    const mutationObserver = new MutationObserver((records) => {
      if (records.every((record) => root.contains(record.target))) return;
      const structural = records.some((record) => record.type === "childList");
      if (structural) scheduleCandidateDiscovery();
      else {
        scheduleGeometryRefresh();
        scheduleCandidateDiscovery();
      }
    });
    mutationObserver.observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ["class", "style", "hidden", "open", "src"] });
    chrome.runtime.onMessage.addListener(handleSessionMessage);
    for (const type of ["pointerdown", "pointerup", "pointercancel", "mousedown", "mouseup", "click", "auxclick", "contextmenu"]) {
      root.addEventListener(type, stopPageEvent);
    }
    for (const type of ["pointerdown", "pointerup", "pointercancel", "mousedown", "mouseup", "click", "auxclick", "contextmenu", "touchstart", "touchend"]) {
      document.addEventListener(type, stopUnderlyingPageEvent, { capture: true, passive: false });
    }

    function renderSelectionState() {
      count.textContent = (options.selectedCount || "已选 {count} 张").replace("{count}", String(selected.size));
      addButton.disabled = !selected.size;
      for (const [element, button] of candidateButtons) {
        const isSelected = selected.has(element);
        button.classList.toggle("is-selected", isSelected);
        button.setAttribute("aria-pressed", String(isSelected));
      }
      notifyState();
    }

    function onKeyDown(event) {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        finish(null, "cancelled");
      } else if (event.key === "Enter" && selected.size && !event.target.closest?.("button")) {
        event.preventDefault();
        addButton.click();
      }
    }

    function handleSessionMessage(message, _sender, sendResponse) {
      if (!externalControls || message?.type !== "PROMPTDIRECTOR_SMART_VISUAL_SELECTION" || message.sessionId !== sessionId) return undefined;
      if (message.action === "status") {
        sendResponse({ ok: true, ...sessionState() });
        return false;
      }
      if (message.action === "cancel") {
        finish(null, "cancelled").then(() => sendResponse({ ok: true, cancelled: true, sessionId }));
        return true;
      }
      if (message.action === "confirm") {
        if (!selected.size) {
          sendResponse({ ok: false, message: "请先在网页中选择至少一张图片", ...sessionState() });
          return false;
        }
        const selections = candidates.filter((candidate) => selected.has(candidate.element)).map((candidate) => ({
          rect: { ...candidate.rect },
          viewportWidth: window.innerWidth,
          viewportHeight: window.innerHeight
        }));
        finish({ selections }, "confirmed").then((result) => sendResponse({ ok: true, ...result }));
        return true;
      }
      return undefined;
    }

    function sessionState() {
      return {
        sessionId,
        candidateCount: candidates.length,
        selectedCount: selected.size,
        geometryRevision,
        candidateRevision,
        overlayReady: root.isConnected,
        fullscreenMode: document.fullscreenElement ? "element" : options.browserFullscreen ? "browser" : "none",
        fullscreen: Boolean(document.fullscreenElement || options.browserFullscreen)
      };
    }

    function notifyState() {
      if (!externalControls) return;
      chrome.runtime.sendMessage({ type: "SMART_VISUAL_SELECTION_CHANGED", ...sessionState() }).catch(() => undefined);
    }

    function scheduleGeometryRefresh() {
      if (activeCandidateInteraction) {
        pendingCandidateRefresh = true;
        return;
      }
      if (geometryFrame || finished) return;
      geometryFrame = requestAnimationFrame(() => {
        geometryFrame = 0;
        const next = measureKnownCandidates();
        const connected = new Set(next.map((candidate) => candidate.element));
        for (const element of [...selected]) if (!connected.has(element)) selected.delete(element);
        candidates = next;
        geometryRevision += 1;
        syncCandidateButtons();
        renderSelectionState();
      });
    }

    function scheduleCandidateDiscovery() {
      if (finished) return;
      if (discoveryTimer) clearTimeout(discoveryTimer);
      discoveryTimer = setTimeout(() => {
        discoveryTimer = 0;
        if (activeCandidateInteraction) {
          pendingCandidateRefresh = true;
          return;
        }
        const previous = new Set(candidates.map((candidate) => candidate.element));
        const next = collectCandidates();
        const connected = new Set(next.map((candidate) => candidate.element));
        for (const element of [...selected]) if (!connected.has(element)) selected.delete(element);
        const changed = previous.size !== connected.size || [...previous].some((element) => !connected.has(element));
        candidates = next;
        geometryRevision += 1;
        if (changed) candidateRevision += 1;
        syncCandidateButtons();
        renderSelectionState();
      }, 160);
    }

    function measureKnownCandidates() {
      const known = new Set(candidates.map((candidate) => candidate.element).filter((element) => element.isConnected));
      return collectCandidates().filter((candidate) => known.has(candidate.element));
    }

    function updateCandidateButtonGeometry(button, rect) {
      button.style.transform = `translate(${rect.x}px, ${rect.y}px)`;
      button.style.width = `${rect.width}px`;
      button.style.height = `${rect.height}px`;
    }

    function releaseCandidateInteraction() {
      if (interactionReleaseTimer) clearTimeout(interactionReleaseTimer);
      interactionReleaseTimer = setTimeout(() => {
        interactionReleaseTimer = 0;
        activeCandidateInteraction = null;
        if (!pendingCandidateRefresh) return;
        pendingCandidateRefresh = false;
        scheduleCandidateDiscovery();
      }, 0);
    }

    function handleFullscreenChange() {
      const mount = overlayMount();
      if (root.parentElement !== mount) mount.append(root);
      scheduleCandidateDiscovery();
      notifyState();
    }

    function handlePageHide() {
      finish(null, "page-hidden");
    }

    async function finish(result, status = result ? "confirmed" : "cancelled") {
      if (finished) return;
      finished = true;
      clearTimeout(timeoutId);
      if (geometryFrame) cancelAnimationFrame(geometryFrame);
      if (discoveryTimer) clearTimeout(discoveryTimer);
      if (keepAliveInterval) clearInterval(keepAliveInterval);
      if (interactionReleaseTimer) clearTimeout(interactionReleaseTimer);
      try {
        keepAlivePort?.disconnect();
      } catch {
      }
      mutationObserver.disconnect();
      chrome.runtime.onMessage.removeListener(handleSessionMessage);
      window.removeEventListener("keydown", onKeyDown, true);
      window.removeEventListener("wheel", stopScroll, true);
      window.removeEventListener("touchmove", stopScroll, true);
      window.removeEventListener("scroll", scheduleGeometryRefresh, true);
      window.removeEventListener("resize", scheduleGeometryRefresh, true);
      window.visualViewport?.removeEventListener("resize", scheduleGeometryRefresh);
      window.visualViewport?.removeEventListener("scroll", scheduleGeometryRefresh);
      document.removeEventListener("fullscreenchange", handleFullscreenChange, true);
      for (const type of ["pointerdown", "pointerup", "pointercancel", "mousedown", "mouseup", "click", "auxclick", "contextmenu", "touchstart", "touchend"]) {
        document.removeEventListener(type, stopUnderlyingPageEvent, true);
      }
      window.removeEventListener("pagehide", handlePageHide);
      root.remove();
      let completed = null;
      if (result) {
        const captureToken = options.hideFloatingControls === false
          ? ""
          : hideFloatingControls(result.selections.map((selection) => selection.rect));
        await new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done)));
        completed = { ...result, captureToken, sessionId };
      }
      if (externalControls) {
        chrome.runtime.sendMessage({ type: "SMART_VISUAL_SELECTION_ENDED", sessionId, status }).catch(() => undefined);
      } else {
        resolve(completed);
      }
      return completed;
    }

    function stopPageEvent(event) {
      event.preventDefault();
      event.stopImmediatePropagation();
    }

    function stopUnderlyingPageEvent(event) {
      const path = typeof event.composedPath === "function" ? event.composedPath() : [];
      if (path.includes(root) || root.contains(event.target)) return;
      event.preventDefault();
      event.stopImmediatePropagation();
    }

    function stopScroll(event) {
      event.preventDefault();
      event.stopPropagation();
    }

    function hideFloatingControls(rects) {
      const token = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
      const viewportArea = Math.max(1, window.innerWidth * window.innerHeight);
      for (const element of document.querySelectorAll("*")) {
        if (!(element instanceof HTMLElement) || element.id === rootId) continue;
        const style = getComputedStyle(element);
        if (!["fixed", "sticky"].includes(style.position) || style.visibility === "hidden" || style.display === "none") continue;
        const zIndex = Number.parseInt(style.zIndex, 10);
        if (!Number.isFinite(zIndex) || zIndex < 100) continue;
        const bounds = element.getBoundingClientRect();
        const area = bounds.width * bounds.height;
        if (bounds.width < 16 || bounds.height < 16 || bounds.width > 180 || bounds.height > 180 || area > viewportArea * 0.05) continue;
        if (!rects.some((rect) => intersects(bounds, rect))) continue;
        element.dataset.promptCaseCaptureToken = token;
        element.dataset.promptCaseCaptureHadStyle = element.hasAttribute("style") ? "1" : "0";
        element.dataset.promptCaseCaptureStyle = element.getAttribute("style") || "";
        element.style.setProperty("visibility", "hidden", "important");
      }
      return token;
    }

    function intersects(bounds, rect) {
      return bounds.right > rect.x
        && bounds.left < rect.x + rect.width
        && bounds.bottom > rect.y
        && bounds.top < rect.y + rect.height;
    }

    function overlayMount() {
      const fullscreenRoot = document.fullscreenElement;
      return fullscreenRoot instanceof HTMLElement ? fullscreenRoot : document.documentElement;
    }

    if (externalControls) {
      resolve({ ok: true, ...sessionState() });
      notifyState();
    }
  });
}

export function restorePageAfterCapture(token) {
  if (!token) return;
  for (const element of document.querySelectorAll(`[data-prompt-case-capture-token="${token}"]`)) {
    const hadStyle = element.dataset.promptCaseCaptureHadStyle === "1";
    const originalStyle = element.dataset.promptCaseCaptureStyle || "";
    delete element.dataset.promptCaseCaptureToken;
    delete element.dataset.promptCaseCaptureHadStyle;
    delete element.dataset.promptCaseCaptureStyle;
    if (hadStyle) element.setAttribute("style", originalStyle);
    else element.removeAttribute("style");
  }
}

export function showPageToast(message, isError = false) {
  const toastId = "__prompt_case_capture_toast__";
  document.getElementById(toastId)?.remove();
  const toast = document.createElement("div");
  toast.id = toastId;
  toast.textContent = message;
  Object.assign(toast.style, {
    position: "fixed",
    zIndex: "2147483647",
    top: "20px",
    left: "50%",
    transform: "translateX(-50%)",
    maxWidth: "min(520px, calc(100vw - 32px))",
    padding: "11px 16px",
    borderRadius: "999px",
    color: "#fff",
    background: isError ? "#a23c32" : "#176b56",
    boxShadow: "0 12px 34px rgba(0, 0, 0, 0.28)",
    font: "700 13px/1.4 -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
    textAlign: "center",
    pointerEvents: "none"
  });
  document.documentElement.appendChild(toast);
  setTimeout(() => toast.remove(), 2600);
}
