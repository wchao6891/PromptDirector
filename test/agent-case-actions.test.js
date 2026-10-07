import test from 'node:test';
import assert from 'node:assert/strict';
import { createCaseTrashOperations } from '../extension/case-trash-operations.js';
import { operationCase } from '../extension/case-operations.js';
import { restoreTrashItems } from '../extension/trash.js';

function fixture() {
  const data={entries:['a','b','c'].map(id=>({id,title:id,text:'完整原词 '+id,mediaAssets:[{id:'image-'+id,kind:'image',storageMode:'managed',mimeType:'image/png'}]})),
    organizerState:{version:1,collections:[{id:'p',name:'项目',entryIds:['a','b','c']}]},
    compoundCases:[{id:'group',title:'组合',memberEntryIds:['a','b']}],trashState:{version:1,items:[]},visionAnalysisUndo:{a:{old:true},c:{keep:true}}};
  let tail=Promise.resolve(), commits=0,fail=false;
  const enqueue=fn=>{const next=tail.then(fn);tail=next.catch(()=>{});return next;};
  const storage={get:async key=>({[key]:structuredClone(data[key])})};
  const commit=async update=>{if(fail)throw Error('disk full');commits++;Object.assign(data,structuredClone(update));};
  const common={loadState:async()=>structuredClone(data),storage,commit,enqueue};
  const trash=createCaseTrashOperations(common);
  return {data,trash,fail:value=>{fail=value;},get commits(){return commits;}};
}
const input=async(f,id='a',requestId='request')=>({requestId,caseId:id,expectedRevision:(await operationCase(f.data,id)).revision});

test('recoverable compound removal and restoration preserve complete members, originals and project relationships',async()=>{
  const f=fixture();const before=structuredClone(f.data);const request=await input(f,'group');
  const result=await f.trash.execute(request);
  assert.equal(result.restorable,true);assert.deepEqual(result.movedEntryIds,['a','b']);
  assert.deepEqual(f.data.entries.map(e=>e.id),['c']);assert.equal(f.data.compoundCases.length,0);
  assert.equal(f.data.visionAnalysisUndo.a,undefined);assert.deepEqual(f.data.visionAnalysisUndo.c,{keep:true});
  const restored=restoreTrashItems(f.data,result.movedItemIds);Object.assign(f.data,restored);
  for(const original of before.entries){const current=f.data.entries.find(e=>e.id===original.id);assert.equal(current.text,original.text);assert.deepEqual(current.mediaAssets,original.mediaAssets);}
  assert.deepEqual(f.data.organizerState.collections[0].entryIds,['a','b','c']);
  assert.deepEqual(f.data.compoundCases[0].memberEntryIds,['a','b']);
  const replay=await f.trash.execute(request);assert.equal(replay.replayed,true);assert.equal(f.data.entries.length,3);
});

test('trash detects stale member changes and request reuse before any deletion; failed commit leaves no success receipt',async()=>{
  const f=fixture();const request=await input(f,'group');f.data.entries[1].text='另一页面修改';
  await assert.rejects(f.trash.execute(request),e=>e.code==='case_conflict');assert.equal(f.commits,0);
  const fresh=await input(f,'group');f.fail(true);await assert.rejects(f.trash.execute(fresh),/disk full/);
  assert.equal(f.data.entries.length,3);assert.equal(f.data['caseOperation:request'],undefined);
  f.fail(false);await f.trash.execute(fresh);
  await assert.rejects(f.trash.execute({...fresh,caseId:'c'}),e=>e.code==='request_conflict');
});

test('removing a member does not silently remove the rest of its compound or overwrite a conflicting trash snapshot',async()=>{
  const f=fixture();const request=await input(f);const result=await f.trash.execute(request);
  assert.deepEqual(result.movedEntryIds,['a']);assert.deepEqual(f.data.entries.map(e=>e.id),['b','c']);
  const second=fixture();second.data.trashState=f.data.trashState;
  const before=structuredClone(second.data);await assert.rejects(second.trash.execute(await input(second)),e=>e.code==='trash_conflict');
  assert.deepEqual(second.data,before);
});
