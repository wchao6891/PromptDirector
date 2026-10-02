import test from 'node:test';
import assert from 'node:assert/strict';
import { readPageCaptureSupplement } from '../extension/capture-supplement.js';

const item = { id: 'reply', sourceUrl: 'https://x.com/director/status/124', text: 'preview', partial: true };
function fixture(result, failure) {
  const calls = [];
  const event = { addListener() {}, removeListener() {} };
  const api = {
    permissions: { contains: async () => true },
    tabs: {
      onUpdated: event, onRemoved: event,
      create: async value => { calls.push(['create', value]); return { id: 2 }; },
      get: async () => ({ id: 2, status: 'complete', url: item.sourceUrl }),
      remove: async id => calls.push(['remove', id])
    },
    scripting: { executeScript: async value => { calls.push(['read', value.args]); if (failure) throw failure; return [{ result }]; } }
  };
  return { api, calls };
}

test('selected comment is read in an inactive temporary tab and keeps its identity and full text', async () => {
  const full = 'Full prompt\n'.repeat(2000);
  const { api, calls } = fixture({ supplement: { sourceUrl: item.sourceUrl, text: full, partial: false } });
  const result = await readPageCaptureSupplement(item, api);
  assert.equal(result.id, item.id);
  assert.equal(result.text, full);
  assert.deepEqual(calls[0], ['create', { url: item.sourceUrl, active: false }]);
  assert.deepEqual(calls.at(-1), ['remove', 2]);
  assert.equal(item.text, 'preview');
});

test('a selected reply already available in the source thread keeps its full text and own video without a background tab', async () => {
  const sourceUrl = 'https://x.com/director/status/123';
  const full = 'Selected full prompt. '.repeat(1000);
  const media = [{ id:'video', kind:'video', url:'https://video.twimg.com/own.mp4' }];
  const { api, calls } = fixture({ supplement: { sourceUrl:item.sourceUrl, text:full, media, partial:false } });
  api.tabs.get = async id => ({ id, url:sourceUrl, status:'complete' });
  const result = await readPageCaptureSupplement(item, api, { sourceTabId:1, sourceUrl });
  assert.equal(result.text, full);
  assert.deepEqual(result.media, media);
  assert.deepEqual(calls.map(call=>call[0]), ['read']);
  assert.equal(calls[0][1][0].xSourceUrl, sourceUrl);
  assert.equal(calls[0][1][0].xSupplementInThread, true);
});

test('a failed source-thread read preserves the original draft and propagates the actual failure without silently trying a different page', async () => {
  const sourceUrl = 'https://x.com/director/status/123';
  const { api, calls } = fixture({ captureError: { message:'评论读取已取消；当前草稿已保留', code:'PAGE_CAPTURE_FAILED' } });
  api.tabs.get = async id => ({ id, url:sourceUrl, status:'complete' });
  await assert.rejects(readPageCaptureSupplement(item, api, { sourceTabId:1, sourceUrl }), /已取消/u);
  assert.deepEqual(calls.map(call=>call[0]), ['read']);
  assert.equal(item.text, 'preview');
});

test('unavailable, truncated or substituted replies fail without returning a preview as success', async () => {
  for (const result of [{}, { supplement: { ...item } }, { supplement: { ...item, partial: false, sourceUrl: 'https://x.com/other/status/456' } }]) {
    const { api, calls } = fixture(result);
    await assert.rejects(readPageCaptureSupplement(item, api), /全文/);
    assert.deepEqual(calls.at(-1), ['remove', 2]);
  }
  const { api, calls } = fixture(null, new Error('site unavailable'));
  await assert.rejects(readPageCaptureSupplement(item, api), /site unavailable/);
  assert.deepEqual(calls.at(-1), ['remove', 2]);
});

test('invalid origins and missing site permission cannot open a background page', async () => {
  const { api, calls } = fixture({});
  await assert.rejects(readPageCaptureSupplement({ ...item, sourceUrl: 'https://example.com/status/124' }, api), /有效/);
  api.permissions.contains = async () => false;
  await assert.rejects(readPageCaptureSupplement(item, api), /授权/);
  assert.deepEqual(calls, []);
});

test('media-only selected reply keeps its own pictures and resolves its video without reloading the source page', async t=>{
  t.mock.method(globalThis,'fetch',async()=>new Response(''));
  const media=[{id:'photo',kind:'image',url:'https://pbs.twimg.com/photo.jpg'},
    {id:'video',kind:'video',url:'blob:pending',posterUrl:'https://pbs.twimg.com/poster.jpg'}];
  const {api,calls}=fixture({supplement:{sourceUrl:item.sourceUrl,text:'',partial:false,media}});
  const reader=api.scripting.executeScript;
  api.scripting.unregisterContentScripts=async()=>{};
  api.scripting.registerContentScripts=async scripts=>assert(scripts[0].matches[0].includes('/status/124'));
  api.tabs.reload=async id=>{assert.equal(id,2);calls.push(['reload',id]);};
  api.scripting.executeScript=async options=>options.args?reader(options):[{result:{postId:'124',media:[{posterUrl:media[1].posterUrl,variants:[{url:'https://video.twimg.com/own.mp4',mimeType:'video/mp4'}]}]}}];
  const result=await readPageCaptureSupplement(item,api);
  assert.equal(result.text,'');assert.deepEqual(result.media[0],media[0]);
  assert.equal(result.media[1].url,'https://video.twimg.com/own.mp4');
  assert.equal(result.media[1].id,'video');assert.deepEqual(calls.at(-1),['remove',2]);
});

test('a selected reply with an unresolved video preserves the draft instead of completing with only its text and pictures', async t=>{
  t.mock.method(globalThis,'fetch',async()=>new Response(''));
  const media=[{id:'photo',kind:'image',url:'https://pbs.twimg.com/photo.jpg'},
    {id:'video',kind:'video',url:'blob:pending',posterUrl:'https://pbs.twimg.com/poster.jpg'}];
  const {api,calls}=fixture({supplement:{sourceUrl:item.sourceUrl,text:'Full comment',partial:false,media}});
  const reader=api.scripting.executeScript;
  api.scripting.unregisterContentScripts=async()=>{};
  api.scripting.registerContentScripts=async()=>{};
  api.tabs.reload=async()=>{};
  api.scripting.executeScript=async options=>options.args?reader(options):[{result:{postId:'124',done:true,media:[]}}];
  await assert.rejects(readPageCaptureSupplement(item,api),/视频原件尚未取得.*草稿已保留/u);
  assert.deepEqual(calls.at(-1),['remove',2]);
  assert.equal(item.text,'preview');assert.equal(media[1].url,'blob:pending');
});
