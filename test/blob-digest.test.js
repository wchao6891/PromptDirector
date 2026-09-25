import test from 'node:test';
import assert from 'node:assert/strict';
import { createBlobDigestCache, sha256Blob } from '../extension/blob-digest.js';
import { buildFolderBackupWritePlan, verifyFolderBackupCompletion } from '../extension/library-export-plan.js';

function countedBlob(text) {
  const blob = new Blob([text]);
  const stream = blob.stream.bind(blob);
  let reads = 0;
  blob.stream = () => { reads++; return stream(); };
  return { blob, reads: () => reads };
}

test('backup preflight and manifest reuse actual bytes, not asset ids or claimed hashes', async () => {
  const original = countedBlob('original');
  const digest = createBlobDigestCache();
  await Promise.all([digest(original.blob), digest(original.blob)]);
  const files = new Map([['library.json', new Blob(['{}'])], ['videos/source.mp4', original.blob]]);
  const plan = await buildFolderBackupWritePlan({ files, digest });
  assert.equal(original.reads(), 1);
  // Even with the same name and size, disk readback is an independent snapshot.
  const damaged = countedBlob('damaged!');
  files.set('videos/source.mp4', damaged.blob);
  await assert.rejects(verifyFolderBackupCompletion(plan.marker, files, { digest }), /完整性校验失败/);
  assert.equal(damaged.reads(), 1);
  const readback = countedBlob('original');
  files.set('videos/source.mp4', readback.blob);
  await verifyFolderBackupCompletion(plan.marker, files, { digest });
  assert.equal(readback.reads(), 1);
});

test('failed reads can retry and caches never survive an operation', async () => {
  const original = countedBlob('retry');
  const stream = original.blob.stream;
  original.blob.stream = () => { throw new Error('unavailable'); };
  const digest = createBlobDigestCache();
  await assert.rejects(digest(original.blob), /unavailable/);
  original.blob.stream = stream;
  assert.equal(await digest(original.blob), await sha256Blob(new Blob(['retry'])));
  await createBlobDigestCache()(original.blob);
  assert.equal(original.reads(), 2);
});

test('long media report actual streamed bytes through completion', async () => {
  const blob = new Blob([new Uint8Array(1024 * 1024)]);
  const progress = [];
  await sha256Blob(blob, { onProgress: value => progress.push(value) });
  assert.ok(progress.length);
  assert.equal(progress.at(-1).completedBytes, blob.size);
  assert.ok(progress.every((p, i) => p.totalBytes === blob.size && (!i || p.completedBytes >= progress[i - 1].completedBytes)));
});
