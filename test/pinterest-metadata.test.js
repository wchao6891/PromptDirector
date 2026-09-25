import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { enrichPinterestCandidates } from '../extension/pinterest-capture.js';
import { collectPageCaptureSitePayload, normalizePageCaptureSitePayload } from '../extension/page-capture-site-adapters.js';
const pin = JSON.parse(await readFile(new URL('./fixtures/pinterest-pin-metadata.json',import.meta.url)));
const url = `https://www.pinterest.com/pin/${pin.entityId}/`;
const html = p => `<script>window.__PWS_RELAY_REGISTER_COMPLETED_REQUEST__("public", ${JSON.stringify({data:{v3GetPinQueryv2:{data:p}}})});</script>`;
test('public work metadata replaces a board ID placeholder without replacing selected media identities', async () => {
 const card={id:'card',title:`Pinterest ${pin.entityId}`,canonicalUrl:url,media:[{id:'selected-original',url:pin.images_orig.url}],sourceFacts:{provider:'pinterest',engagement:{reactions:252}}};
 const result=await enrichPinterestCandidates({adapter:'pinterest',candidates:[card]}, {readHtml:async()=>html(pin)});
 const work=result.candidates[0];
 assert.equal(work.title,'Wukong vs heaven');assert.equal(work.sourceFacts.author,'ʀᴇᴅɢʀᴀᴠᴇ');
 assert.equal(work.sourceFacts.authorUrl,'https://www.pinterest.com/LastSon_/');
 assert.equal(work.sourceFacts.engagement.repins,471);assert.equal(work.sourceFacts.engagement.reactions,252);
 assert.ok(work.sourceFacts.publishedAt);assert.ok(work.sourceFacts.imageDescription);
 assert.equal(work.id,card.id);assert.equal(work.media[0].id,'selected-original');assert.equal(work.media[0].sourceTitle,'Wukong vs heaven');
});
test('another Pin or unavailable detail cannot masquerade as complete work metadata',async()=>{
 const card={id:'card',title:'list description',canonicalUrl:url,media:[],sourceFacts:{}};
 for(const readHtml of [async()=>html({...pin,entityId:'999'}),async()=>{throw new Error('HTTP 429');}]) {
  const result=await enrichPinterestCandidates({adapter:'pinterest',candidates:[card]},{readHtml});
  assert.equal(result.candidates[0].title,'list description');assert.equal(result.candidates[0].completeness,'partial');
  assert.ok(result.candidates[0].sourceFacts.metadataError);
 }
});
test('missing interaction counts remain unknown rather than fabricated zero',()=>{
 const payload=collectPageCaptureSitePayload({pinterestUrl:url,pinterestHtml:html({...pin,repinCount:undefined}),maxCandidates:1,maxMedia:1,maxTextCharacters:100000});
 assert.deepEqual(normalizePageCaptureSitePayload(payload,url).sourceFacts.engagement,{});
});
test('untitled detail still contributes real creator metadata, and cancellation retains found cards',async()=>{
 const card={id:'card',title:'Visible artwork description',canonicalUrl:url,media:[{id:'original'}],sourceFacts:{}};
 const result=await enrichPinterestCandidates({adapter:'pinterest',candidates:[card]}, {readHtml:async()=>html({...pin,title:'',gridTitle:'',seoTitle:'',closeupUnifiedTitle:''})});
 assert.equal(result.candidates[0].title,card.title);
 assert.equal(result.candidates[0].sourceFacts.author,'ʀᴇᴅɢʀᴀᴠᴇ');
 const stopped=await enrichPinterestCandidates({adapter:'pinterest',candidates:[card]}, {cancelled:()=>true,readHtml:()=>{throw new Error('must not fetch');}});
 assert.equal(stopped.candidates.length,1);assert.deepEqual(stopped.candidates[0].media,card.media);
 assert.equal(stopped.candidates[0].completeness,'partial');
});
