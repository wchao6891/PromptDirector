import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import {
  createCreativeJob,
  interruptActiveCreativeJobs,
  normalizeCreativeJobsState,
  requestCreativeJobStop,
  retryCreativeJob,
  settleCreativeJobStop,
  updateCreativeJob
} from "../creative-jobs.js";

const [background, offscreen, runner] = await Promise.all([
  readFile(new URL("../background.js", import.meta.url), "utf8"),
  readFile(new URL("../offscreen.js", import.meta.url), "utf8"),
  readFile(new URL("../creative-job-runner.js", import.meta.url), "utf8")
]);

function request(overrides = {}) {
  return {
    session: {
      id: "session-one",
      title: "图片创作",
      targetType: "image",
      outputMode: "create_image",
      messages: [{ id: "message-one", role: "user", type: "request", content: "创建一张图" }]
    },
    userMessageId: "message-one",
    startPhase: "planning",
    imageEdit: null,
    ...overrides
  };
}

test("creative jobs persist an immutable request without credentials or image payloads", () => {
  const created = createCreativeJob(undefined, request({
    apiKey: "must-not-persist",
    imageEdit: {
      mode: "local",
      parentVisualId: "visual-one",
      maskAssetId: "creative-job-mask:one",
      modification: "只修改衣服",
      dataUrl: "data:image/png;base64,secret",
      temporaryUrl: "https://temporary.invalid/result"
    }
  }), { id: "job-one", now: "2026-08-08T00:00:00.000Z" });

  assert.equal(created.job.id, "job-one");
  assert.equal(created.job.status, "queued");
  assert.equal(created.job.executionState, "queued");
  assert.equal(created.job.providerMayHaveAccepted, false);
  assert.equal(created.job.stopRequestedAt, "");
  assert.deepEqual(created.job.actualStages, []);
  assert.deepEqual(created.job.request.imageEdit, {
    mode: "local",
    parentVisualId: "visual-one",
    maskAssetId: "creative-job-mask:one",
    modification: "只修改衣服",
    originalPrompt: ""
  });
  const serialized = JSON.stringify(created.state);
  assert.doesNotMatch(serialized, /must-not-persist|data:image|temporary\.invalid/);
});

test("creative jobs preserve the ordered set of stages that actually ran", () => {
  const created = createCreativeJob(undefined, request(), { id: "job-one" });
  const preparing = updateCreativeJob(created.state, "job-one", {
    status: "running",
    phase: "generation",
    actualStages: ["preparing_media"]
  });
  const requested = updateCreativeJob(preparing, "job-one", {
    actualStages: ["preparing_media", "media_prepared", "provider_request"]
  });

  assert.deepEqual(requested.items[0].actualStages, [
    "preparing_media",
    "media_prepared",
    "provider_request"
  ]);
  assert.deepEqual(normalizeCreativeJobsState(requested).items[0].actualStages, requested.items[0].actualStages);
});

test("creative job execution facts distinguish a stop request from provider cancellation", () => {
  const created = createCreativeJob(undefined, request(), { id: "job-one", now: "2026-08-08T00:00:00.000Z" });
  const running = updateCreativeJob(created.state, "job-one", {
    status: "running",
    phase: "generation",
    providerMayHaveAccepted: true
  }, { now: "2026-08-08T00:00:01.000Z" });
  const requested = requestCreativeJobStop(running, "job-one", { now: "2026-08-08T00:00:02.000Z" });

  assert.equal(requested.job.status, "running");
  assert.equal(requested.job.executionState, "stop_requested");
  assert.equal(requested.job.providerMayHaveAccepted, true);
  assert.equal(requested.job.stopRequestedAt, "2026-08-08T00:00:02.000Z");

  const settled = settleCreativeJobStop(requested.state, "job-one", {
    runnerStopped: true,
    providerMayHaveAccepted: true,
    now: "2026-08-08T00:00:03.000Z"
  });
  assert.equal(settled.job.status, "interrupted");
  assert.equal(settled.job.executionState, "stop_unknown");
  assert.equal(settled.job.error.kind, "stop_unknown");
  assert.equal(settled.job.error.retryable, true);
});

