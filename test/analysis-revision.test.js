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
    analysisMeta: { textRevision: 4 }
  };
  assert.equal(textAnalysisReason(markEntryTextChanged(original, "same")), "");
  const changed = markEntryTextChanged(original, "changed");
  assert.equal(entryTextRevision(changed), 5);
  assert.equal(textAnalysisReason(changed), "text_changed");
  assert.deepEqual(analysisRevisionMeta(changed), { textRevision: 5 });
});

test("new text without prior analysis is immediately counted as missing", () => {
  assert.equal(textAnalysisReason({ id: "new", text: "first" }), "missing_analysis");
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
