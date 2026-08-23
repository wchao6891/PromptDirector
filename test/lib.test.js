import test from "node:test";
import assert from "node:assert/strict";

import {
  DEFAULT_SETTINGS,
  DEFAULT_SETTINGS_EN,
  buildEntry,
  calculateCropGeometry,
  findDuplicate,
  libraryTitleForLocale,
  libraryTitleForStorage,
  normalizeOutputPath,
  normalizeSettings,
  normalizeSelection,
  renderLibraryJson,
  renderMarkdown
} from "../lib.js";
import { CONTENT_IDS, SCHEMA_VERSION, createDefaultTaxonomy } from "../taxonomy.js";
import { createDefaultFacetCatalog, createEmptyFacetCatalog, createFacet, createFacetNode } from "../facets.js";

test("normalizeSelection preserves paragraphs while removing copied line noise", () => {
  assert.equal(
    normalizeSelection("  First line  \r\nSecond line\t\r\n\r\n"),
    "First line\nSecond line"
  );
});

test("normalizeOutputPath keeps a safe relative markdown path", () => {
  assert.equal(
    normalizeOutputPath(" ../Prompt:Cases / examples "),
    "Prompt-Cases/examples.zip"
  );
  assert.equal(normalizeOutputPath(""), DEFAULT_SETTINGS.outputPath);
  assert.equal(
    normalizeOutputPath("提示词案例库/旧案例.md"),
    "提示词案例库/旧案例.zip"
  );
});

test("legacy default library names migrate without overwriting genuine custom names", () => {
  assert.equal(normalizeSettings({ libraryTitle: "优秀提示词案例库" }).libraryTitle, "视觉创作灵感库");
  assert.equal(normalizeSettings({ libraryTitle: "Visual Creative Archive" }, DEFAULT_SETTINGS_EN).libraryTitle, "Visual Inspiration Library");
  assert.equal(normalizeSettings({ libraryTitle: "我的导演项目" }).libraryTitle, "我的导演项目");
});

test("system library titles follow the interface language without rewriting custom titles", () => {
  assert.equal(libraryTitleForLocale("视觉创作灵感库", "en"), "Visual Inspiration Library");
  assert.equal(libraryTitleForLocale("Visual Inspiration Library", "zh-CN"), "视觉创作灵感库");
  assert.equal(libraryTitleForLocale("优秀提示词案例库", "en"), "Visual Inspiration Library");
  assert.equal(libraryTitleForLocale("我的导演项目", "en"), "我的导演项目");
});

test("saving another library setting does not rewrite a localized system title", () => {
  assert.equal(libraryTitleForStorage("Visual Inspiration Library", "视觉创作灵感库", "en"), "视觉创作灵感库");
  assert.equal(libraryTitleForStorage("Director archive", "视觉创作灵感库", "en"), "Director archive");
});

