import test from "node:test";
import assert from "node:assert/strict";

import {
  assertRemoteMediaUrl,
  boundedMediaBlobFromResponse,
  fetchBoundedMedia
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
