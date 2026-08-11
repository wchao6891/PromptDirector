import { analysisTaxonomyPayload, validateAnalysisTagResponse } from "./tag-taxonomy.js";

export const VISUAL_ANALYSIS_VERSION = 2;
export const VISUAL_SET_SUMMARY_VERSION = 1;
export const VISUAL_MODEL_PROTOCOL_VERSION = "box_2d-yxyx-v1";
export const VISUAL_ANALYSIS_DIMENSIONS = Object.freeze([
  "subject",
  "scene",
  "action",
  "style",
  "camera",
  "light",
  "mood",
  "sound",
  "output",
  "workflow"
]);

const MEASUREMENT_SOURCES = Object.freeze(["measured", "estimated", "not_observable"]);
const ORIENTATIONS = Object.freeze(["landscape", "portrait", "square"]);
const DEPTH_LAYERS = Object.freeze(["foreground", "midground", "background", "overlay"]);
const OCR_LEGIBILITY = Object.freeze(["exact", "partial", "unreadable"]);
const ROOT_FIELDS = new Set([
  "description", "canvas", "elements", "dimensions", "ocr", "reconstructionPrompt",
  "limitations", "completeness", "tags"
]);

const BBOX_SCHEMA = Object.freeze({
  type: "object",
  additionalProperties: false,
  required: ["x", "y", "width", "height", "source"],
  properties: {
    x: { type: "number", minimum: 0, maximum: 1000 },
    y: { type: "number", minimum: 0, maximum: 1000 },
    width: { type: "number", minimum: 0, maximum: 1000 },
    height: { type: "number", minimum: 0, maximum: 1000 },
    source: { type: "string", enum: MEASUREMENT_SOURCES }
  }
});

export const VISUAL_ANALYSIS_SCHEMA = Object.freeze({
  type: "object",
  additionalProperties: false,
  required: [...ROOT_FIELDS],
  properties: {
    description: { type: "string", minLength: 1 },
    canvas: {
      type: "object",
      additionalProperties: false,
      required: ["width", "height", "aspectRatio", "orientation", "dominantColors"],
      properties: {
        width: { type: "integer", minimum: 1 },
        height: { type: "integer", minimum: 1 },
        aspectRatio: { type: "string", minLength: 1 },
        orientation: { type: "string", enum: ORIENTATIONS },
        dominantColors: {
          type: "array",
          maxItems: 12,
          items: {
            type: "object",
            additionalProperties: false,
            required: ["hex", "coveragePercent", "source"],
            properties: {
              hex: { type: "string", pattern: "^#[0-9A-Fa-f]{6}$" },
              coveragePercent: { type: "number", minimum: 0, maximum: 100 },
              source: { type: "string", enum: MEASUREMENT_SOURCES }
            }
          }
        }
      }
    },
    elements: {
      type: "array",
      minItems: 1,
      items: {
        type: "object",
        additionalProperties: false,
        required: [
          "id", "label", "category", "bbox", "coveragePercent", "depthLayer",
          "occludes", "occludedBy", "relationships", "visualAttributes"
        ],
        properties: {
          id: { type: "string", minLength: 1 },
          label: { type: "string", minLength: 1 },
          category: { type: "string", minLength: 1 },
          bbox: BBOX_SCHEMA,
          coveragePercent: { type: "number", minimum: 0, maximum: 100 },
          depthLayer: { type: "string", enum: DEPTH_LAYERS },
          occludes: { type: "array", items: { type: "string" } },
          occludedBy: { type: "array", items: { type: "string" } },
          relationships: { type: "array", items: { type: "string" } },
          visualAttributes: { type: "array", items: { type: "string" } }
        }
      }
    },
    dimensions: {
      type: "array",
      minItems: VISUAL_ANALYSIS_DIMENSIONS.length,
      maxItems: VISUAL_ANALYSIS_DIMENSIONS.length,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["id", "applicable", "facts", "measurements"],
        properties: {
          id: { type: "string", enum: VISUAL_ANALYSIS_DIMENSIONS },
          applicable: { type: "boolean" },
          facts: { type: "array", items: { type: "string" } },
          measurements: { type: "array", items: { type: "string" } }
        }
      }
    },
    ocr: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["text", "legibility", "bbox", "typography"],
        properties: {
          text: { type: "string" },
          legibility: { type: "string", enum: OCR_LEGIBILITY },
          bbox: BBOX_SCHEMA,
          typography: { type: "array", items: { type: "string" } }
        }
      }
    },
    reconstructionPrompt: { type: "string", minLength: 1 },
    limitations: { type: "array", items: { type: "string" } },
    completeness: {
      type: "object",
      additionalProperties: false,
      required: ["checkedRegions", "omittedVisibleElements"],
      properties: {
        checkedRegions: { type: "array", minItems: 1, items: { type: "string" } },
        omittedVisibleElements: { type: "array", items: { type: "string" } }
      }
    },
    tags: {
      type: "array",
      maxItems: 6,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["g", "t"],
        properties: {
          g: { type: "string" },
          t: { type: ["string", "null"] }
        }
      }
    }
  }
});

