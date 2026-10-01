import test from 'node:test';
import assert from 'node:assert/strict';
import { createSkillWriter } from '../extension/skill-writer.js';
import { createSkillOperations } from '../extension/skill-operations.js';
import { createAgentTransfers } from '../extension/agent-transfers.js';
import { sha256Blob } from '../extension/blob-digest.js';
import { bytesToBase64 } from '../extension/agent-protocol.js';
import { skillFileOwners } from '../extension/skill-files.js';
import { createCreativeSkill, saveCreativeSkillVersion, skillPackageAssetIds, mergeCreativeSkillsState } from '../extension/creative-skills.js';
import { libraryStoredAssetIds, libraryAssetCleanupCandidates } from '../extension/library-asset-inventory.js';
import { parseLibraryPackage, mergeLibraryPackage } from '../extension/library-package.js';
import { attachSyncImageReferences, collectSyncAssets } from '../extension/sync-model.js';
import { validatePortableAssetRecord } from '../extension/media-store.js';
import { createVerifiedLibraryZip } from '../extension/library-export-zip.js';

function fixture() {
  const data={},blobs=new Map();let failCommit='',commits=0,prepared=0,queue=Promise.resolve();
  const storage={async get(keys){return structuredClone(Object.fromEntries((typeof keys==='string'?[keys]:keys??Object.keys(data)).filter(k=>k in data).map(k=>[k,data[k]])));},
    async set(value){Object.assign(data,structuredClone(value));},async remove(key){delete data[key];}};
  const transfers=createAgentTransfers({storage,readBlob:async id=>blobs.get(id),writeBlob:async(id,blob)=>{validatePortableAssetRecord(id,blob);blobs.set(id,blob);},deleteBlob:async id=>blobs.delete(id),prepare:async()=>{prepared++;throw Error('Must not treat scripts as media');}});
  const enqueue=fn=>{const result=queue.then(fn,fn);queue=result.catch(()=>{});return result;};
  const cleanup=async ids=>{for(const id of ids)if(!libraryStoredAssetIds(data).has(id))blobs.delete(id);};
  const deps={storage,transfers,readBlob:async id=>blobs.get(id),enqueue,cleanup,commit:async update=>{
    commits++;if(failCommit==='before')throw Error('write failed');await storage.set(update);if(failCommit==='after')throw Error('ack lost');
  }};
  const reader=createSkillOperations({loadState:async()=>structuredClone(data),readBlob:deps.readBlob});
  let sequence=0;
  async function stage(files) {
    const result=[];
    for(const [path,value] of Object.entries(files)){
      const blob=value instanceof Blob?value:new Blob([value]);const id=`upload-${++sequence}`;
      const begin=await transfers.begin({id,name:path.split('/').at(-1),byteSize:blob.size,sha256:await sha256Blob(blob),purpose:'skill-file'});
      for(let offset=0;offset<blob.size;offset+=begin.chunkBytes)await transfers.append({id,offset,data:bytesToBase64(new Uint8Array(await blob.slice(offset,offset+begin.chunkBytes).arrayBuffer()))});
      await transfers.finish({id});result.push({path,transferId:id});
    }
    return result;
  }
  return {data,blobs,storage,transfers,reader,stage,writer:()=>createSkillWriter(deps),get prepared(){return prepared;},get commits(){return commits;},set failCommit(v){failCommit=v;}};
}
const main=body=>`---\nname: anime-film\ndescription: 动漫电影\ncustom: preserve\n---\n${body}\n`;
const pack=body=>({'SKILL.md':main(body),'scripts/frames.py':`print('${body}')`,'scripts/__init__.py':'','references/prompts.md':`原词 ${body}`,'assets/data.bin':new Blob([new Uint8Array([255,0,128,9])])});

