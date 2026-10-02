"""Opt-in startup trace for synthetic metadata, never a daily Chrome profile.

--budget-ms follows the current library-opening plan's one-second target.
Actual image decode, real library contents and daily installed acceptance are
separate evidence. CPU instrumentation lives only in a temporary source copy.
"""
import sys,json,tempfile,time,argparse,math
from pathlib import Path
from e2e_support import EXTENSION_DIR,extension_session
parser=argparse.ArgumentParser();parser.add_argument('--count',type=int,default=3871);parser.add_argument('--budget-ms',type=int,default=1000);parser.add_argument('--source',type=Path,default=EXTENSION_DIR);parser.add_argument('--history-bytes',type=int,default=0);parser.add_argument('--interactions',action='store_true')
a=parser.parse_args()
a.source=a.source.resolve()
with tempfile.TemporaryDirectory(prefix='pd-open-trace-code-') as tmp:
 ext=Path(tmp)
 for p in a.source.iterdir():
  if p.name not in ('background.js','library.js'):(ext/p.name).symlink_to(p,target_is_directory=p.is_dir())
 for name,names,scope in [('library.js',['refreshLibrary','rebuildLibraryDerivedState','rebuildLocalSimilarityIndex','rebuildLibrarySearchIndex','renderGallery','renderGalleryResults','renderNavigation','renderNextBatch','loadImageDerivedMetadata'],'window'),('background.js',['readState','readCaseLibraryState'],'globalThis')]:
  source=(a.source/name).read_text();wrappers=[]
  if name=='library.js':
   source=source.replace('const libraryStorage = getLibraryStorage();', '''const pdProbeStorage=getLibraryStorage();const libraryStorage={...pdProbeStorage,get:async keys=>{const start=performance.now();try{return await pdProbeStorage.get(keys);}finally{(window.pdOpenTimings??=[]).push({stage:'storage.get',keys,ms:performance.now()-start});}}};''')
  for fn in names:
   import re
   m=re.search(r'(async )?function '+fn+r'\(([^)]*)\)',source)
   if not m:continue
   source=source[:m.start()]+source[m.start():].replace('function '+fn+'(','function pdProbe_'+fn+'(',1)
   async_=bool(m.group(1));wrappers.append(('async ' if async_ else '')+'function '+fn+'(...args) {const start=performance.now();try{return '+('await ' if async_ else '')+'pdProbe_'+fn+'(...args);}finally{('+scope+'.pdOpenTimings??=[]).push({stage:'+json.dumps(fn)+',ms:performance.now()-start});}}')
  (ext/name).write_text(source+'\n'+'\n'.join(wrappers)+'\n')
 with extension_session('pd-open-probe-profile-',extension_dir=ext,viewport={'width':1440,'height':900}) as run:
  setup=run.open_page('collector.html')
  fixture=setup.evaluate('''async ({count,historyBytes})=>{
   const [{SCHEMA_VERSION},{createDefaultFacetCatalog},{createDefaultOrganizerState}]=await Promise.all([import('./taxonomy.js'),import('./facets.js'),import('./organizer.js')]);
   const tags=Array.from({length:400},(_,i)=>({id:`perf-tag-${i}`,name:`风格${i}`,facetId:'style',parentId:'style.render',order:i,aliases:[],patterns:[],status:'active',kind:'detail',origin:'manual'}));
   const entries=Array.from({length:count},(_,i)=>({schemaVersion:SCHEMA_VERSION,id:`open-${i}`,title:`开页案例${i}`,text:'镜头、光线、构图与人物动作的完整参考内容。'.repeat(30),textRevision:1,savedAt:new Date(Date.UTC(2026,8,1,0,0,i)).toISOString(),classification:{pathIds:['content:image-case'],status:'confirmed',source:'manual'},mediaAssets:[{id:`media-${i}`,kind:'image',usage:'content',storageMode:'managed',mimeType:'image/png',width:1280,height:720,byteSize:400000}],primaryMediaId:`media-${i}`,mediaPrompts:[{assetId:`media-${i}`,text:'保留的完整原词。'.repeat(30),source:'manual'}],facetAssignments:[{facetId:'style',nodeId:`perf-tag-${i%400}`,source:'manual',status:'confirmed'}],customLabels:['参考'],timeNotes:[]}));
   const facetCatalog=createDefaultFacetCatalog();facetCatalog.nodes.push(...tags);
   const organizerState=createDefaultOrganizerState();organizerState.collections=Array.from({length:148},(_,i)=>({id:`project-${i}`,name:`项目${i}`,order:i,entryIds:entries.filter((_,j)=>j%148===i).map(e=>e.id)}));
   await chrome.storage.local.set({schemaVersion:SCHEMA_VERSION,entries,facetCatalog,organizerState,compoundCases:[],trashState:{version:1,items:[]}});
   const {saveMediaBlob}=await import('./media-store.js');const blob=await(await fetch('data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==')).blob();for(const e of entries.slice(-96))await saveMediaBlob(e.primaryMediaId,blob);
   if(historyBytes)await chrome.storage.local.set({migrationBackup:{text:'历史'.repeat(Math.ceil(historyBytes/6))},analysisTasks:{version:1,tasks:[{text:'历史'.repeat(Math.ceil(historyBytes/6))}]}});
   return {count,bytes:new Blob([JSON.stringify(entries)]).size};
  }''',{'count':a.count,'historyBytes':a.history_bytes})
  worker=run.context.service_workers[0]; worker.evaluate('globalThis.pdOpenTimings=[]')
  page=run.context.new_page();page.add_init_script('''window.pdOpenMessages=[];const pdSend=chrome.runtime.sendMessage.bind(chrome.runtime);chrome.runtime.sendMessage=async(...args)=>{const s=performance.now();try{return await pdSend(...args);}finally{window.pdOpenMessages.push({type:args[0]?.type,ms:performance.now()-s});}};''')
  console=[]
  run.context.on('console',lambda msg: console.append(msg.text[:400]) if msg.type=='error' else None)
  cdp=run.context.new_cdp_session(page);cdp.send('Profiler.enable');cdp.send('Profiler.start')
  started=time.monotonic();page.goto(f'chrome-extension://{run.extension_id}/library.html',wait_until='domcontentloaded');page.wait_for_selector('body[data-library-state="ready"]',timeout=60000);
  if page.locator('.case-card').count()==0:
   print(json.dumps({'count':a.count,'fixtureBytes':fixture['bytes'],'failure':'ready-without-cards','messages':page.evaluate('window.pdOpenMessages'),'console':console,'text':page.locator('body').inner_text()[:1500]},ensure_ascii=False),flush=True)
   raise AssertionError('The gallery must show cards after becoming ready')
  ready=(time.monotonic()-started)*1000
  profile=cdp.send('Profiler.stop')['profile'];nodes={n['id']:n for n in profile['nodes']};cost={}
  for n,d in zip(profile.get('samples',[]),profile.get('timeDeltas',[])):
   f=nodes[n]['callFrame'];key=f['functionName'] or f['url'].split('/')[-1];cost[key]=cost.get(key,0)+d/1000
  result={'count':a.count,'fixtureBytes':fixture['bytes'],'historyBytesPerKey':a.history_bytes,'readyMs':round(ready,1),'pageStages':page.evaluate('window.pdOpenTimings'),'messages':page.evaluate('window.pdOpenMessages'),'backgroundStages':worker.evaluate('globalThis.pdOpenTimings'),'cpuTop':sorted(cost.items(),key=lambda kv:-kv[1])[:20],'cards':page.locator('.case-card').count()}
  if a.interactions:
   samples=[]
   for i in range(min(20,a.count)):
    target=f'open-{a.count-1-i}'
    start=time.monotonic();page.locator('#search-input').fill(f'"开页案例{a.count-1-i}"')
    page.locator(f'.case-card[data-entry-id="{target}"]').wait_for()
    page.wait_for_function('() => document.querySelectorAll(".case-card").length === 1')
    samples.append(round((time.monotonic()-start)*1000,1))
   result['search']={'samplesMs':samples,'p95Ms':sorted(samples)[math.ceil(len(samples)*.95)-1],'targetMs':300,'scope':'isolated synthetic fixture, real input-to-card update'}
   page.locator('#search-input').fill('');page.wait_for_function('() => document.querySelectorAll(".case-card").length >= 24')
   scroll=[]
   for i in range(10):
    before=int(page.locator('#case-list').get_attribute('data-loaded-count') or 0)
    if before>=a.count:break
    start=time.monotonic();page.evaluate('window.scrollTo(0,document.documentElement.scrollHeight)')
    page.wait_for_function('before => Number(document.querySelector("#case-list").dataset.loadedCount) > before',arg=before)
    scroll.append({'step':i+1,'ms':round((time.monotonic()-start)*1000,1),'cards':page.locator('.case-card').count(),'loaded':int(page.locator('#case-list').get_attribute('data-loaded-count'))})
   result['scroll']=scroll
  print(json.dumps(result,ensure_ascii=False),flush=True)
  assert ready<a.budget_ms,f'Opening {a.count} cases took {ready:.0f}ms; target from existing plan {a.budget_ms}ms'
  if a.interactions:assert result['search']['p95Ms']<300,f'Isolated search P95 {result["search"]["p95Ms"]}ms exceeds existing plan target 300ms'
