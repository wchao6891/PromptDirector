import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import { organizeDetailTagsWithDeepSeek } from "../extension/deepseek.js";
import { setTaskProgress } from "../extension/task-feedback.js";
import {
  ANALYSIS_DETAIL_MAX_LENGTH, applyDetailOrganizationMappings, applyFixedAnalysisTags,
  createDetailOrganizationChunks, createFixedFacetCatalog,
  detailOrganizationRequestChunk, validateDetailOrganizationResponse
} from "../extension/tag-taxonomy.js";

const chunk = {
  g: ["subject.character", "主体与角色", "人物与角色类型"],
  d: [["detail:subject.character:fixture-a", "韩国女偶像", 2], ["detail:subject.character:fixture-b", "披风剑客", 3]]
};
const [id, label] = chunk.d[0];

const secondChunk = {
  g: ["style.render", "视觉风格", "渲染方式"],
  d: [["detail:style.render:a", "电影写实", 2], ["detail:style.render:b", "写实渲染", 3]]
};

function modelReply(m, finishReason = "stop") {
  return new Response(JSON.stringify({ choices: [{ finish_reason: finishReason, message: { content: JSON.stringify({ m }) } }] }));
}

function libraryHarness(chunks, replyForCall) {
  const source = fs.readFileSync(new URL("../extension/library.js", import.meta.url), "utf8");
  const start = source.indexOf("let detailOrganizationProgress = null;");
  const end = source.indexOf("async function controlAnalysisBatch", start);
  assert.ok(start >= 0 && end > start, "Exercise the production library action, not a copy of its loop");
  const state = { chunks, settings: { apiKey: "fixture", consent: true, analysisModel: "deepseek-chat" } };
  const calls = [], confirmations = [], feedback = [], applied = [];
  const attributes = () => ({ setAttribute() {}, removeAttribute() {}, classList: { toggle() {} } });
  const context = vm.createContext({
    elements: { organizeDetailTags: { disabled: false, ...attributes() }, organizeDetailProgress: attributes(), organizeDetailStatus: {}, facetRecoveryActions: {} },
    setTaskProgress,
    facetCatalog: {}, entries: [], TextEncoder,
    createDetailOrganizationChunks: () => state.chunks,
    detailOrganizationRequestChunk,
    privateAiSettings: async () => state.settings,
    currentLocale: () => "zh-CN",
    confirmAppAction: async options => { confirmations.push(options.description); return true; },
    t: (text, values = {}) => Object.entries(values).reduce((text, [key, value]) => text.replaceAll(`{${key}}`, value), text),
    translateUiMessage: text => text,
    transientFeedback: { show: (_element, text) => feedback.push(text), revealRecovery: () => {} },
    organizeDetailTagsWithDeepSeek: async (input, settings) => {
      calls.push(input.g[0]);
      return organizeDetailTagsWithDeepSeek(input, settings, async () => replyForCall(input, calls.length));
    },
    chrome: { runtime: { sendMessage: async message => { applied.push(message); return { ok: true, message: "整理完成" }; } } },
    refreshLibrary: async () => {}
  });
  vm.runInContext(source.slice(start, end), context);
  return { state, context, calls, confirmations, feedback, applied, run: () => vm.runInContext("organizeDetailTags()", context) };
}

test("organization rejection identifies each invalid model mapping without accepting partial changes", () => {
  const probes = [
    [{ id: "subject.character", n: label }, /不属于本批/],
    [{ id, n: label }, /不同名称/],
    [{ id: chunk.d[1][0], n: " " }, /空名称/],
    [{ id: chunk.d[1][0], n: "a".repeat(ANALYSIS_DETAIL_MAX_LENGTH + 1) }, /名称超过/]
  ];
  for (const [invalid, message] of probes) {
    const before = structuredClone(chunk);
    assert.throws(() => validateDetailOrganizationResponse({ m: [{ id, n: "女性偶像" }, invalid] }, chunk), message);
    assert.deepEqual(chunk, before);
  }
});

test("organization prompt describes real tag rows and all mapping constraints", async () => {
  let request;
  const result = await organizeDetailTagsWithDeepSeek(chunk, { apiKey: "fixture", consent: true }, async (_url, options) => {
    request = JSON.parse(options.body);
    return new Response(JSON.stringify({ choices: [{ finish_reason: "stop", message: { content: '{"m":[]}' } }] }));
  });
  const prompt = request.messages[0].content;
  assert.match(prompt, /标签编号.*当前名称.*使用案例数/);
  assert.match(prompt, /逐字复制/);
  assert.match(prompt, /编号最多.*一次/);
  assert.match(prompt, new RegExp(`不得超过 ${ANALYSIS_DETAIL_MAX_LENGTH} 个字符`));
  assert.match(prompt, /不得为空/);
  assert.deepEqual(JSON.parse(request.messages[1].content), {
    g: chunk.g.slice(1), d: chunk.d.map(([, name, count], index) => [String(index + 1), name, count])
  });
  assert.doesNotMatch(request.messages[1].content, /detail:|subject\.character/);
  assert.deepEqual(result.mappings, []);
});