test('complete Skill save/update/restore keeps historical scripts, prompt references, binary bytes and retry receipts',async()=>{
  const f=fixture();const a=await f.stage(pack('A'));
  const firstInput={requestId:'first',callName:'动漫电影',files:a};
  const first=await f.writer().execute('save_skill',firstInput);
  assert.equal(f.prepared,0);assert.equal(first.fileCount,5);
  assert.equal(f.data[f.transfers.key(a[0].transferId)].state,'committed');
  const repeated=await f.writer().execute('save_skill',firstInput);assert(repeated.replayed);assert.equal(repeated.skillId,first.skillId);
  assert.equal(f.data.creativeSkills.items.length,1);
  await assert.rejects(f.writer().execute('save_skill',{requestId:'duplicate-id',callName:'另一方法',files:a}),{code:'skill_identity_conflict'});
  const b=await f.stage(pack('B'));
  const second=await f.writer().execute('save_skill',{requestId:'second',skillId:first.skillId,expectedRevision:first.revision,files:b});
  const old=await f.reader.execute('read_skill_file',{skillId:first.skillId,versionId:first.versionId,expectedRevision:second.revision,source:'package',path:'scripts/frames.py'});
  assert.equal(old.content,"print('A')");assert.equal(old.packageFileScope,'version');
  const current=await f.reader.execute('read_skill_file',{skillId:first.skillId,expectedRevision:second.revision,source:'package',path:'assets/data.bin',encoding:'binary'});
  assert.deepEqual([...Buffer.from(current.data,'base64')],[255,0,128,9]);
  const before=structuredClone(f.data);
  const restored=await f.writer().execute('restore_skill',{requestId:'restore',skillId:first.skillId,expectedRevision:second.revision,versionId:first.versionId});
  assert.equal((await f.reader.execute('read_skill',{skillId:first.skillId})).content,'A');
  const script=await f.reader.execute('read_skill_file',{skillId:first.skillId,expectedRevision:restored.revision,source:'package',path:'scripts/frames.py'});
  assert.equal(script.content,"print('A')");
  assert.deepEqual(libraryAssetCleanupCandidates(before,f.data),[],'Restoring A must retain B and its historical originals');
  assert.equal(skillPackageAssetIds(f.data.creativeSkills.items[0]).length,10);
  await assert.rejects(f.transfers.abort({id:a[0].transferId}),{code:'already_committed'});
});

test('manual edits and stale/ambiguous requests never overwrite current methods or discard omitted references',async()=>{
  const f=fixture();const first=await f.writer().execute('save_skill',{requestId:'text',callName:'方法',description:'方法说明',skillMarkdown:'原文',references:[{path:'references/source.md',markdown:'原始提示词'}]});
  const second=await f.writer().execute('save_skill',{requestId:'edit',skillId:first.skillId,expectedRevision:first.revision,skillMarkdown:'改过的正文'});
  assert.equal(f.data.creativeSkills.items[0].versions.at(-1).references[0].markdown,'原始提示词');
  const snapshot=structuredClone(f.data);
  await assert.rejects(f.writer().execute('save_skill',{requestId:'stale',skillId:first.skillId,expectedRevision:first.revision,skillMarkdown:'覆盖'}),{code:'skill_changed'});
  await assert.rejects(f.writer().execute('save_skill',{requestId:'edit',skillId:first.skillId,expectedRevision:second.revision,skillMarkdown:'另一内容'}),{code:'request_conflict'});
  await assert.rejects(f.writer().execute('save_skill',{requestId:'bad-ref',skillId:first.skillId,expectedRevision:second.revision,skillMarkdown:'新稿',references:[{path:'../secret',markdown:'bad'}]}),{code:'invalid_input'});
  assert.deepEqual(f.data,snapshot);
  const race=await Promise.allSettled(['left','right'].map(requestId=>f.writer().execute('save_skill',{
    requestId,skillId:first.skillId,expectedRevision:second.revision,skillMarkdown:requestId
  })));
  assert.equal(race.filter(result=>result.status==='fulfilled').length,1);
  assert.equal(race.find(result=>result.status==='rejected').reason.code,'skill_changed');
});

