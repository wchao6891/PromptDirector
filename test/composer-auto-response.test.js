import test from "node:test";
import assert from "node:assert/strict";

import {
  composerAutoResponseProtocolFacts,
  createComposerAutoResponseProjector,
  parseComposerAutoResponse
} from "../composer-auto-response.js";

test("a valid automatic response exposes only the user-visible body", () => {
  assert.deepEqual(parseComposerAutoResponse(
    '{"route":"compose","status":"ready"}\n一只白猫站在蓝色窗边。',
    { final: true }
  ), {
    ready: true,
    route: "compose",
    status: "ready",
    visibleText: "一只白猫站在蓝色窗边。",
    degraded: false,
    degradationReason: ""
  });
});

test("a response without the control frame is preserved as a normal answer", () => {
  assert.deepEqual(parseComposerAutoResponse("先讨论这个方向，不生成提示词。", { final: true }), {
    ready: true,
    route: "chat",
    status: "ready",
    visibleText: "先讨论这个方向，不生成提示词。",
    degraded: true,
    degradationReason: "invalid_control_frame"
  });
});

test("automatic streaming hides the control frame and emits only visible body deltas", () => {
  const updates = [];
  const projector = createComposerAutoResponseProjector((delta, content) => updates.push({ delta, content }));

  assert.equal(projector.push('{"route":"compose"').ready, false);
  assert.equal(projector.push('{"route":"compose","status":"ready"}\n一只').visibleText, "一只");
  assert.equal(projector.push('{"route":"compose","status":"ready"}\n一只白猫').visibleText, "一只白猫");

  assert.deepEqual(updates, [
    { delta: "一只", content: "一只" },
    { delta: "白猫", content: "一只白猫" }
  ]);
});

test("plain-text fallback streams immediately instead of waiting for completion", () => {
  const updates = [];
  const projector = createComposerAutoResponseProjector((delta, content) => updates.push({ delta, content }));

  const partial = projector.push("先讨论");
  projector.push("先讨论这个方向");

  assert.equal(partial.ready, true);
  assert.equal(partial.degraded, true);
  assert.deepEqual(updates, [
    { delta: "先讨论", content: "先讨论" },
    { delta: "这个方向", content: "先讨论这个方向" }
  ]);
});

test("a normal JSON answer is preserved when it is not an automatic control frame", () => {
  const content = '{"subject":"白猫","lighting":"逆光"}';
  assert.deepEqual(parseComposerAutoResponse(content, { final: true }), {
    ready: true,
    route: "chat",
    status: "ready",
    visibleText: content,
    degraded: true,
    degradationReason: "invalid_control_frame"
  });
});

test("automatic fallback exposes one compact diagnostic fact without another request", () => {
  assert.deepEqual(composerAutoResponseProtocolFacts({
    degraded: true,
    degradationReason: "invalid_control_frame"
  }), {
    protocolDegraded: true,
    protocolDegradationReason: "invalid_control_frame"
  });
});