test("invalid organization replies fail once and keep all result mappings uncommitted", async () => {
  let calls = 0;
  await assert.rejects(() => organizeDetailTagsWithDeepSeek(chunk, { apiKey: "fixture", consent: true }, async () => {
    calls += 1;
    return new Response(JSON.stringify({ choices: [{ finish_reason: "stop", message: {
      content: JSON.stringify({ m: [{ id: "1", n: "女性偶像" }, { id: "1", n: "女偶像" }] })
    } }] }));
  }), /不同名称（「女性偶像」和「女偶像」）/);
  assert.equal(calls, 1, "A rejected model result must not trigger an unconfirmed paid retry");
});

test("library failure names its group and batch, preserves earlier results, and resumes without charging them again", async () => {
  const harness = libraryHarness([chunk, secondChunk], (_input, call) => modelReply(call === 2
    ? [{ id: "1", n: "写实" }, { id: "1", n: "电影写实" }]
    : [{ id: "1", n: "规范名称" }]));
  const { calls, confirmations, feedback, applied, context } = harness;
  await harness.run();
  assert.match(feedback.at(-1), /第 2\/2 批（渲染方式）失败：AI 为同一标签返回了不同名称/);
  assert.equal(applied.length, 0, "A late invalid chunk must not commit earlier valid chunks");
  assert.equal(context.elements.organizeDetailTags.disabled, false);
  await harness.run();
  assert.match(confirmations[0], /2 次付费请求/);
  assert.match(confirmations[1], /1 次付费请求/);
  const bytes = input => new TextEncoder().encode(JSON.stringify(detailOrganizationRequestChunk(input))).length;
  assert.ok(confirmations[0].includes((bytes(chunk) + bytes(secondChunk)).toLocaleString("zh-CN")), "Payment confirmation must show the bytes actually sent to the model");
  assert.ok(confirmations[1].includes(bytes(secondChunk).toLocaleString("zh-CN")), "Retry confirmation must only include the remaining input");
  assert.deepEqual(calls, ["subject.character", "style.render", "style.render"]);
  assert.equal(applied.length, 1);
  assert.equal(applied[0].mappings.length, 2);
  assert.equal(context.elements.organizeDetailTags.disabled, false);
});

test("per-request sequence numbers map back to the exact original tags even across different batches", async () => {
  for (const input of [chunk, { ...chunk, d: [["detail:subject.character:other", "其他角色", 1]] }]) {
    let request;
    const result = await organizeDetailTagsWithDeepSeek(input, { apiKey: "fixture", consent: true }, async (_url, options) => {
      request = JSON.parse(options.body);
      return new Response(JSON.stringify({ choices: [{ finish_reason: "stop", message: {
        content: JSON.stringify({ m: [{ id: 1, n: "人物角色" }] })
      } }] }));
    });
    assert.deepEqual(JSON.parse(request.messages[1].content).d[0], ["1", input.d[0][1], input.d[0][2]]);
    assert.deepEqual(result.mappings, [{ id: input.d[0][0], n: "人物角色" }]);
  }
});

test("unrecognized or out-of-range sequence numbers cannot resolve by label or alter library identity", async () => {
  for (const invalidId of ["0", "3", "1.0", "01", label, id, "subject.character"]) {
    await assert.rejects(() => organizeDetailTagsWithDeepSeek(chunk, { apiKey: "fixture", consent: true }, async () => {
      return new Response(JSON.stringify({ choices: [{ finish_reason: "stop", message: {
        content: JSON.stringify({ m: [{ id: "1", n: "女性偶像" }, { id: invalidId, n: label }] })
      } }] }));
    }), /不属于本批/);
  }
});

test("reordered model mappings resolve by the local sequence table even when original names match", async () => {
  const input = { ...chunk, d: [["original-a", "相同名称", 2], ["original-b", "相同名称", 3]] };
  const result = await organizeDetailTagsWithDeepSeek(input, { apiKey: "fixture", consent: true }, async () => {
    return new Response(JSON.stringify({ choices: [{ finish_reason: "stop", message: {
      content: JSON.stringify({ m: [{ id: "2", n: "第二标签" }, { id: "1", n: "第一标签" }] })
    } }] }));
  });
  assert.deepEqual(result.mappings, [{ id: "original-b", n: "第二标签" }, { id: "original-a", n: "第一标签" }]);
});

