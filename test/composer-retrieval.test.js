import test from "node:test";
import assert from "node:assert/strict";

import { retrieveComposerSources } from "../composer-retrieval.js";
import { buildSearchIndex } from "../search-index.js";
import { CONTENT_IDS } from "../taxonomy.js";

test("local composer retrieval keeps cases and guides as separate source roles", () => {
  const sources = retrieveComposerSources({
    query: "霓虹 夜景",
    contentRoles: ["case", "guide"],
    targetType: "image",
    characterBudget: 10_000,
    entries: [
      {
        id: "case",
        title: "霓虹夜景案例",
        text: "霓虹夜景中的人物海报，低机位构图。",
        classification: { pathIds: [CONTENT_IDS.promptImage] },
        customLabels: ["霓虹"]
      },
      {
        id: "guide",
        title: "夜景布光攻略",
        text: "夜景先确定主光方向，再安排霓虹环境光。",
        classification: { pathIds: [CONTENT_IDS.tutorial] }
      },
      {
        id: "video",
        title: "视频案例",
        text: "霓虹夜景运镜",
        classification: { pathIds: [CONTENT_IDS.promptVideo] }
      }
    ]
  });

  assert.deepEqual(sources.map((item) => item.role).sort(), ["case", "guide"]);
  assert.equal(sources.some((item) => item.entryId === "video"), false);
  assert.deepEqual(sources.map((item) => item.alias), ["@检索1", "@检索2"]);
});

test("local composer retrieval excludes hand-selected cases and fills only the available request budget", () => {
  const sources = retrieveComposerSources({
    query: "角色",
    contentRoles: ["case"],
    targetType: "image",
    characterBudget: 240,
    excludedEntryIds: ["selected"],
    entries: [
      { id: "selected", title: "已经手选", text: "角色参考", classification: { pathIds: [CONTENT_IDS.promptImage] } },
      { id: "candidate", title: "候选角色", text: `角色参考 ${"细节".repeat(300)}`, classification: { pathIds: [CONTENT_IDS.promptImage] } },
      { id: "later", title: "另一个角色", text: "角色参考", classification: { pathIds: [CONTENT_IDS.promptImage] } }
    ]
  });

  assert.equal(sources.some((item) => item.entryId === "selected"), false);
  assert.ok(JSON.stringify(sources).length <= 240);
  assert.match(sources[0].text, /本轮按请求容量截断/);
});

test("local composer retrieval can send extracted document text without sending document metadata", () => {
  const sources = retrieveComposerSources({
    query: "镜头节奏",
    contentRoles: ["guide"],
    targetType: "video",
    characterBudget: 2_000,
    entries: [{
      id: "pdf-guide",
      title: "本地私有标题",
      url: "https://private.invalid/guide.pdf",
      text: "",
      classification: { pathIds: [CONTENT_IDS.tutorial] }
    }],
    documentTextByEntryId: new Map([["pdf-guide", "镜头节奏应由可见动作变化推动。"]])
  });

  assert.equal(sources.length, 1);
  assert.equal(sources[0].text, "镜头节奏应由可见动作变化推动。");
  assert.doesNotMatch(sources[0].text, /本地私有标题|private\.invalid/);
});

test("local composer retrieval narrows candidates through the reusable search index", () => {
  const entries = [
    { id: "match", title: "match", text: "雾夜角色布光", classification: { pathIds: [CONTENT_IDS.promptImage] } },
    { id: "partial", title: "partial", text: "普通角色造型", classification: { pathIds: [CONTENT_IDS.promptImage] } },
    { id: "unrelated", title: "unrelated", text: "白日建筑", classification: { pathIds: [CONTENT_IDS.promptImage] } }
  ];
  const sources = retrieveComposerSources({
    query: "雾夜角色",
    contentRoles: ["case"],
    targetType: "image",
    characterBudget: 2_000,
    entries,
    searchIndex: buildSearchIndex(entries)
  });

  assert.deepEqual(sources.map((item) => item.entryId), ["match"]);
});

test("one-click retrieval finds the distinctive subject inside a natural-language request", () => {
  const entries = [
    { id: "case", title: "雾夜案例", text: "雾夜角色穿银色披风。", classification: { pathIds: [CONTENT_IDS.promptImage] } },
    { id: "guide", title: "雾夜教程", text: "雾夜角色先确定轮廓光。", classification: { pathIds: [CONTENT_IDS.tutorial] } },
    { id: "partial", title: "普通角色", text: "普通角色穿黑色夹克。", classification: { pathIds: [CONTENT_IDS.promptImage] } },
    { id: "unrelated", title: "白日建筑", text: "晴天里的白色建筑。", classification: { pathIds: [CONTENT_IDS.promptImage] } }
  ];
  const sources = retrieveComposerSources({
    query: "用私人资料补充雾夜角色",
    contentRoles: ["case", "guide"],
    targetType: "image",
    characterBudget: 2_000,
    entries,
    searchIndex: buildSearchIndex(entries)
  });

  assert.deepEqual(sources.map((item) => item.entryId).sort(), ["case", "guide"]);
});
