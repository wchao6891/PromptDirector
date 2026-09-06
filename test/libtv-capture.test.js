import test from 'node:test';
import assert from 'node:assert/strict';
import { collectLibTvPublicPayload, normalizeLibTvPublicPayload } from '../libtv-capture.js';
import { normalizePageCaptureBatch } from '../page-capture.js';

test('LibTV public video is a video case, never a description disguised as its prompt', () => {
  const payload = normalizeLibTvPublicPayload({ canonicalUrl: 'https://www.liblib.tv/', items: [
    { id: 'public-one', title: '公开作品', kind: 'video', description: '作品介绍', author: '作者', url: 'https://libtv-res.liblib.art/upload/video.mp4', posterUrl: 'https://libtv-res.liblib.art/upload/cover.png', likes: 2 },
    { id: 'public-two', title: '另一个作品', kind: 'video', url: 'https://libtv-res.liblib.art/upload/video2.mp4' }
  ] });
  const candidates = normalizePageCaptureBatch({ ...payload, sourceUrl: payload.canonicalUrl }).candidates;
  assert.equal(candidates.length, 2);
  assert.equal(candidates[0].contentText, '');
  assert.equal(candidates[0].sourceFacts.description, '作品介绍');
  assert.equal(candidates[0].sourceFacts.originalPromptAvailable, false);
  assert.equal(candidates[0].media[0].sourceKind, 'site-original');
  assert.equal(candidates[0].media[0].kind, 'video');
  assert.notEqual(candidates[0].sourceFacts.itemId, candidates[1].sourceFacts.itemId);
});

test('public workflow snapshots resolve original bytes and keep genuine node prompts', () => {
  const payload = normalizeLibTvPublicPayload({ canonicalUrl: 'https://www.liblib.tv/', items: [
    { id: 'template:video-node', kind: 'video', prompt: '真实节点提示词', url: 'https://libtv-res.liblib.art/video.mp4?x-oss-process=video/snapshot,t_0,f_jpg,w_400' },
    { id: 'template:image-node', kind: 'image', url: 'https://libtv-res.liblib.art/image.png?x-oss-process=image/resize,w_400/format,webp' },
    { id: 'untrusted', kind: 'video', url: 'https://malicious.example/video.mp4' }
  ] });
  assert.equal(payload.candidates.length, 2);
  assert.equal(payload.candidates[0].media[0].url, 'https://libtv-res.liblib.art/video.mp4');
  assert.equal(payload.candidates[1].media[0].url, 'https://libtv-res.liblib.art/image.png');
  assert.equal(payload.candidates[0].contentText, '真实节点提示词');
  assert.equal(payload.candidates[0].sourceFacts.originalPromptAvailable, true);
});

test('public hydration parsing is self-contained and does not evaluate script content', () => {
  const previous = { location: globalThis.location, document: globalThis.document };
  const record = { templateUuid: 'template', projectUuid: 'project', name: '公开作品', finalOutput: 'https://libtv-res.liblib.art/one.mp4', nickname: '作者' };
  globalThis.location = { hostname: 'www.liblib.tv', href: 'https://www.liblib.tv/' };
  globalThis.document = { querySelectorAll(selector) {
    if (selector === 'script:not([src])') return [{ textContent: `self.__next_f.push(${JSON.stringify([1, '70:' + JSON.stringify({ items: [record] })])})` }];
    if (selector === 'main img[alt]') return [{ alt: '公开作品' }];
    return [];
  } };
  try {
    const result = collectLibTvPublicPayload({ maxCandidates: 100, maxTextCharacters: 100000 });
    assert.equal(result.items[0].url, record.finalOutput);
    assert.equal(result.items[0].prompt, '');
  } finally { Object.assign(globalThis, previous); }
});
