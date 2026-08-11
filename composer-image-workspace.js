const MIN_ZOOM = 0.1;
const MAX_ZOOM = 8;

export function scalePointerToImage({ clientX, clientY, rect, imageWidth, imageHeight }) {
  const width = Math.max(1, Number(rect?.width) || 0);
  const height = Math.max(1, Number(rect?.height) || 0);
  return {
    x: clamp((Number(clientX) - Number(rect?.left || 0)) / width * imageWidth, 0, imageWidth),
    y: clamp((Number(clientY) - Number(rect?.top || 0)) / height * imageHeight, 0, imageHeight)
  };
}

export function createMaskDocument(width, height) {
  return {
    width: Math.max(1, Math.round(Number(width) || 1)),
    height: Math.max(1, Math.round(Number(height) || 1)),
    strokes: []
  };
}

export function addMaskStroke(documentValue, strokeValue) {
  const document = normalizeMaskDocument(documentValue);
  const tool = strokeValue?.tool === "eraser" ? "eraser" : "brush";
  const size = clamp(Number(strokeValue?.size) || 1, 1, Math.max(document.width, document.height));
  const points = (Array.isArray(strokeValue?.points) ? strokeValue.points : []).flatMap((point) => {
    const x = Number(point?.x);
    const y = Number(point?.y);
    return Number.isFinite(x) && Number.isFinite(y)
      ? [{ x: clamp(x, 0, document.width), y: clamp(y, 0, document.height) }]
      : [];
  });
  if (!points.length) return document;
  return { ...document, strokes: [...document.strokes, { tool, size, points }] };
}

export function undoMaskStroke(documentValue) {
  const document = normalizeMaskDocument(documentValue);
  return { ...document, strokes: document.strokes.slice(0, -1) };
}

export function clearMaskStrokes(documentValue) {
  const document = normalizeMaskDocument(documentValue);
  return { ...document, strokes: [] };
}

export function maskAlphaAt(documentValue, xValue, yValue) {
  const document = normalizeMaskDocument(documentValue);
  const point = { x: Number(xValue) || 0, y: Number(yValue) || 0 };
  let alpha = 255;
  for (const stroke of document.strokes) {
    if (strokeContains(stroke, point)) alpha = stroke.tool === "eraser" ? 255 : 0;
  }
  return alpha;
}

