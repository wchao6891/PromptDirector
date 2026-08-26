import test from "node:test";
import assert from "node:assert/strict";

import { createComposerAnalysisTaskBridge } from "../composer-analysis-task-bridge.js";

test("closing while task creation is pending detaches the consumer and rejects late automatic continuation", async () => {
  const messages = [];
  let finishStart;
  const startResponse = new Promise((resolve) => { finishStart = resolve; });
  const bridge = createComposerAnalysisTaskBridge({
    createId: (() => {
      const ids = ["consumer:one", "request:one"];
      return () => ids.shift();
    })(),
    sendMessage: async (message) => {
      messages.push(structuredClone(message));
      if (message.type === "START_OR_JOIN_ANALYSIS_TASK") return startResponse;
      return { ok: true };
    }
  });

  const starting = bridge.start({ sessionId: "session:one", tempReferenceIds: ["reference:one"] });
  await Promise.resolve();
  await bridge.detach();
  finishStart({
    ok: true,
    task: { id: "task:one", status: "completed", executionState: "completed", activeAttemptId: "attempt:one" },
    attemptId: "attempt:one",
    result: { ok: true, session: { id: "session:one" } }
  });
  await starting;

  assert.deepEqual(messages.map((message) => message.type), [
    "START_OR_JOIN_ANALYSIS_TASK",
    "DETACH_ANALYSIS_CONSUMER"
  ]);
  assert.equal(bridge.snapshot().attached, false);
  assert.equal(bridge.consumeCompletion(), null);
});

test("a detached consumer rejects later task push updates", async () => {
  const bridge = createComposerAnalysisTaskBridge({
    createId: (() => {
      const ids = ["consumer:detached", "request:detached"];
      return () => ids.shift();
    })(),
    sendMessage: async (message) => {
      if (message.type === "START_OR_JOIN_ANALYSIS_TASK") {
        return {
          ok: true,
          task: { id: "task:detached", status: "running", executionState: "running", activeAttemptId: "attempt:detached" },
          attemptId: "attempt:detached"
        };
      }
      return { ok: true };
    }
  });

  await bridge.start({ sessionId: "session:detached", tempReferenceIds: ["reference:detached"] });
  await bridge.detach();

  assert.equal(bridge.acceptUpdate({
    task: { id: "task:detached", status: "completed", executionState: "completed", activeAttemptId: "attempt:detached" },
    attemptId: "attempt:detached",
    result: { value: "must-not-be-consumed" }
  }), false);
  assert.equal(bridge.consumeCompletion(), null);
});

test("a rejected task command is surfaced instead of leaving a false running state", async () => {
  const bridge = createComposerAnalysisTaskBridge({
    createId: (() => {
      const ids = ["consumer:rejected", "request:rejected"];
      return () => ids.shift();
    })(),
    sendMessage: async () => ({ ok: false, message: "任务协议尚未接线" })
  });

  await assert.rejects(
    () => bridge.start({ sessionId: "session:rejected", tempReferenceIds: ["reference:rejected"] }),
    /任务协议尚未接线/
  );
  assert.equal(bridge.consumeCompletion(), null);
});

test("stopping a queued interactive task cancels automatic continuation through a distinct stop message", async () => {
  const messages = [];
  const bridge = createComposerAnalysisTaskBridge({
    createId: (() => {
      const ids = ["consumer:queued", "request:queued"];
      return () => ids.shift();
    })(),
    sendMessage: async (message) => {
      messages.push(structuredClone(message));
      if (message.type === "START_OR_JOIN_ANALYSIS_TASK") {
        return {
          ok: true,
          task: { id: "task:queued", status: "queued", executionState: "queued", activeAttemptId: "" }
        };
      }
      return {
        ok: true,
        task: { id: "task:queued", status: "stopped", executionState: "canceled", activeAttemptId: "" }
      };
    }
  });

  await bridge.start({ sessionId: "session:queued", tempReferenceIds: ["reference:one", "reference:one"] });
  await bridge.stop();

  assert.deepEqual(messages, [
    {
      type: "START_OR_JOIN_ANALYSIS_TASK",
      priority: "interactive",
      consumerId: "consumer:queued",
      clientRequestId: "request:queued",
      sessionId: "session:queued",
      tempReferenceIds: ["reference:one"],
      outputLocale: "zh-CN"
    },
    {
      type: "STOP_ANALYSIS_TASK",
      taskId: "task:queued",
      consumerId: "consumer:queued",
      clientRequestId: "request:queued"
    }
  ]);
  assert.equal(bridge.snapshot().attached, false);
  assert.equal(bridge.snapshot().status, "stopped");
  assert.equal(bridge.consumeCompletion(), null);
});

