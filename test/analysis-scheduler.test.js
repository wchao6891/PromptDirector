import test from "node:test";
import assert from "node:assert/strict";

import {
  coalesceAnalysisRequest,
  runScheduledAnalysisWithRetries,
  scheduleAnalysis
} from "../extension/analysis-scheduler.js";

const delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

test("stopping one coalesced consumer preserves others; stopping all aborts the real request", async () => {
  const first = new AbortController();
  const second = new AbortController();
  let providerSignal;
  let ready;
  const started = new Promise(resolve => { ready = resolve; });
  const run = (controller) => coalesceAnalysisRequest("stop-shared", async signal => {
    providerSignal = signal;
    ready();
    return new Promise(() => {});
  }, { signal: controller.signal });
  const one = run(first);
  const two = run(second);
  await started;
  first.abort();
  await assert.rejects(one, { name: "AbortError" });
  assert.equal(providerSignal.aborted, false);
  second.abort();
  await assert.rejects(two, { name: "AbortError" });
  assert.equal(providerSignal.aborted, true);
});

test("analysis scheduler enforces the shared provider-model-task limit", async () => {
  let active = 0;
  let maximum = 0;
  await Promise.all(Array.from({ length: 8 }, (_, index) => scheduleAnalysis("deepseek:model:imageAnalysis", 3, async () => {
    active += 1;
    maximum = Math.max(maximum, active);
    await delay(4);
    active -= 1;
    return index;
  })));
  assert.equal(maximum, 3);
});

test("analysis scheduler coalesces identical in-flight work and retries transient failures twice", async () => {
  let calls = 0;
  let coalesced = 0;
  const work = () => coalesceAnalysisRequest("same-fingerprint", () => runScheduledAnalysisWithRetries({
    key: "deepseek:model:imageAnalysis",
    concurrency: 10,
    wait: async () => undefined,
    jitter: () => 0,
    task: async () => {
      calls += 1;
      if (calls < 3) throw Object.assign(new Error("busy"), { status: 503 });
      return "ok";
    }
  }), { onCoalesced: () => { coalesced += 1; } });
  assert.deepEqual(await Promise.all([work(), work()]), ["ok", "ok"]);
  assert.equal(calls, 3);
  assert.equal(coalesced, 1);
});

test("analysis scheduler does not mistake local JSON validation errors for network failures", async () => {
  let calls = 0;
  await assert.rejects(() => runScheduledAnalysisWithRetries({
    key: "deepseek:model:imageAnalysis:local-output-error",
    concurrency: 10,
    wait: async () => undefined,
    task: async () => {
      calls += 1;
      throw new Error("模型 JSON 无效");
    }
  }), /JSON 无效/);
  assert.equal(calls, 1);
});

test("shared work honors the lowest active job snapshot instead of the last caller", async () => {
  let active = 0;
  let lowLimitActive = 0;
  let maximumWhileLowLimitActive = 0;
  const task = async (lowLimit) => {
    active += 1;
    if (lowLimit) lowLimitActive += 1;
    if (lowLimitActive) maximumWhileLowLimitActive = Math.max(maximumWhileLowLimitActive, active);
    await delay(5);
    if (lowLimit) lowLimitActive -= 1;
    active -= 1;
  };
  await Promise.all([
    scheduleAnalysis("shared-snapshot-limit", 2, () => task(true)),
    scheduleAnalysis("shared-snapshot-limit", 2, () => task(true)),
    ...Array.from({ length: 6 }, () => scheduleAnalysis("shared-snapshot-limit", 6, () => task(false)))
  ]);
  assert.equal(maximumWhileLowLimitActive, 2);
});

test("the production shared provider queue starts interactive work before queued background imports", async () => {
  const starts = [];
  const releases = [];
  const blockers = [0, 1].map((index) => scheduleAnalysis("shared-priority", 2, async () => {
    starts.push(`blocker:${index}`);
    await new Promise((resolve) => releases.push(resolve));
  }, { priority: "background_import" }));
  await delay(0);
  const background = scheduleAnalysis("shared-priority", 2, async () => {
    starts.push("queued-background");
  }, { priority: "background_import" });
  const interactive = scheduleAnalysis("shared-priority", 2, async () => {
    starts.push("interactive");
  }, { priority: "interactive" });

  releases.shift()();
  await delay(0);
  assert.equal(starts[2], "interactive");
  releases.shift()();
  await Promise.all([...blockers, background, interactive]);
  assert.deepEqual(starts.slice(2), ["interactive", "queued-background"]);
});
