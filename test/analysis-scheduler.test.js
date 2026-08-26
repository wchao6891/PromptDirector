import test from "node:test";
import assert from "node:assert/strict";

import {
  coalesceAnalysisRequest,
  createAnalysisScheduler,
  runScheduledAnalysisWithRetries,
  scheduleAnalysis
} from "../analysis-scheduler.js";

const delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

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

test("interactive work outranks queued batch work while preserving no-preemption for the running item", async () => {
  const scheduler = createAnalysisScheduler({ concurrency: 1, agingMs: 10 });
  const events = [];
  let release;

  const blocker = scheduler.schedule(async () => {
    events.push("background_import:started");
    await new Promise((resolve) => { release = resolve; });
    events.push("background_import:finished");
    return "blocker";
  }, { priority: "background_import" });

  await delay(5);

  const laterInteractive = scheduler.schedule(async () => {
    events.push("interactive:started");
    return "interactive";
  }, { priority: "interactive" });

  await delay(0);
  assert.deepEqual(events, ["background_import:started"]);
  release();
  assert.equal(await blocker.promise, "blocker");
  assert.equal(await laterInteractive.promise, "interactive");
  assert.equal(events[0], "background_import:started");
  assert.ok(events.includes("interactive:started"));
  assert.ok(events.indexOf("background_import:started") < events.indexOf("interactive:started"));
});

test("same-priority work stays FIFO and queued cancel prevents execution", async () => {
  const scheduler = createAnalysisScheduler({ concurrency: 1, agingMs: 10 });
  const starts = [];
  let release;

  const blocker = scheduler.schedule(async () => {
    starts.push("blocker:start");
    await new Promise((resolve) => { release = resolve; });
  }, { priority: "user_batch" });

  await delay(5);
  const first = scheduler.schedule(async () => {
    starts.push("first");
    return "first";
  }, { priority: "user_batch" });
  const second = scheduler.schedule(async () => {
    starts.push("second");
    return "second";
  }, { priority: "user_batch" });

  assert.equal(second.cancel(), true);
  release();
  await blocker.promise;
  assert.equal(await first.promise, "first");
  await assert.rejects(() => second.promise, /取消/);
  assert.deepEqual(starts, ["blocker:start", "first"]);
});

test("aging lets a long-waiting lower-priority task overtake a newer higher-priority task", async () => {
  const scheduler = createAnalysisScheduler({ concurrency: 1, agingMs: 10 });
  const starts = [];
  let release;

  const blocker = scheduler.schedule(async () => {
    starts.push("blocker:start");
    await new Promise((resolve) => { release = resolve; });
  }, { priority: "interactive" });

  await delay(5);
  const background = scheduler.schedule(async () => {
    starts.push("background_import");
    return "background";
  }, { priority: "background_import" });

  await delay(25);
  const userBatch = scheduler.schedule(async () => {
    starts.push("user_batch");
    return "user";
  }, { priority: "user_batch" });

  release();
  await blocker.promise;
  assert.equal(await background.promise, "background");
  assert.equal(await userBatch.promise, "user");
  assert.deepEqual(starts, ["blocker:start", "background_import", "user_batch"]);
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
