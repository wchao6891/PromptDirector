import test from 'node:test';
import assert from 'node:assert/strict';
import {createExternalAnalysisBatches} from '../extension/external-analysis-batches.js';
import {caseRevision} from '../extension/case-operations.js';
import {createFixedFacetCatalog} from '../extension/tag-taxonomy.js';
import {sha256Blob} from '../extension/blob-digest.js';
import {normalizeEntryMedia} from '../extension/media.js';
import {withComposerCaseOperations} from '../extension/composer-case-operations.js';

function setup(count=2) {
 const blobs=new Map([['img',new Blob(['original'])]]);
 const data={entries:Array.from({length:count},(_,i)=>normalizeEntryMedia({id:`c${i}`,title:`Case ${i}`,text:'人工正文',customLabels:['人工标签'],mediaAssets:[{id:'img',kind:'image',storageMode:'managed'}],mediaPrompts:[{assetId:'img',source:'manual',text:'真实原词'}]})),facetCatalog:createFixedFacetCatalog(),organizerState:{collections:[]}};
 let tail=Promise.resolve(),failure='',libraryId='library',commits=0,loads=0;
 const storage={getKeys:async()=>Object.keys(data),get:async keys=>structuredClone(Object.fromEntries((typeof keys==='string'?[keys]:keys).filter(k=>k in data).map(k=>[k,data[k]])))};
 const deps={storage,loadState:async()=>{loads++;return structuredClone(data);},readBlob:async id=>blobs.get(id),getLibraryId:async()=>libraryId,
 enqueue:fn=>{const p=tail.then(fn,fn);tail=p.catch(()=>{});return p;},commit:async changes=>{commits++;if(failure==='before')throw Error('disk');Object.assign(data,structuredClone(changes));if(failure==='after')throw Error('ack');}};
 const api=()=>createExternalAnalysisBatches(deps);
 const call=(name,input)=>api().execute(name,input);
 const item=async(id,visual=false)=>({caseId:id,expectedRevision:await caseRevision(data,data.entries.find(e=>e.id===id)),assets:visual?[{assetId:'img',sha256:await sha256Blob(blobs.get('img')),coverage:'原图完整查看'}]:[]});
 const create=async(items)=>call('manage_analysis_batch',{action:'create',requestId:'batch',instruction:'分析用户指定案例',items});
 const read=()=>call('read_analysis_batch',{batchId:'batch'});
 const control=async(action,items,requestId=action)=>call('manage_analysis_batch',{action,batchId:'batch',requestId,expectedRevision:(await read()).revision,...(action==='cancel'?{epoch:(await read()).epoch}:{}),...(items?{items}:{})});
 const submit=async(row,extra={},requestId=`result-${row.caseId}-${row.attempts}`)=>call('submit_analysis_result',{batchId:'batch',requestId,caseId:row.caseId,attemptId:row.attemptId,epoch:(await read()).epoch,...extra});
 return {data,blobs,item,create,read,control,submit,call,get commits(){return commits;},get loads(){return loads;},fail:v=>{failure=v;},switchLibrary:v=>{libraryId=v;}};
}
const tags={tags:[{g:'scene.place',t:'摄影棚'}]};

async function pageInput(f) {
 const rows=(await f.read()).items;
 return {requestId:'result-page',batchId:'batch',epoch:0,items:rows.map(row=>({caseId:row.caseId,attemptId:row.attemptId,result:tags}))};
}

test('one page shares one fresh read and one commit while preserving per-item conflicts, receipts and tags',async()=>{
 const f=setup(4);await f.create(await Promise.all(f.data.entries.map(e=>f.item(e.id))));await f.control('seal');
 const input=await pageInput(f);f.data.entries[1].text='新的人工编辑';
 input.items[2].result={tags:[{g:'scene.weather',t:'晴天'}]};delete input.items[3].result;input.items[3].error='模型失败';
 const before={loads:f.loads,commits:f.commits};
 const result=await f.call('submit_analysis_results',input);
 assert.equal(f.loads-before.loads,1);assert.equal(f.commits-before.commits,1);
 assert.deepEqual(result.items.map(i=>i.state),['saved','failed','saved','failed']);
 assert.equal(result.items[1].error.code,'case_conflict');assert.equal(result.status,'partial');assert.equal(result.saved,2);
 assert.equal(f.data.entries[1].text,'新的人工编辑');assert.equal(f.data.entries[0].facetAssignments.length,1);assert.equal(f.data.entries[2].facetAssignments.length,1);
 for(const row of result.items.filter(i=>i.state==='saved'))assert.equal(row.savedRevision,await caseRevision(f.data,f.data.entries.find(e=>e.id===row.caseId)));
 const commits=f.commits;assert((await f.call('submit_analysis_results',input)).replayed);assert.equal(f.commits,commits);
 for(const row of result.items)assert.equal(JSON.parse((await f.call('read_analysis_batch',{batchId:'batch',part:'result',caseId:row.caseId})).content).state,row.state);
});