const MODEL_BOX_SCHEMA = Object.freeze({
  type: "array",
  minItems: 4,
  maxItems: 4,
  items: { type: "integer", minimum: 0, maximum: 1000 }
});

export const VISUAL_MODEL_RESPONSE_SCHEMA = Object.freeze(createVisualModelResponseSchema());

export function visualModelResponseSchema(catalog) {
  const schema = createVisualModelResponseSchema();
  schema.properties.tags.items.properties.g.enum = fixedTagGroupIds(catalog);
  return schema;
}

export function compileVisualAnalysisInstruction({ catalog, customInstruction = "", locale = "zh-CN", measuredCanvas = null } = {}) {
  const language = locale === "en"
    ? "Write all descriptions, facts, labels, limitations, and the reconstruction prompt in English. Preserve exact visible spelling."
    : "所有描述、事实、标签、限制项和重建提示词使用简体中文；画面中的文字保留原始拼写。";
  const measured = measuredCanvas?.width && measuredCanvas?.height
    ? `programMeasuredCanvasPixels=${JSON.stringify({ width: measuredCanvas.width, height: measuredCanvas.height })}; these pixel dimensions describe only the source file and must never be copied into box_2d.`
    : "programMeasuredCanvasPixels=unavailable; estimate the canvas size, but never use estimated pixel dimensions inside box_2d.";
  return [
    "Analyze only the attached image in one single visual-analysis call.",
    locale === "en" ? "Complete the full analysis in this single call; no second visual audit is allowed." : "必须在这一次单次分析中完成全部拆解与自检，不进行第二次视觉复审。",
    language,
    String(customInstruction ?? "").trim().slice(0, 1200),
    measured,
    "Produce a reconstruction-grade inventory of every visible subject, background object, decoration, text block, mark, edge detail, and occlusion. Do not infer off-image facts, authors, brands, or hidden objects.",
    "For every visible element and OCR region, return box_2d exactly as [y_min, x_min, y_max, x_max] using relative integers from 0 to 1000. These are frame-relative edges, never pixel dimensions: 0 <= y_min < y_max <= 1000 and 0 <= x_min < x_max <= 1000. Do not return x/y/width/height.",
    "Record coverage percentage, depth, occlusion, relationships, material, texture, color, lighting, pose, orientation, and typography wherever visible.",
    `Return each of these ten visual dimensions exactly once and in this order: ${VISUAL_ANALYSIS_DIMENSIONS.join(", ")}. Mark a dimension applicable=false with empty facts when it is not visibly applicable; never invent content to fill it.`,
    "Mark quantitative sources as measured, estimated, or not_observable. OCR must distinguish exact, partial, and unreadable text. reconstructionPrompt must be self-contained and usable without the image. It must synthesize every reconstruction-relevant visible fact recorded in canvas, elements, dimensions, and OCR, including aspect ratio, subject count, relative position and scale, depth and occlusion, materials, colors, lighting, focus, typography, and exact legible text; do not merely summarize the scene.",
    "Before returning, inspect all four corners, foreground, subject area, background, overlays, and text. Put any still-visible omission in completeness.omittedVisibleElements; an empty array asserts that the single-call completeness check found none.",
    `fixedPaths=${analysisTaxonomyPayload(catalog, locale)}`,
    "Return exactly one JSON object matching the supplied visual-model response schema. Do not output commentary, markdown, scores, hidden reasoning, or additional fields."
  ].filter(Boolean).join("\n");
}

