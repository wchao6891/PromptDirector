export function renderMarkdownDocument(sourceValue, options = {}) {
  const root = document.createElement("article");
  root.className = "markdown-reader";
  const lines = normalizeLines(sourceValue);
  for (let index = 0; index < lines.length;) {
    const line = lines[index];
    if (!line.trim()) { index += 1; continue; }

    const fence = line.match(/^\s*```([^`]*)$/);
    if (fence) {
      const values = [];
      index += 1;
      while (index < lines.length && !/^\s*```\s*$/.test(lines[index])) values.push(lines[index++]);
      if (index < lines.length) index += 1;
      const pre = document.createElement("pre");
      const code = document.createElement("code");
      const language = cleanText(fence[1]).split(/\s+/)[0];
      if (language) code.dataset.language = language;
      code.textContent = values.join("\n");
      pre.append(code);
      root.append(pre);
      continue;
    }

    const heading = line.match(/^\s{0,3}(#{1,6})\s+(.+)$/);
    if (heading) {
      const element = document.createElement(`h${heading[1].length}`);
      appendInline(element, heading[2], options);
      root.append(element);
      index += 1;
      continue;
    }

    if (/^\s{0,3}(?:-{3,}|\*{3,}|_{3,})\s*$/.test(line)) {
      root.append(document.createElement("hr"));
      index += 1;
      continue;
    }

    if (/^\s*>/.test(line)) {
      const quote = document.createElement("blockquote");
      const values = [];
      while (index < lines.length && /^\s*>/.test(lines[index])) values.push(lines[index++].replace(/^\s*>\s?/, ""));
      appendInline(quote, values.join("\n"), options);
      root.append(quote);
      continue;
    }

    if (isTableHeader(lines, index)) {
      const table = document.createElement("table");
      const headers = tableCells(lines[index]);
      const head = document.createElement("thead");
      const headRow = document.createElement("tr");
      headers.forEach((value) => {
        const cell = document.createElement("th");
        appendInline(cell, value, options);
        headRow.append(cell);
      });
      head.append(headRow);
      table.append(head);
      index += 2;
      const body = document.createElement("tbody");
      while (index < lines.length && lines[index].includes("|") && lines[index].trim()) {
        const row = document.createElement("tr");
        tableCells(lines[index++]).forEach((value) => {
          const cell = document.createElement("td");
          appendInline(cell, value, options);
          row.append(cell);
        });
        body.append(row);
      }
      table.append(body);
      root.append(table);
      continue;
    }

    const listMatch = listItem(line);
    if (listMatch) {
      const list = document.createElement(listMatch.ordered ? "ol" : "ul");
      while (index < lines.length) {
        const item = listItem(lines[index]);
        if (!item || item.ordered !== listMatch.ordered) break;
        const listElement = document.createElement("li");
        const task = item.text.match(/^\[([ xX])\]\s+(.+)$/);
        if (task) {
          const checkbox = document.createElement("input");
          checkbox.type = "checkbox";
          checkbox.checked = task[1].toLocaleLowerCase("en-US") === "x";
          checkbox.disabled = true;
          listElement.className = "markdown-task";
          listElement.append(checkbox);
          appendInline(listElement, task[2], options);
        } else appendInline(listElement, item.text, options);
        list.append(listElement);
        index += 1;
      }
      root.append(list);
      continue;
    }

    const paragraphLines = [line.trim()];
    index += 1;
    while (index < lines.length && lines[index].trim() && !startsBlock(lines, index)) {
      paragraphLines.push(lines[index].trim());
      index += 1;
    }
    const paragraph = document.createElement("p");
    appendInline(paragraph, paragraphLines.join("\n"), options);
    root.append(paragraph);
  }
  if (!root.childNodes.length) root.textContent = "这个 Markdown 文档没有可显示的文字";
  return root;
}

export function markdownPlainText(value) {
  return normalizeLines(value).join("\n")
    .replace(/^\s*```[^\n]*$/gm, "")
    .replace(/^\s{0,3}#{1,6}\s+/gm, "")
    .replace(/^\s*>\s?/gm, "")
    .replace(/^\s*(?:[-+*]|\d+[.)])\s+(?:\[[ xX]\]\s+)?/gm, "")
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/(?:\*\*|__|~~|`)(.*?)(?:\*\*|__|~~|`)/g, "$1")
    .replace(/\|/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function appendInline(parent, sourceValue, options) {
  const source = String(sourceValue ?? "");
  const tokenPattern = /(!?\[[^\]]*\]\([^)]+\)|`[^`]+`|\*\*[^*]+\*\*|__[^_]+__|~~[^~]+~~|\*[^*]+\*|_[^_]+_)/g;
  let cursor = 0;
  for (const match of source.matchAll(tokenPattern)) {
    if (match.index > cursor) appendTextWithBreaks(parent, source.slice(cursor, match.index));
    appendInlineToken(parent, match[0], options);
    cursor = match.index + match[0].length;
  }
  if (cursor < source.length) appendTextWithBreaks(parent, source.slice(cursor));
}

function appendInlineToken(parent, token, options) {
  const media = token.match(/^(!?)\[([^\]]*)\]\(([^)]+)\)$/);
  if (media) {
    const url = safeRemoteUrl(media[3]);
    if (media[1]) parent.append(remoteImage(url, media[2], options));
    else {
      const link = document.createElement("a");
      link.textContent = media[2] || url || media[3];
      if (url) {
        link.href = url;
        link.target = "_blank";
        link.rel = "noopener noreferrer";
      }
      parent.append(link);
    }
    return;
  }
  const element = document.createElement(token.startsWith("`") ? "code"
    : token.startsWith("~~") ? "s"
      : token.startsWith("**") || token.startsWith("__") ? "strong" : "em");
  element.textContent = token.replace(/^(?:`|~~|\*\*|__|\*|_)/, "").replace(/(?:`|~~|\*\*|__|\*|_)$/, "");
  parent.append(element);
}

