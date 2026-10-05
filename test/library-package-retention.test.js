import test from 'node:test';
import assert from 'node:assert/strict';
import { createDefaultFacetCatalog, createFacetNode } from '../extension/facets.js';
import { createDefaultTaxonomy, SCHEMA_VERSION } from '../extension/taxonomy.js';
import { createComposerSession, normalizeComposerSettings } from '../extension/composer.js';
import { createCreativeSkill } from '../extension/creative-skills.js';
import { mergeLibraryPackage } from '../extension/library-package.js';
import { libraryStoredAssetIds } from '../extension/library-asset-inventory.js';
import { inspectLibraryTransfer, planLibraryTransfer, planLibraryTransferBatch } from '../extension/library-transfer.js';

const original = { id:'original-shared',kind:'image',storageMode:'managed',sourceTitle:'original.webp',sourceFormat:'webp',mimeType:'image/webp',byteSize:4,contentHash:'a'.repeat(64) };
const entry = (id, text, asset=original) => ({id,title:text,text,mediaAssets:asset?[asset]:[],primaryMediaId:asset?.id||'',facetAssignments:[]});
const deleted = { id:'trash:entry:deleted',kind:'entry',targetId:'deleted',deletedAt:'2026-10-01T00:00:00.000Z',snapshot:entry('deleted','可恢复原件'),relationships:{collections:[]} };
const empty = () => ({format:'prompt-case-library',version:5,schemaVersion:SCHEMA_VERSION,entries:[],taxonomy:createDefaultTaxonomy(),facetCatalog:createDefaultFacetCatalog(),classificationRules:[],settings:{},trashState:{version:1,items:[]},organizerState:{version:1,collections:[]},creativeSkills:{version:1,items:[]}});
const source = () => ({...empty(),entries:[entry('incoming','来源正文',{...original,contentHash:'b'.repeat(64),assetPath:'images/incoming/original.webp'})]});

test('safe merge after deleting the last active case retains recoverable cases, projects and unfinished creative work', () => {
  const current = empty();
  current.trashState.items = [deleted];
  current.organizerState.collections = [{id:'project',name:'未完成项目',entryIds:[]}];
  current.composerSessions = [createComposerSession({id:'unfinished',title:'未完成任务',messages:[{id:'request',role:'user',content:'保留完整创作要求'}]})];
  current.composerSettings = normalizeComposerSettings({lastTargetPlatform:'Seedance'});
  const result = mergeLibraryPackage(current,source());
  assert.equal(result.state.entries.length,1);
  assert.equal(result.state.trashState.items[0].snapshot.text,'可恢复原件');
  assert.ok(result.state.organizerState.collections.some(item=>item.id==='project'));
  assert.equal(result.state.composerSessions[0].messages[0].content,'保留完整创作要求');
  assert.equal(result.state.composerSettings.lastTargetPlatform,'Seedance');
});

test('zero active cases with only user configuration never reset that configuration during ordinary safe merge', () => {
  for (const configure of [
    current=>{current.settings={libraryTitle:'我的资料',outputPath:'我的资料.zip'};},
    current=>{current.classificationRules=[{hostname:'local.example',pathIds:[current.taxonomy.nodes[0].id],enabled:true}];},
    current=>{current.facetCatalog=createFacetNode(current.facetCatalog,{id:'mine',facetId:'mood',parentId:'mood.emotion',name:'个人词'});},
    current=>{current.composerSettings=normalizeComposerSettings({lastTargetPlatform:'Seedance'});},
    current=>{current.creativeExperimentSettings={enabled:true,autoAnalyze:true};}
  ]) {
    const current=empty(); configure(current);
    const result=mergeLibraryPackage(current,source());
    assert.deepEqual(result.state.settings.libraryTitle,current.settings.libraryTitle||'视觉创作灵感库');
    for (const key of ['classificationRules','composerSettings','creativeExperimentSettings']) {
      if (current[key]) assert.deepEqual(result.state[key],current[key],key);
    }
    if (current.facetCatalog.nodes.some(node=>node.id==='mine')) assert.ok(result.state.facetCatalog.nodes.some(node=>node.id==='mine'));
  }
});

