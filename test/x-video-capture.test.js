import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import { xVideoSourcesFromHtml } from '../extension/x-post-metadata.js';
import { PAGE_CAPTURE_LIMITS } from '../extension/resource-limits.js';
import { installXVideoObserver, applyXVideoSources, resolveXVideoSources } from '../extension/x-video-capture.js';

const variant = (name, bitrate = 1) => ({url:`https://video.twimg.com/${name}.mp4`,content_type:'video/mp4',bitrate});
const post = (id, name) => ({rest_id:id,legacy:{extended_entities:{media:[{id_str:`media-${id}`,media_url_https:`https://pbs.twimg.com/${name}.jpg`,video_info:{variants:[variant(name),variant(`${name}-hd`,10)]}}]}}});

test('public server-rendered video sources resolve before reload, preserving selected reply ownership', async()=>{
  const actions=[];
  const api={scripting:{unregisterContentScripts:async()=>{},registerContentScripts:async()=>{},executeScript:async()=>[{result:{postId:'123',done:true,media:[]}}]},tabs:{reload:async()=>actions.push('reload'),get:async()=>({url:'https://x.com/director/status/123'})}};
  const snapshot={candidates:[{canonicalUrl:'https://x.com/director/status/123',articleDocument:{blocks:[{assetId:'own',kind:'video',sourceUrl:''}]},media:[{id:'own',kind:'video',url:'',posterUrl:'https://pbs.twimg.com/amplify_video_thumb/555/img/cover?format=webp&name=medium'}]}]};
  const html=`<script>($R=>$R[1]={media_entities:$R[2]=[$R[3]={expanded_url:"https://x.com/director/status/123/video/1",id_str:"555",media_url_https:"https://pbs.twimg.com/amplify_video_thumb/555/img/cover.jpg",video_info:$R[4]={variants:$R[5]=[$R[6]={bitrate:1,content_type:"video/mp4",url:"https://video.twimg.com/low.mp4"},$R[7]={bitrate:10,content_type:"video/mp4",url:"https://video.twimg.com/full.mp4"}]}}],rest_id:"123"})($R["tsr"]);document.currentScript.remove()</script>`;
  const result=await resolveXVideoSources(snapshot,{id:1,url:snapshot.candidates[0].canonicalUrl},api,{readHtml:async()=>html});
  assert.equal(result.candidates[0].media[0].url,'https://video.twimg.com/full.mp4');
  assert.equal(result.candidates[0].articleDocument.blocks[0].sourceUrl,'https://video.twimg.com/full.mp4');
  assert.deepEqual(actions,[],'an already delivered original must not reload the page');
});

test('the user-reported public video page literal yields its complete highest-bitrate MP4, not playback fragments',async()=>{
  const html=await readFile(new URL('./fixtures/x-public-video-metadata.html',import.meta.url),'utf8');
  const result=xVideoSourcesFromHtml(html,'https://x.com/PJaccetturo/status/2105285286389248049');
  assert.equal(result.media.length,1);assert.equal(result.media[0].id,'2105198166014640128');
  assert.equal(result.media[0].variants[0].bitrate,10368000);
  assert.match(result.media[0].variants[0].url,/\/1080x1920\/z6kl6M8h3-GvBntj\.mp4\?tag=29$/u);
});

test('serialized page data excludes other posts, quotes, hostile URLs, segments and fake fields inside prompt strings',()=>{
  const own={expanded_url:'https://x.com/director/status/123/video/1',id_str:'555',video_info:{variants:[variant('own',10),{...variant('segment',20),url:'https://video.twimg.com/amplify_video/555/vid/avc1/0/0/720x1280/init.mp4'},{...variant('bad',30),url:'https://video.twimg.com@evil.example/bad.mp4'}]}};
  const other={...own,expanded_url:'https://x.com/director/status/999/video/1',video_info:{variants:[variant('other',50)]}};
  const html=`<script type="application/json">${JSON.stringify({full_prompt:JSON.stringify(other),media:[own,other],quoted:other})}</script>`;
  const result=xVideoSourcesFromHtml(html,'https://x.com/director/status/123');
  assert.equal(result.media.length,1);assert.equal(result.media[0].variants.length,1);
  assert.equal(result.media[0].variants[0].url,'https://video.twimg.com/own.mp4');
});

test('multiple videos match their own poster despite CDN preview format and size changes',()=>{
  const candidate={canonicalUrl:'https://x.com/director/status/123',media:[{id:'a',kind:'video',posterUrl:'https://pbs.twimg.com/amplify_video_thumb/555/img/a?format=webp&name=medium'}, {id:'b',kind:'video',posterUrl:'https://pbs.twimg.com/amplify_video_thumb/556/img/b?format=jpg&name=small'}]};
  const result=applyXVideoSources({candidates:[candidate]},{postId:'123',media:[{posterUrl:'https://pbs.twimg.com/amplify_video_thumb/556/img/b.jpg',variants:[{url:'https://video.twimg.com/b.mp4'}]}, {posterUrl:'https://pbs.twimg.com/amplify_video_thumb/555/img/a.jpg',variants:[{url:'https://video.twimg.com/a.mp4'}]}]});
  assert.deepEqual(result.candidates[0].media.map(m=>m.url),['https://video.twimg.com/a.mp4','https://video.twimg.com/b.mp4']);
});
function observer(payload) {
  const original = async()=>new Response(JSON.stringify(payload));
  const scope = vm.createContext({location:new URL('https://x.com/director/status/123'),fetch:original,URL,Blob,Response,TextDecoder,WeakSet,setTimeout,clearTimeout});
  vm.runInContext(`(${installXVideoObserver.toString()})({timeoutMs:1000,maxBytes:100000,maxMedia:24})`,scope);
  return {scope,original};
}

