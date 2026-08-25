import test from "node:test";
import assert from "node:assert/strict";

import { canonicalTextAnalysisInput, hasCommittedTextAnalysisTags } from "../analysis-input.js";

test("canonical text analysis input prefers the primary image prompt over shared text", () => {
  const entry = {
    id: "entry",
    text: "共享提示词",
    textRevision: 3,
    primaryMediaId: "image-b",
    mediaAssets: [
      { id: "image-a", kind: "image" },
      { id: "image-b", kind: "image" }
    ],
    mediaPrompts: [
      { assetId: "image-a", text: "其他图提示词", textRevision: 2, updatedAt: "2026-08-20T10:00:00.000Z" },
      { assetId: "image-b", text: "当前图片提示词", textRevision: 1, updatedAt: "2026-08-21T09:30:00.000Z" }
    ]
  };

  assert.deepEqual(canonicalTextAnalysisInput(entry), {
    text: "当前图片提示词",
    textRevision: Date.parse("2026-08-21T09:30:00.000Z"),
    source: "media_prompt",
    assetId: "image-b"
  });
});

test("canonical text analysis input falls back to shared text when no primary image prompt is present", () => {
  assert.deepEqual(canonicalTextAnalysisInput({
    id: "entry",
    text: "共享提示词",
    textRevision: 5,
    mediaAssets: [{ id: "image-a", kind: "image" }],
    mediaPrompts: [{ assetId: "image-a", text: "   " }]
  }), {
    text: "共享提示词",
    textRevision: 5,
    source: "entry_text",
    assetId: "image-a"
  });
});

test("canonical text analysis input can target the image currently shown in detail", () => {
  const entry = {
    id: "entry",
    text: "共享提示词",
    textRevision: 5,
    primaryMediaId: "image-a",
    mediaAssets: [
      { id: "image-a", kind: "image" },
      { id: "image-b", kind: "image" }
    ],
    mediaPrompts: [
      { assetId: "image-a", text: "主图提示词", updatedAt: "2026-08-20T10:00:00.000Z" },
      { assetId: "image-b", text: "当前查看图片提示词", updatedAt: "2026-08-22T10:00:00.000Z" }
    ]
  };

  assert.deepEqual(canonicalTextAnalysisInput(entry, "image-b"), {
    text: "当前查看图片提示词",
    textRevision: Date.parse("2026-08-22T10:00:00.000Z"),
    source: "media_prompt",
    assetId: "image-b"
  });
});

test("only committed deepseek_text facet assignments count as completed text analysis", () => {
  assert.equal(hasCommittedTextAnalysisTags({
    analysisMeta: { textRevision: 1 },
    analyzedAt: "2026-08-20T00:00:00.000Z",
    facetAssignments: []
  }), false);
  assert.equal(hasCommittedTextAnalysisTags({
    facetAssignments: [{ source: "deepseek_text", nodeId: "node:1" }]
  }), true);
});
