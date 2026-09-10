import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { installXVideoObserver, applyXVideoSources, resolveXVideoSources } from '../extension/x-video-capture.js';

const variant = (name, bitrate = 1) => ({url:`https://video.twimg.com/${name}.mp4`,content_type:'video/mp4',bitrate});
const post = (id, name) => ({rest_id:id,legacy:{extended_entities:{media:[{id_str:`media-${id}`,media_url_https:`https://pbs.twimg.com/${name}.jpg`,video_info:{variants:[variant(name),variant(`${name}-hd`,10)]}}]}}});
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
  assert.equal(await resolveXVideoSources(snapshot,{id:1,url:'https://x.com/director/status/123'},api),snapshot);
  assert.deepEqual(actions,['unregister','register','reload','unregister']);
});
