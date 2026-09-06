import test from "node:test";
import assert from "node:assert/strict";

import {
  createOrJoinAnalysisTask,
  detachAnalysisTaskConsumer,
  normalizeAnalysisTaskRegistry,
  recoverInterruptedAnalysisTasks,
  replaceAnalysisTask
} from "../analysis-task-registry.js";
import {
  createAnalysisTask,
  startAnalysisAttempt,
  updateAnalysisTaskProgress
} from "../analysis-tasks.js";

test("video task progress records the paid request boundary and survives normalization", () => {
  const task = createAnalysisTask({ id: "task:video", now: "2026-09-03T10:00:00.000Z" });
  const running = startAnalysisAttempt(task, {
    attemptId: "attempt:video",
    now: "2026-09-03T10:00:01.000Z"
  });
  const encoding = updateAnalysisTaskProgress(running, {
    attemptId: "attempt:video",
    phase: "encoding",
    now: "2026-09-03T10:00:02.000Z"
  });
  assert.equal(encoding.phase, "encoding");
  assert.equal(encoding.providerMayHaveAccepted, false);
  assert.equal(encoding.requestStartedAt, "");

  const analyzing = updateAnalysisTaskProgress(encoding, {
    attemptId: "attempt:video",
    phase: "analyzing",
    providerMayHaveAccepted: true,
    now: "2026-09-03T10:00:03.000Z"
  });
  assert.equal(analyzing.phase, "analyzing");
  assert.equal(analyzing.providerMayHaveAccepted, true);
  assert.equal(analyzing.requestStartedAt, "2026-09-03T10:00:03.000Z");

  const normalized = normalizeAnalysisTaskRegistry({ version: 1, items: [{
    ...analyzing,
    request: {
      kind: "entry_video",
      entryId: "entry:1",
      assetId: "video:1",
      mode: "creative-breakdown",
      clientRequestId: "client:1"
    }
  }] }).items[0];
  assert.equal(normalized.phase, "analyzing");
  assert.equal(normalized.requestStartedAt, "2026-09-03T10:00:03.000Z");
  assert.equal(normalized.providerMayHaveAccepted, true);
});

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

test("the same video joins one active task even when a second click has a new client request id", () => {
  const videoRequest = {
    kind: "entry_video",
    entryId: "entry:one",
    assetId: "video:one",
    mode: "visual-reconstruction",
    instruction: "只分析可见画面",
    includeTags: true,
    priority: "interactive",
    consumerId: "detail:one",
    clientRequestId: "video-request:one"
  };
  const first = createOrJoinAnalysisTask({}, videoRequest, { taskId: "task:video" });
  const second = createOrJoinAnalysisTask(first.state, {
    ...videoRequest,
    clientRequestId: "video-request:two"
  }, { taskId: "task:duplicate" });

  assert.equal(first.created, true);
  assert.equal(second.created, false);
  assert.equal(second.task.id, "task:video");
  assert.equal(second.state.items.length, 1);
  assert.equal(second.task.request.instruction, "只分析可见画面");
  assert.equal(second.task.request.includeTags, true);
  assert.deepEqual(second.task.clientRequestIds, ["video-request:one", "video-request:two"]);
});

test("different video analysis semantics are blocked while the same asset is busy", () => {
  const first = createOrJoinAnalysisTask({}, {
    kind: "entry_video",
    entryId: "entry:one",
    assetId: "video:one",
    mode: "visual-reconstruction",
    instruction: "逆推可见画面",
    includeTags: true,
    outputLocale: "zh-CN",
    clientRequestId: "video-request:one"
  }, { taskId: "task:reconstruction" });
  assert.throws(() => createOrJoinAnalysisTask(first.state, {
      kind: "entry_video",
      entryId: "entry:one",
      assetId: "video:one",
      mode: "ad-review",
      instruction: "分析广告效果",
      includeTags: false,
      outputLocale: "zh-CN",
      clientRequestId: "video-request:two"
    }, { taskId: "task:review" }),
    /当前视频已有分析在运行/);
  assert.equal(first.state.items.length, 1);
});

