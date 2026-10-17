import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { collectVideoPagePayload, normalizeVideoPagePayload } from '../extension/video-page-capture.js';
import { normalizePageCaptureBatch } from '../extension/page-capture.js';
import { normalizeEntryMedia } from '../extension/media.js';

const capture = (url, window, elements = {}) => vm.runInNewContext(`(${collectVideoPagePayload.toString()})()`, {
  URL, location: { href: url }, window, document: { querySelector: selector => elements[selector] || null }
});

test('YouTube captures this video and full description without promoting hashtags or linked recommendations to videos', () => {
  const url = 'https://www.youtube.com/watch?v=Wh3zKB3_ZHw';
  const payload = capture(url, { ytInitialPlayerResponse: {
    videoDetails: { videoId: 'Wh3zKB3_ZHw', title: 'Current video', shortDescription: 'Full description\n#LTX25 https://youtu.be/other', author: 'Creator', viewCount: '123', lengthSeconds: '608' },
    microformat: { playerMicroformatRenderer: { likeCount: '8' } }
  } });
  const site = normalizeVideoPagePayload(payload, url);
  const candidate = normalizePageCaptureBatch({ candidates: site.candidates }).candidates[0];
  assert.equal(candidate.media.length, 1);
  assert.equal(candidate.media[0].url, url);
  assert.equal(candidate.sourceFacts.author, 'Creator');
  assert.equal(candidate.sourceFacts.itemId, 'Wh3zKB3_ZHw');
  assert.equal(candidate.sourceFacts.originalPromptAvailable, false, 'the platform description must not become a claimed generation prompt');
  assert.equal(candidate.sourceFacts.model, '');
  assert.equal(candidate.sourceFacts.engagement.views, 123);
  assert.match(candidate.contentText, /Full description\n#LTX25/);
});

test('in-page YouTube navigation uses the current player response instead of previous video metadata', () => {
  const payload = capture('https://www.youtube.com/watch?v=current', { ytInitialPlayerResponse: { videoDetails: { videoId: 'previous', title: 'wrong' } } }, {
    '#movie_player': { getPlayerResponse: () => ({ videoDetails: { videoId: 'current', title: 'right', shortDescription: '' } }) }
  });
  assert.equal(payload.title, 'right');
});

test('Bilibili maps the owning video fields, keeps zero counts, and does not invent missing metrics', () => {
  const url = 'https://www.bilibili.com/video/BV1ntYN6NEAi/';
  const site = normalizeVideoPagePayload(capture(url, { __INITIAL_STATE__: { videoData: {
    bvid: 'BV1ntYN6NEAi', title: 'Title', desc: '', owner: { name: 'Author' }, stat: { view: 3, reply: 0, coin: 2 }, duration: 10
  } } }), url);
  assert.equal(site.candidates[0].sourceFacts.author, 'Author');
  assert.deepEqual(site.candidates[0].sourceFacts.engagement, { views: 3, comments: 0, coins: 2 });
  assert.equal(site.candidates[0].contentText, '');
  assert.equal(site.candidates[0].media.length, 1);
});

test('obsolete capture diagnostics are removed during normalization without changing the source entry or its assets', () => {
  const entry = { id: 'saved', text: 'User content', sourceFacts: { author: 'Creator', captureWarnings: ['internal diagnostic'] } };
  const result = normalizeEntryMedia(entry);
  assert.equal(result.sourceFacts.captureWarnings, undefined);
  assert.equal(result.sourceFacts.author, 'Creator');
  assert.equal(result.text, entry.text);
  assert.deepEqual(entry.sourceFacts.captureWarnings, ['internal diagnostic']);
});


test('Bilibili HTTP and protocol-relative cover URLs use the CDN HTTPS original through candidate normalization', () => {
  const url = 'https://www.bilibili.com/video/BV1ntYN6NEAi/';
  for (const pic of ['http://i1.hdslb.com/bfs/archive/cover.jpg', '//i1.hdslb.com/bfs/archive/cover.jpg']) {
    const site = normalizeVideoPagePayload(capture(url, { __INITIAL_STATE__: { videoData: { bvid: 'BV1ntYN6NEAi', title: 'Title', pic } } }), url);
    const candidate = normalizePageCaptureBatch({ candidates: site.candidates }).candidates[0];
    assert.equal(candidate.media[0].posterUrl, 'https://i1.hdslb.com/bfs/archive/cover.jpg');
    assert.equal(candidate.media.length, 1);
  }
});

test('Bilibili part identity and the matching highest-resolution video/audio survive the shared candidate pipeline', () => {
  const url = 'https://www.bilibili.com/video/BVpart/?p=2';
  const window = { __INITIAL_STATE__: { cid: 22, videoData: { bvid: 'BVpart', title: 'Parts', pages: [{ cid: 11 }, { cid: 22 }] } },
    __playinfo__: { data: { dash: { video: [{ height: 720, baseUrl: 'https://a.bilivideo.com/720' }, { height: 2160, baseUrl: 'https://a.bilivideo.com/4k' }], audio: [{ bandwidth: 192000, base_url: 'https://a.bilivideo.com/audio' }] } } } };
  const site = normalizeVideoPagePayload(capture(url, window), url);
  const candidate = normalizePageCaptureBatch({ candidates: site.candidates }).candidates[0];
  assert.equal(candidate.sourceFacts.itemId, 'BVpart:p2');
  assert.equal(candidate.canonicalUrl, url);
  assert.equal(candidate.media[0].videoStreams.videoUrl, 'https://a.bilivideo.com/4k');
  assert.equal(candidate.media[0].videoStreams.audioUrl, 'https://a.bilivideo.com/audio');
  assert.equal(candidate.media[0].height, 2160, 'page quality must survive normalization so a refreshed download cannot silently downgrade');
  window.__INITIAL_STATE__.cid = 11;
  assert.equal(capture(url, window).videoStreams, undefined, 'a stale previous part must never be downloaded as the selected part');
});


test('Bilibili PCDN primary keeps the selected quality through an official backup instead of rejecting the whole work', () => {
  const url = 'https://www.bilibili.com/video/BV1ctJC6kEGb/';
  const window = { __INITIAL_STATE__: { videoData: { bvid: 'BV1ctJC6kEGb', title: 'Work' } },
    __playinfo__: { data: { dash: { video: [{ height: 1080, baseUrl: 'https://edge.mountaintoys.cn:4483/current.m4s', backupUrl: ['https://a.bilivideo.com/current.m4s'] }], audio: [{ base_url: 'https://mcdn.bilivideo.cn:8082/audio.m4s', backup_url: ['https://a.bilivideo.cn/audio.m4s'] }] } } } };
  assert.equal(capture(url, window).videoStreams.videoUrl, 'https://a.bilivideo.com/current.m4s');
  assert.equal(capture(url, window).videoStreams.audioUrl, 'https://a.bilivideo.cn/audio.m4s');
  window.__playinfo__.data.dash.video[0].backupUrl = [];
  assert.equal(capture(url, window).videoStreams, undefined, 'without an accepted stream, re-resolve the work rather than passing an untrusted URL or reducing quality');
});
