import test from 'node:test';
import assert from 'node:assert/strict';
import { createCreativeSkill, saveCreativeSkillVersion } from '../extension/creative-skills.js';
import { createSkillOperations } from '../extension/skill-operations.js';
import { AGENT_CHUNK_BYTES } from '../extension/agent-protocol.js';
import { createComposerWorkspaceTools } from '../extension/composer-workspace-tools.js';
import { createComposerSession } from '../extension/composer.js';

function fixture() {
  const blobs = new Map([
    ['main',new Blob(['---\nname: cinema\ndescription: Original\ncustom: preserve\n---\nOriginal main'])],
    ['script',new Blob(['print("逐帧核验")\n'.repeat(20000)])],
    ['binary',new Blob([new Uint8Array([255,0,128,9])])]
  ]);
  const created = createCreativeSkill({}, {callName:'动漫电影',portableId:'cinema',description:'电影工作流',skillMarkdown:'第一稿',
    references:[{path:'references/prompts.md',markdown:'原始提示词'.repeat(6000)}],
    packageFiles:[{path:'cinema/SKILL.md',assetId:'main'}, {path:'cinema/scripts/frames.py',assetId:'script'},
      {path:'cinema/references/original.bin',assetId:'binary'}]});
  let state = {creativeSkills:created.state}; let reads = 0;
  const service = createSkillOperations({loadState:async()=>structuredClone(state),readBlob:async id=>{reads++;return blobs.get(id);}});
  return {service,blobs,skill:created.skill,get reads(){return reads;},get state(){return state;},set state(v){state=v;}};
}
async function complete(service, name, input) {
  let content = ''; let result;
  do {
    result = await service.execute(name,{...input,...(result ? {offset:result.nextOffset,expectedRevision:result.revision, ...(result.sha256?{expectedHash:result.sha256}:{})}: {})});
    content += result.content;
  } while(result.nextOffset !== null);
  return {result,content};
}
test('Skill reads keep current text, full prompt references and imported package distinct; scripts are never run',async()=>{
  const f=fixture(); const id=f.skill.id;
  const updated=saveCreativeSkillVersion(f.state.creativeSkills,id,{skillMarkdown:'人工修改后的当前方法',references:f.skill.versions[0].references});
  f.state={creativeSkills:updated.state};
  const body=await f.service.execute('read_skill',{skillId:id});
  assert.equal(body.content,'人工修改后的当前方法');
  const refs=JSON.parse((await complete(f.service,'read_skill',{skillId:id,part:'references'})).content);
  assert.equal(refs.references[0].markdown,'原始提示词'.repeat(6000));
  const files=JSON.parse((await complete(f.service,'read_skill',{skillId:id,part:'files'})).content);
  assert.equal(f.reads,0,'Metadata reads must not open all package blobs');
  assert.ok(files.some(file=>file.source==='current'&&file.path==='SKILL.md'));
  assert.ok(files.some(file=>file.source==='package'&&file.path==='cinema/scripts/frames.py'));
  const base={skillId:id,expectedRevision:body.revision};
  const current=await f.service.execute('read_skill_file',{...base,source:'current',path:'SKILL.md'});
  assert.match(current.content,/人工修改后的当前方法/);
  const original=await f.service.execute('read_skill_file',{...base,source:'package',path:'cinema/SKILL.md'});
  assert.match(original.content,/custom: preserve/);assert.match(original.content,/Original main/);
  const script=await complete(f.service,'read_skill_file',{...base,source:'package',path:'cinema/scripts/frames.py'});
  assert.equal(script.content,await f.blobs.get('script').text());
  assert.equal(script.result.packageFileScope,'version');
  const versions=JSON.parse((await complete(f.service,'read_skill',{skillId:id,part:'versions'})).content);
  assert.equal(versions.length,2);assert.equal(versions[0].skillMarkdown,'第一稿');
});
test('Skill page/file reads reject edits, deletion, missing files, mixed byte contents and unlisted asset access',async()=>{
  const f=fixture();const skillId=f.skill.id;
  const read=await f.service.execute('read_skill',{skillId});
  const input={skillId,expectedRevision:read.revision,source:'package',path:'cinema/scripts/frames.py',encoding:'binary'};
  const first=await f.service.execute('read_skill_file',input);
  assert.equal(first.nextOffset,AGENT_CHUNK_BYTES);
  await assert.rejects(f.service.execute('read_skill_file',{...input,offset:first.nextOffset}),{code:'skill_hash_required'});
  f.blobs.set('script',new Blob(['changed']));
  await assert.rejects(f.service.execute('read_skill_file',{...input,offset:first.nextOffset,expectedHash:first.sha256}),{code:'skill_file_changed'});
  await assert.rejects(f.service.execute('read_skill_file',{...input,path:'../private'}),{code:'skill_file_not_found'});
  f.blobs.delete('script');
  await assert.rejects(f.service.execute('read_skill_file',input),{code:'skill_file_missing'});
  await assert.rejects(f.service.execute('read_skill',{skillId,offset:1}),{code:'skill_revision_required'});
  f.state.creativeSkills.items[0].versions[0].references[0].markdown='更新原词';
  await assert.rejects(f.service.execute('read_skill',{skillId,expectedRevision:read.revision}),{code:'skill_changed'});
  f.state.creativeSkills.items=[];
  await assert.rejects(f.service.execute('read_skill_file',input),{code:'skill_not_found'});
});
test('Binary Skill references retain exact bytes and reject silent lossy UTF-8 decoding',async()=>{
  const f=fixture();const skillId=f.skill.id;
  const {revision}=await f.service.execute('read_skill',{skillId});
  const input={skillId,expectedRevision:revision,source:'package',path:'cinema/references/original.bin'};
  await assert.rejects(f.service.execute('read_skill_file',input),{code:'skill_file_binary'});
  const bytes=await f.service.execute('read_skill_file',{...input,encoding:'binary'});
  assert.deepEqual([...Buffer.from(bytes.data,'base64')],[255,0,128,9]);
  assert.equal(bytes.nextOffset,null);
});
test('Plain Markdown Skills without descriptions remain fully readable without fabricated metadata',async()=>{
  const {state,skill}=createCreativeSkill({}, {callName:'无说明',skillMarkdown:'原文保留'});
  const service=createSkillOperations({loadState:async()=>({creativeSkills:state})});
  const body=await service.execute('read_skill',{skillId:skill.id});
  assert.equal(body.currentFileHasFrontmatter,false);
  const files=await service.execute('read_skill',{skillId:skill.id,part:'files'});
  assert.equal(JSON.parse(files.content)[0].path,'SKILL.md');
  const file=await service.execute('read_skill_file',{skillId:skill.id,expectedRevision:body.revision,source:'current',path:'SKILL.md'});
  assert.equal(file.content,'原文保留');assert.equal(file.description,'');
});
test('Skill listing pagination detects changes and internal tools use the shared service with case search disabled',async()=>{
  const f=fixture();
  for(let i=0;i<25;i++) f.state.creativeSkills.items.push({...structuredClone(f.skill),id:`copy-${i}`,callName:`镜头${i}`});
  const first=await f.service.execute('list_skills',{});
  assert.equal(first.items.length,24);assert.equal(first.nextOffset,24);
  const next=await f.service.execute('list_skills',{offset:24,expectedRevision:first.revision});assert.equal(next.items.length,2);
  f.state.creativeSkills.items[0].description='新说明';
  await assert.rejects(f.service.execute('list_skills',{offset:24,expectedRevision:first.revision}),{code:'skill_changed'});
  const tools=createComposerWorkspaceTools({session:createComposerSession({libraryRetrievalEnabled:false}),caseTools:{specs:[],instructions:''},
    loadState:async()=>{throw Error('Must not load unrelated sessions/settings');},invokeSkill:(name,args)=>f.service.execute(name,args)});
  const inside=await tools.execute('read_skill',{skillId:f.skill.id},{callId:'same'});
  assert.deepEqual(inside.data,await f.service.execute('read_skill',{skillId:f.skill.id}));
  const invalid=await tools.execute('read_skill',{skillId:f.skill.id,length:0},{callId:'invalid'});
  assert.ok(invalid.data.error);
});