export function createComposerImageWorkspace(options = {}) {
  const translate = typeof options.translate === "function" ? options.translate : (value) => value;
  const root = buildWorkspace(translate);
  const refs = Object.fromEntries([...root.querySelectorAll("[data-workspace-id]")]
    .map((node) => [node.dataset.workspaceId, node]));
  document.body.append(root);

  let items = [];
  let index = 0;
  let currentUrl = "";
  let currentBlob = null;
  let naturalWidth = 1;
  let naturalHeight = 1;
  let zoom = 1;
  let fitZoom = 1;
  let pan = { x: 0, y: 0 };
  let editorOpen = false;
  let editMode = "whole";
  let tool = "brush";
  let mask = createMaskDocument(1, 1);
  let draftStroke = null;
  let submitting = false;
  const pointers = new Map();
  let gesture = null;

  const current = () => items[index] ?? null;

  async function open(input = {}) {
    items = Array.isArray(input.items) ? input.items.filter((item) => item?.output?.visual?.id) : [];
    index = clamp(Math.trunc(Number(input.index) || 0), 0, Math.max(0, items.length - 1));
    editorOpen = input.startEditing === true;
    refs.editor.hidden = !editorOpen;
    root.dataset.editing = String(editorOpen);
    if (!root.open) root.showModal();
    await renderCurrent();
  }

  function close() {
    if (root.open) root.close();
  }

  async function renderCurrent() {
    const item = current();
    if (!item) return close();
    refs.error.textContent = "";
    refs.counter.textContent = `${index + 1} / ${items.length}`;
    refs.previous.disabled = index <= 0;
    refs.next.disabled = index >= items.length - 1;
    refs.title.textContent = item.run?.title || translate("生成图片");
    refs.meta.textContent = generationMeta(item, translate);
    const capabilities = item.capabilities ?? { whole: false, local: false };
    refs.edit.disabled = !capabilities.whole;
    refs.localMode.disabled = !capabilities.local;
    if (!capabilities.local && editMode === "local") setEditMode("whole");
    currentBlob = await options.loadBlob?.(item.output.visual.id);
    if (!(currentBlob instanceof Blob)) throw new Error(translate("无法读取这张生成图片"));
    if (currentUrl) URL.revokeObjectURL(currentUrl);
    currentUrl = URL.createObjectURL(currentBlob);
    refs.image.src = currentUrl;
    await refs.image.decode().catch(() => undefined);
    naturalWidth = refs.image.naturalWidth || item.output.visual.width || 1;
    naturalHeight = refs.image.naturalHeight || item.output.visual.height || 1;
    refs.layer.style.width = `${naturalWidth}px`;
    refs.layer.style.height = `${naturalHeight}px`;
    refs.mask.width = naturalWidth;
    refs.mask.height = naturalHeight;
    mask = createMaskDocument(naturalWidth, naturalHeight);
    refs.instruction.value = "";
    setTool("brush");
    fitImage();
    renderMaskOverlay();
  }

  function fitImage() {
    const rect = refs.viewport.getBoundingClientRect();
    fitZoom = clamp(Math.min((rect.width - 40) / naturalWidth, (rect.height - 40) / naturalHeight), MIN_ZOOM, 1);
    zoom = fitZoom;
    pan = { x: 0, y: 0 };
    applyTransform();
  }

  function setZoom(value) {
    zoom = clamp(Number(value) || fitZoom, MIN_ZOOM, MAX_ZOOM);
    applyTransform();
  }

  function applyTransform() {
    refs.layer.style.transform = `translate(-50%, -50%) translate3d(${pan.x}px, ${pan.y}px, 0) scale(${zoom})`;
    refs.zoomLabel.textContent = `${Math.round(zoom * 100)}%`;
  }

  function setEditMode(value) {
    editMode = value === "local" && !refs.localMode.disabled ? "local" : "whole";
    root.dataset.editMode = editMode;
    refs.wholeMode.setAttribute("aria-pressed", String(editMode === "whole"));
    refs.localMode.setAttribute("aria-pressed", String(editMode === "local"));
    refs.maskTools.hidden = editMode !== "local";
    refs.mask.hidden = editMode !== "local";
    refs.submit.textContent = translate(editMode === "local" ? "修改选区" : "修改整图");
  }

  function setTool(value) {
    tool = value === "eraser" ? "eraser" : "brush";
    refs.brush.setAttribute("aria-pressed", String(tool === "brush"));
    refs.eraser.setAttribute("aria-pressed", String(tool === "eraser"));
  }

  function renderMaskOverlay() {
    const context = refs.mask.getContext("2d");
    context.clearRect(0, 0, naturalWidth, naturalHeight);
    for (const stroke of mask.strokes) drawStroke(context, stroke, true);
    if (draftStroke) drawStroke(context, draftStroke, true);
  }

  async function submitEdit() {
    const item = current();
    const instruction = refs.instruction.value.trim();
    if (!instruction) return showError(translate("请先说明要修改什么"));
    if (editMode === "local" && !mask.strokes.length) return showError(translate("请先在图片上涂抹要修改的区域"));
    submitting = true;
    refs.submit.disabled = true;
    refs.error.textContent = "";
    try {
      const maskBlob = editMode === "local" ? await renderMaskBlob(mask) : null;
      await options.onEdit?.({ item, mode: editMode, instruction, maskBlob });
      close();
    } catch (error) {
      showError(error?.message || translate("图片修改失败，提示词和选区已保留"));
    } finally {
      submitting = false;
      refs.submit.disabled = false;
    }
  }

  function showError(message) {
    refs.error.textContent = String(message || "");
  }

  async function navigate(nextIndex) {
    if (submitting || nextIndex < 0 || nextIndex >= items.length) return;
    index = nextIndex;
    await renderCurrent();
  }

  refs.close.addEventListener("click", close);
  root.addEventListener("cancel", (event) => { event.preventDefault(); close(); });
  refs.previous.addEventListener("click", () => navigate(index - 1));
  refs.next.addEventListener("click", () => navigate(index + 1));
  refs.fit.addEventListener("click", fitImage);
  refs.actual.addEventListener("click", () => { pan = { x: 0, y: 0 }; setZoom(1); });
  refs.zoomOut.addEventListener("click", () => setZoom(zoom / 1.2));
  refs.zoomIn.addEventListener("click", () => setZoom(zoom * 1.2));
  refs.edit.addEventListener("click", () => {
    editorOpen = true;
    refs.editor.hidden = false;
    root.dataset.editing = "true";
    refs.instruction.focus();
  });
  refs.wholeMode.addEventListener("click", () => setEditMode("whole"));
  refs.localMode.addEventListener("click", () => setEditMode("local"));
  refs.brush.addEventListener("click", () => setTool("brush"));
  refs.eraser.addEventListener("click", () => setTool("eraser"));
  refs.undo.addEventListener("click", () => { mask = undoMaskStroke(mask); renderMaskOverlay(); });
  refs.clear.addEventListener("click", () => { mask = clearMaskStrokes(mask); renderMaskOverlay(); });
  refs.submit.addEventListener("click", submitEdit);
  refs.download.addEventListener("click", () => downloadBlob(currentBlob, current()?.output?.visual));
  refs.save.addEventListener("click", () => runWorkspaceAction(() => options.onSave?.(current())));
  refs.reference.addEventListener("click", () => runWorkspaceAction(() => options.onUseAsReference?.(current())));
  refs.reroll.addEventListener("click", () => runWorkspaceAction(() => options.onReroll?.(current())));
  refs.delete.addEventListener("click", async () => {
    try {
      const item = current();
      const deleted = await options.onDelete?.(item);
      if (deleted === false) return;
      items.splice(index, 1);
      if (!items.length) return close();
      index = Math.min(index, items.length - 1);
      await renderCurrent();
    } catch (error) {
      showError(error?.message || translate("操作失败"));
    }
  });

  async function runWorkspaceAction(callback) {
    refs.error.textContent = "";
    try { await callback(); }
    catch (error) { showError(error?.message || translate("操作失败")); }
  }

  refs.viewport.addEventListener("wheel", (event) => {
    event.preventDefault();
    setZoom(zoom * (event.deltaY > 0 ? 0.9 : 1.1));
  }, { passive: false });

  refs.viewport.addEventListener("pointerdown", (event) => {
    if (editMode === "local" && event.target === refs.mask) return;
    refs.viewport.setPointerCapture(event.pointerId);
    pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (pointers.size === 1) gesture = { type: "pan", start: { x: event.clientX, y: event.clientY }, pan: { ...pan } };
    if (pointers.size === 2) {
      const values = [...pointers.values()];
      gesture = { type: "pinch", distance: distance(values[0], values[1]), zoom };
    }
  });
  refs.viewport.addEventListener("pointermove", (event) => {
    if (!pointers.has(event.pointerId)) return;
    pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (gesture?.type === "pinch" && pointers.size >= 2) {
      const values = [...pointers.values()];
      setZoom(gesture.zoom * distance(values[0], values[1]) / Math.max(1, gesture.distance));
    } else if (gesture?.type === "pan" && pointers.size === 1) {
      pan = { x: gesture.pan.x + event.clientX - gesture.start.x, y: gesture.pan.y + event.clientY - gesture.start.y };
      applyTransform();
    }
  });
  const endViewportPointer = (event) => { pointers.delete(event.pointerId); if (!pointers.size) gesture = null; };
  refs.viewport.addEventListener("pointerup", endViewportPointer);
  refs.viewport.addEventListener("pointercancel", endViewportPointer);

  refs.mask.addEventListener("pointerdown", (event) => {
    if (editMode !== "local") return;
    event.stopPropagation();
    refs.mask.setPointerCapture(event.pointerId);
    draftStroke = { tool, size: Number(refs.brushSize.value), points: [scalePointerToImage({
      clientX: event.clientX, clientY: event.clientY, rect: refs.mask.getBoundingClientRect(), imageWidth: naturalWidth, imageHeight: naturalHeight
    })] };
    renderMaskOverlay();
  });
  refs.mask.addEventListener("pointermove", (event) => {
    if (!draftStroke || !refs.mask.hasPointerCapture(event.pointerId)) return;
    draftStroke.points.push(scalePointerToImage({
      clientX: event.clientX, clientY: event.clientY, rect: refs.mask.getBoundingClientRect(), imageWidth: naturalWidth, imageHeight: naturalHeight
    }));
    renderMaskOverlay();
  });
  const finishStroke = (event) => {
    if (!draftStroke) return;
    if (refs.mask.hasPointerCapture(event.pointerId)) refs.mask.releasePointerCapture(event.pointerId);
    mask = addMaskStroke(mask, draftStroke);
    draftStroke = null;
    renderMaskOverlay();
  };
  refs.mask.addEventListener("pointerup", finishStroke);
  refs.mask.addEventListener("pointercancel", finishStroke);
  window.addEventListener("resize", () => { if (root.open && Math.abs(zoom - fitZoom) < 0.001) fitImage(); });
  setEditMode("whole");

  return { open, close, element: root };
}

