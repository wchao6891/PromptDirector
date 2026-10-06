import test from "node:test";
import assert from "node:assert/strict";
import { createDownloadAhead } from "../extension/capture-download-ahead.js";
import { createCaptureAssetIndex } from "../extension/capture-asset-index.js";

const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };

test("the next items download while the current one is written, in order and never more than the window ahead", async () => {
  const started = [];
  const gates = new Map();
  const item = key => ({ key, start: () => { started.push(key); const gate = deferred(); gates.set(key, gate); return gate.promise; } });
  const ahead = createDownloadAhead({ window: 2 });
  ahead.plan([item("a"), null, item("c"), item("d"), item("e")]);
  ahead.advance(0);
  await Promise.resolve();
  assert.deepEqual(started, ["c"], "item 1 is fetched another way; only the window after the current item starts");
  assert.equal(ahead.take("a"), null, "the current first item is downloaded directly as before");
  ahead.advance(2);
  await Promise.resolve();
  assert.deepEqual(started, ["c", "d", "e"]);
  const progress = [];
  const taken = ahead.take("c", value => progress.push(value));
  gates.get("c").resolve("bytes-c");
  assert.equal(await taken, "bytes-c");
  assert.equal(ahead.take("c"), null, "a download is used once");
  ahead.close();
});

test("progress of an early download reaches the item once it is current, and unused downloads are cancelled", async () => {
  let report, received;
  const outer = new AbortController();
  const ahead = createDownloadAhead({ signal: outer.signal, window: 1 });
  ahead.plan([null, { key: "b", start: ({ onProgress, signal }) => { report = onProgress; received = signal; return new Promise(() => {}); } }]);
  ahead.advance(0);
  await Promise.resolve();
  report({ completedBytes: 1 });
  const progress = [];
  ahead.take("b", value => progress.push(value));
  report({ completedBytes: 2 });
  assert.deepEqual(progress, [{ completedBytes: 2 }]);
  ahead.close();
  assert.equal(received.aborted, true);
});

test("cancelling the save cancels downloads started ahead", async () => {
  let received;
  const outer = new AbortController();
  const ahead = createDownloadAhead({ signal: outer.signal, window: 1 });
  ahead.plan([null, { key: "b", start: ({ signal }) => { received = signal; return new Promise(() => {}); } }]);
  ahead.advance(0);
  await Promise.resolve();
  outer.abort();
  assert.equal(received.aborted, true);
});

test("saved originals are found by hash with the same first match as an in-order search, and appended cases are seen", () => {
  const entries = [
    { id: "one", mediaAssets: [{ id: "a", contentHash: "h1" }, { id: "b", contentHash: "h2" }] },
    { id: "two", mediaAssets: [{ id: "c", contentHash: "h1" }] }
  ];
  const index = createCaptureAssetIndex(entry => entry.mediaAssets);
  assert.equal(index.withHash(entries, "h1")[0].id, entries.flatMap(entry => entry.mediaAssets).find(asset => asset.contentHash === "h1").id);
  assert.equal(index.withId(entries, "c").id, "c");
  entries.push({ id: "three", mediaAssets: [{ id: "d", contentHash: "h3" }] });
  assert.equal(index.withHash(entries, "h3")[0].id, "d", "a case appended during the same save is indexed");
  assert.deepEqual(index.withHash([...entries], "missing"), []);
});
