import test from 'node:test';
import assert from 'node:assert/strict';
import { readComposerCuratedCatalog } from '../extension/composer-curated-tools.js';
import { CURATED_CATALOG_URL } from '../extension/curated-config.js';
const base='https://wchao6891.github.io/PromptDirector-Curated';
const theme={id:'portraits',title:'人像',type:'image_prompt',packageId:'portraits',packageVersion:'2.0.0',authorId:'fixture',author:'测试作者',license:'CC BY 4.0',rightsStatus:'verified_authorized',rightsReviewUrl:`${base}/review.json`,updatedAt:'2026-09-10T00:00:00Z',coverUrl:`${base}/cover.webp`,previewUrl:`${base}/preview.json`,downloadUrl:'https://github.com/wchao6891/PromptDirector-Curated/releases/download/fixture/portraits.zip',sha256:'a'.repeat(64),archiveBytes:1024,caseCount:25,imageCount:25,videoCount:0,order:1};
const catalog={format:'prompt-director-curated',version:2,updatedAt:'2026-09-10T00:00:00Z',themes:[theme]};
const preview={format:'prompt-director-curated-preview',version:1,catalogId:theme.id,packageId:theme.packageId,packageVersion:theme.packageVersion,entries:Array.from({length:25},(_,i)=>({id:`case${i}`,title:`案例${i}`,text:'明确标注的测试资料'.repeat(80),author:'测试',rights:'测试已授权',mediaKind:'image',width:100,height:100,previewImageUrl:`${base}/image${i}.webp`}))};
test('curated checks compare actual manifests and page previews without requesting packages or images',async()=>{
 const urls=[];
 const fetchImpl=async(url,options)=>{urls.push(url);assert.equal(options.credentials,'omit');return new Response(JSON.stringify(url===CURATED_CATALOG_URL?catalog:preview));};
 const state={entries:[{curatedOrigin:{packageId:theme.packageId,packageVersion:'1.0.0'}}]};
 const result=await readComposerCuratedCatalog({},state,undefined,fetchImpl);
 assert.equal(result.items[0].availableVersion,'2.0.0');
 assert.equal(result.items[0].installation,'可用版本与本地不同');
 assert.equal(result.source,CURATED_CATALOG_URL);
 const first=await readComposerCuratedCatalog({catalogId:theme.id},state,undefined,fetchImpl);
 assert.equal(first.items.length,24);assert.equal(first.nextOffset,24);assert.equal(first.total,25);
 assert.equal(first.items[0].excerpt.length,240);
 const next=await readComposerCuratedCatalog({catalogId:theme.id,offset:24},state,undefined,fetchImpl);
 assert.equal(next.items.length,1);assert.equal(next.nextOffset,null);
 assert.ok(urls.every(url=>url===CURATED_CATALOG_URL||url===theme.previewUrl));
});
test('failed catalog and mismatched preview do not masquerade as no updates',async()=>{
 await assert.rejects(readComposerCuratedCatalog({}, {},undefined,async()=>new Response('',{status:503})),/读取失败/);
 await assert.rejects(readComposerCuratedCatalog({catalogId:theme.id},{},undefined,async url=>new Response(JSON.stringify(url===CURATED_CATALOG_URL?catalog:{...preview,packageVersion:'wrong'}))),/版本不一致/);
});
