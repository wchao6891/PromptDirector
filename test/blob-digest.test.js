import test from 'node:test';
import assert from 'node:assert/strict';
import { createBlobDigestCache, nativeDigestMaxBytes, sha256Blob } from '../extension/blob-digest.js';
import { buildFolderBackupWritePlan, verifyFolderBackupCompletion } from '../extension/library-export-plan.js';

function countedBlob(text) {
  const blob = new Blob([text]);
  const stream = blob.stream.bind(blob);
  const arrayBuffer = blob.arrayBuffer.bind(blob);
  let reads = 0;
  blob.stream = () => { reads++; return stream(); };
  blob.arrayBuffer = () => { reads++; return arrayBuffer(); };
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
  const arrayBuffer = original.blob.arrayBuffer;
  original.blob.arrayBuffer = () => { throw new Error('unavailable'); };
  const digest = createBlobDigestCache();
  await assert.rejects(digest(original.blob), /unavailable/);
  original.blob.arrayBuffer = arrayBuffer;
  assert.equal(await digest(original.blob), await sha256Blob(new Blob(['retry'])));
  await createBlobDigestCache()(original.blob);
  assert.equal(original.reads(), 2);
});

test('small files use the native digest and large files stream, with identical hashes either way', async () => {
  const bytes = new Uint8Array(256 * 1024).map((_, index) => index * 31);
  const budget = { workingBytes: bytes.length * 8 };
  assert.equal(nativeDigestMaxBytes(budget), bytes.length);
  const native = countedBlob(bytes), streamed = countedBlob(new Uint8Array([...bytes, 7]));
  let nativeStreams = 0;
  native.blob.stream = () => { nativeStreams++; throw new Error('must not stream a file within the native budget'); };
  streamed.blob.arrayBuffer = () => { throw new Error('must not buffer a file beyond the native budget'); };
  const nativeHash = await sha256Blob(native.blob, { budget });
  const streamedHash = await sha256Blob(streamed.blob, { budget });
  assert.equal(nativeStreams, 0);
  assert.equal(nativeHash, await sha256Blob(new Blob([bytes]), { budget: { workingBytes: 1 } }), 'native and streamed digests agree');
  assert.equal(streamedHash, await sha256Blob(new Blob([new Uint8Array([...bytes, 7])])));
});

test('long media report actual streamed bytes through completion', async () => {
  const blob = new Blob([new Uint8Array(1024 * 1024)]);
  const progress = [];
  await sha256Blob(blob, { onProgress: value => progress.push(value), budget: { workingBytes: 1 } });
  assert.ok(progress.length);
  assert.equal(progress.at(-1).completedBytes, blob.size);
  assert.ok(progress.every((p, i) => p.totalBytes === blob.size && (!i || p.completedBytes >= progress[i - 1].completedBytes)));
});