test("a queued creative job with no provider request can be canceled conclusively", () => {
  const created = createCreativeJob(undefined, request(), { id: "job-one" });
  const requested = requestCreativeJobStop(created.state, "job-one");
  const settled = settleCreativeJobStop(requested.state, "job-one", {
    runnerStopped: false,
    providerMayHaveAccepted: false
  });

  assert.equal(settled.job.status, "canceled");
  assert.equal(settled.job.executionState, "canceled");
  assert.equal(settled.job.error.kind, "canceled");
});

test("unknown stop keeps a local edit mask and remote video identity available to an explicit retry", () => {
  const created = createCreativeJob(undefined, request({
    session: {
      ...request().session,
      targetType: "video",
      outputMode: "create_video"
    },
    imageEdit: {
      mode: "local",
      parentVisualId: "visual-one",
      maskAssetId: "creative-job-mask:one",
      modification: "只修改衣服"
    }
  }), { id: "job-one" });
  const running = updateCreativeJob(created.state, "job-one", {
    status: "running",
    phase: "generation",
    providerMayHaveAccepted: true,
    remoteVideo: {
      serviceId: "openai",
      remoteId: "remote-one",
      finalPrompt: "继续同一个远程任务",
      requestParameters: {}
    }
  });
  const requested = requestCreativeJobStop(running, "job-one");
  const stopped = settleCreativeJobStop(requested.state, "job-one", {
    runnerStopped: true,
    providerMayHaveAccepted: true
  });
  const retried = retryCreativeJob(stopped.state, "job-one", { id: "job-two" });

  assert.equal(retried.job.request.imageEdit.maskAssetId, "creative-job-mask:one");
  assert.equal(retried.job.remoteVideo.remoteId, "remote-one");
  assert.equal(retried.job.retryOf, "job-one");
});

test("creative jobs allow only one queued or running task", () => {
  const first = createCreativeJob(undefined, request(), { id: "job-one" });
  assert.throws(
    () => createCreativeJob(first.state, request({ session: { ...request().session, id: "session-two" } }), { id: "job-two" }),
    /已有创作任务/
  );

  const running = updateCreativeJob(first.state, "job-one", { status: "running", phase: "generation" });
  const completed = updateCreativeJob(running, "job-one", { status: "completed", phase: "completed" });
  const second = createCreativeJob(completed, request({ session: { ...request().session, id: "session-two" } }), { id: "job-two" });
  assert.equal(second.job.id, "job-two");
});

test("startup marks stale active jobs interrupted without automatically retrying them", () => {
  const created = createCreativeJob(undefined, request(), { id: "job-one", now: "2026-08-08T00:00:00.000Z" });
  const running = updateCreativeJob(created.state, "job-one", { status: "running", phase: "generation" }, { now: "2026-08-08T00:00:01.000Z" });
  const recovered = interruptActiveCreativeJobs(running, { now: "2026-08-08T00:01:00.000Z" });

  assert.equal(recovered.items[0].status, "interrupted");
  assert.equal(recovered.items[0].error.kind, "interrupted");
  assert.equal(recovered.items[0].error.retryable, true);
  assert.equal(recovered.items.length, 1);
});

test("legacy running jobs are conservatively recovered as possibly submitted", () => {
  const created = createCreativeJob(undefined, request(), { id: "job-one" });
  const { executionState: _executionState, providerMayHaveAccepted: _providerMayHaveAccepted, ...legacyJob } = created.state.items[0];
  const legacyRunning = {
    ...created.state,
    items: [{
      ...legacyJob,
      status: "running",
      phase: "generation"
    }]
  };
  const recovered = interruptActiveCreativeJobs(legacyRunning);

  assert.equal(recovered.items[0].status, "interrupted");
  assert.equal(recovered.items[0].executionState, "submission_unknown");
  assert.equal(recovered.items[0].providerMayHaveAccepted, true);
  assert.equal(recovered.items[0].error.kind, "submission_unknown");
});