test('invalid page bounds, duplicate cases and stale attempts cannot partially save a page',async()=>{
 const f=setup();await f.create([await f.item('c0'),await f.item('c1')]);const input=await pageInput(f),before=f.commits;
 await assert.rejects(f.call('submit_analysis_results',{...input,items:Array(25).fill(input.items[0])}),/列表无效/);
 await assert.rejects(f.call('submit_analysis_results',{...input,items:[input.items[0],input.items[0]]}),{code:'invalid_input'});
 await assert.rejects(f.call('submit_analysis_results',{...input,items:[input.items[0],{...input.items[1],attemptId:'old'}]}),{code:'analysis_attempt_stale'});
 await assert.rejects(f.call('submit_analysis_results',{...input,items:[input.items[0],{...input.items[1],error:'both'}]}),{code:'invalid_input'});
 assert.equal(f.commits,before);assert.equal((await f.read()).saved,0);
});

test('a failed page commit changes no outcomes; an acknowledged-lost page replays without overwriting later manual edits',async()=>{
 const f=setup();await f.create([await f.item('c0'),await f.item('c1')]);const input=await pageInput(f);
 f.fail('before');await assert.rejects(f.call('submit_analysis_results',input),/disk/);assert.equal((await f.read()).saved,0);
 f.fail('after');await assert.rejects(f.call('submit_analysis_results',input),/ack/);f.fail('');f.data.entries[0].text='保存后新改';
 assert((await f.call('submit_analysis_results',input)).replayed);assert.equal((await f.read()).saved,2);assert.equal(f.data.entries[0].text,'保存后新改');
});

test('cancel between pages preserves saved cases and prevents subsequent page writes',async()=>{
 const f=setup();await f.create([await f.item('c0'),await f.item('c1')]);const input=await pageInput(f);
 await f.call('submit_analysis_results',{...input,items:[input.items[0]]});await f.control('cancel');
 await assert.rejects(f.call('submit_analysis_results',{...input,requestId:'late-page',items:[input.items[1]]}),{code:'analysis_batch_canceled'});
 assert.equal((await f.read()).saved,1);assert.equal((await f.read()).pending,1);
});

test('reconnect discovers existing batches without reading cases, results or receipts; filters and paging stay scoped',async()=>{
 const f=setup();const item=await f.item('c0');
 for(let i=0;i<26;i++)await f.call('manage_analysis_batch',{action:'create',requestId:`task-${i}`,instruction:`广告 ${i}`,items:[item]});
 const first=await f.call('list_analysis_batches',{});assert.equal(first.total,26);assert.equal(first.batches.length,24);
 const next=await f.call('list_analysis_batches',{offset:first.nextOffset,expectedRevision:first.revision});assert.equal(next.batches.length,2);
 assert.equal(new Set([...first.batches,...next.batches].map(b=>b.id)).size,26);
 const found=await f.call('list_analysis_batches',{query:'广告 25',status:'collecting'});assert.equal(found.total,1);
 await f.call('manage_analysis_batch',{action:'seal',requestId:'seal-found',batchId:'task-25',expectedRevision:1});
 await assert.rejects(f.call('list_analysis_batches',{offset:24,expectedRevision:first.revision}),{code:'analysis_batch_changed'});
 await assert.rejects(f.call('list_analysis_batches',{query:'广告 2',offset:1,expectedRevision:found.revision}),{code:'analysis_batch_changed'});
 assert.equal((await f.call('list_analysis_batches',{status:'awaiting_results'})).total,1);
 f.switchLibrary('other');assert.equal((await f.call('list_analysis_batches',{})).total,0);
 const readKeys=[];
 const api=createExternalAnalysisBatches({storage:{getKeys:async()=>Object.keys(f.data),get:async keys=>{
   readKeys.push(...keys);assert(keys.every(k=>/^externalAnalysis:[^:]+$/.test(k)));return Object.fromEntries(keys.map(k=>[k,f.data[k]]));
 }},loadState:()=>assert.fail('discovery must not load the case library'),getLibraryId:async()=> 'library',enqueue:fn=>fn()});
 assert.equal((await api.execute('list_analysis_batches',{})).total,26);assert.equal(readKeys.length,26);
});

