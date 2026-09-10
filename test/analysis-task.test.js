import test from "node:test";
import assert from "node:assert/strict";

import {
  applyAnalysisAttemptWrite,
  cancelQueuedAnalysisTask,
  completeAnalysisAttempt,
  createAnalysisTask,
  normalizeAnalysisTask,
  failAnalysisAttempt,
  restartRunningAnalysisTask,
  retryAnalysisAttempt,
  stopAnalysisTask,
  startAnalysisAttempt,
  updateAnalysisTaskProgress
} from "../extension/analysis-tasks.js";

test("a restored failed attempt retains protocol facts and request counts without raw payload or secrets", () => {
  let task = startAnalysisAttempt(createAnalysisTask({ id: "task:receipt" }), { attemptId: "attempt:receipt" });
  task = updateAnalysisTaskProgress(task, { attemptId: task.activeAttemptId, phase: "correcting", providerMayHaveAccepted: true,
    requestBudget: { providerCalls: 2, outputCorrectionRequests: 1 }, requestId: "request:2" });
  task = failAnalysisAttempt(task, { attemptId: task.activeAttemptId, error: "输出被截断", diagnostic: {
    httpStatus: 200, finishReason: "length", contentLength: 0, model: "fixture-model", responseId: "sk-fixture-secret", raw: "private content"
  } });
  const restored = normalizeAnalysisTask(JSON.parse(JSON.stringify(task)));
  assert.equal(restored.attempts.at(-1).diagnostic.httpStatus, 200);
  assert.equal(restored.attempts.at(-1).diagnostic.finishReason, "length");
  assert.equal(restored.attempts.at(-1).diagnostic.inputTokens, null);
  assert.equal(restored.attempts.at(-1).requestBudget.providerCalls, 2);
  assert.equal(restored.attempts.at(-1).requestId, "request:2");
  assert.doesNotMatch(JSON.stringify(restored), /private content|sk-fixture-secret/);
});

test("queued analysis tasks can be canceled before any execution attempt exists", () => {
  const task = createAnalysisTask({ id: "task-queued", priority: "interactive", now: "2026-08-26T00:00:00.000Z" });
  const canceled = cancelQueuedAnalysisTask(task, { now: "2026-08-26T00:00:01.000Z" });

  assert.equal(canceled.status, "canceled");
  assert.equal(canceled.executionState, "canceled");
  assert.equal(canceled.attempts.length, 0);
  assert.throws(
    () => startAnalysisAttempt(canceled, { attemptId: "attempt:late", now: "2026-08-26T00:00:02.000Z" }),
    /任务已经结束/
  );
});

test("running analysis restart leaves execution state unknown until an explicit new Attempt is started", () => {
  let task = createAnalysisTask({ id: "task-running" });
  task = startAnalysisAttempt(task, {
    attemptId: "attempt:one",
    now: "2026-08-26T00:00:00.000Z",
    deadlineAt: "2026-08-26T00:05:00.000Z"
  });
  assert.equal(task.deadlineAt, "2026-08-26T00:05:00.000Z");
  task = updateAnalysisTaskProgress(task, {
    attemptId: "attempt:one",
    phase: "analyzing",
    providerMayHaveAccepted: true,
    now: "2026-08-26T00:00:01.000Z"
  });
  task = restartRunningAnalysisTask(task, { now: "2026-08-26T00:00:05.000Z" });

  assert.equal(task.status, "stopped");
  assert.equal(task.executionState, "execution_state_unknown");
  assert.equal(task.attempts.length, 1);
  assert.equal(task.attempts[0].status, "execution_state_unknown");

  task = startAnalysisAttempt(task, { attemptId: "attempt:two", now: "2026-08-26T00:00:06.000Z" });

  assert.equal(task.status, "running");
  assert.equal(task.executionState, "running");
  assert.equal(task.attempts.length, 2);
  assert.equal(task.attempts[1].id, "attempt:two");
  assert.equal(task.attempts[1].status, "running");
});

test("service-worker recovery before the provider request stays a safe stopped task", () => {
  let task = createAnalysisTask({ id: "task-encoding" });
  task = startAnalysisAttempt(task, { attemptId: "attempt:encoding" });
  task = updateAnalysisTaskProgress(task, {
    attemptId: "attempt:encoding",
    phase: "encoding"
  });
  task = restartRunningAnalysisTask(task);

  assert.equal(task.status, "stopped");
  assert.equal(task.executionState, "canceled");
  assert.equal(task.providerMayHaveAccepted, false);
  assert.equal(task.attempts[0].status, "canceled");
});

