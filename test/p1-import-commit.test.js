import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const source=readFileSync(new URL('../extension/background.js',import.meta.url),'utf8');
const start=source.indexOf('async function applyCuratedImport(');
const importer=source.slice(start,source.indexOf('\nfunction curatedImportResponse(',start));
function fixture({commitFails=false}={}) {
  const calls=[];let saved;
  const result={state:{entries:[{id:'case',mediaAssets:[{id:'original'}]}]},importedEntryIds:['case']};
  const context=vm.createContext({STORAGE_KEYS:Object.fromEntries(['settings','composerSettings','composerSessions','creativeExperimentSettings','creativeRuns','creativeSkills'].map(x=>[x,x])),
    mergeCuratedLibraryPackage:()=>result,storagePayload:s=>s,
    commitLocalChanges:async update=>{calls.push('commit');if(commitFails)throw new Error('metadata write failed');saved=update;},
    enqueueAutomaticLibraryMaintenance:async()=>{calls.push('maintenance');throw new Error('maintenance unavailable');},
    queueAutomaticVisionAnalysis:async()=>{calls.push('vision');throw new Error('analysis queue unavailable');},
    curatedImportResponse:()=>({ok:true,importedEntryIds:['case']}),userMessage:e=>e.message,
    Set,...Object.fromEntries(['normalizeSettings','normalizeComposerSettings','normalizeComposerSessions','normalizeCreativeExperimentSettings','normalizeCreativeRuns','normalizeCreativeSkillsState'].map(x=>[x,v=>v]))});
  vm.runInContext(importer,context);return {calls,run:()=>context.applyCuratedImport({},{}),get saved(){return saved;}};
}
test('auxiliary failures after curated commit keep the successful receipt and referenced originals',async()=>{
  const f=fixture();const result=await f.run();assert.equal(result.ok,true);assert.equal(f.saved.entries[0].mediaAssets[0].id,'original');
  assert.deepEqual(f.calls,['commit','maintenance','vision']);assert.equal(result.warnings.length,2);
  assert.match(result.warnings.join(' '),/已保存/);
});
test('failed curated metadata commit stays a failure and starts no auxiliary task',async()=>{
  const f=fixture({commitFails:true});await assert.rejects(f.run(),/metadata write failed/);assert.deepEqual(f.calls,['commit']);assert.equal(f.saved,undefined);
});
