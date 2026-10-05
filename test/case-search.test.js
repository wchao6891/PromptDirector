import test from 'node:test';
import assert from 'node:assert/strict';
import { createAgentLibrary } from '../extension/agent-library.js';
import { createComposerLibraryTools } from '../extension/composer-library-tools.js';
import { createComposerSession } from '../extension/composer.js';
import { buildSearchIndex, createSearchIndexCache } from '../extension/search-index.js';
import { searchCaseEntries, searchCaseResult } from '../extension/case-search.js';

const asset = (id,kind,extra={}) => ({id,kind,storageMode:'managed',...extra});
function fixture() {
  const entries=[
    {id:'v',title:'动作打斗',savedAt:'2026-01-03',text:'描述',sourceFacts:{originalPromptAvailable:false},mediaAssets:[asset('v1','video'),asset('cover','image',{usage:'poster'})],mediaPrompts:[{assetId:'v1',source:'manual',text:'长镜头动作原词'}]},
    {id:'i',title:'动作图片',savedAt:'2026-01-02',text:'',mediaAssets:[asset('i1','image')],mediaPrompts:[{assetId:'i1',source:'manual',text:'图片原词'}]},
    {id:'mixed',title:'雨夜打斗',savedAt:'2026-01-01',text:'',mediaAssets:[asset('mi','image'),asset('mv','video')],mediaPrompts:[{assetId:'mi',source:'manual',text:'图片原词'}, {assetId:'mv',source:'ai-suggestion',text:'视频逆推'}]},
    {id:'doc',title:'参考文档',savedAt:'2026-01-04',mediaAssets:[asset('doc1','document')],text:''}
  ];
  const organizerState={collections:[{id:'parent',name:'父项目',entryIds:[]},{id:'child',name:'子项目',parentId:'parent',entryIds:['v','mixed']},{id:'other',name:'其他',entryIds:['i','doc']}]};
  const state={entries,organizerState};let documentReads=0;
  const external=createAgentLibrary({loadState:async()=>state,readDerived:async()=>{documentReads++;return{searchText:'文档正文'};},readDerivedMetadata:async()=>new Map(),libraryUrl:'chrome-extension://test/library.html'});
  const internal=createComposerLibraryTools({session:createComposerSession({messages:[{id:'u',role:'user',content:'找动作视频'}]}),vision:false,maxCharacters:10000,
    loadLibrary:async()=>({...state,searchIndex:buildSearchIndex(entries)}),onEvent:async()=>{}});
  return {state,external,internal,documentReads:()=>documentReads};
}

test('internal and external search apply identical media, original-prompt, project and ordering rules', async () => {
  const {external,internal}=fixture();
  for(const filters of [
    {query:'动作',mediaKind:'video',hasOriginalPrompt:true},
    {query:'',mediaKind:'image'},
    {query:'打斗',project:'父项目',mediaKind:'video',hasOriginalPrompt:false},
    {query:'动作',alternatives:['雨夜'],sort:'oldest'},
    {query:'',alternatives:['雨夜'],mediaKind:'video'}
  ]){
    const result=await external.search(filters);
    const local=await internal.execute('search_cases',filters,{callId:crypto.randomUUID()});
    assert.deepEqual(local.data.candidates.map(item=>item.caseId),result.cases.map(item=>item.caseId));
    assert.equal(local.data.total,result.total);
  }
});
test('image filter ignores a video poster and a sibling image prompt never makes a video have original prompts', async () => {
  const {external}=fixture();
  assert.deepEqual((await external.search({mediaKind:'image'})).cases.map(item=>item.caseId),['i','mixed']);
  assert.deepEqual((await external.search({mediaKind:'video',hasOriginalPrompt:true})).cases.map(item=>item.caseId),['v']);
  assert.deepEqual((await external.search({mediaKind:'video',hasOriginalPrompt:false})).cases.map(item=>item.caseId),['mixed']);
});
test('project and media restrictions run before unrelated document reads; counting returns no fake first page', async () => {
  const {external,documentReads}=fixture();
  const result=await external.search({project:'父项目',mediaKind:'video',countOnly:true});
  assert.equal(result.total,2);assert.deepEqual(result.cases,[]);assert.equal(result.nextOffset,null);assert.equal(documentReads(),0);
  assert(!Object.hasOwn(result,'projects'),'count-only searches must not attach the unrelated project tree');
});
test('compound search uses each matching member media and its own prompt provenance', () => {
  const {state}=fixture();
  const compound={id:'c',title:'组合',memberEntries:[state.entries[1],state.entries[2]],memberEntryIds:['i','mixed'],mediaAssets:[...state.entries[1].mediaAssets,...state.entries[2].mediaAssets]};
  const entries=[compound],index=buildSearchIndex(entries);
  assert.equal(searchCaseEntries(entries,index,state.organizerState,{mediaKind:'video',hasOriginalPrompt:true}).length,0);
  assert.equal(searchCaseEntries(entries,index,state.organizerState,{mediaKind:'video',hasOriginalPrompt:false}).length,1);
});
test('invalid filters and ambiguous projects are rejected rather than silently broadened', async () => {
  const {state,external}=fixture();state.organizerState.collections.push({id:'duplicate',name:'子项目',entryIds:[]});
  await assert.rejects(external.search({project:'子项目'}),{code:'ambiguous_project'});
  await assert.rejects(external.search({mediaKind:'banana'}),{code:'invalid_input'});
  await assert.rejects(external.search({hasOriginalPrompt:'true'}),{code:'invalid_input'});
  await assert.rejects(external.search({alternatives:['']}),{code:'invalid_input'});
});


