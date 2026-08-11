import test from "node:test";
import assert from "node:assert/strict";

import {
  captureScreenshotMetadata,
  createEntrySaveUndo,
  createScreenshotSaveUndo,
  normalizeLastSaveUndo,
  restoreScreenshotSaveEntry
} from "../save-history.js";

test("entry save undo targets the exact created entry", () => {
  assert.deepEqual(createEntrySaveUndo("entry:new"), {
    version: 1,
    type: "delete_created_entry",
    entryId: "entry:new"
  });
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
  const undo = createScreenshotSaveUndo(
    previous.id,
    captureScreenshotMetadata(previous),
    appliedAt,
    true
  );
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

  const restored = restoreScreenshotSaveEntry(current, undo);
  assert.equal(restored.title, "用户后来改过的标题");
  assert.equal(restored.screenshotWidth, 800);
  assert.equal(restored.screenshotUpdatedAt, "2026-07-20T00:00:00.000Z");
  assert.equal(restored.visionAnalysis.description, "旧画面");
  assert.deepEqual(restored.facetAssignments.map((item) => item.nodeId), [
    "manual",
    "manual-later",
    "vision-old"
  ]);
});

test("screenshot save undo refuses to overwrite a newer screenshot", () => {
  const undo = createScreenshotSaveUndo(
    "entry:existing",
    captureScreenshotMetadata({ id: "entry:existing", hasScreenshot: false }),
    "2026-07-21T00:00:00.000Z",
    false
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
