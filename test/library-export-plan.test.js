import test from "node:test";
import assert from "node:assert/strict";

import {
  buildFolderBackupCompletion,
  verifyFolderBackupCompletion
} from "../library-export-plan.js";

test("folder completion is written from actual files and rejects later byte changes", async () => {
  const files = new Map([
    ["library.json", new Blob(["{\"entries\":[]}"], { type: "application/json" })],
    ["images/case/image.webp", new Blob(["image-bytes"], { type: "image/webp" })]
  ]);
  const completion = await buildFolderBackupCompletion(files, {
    createdAt: "2026-08-26T00:00:00.000Z",
    caseCount: 1,
    trashCaseCount: 2,
    trashProjectCount: 1,
    mediaCount: 1,
    byteSize: 11
  });

  assert.equal(completion.version, 2);
  assert.equal(completion.fileCount, 2);
  assert.deepEqual(completion.files.map(({ path, byteSize }) => ({ path, byteSize })), [
    { path: "images/case/image.webp", byteSize: 11 },
    { path: "library.json", byteSize: 14 }
  ]);
  await assert.doesNotReject(() => verifyFolderBackupCompletion(completion, files));

  const changed = new Map(files);
  changed.set("images/case/image.webp", new Blob(["changed-bytes"], { type: "image/webp" }));
  await assert.rejects(() => verifyFolderBackupCompletion(completion, changed), /完整性校验失败/);
});