test("stale writes from an abandoned attempt are rejected after a restart", () => {
  let task = createAnalysisTask({ id: "task-write" });
  task = startAnalysisAttempt(task, { attemptId: "attempt:one" });
  task = restartRunningAnalysisTask(task);
  task = startAnalysisAttempt(task, { attemptId: "attempt:two" });

  assert.throws(
    () => applyAnalysisAttemptWrite(task, { attemptId: "attempt:one", result: { ok: true } }),
    /失效|stale|重新发起/
  );

  const updated = applyAnalysisAttemptWrite(task, {
    attemptId: "attempt:two",
    result: { ok: true }
  });

  assert.deepEqual(updated.attempts[1].result, { ok: true });
  assert.equal(updated.attempts[1].writeCount, 1);
});

test("an explicit retry creates a new Attempt after failure while the old Attempt stays immutable", () => {
  let task = createAnalysisTask({ id: "task-retry" });
  task = startAnalysisAttempt(task, { attemptId: "attempt:one" });
  task = failAnalysisAttempt(task, { attemptId: "attempt:one", error: "provider failed" });

  assert.throws(() => retryAnalysisAttempt(task, { attemptId: "attempt:two", confirmed: false }), /确认/);
  task = retryAnalysisAttempt(task, { attemptId: "attempt:two", confirmed: true });

  assert.equal(task.activeAttemptId, "attempt:two");
  assert.equal(task.attemptCount, 2);
  assert.equal(task.attempts[0].status, "failed");
  assert.equal(task.attempts[1].status, "running");
  assert.throws(() => completeAnalysisAttempt(task, { attemptId: "attempt:one", result: { stale: true } }), /失效|stale/);
});

test("stop distinguishes local preparation from a request already sent to the provider", () => {
  const queued = stopAnalysisTask(createAnalysisTask({ id: "task-queued-stop" }));
  assert.equal(queued.status, "stopped");
  assert.equal(queued.executionState, "canceled");
  assert.equal(queued.providerMayHaveAccepted, false);

  let running = createAnalysisTask({ id: "task-running-stop" });
  running = startAnalysisAttempt(running, { attemptId: "attempt:running" });
  running = updateAnalysisTaskProgress(running, {
    attemptId: "attempt:running",
    phase: "encoding"
  });
  running = stopAnalysisTask(running);
  assert.equal(running.status, "stopped");
  assert.equal(running.executionState, "canceled");
  assert.equal(running.providerMayHaveAccepted, false);
  assert.equal(running.activeAttemptId, "");
  assert.equal(running.attempts[0].status, "canceled");
  assert.throws(() => applyAnalysisAttemptWrite(running, { attemptId: "attempt:running", result: {} }), /失效|stale/);

  let sent = createAnalysisTask({ id: "task-sent-stop" });
  sent = startAnalysisAttempt(sent, { attemptId: "attempt:sent" });
  sent = updateAnalysisTaskProgress(sent, {
    attemptId: "attempt:sent",
    phase: "analyzing",
    providerMayHaveAccepted: true,
    now: "2026-09-03T10:00:00.000Z"
  });
  sent = stopAnalysisTask(sent);
  assert.equal(sent.providerMayHaveAccepted, true);
  assert.equal(sent.requestStartedAt, "2026-09-03T10:00:00.000Z");
});

test("only the active running Attempt can complete or fail a task", () => {
  let completed = createAnalysisTask({ id: "task-complete" });
  completed = startAnalysisAttempt(completed, { attemptId: "attempt:complete" });
  completed = completeAnalysisAttempt(completed, { attemptId: "attempt:complete", result: { ok: true } });
  assert.equal(completed.status, "completed");
  assert.deepEqual(completed.attempts[0].result, { ok: true });

  let failed = createAnalysisTask({ id: "task-fail" });
  failed = startAnalysisAttempt(failed, { attemptId: "attempt:fail" });
  failed = failAnalysisAttempt(failed, { attemptId: "attempt:fail", error: "bad output" });
  assert.equal(failed.status, "failed");
  assert.equal(failed.attempts[0].error, "bad output");
});