test('discovery never reports empty success on storage failure or library change',async()=>{
 const deps={enqueue:fn=>fn(),getLibraryId:async()=> 'library',storage:{getKeys:async()=>{throw Error('storage unavailable');}}};
 await assert.rejects(createExternalAnalysisBatches(deps).execute('list_analysis_batches',{}),/storage unavailable/);
 let calls=0;deps.storage.getKeys=async()=>[];deps.getLibraryId=async()=>++calls===1?'library':'changed';
 await assert.rejects(createExternalAnalysisBatches(deps).execute('list_analysis_batches',{}),{code:'library_mismatch'});
});

test('batch stores per-item outcomes atomically, preserves manual content and survives service recreation',async()=>{
 const f=setup();await f.create([await f.item('c0',true),await f.item('c1')]);await f.control('seal');
 const rows=(await f.read()).items;
 const saved=await f.submit(rows[0],{result:{...tags,mediaPrompts:[{assetId:'img',text:'逆推建议'}]},model:'test-model'});
 assert.equal(saved.item.state,'saved');assert.equal(saved.saved,1);assert.equal(saved.pending,1);
 const replay=await f.submit(rows[0],{result:{...tags,mediaPrompts:[{assetId:'img',text:'逆推建议'}]},model:'test-model'});assert(replay.replayed);
 assert.equal(f.data.entries[0].text,'人工正文');assert.equal(f.data.entries[0].mediaPrompts.find(p=>p.source==='manual').text,'真实原词');
 assert.equal(f.data.entries[0].mediaPrompts.filter(p=>p.source==='ai-suggestion').length,1);
 assert.equal(f.data.entries[0].facetAssignments[0].visualId,'img');
 const failed=await f.submit(rows[1],{error:'宿主模型超时'});assert.equal(failed.status,'partial');assert.equal(failed.failed,1);
 const result=await f.call('read_analysis_batch',{batchId:'batch',part:'result',caseId:'c0'});
 assert.equal(JSON.parse(result.content).output.model,'test-model');
 assert.equal(saved.item.savedRevision,await caseRevision(f.data,f.data.entries[0]));
 assert(!('items' in f.data['externalAnalysis:batch']),'progress metadata must not grow with the entire manifest');
});

test('cancel/resume rejects late epoch, retry rejects old attempt and preserves completed items',async()=>{
 const f=setup();await f.create([await f.item('c0'),await f.item('c1')]);const row=(await f.read()).items[0];
 await f.control('cancel');
 await assert.rejects(f.submit(row,{result:tags}),{code:'analysis_batch_canceled'});
 await f.control('resume');
 await assert.rejects(f.call('submit_analysis_result',{batchId:'batch',caseId:row.caseId,attemptId:row.attemptId,epoch:0,requestId:'late',result:tags}),{code:'analysis_epoch_changed'});
 await f.submit(row,{error:'失败'});
 const retried=await f.control('retry',[await f.item('c0')]);assert.notEqual(retried.item.attemptId,row.attemptId);
 await assert.rejects(f.submit(row,{result:tags},'old-attempt'),{code:'analysis_attempt_stale'});
 await f.submit(retried.item,{result:tags},'new-attempt');
 await assert.rejects(f.control('retry',[await f.item('c0')],'retry-saved'),{code:'analysis_item_not_failed'});
 assert.equal((await f.read()).saved,1);
});

test('manual edits, deleted cases and mutated bytes become item failures without overwriting any case',async()=>{
 const f=setup(3);await f.create([await f.item('c0'),await f.item('c1'),await f.item('c2',true)]);const rows=(await f.read()).items;
 f.data.entries[0].text='用户新编辑';f.data.entries=f.data.entries.filter(e=>e.id!=='c1');f.blobs.set('img',new Blob(['changed']));
 const before=structuredClone(f.data.entries);
 for(const [i,code] of ['case_conflict','case_not_found','analysis_media_changed'].entries()) assert.equal((await f.submit(rows[i],{result:tags})).item.error.code,code);
 assert.deepEqual(f.data.entries,before);assert.equal((await f.read()).failed,3);
});

