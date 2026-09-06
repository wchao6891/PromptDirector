import test from "node:test";
import assert from "node:assert/strict";
import { aiConfigurationFromStorage, resolveTextTaskSettings, resolveVisionTaskSettings, resolveVideoAnalysisTask } from "../ai-runtime.js";
import { analyzeTextDetailedWithDeepSeek } from "../deepseek.js";
import { analyzeImageWithVision } from "../vision.js";
import { analyzeVideoWithChatCompletions } from "../video-analysis.js";
import { createDefaultFacetCatalog } from "../facets.js";

const model = "glm-5.3-flash";
const tasks = ["textTags", "imageAnalysis", "videoAnalysis"];
const configuration = aiConfigurationFromStorage({
  aiProviderRegistry: { providers: { zhipu: {
    apiKey: "offline-fixture-not-a-key", consent: true,
    models: Object.fromEntries(tasks.map(task => [task, model])),
    discoveredModels: [{ id: model, status: "available", confidence: "declared", tasks }]
  } } },
  aiTaskAssignments: Object.fromEntries(tasks.map(task => [task, { providerId: "zhipu", model }]))
});
const catalog = createDefaultFacetCatalog();
const routes = {
  text: fetchImpl => analyzeTextDetailedWithDeepSeek({ text: "离线文字夹具" }, catalog, resolveTextTaskSettings("textTags", configuration), fetchImpl),
  image: fetchImpl => analyzeImageWithVision({ settings: resolveVisionTaskSettings("imageAnalysis", configuration), catalog,
    imageDataUrl: "data:image/png;base64,AQID" }, fetchImpl),
  video: fetchImpl => analyzeVideoWithChatCompletions({ ...resolveVideoAnalysisTask(configuration), catalog,
    mode: "visual-reconstruction", requestId: "offline-budget-fixture", videoBlob: new Blob([new Uint8Array([1, 2, 3])], { type: "video/mp4" }) }, { fetchImpl })
};

for (const [kind, run] of Object.entries(routes)) {
  test(`${kind}: GLM sends its documented output capacity without weakening thinking or retrying truncation`, async () => {
    const requests = [];
    // Synthetic transport boundary: this is not a real model-quality or token-usage receipt.
    await assert.rejects(run(async (_url, options) => {
      requests.push(JSON.parse(options.body));
      return new Response(JSON.stringify({ choices: [{ finish_reason: "length", message: { content: "离线截断夹具" } }] }), { status: 200 });
    }), error => error.code === "output_truncated");
    assert.equal(requests.length, 1, "a provider truncation must not trigger another billable request");
    const request = requests[0];
    // Independent source: https://docs.bigmodel.cn/cn/guide/models/vlm/glm-5.3-flash (128K).
    assert.equal(request.max_tokens, 131072);
    assert.equal(request.model, model);
    assert.notEqual(request.thinking?.type, "disabled");
    assert.ok(!request.reasoning_effort || request.reasoning_effort === "max");
    if (kind === "image") assert.ok(request.messages.some(message => Array.isArray(message.content) && message.content.some(part => part.type === "image_url")));
    if (kind === "video") assert.equal(request.messages[0].content.find(part => part.type === "video_url").video_url.url, "AQID");
  });
}
