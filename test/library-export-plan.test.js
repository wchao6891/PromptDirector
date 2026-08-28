import test from "node:test";
import assert from "node:assert/strict";

import {
  buildFolderBackupCompletion,
  buildFolderBackupWritePlan,
  buildFolderRescueCompletion,
  inspectFolderBackupEnvelope,
  verifyFolderBackupCompletion,
  verifyFolderRescueCompletion
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

test("complete backup verification ignores and reports files outside its manifest", async () => {
  const files = new Map([
    ["library.json", new Blob(["{\"entries\":[]}"], { type: "application/json" })]
  ]);
  const completion = await buildFolderBackupCompletion(files);
  const withExtra = new Map(files);
  withExtra.set("readme-from-user.txt", new Blob(["do not import"], { type: "text/plain" }));

  assert.deepEqual(await verifyFolderBackupCompletion(completion, withExtra), {
    extraPaths: ["readme-from-user.txt"]
  });
});

test("rescue backup has a distinct marker and never impersonates a complete backup", async () => {
  const files = new Map([
    ["library.json", new Blob(["{\"entries\":[]}"], { type: "application/json" })]
  ]);
  const rescue = await buildFolderRescueCompletion(files, {
    createdAt: "2026-08-27T00:00:00.000Z",
    issues: [{ code: "media_file_dropped", assetId: "image:broken", reason: "missing_file" }]
  });

  assert.equal(rescue.format, "prompt-director-folder-rescue");
  assert.equal(rescue.version, 1);
  assert.equal(rescue.status, "rescue");
  assert.equal(rescue.issues.length, 1);
  assert.notEqual(rescue.format, "prompt-director-folder-backup");
  await assert.doesNotReject(() => verifyFolderRescueCompletion(rescue, files));
  await assert.rejects(() => verifyFolderBackupCompletion(rescue, files), /完整备份标记无效/);
});

test("folder envelope keeps a valid complete backup complete while reporting extra files", async () => {
  const files = new Map([
    ["library.json", new Blob(["{\"format\":\"prompt-case-library\",\"version\":5,\"entries\":[]}"], { type: "application/json" })]
  ]);
  const completion = await buildFolderBackupCompletion(files);
  files.set("complete.json", new Blob([JSON.stringify(completion)], { type: "application/json" }));
  files.set("unlisted/private-note.txt", new Blob(["ignore me"], { type: "text/plain" }));

  const envelope = await inspectFolderBackupEnvelope(files);

  assert.equal(envelope.mode, "complete");
  assert.equal(envelope.report.status, "partial");
  assert.deepEqual(envelope.report.diagnostics, [{
    code: "extra_file_ignored",
    severity: "file",
    action: "ignored",
    path: "unlisted/private-note.txt",
    reason: "not_in_manifest"
  }]);
});

test("missing or damaged complete markers enter rescue without guessing library JSON", async () => {
  const libraryFile = new Blob(["{\"format\":\"prompt-case-library\",\"version\":5,\"entries\":[]}"], { type: "application/json" });
  const missing = await inspectFolderBackupEnvelope(new Map([["library.json", libraryFile]]));
  assert.equal(missing.mode, "rescue");
  assert.equal(missing.report.diagnostics[0].reason, "missing_complete_marker");

  const files = new Map([["library.json", libraryFile]]);
  const completion = await buildFolderBackupCompletion(files);
  completion.files[0].sha256 = "0".repeat(64);
  files.set("complete.json", new Blob([JSON.stringify(completion)], { type: "application/json" }));
  const damaged = await inspectFolderBackupEnvelope(files);
  assert.equal(damaged.mode, "rescue");
  assert.equal(damaged.report.diagnostics[0].reason, "complete_integrity_failure");
  await assert.rejects(
    () => inspectFolderBackupEnvelope(new Map([["complete.json", files.get("complete.json")]])),
    /缺少 library.json/
  );
});

test("a future folder marker asks for an application update instead of entering rescue", async () => {
  const files = new Map([
    ["library.json", new Blob(["{\"format\":\"prompt-case-library\",\"version\":5,\"entries\":[]}"], { type: "application/json" })],
    ["complete.json", new Blob([JSON.stringify({
      format: "prompt-director-folder-backup",
      version: 99,
      files: []
    })], { type: "application/json" })]
  ]);

  await assert.rejects(() => inspectFolderBackupEnvelope(files), /更新 PromptDirector/);
});

test("write plan chooses exactly one honest marker after preflight", async () => {
  const files = new Map([
    ["library.json", new Blob(["{\"entries\":[]}"], { type: "application/json" })]
  ]);
  const metadata = {
    createdAt: "2026-08-27T00:00:00.000Z",
    caseCount: 0,
    mediaCount: 0,
    byteSize: 0
  };
  const complete = await buildFolderBackupWritePlan({
    files,
    report: { status: "ready", diagnostics: [], stats: {} },
    metadata
  });
  const issue = {
    code: "media_file_dropped",
    severity: "media",
    action: "dropped",
    assetId: "image:missing",
    reason: "missing_file"
  };
  const rescue = await buildFolderBackupWritePlan({
    files,
    report: { status: "partial", diagnostics: [issue], stats: { droppedMediaFiles: 1 } },
    metadata
  });

  assert.equal(complete.mode, "complete");
  assert.equal(complete.markerPath, "complete.json");
  assert.equal(complete.marker.format, "prompt-director-folder-backup");
  assert.equal(rescue.mode, "rescue");
  assert.equal(rescue.markerPath, "rescue.json");
  assert.equal(rescue.marker.format, "prompt-director-folder-rescue");
  assert.deepEqual(rescue.marker.issues, [issue]);
  assert.equal(complete.files.has("rescue.json"), false);
  assert.equal(rescue.files.has("complete.json"), false);
});