test('reading a selected asset original never returns its sibling prompt or an AI reconstruction', async () => {
  const {external,state}=fixture();
  const image=await external.read({caseId:'mixed',assetId:'mi',part:'original_prompt'});
  const video=await external.read({caseId:'mixed',assetId:'mv',part:'original_prompt'});
  assert.equal(image.content,'图片原词');assert.equal(video.content,'');
  await assert.rejects(external.read({caseId:'mixed',assetId:'outside',part:'original_prompt'}),{code:'asset_not_in_case'});
  assert.equal((await external.read({caseId:'mixed',part:'original_prompt'})).content,'图片原词');
  state.entries[2].mediaPrompts.push({assetId:'mv',source:'manual',text:'独立视频原词'});
  assert.equal((await external.read({caseId:'mixed',assetId:'mv',part:'original_prompt'})).content,'独立视频原词');
});


test('duration bounds match one actual video and its own original prompt, excluding unknown durations honestly', async () => {
  const {state,external,internal}=fixture();
  state.entries[0].mediaAssets[0].durationMs=8000;
  state.entries[2].mediaAssets.find(a=>a.id==='mv').durationMs=25000;
  state.entries.push({id:'unknown',title:'动作未知时长',mediaAssets:[asset('unknown-v','video')],text:''});
  const input={query:'',mediaKind:'video',minDurationMs:8000,maxDurationMs:25000};
  const result=await external.search(input);
  assert.deepEqual(result.cases.map(c=>c.caseId),['v','mixed']);
  assert.deepEqual(result.durationCoverage,{scope:'文字、项目和媒体类型筛选后，应用时长与原词条件之前的素材',totalMedia:3,knownDurationMedia:2,unknownDurationMedia:1,unknownExcluded:true});
  const local=await internal.execute('search_cases',input,{callId:'duration'});
  assert.deepEqual(local.data.candidates.map(c=>c.caseId),result.cases.map(c=>c.caseId));
  assert.deepEqual(local.data.durationCoverage,result.durationCoverage);
  assert.deepEqual((await external.search({...input,minDurationMs:20000,hasOriginalPrompt:true})).cases,[]);
  state.entries[2].mediaAssets.push(asset('short-v','video',{durationMs:1000}));
  state.entries[2].mediaPrompts.push({assetId:'short-v',source:'manual',text:'短视频原词'});
  assert.deepEqual((await external.search({...input,minDurationMs:20000,hasOriginalPrompt:true})).cases,[]);
  assert.deepEqual((await external.search({...input,minDurationMs:20000,hasOriginalPrompt:false})).cases.map(c=>c.caseId),['mixed']);
  for (const bad of [{minDurationMs:-1},{minDurationMs:30,maxDurationMs:20},{maxDurationMs:'100'},{mediaKind:'image',minDurationMs:0}]) await assert.rejects(external.search(bad),{code:'invalid_input'});
});

test('search pages cannot silently repeat or skip cases after insertion, edits, project moves, query changes or deletion', async () => {
  for (const mutate of [
    s=>s.entries.unshift({id:'new',title:'new',text:''}),
    s=>{s.entries[0].title='刚被人工改过';},
    s=>{s.entries.splice(1,1);},
    s=>{s.organizerState.collections[0].name='更名';}
  ]) {
    const {state,external}=fixture();
    const first=await external.search({query:'',limit:1});
    const second=await external.search({query:'',offset:first.nextOffset,limit:1,expectedRevision:first.revision});
    assert.equal(second.cases[0].caseId,'i');
    mutate(state);
    await assert.rejects(external.search({query:'',offset:first.nextOffset,limit:1,expectedRevision:first.revision}),{code:'search_changed'});
  }
  const {external}=fixture(), first=await external.search({query:'',limit:1});
  await assert.rejects(external.search({offset:1}),{code:'search_revision_required'});
  await assert.rejects(external.search({query:'动作',expectedRevision:first.revision}),{code:'search_changed'});
  assert.equal((await external.search({query:'',countOnly:true})).revision,first.revision);
});

