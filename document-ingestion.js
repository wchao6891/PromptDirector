import { parseRTF } from "./vendor/document-ingestion/rtf-toolkit/parser/parser.js";
import { toHTML } from "./vendor/document-ingestion/rtf-toolkit/renderers/html.js";
import TurndownService from "./vendor/document-ingestion/turndown.browser.es.js";

const SOURCE_FORMATS = new Map([
  ["pdf", "pdf"],
  ["txt", "txt"],
  ["md", "markdown"],
  ["markdown", "markdown"],
  ["html", "html"],
  ["htm", "html"],
  ["rtf", "rtf"]
]);

export const DOCUMENT_SOURCE_FORMATS = Object.freeze([...new Set(SOURCE_FORMATS.values())]);

export async function ingestLocalDocument(blob, options = {}) {
  if (!(blob instanceof Blob)) throw new Error("文档文件无效");
  const extension = clean(options.extension).toLocaleLowerCase("en-US");
  const sourceFormat = SOURCE_FORMATS.get(extension);
  if (!sourceFormat) throw new Error("暂不支持这种文档格式");
  if (sourceFormat === "pdf") {
    const contentText = typeof options.extractPdfText === "function"
      ? normalizePlainText(await options.extractPdfText(blob))
      : "";
    return documentResult({ contentText, contentFormat: "plain", sourceFormat });
  }

  const source = await blob.text();
  if (sourceFormat === "markdown") {
    return documentResult({ contentText: normalizeMarkdown(source), contentFormat: "markdown", sourceFormat });
  }
  if (sourceFormat === "txt") {
    return documentResult({ contentText: normalizePlainText(source), contentFormat: "plain", sourceFormat });
  }
  if (sourceFormat === "html") {
    return documentResult({
      contentText: htmlToMarkdown(source, options),
      contentFormat: "markdown",
      sourceFormat
    });
  }
  if (!/^\s*\{\\rtf(?:1)?\b/iu.test(source)) throw new Error("无法读取 RTF：文件头无效或文件已损坏");
  try {
    const html = toHTML(parseRTF(source));
    const contentText = htmlToMarkdown(html, options);
    if (!contentText) throw new Error("没有解析出可阅读文字");
    return documentResult({ contentText, contentFormat: "markdown", sourceFormat });
  } catch (error) {
    throw new Error(`无法读取 RTF：${clean(error?.message) || "文件可能已损坏"}`);
  }
}

export function ingestHtmlDocument(source, options = {}) {
  return documentResult({
    contentText: htmlToMarkdown(source, options),
    contentFormat: "markdown",
    sourceFormat: "html"
  });
}

function htmlToMarkdown(source, options) {
  const documentValue = parseHtml(source, options.parseHtml);
  documentValue.querySelectorAll?.("script,style,noscript,template,iframe,object,embed,form,meta,link").forEach((node) => node.remove());
  documentValue.querySelectorAll?.("*").forEach((node) => {
    for (const attribute of [...(node.attributes ?? [])]) {
      const name = attribute.name.toLocaleLowerCase("en-US");
      const value = clean(attribute.value).toLocaleLowerCase("en-US");
      if (name.startsWith("on") || (["href", "src", "xlink:href"].includes(name) && value.startsWith("javascript:"))) {
        node.removeAttribute(attribute.name);
      }
    }
  });
  const root = documentValue.body || documentValue;
  if (typeof options.toMarkdown === "function") return normalizeMarkdown(options.toMarkdown(root));
  if (!root?.nodeType && typeof root?.textContent === "string") return normalizeMarkdown(root.textContent);
  return normalizeMarkdown(new TurndownService({
    headingStyle: "atx",
    bulletListMarker: "-",
    codeBlockStyle: "fenced",
    emDelimiter: "_",
    strongDelimiter: "**"
  }).turndown(root));
}

function parseHtml(source, parser) {
  if (typeof parser === "function") return parser(source);
  if (typeof DOMParser !== "function") throw new Error("当前环境无法读取结构化文档");
  return new DOMParser().parseFromString(source, "text/html");
}

function documentResult({ contentText, contentFormat, sourceFormat, warnings = [] }) {
  return {
    contentText,
    contentFormat,
    sourceFormat,
    warnings: [...new Set(warnings.map(clean).filter(Boolean))]
  };
}

function normalizeMarkdown(value) {
  return normalizeNewlines(value).replace(/\n{3,}/gu, "\n\n").trim();
}

function normalizePlainText(value) {
  return normalizeNewlines(value).replace(/[\u0000\u0008\u000b\u000c\u000e-\u001f\u007f]/gu, "").trim();
}

function normalizeNewlines(value) {
  return String(value ?? "").replace(/\r\n?/gu, "\n");
}

function clean(value) {
  return String(value ?? "").trim();
}
