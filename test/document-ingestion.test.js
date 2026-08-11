import test from "node:test";
import assert from "node:assert/strict";

import { ingestLocalDocument } from "../document-ingestion.js";
import { detectLocalMediaFile, prepareLocalMedia } from "../local-media.js";

const parseHtml = (source) => ({ body: source, querySelectorAll: () => [] });
const toMarkdown = (source) => String(source)
  .replace(/<strong[^>]*>(.*?)<\/strong>/gis, "**$1**")
  .replace(/<h([1-6])[^>]*>(.*?)<\/h\1>/gis, (_match, level, text) => `${"#".repeat(Number(level))} ${text}\n`)
  .replace(/<li[^>]*>(.*?)<\/li>/gis, "- $1\n")
  .replace(/<[^>]+>/g, "\n")
  .replace(/\n{2,}/g, "\n");

test("RTF is accepted locally and converted to structured Markdown without storing control codes", async () => {
  const source = String.raw`{\rtf1\ansi\ansicpg65001\deff0 {\fonttbl {\f0 Arial;}}\f0\fs24 标题\par 这是 \b bold\b0 text.}`;
  const file = new File([source], "notes.rtf", { type: "application/rtf" });
  assert.deepEqual(detectLocalMediaFile(file), {
    extension: "rtf", kind: "document", mimeType: "application/rtf"
  });
  const prepared = await prepareLocalMedia(file, "document:rtf", {
    relativePath: "notes.rtf",
    estimateStorage: async () => ({ quota: 100_000, usage: 0 }),
    parseHtml,
    toMarkdown
  });
  assert.equal(prepared.contentFormat, "markdown");
  assert.equal(prepared.sourceFormat, "rtf");
  assert.equal(prepared.asset.extractedTextFormat, "markdown");
  assert.match(prepared.contentText, /标题/);
  assert.match(prepared.contentText, /\*\*bold\*\*/);
  assert.doesNotMatch(prepared.contentText, /\\rtf|\\ansi|\\par/);
});

test("damaged RTF fails that file with a readable reason instead of saving raw controls", async () => {
  await assert.rejects(
    ingestLocalDocument(new Blob([String.raw`{\fonttbl broken}`]), { extension: "rtf", parseHtml, toMarkdown }),
    /无法读取 RTF/
  );
});

test("Markdown, text, HTML and PDF return explicit normalized formats", async () => {
  const markdown = await ingestLocalDocument(new Blob(["# 标题\r\n\r\n正文"]), { extension: "md" });
  const text = await ingestLocalDocument(new Blob(["第一行\r第二行"]), { extension: "txt" });
  const html = await ingestLocalDocument(new Blob(["<h1>标题</h1><p>正文</p>"]), { extension: "html", parseHtml, toMarkdown });
  const pdf = await ingestLocalDocument(new Blob(["pdf"]), { extension: "pdf", extractPdfText: async () => "PDF 正文" });
  assert.deepEqual([markdown.contentFormat, text.contentFormat, html.contentFormat, pdf.contentFormat], ["markdown", "plain", "markdown", "plain"]);
  assert.equal(markdown.contentText, "# 标题\n\n正文");
  assert.equal(text.contentText, "第一行\n第二行");
  assert.match(html.contentText, /# 标题/);
  assert.equal(pdf.contentText, "PDF 正文");
});