test("identical duplicate mappings are redundant and apply each original tag only once", async () => {
  const before = structuredClone(chunk);
  const result = await organizeDetailTagsWithDeepSeek(chunk, { apiKey: "fixture", consent: true }, async () => {
    return new Response(JSON.stringify({ choices: [{ finish_reason: "stop", message: {
      content: JSON.stringify({ m: [{ id: "1", n: "女性偶像" }, { id: 1, n: " 女性偶像 " }, { id: "2", n: "剑客" }, { id: "1", n: "女性偶像" }] })
    } }] }));
  });
  assert.deepEqual(result.mappings, [{ id, n: "女性偶像" }, { id: chunk.d[1][0], n: "剑客" }]);
  assert.deepEqual(chunk, before);
});

test("a duplicate still validates all fields and cannot hide invalid output", () => {
  const known = detailOrganizationRequestChunk(chunk);
  const valid = { id: "1", n: "女性偶像" };
  const invalidRows = [
    [{ ...valid, reason: "duplicate" }, /未允许字段/],
    [{ id: "1", n: [valid.n] }, /格式无效/],
    [{ id: "1", n: 123 }, /格式无效/],
    [{ id: "1", n: "" }, /空名称/],
    [{ id: "1", n: "a".repeat(ANALYSIS_DETAIL_MAX_LENGTH + 1) }, /名称超过/]
  ];
  for (const [invalid, message] of invalidRows) {
    assert.throws(() => validateDetailOrganizationResponse({ m: [valid, invalid] }, known), message);
  }
});

// Match the reported run length and failure position, with synthetic identities
// and deterministic replies. This does not substitute for real-model acceptance.
for (const [failure, invalid, reason] of [
  ["unknown ID", [{ id: "3", n: "角色" }], /不属于本批/],
  ["conflicting duplicate", [{ id: "1", n: "角色" }, { id: "1", n: "服装" }], /不同名称/]
]) {
  test(`159-batch organization stops at batch 23 on ${failure}, then resumes the remaining 137 without partial writes or cross-batch IDs`, async () => {
    const chunks = Array.from({ length: 159 }, (_, index) => ({
      g: [`fixture-group-${index + 1}`, "测试维度", index === 22 ? "服装造型" : `分组${index + 1}`],
      d: [[`detail:fixture:${index}:a`, "相同原名称", 2], [`detail:fixture:${index}:b`, "相同原名称", 3]]
    }));
    const before = structuredClone(chunks);
    const valid = [{ id: "2", n: "造型" }, { id: 1, n: "角色" }, { id: "1", n: " 角色 " }];
    const harness = libraryHarness(chunks, (_input, call) => modelReply(call === 23 ? invalid : valid));

    await harness.run();
    assert.equal(harness.calls.length, 23, "Do not continue or automatically charge for another request after rejection");
    assert.match(harness.feedback.at(-1), /第 23\/159 批（服装造型）失败/);
    assert.match(harness.feedback.at(-1), reason);
    assert.equal(harness.applied.length, 0, "The first 22 paid results must remain uncommitted on a late model failure");
    assert.equal(vm.runInContext("detailOrganizationProgress.results.length", harness.context), 22);
    assert.equal(harness.context.elements.organizeDetailTags.disabled, false);

    await harness.run();
    assert.match(harness.confirmations[0], /159 次付费请求/);
    assert.match(harness.confirmations[1], /137 次付费请求/);
    const pending = chunks.slice(22);
    const bytes = pending.reduce((sum, input) => sum + Buffer.byteLength(JSON.stringify(detailOrganizationRequestChunk(input))), 0);
    assert.ok(harness.confirmations[1].includes(bytes.toLocaleString("zh-CN")), "Only remaining input is included in retry cost disclosure");
    assert.deepEqual(harness.calls, [...chunks.slice(0, 23), ...pending].map(input => input.g[0]));
    assert.equal(harness.applied.length, 1, "One write is allowed only after all chunks validate");
    assert.equal(harness.applied[0].type, "APPLY_DETAIL_TAG_ORGANIZATION");
    const mappings = JSON.parse(JSON.stringify(harness.applied[0].mappings));
    assert.deepEqual(mappings, chunks.flatMap(input => [
      { id: input.d[1][0], n: "造型" }, { id: input.d[0][0], n: "角色" }
    ]), "Repeated per-batch numbers and matching original names must resolve to their own persistent identities");
    assert.equal(new Set(mappings.map(item => item.id)).size, 318, "Identical duplicates must not reach the storage write");
    assert.equal(vm.runInContext("detailOrganizationProgress", harness.context), null);
    assert.deepEqual(chunks, before);
  });
}