async function renderMaskBlob(documentValue) {
  const document = normalizeMaskDocument(documentValue);
  const canvas = globalThis.document.createElement("canvas");
  canvas.width = document.width;
  canvas.height = document.height;
  const context = canvas.getContext("2d");
  context.fillStyle = "rgba(255,255,255,1)";
  context.fillRect(0, 0, canvas.width, canvas.height);
  for (const stroke of document.strokes) drawStroke(context, stroke, false);
  return new Promise((resolve, reject) => canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error("无法生成选区遮罩")), "image/png"));
}

function drawStroke(context, stroke, overlay) {
  const points = stroke.points;
  if (!points.length) return;
  context.save();
  context.lineCap = "round";
  context.lineJoin = "round";
  context.lineWidth = stroke.size;
  if (overlay) {
    context.globalCompositeOperation = stroke.tool === "eraser" ? "destination-out" : "source-over";
    context.strokeStyle = "rgba(240, 80, 74, .48)";
    context.fillStyle = "rgba(240, 80, 74, .48)";
  } else {
    context.globalCompositeOperation = stroke.tool === "eraser" ? "source-over" : "destination-out";
    context.strokeStyle = "rgba(255,255,255,1)";
    context.fillStyle = "rgba(255,255,255,1)";
  }
  if (points.length === 1) {
    context.beginPath();
    context.arc(points[0].x, points[0].y, stroke.size / 2, 0, Math.PI * 2);
    context.fill();
  } else {
    context.beginPath();
    context.moveTo(points[0].x, points[0].y);
    for (const point of points.slice(1)) context.lineTo(point.x, point.y);
    context.stroke();
  }
  context.restore();
}

