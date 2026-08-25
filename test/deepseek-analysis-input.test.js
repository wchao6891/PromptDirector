import test from "node:test";
import assert from "node:assert/strict";

import { analyzeTextDetailedWithDeepSeek } from "../deepseek.js";
import { createFixedFacetCatalog } from "../tag-taxonomy.js";

test("detail text analysis sends the canonical primary-image prompt to DeepSeek", async () => {
  const requests = [];
  const result = await analyzeTextDetailedWithDeepSeek({
    id: "entry",
    title: "案例",
    text: "共享提示词",
    primaryMediaId: "image-a",
    mediaAssets: [{ id: "image-a", kind: "image" }],
    mediaPrompts: [{ assetId: "image-a", text: "当前图片提示词", updatedAt: "2026-08-21T09:30:00.000Z" }]
  }, createFixedFacetCatalog(), {
    apiKey: "test-key",
    consent: true,
    analysisModel: "deepseek-v4-flash"
  }, async (_url, options) => {
    requests.push(JSON.parse(options.body));
    return {
      ok: true,
      json: async () => ({
        choices: [{ finish_reason: "stop", message: { content: JSON.stringify({ tags: [{ g: "subject.character", t: "角色" }] }) } }],
        usage: { total_tokens: 9 }
      })
    };
  });

  assert.equal(result.tags.length, 1);
  const userMessage = requests[0].messages.find((item) => item.role === "user");
  assert.match(userMessage.content, /当前图片提示词/);
  assert.doesNotMatch(userMessage.content, /共享提示词/);
});