test("a length-limited response is rejected even when its partial content is syntactically valid JSON", async () => {
  let calls = 0;
  await assert.rejects(() => organizeDetailTagsWithDeepSeek(chunk, { apiKey: "fixture", consent: true }, async () => {
    calls += 1;
    return modelReply([{ id: "1", n: "女性偶像" }], "length");
  }), error => error.code === "output_truncated" && error.diagnostic.finishReason === "length");
  assert.equal(calls, 1, "Truncation cannot be hidden by a paid automatic retry");
});

for (const change of ["tag identity", "model"]) {
  test(`cached organization results are discarded when ${change} changes, protecting the current library and request choice`, async () => {
    const harness = libraryHarness(structuredClone([chunk, secondChunk]), (_input, call) => modelReply(call === 2
      ? [{ id: "unknown", n: "规范名称" }]
      : [{ id: "1", n: "规范名称" }]));
    await harness.run();
    assert.equal(harness.applied.length, 0);
    if (change === "tag identity") harness.state.chunks[0].d[0][0] = "detail:subject.character:new-identity";
    else harness.state.settings.analysisModel = "deepseek-reasoner";

    await harness.run();
    assert.deepEqual(harness.calls, ["subject.character", "style.render", "subject.character", "style.render"]);
    assert.match(harness.confirmations[1], /2 次付费请求/, "Changed input cannot reuse old paid results silently");
    assert.equal(harness.applied.length, 1);
    assert.deepEqual(JSON.parse(JSON.stringify(harness.applied[0].mappings)), harness.state.chunks.map(input => ({ id: input.d[0][0], n: "规范名称" })));
  });
}

test("duplicate model output can be merged through production functions while preserving case identities, edits, originals and project relationships", async () => {
  let state = {
    facetCatalog: createFixedFacetCatalog(),
    entries: ["a", "b", "c"].map(id => ({
      id, title: `人工标题${id}`, text: `人工原词${id}`, customLabels: ["人工标签"],
      mediaAssets: [{ id: `asset-${id}`, kind: "image", storageMode: "managed", assetPath: `images/${id}.png` }],
      primaryMediaId: `asset-${id}`, facetAssignments: []
    })),
    organizerState: { collections: [{ id: "project", name: "项目", entryIds: ["a", "b", "c"] }] },
    compoundCases: [{ id: "compound", memberEntryIds: ["b", "a"] }],
    trashState: { items: [{ entry: { id: "deleted", text: "可恢复正文", mediaAssets: [{ id: "retained-original" }] } }] }
  };
  for (const [id, g, t] of [["a", "style.render", "赛璐珞"], ["b", "style.render", "赛璐珞动画"], ["c", "style.medium", "赛璐珞"]]) {
    state = applyFixedAnalysisTags(state, id, [{ g, t }]).state;
  }
  const before = structuredClone(state);
  const chunks = createDetailOrganizationChunks(state.facetCatalog, state.entries);
  assert.equal(chunks.length, 1, "The singleton in another group is not included in this merge");
  const result = await organizeDetailTagsWithDeepSeek(chunks[0], { apiKey: "fixture", consent: true }, async () => modelReply([
    { id: "2", n: "赛璐珞" }, { id: "1", n: "赛璐珞" }, { id: 2, n: " 赛璐珞 " }
  ]));
  const applied = applyDetailOrganizationMappings(state, result.mappings);
  assert.equal(applied.changedCount, 2);
  assert.equal(applied.mergedCount, 1);
  const nonTagData = ({ facetAssignments, ...rest }) => rest;
  assert.deepEqual(applied.state.entries.map(nonTagData), before.entries.map(nonTagData));
  for (const key of ["organizerState", "compoundCases", "trashState"]) assert.deepEqual(applied.state[key], before[key]);
  assert.equal(applied.state.entries[0].facetAssignments[0].nodeId, applied.state.entries[1].facetAssignments[0].nodeId);
  assert.deepEqual(applied.state.entries[2].facetAssignments, before.entries[2].facetAssignments, "A matching label in another group must retain its identity");
  assert.deepEqual(state, before, "Applying a plan must not mutate its source snapshot");
});
