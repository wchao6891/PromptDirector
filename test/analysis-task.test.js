import test from "node:test";
import assert from "node:assert/strict";

import {
  applyAnalysisAttemptWrite,
  cancelQueuedAnalysisTask,
  completeAnalysisAttempt,
  createAnalysisTask,
  failAnalysisAttempt,
  restartRunningAnalysisTask,
  retryAnalysisAttempt,
  stopAnalysisTask,
  startAnalysisAttempt
} from "../analysis-tasks.js";

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
  task = startAnalysisAttempt(task, { attemptId: "attempt:one", now: "2026-08-26T00:00:00.000Z" });
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

test("stop distinguishes a free queued cancel from a running request whose provider may have accepted it", () => {
  const queued = stopAnalysisTask(createAnalysisTask({ id: "task-queued-stop" }));
  assert.equal(queued.status, "stopped");
  assert.equal(queued.executionState, "canceled");
  assert.equal(queued.providerMayHaveAccepted, false);

  let running = createAnalysisTask({ id: "task-running-stop" });
  running = startAnalysisAttempt(running, { attemptId: "attempt:running" });
  running = stopAnalysisTask(running);
  assert.equal(running.status, "stopped");
  assert.equal(running.executionState, "canceled");
  assert.equal(running.providerMayHaveAccepted, true);
  assert.equal(running.activeAttemptId, "");
  assert.equal(running.attempts[0].status, "canceled");
  assert.throws(() => applyAnalysisAttemptWrite(running, { attemptId: "attempt:running", result: {} }), /失效|stale/);
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
