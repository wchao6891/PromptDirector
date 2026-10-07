import test from 'node:test';
import assert from 'node:assert/strict';
import {createSimilarityIndex, rankSimilarEntries, paletteSimilarity} from '../extension/local-similarity.js';
import {createDefaultFacetCatalog, createFacetNode} from '../extension/facets.js';

function entry(id, kind='image', colors=[], text='') {
 return {id, text, sourceFacts:{originalPromptAvailable:true}, mediaAssets:[{id:`${id}:media`,kind,usage:'content'}], discoveryColors:colors, discoveryVisualId:`${id}:media`};
}
function rank(entries, id=entries[0].id, catalog=createDefaultFacetCatalog()) { return rankSimilarEntries(createSimilarityIndex(entries,catalog),id); }
const ids = result => result.map(x=>x.entry.id);

test('images with no tags or prompts still discover similar palettes',()=>{
 const result=rank([entry('current','image',['#223344']),entry('near','image',['#233445']),entry('far','image',['#EECCAA'])]);
 assert.deepEqual(ids(result),['near','far']);
});

test('image color group precedes exact prompt similarity in an unrelated palette',()=>{
 const result=rank([entry('current','image',['#223344'],'copper robot city'),entry('near','image',['#233445'],'moon forest'),entry('far','image',['#EECCAA'],'copper robot city')]);
 assert.deepEqual(ids(result),['near','far']);
});

test('within an image color neighborhood the prompt can outrank a tiny color difference',()=>{
 const result=rank([entry('current','image',['#223344'],'copper robot city'),entry('color-only','image',['#223344'],'ocean coral'),entry('content','image',['#233445'],'copper robot city'),entry('far','image',['#FFFFFF'],'copper robot city')]);
 assert.deepEqual(ids(result),['content','color-only','far']);
});

test('videos use original prompts before matching poster colors',()=>{
 const result=rank([entry('current','video',['#223344'],'copper robot city'),entry('prompt','video',['#EECCAA'],'copper robot city'),entry('color','video',['#223344'],'ocean coral')]);
 assert.deepEqual(ids(result),['prompt','color']);
 assert.equal(result[1].fallback,true);
});

test('poster color refines a video prompt neighborhood rather than requiring exact prompt ties',()=>{
 const result=rank([entry('current','video',['#223344'],'copper robot city'),entry('exact','video',['#FFFFFF'],'copper robot city'),entry('color','video',['#223344'],'copper robot city night'),entry('different','video',['#223344'],'ocean coral')]);
 assert.deepEqual(ids(result),['color','exact','different']);
});

test('personal tags, projects, filenames, timestamps and formats cannot influence the ranking',()=>{
 const values=[entry('current','image',['#223344'],'robot'),entry('a','image',['#223344'],'robot'),entry('b','image',['#FFFFFF'],'robot')];
 const before=rank(values);
 for(const e of values){e.customLabels=['收藏'];e.savedAt=crypto.randomUUID();e.mediaAssets[0].sourceTitle='same.png';e.mediaAssets[0].mimeType='image/png';}
 const after=rankSimilarEntries(createSimilarityIndex(values,createDefaultFacetCatalog(),{projectIdsForEntry:()=>['same']}),'current');
 assert.deepEqual(ids(after),ids(before));
 assert.deepEqual(after.map(x=>x.promptSimilarity),before.map(x=>x.promptSimilarity));
});

test('image and video results do not mix and a poster does not turn a video into an image case',()=>{
 const values=[entry('current','video',['#223344'],'robot city'),entry('video','video',['#223344'],'robot city'),entry('image','image',['#223344'],'robot city')];
 values[1].mediaAssets.push({kind:'image',usage:'poster'});
 assert.deepEqual(ids(rank(values)),['video']);
 const mixed=entry('mixed','video',['#223344'],'robot city');mixed.mediaAssets.push({kind:'image'});
 assert.deepEqual(ids(rank([...values,mixed])),['video']);
});

test('word segmentation handles differently worded descriptions without a synonym list',()=>{
 const result=rank([entry('current','video',[],'copper robot walking through neon city'),entry('near','video',[],'neon city with a copper robot'),entry('far','video',[],'ocean coral reef')]);
 assert.deepEqual(ids(result),['near']);
 const chinese=rank([entry('current','video',[],'电影级赛博朋克写实'),entry('near','video',[],'电影级赛博朋克城市')]);
 assert.equal(chinese.length,1);
});

