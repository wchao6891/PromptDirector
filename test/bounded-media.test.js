import test from "node:test";
import assert from "node:assert/strict";

import {
  assertRemoteMediaUrl,
  boundedMediaBlobFromResponse,
  detectImageDimensions,
  fetchBoundedMedia,
  isSupportedDocumentMimeType
} from "../bounded-media.js";

const PNG = Uint8Array.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
  0x00, 0x00, 0x00, 0x0d
]);

test("bounded media rejects declared and streamed overflow before creating a Blob", async () => {
  const declared = new Response(PNG, {
    headers: { "content-type": "image/png", "content-length": "99" }
  });
  await assert.rejects(
    () => boundedMediaBlobFromResponse(declared, { kind: "image", maxBytes: 12 }),
    /超过本地容量上限/
  );

  const streamed = new Response(new Uint8Array([...PNG, 1]));
  await assert.rejects(
    () => boundedMediaBlobFromResponse(streamed, { kind: "image", maxBytes: 12 }),
    /超过本地容量上限/
  );
});

test("bounded media trusts file signatures instead of a spoofed content type", async () => {
  const response = new Response(new TextEncoder().encode("<svg onload=alert(1)></svg>"), {
    headers: { "content-type": "image/png" }
  });
  await assert.rejects(
    () => boundedMediaBlobFromResponse(response, { kind: "image", maxBytes: 1024 }),
    /有效图片文件/
  );
});

test("bounded media returns the detected safe type and refuses redirects", async () => {
  const calls = [];
  const blob = await fetchBoundedMedia("https://media.example/image", {
    kind: "image",
    maxBytes: 1024,
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      return new Response(PNG, { headers: { "content-type": "application/octet-stream" } });
    }
  });
  assert.equal(blob.type, "image/png");
  assert.equal(calls[0].options.redirect, "error");
  assert.equal(calls[0].options.credentials, "omit");
});

test("remote media URLs require HTTPS and cannot contain credentials", () => {
  assert.throws(() => assertRemoteMediaUrl("http://example.com/image.png"), /HTTPS/);
  assert.throws(() => assertRemoteMediaUrl("https://name:secret@example.com/image.png"), /登录凭据/);
  assert.equal(assertRemoteMediaUrl("http://127.0.0.1:8080/image.png", { allowLoopback: true }).hostname, "127.0.0.1");
});

test("bounded images report real header dimensions and reject excessive pixel counts", async () => {
  const sizedPng = Uint8Array.from([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
    0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
    0x00, 0x00, 0x0f, 0xa0, 0x00, 0x00, 0x0b, 0xb8
  ]);
  assert.deepEqual(detectImageDimensions(sizedPng, "image/png"), { width: 4000, height: 3000 });
  let metadata = null;
  const blob = await boundedMediaBlobFromResponse(new Response(sizedPng), {
    kind: "image",
    maxBytes: 1024,
    maxPixels: 12_000_000,
    onMetadata: (value) => { metadata = value; }
  });
  assert.equal(blob.type, "image/png");
  assert.deepEqual(metadata, { mimeType: "image/png", width: 4000, height: 3000 });
  await assert.rejects(
    () => boundedMediaBlobFromResponse(new Response(sizedPng), { kind: "image", maxBytes: 1024, maxPixels: 11_999_999 }),
    /图片像素超过/
  );
});

test("bounded documents accept only verified safe document content", async () => {
  const pdf = new TextEncoder().encode("%PDF-1.7\n1 0 obj\n<<>>\nendobj\n%%EOF");
  const pdfBlob = await boundedMediaBlobFromResponse(new Response(pdf, {
    headers: { "content-type": "application/octet-stream" }
  }), { kind: "document", expectedMimeType: "application/pdf", maxBytes: 1024 });
  assert.equal(pdfBlob.type, "application/pdf");

  const html = new TextEncoder().encode("<!doctype html><html><body>Reference</body></html>");
  const htmlBlob = await boundedMediaBlobFromResponse(new Response(html, {
    headers: { "content-type": "text/plain" }
  }), { kind: "document", expectedMimeType: "text/html", maxBytes: 1024 });
  assert.equal(htmlBlob.type, "text/html");

  assert.equal(isSupportedDocumentMimeType("text/markdown; charset=utf-8"), true);
  assert.equal(isSupportedDocumentMimeType("application/zip"), false);
});

test("bounded documents reject spoofed, binary and unsupported files", async () => {
  await assert.rejects(
    () => boundedMediaBlobFromResponse(new Response(new TextEncoder().encode("not a pdf"), {
      headers: { "content-type": "application/pdf" }
    }), { kind: "document", expectedMimeType: "application/pdf", maxBytes: 1024 }),
    /有效文档文件/
  );
  await assert.rejects(
    () => boundedMediaBlobFromResponse(new Response(Uint8Array.from([0x50, 0x4b, 0x03, 0x04, 0, 0, 0]), {
      headers: { "content-type": "text/plain" }
    }), { kind: "document", expectedMimeType: "text/plain", maxBytes: 1024 }),
    /有效文档文件/
  );
  await assert.rejects(
    () => boundedMediaBlobFromResponse(new Response(new TextEncoder().encode("plain"), {
      headers: { "content-type": "application/zip" }
    }), { kind: "document", expectedMimeType: "application/zip", maxBytes: 1024 }),
    /支持的安全文档类型/
  );
});
