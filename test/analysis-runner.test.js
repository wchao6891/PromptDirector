import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import { runAnalysisClaimsIndependently } from "../analysis-runner.js";

const delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

test("a stalled analysis cannot prevent completed siblings from being committed", async () => {
  const committed = [];
  const claims = [{ entryId: "a" }, { entryId: "b" }, { entryId: "stalled" }];

  const settled = await runAnalysisClaimsIndependently({
    claims,
    timeoutMs: 30,
    analyze: async (claim) => {
      if (claim.entryId === "stalled") return new Promise(() => {});
      if (claim.entryId === "b") await delay(5);
      return { entryId: claim.entryId, tags: [] };
    },
    commit: async (result) => {
      committed.push(result);
      return result.entryId;
    },
    timeoutResult: (claim) => ({
      entryId: claim.entryId,
      error: { message: "AI analysis timed out", status: 408 }
    })
  });

  assert.deepEqual(committed.slice(0, 2).map((item) => item.entryId), ["a", "b"]);
  assert.deepEqual(committed[2], {
    entryId: "stalled",
    error: { message: "AI analysis timed out", status: 408 }
  });
  assert.equal(settled.every((item) => item.status === "fulfilled"), true);
});

test("pausing aborts active analyses without committing them as failures", async () => {
  const controller = new AbortController();
  const committed = [];
  const startedAt = Date.now();
  const running = runAnalysisClaimsIndependently({
    claims: [{ entryId: "active" }],
    timeoutMs: 5_000,
    signal: controller.signal,
    analyze: async () => new Promise(() => {}),
    commit: async (result) => committed.push(result),
    timeoutResult: (claim) => ({ entryId: claim.entryId, error: { status: 408 } })
  });

  await delay(10);
  controller.abort();
  const settled = await running;

  assert.equal(Date.now() - startedAt < 500, true);
  assert.deepEqual(committed, []);
  assert.deepEqual(settled, [{ status: "fulfilled", value: { status: "aborted" } }]);
});

test("batch progress distinguishes active, queued, and failed cases", async () => {
  const library = await readFile(new URL("../library.js", import.meta.url), "utf8");
  assert.match(library, /job\.counts\.running[^\n]+处理中/);
  assert.match(library, /job\.counts\.pending[^\n]+等待中/);
  assert.match(library, /继续完成重建/);
  assert.match(library, /成功结果已安全暂存/);
  assert.match(library, /应用已成功结果/);
});
