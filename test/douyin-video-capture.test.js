import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { collectDouyinVideoPayload } from '../extension/douyin-video-capture.js';
import { normalizeVideoPagePayload } from '../extension/video-page-capture.js';
import { normalizePageCaptureBatch } from '../extension/page-capture.js';
import { addDiscoveredVideos } from '../extension/video-discovery.js';

const id = '7673852821996834082';
const work = `https://www.douyin.com/video/${id}`;
function collect(url, data, method = 'react') {
  const player = { parentElement: null, __reactProps$test: { children: { props: { data } } } };
  const script = { textContent: encodeURIComponent(JSON.stringify({ detail: data })) };
  return vm.runInNewContext(`(${collectDouyinVideoPayload.toString()})()`, {
    URL, location: { href: url }, window: {}, document: { title: '作品 - 抖音',
      querySelector: selector => selector === `.video_${id}` && method === 'react' ? player : null,
      querySelectorAll: selector => selector === 'video' ? [] : method === 'script' ? [script] : [] }
  });
}
const item = { awemeId: id, desc: '当前作品原文', authorInfo: { nickname: '作者' },
  video: { duration: 268911, width: 3840, height: 2160, play_addr: { url_list: ['https://v26-web.douyinvod.com/original/?signature=abc'], width: 3840, height: 2160 },
    bitRateList: [{ width: 1920, height: 1080, bitRate: 5000000, playAddr: [{ src: 'https://v26-web.douyinvod.com/1080/' }] },
      { width: 3840, height: 2160, isH265: 1, playAddr: [{ src: 'https://v26-web.douyinvod.com/separate/media-video-hvc1/' }] }] } };

test('Douyin profile modal selects exactly its video, preserves full source and never inherits recommendations', () => {
  const url = `https://www.douyin.com/user/author?modal_id=${id}&from_tab_name=main`;
  const payload = collect(url, { recommendation: { ...item, awemeId: '123', desc: '其他作品' }, selected: item });
  const site = normalizeVideoPagePayload(payload, url);
  const batch = normalizePageCaptureBatch({ adapter: 'douyin', candidates: site.candidates });
  assert.equal(batch.candidates.length, 1);
  const candidate = batch.candidates[0];
  assert.equal(candidate.canonicalUrl, work);
  assert.equal(candidate.sourceFacts.itemId, id);
  assert.equal(candidate.sourceFacts.author, '作者');
  assert.equal(candidate.contentText, '当前作品原文');
  assert.equal(candidate.media.length, 1);
  assert.equal(candidate.media[0].originalWorkUrl, work);
  assert.equal(candidate.media[0].url, item.video.play_addr.url_list[0]);
  assert.equal(candidate.media[0].width, 3840);
  assert.equal(candidate.media[0].sourceKind, 'site-original');
  assert.equal(addDiscoveredVideos(batch, [{ key: 'unrelated', url: 'https://v26-web.douyinvod.com/recommendation.mp4' }]).candidates[0].media.length, 1);
});

test('Douyin encoded server-rendered raw API data is read without rounding its long work ID', () => {
  const raw = { aweme_id: id, desc: '原文', video: { duration: 10000, play_addr: { url_list: ['https://cdn.douyinvod.com/asset'], width: 1080, height: 1920 } } };
  const payload = collect(work, raw, 'script');
  assert.equal(payload.itemId, id);
  assert.equal(payload.formats[0].urls[0], 'https://cdn.douyinvod.com/asset');
});

test('missing target media retains an unresolved target instead of collecting the author page', () => {
  const payload = collect(`https://www.douyin.com/user/author?modal_id=${id}`, { ...item, awemeId: 'other' });
  assert.equal(payload.formats.length, 0);
  assert.equal(normalizeVideoPagePayload(payload, work).candidates[0].media[0].url, work);
  assert.equal(collect('https://www.douyin.com/user/author', item), null);
});

test('master dimensions must not make a 1080p default URL outrank an explicitly available 4K format', () => {
  const payload = collect(work, { ...item, video: { width: 3840, height: 2160, playAddr: [{ src: 'https://cdn.douyinvod.com/default-1080' }],
    bitRateList: [{ width: 3840, height: 2160, isH265: 1, playAddr: [{ src: 'https://cdn.douyinvod.com/actual-4k' }] }] } });
  assert.equal(payload.formats[0].urls[0], 'https://cdn.douyinvod.com/actual-4k');
});
