// Runs in the source page; no dependencies may cross this injection boundary.
export function pickPageContent(options = {}) {
  const commentLimit = options.commentLimit || 30;
  let collecting = false;
  let finished = false;
  const id = "promptdirector-content-picker";
  document.getElementById(id)?.dispatchEvent(new Event("cancel"));
  const overlay = document.createElement("div");
  overlay.id = id;
  Object.assign(overlay.style, { position: "fixed", pointerEvents: "none", zIndex: "2147483647", border: "2px solid #bafa00", background: "rgba(186,250,0,.08)", display: "none" });
  const cancel = document.createElement("button");
  cancel.textContent = "取消选取";
  Object.assign(cancel.style, { position: "fixed", top: "16px", right: "16px", zIndex: "2147483647", padding: "10px 16px", borderRadius: "8px", border: "1px solid #777", background: "#161719", color: "white", cursor: "pointer" });
  document.documentElement.append(overlay, cancel);
  let selected;
  const originalScroll = { x: scrollX, y: scrollY };
  const target = event => {
    const node = event.composedPath().find(value => value instanceof Element);
    if (!node || node === cancel || node === overlay) return null;
    const comments = event.composedPath().find(value => value instanceof Element && value.matches("ytd-comments,bili-comments"));
    if (comments) return comments;
    return node.closest("p,li,blockquote,pre,table,figure,img,video,iframe,section,article,div") || node;
  };
  const serialize = node => {
    if (node.nodeType === Node.TEXT_NODE) return document.createTextNode(node.textContent);
    if (!(node instanceof Element) || node.matches("script,style,noscript,button,input,textarea,select")) return document.createDocumentFragment();
    const copy = document.createElement(node.localName.includes("-") ? "div" : node.localName);
    for (const name of ["href", "src", "poster", "alt", "colspan", "rowspan", "width", "height", "srcset", "sizes", "data-src", "data-original", "data-video-src", "download"]) {
      const value = node[name] || node.getAttribute(name);
      if ((typeof value === "string" || typeof value === "number") && value !== "") copy.setAttribute(name, String(value));
      else if (name === "download" && node.hasAttribute(name)) copy.setAttribute(name, "");
    }
    if (node.matches("img,video")) copy.setAttribute("src", node.currentSrc || node.src || "");
    const children = node.localName === "slot" ? node.assignedNodes({ flatten: true }) : (node.shadowRoot || node).childNodes;
    for (const child of children) copy.append(serialize(child));
    return copy;
  };
  const deepAll = (root, selector) => {
    const result = [];
    const visit = node => {
      if (node instanceof Element && node.matches(selector)) result.push(node);
      for (const child of (node.shadowRoot || node).children || []) visit(child);
    };
    visit(root);
    return result;
  };
  const visible = node => Boolean(node?.getClientRects().length) && getComputedStyle(node).visibility !== "hidden";
  const commentNodes = root => deepAll(root, "ytd-comment-view-model,ytd-comment-renderer,bili-comment-renderer,bili-comment-reply-renderer");
  const collectComments = async (area, event) => {
    const wrapper = document.createElement("div");
    const threads = deepAll(area, "ytd-comment-thread-renderer,bili-comment-thread-renderer");
    const clicked = event.composedPath().find(node => threads.includes(node));
    const start = clicked ? threads.indexOf(clicked) : 0;
    const deadline = Date.now() + options.timeoutMs;
    let count = 0;
    const append = node => {
      if (count >= commentLimit || !visible(node)) return;
      const content = deepAll(node, "#content-text,bili-rich-text")[0];
      if (!content) return;
      const author = deepAll(node, "#author-text,#user-name")[0]?.textContent?.trim() || "";
      const body = serialize(content);
      // Emoji belong to the comment, not to the case's image collection.
      for (const image of body.querySelectorAll?.("img") || []) image.replaceWith(document.createTextNode(image.alt || ""));
      const contentText = body.textContent.trim();
      if (!contentText) return;
      const paragraph = document.createElement("p");
      paragraph.textContent = author ? `${author}：${contentText}` : contentText;
      wrapper.append(paragraph); count += 1;
    };
    for (const thread of threads.slice(start)) {
      if (finished || count >= commentLimit) break;
      const parent = commentNodes(thread)[0];
      if (parent) append(parent);
      const replies = deepAll(thread, "ytd-comment-replies-renderer,bili-comment-replies-renderer")[0];
      if (!replies || count >= commentLimit) continue;
      const expand = deepAll(replies, "#more-replies button,#more-replies-sub-thread button,#view-more bili-text-button").find(visible);
      if (expand && Date.now() < deadline) {
        const before = commentNodes(replies).length;
        await new Promise(resolve => {
          const observer = new MutationObserver(() => { if (commentNodes(replies).length > before || finished) done(); });
          const done = () => { clearTimeout(timer); observer.disconnect(); resolve(); };
          const timer = setTimeout(done, Math.max(0, deadline - Date.now()));
          observer.observe(replies.shadowRoot || replies, { childList: true, subtree: true });
          expand.scrollIntoView({ block: "center" });
          expand.click();
        });
      }
      for (const reply of commentNodes(replies)) append(reply);
    }
    return { html: wrapper.innerHTML, supplement: "comments", commentCount: count };
  };
  return new Promise(resolve => {
    const finish = value => {
      if (finished) return;
      finished = true;
      document.removeEventListener("pointerover", hover, true);
      document.removeEventListener("click", click, true);
      document.removeEventListener("keydown", key, true);
      overlay.remove(); cancel.remove();
      if (collecting) window.scrollTo(originalScroll.x, originalScroll.y);
      resolve(value);
    };
    const hover = event => {
      if (collecting) return;
      selected = target(event);
      if (!selected) { overlay.style.display = "none"; return; }
      const rect = selected.getBoundingClientRect();
      Object.assign(overlay.style, { display: "block", left: `${rect.left}px`, top: `${rect.top}px`, width: `${rect.width}px`, height: `${rect.height}px` });
    };
    const click = async event => {
      if (event.composedPath().includes(cancel)) { event.preventDefault(); event.stopImmediatePropagation(); finish({ cancelled: true }); return; }
      if (collecting) return;
      selected = target(event);
      if (!selected) return;
      event.preventDefault(); event.stopImmediatePropagation();
      if (selected.matches("ytd-comments,bili-comments")) {
        collecting = true;
        try { finish(await collectComments(selected, event)); }
        catch (error) { console.debug("PromptDirector comment selection", error); finish({ cancelled: true }); }
        return;
      }
      const wrapper = document.createElement("div"); wrapper.append(serialize(selected));
      finish({ html: wrapper.innerHTML });
    };
    const key = event => { if (event.key === "Escape") { event.preventDefault(); finish({ cancelled: true }); } };
    overlay.addEventListener("cancel", () => finish({ cancelled: true }), { once: true });
    document.addEventListener("pointerover", hover, true);
    document.addEventListener("click", click, true);
    document.addEventListener("keydown", key, true);
  });
}
