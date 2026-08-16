import assert from "node:assert/strict";
import test from "node:test";
import {
  CURATED_SUBMISSION_MAX_FILE_BYTES,
  CURATED_SUBMISSION_PART_PAYLOAD_BYTES,
  prepareCuratedSubmissionState,
  sanitizeCuratedSubmissionEntry,
  submissionManifest,
  submissionPartManifest
} from "../curated-submission.js";

test("精选投稿只保留公开案例字段和必要媒体", () => {
  const prepared = prepareCuratedSubmissionState(fixtureState(), { entryIds: ["case-1"] });
  assert.equal(prepared.entries.length, 1);
  const entry = prepared.entries[0];
  assert.equal(entry.text, "公开提示词");
  assert.deepEqual(entry.metadataLabels, ["作者：小明", "权利：本人原创"]);
  assert.equal(entry.mediaAssets.length, 1);
  assert.equal(entry.mediaAssets[0].storageMode, "managed");
  const serialized = JSON.stringify(prepared.state);
  for (const secret of ["私人笔记", "sk-secret", "创作会话", "模型配置", "本地标签"]) {
    assert.equal(serialized.includes(secret), false, `投稿包不应包含：${secret}`);
  }
});

test("投稿拒绝外链媒体、空提示词和缺少封面的视频", () => {
  const image = fixtureState().entries[0];
  assert.throws(() => sanitizeCuratedSubmissionEntry({
    ...image,
    primaryMediaId: "video-1",
    mediaAssets: [{
      id: "video-1",
      kind: "video",
      usage: "content",
      storageMode: "reference",
      mimeType: "video/mp4",
      posterAssetId: "poster-1",
      reference: { url: "https://example.com/video.mp4" }
    }, {
      ...image.mediaAssets[0],
      id: "poster-1",
      usage: "poster",
      derivedFromAssetId: "video-1"
    }]
  }), /保存到本地/);
  assert.throws(() => sanitizeCuratedSubmissionEntry({ ...image, text: "" }), /缺少可公开/);
  assert.throws(() => sanitizeCuratedSubmissionEntry({
    ...image,
    mediaAssets: [{
      ...image.mediaAssets[0],
      id: "video-1",
      kind: "video",
      mimeType: "video/mp4",
      posterAssetId: "poster-1"
    }],
    primaryMediaId: "video-1"
  }), /唯一封面/);
});

test("投稿清单和分卷清单使用完整 SHA-256 身份", () => {
  const hash = "a".repeat(64);
  assert.equal(CURATED_SUBMISSION_MAX_FILE_BYTES, 24 * 1024 * 1024);
  assert.ok(CURATED_SUBMISSION_PART_PAYLOAD_BYTES < CURATED_SUBMISSION_MAX_FILE_BYTES);
  assert.equal(submissionManifest({
    submissionId: hash,
    payloadBytes: 100,
    caseCount: 1,
    mediaCount: 1
  }).submissionId, hash);
  assert.equal(submissionPartManifest({
    submissionId: hash,
    archiveSha256: hash,
    archiveBytes: 200,
    partIndex: 1,
    partCount: 2,
    payloadSha256: hash,
    payloadBytes: 100
  }).partCount, 2);
  assert.throws(() => submissionManifest({
    submissionId: "short",
    payloadBytes: 100,
    caseCount: 1,
    mediaCount: 1
  }), /摘要无效/);
});

function fixtureState() {
  return {
    entries: [{
      id: "case-1",
      title: "竖图案例",
      text: "公开提示词",
      note: "私人笔记",
      url: "https://example.com/source",
      savedAt: "2026-08-15T00:00:00.000Z",
      classification: { pathIds: ["content:prompt:image"], status: "confirmed" },
      facetAssignments: [{ facetId: "private", nodeId: "本地标签" }],
      customLabels: ["本地标签"],
      metadataLabels: ["作者：小明", "权利：本人原创", "秘密：sk-secret"],
      primaryMediaId: "media-1",
      mediaAssets: [{
        id: "media-1",
        kind: "image",
        usage: "content",
        storageMode: "managed",
        mimeType: "image/webp",
        width: 900,
        height: 1600,
        sourceUrl: "https://example.com/image.webp",
        visionAnalysis: { description: "模型配置" }
      }]
    }],
    taxonomy: {
      version: 2,
      nodes: [{ id: "content:prompt:image", name: "图片", kind: "leaf" }]
    },
    facetCatalog: {
      version: 2,
      facets: [{ id: "private", name: "私人" }],
      nodes: [{ id: "本地标签", facetId: "private", name: "本地标签" }]
    },
    composerSettings: { apiKey: "sk-secret" },
    composerSessions: [{ id: "session-1", title: "创作会话" }],
    creativeRuns: [{ id: "run-1", model: "模型配置" }],
    organizerState: { version: 4, collections: [] }
  };
}