test("durable stop flow persists the request fact and never treats local abort as provider cancellation", () => {
  const start = background.indexOf("async function cancelCreativeJobAction");
  const end = background.indexOf("async function dispatchCreativeJob", start);
  const cancellation = background.slice(start, end);

  assert.match(cancellation, /requestCreativeJobStop/);
  assert.match(cancellation, /settleCreativeJobStop/);
  assert.match(cancellation, /providerCancelConfirmed = response\?\.providerCancelConfirmed === true/);
  assert.match(cancellation, /finalJob\.executionState === "canceled"/);
  assert.doesNotMatch(cancellation, /status:\s*"canceled"/);
  assert.match(offscreen, /providerMayHaveAccepted: runner\.providerMayHaveAccepted/);
  assert.doesNotMatch(offscreen, /finally[\s\S]{0,300}deleteScreenshotBlob\(maskAssetId\)/);
  assert.match(runner, /onRequestStart: markProviderRequestStarted/);
  assert.match(runner, /providerMayHaveAccepted = true;[\s\S]{0,360}providerMayHaveAccepted: true,[\s\S]{0,80}actualStages: \[\.\.\.actualStages\]/);
  assert.match(offscreen, /progress: \(\{ phase, session, remoteVideo, providerMayHaveAccepted, actualStages \}\)/);
  assert.match(cancellation, /actualStages: active\.actualStages/);
  assert.doesNotMatch(runner, /startPhase === "planning"|planComposerSession/);
});

