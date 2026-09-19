import test from 'node:test';
import assert from 'node:assert/strict';
import { installPageCaptureSiteObserver, collectPageCaptureSitePayload, normalizePageCaptureSitePayload } from '../extension/page-capture-site-adapters.js';
import { pageCaptureDefaultMediaIds } from '../extension/page-capture.js';

// Reduced synthetic public get_explore response: field names checked against the live site.
const workId = '7490123456789012345';
const videoUrl = 'https://v6-artist.vlabvod.com/current-original/video/';
const rawVideo = () => ({
  common_attr: { id: workId, title: '当前竖版短片', description: '剧情第一段\n剧情第二段', cover_url: 'https://p3-heycan-hgt-sign.byteimg.com/cover.webp' },
  author: { name: '当前作者' },
  video: { duration: 12, origin_video: { video_url: videoUrl, width: 1080, height: 1920, encryption_key: 'excluded' } },
  permission: { token: 'excluded' }
});
function inPage(run) {
  const names = ['location', 'document', 'fetch', 'XMLHttpRequest', 'setInterval', '__get_explore_result', '__PROMPTDIRECTOR_JIMENG_CAPTURE__'];
  const saved = Object.fromEntries(names.map(key => [key, globalThis[key]]));
  globalThis.location = { hostname: 'jimeng.jianying.com', pathname: '/ai-tool/explore', href: 'https://jimeng.jianying.com/ai-tool/explore' };
  globalThis.document = { scripts: [], querySelector: () => null, querySelectorAll: () => [] };
  globalThis.fetch = undefined;
  globalThis.XMLHttpRequest = undefined;
  globalThis.setInterval = undefined;
  globalThis.__get_explore_result = { data: { item_list: [rawVideo()] } };
  delete globalThis.__PROMPTDIRECTOR_JIMENG_CAPTURE__;
  try { run(); } finally {
    delete globalThis.__PROMPTDIRECTOR_JIMENG_CAPTURE__;
    Object.assign(globalThis, saved);
  }
}
function read() {
  const payload = (0, eval)(`(${collectPageCaptureSitePayload.toString()})`)({ maxCandidates: 100, maxMedia: 24, maxTextCharacters: 100000 });
  return normalizePageCaptureSitePayload(payload, globalThis.location.href);
}
function assertOriginal(candidate) {
  assert.equal(candidate.media.length, 1, 'a video response must retain its original, not save a text-only case');
  assert.equal(candidate.media[0].kind, 'video');
  assert.equal(candidate.media[0].url, videoUrl);
  assert.equal(candidate.media[0].width, 1080);
  assert.equal(candidate.media[0].height, 1920);
  assert.equal(candidate.media[0].originalPrompt, '');
  assert.equal(candidate.contentText, '剧情第一段\n剧情第二段');
  assert.equal(candidate.sourceFacts.itemId, workId);
}
test('initial public video response keeps the original video and paragraph boundaries', () => inPage(() => {
  assertOriginal(read().candidates[0]);
}));
test('observed video response keeps the same original after initial page data is gone', () => inPage(() => {
  (0, eval)(`(${installPageCaptureSiteObserver.toString()})`)({ maxCandidates: 100, maxMedia: 24 });
  delete globalThis.__get_explore_result;
  const retained = globalThis.__PROMPTDIRECTOR_JIMENG_CAPTURE__.items;
  assert.equal(JSON.stringify(retained).includes('excluded'), false);
  assertOriginal(read().candidates[0]);
}));
test('explicit current work never normalizes an unrelated background candidate', () => {
  const result = normalizePageCaptureSitePayload({ adapter: 'jimeng', pageKind: 'detail', workId: '7490123456789012346', items: [rawVideo()] });
  assert.deepEqual(result.candidates, []);
  assert.equal(result.completeness, 'partial');
});
test('the current work video is selected in ordinary review instead of silently saving only text', () => {
  const candidate = normalizePageCaptureSitePayload({ adapter: 'jimeng', pageKind: 'detail', workId, items: [rawVideo()] });
  assert.deepEqual(pageCaptureDefaultMediaIds(candidate), candidate.media.map(media => media.id));
  assert.equal(candidate.media.length, 1);
});

const videoPrompt = '第一段<角色1>\n第二段完整分镜';
test('video unified-edit prompt survives public response observer without collecting input material secrets', () => inPage(() => {
  const item = globalThis.__get_explore_result.data.item_list[0];
  item.aigc_image_params = { text2video_params: { video_gen_inputs: [{ prompt: '', unified_edit_input: {
    meta_list: [{ meta_type: 'text', text: videoPrompt }], material_list: [{ private: 'excluded' }]
  }}] } };
  (0, eval)(`(${installPageCaptureSiteObserver.toString()})`)({ maxCandidates: 100, maxMedia: 24 });
  delete globalThis.__get_explore_result;
  const candidate = read().candidates[0];
  assert.equal(candidate.media[0].originalPrompt, videoPrompt);
  assert.equal(candidate.contentText, videoPrompt);
  assert.equal(JSON.stringify(globalThis.__PROMPTDIRECTOR_JIMENG_CAPTURE__).includes('excluded'), false);
}));
test('SSR AiVideo work reads text2video unified edit prompt and keeps its video pairing', () => inPage(() => {
  globalThis.location.pathname = '/ai-tool/work-detail/' + workId;
  delete globalThis.__get_explore_result;
  const item = { commonAttr: {id:workId}, author:{name:'视频作者'},
    aigcImageParams: {text2videoParams:{videoGenInputs:[{prompt:'', unifiedEditInput:{metaList:[{metaType:'text', text:videoPrompt}]}}]}},
    video: {originVideo:{videoUrl,width:1080,height:1920},duration:12} };
  globalThis.document.scripts = [{textContent:'window._ROUTER_DATA = '+JSON.stringify({loaderData:{'ai-tool/work-detail/page':{workDetail:{ok:true,value:item}}}})}];
  assert.equal(read().candidates[0].media[0].originalPrompt, videoPrompt);
}));
