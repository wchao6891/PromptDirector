import { GlobalWorkerOptions, getDocument } from "./vendor/pdfjs/pdf.mjs";

GlobalWorkerOptions.workerSrc = chrome.runtime.getURL("vendor/pdfjs/pdf.worker.mjs");

export async function createPdfPreview(blob, desiredWidth = 560) {
  const pdf = await openPdf(blob);
  try {
    const page = await pdf.getPage(1);
    const viewport = page.getViewport({ scale: 1 });
    const scale = desiredWidth / viewport.width;
    const rendered = page.getViewport({ scale });
    const canvas = document.createElement("canvas");
    const outputScale = globalThis.devicePixelRatio || 1;
    canvas.width = Math.max(1, Math.floor(rendered.width * outputScale));
    canvas.height = Math.max(1, Math.floor(rendered.height * outputScale));
    const context = canvas.getContext("2d", { alpha: false });
    await page.render({
      canvasContext: context,
      viewport: rendered,
      transform: outputScale === 1 ? null : [outputScale, 0, 0, outputScale, 0, 0]
    }).promise;
    return { pageCount: pdf.numPages, thumbnail: await canvasBlob(canvas) };
  } finally {
    await pdf.destroy();
  }
}

export async function extractPdfSearchText(blob) {
  const pdf = await openPdf(blob);
  const pages = [];
  try {
    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
      const page = await pdf.getPage(pageNumber);
      const content = await page.getTextContent();
      pages.push(content.items.map((item) => String(item.str ?? "")).join(" "));
      if (pageNumber % 8 === 0) await yieldToBrowser();
    }
    return pages.join("\n").trim();
  } finally {
    await pdf.destroy();
  }
}

export async function createPdfViewer(blob, title = "PDF") {
  const pdf = await openPdf(blob);
  const root = node("div", "pdf-reader");
  const toolbar = node("div", "pdf-reader-toolbar");
  const previous = button("上一页");
  const next = button("下一页");
  const pageStatus = node("span", "pdf-page-status");
  const zoom = document.createElement("select");
  for (const [value, label] of [["0.8", "80%"], ["1", "100%"], ["1.25", "125%"], ["1.5", "150%"], ["2", "200%"]]) {
    const item = document.createElement("option");
    item.value = value;
    item.textContent = label;
    item.selected = value === "1";
    zoom.append(item);
  }
  zoom.setAttribute("aria-label", "PDF 缩放");
  toolbar.append(previous, pageStatus, next, zoom);
  const viewport = node("div", "pdf-page-viewport");
  const canvas = document.createElement("canvas");
  canvas.setAttribute("aria-label", `${title} 页面`);
  viewport.append(canvas);
  root.append(toolbar, viewport);
  let pageNumber = 1;
  let renderTask = null;

  const render = async () => {
    previous.disabled = pageNumber <= 1;
    next.disabled = pageNumber >= pdf.numPages;
    pageStatus.textContent = `${pageNumber} / ${pdf.numPages}`;
    if (renderTask) renderTask.cancel();
    const page = await pdf.getPage(pageNumber);
    const base = page.getViewport({ scale: 1 });
    const availableWidth = Math.max(320, Math.min(920, viewport.clientWidth || 760));
    const scale = (availableWidth / base.width) * Number(zoom.value);
    const pageViewport = page.getViewport({ scale });
    const outputScale = globalThis.devicePixelRatio || 1;
    canvas.width = Math.max(1, Math.floor(pageViewport.width * outputScale));
    canvas.height = Math.max(1, Math.floor(pageViewport.height * outputScale));
    canvas.style.width = `${Math.floor(pageViewport.width)}px`;
    canvas.style.height = `${Math.floor(pageViewport.height)}px`;
    renderTask = page.render({
      canvasContext: canvas.getContext("2d", { alpha: false }),
      viewport: pageViewport,
      transform: outputScale === 1 ? null : [outputScale, 0, 0, outputScale, 0, 0]
    });
    try { await renderTask.promise; } catch (error) { if (error?.name !== "RenderingCancelledException") throw error; }
  };

  previous.addEventListener("click", () => { if (pageNumber > 1) { pageNumber -= 1; render(); } });
  next.addEventListener("click", () => { if (pageNumber < pdf.numPages) { pageNumber += 1; render(); } });
  zoom.addEventListener("change", render);
  await render();
  setTimeout(() => watchViewerRemoval(root, pdf, () => renderTask), 0);
  return root;
}

function watchViewerRemoval(root, pdf, currentRenderTask) {
  if (!root.isConnected) {
    pdf.destroy();
    return;
  }
  const observer = new MutationObserver(() => {
    if (root.isConnected) return;
    observer.disconnect();
    currentRenderTask()?.cancel();
    pdf.destroy();
  });
  observer.observe(document.body, { childList: true, subtree: true });
}

async function openPdf(blob) {
  const loading = getDocument({
    data: new Uint8Array(await blob.arrayBuffer()),
    cMapUrl: chrome.runtime.getURL("vendor/pdfjs/cmaps/"),
    cMapPacked: true,
    isEvalSupported: false,
    standardFontDataUrl: chrome.runtime.getURL("vendor/pdfjs/standard_fonts/"),
    wasmUrl: chrome.runtime.getURL("vendor/pdfjs/wasm/")
  });
  loading.onPassword = (updatePassword) => {
    const password = globalThis.prompt("这个 PDF 需要密码。密码只用于本次打开，不会保存。") ?? "";
    updatePassword(password);
  };
  return loading.promise;
}

function canvasBlob(canvas) {
  return new Promise((resolve, reject) => canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error("无法生成 PDF 预览")), "image/webp", 0.82));
}

function yieldToBrowser() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

function node(tag, className) {
  const value = document.createElement(tag);
  value.className = className;
  return value;
}

function button(label) {
  const value = node("button", "button-secondary");
  value.type = "button";
  value.textContent = label;
  return value;
}