test("startup normalization never rewrites an unchanged creative job from a stale sibling snapshot", () => {
  const start = background.indexOf("const creativeRuns = normalizeCreativeRuns");
  const end = background.indexOf("const storedBatchJob = normalizeAnalysisBatchJob", start);
  const normalization = background.slice(start, end);

  assert.match(normalization, /const creativeNormalizationUpdate = Object\.fromEntries/);
  assert.match(normalization, /Object\.entries\(normalizedCreativeStorage\)/);
  assert.match(normalization, /filter\(\(\[key, value\]\) => JSON\.stringify\(stored\[key\]\) !== JSON\.stringify\(value\)\)/);
  assert.match(normalization, /commitLocalChanges\(creativeNormalizationUpdate/);
});

test("startup recovery re-reads and commits interrupted jobs inside the shared write queue", () => {
  const start = background.indexOf("async function recoverCreativeJobs()");
  const end = background.indexOf("function waitForDownload", start);
  const recovery = background.slice(start, end);

  assert.match(recovery, /await enqueue\(async \(\) => \{/);
  assert.match(recovery, /const latest = await chrome\.storage\.local\.get/);
  assert.match(recovery, /const active = activeCreativeJob\(creativeJobs\)/);
  assert.match(recovery, /actualStages: active\.actualStages/);
  assert.match(recovery, /await commitLocalChanges\(\{[\s\S]*creativeJobs[\s\S]*composerSessions/);
});

test("installation migration shares the write queue with startup recovery", () => {
  const start = background.indexOf("chrome.runtime.onInstalled.addListener");
  const end = background.indexOf("chrome.runtime.onUpdateAvailable.addListener", start);
  const installation = background.slice(start, end);

  assert.match(installation, /enqueue\(async \(\) => \{/);
  assert.match(installation, /const state = await readState\(\)/);
  assert.match(installation, /await migrateLegacyScreenshots\(state\.entries\)/);
});

test("an interrupted local edit can be retried explicitly with its retained mask reference", () => {
  const created = createCreativeJob(undefined, request({
    imageEdit: {
      mode: "local",
      parentVisualId: "visual-one",
      maskAssetId: "creative-job-mask:one",
      modification: "只修改衣服"
    }
  }), { id: "job-one" });
  const interrupted = interruptActiveCreativeJobs(
    updateCreativeJob(created.state, "job-one", { status: "running", phase: "generation" })
  );
  const retried = retryCreativeJob(interrupted, "job-one", { id: "job-two" });

  assert.equal(retried.job.retryOf, "job-one");
  assert.equal(retried.job.request.imageEdit.maskAssetId, "creative-job-mask:one");
});

test("retry is explicit and creates a new queued job with preserved request metadata", () => {
  const created = createCreativeJob(undefined, request(), { id: "job-one" });
  const interrupted = interruptActiveCreativeJobs(
    updateCreativeJob(created.state, "job-one", { status: "running", phase: "generation" })
  );
  const retried = retryCreativeJob(interrupted, "job-one", { id: "job-two" });

  assert.equal(retried.job.status, "queued");
  assert.equal(retried.job.retryOf, "job-one");
  assert.equal(retried.job.request.session.id, "session-one");
  assert.equal(normalizeCreativeJobsState(retried.state).items.length, 2);
});

test("terminal jobs cannot return to running and completed jobs require the completed phase", () => {
  const created = createCreativeJob(undefined, request(), { id: "job-one" });
  const running = updateCreativeJob(created.state, "job-one", { status: "running", phase: "generation" });
  assert.throws(
    () => updateCreativeJob(running, "job-one", { status: "completed", phase: "persisting" }),
    /完成阶段/
  );
  const completed = updateCreativeJob(running, "job-one", { status: "completed", phase: "completed" });
  assert.throws(
    () => updateCreativeJob(completed, "job-one", { status: "running" }),
    /不能从 completed 变为 running/
  );
});

test("canceled jobs release the single-task lock and retry only by creating a new job", () => {
  const created = createCreativeJob(undefined, request(), { id: "job-one" });
  const canceled = updateCreativeJob(created.state, "job-one", {
    status: "canceled",
    error: { kind: "canceled", message: "用户已取消", retryable: true }
  });
  const retried = retryCreativeJob(canceled, "job-one", { id: "job-two" });
  assert.equal(retried.job.id, "job-two");
  assert.equal(retried.job.retryOf, "job-one");
});

test("video jobs persist remote ids and resume them unless the remote result expired", () => {
  const videoRequest = request({
    session: {
      ...request().session,
      targetType: "video",
      outputMode: "create_video",
      generationParameters: { size: "1280x720", duration: "4" }
    }
  });
  const created = createCreativeJob(undefined, videoRequest, { id: "video-job" });
  const running = updateCreativeJob(created.state, "video-job", {
    status: "running",
    phase: "generation",
    remoteVideo: {
      serviceId: "openai",
      remoteId: "remote-one",
      finalPrompt: "最终视频提示词",
      requestParameters: { size: "1280x720", duration: "4", apiKey: "drop" }
    }
  });
  assert.deepEqual(running.items[0].remoteVideo, {
    serviceId: "openai",
    remoteId: "remote-one",
    finalPrompt: "最终视频提示词",
    requestParameters: { size: "1280x720", duration: "4" }
  });

  const failed = updateCreativeJob(running, "video-job", {
    status: "failed",
    error: { kind: "network", message: "网络中断", retryable: true }
  });
  const resumed = retryCreativeJob(failed, "video-job", { id: "video-resume" });
  assert.equal(resumed.job.remoteVideo.remoteId, "remote-one");
  assert.equal(resumed.job.phase, "generation");

  const expired = updateCreativeJob(running, "video-job", {
    status: "failed",
    error: { kind: "expired", message: "远程成品过期", retryable: true }
  });
  const regenerated = retryCreativeJob(expired, "video-job", { id: "video-regenerate" });
  assert.equal(regenerated.job.remoteVideo, null);
  assert.equal(regenerated.job.phase, "planning");

  const xaiRunning = updateCreativeJob(created.state, "video-job", {
    status: "running",
    phase: "generation",
    remoteVideo: {
      serviceId: "xai",
      remoteId: "xai-remote-one",
      finalPrompt: "xAI 最终视频提示词",
      requestParameters: {}
    }
  });
  assert.equal(xaiRunning.items[0].remoteVideo.serviceId, "xai");
  assert.equal(xaiRunning.items[0].remoteVideo.remoteId, "xai-remote-one");
});