test('term weights adapt to each corpus rather than privileging a specific word',()=>{
 const make=common=>rank([entry('current','video',[],'orchid quartz'),entry('orchid','video',[],'orchid'),entry('quartz','video',[],'quartz'),...Array.from({length:12},(_,i)=>entry(`background-${i}`,'video',[],common))]);
 assert.equal(make('orchid')[0].entry.id,'quartz');
 assert.equal(make('quartz')[0].entry.id,'orchid');
});

test('repeating prompt words or whole duplicate members does not inflate similarity',()=>{
 const a=entry('a','video',[],'copper robot');const b=entry('b','video',[],'copper robot copper robot copper robot');
 const result=rank([entry('current','video',[],'copper robot'),a,b]);
 assert.equal(result[0].promptSimilarity,result[1].promptSimilarity);
});

test('original media prompts exclude website prose; explicitly adopted video AI prompts provide independent evidence while incomplete analysis does not',()=>{
 const current=entry('current','video',[],'website marketing');current.mediaPrompts=[{assetId:'current:media',source:'webpage',text:'copper robot city'}];
 const ai=entry('ai','video',[],'');ai.mediaPrompts=[{assetId:'ai:media',source:'ai-suggestion',text:'copper robot city'}];
 const incomplete=entry('incomplete','video',[],'');incomplete.videoAnalyses=[{id:'unfinished',assetId:'incomplete:media',mode:'visual-reconstruction',reconstructionPrompt:'copper robot city',finishReason:'length'}];
 const result=rank([current,entry('original','video',[],'copper robot city'),entry('marketing','video',[],'website marketing'),ai,incomplete]);
 assert.deepEqual(ids(result),['ai','original']);
});

test('tags assist equal color and prompt results but cannot gate or manufacture candidates',()=>{
 const catalog=createFacetNode(createDefaultFacetCatalog(),{id:'tag',facetId:'style',parentId:'style.render',name:'共同风格'});
 const values=[entry('current','image',['#223344'],'robot'),entry('a-no-tag','image',['#223344'],'robot'),entry('z-tag','image',['#223344'],'robot')];
 for(const e of [values[0],values[2]])e.facetAssignments=[{nodeId:'tag',status:'confirmed'}];
 assert.deepEqual(ids(rank(values,'current',catalog)),['z-tag','a-no-tag']);
 for(const e of values){e.discoveryColors=[];e.text='';}
 assert.deepEqual(rank(values,'current',catalog),[]);
});

test('missing primary evidence uses the other real source and explains the limitation',()=>{
 const imageResult=rank([entry('current','image',[],'robot city'),entry('other','image',[],'robot city')]);
 assert.equal(imageResult[0].fallback,true);assert.match(imageResult[0].reason,/缺少色卡/);
 const videoResult=rank([entry('current','video',['#223344']),entry('other','video',['#233445'])]);
 assert.equal(videoResult[0].fallback,true);assert.match(videoResult[0].reason,/封面色彩/);
 assert.deepEqual(rank([entry('current'),entry('empty')]),[]);
});

test('homogeneous small libraries remain searchable without special thresholds',()=>{
 for(const size of [2,3,20])assert.equal(rank(Array.from({length:size},(_,i)=>entry(`case-${i}`,'video',[],'robot city'))).length,size-1);
});

test('ranking is deterministic and does not truncate the full matching set',()=>{
 const values=Array.from({length:1201},(_,i)=>entry(`case-${i}`,'image',['#223344']));
 assert.equal(rank(values).length,1200);
 assert.deepEqual(ids(rank(values.toReversed(),values[0].id)),ids(rank(values)));
});

test('index rebuild reflects prompt edits and other media do not skew term statistics',()=>{
 const values=[entry('current','video',[],'robot city'),entry('other','video',[],'robot city')];
 const before=rank(values)[0].promptSimilarity;
 assert.equal(rank([...values,entry('image','image',[],'robot city')])[0].promptSimilarity,before);
 values[1].text='ocean coral';assert.deepEqual(rank(values),[]);
});

test('compound titles are not original prompts and unmatched members reduce textual overlap',()=>{
 const current=entry('current','video',[],'robot city');
 const compound=entry('compound','video');compound.memberEntries=[entry('m1','video',[],'robot city'),entry('m2','video',[],'ocean coral')];
 compound.memberEntries.forEach(e=>e.title='robot city');
 const result=rank([current,entry('exact','video',[],'robot city'),compound]);
 assert.ok(result.find(e=>e.entry.id==='exact').promptSimilarity>result.find(e=>e.entry.id==='compound').promptSimilarity);
});

