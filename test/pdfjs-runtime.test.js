import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { verifyPdfjsRuntime } from "../tools/pdfjs-runtime.mjs";

test("PDF.js packaging uses one exact dependency version and a byte-identical vendor runtime", async () => {
  const result = await verifyPdfjsRuntime();
  const projectPackage = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));

  assert.equal(result.version, projectPackage.dependencies["pdfjs-dist"]);
  assert.ok(result.fileCount > 0);
});

test("the PDF viewer keeps dynamic expression evaluation disabled", async () => {
  const source = await readFile(new URL("../document-viewer.js", import.meta.url), "utf8");
  assert.match(source, /isEvalSupported:\s*false/);
});