export function normalizeVisualModelResponse(value, catalogValue) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("视觉模型返回格式不正确，本次没有写入");
  }
  const tagDiagnostics = partitionModelTags(value.tags, catalogValue);
  const converted = {
    ...value,
    elements: (Array.isArray(value.elements) ? value.elements : []).map((item) => convertModelBox(item)),
    ocr: (Array.isArray(value.ocr) ? value.ocr : []).map((item) => convertModelBox(item)),
    tags: tagDiagnostics.accepted
  };
  return {
    ...normalizeVisualAnalysisV2(converted, catalogValue),
    tagDiagnostics: { rejectedCount: tagDiagnostics.rejectedCount }
  };
}

export function normalizeVisualAnalysisV2(value, catalogValue) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("视觉模型返回格式不正确，本次没有写入");
  }
  assertOnlyFields(value, ROOT_FIELDS, "视觉分析");
  const description = requiredText(value.description, "视觉模型没有返回画面描述，本次没有写入");
  const canvas = normalizeCanvas(value.canvas);
  const elements = normalizeElements(value.elements);
  const dimensions = normalizeDimensions(value.dimensions);
  const ocr = normalizeOcr(value.ocr);
  const reconstructionPrompt = requiredText(value.reconstructionPrompt, "视觉模型没有返回可独立使用的重建提示词");
  const completeness = normalizeCompleteness(value.completeness);
  return {
    description,
    canvas,
    elements,
    dimensions,
    ocr,
    reconstructionPrompt,
    limitations: cleanStrings(value.limitations),
    completeness,
    tags: validateAnalysisTagResponse({ tags: value.tags }, catalogValue, { allowEmpty: true, maxTags: 6 })
  };
}

export function prepareVisualSetSummary(values, locale = "zh-CN") {
  const assets = [];
  const missingAssetIds = [];
  for (const item of Array.isArray(values) ? values : []) {
    const assetId = String(item?.assetId ?? "").trim();
    if (!assetId) continue;
    if (!item?.analysis || Number(item.analysis.version ?? VISUAL_ANALYSIS_VERSION) !== VISUAL_ANALYSIS_VERSION) {
      missingAssetIds.push(assetId);
      continue;
    }
    const currentFingerprint = String(item?.imageFingerprint ?? "").trim();
    const analysisFingerprint = String(item?.analysis?.imageFingerprint ?? "").trim();
    if (!currentFingerprint || !analysisFingerprint || currentFingerprint !== analysisFingerprint) {
      missingAssetIds.push(assetId);
      continue;
    }
    try {
      const analysis = normalizeVisualAnalysisV2(visualAnalysisPayload(item.analysis));
      assets.push({
        assetId,
        description: analysis.description,
        canvas: analysis.canvas,
        elements: analysis.elements,
        dimensions: analysis.dimensions,
        ocr: analysis.ocr,
        reconstructionPrompt: analysis.reconstructionPrompt,
        limitations: analysis.limitations
      });
    } catch {
      missingAssetIds.push(assetId);
    }
  }
  return {
    ready: missingAssetIds.length === 0 && assets.length > 0,
    missingAssetIds,
    input: missingAssetIds.length || !assets.length ? null : {
      locale: locale === "en" ? "en" : "zh-CN",
      assets
    }
  };
}

export function compileVisualSetSummaryInstruction(locale = "zh-CN") {
  return locale === "en"
    ? "Summarize the saved per-image VisualAnalysisV2 records as one creative set. Do not request or infer from source images. Return strict JSON with imageRoles, sharedVisualSystem, differences, continuity, compositionRules, and reusablePrompt. Cover every assetId exactly once in imageRoles."
    : "仅汇总已保存的逐图 VisualAnalysisV2 记录，不请求原图，也不把主图或拼图当作缺失图片的替代。严格返回 JSON：imageRoles（每个 assetId 恰好一次）、sharedVisualSystem（共同视觉系统）、differences（差异）、continuity（连续关系）、compositionRules（组合规律）、reusablePrompt（不依赖原图的可复用创作提示词）。";
}