test("a lost stop acknowledgement becomes unknown and requires explicit retry confirmation", async () => {
  const bridge = createComposerAnalysisTaskBridge({
    createId: (() => {
      const ids = ["consumer:stop-lost", "request:stop-lost"];
      return () => ids.shift();
    })(),
    sendMessage: async (message) => {
      if (message.type === "START_OR_JOIN_ANALYSIS_TASK") {
        return {
          ok: true,
          task: { id: "task:stop-lost", status: "running", executionState: "running", activeAttemptId: "attempt:stop-lost" },
          attemptId: "attempt:stop-lost"
        };
      }
      throw new Error("停止回执丢失");
    }
  });

  await bridge.start({ sessionId: "session:stop-lost", tempReferenceIds: ["reference:stop-lost"] });
  await assert.rejects(() => bridge.stop(), /停止回执丢失/);

  assert.equal(bridge.snapshot().attached, false);
  assert.equal(bridge.snapshot().executionState, "execution_state_unknown");
  assert.equal(bridge.snapshot().canRetry, true);
  await assert.rejects(() => bridge.retry({ confirmed: false }), /确认.*再次计费/);
});

test("unknown execution state retries only after confirmation and rejects the abandoned Attempt result", async () => {
  const messages = [];
  const bridge = createComposerAnalysisTaskBridge({
    createId: (() => {
      const ids = ["consumer:one", "request:one", "consumer:two", "request:two"];
      return () => ids.shift();
    })(),
    sendMessage: async (message) => {
      messages.push(structuredClone(message));
      if (message.type === "START_OR_JOIN_ANALYSIS_TASK") {
        return {
          ok: true,
          task: { id: "task:one", status: "running", executionState: "running", activeAttemptId: "attempt:one" },
          attemptId: "attempt:one"
        };
      }
      if (message.type === "GET_ANALYSIS_TASK") {
        return {
          ok: true,
          task: { id: "task:one", status: "failed", executionState: "execution_state_unknown", activeAttemptId: "" },
          attemptId: "attempt:one"
        };
      }
      return {
        ok: true,
        task: { id: "task:one", status: "running", executionState: "running", activeAttemptId: "attempt:two" },
        attemptId: "attempt:two"
      };
    }
  });

  await bridge.start({ sessionId: "session:one", tempReferenceIds: ["reference:one"], outputLocale: "en" });
  await bridge.refresh();
  assert.equal(bridge.snapshot().executionState, "execution_state_unknown");
  assert.equal(bridge.snapshot().canRetry, true);
  assert.deepEqual(messages.map((message) => message.type), ["START_OR_JOIN_ANALYSIS_TASK", "GET_ANALYSIS_TASK"]);

  await assert.rejects(() => bridge.retry({ confirmed: false }), /确认.*再次计费/);
  await bridge.retry({ confirmed: true });
  assert.equal(messages.at(-1).type, "RETRY_ANALYSIS_TASK");
  assert.equal(messages.at(-1).previousAttemptId, "attempt:one");
  assert.equal(messages.at(-1).confirmDuplicateCharge, true);
  assert.equal(bridge.snapshot().attemptId, "attempt:two");

  assert.equal(bridge.acceptUpdate({
    task: { id: "task:one", status: "completed", executionState: "completed", activeAttemptId: "attempt:one" },
    attemptId: "attempt:one",
    result: { value: "old" }
  }), false);
  assert.equal(bridge.consumeCompletion(), null);

  assert.equal(bridge.acceptUpdate({
    task: { id: "task:one", status: "completed", executionState: "completed", activeAttemptId: "attempt:two" },
    attemptId: "attempt:two",
    result: { value: "new" }
  }), true);
  assert.deepEqual(bridge.consumeCompletion(), { value: "new" });
  assert.equal(bridge.consumeCompletion(), null);
});
