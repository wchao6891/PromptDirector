import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { createZipBlob, openZipBlob, readZipBlob } from "../extension/zip.js";
import { renderLibraryJson } from "../extension/lib.js";
import { parseLibraryPackage } from "../extension/library-package.js";
import { sha256Blob } from "../extension/blob-digest.js";
import { resolveZip64Extra, zipSafeInteger } from "../extension/zip64.js";
import { verifiedDocumentBlob } from "../extension/bounded-media.js";

test("more than 5000 cases and projects survive default transfer parsing", () => {
  const entries = Array.from({ length: 5001 }, (_, index) => ({
    id: `case-${index}`, title: `Case ${index}`, text: `Original ${index}`, savedAt: "2026-09-07T00:00:00.000Z"
  }));
  const data = JSON.parse(renderLibraryJson(entries));
  data.organizerState = { collections: entries.map((entry, index) => ({
    id: `project-${index}`, name: `Project ${index}`, parentId: null, order: index, entryIds: [entry.id]
  })) };
  const parsed = parseLibraryPackage(data);
  assert.equal(parsed.entries.length, entries.length);
  assert.equal(parsed.organizerState.collections.length, entries.length);
  assert.equal(parsed.entries.at(-1).text, entries.at(-1).text);
  assert.deepEqual(parsed.organizerState.collections.at(-1).entryIds, [entries.at(-1).id]);
});

test("ZIP64 directory counts roundtrip beyond both the former file quota and ZIP32 count", async () => {
  const files = Array.from({ length: 65536 }, (_, index) => ({ name: `files/${index}.txt`, data: "" }));
  const archive = await createZipBlob(files);
  const reader = await openZipBlob(archive);
  assert.equal(reader.names.length, files.length);
  const selected = await reader.read([files[0].name, files.at(-1).name]);
  assert.equal(selected.size, 2);
});

test("Python ZIP64 local headers and compressed payloads are readable without relaxed limits", async () => {
  const bytes = execFileSync("python3", ["-c", `
import io,sys,zipfile
b=io.BytesIO()
with zipfile.ZipFile(b,'w',compression=zipfile.ZIP_DEFLATED) as z:
 with z.open('attachments/original.psd','w',force_zip64=True) as f: f.write(b'original'*1024)
sys.stdout.buffer.write(b.getvalue())
`]);
  const files = await readZipBlob(new Blob([bytes]));
  assert.equal(await files.get("attachments/original.psd").text(), "original".repeat(1024));
});

test("ZIP64 rejects missing sizes and integers that cannot be represented exactly", () => {
  assert.throws(() => resolveZip64Extra(new Uint8Array(), { size: 0xffffffff }), /缺失/);
  assert.throws(() => zipSafeInteger(BigInt(Number.MAX_SAFE_INTEGER) + 1n), /可精确处理范围/);
});

test("canceling ZIP reading stops before materializing assets", async () => {
  const archive = await createZipBlob([{ name: "library.json", data: "{}" }]);
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(readZipBlob(archive, {}, { signal: controller.signal }), { name: "AbortError" });
});

test("streaming file hashes preserve standard SHA256 without whole-file arrayBuffer", async () => {
  const bytes = new Uint8Array(1024 * 1024 + 73).fill(19);
  const blob = new Blob([bytes]);
  blob.arrayBuffer = () => { throw new Error("whole-file allocation"); };
  assert.equal(await sha256Blob(blob), createHash("sha256").update(bytes).digest("hex"));
  assert.equal(await sha256Blob(new Blob()), createHash("sha256").digest("hex"));
});

test("local backup document validation streams text and keeps original PDF bytes", async () => {
  const markdown = new Blob(["跨段文字\n".repeat(30000)], { type: "text/markdown" });
  markdown.arrayBuffer = () => { throw new Error("whole document allocation"); };
  const verified = await verifiedDocumentBlob(markdown, "text/markdown", markdown.size);
  assert.equal(await sha256Blob(verified), await sha256Blob(markdown));
  const pdf = new Blob(["%PDF-1.7\n", new Uint8Array(1024 * 1024)], { type: "application/pdf" });
  pdf.arrayBuffer = () => { throw new Error("whole document allocation"); };
  assert.equal((await verifiedDocumentBlob(pdf, "application/pdf", pdf.size)).size, pdf.size);
  for (const invalid of [
    new Blob([markdown, new Uint8Array([0])]),
    new Blob([markdown, new Uint8Array([0xe4, 0xb8])])
  ]) await assert.rejects(verifiedDocumentBlob(invalid, "text/markdown", invalid.size), /有效文档/);
  await assert.rejects(verifiedDocumentBlob(new Blob(["not PDF"]), "application/pdf", 10), /有效文档/);
});
