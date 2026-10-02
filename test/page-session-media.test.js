import test from "node:test";
import assert from "node:assert/strict";

import {
  discardPageSessionMedia,
  preparePageSessionMedia,
  readPageSessionMediaChunk
} from "../extension/page-session-media.js";

test("page-session media reads only the exact selected HTTPS URL with browser credentials", async () => {
  const injected = (0, eval)(`(${preparePageSessionMedia.toString()})`);
  const original = { location: globalThis.location, fetch: globalThis.fetch };
  const calls = [];
  globalThis.location = { href: "https://example.com/work/1", origin: "https://example.com" };
  globalThis.fetch = async (url, options) => {
    calls.push({ url, options });
    return new Response(Uint8Array.from([0x89, 0x50, 0x4e, 0x47]), { headers: { "content-type": "image/png" } });
  };
  try {
    await assert.rejects(() => injected({
      token: "token-a", url: "https://evil.example/image.png", allowedUrls: ["https://media.example/image.png"], maxBytes: 32, chunkBytes: 4, timeoutMs: 1000
    }), /不在本次选择范围/);
    const prepared = await injected({
      token: "token-b", url: "https://media.example/image.png", allowedUrls: ["https://media.example/image.png"], maxBytes: 32, chunkBytes: 4, timeoutMs: 1000
    });
    assert.equal(prepared.chunkCount, 1);
    assert.equal(calls[0].options.credentials, "include");
    assert.equal(calls[0].options.redirect, "error");
    assert.equal(calls[0].options.referrerPolicy, "strict-origin-when-cross-origin");
  } finally {
    discardPageSessionMedia({ token: 'token-b' });
    delete globalThis.__PROMPTDIRECTOR_PAGE_SESSION_MEDIA__;
    Object.assign(globalThis, original);
  }
});

test("page-session chunks are one-time bounded state and can be explicitly discarded", async () => {
  const read = (0, eval)(`(${readPageSessionMediaChunk.toString()})`);
  const discard = (0, eval)(`(${discardPageSessionMedia.toString()})`);
  globalThis.__PROMPTDIRECTOR_PAGE_SESSION_MEDIA__ = new Map([["token", { blob: new Blob([Uint8Array.from([0, 0, 0, 4, 16, 65])]), chunkBytes: 3 }]]);
  try {
    assert.equal(await read({ token: "token", index: 0 }), "AAAA");
    assert.equal(await read({ token: "token", index: 1 }), "BBBB");
    assert.equal(await read({ token: "token", index: 2 }), "");
    assert.equal(discard({ token: "token" }), true);
    assert.equal(await read({ token: "token", index: 0 }), "");
  } finally {
    delete globalThis.__PROMPTDIRECTOR_PAGE_SESSION_MEDIA__;
  }
});

test('a stalled page-session download is cancelled without leaving temporary media or buffered copies', async t => {
  // Keep the mock transport alive until AbortSignal.timeout fires on Node 22.
  const transport = setInterval(() => {}, 1000);
  t.after(() => clearInterval(transport));
  const injected = (0, eval)(`(${preparePageSessionMedia.toString()})`);
  const originalFetch = globalThis.fetch;
  let cancelled = false;
  globalThis.fetch = async () => new Response(new ReadableStream({ cancel() { cancelled = true; } }));
  try {
    await assert.rejects(injected({ token: 'stalled', url: 'https://media.example/video.mp4',
      allowedUrls: ['https://media.example/video.mp4'], maxBytes: 1024, chunkBytes: 4, timeoutMs: 40 }), { name: 'TimeoutError' });
    assert.equal(cancelled, true);
    assert.equal(globalThis.__PROMPTDIRECTOR_PAGE_SESSION_MEDIA__?.has('stalled') ?? false, false);
  } finally { globalThis.fetch = originalFetch; }
});

test('page-session streaming enforces temporary storage budget and preserves exact bytes chunk by chunk', async () => {
  const originalFetch = globalThis.fetch;
  const original = Uint8Array.from({ length: 1031 }, (_, index) => index % 256);
  globalThis.fetch = async () => new Response(original);
  try {
    await assert.rejects(preparePageSessionMedia({ token: 'oversized', url: 'https://media.example/video.mp4',
      allowedUrls: ['https://media.example/video.mp4'], maxBytes: 1030, chunkBytes: 4, timeoutMs: 1000 }), /暂存预算/);
    const prepared = await preparePageSessionMedia({ token: 'exact', url: 'https://media.example/video.mp4',
      allowedUrls: ['https://media.example/video.mp4'], maxBytes: 1031, chunkBytes: 256, timeoutMs: 1000 });
    const chunks = [];
    for (let index = 0; index < prepared.chunkCount; index++) chunks.push(Buffer.from(await readPageSessionMediaChunk({ token: 'exact', index }), 'base64'));
    assert.deepEqual(Buffer.concat(chunks), Buffer.from(original));
    const record = globalThis.__PROMPTDIRECTOR_PAGE_SESSION_MEDIA__.get('exact');
    assert(record.blob instanceof Blob);
    assert.equal(Object.hasOwn(record, 'chunks'), false);
  } finally { discardPageSessionMedia({ token: 'exact' }); globalThis.fetch = originalFetch; }
});
