import test from "node:test";
import assert from "node:assert/strict";

import {
  discardPageSessionMedia,
  preparePageSessionMedia,
  readPageSessionMediaChunk
} from "../page-session-media.js";

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
      token: "token-a", url: "https://evil.example/image.png", allowedUrls: ["https://media.example/image.png"], maxBytes: 32, chunkBytes: 4
    }), /不在本次选择范围/);
    const prepared = await injected({
      token: "token-b", url: "https://media.example/image.png", allowedUrls: ["https://media.example/image.png"], maxBytes: 32, chunkBytes: 4
    });
    assert.equal(prepared.chunkCount, 1);
    assert.equal(calls[0].options.credentials, "include");
    assert.equal(calls[0].options.redirect, "error");
    assert.equal(calls[0].options.referrerPolicy, "no-referrer");
  } finally {
    delete globalThis.__PROMPTDIRECTOR_PAGE_SESSION_MEDIA__;
    Object.assign(globalThis, original);
  }
});

test("page-session chunks are one-time bounded state and can be explicitly discarded", async () => {
  const read = (0, eval)(`(${readPageSessionMediaChunk.toString()})`);
  const discard = (0, eval)(`(${discardPageSessionMedia.toString()})`);
  globalThis.__PROMPTDIRECTOR_PAGE_SESSION_MEDIA__ = new Map([["token", { chunks: ["AAAA", "BBBB"] }]]);
  try {
    assert.equal(read({ token: "token", index: 0 }), "AAAA");
    assert.equal(read({ token: "token", index: 2 }), "");
    assert.equal(discard({ token: "token" }), true);
    assert.equal(read({ token: "token", index: 0 }), "");
  } finally {
    delete globalThis.__PROMPTDIRECTOR_PAGE_SESSION_MEDIA__;
  }
});
