import test from 'node:test';
import assert from 'node:assert/strict';
import { planPageCaptureRepair, mergePageCaptureRepair } from '../extension/page-capture-repair.js';

const candidate = { pageType:'video', canonicalUrl:'https://example.com/publication/one', sourceFacts:{pageType:'video',extractionMethod:'structured'},media:[{id:'captured-video',kind:'video',url:'https://cdn.example.com/one.mp4'}] };
const reference = {id:'old',kind:'video',storageMode:'reference',sourceUrl:candidate.canonicalUrl,reference:{url:candidate.canonicalUrl}};

test('recapture upgrades a page-only video without replacing edited case content or annotations', async()=>{
  const entry={id:'case',title:'Edited title',text:'My original prompt',customLabels:['keep'],mediaAssets:[reference],primaryMediaId:'old',mediaPrompts:[{assetId:'old',source:'manual',text:'Per-media edit'}]};
  const plan=await planPageCaptureRepair(entry,candidate,async()=>false);
  assert.equal(plan.pending.length,1);
  assert.equal(plan.matched.get('captured-video').id,'old');
  const video={...reference,storageMode:'managed',mimeType:'video/mp4'};
  const result=mergePageCaptureRepair(entry,candidate,plan,[video],new Map([['captured-video','old']]));
  assert.equal(result.id,entry.id);
  assert.equal(result.text,entry.text);
  assert.equal(result.title,entry.title);
  assert.deepEqual(result.customLabels,entry.customLabels);
  assert.deepEqual(result.mediaPrompts,entry.mediaPrompts);
  assert.equal(result.mediaAssets.length,1);
  assert.equal(result.mediaAssets[0].storageMode,'managed');
  assert.equal(result.sourceFacts.pageType,'video');
});

test('already stored bytes are reused, but missing local bytes are repaired', async()=>{
  const asset={id:'video',kind:'video',storageMode:'managed',sourceUrl:candidate.media[0].url};
  const entry={mediaAssets:[asset]};
  assert.equal((await planPageCaptureRepair(entry,candidate,async()=>true)).pending.length,0);
  assert.equal((await planPageCaptureRepair(entry,candidate,async()=>false)).pending.length,1);
});

test('an unannotated obsolete source card is collapsed into the verified local video',async()=>{
  const video={id:'local',kind:'video',storageMode:'managed',sourceUrl:candidate.media[0].url};
  const entry={mediaAssets:[reference,video],primaryMediaId:reference.id};
  const plan=await planPageCaptureRepair(entry,candidate,async()=>true);
  assert.equal(plan.pending.length,0);
  const result=mergePageCaptureRepair(entry,candidate,plan,[],plan.assetIds);
  assert.deepEqual(result.mediaAssets,[video]);
  assert.equal(result.primaryMediaId,video.id);
});

test('reference-specific user notes survive when a local copy already exists',async()=>{
  const video={id:'local',kind:'video',storageMode:'managed',sourceUrl:candidate.media[0].url};
  const entry={mediaAssets:[reference,video],primaryMediaId:reference.id,timeNotes:[{assetId:'old',text:'User note'}]};
  const plan=await planPageCaptureRepair(entry,candidate,async()=>true);
  const result=mergePageCaptureRepair(entry,candidate,plan,[],plan.assetIds);
  assert.equal(result.mediaAssets.length,2);
  assert.deepEqual(result.timeNotes,entry.timeNotes);
  assert.equal(result.primaryMediaId,video.id);
});

test('newly recovered article images return to their original body position',async()=>{
  const article={pageType:'article',canonicalUrl:'https://example.com/article',sourceFacts:{pageType:'article'},media:[{id:'source-image',kind:'image',url:'https://cdn.example.com/original.png'}]};
  const entry={text:'User edited article',mediaAssets:[],articleDocument:{blocks:[{kind:'paragraph',text:'Edited paragraph'}, {kind:'image',sourceUrl:article.media[0].url}]}};
  const plan=await planPageCaptureRepair(entry,article,async()=>false);
  const result=mergePageCaptureRepair(entry,article,plan,[{id:'image',kind:'image',storageMode:'managed'}],new Map([['source-image','image']]));
  assert.equal(result.articleDocument.blocks[0].text,'Edited paragraph');
  assert.equal(result.articleDocument.blocks[1].assetId,'image');
  assert.equal(result.text,entry.text);
});

test('explicit supplemental text on a saved page is appended without overwriting user edits', async () => {
  const entry = { id: 'case', text: 'User edited body', textRevision: 3, title: 'User title', mediaAssets: [],
    articleDocument: { version: 1, blocks: [{ id: 'old', kind: 'paragraph', text: 'User edited body', sourceOrder: 0 }] } };
  const selected = { ...candidate, media: [], textBlocks: [
    { id: 'body', text: 'Changed webpage body must not replace the user edit' },
    { id: 'added:draft:fragment', text: 'Selected additional prompt' }
  ] };
  const plan = await planPageCaptureRepair(entry, selected, async () => true);
  const result = mergePageCaptureRepair(entry, selected, plan, [], plan.assetIds);
  assert.equal(result.text, 'User edited body\n\nSelected additional prompt');
  assert.equal(result.title, 'User title');
  assert.equal(result.textRevision, 4);
  assert.deepEqual(result.articleDocument.blocks.map(b => b.text), ['User edited body', 'Selected additional prompt']);
  const again = await planPageCaptureRepair(result, selected, async () => true);
  assert.deepEqual(again.textAdditions, []);
});

test('media receipt distinguishes downloaded originals from failed source-only video references', async () => {
  const {pageCaptureMediaReceipt} = await import('../extension/page-capture-repair.js');
  const candidate={media:[{id:'image'},{id:'video'},{id:'embed'},{id:'missing'}]};
  const result=pageCaptureMediaReceipt(candidate,new Map([['image','a'],['video','b'],['embed','c']]),new Set(['video','missing']));
  assert.deepEqual(result,{savedMediaIds:['image','embed'],pendingMediaIds:['video','missing']});
});

test('retry recognizes already stored local supplement by content hash after its draft blob is consumed', async () => {
  const {planPageCaptureRepair} = await import('../extension/page-capture-repair.js');
  const plan=await planPageCaptureRepair({mediaAssets:[{id:'stored',kind:'image',storageMode:'managed',contentHash:'same'}]},
    {media:[{id:'local',localAssetId:'consumed',kind:'image',contentHash:'same'}]},async()=>true);
  assert.equal(plan.pending.length,0);
  assert.equal(plan.assetIds.get('local'),'stored');
});
