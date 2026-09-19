import test from "node:test";
import assert from "node:assert/strict";
import { readEventStream } from "../extension/event-stream.js";

test("SSE combines data lines, ignores comments and preserves meaningful whitespace", async () => {
  const response = new Response("\ufeff: heartbeat\r\nevent: message\r\ndata: 第一行\r\ndata:  第二行\r\n\r\ndata: unfinished");
  const events = [];
  for await (const event of readEventStream(response)) events.push(event);
  assert.deepEqual(events, ["第一行\n 第二行", "unfinished"]);
  assert.equal(response.body.locked, false);
});

test("stopping while waiting for bytes cancels the reader and releases its lock", async () => {
  let cancellations = 0;
  const response = new Response(new ReadableStream({ cancel() { cancellations++; } }));
  const controller = new AbortController();
  const stream = readEventStream(response, { signal: controller.signal });
  const next = stream.next();
  controller.abort();
  await assert.rejects(next, { name: "AbortError" });
  assert.equal(cancellations, 1);
  assert.equal(response.body.locked, false);
});

test("a consumer rejecting an event stops reading the provider response", async () => {
  let cancellations = 0;
  const response = new Response(new ReadableStream({
    start(controller) { controller.enqueue(new TextEncoder().encode("data: rejected\n\n")); },
    cancel() { cancellations++; }
  }));
  await assert.rejects(async () => {
    for await (const _event of readEventStream(response)) throw new Error("provider failure");
  }, /provider failure/);
  assert.equal(cancellations, 1);
  assert.equal(response.body.locked, false);
});
