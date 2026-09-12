import test from "node:test";
import assert from "node:assert/strict";
import { waitForDownload } from "../extension/download-completion.js";

function downloadFixture(item) {
  const listeners = new Set();
  return {
    item, listeners,
    onChanged: {
      addListener: (listener) => listeners.add(listener),
      removeListener: (listener) => listeners.delete(listener)
    },
    async search() { return this.item ? [this.item] : []; },
    emit(delta) { for (const listener of listeners) listener(delta); }
  };
}

test("large exports can progress beyond 30 seconds without revoking their source URL", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout", "Date"] });
  const api = downloadFixture({ state: "in_progress", bytesReceived: 0 });
  const result = waitForDownload(7, api);
  await Promise.resolve();
  for (const bytes of [1 << 20, 2 << 20, 3 << 20, 4 << 20, 2 ** 32]) {
    api.item.bytesReceived = bytes;
    t.mock.timers.tick(10_000);
    await Promise.resolve();
    assert.equal(api.listeners.size, 1);
  }
  api.emit({ id: 7, state: { current: "complete" } });
  await result;
  assert.equal(api.listeners.size, 0);
});

test("a stalled export still fails and releases its listener", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout", "Date"] });
  const api = downloadFixture({ state: "in_progress", bytesReceived: 100 });
  const result = assert.rejects(waitForDownload(7, api), /写入超时/);
  await Promise.resolve();
  t.mock.timers.tick(30_000);
  await result;
  assert.equal(api.listeners.size, 0);
});

test("completion before listener setup and interruptions retain their actual result", async () => {
  await waitForDownload(7, downloadFixture({ state: "complete" }));
  await assert.rejects(waitForDownload(7, downloadFixture({ state: "interrupted", error: "FILE_NO_SPACE" })), /FILE_NO_SPACE/);
  await assert.rejects(waitForDownload(7, downloadFixture(null)), /下载记录不存在/);
  const api = downloadFixture({ state: "in_progress", bytesReceived: 0 });
  const result = assert.rejects(waitForDownload(7, api), /USER_CANCELED/);
  api.emit({ id: 7, state: { current: "interrupted" }, error: { current: "USER_CANCELED" } });
  await result;
  assert.equal(api.listeners.size, 0);
});