test('document-derived text and palette changes invalidate pages even when case timestamps do not change', async () => {
  const {state}=fixture();let text='第一版文档';let palette='#aabbcc';
  const external=createAgentLibrary({loadState:async()=>state,readDerived:async()=>({searchText:text}),readDerivedMetadata:async()=>new Map([['i1',{palette:{colors:[palette]}}]]),libraryUrl:'local'});
  const first=await external.search({limit:1});
  text='外部重新提取后的文档';
  await assert.rejects(external.search({offset:1,expectedRevision:first.revision}),{code:'search_changed'});
  const refreshed=await external.search({limit:1});palette='#ddeeff';
  await assert.rejects(external.search({offset:1,expectedRevision:refreshed.revision}),{code:'search_changed'});
});

test('incremental index reuses unchanged records but never stale edits, derived documents, palettes or vocabulary', () => {
  const {state}=fixture(),cache=createSearchIndexCache();
  const docs=new Map([['doc1','完整文档']]), derived=new Map();
  const first=cache.build(state.entries,undefined,docs,derived);assert.equal(first.rebuilt,4);
  const warm=cache.build(structuredClone(state.entries),undefined,docs,derived);assert.equal(warm.rebuilt,0);assert.equal(warm.index[0],first.index[0]);
  state.entries[0].text='编辑后正文';assert.equal(cache.build(state.entries,undefined,docs,derived).rebuilt,1);
  docs.set('doc1','重新提取');assert.equal(cache.build(state.entries,undefined,docs,derived).rebuilt,1);
  derived.set('i1',{palette:{colors:['#123456']}});assert.equal(cache.build(state.entries,undefined,docs,derived).rebuilt,1);
  assert.equal(cache.build(state.entries,{revision:2},docs,derived).rebuilt,4);
  state.entries.pop();assert.equal(cache.build(state.entries,{revision:2},docs,derived).index.length,3);
  assert.deepEqual(cache.build(state.entries,{revision:2},docs,derived).index,buildSearchIndex(state.entries,{revision:2},docs,derived));
});


test('transport key order and internal display-only classification labels do not fork search revisions', async () => {
  const {state}=fixture();
  const index=buildSearchIndex(state.entries);
  const original=await searchCaseResult(state.entries,index,state.organizerState,{});
  const decorated=state.entries.map(e=>({...Object.fromEntries(Object.entries(e).reverse()),contentRole:'video',contentTypeName:'视频'}));
  const next=await searchCaseResult(decorated,buildSearchIndex(decorated),state.organizerState,{expectedRevision:original.revision});
  assert.equal(next.revision,original.revision);
  const cache=createSearchIndexCache();cache.build(state.entries);
  assert.equal(cache.build(state.entries.map(e=>Object.fromEntries(Object.entries(e).reverse()))).rebuilt,0);
});

test('repeated pages reuse validated result facts instead of serializing every long prompt again', async () => {
  let bodyReads = 0;
  const entry = { id: 'long', title: 'long prompt', mediaAssets: [],
    get text() { bodyReads++; return '完整原始提示词'.repeat(20000); } };
  const entries = [entry], cache = createSearchIndexCache();
  const firstIndex = cache.build(entries);
  const first = await searchCaseResult(entries, firstIndex.index, {}, {}, firstIndex.resultVersion);
  const nextIndex = cache.build(entries);
  bodyReads = 0;
  const next = await searchCaseResult(entries, nextIndex.index, {}, { expectedRevision: first.revision }, nextIndex.resultVersion);
  assert.equal(next.revision, first.revision);
  assert.equal(bodyReads, 0, 'a validated unchanged prompt should not be re-read to version the next page');
});

test('cached result versions match uncached reads and retain their snapshot across interleaved queries', async () => {
  const {state} = fixture(), cache = createSearchIndexCache();
  const before = structuredClone(state.entries);
  const oldIndex = cache.build(before);
  const first = await searchCaseResult(before, oldIndex.index, state.organizerState, {}, oldIndex.resultVersion);
  state.entries[0].mediaAssets[0].byteSize = 200;
  const changed = cache.build(state.entries);
  const fresh = await searchCaseResult(state.entries, changed.index, state.organizerState, {}, changed.resultVersion);
  const uncached = await searchCaseResult(state.entries, buildSearchIndex(state.entries), state.organizerState);
  assert.notEqual(fresh.revision, first.revision, 'a changed original descriptor must invalidate the old page');
  assert.equal(fresh.revision, uncached.revision);
  const held = await searchCaseResult(before, oldIndex.index, state.organizerState, {}, oldIndex.resultVersion);
  assert.equal(held.revision, first.revision, 'another cache build must not change an already loaded snapshot');
  const scoped = cache.build([state.entries[1]], undefined, new Map(), new Map(), new Set(state.entries.map(e=>e.id)));
  await searchCaseResult(state.entries, scoped.index, state.organizerState, {}, scoped.resultVersion);
  const restored = cache.build(structuredClone(state.entries));
  assert.equal(restored.rebuilt, 0);
  assert.equal((await searchCaseResult(state.entries, restored.index, state.organizerState, {}, restored.resultVersion)).revision, fresh.revision);
});
