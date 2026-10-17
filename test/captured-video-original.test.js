import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolveCapturedVideoOriginal } from '../extension/captured-video-original.js';
import { videoResource, addDiscoveredVideos } from '../extension/video-discovery.js';
import { normalizePageCaptureBatch } from '../extension/page-capture.js';
const bytes = await readFile(new URL('./fixtures/zhipu-local-video-smoke.mp4', import.meta.url));

test('a network-observed extensionless MP4 reaches actual byte download through candidate normalization', async () => {
  const url = 'https://v26-web.douyinvod.com/video/asset/?mime_type=video_mp4&signature=keep';
  const resource = videoResource({ tabId: 1, url, statusCode: 206, responseHeaders: [{ name: 'content-type', value: 'video/mp4' }] });
  const batch = normalizePageCaptureBatch(addDiscoveredVideos({ candidates: [{ id: 'selected', canonicalUrl: 'https://example.com/work', title: 'Work', media: [] }] }, [resource]));
  const candidate = batch.candidates[0];
  const { downloadPageCaptureVideo } = await import('../extension/page-capture-video.js');
  let calls = 0;
  const blob = await resolveCapturedVideoOriginal(candidate.media[0], candidate, { download: (value, options) => downloadPageCaptureVideo(value, {
    ...options, fetchImpl: async value => { calls++; assert.equal(value, url); return new Response(bytes, { headers: { 'content-type': 'video/mp4' } }); }
  }) });
  assert.equal(calls, 1);
  assert.equal(blob.size, bytes.length);
});

test('a platform player is resolved by the native engine instead of succeeding as a local video', async () => {
  const work = 'https://www.youtube.com/watch?v=current';
  let calls = 0;
  const blob = await resolveCapturedVideoOriginal({ url: work }, { canonicalUrl: work }, {
    download: async () => null,
    downloadNative: async value => { calls++; assert.equal(value, work); return new Blob([bytes]); }
  });
  assert.equal(calls, 1); assert.equal(blob.size, bytes.length);
  await assert.rejects(resolveCapturedVideoOriginal({ url: work }, { canonicalUrl: work }, { download: async () => null }), /完整视频/);
});

test('selected DASH video and audio stay together and cancellation does not start a second download', async () => {
  const streams = { videoUrl: 'https://a.bilivideo.com/video', audioUrl: 'https://a.bilivideo.com/audio' };
  const candidate = normalizePageCaptureBatch({ candidates: [{ id: 'b', title: 'B', canonicalUrl: 'https://www.bilibili.com/video/BVtest/?p=2', media: [{ id: 'v', kind: 'video', url: 'https://www.bilibili.com/video/BVtest/?p=2', videoStreams: streams }] }] }).candidates[0];
  await resolveCapturedVideoOriginal(candidate.media[0], candidate, { download: () => assert.fail('DASH tracks need merging'), downloadNative: async (url, options) => {
    assert.match(url, /p=2/u); assert.deepEqual(options.streams, streams); return new Blob([bytes]);
  } });
  const controller = new AbortController();
  await assert.rejects(resolveCapturedVideoOriginal({ url: 'https://example.com/video.mp4' }, {}, {
    signal: controller.signal, download: async () => { controller.abort(); controller.signal.throwIfAborted(); },
    downloadNative: () => assert.fail('cancel cannot become another request')
  }), { name: 'AbortError' });
});

test('an expired high-resolution file tries its same-quality mirrors, then re-resolves the work instead of silently saving a lower-quality variant', async () => {
  const urls = [];
  const result = await resolveCapturedVideoOriginal({ url: 'https://cdn.douyinvod.com/4k', width: 3840, height: 2160,
    variants: [{ url: 'https://cdn.douyinvod.com/4k-mirror', width: 3840, height: 2160 }, { url: 'https://cdn.douyinvod.com/720', width: 1280, height: 720 }] },
  { canonicalUrl: 'https://www.douyin.com/video/123' }, {
    download: async url => { urls.push(url); throw new Error('HTTP 403'); },
    downloadNative: async url => { urls.push(url); return new Blob([bytes]); }
  });
  assert.equal(result.size, bytes.length);
  assert.deepEqual(urls, ['https://cdn.douyinvod.com/4k', 'https://cdn.douyinvod.com/4k-mirror', 'https://www.douyin.com/video/123']);
});


test('a page-session failure preserves the original HTTP cause so users can distinguish an unavailable source', async () => {
  await assert.rejects(resolveCapturedVideoOriginal({ url: 'https://example.com/video.mp4' }, {}, {
    download: async () => { throw new Error('HTTP 503'); },
    downloadSession: async () => { throw new Error('页面没有返回有效媒体'); }
  }), error => error.message.includes('HTTP 503') && error.message.includes('页面没有返回有效媒体'));
});

test('an unfinished Bilibili capture re-resolves its work when the old PCDN hint is outside the supported CDN domains', async () => {
  const work = 'https://www.bilibili.com/video/BV1ctJC6kEGb/';
  let calls = 0;
  const blob = await resolveCapturedVideoOriginal({ url: work, videoStreams: {
    videoUrl: 'https://edge.mountaintoys.cn:4483/current.m4s', audioUrl: 'https://a.bilivideo.cn/audio.m4s'
  } }, { canonicalUrl: work }, { downloadNative: async (url, options) => {
    calls++;
    assert.equal(url, work);
    assert.equal(options.streams, undefined, 'the old rejected hint must not prevent recovery from the original work');
    return new Blob([bytes]);
  } });
  assert.equal(calls, 1);
  assert.equal(blob.size, bytes.length);
});

test('a Bilibili page CDN denied to the native process is refreshed from the same work, retaining the selected resolution', async () => {
  const work = 'https://www.bilibili.com/video/BVtest/?p=2';
  const streams = { videoUrl: 'https://a.bilivideo.com/current.m4s', audioUrl: 'https://a.bilivideo.com/audio.m4s' };
  const calls = [];
  const blob = await resolveCapturedVideoOriginal({ url: work, width: 1920, height: 1080, videoStreams: streams }, { canonicalUrl: work }, {
    downloadNative: async (url, options) => {
      calls.push({ url, ...options });
      if (options.streams) throw new Error('Error opening input: Server returned 403 Forbidden (access denied)');
      return new Blob([bytes]);
    }
  });
  assert.equal(blob.size, bytes.length);
  assert.equal(calls.length, 2);
  assert.equal(calls[1].url, work);
  assert.equal(calls[1].streams, undefined);
  assert.equal(calls[1].minWidth, 1920);
  assert.equal(calls[1].minHeight, 1080);
});

test('stream cancellation, component setup and disk failures cannot turn into a second native download', async () => {
  for (const error of [new DOMException('cancelled', 'AbortError'), Object.assign(new Error('setup'), { code: 'video_component_required' }), new Error('本机没有足够的视频暂存空间')]) {
    let calls = 0;
    await assert.rejects(resolveCapturedVideoOriginal({ videoStreams: { videoUrl: 'https://a.bilivideo.com/v' } }, { canonicalUrl: 'https://www.bilibili.com/video/BVtest/' }, {
      downloadNative: async () => { calls++; throw error; }
    }));
    assert.equal(calls, 1);
  }
});