function strokeContains(stroke, point) {
  if (!stroke.points.length) return false;
  if (stroke.points.some((candidate) => distance(candidate, point) <= stroke.size / 2)) return true;
  for (let index = 1; index < stroke.points.length; index += 1) {
    if (distanceToSegment(point, stroke.points[index - 1], stroke.points[index]) <= stroke.size / 2) return true;
  }
  return false;
}

function distanceToSegment(point, start, end) {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  if (!dx && !dy) return distance(point, start);
  const ratio = clamp(((point.x - start.x) * dx + (point.y - start.y) * dy) / (dx * dx + dy * dy), 0, 1);
  return distance(point, { x: start.x + ratio * dx, y: start.y + ratio * dy });
}

function normalizeMaskDocument(value = {}) {
  const width = Math.max(1, Math.round(Number(value.width) || 1));
  const height = Math.max(1, Math.round(Number(value.height) || 1));
  const strokes = (Array.isArray(value.strokes) ? value.strokes : []).flatMap((stroke) => {
    const tool = stroke?.tool === "eraser" ? "eraser" : "brush";
    const size = clamp(Number(stroke?.size) || 1, 1, Math.max(width, height));
    const points = (Array.isArray(stroke?.points) ? stroke.points : []).flatMap((point) => {
      const x = Number(point?.x);
      const y = Number(point?.y);
      return Number.isFinite(x) && Number.isFinite(y)
        ? [{ x: clamp(x, 0, width), y: clamp(y, 0, height) }]
        : [];
    });
    return points.length ? [{ tool, size, points }] : [];
  });
  return { width, height, strokes };
}