test('commit failure is retryable; lost acknowledgement replays without duplicate tags or counts',async()=>{
 const f=setup();await f.create([await f.item('c0')]);const row=(await f.read()).items[0];
 f.fail('before');await assert.rejects(f.submit(row,{result:tags}),/disk/);assert.equal((await f.read()).saved,0);
 f.fail('after');await assert.rejects(f.submit(row,{result:tags}),/ack/);f.fail('');
 assert((await f.submit(row,{result:tags})).replayed);assert.equal((await f.read()).saved,1);
 assert.equal(f.data.entries[0].facetAssignments.length,1);
});

test('registration pages reject duplicates and stale versions; receipt and data never cross libraries',async()=>{
 const f=setup(28);await f.create(await Promise.all(Array.from({length:25},(_,i)=>f.item(`c${i}`))));
 const page=await f.read();assert.equal(page.items.length,24);assert.equal(page.nextOffset,24);
 await f.control('add',[await f.item('c25')]);
 await assert.rejects(f.call('read_analysis_batch',{batchId:'batch',offset:24,expectedRevision:page.revision}),{code:'analysis_batch_changed'});
 await assert.rejects(f.control('add',[await f.item('c0')],'duplicate'),{code:'analysis_item_duplicate'});
 assert.equal((await f.read()).total,26);
 f.switchLibrary('elsewhere');await assert.rejects(f.read(),{code:'library_mismatch'});
});

test('parallel results for one case commit once; a different payload cannot reuse the receipt',async()=>{
 const f=setup();await f.create([await f.item('c0')]);const row=(await f.read()).items[0];
 const results=await Promise.allSettled([f.submit(row,{result:tags},'one'),f.submit(row,{result:tags},'two')]);
 assert.equal(results.filter(r=>r.status==='fulfilled').length,1);assert.equal((await f.read()).saved,1);
 await assert.rejects(f.submit(row,{result:{tags:[{g:'scene.weather'}]}},'one'),{code:'request_conflict'});
});

test('invalid scope, duplicate/overlong tags and existing AI edits fail wholly, preserving manual and AI data',async()=>{
 for(const bad of [{mediaPrompts:[{assetId:'other',text:'bad'}]},{tags:[...tags.tags,...tags.tags]},{tags:[{g:'scene.place',t:'长'.repeat(81)}]}]) {
  const f=setup();await f.create([await f.item('c0',true)]);const row=(await f.read()).items[0],before=structuredClone(f.data.entries);
  assert.equal((await f.submit(row,{result:bad})).item.state,'failed');assert.deepEqual(f.data.entries,before);
 }
 const f=setup();f.data.entries[0].mediaPrompts.push({assetId:'img',source:'ai-suggestion',text:'人工改过的AI词'});
 await f.create([await f.item('c0',true)]);const row=(await f.read()).items[0];
 assert.equal((await f.submit(row,{result:{mediaPrompts:[{assetId:'img',text:'覆盖'}]}})).item.error.code,'manual_analysis_conflict');
});

test('internal composer uses the same batch contract and reports failed item instead of claiming a save',async()=>{
 const f=setup();const session={libraryRetrievalEnabled:true,messages:[{id:'u'}],referenceSnapshots:[{entryId:'c0'}]};const events=[];
 const tools=withComposerCaseOperations({session,tools:{specs:[],instructions:''},invoke:f.call,onEvent:event=>events.push(event)});
 const created=await tools.execute('manage_analysis_batch',{action:'create',requestId:'batch',instruction:'文字分析',items:[await f.item('c0')]},{callId:'create'});
 assert(created.data.ok);
 const result=await tools.execute('submit_analysis_result',{requestId:'bad',batchId:'batch',caseId:'c0',attemptId:created.data.item.attemptId,epoch:0,error:'模型失败'},{callId:'submit'});
 assert.equal(result.data.item.state,'failed');assert.match(events.at(-1).label,/未写入/);
});