test('normal page response selects the current post at highest bitrate, never a reply or quote',async()=>{
  const {scope,original}=observer({data:[post('456','reply'),post('123','work'),post('789','quote')]});
  const response=await scope.fetch('/i/api/graphql/fixture');
  assert.equal(response.status,200);
  for(let n=0;n<30&&!scope.__PROMPTDIRECTOR_X_VIDEO__.done;n++)await new Promise(r=>setTimeout(r,5));
  const state=scope.__PROMPTDIRECTOR_X_VIDEO__;
  assert.equal(state.media.length,1);
  assert.equal(state.media[0].variants[0].url,'https://video.twimg.com/work-hd.mp4');
  assert.equal(scope.fetch,original,'the page fetch hook is restored after success');
});

test('unrelated endpoints and foreign media URLs do not become selected post video',async()=>{
  const value=post('123','bad');value.legacy.extended_entities.media[0].video_info.variants=[{...variant('x'),url:'https://example.com/private.mp4'}];
  const {scope,original}=observer(value);
  await scope.fetch('/settings');await scope.fetch('/i/api/graphql/fixture');
  await new Promise(r=>setTimeout(r,20));
  assert.equal(scope.__PROMPTDIRECTOR_X_VIDEO__.media.length,0);
  scope.__PROMPTDIRECTOR_X_VIDEO__.stop();assert.equal(scope.fetch,original);
});

test('resolved sources preserve text, IDs and excluded quotes even with a custom poster',()=>{
  const snapshot={candidates:[{canonicalUrl:'https://x.com/director/status/123',contentText:'User supplement',media:[{id:'work',kind:'video',posterUrl:'https://pbs.twimg.com/custom.jpg'},{id:'quote',kind:'video',isQuoted:true}]}]};
  const result=applyXVideoSources(snapshot,{postId:'123',media:[{variants:[{url:'https://video.twimg.com/file.mp4',mimeType:'video/mp4'}]}]});
  assert.equal(result.candidates[0].contentText,'User supplement');
  assert.equal(result.candidates[0].media[0].id,'work');
  assert.equal(result.candidates[0].media[0].url,'https://video.twimg.com/file.mp4');
  assert.deepEqual(result.candidates[0].media[1],snapshot.candidates[0].media[1]);
  assert.equal(applyXVideoSources(snapshot,{postId:'456',media:[{}]}).candidates[0],snapshot.candidates[0]);
});

test('navigation away cleans up the temporary script without reloading another post',async()=>{
  const actions=[];
  const api={scripting:{unregisterContentScripts:async()=>actions.push('unregister'),registerContentScripts:async s=>{assert.equal(s[0].persistAcrossSessions,false);actions.push('register');},executeScript:async()=>[]},tabs:{reload:async()=>actions.push('reload'),get:async()=>({url:'https://x.com/director/status/456'})}};
  const snapshot={candidates:[{canonicalUrl:'https://x.com/director/status/123',media:[{kind:'video',url:''}]}]};
  assert.equal(await resolveXVideoSources(snapshot,{id:1,url:'https://x.com/director/status/123'},api,{readHtml:async()=>''}),snapshot);
  assert.deepEqual(actions,['unregister','register','reload','unregister']);
});

test('cancelling a public metadata read aborts the download and does not reload the page',async()=>{
  const snapshot={candidates:[{canonicalUrl:'https://x.com/director/status/123',media:[{kind:'video',url:''}]}]};
  let cancelled=false;
  let aborted=false;
  const result=await resolveXVideoSources(snapshot,{id:1,url:snapshot.candidates[0].canonicalUrl},{},{
    cancelled:()=>cancelled,
    readHtml:async(_url,{signal})=>new Promise((_resolve,reject)=>{
      signal.addEventListener('abort',()=>{aborted=true;reject(signal.reason);},{once:true});
      cancelled=true;
    })
  });
  assert.equal(result,snapshot);assert.equal(aborted,true);
});

test('the public-page and normal-response paths share one read deadline instead of doubling the wait',async t=>{
  const snapshot={candidates:[{canonicalUrl:'https://x.com/director/status/123',media:[{kind:'video',url:''}]}]};
  let now=1000;
  t.mock.method(Date,'now',()=>now);
  const actions=[];
  const api={scripting:{unregisterContentScripts:async()=>{},registerContentScripts:async()=>{},executeScript:async()=>[{result:{done:true,media:[]}}]},tabs:{reload:async()=>actions.push('reload'),get:async()=>({url:snapshot.candidates[0].canonicalUrl})}};
  const result=await resolveXVideoSources(snapshot,{id:1,url:snapshot.candidates[0].canonicalUrl},api,{readHtml:async()=>{now+=PAGE_CAPTURE_LIMITS.navigationTimeoutMs;return '';}});
  assert.equal(result,snapshot);assert.deepEqual(actions,[],'an exhausted read must preserve the draft instead of starting another full wait');
});