export function normalizeVisualSetSummaryV1(value, assetIds = []) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("整组总结返回格式无效");
  const expected = [...new Set(assetIds.map((id) => String(id ?? "").trim()).filter(Boolean))];
  const imageRoles = (Array.isArray(value.imageRoles) ? value.imageRoles : []).map((item) => ({
    assetId: requiredText(item?.assetId, "整组总结缺少素材编号"),
    role: requiredText(item?.role, "整组总结缺少逐图角色")
  }));
  if (imageRoles.length !== expected.length || expected.some((id) => !imageRoles.some((item) => item.assetId === id))) {
    throw new Error("整组总结没有覆盖全部逐图分析");
  }
  return {
    version: VISUAL_SET_SUMMARY_VERSION,
    imageRoles,
    sharedVisualSystem: cleanStrings(value.sharedVisualSystem),
    differences: cleanStrings(value.differences),
    continuity: cleanStrings(value.continuity),
    compositionRules: cleanStrings(value.compositionRules),
    reusablePrompt: requiredText(value.reusablePrompt, "整组总结缺少可复用创作提示词")
  };
}

function visualAnalysisPayload(value = {}) {
  return Object.fromEntries([...ROOT_FIELDS].map((key) => [key, key === "tags" && !Array.isArray(value[key]) ? [] : value[key]]));
}

