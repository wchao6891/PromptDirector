import test from "node:test";
import assert from "node:assert/strict";

import { parseStructuredObject } from "../structured-output.js";

test("structured output accepts fenced JSON, surrounding prose, a trailing comma, and double encoding", () => {
  assert.deepEqual(parseStructuredObject("\uFEFF```json\n{\"tags\":[{\"g\":\"style.render\",}],}\n```"), {
    tags: [{ g: "style.render" }]
  });
  assert.deepEqual(parseStructuredObject("模型结果如下： {\"tags\":[{\"g\":\"scene.place\"}]} 谢谢"), {
    tags: [{ g: "scene.place" }]
  });
  assert.deepEqual(parseStructuredObject(JSON.stringify('{"tags":[{"g":"light.direction"}]}')), {
    tags: [{ g: "light.direction" }]
  });
});

test("structured output never evaluates executable text or invents a missing object", () => {
  globalThis.__structuredOutputExecuted = false;
  assert.throws(() => parseStructuredObject("globalThis.__structuredOutputExecuted = true"), /JSON|结构化/);
  assert.equal(globalThis.__structuredOutputExecuted, false);
  delete globalThis.__structuredOutputExecuted;
});

test("structured output recovers only complete top-level fields from a truncated object", () => {
  const recovered = parseStructuredObject('{"description":"visible","tags":[{"g":"style.render","t":"CG"}],"canvas":{"width":');
  assert.deepEqual(recovered, {
    description: "visible",
    tags: [{ g: "style.render", t: "CG" }]
  });
  assert.deepEqual(parseStructuredObject('{"description":"visible"'), { description: "visible" });
  assert.throws(() => parseStructuredObject('{"description":"vis'), /JSON/);
});