function remoteImage(url, alt, options) {
  const figure = document.createElement("span");
  figure.className = "markdown-remote-image";
  if (!url) {
    figure.textContent = alt || "远程图片地址无效";
    return figure;
  }
  const button = document.createElement("button");
  button.type = "button";
  button.className = "button-secondary";
  button.textContent = alt ? `加载图片：${alt}` : "加载远程图片";
  button.addEventListener("click", async () => {
    button.disabled = true;
    try {
      const imageUrl = await options.loadRemoteImage?.(url);
      if (!imageUrl) throw new Error("图片读取失败");
      const image = document.createElement("img");
      image.src = imageUrl;
      image.alt = alt;
      image.loading = "lazy";
      figure.replaceChildren(image);
    } catch (error) {
      button.disabled = false;
      button.textContent = error?.message || "图片读取失败，请重试";
    }
  });
  figure.append(button);
  return figure;
}

function appendTextWithBreaks(parent, value) {
  const parts = String(value).split("\n");
  parts.forEach((part, index) => {
    if (index) parent.append(document.createElement("br"));
    parent.append(document.createTextNode(part));
  });
}

function startsBlock(lines, index) {
  const value = lines[index];
  return /^\s*```|^\s{0,3}#{1,6}\s+|^\s*>|^\s{0,3}(?:[-+*]|\d+[.)])\s+/.test(value) ||
    /^\s{0,3}(?:-{3,}|\*{3,}|_{3,})\s*$/.test(value) || isTableHeader(lines, index);
}

function listItem(value) {
  const match = String(value).match(/^\s{0,3}([-+*]|\d+[.)])\s+(.+)$/);
  return match ? { ordered: /^\d/.test(match[1]), text: match[2] } : null;
}

function isTableHeader(lines, index) {
  return index + 1 < lines.length && lines[index].includes("|") &&
    /^\s*\|?\s*:?-{3,}:?\s*(?:\|\s*:?-{3,}:?\s*)+\|?\s*$/.test(lines[index + 1]);
}

function tableCells(value) {
  return String(value).trim().replace(/^\||\|$/g, "").split("|").map((item) => item.trim());
}

function safeRemoteUrl(value) {
  try {
    const url = new URL(String(value ?? "").trim());
    return ["http:", "https:"].includes(url.protocol) ? url.href : "";
  } catch {
    return "";
  }
}

function normalizeLines(value) {
  return String(value ?? "").replace(/\r\n?/g, "\n").split("\n");
}

function cleanText(value) {
  return String(value ?? "").replace(/[\u0000-\u001f\u007f]/g, "").trim();
}
