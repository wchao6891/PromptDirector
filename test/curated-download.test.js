import test from "node:test";
import assert from "node:assert/strict";

import { fetchCuratedPackage, readResponseBlobWithProgress } from "../curated-download.js";

const DOWNLOAD_URL =
  "https://github.com/wchao6891/PromptDirector-Curated/releases/download/example-1.0.0/example.zip";

test("curated downloads bypass cached signed redirects and retry one transient HTTP failure", async () => {
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url, options });
    return calls.length === 1
      ? new Response("expired redirect", { status: 618 })
      : new Response("package", { status: 200 });
  };

  const response = await fetchCuratedPackage(DOWNLOAD_URL, { fetchImpl });

  assert.equal(response.status, 200);
  assert.equal(calls.length, 2);
  assert.deepEqual(calls.map(({ url, options }) => ({ url, ...options })), [
    { url: DOWNLOAD_URL, cache: "no-store", credentials: "omit", redirect: "follow" },
    { url: DOWNLOAD_URL, cache: "no-store", credentials: "omit", redirect: "follow" }
  ]);
});

test("curated downloads do not retry permanent client errors", async () => {
  let calls = 0;
  const response = await fetchCuratedPackage(DOWNLOAD_URL, {
    fetchImpl: async () => {
      calls += 1;
      return new Response("missing", { status: 404 });
    }
  });

  assert.equal(response.status, 404);
  assert.equal(calls, 1);
});

test("curated downloads retry one rejected network request", async () => {
  let calls = 0;
  const response = await fetchCuratedPackage(DOWNLOAD_URL, {
    fetchImpl: async () => {
      calls += 1;
      if (calls === 1) throw new TypeError("Failed to fetch");
      return new Response("package", { status: 200 });
    }
  });

  assert.equal(response.status, 200);
  assert.equal(calls, 2);
});

test("curated package reads stream bytes and reports determinate progress", async () => {
  const progress = [];
  const response = new Response(new ReadableStream({
    start(controller) {
      controller.enqueue(new Uint8Array([1, 2]));
      controller.enqueue(new Uint8Array([3, 4, 5]));
      controller.close();
    }
  }), {
    headers: {
      "content-length": "5",
      "content-type": "application/zip"
    }
  });

  const blob = await readResponseBlobWithProgress(response, {
    onProgress: (value) => progress.push(value)
  });

  assert.deepEqual([...new Uint8Array(await blob.arrayBuffer())], [1, 2, 3, 4, 5]);
  assert.equal(blob.type, "application/zip");
  assert.deepEqual(progress, [
    { loaded: 2, total: 5, ratio: 0.4 },
    { loaded: 5, total: 5, ratio: 1 }
  ]);
});

test("curated package still reports downloaded bytes when the total is unavailable", async () => {
  const progress = [];
  const response = new Response(new Blob([new Uint8Array([1, 2, 3])]), {
    headers: { "content-type": "application/octet-stream" }
  });

  const blob = await readResponseBlobWithProgress(response, {
    onProgress: (value) => progress.push(value)
  });

  assert.equal(blob.size, 3);
  assert.equal(progress.at(-1).loaded, 3);
  assert.equal(progress.at(-1).total, 0);
  assert.equal(progress.at(-1).ratio, null);
});

test("curated package rejects a declared response size that does not match the stream", async () => {
  const response = new Response(new Blob([new Uint8Array([1, 2, 3])]), {
    headers: { "content-length": "5" }
  });

  await assert.rejects(() => readResponseBlobWithProgress(response), /下载不完整/);
});
