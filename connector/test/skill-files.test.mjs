import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PassThrough } from 'node:stream';
import { randomUUID } from 'node:crypto';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import { startNativeHost } from '../native-host.mjs';
import { frameDecoder, encodeFrame } from '../framing.mjs';
import { createSkillOperations } from '../../extension/skill-operations.js';
import { createAgentTransfers } from '../../extension/agent-transfers.js';
import { skillPackageLimits } from '../../extension/creative-skill-package.js';
import { createSkillWriter } from '../../extension/skill-writer.js';
import { createCreativeSkill } from '../../extension/creative-skills.js';

test('MCP transfers full Skill packages, updates/restores script versions, downloads exact files and rejects stale cache after deletion',async()=>{
  const root=await mkdtemp(join(tmpdir(),'pd-skill-mcp-'));
  // Agent-authored sources live outside the connector's private pairing directory.
  const source=await mkdtemp(join(tmpdir(),'pd-skill-source-'));
  const instanceId=randomUUID(), extensionId='a'.repeat(32);
  await writeFile(join(root,'config.json'),JSON.stringify({extensionId}));
  await writeFile(join(root,'selected.json'),JSON.stringify({instanceId}));
  const bytes=Buffer.from('print("参考原词")\n'.repeat(30000));
  const {state,skill}=createCreativeSkill({}, {callName:'镜头',description:'测试脚本',skillMarkdown:'使用scripts/frames.py',
    packageFiles:[{path:'scripts/frames.py',assetId:'script',byteSize:bytes.length}]});
  const data={creativeSkills:state},blobs=new Map([['script',new Blob([bytes])]]);
  const storage={async get(keys){return structuredClone(Object.fromEntries((typeof keys==='string'?[keys]:keys??Object.keys(data)).filter(key=>key in data).map(key=>[key,data[key]])));},
    async set(update){Object.assign(data,structuredClone(update));},async remove(key){delete data[key];}};
  const transfers=createAgentTransfers({storage,readBlob:async id=>blobs.get(id),writeBlob:async(id,blob)=>blobs.set(id,blob),deleteBlob:async id=>blobs.delete(id),prepare:async()=>{throw Error('Unexpected media preparation');}});
  const writer=createSkillWriter({storage,transfers,readBlob:async id=>blobs.get(id),commit:update=>storage.set(update),enqueue:fn=>fn()});
  const service=createSkillOperations({loadState:async()=>data,readBlob:async id=>blobs.get(id)});
  let writesSupported=true, uploads=0;
  const dispatch=(name,input)=>{
    if(name==='status')return Promise.resolve({capabilities:writesSupported?['save_skill','restore_skill']:[],skillPackageLimits:skillPackageLimits()});
    if(name==='begin_transfer')uploads++;
    if(['save_skill','restore_skill'].includes(name))return writer.execute(name,input);
    const action={begin_transfer:'begin',append_transfer:'append',finish_transfer:'finish'}[name];
    return action?transfers[action](input):service.execute(name,input);
  };
  let chunks=0,input,output,host;
  // Chrome starts a new native host whenever the extension is reloaded or replaced by another version.
  const startExtensionHost=async()=>{
    let ready;
    const readiness=new Promise(resolve=>{ready=resolve;});
    input=new PassThrough();output=new PassThrough();
    const reply=input;
    output.on('data',frameDecoder(message=>{
      if(message.type==='ready')ready();
      if(message.type==='request'){
        if(message.operation==='read_skill_file')chunks++;
        dispatch(message.operation,message.input).then(result=>reply.write(encodeFrame({type:'response',id:message.id,result})),
          error=>reply.write(encodeFrame({type:'response',id:message.id,error:{code:error.code,message:error.message}})));
      }
    }));
    host=await startNativeHost({root,origin:`chrome-extension://${extensionId}/`,input,output});
    input.write(encodeFrame({type:'hello',protocolVersion:1,extensionId,instanceId}));await readiness;
  };
  const client=new Client({name:'skill-file-test',version:'1'});
  try{
    await startExtensionHost();
    await client.connect(new StdioClientTransport({command:process.execPath,args:[fileURLToPath(new URL('../mcp.mjs',import.meta.url))],env:{...process.env,PROMPTDIRECTOR_CONNECTOR_HOME:root}}));
    const invoke=async(name,args)=>{
      const result=await client.callTool({name:`promptdirector_${name}`,arguments:args});
      return {...JSON.parse(result.content[0].text),isError:result.isError};
    };
    const read=await invoke('read_skill',{skillId:skill.id});assert(!read.isError);
    const args={skillId:skill.id,expectedRevision:read.revision,source:'package',path:'scripts/frames.py'};
    const first=await invoke('download_skill_file',args);assert(!first.isError,JSON.stringify(first));
    assert.equal(first.relativePath,args.path);assert(chunks>1);
    assert.deepEqual(await readFile(first.path),bytes);
    chunks=0;const reused=await invoke('download_skill_file',args);assert.equal(reused.path,first.path);assert.equal(chunks,1);
    const mainPath=join(source,'SKILL.md'),scriptPath=join(source,'frames.py'),emptyPath=join(source,'__init__.py');
    await writeFile(mainPath,'---\nname: native-skill\ndescription: Native write\ncustom: keep\n---\nUse scripts/frames.py\n');
    await writeFile(scriptPath,'print("first")');await writeFile(emptyPath,'');
    const saveArgs={requestId:'native-write',files:[{path:mainPath,packagePath:'SKILL.md'},{path:scriptPath,packagePath:'scripts/frames.py'},{path:emptyPath,packagePath:'scripts/__init__.py'}]};
    const saved=await invoke('save_skill',saveArgs);assert(saved.ok,JSON.stringify(saved));assert.equal(saved.fileCount,3);
    const uploadCount=uploads;
    const invalid=await invoke('save_skill',{...saveArgs,requestId:'mixed-input',skillMarkdown:'另一份正文'});
    assert(invalid.isError);assert.equal(invalid.code,'invalid_input');assert.equal(uploads,uploadCount,'mutually exclusive input must fail before any native upload');
    assert((await invoke('save_skill',saveArgs)).replayed);
    await writeFile(scriptPath,'print("second")');
    const updated=await invoke('save_skill',{...saveArgs,requestId:'native-update',skillId:saved.skillId,expectedRevision:saved.revision});assert(updated.ok,JSON.stringify(updated));
    const historical=await invoke('download_skill_file',{skillId:saved.skillId,versionId:saved.versionId,expectedRevision:updated.revision,source:'package',path:'scripts/frames.py'});
    assert(!historical.isError,JSON.stringify(historical));assert.equal(await readFile(historical.path,'utf8'),'print("first")');
    const restored=await invoke('restore_skill',{requestId:'native-restore',skillId:saved.skillId,expectedRevision:updated.revision,versionId:saved.versionId});assert(restored.ok,JSON.stringify(restored));
    const file=await invoke('read_skill_file',{skillId:saved.skillId,expectedRevision:restored.revision,source:'package',path:'scripts/frames.py'});assert.equal(file.content,'print("first")');
    writesSupported=false;
    await host.close();input.destroy();output.destroy();
    await startExtensionHost();
    const before=uploads;
    const unsupported=await invoke('save_skill',{...saveArgs,requestId:'old-backend'});
    assert(unsupported.isError);assert.match(JSON.stringify(unsupported),/尚不支持Skill写入/);
    assert.equal(uploads,before,'an old installed extension must refuse before uploading package files');
    data.creativeSkills.items=[];
    const missing=await invoke('download_skill_file',args);assert(missing.isError);assert.equal(missing.code,'skill_not_found');
  }finally{
    await client.close();await host.close();input.destroy();output.destroy();await rm(root,{recursive:true,force:true});await rm(source,{recursive:true,force:true});
  }
});