test('internal reconnect discovers then reads cases before submitting a page and reports partial success truthfully',async()=>{
 const f=setup();await f.create([await f.item('c0'),await f.item('c1')]);const input=await pageInput(f),events=[];
 const tools=withComposerCaseOperations({session:{messages:[{id:'u'}]},tools:{specs:[],instructions:''},invoke:f.call,onEvent:event=>events.push(event)});
 assert.equal((await tools.execute('list_analysis_batches',{},{})).data.total,1);assert.equal(events.at(-1).label,'已读取资料');
 assert.match((await tools.execute('submit_analysis_results',input,{})).data.error,/先查询/);
 await tools.execute('read_analysis_batch',{batchId:'batch'},{});
 f.data.entries[1].text='新人工编辑';
 const result=await tools.execute('submit_analysis_results',input,{});
 assert.deepEqual(result.data.items.map(i=>i.state),['saved','failed']);assert.equal(events.at(-1).label,'部分分析结果已保存，请查看失败项');
});

test('batch membership indexing matches single-case revisions without repeated project scans',async()=>{
 const {caseOrganizationIndex}=await import('../extension/case-operations.js');const f=setup(1000);
 let traversals=0;
 const ids=f.data.entries.map(e=>e.id);
 ids[Symbol.iterator]=function*(){traversals++;for(let i=0;i<this.length;i++)yield this[i];};
 f.data.organizerState.collections=[{id:'project',entryIds:ids}];
 f.data.compoundCases=[{id:'group',memberEntryIds:['c0','c1']}];
 const index=caseOrganizationIndex(f.data,['c0','c1','c999']);
 assert.equal(traversals,1);
 for(const id of index.keys())assert.equal(await caseRevision(f.data,f.data.entries.find(e=>e.id===id),index.get(id)),await caseRevision(f.data,f.data.entries.find(e=>e.id===id)));
});

test('video notes append without changing old notes; invalid ranges reject the entire result',async()=>{
 const f=setup();f.blobs.set('video',new Blob(['video']));
 f.data.entries[0]=normalizeEntryMedia({...f.data.entries[0],mediaAssets:[{id:'video',kind:'video',storageMode:'managed',durationMs:3000}],timeNotes:[{id:'human',assetId:'video',startMs:200,text:'人工判断'}]});
 const item={caseId:'c0',expectedRevision:await caseRevision(f.data,f.data.entries[0]),assets:[{assetId:'video',sha256:await sha256Blob(f.blobs.get('video')),coverage:'测试时间范围'}]};
 await f.create([item]);const row=(await f.read()).items[0];
 const bad=await f.submit(row,{result:{timeNotes:[{assetId:'video',startMs:4000,text:'超长'}]}});assert.equal(bad.item.state,'failed');
 const retried=await f.control('retry',[item]);
 const valid=await f.submit(retried.item,{result:{timeNotes:[{assetId:'video',startMs:1000,endMs:2000,text:'AI节奏观察'}]}},'valid');
 assert.equal(valid.item.state,'saved');assert.equal(f.data.entries[0].timeNotes.length,2);assert.equal(f.data.entries[0].timeNotes[0].text,'人工判断');
});

test('taxonomy pagination refuses changed taxonomy even when batch status is unchanged',async()=>{
 const f=setup();await f.create([await f.item('c0')]);
 const first=await f.call('read_analysis_batch',{batchId:'batch',part:'taxonomy'});
 f.data.facetCatalog.nodes[0].name='更改分类名';f.data.facetCatalog.nodes[0].nameEn='Changed';
 // Use the exact localized field consumed by the payload.
 f.data.facetCatalog.nodes[0].labels={...f.data.facetCatalog.nodes[0].labels,'zh-CN':'更改分类'};
 f.data.facetCatalog.nodes[0].status='archived';
 await assert.rejects(f.call('read_analysis_batch',{batchId:'batch',part:'taxonomy',offset:1,expectedRevision:first.revision,expectedContentRevision:first.contentRevision}),{code:'analysis_taxonomy_changed'});
});

 test('cancel remains effective when ordinary result progress advanced after the status read',async()=>{
 const f=setup();await f.create([await f.item('c0'),await f.item('c1')]);const before=await f.read();
 await f.submit(before.items[0],{result:tags});
 const canceled=await f.call('manage_analysis_batch',{action:'cancel',batchId:'batch',requestId:'stop',expectedRevision:before.revision,epoch:before.epoch});
 assert.equal(canceled.status,'canceled');assert.equal(canceled.saved,1);
 await assert.rejects(f.submit(before.items[1],{result:tags}),{code:'analysis_batch_canceled'});
});
