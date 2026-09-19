import test from 'node:test';
import assert from 'node:assert/strict';
import { videoResource, installVideoDiscovery, addDiscoveredVideos } from '../extension/video-discovery.js';

test('video discovery rejects audio, segments, failures and non-tab requests', () => {
  for (const details of [ { url: 'https://example.com/one.m4s', mime: 'video/mp4' }, { url:'https://example.com/audio',mime:'audio/mp4' }, {url:'https://example.com/movie.mp4',statusCode:403}, {url:'https://example.com/movie.mp4',tabId:-1} ]) {
    assert.equal(videoResource({tabId:1,statusCode:200,responseHeaders:[{name:'Content-Type',value:details.mime||''}],...details}),null);
  }
});
test('range repeats share identity while distinct videos and stream manifests remain discoverable', () => {
  const resource = url => videoResource({ tabId:1, url, statusCode:206 });
  assert.equal(resource('https://example.com/movie.mp4?range=0-99').key,resource('https://example.com/movie.mp4?range=100-200').key);
  assert.notEqual(resource('https://example.com/movie.mp4?id=1').key,resource('https://example.com/movie.mp4?id=2').key);
  assert.equal(resource('https://example.com/master.m3u8').manifest,true);
});
test('badges and cached resources stay in their tab and clear on navigation', async () => {
  const data={},badges={};let headers,updated,removed;
  const chrome={webRequest:{onHeadersReceived:{addListener:fn=>headers=fn}},tabs:{onUpdated:{addListener:fn=>updated=fn},onRemoved:{addListener:fn=>removed=fn}},
    storage:{session:{get:async key=>({[key]:data[key]}),set:async value=>Object.assign(data,value),remove:async key=>{delete data[key];}}},action:{setBadgeText:async ({tabId,text})=>{badges[tabId]=text;}}};
  const read=installVideoDiscovery(chrome);
  for (const [tabId,range] of [[1,'0-99'],[1,'100-200'],[2,'0-99']]) headers({tabId,url:`https://example.com/video.mp4?range=${range}`,statusCode:206});
  assert.equal((await read(1)).length,1);assert.equal((await read(2)).length,1);
  assert.deepEqual(badges,{1:'1',2:'1'});
  updated(1,{url:'https://example.com/next'});assert.equal((await read(1)).length,0);assert.equal((await read(2)).length,1);
  removed(2);assert.equal((await read(2)).length,0);
});

test('late discovery keeps existing choices and presents new media as optional once', () => {
  const batch={candidates:[{id:'one',contentText:'user text',media:[]}],selections:[{candidateId:'one',selectedMediaIds:[]}]};
  const resources=[{key:'video',url:'https://example.com/video.mp4',mimeType:'video/mp4'}];
  const first=addDiscoveredVideos(batch,resources);
  const second=addDiscoveredVideos(first,resources);
  assert.equal(second.candidates[0].media.length,1);
  assert.equal(second.candidates[0].media[0].placement,'unplaced');
  assert.deepEqual(second.selections,batch.selections);
  assert.equal(second.candidates[0].contentText,'user text');
  const list={...batch,candidates:[...batch.candidates,{id:'two'}]};
  assert.equal(addDiscoveredVideos(list,resources),list);
});

test('network HLS keeps its playback address through candidate normalization without claiming DASH playback', async () => {
  const { normalizePageCaptureCandidate } = await import('../extension/page-capture.js');
  for (const [url,mime,hls] of [
    ['https://example.com/master.m3u8','',true],
    ['https://example.com/stream','application/vnd.apple.mpegurl',true],
    ['https://example.com/master.mpd','application/dash+xml',false]
  ]) {
    const resource=videoResource({tabId:1,statusCode:200,url,responseHeaders:[{name:'Content-Type',value:mime}]});
    const batch=addDiscoveredVideos({candidates:[{id:'one',canonicalUrl:'https://example.com/watch',media:[]}]},[resource]);
    const media=normalizePageCaptureCandidate(batch.candidates[0]).media[0];
    assert.equal(media.streamUrl, hls ? url : undefined);
  }
});
