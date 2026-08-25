import test from "node:test";
import assert from "node:assert/strict";

import {
  analysisRevisionMeta,
  entryTextRevision,
  markEntryTextChanged,
  updateEntryText,
  textAnalysisReason
} from "../analysis-revision.js";

test("legacy completed analysis is treated as unchanged without hashing the whole library", () => {
  const entries = Array.from({ length: 6500 }, (_, index) => ({
    id: `legacy-${index}`,
    text: `prompt ${index}`,
    analyzedAt: "2026-08-01T00:00:00.000Z",
    facetAssignments: [{ source: "deepseek_text", nodeId: `node-${index}` }]
  }));
  assert.equal(entries.filter((entry) => textAnalysisReason(entry)).length, 0);
});

test("only a real text edit advances the revision and becomes incremental work", () => {
  const original = {
    id: "entry",
    text: "same",
    textRevision: 4,
    analysisMeta: { textRevision: 4 },
    facetAssignments: [{ source: "deepseek_text", nodeId: "node:1" }]
  };
  assert.equal(textAnalysisReason(markEntryTextChanged(original, "same")), "");
  const changed = markEntryTextChanged(original, "changed");
  assert.equal(entryTextRevision(changed), 5);
  assert.equal(textAnalysisReason(changed), "text_changed");
  assert.deepEqual(analysisRevisionMeta(changed), { textRevision: 5 });
});

test("new text without prior analysis is immediately counted as missing", () => {
  assert.equal(textAnalysisReason({ id: "new", text: "first" }), "missing_analysis");
  assert.equal(textAnalysisReason({
    id: "image-only",
    text: "",
    primaryMediaId: "image-a",
    mediaAssets: [{ id: "image-a", kind: "image" }],
    mediaPrompts: [{ assetId: "image-a", text: "当前图片提示词", updatedAt: "2026-08-21T00:00:00.000Z" }]
  }), "missing_analysis");
  assert.equal(textAnalysisReason({ id: "empty", text: "" }), "");
});

test("prompt edits reject stale revisions and keep media cases valid when text is cleared", () => {
  const entry = { id: "one", text: "old", textRevision: 4, mediaAssets: [{ id: "image", kind: "image" }] };
  assert.throws(() => updateEntryText(entry, "new", 3), /其他页面/);
  const cleared = updateEntryText(entry, "  ", 4);
  assert.equal(cleared.text, "");
  assert.equal(cleared.textRevision, 5);
  assert.throws(() => updateEntryText({ id: "text-only", text: "old", textRevision: 1 }, "", 1), /不能为空/);
});

test("editing shared text keeps its own revision even when the primary image has a newer prompt", () => {
  const entry = {
    id: "mixed",
    text: "共享提示词",
    textRevision: 4,
    primaryMediaId: "image-a",
    mediaAssets: [{ id: "image-a", kind: "image" }],
    mediaPrompts: [{
      assetId: "image-a",
      text: "图片提示词",
      updatedAt: "2026-08-22T10:00:00.000Z"
    }]
  };

  assert.equal(entryTextRevision(entry), 4);
  const updated = updateEntryText(entry, "新的共享提示词", 4);
  assert.equal(updated.textRevision, 5);
});

test("analysis metadata alone does not suppress missing analysis when deepseek tags are absent", () => {
  assert.equal(textAnalysisReason({
    id: "dangling-meta",
    text: "共享提示词",
    textRevision: 2,
    analysisMeta: { textRevision: 2 },
    analyzedAt: "2026-08-21T00:00:00.000Z",
    facetAssignments: []
  }), "missing_analysis");
});
