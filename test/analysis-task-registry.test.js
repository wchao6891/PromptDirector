import test from "node:test";
import assert from "node:assert/strict";

import {
  createOrJoinAnalysisTask,
  detachAnalysisTaskConsumer,
  recoverInterruptedAnalysisTasks,
  replaceAnalysisTask
} from "../analysis-task-registry.js";
import { startAnalysisAttempt } from "../analysis-tasks.js";

const request = {
  sessionId: "session:one",
  tempReferenceIds: ["reference:one", "reference:one"],
  outputLocale: "zh-CN",
  priority: "interactive",
  consumerId: "consumer:one",
  clientRequestId: "request:one"
};

test("the same client request joins one persisted task instead of creating duplicate paid work", () => {
  const first = createOrJoinAnalysisTask({}, request, {
    taskId: "task:one",
    now: "2026-08-26T00:00:00.000Z"
  });
  const second = createOrJoinAnalysisTask(first.state, request, {
    taskId: "task:must-not-exist",
    now: "2026-08-26T00:00:01.000Z"
  });

  assert.equal(first.created, true);
  assert.equal(second.created, false);
  assert.equal(second.task.id, "task:one");
  assert.equal(second.state.items.length, 1);
  assert.deepEqual(second.task.request.tempReferenceIds, ["reference:one"]);
});

test("detaching removes only the consumer and leaves the running task intact", () => {
  const created = createOrJoinAnalysisTask({}, request, { taskId: "task:detach" });
  const running = startAnalysisAttempt(created.task, { attemptId: "attempt:detach" });
  const state = replaceAnalysisTask(created.state, running);
  const detached = detachAnalysisTaskConsumer(state, "task:detach", "consumer:one");

  assert.equal(detached.task.status, "running");
  assert.deepEqual(detached.task.consumerIds, []);
});

test("detaching can resolve a task by clientRequestId before the start response returns", () => {
  const created = createOrJoinAnalysisTask({}, request, { taskId: "task:early-close" });
  const detached = detachAnalysisTaskConsumer(
    created.state,
    "",
    "consumer:one",
    "request:one"
  );

  assert.equal(detached.task.id, "task:early-close");
  assert.deepEqual(detached.task.consumerIds, []);
});

test("service-worker recovery marks running execution unknown and never queues it again", () => {
  const created = createOrJoinAnalysisTask({}, request, { taskId: "task:recover" });
  const running = startAnalysisAttempt(created.task, { attemptId: "attempt:recover" });
  const recovered = recoverInterruptedAnalysisTasks(replaceAnalysisTask(created.state, running), {
    now: "2026-08-26T00:01:00.000Z"
  });

  assert.equal(recovered.items[0].status, "stopped");
  assert.equal(recovered.items[0].executionState, "execution_state_unknown");
  assert.equal(recovered.items[0].attempts[0].status, "execution_state_unknown");
});