test('failed commit retains staged files; lost acknowledgement replays the committed receipt without duplicate Skill or deleted originals',async()=>{
  const f=fixture();const files=await f.stage(pack('atomic'));const input={requestId:'atomic',files};
  f.failCommit='before';await assert.rejects(f.writer().execute('save_skill',input),/write failed/);
  assert.equal(f.data.creativeSkills,undefined);assert.equal(f.blobs.size,5);
  f.failCommit='after';await assert.rejects(f.writer().execute('save_skill',input),/ack lost/);
  assert.equal(f.data.creativeSkills.items.length,1);assert.equal(f.blobs.size,5);
  f.failCommit='';const retry=await f.writer().execute('save_skill',input);assert(retry.replayed);assert.equal(f.data.creativeSkills.items.length,1);
  assert.equal(f.commits,2);
});

test('unknown legacy script history is explicit; complete restore refuses it and text restore preserves current files',async()=>{
  const f=fixture();const created=createCreativeSkill({}, {callName:'旧方法',description:'说明',skillMarkdown:'current',packageFiles:[{path:'scripts/tool.py',assetId:'today'}]});
  created.skill.versions.unshift({...created.skill.versions[0],id:'legacy',skillMarkdown:'old text'});
  f.data.creativeSkills=created.state;f.blobs.set('today',new Blob(['current script']));
  const read=await f.reader.execute('read_skill',{skillId:created.skill.id,versionId:'legacy'});assert.equal(read.packageFileScope,'unrecorded');
  await assert.rejects(f.reader.execute('read_skill_file',{skillId:created.skill.id,versionId:'legacy',expectedRevision:read.revision,source:'package',path:'scripts/tool.py'}),{code:'skill_files_unrecorded'});
  const input={requestId:'legacy',skillId:created.skill.id,expectedRevision:read.revision,versionId:'legacy'};
  await assert.rejects(f.writer().execute('restore_skill',input),{code:'skill_files_unrecorded'});
  await f.writer().execute('restore_skill',{...input,mode:'text'});
  assert.equal(f.data.creativeSkills.items[0].packageFiles[0].assetId,'today');
});

test('historical Skill files survive backup parsing, conflicting IDs on import, sync references and version-limit cleanup',async()=>{
  const f=fixture();const a=await f.writer().execute('save_skill',{requestId:'a',files:await f.stage(pack('A'))});
  const b=await f.writer().execute('save_skill',{requestId:'b',skillId:a.skillId,expectedRevision:a.revision,files:await f.stage(pack('B'))});
  const archived=structuredClone(f.data.creativeSkills),files=new Map();
  for(const owner of skillFileOwners(archived.items[0]))for(const file of owner.packageFiles){
    file.archivePath=`skills/anime-film/${file.assetId.replaceAll(':','-')}/${file.path}`;files.set(file.archivePath,f.blobs.get(file.assetId));
  }
  const library={format:'prompt-case-library',version:5,entries:[],creativeSkills:archived};
  const parsed=parseLibraryPackage(library,files);assert.equal(parsed.skillAssets.size,10);
  const occupied=structuredClone(archived);occupied.items[0].id='existing';
  const imported=mergeLibraryPackage({entries:[],creativeSkills:occupied},library);
  const importedSkill=imported.state.creativeSkills.items.find(skill=>skill.id!== 'existing');
  assert.equal(skillPackageAssetIds(importedSkill).length,10);
  for(const owner of skillFileOwners(importedSkill))for(const file of owner.packageFiles){
    assert(!file.archivePath);assert(f.blobs.has(Object.keys(imported.packageAssetIdMap).find(id=>imported.packageAssetIdMap[id]===file.assetId)));
  }
  const refs=Object.fromEntries([...libraryStoredAssetIds(f.data)].map((id,i)=>[id,{objectId:(i+1).toString(16).padStart(64,'0'),contentType:'application/octet-stream'}]));
  const synced=attachSyncImageReferences(f.data,refs);assert.equal(collectSyncAssets(synced).length,10);
  for(const owner of skillFileOwners(synced.creativeSkills.items[0]))for(const file of owner.packageFiles)assert.equal(file.syncObjectId,refs[file.assetId].objectId);
  let revision=b.revision;
  for(let i=0;i<10;i++)({revision}=await f.writer().execute('save_skill',{requestId:`more-${i}`,skillId:a.skillId,expectedRevision:revision,files:await f.stage(pack(`new-${i}`))}));
  assert.equal(f.data.creativeSkills.items[0].versions.length,10);
  assert.equal(libraryStoredAssetIds(f.data).size,50);
  assert.equal(f.blobs.size,50,'Only versions no longer referenced anywhere may release files');
});

