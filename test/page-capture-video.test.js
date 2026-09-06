import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { downloadPageCaptureVideo, isPageCaptureVideoFileUrl } from "../page-capture-video.js";

const video = await readFile(new URL('./fixtures/zhipu-local-video-smoke.mp4', import.meta.url));
test('a source declared by the page video element is verified by bytes even without a filename extension', async () => {
  const blob = await downloadPageCaptureVideo('https://cdn.example.com/resource?id=video', {
    declaredVideo:true, fetchImpl:async()=>new Response(video,{headers:{'content-type':'application/octet-stream'}})
  });
  assert.equal(blob.type,'video/mp4');
  assert.equal(blob.size,video.byteLength);
  assert.equal(await downloadPageCaptureVideo('https://cdn.example.com/master.m3u8',{declaredVideo:true,fetchImpl:()=>assert.fail('a playlist is not the original video file')}),null);
  await assert.rejects(downloadPageCaptureVideo('https://cdn.example.com/resource?id=expired', {
    declaredVideo:true,fetchImpl:async()=>new Response('<html>Expired</html>',{headers:{'content-type':'text/html'}})
  }), /有效视频/);
});
test('direct captured video is downloaded and verified as video bytes without credentials', async () => {
  let calls = 0;
  const blob = await downloadPageCaptureVideo('https://cdn.example.com/movie.mp4?signature=test', {fetchImpl: async (url, options) => {
    calls += 1;
    assert.equal(new URL(url).search, '?signature=test');
    assert.equal(options.credentials, 'omit');
    return new Response(video, {headers: {'content-type': 'video/mp4'}});
  }});
  assert.equal(calls, 1);
  assert.equal(blob.type, 'video/mp4');
  assert.equal(blob.size, video.byteLength);
});

test('stream manifests and video webpages remain references instead of fake video files', async () => {
  for (const url of ['https://cdn.example.com/index.m3u8', 'https://example.com/watch/film', 'blob:https://example.com/film', 'javascript:alert(1)']) {
    assert.equal(isPageCaptureVideoFileUrl(url), false);
    assert.equal(await downloadPageCaptureVideo(url, {fetchImpl: () => assert.fail('must not download a webpage as a video')}), null);
  }
});

test('expired media and HTML responses are explicit failures, without automatic retries', async () => {
  let calls = 0;
  await assert.rejects(downloadPageCaptureVideo('https://cdn.example.com/movie.mp4', {fetchImpl: async () => {
    calls += 1;
    return new Response('Expired', {status: 403});
  }}), /403/);
  assert.equal(calls, 1);
  await assert.rejects(downloadPageCaptureVideo('https://cdn.example.com/movie.mp4', {fetchImpl: async () => new Response('<html>Login</html>', {headers: {'content-type': 'video/mp4'}})}), /有效视频/);
});