test('palette metric is exact for identical colors and monotonic for a nearby single swatch',()=>{
 assert.equal(paletteSimilarity(['#223344'],['#223344']),1);
 assert.ok(paletteSimilarity(['#223344'],['#233445'])>paletteSimilarity(['#223344'],['#FFFFFF']));
});


test('cached tokenization is reused only for unchanged text and removed prompts leave the cache',()=>{
 const values=[entry('current','video',[],'robot city'),entry('other','video',[],'robot city')];
 const first=createSimilarityIndex(values,createDefaultFacetCatalog());
 const second=createSimilarityIndex(values,createDefaultFacetCatalog(),{previousIndex:first});
 assert.equal(second.tokenCache.get('robot city'),first.tokenCache.get('robot city'));
 const changed=values.map(e=>({...e,text:'ocean coral'}));
 const third=createSimilarityIndex(changed,createDefaultFacetCatalog(),{previousIndex:second});
 assert.equal(third.tokenCache.has('robot city'),false);
 assert.equal(rankSimilarEntries(third,'current').length,1);
});

test('video tags cannot outrank stronger prompt content when poster colors are absent',()=>{
 const catalog=createFacetNode(createDefaultFacetCatalog(),{id:'tag',facetId:'style',parentId:'style.render',name:'共同风格'});
 const values=[entry('current','video',[],'orc battlefield handheld'),entry('closer','video',[],'orc battlefield handheld'),entry('tag-only','video',[],'handheld travel vlog')];
 for(const e of [values[0],values[2]])e.facetAssignments=[{nodeId:'tag',status:'confirmed'}];
 assert.equal(rank(values,'current',catalog)[0].entry.id,'closer');
});

function reconstructed(id, kind, text) {
 const value=entry(id,kind,[],'');
 if(kind==='image')value.mediaAssets[0].visionAnalysis={version:2,reconstructionPrompt:text};
 else value.videoAnalyses=[{id:`${id}:analysis`,assetId:`${id}:media`,mode:'visual-reconstruction',reconstructionPrompt:text,requestId:'request',contractVersion:'test',analysisScope:'video',includeTags:false,tags:[],uncertainties:[],finishReason:'stop',createdAt:'2026-09-27T00:00:00Z'}];
 return value;
}

test('images and videos without originals use existing complete reconstruction, originals always win',()=>{
 for(const kind of ['image','video']){
  const current=reconstructed('current',kind,'copper robot city');
  const candidate=entry('original',kind,[],'copper robot city');
  assert.deepEqual(ids(rank([current,candidate])),['original']);
  assert.doesNotMatch(rank([current,candidate])[0].reason,/原始/);
  current.text='ocean coral';
  assert.deepEqual(rank([current,candidate]),[]);
 }
});

test('invalid image analysis and unfinished video reconstruction do not manufacture similarity',()=>{
 for(const kind of ['image','video']){
  const current=reconstructed('current',kind,'copper robot city');
  if(kind==='image')current.mediaAssets[0].visionAnalysis.invalidated=true;
  else current.videoAnalyses[0].finishReason='length';
  assert.deepEqual(rank([current,entry('other',kind,[],'copper robot city')]),[]);
 }
});

test('adopted image reconstruction participates only without an original prompt',()=>{
 const current=entry('current','image');
 current.mediaPrompts=[{assetId:'current:media',source:'ai-suggestion',text:'copper robot city'}];
 const other=entry('other','image',[],'copper robot city');
 assert.equal(rank([current,other]).length,1);
 current.mediaPrompts.push({assetId:'current:media',source:'webpage',text:'ocean coral'});
 assert.deepEqual(rank([current,other]),[]);
});

test('compound members choose original or reconstruction independently and edits refresh cached terms',()=>{
 const compound=entry('compound','video');
 compound.memberEntries=[entry('m1','video',[],'ocean coral'),reconstructed('m2','video','copper robot city')];
 const other=entry('other','video',[],'copper robot city');
 const first=createSimilarityIndex([compound,other],createDefaultFacetCatalog());
 assert.equal(rankSimilarEntries(first,'compound').length,1);
 compound.memberEntries[1].videoAnalyses[0].reconstructionPrompt='ocean coral';
 const second=createSimilarityIndex([compound,other],createDefaultFacetCatalog(),{previousIndex:first});
 assert.deepEqual(rankSimilarEntries(second,'compound'),[]);
});
