import test from "node:test";
import assert from "node:assert/strict";
import { editedLabels } from "../extension/label-edits.js";

test("a stale page edit and a concurrent Agent label change both survive", () => {
  // The page saw ["人像"] and removed it; meanwhile an Agent added "夜景" to the stored labels.
  assert.deepEqual(editedLabels(["人像", "夜景"], { addLabels: [], removeLabels: ["人像"] }), ["夜景"]);
  // The page added "胶片" from its stale view; the Agent's "夜景" stays.
  assert.deepEqual(editedLabels(["人像", "夜景"], { addLabels: ["胶片"], removeLabels: [] }), ["人像", "夜景", "胶片"]);
  assert.deepEqual(editedLabels(["人像"], { addLabels: ["人像"] }), ["人像"], "re-adding does not duplicate");
});

test("a whole label list still replaces the labels for callers that send one", () => {
  assert.deepEqual(editedLabels(["旧"], { customLabels: ["新", "新"] }), ["新"]);
});
