import test from "node:test";
import assert from "node:assert/strict";

import {
  createComposerActiveTurn,
  createLatestCheckpointWriter,
  recoverInterruptedComposerTurn,
  updateComposerActiveTurn
} from "../composer-active-turn.js";
import { createComposerSession } from "../composer.js";

test("an active text turn persists only recoverable request facts and partial text", () => {
  const activeTurn = createComposerActiveTurn({
    turnId: "turn-one",
    userMessageId: "user-one",
    route: "auto",
    routeSource: "auto",
    serviceId: "zhipu",
    model: "glm-5.3-flash",
    startedAt: "2026-08-30T12:00:00.000Z",
    apiKey: "must-not-survive"
  });
  const receiving = updateComposerActiveTurn(activeTurn, {
    status: "receiving",
    phase: "streaming",
    partialText: "已经收到的正文",
    providerMayHaveAccepted: true,
    updatedAt: "2026-08-30T12:00:01.000Z"
  });
  const session = createComposerSession({ activeTurn: receiving });

  assert.equal(session.activeTurn.partialText, "已经收到的正文");
  assert.equal(session.activeTurn.providerMayHaveAccepted, true);
  assert.equal(Object.hasOwn(session.activeTurn, "apiKey"), false);
});

test("startup recovery marks an unfinished text turn interrupted without creating a resend", () => {
  const session = createComposerSession({
    activeTurn: createComposerActiveTurn({
      turnId: "turn-two",
      userMessageId: "user-two",
      status: "receiving",
      phase: "streaming",
      route: "compose",
      routeSource: "manual",
      partialText: "未完成但应保留的提示词",
      providerMayHaveAccepted: true,
      startedAt: "2026-08-30T12:00:00.000Z"
    })
  });

  const recovered = recoverInterruptedComposerTurn(session, "2026-08-30T12:05:00.000Z");

  assert.equal(recovered.activeTurn.status, "interrupted");
  assert.equal(recovered.activeTurn.partialText, "未完成但应保留的提示词");
  assert.equal(recovered.lastFailure.kind, "interrupted");
  assert.equal(recovered.lastFailure.retryable, true);
  assert.match(recovered.lastFailure.message, /不会自动重试/);
});

test("checkpoint writes keep the first in-flight snapshot and then only the latest pending snapshot", async () => {
  const written = [];
  const releases = [];
  const writer = createLatestCheckpointWriter(async (value) => {
    written.push(value);
    await new Promise((resolve) => releases.push(resolve));
  });

  writer.schedule("first");
  writer.schedule("second");
  writer.schedule("latest");
  await Promise.resolve();
  assert.deepEqual(written, ["first"]);

  releases.shift()();
  await Promise.resolve();
  await Promise.resolve();
  assert.deepEqual(written, ["first", "latest"]);

  releases.shift()();
  await writer.drain();
});
