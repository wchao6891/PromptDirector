// These functions run in the page's isolated world via chrome.scripting.
export function renderPageCaptureRegionPreview({ marker = "", targets = [], text = "", mediaIds = [], mediaUrls = [], edits = [], locate = false } = {}) {
  const id = "promptdirector-page-capture-region-preview";
  const attribute = "data-promptdirector-capture-highlight";
  document.getElementById(id)?.remove();
  document.querySelectorAll(`[${attribute}]`).forEach(element => element.removeAttribute(attribute));
  if (!marker) return { ok: true, count: 0 };
  const root = [...document.querySelectorAll("[data-promptdirector-capture-region]")]
    .find(element => element.getAttribute("data-promptdirector-capture-region") === marker);
  if (!root) return { ok: false };
  const clean = value => String(value || "").replace(/\s+/gu, " ").trim();
  const savedText = clean(text);
  const selectedMedia = new Set(mediaIds);
  const selectedUrls = new Set(mediaUrls);
  const resolved = new Set();
  for (const target of targets) {
    if (target.kind === "group") continue;
    let element;
    try { element = document.querySelector(target.path); } catch { continue; }
    if (!element) continue;
    if (target.kind === "text") {
      const value = clean(element.innerText || element.textContent);
      if (!value || !savedText.includes(value)) continue;
    } else if (!target.mediaIds?.some(id => selectedMedia.has(id))) continue;
    resolved.add(element);
  }
  // Added content can lie outside the original root. Its saved text/media,
  // rather than the parent container rectangle, determines the visible marks.
  const selector = "h1,h2,h3,h4,h5,h6,p,li,blockquote,pre,table,img,video,iframe,a[href]";
  for (const edit of edits) {
    if (edit.mode !== "include") continue;
    let included;
    try { included = document.querySelector(edit.path); } catch { continue; }
    if (!included) continue;
    const leaves = [...included.querySelectorAll(selector)];
    if (included.matches(selector) || !leaves.length) leaves.unshift(included);
    for (const element of leaves) {
      const value = clean(element.innerText || element.textContent);
      const urls = [element.currentSrc, element.src, element.href, element.getAttribute("data-src")];
      if ((value && savedText.includes(value)) || urls.some(url => selectedUrls.has(url))) resolved.add(element);
    }
  }
  if (!resolved.size) return { ok: false };
  const style = document.createElement("style");
  style.id = id;
  style.textContent = `[${attribute}="true"]{outline:2px solid #809329!important;outline-offset:3px!important}`;
  document.documentElement.append(style);
  resolved.forEach(element => element.setAttribute(attribute, "true"));
  if (locate) [...resolved][0].scrollIntoView({ block: "center", inline: "nearest", behavior: "instant" });
  return { ok: true, count: resolved.size };
}

export function clearPageCapturePageState(options = {}) {
  if (options.removePreview !== false) {
    document.getElementById("promptdirector-page-capture-region-preview")?.remove();
    document.querySelectorAll("[data-promptdirector-capture-highlight]").forEach(element => element.removeAttribute("data-promptdirector-capture-highlight"));
  }
  if (options.removeEditor !== false) {
    const editor = document.getElementById("promptdirector-page-capture-region-editor");
    editor?.dispatchEvent(new Event("promptdirector-cancel"));
    editor?.remove();
  }
  for (const element of document.querySelectorAll("[data-promptdirector-page-edit-include],[data-promptdirector-page-edit-exclude],[data-promptdirector-page-edit-hover]")) {
    element.removeAttribute("data-promptdirector-page-edit-include");
    element.removeAttribute("data-promptdirector-page-edit-exclude");
    element.removeAttribute("data-promptdirector-page-edit-hover");
  }
  if (options.removeRegionMarkers) {
    for (const element of document.querySelectorAll("[data-promptdirector-capture-region]")) element.removeAttribute("data-promptdirector-capture-region");
  }
  return true;
}
