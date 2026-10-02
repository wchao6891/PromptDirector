import test from "node:test";
import assert from "node:assert/strict";

import {
  captureScreenshotMetadata,
  createEntrySaveUndo,
  createScreenshotSaveUndo,
  normalizeLastSaveUndo,
  assertCreatedEntryUndoSafe,
  restoreScreenshotSaveEntry
} from "../extension/save-history.js";

test("entry save undo targets the exact created entry", () => {
  const entry = { id: "entry:new", title: "刚保存", text: "原词" };
  const undo = createEntrySaveUndo(entry);
  assert.deepEqual(undo, {
    version: 3,
    type: "delete_created_entry",
    entryId: "entry:new",
    entryFingerprint: undo.entryFingerprint
  });
  assert.match(undo.entryFingerprint, /^[a-f0-9]{64}$/);
  assert.doesNotThrow(() => assertCreatedEntryUndoSafe(entry, undo));
  assert.throws(() => assertCreatedEntryUndoSafe({ ...entry, text: "后来编辑" }, undo), /被修改/);
  assert.equal(normalizeLastSaveUndo({ version: 1, type: "delete_created_entry", entryId: entry.id }), null);
  assert.equal(normalizeLastSaveUndo({ type: "delete_created_entry", entryId: "" }), null);
});

test("screenshot save undo restores prior metadata and vision data without reverting unrelated edits", () => {
  const previous = {
    id: "entry:existing",
    text: "原提示词",
    title: "原标题",
    hasScreenshot: true,
    screenshotWidth: 800,
    screenshotHeight: 600,
    screenshotMimeType: "image/png",
    screenshotByteSize: 123,
    screenshotUpdatedAt: "2026-07-20T00:00:00.000Z",
    screenshotReviewStatus: "verified",
    palette: { colors: ["#111111"] },
    visionAnalysis: { description: "旧画面" },
    facetAssignments: [
      { source: "manual", nodeId: "manual" },
      { source: "vision_model", nodeId: "vision-old" }
    ]
  };
  const appliedAt = "2026-07-21T00:00:00.000Z";
  const current = {
    ...previous,
    title: "用户后来改过的标题",
    hasScreenshot: true,
    screenshotWidth: 1600,
    screenshotHeight: 900,
    screenshotByteSize: 999,
    screenshotUpdatedAt: appliedAt,
    palette: { colors: ["#ffffff"] },
    visionAnalysis: { description: "不应保留" },
    facetAssignments: [
      { source: "manual", nodeId: "manual" },
      { source: "manual", nodeId: "manual-later" },
      { source: "vision_model", nodeId: "vision-new" }
    ]
  };

  const undo = createScreenshotSaveUndo(
    previous.id,
    captureScreenshotMetadata(previous),
    appliedAt,
    true,
    undefined,
    captureScreenshotMetadata(current)
  );
  const later = { ...current, title: "用户更新的标题", facetAssignments: [...current.facetAssignments, { source: "manual", nodeId: "another-manual" }] };
  const restored = restoreScreenshotSaveEntry(later, undo);
  assert.equal(restored.title, "用户更新的标题");
  assert.equal(restored.screenshotWidth, 800);
  assert.equal(restored.screenshotUpdatedAt, "2026-07-20T00:00:00.000Z");
  assert.equal(restored.visionAnalysis.description, "旧画面");
  assert.deepEqual(restored.facetAssignments.map((item) => item.nodeId), [
    "manual",
    "manual-later",
    "another-manual",
    "vision-old"
  ]);
});

test("screenshot save undo refuses to overwrite a newer screenshot", () => {
  const undo = createScreenshotSaveUndo(
    "entry:existing",
    captureScreenshotMetadata({ id: "entry:existing", hasScreenshot: false }),
    "2026-07-21T00:00:00.000Z",
    false,
    undefined,
    captureScreenshotMetadata({ id: "entry:existing", screenshotUpdatedAt: "2026-07-21T00:00:00.000Z" })
  );
  assert.throws(
    () => restoreScreenshotSaveEntry({
      id: "entry:existing",
      hasScreenshot: true,
      screenshotUpdatedAt: "2026-07-21T01:00:00.000Z"
    }, undo),
    /截图已经再次变化/
  );
});

test("screenshot save undo rejects backup IDs that could target unrelated images", () => {
  assert.throws(
    () => createScreenshotSaveUndo(
      "entry:existing",
      captureScreenshotMetadata({ id: "entry:existing", hasScreenshot: true }),
      "2026-07-21T00:00:00.000Z",
      true,
      "entry:unrelated"
    ),
    /备份编号无效/
  );
});

test("screenshot undo refuses later vision edits even when the screenshot timestamp is unchanged", () => {
  const applied = { id: "shot", hasScreenshot: true, screenshotUpdatedAt: "saved-at", visionAnalysis: { description: "保存时分析" } };
  const undo = createScreenshotSaveUndo(applied.id, captureScreenshotMetadata({ hasScreenshot: false }), applied.screenshotUpdatedAt, false, undefined, captureScreenshotMetadata(applied));
  assert.throws(() => restoreScreenshotSaveEntry({ ...applied, visionAnalysis: { description: "用户后来修改" } }, undo), /保护新编辑/);
  assert.throws(() => restoreScreenshotSaveEntry({ ...applied, palette: { colors: ["#ffffff"] } }, undo), /保护新编辑/);
  assert.equal(normalizeLastSaveUndo({ ...undo, version: 1, appliedMetadata: undefined }), null);
});