test("a completed video allows an explicit new task and append-only analysis version", () => {
  const videoRequest = {
    kind: "entry_video",
    entryId: "entry:one",
    assetId: "video:one",
    mode: "visual-reconstruction",
    clientRequestId: "video-request:one"
  };
  const first = createOrJoinAnalysisTask({}, videoRequest, { taskId: "task:video" });
  first.state.items[0].status = "completed";
  first.state.items[0].executionState = "completed";
  const second = createOrJoinAnalysisTask(first.state, {
    ...videoRequest,
    clientRequestId: "video-request:two"
  }, { taskId: "task:next-video" });

  assert.equal(second.created, true);
  assert.equal(second.task.id, "task:next-video");
  assert.equal(second.state.items.length, 2);
});

test("batch video tasks preserve the exact endpoint and transport snapshot", () => {
  const created = createOrJoinAnalysisTask({}, {
    kind: "entry_video",
    entryId: "entry:one",
    assetId: "video:one",
    mode: "visual-reconstruction",
    batchJobId: "batch:one",
    batchClaimId: "claim:one",
    sourceFingerprint: "fingerprint:one",
    protocol: "chat_completions",
    sourceKind: "local-video",
    routeEndpoint: "https://open.bigmodel.cn/api/paas/v4/chat/completions",
    routeProviderId: "zhipu",
    routeModel: "glm-5.3-flash",
    localVideo: "base64",
    preferPublicVideoUrl: false,
    publicVideoUrl: "direct",
    hasRouteSnapshot: true,
    clientRequestId: "video-request:batch"
  }, { taskId: "task:batch-video" });

  assert.deepEqual({
    routeEndpoint: created.task.request.routeEndpoint,
    routeProviderId: created.task.request.routeProviderId,
    routeModel: created.task.request.routeModel,
    localVideo: created.task.request.localVideo,
    preferPublicVideoUrl: created.task.request.preferPublicVideoUrl,
    publicVideoUrl: created.task.request.publicVideoUrl,
    hasRouteSnapshot: created.task.request.hasRouteSnapshot
  }, {
    routeEndpoint: "https://open.bigmodel.cn/api/paas/v4/chat/completions",
    routeProviderId: "zhipu",
    routeModel: "glm-5.3-flash",
    localVideo: "base64",
    preferPublicVideoUrl: false,
    publicVideoUrl: "direct",
    hasRouteSnapshot: true
  });
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
  const running = updateAnalysisTaskProgress(
    startAnalysisAttempt(created.task, { attemptId: "attempt:recover" }),
    {
      attemptId: "attempt:recover",
      phase: "analyzing",
      providerMayHaveAccepted: true
    }
  );
  const recovered = recoverInterruptedAnalysisTasks(replaceAnalysisTask(created.state, running), {
    now: "2026-08-26T00:01:00.000Z"
  });

  assert.equal(recovered.items[0].status, "stopped");
  assert.equal(recovered.items[0].executionState, "execution_state_unknown");
  assert.equal(recovered.items[0].attempts[0].status, "execution_state_unknown");
});

test("service-worker recovery preserves the attempt still owned by the Offscreen runner", () => {
  const created = createOrJoinAnalysisTask({}, {
    ...request,
    kind: "entry_video",
    entryId: "entry:video",
    assetId: "asset:video",
    mode: "visual-reconstruction"
  }, { taskId: "task:offscreen" });
  const running = updateAnalysisTaskProgress(
    startAnalysisAttempt(created.task, {
      attemptId: "attempt:offscreen",
      deadlineAt: "2026-08-26T00:05:00.000Z"
    }),
    { attemptId: "attempt:offscreen", phase: "analyzing", providerMayHaveAccepted: true }
  );
  const recovered = recoverInterruptedAnalysisTasks(replaceAnalysisTask(created.state, running), {
    activeAttemptIds: ["attempt:offscreen"]
  });

  assert.equal(recovered.items[0].status, "running");
  assert.equal(recovered.items[0].activeAttemptId, "attempt:offscreen");
  assert.equal(recovered.items[0].deadlineAt, "2026-08-26T00:05:00.000Z");
});
