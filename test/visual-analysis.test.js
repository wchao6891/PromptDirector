import test from "node:test";
import assert from "node:assert/strict";

import {
  VISUAL_ANALYSIS_DIMENSIONS,
  VISUAL_MODEL_RESPONSE_SCHEMA,
  compileVisualAnalysisInstruction,
  mergePartialVisualAnalysis,
  normalizeVisualAnalysisV2,
  normalizeVisualModelResponse,
  prepareVisualSetSummary
} from "../visual-analysis.js";
import { createDefaultFacetCatalog } from "../facets.js";

function completeAnalysis(overrides = {}) {
  return {
    description: "竖版海报中，一名人物位于画面中央，背景为逆光城市街道。",
    canvas: {
      width: 1080,
      height: 1920,
      aspectRatio: "9:16",
      orientation: "portrait",
      dominantColors: [
        { hex: "#101820", coveragePercent: 62, source: "estimated" },
        { hex: "#F2A65A", coveragePercent: 18, source: "estimated" }
      ]
    },
    elements: [{
      id: "subject-1",
      label: "中央人物",
      category: "person",
      bbox: { x: 310, y: 170, width: 380, height: 710, source: "estimated" },
      coveragePercent: 27,
      depthLayer: "foreground",
      occludes: [],
      occludedBy: [],
      relationships: ["位于画面中央"],
      visualAttributes: ["黑色夹克", "暖色轮廓光"]
    }],
    dimensions: VISUAL_ANALYSIS_DIMENSIONS.map((id) => ({
      id,
      applicable: id !== "sound",
      facts: id === "sound" ? [] : [`${id} 可见事实`],
      measurements: []
    })),
    ocr: [{
      text: "PROMPT DIRECTOR",
      legibility: "exact",
      bbox: { x: 120, y: 70, width: 760, height: 90, source: "estimated" },
      typography: ["全大写", "居中"]
    }],
    reconstructionPrompt: "9:16 竖版城市人物海报，中央人物占画面约四分之一，暖色逆光，深蓝背景。",
    limitations: ["无法从单张图片确认真实焦距"],
    completeness: {
      checkedRegions: ["四角", "主体", "背景", "文字"],
      omittedVisibleElements: []
    },
    tags: [{ g: "light.direction", t: "逆光" }],
    ...overrides
  };
}

function completeModelResponse(overrides = {}) {
  const value = completeAnalysis();
  value.elements = value.elements.map(({ bbox, ...item }) => ({
    ...item,
    box_2d: [bbox.y, bbox.x, bbox.y + bbox.height, bbox.x + bbox.width]
  }));
  value.ocr = value.ocr.map(({ bbox, ...item }) => ({
    ...item,
    box_2d: [bbox.y, bbox.x, bbox.y + bbox.height, bbox.x + bbox.width]
  }));
  return { ...value, ...overrides };
}

test("VisualAnalysisV2 accepts one complete reconstruction record with all ten dimensions", () => {
  const result = normalizeVisualAnalysisV2(completeAnalysis(), createDefaultFacetCatalog());
  assert.equal(result.description.startsWith("竖版海报"), true);
  assert.deepEqual(result.dimensions.map((item) => item.id), VISUAL_ANALYSIS_DIMENSIONS);
  assert.equal(result.elements[0].bbox.x, 310);
  assert.equal(result.reconstructionPrompt.includes("中央人物"), true);
  assert.equal(result.tags.length, 1);
});

test("VisualAnalysisV2 rejects incomplete dimensions and out-of-frame coordinates", () => {
  assert.throws(() => normalizeVisualAnalysisV2(completeAnalysis({
    dimensions: completeAnalysis().dimensions.slice(0, 9)
  })), /十个视觉维度/);
  assert.throws(() => normalizeVisualAnalysisV2(completeAnalysis({
    elements: [{ ...completeAnalysis().elements[0], bbox: { x: 990, y: 0, width: 20, height: 100, source: "estimated" } }]
  })), /边界框/);
});

test("model box_2d uses yxyx order and converts once into the persisted V2 bbox", () => {
  const result = normalizeVisualModelResponse(completeModelResponse(), createDefaultFacetCatalog());
  assert.deepEqual(result.elements[0].bbox, {
    x: 310, y: 170, width: 380, height: 710, source: "estimated"
  });
  assert.deepEqual(result.ocr[0].bbox, {
    x: 120, y: 70, width: 760, height: 90, source: "estimated"
  });
  assert.ok(VISUAL_MODEL_RESPONSE_SCHEMA.properties.elements.items.properties.box_2d);
  assert.equal(VISUAL_MODEL_RESPONSE_SCHEMA.properties.elements.items.properties.bbox, undefined);
});