const holders = {
  trash: current=>{current.trashState.items=[deleted];},
  folderHistory: current=>{current.folderOwnershipBackup={state:{entries:[entry('history','历史原件')]}};},
  replacementHistory: current=>{current.libraryReplacementRecoveryPoint={state:{entries:[entry('backup','恢复点原件')]}};},
  replacementRetained: current=>{current.libraryReplacementRecoveryPoint={retainedAssetIds:[original.id]};},
  staging: current=>{current.importStaging={assets:[{assetId:original.id}]};},
  job: current=>{current.creativeJobs={items:[{request:{session:{referenceSnapshots:[{sourceType:'temporary',assetRefs:[{assetId:original.id}]}]}}}]};},
  skill: current=>{current.creativeSkills={items:[{id:'existing-skill',name:'已有Skill',callName:'existing',packageFiles:[{assetId:original.id,path:'original.webp',mimeType:'image/webp',byteSize:4,contentHash:'a'.repeat(64)}]}]};}
};
for (const [owner,retain] of Object.entries(holders)) {
  test(`safe single and batch imports isolate different bytes from ${owner} originals even with zero active cases`,async()=>{
    const inspection=await inspectLibraryTransfer({sourceType:'share-package',library:source(),files:new Map([['images/incoming/original.webp',new Blob(['new!'],{type:'image/webp'})]])});
    for (const batch of [false,true]) {
      const current=empty(); retain(current);
      assert.ok(libraryStoredAssetIds(current,{includeLocalOnly:true}).has(original.id));
      const result=batch?planLibraryTransferBatch({currentState:current,inspections:[inspection]}):planLibraryTransfer({currentState:current,inspection});
      const writes=result.resourceWrites;
      assert.ok(writes.length);
      assert.ok(writes.every(write=>write.targetId!==original.id));
      const store=new Map([[original.id,new Blob(['old!'],{type:'image/webp'})]]);
      for (const write of writes) store.set(write.targetId,inspection.resources.assets.get(write.sourceId));
      assert.equal(await store.get(original.id).text(),'old!','recoverable original bytes must survive actual planned put writes');
      assert.equal(await store.get(result.targetState.entries[0].mediaAssets[0].id).text(),'new!');
    }
  });
}

test('all backup resource owners use isolated IDs rather than overwriting a recoverable case original',async()=>{
  const blob=new Blob(['new!'],{type:'image/webp'});
  for (const owner of ['trash','creative-output','temporary-reference','skill-file']) {
    const incoming=empty();
    let path;
    const files=new Map();
    if (owner==='trash') {
      path='images/deleted/original.webp';
      incoming.trashState.items=[{...deleted,snapshot:entry('deleted','不同的已删除案例',{...original,contentHash:'b'.repeat(64),assetPath:path})}];
    } else if (owner==='creative-output') {
      path='creative-results/run/original.webp';
      incoming.creativeRuns=[{id:'run',sessionId:'session',promptVersionId:'prompt',promptText:'新结果',targetType:'image',outputs:[{visual:{...original,contentHash:'b'.repeat(64),assetPath:path}}]}];
    } else if (owner==='temporary-reference') {
      path='temp-references/session/original.webp';
      incoming.composerSessions=[createComposerSession({id:'session',referenceSnapshots:[{entryId:'temp-reference:incoming',alias:'@参考1',title:'新临时参考',sourceType:'temporary',referenceKind:'reference',imageRefs:[{visualId:original.id,mimeType:'image/webp'}],assetRefs:[{assetId:original.id,kind:'image',mimeType:'image/webp',name:'original.webp',byteSize:4,contentHash:'b'.repeat(64),archivePath:path}]}]})];
    } else {
      path='skills/incoming/file/SKILL.md';
      incoming.creativeSkills=createCreativeSkill({}, {callName:'新方法',portableId:'incoming',skillMarkdown:'# 新方法',packageFiles:[{path:'SKILL.md',assetId:original.id,byteSize:4,mimeType:'text/markdown',archivePath:path}]},{id:'skill:incoming',versionId:'version:incoming'}).state;
    }
    files.set(path,owner==='skill-file'?new Blob(['new!'],{type:'text/markdown'}):blob);
    const inspection=await inspectLibraryTransfer({sourceType:'complete-backup',library:incoming,files});
    assert.equal(inspection.sourceType,'complete-backup',owner);
    const current=empty(); current.trashState.items=[deleted];
    const result=planLibraryTransfer({currentState:current,inspection});
    assert.ok(result.resourceWrites.length,owner);
    assert.ok(result.resourceWrites.every(write=>write.targetId!==original.id),owner);
    const store=new Map([[original.id,new Blob(['old!'],{type:'image/webp'})]]);
    for (const write of result.resourceWrites) store.set(write.targetId,(write.resourceType==='skill'?inspection.resources.skillAssets:inspection.resources.assets).get(write.sourceId));
    assert.equal(await store.get(original.id).text(),'old!',owner);
    assert.equal(result.targetState.trashState.items[0].snapshot.mediaAssets[0].id,original.id,owner);
  }
});
