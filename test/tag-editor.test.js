import test from "node:test";
import assert from "node:assert/strict";

import { addTagValues, normalizeTagValue, normalizeTagValues, splitTagInput } from "../tag-editor.js";

test("tag values support multiple Chinese and English separators without duplicates", () => {
  assert.deepEqual(splitTagInput("参考,构图，夜景\n客户喜欢"), ["参考", "构图", "夜景", "客户喜欢"]);
  assert.deepEqual(normalizeTagValues(splitTagInput("参考, 参考，夜景, NIGHT, night")), ["参考", "夜景", "NIGHT"]);
  assert.deepEqual(addTagValues(["参考"], ["夜景", "参考", "待复刻"]), ["参考", "夜景", "待复刻"]);
});

test("tag normalization removes control characters and empty separators", () => {
  assert.equal(normalizeTagValue(" ，  客户\u0000 喜欢； "), "客户 喜欢");
  assert.deepEqual(normalizeTagValues(["", "，", "  "]), []);
});