function normalizeCanvas(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("视觉分析缺少画布信息");
  const width = positiveInteger(value.width);
  const height = positiveInteger(value.height);
  const aspectRatio = requiredText(value.aspectRatio, "视觉分析缺少画布比例");
  const orientation = ORIENTATIONS.includes(value.orientation) ? value.orientation : "";
  if (!width || !height || !orientation) throw new Error("视觉分析画布信息不完整");
  const dominantColors = (Array.isArray(value.dominantColors) ? value.dominantColors : []).map((item) => {
    const hex = String(item?.hex ?? "").trim().toUpperCase();
    const coveragePercent = boundedNumber(item?.coveragePercent, 0, 100, "主色覆盖率");
    const source = measurementSource(item?.source);
    if (!/^#[0-9A-F]{6}$/.test(hex)) throw new Error("视觉分析主色格式无效");
    return { hex, coveragePercent, source };
  });
  if (dominantColors.length > 12) throw new Error("视觉分析主色数量过多");
  return { width, height, aspectRatio, orientation, dominantColors };
}

function normalizeElements(values) {
  if (!Array.isArray(values) || !values.length) throw new Error("视觉分析没有返回画面元素清单");
  const seen = new Set();
  return values.map((item) => {
    const id = requiredText(item?.id, "画面元素缺少编号");
    if (seen.has(id)) throw new Error("画面元素编号重复");
    seen.add(id);
    return {
      id,
      label: requiredText(item?.label, "画面元素缺少名称"),
      category: requiredText(item?.category, "画面元素缺少类别"),
      bbox: normalizeBbox(item?.bbox),
      coveragePercent: boundedNumber(item?.coveragePercent, 0, 100, "画面元素覆盖率"),
      depthLayer: DEPTH_LAYERS.includes(item?.depthLayer) ? item.depthLayer : invalid("画面元素景深层级无效"),
      occludes: cleanStrings(item?.occludes),
      occludedBy: cleanStrings(item?.occludedBy),
      relationships: cleanStrings(item?.relationships),
      visualAttributes: cleanStrings(item?.visualAttributes)
    };
  });
}

function normalizeDimensions(values) {
  if (!Array.isArray(values) || values.length !== VISUAL_ANALYSIS_DIMENSIONS.length) {
    throw new Error("视觉分析必须完整返回十个视觉维度");
  }
  const byId = new Map(values.map((item) => [String(item?.id ?? "").trim(), item]));
  if (byId.size !== VISUAL_ANALYSIS_DIMENSIONS.length || VISUAL_ANALYSIS_DIMENSIONS.some((id) => !byId.has(id))) {
    throw new Error("视觉分析必须完整返回十个视觉维度");
  }
  return VISUAL_ANALYSIS_DIMENSIONS.map((id) => {
    const item = byId.get(id);
    const applicable = item?.applicable === true;
    const facts = cleanStrings(item?.facts);
    if (!applicable && facts.length) throw new Error(`${id} 标记为不适用时不能编造事实`);
    return { id, applicable, facts, measurements: cleanStrings(item?.measurements) };
  });
}

function normalizeOcr(values) {
  if (!Array.isArray(values)) throw new Error("视觉分析缺少 OCR 清单");
  return values.map((item) => ({
    text: String(item?.text ?? "").trim(),
    legibility: OCR_LEGIBILITY.includes(item?.legibility) ? item.legibility : invalid("OCR 可读性状态无效"),
    bbox: normalizeBbox(item?.bbox),
    typography: cleanStrings(item?.typography)
  }));
}

function normalizeCompleteness(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("视觉分析缺少完整性检查");
  const checkedRegions = cleanStrings(value.checkedRegions);
  if (!checkedRegions.length) throw new Error("视觉分析没有完成画面区域检查");
  return { checkedRegions, omittedVisibleElements: cleanStrings(value.omittedVisibleElements) };
}

function normalizeBbox(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("视觉分析边界框无效");
  const x = boundedNumber(value.x, 0, 1000, "边界框 x");
  const y = boundedNumber(value.y, 0, 1000, "边界框 y");
  const width = boundedNumber(value.width, 0, 1000, "边界框宽度");
  const height = boundedNumber(value.height, 0, 1000, "边界框高度");
  if (x + width > 1000 || y + height > 1000) throw new Error("视觉分析边界框超出画面");
  return { x, y, width, height, source: measurementSource(value.source) };
}

function createVisualModelResponseSchema() {
  const schema = structuredClone(VISUAL_ANALYSIS_SCHEMA);
  for (const collection of ["elements", "ocr"]) {
    const item = schema.properties[collection].items;
    item.required = item.required.map((field) => field === "bbox" ? "box_2d" : field);
    delete item.properties.bbox;
    item.properties.box_2d = MODEL_BOX_SCHEMA;
  }
  return schema;
}

function fixedTagGroupIds(catalog) {
  const payload = JSON.parse(analysisTaxonomyPayload(catalog));
  return payload.f.flatMap((facet) => facet[2].map((group) => group[0]));
}

function partitionModelTags(values, catalog) {
  const source = Array.isArray(values) ? values : [];
  const accepted = [];
  const seen = new Set();
  let rejectedCount = Array.isArray(values) ? 0 : 1;
  for (const value of source) {
    let tag;
    try {
      [tag] = validateAnalysisTagResponse({ tags: [value] }, catalog, { allowEmpty: true, maxTags: 1 });
    } catch {
      rejectedCount += 1;
      continue;
    }
    const key = JSON.stringify(tag);
    if (seen.has(key) || accepted.length >= 6) {
      rejectedCount += 1;
      continue;
    }
    seen.add(key);
    accepted.push(tag);
  }
  return { accepted, rejectedCount };
}

function convertModelBox(item) {
  if (!item || typeof item !== "object" || Array.isArray(item)) return item;
  const box = item.box_2d;
  if (!Array.isArray(box) || box.length !== 4) {
    throw new Error("视觉模型没有完整返回画面位置，本次没有写入");
  }
  const [yMin, xMin, yMax, xMax] = box.map(Number);
  if (![yMin, xMin, yMax, xMax].every((value) => Number.isInteger(value) && value >= 0 && value <= 1000)
      || yMin >= yMax || xMin >= xMax) {
    throw new Error("视觉模型返回的画面位置关系不完整，本次没有写入");
  }
  const { box_2d: _box, ...rest } = item;
  return {
    ...rest,
    bbox: {
      x: xMin,
      y: yMin,
      width: xMax - xMin,
      height: yMax - yMin,
      source: "estimated"
    }
  };
}

function assertOnlyFields(value, allowed, label) {
  const unexpected = Object.keys(value).filter((key) => !allowed.has(key));
  if (unexpected.length) throw new Error(`${label}包含未允许字段：${unexpected.join("、")}`);
}

function measurementSource(value) {
  if (!MEASUREMENT_SOURCES.includes(value)) throw new Error("视觉分析测量来源无效");
  return value;
}

function positiveInteger(value) {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : 0;
}

function boundedNumber(value, minimum, maximum, label) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < minimum || number > maximum) throw new Error(`${label}无效`);
  return number;
}

function requiredText(value, message) {
  const text = String(value ?? "").trim();
  if (!text) throw new Error(message);
  return text;
}

function cleanStrings(values) {
  return [...new Set((Array.isArray(values) ? values : []).map((item) => String(item ?? "").trim()).filter(Boolean))];
}

function invalid(message) {
  throw new Error(message);
}