test("renderMarkdown keeps source metadata and does not break on code fences", () => {
  const taxonomy = createDefaultTaxonomy();
  let facets = createFacet(createEmptyFacetCatalog(), { id: "facet:visual", name: "视觉风格" });
  facets = createFacetNode(facets, { id: "tag:aesthetic", facetId: "facet:visual", name: "整体审美" });
  facets = createFacetNode(facets, { id: "tag:cinema", facetId: "facet:visual", parentId: "tag:aesthetic", name: "电影感" });
  facets = createFacet(facets, { id: "facet:light", name: "灯光设计" });
  facets = createFacetNode(facets, { id: "tag:setup", facetId: "facet:light", name: "经典布光" });
  facets = createFacetNode(facets, { id: "tag:rembrandt", facetId: "facet:light", parentId: "tag:setup", name: "伦勃朗光" });
  const markdown = renderMarkdown(
    [
      {
        id: "entry-1",
        text: "A cinematic prompt\n```json\n{}\n```",
        title: "Creator [on X]",
        url: "https://x.com/creator/status/123?ref=test",
        savedAt: "2026-07-17T12:30:00.000Z",
        visuals: [{ id: "visual-1", screenshotPath: "images/entry-1.webp", palette: { colors: ["#102030", "#E89030"], source: "screenshot", version: 1 } }],
        primaryVisualId: "visual-1",
        classification: {
          pathIds: [CONTENT_IDS.promptImage],
          status: "confirmed"
        },
        customLabels: ["喜欢", "待复刻"],
        negativeTerms: ["watermark", "bad hands"],
        facetAssignments: [
          { facetId: "facet:visual", nodeId: "tag:cinema", status: "confirmed", source: "manual" },
          { facetId: "facet:light", nodeId: "tag:rembrandt", status: "confirmed", source: "manual", evidence: "LIGHTING: Rembrandt lighting" }
        ],
        analysisCandidates: [{ id: "candidate:one", dimensionName: "镜头调度", groupName: "摄影机运动", tagName: "跟拍", source: "deepseek_text", evidence: "tracking shot" }]
      }
    ],
    DEFAULT_SETTINGS,
    taxonomy,
    facets
  );

  assert.match(markdown, /^# 视觉创作灵感库/m);
  assert.match(markdown, /共 1 条案例/);
  assert.match(markdown, /- 截图 1（主图）：!\[对应画面\]\(images\/entry-1.webp\)/);
  assert.ok(
    markdown.includes("![对应画面](images/entry-1.webp)")
  );
  assert.doesNotMatch(markdown, /base64,/);
  assert.match(markdown, /- 内容类型：图片提示词/);
  assert.match(markdown, /- 视觉风格：整体审美 \/ 电影感/);
  assert.match(markdown, /- 灯光设计：经典布光 \/ 伦勃朗光/);
  assert.match(markdown, /- 自定义标签：喜欢、待复刻/);
  assert.match(markdown, /- 主图代表色卡：#102030、#E89030/);
  assert.match(markdown, /- 负面提示词原文：watermark、bad hands/);
  assert.match(markdown, /### 待确认建议[\s\S]*镜头调度 \/ 摄影机运动 \/ 跟拍/);
  assert.ok(
    markdown.includes(
      "[Creator \\[on X\\]](https://x.com/creator/status/123?ref=test)"
    )
  );
  assert.match(markdown, /````text\nA cinematic prompt\n```json\n\{\}\n```\n````/);
});

test("renderMarkdown keeps older text-only entries readable", () => {
  const markdown = renderMarkdown([
    {
      id: "entry-without-image",
      text: "text only prompt",
      title: "Old entry",
      url: "https://example.com/old",
      savedAt: "2026-07-17T12:30:00.000Z"
    }
  ]);

  assert.doesNotMatch(markdown, /### 对应画面/);
  assert.match(markdown, /text only prompt/);
});

test("English export localizes system headings but preserves creator content", () => {
  const markdown = renderMarkdown([{
    id: "entry-en",
    title: "用户标题",
    text: "用户提示词",
    savedAt: "2026-07-19T10:00:00.000Z",
    classification: { pathIds: [CONTENT_IDS.promptImage], status: "confirmed" }
  }], DEFAULT_SETTINGS_EN, createDefaultTaxonomy(), createDefaultFacetCatalog(), { locale: "en" });
  assert.match(markdown, /^# Visual Inspiration Library/m);
  assert.match(markdown, /## Case 01 \| 用户标题/);
  assert.match(markdown, /- Content type: Image prompt/);
  assert.match(markdown, /### Original prompt[\s\S]*用户提示词/);
});

test("English export resolves a stored Chinese system library title", () => {
  const markdown = renderMarkdown([], { ...DEFAULT_SETTINGS, libraryTitle: "视觉创作灵感库" }, undefined, undefined, { locale: "en" });
  assert.match(markdown, /^# Visual Inspiration Library/m);
});

test("calculateCropGeometry maps CSS pixels to screenshot pixels and caps output width", () => {
  assert.deepEqual(
    calculateCropGeometry({
      imageWidth: 2400,
      imageHeight: 1600,
      viewportWidth: 1200,
      viewportHeight: 800,
      rect: { x: 100, y: 50, width: 1000, height: 600 },
      maxOutputWidth: 1000
    }),
    {
      sourceX: 200,
      sourceY: 100,
      sourceWidth: 2000,
      sourceHeight: 1200,
      outputWidth: 1000,
      outputHeight: 600
    }
  );
});

test("findDuplicate only rejects the same text from the same page", () => {
  const entries = [{ text: "same prompt", url: "https://x.com/a" }];
  assert.ok(findDuplicate(entries, { text: "same prompt", url: "https://x.com/a" }));
  assert.equal(
    findDuplicate(entries, { text: "same prompt", url: "https://x.com/b" }),
    undefined
  );
});

test("screenshot-only cases can have no prompt text and export as image references", () => {
  const entry = buildEntry({
    text: "", title: "Style reference", url: "https://example.com/style", allowEmptyText: true
  });
  const markdown = renderMarkdown([{
    ...entry,
    visuals: [{ id: entry.id, screenshotPath: `images/${entry.id}.webp` }],
    primaryVisualId: entry.id,
    classification: { pathIds: [CONTENT_IDS.imageCase], status: "confirmed", source: "manual" }
  }]);
  assert.equal(entry.text, "");
  assert.match(markdown, /- 内容类型：图片案例/);
  assert.match(markdown, /仅包含截图和 AI 标签/);
  assert.doesNotMatch(markdown, /### 原始提示词/);
});

test("Markdown backup keeps the current visual description without exposing provider metadata", () => {
  const markdown = renderMarkdown([{
    id: "vision-case",
    title: "Visual case",
    text: "",
    visuals: [{ id: "vision-1", visionAnalysis: {
      description: "A courtyard surrounded by blue-green mist.", providerType: "compatible", model: "private-model"
    } }],
    primaryVisualId: "vision-1",
    classification: { pathIds: [CONTENT_IDS.imageCase], status: "confirmed" }
  }]);
  assert.match(markdown, /### 画面描述[\s\S]*A courtyard surrounded by blue-green mist\./);
  assert.doesNotMatch(markdown, /private-model|compatible/);
});

test("library JSON is machine-readable and references screenshots without base64", () => {
  const json = renderLibraryJson([
    { id: "case-1", title: "示例", text: "prompt", visuals: [{ id: "visual-1", screenshotPath: "images/case-1/visual-1.webp" }], primaryVisualId: "visual-1" }
  ], { libraryTitle: "案例库" }, createDefaultTaxonomy(), createDefaultFacetCatalog(), []);
  const parsed = JSON.parse(json);

  assert.equal(parsed.format, "prompt-case-library");
  assert.equal(parsed.version, 4);
  assert.equal(parsed.schemaVersion, SCHEMA_VERSION);
  assert.equal(parsed.entries[0].visuals[0].screenshotPath, "images/case-1/visual-1.webp");
  assert.equal(json.includes("base64,"), false);
  assert.ok(Array.isArray(parsed.facetCatalog.facets));
});