test('same file referenced under two historical paths survives verified ZIP export; conflicting bytes do not',async()=>{
  const f=fixture();const created=await f.writer().execute('save_skill',{requestId:'aliases',files:await f.stage(pack('shared'))});
  const skill=f.data.creativeSkills.items[0];
  f.data.creativeSkills=saveCreativeSkillVersion(f.data.creativeSkills,skill.id,{skillMarkdown:'Changed body'}).state;
  const archived=structuredClone(f.data.creativeSkills),files=new Map();
  const old=archived.items[0].versions.find(version=>version.id===created.versionId);
  old.packageFiles.find(file=>file.path==='scripts/frames.py').path='scripts/original.py';
  for(const owner of skillFileOwners(archived.items[0]))for(const file of owner.packageFiles){
    file.archivePath=`skills/anime/${file.assetId.replaceAll(':','-')}/${file.path}`;files.set(file.archivePath,f.blobs.get(file.assetId));
  }
  const data={format:'prompt-case-library',version:5,entries:[],creativeSkills:archived};
  const json=JSON.stringify(data);
  const fileList=()=>[{name:'library.json',data:json},...[...files].map(([name,data])=>({name,data}))];
  await createVerifiedLibraryZip(fileList(),json);
  const original=old.packageFiles.find(file=>file.path==='scripts/original.py');
  files.set(original.archivePath,new Blob(['Z'.repeat(original.byteSize)]));
  await assert.rejects(createVerifiedLibraryZip(fileList(),json),/冲突|校验/);
});

test('import keeps one file mapping when several Skills and their versions share the same original',()=>{
  const file={path:'scripts/tool.py',assetId:'shared',byteSize:4,archivePath:'skills/shared.py'};
  const first=createCreativeSkill({}, {callName:'First',skillMarkdown:'One',packageFiles:[file]});
  const second=createCreativeSkill(first.state, {callName:'Second',skillMarkdown:'Two',packageFiles:[file]});
  const history=saveCreativeSkillVersion(second.state,first.skill.id,{skillMarkdown:'Edited'});
  const existing=createCreativeSkill({}, {callName:'Existing',skillMarkdown:'Existing',packageFiles:[file]});
  const result=mergeCreativeSkillsState(existing.state,history.state);
  const mapped=result.packageAssetIdMap.shared;
  assert.notEqual(mapped,'shared','the existing library file identity stays independent');
  for(const skill of result.state.items.filter(item=>item.id!==existing.skill.id))
    for(const owner of skillFileOwners(skill))for(const retained of owner.packageFiles){
      assert.equal(retained.assetId,mapped,'one recovered file must serve every imported owner');
      assert(!retained.archivePath);
    }
});

test('corrupted or non-Skill transfers cannot be committed as Skill files',async()=>{
  const f=fixture();const files=await f.stage(pack('bad'));
  const record=await f.transfers.get(files[1].transferId);
  f.blobs.set(record.assetId,new Blob(['x'.repeat(record.byteSize)]));
  await assert.rejects(f.writer().execute('save_skill',{requestId:'damaged',files}),{code:'skill_file_missing'});
  assert.equal(f.data.creativeSkills,undefined);
  f.blobs.set(record.assetId,new Blob(["print('bad')"]));
  delete f.data[f.transfers.key(record.id)].purpose;
  await assert.rejects(f.writer().execute('save_skill',{requestId:'wrong-purpose',files}),{code:'transfer_not_ready'});
});