function buildWorkspace(translate) {
  const t = (value) => escapeHtml(translate(value));
  const dialog = document.createElement("dialog");
  dialog.className = "composer-image-workspace";
  dialog.innerHTML = `
    <header class="composer-image-workspace-header">
      <div class="composer-image-workspace-nav">
        <button type="button" data-workspace-id="previous" aria-label="${t("上一张")}">←</button>
        <span data-workspace-id="counter">1 / 1</span>
        <button type="button" data-workspace-id="next" aria-label="${t("下一张")}">→</button>
      </div>
      <div class="composer-image-zoom-tools">
        <button type="button" data-workspace-id="fit">${t("适应窗口")}</button>
        <button type="button" data-workspace-id="actual">100%</button>
        <button type="button" data-workspace-id="zoomOut" aria-label="${t("缩小")}">−</button>
        <span data-workspace-id="zoomLabel">100%</span>
        <button type="button" data-workspace-id="zoomIn" aria-label="${t("放大")}">＋</button>
      </div>
      <button class="composer-image-workspace-close" type="button" data-workspace-id="close" aria-label="${t("关闭图片工作区")}">×</button>
    </header>
    <div class="composer-image-workspace-body">
      <div class="composer-image-viewport" data-workspace-id="viewport">
        <div class="composer-image-layer" data-workspace-id="layer">
          <img data-workspace-id="image" alt="${t("生成图片原图")}" draggable="false" />
          <canvas data-workspace-id="mask" hidden></canvas>
        </div>
      </div>
      <aside class="composer-image-workspace-panel">
        <div><h2 data-workspace-id="title">${t("生成图片")}</h2><p data-workspace-id="meta"></p></div>
        <div class="composer-image-primary-actions">
          <button type="button" data-workspace-id="download">${t("下载原图")}</button>
          <button type="button" data-workspace-id="save">${t("保存到灵感库")}</button>
          <button type="button" data-workspace-id="reference">${t("作为参考继续")}</button>
          <button type="button" data-workspace-id="reroll">${t("再来一张")}</button>
          <button type="button" data-workspace-id="edit">${t("编辑")}</button>
          <button class="button-danger" type="button" data-workspace-id="delete">${t("删除")}</button>
        </div>
        <section class="composer-image-editor" data-workspace-id="editor" hidden>
          <div class="composer-image-edit-modes" role="group" aria-label="${t("图片修改范围")}">
            <button type="button" data-workspace-id="wholeMode" aria-pressed="true">${t("整图修改")}</button>
            <button type="button" data-workspace-id="localMode" aria-pressed="false">${t("局部修改")}</button>
          </div>
          <div class="composer-mask-tools" data-workspace-id="maskTools" hidden>
            <button type="button" data-workspace-id="brush" aria-pressed="true">${t("画笔")}</button>
            <button type="button" data-workspace-id="eraser" aria-pressed="false">${t("橡皮")}</button>
            <button type="button" data-workspace-id="undo">${t("撤销")}</button>
            <button type="button" data-workspace-id="clear">${t("清空")}</button>
            <label><span>${t("画笔大小")}</span><input data-workspace-id="brushSize" type="range" min="8" max="240" value="72" /></label>
          </div>
          <label class="composer-image-edit-instruction"><span>${t("修改要求")}</span><textarea data-workspace-id="instruction" rows="5" placeholder="${t("说明希望保留什么、只修改什么")}"></textarea></label>
          <p class="composer-image-workspace-error" data-workspace-id="error" role="status"></p>
          <button class="composer-image-edit-submit" type="button" data-workspace-id="submit">${t("修改整图")}</button>
        </section>
      </aside>
    </div>`;
  return dialog;
}

function generationMeta(item, translate) {
  const generation = item.output?.generation;
  const model = generation?.responseModel || generation?.requestModel;
  const modelLabel = generation?.responseModel ? translate("返回模型") : generation?.requestModel ? translate("请求模型") : "";
  return [modelLabel && model ? `${modelLabel}：${model}` : "", item.output?.capturedAt ? new Date(item.output.capturedAt).toLocaleString() : ""]
    .filter(Boolean).join(" · ");
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function downloadBlob(blob, visual = {}) {
  if (!(blob instanceof Blob)) return;
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `promptdirector-${String(visual.id || "image").slice(0, 8)}.${extensionForMime(blob.type)}`;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1_000);
}

function extensionForMime(value) {
  return ({ "image/jpeg": "jpg", "image/webp": "webp", "image/gif": "gif" })[value] || "png";
}

function distance(left, right) {
  return Math.hypot(left.x - right.x, left.y - right.y);
}

function clamp(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, value));
}
