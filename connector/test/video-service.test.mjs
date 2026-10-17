import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readdir, writeFile, readFile, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { PassThrough } from 'node:stream';
import { createServer } from 'node:http';
import { createVideoService, canonicalVideoUrl, validateVideoStreams } from '../video-service.mjs';
import { discoverVideoTools } from '../video-tools.mjs';
import { startVideoHost } from '../video-host.mjs';
import { encodeFrame, frameDecoder } from '../framing.mjs';

const exec = promisify(execFile);
const fixture = fileURLToPath(new URL('../../test/fixtures/hls-audio-video/stream.m3u8', import.meta.url));

test('native extraction keeps modal and Bilibili part identity and rejects non-platform or mismatched sources', () => {
  assert.equal(canonicalVideoUrl('https://www.douyin.com/user/a?modal_id=7673852821996834082'), 'https://www.douyin.com/video/7673852821996834082');
  assert.equal(canonicalVideoUrl('https://www.bilibili.com/video/BVtest/?p=3&tracking=1'), 'https://www.bilibili.com/video/BVtest/?p=3');
  for (const url of ['file:///tmp/video', 'https://127.0.0.1/video', 'https://www.youtube.com/playlist?list=all', 'https://www.douyin.com/user/a']) assert.throws(() => canonicalVideoUrl(url));
  assert.throws(() => validateVideoStreams({ videoUrl: 'https://127.0.0.1/video' }, 'https://www.bilibili.com/video/BVtest/'), /不匹配/u);
});

test('real FFmpeg merges separately selected audio/video without transcoding, streams every byte and cleans its own temporary files', async t => {
  const root = await mkdtemp(join(tmpdir(), 'pd-native-video-test-'));
  const tools = await discoverVideoTools({ root });
  if (!tools.ffmpeg || !tools.ffprobe || !tools.ytDlp) {
    await rm(root, { recursive: true, force: true });
    assert.notEqual(process.env.PROMPTDIRECTOR_VIDEO_REQUIRE_TOOLS, '1', 'Installed component tools must be present for installer acceptance');
    return t.skip('Optional native components are not installed in this test environment');
  }
  const video = join(root, 'video.mp4'), audio = join(root, 'audio.m4a');
  await exec(tools.ffmpeg, ['-v', 'error', '-i', fixture, '-an', '-c', 'copy', video]);
  // Reuse the synthetic H.264/AAC fixture; installed tools only need stream copy.
  await exec(tools.ffmpeg, ['-v', 'error', '-i', fixture, '-vn', '-c', 'copy', audio]);
  const assets = { '/video': await readFile(video), '/audio': await readFile(audio) };
  const server = createServer((request, response) => { const bytes = assets[request.url]; response.writeHead(200, { 'content-type': 'video/mp4', 'content-length': bytes.length }); response.end(bytes); });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const progress = [];
  const service = createVideoService({ root, resolveTools: async () => tools, sendProgress: (id, value) => progress.push(value),
    spawnImpl: (command, args, options) => spawn(command, args.map(arg => arg === 'https://a.bilivideo.com/video' ? `${origin}/video` : arg === 'https://a.bilivideo.com/audio' ? `${origin}/audio` : arg), options) });
  try {
    const result = await service.request('download', { url: 'https://www.bilibili.com/video/BVtest/?p=2',
      streams: { videoUrl: 'https://a.bilivideo.com/video', audioUrl: 'https://a.bilivideo.com/audio' }, maxBytes: 32 * 1024 * 1024 });
    assert(result.hasAudio); assert(result.durationMs >= 3000, 'The full three-second fixture must survive the merge');
    assert.equal(result.width, 160); assert.equal(result.height, 90);
    let size = 0;
    for (let index = 0; index < result.chunkCount; index++) size += Buffer.from((await service.request('read', { token: result.token, index })).data, 'base64').length;
    assert.equal(size, result.byteSize);
    assert(progress.some(value => value.phase === 'verify'));
    await service.request('release', { token: result.token });
    await assert.rejects(service.request('read', { token: result.token, index: 0 }), /不存在/u);
  } finally { await service.close(); await new Promise(resolve => server.close(resolve)); await rm(root, { recursive: true, force: true }); }
});

test('video native sessions handshake independently of Agent pairing and expose component readiness only to their extension', async () => {
  const root = await mkdtemp(join(tmpdir(), 'pd-video-host-test-'));
  const extensionId = 'a'.repeat(32);
  await writeFile(join(root, 'component.json'), JSON.stringify({ extensionId }));
  const input = new PassThrough(), output = new PassThrough();
  const events = [];
  output.on('data', frameDecoder(message => events.push(message)));
  const host = await startVideoHost({ directory: root, origin: `chrome-extension://${extensionId}/`, input, output });
  try {
    input.write(encodeFrame({ type: 'video_hello', protocolVersion: 1, extensionId }));
    assert.equal(events[0].type, 'video_ready');
    input.write(encodeFrame({ type: 'video_request', id: 'status', operation: 'status', input: {} }));
    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('status timed out')), 15000);
      const poll = setInterval(() => { if (events.some(event => event.id === 'status')) { clearInterval(poll); clearTimeout(timeout); resolve(); } }, 10);
    });
    assert.equal(typeof events.find(event => event.id === 'status').result.available, 'boolean');
    assert(!(await readdir(root)).some(name => name.endsWith('.sock')), 'video extraction must not create or take over an Agent endpoint');
    await assert.rejects(startVideoHost({ directory: root, origin: `chrome-extension://${'b'.repeat(32)}/`, input: new PassThrough(), output: new PassThrough() }), /identity/u);
  } finally { await host.close(); await rm(root, { recursive: true, force: true }); }
});

test('cancelling an active native download terminates its process and removes only that task temporary directory', async () => {
  let directory, service;
  service = createVideoService({ resolveTools: async () => ({ ytDlp: process.execPath, ffmpeg: process.execPath, ffprobe: process.execPath }),
    spawnImpl: (command, args, options) => {
      assert(args.includes('--abort-on-unavailable-fragments'), 'missing platform fragments must fail instead of silently producing an incomplete original');
      directory = dirname(args[args.indexOf('--output') + 1]);
      const child = spawn(process.execPath, ['-e', 'setTimeout(()=>{},10000)'], options);
      child.once('spawn', () => { void service.request('cancel', { requestId: 'cancel-test' }); });
      return child;
    } });
  try {
    await assert.rejects(service.request('download', { url: 'https://www.youtube.com/watch?v=test', maxBytes: 1024 * 1024 }, 'cancel-test'), { name: 'AbortError' });
    assert(directory);
    await assert.rejects(stat(directory), { code: 'ENOENT' });
  } finally { await service.close(); }
});
