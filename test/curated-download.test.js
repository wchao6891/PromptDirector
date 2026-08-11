import test from "node:test";
import assert from "node:assert/strict";

import { fetchCuratedPackage } from "../curated-download.js";

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