test("known root field casing is normalized before strict visual validation", () => {
  const response = completeModelResponse();
  response.OCR = response.ocr;
  delete response.ocr;
  const result = normalizeVisualModelResponse(response, createDefaultFacetCatalog());
  assert.equal(result.ocr[0].text, "PROMPT DIRECTOR");
  assert.equal(Object.hasOwn(result, "OCR"), false);
});

test("root field casing conflicts remain rejected while unknown fields are ignored", () => {
  const conflict = completeModelResponse();
  conflict.OCR = conflict.ocr;
  assert.throws(() => normalizeVisualModelResponse(conflict), /字段大小写冲突：ocr/);

  const unknown = completeModelResponse({ audit: [] });
  assert.equal(normalizeVisualModelResponse(unknown).quality, "complete");
});

test("invalid model boxes produce a visible partial result without clipping or rewriting input", () => {
  const invalid = completeModelResponse();
  invalid.elements[0].box_2d = [150, 250, 140, 900];
  const result = normalizeVisualModelResponse(invalid);
  assert.equal(result.quality, "partial");
  assert.ok(result.missingFields.includes("elements"));
  assert.deepEqual(invalid.elements[0].box_2d, [150, 250, 140, 900]);
});

test("completion merges only missing fields and preserves fields already validated from a paid partial result", () => {
  const previous = normalizeVisualModelResponse({
    description: "已经保存的可靠描述",
    reconstructionPrompt: "已经保存的可靠重建提示词",
    tags: []
  });
  const incoming = normalizeVisualModelResponse(completeModelResponse({
    description: "补全请求中的重复描述",
    reconstructionPrompt: "补全请求中的重复提示词"
  }));
  const merged = mergePartialVisualAnalysis(previous, incoming);
  assert.equal(merged.quality, "complete");
  assert.deepEqual(merged.missingFields, []);
  assert.equal(merged.description, "已经保存的可靠描述");
  assert.equal(merged.reconstructionPrompt, "已经保存的可靠重建提示词");
  assert.deepEqual(merged.canvas, incoming.canvas);
});

test("visual instruction requests quantitative reconstruction in one call and exposes only fixed taxonomy paths", () => {
  const catalog = createDefaultFacetCatalog();
  catalog.nodes.push({
    id: "detail:secret", facetId: "light", parentId: "light.direction", name: "secret-dynamic-tag",
    order: 0, aliases: [], patterns: [], status: "active", kind: "detail", origin: "manual", fixed: false
  });
  const instruction = compileVisualAnalysisInstruction({
    catalog,
    locale: "zh-CN",
    customInstruction: "记录所有可见文字。"
  });
  assert.match(instruction, /0 to 1000/);
  assert.match(instruction, /\[y_min, x_min, y_max, x_max\]/);
  assert.match(instruction, /programMeasuredCanvasPixels/);
  assert.match(instruction, /单次分析/);
  assert.match(instruction, /reconstructionPrompt/);
  assert.match(instruction, /every reconstruction-relevant visible fact/);
  assert.match(instruction, /do not merely summarize the scene/);
  for (const id of VISUAL_ANALYSIS_DIMENSIONS) assert.match(instruction, new RegExp(`\\b${id}\\b`));
  assert.match(instruction, /light\.direction/);
  assert.doesNotMatch(instruction, /secret-dynamic-tag/);
});

test("visual set summary consumes saved V2 text and reports missing assets without accepting a contact sheet", () => {
  const ready = prepareVisualSetSummary([
    { assetId: "image-a", imageFingerprint: "fingerprint-a", analysis: completeAnalysis({ imageFingerprint: "fingerprint-a" }) },
    { assetId: "image-b", imageFingerprint: "fingerprint-b", analysis: completeAnalysis({ imageFingerprint: "fingerprint-b", description: "第二张图展示同一人物的侧面近景。" }) }
  ], "zh-CN");
  assert.equal(ready.ready, true);
  assert.deepEqual(ready.missingAssetIds, []);
  assert.equal(JSON.stringify(ready.input).includes("data:image"), false);
  assert.equal(ready.input.assets.length, 2);

  const missing = prepareVisualSetSummary([
    { assetId: "image-a", imageFingerprint: "fingerprint-a", analysis: completeAnalysis({ imageFingerprint: "fingerprint-a" }) },
    { assetId: "image-b", analysis: null }
  ], "zh-CN");
  assert.equal(missing.ready, false);
  assert.deepEqual(missing.missingAssetIds, ["image-b"]);
  assert.equal(missing.input, null);
});
